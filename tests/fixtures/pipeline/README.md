# Pipeline test fixtures (TEST DATA)

Recorded-shape answers of every source the pipeline reads, so `pipeline/run.mjs` can run end to end without network
access. The values are **fixture values, not verified facts**: well-known projects appear with plausible coordinates,
years, files and links, and QIDs `Q99000xxx` do not exist on Wikidata. Never publish anything from here.

| path | shaped like |
|---|---|
| `wikidata/entities/<QID>.json` | one entity of `wbgetentities` (labels, descriptions, claims with mainsnak/datavalue/rank, sitelinks with URLs) |
| `wikidata/sparql/class-count-<QID>.json`, `class-instances-<QID>.json` | `query.wikidata.org` SPARQL JSON results (`head.vars`, `results.bindings`) |
| `commons/categories.json` | Commons category pages (`formatversion=2`: `pageprops.wikibase_item`, `categoryinfo`, `coordinates`) and their `categorymembers` |
| `commons/files.json` | Commons file pages: `imageinfo` (sizes, sha1, thumb URLs, `extmetadata` with licence and author) and `templates` |
| `commons/search.json` | category (namespace 14) and file (namespace 6) name search results |
| `wikipedia/<lang>.json` | `list=search` hits (with `searchmatch` snippets) and `prop=pageprops|extracts|coordinates` pages |
| `web/gdelt.json`, `web/feed.xml` | a GDELT DOC 2.0 `ArtList` answer and an RSS 2.0 feed (served with an ETag) |
| `links.json`, `overpass.json` | link-check and `robots.txt` answers per host; an Overpass `out center tags` answer |
| `thumbs/*.jpg` | 330 px thumbnails generated with sharp: LED facade at night, projections, a light field, a daytime building, a colourful daytime frame, a dark frame with white beams, dim windows, an interior |
| `editorial/` | editorial decisions and a hero allowlist exercising every action and status |
| `site-data/`, `admin-data/` | **the output of a dry run** over all of the above (59 projects): the small, schema-valid dataset the UI track develops against |

`fake-fetch.mjs` composes the answers the way the services do (batches of `wbgetentities`, SPARQL bindings for the
aux query, Commons template continuation in pages of 12, `If-None-Match` → 304, per-host `robots.txt`) and keeps a
virtual clock, so rate limits and the time budget run instantly. It also records every request (time, host, URL,
User-Agent) for the politeness tests, and takes a `fail(url, init)` hook to inject outages.

Regenerate after changing the world or the pipeline:

```
node tests/fixtures/pipeline/make-fixtures.mjs   # the recorded answers and thumbnails (needs sharp: npm ci --prefix pipeline)
node tests/fixtures/pipeline/make-site-data.mjs  # site-data/ and admin-data/ from a dry run
```

`tests/pipeline-run.test.mjs` fails when `site-data/` is not exactly what a fresh dry run produces.
