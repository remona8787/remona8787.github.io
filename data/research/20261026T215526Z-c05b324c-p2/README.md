# 빛의 건축 미디어파사드·미디어아트 아카이브 공개 데이터셋

- 데이터셋 ID: `light-architecture-archive` · 버전: `20261026T215526Z-c05b324c-p2` (수집 빌드 ID `20261026T215526Z-c05b324c`와 패키지 형식 p2)
- 생성: 2026-10-26T21:55:26.281Z · 데이터 기준일: 2026-10-26
- 프로젝트 390건 (좌표 있음 202건) · 출처 762건 · 이미지 정보 1742건 · 관계 38건 · 행사 0건 · 작가·건축가·기관 108건
- 국가 36곳 · 국내 권역 seoul 51, busan_ulsan_gyeongnam 1, gwangju_jeolla 1, gyeonggi_incheon 1

## 파일

projects.csv · projects.json · projects.geojson · sources.csv · images.csv · relations.csv · events.csv · agents.csv · archive.xlsx(같은 표를 시트로, 데이터 사전 시트 포함) · datapackage.json(필드 정의와 체크섬) · CITATION.txt

## 엔터티 모델

| 엔터티 | 이 데이터셋에서 |
|---|---|
| 장소·건축 (Place, Architecture) | projects.csv에서 `kind`가 facility이고 `project_type`이 media_facade, media_architecture, media_wall인 레코드 |
| 설치·작품 (Installation, Artwork) | projects.csv에서 `kind`가 facility이고 `project_type`이 light_art, projection_mapping, interactive_installation인 레코드 |
| 전시 (Exhibition) | `kind`가 exhibition인 레코드, events.csv에서 `kind`가 exhibition인 행 |
| 행사 (Event) | `kind`가 festival·program인 레코드, events.csv에서 `kind`가 event인 행, relations.csv의 edition_of(회차) |
| 작가 (Artist) | agents.csv에서 `entity_type`이 artist·architect인 행 |
| 기관 (Organization) | agents.csv에서 `entity_type`이 organization인 행 |

장소와 그곳의 행사·전시·회차는 relations.csv로 이어집니다(event_at, exhibition_at, part_of, edition_of). 작가와 기관은 아직 독립 레코드가 아니라 레코드의 크레딧과 행사 주최 기관에서 모은 목록입니다. 이름이 정확히 같거나 Wikidata QID가 같을 때만 같은 행위자로 봅니다.

## 결측치와 검증 상태

- 빈 값은 '출처에서 확인하지 못함'을 뜻합니다. 추정한 값으로 채우지 않습니다.
- 필드별 출처는 `field_sources`에 있습니다. 출처 ID는 sources.csv의 `source_id`입니다.
- `confidence_*` 열은 유형·지역·날짜·작가·건축가·좌표가 어디서 왔는지 나타냅니다: sourced(출처가 밝힘), inferred(규칙으로 추정한 값이라 확인 필요), editorial(편집부 입력), unknown(자료 없음).
- `status`는 출처가 진행 상태를 밝힌 경우에만 unknown이 아니며, 그 출처는 `status_source`에 있습니다.
- 이미지는 자동 규칙(동일성·관련성·권리)을 통과한 것만 실립니다. 사람의 육안 검수를 거쳤다는 뜻은 아닙니다.
- 편집부 해설문(summary)은 이용 조건이 정해질 때까지 이 데이터셋에 넣지 않습니다.
- CSV에서 `=`, `+`, `-`, `@`로 시작하는 텍스트는 스프레드시트가 수식으로 실행하지 않도록 앞에 `'`를 붙였습니다.

## 이용 조건

- Wikidata에서 온 사실 정보는 CC0 1.0입니다.
- 그 밖의 정보는 sources.csv에 적힌 각 출처의 조건을 따릅니다.
- events.csv의 행사 정보는 행마다 적힌 원천 데이터셋과 라이선스(예: 공공누리 제1유형, 출처 표시)를 따릅니다.
- 이미지는 이 데이터셋에 들어 있지 않습니다. 쓰려면 images.csv의 원본 페이지에서 저작자와 라이선스를 확인하고 그 조건을 지켜야 합니다. `commercial_use`가 false인 이미지는 상업적으로 이용할 수 없습니다.
- 이 데이터셋에 대해 독점적 권리를 주장하지 않습니다.

## 인용

빛의 건축 (Architecture of Light). (2026). 빛의 건축 미디어파사드·미디어아트 아카이브 공개 데이터셋 (버전 20261026T215526Z-c05b324c-p2, 데이터 기준일 2026-10-26). https://remona8787.github.io/data/research/20261026T215526Z-c05b324c-p2/

## 필드 정의 (데이터 사전)

### projects.csv

