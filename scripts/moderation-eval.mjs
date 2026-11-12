#!/usr/bin/env node
// Measures the contextual moderation classifier on the labelled set (tests/fixtures/moderation/eval.json,
// docs/PLATFORM.md "Moderation"): each item goes through the rules and the classifier (edge-functions/_shared/
// platform/classify.mjs), then decide(); prints the confusion matrix and the rates. Spends API credit: 40 requests.
// Needs the Anthropic SDK (npm i --no-save @anthropic-ai/sdk) and ANTHROPIC_API_KEY in the environment (never in a file).
//   node scripts/moderation-eval.mjs [--model=claude-opus-5-5]
import { readFile } from 'node:fs/promises'
import { rules, decide, evaluate } from '../edge-functions/_shared/platform/moderation.mjs'
import { classify, DEFAULT_MODEL } from '../edge-functions/_shared/platform/classify.mjs'

const model = (process.argv.find((a) => a.startsWith('--model=')) || '').slice(8) || DEFAULT_MODEL
let Anthropic
try { ({ default: Anthropic } = await import('@anthropic-ai/sdk')) } catch { console.error('Install the SDK first: npm i --no-save @anthropic-ai/sdk'); process.exit(2) }
if (!process.env.ANTHROPIC_API_KEY) { console.error('Set ANTHROPIC_API_KEY in the environment.'); process.exit(2) }
const client = new Anthropic()
const { items } = JSON.parse(await readFile(new URL('../tests/fixtures/moderation/eval.json', import.meta.url), 'utf8'))
const rows = []
for (const it of items) {
  const r = rules(it.text)
  let c = null
  try { c = r.block ? null : await classify(client, { model, type: it.type, text: it.text }) } catch (e) { c = { ok: false, error: e?.status ? `http_${e.status}` : 'error' } }
  const d = decide({ rules: r, classifier: c })
  rows.push({ id: it.id, group: it.group, expected: it.expected, got: d.decision })
  console.log(`${it.id.padEnd(4)} ${it.group.padEnd(10)} expected ${it.expected.padEnd(12)} got ${d.decision.padEnd(12)} ${c?.refusal ? 'refusal' : c?.ok === false ? c.error : ''}`)
}
const m = evaluate(rows)
console.log(JSON.stringify({ model, ...m, borderline_rejected: rows.filter((r) => r.group === 'borderline' && r.got === 'rejected').length }, null, 1))
