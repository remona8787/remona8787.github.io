# Archive pipeline: operations (v0.17)

This document covers the pipeline that grows the archive from the 49 curated places to hundreds or thousands of
real, source-verified projects. It runs as a GitHub Actions workflow in `remona8787/remona8787.github.io` and
publishes a static, sharded dataset on GitHub Pages.

- The contract (repository layout, eligibility, image rules, output files, consumer rules) is `docs/STATIC_ARCHIVE.md`.
- This document says how to operate it.
- The Supabase path (`docs/ARCHIVE_SPEC.md`) is optional and independent.

```
sources ─ Wikidata classes · Commons categories · Wikipedia media-facade search · web candidates (GDELT, RSS)
   → classify/type → resolve entities → dedupe/merge → enrich (Wikidata facts) → editorial decisions → eligibility
   → images (rights, keyword and visual scores, roles) → contact sheets → link checks → Overpass (optional)
   → shard → site-data/ admin-data/ review/ state/          (pipeline/run.mjs, Node 22, ~25 min budget)
   → deploy: build source + data → main → GitHub Pages     (pipeline/deploy.mjs)
   → verify-live: screenshots and measurements → review/live/ (pipeline/verify-live.mjs)
```

| file | role |
|---|---|
| `pipeline/run.mjs` | one collect run (all stages); `--fixtures` runs it over the recorded test answers |
| `pipeline/config/classes.json` | Wikidata classes (QID, verified, include, `project_type`, rule), blocklist classes, properties |
| `pipeline/config/categories.json` | Commons search terms, root categories, aggregate-name patterns, blocklist, night/event subcategory patterns |
| `pipeline/config/pipeline.json` | budget and stage shares, source switches, cache TTLs, Wikipedia terms per language, entity rules, image thresholds, link-check and output settings |
| `pipeline/lib/*.mjs` | the stages (net, cache, wikidata, commons, wikipedia, web, entities, images, visual, contact-sheet, editorial, links, overpass, output, schema, state) |
| `pipeline/deploy.mjs` | job `deploy`: assembles main from the build and the data branch |
| `pipeline/verify-live.mjs` | job `verify-live`: waits for the deploy, checks the live site with Playwright |
| `pipeline/ci/use-branch.sh`, `pipeline/ci/commit-push.sh` | branch switching and commits (github-actions[bot], bounded history) |
| `deploy/pages-repo/` | canonical copies of the files on `main`: `.github/workflows/archive.yml`, `README.md`, `.nojekyll` |

## 1. Running it

| how | what runs |
|---|---|
| Schedule: `17 */6 * * *` (UTC: 00:17, 06:17, 12:17, 18:17; KST 09:17, 15:17, 21:17, 03:17) | collect → deploy → verify-live |
| Actions → **archive** → Run workflow | the same. Turn off "collect" to only build, deploy and verify; "budget_minutes" sets the collect budget. |
| Push to `source` | deploy → verify-live. Collect runs too when the head commit message contains `[collect]`. |

All jobs share the concurrency group `archive`: one run at a time, never two pushers. A run that arrives while
another is going waits for it.

Locally, from the project root (`light-architecture/` in the development repository, the branch root on `source`):

```
npm ci --prefix pipeline                       # sharp (image scoring and contact sheets); yaml for the workflow tests
node pipeline/run.mjs --data=../data           # a real run into ../data (needs internet access to the sources)
npm run dry-run --prefix pipeline               # dry run over the fixtures into pipeline/.dry-run/ (no network)
node tests/fixtures/pipeline/make-site-data.mjs                  # regenerate the committed fixture dataset
npm run build && node pipeline/deploy.mjs --dist=dist --data=pipeline/.dry-run --site=/tmp/site   # assemble a main tree
node scripts/serve.mjs /tmp/site 4321 & node pipeline/verify-live.mjs --site=http://127.0.0.1:4321/ --out=/tmp/live
```

Options of `run.mjs`: `--data=<dir>` (default `../data`), `--editorial=<dir>` (default `editorial/` when it exists),
`--budget=<minutes>`, `--fixtures`, `--now=<iso>` (fixtures only). A run exits 0 when it wrote its report, even if it
kept the previous dataset; it exits 1 only on a crash, and then the workflow commits nothing.

