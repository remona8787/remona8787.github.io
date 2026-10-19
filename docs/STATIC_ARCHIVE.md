# Static archive pipeline and dataset (v0.17)

The operator has no Supabase project connected, but does have a public GitHub repository,
`remona8787/remona8787.github.io`, that serves https://remona8787.github.io/ through GitHub Pages and runs GitHub
Actions with full internet access. That repository is the production backend:

- Scheduled jobs collect, normalise, deduplicate and verify the data.
- Git stores the results.
- Pages serves them as static, sharded JSON.

The Supabase path (docs/ARCHIVE_SPEC.md) stays supported as an optional backend for login, sync and the live review console.

## Repository layout (remona8787/remona8787.github.io)

| branch | content |
|---|---|
| `main` | The built site served by Pages (`dist/` contents plus `data/`), plus `.github/workflows/` and `README.md`. Written only by the deploy job. |
| `source` | The `light-architecture/` project at the branch root (no `light-architecture/` prefix), plus `editorial/`. Humans and Claude push here. |
| `data` | Pipeline output. It holds `site-data/` (published), `admin-data/` (published under `data/admin/`), `review/` (contact sheets and logs, not published) and `state/` (caches, ETags, failure counters). Written only by the collect job. |

Workflows live on `main`, because scheduled workflows must be on the default branch.

- **`archive.yml`**
  - Triggers: `schedule` every 6 h (`17 */6 * * *`), `workflow_dispatch`, and `push` to `source`.
  - Job `collect`: skipped on push unless the commit message contains `[collect]`. It checks out `source` and `data`, runs `npm ci` and `node pipeline/run.mjs`, then commits to `data`.
  - Job `deploy`: always runs after `collect` (or alone). It builds `source` with `SITE_URL=https://remona8787.github.io`, copies `data/site-data` to `dist/data` and `data/admin-data` to `dist/data/admin`, keeps `.github` and `README.md`, commits to `main` and pushes. A GITHUB_TOKEN push to the Pages branch triggers the Pages build.
  - Job `verify-live`: waits until https://remona8787.github.io/data/manifest.json reports the deployed `build_id`. It then runs Playwright against the live URL at 390×844 and 1440×900, writes screenshots, console errors and timings to `review/live/`, and commits them to `data`.
- Concurrency group `archive`, so only one run at a time and never two pushers.

Pushes made with GITHUB_TOKEN do not start other workflows. That is why collect, deploy and verify are jobs of one workflow.

## Pipeline (`pipeline/`, Node 22; its own package.json may use npm deps such as `sharp`)

```
sources → discover → classify/type → resolve entities → dedupe/merge → enrich (Wikidata facts, coordinates)
        → images (Commons, rights check, visual scoring) → link check → apply editorial decisions → shard → report
```

### Sources (all within their terms; User-Agent with contact; rate limits honoured; responses cached in `state/`)

1. **Wikidata SPARQL.**
   - Items that are instances of (P31/P279*) a verified set of classes: media facade, projection mapping (works and events), light art, light installation, light festival, media art installation, interactive art installation, digital art installation, video mapping festival, LED building facade if a class exists, and illuminated architecture only through the more specific classes.
   - The class list is data: `pipeline/config/classes.json` holds QIDs plus a `type` mapping. A discovery query reports candidate classes with counts into `review/`, so the list can grow.
   - Never guess an id: every QID and PID used must be confirmed by a live query whose result is logged in `review/`.
2. **Wikimedia Commons categories.**
   - Use category search (namespace 14) for configured seed terms ("media facade", "media façade", "projection mapping", "light installation", "light art", "light festival", "video mapping", "LED facade", and native-language forms), plus configured root categories.
   - Walk subcategories breadth-first with a depth and count limit. Record each category's linked Wikidata item (`pageprops.wikibase_item`) and its coordinates (category or file `coordinates`).
   - A category becomes a project candidate only if it is about one specific project or place, not a country/year/type aggregate. Decide this with rules: aggregate-name patterns ("by country", "in <country>", "festivals in", years) and child-count heuristics. Record the reason for every decision.
3. **Web discovery (GDELT DOC API, RSS/Atom feeds, optional NAVER/Brave keys)**, using the existing `edge-functions/_shared/archive/` collector modules. These produce **candidates only**: `admin-data/candidates.json`. They are never public until an editorial decision approves them.
4. **OpenStreetMap / Overpass**: optional, only to confirm coordinates. Respect the usage policy; skip it when unreachable.

### Project eligibility (public dataset)

A project is public when **all** of the following hold:

- It has a stable identity: a Wikidata QID, a Commons category, or an approved editorial record.
- It has a name.
- It has a country, and coordinates or a city.
- Its type maps to one of the archive `project_type`s, and it is not on a blocklist (general buildings, plain billboards and advertising screens, unrelated institutions).
- It has at least one public source URL: Wikidata, a Wikipedia sitelink, a Commons category, or an official site.

Duplicates merge by:

1. QID.
2. A Commons category linked to the same QID.
3. The same normalised name within 300 m.
4. The same official URL.

