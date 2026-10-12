# v0.8 Account Setup — exact order

## Supabase
1. Create project.
2. Run existing SQL `01` through `07`.
3. Run `08_hybrid_media_pipeline.sql`.
4. Deploy Edge Functions:
   - `cache-commons-media`
   - `sync-place-media`
   - `refresh-media-rights`
5. Set Edge Function secrets:
   - server secret key (`SUPABASE_SECRET_KEYS` or supported server secret)
   - `MEDIA_ADMIN_SECRET`
   - `MEDIA_CRON_SECRET`
6. Run one bootstrap sync manually:
   `sync-place-media` with `{ "limit": 10 }`, then repeat batches.
7. Confirm `public_place_media` returns cached cleared rows.
8. Put project URL and publishable key in `site/config.js`.
9. Run `09_hybrid_media_cron.sql` after Vault secrets are configured.

## Client `config.js`
Only public client values belong here:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Never put a server/service secret or media admin secret in the web app.

## Launch check
- cover image loads from Supabase Storage URL
- attribution still links to original Commons file
- `last_rights_sync_at` is populated
- a deliberately pending asset does not appear in `public_place_media`
- Commons live search still works if canonical media is missing