## 2. Where the outputs live

| data branch | published at | content |
|---|---|---|
| `site-data/manifest.json` | `/data/manifest.json` | `schema`, `build_id`, `generated_at`, `counts` (projects, with_images, with_hero, by_type, by_region, by_country), `files` (index, home, stats, shards), `sources` (`{status, last_success, items}` per source), `credits` |
| `site-data/index.json` | `/data/index.json` | `{schema, fields, rows}`; fields: id, name_ko, name_en, name_original, country_iso2, city, lat, lng, project_type, year, thumb, visual_rank, shard, added_at. Loaded lazily by explore and map, never by the home first paint. Under 1 MB for 5,000 rows. |
| `site-data/home.json` | `/data/home.json` | everything the home page needs: `hero` (≤ 6 reviewed slides), `featured` (≤ 12), `regions`, `types` (counts and a representative image), `recent`, `counts`, and `projects` (compact records of every id named) |
| `site-data/projects/<shard>.json` | `/data/projects/<shard>.json` | full records, about 200 per shard; the shard count is a power of two, so an id changes shard only when the archive doubles |
| `site-data/stats.json` | `/data/stats.json` | counts behind the research page (by type, region, country, decade, year, origin, source kind, credit role; top cities) |
| `admin-data/report.json` | `/data/admin/report.json` | the run: status, publish decision, stages, sources (status, items, errors, consecutive failures, last success), HTTP counters per host, reachability, cache sizes, counts (new, changed, merged, removed, carried over, stale, excluded), image statistics, changes, applied decisions, hero list status, review queue, errors |
| `admin-data/quality.json` | `/data/admin/quality.json` | missing images, no home image, broken links, robots-disallowed links, suspected duplicates, stale projects (not seen in 3 runs), low-confidence types, excluded projects with reasons, coordinate mismatches (Overpass), image rejection counts |
| `admin-data/candidates.json` | `/data/admin/candidates.json` | web-derived candidates (GDELT, RSS; NAVER/Brave when keyed) with their hits, classification and confidence; never public until approved |
| `review/classes.json`, `properties.json` | not published | the live label, description and instance counts of every configured class and property, and whether each is published from |
| `review/categories.json` | not published | every Commons category decision with its reason |
| `review/wikipedia.json` | not published | every Wikipedia hit (language, term, score, reasons) and the entity decision of each accepted hit |
| `review/images.json` | not published | per project: every image candidate with rights, keyword and visual scores, tier and hero decision |
| `review/contact-sheets/*.jpg`, `index.json` | not published | grids of hero and card candidates labelled `#n <project id>`, `T<tier> V<visual>` and `OK` (allowlisted) or `H?` (awaiting review) |
| `review/web.json`, `http-log.json` | not published | web rule results; HTTP retries, maxlag waits and errors |
| `review/live/` | not published | `report.json` and `<mobile|desktop>-<page>.jpg` of the last live check |
| `state/` | not published | `runs.json` (counter, last good build), `tracker.json` (per-project first/last seen, missing runs), `failures.json`, `web-rules.json`, `candidates.json`, `image-picks.json`, `cache/*.json` (responses with TTLs and ETags) |

Record fields (`projects/<shard>.json`) follow `docs/ARCHIVE_SPEC.md` §6:

- identity and names: `id`, `curated_place_id`, `wikidata`, `name_ko`, `name_en`, `name_original`, `name_original_lang`, `aliases`;
- place: `country_iso2`, `region`, `city`, `city_ko`, `district`, `address`, `lat`, `lng`, `location_precision`;
- the work: `project_type`, `year_installed`, `year_completed`, `year_operating_since`, `year_ended`, `operating_status`, `building_name`, `installation_method`, `envelope_type`, `technologies`, `content_types`, `spatial_context`, `summary_ko`, `summary_en`, `credits[]` (`{role, name, name_en, wikidata_qid}`), `official_url`, `commons_category`;
- media and sources:
  - `images[]`: `{thumb, src, page, license, license_url, author, attribution, role: hero|card|detail, tier: 1–4, width, height}`;
  - `videos[]`;
  - `sources[]`: `{id, kind, title, url, publisher}`;
  - `field_sources`: which source gave each field;
  - `visit`: `{status, note, period, source}`, only when a source states it;
