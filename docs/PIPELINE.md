# Archive pipeline: operations (v0.18)

This document covers the pipeline that grows the archive from the 49 curated places to hundreds or thousands of
real, source-verified projects, **Korean projects first**, with licensed, high-resolution photos from Wikimedia
Commons and other providers. It runs as a GitHub Actions workflow in `remona8787/remona8787.github.io` and publishes a
static, sharded dataset on GitHub Pages.

- The contract (repository layout, eligibility, image rules, output files, consumer rules) is `docs/STATIC_ARCHIVE.md`.
- This document says how to operate it.
- The Supabase path (`docs/ARCHIVE_SPEC.md`) is optional and independent.

```
sources, Korean first ─ South Korea's first-level divisions (live) · Korean class items (P17 = Q884) · Commons Korean
          searches and roots · Korean Wikipedia (wide term list) · TourAPI KorService2 (keyed)
        then worldwide ─ Wikidata classes · Commons categories · Wikipedia media-facade search · web candidates (GDELT, RSS)
   → classify/type → resolve entities → dedupe/merge → enrich (Wikidata facts, Korean items first) → editorial
   → kr_region → eligibility
   → images, Korean projects first (Commons + Openverse, Flickr, TourAPI, photo gallery, Unsplash, Pexels; rights,
     identity, keyword evidence, visual score, quality on ~1024 px, tiers 1–6, roles) → contact sheets per provider
   → link checks → Overpass (optional)
   → shard → site-data/ (published) · admin-data/ review/ state/ (data branch only)   (pipeline/run.mjs, Node 22, ~25 min)
   → deploy: build source + data → main → GitHub Pages     (pipeline/deploy.mjs; admin data never published)
   → verify-live: screenshots and measurements → review/live/ (pipeline/verify-live.mjs)
```

| file | role |
|---|---|
| `pipeline/run.mjs` | one collect run (all stages); `--fixtures` runs it over the recorded test answers |
| `pipeline/config/classes.json` | Wikidata classes (QID, verified, include, `project_type`, rule), blocklist classes, properties |
| `pipeline/config/categories.json` | Commons search terms, root categories, aggregate-name patterns, blocklist, night/event subcategory patterns |
| `pipeline/config/pipeline.json` | budget and stage shares, source switches, cache TTLs, Wikipedia terms per language (and Korean term rules), TourAPI, the Korea-first reserve, entity rules, image thresholds and provider caps, link-check and output settings |
| `pipeline/config/korea.json` | the eight Korean regions (ISO 3166-2 codes, first-level division names and the QIDs expected from web searches), the gazetteer of city and district names in Korean and English, ambiguous names, TourAPI area and legal-dong codes |
| `pipeline/lib/*.mjs` | the stages (net, cache, wikidata, korea, tourapi, commons, wikipedia, web, entities, images, image-stage, providers, identity, quality, visual, contact-sheet, editorial, links, overpass, output, schema, state) |
| `pipeline/deploy.mjs` | job `deploy`: assembles main from the build and the data branch |
| `pipeline/verify-live.mjs` | job `verify-live`: waits for the deploy, checks the live site with Playwright |
| `pipeline/ci/use-branch.sh`, `pipeline/ci/commit-push.sh` | branch switching and commits (github-actions[bot], bounded history) |
| `deploy/pages-repo/` | canonical copies of the files on `main`: `.github/workflows/archive.yml`, `README.md`, `.nojekyll` |
| `.github/workflows/archive.yml` (source branch root) | the same workflow, so a push to `source` starts it; a test keeps both copies identical |

## 1. Running it

| how | what runs |
|---|---|
| Schedule: `17 */6 * * *` (UTC: 00:17, 06:17, 12:17, 18:17; KST 09:17, 15:17, 21:17, 03:17) | collect → deploy → verify-live |
| Actions → **archive** → Run workflow | the same. Turn off "collect" to only build, deploy and verify; "budget_minutes" sets the collect budget. |
| Push to `source` | deploy → verify-live. Collect runs too when the head commit message contains `[collect]`. |

All jobs share the concurrency group `archive` (`cancel-in-progress: false`): one run at a time, never two pushers,
and a running run is never cancelled; a run that arrives while another is going waits for it. The deploy job also has
its own group `archive-deploy`, so no deploy is ever cancelled or runs next to another.

The workflow lives in three places with the same content: `deploy/pages-repo/.github/workflows/archive.yml` (the
canonical copy), `.github/workflows/archive.yml` at the root of `source` (GitHub reads a push's workflow from the
pushed commit, so this copy is what starts a run on a push to `source`), and `.github/workflows/archive.yml` on `main`
(schedules and manual runs use the default branch). `tests/pipeline-workflow.test.mjs` fails when the two copies of
the source tree differ; the deploy job warns when main's copy differs (a GITHUB_TOKEN push may not change workflow
files: copy it by hand).

