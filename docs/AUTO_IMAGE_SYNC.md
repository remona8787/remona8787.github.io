# Auto Image Sync v0.4

## Flow
1. Seed place becomes visible.
2. Query Wikidata `wbsearchentities` by Korean/English name.
3. Accept only exact-ish label match.
4. Query entity claims and read P18.
5. Query Wikimedia Commons `imageinfo` with `extmetadata`.
6. Auto-display only if license metadata resolves to:
   - CC BY
   - CC BY-SA
   - CC0
   - Public Domain
   and does not include NC / ND.
7. Render a small credit overlay under the image:
   `author · license`
   linking to the exact Commons file page.
8. Cache successful/failed checks locally for 7 days.
9. User can clear image cache in MY to force recheck.

## Important
Attribution is not a substitute for permission. The license must actually permit the intended reuse.
The implementation therefore rejects unknown/NC/ND licenses instead of showing the image.

## Data freshness
- Wikimedia image metadata: 7-day client cache.
- Wikidata global search: live on each query.
- OSM map tiles: live as viewed.
- Seoul seed operating info: still editorial/audited until Seoul OpenAPI key exists.
- Once Seoul OpenAPI key is connected, use `culturalEventInfo` and daily-source refresh.
