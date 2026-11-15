# v2.0 개인정보 처리방침·이용 안내 확정본 (2026-11-15)

운영자가 2026-11-15에 "기본값으로" 정한 값으로 `v2-drafts.md`의 대괄호를 채운 확정본입니다. 본문은
`release/policies/v2/privacy.body.html`과 `terms.body.html`이고, `scripts/policy-v2.mjs`가 사이트의 현재 페이지 틀에 넣어 게시합니다.
**아직 게시하지 않았습니다.** 지금 사이트의 방침(버전 1.0.0, 회원 기능 없음)이 그대로 유효합니다.

## 정한 값

| 항목 | 값 | 실제 동작 |
|---|---|---|
| 연구자 신청 보관 | 반려·취소·만료·철회 후 1년 | `platform_expire`가 매일 삭제(`retention_application_days` 365) |
| 신고·이의신청 기록 | 처리·결정 후 3년 | 같은 작업(`retention_record_days` 1095). 열린 신고·이의신청은 기간과 상관없이 남김 |
| 운영 기록(결정, 감사 로그) | 3년 | 같은 작업 |
| 신고 회신 이메일 | 처리 즉시 삭제 | `content_flags`, `content_reports` 트리거(이미 있음) |
| AI 문맥 검수 | 쓰지 않음 | `ANTHROPIC_API_KEY` 없음: 모든 글이 규칙 검사 뒤 사람에게 감 |
| 만 14세 미만 | 가입 불가 | 가입 화면의 확인란(나이·약관·방침), 확인 기록은 계정 메타데이터 `consent`(버전 2.0.0, 일시) |
| 사진 삭제 후 남아 보이는 시간 | 최대 1시간 | 공개 사진 `cacheControl` 3600 |
| 이메일 발송 업체 | **미정** | SMTP를 정하면 `notice`의 `--mail-provider`, `--mail-country`로 채움 |
| 법률 검토 | **받지 않음** | 운영자 판단. 특히 국외 이전 근거(4절)와 만 14세 확인 방식은 검토를 권합니다 |

## 게시 순서

1. SMTP 연결(운영자) → 업체 이름과 국가 확정.
2. 개정 예고: `node scripts/policy-v2.mjs notice --mail-provider="<업체>" --mail-country="<국가>"`
   - `privacy-next.html`, `terms-next.html`(검색 제외)이 생기고, 현재 `privacy.html`, `terms.html` 맨 위에 시행일이 적힌 안내가 붙습니다.
   - 시행일은 공고일 + 7일(지금 방침 7절의 약속). `release/policies/v2/state.json`에 날짜가 남습니다.
   - 같은 때 platform 워크플로 `apply`로 보관 기간(`20261115000000_v2_retention.sql`)을 운영 DB에 설치합니다(운영자 승인).
3. 시행일 당일 이후: `node scripts/policy-v2.mjs effective`
   - 새 문서가 `privacy.html`, `terms.html`이 되고, 이전 문서는 `privacy-v1.html`, `terms-v1.html`(검색 제외)로 남습니다.
   - 같은 배포에서 `site-public-cleared/config.js`에 `SUPABASE_URL`과 공개용 키를 넣어 회원 기능을 켭니다.

`tests/policy-v2.test.mjs`가 두 단계(값 채움, 이스케이프, 7일 미만 거부, 시행일 전 거부, 이전 판 보존)를 확인합니다.
