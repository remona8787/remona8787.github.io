# The archive in the app (client)

This page covers the app side of the media facade archive: how published projects reach the screens, which fields the
app reads and how it checks them, and how search, filters, the map, the place page and the research page use them.
It also lists the language coverage, the contract changes the client track made, and what is still open.

The client track (v0.16, `wt/arch-client`) built this, and v0.17 merged it. It reads the Supabase path of
docs/ARCHIVE_SPEC.md §6. The static GitHub Pages dataset of docs/STATIC_ARCHIVE.md (`/data/*.json`) is specified but
has no loader in the app yet (see Open items). Everything here is tested with fixtures only:

- `tests/archive-app.test.mjs`: rows → places, the coordinate rule, media, facets, similar projects, statistics, export.
- `tests/archive-integration.test.mjs`: a row that real SQL published, mapped and searched.
- `qa/archive.spec.mjs`: the screens in a browser against a mocked view.
- `tests/i18n.test.cjs`: the language strings.

## Data flow

```
public.public_archive_projects (published, not merged; cleared, unbroken images only)
  │  GET /rest/v1/public_archive_projects?select=<ARCHIVE_COLUMNS>&order=slug.asc
  │  apikey = publishable key, no session, credentials omitted
  │  Range pages of 1000 (Prefer: count=exact), at most 5000 rows, 30 s per page
  ▼
client/archive.js ── localStorage aol_archive_v1 (fresh 6 h, kept at most 72 h after a failed refresh,
  │                  at most 1.5 M characters: saved, planned and recorded projects are kept first)
  ▼
client/archive-rows.mjs fromArchiveRows(rows, {publicURL}) → {projects, media, updatedAt}
  │  window.AOL_ARCHIVE = {projects, fetchedAt, updatedAt, status, truncated}
  │  window.AOL_ARCHIVE_MEDIA = media rows for the photo index
  ▼
site-public-cleared/app.js allPlaces(): curated catalogue + archive projects + saved candidates + Wikidata sync
  ▼
catalog.js X.search / facetCounts / similar / stats / exportCSV / exportJSON
```

- **Configured or not.** The loader runs only when `config.js` has both `SUPABASE_URL` and
  `SUPABASE_PUBLISHABLE_KEY`. Otherwise the status is `disabled`, the list is empty, and the app shows the curated
  places and the Wikidata sync as before.
- **Refresh.** On load (a cached copy is shown at once), when the tab becomes visible, every 30 minutes, and from the
  settings button ("지금 동기화"). A page restored from the back/forward cache restarts its refresh.
- **Statuses.** `disabled`, `loading`, `cached`, `ok`, `stale` (the last refresh failed, the previous list is shown)
  and `unavailable` (no list). The settings screen shows them.
- **Rendering.** The app re-renders through `AOLApp.softRender` when a list arrives, so scroll position and open
  sheets survive.

### Merging with the curated catalogue

An archive project that is the same work as a curated place enriches that place instead of being listed twice. It
matches, in this order:

1. its `curated_place_id`;
2. the same exact Wikidata QID (not a host-building QID);
3. a curated name in the same city (normalised, with bracketed parts and "A / B" variants).

The curated place keeps its own text, ids and schedule. It takes the archive values in `ARCHIVE_FILL`: type, region,
country, original name, aliases, English summary, years, operating status, building, method, envelope,
technologies, content types, display figures, interaction, spatial and urban context, credits, sources, assessments,
review and update state, collection dates and the official URL. It takes the archive's coordinates only when it has
none of its own. Opening an absorbed archive id (`AR-…`) opens the curated place.

A Wikidata-synced place is skipped when an archive project has its QID (`wikidata_qid` or `discovered_qid`), as it is
for a curated place's QID.

## Fields

### Columns read

`ARCHIVE_COLUMN_LIST` in client/archive-rows.mjs:

`slug, name_original, name_original_lang, name_en, name_ko, aliases, country_iso2, region, city, district, address,
latitude, longitude, location_precision, year_installed, year_completed, year_operating_since, year_ended,
operating_status, building_name, project_type, installation_method, envelope_type, technology, display_area_m2,
resolution_text, pixel_pitch_mm, content_type, interactive, viewing_points, spatial_context, urban_context,
summary_ko, summary_en, wikidata_qid, official_url, discovered_qid, curated_place_id, record_origin, review_status,
update_status, field_status, first_collected_at, last_collected_at, last_verified_at, created_at, updated_at,
credits, sources, media, assessments`

- **Not read:** `id`, `visibility` (the view returns published projects only), `official_url_state` and
  `official_url_checked_at`.
- **Never in the view:** editors and internal columns (`created_by`, `updated_by`, `internal_note`, `merged_into`).
- **Tested:** tests/archive-integration.test.mjs checks that every column exists in the view and that the published
  row carries no reviewer id or note.

### Row → place

