# v0.8 Hybrid Media Pipeline

## Runtime priority
1. `public.public_place_media` — Supabase Storage cached + cleared canonical image
2. Wikimedia Commons live discovery — fallback and internal candidate review
3. UI placeholder

## Initial cache population
`sync-place-media`
- loads published places
- searches Wikidata P18 and Commons
- ranks candidates
- takes top 3
- calls `cacheCommonsAsset`
- caches image bytes in `place-media-cache`
- stores creator/license/source/SHA-1/timestamp in `media_assets`

## Canonical media table
`media_assets` stores:
- `storage_path`
- `cached_public_url`
- `source_provider`
- `provider_asset_id`
- `source_url`
- `original_file_url`
- `creator`
- `license_code`, `license_url`
- `commercial_use_allowed`, `derivatives_allowed`
- `source_sha1`, `source_modified_at`
- `rights_fingerprint`
- `cached_at`, `last_rights_sync_at`
- `clearance_status`
- `sync_status`
- `review_required`
- `relevance_score`
- `is_cover`, `display_order`

## Scheduled refresh
`refresh-media-rights`
- re-fetches Commons `imageinfo`
- compares SHA-1 and rights fingerprint
- same rights + new source SHA-1: versioned recache automatically
- auto-allowed rights metadata change: update + keep live + create review item
- license becomes non-allowed: set `expired`, remove from public view, urgent review
- file/API error: set sync status `error`, remove from public view until reviewed

## CDN/cache strategy
Storage path contains source SHA-1:
`places/SEOUL001/<sha1>-<filename>.jpg`

This means a changed Commons revision gets a new URL instead of relying on browser cache eviction.

## Client behavior
When `config.js` contains Supabase URL + publishable key:
- app reads `public_place_media`
- cached media is first priority
- internal review mode merges cached assets + live candidates
- public mode returns cached cleared assets first
- if no cached asset exists, live Commons discovery remains a fallback

When Supabase is not configured:
- app still works in v0.7-style live mode.