- bookkeeping: `record_origin`, `added_at`, `shard`.

A fact without a source is `null`. Nothing about review state, scores or runs is in a public record.

Reader rule for `index.json`: above 512 KB the index stores Commons thumbnails as `"<h>/<hh>/<File.jpg>"` and names
the pattern once in `thumb_template`. A `thumb` that is not an https URL becomes
`thumb_template.replace('{path}', thumb).replace('{file}', last path segment)`. Below the threshold every thumb is a
full URL.

## 3. What a run guarantees

- **Polite.** Every request carries `User-Agent: LightArchitectureArchive/0.17 (+https://remona8787.github.io/; remona56@hanmail.net)`.
  - Every MediaWiki API call has `maxlag=5` and waits and retries on a maxlag answer.
  - 429 and 5xx answers are retried with backoff, honouring `Retry-After`.
  - Per-host spacing is strict (table in §4).
  - Answers are cached with TTLs and ETags, so a run asks only for what is new or expired.
- **Bounded.** A 25-minute budget is split into stage shares (sources 42 %, enrichment 16 %, images 30 %, links 8 %).
  - No request starts after its stage's deadline.
  - What a stage did not reach keeps its previous data (images, link results), so the output is partial but consistent.
  - The report marks such stages `partial`.
- **Never loses the last good dataset.**
  - The new dataset is written to a staging directory, checked against the schema (`lib/schema.mjs`) and only then swapped in.
  - An invalid dataset is not published (`publish: kept_previous_invalid_output`).
  - Neither is a drop of more than half of the projects at once (`kept_previous_drop_guard`).
  - A project that a failed or partial source no longer returns is carried over unchanged.
  - A project missing although all its sources completed stays for 3 runs (listed as stale in quality.json), then it is removed.
  - Hidden or ineligible projects go at once.
- **Idempotent.**
  - An unchanged run keeps the same `build_id` and byte-identical files.
  - The deploy id is a hash of the deployed tree, so an unchanged deploy commits nothing.
- **Bounded history.** `commit-push.sh` replaces the history of `data` and `main` with one snapshot commit once it
  exceeds 120 commits. That is about two weeks on `data` (collect and verify commit there) and a month on `main`.
  - Only the github-actions[bot] identity commits, with a lease on the old tip.
  - If branch protection refuses the force push, it pushes normally.

## 4. Sources: rate limits and terms

| source | used for | limit in the pipeline | terms |
|---|---|---|---|
| Wikidata Query Service `query.wikidata.org/sparql` | class counts and instances (`?item wdt:P31/wdt:P279* wd:<class>`, LIMIT 5000), auxiliary labels, ISO codes, P131 chains | 1 request/s, cached 24 h (counts, instances) and 30 days (aux) | data CC0; WDQS user-agent policy and 60 s query limit |
| Wikidata API `www.wikidata.org/w/api.php` | `wbgetentities`, 25 items per request: labels (ko, en, original language), P17, P131, P625, P571, P580, P582, P84, P170, P137, P856, P373, P18, P301, sitelinks | 1 request/s, `maxlag=5`, cached 72 h | CC0 |
| Wikimedia Commons API | category search (namespace 14), file search (namespace 6) for "media facade" terms, P180 depicts search, category walk, members, `imageinfo` + `extmetadata`, templates (deletion, NoFoP, Korean FoP) | 1 request/s, `maxlag=5`; categories 72 h, depicts and file metadata 14 days | each file's own licence; attribution is always published with the image |
| `upload.wikimedia.org` | 330 px thumbnails for visual scoring | 5 requests/s, ≤ 1,800 per run, standard thumbnail steps only, the score cached a year by file and sha1 | as above; thumbnails are measured, never re-hosted |
| Wikipedia APIs (14 wikis: en de ko ja zh fr es it nl pl ru pt tr ar) | `list=search` phrase queries, `pageprops` (wikibase_item), lead extracts, coordinates | 1 request/s per wiki (the wikis in parallel), `maxlag=5`; search 72 h, pages 7 days | CC BY-SA 4.0: only the article URL is published, as a source; snippets stay in `review/` |
| GDELT DOC 2.0 | news candidates | 1 request per 5 s | free; candidates only |
| RSS/Atom feeds (seed rules of `edge-functions/_shared/archive/seed-rules.mjs`) | news candidates | conditional GET (ETag / Last-Modified), 1 request/s per host, per-rule backoff | each publisher's terms; titles and links only, candidates only |
| NAVER, Brave search | candidates, only with keys | as in the collector | API terms. The workflow passes no secrets: to enable them, add `NAVER_API_KEY_ID`, `NAVER_API_KEY` or `BRAVE_API_KEY` as repository secrets and to the env of the Collect step. |
| Overpass API `overpass-api.de` | optional coordinate confirmation (`wikidata=` tags) | 1 request per 10 s, one query of ≤ 50 items per run, cached 30 days; skipped when unreachable | OSM data is not copied into the dataset (ODbL); it only flags mismatches over 1 km |
| Official and source links | link checks | HEAD, then a 1-byte GET; `robots.txt` honoured before HTML pages; 1 request/s per host; ≤ 400 per run, cached 7 days; Wikimedia hosts skipped | — |

