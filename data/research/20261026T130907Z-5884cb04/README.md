# 빛의 건축 미디어파사드·미디어아트 아카이브 공개 데이터셋

- 데이터셋 ID: `light-architecture-archive` · 버전: `20261026T130907Z-5884cb04` (수집 빌드 ID와 같음)
- 생성: 2026-10-26T13:09:07.451Z · 데이터 기준일: 2026-10-26
- 프로젝트 396건 (좌표 있음 204건) · 출처 773건 · 이미지 정보 1804건
- 국가 36곳 · 국내 권역 seoul 54, gwangju_jeolla 2, busan_ulsan_gyeongnam 1, daegu_gyeongbuk 1, gyeonggi_incheon 1

## 파일

projects.csv · projects.json · projects.geojson · sources.csv · images.csv · datapackage.json(필드 정의와 체크섬) · CITATION.txt · CHANGELOG.md

## 결측치와 검증 상태

- 빈 값은 '출처에서 확인하지 못함'을 뜻합니다. 추정한 값으로 채우지 않습니다.
- 필드별 출처는 `field_sources`에 있습니다. 출처 ID는 sources.csv의 `source_id`입니다.
- 이미지는 자동 규칙(동일성·관련성·권리)을 통과한 것만 실립니다. 사람의 육안 검수를 거쳤다는 뜻은 아닙니다.
- 편집부 해설문(summary)은 이용 조건이 정해질 때까지 이 데이터셋에 넣지 않습니다.
- CSV에서 `=`, `+`, `-`, `@`로 시작하는 텍스트는 스프레드시트가 수식으로 실행하지 않도록 앞에 `'`를 붙였습니다.

## 이용 조건

- Wikidata에서 온 사실 정보는 CC0 1.0입니다.
- 그 밖의 정보는 sources.csv에 적힌 각 출처의 조건을 따릅니다.
- 이미지는 이 데이터셋에 들어 있지 않습니다. 쓰려면 images.csv의 원본 페이지에서 저작자와 라이선스를 확인하고 그 조건을 지켜야 합니다. `commercial_use`가 false인 이미지는 상업적으로 이용할 수 없습니다.
- 이 데이터셋에 대해 독점적 권리를 주장하지 않습니다.

## 인용

빛의 건축 (Architecture of Light). (2026). 빛의 건축 미디어파사드·미디어아트 아카이브 공개 데이터셋 (버전 20261026T130907Z-5884cb04, 데이터 기준일 2026-10-26). https://remona8787.github.io/data/research/20261026T130907Z-5884cb04/

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