Every collect run writes a step summary on the run page (`$GITHUB_STEP_SUMMARY`): projects collected, eligible and
published, Korean and foreign (and Korean with a region), changes, images by provider, hero images on the home page,
images below their role's width target, review queues, and the failing sources.

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
| `site-data/manifest.json` | `/data/manifest.json` | `schema`, `build_id`, `generated_at`, `counts` (projects, with_images, with_hero, by_type, by_region, by_country, by_kr_region, korea, world), `files` (index, home, stats, shards), `sources` (`{status, last_success, items}` per source, tourapi included), `credits` |
| `site-data/index.json` | `/data/index.json` | `{schema, fields, rows}`; fields: id, name_ko, name_en, name_original, country_iso2, city, lat, lng, project_type, year, thumb, visual_rank (the card's tier 1–5), shard, added_at, then (v0.18) kr_region, thumb_w, thumb_h. Readers find columns by name. Loaded lazily by explore and map, never by the home first paint. Under 1 MB for 5,000 rows. |
| `site-data/home.json` | `/data/home.json` | everything the home page needs, Korean first: `hero` (≤ 6 reviewed slides, tier 1–2, at least 70 % Korean when a Korean hero exists), `kr_regions` (the eight regions: key, count, a representative image and the top projects), `kr_featured` (≤ 12 Korean projects), `kr_programs` (Korean exhibitions, festivals and media art, running ones first), `world` (`{highlights, count, countries}`), `counts` (projects, countries, with_images, korea, korea_with_images, world, world_countries, by_kr_region), and for the v0.17 app `featured` (≤ 12, Korean first), `regions`, `types`, `themes`, `recent`, and `projects` (compact records of every id named, with `kr_region` and the home image) |
| `site-data/projects/<shard>.json` | `/data/projects/<shard>.json` | full records, about 200 per shard; the shard count is a power of two, so an id changes shard only when the archive doubles |
| `site-data/stats.json` | `/data/stats.json` | counts behind the research page (by type, region, country, decade, year, origin, source kind, credit role; top cities) |
| `admin-data/report.json` | not published (data branch only) | the run: status, publish decision, stages, sources (status, items, errors, consecutive failures, last success), HTTP counters per host, reachability, cache sizes, counts (new, changed, merged, removed, carried over, stale, excluded), image statistics, changes, applied decisions, hero list status, review queue, errors |
| `admin-data/quality.json` | not published | missing images, no home image, broken links, robots-disallowed links, suspected duplicates, stale projects (not seen in 3 runs), low-confidence types, excluded projects with reasons, coordinate mismatches (Overpass), image rejection counts |
| `admin-data/candidates.json` | not published | web-derived candidates (GDELT, RSS; NAVER/Brave when keyed) with their hits, classification and confidence; `image_candidates` (NAVER image results, and provider images that wait for an `approve_image`); `tourapi` (accepted TourAPI items that are not public yet, with the reason); never public until approved |
| `review/classes.json`, `properties.json` | not published | the live label, description and instance counts of every configured class and property, and whether each is published from |
| `review/categories.json` | not published | every Commons category decision with its reason |
| `review/wikipedia.json` | not published | every Wikipedia hit (language, term, score, reasons) and the entity decision of each accepted hit |
| `review/korea.json` | not published | the live first-level divisions of South Korea and their regions, the expected QIDs against them, Korean class instance counts, and the kr_region decision (rule, matches or conflict) of every Korean project |
| `review/tourapi.json` | not published | every TourAPI item seen: the terms found in its title or overview, the classifier's verdict and the decision |
| `review/images.json` | not published | per project: every image candidate (every provider) with rights, identity, keyword evidence, visual and quality measurements, width, tier, approval, the hero and featured decisions and the near-duplicates removed |
| `review/providers.json` | not published | provider requests of the run: TourAPI name matches, caps reached, errors, rejections, Openverse rate-limit headers |
| `review/contact-sheets/*.jpg`, `index.json` | not published | one set of sheets per kind and provider (`hero-<provider>-NN.jpg`, `featured-<provider>-NN.jpg`, `cards-NN.jpg`), Korean projects first; each tile: `#n` and the image id, provider and the original's width × height, `S` sharpness `B` blockiness `T` tier `V` visual and `OK` / `R?` (needs approve_image) / `H?` (hero candidate), the project id, the project name in ASCII (Korean romanized) |
| `review/web.json`, `http-log.json` | not published | web rule results; HTTP retries, maxlag waits and errors |
| `review/live/` | not published | `report.json` and `<mobile|desktop>-<page>.jpg` of the last live check |
| `state/` | not published | `runs.json` (counter, last good build), `tracker.json` (per-project first/last seen, missing runs), `failures.json`, `web-rules.json`, `candidates.json`, `image-picks.json`, `cache/*.json` (responses with TTLs and ETags; `quality`, `visual`, `tourapi`, `openverse`, `flickr`… per provider) |

Record fields (`projects/<shard>.json`) follow `docs/ARCHIVE_SPEC.md` §6:

- identity and names: `id`, `curated_place_id`, `wikidata`, `name_ko`, `name_en`, `name_original`, `name_original_lang`, `aliases`;
- place: `country_iso2`, `region`, `kr_region` (Korean projects; null when unknown and for every other country), `city`, `city_ko`, `district`, `address`, `lat`, `lng`, `location_precision`;
- the work: `project_type`, `year_installed`, `year_completed`, `year_operating_since`, `year_ended`, `operating_status`, `building_name`, `installation_method`, `envelope_type`, `technologies`, `content_types`, `spatial_context`, `summary_ko`, `summary_en`, `credits[]` (`{role, name, name_en, wikidata_qid}`), `official_url`, `commons_category`;
- media and sources:
  - `images[]`: the v0.18 image object (§6), at most 12;
  - `videos[]`;
  - `sources[]`: `{id, kind, title, url, publisher}`;
  - `field_sources`: which source gave each field;
  - `visit`: `{status, note, period, source}`, only when a source states it;
- bookkeeping: `record_origin`, `added_at`, `shard`.

A fact without a source is `null`. Nothing about review state or runs is in a public record; the image measurements
and the approval are part of the image object, as the v0.18 contract asks.

Reader rule for `index.json`: above 512 KB the index stores Commons thumbnails as `"<h>/<hh>/<File.jpg>"` and names
the pattern once in `thumb_template`. A `thumb` that is not an https URL becomes
`thumb_template.replace('{path}', thumb).replace('{file}', last path segment)`. Below the threshold every thumb is a
full URL.

## 3. What a run guarantees

- **Polite.** Every request carries `User-Agent: LightArchitectureArchive/0.18 (+https://remona8787.github.io/; remona56@hanmail.net)`.
  - Every MediaWiki API call has `maxlag=5` and waits and retries on a maxlag answer.
  - 429 and 5xx answers are retried with backoff, honouring `Retry-After`.
  - Per-host spacing is strict (table in §4).
  - Answers are cached with TTLs and ETags, so a run asks only for what is new or expired.
- **Bounded, Korea first.** A 25-minute budget is split into stage shares (sources 38 %, enrichment 14 %, images 40 %, links 6 %).
  - Korean sources start first on every shared host (the per-host queues keep call order) and run until the stage
    deadline; the foreign sources use a view of the client that stops 20 % of the sources stage earlier
    (`korea.foreign_reserve_share`), so the budget never cuts a Korean source before a foreign one.
  - Enrichment reads the Korean items first; the images and links stages handle Korean projects first.
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
| `upload.wikimedia.org`, `thumb.wikimedia.org` | 330 px thumbnails for visual scoring, ~1024 px (960 px step) renditions for quality, contact-sheet tiles | 5 requests/s per host, ≤ 1,800 visual and ≤ 600 quality downloads per run, standard thumbnail widths only (120, 250, 330, 500, 960, 1280, 1920, 3840: the CDN refuses other widths since the 2025/2026 standardisation), measurements cached a year by file and sha1 | as above; files are measured, never re-hosted. Wikimedia now names `thumb.wikimedia.org` for thumbnails and adds `utm_*` parameters to API thumbnail URLs (`$wgTrackMediaRequestProvenance`): the pipeline strips them from every stored URL |
| Wikipedia APIs (14 wikis: en de ko ja zh fr es it nl pl ru pt tr ar) | `list=search` phrase queries, `pageprops` (wikibase_item), lead extracts, coordinates | 1 request/s per wiki (the wikis in parallel), `maxlag=5`; search 72 h, pages 7 days | CC BY-SA 4.0: only the article URL is published, as a source; snippets stay in `review/` |
| GDELT DOC 2.0 | news candidates | 1 request per 5 s | free; candidates only |
| RSS/Atom feeds (seed rules of `edge-functions/_shared/archive/seed-rules.mjs`) | news candidates | conditional GET (ETag / Last-Modified), 1 request/s per host, per-rule backoff | each publisher's terms; titles and links only, candidates only |
| NAVER, Brave search | web candidates, only with keys | as in the collector | API terms; candidates only |
| Wikidata Query Service, Korea first | South Korea's first-level divisions (`wd:Q884 p:P150`, ISO 3166-2 `P300`, end dates), the items of every usable class located in Korea (`wdt:P17 wd:Q884`) | before every worldwide query; divisions cached 7 days, class items 24 h | CC0 |
| Korean Wikipedia | the wide Korean term list (`wikipedia.wikis.ko`: 미디어파사드, 미디어아트, 프로젝션 매핑, 빛축제, 라이트쇼, 루미나리에, 야간경관, 경관조명, 미디어월, 미디어 캔버스, 몰입형 전시…) with `term_rules` (type per term, higher scores for broad terms) | 1 request/s, on the Korean deadline | CC BY-SA 4.0, article URLs only |
| Seoul cultural events `http://openapi.seoul.go.kr:8088/{key}/json/culturalEventInfo/{start}/{end}/` (`SEOUL_OPEN_DATA_KEY`) | every current event in pages of 1,000 rows (≤ 6,000); relevant ones (media art, media facade, projection, mapping, light, LED, digital, immersive in the title, programme or place, and the classifier agrees) linked to a project by name within 300 m, else a place candidate | 1 request/s; cached 20 h (daily refresh); the key is in the URL path, so no redirect is ever followed and logs show `***` | 공공누리 제1유형 (attribution; commercial use and changes allowed); events carry the dataset, licence and page |
| TourAPI 4.x KorService2 `apis.data.go.kr/B551011/KorService2` (`TOURAPI_SERVICE_KEY`) | `searchKeyword2` for the Korean terms by content type (12, 14, 15), `detailCommon2` (overview, homepage), `detailImage2` (images with `cpyrhtDivCd`), `searchKeyword2` by a project's Korean name (image identity) | 2 requests/s; ≤ 120 new overviews and ≤ 300 image requests per run; searches 72 h, details and images 14 days | 한국관광공사 data on data.go.kr; images only with `cpyrhtDivCd` Type1 (공공누리 제1유형: attribution) or Type3 (제3유형: attribution, no changes; `no_derivatives: true`, never cropped) |
| Photo gallery `PhotoGalleryService1` (same key) | `gallerySearchList1` by a project's Korean name: `galTitle`, `galWebImageUrl`, `galPhotographer`, `galPhotographyLocation`, `galSearchKeyword` | ≤ 150 per run, 14 days | PhotoKorea photos are 공공누리 제1유형 per the data.go.kr service page, but no per-photo copyright field is documented: without one in the answer a photo is a review candidate only (`kto_photo.default_license_when_missing` stays null until the first live answers are read) |
| Openverse API `api.openverse.org/v1/images/` (no key; optional `OPENVERSE_CLIENT_ID`/`OPENVERSE_CLIENT_SECRET`) | `q` = the project's core names, `license=cc0,pdm,by,by-sa`, `page_size=20`; creator, licence and version, licence URL, `foreign_landing_url`, `url`, width, height | 1 request per 4 s, ≤ 120 new searches per run, 14 days; the `X-RateLimit-Available-*` headers are read (0 stops the run's searches) and a 429 pauses the host for its `Retry-After` | each work's licence; Wikimedia results are skipped (read from Commons) |
| Flickr API `api.flickr.com/services/rest/` (`FLICKR_API_KEY`) | `flickr.photos.licenses.getInfo` (licence ids from the live answer: only CC0, PDM, BY, BY-SA) and `flickr.photos.search` with text, a ±1 km bounding box, the licences, `url_z…url_o` sizes, geotags, tags | 1 request/s, ≤ 300 per run, 14 days | Flickr API terms: shown from Flickr (`usage: hotlink`) with a link to the photo page; each photo's licence |
| Unsplash API (`UNSPLASH_ACCESS_KEY`) | `search/photos` by English name and city | 1 request per 75 s (50/h demo limit), ≤ 10 per run | hotlink only, photographer and Unsplash named, referral parameters on links back (Unsplash API guidelines) |
| Pexels API (`PEXELS_API_KEY`) | `v1/search` by English name and city | 1 request per 20 s, ≤ 30 per run | hotlink only, photographer and Pexels named |
| NAVER image search (`NAVER_API_KEY_ID`, `NAVER_API_KEY`, API HUB `/search/v1/image`, or legacy keys with `NAVER_API_MODE=legacy` until 2027-06-30) | discovery of Korean project photos | ≤ 100 per run, 14 days | never displayed: results go to `admin-data/candidates.json` → `image_candidates` for an editor, who finds the original, its licence or a permission and adds a `set_image` decision |
| Overpass API `overpass-api.de` | optional coordinate confirmation (`wikidata=` tags) | 1 request per 10 s, one query of ≤ 50 items per run, cached 30 days; skipped when unreachable | OSM data is not copied into the dataset (ODbL); it only flags mismatches over 1 km |
| Official and source links | link checks | HEAD, then a 1-byte GET; `robots.txt` honoured before HTML pages; 1 request/s per host; ≤ 400 per run, cached 7 days; Wikimedia hosts skipped | — |

