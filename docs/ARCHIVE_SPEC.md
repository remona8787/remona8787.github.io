# Global media facade archive — specification (v0.16)

This is the shared contract for the archive layer: database, collector, admin console and app. Names of tables,
views, RPCs, Edge Functions and client fields below are fixed. A track that must change one records the change in
its own doc under "Contract changes" and the integration step reconciles them.

## 1. Goal and rules

「빛의 건축」 becomes a continuously updated archive of media facades and related media architecture in Korea and
worldwide, which people can search, filter, compare and map, and which researchers can cite and export.

Rules that every track follows:

1. **No auto-publishing of web-derived information.** Anything found through news, RSS, search APIs or other web
   sources becomes a *candidate* and is public only after an editor approves it. The one exception is structured
   Wikidata items (CC0) with an explicit media-facade or light-art class and coordinates. They are already listed,
   labelled "자동 수집 · 미검수" (`public_discovered_places`, v0.15), and stay controlled by the
   `auto_list_structured` setting.
2. **Nothing is invented.** A field without a source is `null` and shown as "미확인". Derived values (for example a
   project type derived from a curated category) carry the field state `derived`.
3. **Store facts and pointers, not copies.** From a news item or search result we keep the title, the canonical URL,
   the publisher, the language, the publication date and an excerpt of at most 300 characters taken from the feed or
   API response. We never fetch or store article bodies, and we never store third-party images except
   license-cleared Wikimedia Commons files (existing rights pipeline).
4. **Allowed access only.** Use official APIs and published feeds, and follow each source's terms and rate limits.
   Before fetching any HTML page (link checks), honour robots.txt. Send a descriptive User-Agent with a contact
   address: `LightArchitectureArchive/0.16 (+https://github.com/ymin02/medieval_era_project; remona56@hanmail.net)`.
5. **Separate collected data from human judgement.** Each value carries its origin: collected (auto), editor
   verified, or researcher assessed. An automatic classification is never presented as an academic fact.
6. **Costs are opt-in.** The default configuration uses only free sources that need no key. Keyed or metered
   sources stay off until the operator adds the key.
7. **Secrets stay server-side.** Service-role keys and API keys live only in Supabase Edge Function secrets or
   Vault, never in `config.js`, the admin config, the repository or logs.

## 2. Sources

| kind | access | key / cost | stored | default |
|---|---|---|---|---|
| `wikidata` | SPARQL (existing sync-global-places + archive enrichment) | none, CC0 | structured fields, QID | on, 6 h |
| `commons` | MediaWiki API (existing rights checks) | none | cleared image metadata and attribution | on |
| `gdelt` | GDELT DOC 2.0 API, `mode=ArtList&format=json`, rolling 3-month window, 65 languages | none, free; cite GDELT; at most 1 request per 5 s | title, URL, domain, language, source country, seen date | on, 6 h per keyword group |
| `rss` | RSS 2.0 / Atom feeds of architecture, design and media-art publications (conditional GET with ETag/Last-Modified) | none | only items whose title or excerpt matches positive keywords | on, 6 h |
| `websub` | WebSub (PubSubHubbub) push for feeds that advertise a hub | none | same as rss | auto when a hub is advertised |
| `naver_news`, `naver_blog` | NAVER API HUB `https://naverapihub.apigw.ntruss.com/search/v1/{news,blog}`, headers `X-NCP-APIGW-API-KEY-ID` / `X-NCP-APIGW-API-KEY`; legacy developers.naver.com keys (`openapi.naver.com/v1/search/*`, `X-Naver-Client-Id/Secret`) are supported until 2027-06-30 | key; free quota (25,000/day) | title (tags stripped), link, ≤300-char description, pubDate | off until keys are set |
| `brave` | Brave Search API web search | key and card; metered (about $5 per 1,000 requests, $5 monthly credit) | title, URL, ≤300-char description | off; enabling it may incur cost |

