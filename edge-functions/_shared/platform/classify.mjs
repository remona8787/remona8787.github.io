// The contextual moderation classifier call (v2.0, docs/PLATFORM.md "Moderation"). The caller passes an Anthropic SDK
// client (npm:@anthropic-ai/sdk in the Edge Function, @anthropic-ai/sdk in scripts/moderation-eval.mjs), so this
// module has no import of its own and no secret. Structured output (a JSON schema) keeps the answer machine-readable;
// server-side refusal fallbacks are on for the models that have them, and a refusal is reported as such (decide() then holds the
// item for a person).
import { SYSTEM_PROMPT, OUTPUT_SCHEMA, userMessage, parse } from './moderation.mjs'

export const DEFAULT_MODEL = 'claude-opus-5-5'
// Server-side refusal fallbacks exist for the Fable 5 family, Claude Opus 5 / 5.5 and Claude Sonnet 5.5; a cheaper model
// the operator may choose (MODERATION_MODEL, e.g. claude-haiku-5-5) gets the request without them, and its refusals go
// to a person like any other.
export const hasFallbacks = (model) => /^claude-(fable-5|opus-5|sonnet-5-5)/.test(String(model))

export function request({ model = DEFAULT_MODEL, type, text, projectName = null }) {
  return {
    model,
    max_tokens: 4000,
    ...(hasFallbacks(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage({ type, text, projectName }) }],
  }
}

export async function classify(client, args) {
  const response = await client.beta.messages.create(request(args))
  if (response.stop_reason === 'refusal') return { refusal: true, category: response.stop_details?.category ?? null, model: response.model }
  if (response.stop_reason === 'max_tokens') return { ok: false, error: 'max_tokens', model: response.model }
  const block = response.content.find((b) => b.type === 'text')
  let obj = null
  try { obj = JSON.parse(block?.text ?? '') } catch { return { ok: false, error: 'invalid_json', model: response.model } }
  return { ...parse(obj), model: response.model, usage: { input: response.usage?.input_tokens ?? null, output: response.usage?.output_tokens ?? null } }
}