Image hosts (`tong.visitkorea.or.kr`, `live.staticflickr.com`, `images.unsplash.com`, `images.pexels.com`, official
sites) are read only for measurements and contact-sheet tiles (5 requests/s per host); nothing is re-hosted.

### Keys (GitHub repository secrets)

Settings → Secrets and variables → Actions → New repository secret. The workflow passes exactly these to the collect
step's environment (`tests/pipeline-workflow.test.mjs` checks the list); without a key the source is skipped and the
report says why. Keys never appear in a log, a report, a cache key or an error message (`redactKeys`).

| secret | enables |
|---|---|
| `SEOUL_OPEN_DATA_KEY` | Seoul cultural events (서울 열린데이터광장 OA-15486, `culturalEventInfo`; the same name as the Supabase function's). Without it one probe with the portal's sample key records reachability and the field names (never published) |
| `TOURAPI_SERVICE_KEY` | TourAPI KorService2 discovery and images, and the photo gallery (either the "encoding" or the "decoding" key of data.go.kr; each service needs its own 활용신청 on data.go.kr: 한국관광공사_국문 관광정보 서비스_GW and 한국관광공사_관광사진 정보_GW) |
| `FLICKR_API_KEY` | Flickr photo search |
| `OPENVERSE_CLIENT_ID`, `OPENVERSE_CLIENT_SECRET` | an Openverse OAuth token (higher rate limit; Openverse also works without them) |
| `UNSPLASH_ACCESS_KEY` | Unsplash search |
| `PEXELS_API_KEY` | Pexels search |
| `NAVER_API_KEY_ID`, `NAVER_API_KEY` | NAVER news/blog web candidates and NAVER image discovery |
| `BRAVE_API_KEY` | Brave web candidates |

Every Wikidata class and property id is confirmed by a live query in each run:

- the labels go to `review/classes.json` and `review/properties.json`;
- a class whose live label no longer matches is not published from;
- a property whose label does not match is not used, and the report says so.

## 5. Discovery and eligibility

**Korea first.**

- Before anything else the Wikidata task reads the live labels of the classes, properties and the country item
  (`Q884` "South Korea"), then South Korea's first-level divisions (`p:P150`, with ISO 3166-2 codes `P300` and end
  dates), then the items of every usable class located in Korea (`wdt:P17 wd:Q884`). Items of classes that are not
  published worldwide are published from Korea when the class has `korea_include` (musical fountain, video
  installation). Only then the worldwide counts and instances run (on the foreign deadline).
