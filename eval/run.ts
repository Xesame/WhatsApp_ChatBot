/**
 * pnpm eval: measures extraction accuracy on the labeled cases in eval/cases.
 *
 *   pnpm eval                  call the configured models (needs GEMINI_API_KEY or another key)
 *   pnpm eval --record         same, and save each model answer to eval/recordings/
 *   pnpm eval --replay         use saved answers instead of calling models (free, offline)
 *   pnpm eval --case <id>      run one case
 *
 * Each case is a folder with message.txt, optional quoted.txt (the message it
 * replies to) and expected.json. The report (per-field accuracy, unit-count
 * accuracy, cost, latency) is printed and written to eval/reports/. It is
 * compared with eval/reports/latest.json, the last saved report.
 *
 * Example cases (`"source": "example"`) are written by hand to show the format
 * and test the runner; they are reported separately and never count toward
 * the accuracy that decides prompt or model changes.
 */
import { loadConfigOrExit } from '@reb/config';
import { cities, createDatabase, developers, projects } from '@reb/db';
import {
  apiKeysFrom,
  LlmClient,
  parseModelList,
  PROVIDERS,
  scrubPersonalData,
  type Attempt,
} from '@reb/llm';
import { mightBeListing, runClassification, runExtraction } from '@reb/pipeline';
import type { Unit } from '@reb/schema';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  COMPARED_FIELDS,
  KEY_FIELDS,
  percent,
  scoreCase,
  sumScores,
  type CaseScore,
  type ComparableUnit,
  type FieldTally,
} from './compare.ts';

const root = new URL('.', import.meta.url).pathname;
const casesDir = join(root, 'cases');
const recordingsDir = join(root, 'recordings');
const reportsDir = join(root, 'reports');

interface Expected {
  source: 'real' | 'review' | 'example';
  kind: 'text' | 'image' | 'pdf';
  /** When the message was posted (for "delivery in 3 years"). Defaults to the run date. */
  sentAt?: string;
  intent: 'listing' | 'price_update' | 'sold' | 'not_relevant';
  units: ComparableUnit[];
}

interface Recording {
  /** True when the answers were written by hand rather than recorded from a model. */
  handwritten?: boolean;
  classification?: string;
  extraction?: string;
}

const { values } = parseArgs({
  options: {
    record: { type: 'boolean' },
    replay: { type: 'boolean' },
    case: { type: 'string' },
  },
});

const config = loadConfigOrExit();
const database = createDatabase(config.DATABASE_URL, { max: 2 });
const models = {
  classify: parseModelList(config.LLM_CLASSIFY_MODELS),
  extract: parseModelList(config.LLM_EXTRACT_MODELS),
};

/** In replay mode, a fake HTTP layer answers from the case's recording. */
function replayFetch(recording: Recording): typeof fetch {
  return ((_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as {
      response_format: { json_schema: { name: string } };
    };
    const name = body.response_format.json_schema.name as 'classification' | 'extraction';
    const content = recording[name];
    if (content === undefined)
      return Promise.resolve(new Response('{"error":"no recording"}', { status: 404 }));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        }),
      ),
    );
  }) as unknown as typeof fetch;
}

/** English names by ID, loaded once. */
const entityNames = {
  developer: new Map(
    (await database.db.select({ id: developers.id, name: developers.nameEn }).from(developers)).map(
      (r) => [r.id, r.name],
    ),
  ),
  project: new Map(
    (await database.db.select({ id: projects.id, name: projects.nameEn }).from(projects)).map(
      (r) => [r.id, r.name],
    ),
  ),
  city: new Map(
    (await database.db.select({ id: cities.id, name: cities.nameEn }).from(cities)).map((r) => [
      r.id,
      r.name,
    ]),
  ),
};

