# Evaluation set

Measures extraction accuracy, so prompt and model changes are decided by numbers. Full guide: PROJECT.md, chapter 12.

```
eval/
  cases/<id>/message.txt      the message, as posted (contact details are scrubbed when run)
  cases/<id>/quoted.txt       optional: the message it replies to
  cases/<id>/expected.json    the correct answer (intent + units, in export form)
  recordings/<id>.json        saved model answers, for free offline runs (--replay)
  reports/                    one report per run; latest.json is the baseline for comparisons
  compare.ts                  field-by-field scoring
  run.ts                      the runner
```

```sh
pnpm eval                 # call the models (needs GEMINI_API_KEY or another model key)
pnpm eval --record        # call the models and save their answers
pnpm eval --replay        # use saved answers: free, offline, repeatable
pnpm eval --case <id>     # one case
```

The three `example-*` cases are written by hand (`"source": "example"`, recordings marked `"handwritten": true`) to show the format and test the runner. They are reported separately and never count toward real accuracy.