Every Wikidata class and property id is confirmed by a live query in each run:

- the labels go to `review/classes.json` and `review/properties.json`;
- a class whose live label no longer matches is not published from;
- a property whose label does not match is not used, and the report says so.

## 5. Discovery and eligibility

**Wikidata classes** (`config/classes.json`):

- Each class has `qid`, `label`, `verified` (+ `verified_by`, the search result URL that showed the item), `include`, `project_type` (keys of `site-public-cleared/archive-taxonomy.js`) and a `rule`.
- Projects are published from a class only when it is verified, included and its live label still matches.
- Every other class is queried for its counts only.
- `low_confidence` types are listed in quality.json; `require_coordinates` keeps only located instances.
- Blocklist classes (lighthouse, billboard, drone display, business, company, scholarly article, light show, Wikimedia category…) remove items whose own P31 is one of them.

**Commons categories** (`config/categories.json`):

- Search terms, root categories, and a breadth-first walk (≤ 2,500 categories, ≤ 600 per root).
- A category becomes a project candidate only when it is about one specific project or place.
- Aggregates are rejected by name pattern ("by country", "<topic> in <place>", years, featured/quality sets) and by child counts (≥ 25 subcategories with ≤ 5 files).
- The roots "Illuminated buildings by country/city" give image evidence only.
- Each decision and its reason is in `review/categories.json`.

**Wikipedia media-facade search** (`config/pipeline.json` → `wikipedia`). Wikidata has no media facade instances
(Q17158007: 0 on 2026-10-19), so real media facades are found through the articles that describe them.

- Each hit is scored (term in title +20, in the lead +45, repeated +10, only in the snippet +25, building context +10, page coordinates +10, the lead describes a company/person/product −40).
- A hit becomes an observation from `accept_score` (50).
- Its Wikidata item must be a building, structure or place with coordinates or a country, and not a person, company, product, technology, area or class (`entity_rules`).
- The article URL is kept as the source that states the media facade.

**Web candidates** (GDELT, RSS) go to `admin-data/candidates.json` only.

**Merging**, in this order:

1. the same QID;
2. a Commons category named by the item's P373;
3. the same normalised name within 300 m;
4. the same official URL (not shared portal hosts).

All sources stay attached. Curated places (`site-public-cleared/assets/seed.js`) keep their ids and merge by QID.

**Eligibility**: identity, name, country, coordinates or city, an archive type, not blocklisted, and a public source.
Curated and editor-approved records skip the source gates (unverified class only, class requires coordinates, low
Wikipedia relevance, web candidate), never the basics. Every excluded project and its reasons are in quality.json.

## 6. Images

Candidates for each project:

- the item's P18;
- files of the project category and of its "at night", illuminated and event subcategories;
- night subcategories found by the walk;
- files whose structured data depicts the item (P180, one `haswbstatement:P180=<QID>` search per project). This is
  only for projects none of whose candidates names both night and media evidence, at most 80 new searches per run
  (`images.depicts_max_per_run`), and cached two weeks, so the searches reach every project over a few runs.