/** Unit in the export form used by expected.json: names instead of IDs, whole currency units. */
function comparable(unit: Unit): ComparableUnit {
  const name = (kind: keyof typeof entityNames, id: number | null) =>
    id === null ? null : (entityNames[kind].get(id) ?? null);
  const major = (minor: number | null) => (minor === null ? null : minor / 100);
  return {
    category: unit.category,
    developer: name('developer', unit.developerId),
    project: name('project', unit.projectId),
    city: name('city', unit.cityId),
    unitType: unit.unitType,
    unitCode: unit.unitCode,
    floor: unit.floor,
    finishingSpecs: unit.finishingSpecs,
    minArea: unit.minArea,
    maxArea: unit.maxArea,
    landArea: unit.landArea,
    gardenArea: unit.gardenArea,
    outdoorArea: unit.outdoorArea,
    minPrice: major(unit.minPrice),
    maxPrice: major(unit.maxPrice),
    priceCurrency: unit.priceCurrency,
    deliveryYear: unit.deliveryYear,
    readyToMove: unit.readyToMove,
    maintenance: unit.maintenance,
    maintenanceCurrency: unit.maintenanceCurrency,
    cashDiscount: unit.cashDiscount,
    cashDiscountType: unit.cashDiscountType,
    downPayment: unit.downPayment,
    installmentsCount: unit.installmentsCount,
    bedrooms: unit.bedrooms,
    bathrooms: unit.bathrooms,
  };
}

interface CaseResult {
  id: string;
  expected: Expected;
  score: CaseScore;
  costUsd: number;
  latencyMs: number;
  modelCalls: number;
  handwritten: boolean;
}

async function runCase(id: string): Promise<CaseResult> {
  const dir = join(casesDir, id);
  const expected = JSON.parse(await readFile(join(dir, 'expected.json'), 'utf8')) as Expected;
  const text = scrubPersonalData(await readFile(join(dir, 'message.txt'), 'utf8'));
  const quotedPath = join(dir, 'quoted.txt');
  const quoted = existsSync(quotedPath)
    ? scrubPersonalData(await readFile(quotedPath, 'utf8'))
    : null;
  const recordingPath = join(recordingsDir, `${id}.json`);
  const recording: Recording = existsSync(recordingPath)
    ? (JSON.parse(await readFile(recordingPath, 'utf8')) as Recording)
    : {};

  if (values.replay && !existsSync(recordingPath))
    throw new Error(`No recording for case ${id}; run with --record first`);
  const llm = new LlmClient({
    apiKeys: values.replay
      ? Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, 'replay']))
      : apiKeysFrom(config),
    requestsPerMinute: values.replay ? 10_000 : config.LLM_REQUESTS_PER_MINUTE,
    timeoutMs: config.LLM_TIMEOUT_MS,
    freeTier: config.LLM_FREE_TIER === 'true',
    ...(values.replay ? { fetch: replayFetch(recording) } : {}),
  });

  const attempts: Attempt[] = [];
  let intent: Expected['intent'] = 'not_relevant';
  let produced: Unit[] = [];
  const newRecording: Recording = {};

  if (mightBeListing(`${text} ${quoted ?? ''}`)) {
    const classification = await runClassification(llm, models.classify, { text, quoted });
    attempts.push(...classification.attempts);
    newRecording.classification = classification.attempts.at(-1)?.rawOutput ?? undefined;
    intent = classification.data?.intent ?? 'not_relevant';
    if (intent !== 'not_relevant') {
      const extraction = await runExtraction(database.db, llm, models.extract, {
        text,
        quoted,
        sourceText: [text, quoted].filter(Boolean).join('\n'),
        sentAt: expected.sentAt ? new Date(expected.sentAt) : new Date(),
      });
      attempts.push(...extraction.attempts);
      newRecording.extraction = extraction.attempts.at(-1)?.rawOutput ?? undefined;
      // Price updates and sold notices produce no new units until Phase 4,
      // but their extraction is still scored.
      produced = extraction.units;
    }
  }
  if (values.record) await writeFile(recordingPath, `${JSON.stringify(newRecording, null, 2)}\n`);

  const actualUnits = produced.map(comparable);
  return {
    id,
    expected,
    score: scoreCase(
      { intent: expected.intent, units: expected.units },
      { intent, units: actualUnits },
    ),
    costUsd: attempts.reduce((sum, a) => sum + (a.costUsd ?? 0), 0),
    latencyMs: attempts.reduce((sum, a) => sum + a.latencyMs, 0),
    modelCalls: attempts.length,
    handwritten: values.replay === true && recording.handwritten === true,
  };
}

