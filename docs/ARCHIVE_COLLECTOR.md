# Archive collector (v0.16)

The automatic collection system of the global media facade archive: the collector track of
[ARCHIVE_SPEC.md](ARCHIVE_SPEC.md) (§2 sources, §3 pipeline, §5 Edge Functions, §8 ingest items). It finds news,
feed items and search results about media facades and related media architecture, scores and normalizes them, and
hands them to the database (`archive_ingest`) as **candidates**. Nothing it finds is published: an editor approves
every candidate (spec §1 rule 1).

Status of this document's claims: everything below was **fixture-tested** (unit tests on recorded-shape answers,
Deno tests with stubbed Supabase and sources, and one run of the db track's SQL on PGlite). No source was reachable
from the machine this was built on, so **nothing here is live-verified**; see "Verified here" and "Probe run from the
build machine" at the end.

## Files

| file | what it does |
|---|---|
| `edge-functions/_shared/archive/http.mjs` | every outbound request: User-Agent, 20 s timeout, ≤ 2 retries on 429/5xx with Retry-After, 2 MB streaming cap, ≤ 3 manual redirects with the SSRF guard on each hop, per-host rate limiter, robots.txt, conditional GET |
| `adapters/gdelt.mjs`, `rss.mjs`, `naver.mjs`, `brave.mjs`, `wikidata.mjs` | one adapter per source kind; RSS 2.0, Atom 1.0 and RSS 1.0/RDF with a dependency-free XML reader |
| `classify.mjs` | the deterministic weighted multilingual classifier (14 languages), explainable reasons and a version string |
| `normalize.mjs`, `gazetteer.mjs` | canonical URL, title/excerpt cleaning, language, country/city from a compact gazetteer, project names, alias matching |
| `dedupe.mjs`, `reliability.mjs` | story clustering and keys; source kind and reliability |
| `websub.mjs` | subscribe/renew, verification of intent, HMAC signature check |
| `pipeline.mjs` | rule → adapter → prefilter → classify → normalize → dedupe → §8 items, with the §8 validator; pure (injected fetch and clock) |
| `service.mjs`, `linkcheck.mjs` | what the three Edge Functions do with the database, against an injected `rpc` |
| `seed-rules.mjs` | the source of truth for collection rules and keywords |
| `edge-functions/archive-collect/`, `archive-websub/`, `archive-check-links/` | the Edge Functions |
| `scripts/archive-seed-sql.mjs` → `release/launch/archive-seed.sql` | idempotent seed SQL (`npm run archive:seed-sql`, `--check`) |
| `scripts/archive-probe.mjs` → `release/archive-probe.json` | live dry run without a database (`npm run archive:probe`) |
| `.github/workflows/light-architecture-archive-probe.yml` | the probe weekly (Monday 03:23 UTC) and on demand; report uploaded as an artifact |

The shared modules are plain ES modules without dependencies: Deno imports them in the Edge Functions and Node imports
them in the tests and the probe.

## Sources

| kind | endpoint and parameters | terms, limits | cost | default |
|---|---|---|---|---|
| `gdelt` | `https://api.gdeltproject.org/api/v2/doc/doc?query=…&mode=ArtList&format=json&maxrecords=250&timespan=…&sort=DateDesc` | open, no key; cite GDELT; at most 1 request per 5 s (enforced per invocation); rolling ~3-month window | free | on, 14 language groups, every 6 h |
| `rss` / `websub` | the feed URL, conditional GET (`If-None-Match` / `If-Modified-Since`); WebSub push when the feed advertises a hub (`atom:link rel=hub`, or the HTTP `Link` header) | the publisher's feed; only items with a positive keyword in title or excerpt are kept; ≤ 300-character excerpts from the feed, never `content:encoded` | free | on, 7 feeds, every 6 h; WebSub when a hub is advertised and `WEBSUB_CALLBACK_URL` is set |
| `naver_news`, `naver_blog` | NAVER API HUB `https://naverapihub.apigw.ntruss.com/search/v1/{news,blog}` with `X-NCP-APIGW-API-KEY-ID` / `X-NCP-APIGW-API-KEY`; or legacy `https://openapi.naver.com/v1/search/{news,blog}.json` with `X-Naver-Client-Id` / `-Secret` (`NAVER_API_MODE=legacy`); `query`, `display=100`, `start`, `sort=date` | key required; 25,000 calls/day per the API HUB news document; at most 2 pages per rule run | free quota | **off** until keys are set and an admin enables the rules |
| `brave` | `https://api.search.brave.com/res/v1/web/search?q=…&count=20&freshness=pw` with `X-Subscription-Token` | key and card required | metered: about $5 per 1,000 requests, $5 monthly credit | **off** |
| `wikidata` | `https://query.wikidata.org/sparql` (POST): `schema:dateModified`, P571, P17, P625, P856, P5817 for the archive projects with a QID, 50 per query | CC0 | free | on, every 6 h; a first run only sets the baseline |

