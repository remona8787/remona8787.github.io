# 실제 적용 상태 — v1.0 미완료

Supabase project: refwrdfxbhcsguweicle / architecture-of-light / Seoul.

## 확인한 서버 상태
- places 전체 50, is_published=true 49. SEOUL042 보류로 50-1=49.
- user_workspaces, save_workspace CAS RPC, 소유자 조회 RLS 생성 성공.
- user_workspaces/places Realtime publication 등록 성공. 실제 구독 테스트는 미실행.
- live 데이터/이미지 메타데이터/검토 로그/글로벌 후보 테이블 적용 성공.
- public 일반 테이블 중 RLS 비활성 테이블: 0.
- 관리자 테이블 없음, 개인사진 메타데이터 테이블 없음.
- Auth 사용자 0, cached_public_url이 있는 이미지 0.
- 앱 프런트엔드는 아직 백엔드 키를 활성화하지 않았음. 기존 공개 사이트 기능 보존.

## 실패와 승인 창
apply_migration 요청 일부는 성공했으나 여러 변경 요청과 최종 일괄 요청이 MCP -32602 Invalid or expired requestState로 종료되었습니다. 사용자 승인/거부 여부는 이 오류로 판별할 수 없습니다. 앱 권한 설정을 변경하거나 우회하지 않았습니다. 같은 실패 호출을 반복하지 않습니다.

## 준비된 후속 적용
complete-backend.sql은 확인된 부분 적용 상태를 전제로 남은 SQL을 하나의 트랜잭션에 묶었습니다. 아직 성공적으로 실행되지 않았습니다. Supabase SQL Editor에서 사용자가 실행하거나, 연결 상태가 복구된 뒤 해당 파일을 한 번 적용해야 합니다. 이 파일만으로 Edge Function 배포/Auth 설정/Cron 실행까지 완료되는 것은 아닙니다.

## 코드 수정·검증
- 원본 Seed의 연도 단독 날짜를 NULL로 변경. 없는 월·일을 생성하지 않음.
- sources 날짜 VALUES의 명시적 date cast 추가.
- 라이선스 allowlist, NC/ND/모호한 문자열 차단.
- 이미지 검토 전 또는 권리 변경 시 공개 캐시 생성 차단. 승인 가능한 라이선스도 관리자 reviewed=true 또는 유지 중인 기존 승인 필요.
- 62 기존 테스트 + 9 라이선스 테스트 = 71 통과. build/check 통과.
- local-verification.txt 참조. 실제 Auth/RLS 두 계정/Storage 업로드/브라우저/모바일 검증은 미실행.

## 런칭 차단 항목
남은 SQL 적용, 관리자 계정 지정, 이메일 Auth 발송/redirect 설정, 사진 Storage 실업로드, 함수 배포, 수집 실제 데이터 확보, 이미지 캐싱/귀속, Cron 실행, 실제 두 계정 동기화 및 브라우저 E2E, 운영자/지원 연락처 확정. 공개 사이트가 존재하는 것을 서비스 런칭 완료로 계산하지 않습니다.