Not implemented: the Bing Search APIs (retired 2025-08-11) and the Google Custom Search JSON API (closed to new
customers; discontinued 2027-01-01). Both are recorded in the docs with these reasons.

Seed rules (`archive_collection_rules`) cover:

- GDELT keyword groups in English, Korean, Japanese, Chinese, German, French, Spanish, Italian, Portuguese, Dutch,
  Polish, Russian, Arabic and Turkish. Examples: "media facade", "media façade", "LED facade", "projection mapping"
  together with a building term, 미디어파사드, メディアファサード, 媒体立面 / 媒体幕墙, Medienfassade,
  façade média(tique), fachada multimedia / fachada de medios, facciata mediatica, fachada de mídia, mediagevel,
  fasada medialna, медиафасад, واجهة إعلامية, medya cephe.
- RSS feeds: Dezeen, designboom, ArchDaily, Archinect, Creative Applications Network, Media Architecture Institute,
  Designboom Korea. Every feed is seeded with `verified_at = null`. A failing feed backs off and is flagged in the
  dashboard; it is never silently dropped.

## 3. Pipeline

```
fetch (adapter) → parse → keyword prefilter → classify → normalize → dedupe/match → ingest (SQL) → run log
```

- **Classify** (`edge-functions/_shared/archive/classify.mjs`, deterministic and explainable, no paid model):
  - Weighted multilingual terms with three polarities: positive (facade or media-architecture terms), context
    (building, tower, plaza, bridge, architecture, unveiled, installed, festival) and negative (rental, price, buy,
    supplier, manufacturer, wholesale, job, 임대, 매매, 분양, 채용, 광고대행, 견적).
  - Output: `{score 0..100, label, reasons[], version}`. `label` is one of `facade_project`, `event_program`,
    `ad_screen`, `product_vendor`, `irrelevant` or `uncertain`.
  - Thresholds: `score >= 60` gives `needs_review`, 35–59 gives `uncertain` (also reviewable), and below 35 gives
    `auto_ignored`, kept 30 days for audit.
- **Normalize:**
  - Canonical URL: lower-case host, drop `www.`, `utm_*`, `fbclid`, `gclid` and fragments.
  - Clean title: strip HTML and the site-name suffix.
  - Language: from the source, otherwise detected by script.
  - Location: gazetteer lookup of country and city names (KO/EN/local) in the title and excerpt, using the
    `countries` and `cities` tables. GDELT's `sourcecountry` is the publisher's country, not the project location.
  - Known-project match: the alias index of archive project names (all languages) and Wikidata labels.
- **Dedupe and match**, rules in order; the first hit wins:
  1. Same `wikidata_qid`.
  2. Same canonical official URL, or the canonical source URL is already attached to a project or candidate.
  3. Known-project alias found in the title.
  4. Same normalized name and same country and city.
  5. Coordinates within 200 m and name trigram similarity ≥ 0.45.
  6. News-story clustering: titles with token Jaccard ≥ 0.6 seen within 14 days become one candidate with several
     hits (syndicated or duplicate articles).

  A match to a project attaches the hit as new information (`archive_project_updates`) instead of creating a
  candidate.
- **Reliability** of a source, 0–100:
  - Base score by source kind: official 90, public_agency 85, academic 85, wikidata 70, specialist_media 70,
    news 55, search_result 40, blog 30.
  - +10 for each further independent domain on the same candidate, up to +20.
  - −30 when the link is broken.

  Candidate `confidence` = round(0.6 × classifier score + 0.4 × best source reliability).
- **Retries:**
  - Per request: up to 2 retries on 429 or 5xx, honouring `Retry-After`; 20 s timeout; 2 MB response cap.
  - Per rule: `failure_count`, then `backoff_until` = now + min(48 h, 1 h × 2^(failures−1)).
  - Every error is written to `archive_run_errors`.