- Commons: `korea_search` (Korean terms, and English terms that must be in the name together with "South Korea",
  "Seoul" or "Busan") and `korea_roots` run first. Their categories carry a Korean place hint; Korean lantern festivals
  are not caught by the worldwide lantern blocklist (`korea_allow_patterns`).
- Korean Wikipedia searches the wide Korean term list; broad terms need a higher score (`term_rules.min_score`) and
  give their own type (media art → media_architecture, light festival → festival_program, landscape lighting →
  light_art…). Entity rules are the same for every term.
- TourAPI (keyed): an item is a candidate only when a term is in its title or its overview and the collector's keyword
  classifier agrees (a facade project or an event programme; for media art and light art terms also "only art terms"
  without commercial signals); its homepage is its public source. Without one it stays out (listed in
  `admin-data/candidates.json` → `tourapi`, approvable). A TourAPI place merges with the project named after it within
  300 m ("롯데월드타워" into "롯데월드타워 미디어파사드"), which then gets its TourAPI images. Every decision is in
  `review/tourapi.json`.

**kr_region** (`lib/korea.mjs`, `config/korea.json`; null when unknown, never guessed), the first rule that gives one
region:

1. an editorial `edit` of `kr_region`;
2. curated Seoul places (`SEOUL001…`): `seoul`;
3. the P131 chain of the item, up to a first-level division that this run's live query confirmed (ISO code, else its
   label through the gazetteer's division names: the Jeonnam-Gwangju city of 2026 has no ISO code yet);
4. the labels of the same chain through the gazetteer;
5. TourAPI `lDongRegnCd`, then `areacode` (kept apart: code 31 is Ulsan as one and Gyeonggi as the other), unless the
   address names another region;
6. the gazetteer over the address, then district and city, in Korean and English; ambiguous names (Jung-gu and the
   other district names several cities share, Gwangju, Goseong) never decide alone; two regions give nothing.

`review/korea.json` lists every decision with its rule. The configured `expected_qid`s (from web searches, with
`verified_by`) are compared with the live answer and never used on their own.

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
4. the same official URL (not shared portal hosts);
5. a TourAPI place whose name is contained in a project's name (or the reverse) within 300 m.

All sources stay attached. Curated places (`site-public-cleared/assets/seed.js`) keep their ids and merge by QID.

**Eligibility**: identity (a QID, a Commons category, a curated or editorial id, or a TourAPI content id: `KTO-<id>`),
name, country, coordinates or city, an archive type, not blocklisted, and a public source.
Curated and editor-approved records skip the source gates (unverified class only, class requires coordinates, low
Wikipedia relevance, web candidate), never the basics. Every excluded project and its reasons are in quality.json.

## 6. Images

Korean projects first; every image belongs to one project and is proven to show it.

**Candidates.**

- Commons: the item's P18; files of the project category and of its "at night", illuminated and event
  subcategories; night subcategories found by the walk; files whose structured data depicts the item (P180, one
  `haswbstatement:P180=<QID>` search per project lacking named night and media evidence, ≤ 80 new searches per run,
  cached two weeks).
- Providers (`lib/providers.mjs`, §4), asked for Korean projects and for projects with fewer than 3 Commons files of at
  least 1600 px, each capped per run: TourAPI images (the project's own TourAPI content id, or an item found by its
  Korean name within 300 m), the photo gallery, Openverse, Flickr, Unsplash, Pexels. NAVER results are review
  candidates only.
- Editorial: `set_image` (official or editor images with a licence or a permission note).

