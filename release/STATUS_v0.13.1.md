# v0.13.1 — v1.0 연결 전 안정화

## A. 실제 완료
기존 UI/URL/49개 Seed 보존. 카탈로그 조회 실패와 Auth 초기화 분리, 계정 전환 중 오래된 응답 차단, 충돌 상태 유지, 충돌 해결 중 계정/로컬 데이터 변경 감지, 동시 카탈로그 요청 병합, 이미지 조회 오류 시 마지막 정상 응답 유지. 수집 DB 오류 전파, 제공자 식별자 보존, 외부 요청 60초 제한과 응답 배열 검증. 새 UI 시안을 만들지 않음.

**v1.0 Public Launch 완료 아님.** 아래 미연결 사항 때문에 상용 준비 완료로 표시하지 않습니다.

## B. URL
- 서비스: https://light-architecture-jihyun.peppydegu2.chatgpt.site/
- 관리자: https://light-architecture-jihyun.peppydegu2.chatgpt.site/admin/
- 관리자의 실제 인증/DB 연동은 미완료.

## C. Backend
조직 JIHYUN-KIM (aeemdrmufufmeptmjsuj) 조회 성공, plan=free, tier=tier_free. list_projects=[] 확인.
프로젝트 생성 비용 조회 get_cost와 confirm_cost 모두 실제 서버에서 UNAVAILABLE / “MCP tool ... was not returned by tools/list” 반환. 생성에 필요한 비용 확인 ID를 얻지 못했으며 임의 ID를 생성하거나 비용 절차를 우회하지 않았습니다. 유료 신청 없음.
따라서 Project 미생성; DB/Auth/Storage/Edge Functions/Cron 실제 연결·배포·실행 없음. 기존 SQL·클라이언트·함수 코드가 있어도 연결 완료를 뜻하지 않습니다.
Supabase 공식 가격표: Free 월 $0, 활성 무료 프로젝트 최대 2개, 1주 비활성 시 pause 가능, 자동 백업 미포함. Pro 월 $25부터. Pro 전환은 자동 실행하지 않았으며 공개 URL 자체에 Pro가 필수라는 뜻은 아닙니다. 실제 결제 조건은 생성 화면에서 재확인합니다.

## D. Data
Wikidata 네트워크 호출을 서울·도쿄·뉴욕 중심 좌표로 실제 시도했습니다. 각 응답 후보 0개. 후속 VALUES 진단 쿼리는 HTTP 403 반환. release/DISCOVERY_ATTEMPT_v0.13.1.json 참조. **세 도시 수집 완료가 아니며**, 쿼리 범위·공급자 응답 추가 진단이 필요합니다. DB 미생성으로 저장/매칭/승격 테스트 미실행. 기존 로컬 canonical Seed 49개, DB canonical 및 review pending 수는 집계 불가. 좌표 검증 상태 변경 없음.

## E. Images
새로 확보/캐시한 실제 사진 0개. cleared/pending 운영 DB 통계 없음. 기존 명시적 플레이스홀더 유지. 이미지 장애 시 메모리에 보관된 마지막 성공 응답 유지 수정은 완료했지만, 실제 Storage/CDN 이미지 로딩 검증은 하지 못했습니다.

## F. Tests
release/VERIFICATION_v0.13.1.txt: 기존 51 + 동기화 7 + 수집 4 = 62 통과, 실패 0. 웹 빌드·JS 문법·Edge TypeScript 문법 검사 통과. 네트워크·DB 응답을 모의한 회귀 검사이며 RLS/실제 로그인/두 기기/비공개 사진 업로드 증거가 아닙니다.
Sites 스킬은 이 managed 환경에서 control-browser가 없으면 브라우저 실행을 금지합니다. 해당 기능이 없어 실제 Chrome/Edge/360·390·412·430 viewport, Lighthouse, 스크린샷 검증은 미실행입니다. QA 테스트 파일은 실행 증거가 아닙니다.

## G. 다음 필요 작업
사용자 조치: Supabase 대시보드에서 위 조직에 architecture-of-light Free 프로젝트를 생성하고 서울(ap-northeast-2)을 선택한 뒤 프로젝트 이름/ID를 알려 주세요. 조직/Free 생성 승인은 이미 받았으므로 다시 요구하지 않습니다. 현재 요청은 플러그인의 생성 절차 도구가 서버에 없기 때문입니다. service-role/secret 키를 대화에 붙여넣을 필요는 없습니다.
프로젝트가 조회되면 기존 SQL 순서 적용 및 권한 검사, Auth 설정, private Storage·함수 배포, 관리자 지정, 실제 계정 두 개를 이용한 RLS/동기화/사진 테스트, 수집·캐시·Cron 실행이 남아 있습니다. 브라우저 검증 환경, 운영자/지원 연락처 확정도 필요합니다. 운영 연결 없이 v1.0 완료로 보고하지 않습니다. Android/iOS 서명 빌드는 요청대로 웹 안정화 이후 별도 단계입니다.