- **Link and image checks:**
  - Daily batch of the oldest-checked URLs. HEAD request, falling back to `GET Range: bytes=0-0`; at most 3
    redirects.
  - SSRF guard: http(s) only; refuse localhost, private, link-local and metadata addresses.
  - At most 1 request per second per host; robots.txt is honoured for HTML pages.
  - Three consecutive failures set `link_state = broken`. A broken image is hidden from the public view; a broken
    official URL sets the project's `update_status = link_broken`.

## 4. Database (migration `supabase/migrations/20261018000000_media_facade_archive.sql`, also appended to `release/launch/complete-backend.sql`)

Controlled vocabularies are `text` columns with `check` constraints, so new values need only a migration. The same
lists, with KO/EN labels, live in `site-public-cleared/archive-taxonomy.js`, a UMD module shared by the app, the
admin console and the tests.

```
project_type:        media_facade | projection_mapping | urban_screen | media_wall | interactive_installation |
                     light_art | festival_program | media_architecture | other
installation_method: led_mesh | led_cabinet_screen | led_linear_pixel | led_media_glass | led_backlit_cladding |
                     projection | kinetic | lcd_panel | mixed | other
envelope_type:       glass_curtain_wall | metal_mesh | perforated_metal | stone_masonry | concrete | membrane_etfe |
                     louvres_fins | bridge_infrastructure | historic_facade | other
technology[]:        led_rgb | led_mono | pixel_points | laser_projector | lamp_projector | sensors | mobile_interaction |
                     sound | realtime_data | generative | anamorphic_3d
content_type[]:      artwork | generative | data_visualization | advertising | information | event_program |
                     interactive | anamorphic_3d | mixed
spatial_context[]:   plaza | street | waterfront | skyline | transit_hub | cultural_district | commercial_district |
                     campus | park | heritage_site | bridge | interior_atrium
operating_status:    operating | seasonal | event_based | ended | inactive | demolished | unknown
region:              east_asia | southeast_asia | south_asia | central_asia | middle_east | europe | africa |
                     north_america | latin_america | oceania   (derived from country_iso2)
record_origin:       curated | auto_collected | editor_created
review_status:       unreviewed | editor_verified | researcher_assessed
field state:         unverified | source_reported | derived | editor_verified | researcher_assessed
visibility:          draft | published | hidden
update_status:       current | new_info | stale | link_broken
source_kind:         official | public_agency | academic | specialist_media | news | blog | wikidata | search_result
link_state:          unknown | ok | redirect | broken | robots_disallowed | blocked
candidate status:    needs_review | uncertain | auto_ignored | approved | merged | rejected | duplicate
```

Tables (all have RLS on, with no anon or authenticated table privileges; writes go only through the RPCs below or
service_role):

- `archive_projects`
  - Identity: `id uuid`, `slug unique`, `name_original`, `name_original_lang`, `name_en`, `name_ko`, `aliases text[]`.
  - Location: `country_iso2`, `region`, `city`, `district`, `address`, `latitude`, `longitude`,
    `location_precision` (exact|street|city|unknown).
  - Dates and status: `year_installed`, `year_completed`, `year_operating_since`, `year_ended`, `operating_status`.
  - Building and media: `building_name`, `project_type`, `installation_method`, `envelope_type`, `technology[]`,
    `display_area_m2 numeric`, `resolution_text`, `pixel_pitch_mm numeric`, `content_type[]`, `interactive boolean`.
  - Context: `viewing_points`, `spatial_context[]`, `urban_context`, `summary_ko`, `summary_en`.
  - Links and status: `wikidata_qid unique`, `official_url`, `discovered_qid` (link to `discovered_places`),
    `curated_place_id` (seed id such as SEOUL001), `record_origin`, `review_status`, `visibility`, `update_status`.
  - Provenance: `field_status jsonb`, a map from field name to `{state, source_id?, at?}`. A missing key means
    unverified.
  - Timestamps and editing: `first_collected_at`, `last_collected_at`, `last_verified_at`, `created_at`,
    `updated_at`, `created_by`, `updated_by`.
