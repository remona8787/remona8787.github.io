# 데이터베이스 확충과 6시간 자동 갱신 (v0.26)

이 문서는 v0.26에서 바꾼 수집·검증·배포 구조와 운영 방법을 정리합니다. 수치는 측정한 값만 적었고, 확인하지 못한 값은
"확인 필요"로 남겼습니다. 최신 실측치는 data 브랜치의 `admin-data/report.json`, `site-data/stats.json`,
`site-data/events.json`, `site-data/status.json`, `review/live/report.json`에 있습니다.

## 1. 감사 결과 (2026-11-11, v0.25 데이터 20261110T194650Z-ab4e3073 기준)

| 항목 | 값 | 출처 |
|---|---|---|
| 공개 사례 | 390 (국내 54, 해외 336, 36개국) | site-data/stats.json |
| 국내 지역 | 서울 51, 부산·울산·경남 1, 광주·전라 1, 경기·인천 1 | stats.by_kr_region |
| 이미지 보유 | 213 | stats.counts.with_images |
| 수집 후보 | 964 → 공개 390, 제외 574 | admin-data/report.json |
| 제외 사유(중복 포함) | 국가·위치 없음 429·353, 좌표 필요 클래스 364, 사람·회사 등 차단 41, 편집자 숨김 28 | admin-data/quality.json |
| 출처 상태 | tourapi·seoul_events 건너뜀(키 없음), wikidata 부분(maxlag), web 부분(GDELT 429) | manifest.sources |
| 예약 실행 | 10-26~11-10 약 60개 슬롯 중 41회 실행, 37회 성공(10-31~11-01 4회 실패) | GitHub Actions 실행 목록 |

원인:

1. **TourAPI 건너뜀**: 저장소 비밀값 `TOURAPI_SERVICE_KEY`가 없음(review/tourapi.json `reason`). 코드와 검색어는 준비되어
   있습니다. 국내 전국 확대의 가장 큰 자동 경로입니다.
2. **서울 문화행사 건너뜀**: `SEOUL_OPEN_DATA_KEY`가 없음. 샘플 키 탐침만 돌고 공개하지 않습니다.
3. **Wikidata 부분 실패**: 쿼리 서버 지연(maxlag) 응답. 실패한 쿼리는 다음 실행에서 캐시와 함께 다시 시도됩니다.
4. **웹(GDELT) 부분 실패**: 429 응답(요청 제한). 웹 후보는 원래 편집자 승인 전에는 공개하지 않습니다.
5. **위치 없는 후보**: 클래스 인스턴스 중 국가·좌표·도시가 없는 항목(데모신 작품 등 무관한 항목 포함)은 공개 규칙대로
   제외됩니다. 규칙을 느슨하게 하지 않았습니다.
6. **예약 누락**: GitHub가 바쁠 때 예약 실행을 늦추거나 건너뜁니다(11-11 00:17 슬롯도 실행되지 않음).

## 2. 바꾼 것

### 2.1 수집 경로 (pipeline/)

- **Wikidata 경로** (`config/classes.json` `route`, `lib/wikidata.mjs`): 빛 클래스가 없는 빛 작품을 재료(P186: LED
  Q25504, 형광등 Q182925, 네온 조명 Q12177156, 네온사인 Q6006, 빛 Q9128 — 작품 Q838948인 항목만), 장르(P136)와
  사조(P135) 라이트아트(Q1421557)로 찾습니다. 모든 QID는 wikidata.org 검색으로 확인했습니다(`verified_by`). 소장처(P195)로
  위치를 찾습니다. 같은 작가·장소의 경로 전용 작품은 6건까지 공개하고 나머지는 검토 대기(`route_diversity_cap`)로 둡니다.
- **연구 레지스트리** (`editorial/registry/*.json`, `lib/registry.mjs`): 공개 데이터셋에 아직 없는 지역 축제·전시관·
  미디어파사드를 공식 출처로 조사한 기록입니다.
  - 신뢰도 A: 공식·공공기관 출처 1개 이상. B: 서로 다른 출처 2개 이상. C: 검토 대기(공개하지 않음). D: 제외.
  - 한국 기록은 17개 시·도(`kr_division`)가 필수입니다. 좌표·영문명·날짜는 출처에 없으면 비워 둡니다.
  - `attach_to`: 이미 있는 기록(예: Q4167 리옹 빛 축제)에 회차만 붙입니다. 기존 ID와 링크는 바뀌지 않습니다.
- **행사 DB** (`data/events.json`): 축제 시리즈와 회차를 담습니다. 회차 상태는 현지 시간대의 날짜로 계산합니다
  (예정 / 진행 중 / 종료). 출처가 밝힌 취소·연기가 날짜보다 우선하고, 두 날짜가 없으면 "일정 확인 필요"입니다. 종료
  회차도 지우지 않습니다. 같은 행사의 연도별 회차는 프로젝트 1건으로만 셉니다.
- **17개 시·도**: 기록, `index.json`(마지막 열 `kr_division`), 통계(`by_kr_division`, 0건 포함 17개)에 들어갑니다.
  2026-07 통합된 전남광주특별시 주소는 두 조사 단위에 걸치므로 단독으로 시·도를 정하지 않습니다.