| place field | from | rule |
|---|---|---|
| `place_id`, `archive_slug`, `origin` | `slug` | `AR-` + slug, `origin: 'archive'`. A slug must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$`; otherwise the row is dropped. |
| `name_kr` (display name) | `name_ko` → `name_en` → `name_original` | The first one present. A row with no name is dropped. The original name is always kept beside it. |
| `country_iso2`, `country`, `region`, `scope` | `country_iso2`, `region` | The ISO code must be in the taxonomy's region map. The region comes from the row, or is derived from the code. The country name is shown in Korean or English. `scope` is `korea` for KR, else `world`. |
| `latitude`, `longitude`, `coordinate_*`, `location_precision` | coordinates, `field_status`, `sources` | See the coordinate rule below. |
| `project_type`, `installation_method`, `envelope_type`, `operating_status`, `record_origin`, `update_status` | same | The value must be in the controlled vocabulary (archive-taxonomy.js), else `null`. |
| `technologies`, `content_types`, `spatial_context` | `technology`, `content_type`, `spatial_context` | Vocabulary values only, without duplicates. |
| `primary_category` | `project_type` | `media_facade` and `urban_screen` → Media Facade, `light_art` → Light Art, `projection_mapping` → Media Art, `festival_program` → Festival. Other types have no category; their type label is shown instead. |
| years | `year_*` | Integers 1000–2100, else `null`. |
| `display_area_m2`, `pixel_pitch_mm` | same | Positive numbers below 10⁷, else `null`. |
| `credits` | `credits` | `{role, name, name_en, qid}`; an unknown role becomes `other`; at most 40. |
| `sources` | `sources` | `{title, url, publisher, kind, language, published_at, retrieved_at, last_checked_at, link_state, reliability, license, supports}`; http(s) URLs only; at most 60. |
| `assessments` | `assessments` | `{attribute, value, confidence, method, note, created_at}`; a structured value is kept as JSON text. |
| `field_status` | `field_status` | Known states only (`field_state` vocabulary), with `source_id` and `at`. |
| `review_status` | `review_status` | A vocabulary value, else `unreviewed`. |
| `wikidata`, `source_url` | `wikidata_qid`, `sources` | `source_url` is the Wikidata item, else the first unbroken source, else the official site. |
| `website`, `official_url` | `official_url` | http(s) only. |

Text is stripped of control characters, whitespace is collapsed, and length is limited (300 characters by default).
Nothing outside a vocabulary survives, and nothing is guessed in its place.

### The coordinate rule (also the map legend)

- A project goes on the map only with coordinates at `exact` or `street` precision. A city-level point would pin it
  to the city centre. Coordinates of `(0, 0)` are rejected.
- **Verified:** when every recorded state of `latitude`/`longitude`/`coordinates` is `editor_verified` or
  `researcher_assessed`. Drawn as a pin. The source link is a source that supports the coordinates, else the official
  site, else the Wikidata item, else the record's own URL (`PUBLIC_URL/#place/AR-…`).
- **Source:** otherwise, only when an unbroken https source supports the coordinates. Drawn as a circle that names
  the source.
- **Off the map:** everything else. The project is still listed.

### Images

- The view returns only `cleared` images whose links are not broken.
- The app also requires an https URL, a licence and an author or attribution.
- It shows at most 12, the primary first.
- They join the photo index with the same fields as Commons photos (licence, creator, source page). Credits are
  always shown.

## Search, filters and sorting (catalog.js)

- **Search.** Every word must match (AND). The searchable text covers all names and aliases, credits, building,
  address, district, city and country in both languages, the Korean and English type labels, and the summaries. It
  is built once per place and only when there is a query. Relevance ranks an exact name match above a name prefix,
  then a name part, then the building, then credits.
- **Facets.** Each facet allows several values (any of them); facets combine with AND. The facets are `region`,
  `project_type`, `installation_method`, `technology`, `envelope_type`, `operating_status` and `origin`. `origin`
  has three groups:
  - curated;
  - editor-verified (an archive project an editor or researcher reviewed);
  - unreviewed (every automatic record, archive and Wikidata alike).
- **Other filters.**
  - Country (by ISO code) and city. Korean and English city names are one key, so Seoul and 서울 are the same city.
  - Year range, on the first known of installed, completed, project and programme start year.
  - "with photo", saved, free and indoor.
- **Facet counts.** Each option counts the places it would add, with every other filter applied.
- **Sorts.** `relevance`, `newest` (first collected), `updated`, `year_desc`, `year_asc`, `name` (in the UI language).
- **Project types for Wikidata places.** A Wikidata-synced place gets a derived type from its light category
  (Media Facade → `media_facade`, Light Art → `light_art`, Festival/Exhibition → `festival_program`). It is marked
  `derived` in exports.
- **UI.** On a phone the filters open as a full-screen sheet; on a desktop they are a side panel. Active filters show
  as removable chips.

## Screens

- **Explore** lists curated, archive and synced places together, with the facets and sorts above. The list grows in
  pages of 24.
- **Map** shows the explore results that pass the coordinate rule, with a legend (verified pins, Wikidata circles,
  source circles) and the rule text. The list follows the map.