| 열 | 형식 | 이름 | 설명 |
|---|---|---|---|
| `id` | string | ID | 아카이브 프로젝트 ID. Wikidata 항목이면 QID, 편집부 수록이면 SEOUL001 형식, Commons 분류 기반이면 CAT-… |
| `name_ko` | string | 한국어 이름 | 없으면 빈 값 |
| `name_en` | string | 영어 이름 | 없으면 빈 값 |
| `name_original` | string | 원어 이름 |  |
| `name_original_lang` | string | 원어 언어 | ISO 639-1 |
| `project_type` | string | 유형 | archive-taxonomy.js의 project_type 키 (media_facade, projection_mapping, light_art …) |
| `country_iso2` | string | 국가 | ISO 3166-1 alpha-2 |
| `region` | string | 세계 권역 |  |
| `kr_region` | string | 국내 권역 | 국내 8개 권역 키 (seoul, gyeonggi_incheon …). 국외는 빈 값 |
| `city` | string | 도시(영문) |  |
| `city_ko` | string | 시·군(한국어) | 출처의 행정구역 이름에서만 채움. 추정하지 않음 |
| `district` | string | 구·군 | 출처의 행정구역 이름에서만 채움 |
| `address` | string | 주소 | 출처에 있는 경우만 |
| `lat` | number | 위도 | WGS84. 좌표가 없으면 빈 값 |
| `lng` | number | 경도 | WGS84 |
| `location_precision` | string | 위치 정밀도 | exact, approximate, city 등 |
| `operating_status` | string | 운영 상태 | 출처에 근거한 값만. 모르면 빈 값 |
| `kind` | string | 레코드 종류 | facility(상설 시설·작품), program(정기 프로그램), festival(축제), exhibition(전시) |
| `start_date` | string | 시작일 | YYYY, YYYY-MM 또는 YYYY-MM-DD. 출처에 있는 경우만 |
| `end_date` | string | 종료일 | YYYY, YYYY-MM 또는 YYYY-MM-DD |
| `status` | string | 진행 상태 | running, seasonal, ended, upcoming, unknown. 출처가 없으면 unknown |
| `status_source` | string | 진행 상태 출처 | tourapi, wikidata, editorial, curated. status가 unknown이면 빈 값 |
| `year_installed` | integer | 설치 연도 |  |
| `year_completed` | integer | 완공 연도 |  |
| `year_operating_since` | integer | 운영 시작 연도 |  |
| `year_ended` | integer | 종료 연도 |  |
| `installation_method` | string | 설치 방식 |  |
| `envelope_type` | string | 외피 유형 |  |
| `technologies` | string | 기술 | 세미콜론(;)으로 구분 |
| `spatial_context` | string | 공간 맥락 | 세미콜론(;)으로 구분 |
| `content_types` | string | 콘텐츠 유형 | 세미콜론(;)으로 구분 |
| `wikidata` | string | Wikidata | QID |
| `commons_category` | string | Commons 분류 |  |
| `official_url` | string | 공식 URL |  |
| `record_origin` | string | 레코드 출처 | wikidata, commons, curated, wikipedia … |
| `added_at` | datetime | 처음 수록 | ISO 8601 |
| `source_count` | integer | 출처 수 | sources.csv의 행 수 |
| `image_count` | integer | 공개 이미지 수 | images.csv의 행 수 |
| `has_valid_image` | boolean | 대표 이미지 있음 | 프로젝트 사진(project_media, project_installation) 또는 건축 맥락 사진이 카드·대표로 지정됨 |
| `field_sources` | string | 필드별 출처 | JSON 객체: 필드 이름 → 출처 ID (sources.csv의 source_id) |
| `confidence_project_type` | string | 신뢰도: 유형 | sourced(출처가 밝힘), inferred(규칙으로 추정, 확인 필요), editorial(편집부 입력), unknown(자료 없음) |
| `confidence_region` | string | 신뢰도: 지역 | sourced(출처가 밝힘), inferred(규칙으로 추정, 확인 필요), editorial(편집부 입력), unknown(자료 없음) |
| `confidence_dates` | string | 신뢰도: 날짜 | sourced(출처가 밝힘), inferred(규칙으로 추정, 확인 필요), editorial(편집부 입력), unknown(자료 없음) |
| `confidence_artist` | string | 신뢰도: 작가 | sourced(출처가 밝힘), inferred(규칙으로 추정, 확인 필요), editorial(편집부 입력), unknown(자료 없음) |
| `confidence_architect` | string | 신뢰도: 건축가 | sourced(출처가 밝힘), inferred(규칙으로 추정, 확인 필요), editorial(편집부 입력), unknown(자료 없음) |
| `confidence_coordinates` | string | 신뢰도: 좌표 | sourced(출처가 밝힘), inferred(규칙으로 추정, 확인 필요), editorial(편집부 입력), unknown(자료 없음) |
| `relation_count` | integer | 관계 수 | relations.csv의 행 수 |
| `event_count` | integer | 행사·전시 수 | events.csv의 행 수 |