Facts behind the table, with where they come from (checked by web search on 2026-10-18/19; the pages themselves could
not be fetched from the build machine):

- **GDELT DOC 2.0** — open and keyless; `mode=ArtList`, `format=json`, `maxrecords` ≤ 250, `timespan`, `sort=DateDesc`,
  query operators such as `sourcelang:`, phrases in double quotes and OR'd alternatives in parentheses
  ([GDELT DOC 2.0 API debuts](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)). GDELT searches the
  **English machine translations** of the 65 languages it monitors and is phasing out native-language keyword
  search ([GDELT blog](https://blog.gdeltproject.org/)), which is why every language group asks English phrases and
  filters with `sourcelang:<language>`; the native terms (미디어파사드, メディアファサード, Medienfassade, медиафасад …)
  are what the classifier scores in the original titles. Output fields `url, url_mobile, title, seendate, socialimage,
  domain, language, sourcecountry` (third-party clients agree; `seendate` is `YYYYMMDDThhmmssZ`, UTC).
  `sourcecountry` is the **publisher's** country and is never used as the project location.
- **NAVER** — the developers-center Search API closed new registrations on 2026-07-31, and legacy keys keep working
  until 2027-06-30; NAVER API HUB is the path for new keys (per NAVER's notice as quoted by third parties; NAVER's own
  documents: [API HUB overview](https://api.ncloud-docs.com/docs/en/naver-api-hub-overview),
  [news search](https://api.ncloud-docs.com/docs/en/naver-api-hub-search-news),
  [subscription](https://guide.ncloud-docs.com/docs/apihub-use)). The news document gives `display` 1–100, `start`
  1–1000 and a 25,000/day limit; the console reportedly shows a monthly figure for News View instead, so check the
  console for the limit that applies. The adapter refuses legacy mode from 2027-07-01 00:00 KST (injected clock).
- **Brave Search API** — credit-based billing: about $5 per 1,000 Search requests with $5 of monthly credit, card
  required even for the credit; older free tiers were retired in early 2026 ([Brave Search API](https://brave.com/search/api/);
  secondary: implicator.ai, laozhang.ai). Parameters `q`, `count` (≤ 20), `offset`, `freshness=pd|pw|pm|py`.
- **Not implemented:** the **Bing Search APIs were retired on 2025-08-11**
  ([Microsoft lifecycle notice](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement));
  the **Google Custom Search JSON API is closed to new customers and existing customers must move off it by
  2027-01-01** ([Google's overview page](https://developers.google.com/custom-search/v1/overview), as quoted by
  apiserpent.com and cloro.dev).

### Seed rules (`seed-rules.mjs` → `release/launch/archive-seed.sql`)

- **GDELT**, one rule per language (en, ko, ja, zh, de, fr, es, it, pt, nl, pl, ru, ar, tr):
  `("media facade" OR "media facades" OR "led facade" OR "digital facade" OR "facade projection" OR "projection mapping" OR "media architecture") sourcelang:<english|korean|…>`.
- **RSS** (every one `verified_at = null`; URLs established from feed directories and the publishers' URL patterns):

  | name | feed URL | basis |
  |---|---|---|
  | Dezeen | `https://www.dezeen.com/feed/` | listed by feed directories (feeder.co, rss.app) |
  | designboom | `https://www.designboom.com/feed/` | WordPress feed path; not confirmed by a listing |
  | ArchDaily | `https://feeds.feedburner.com/Archdaily` | long-published Feedburner address; ArchDaily's own feeds name `https://www.archdaily.com/show.xml` as `atom:link self` — switch if the probe finds Feedburner stale |
  | Archinect | `https://archinect.com/feed/1/news` | pattern of Archinect's news tag feeds (`/feed/1/news/tag/…`) |
  | Creative Applications Network | `https://www.creativeapplications.net/feed/` | WordPress feed path; a members' full-content feed exists, only the public feed is used |
  | Media Architecture Institute | `https://mediaarchitecture.org/feed/` | WordPress site (`wp-json` present) |
  | Designboom Korea | `https://www.designboom.com/tag/korea/feed/` | no Korean edition of designboom was found; this is designboom's tag feed for Korea |
- **NAVER** (off): news `미디어파사드`, news `프로젝션 매핑 건물`, blog `미디어파사드`. **Brave** (off): `"media facade" building`, every 24 h.
- **Wikidata** (on): change detection for archive projects with a QID.
- **Keywords**: 1,185 weighted terms in 14 languages, each with polarity (positive / context / negative), weight and a
  classifier category (not stored in the database; looked up by term and language).

The seed SQL updates seeded definitions in place by `(kind, name)` and `(term, language)` and inserts missing rows,
with or without unique indexes; it never changes a rule's `enabled`, `verified_at` or schedule, or a keyword's
`enabled`. Order on a new database: `complete-backend.sql` (includes the archive migration), then `archive-seed.sql`,
then `install-six-hour-sync.sql`.

## Pipeline

1. **Fetch** through `fetchWithPolicy` (below). **Parse** the adapter's format into records `{provider, external_id,
   url, title, excerpt, publisher, language, published_at, raw}`.
2. **Prefilter**: RSS and WebSub items need a positive keyword in the title or excerpt (spec §2). API sources are
   pre-filtered by their query.
3. **Classify** (`classify.mjs`, version `aol-kw-2026.10.1`; with keyword rows edited in the database the version
   becomes `aol-kw-2026.10.1+kw.<hash>` of the enabled set):
   - score = positive terms (capped per category: facade 60, projection 45, event 45, screen 35, art 25, lighting 25)
     + context terms (capped at 30; at most 10 without any positive term) + 10 when a positive term is in the title
     − negative terms, clamped to 0..100.
   - **"projection mapping" and its translations score only with an architectural context term** (building,
     facade, tower, cathedral, 건물, 外壁, Gebäude, фасад …); a projection-mapped concert stage scores 0 for it.
   - Negative categories: advertising sales, rental, vendors (supplier, manufacturer, wholesale, price, 견적 …), real
     estate (분양, 매매 …) and jobs (채용 …).
   - Label: `product_vendor` / `ad_screen` / `irrelevant` when negatives reach 60 % of the positives (by the
     dominant negative category); else `ad_screen` when screen terms dominate, `event_program` when light-festival
     terms reach 75 % of the facade terms, `facade_project` for facade or projection terms, `uncertain` for only
     light-art/lighting terms or when negatives reach 30 % of the positives.
   - Latin-script terms of a language other than English count only for items in that language (or of unknown
     language): the Polish `cena` (price) does not penalise a Spanish `cena de gala`. Hangul/kana/Han terms match
     inside words, so Korean particles and Japanese/Chinese text without spaces still match.
   - Reasons (≤ 20) state the score arithmetic, the label rule and every term that counted, e.g.
     `+45 facade "미디어파사드" (ko, title)`, `0 projection "projection mapping" (en/…): no building/facade context`.
   - Statuses: ≥ 60 `needs_review`, 35–59 `uncertain`, < 35 `auto_ignored` (the SQL applies `archive_settings`).
4. **Normalize** (`normalize.mjs`): canonical URL (lower-case host, no `www.`, no `utm_*` / `fbclid` / `gclid`, no
   fragment); title without HTML and the site-name suffix (known site names, or the item's publisher/domain; Korean
   `[포토]`-style tags dropped); excerpt ≤ 300; language from the source (BCP-47 or GDELT's language names), else by
   script (Hangul, kana, Han, Arabic, Cyrillic) and for Latin script by a stop-word vote, `null` when unclear.
   - **Location**: country and city from a compact gazetteer (89 countries, 203 cities; English, Korean, local and
     the 14 languages' forms). A city decides the country; the title wins over the excerpt; overlapping names keep
     the longer one. Names that are also common words were left out (Korean 인도, 이란, 빈, 오만; English Nice,
     Jordan, Georgia; Japanese タイ, インド …). The region map is a copy of `site-public-cleared/archive-taxonomy.js`
     (the Edge Function bundle contains only `edge-functions/`), compared key by key in the tests. **Coordinates are
     never derived** (`detected.latitude/longitude` stay `null`): a city centroid would make dedupe rule 5 merge
     unrelated projects.
   - **Project name** (`detected.name`, a hint for editors): a quoted name; capitalised words before "media facade"
     or after "on/at the"; the Korean word before 미디어파사드; the Han/kana run before メディアファサード / 灯光秀.
   - **Known projects**: the alias index (`archive_alias_index()`); the longest alias found in the title wins, two
     projects tied on it give no match; aliases under 3 characters or that are only a place name are ignored.
5. **Dedupe keys** (`dedupe.mjs`): `story_key` = hash of the title's token set (stop words removed, Korean particles
   stripped, Han/kana bigrams); in-batch clustering joins titles with token Jaccard ≥ 0.6 published within 14 days,
   and every member carries the earliest item's key. `normalized_name` = NFKC, lower case, generic medium words at
   the end removed, whitespace and punctuation removed (diacritics kept, like the SQL's `archive_norm_name`).
6. **Reliability** (`reliability.mjs`): base by source kind (official 90 … blog 30), +10 per further independent
   registrable domain in the same in-batch story (≤ +20). Source kind from a domain map (publishers, agencies,
   universities, official festival sites) and suffix rules (`go.kr`, `.gov`, `gouv.fr`, `ac.kr`, `.edu` …), else by
   provider (GDELT/NAVER news → news, NAVER blog → blog, Brave → search_result, feeds → specialist_media).
7. **Items** exactly per §8; `validateItem` checks keys, types, lengths and vocabularies before anything is sent;
   `raw` is bounded to 4 kB (API fields only: no article bodies, no image URLs).

### HTTP policy (`http.mjs`)

- User-Agent `LightArchitectureArchive/0.16 (+https://github.com/ymin02/medieval_era_project; remona56@hanmail.net)`.
- 20 s per attempt (link checks 15 s); up to 2 retries on 429, 5xx or a network failure, waiting `Retry-After`
  (seconds or HTTP date) or 1 s then 2 s; a `Retry-After` over 30 s is not waited for (the run ends and the rule
  backs off; archive_finish_run's backoff applies). Timeouts are not retried (the run has ~2 minutes).
- 2 MB cap: refused from `Content-Length`, and the stream is cancelled as soon as it passes the cap.
- Redirects followed by hand, at most 3; 303 (and 301/302 after POST) continue as GET.
- **SSRF guard** on the first URL and every redirect hop: http/https only, no credentials in the URL; IP literals
  refused for this-network, private, CGNAT, loopback, link-local/metadata (169.254.169.254, 100.100.100.200),
  benchmark, documentation, multicast/reserved, and IPv6 loopback, unspecified, ULA (incl. `fd00:ec2::254`),
  link-local, site-local, multicast, documentation, Teredo, and the IPv4-mapped/compatible, NAT64 and 6to4 forms of
  any refused IPv4 (decimal, hex and octal IPv4 spellings are normalized by the URL parser first); host names
  `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.localdomain`, `*.lan`, `*.home.arpa`, `*.intranet`,
  `*.corp`, `*.home` and single-label names refused. **Limit:** a public host name that resolves to a private
  address is not caught — the Supabase Edge runtime gives functions no DNS lookup, and a lookup before `fetch` would
  race `fetch`'s own resolution anyway. Redirect hops are re-checked, which closes the common "public URL redirects
  to the metadata address" path.
- Per-host spacing: GDELT 5 s, every other host 1 s (one invocation; GDELT's limit is global, and with at most 6
  rules per invocation and an hourly schedule the 14 GDELT rules never overlap).
- robots.txt (RFC 9309): groups of consecutive `User-agent` lines, our product token `LightArchitectureArchive`
  matched exactly, else `*`; `Allow`/`Disallow` with longest match, Allow winning ties, `*` and `$`; 4xx = no rules,
  5xx or unreachable = disallow all; cached 24 h per origin. Used before fetching HTML pages (link checks); feeds and
  APIs are not HTML pages.

## Edge Functions

All three are deployed with `verify_jwt = false` (auth is enforced in the function, like the existing ones).

### `archive-collect` (POST)

- **Auth**: `x-aol-cron-secret` = `MEDIA_CRON_SECRET` (the existing cron secret, which the db track's cron SQL sends
  from Vault `media_cron_secret`; no separate archive secret), or `x-aol-media-admin-secret` = `MEDIA_ADMIN_SECRET`
  (operator), or `Authorization: Bearer <user JWT>` of an **editor or admin**: the session is verified with
  `auth.getUser`, then `archive_role()` is called **with the user's own token** (publishable/anon key + the user's
  JWT, never the service key); researchers get 403. A user run must name its rules. CORS allows the admin console.
- **Body**: `{rule_ids?: uuid[≤6] | rule_id?: uuid, max_rules?: 1..6, dry_run?: boolean}`.
- **Run**: claim → alias index and keywords → for each rule: start run, collect, log errors, ingest (500 items per
  call), record Wikidata changes, finish run; then subscribe to hubs the feeds advertised; then renew WebSub leases
  ending within 48 h (and retry failed/unverified ones), at most 20 per invocation. Budget 130 s; a claimed rule with
  under 20 s left is finished as `skipped` with `next_run_at` in 10 minutes.
- **dry_run** reads (rules from the table, alias index, keywords), fetches and classifies, and writes nothing: no
  claim, run, error, ingest, update or subscription. The answer carries each rule's top 10 items.
- **Answer**: `{ok, trigger, dry_run, requested_by, ms, rules: [{rule_id, name, kind, run_id, status, reason, fetched,
  items, ingest, project_updates, dropped, labels, errors, websub_hub, sample?}], websub: [...], keywords: {source,
  version, error}, aliases, websub_enabled}`; 401/403/400 for auth and body errors; 500 with the message for a
  database error.

### `archive-websub` (GET, POST; public by design)

- **GET** (hub verification): `hub.mode`, `hub.topic`, `hub.challenge`, `hub.lease_seconds`. The challenge is echoed
  (200, text/plain) only when `archive_websub_get(topic)` is pending or active; the row then becomes `active` with
  the hub's lease (subscribe) or `expired` (unsubscribe); `denied` marks it `failed`. Unknown or ended topics: 404,
  no challenge.
- **POST** (content push): topic from `?topic=` (our callback always carries it) or the `Link rel=self` header.
  Unknown or ended topics: 410 (the hub stops). Over 2 MB: 413, before any database call. The signature
  (`X-Hub-Signature-256: sha256=…`, or `X-Hub-Signature: sha1|sha256|sha384|sha512=…`) is checked against the
  subscription secret with `crypto.subtle` HMAC and a constant-time comparison. Valid → parsed, prefiltered and
  ingested as a `websub` run of the subscription's rule; invalid or missing → the **same 202** (WebSub §8: a forger
  learns nothing), nothing ingested, `archive_log_error(stage 'websub', 'push ignored: <reason>')`.
- `scripts/check.mjs` requires this HMAC check explicitly (it is the function's only guard).

### `archive-check-links` (POST, cron secret only)

- `archive_links_due(limit)` (default 120, ≤ 500) → per URL: SSRF guard; robots.txt when `html`; `HEAD`, then
  `GET` with `Range: bytes=0-0` when HEAD is refused (400/403/405/406/409/429/5xx or a network error); ≤ 3 redirects;
  1 request/s per host, 4 workers, 120 s budget (URLs not reached stay due).
- State per URL: `ok`, `redirect`, `broken` (this check failed: 404/410/5xx, timeout, network, redirect loop; also an
  unreachable robots.txt, which by RFC 9309 forbids the fetch), `robots_disallowed`, `blocked` (SSRF refusal or
  401/403/429 bot protection). The SQL counts consecutive failures, sets `broken` after three, hides broken images
  and opens/closes the `link_broken` / `image_broken` project updates.

## RPC calls and payloads (for comparison with the db track)

| call | arguments sent | by |
|---|---|---|
| `archive_claim_due_rules` | `{p_limit: 1..6, p_owner: uuid string, p_rule_ids: uuid[] \| null}` | collect (not in dry runs) |
| `archive_alias_index` | `{}`; reads `project_id`, `names[]`, `wikidata_qid` | collect, websub |
| `archive_start_run` | `{p_rule_id, p_trigger: 'cron'\|'admin'\|'websub'}` | collect, websub |
| `archive_ingest` | `{p_run_id, p_items: §8 item[] (≤ 500 per call)}` | collect, websub |
| `archive_log_error` | `{p_run_id \| null, p_rule_id \| null, p_stage, p_http: int \| null, p_message ≤ 1000, p_url ≤ 2000 \| null}`; stages `fetch`, `parse`, `normalize`, `validate`, `config`, `collect`, `ingest`, `websub` | collect, websub |
| `archive_finish_run` | `{p_run_id, p_status: 'success'\|'partial'\|'error'\|'skipped', p_counts: {fetched, errors, dropped:{prefilter, invalid, duplicate_url}, labels:{…}, not_modified, reason, classifier, project_updates}, p_rule_state: {etag?, last_modified? (RSS only), next_run_at, not_modified, failed, failure_count, backoff_until, retry_after_seconds, websub_hub, websub_self, skipped_reason}}` | collect, websub (`p_rule_state: {}`) |
| `archive_record_project_update` | `{p_project_id, p_kind: 'wikidata_changed', p_detail: {qid, date_modified, values: {inception?, country?, coordinates?, official_website?, state_of_use?: string[]}, since, rule_id}}` | collect (Wikidata rule) |
| `archive_websub_get` | `{p_topic}`; reads `{topic, hub, secret, state, rule_id}` | collect, websub |
| `archive_websub_upsert` | subscribe: `{p_topic, p_hub, p_secret: 64 hex, p_state: 'pending', p_lease_seconds: null, p_rule_id}`; hub refused: `{…, p_hub: null, p_secret: null, p_state: 'failed', p_rule_id: null}`; verification: `{p_topic, p_hub: null, p_secret: null, p_state: 'active'\|'expired'\|'failed', p_lease_seconds: hub's lease \| 604800 \| null, p_rule_id: null}` | collect, websub |
| `archive_websub_due` | `{p_within_hours: 48}`; reads `{topic, hub, rule_id}` | collect |
| `archive_links_due` | `{p_limit: 1..500}`; reads `{target, id, url, html}` | check-links |
| `archive_record_link_checks` | `{p_results: [{target, id, url, state, http_status: int \| null, final_url, reason}]}` | check-links |
| `archive_role` | `{}` with the **user's** JWT | collect (user path) |

Direct table reads with the service role (no RPC exists for them in §4): `archive_collection_rules` (`select *`,
dry runs only: `id=in.(…)` or enabled non-websub rules by `next_run_at`) and `archive_keywords`
(`term,language,polarity,weight,enabled`, enabled rows; falls back to the seed list when empty or failing).

## Operations

### Secrets (Supabase → Edge Functions → Secrets)

| name | needed by | notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEYS`), `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEYS`) | all | provided by Supabase |
| `MEDIA_CRON_SECRET` | collect, check-links | existing cron secret, reused (no `ARCHIVE_CRON_SECRET`); must equal Vault `media_cron_secret` |
| `MEDIA_ADMIN_SECRET` | collect | existing operator secret (manual runs, e.g. `curl` with `x-aol-media-admin-secret`) |
| `WEBSUB_CALLBACK_URL` | collect | `https://<ref>.supabase.co/functions/v1/archive-websub`; unset = WebSub off |
| `NAVER_API_KEY_ID`, `NAVER_API_KEY`, `NAVER_API_MODE` (`hub` default, or `legacy` until 2027-06-30) | collect | optional; then enable the NAVER rules in the admin console |
| `BRAVE_API_KEY` | collect | optional, metered; then enable the Brave rule |

`scripts/deploy-edge-functions.sh` deploys the three functions, sets `WEBSUB_CALLBACK_URL` to the project's URL by
default and passes the NAVER/Brave values on only when they are set in the environment (never generated, never
printed; the generated secrets file is git-ignored). The probe workflow reads `NAVER_API_KEY_ID`, `NAVER_API_KEY`,
`NAVER_API_MODE` and `BRAVE_API_KEY` from repository secrets; GitHub masks them and the probe never prints them.

### Expected volumes and costs (seed configuration)

| source | requests | monthly (≈) | cost |
|---|---|---|---|
| GDELT | 14 rules × 4 runs/day (≤ 3 attempts each) | 1,700 (≤ 5,000) | free |
| RSS | 7 feeds × 4/day, mostly 304 Not Modified | 850 | free |
| Wikidata | 4/day × ⌈projects with QID / 50⌉ | 120 per 50 projects | free |
| WebSub | one subscribe per feed with a hub, renewal about weekly (7-day lease, renewed within 48 h) | ≈ 5 per topic | free |
| NAVER (if enabled) | 3 rules × 4/day × ≤ 2 pages | ≤ 720 (quota 25,000/day) | free quota |
| Brave (if enabled) | 1 rule × 1/day | 30 | ≈ $0.15 at $5/1,000, inside the $5 credit (card required) |
| Link checks | ≤ 120 URLs/day, 1–3 requests each (robots, HEAD, GET) | ≤ 10,000 | free |
| Edge Function invocations | collect 24/day, check-links 1/day, websub per push | ≈ 750 + pushes | within Supabase's plan |

### Failure runbook

| symptom | where to look | what to do |
|---|---|---|
| a rule keeps failing / backs off | admin dashboard; `select * from archive_run_errors order by at desc limit 50` (stage, http_status, message, url) | run `npm run archive:probe -- --kinds <kind>` (or the workflow) to see the live answer; fix the URL or query with `archive_admin_upsert_rule`; a failing feed is never dropped: it backs off (1 h × 2^(n−1), ≤ 48 h) and stays flagged |
| GDELT `parse` errors "GDELT answered without JSON: …" | the message is GDELT's own text (e.g. a phrase too short, a malformed query) | correct the rule's query; keep phrases ≥ 3 characters and OR groups in parentheses |
| GDELT 429 | `archive_run_errors` http 429 | lower the number of GDELT rules per hour (`max_rules`) or their cadence; the 5 s spacing is per invocation |
| NAVER `naver_keys_not_set` (skipped) | run summary `reason` | set both keys; `naver_mode_invalid`: `NAVER_API_MODE` must be `hub` or `legacy` |
| NAVER 401/403 | `archive_run_errors` | API HUB keys go with `hub` mode, developers-center keys with `legacy`; `naver_legacy_expired` from 2027-07-01 KST: switch to API HUB keys |
| Brave `brave_key_not_set` / 401 / 402 | run summary, errors | set or renew the key; check the Brave dashboard (credit, card) |
| WebSub stays `pending` | `archive_websub_subscriptions` | the hub could not reach the callback: check `WEBSUB_CALLBACK_URL` and that `archive-websub` is deployed with `verify_jwt = false`; pending > 1 h is retried hourly |
| "push ignored: signature_mismatch" in errors | `archive_run_errors` stage `websub` | the hub signs with another secret (a renewal that was not verified): set the subscription `failed` so the next collect run re-subscribes with the stored secret |
| many `blocked` link checks | `archive_sources.link_state` | 401/403/429 is bot protection, not a broken link; check by hand; `robots_disallowed` is respected, nothing to do |
| archive-collect answers 500 | the `error` message | usually the database: is the archive migration applied, and `archive-seed.sql` run? |
| too many / too few candidates | queue by label and score | tune keywords in the admin console (weights, polarity); the classifier version in new candidates shows the change; the seed SQL resets seeded weights on its next run, so change `seed-rules.mjs` for lasting changes |
| stop a source | admin console | disable the rule (`enabled = false`); re-running the seed SQL keeps it disabled |

## Contract changes and integration notes

No names in ARCHIVE_SPEC changed. Points where the collector relies on details the spec left open (all match the db
track's migration as of its commit e70c08d, checked on PGlite):

1. `archive_claim_due_rules` takes `p_rule_ids uuid[] default null` (added by the db track); editor runs use it.
2. `archive_finish_run`: counts given there **replace** what `archive_ingest` accumulated, so the collector passes only
   `fetched` and `errors` as counts and its other figures as detail keys. Of `p_rule_state` the SQL uses `etag`,
   `last_modified` (sent for RSS rules only, since the SQL overwrites them whenever the keys are present) and
   `next_run_at`; it computes failures and backoff itself with the spec formula. The collector's own
   `failure_count`/`backoff_until`/`retry_after_seconds` are informational: **a long `Retry-After` is not honoured
   by the SQL backoff** (it uses 1 h × 2^(n−1) only).
3. The link checker does not call `archive_record_project_update`: `archive_record_link_checks` opens and closes the
   `link_broken` / `image_broken` updates itself (spec §4 listed the link checker as a caller).
4. `archive_log_error` is called with `p_run_id = null` for rejected WebSub pushes (no run is started for them).
5. Dry runs and keyword loading read `archive_collection_rules` and `archive_keywords` directly with the service role.
6. The WebSub callback carries the topic (`?topic=`); `last_push_at` is set by `archive_start_run` for websub runs.
7. `keys.wikidata_qid` is `null` for web items (none of the web sources states a QID); a known project is passed as
   `keys.alias_project_id`.
8. For the db track: `archive_ingest` uses the `pg_trgm` operator `%` at run time (dedupe rule 6). On PGlite without
   the extension, items reaching that rule failed with `42883 operator does not exist: text % text` (caught per item
   as an `ingest` error); with `pg_trgm` installed (as on Supabase) the fixture batch ingested correctly
   (2 new candidates, the syndicated copy attached to the first, 4 auto-ignored).

## Verified here (fixture-tested) vs needs live verification

**Fixture-tested on the build machine** (`npm test`: `tests/archive-collector-*.test.mjs`; `deno test tests/deno/`):

- request policy: retries and backoff with a fake fetch and clock, Retry-After (seconds and date), timeout, 2 MB cap
  (declared and streamed), redirects and the SSRF guard per hop (IPv4/IPv6 and mapped forms, local names), rate
  limiter, robots.txt rules and cache, conditional GET, charset decoding (EUC-KR);
- parsing of recorded-shape answers: GDELT ArtList JSON, WordPress RSS (Dezeen), Feedburner RSS (ArchDaily, with
  `origLink` and hub), Atom (Archinect: html/text/xhtml), RSS 1.0/RDF (Japanese), NAVER news and blog JSON with
  `<b>` marks, Brave web results, Wikidata SPARQL JSON;
- the classifier on 65 realistic positive and negative cases in all 14 languages (ads, LED vendors, rentals, jobs,
  real estate, unrelated facade renovations, projection-mapping concerts, real facade projects): every case gets its
  expected label and review status (precision and recall 1.0 on this set);
- normalization, gazetteer (and its region map against the taxonomy), aliases, names, dedupe keys and clustering,
  reliability, WebSub HMAC (sha1/sha256/sha512) and verification, the §8 validator, rule state and backoff;
- the seed SQL run twice on PGlite (idempotent, keeps operator state), and against the db track's migration;
- the three Edge Functions under Deno with stubbed Supabase and sources: auth rejections, editor JWT with the
  role checked under the user's token, the full cron run's rpc sequence and payloads, dry runs writing nothing,
  WebSub GET challenge (known vs unknown topic) and POST signature ok/bad, link-check batch results.

**Needs live verification** (probe workflow, or a deployed run):

- that each seeded feed URL answers and is the feed we think (none verified; `verified_at` stays null until an
  operator checks a probe report), and which feeds advertise a hub;
- GDELT's actual answers to the seeded queries (accepted syntax, volumes, the English-translation matching per
  `sourcelang`), and its rate limiting in practice;
- NAVER API HUB keys, headers and quota in practice; Brave's billing; Wikidata change detection on real QIDs;
- the classifier's precision on real traffic (tune keywords from the first weeks of the review queue);
- WebSub with real hubs (verification reaching the callback, signed pushes), and link checks against real sites;
- the Edge Functions on Supabase (secrets, `verify_jwt = false`, the 150 s gateway limit, pg_cron calls).

## Probe run from the build machine (2026-10-19)

`npm run archive:probe` (Node 22, no keys) — every source unreachable, as expected on this machine (only the npm
registry is allowed out). Report: `release/archive-probe.json`.

- 26 rules: 0 success, 22 error, 4 skipped (`naver_keys_not_set` × 3, `brave_key_not_set`), 0 items.
- Every GDELT, RSS and Wikidata rule: `network error: fetch failed (getaddrinfo ENOTFOUND <host>)` — Node's `fetch`
  does not use the machine's HTTPS proxy, so the host names do not resolve. Through the proxy (curl) the same hosts
  answer `CONNECT tunnel failed, response 403` (api.gdeltproject.org, www.dezeen.com, query.wikidata.org,
  naverapihub.apigw.ntruss.com, api.search.brave.com).
- Live verification therefore belongs to the weekly workflow `light-architecture-archive-probe.yml` (GitHub-hosted
  runner, open network), whose artifact `archive-probe` shows per-rule counts, labels, top candidates and errors.