- `archive_credits`: `project_id`, `role` (architect|facade_designer|media_artist|lighting_designer|manufacturer|
  operator|owner|curator|producer|other), `name`, `name_en`, `wikidata_qid`, `source_id`.
- `archive_sources`
  - Identity: `id`, `url`, `canonical_url unique`, `title`, `publisher`, `source_kind`, `language`.
  - Dates: `published_at`, `retrieved_at`, `last_checked_at`.
  - Link check: `http_status`, `link_state`, `consecutive_failures`.
  - Quality: `reliability smallint`, `license`, `excerpt (≤300)`.
  - Origin: `provider` (the rule kind it came from).
- `archive_project_sources`: `project_id`, `source_id`, `supports text[]` (field names), `added_at` (many-to-many).
- `archive_media`: `project_id`, `url`, `page_url`, `commons_file`, `license`, `license_url`, `author`,
  `attribution`, `rights_status` (pending|cleared|blocked), `is_primary`, `link_state`, `last_checked_at`, `source_id`.
- `archive_candidates`
  - Identity and status: `id`, `status`, `label`, `score`, `confidence`, `reasons jsonb`, `classifier_version`,
    `detected_name`, `detected_country_iso2`, `detected_city`, `latitude`, `longitude`, `language`, `dedupe_key`,
    `matched_project_id`, `duplicate_of`.
  - Timestamps: `first_seen_at`, `last_seen_at`, `seen_count`.
  - Review: `reviewed_by`, `reviewed_at`, `review_note`.
- `archive_candidate_hits`: `candidate_id`, `rule_id`, `provider`, `external_id`, `url`, `canonical_url`, `title`,
  `excerpt`, `publisher`, `published_at`, `fetched_at`, `raw jsonb` (≤4 kB of API fields, no article bodies);
  unique on (`provider`, `canonical_url`).
- `archive_project_updates`: `project_id`, `kind` (new_source|changed_field|link_broken|image_broken|wikidata_changed),
  `detail jsonb`, `status` (open|applied|dismissed), `created_at`, `resolved_by`, `resolved_at`.
- `archive_collection_rules`
  - Definition: `id`, `kind` (gdelt|rss|naver_news|naver_blog|brave|wikidata|websub), `name`, `query`, `url`,
    `language`, `region_hint`, `enabled`, `cadence_hours`.
  - Scheduling: `next_run_at`, `last_run_at`, `last_status`, `failure_count`, `backoff_until`.
  - Conditional GET: `etag`, `last_modified`.
  - Notes: `terms_url`, `verified_at`, `notes`.
- `archive_keywords`: `term`, `language`, `polarity` (positive|context|negative), `weight`, `enabled`.
- `archive_runs`: `id`, `rule_id`, `trigger` (cron|admin|websub|probe), `status` (running|success|partial|error|
  skipped), `started_at`, `finished_at`, `fetched`, `kept`, `new_candidates`, `matched_projects`, `duplicates`,
  `ignored`, `errors`, `attempt`.
- `archive_run_errors`: `run_id`, `rule_id`, `at`, `stage`, `http_status`, `message (≤1000)`, `url`.
- `archive_websub_subscriptions`: `topic unique`, `hub`, `secret` (server only, never exposed), `state`
  (pending|active|failed|expired), `lease_expires_at`, `last_push_at`.
- `archive_assessments` (researcher judgements, kept apart from collected data): `project_id`, `assessor` (auth
  uid), `attribute`, `value jsonb`, `confidence` (low|medium|high), `method`, `note`, `created_at`.
- `archive_audit_log`: `actor`, `action`, `entity`, `entity_id`, `before jsonb`, `after jsonb`, `at`.
- `archive_settings`: one row with `auto_list_structured boolean default true`,
  `auto_ignore_below smallint default 35`, `review_threshold smallint default 60`.