Rights are checked with `edge-functions/_shared/live-media.mjs`:

- licence allowlist;
- deletion and NoFoP templates;
- the Korean freedom-of-panorama policy;
- attribution.

Maps, plans, logos, diagrams, portraits, signatures, small files, extreme aspect ratios and interiors of exterior works
are rejected.

Scores:

- `night` and `media` come from keywords in many languages and from the subcategory.
- `visual` is measured on a 320 px thumbnail with sharp:
  - mean luminance;
  - Hasler–Süsstrunk colourfulness;
  - the share of saturated bright pixels.
- A dark frame with saturated light scores. Darkness alone never qualifies.

Tiers: 1 media active at night, 2 media art content, 3 light or LED characteristics, 4 context (for example a daytime
architectural photo).

| surface | rule |
|---|---|
| home hero | tier 1, the home rule (mean luminance ≤ 0.40, saturated bright share ≥ 0.02, colourfulness ≥ 20), night and media evidence, visual ≥ 45, original ≥ 1600 px wide, **and** listed in `editorial/hero.json` or set by a `set_hero` decision |
| home featured / collections | an image that passes the home rule (tier ≤ 3); otherwise the designed placeholder (`image: null`) |
| card (`index.json` thumb) | the best tier; a tier-4 image may be a card only when nothing better exists, and never on the home page |
| detail gallery | up to 12 cleared images, media-active first, each with licence and author |

**Approving heroes.**

1. After a run, open `review/contact-sheets/hero-candidates-*.jpg` on the data branch.
2. Each tile shows `#n <project id>` and `T<tier> V<visual>`; `review/contact-sheets/index.json` maps `#n` to the file name.
3. For a tile that visibly shows the media running, add `{"project": "<id>", "image": "<File name.jpg>", "note": "…"}` to `editorial/hero.json`, or commit a `set_hero` decision.
4. The next run applies it, if the image still passes the visual gates. `report.json` → `hero_list` tells why not.

## 7. Editorial decisions

Decisions are files in `editorial/decisions/` on `source`, named `<UTC timestamp>-<action>.json` (for example
`2026-10-21T09-00-00Z-hide.json`). They are applied in file-name order. A later decision on the same target wins.
Only people with write access to the repository can commit them, so GitHub authentication is the access control. The
admin page builds the JSON and opens GitHub's new-file page
(`https://github.com/remona8787/remona8787.github.io/new/source?filename=editorial/decisions/...&value=...`).

```json
{"action": "hide", "target": "Q99000108", "note": "advertising sign, not light art", "by": "editor-name", "at": "2026-10-21T09:00:00Z"}
{"action": "unhide", "target": "SEOUL050", "note": "", "by": "editor-name", "at": "2026-10-21T09:05:00Z"}
{"action": "merge", "target": "Q18391691", "into": "Q15140473", "note": "same festival", "by": "editor-name", "at": "2026-10-21T09:10:00Z"}
{"action": "edit", "target": "Q7715933", "fields": {"name_ko": "더 베이 라이츠", "visit": {"status": "ended", "period": "2013–2023", "source": "https://thebaylights.org/"}}, "note": "", "by": "editor-name", "at": "2026-10-21T09:15:00Z"}
{"action": "approve", "target": "Q123456", "note": "class not yet verified, checked by hand", "by": "editor-name", "at": "2026-10-21T09:20:00Z"}
{"action": "approve", "target": "cand-1k2j3h4", "fields": {"name_en": "…", "country_iso2": "KR", "city": "Seoul", "project_type": "media_facade", "official_url": "https://…"}, "note": "", "by": "editor-name", "at": "2026-10-21T09:25:00Z"}
{"action": "approve", "target": "new:some-pavilion", "fields": {"name_en": "…", "country_iso2": "NL", "lat": 52.37, "lng": 4.90, "project_type": "light_art", "sources": [{"url": "https://…", "title": "…"}]}, "note": "", "by": "editor-name", "at": "2026-10-21T09:30:00Z"}
{"action": "block_image", "target": "Q7715933", "image": "Bay Bridge from Embarcadero daytime.jpg", "note": "shows the bridge, not the work", "by": "editor-name", "at": "2026-10-21T09:35:00Z"}
{"action": "set_hero", "target": "Q4167", "image": "Fete des Lumieres 2015 Cathedrale Saint-Jean projection.jpg", "note": "reviewed on the contact sheet", "by": "editor-name", "at": "2026-10-21T09:40:00Z"}
```