All sources stay attached. Curated seed places (SEOUL001…) are part of the dataset and merge with their QIDs.

### Images (per-surface rules)

Candidate images:

- the item's P18;
- Commons files in the project category and its direct "at night" / "illuminated" / event subcategories;
- files linked to the item through P180 depicts, only if a cheap query supports it.

Each candidate is licence-checked with the existing `live-media.mjs` rules: allowlist licences, deletion and NoFoP templates (with the Korean FoP policy), attribution.

Each image gets scores, all logged:

- `night`: title, description or category keywords in many languages ("night", "nuit", "Nacht", "야경", "夜景", "illuminated", "illumination", "light show", "projection", festival names…) plus the "at night" subcategory.
- `media`: keywords "media facade", "LED", "projection", "mapping", "light art", "installation", "show", "festival", event names.
- `visual`: computed from a 320 px thumbnail with sharp.
  - Mean luminance, the colourfulness metric (Hasler–Süsstrunk), and the share of saturated bright pixels.
  - A dark frame with saturated bright regions suggests active media. Darkness alone never qualifies.
- `relevance`: the image belongs to the project's own entity (P18 or the project category) and is not a map, plan, logo, portrait or interior unrelated to the work. Reject mime/svg/pdf and files whose names match `map|plan|logo|diagram|portrait|signature`.

Roles:

- **hero** (home): `night` and `media` evidence, plus `visual` above a threshold, plus relevance, plus an entry in `editorial/hero.json` (the visually reviewed allowlist), or `editorial/hero-candidates` approval.
- **card**: the best image by priority:
  1. media active at night;
  2. media art content;
  3. LED/projection/lighting characteristics;
  4. an official or architectural image of the project;
  5. none — the UI draws the designed placeholder. A daytime architectural photo may be a card image only below the media-active tiers, and never on the home page.
- **detail gallery**: up to 12 relevant cleared images, media-active first, each labelled with its licence and author.

The pipeline also writes `review/contact-sheets/*.jpg`: a grid of hero and card candidates with their ids, so a human (or Claude) can verify relevance visually. Hero eligibility needs that review, recorded in `editorial/hero.json`.

### Output (`site-data/`, published at `/data/`)

- `manifest.json`: `{schema:1, build_id, generated_at, counts:{projects, with_images, with_hero, by_type{}, by_region{}, by_country{}}, files:{index, home, shards:[...]}, sources:{<name>:{status, last_success, items}}}`
- `index.json`: compact rows for list, search and map — `{fields:[...], rows:[[id, name_ko, name_en, name_original, country_iso2, city, lat, lng, project_type, year, thumb, visual_rank, shard], ...]}`. Under 1 MB raw for 5,000 rows; loaded lazily by explore and map, never by the home first paint.
- `home.json`: about 30 projects pre-picked for the home page (hero slides, featured, region and type collections with representative images and counts). The home page needs only this file.
- `projects/<shard>.json`: full records, about 200 per shard, loaded on demand by the detail page.
  - Fields follow the ARCHIVE_SPEC §6 client fields plus `images[]` (`{thumb, src, page, license, license_url, author, attribution, role}`), `sources[]` (`{kind, title, url, publisher}`) and `visit` (`{status, note, period}` when known).
  - Only facts with a source; `null` otherwise.
- `stats.json`: the counts behind the research page.

`admin-data/` (published at `/data/admin/`, linked only from the admin page; `noindex`):

- `report.json`: per-run and per-source status, durations, errors with causes, counts (new, changed, merged, removed), last success times, API reachability and the review queue size.
- `quality.json`: projects missing images, broken links, suspected duplicates, stale items (not seen in 3 runs), low-confidence types.
- `candidates.json`: web-derived candidates with their hits and classifier reasons.

### Editorial decisions (`editorial/` on `source`; GitHub authentication protects every write)

- `editorial/decisions/*.json`: `{action: 'approve'|'hide'|'unhide'|'merge'|'edit'|'block_image'|'set_hero'|'unset_hero', target, fields?, into?, image?, note, by, at}`. The pipeline applies them in file-name order, and every applied decision appears in `report.json`.
- `editorial/hero.json`: the reviewed hero allowlist `[{project, image, note}]`.
- The static admin page builds a decision as JSON and opens GitHub's "create new file" page for `editorial/decisions/<timestamp>-<action>.json` with the content prefilled (`https://github.com/<repo>/new/source?filename=...&value=...`). Only someone with write access to the repository can commit it, so GitHub authentication is the access control for every change. The page states that its read-only quality data is public, like the repository.

## Consumer UI rules (v0.17)

- No internal review or pipeline vocabulary on public screens: no "재확인 시점 경과", "확인 기록 있음", "검토 목록", "편집 검수", "자동 수집·미검수", sync status, field states or pipeline timestamps.
- Public screens show:
  - name, country and city, representative image, type, people (artist, architect, operator), description, location and map;
  - images and videos with licence and author credits — required, never removed;
  - official and source links;
  - visit information (whether it can be seen now, operating period) only when known from a source.
- Required credits (image licence and author, map attribution) and facts that affect a visit stay visible.
- Internal quality and status information lives only in the admin page.