function table(
  title: string,
  results: CaseResult[],
  previous: Record<string, number> | undefined,
): string[] {
  if (results.length === 0) return [];
  const fields = sumScores(results.map((r) => r.score));
  const tally = (f: string): FieldTally => fields[f] ?? { correct: 0, total: 0 };
  const lines = [
    `## ${title} (${results.length} case${results.length === 1 ? '' : 's'})`,
    '',
    `- Intent correct: ${results.filter((r) => r.score.intentCorrect).length}/${results.length}`,
    `- Unit count correct: ${results.filter((r) => r.score.unitCountCorrect).length}/${results.length}`,
    `- Model calls: ${results.reduce((s, r) => s + r.modelCalls, 0)}, cost: $${results.reduce((s, r) => s + r.costUsd, 0).toFixed(4)}, average latency per message: ${Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length)} ms`,
    '',
    '| Field | Accuracy | Change | Correct / total |',
    '| --- | --- | --- | --- |',
  ];
  for (const field of COMPARED_FIELDS) {
    const now = percent(tally(field));
    const before = previous?.[field];
    const change =
      before === undefined ? '' : `${now - before >= 0 ? '+' : ''}${(now - before).toFixed(1)}`;
    const flag =
      KEY_FIELDS.includes(field) && before !== undefined && now - before < -2
        ? ' ⚠ needs approval'
        : '';
    lines.push(
      `| ${KEY_FIELDS.includes(field) ? `**${field}**` : field} | ${now}% | ${change}${flag} | ${tally(field).correct}/${tally(field).total} |`,
    );
  }
  lines.push('', '**Mistakes**', '');
  for (const r of results) {
    for (const m of r.score.mistakes) lines.push(`- ${r.id}: ${m}`);
  }
  return [...lines, ''];
}

try {
  const ids = (await readdir(casesDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && (!values.case || d.name === values.case))
    .map((d) => d.name)
    .sort();
  if (ids.length === 0) throw new Error('No cases found in eval/cases');
  if (!values.replay && Object.keys(apiKeysFrom(config)).length === 0) {
    throw new Error(
      'No model API key set. Set GEMINI_API_KEY (and GROQ_API_KEY, OPENROUTER_API_KEY) in .env, or use --replay.',
    );
  }

  const results: CaseResult[] = [];
  for (const id of ids) {
    process.stdout.write(`${id} ... `);
    const result = await runCase(id);
    results.push(result);
    console.log(
      result.score.mistakes.length === 0
        ? 'all correct'
        : `${result.score.mistakes.length} mistake(s)`,
    );
  }

  const latestPath = join(reportsDir, 'latest.json');
  const previous = existsSync(latestPath)
    ? (JSON.parse(await readFile(latestPath, 'utf8')) as { fields: Record<string, number> }).fields
    : undefined;
  const real = results.filter((r) => r.expected.source !== 'example');
  const examples = results.filter((r) => r.expected.source === 'example');
  const kinds = [...new Set(real.map((r) => r.expected.kind))];

  const report = [
    `# Eval report ${new Date().toISOString()}`,
    '',
    `Prompts: classify and extract versions as recorded in extraction_runs. Models: classify ${config.LLM_CLASSIFY_MODELS}; extract ${config.LLM_EXTRACT_MODELS}. Mode: ${values.replay ? 'replay (saved answers)' : 'live'}.`,
    '',
    real.length === 0
      ? '**No real cases yet: the accuracy below comes from example cases only and means nothing about real performance.**'
      : '',
    '',
    ...table('Real cases: all', real, previous),
    ...kinds.flatMap((kind) =>
      kinds.length > 1
        ? table(
            `Real cases: ${kind}`,
            real.filter((r) => r.expected.kind === kind),
            undefined,
          )
        : [],
    ),
    ...table('Example cases (not counted)', examples, undefined),
  ].join('\n');

  await mkdir(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(join(reportsDir, `${stamp}.md`), report);
  if (real.length > 0 && !values.replay) {
    const fields = sumScores(real.map((r) => r.score));
    await writeFile(
      latestPath,
      `${JSON.stringify({ date: new Date().toISOString(), fields: Object.fromEntries(Object.entries(fields).map(([f, t]) => [f, percent(t)])) }, null, 2)}\n`,
    );
  }
  console.log(`\n${report}\nSaved to eval/reports/${stamp}.md`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database.close();
}