- `app_admins` gains `role text check (role in ('admin','editor','researcher')) default 'editor'` and keeps the
  existing `is_app_admin()`, which is true for admin and editor. New helper:
  `archive_role() returns text` (null for others).

Indexes: `pg_trgm` GIN on the project names and aliases; btree on `country_iso2`, `project_type`, `year_installed`,
`updated_at`, `first_collected_at`; candidates on (`status`, `confidence desc`); hits on `canonical_url`; sources on
`canonical_url`.

### Public read API (anon)

- `public_archive_projects` (view, owner rights, like `public_discovered_places`): published projects only.
  - Columns: every project column except `created_by`, `updated_by` and internal notes, plus `credits jsonb`,
    `sources jsonb` and `media jsonb`.
    - `sources`: `{title, url, publisher, kind, language, published_at, retrieved_at, last_checked_at, link_state,
      reliability, license, supports}`.
    - `media`: cleared images with link_state not broken only, `{url, page_url, license, license_url, author,
      attribution, is_primary}`.
  - Researcher assessments come as `assessments jsonb`: `{attribute, value, confidence, method, note, created_at}`,
    with no assessor id.
- `archive_search(p_q text, p_filters jsonb, p_sort text, p_limit int, p_offset int)` returns rows of the view.
  - Filters: `region`, `country_iso2`, `city`, `project_type`, `installation_method`, `envelope_type`, `technology`
    (any), `operating_status`, `year_from`, `year_to`, `origin`, `review_status`.
  - Sort: `relevance` | `newest` (`first_collected_at`/`created_at`) | `updated` | `year_desc` | `year_asc` | `name`.
- `archive_public_stats() returns jsonb`: counts by region, country, year, project type, installation method,
  technology and review status, plus `generated_at`.

### Admin API (authenticated; every function is `security definer`, `set search_path = public`, checks `archive_role()`)

| RPC | role |
|---|---|
| `archive_admin_dashboard() → jsonb` (queue counts, runs 24 h/7 d, error count, sources by status, projects by visibility/review, open updates, broken links) | editor+ |
| `archive_admin_list_candidates(p_status text, p_q text, p_min_conf int, p_limit int, p_offset int) → setof jsonb` (candidate + hits + suggested matches) | editor+ |
| `archive_admin_review_candidate(p_id uuid, p_action text, p_payload jsonb) → jsonb` with actions `approve_new` (payload: project fields + `publish` bool), `attach` (`project_id`), `merge` (`into_candidate_id`), `reject` (`note` required), `ignore`, `reopen` | editor+ |
| `archive_admin_upsert_project(p_project jsonb) → uuid` (validates vocabularies, updates `field_status`, writes the audit log) | editor+ |
| `archive_admin_set_visibility(p_project_id uuid, p_visibility text, p_note text)` | editor+ |
| `archive_admin_merge_projects(p_keep uuid, p_drop uuid) → uuid` (moves sources, credits, media, aliases; drop → hidden + alias) | editor+ |
| `archive_admin_add_source(p_project_id uuid, p_source jsonb, p_supports text[]) → uuid` | editor+ |
| `archive_admin_set_media(p_project_id uuid, p_media jsonb) → uuid` / `archive_admin_remove_media(p_media_id uuid)` | editor+ |
| `archive_admin_list_projects(p_q text, p_visibility text, p_limit int, p_offset int) → setof jsonb` | editor+ |
| `archive_admin_list_updates(p_status text, p_limit int) → setof jsonb` / `archive_admin_resolve_update(p_id uuid, p_action text)` | editor+ |
| `archive_admin_list_runs(p_limit int, p_rule_id uuid) → setof jsonb` / `archive_admin_list_errors(p_limit int)` | editor+ |
| `archive_admin_list_rules() → setof jsonb` / `archive_admin_upsert_rule(p_rule jsonb) → uuid` / `archive_admin_list_keywords()` / `archive_admin_upsert_keyword(p_kw jsonb)` | admin (list: editor+) |
| `archive_admin_set_settings(p_settings jsonb)` | admin |
| `archive_research_add_assessment(p_project_id uuid, p_attribute text, p_value jsonb, p_confidence text, p_method text, p_note text) → uuid` | researcher, editor, admin |

