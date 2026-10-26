/** Calls to the API (same address as this page; see vite.config.ts). */

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const body = json as { error?: string; message?: string; issues?: string[] } | null;
    const message = [
      body?.error ?? body?.message ?? response.statusText,
      ...(body?.issues ?? []),
    ].join(': ');
    throw new ApiError(response.status, message);
  }
  return json as T;
}

// Response shapes (dates arrive as ISO strings).

export interface Owner {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface Connection {
  account: string;
  state: string;
  qrSvg: string | null;
  pairingCode: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastDisconnectReason: string | null;
  lastMessageAt: string | null;
  updatedAt: string;
}

export interface Group {
  id: number;
  name: string | null;
  watched: boolean;
  sourceType: 'developer' | 'broker' | null;
  isMember: boolean;
  lastMessageAt: string | null;
  messages: number;
}

export type UnitRecord = Record<string, unknown> & {
  id: number;
  status: string;
  confidence: number;
  needsReview: boolean;
  reviewReasons: string[];
  priceCurrency: string;
};

export interface Source {
  messageId: number;
  role: string;
  sentAt: string;
  groupName: string | null;
  text: string | null;
  media: {
    id: number;
    kind: string;
    mimeType: string | null;
    status: string;
    derivedText: string | null;
    derivedMethod: string | null;
  } | null;
}

export interface PriceRow {
  id: number;
  minPrice: number | null;
  maxPrice: number | null;
  priceCurrency: string;
  downPayment: number | null;
  installmentYears: number | null;
  observedAt: string;
}

export interface UnitView {
  unit: UnitRecord;
  names: { developer: string | null; project: string | null; city: string | null };
  sources: Source[];
  prices: PriceRow[];
}

export interface Entity {
  id: number;
  nameEn: string;
  nameAr: string;
  developerId?: number;
  cityId?: number;
  aliases: { id: number; alias: string; source: string }[];
  unitCount: number;
}
export type EntityKind = 'city' | 'developer' | 'project';

export interface Stats {
  days: {
    day: string;
    messages: number;
    processed: number;
    skipped: number;
    failed: number;
    modelCalls: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  extractionSuccessRate: number | null;
  needsReviewRate: number | null;
  units: Record<string, number>;
  needsReview: number;
}

export interface FailedJob {
  id: string;
  queue: string;
  data: unknown;
  error: string | null;
  failedAt: string | null;
  retries: number;
}

export interface Settings {
  usdEgpRate: number | null;
  usdEgpRateFallback: number | null;
}
