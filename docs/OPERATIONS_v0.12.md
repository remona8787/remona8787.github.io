# v0.12 설치·백엔드·배포

## 실행
Node 22 이상. `npm ci`, `npm test`, `npm run build`, `npm run check`. 운영 웹 루트는 **dist**이며 site, prototype, legacy, admin 원본을 별도 공개 루트로 배포하지 않습니다. 개발 원본은 site-public-cleared입니다. assets/cloud.js/native.js는 빌드 시 client 폴더에서 번들링됩니다.

## Supabase 적용 순서
운영 백업을 만든 뒤 별도 테스트 프로젝트에서 먼저 적용합니다. 01_schema → 02_seed_seoul50 → 03_storage → 04_flutterflow_rpc → 05_live_data_schema → 07_audited_corrections → 08_hybrid_media_pipeline → 10_global_discovery_engine → 12_seed_countries_cities → 13_admin_review_console → 14_bootstrap_job_markers → 15_discovery_hardening → 17_user_sync_and_operations → 18_discovery_rotation. 기존 프로젝트에서는 migration 이력을 대조해 이미 실행한 seed/DDL을 무조건 재실행하지 마세요. 16,98,99는 검증 쿼리이며 운영 데이터를 확인하고 실행합니다. 06,09,11은 **스케줄 활성화 SQL**이므로 함수/시크릿/수동 호출을 검증한 다음 마지막에 적용합니다. 원래 49개 place_code와 로컬 ID는 변경하지 않습니다.

Supabase Auth 이메일 확인, Site URL, 웹 리디렉트 allowlist를 실제 도메인으로 설정합니다. config.js의 SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY만 클라이언트에 넣습니다. service_role, secret 키는 절대 넣지 않습니다. 관리자는 app_admins allowlist로 제한합니다. SQL17의 save_workspace는 auth.uid만 사용하며 직접 쓰기 권한을 부여하지 않습니다.

CLI로 함수를 배포할 때 기존 `_shared` 의존성을 함께 포함합니다. delete-account는 사용자 Bearer 토큰을 검증하고 최근 5분 이내 재로그인을 요구합니다. cron 함수는 플랫폼 JWT 게이트 설정과 x-aol-cron-secret을 함께 점검해야 합니다. 새 publishable key는 사용자 JWT가 아니므로 cron 함수 게이트를 JWT 미검증으로 배포하는 경우 반드시 함수 내부 secret 검사가 활성화되어 있어야 합니다. 익명 호출 401을 먼저 확인하세요.

## 스케줄
11_global_discovery_cron.sql은 기본 매일 02:21 UTC입니다. 대량 확대 전 도시 배치 수/외부 공급자 비용을 점검하세요. v0.12는 오래된 도시부터 순환합니다. 운영 48시간 주기는 홀수 날짜 cron이 아니라 마지막 성공 시각을 기준으로 간격을 제어하도록 별도 스케줄러를 설정해야 하며 현재 미구현입니다. 현재 활성화·실행 검증된 스케줄은 없습니다.

## 웹 배포/롤백
동일 Sites project ID에 dist를 배포합니다. 독립 정적 호스팅도 dist를 문서 루트로 사용합니다. SPA 라우트는 #을 사용하므로 상세 링크 새로고침은 index.html로 열립니다. 별도 프리뷰 프로젝트에 테스트 Supabase를 사용하고 운영 프로젝트와 config를 혼용하지 마세요. Sites의 이전 저장 버전을 재배포하면 웹 롤백이 가능합니다. SQL 마이그레이션은 자동 역적용하지 말고 백업 복구 또는 전진 수정합니다. 기존 도메인에서는 localStorage 키를 유지하며, 다른 도메인에는 JSON 백업→복원이 필요합니다.

## 백업과 비밀
Supabase 프로젝트의 백업/PITR 가용성은 요금제에서 확인하세요. DB dump에는 개인정보가 있으므로 암호화 저장소에 보관하고 복구 리허설을 별도 프로젝트에서 수행합니다. Storage 파일은 DB dump와 별도 보존해야 합니다. 운영 연락처·서버 지역·백업 보관기간은 실제 프로젝트 결정 후 privacy.html에 확정해야 합니다.

## 운영비
정적 호스팅, Supabase DB/Auth/Realtime/Storage/egress, 지도 타일 공급자, 외부 문화 API 한도, 스토어 개발자 계정 비용이 발생할 수 있습니다. 현재 유료 플랜이나 결제는 생성하지 않았습니다. 일별 함수 호출/전송량/Storage/실패율 알림과 예산 한도를 운영자가 설정해야 합니다. 클라이언트 지도는 현 OSM 정책을 준수해야 하며 오프라인 타일 선다운로드 기능은 없습니다.
