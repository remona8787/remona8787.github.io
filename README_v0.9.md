# 빛의 건축 v0.9 — Global Discovery Engine

추가 구현:
- `countries / cities / external_candidates / provider_links / ingestion_jobs / duplicate_clusters / candidate_scores`
- 국가 → 도시 → 장소 자동 탐색 구조
- Overpass + Wikidata 기반 global candidate discovery
- candidate scoring / dedupe / publishing workflow
- candidate → canonical place 승격 함수

주요 파일:
- `supabase/10_global_discovery_engine.sql`
- `supabase/11_global_discovery_cron.sql`
- `edge-functions/_shared/discovery.ts`
- `edge-functions/discover-city-candidates/index.ts`
- `edge-functions/promote-candidate/index.ts`
- `docs/GLOBAL_DISCOVERY_ENGINE.md`
- `docs/V09_ACCOUNT_SETUP.md`
