# Archive database (v0.16, db track)

The database layer of the global media facade archive defined in [ARCHIVE_SPEC.md](ARCHIVE_SPEC.md) §4 and §8.

| file | what |
|---|---|
| `supabase/migrations/20261018000000_media_facade_archive.sql` | the whole archive schema, re-runnable |
| `release/launch/complete-backend.sql` | carries the same SQL as section `-- SOURCE: migrations/20261018000000_media_facade_archive.sql` |
| `release/launch/install-six-hour-sync.sql` | cron jobs `aol-archive-collect-hourly`, `aol-archive-check-links-daily`, `aol-archive-prune-daily` |
| `tests/archive-sql.test.mjs` | PGlite tests of everything below |
| `tests/sql/supabase-stubs.sql` | one added line: usage on schema `extensions` for the API roles, as on Supabase |

**Verification status.** Everything here is PGlite-tested (Postgres 17 in WASM, with pg_trgm, Supabase's default
grants and stubbed `auth` schema). None of it has run on a live Supabase project yet; see
[What still needs a live check](#what-still-needs-a-live-check).

## Applying it

**pg_trgm is required.** Supabase ships it; the migration creates it in schema `extensions`. Dedupe rules 5 and 6 of
`archive_ingest`, `archive_search` and the suggested matches of `archive_admin_list_candidates` call it. The schema
still installs where it is missing, but only so that the release bundle can be checked on a bare Postgres. In that
case the trigram indexes are skipped, the install raises a warning, and those calls fail with `42883`
(`undefined_function`). `archive_ingest` logs that error per item (stage `ingest`) and counts the item as ignored.

Order on a new project:

1. `release/launch/complete-backend.sql`, which includes the archive section. Alternatively, apply the legacy SQL
   01..18, `20261010160920`, `20261013000000` and then this migration.
2. `release/launch/archive-seed.sql`, which the collector track generates from `seed-rules.mjs`. It contains idempotent
   upserts of `archive_collection_rules` keyed by (kind, name) and of `archive_keywords` keyed by (term, language). The
   migration creates no rules or keywords, only the settings row.
3. Deploy the Edge Functions (`archive-collect`, `archive-websub`, `archive-check-links`) with `MEDIA_CRON_SECRET`.
4. `release/launch/install-six-hour-sync.sql`. It refuses to run if the archive tables are missing.

On an existing project (legacy SQL, `20261010160920` and `20261013000000` already applied), run the migration in the
SQL Editor, or run `complete-backend.sql` again (it is idempotent). Then do steps 2 to 4.

In `complete-backend.sql` the archive section sits **before** the `discovered_places` section, not at the end. The
bundle is still one transaction, and the two sections are independent: `archive_projects.discovered_qid` is a plain
QID, not a foreign key. The reason for the placement is that `tests/sql.test.mjs` asserts that the discovered_places
body is immediately followed by the bundle's final `commit;`. A later section can go in the same place.

### Roles

```sql
-- admin: everything, including rules, keywords and settings
insert into public.app_admins(user_id, role) select id, 'admin' from auth.users where email = 'OPERATOR@example.com'
on conflict (user_id) do update set role = excluded.role;
-- editor: review queue, projects, sources, media, updates (also the legacy admin console: is_app_admin() is true)
insert into public.app_admins(user_id, role) values ('<auth user uuid>', 'editor') on conflict (user_id) do update set role = excluded.role;
-- researcher: assessments only (is_app_admin() is false)
insert into public.app_admins(user_id, role) values ('<auth user uuid>', 'researcher') on conflict (user_id) do update set role = excluded.role;
```

`app_admins.role` is checked as `admin | editor | researcher` (default `editor`). The v0.10 setup docs, including
`LAUNCH.md`, insert `'owner'`. A trigger maps `owner` to `admin`, so that snippet keeps working, and the migration
converted existing `owner` rows. Any other legacy value became `editor`, which keeps the console access it had.
`is_app_admin()` is now true for admin and editor only. `archive_role()` returns the role, or null for everyone else.

## Tables (ER overview)

```
app_admins (role) ─┐ archive_role()
                   │
archive_projects ──┬─< archive_credits >── archive_sources (source_id, optional)
  │ merged_into ↺  ├─< archive_project_sources >── archive_sources
  │                ├─< archive_media >── archive_sources (source_id, optional)
  │                ├─< archive_assessments (assessor → auth.users)
  │                ├─< archive_project_updates (one open row per project and kind)
  │                └─< archive_candidate_hits (project_id: hits matched to a known project)
  │
archive_candidates ─< archive_candidate_hits >── archive_collection_rules ─< archive_runs ─< archive_run_errors
  │ matched_project_id → archive_projects                                  └─< archive_websub_subscriptions (rule_id)
  │ duplicate_of ↺
archive_keywords   archive_audit_log   archive_settings (one row)
```

All columns of ARCHIVE_SPEC §4 exist with those names. Additions are listed under [Contract changes](#contract-changes).
Each hit belongs either to a candidate or to a project (`num_nonnulls(candidate_id, project_id) = 1`), and
(provider, canonical_url) is unique.

**Vocabularies** are `text` columns with check constraints whose lists equal the keys of
`site-public-cleared/archive-taxonomy.js`; the test reads both and compares them. The same goes for
`archive_region_of(iso2)` against `regionOf`. These vocabularies exist only in the spec, not in the taxonomy:
`location_precision` (exact, street, city, unknown), media `rights_status` (pending, cleared, blocked), update `kind`
and `status`, keyword `polarity`, run `trigger` and `status`, WebSub `state`, assessment `confidence`.

**field_status** maps a field name to `{state, source_id?, at?}`, and a missing key means unverified. The keys come
from `archive_project_fields()`, which lists the content columns plus `credits`. Who sets which state:

| state | set by |
|---|---|
| `editor_verified` | a field the editor submitted, with a value, in `archive_admin_upsert_project` or `approve_new` |
| `source_reported` | values passed as `reported` (with `reported_source_id`), Wikidata statements of an approved Wikidata candidate, and a field with a value that a source added by `archive_admin_add_source` supports while still unverified or derived |
| `derived` | `region` (always from the country when the taxonomy map knows it), and `name_original` when it was copied from `name_en` or `name_ko` |
| `researcher_assessed` | `archive_research_add_assessment` on an attribute that is a project field (the value stays in the assessment and never overwrites the field) |
| (no entry) | a field never given, or submitted as `null` or `""` (cleared) |

`review_status` becomes `editor_verified` through `approve_new` or `"reviewed": true`; each editor review also stamps
`last_verified_at`. Any assessment makes it `researcher_assessed`. **Publishing requires `last_verified_at`**, so a
researcher assessment alone never makes a project publishable.

## Access matrix

Every archive table has RLS on, no policy, and no privilege for `anon` or `authenticated`. `service_role` has table
privileges. The migration re-revokes on every run against Supabase's default grants.

| object | anon | authenticated (no role) | researcher | editor | admin | service_role |
|---|---|---|---|---|---|---|
| `archive_*` tables | – | – | – | – | – | all |
| view `public_archive_projects` | read | read | read | read | read | read |
| `archive_search`, `archive_public_stats` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `archive_role`, `is_app_admin` | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| admin RPCs marked editor+ | – | 42501 | 42501 | ✓ | ✓ | – |
| `archive_admin_upsert_rule`, `_upsert_keyword`, `_set_settings` | – | 42501 | 42501 | 42501 | ✓ | – |
| `archive_research_add_assessment` | – | 42501 | ✓ | ✓ | ✓ | – |
| service RPCs | – | – | – | – | – | ✓ |

In the matrix, `–` means EXECUTE or SELECT is revoked ("permission denied"), and `42501` means the function runs but
raises `insufficient_privilege` ("archive role required: …"). The admin RPCs are `security definer`; they check
`archive_role()` first and write `archive_audit_log` (actor, action, entity, entity_id, before, after) on every change.
The two public functions are `security definer` too, but read only the published view. The service functions are
`security invoker`, so they rely on service_role's own table privileges. Every function sets `search_path`:
`public, pg_temp`, or `public, extensions, pg_temp` where pg_trgm is used. The pure helpers use `''`. Internal helpers
are executable only by the owner and service_role (check constraints and indexes call some of them), never by clients.

The WebSub `secret` column is in no view, and only `archive_websub_get` (service_role) returns it. The public view has
no `created_by`, `updated_by`, `internal_note`, `merged_into`, review notes, reviewer or assessor ids.

## RPC reference

Exact signatures, read from the installed database. `p_*` parameters with defaults can be omitted through PostgREST.
Errors use SQLSTATE `22023` for bad input, `42501` for a missing role, and check-constraint errors (`23514`) for values
outside a vocabulary or range.

### Public (anon)

`public_archive_projects` (view): published projects that were not merged away. Columns are every project column
except `created_by`, `updated_by`, `internal_note`, `merged_into` and `official_url_failures`, plus four arrays:

- `credits`: `[{role, name, name_en, wikidata_qid}]`
- `sources`: `[{id, title, url, publisher, kind, language, published_at, retrieved_at, last_checked_at, link_state,
  reliability, license, supports}]`. `reliability` is shown 30 lower while the link is broken.
- `media`: `[{url, page_url, license, license_url, author, attribution, is_primary}]`, only rows that are
  `rights_status = 'cleared'` and not `link_state = 'broken'`.
- `assessments`: `[{attribute, value, confidence, method, note, created_at}]`, with no assessor.

```
archive_search(p_q text DEFAULT NULL, p_filters jsonb DEFAULT '{}', p_sort text DEFAULT 'relevance',
               p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) → SETOF public_archive_projects
```

- **Filters.** Each filter is a string or an array of strings: `region`, `country_iso2`, `city` (case-insensitive),
  `project_type`, `installation_method`, `envelope_type`, `technology` (matches any), `operating_status`, `origin` (=
  `record_origin`), `review_status`, `year_from`, `year_to`. The year is the first known of `year_installed`,
  `year_completed` and `year_operating_since`. Empty values and unknown keys are ignored.
- **`p_q`.** Matches names and aliases (substring or trigram word similarity), city or building.
- **Sort.** `relevance` | `newest` (`first_collected_at`, else `created_at`) | `updated` | `year_desc` | `year_asc` |
  `name`. Any other value raises 22023. Relevance with a query puts an exact name first, then orders by similarity;
  without a query it orders researcher-assessed, then editor-verified, then the rest, newest update first.
- **Limits.** `p_limit` is clamped to 1–200 and `p_offset` to 0–100000.

```
archive_public_stats() → jsonb
```

Returns `{total, by_region, by_country, by_year, by_project_type, by_installation_method, by_technology,
by_review_status, settings: {auto_list_structured}, generated_at}`, computed over the published set. A missing value
counts under `"unknown"`.

### Admin (authenticated; editor+ unless noted)

```
archive_role() → text
archive_admin_dashboard() → jsonb
archive_admin_list_candidates(p_status text DEFAULT NULL, p_q text DEFAULT NULL, p_min_conf integer DEFAULT NULL,
                              p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) → SETOF jsonb
archive_admin_review_candidate(p_id uuid, p_action text, p_payload jsonb DEFAULT '{}') → jsonb
archive_admin_upsert_project(p_project jsonb) → uuid
archive_admin_set_visibility(p_project_id uuid, p_visibility text, p_note text DEFAULT NULL) → jsonb
archive_admin_merge_projects(p_keep uuid, p_drop uuid) → uuid
archive_admin_add_source(p_project_id uuid, p_source jsonb, p_supports text[] DEFAULT '{}') → uuid
archive_admin_set_media(p_project_id uuid, p_media jsonb) → uuid
archive_admin_remove_media(p_media_id uuid) → boolean
archive_admin_list_projects(p_q text DEFAULT NULL, p_visibility text DEFAULT NULL, p_limit integer DEFAULT 50,
                            p_offset integer DEFAULT 0) → SETOF jsonb
archive_admin_list_updates(p_status text DEFAULT 'open', p_limit integer DEFAULT 50) → SETOF jsonb
archive_admin_resolve_update(p_id uuid, p_action text) → jsonb
archive_admin_list_runs(p_limit integer DEFAULT 50, p_rule_id uuid DEFAULT NULL) → SETOF jsonb
archive_admin_list_errors(p_limit integer DEFAULT 100) → SETOF jsonb
archive_admin_list_rules() → SETOF jsonb
archive_admin_upsert_rule(p_rule jsonb) → uuid                                    -- admin
archive_admin_list_keywords() → SETOF jsonb
archive_admin_upsert_keyword(p_kw jsonb) → uuid                                   -- admin
archive_admin_set_settings(p_settings jsonb) → jsonb                              -- admin
archive_research_add_assessment(p_project_id uuid, p_attribute text, p_value jsonb, p_confidence text,
                                p_method text DEFAULT NULL, p_note text DEFAULT NULL) → uuid   -- researcher, editor, admin
```

#### `dashboard`

Returns:

```
{queue: {<status>: n}, runs_24h, runs_7d: {total, running, success, partial, error, skipped, new_candidates,
 matched_projects}, errors_24h, errors_7d, rules: {total, enabled, failing, backing_off, unverified},
 rules_by_status, sources_by_link_state, projects_by_visibility, projects_by_review, open_updates: {<kind>: n},
 broken_links: {sources, media, official_urls}, websub: {<state>: n}, settings, generated_at}
```

#### `list_candidates`

- `p_status` is a candidate status, `'open'` (the default: needs_review and uncertain), or `'all'`.
- Each row is the candidate's columns plus `total_seen`, `hits` and `suggested_matches`. `hits` includes the hits of
  candidates merged into it and leaves out `raw`. `suggested_matches` holds up to three
  `{project_id, slug, name, name_original, country_iso2, city, visibility, similarity, reason: wikidata_qid|name}`
  with similarity ≥ 0.3.
- Rows are ordered by confidence, then most recently seen.

#### `review_candidate`

Returns `{ok, action, candidate_id, status, project_id, duplicate_of}`. Every action except `reopen` needs an open or
auto-ignored candidate; a decided one must be reopened first.

| action | payload | result |
|---|---|---|
| `approve_new` | project fields as for upsert, plus `publish` (bool), `reported` ({field: value}), `supports` (field names the hits support), `credits`, `note` | Needs a name (`name_original`, `name_en` or `name_ko`), a country and at least one hit. Creates an editor-reviewed project with `record_origin = 'auto_collected'` and the hits as sources. For a Wikidata candidate, its QID, name, country, city and coordinates that the editor did not restate are stored as `source_reported`. A news item's gazetteer location is never carried over. The candidate becomes `approved` with `matched_project_id` set. |
| `attach` | `project_id`, `supports?`, `note?` | The hits become sources of that project, and the candidate becomes `merged` with `matched_project_id` set. |
| `merge` | `into_candidate_id` (an open candidate), `note?` | The candidate becomes `duplicate` with `duplicate_of` set. Its hits stay where they are, and the target lists them. |
| `reject` | `note` (required) | `rejected`; never pruned. |
| `ignore` | `note?` | `auto_ignored` with `reviewed_by` set. A later hit never reopens it, and it is pruned after 30 days. |
| `reopen` | — | Back to `needs_review` (score at or above `review_threshold`) or `uncertain`. Clears `duplicate_of`, `matched_project_id` and the review fields; projects and sources it created stay. |

#### `upsert_project`

`p_project` with no `id` creates a project (`editor_created`, or `curated` when `record_origin: 'curated'`);
otherwise it updates one. Only the keys present are written:

- **Content fields.** Each key from `archive_project_fields()` that has a value becomes `editor_verified`. `null` or
  `""` clears the field and its state. `credits: [{role, name, name_en?, wikidata_qid?}]` replaces the credits.
- **Meta keys.**
  - `slug`, `visibility` and `internal_note`.
  - `reviewed: true`, which records an editor review.
  - `reported` with `reported_source_id`, whose values are stored as `source_reported`.
- **Read-only keys.** The keys `archive_admin_list_projects` returns (`field_status`, `sources`, `created_at`, …) are
  accepted and ignored, so a row can be sent back as it is. Any other key raises 22023.

Clients should send only the fields the editor checked: every key present counts as verified.

Validation:

- Vocabularies, years 1900–2100, latitude and longitude in range and given together, and text lengths.
- `http(s)` URLs only.
- The country is upper-cased and must be ISO alpha-2, and the region is derived from it.
- `published` needs an editor review, and a merged project cannot be published.

#### Other admin calls

- **`set_visibility`** returns `{id, visibility, previous}`. `published` needs `last_verified_at`. The note goes to
  the audit log only.
- **`merge_projects(keep, drop)`** moves sources (supports merged), credits (deduplicated), media (the primary flag
  kept only if keep has none), assessments, hits, candidate links and open updates (merged into keep's). Drop's names
  become aliases of keep, and keep takes a QID or curated id it lacks. Drop becomes `hidden` with `merged_into = keep`.
  Ingest and every admin RPC follow `merged_into`. It returns `p_keep`.
- **`add_source`**: `p_source` is `{url, canonical_url?, title?, publisher?, source_kind | kind, language?,
  published_at?, license?, excerpt?, reliability?}`. The source is upserted by `canonical_url`, and reliability
  defaults to the base score of its kind (§3). `p_supports` are field names; see field_status above. It returns the
  source id.
- **`set_media`**: `p_media` is `{id?, url, page_url?, commons_file?, license?, license_url?, author?, attribution?,
  rights_status?, is_primary?, source_id?}`, matched by id, else by (project, url). A changed URL resets its link
  state. `cleared` needs a licence and an author or attribution. Setting `is_primary` unsets the others.
- **`list_projects`** returns project rows with `credits`, `sources` (with ids, supports and link state), `media` (all
  of them), `assessments` (with assessor), `open_updates` and `candidates`. With `p_visibility` null it lists every
  project except those merged away; `'hidden'` includes them. `p_q` matches the id, the slug, names, city or building.
- **`list_updates`**: `p_status` is `open`, `applied`, `dismissed` or `all`. Rows add `project_name`, `project_slug`
  and `project_visibility`. A `new_source` row's `detail` is `{hits: [{hit_id, provider, url, canonical_url, title,
  publisher, published_at, score}], count}`, keeping the latest 100 hits.
- **`resolve_update(p_id, 'apply' | 'dismiss')`** returns `{id, project_id, status}`. `apply` on `new_source` adds the
  listed hits as sources. Afterwards `update_status` is recomputed: an open `link_broken` gives `link_broken`; else an
  open `new_source`, `changed_field` or `wikidata_changed` gives `new_info`; else `current`.
- **`list_runs` and `list_errors`** add `rule_name` and `rule_kind`.
- **`list_rules`** adds `websub: {topic, hub, state, lease_expires_at, last_push_at}`, never the secret.
- **`upsert_rule`**: `{id?, kind, name, query?, url?, language?, region_hint?, enabled?, cadence_hours?, terms_url?,
  verified? (true stamps verified_at), notes?, next_run_at?}`.
  - Without an id, (kind, name) is the key.
  - `rss` and `websub` rules need `url`; `gdelt`, `naver_*` and `brave` rules need `query`.
  - A new `naver_*` or `brave` rule starts disabled unless `enabled` is given (costs are opt-in).
  - Changing the url or query, or re-enabling a rule, clears its failures, backoff and validators.
- **`upsert_keyword`**: `{id?, term, language, polarity, weight?, enabled?}`, keyed by (term, language). `language`
  is required.
- **`set_settings`**: any of `auto_list_structured`, `auto_ignore_below`, `review_threshold`, where
  `auto_ignore_below` may not exceed `review_threshold`. It returns the settings.

### Service (service_role only; the Edge Functions)

```
archive_claim_due_rules(p_limit integer, p_owner text, p_rule_ids uuid[] DEFAULT NULL) → SETOF archive_collection_rules
archive_start_run(p_rule_id uuid, p_trigger text) → uuid
archive_ingest(p_run_id uuid, p_items jsonb) → jsonb
archive_finish_run(p_run_id uuid, p_status text, p_counts jsonb DEFAULT '{}', p_rule_state jsonb DEFAULT '{}') → jsonb
archive_log_error(p_run_id uuid, p_rule_id uuid, p_stage text, p_http integer, p_message text, p_url text) → void
archive_links_due(p_limit integer) → SETOF jsonb
archive_record_link_checks(p_results jsonb) → jsonb
archive_alias_index() → SETOF jsonb
archive_websub_upsert(p_topic text, p_hub text, p_secret text, p_state text, p_lease_seconds integer, p_rule_id uuid) → uuid
archive_websub_get(p_topic text) → jsonb
archive_websub_due(p_within_hours integer) → SETOF jsonb
archive_record_project_update(p_project_id uuid, p_kind text, p_detail jsonb) → uuid
archive_prune() → jsonb
```

#### `claim_due_rules`

- **Due** means enabled, `next_run_at` null or past, `backoff_until` null or past, and not `running` with a claim
  younger than 30 minutes. An older claim counts as abandoned.
- **`kind = 'websub'` is never claimed**, because those rules are push-driven.
- **Claiming** sets `last_status = 'running'`, `claimed_by` and `claimed_at`. Rows locked by a concurrent claim are
  skipped, so two callers never get the same rule.
- **`p_rule_ids`** ("지금 실행") claims those rules if they are enabled, regardless of schedule and backoff.
- **`p_limit`** is clamped to 1–50 and defaults to 6.

#### `start_run`

Takes a trigger of `cron | admin | websub | probe`. It sets `attempt` to the rule's failures + 1. A `websub` run stamps
`last_push_at` on that rule's subscription. It returns the run id.

#### `ingest`

See [Ingest](#ingest-archive_ingest).

#### `finish_run`

- **Input.** The status is `success | partial | error | skipped`. `p_counts` is
  `{fetched, kept, new_candidates, matched_projects, duplicates, ignored, errors, …}`. A count that is given replaces
  what ingest accumulated (`errors` takes the larger value), and other keys go to `detail`.
- **Scheduling.** For success, partial and skipped: failures are reset, `backoff_until` is null, and `next_run_at` is
  now + `cadence_hours`, or `p_rule_state.next_run_at` limited to now..now+30 days. `etag` and `last_modified` are set
  when present in `p_rule_state`, so an absent key keeps the stored validator.
- **Backoff.** On `error`: `failure_count + 1`, and `backoff_until = next_run_at = now + min(48 h, 1 h × 2^(failures −
  1))`, which gives 1, 2, 4, 8, 16, 32, 48, 48 h.
- **Runs that skip scheduling.** `websub` and `probe` runs leave the schedule alone.
- **Idempotent.** A second call returns `{already_finished: true}` and changes nothing.
- **Returns** `{run_id, status, rule: {id, failure_count, backoff_until, next_run_at}}`.

#### `log_error`

Never fails on bad arguments: unknown run or rule ids become null, the stage is cut to 40 characters and the message to
1000, and an HTTP status outside 100–599 becomes null. It increments the run's `errors`.

#### `links_due` and `record_link_checks`

`links_due` returns the oldest-checked URLs not checked in the last 20 hours, never-checked first:

```
{target: 'source'|'media'|'project', id, url, html, link_state, consecutive_failures, last_checked_at}
```

`html` is true for sources and official URLs, which are HTML pages where robots.txt applies, and false for images.
Blocked media and merged projects are skipped. `p_limit` is clamped to 0–5000.

`record_link_checks` takes `[{target, id, url, state: ok|redirect|broken|robots_disallowed|blocked, http_status?}]`
and returns `{updated, broken, recovered}`.

- **States.** `broken` means this check failed. Three consecutive failures set `link_state = broken`. `ok` or
  `redirect` resets the count. `robots_disallowed` and `blocked` (the SSRF guard) are recorded but are not failures.
- **Stale results.** A result whose `url` differs from the current one is ignored.
- **Newly broken.** An image opens an `image_broken` update and disappears from the view. An official URL sets
  `official_url_state = broken` and opens a `link_broken` update, which makes the project's
  `update_status = link_broken`.
- **Recovered.** The open update is dismissed (`detail.auto_resolved = 'recovered'`) and the status recomputed.

#### `alias_index`

Returns `{project_id, slug, names: [name_original, name_en, name_ko, ...aliases], wikidata_qid, country_iso2, city}`
for every project not merged away.

#### WebSub calls

- **`websub_upsert`** works by topic. A null hub, secret or rule keeps the stored one; a new topic needs a hub and a
  16–200 character secret. `p_lease_seconds` sets `lease_expires_at` from now, at most one year.
- **`websub_get`** returns `{topic, hub, secret, state, lease_expires_at, rule_id}`, or null.
- **`websub_due`** returns `{id, topic, hub, state, lease_expires_at, rule_id, reason}` for active subscriptions whose
  lease ends within `p_within_hours` or is unknown (reason `expiring` or `expired`), failed and expired ones, and
  pending ones unverified for an hour (`unverified`). It never includes the secret. At most 200 rows.

#### `record_project_update`

Used for Wikidata change detection and the link checker. It reuses the project's open row of the same kind: `hits`
arrays are appended, other keys replaced, and `count` incremented. It follows `merged_into` and returns the update id.

#### `prune`

Deletes `auto_ignored` candidates unseen for 30 days (with their hits), runs older than 180 days (with their errors)
and errors older than 180 days. It never deletes a project or an approved, merged, rejected or duplicate candidate.
Returns `{candidates, runs, errors}`.

## Ingest (`archive_ingest`)

The item contract is §8.

### Validation

Every item is checked. An invalid one is skipped, counted in `ignored`, and logged to `archive_run_errors` with stage
`validate` and a message such as `invalid item: excerpt (at most 300 characters)`. The checks are:

- provider and `source_kind` from the vocabularies;
- `rule_id` must be an existing rule;
- `url` and `canonical_url` must be `http(s)` and at most 2000 characters;
- `title` 1–500 characters, `excerpt` at most 300, `publisher` at most 200;
- `language` must be a BCP-47 or ISO 639-1 tag, so a language name such as `English` is invalid;
- `published_at` must be a timestamp, and `reliability` and `score` must be within 0–100;
- `label` from the vocabulary, at most 20 string reasons, and a `version`;
- `detected` must be an object, with an ISO2 country and latitude and longitude in range and given together;
- `keys.story_key` is required, and the QID and alias id must be well formed;
- `raw` must be an object of at most 6 kB in Postgres's text form, which is the contract's 4 kB of compact JSON.

At most 2000 items per call. An unexpected error on one item is logged with stage `ingest` (SQLSTATE and message), and
that item counts as ignored; the rest of the batch still goes in.

### Processing

For each valid item:

0. **Same (provider, canonical_url) as an existing hit.** Only the sighting is counted (`last_seen_at`, `seen_count`
   of its candidate). The outcome is `duplicate_hit`.
1. **Same `keys.wikidata_qid`** as a project, otherwise as a candidate (open ones first).
2. **Same canonical URL** as a project's official URL (compared without scheme, `www.`, trailing slash, fragment or
   `utm_*`/`fbclid`/`gclid`), as a source linked to a project, or as any other hit. The outcome is `duplicate_hit`,
   because this is the same document and not new information.
3. **`keys.alias_project_id`** names a project. The collector finds it in `archive_alias_index()`.
4. **Same normalized name, country and city.** The name is `archive_norm_name`: NFKC, lower case, no spaces or
   punctuation, applied to both sides. The city is compared case-insensitively. Matches a project's names or aliases,
   otherwise an open candidate.
5. **Coordinates within 200 m and name trigram similarity ≥ 0.45**, against projects, otherwise open candidates.
6. **Story clustering** against an open (needs_review or uncertain) candidate. Either it has the same `story_key` and
   was seen within 14 days, or one of its hits fetched within 14 days has a title whose pg_trgm similarity is ≥ 0.6.

The first rule that hits wins. Items with a score below `auto_ignore_below` skip rules 3–6, so noise is never attached
to a project. A matched candidate that is `duplicate` resolves to its target. An `approved` or `merged` one resolves to
its project, and a merged project resolves to the project it was merged into.

### Outcomes

| outcome | when | counted in |
|---|---|---|
| `matched_project` | rules 1, 3, 4, 5 hit a project | `matched_projects` |
| `duplicate_hit` | rule 0 or rule 2 | `duplicates` |
| `attached_candidate` | rules 1, 4, 5, 6 hit a candidate | `duplicates` |
| `new_candidate` | no match, status `needs_review` (score ≥ `review_threshold`) or `uncertain` | `new_candidates` |
| `ignored` | invalid item (no candidate_id), or a new `auto_ignored` candidate (with candidate_id) | `ignored` |

`kept` counts all valid items. The return value is

```
{kept, new_candidates, matched_projects, duplicates, ignored,
 items: [{canonical_url, outcome, candidate_id?, project_id?}]}