**Rights.** Commons files through `edge-functions/_shared/live-media.mjs` (licence allowlist, deletion and NoFoP
templates, the Korean freedom-of-panorama policy, attribution). Other providers: the licence the API states (CC0,
Public Domain Mark, CC BY, CC BY-SA; KOGL Type 1/3 from `cpyrhtDivCd`; the Unsplash and Pexels licences, hotlink only;
a permission note of an editor). Never assumed: a missing licence keeps an image out.

**Identity** (every provider but Commons, `lib/identity.mjs`), recorded on the image as `identity`:

1. `provider_id`: the TourAPI content id belongs to the project;
2. `geotag_name`: geotag within 300 m and the project's name in the title, tags or description;
3. `name_location`: the exact name in the title or tags, and the city, district or region named (or a geotag within
   5 km);
4. `editorial`: set or approved by an editor.

Otherwise the image is refused (`identity_unproven`, in `review/images.json`).

**Relevance.** Maps, plans, logos, diagrams, portraits, signatures, small files, extreme aspect ratios and interiors of
exterior works are rejected, and so are files whose title or description names another subject than the project and
its building: people and political events (summit, G-20, ministers, press conferences…), animals and objects
(teddy bears, a lion, food, a neon sign, posters…), ceremonies and reenactments (a royal-wedding reenactment, an
opening ceremony), unless the word is part of the project's own name (or, for animals and objects, the file is in the
light work's own category: a tiger lantern at a lantern festival). The four mislinked images of the first October
live review are regression fixtures.

**People.** A photo of people is not a photo of the work. Strong signs always count: a portrait word (portrait,
headshot, selfie, posing, 인물사진, 기념사진…), a people or portrait category ("People of …", "Portraits of …", "Visitors
at …"), or structured data that says the file depicts a human (the file's MediaInfo P180 names an item with P31 Q5;
fetched 50 files per request and cached). Weak words (visitors, a couple, a family, 관람객…) count when the file
names neither night nor media; otherwise the people are only in the frame of the work (`people_in_frame`). Providers'
tags count too. A photo naming one of the project's creators (P170, P50, P84 or P112) as its subject ("Leo Villareal
at The Bay Lights opening", not "The Bay Lights by Leo Villareal") is that artist's portrait: it goes to the credit
(`credits[].portrait`, kind `artist_portrait`), never to `images[]`. Politicians, officials and events stay rejected
(people_or_event).

**Image kinds.** Every published image has a `kind` next to its role and tier: `project_media` (tiers 1–3: the work
running), `project_installation` (tier 4), `architecture_context` (tier 5 and institution files),
`technical_documentation` (construction, LED modules, mock-ups, renderings), `event_documentation` (openings,
ceremonies, audiences; a festival's own photos stay media), `artist_portrait` (credits only) and `unverified` (never
published). Only `project_media` can be hero or featured; documentation and portraits are never the card. Each image
stores its source `title` (Commons file name, provider title) and a `description` snippet (≤ 240 characters) for
audits, and `commercial_use` (KOGL types 1 and 3 and CC0/PD/BY/BY-SA: true; NC: false) with `kogl_type` on KOGL
images. Records and images of earlier runs get a kind from their tier and a title from their page.

**Image audit** (`review/image-audit.json`, `report.image_audit` and a section of the step summary): images published
and portraits; relevance verified this run vs. kept after the file-name recheck; images of the previous dataset that
are gone, each with this run's reason (person, mislinked, duplicate, low resolution, rights, identity, not selected,
project removed, not rechecked) and examples; candidates rejected this run by reason group; newly added images; the
share of projects with a valid card (card, featured or hero of a card kind) overall, Korean, world, per Korean
region, and per project. Every number is counted from the records, the previous dataset and the run's decisions.

**Institution files.** A curated place's Wikidata item is often the institution, building, tower or district rather
than the work (the National Museum of Korea for its Immersive Digital Gallery, N Seoul Tower for its lighting), and a
host building always is. Files from such an item's Commons category (and its night and event subcategories) and its
P180 depicts search are *institution files*: they show the institution, its other rooms and the events held there.
An institution file is at most `context` (tier 5; never card, hero, featured or gallery) unless its title or
description

- names the project (its own names; a place whose item is the place itself also by the item's names, so "Leeum,
  Samsung Museum of Art.jpg" is Leeum's; a work in a host building never by the building's name), or
- names media (media facade, LED, projection, light show, installation…), or
- is a night photo of a work shown on the outside of its structure after dark (media facade, media wall, urban
  screen, projection mapping, or the lighting of the item itself such as a tower's).

Their event subcategories are not the work's editions (no event evidence). The item's own P18 (its representative
photo) is not an institution file. A light-work class instance, a light-work category and a Wikipedia article are
about the work itself, so only curated places and host buildings have institution files; a media facade, media wall or
urban screen is its building's surface, so its building item is not an institution. An `approve_image` lifts the rule
for one file. Images kept from an earlier run (budget) are rechecked by file name: a file naming another subject is
dropped, an institution file is demoted to context. The second October live review's exact files (SEOUL022: the G20
summit and KOCIS royal-wedding photos and the museum's night views; SEOUL043: Goong Teddy Bears, Connect Terrace Seoul
Station, Haebangchon, 서울역 앞 대우빌딩 전경, Seoul Aerial Shot, the cable car) are regression fixtures. Offline replay
of the 2026-10-25 data branch: 139 of 274 projects keep a card (140 before), the only one lost is SEOUL022, whose
previous card was the G20 summit photo; `institution_context` counts the demoted files.

**Measurements.**

- `night` and `media`: keywords in many languages, the night/event subcategory, the work's own category.
- `visual` (0–100) on a 320 px rendition: mean luminance, Hasler–Süsstrunk colourfulness, the share of saturated bright
  pixels. A dark frame with saturated light scores; darkness alone never qualifies.
- `quality` on one ~1024 px rendition (Commons: the 960 px standard step; others: their ~1024 px size or the original)
  of the 3 strongest Commons candidates and of every provider candidate: `sharpness` (variance of the 4-neighbour
  Laplacian at 1024 px, log-normalised to 0–100), `blockiness` (8×8 block-edge luma energy on the file as decoded,
  0–100), a perceptual hash (dHash). The decoded file's width and height verify (or, for TourAPI and the gallery,
  give) the original's size. Cached a year.
