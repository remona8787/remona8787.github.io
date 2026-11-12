# 국내 대표 사진 확보 (2026-11-12 점검)

국내 사례의 대표 사진(작품이 작동하는 모습, 저작자·라이선스 확인, 긴 변 900px 이상)이 적은 이유와 늘리는 방법.
권리를 확인하지 못한 사진은 올리지 않는다. 검색 결과에 사진이 있다는 것과 게시할 권리가 있다는 것은 다르다.

## 원인 (공개 데이터 빌드 20261112T003936Z, 국내 293건, 대표 사진 10건)

| 원인 | 건수 | 설명 |
|---|---|---|
| 후보 사진이 하나도 없음 | 273 | 그중 272건은 Wikidata 항목·Commons 분류와 연결이 없다. 국내 미디어파사드·빛 축제는 Wikidata에 거의 없다(레지스트리 236건 이름 검색에서 일치 2건). TourAPI·서울 열린데이터는 인증키가 없어 수집을 건너뛴다 |
| 후보는 있으나 대표 기준 미달 | 10 | 건물 분류의 사진뿐(작품이 아닌 건물 맥락), 900px 미만, 상업 이용 불가 라이선스, 인물·행사 위주, 극단적 가로세로 비 |

## 이번에 한 일

- 편집 결정이 레지스트리 기록(REG-…)에도 적용되도록 고쳤다(`pipeline/lib/editorial.mjs`). 전에는 사진 지정·수정·삭제 결정이
  레지스트리 기록에 닿지 않았다.
- Commons에서 작품 이름으로 파일을 찾고, 파일 페이지에서 저작자·라이선스·원본 크기를 읽은 뒤, 사진을 직접 보고 작품이
  작동하는 모습인지 확인한 것만 `set_image`(새 사진) 또는 `approve_image`(이미 후보인 사진)로 반영했다.
  - 대전 스카이로드: Daejeon Skyroad 3·2 (Alexey82kr, CC BY-SA 4.0)
  - 여수 빅오쇼: The Big-O Show (Jeongyeol Park, CC BY 3.0)
  - 서울로7017 야간조명: Night View in Seoullo 7017 01·02 (분당선M, CC BY-SA 3.0)
  - 롯데월드타워 미디어파사드: Seoul Skyline Night 2018 (CC0)
  - 보고 뺀 사진: 서울로에서 내려다본 도시 야경, N서울타워에서 찍은 시내 야경(타워가 없음), 국립중앙박물관 외관 야경(작품은
    실내 실감영상관), 스카이로드 아래 무대 행사.

## 대표 사진을 늘리는 방법 (우선순위)

1. **TourAPI 인증키** (운영자, 무료): 공공데이터포털에서 “한국관광공사_국문 관광정보 서비스” 활용 신청 → 저장소 Settings →
   Secrets and variables → Actions → `TOURAPI_SERVICE_KEY`. 수집기는 이름과 300m 이내 위치가 모두 맞는 항목의 사진만 후보로
   삼고, 사진마다 표시된 공공누리 유형(cpyrhtDivCd)이 제1유형 또는 제3유형인 것만 공개한다(제3유형은 변경 없이). 키 등록만으로 사진 사용권이 생기지는 않는다.
2. **서울 열린데이터광장 인증키** → `SEOUL_OPEN_DATA_KEY`.
3. **주최 기관 사진 이용 허락**: 지자체·재단에 사진 사용 허락(저작자 표시 조건)을 받으면 `set_image`(provider `official`,
   `permission_note`)로 넣는다. 허락 내용은 결정 파일에 남긴다.
4. **Commons 검토**: 작품 이름으로 Commons 파일을 찾고, 파일 페이지의 저작자·라이선스·크기를 확인하고, 사진을 직접 보고
   작품이 작동하는 모습인지 확인한 뒤 `set_image`/`approve_image` 결정을 만든다. 비슷한 야경이나 건물 사진은 쓰지 않는다.
5. 촬영·기증: 운영자가 직접 찍은 사진은 Commons에 CC BY-SA로 올린 뒤 4와 같이 연결할 수 있다.

## 결정 파일 예

```json
{"action":"set_image","target":"REG-KR-0124","provider":"editor",
 "src":"https://upload.wikimedia.org/wikipedia/commons/0/07/Daejeon_Skyroad_3.jpg",
 "page":"https://commons.wikimedia.org/wiki/File:Daejeon_Skyroad_3.jpg",
 "author":"Alexey82kr","license":"CC BY-SA 4.0","license_url":"https://creativecommons.org/licenses/by-sa/4.0",
 "width":1960,"height":4032,"note":"무엇을 보고 작품과 일치한다고 판단했는지","by":"…","at":"…"}
```
