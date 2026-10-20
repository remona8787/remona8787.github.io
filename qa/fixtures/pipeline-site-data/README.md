# Pipeline fixture dataset (copy)

A copy of `tests/fixtures/pipeline/site-data/` from the pipeline track (`wt/v17-pipeline`, commit b5bdfb7): the
dataset `pipeline/run.mjs` writes from its recorded-shape fixtures. TEST DATA ("Fixture Photographer" credits), never
published. The consumer UI reads it in `tests/app-dataset.test.mjs` and `qa/v17-data.spec.mjs` to prove that the app
understands what the pipeline actually writes. Once both tracks are merged, the tests prefer the original under
`tests/fixtures/pipeline/site-data/` when it exists.
