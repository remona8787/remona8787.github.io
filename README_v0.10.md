# 빛의 건축 v0.10 — Global Bootstrap + Admin Review Console

완료된 범위:
- 실제 country/city seed SQL: KR/JP/US + Seoul/Tokyo/New York
- 도시별 bbox/centroid/timezone/discovery priority
- 자동 bootstrap scripts
- candidate discovery: OSM Overpass + Wikidata spatial museum layer
- relevance/confidence scoring
- provider links
- idempotent duplicate clusters
- candidate lifecycle / publishing status
- schema-compatible candidate → canonical place promotion
- Supabase Auth 기반 admin allowlist
- 후보 검토 관리자 콘솔
- 서울/도쿄/뉴욕 discovery 실행 버튼
- ingestion job monitor
- offline admin dashboard preview

핵심 파일:
- supabase/12_seed_countries_cities.sql
- supabase/13_admin_review_console.sql
- supabase/14_bootstrap_job_markers.sql
- supabase/15_discovery_hardening.sql
- supabase/16_bootstrap_admin_smoke_tests.sql
- bootstrap/
- admin/
- edge-functions/admin-discovery-command/