- Targets: a project id (curated `SEOUL001`…, a QID, `CAT-…`, `ED-…`), a candidate id (`cand-…`), `new:<slug>` for a new record, or `*` for `block_image` everywhere.
- Edit fields: `name_ko`, `name_en`, `name_original`, `name_original_lang`, `country_iso2`, `city`, `city_ko`, `lat`+`lng`, `project_type`, `official_url`, `description_ko`, `description_en`, `visit` (which needs a `source` URL).
- Unknown fields and bad values are reported and never applied.
- Every decision appears in `report.json` → `decisions` with its status: `applied`, `target_not_found`, `invalid` (with reasons) or `superseded`.

## 8. Adding classes, categories and terms

1. **Classes.**
   - Add `{qid, label, verified: false, include, project_type, rule}` to `config/classes.json`.
   - The next run writes its live label and counts to `review/classes.json` without publishing from it.
   - Confirm the QID: a web search restricted to wikidata.org whose result URL is exactly `https://www.wikidata.org/wiki/<QID>` with that label. Then set `verified: true` and `verified_by` to that URL.
   - Set `low_confidence` for broad classes and `require_coordinates` for classes with many unlocated instances.
2. **Categories.**
   - Add search terms or roots to `config/categories.json` (`mode: "candidates"` or `"evidence"`).
   - Add an aggregate pattern or a blocklist pattern when `review/categories.json` shows a wrong decision.
3. **Wikipedia terms.**
   - Add phrases per language under `wikipedia.wikis` in `config/pipeline.json`.
   - Check `review/wikipedia.json` after the next run, and tune `accept_score` or `entity_rules` if needed.
4. **Commit and run.** Commit to `source` with `[collect]` in the message, or run the workflow by hand.

## 9. Deploy and the live check

`pipeline/deploy.mjs` builds the new tree of `main`:

- It copies the build (`npm run build` with `SITE_URL=https://remona8787.github.io`).
- `site-data/` goes to `data/` and `admin-data/` to `data/admin/`.
  - An invalid or missing dataset is never deployed: the data already on main stays.
  - The same holds for the admin data.
- `.git`, `.github/`, `README.md`, `.nojekyll` and `CNAME` on main are kept. Everything else is replaced.
- `robots.txt` gets `Disallow: /data/admin/`.
- `/deploy.json` names the deploy: `{schema, deploy_id, build_id, dataset, admin, source, data, at}`. `deploy_id` is a hash of the whole tree.

`pipeline/verify-live.mjs` works in three steps:

1. It waits (up to 20 minutes) until `/deploy.json` has the deploy id and `/data/manifest.json` the build id.
2. It opens home, explore, map, a detail page (a hero or featured project), the data page and the admin page, at 390×844 and 1440×900. Each page gets a fresh context with a cold cache and service workers blocked.
3. It writes `review/live/report.json` and a JPEG per page.

The report records, per page: HTTP status, console errors, page errors, failed requests, HTTP errors, LCP, navigation
timings, transfer bytes (total and by resource type), the `data/` files fetched, broken images, and any internal
review vocabulary visible on a public screen. Its summary says whether the home page loaded `index.json` (it should
not). The job fails when the deploy never appears or a page does not load. `--strict` also fails on console errors,
failed requests or internal vocabulary.

The deploy job warns when `.github/workflows/archive.yml` on main differs from `deploy/pages-repo/` on source.
Workflow files must be copied by hand: a GITHUB_TOKEN push may not change them.

## 10. Costs

**$0.**

- The repository is public, so GitHub Actions minutes on standard runners and GitHub Pages are free.
- A run takes about 30 minutes in total; four runs a day.
- The sources are free public APIs, used within their etiquette.