- **status.json**: 매 실행마다 씁니다. `last_check_at`은 수집기가 마지막으로 돈 시각, `data_changed_at`은 공개 데이터가
  마지막으로 바뀐 시각입니다. 새 자료가 없는 실행은 첫 값만 바꿉니다.

### 2.2 워크플로 (.github/workflows/archive.yml, main과 source에 같은 파일)

- 예약: `17 */6 * * *`(UTC 00:17·06:17·12:17·18:17)에 보완 예약 `47 2-23/6 * * *`를 더했습니다. 보완 실행은 직전
  5시간 안에 수집이 없을 때만 돕니다(`pipeline/ci/gate.mjs`). GitHub 예약은 늦거나 빠질 수 있으므로 정각 게시를 보장하지는
  않습니다.
- 알림: 실행마다 `health` 작업이 다음 경우 `archive: collection needs attention` 이슈를 열거나 댓글을 답니다. 정상으로
  돌아오면 이슈를 닫습니다(`pipeline/ci/health.mjs`). 데이터는 쓰지 않습니다.
  - 수집·배포·공개 확인 작업 실패
  - 14시간 넘게 수집 없음
  - 직전 데이터 유지(검증 실패·급감·보강 미완료)
  - 7일 넘게 데이터 변경 없음(참고 알림)
- 기존 안전장치는 그대로입니다: 실패한 수집은 커밋하지 않음, 50% 급감 시 직전 데이터 유지, 스키마 검증 실패 시 배포 안
  함, 배포 후 공개 주소 확인(verify-live), 동시 실행 방지(concurrency).

### 2.3 실행 주기

| 주기 | 하는 일 | 구현 |
|---|---|---|
| 6시간 | 행사·일정·변경 확인, 신규 후보, 상태 재계산, 공개 확인 | 매 실행(캐시 사용) |
| 매일 | 클래스·경로 인스턴스와 개수 재조회 | `cache_ttl_hours.sparql`·`class_counts` 24시간 |
| 3일 | 항목 사실(Wikidata 엔티티), Commons 분류 재검증 | `entities`·`commons_*` 72시간 |
| 매주 | 링크 확인, 위키 문서, 넓은 탐색 | `links`·`wiki_pages` 168시간 |
| 매월 | 보조 엔티티, 지오태그, 지명 | `entities_aux`·`commons_geotags` 720시간 |

TTL은 `pipeline/config/pipeline.json`에서 출처별로 조정합니다.

## 3. 외부 설정이 필요한 것

비용이 들거나 되돌리기 어려운 작업이 아닙니다. 다만 저장소 소유자만 할 수 있습니다. 값은 소스코드나 공개 JSON에 넣지 않고
GitHub 저장소 비밀값으로만 넣습니다.

| 비밀값 | 발급처 | 열리는 것 |
|---|---|---|
| `TOURAPI_SERVICE_KEY` | 공공데이터포털(data.go.kr) 한국관광공사 국문 관광정보 서비스 KorService2 활용신청 | 17개 시·도 축제·관광지·문화시설 키워드 탐색, 축제 회차 날짜, 관광사진 후보 |
| `SEOUL_OPEN_DATA_KEY` | 서울 열린데이터광장 인증키 | 서울시 문화행사(OA-15486) 미디어아트·빛 행사 |

등록 위치: GitHub 저장소 → Settings → Secrets and variables → Actions → New repository secret. 등록 뒤 다음 6시간 실행부터
적용되고, `review/tourapi.json`의 `status`가 `skipped`에서 `ok`로 바뀌는지 확인합니다.

## 4. 레지스트리에 기록을 더하는 방법

1. `editorial/registry/korea.json` 또는 `world.json`의 `records`에 항목을 추가합니다. 형식은 `lib/registry.mjs`의
   `validateRecord`가 검사합니다.
2. ID는 `REG-<국가코드>-<4자리>` 형식입니다. 이미 있는 기록에 회차만 붙일 때는 `09xx` 번호와 `attach_to`를 씁니다.
3. 출처마다 `url`(https), `kind`(official, public_agency, news 등), `checked_at`(확인 날짜)를 적습니다.
4. 회차에는 출처가 밝힌 날짜만 넣습니다. 발표되지 않은 날짜는 `null`로 둡니다.
5. `npm test`(pipeline-registry 시험)를 통과한 뒤 source 브랜치에 push합니다. 커밋 메시지에 `[collect]`를 넣으면 바로
   수집합니다.

## 5. 성능 (1,000·5,000건, 390×844 휴대폰 화면, qa/v26-scale.spec.mjs)

| 규모 | index.json(압축 전) | 탐색 화면 렌더 | 검색 갱신 | JS 힙 |
|---|---|---|---|---|
| 1,000 | 193 KB | 18 ms | 25 ms | 10 MB |
| 5,000 | 974 KB | 28 ms | 65 ms | 15 MB |

홈은 index.json을 읽지 않고(home.json만), 탐색·지도는 index를 한 번만 읽고, 상세는 해당 샤드만 읽습니다. index가 512KB를
넘으면 썸네일 주소를 압축합니다. 측정은 로컬 Chromium의 값이고 실제 기기 측정은 아닙니다.