- **Place page**, for an archive project or an enriched curated place:
  - the archive record: grouped fields, each with its state, and a count of unknown fields that are never filled in
    by guesswork;
  - sources: kind, reliability tier, licence, retrieval and link-check dates, supported fields, broken links marked;
  - data status: record origin, review, last collected, last verified, update state;
  - researcher assessments, apart from the collected data;
  - a citation with today's access date;
  - similar projects with the reasons (type, method, technology, envelope, region, decade). A project needs at least
    one shared property of the work; region or decade alone does not count.
- **Research data (`#data`)** works on the places the current filters select:
  - totals (all, on the map, with a photo);
  - statistics by region, top 20 countries, decade or year, type, method, technology and origin, with unknown values
    counted apart;
  - CSV and JSON export with the data dictionary, licences, a dataset citation and the methodology;
  - the methodology text.

### Export

- **Columns.** One flat record per place, with the columns of `EXPORT_FIELDS`:
  - ids and names; type and type label;
  - region, country code and name, city;
  - coordinates and their class (only coordinates that pass the map rule);
  - years, operating status, method, envelope, technologies and content types;
  - building and credits;
  - data origin, record origin, review and update status, field states;
  - collection and verification dates;
  - Wikidata item, official site, source URLs, source licences and the record URL.
- **CSV.** UTF-8 with a BOM (Excel opens it directly), CRLF line ends, every cell quoted, and formula-like cells
  defused. The first line is a `#` comment that warns that automatic values are not verified facts.
- **JSON.** `{meta, projects}`. `meta` holds the title, `generated_at`, `app_version` (read from the shell's version
  label), the count, the active filters, the warning, the licences (Wikidata CC0; Commons per file, with no images in
  the file; editorial text to be confirmed by the operator; source rights stay with each publisher) and the data
  dictionary.

## Languages

site-public-cleared/i18n.js holds every UI string as one `[Korean, English]` row (652 keys), so the two languages
cannot drift apart. tests/i18n.test.cjs checks that every key the app uses exists. The language switch is in the top
bar and in settings, and the choice is kept in the user's preferences (`preferences.language`).

- **In Korean and English:**
  - the shell and navigation; home; explore, filters and sorts; the map and its legend;
  - the place page (record, sources, data status, assessments, citation, similar projects); saved; my archive;
  - settings and the sync status; the research data page and its exports; toasts and empty states.
- **In Korean only** (a note says so in English):
  - courses (답사 코스), field notes (현장 기록), the calendar and the account screen;
  - the static pages: about, privacy, terms, support, account deletion and 404;
  - the admin console (admin/).
- **Data is not translated.** Place names and descriptions show as their source gives them (`nm()` in app.js picks
  the English name in English, else the original).
  - Curated seed districts and most curated city names have no English.
  - Cities in catalog.js's list show in both languages.
- **No language switch on a phone place page:** its photo header replaces the top bar. Use settings, or go back.

## Contract changes made by the client track

1. **Credit role `creator`.** A Wikidata-synced place gets the role `creator` (P170), next to `architect` (P84) and
   `operator` (P137). It is client-only; the archive's `credit_role` vocabulary is unchanged.
2. **P571 (inception) → `year_completed`** for Wikidata-synced places.
3. **Compact Wikidata record v2** (22 fields; the cache and the server sync) adds the inception year, country ISO code,
   architects, creators and operators. v1 records are still read.
4. **Country filter by ISO code.** The explore filter uses the ISO code; curated rows that give only a country name
   are resolved by name.
5. **Derived `project_type`** for Wikidata places, from their light category, marked `derived`.
6. **Name fallback** for archive projects: ko → en → original.
7. **Three origin groups**: curated, editor_verified, unreviewed.
8. **archive-taxonomy.js additions**: `fieldLabels`, `groupLabels`, `fieldLabel()`, `countryName()`. Its vocabulary
   keys are unchanged and still equal the SQL checks (tests/archive-sql.test.mjs).
9. **The version number lives in the shell label only.** Exports and the settings and my-archive footers read it.
   v0.17 removed the last two hard-coded copies in app.js; tests/deploy.test.mjs keeps one number everywhere.

## Open items

- **Static dataset loader.** docs/STATIC_ARCHIVE.md's production path serves `/data/manifest.json`, `index.json`,
  `home.json` and `projects/<shard>.json` from GitHub Pages. The app has no loader for them yet:
  - the home page should read only `home.json`;
  - explore and the map should load `index.json` lazily;
  - the place page should load its shard on demand.
  `connect-src 'self'` already allows these files.
- **Consumer UI rules (v0.17).** STATIC_ARCHIVE.md says public screens show no internal review or pipeline
  vocabulary. These still do:
  - the place page's data status block, the field states next to values, and the origin labels ("편집 검수",
    "자동 수집 · 미검수");
  - the explore facet `origin`;
  - the sync rows in settings.
  They move to the admin page; the export keeps its provenance columns.
- **Hero and featured images.** The per-surface image rules (only active media at night on the home hero, designed
  placeholders instead of unrelated photos) are specified in STATIC_ARCHIVE.md but not implemented.
- **Translations.** English for seed districts and cities, and a language switch on phone place pages.