Limits to keep in mind:

- a Pages site of at most 1 GB with a soft bandwidth limit of 100 GB a month;
- 6 h per job;
- GitHub may disable scheduled workflows in a public repository after 60 days without activity. Re-enable it on the Actions tab if that happens.

## 11. Verified here vs. needs the first live run

The development machine cannot reach Wikidata, Commons, Wikipedia, GDELT, RSS feeds or github.io. Everything below
was verified against **recorded fixtures**; no live result is claimed.

**Verified here:**

- **Fixtures.** `tests/fixtures/pipeline/` holds answers shaped exactly like the real services:
  - SPARQL JSON results;
  - `wbgetentities` entities;
  - Commons `categorymembers`, `pageprops`, `imageinfo`/`extmetadata` and templates, with continuation;
  - Wikipedia `list=search` and `pageprops|extracts|coordinates`;
  - GDELT `ArtList`;
  - RSS with ETags;
  - `robots.txt` and link answers;
  - an Overpass answer;
  - 320 px thumbnails generated with sharp.

  `fake-fetch.mjs` serves them with a virtual clock and records every request.
- **Tests** (`node --test tests/pipeline-*.test.mjs`):
  - entity resolution and the four merge rules;
  - eligibility, and Wikipedia hit scoring and acceptance;
  - aggregate-category rejection and the Commons walk;
  - visual metrics: a daytime building photo never becomes hero or home; darkness alone never qualifies;
  - rights rejection (licences, NoFoP, Korean FoP, deletion);
  - roles and the hero allowlist;
  - sharding, the index size at 5,000 rows, home, records, manifest and stats schemas;
  - every editorial action and status;
  - the HTTP client: User-Agent, maxlag, Retry-After, per-host spacing, budget, ETag caches;
  - a full dry run of `run.mjs` (60 projects) that equals the committed `tests/fixtures/pipeline/site-data/`;
  - idempotence of an unchanged second run;
  - last good data kept when every source fails;
  - the stale tracker and the drop guard;
  - partial output under a short budget, and a run without sharp;
  - the workflow file;
  - the CI scripts against real local git repositories (bot identity, no empty commits, orphan data branch, history compaction);
  - deploy assembly (kept files, last good dataset, idempotent deploy id, robots);
  - the live check's waiting and summary logic.
- **Workflow schema.** `archive.yml` passes the GitHub workflow schema validator `@action-validator/cli` 0.6.0 (run once from a scratch install, not a project dependency).
- **Deploy and live check, end to end on this machine.**
  - `deploy.mjs` was run on a real `npm run build` with the fixture dataset.
  - `verify-live.mjs` was run against it, served locally: 12 pages loaded and screenshotted, and LCP and transfer sizes were recorded.
  - The images failed to load because Commons is unreachable from this machine.
  - The v0.17 base UI did not yet read `/data/` and still showed internal labels. The checker reported both, which is what it is for.

**Needs the first live run** (Actions → archive → Run workflow):

- the real class counts and labels: `review/classes.json` should match the 2026-10-19 discovery, e.g. light installation 138 instances (94 located);
- the Commons category decisions on the real graph, and aggregate patterns that may need tuning (e.g. under "Category:Media art");
- the Wikipedia hit quality per language and the `accept_score`;
- visual thresholds on real photographs: review the contact sheets;
- the first hero allowlist: `editorial/hero.json` is empty until someone reviews the contact sheets, so the home page starts with featured images and no hero slides;
- whether 25 minutes covers a cold cache (the first runs may end `partial` and fill in over the next runs);
- Pages publishing time, and the live LCP and transfer sizes;
- the growth of the data branch.

## 12. Additions to the contract

These additions to `docs/STATIC_ARCHIVE.md` change nothing in the dataset schema:

- `/deploy.json` at the site root (written by the deploy job). verify-live waits for it as well as for the manifest's `build_id`, because a source-only deploy keeps the same `build_id`.
- `robots.txt` on main also disallows `/data/admin/`.
- The deploy job keeps `CNAME` as well as `.github`, `README.md` and `.nojekyll`.
- `data` and `main` histories are compacted to one snapshot commit after 120 commits.