### Service API (service_role only; used by the Edge Functions)

- `archive_claim_due_rules(p_limit int, p_owner text) → setof archive_collection_rules`: lock, then mark running.
- `archive_start_run(p_rule_id uuid, p_trigger text) → uuid`
- `archive_ingest(p_run_id uuid, p_items jsonb) → jsonb`: idempotent; applies the dedupe rules in SQL with the keys
  computed in JS; returns `{new_candidates, matched_projects, duplicates, ignored, kept}`.
- `archive_finish_run(p_run_id uuid, p_status text, p_counts jsonb, p_rule_state jsonb)`: also updates
  backoff, etag and next_run_at.
- `archive_log_error(p_run_id uuid, p_rule_id uuid, p_stage text, p_http int, p_message text, p_url text)`
- `archive_links_due(p_limit int) → setof jsonb` / `archive_record_link_checks(p_results jsonb)`
- `archive_alias_index() → setof jsonb`: project id plus all names and aliases, for known-project matching.
- `archive_websub_*`: subscription upsert, lookup by topic and secret check helpers.
- `archive_prune()`: deletes `auto_ignored` candidates older than 30 days and runs older than 180 days.

Cron (in `release/launch/install-six-hour-sync.sql`, through pg_net with the Vault secret, as the existing jobs do):

- `archive-collect`: hourly at minute 17. Each rule carries its own cadence; at most 6 rules per invocation.
- `archive-check-links`: daily at 03:20 KST.
- `archive-prune`: daily.

## 5. Edge Functions

- `archive-collect` (POST)
  - Authorization: either the cron shared secret (the `authorizedSecret` pattern of the existing functions; this
    also keeps `scripts/check.mjs` passing), or an editor+ user JWT with `{rule_id}` for "지금 실행".
  - Body: `{rule_ids?, max_rules?, dry_run?}`.
  - Renews WebSub subscriptions that expire within 48 h.
- `archive-websub`
  - GET: hub verification. Echo `hub.challenge` only for a known pending or active topic.
  - POST: check `X-Hub-Signature-256` (or sha1) as an HMAC with the subscription secret, using a timing-safe
    comparison, then parse and ingest with trigger `websub`. Body limit 2 MB.
- `archive-check-links`: cron secret only.

Shared code is plain `.mjs` in `edge-functions/_shared/archive/`, imported by both Deno and Node tests:
`adapters/{gdelt,rss,naver,brave,wikidata}.mjs`, `classify.mjs`, `normalize.mjs`, `dedupe.mjs`, `reliability.mjs`,
`http.mjs` (retry, timeout, size cap, SSRF guard, robots), `websub.mjs`.

`scripts/archive-probe.mjs` runs the same adapters and classifier against the live sources without a database
(dry run). It prints per-rule counts, label breakdowns and sample normalized candidates, and writes
`release/archive-probe.json`. `.github/workflows/light-architecture-archive-probe.yml` runs it weekly and on demand,
and uploads the report as an artifact. This is how live collection is verified from an environment that can reach
the sources.

## 6. App (client)

Data sources, merged in `allPlaces()`:

- Curated seed (editor reviewed).
- `public_archive_projects` when Supabase is configured (REST, paged, cached 6 h, stale-on-error, like the v0.15
  server sync).
- Wikidata structured items (`public_discovered_places`, or the browser sync).

Dedupe is by QID, `curated_place_id` and name+city. Archive projects become client places with
`origin: 'archive'`. List, cards, map and detail all read this one merged list through `X.search`, so search results
and map pins always match.

