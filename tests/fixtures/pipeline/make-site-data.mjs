// Writes tests/fixtures/pipeline/site-data/ and admin-data/: the output of a pipeline dry run over the recorded
// fixtures (run.mjs with the injected fetch and a virtual clock). The UI track reads this as a small, schema-valid
// dataset; tests/pipeline-run.test.mjs checks that it equals a fresh dry run. TEST DATA, never published.
//   node tests/fixtures/pipeline/make-site-data.mjs
import { mkdtemp, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runPipeline } from '../../../pipeline/run.mjs'
import { fixtureEnvironment, FIXTURE_OVERRIDES, FIXTURE_ENV } from './fake-fetch.mjs'

const here = import.meta.dirname
const dir = await mkdtemp(path.join(tmpdir(), 'aol-fixture-run-'))
const env = fixtureEnvironment({ start: Date.parse('2026-10-20T06:17:00Z') })
const r = await runPipeline({ dataDir: dir, editorialDir: path.join(here, 'editorial'), fetch: env.fetch, clock: env.clock, sleep: env.sleep, overrides: FIXTURE_OVERRIDES, env: FIXTURE_ENV, log: () => {} })
for (const d of ['site-data', 'admin-data']) {
  await rm(path.join(here, d), { recursive: true, force: true })
  await cp(path.join(dir, d), path.join(here, d), { recursive: true })
}
await rm(dir, { recursive: true, force: true })
console.log(`fixture dataset: ${r.report.counts.published} projects, build ${r.buildId}, status ${r.report.run.status}`)