### sources.csv

| 열 | 형식 | 이름 | 설명 |
|---|---|---|---|
| `project_id` | string | 프로젝트 ID |  |
| `source_id` | string | 출처 ID |  |
| `kind` | string | 종류 | wikidata, wikipedia, official, public_agency, news … |
| `title` | string | 제목 |  |
| `publisher` | string | 발행처 |  |
| `url` | string | URL |  |

### images.csv

| 열 | 형식 | 이름 | 설명 |
|---|---|---|---|
| `project_id` | string | 프로젝트 ID |  |
| `image_id` | string | 이미지 ID |  |
| `kind` | string | 이미지 역할 | project_media, project_installation, architecture_context, technical_documentation, event_documentation |
| `role` | string | 화면 역할 | hero, featured, card, gallery, context |
| `title` | string | 제목 | Commons 파일 이름 또는 제공처 제목 |
| `provider` | string | 제공처 |  |
| `author` | string | 저작자 |  |
| `license` | string | 라이선스 |  |
| `license_url` | string | 라이선스 URL |  |
| `commercial_use` | boolean | 상업적 이용 가능 | 라이선스 기준. 공공누리 2·4유형과 NC는 false |
| `width` | integer | 너비(px) | 원본 |
| `height` | integer | 높이(px) | 원본 |
| `page` | string | 원본 페이지 | 저작자·라이선스를 확인할 수 있는 페이지 |

### relations.csv

| 열 | 형식 | 이름 | 설명 |
|---|---|---|---|
| `project_id` | string | 프로젝트 ID | 관계를 가진 레코드 |
| `type` | string | 관계 | event_at(그 장소에서 열림), exhibition_at(그 장소에서 전시), part_of(그 일부), edition_of(그 회차) |
| `target` | string | 대상 프로젝트 ID | 이 데이터셋에 실린 프로젝트 |
| `source` | string | 근거 | wikidata:P361, commons:edition_category, seoul_events 등 |
| `subject_event` | string | 대상 행사 ID | 레코드 안에 든 행사(events.csv의 event_id)의 관계일 때 |
| `subject_name` | string | 대상 이름 | 레코드 안에 든 회차·부분·행사의 이름 |
| `subject_commons_category` | string | 대상 Commons 분류 |  |

### events.csv

| 열 | 형식 | 이름 | 설명 |
|---|---|---|---|
| `project_id` | string | 프로젝트 ID | 행사가 열리는 장소의 레코드 |
| `event_id` | string | 행사 ID |  |
| `kind` | string | 종류 | event(행사), exhibition(전시) |
| `title` | string | 행사명 |  |
| `program` | string | 프로그램 |  |
| `start` | date | 시작일 |  |
| `end` | date | 종료일 |  |
| `date_text` | string | 기간(원문) |  |
| `status` | string | 진행 상태 | checked_at 기준 |
| `checked_at` | string | 확인일 | YYYY-MM-DD |
| `place` | string | 장소(원문) |  |
| `district` | string | 구·군 |  |
| `org` | string | 주최·주관 |  |
| `fee` | string | 요금(원문) |  |
| `is_free` | boolean | 무료 |  |
| `url` | string | 행사 URL |  |
| `source_dataset` | string | 원천 데이터셋 | 예: OA-15486 |
| `publisher` | string | 제공 기관 |  |
| `license` | string | 라이선스 | 예: KOGL Type 1 |
| `license_url` | string | 라이선스 URL |  |
| `source_url` | string | 원천 페이지 |  |

### agents.csv

| 열 | 형식 | 이름 | 설명 |
|---|---|---|---|
| `agent_id` | string | 행위자 ID | Wikidata QID가 있으면 QID, 없으면 name:<정규화한 이름>. 이름이 정확히 같을 때만 합침 |
| `name` | string | 이름 |  |
| `name_en` | string | 영어 이름 |  |
| `wikidata_qid` | string | Wikidata |  |
| `entity_type` | string | 엔터티 유형 | artist(작가·디자이너·큐레이터), architect(건축가), organization(운영·소유·제작·주최 기관). 역할에서 정하며 사람인지 단체인지는 판단하지 않음 |
| `roles` | string | 역할 | 세미콜론(;)으로 구분. archive-taxonomy.js credit_role 키, 행사 주최는 event_organizer |
| `project_ids` | string | 프로젝트 ID | 세미콜론(;)으로 구분 |
| `project_count` | integer | 프로젝트 수 |  |