```

The counts are also added to the run's counters.

### Side effects

- **A project match** stores the hit with `project_id`. It appends the hit to the project's single open `new_source`
  update, sets `last_collected_at`, and turns `update_status` from `current` to `new_info`.
- **A candidate match** adds the hit. The best-scored hit supplies the label, reasons and classifier version, and the
  score is the maximum. Empty detected fields are filled. The status rises (auto_ignored < uncertain < needs_review)
  unless an editor has decided it.
- **Confidence** is `round(0.6 × score + 0.4 × min(100, best reliability + min(20, 10 × (independent domains −
  1))))`. The domains of merged duplicates count too.
- **Concurrency.** A transaction advisory lock on the canonical URL keeps a cron run and a WebSub push from inserting
  the same URL twice.

## Operations

- **Cron** (`install-six-hour-sync.sql`, through pg_net with the Vault secrets `project_url`, `publishable_key` and
  `media_cron_secret`):
  - `aol-archive-collect-hourly` at `17 * * * *` posts `{"max_rules": 6}` to `functions/v1/archive-collect`.
  - `aol-archive-check-links-daily` at `20 18 * * *` (03:20 KST) posts `{}` to `functions/v1/archive-check-links`.
  - `aol-archive-prune-daily` at `47 19 * * *` runs `select public.archive_prune();`.

  `cron.schedule` by name replaces a job of the same name, as the existing jobs rely on.
- **Watching collection:**

  ```sql
  select r.started_at, k.name, r.status, r.fetched, r.new_candidates, r.matched_projects, r.errors
  from archive_runs r left join archive_collection_rules k on k.id = r.rule_id
  order by r.started_at desc limit 20;
  ```

  Then check `archive_run_errors` and `archive_admin_dashboard()`.
- **A failing feed** backs off (`failure_count`, `backoff_until`) and shows under `rules.failing` and
  `rules.backing_off`. It is never dropped. Fixing its url or re-enabling it clears the backoff.
- **Thresholds** live in `archive_settings` (`auto_ignore_below` 35, `review_threshold` 60) and are changed with
  `archive_admin_set_settings`. Ingest reads them on every call.
- **`auto_list_structured`** (default true) is stored and published as `archive_public_stats().settings`. The v0.15
  view `public_discovered_places` does not read it yet; see Contract changes.

## What still needs a live check

PGlite-tested: everything in `tests/archive-sql.test.mjs`, which has 24 tests. It applies the migration twice under
Supabase default grants, over the legacy SQL and `complete-backend.sql`, and without pg_trgm. It checks the vocabulary
and region equality with the taxonomy, the privilege and role matrix for every admin RPC, every dedupe rule, the
review actions, the view, search and stats, claims and backoff, link checks, WebSub and pruning. `tests/sql.test.mjs`
checks that the bundle with the archive section still passes.

Not verified, because no live Supabase is reachable from the build machine:

- `create extension pg_trgm with schema extensions` on a project where pg_trgm was earlier enabled in another schema.
  The functions find it through `public, extensions`, and the index DDL looks the schema up, but other schemas were not
  tried.
- Supabase's real default privileges and the `postgres` owner (the stubs approximate them).
- pg_cron and pg_net, so the three jobs have only been checked textually.
- PostgREST's handling of the `SETOF jsonb` and `SETOF public_archive_projects` RPCs and of the defaults.
- Advisory locks and `skip locked` under real concurrency. PGlite runs one connection, so concurrent claims are
  serialized in the test.
- Supabase Security Advisor output. `public_archive_projects` is a deliberate owner-rights view, like
  `public_discovered_places`.

## Contract changes

All are additive or fill gaps in ARCHIVE_SPEC §4; no fixed name changed.

1. **`archive_claim_due_rules`** gains a third, optional parameter `p_rule_ids uuid[] DEFAULT NULL`, so that
   "지금 실행" can claim a specific rule outside its schedule. Calls with `(p_limit, p_owner)` are unchanged. Rules of
   kind `websub` are never claimed.
2. **Return types the spec leaves open:** `archive_admin_set_visibility` → jsonb, `archive_admin_remove_media` →
   boolean, `archive_admin_resolve_update` → jsonb, `archive_admin_list_keywords` → setof jsonb,
   `archive_admin_upsert_keyword` → uuid, `archive_admin_set_settings` → jsonb, `archive_finish_run` → jsonb,
   `archive_log_error` → void, `archive_record_link_checks` → jsonb, `archive_prune` → jsonb.
3. **Statuses after review actions:** `attach` → `merged` (with `matched_project_id`); `merge` → `duplicate` (with
   `duplicate_of`; the hits stay, so `reopen` is lossless); `ignore` → `auto_ignored`. Ingest never creates
   `duplicate` candidates; duplicate articles attach to the existing candidate.
4. **Dedupe rule 6** uses pg_trgm similarity ≥ 0.6 of hit titles (per the db task), not token Jaccard as §3 says, plus
   an exact `story_key` match. Both are limited to open candidates seen within 14 days. Rules 3–6 are skipped below
   `auto_ignore_below`. Rule 2 yields `duplicate_hit`, not a project update.
5. **Added columns.**
   - `archive_projects`: `official_url_state`, `official_url_failures`, `official_url_checked_at` (link checks of
     `official_url`), `internal_note`, `merged_into`.
   - `archive_candidates`: `normalized_name`, `wikidata_qid` (rules 4 and 1).
   - `archive_candidate_hits`: `project_id` (hits matched to a project; idempotency), `language`, `source_kind`,
     `reliability`, `score`, `label`.
   - `archive_media`: `consecutive_failures`, `http_status`, `created_at`, `updated_at`.
   - `archive_collection_rules`: `claimed_by`, `claimed_at`, `created_at`, `updated_at`.
   - `archive_runs`: `detail`.
   - `archive_project_updates`: `updated_at`.
   - `archive_websub_subscriptions`: `id`, `rule_id`, `created_at`, `updated_at`.
   - `archive_credits`: `id`, `created_at`.
   - `archive_keywords`: `id`, `created_at`, `updated_at`.
   - `archive_project_sources`: `added_by`.
   - `archive_settings`: `id` (always true), `updated_at`, `updated_by`.
6. **Public output.**
   - The view's `sources` entries carry `id`, so a `field_status[...].source_id` can be resolved.
   - The view adds `official_url_state` and `official_url_checked_at`, and omits `merged_into` and
     `official_url_failures` with the other internal columns.
   - `archive_public_stats` adds `total` and `settings.auto_list_structured`.
7. **search_path.** Functions that use pg_trgm set `search_path = public, extensions, pg_temp`; the others use
   `public, pg_temp`. `archive_search` is `security definer`, reading only the published view, so clients need no
   rights on the helper functions.
8. **`app_admins.role`.** `'owner'` (v0.10 docs) is mapped to `admin` by a trigger. Other legacy values became
   `editor`.
9. **`archive_keywords.language` is NOT NULL**, so that `on conflict (term, language)` works for the seed upserts.
10. **`complete-backend.sql` placement.** The archive section is placed before the `discovered_places` section
    instead of at the very end; see Applying it.
11. **`auto_list_structured` is not enforced in the database yet.** Enforcing it means redefining
    `public_discovered_places` (owned by the v0.15 migration), which would have to come after the discovered section
    in the bundle. For the integration step, either add `and (select s.auto_list_structured from
    public.archive_settings s where s.id)` to that view's `where`, or let the client hide those places when
    `archive_public_stats().settings.auto_list_structured` is false.
12. **`publish` requires `last_verified_at`** (an editor review), not `review_status <> 'unreviewed'`, so a researcher
    assessment alone never makes a project publishable.
