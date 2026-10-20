# 빛의 건축 · Architecture of Light

A global archive of media facades, projection mapping, light art and media architecture, served at
**https://remona8787.github.io/**.

전 세계 미디어파사드·프로젝션 매핑·라이트아트·미디어 건축 아카이브입니다. 이 저장소가 곧 운영 백엔드입니다. GitHub Actions가
6시간마다 공개 출처(Wikidata, Wikimedia Commons, Wikipedia 등)에서 프로젝트를 수집·정리·검증하고, 결과를 정적 데이터로
GitHub Pages에 배포합니다. 서버 비용은 0원입니다(공개 저장소의 Actions와 Pages는 무료).

## How it works

| branch | content | written by |
|---|---|---|
| `main` | the built site served by Pages, `data/` (the published dataset), this README, `.nojekyll` and `.github/workflows/archive.yml` | the `deploy` job only |
| `source` | the app (static PWA) and the pipeline at the branch root, plus `editorial/` (editor decisions) | people (and Claude) |
| `data` | pipeline output: `site-data/`, `admin-data/`, `review/` (contact sheets, query logs, live checks), `state/` (caches) | the workflow only |

`.github/workflows/archive.yml` runs every 6 hours (at minute 17), on demand, and on every push to `source`:

1. **collect** (every schedule; on a push only when the commit message contains `[collect]`): runs
   `pipeline/run.mjs` of `source` and commits the result to `data`. A failed source never removes what it found
   before; a failed run commits nothing.
2. **deploy**: builds `source` with `SITE_URL=https://remona8787.github.io`, adds `data/` and `data/admin/` from the
   `data` branch and commits the result to `main` (this README, `.github/` and `.nojekyll` stay). GitHub Pages then
   publishes `main`.
3. **verify-live**: waits until the live site serves that deploy (`/deploy.json`, `/data/manifest.json`), opens the
   main screens at phone and desktop sizes with Playwright and commits screenshots and measurements to
   `data:review/live/`.

The data comes from Wikidata (CC0), Wikipedia (links to articles), Wikimedia Commons (every image keeps its own
licence and author) and the archive's curated records. Only facts with a source are published.

## One-time setup

1. Settings → Pages → Build and deployment → Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
2. Settings → Actions → General → Workflow permissions: **Read and write permissions**.
3. Push the project to the `source` branch (the `light-architecture/` folder at the branch root, e.g.
   `git subtree split --prefix=light-architecture -b source` in the development repository, then
   `git push <this repository> source:source`).
4. Copy `deploy/pages-repo/.github/workflows/archive.yml`, `README.md` and `.nojekyll` of `source` to `main`.
5. Actions → archive → Run workflow (or push to `source` with `[collect]` in the commit message). The first run
   creates the `data` branch.

## Editing the archive

Editor decisions are JSON files in `editorial/decisions/` on `source` (approve, hide, unhide, merge, edit,
block_image, set_hero, unset_hero) plus the reviewed hero list `editorial/hero.json`. The admin page
(https://remona8787.github.io/admin/) prepares a decision and opens GitHub's "create new file" page; only people with
write access to this repository can commit it. The next collect run applies it. See `docs/PIPELINE.md` on `source`.

The admin data under `/data/admin/` is public, like this repository; it is excluded from indexing in `robots.txt`.
