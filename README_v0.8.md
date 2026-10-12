# 빛의 건축 v0.8 — Hybrid Media

이번 버전은 이미지 파이프라인을 production architecture로 전환합니다.

`Commons live discovery`
→ `Supabase Storage cache`
→ `media_assets canonical metadata`
→ `public_place_media`
→ `앱`
→ `daily rights/source refresh`
→ `review queue`

주요 파일:
- `supabase/08_hybrid_media_pipeline.sql`
- `supabase/09_hybrid_media_cron.sql`
- `edge-functions/sync-place-media/`
- `edge-functions/cache-commons-media/`
- `edge-functions/refresh-media-rights/`
- `docs/HYBRID_MEDIA_PIPELINE.md`
- `docs/V08_ACCOUNT_SETUP.md`

Supabase 계정이 없을 때는 기존 Commons live fallback이 계속 동작합니다.
Supabase 연결 후에는 캐시된 cleared 이미지가 우선됩니다.