- Near-duplicates (dHash distance ≤ 8): the reviewed copy stays, else the larger and sharper one.

**Tiers** (the brief's priority list): 1 a media facade (or media wall, urban screen, projection mapping) running,
original ≥ 1600 px; 2 architectural media art at night; 3 LED or projection technology and content visible; 4 an
exhibition or public-art installation scene; 5 an architectural photo of the same project; 6 none (the designed
placeholder). A colourful dark frame alone never makes tiers 1–3: the file must name night or media, or come from a
night, event or light-work category, or be set by an editor.

| role | rule (widths are the original's) |
|---|---|
| `hero` (home) | tier 1–2, the home rule (mean luminance ≤ 0.40, saturated bright share ≥ 0.02, colourfulness ≥ 20), night and media evidence, visual ≥ 45, sharpness ≥ 35, blockiness ≤ 20, ≥ 2400 px (1920 only when the project has no larger tier-1/2 image; then `below_target: true`), **and** reviewed: `editorial/hero.json`, `set_hero` or `approve_image` |
| `featured` | tier ≤ 3, the home rule, ≥ 1600 px, sharpness ≥ 25, blockiness ≤ 30; an image from a provider other than Commons only after an `approve_image` (contact sheet review) |
| `card` (`index.json` thumb) | the best image of at least 1200 px; a smaller one only when nothing larger exists (`below_target: true`) |
| `gallery` / `context` | up to 12 images in all, media-active first; tier 5 is `context` |

An image is never shown wider than its original: `display` lists only sizes the provider serves up to the original
(Commons: the standard widths below it, and the original itself when it is at most 8 MB). Home images carry `display`
sizes up to 1920 px and, when the original allows it, 3840 px or the original (2560 and more).

**The image object** (`projects/<shard>.json` → `images[]`, `home.json`):
`{id (img-<12 hex>: hash of provider and source id), project, provider, src (original or full size), page, display:
[[width, url]…], thumb (≈500 px, for the v0.17 app), author, rights_holder, license, license_url, attribution, usage
(hotlink | cache), no_derivatives? (KOGL Type 3), permission_note?, width, height, bytes, format, quality: {sharpness,
blockiness, score}, media_active: {score, reasons}, tier, role, identity? (non-Commons), below_target?, checked_at,
approved (true | false | null)}`. No stored URL carries `utm_*` parameters.

**What made the live hero load a 500 px thumbnail (v0.17).** Wikimedia began returning API thumbnail URLs on
`thumb.wikimedia.org` with `?utm_source=…&utm_campaign=imageinfo&utm_content=thumbnail`. The pipeline stored them as
they came. The app builds its Commons srcset with a pattern that must end at the file name (`core.js` `COMMONS`), so a
URL with a query string never matched, no srcset was built, and the `<img>` fell back to `thumb` (500 px). The pipeline
now strips the parameters from every stored URL, stores the original as `src` and the sizes as `display`; previous
records are upgraded the same way (`output.mjs upgradeImage`). The live check records the rendition width of the home
page's largest image (`summary.home_lcp_image_px`).

**Gray contact sheets (v0.17).** A tile only had a picture when its thumbnail was downloaded in that run; with the
measurement cached (every run after the first) the tile stayed gray. The sheets now fetch the small rendition of every
tile that has none (≤ 300 per run, standard widths, no utm), so every run's sheets show real pictures. Each written
sheet is read back: `review/contact-sheets/index.json` gives per sheet `grey_tiles` (tiles whose pixels are the flat
grey of a missing picture) and per tile `image_in_sheet` (the picture decoded and was composited). Tests composite the
fixture photos and check the tiles' pixels on a first and a cached run.

**Approving heroes and provider images.**

1. After a run, open `review/contact-sheets/hero-<provider>-NN.jpg` and `featured-<provider>-NN.jpg` on the data
   branch (Korean projects first). Tiles name the image id, provider, original size, sharpness, blockiness, tier,
   visual score and the project; `index.json` maps every tile to its project, image id, file or URL.
2. For a tile that visibly shows the media running on this project, add
   `{"project": "<id>", "image": "<File name.jpg or img-…>", "note": "…"}` to `editorial/hero.json`, or commit a
   `set_hero` decision; for a provider image that should be featured (`R?`), an `approve_image` decision.
3. The next run applies it if the image still passes the gates; `report.json` → `hero_list` tells why not.

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
{"action": "approve_image", "target": "SEOUL018", "image": "img-a79cc18cdae6", "note": "the Openverse photo shows this facade (contact sheet)", "by": "editor-name", "at": "2026-10-21T09:45:00Z"}
{"action": "block_image", "target": "SEOUL018", "image": "img-bbcdb0f8ce01", "note": "a daytime view", "by": "editor-name", "at": "2026-10-21T09:47:00Z"}
{"action": "set_image", "target": "SEOUL001", "src": "https://operator.example/media/night.jpg", "page": "https://operator.example/media", "author": "Operator", "permission_note": "display with credit allowed (e-mail of 2026-10-10)", "note": "", "by": "editor-name", "at": "2026-10-21T09:50:00Z"}
{"action": "edit", "target": "KTO-2900004", "fields": {"official_url": "https://festival.example/", "kr_region": "jeju"}, "note": "", "by": "editor-name", "at": "2026-10-21T09:55:00Z"}
```

- `approve_image`: the image (its `img-…` id, or a Commons file name) was reviewed on the contact sheets: it may be
  featured, and hero when its tier is 1 or 2. `set_hero` approves too. `block_image` takes an image id as well.
- `set_image`: `src` and `page` (https), `author`, and `license` (with `license_url`) or `permission_note`; optional
  `provider` (`official`, the default, or `editor`), `no_derivatives: true`, `width`/`height`. An official image only
  enters this way; it is measured like any other and approved.

- Targets: a project id (curated `SEOUL001`…, a QID, `CAT-…`, `ED-…`, `KTO-<TourAPI content id>`), a candidate id (`cand-…`), `new:<slug>` for a new record, or `*` for `block_image` everywhere.
- Edit fields: `name_ko`, `name_en`, `name_original`, `name_original_lang`, `country_iso2`, `city`, `city_ko`, `lat`+`lng`, `project_type`, `kr_region`, `official_url`, `description_ko`, `description_en`, `visit` (which needs a `source` URL).
- Unknown fields and bad values are reported and never applied.
- Every decision appears in `report.json` → `decisions` with its status: `applied`, `target_not_found`, `invalid` (with reasons) or `superseded`.

## 8. Adding classes, categories and terms

1. **Classes.**
   - Add `{qid, label, verified: false, include, project_type, rule}` to `config/classes.json`.
   - The next run writes its live label and counts to `review/classes.json` without publishing from it.
   - Confirm the QID: a web search restricted to wikidata.org whose result URL is exactly `https://www.wikidata.org/wiki/<QID>` with that label. Then set `verified: true` and `verified_by` to that URL.
   - Set `low_confidence` for broad classes and `require_coordinates` for classes with many unlocated instances.
   - `korea_include: true` publishes a class's items located in South Korea even when the class is not included
     worldwide (`include: false`).
2. **Categories.**
   - Add search terms or roots to `config/categories.json` (`mode: "candidates"` or `"evidence"`).
   - Add an aggregate pattern or a blocklist pattern when `review/categories.json` shows a wrong decision.
3. **Korea.** Regions, division names, the gazetteer and TourAPI codes are in `config/korea.json`; Korean Commons
   searches and roots in `config/categories.json` (`korea_search`, `korea_roots`, `korea_allow_patterns`); TourAPI
   terms and content types in `config/pipeline.json` → `tourapi`. Check `review/korea.json` and `review/tourapi.json`
   after the next run.
4. **Wikipedia terms.**
   - Add phrases per language under `wikipedia.wikis` in `config/pipeline.json`.
   - Check `review/wikipedia.json` after the next run, and tune `accept_score` or `entity_rules` if needed.
5. **Commit and run.** Commit to `source` with `[collect]` in the message, or run the workflow by hand.

## 9. Deploy and the live check

`pipeline/deploy.mjs` builds the new tree of `main`:

- It copies the build (`npm run build` with `SITE_URL=https://remona8787.github.io`).
- `site-data/` goes to `data/`. An invalid or missing dataset is never deployed: the data already on main stays.
- `admin-data/` is never published (v0.18): it stays on the data branch. A `data/admin/` left on main by an earlier
  deploy is removed by the next one (the deploy commits even when nothing else changed).
- `.git`, `.github/`, `README.md`, `.nojekyll` and `CNAME` on main are kept. Everything else is replaced.
- `robots.txt` keeps `Disallow: /data/admin/` (nothing is there; old links stay out of indexes).
- Project pages for search engines and link previews (`scripts/prerender.mjs`, UI track): `p/<id>/index.html` for every
  project of the deployed dataset, `p/index.html`, `sitemap.xml` (the build's own entries plus the pages) and the
  `aol-static-pages` marker in `index.html`. They are made from the dataset that is deployed: the data branch's, or the
  kept one when the data branch's is rejected, never the rejected one; a `p/` of the build is dropped. Rendering is pure,
  so an unchanged deploy keeps its deploy id. A dataset the renderer cannot read leaves the site without `p/` (logged);
  the summary gives `pages`.
- `/deploy.json` names the deploy: `{schema, deploy_id, build_id, dataset, admin: "not_published", source, data, at}`. `deploy_id` is a hash of the whole tree.

`pipeline/verify-live.mjs` works in four steps:

1. It waits (up to 20 minutes) until `/deploy.json` has the deploy id and `/data/manifest.json` the build id.
2. It opens home, explore, map, a detail page (a hero or featured project), the data page and the admin page, at 390×844 and 1440×900. Each page gets a fresh context with a cold cache and service workers blocked.
3. It checks that `/data/admin/report.json` is not served (`summary.admin_data_public`; served means failure) and
   records the rendition width of the home page's largest image (`summary.home_lcp_image_px`). The regression page
   `#place/SEOUL006` is opened on every run besides the rotating detail page; for both, the images on the page are
   matched to the record (Commons file name or URL): `pages[].gallery` gives the count shown, providers, kinds and any
   artist portrait or unverified image visible (`summary.gallery_forbidden`, should be 0; `--strict` fails on it).
4. It writes `review/live/report.json` and a JPEG per page.

The report records, per page: HTTP status, console errors, page errors, failed requests, HTTP errors, LCP, navigation
timings, transfer bytes (total and by resource type), the `data/` files fetched, broken images, and any internal
review vocabulary visible on a public screen. Its summary says whether the home page loaded `index.json` (it should
not). The job fails when the deploy never appears or a page does not load. `--strict` also fails on console errors,
failed requests or internal vocabulary.

The deploy job warns when `.github/workflows/archive.yml` on main, or the copy at the root of `source`, differs from
`deploy/pages-repo/` on source. Workflow files must be copied to main by hand: a GITHUB_TOKEN push may not change them.

## 10. Costs

**$0.**

- The repository is public, so GitHub Actions minutes on standard runners and GitHub Pages are free.
- A run takes about 30 minutes in total; four runs a day.
- The sources are free public APIs, used within their etiquette.

Limits to keep in mind:

- a Pages site of at most 1 GB with a soft bandwidth limit of 100 GB a month;
- 6 h per job;
- GitHub may disable scheduled workflows in a public repository after 60 days without activity. Re-enable it on the Actions tab if that happens.

## 11. Verified here vs. needs a live run

The development machine reaches only the npm registry and web search: not Wikidata, Commons, Wikipedia, Openverse,
Flickr, data.go.kr, NAVER or github.io. Everything below was verified against **recorded-shape fixtures** and, for the
v0.17 → v0.18 transition, an **offline replay of the live data branch**; no live answer is claimed.

**v0.18, verified here:**

- **Fixtures** (`tests/fixtures/pipeline/`, regenerated by `make-fixtures.mjs`): the v0.17 set plus South Korea's
  first-level divisions (with the 2026 Gwangju merger: an ended division and a merged city without an ISO code),
  Korean class items, Korean Wikipedia hits (a museum under a broad term, a light festival, an artist and a library
  that must be refused), Commons Korean searches, TourAPI KorService2 answers in the data.go.kr envelope (an empty
  `items` string, a gateway error for a wrong key, overviews with HTML homepages, `cpyrhtDivCd` Type1/Type3/missing),
  the photo gallery, Openverse and Flickr answers (licence list, sizes, geotags, a by-nc and an unidentifiable photo, a
  Wikimedia duplicate), 960 px renditions with a blurred and a heavily compressed variant, provider originals of
  1200–2048 px, an official image, the four mislinked files of the first live review and the exact institution files
  of the second (SEOUL022, SEOUL043, with the museum's event subcategories and the tower's depicts files). The fake fetch refuses
  non-standard Wikimedia widths like the CDN.
- **Tests** (`tests/pipeline-korea.test.mjs`, `pipeline-providers.test.mjs`, and the updated run, images, output,
  editorial, deploy and workflow tests): the gazetteer (addresses, cities, ambiguous names, conflicts), the live
  divisions (ISO, label, stale cache, unconfirmed properties), every kr_region rule; TourAPI parsing, licences, key
  handling, discovery decisions; Korean requests first on every shared host, the foreign view's earlier deadline, a
  429 pause; every provider adapter; identity rules; quality metrics (blur, blocking, near-duplicate hashes); tiers
  1–5, the width and quality gates, roles, approvals, near-duplicates; the v0.18 image object and the upgrade of v0.17
  images; home.json sections and the 70 % Korean hero share; every new editorial action; relevance regressions;
  institution files never card, hero, featured or gallery; contact sheets whose written JPEGs, read back pixel by
  pixel, show the fixture photos in every tile on a first and a cached run (`grey_tiles` 0); admin data never deployed and an old `data/admin/` removed; the
  workflow's secrets only in the collect step and the two source copies identical; the step summary.
- **Dry run** (`npm run dry-run --prefix pipeline`): 68 projects, 56 Korean with a region each, 4 hero slides (3
  Korean), contact sheets per provider; equal to the committed fixture dataset.
- **Offline replay of the live data branch** (274 projects, run 22, 2026-10-25), network refused, once with the
  caches as of that run and once with every cache expired: both publish all 274 projects, schema-valid, every Korean
  project with a region (49 Seoul, Tower Infinity in Incheon), all v0.17 images upgraded (no `utm_` left), images the
  run could not re-score kept from the previous dataset; the last good dataset is never dropped.

**Needs the first live run** (push to `source` with `[collect]`, or Actions → archive → Run workflow):

1. `review/korea.json`: the live first-level divisions — every region should have its divisions confirmed; compare
   the `expected` list (Gyeonggi Q20937 was not in the fixture answer on purpose); after the 2026 merger check that the
   Jeonnam-Gwangju item maps to `gwangju_jeolla`.
2. `review/classes.json` → `instances_per_class` and `review/korea.json` → `class_instances`: Korean items per class.
3. `review/wikipedia.json` for `ko`: hit quality of the wide term list; tune `term_rules.min_score` if broad terms
   let unrelated places in, or refuse real ones.
4. `review/categories.json`: the Korean roots (warnings for roots that do not exist on Commons are expected; replace
   them with the real category names) and the `korea_search` results.
5. With `TOURAPI_SERVICE_KEY`: `review/tourapi.json` (decisions; the real field names of KorService2 answers, in
   particular `lDongRegnCd`), `review/providers.json` (TourAPI name matches), and whether the photo gallery answer
   carries a per-photo copyright field (then set `kto_photo.default_license_when_missing` only if the answer proves it).
6. `review/providers.json`: Openverse rate-limit headers and 429s (lower `max_requests_per_run` or add the OAuth
   secrets if the run is limited); Flickr with `FLICKR_API_KEY`.
7. `review/images.json` and the contact sheets: quality thresholds on real photographs (`images.quality`), the
   near-duplicate distance, tiers, and identity decisions; approve good provider images (`approve_image`) and heroes.
   `review/contact-sheets/index.json`: `grey_tiles` should be 0 on every sheet (a non-zero count means thumbnails were
   refused or the fetch budget ran out). The curated Korean places: their cards should show the place or the work,
   never an event, a person or the neighbourhood (`institution_context` in the report counts what was demoted).
8. The step summary of the run: images by provider, hero count, below-threshold count, failures.
9. verify-live: `summary.admin_data_public` false, `summary.home_lcp_image_px` ≥ 1280 on desktop once a hero exists.
10. Whether the 25-minute budget covers the cold image caches (quality renditions and provider searches are cached a
    year and two weeks; the first runs may end `partial` and fill in).
11. The app (UI track) reading `display`, `kr_region`, `kr_regions`, `kr_featured`, `kr_programs`, `world`, `thumb_w`
    and `thumb_h`, and honouring `no_derivatives` (show as is, no cropping) and `usage: hotlink`.

**v0.17, verified earlier:** the recorded fixtures of every v0.17 source; the full dry run, idempotence, last good data
on source failures, the stale tracker and drop guard, partial output under a short budget, a run without sharp; the
workflow file (schema-validated with `@action-validator/cli` 0.6.0); the CI scripts against real local git
repositories; deploy assembly; the live check helpers; and the three jobs in sequence against a local bare
repository. The first live runs (2026-10-20 onwards) confirmed the v0.17 pipeline on GitHub Actions.

## 12. Additions to the contract

These additions to `docs/STATIC_ARCHIVE.md` change nothing that a v0.17 reader relies on:

- `/deploy.json` at the site root (written by the deploy job). verify-live waits for it as well as for the manifest's `build_id`, because a source-only deploy keeps the same `build_id`. Its `admin` is always `"not_published"`.
- `robots.txt` on main also disallows `/data/admin/`.
- The deploy job keeps `CNAME` as well as `.github`, `README.md` and `.nojekyll`.
- `data` and `main` histories are compacted to one snapshot commit after 120 commits.
- v0.18: index columns after `added_at` (`kr_region`, `thumb_w`, `thumb_h`); manifest and home counts `korea`, `world`,
  `by_kr_region`; image objects keep `thumb` and `attribution` for the v0.17 app and add `no_derivatives` (KOGL Type 3),
  `permission_note` (editorial images), `identity` (non-Commons) and `below_target` (a hero or card under its width
  target); records carry `kr_region` (null outside Korea); TourAPI projects have ids `KTO-<content id>`.