Client place fields added (flat, all optional; `null` means 미확인):

- Identity and location: `project_type`, `region`, `country_iso2`, `name_original`.
- Dates and status: `year_installed`, `year_completed`, `operating_status`.
- Building and media: `building_name`, `installation_method`, `envelope_type`, `technologies[]`, `content_types[]`,
  `display_area_m2`, `resolution_text`, `interactive`.
- Context: `spatial_context[]`, `viewing_points`, `urban_context`.
- People and evidence: `credits[{role,name}]`, `sources[...]`, `assessments[...]`.
- Provenance: `record_origin`, `review_status`, `field_status{}`, `first_collected_at`, `last_collected_at`,
  `last_verified_at`, `update_status`.

Wikidata items fill what Wikidata states (P571 inception, P17 → ISO code, P84 architect, P170 creator, P137
operator, P5817 state of use, P856 official website), with state `source_reported`.

The app adds:

- Filters: region, country, city, project type, installation method, technology, envelope, operating status, year
  range, data origin/review state.
- Sorts: relevance, newest, recently updated, year, name.
- A mobile full-screen filter sheet showing the live result count.
- An archive detail section (basic, technical and architectural, sources and licences, data status with the last
  collected/verified time and update state, citation), similar projects, and save and share (existing).
- A KO/EN UI language toggle.
- A research data page: statistics by region, country, year, type and technology; CSV/JSON export of the current
  filtered set with provenance columns and a data dictionary; and a methodology note that explains auto-collected
  versus editor-verified versus researcher-assessed data.

## 7. Track ownership (parallel work; do not edit another track's files)

- **db:**
  - `supabase/migrations/20261018000000_media_facade_archive.sql`
  - archive sections appended to `release/launch/complete-backend.sql` and `release/launch/install-six-hour-sync.sql`
  - `tests/archive-sql.test.mjs`, `tests/sql/*` (stubs only, additive)
  - `docs/ARCHIVE_DB.md`
- **collector:**
  - `edge-functions/_shared/archive/**`
  - `edge-functions/archive-{collect,websub,check-links}/`
  - `tests/archive-collector*.test.mjs`, `tests/deno/archive-*_test.ts`, `tests/fixtures/archive/**`
  - `scripts/archive-probe.mjs`, `.github/workflows/light-architecture-archive-probe.yml`
  - `scripts/deploy-edge-functions.sh`, the `scripts/check.mjs` auth-guard list, `package.json` scripts
  - `docs/ARCHIVE_COLLECTOR.md`
- **admin:**
  - `admin/**` and `site-public-cleared/admin/**` (kept identical)
  - `qa/admin*.spec.mjs`, `qa/admin-fixtures.mjs`
  - `docs/ARCHIVE_ADMIN.md`
- **client:**
  - `site-public-cleared/{app.js,styles.css,catalog.js,core.js,index.html,archive-taxonomy.js,sw.js}`
  - `client/**`
  - `edge-functions/_shared/global-places*.mjs`, `edge-functions/sync-global-places/` (Wikidata field enrichment
    only, keeping its tests green)
  - `site-public-cleared/assets/seed.js` (derived fields only)
  - `scripts/{build.mjs,icons.mjs}`
  - the existing app QA specs, `tests/app.test.cjs`, `tests/catalog.test.cjs`, `tests/global-places*.test.mjs`,
    `tests/deno/sync-global-places_test.ts`
  - `docs/ARCHIVE_APP.md`

`site-public-cleared/archive-taxonomy.js` already exists on main (shared vocabularies and ISO → region map). The
client track may add labels; the admin track loads it as `../archive-taxonomy.js` and does not edit it; the db track
mirrors its keys in check constraints, and `tests/archive-sql.test.mjs` compares the two.

E2E ports, so tracks can run Playwright at the same time: main 4173, db 4311, collector 4312, admin 4313, client 4314,
QA 4315–4317 (set `AOL_TEST_PORT`).
