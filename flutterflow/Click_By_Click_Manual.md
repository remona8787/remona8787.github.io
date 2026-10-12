# FlutterFlow 클릭 매뉴얼 — v0.1

> 계정 생성 후 아래 순서대로 진행. 메뉴 이름은 FlutterFlow UI 업데이트에 따라 약간 달라질 수 있으므로 기능명 기준으로 찾는다.

## 1. 프로젝트
1. Blank mobile app 생성: `빛의 건축`.
2. Theme에서 dark base 설정.
3. `theme_tokens.json` 값 입력.
4. Bottom Navigation 5개 탭 생성: Home / Map / Curation / Saved / My.

## 2. Supabase 연결
1. Settings & Integrations > Supabase.
2. OAuth로 Supabase 프로젝트 연결.
3. `Get Schema`.
4. `places`, `works`, `schedules`, `curations`, `curation_places`, `media`, `users`, `saved_places`, `visited_places`가 보이는지 확인.
5. Authentication > Supabase 활성화.

## 3. 컴포넌트 먼저
`PlaceCardHorizontal`
- inputs: `placeId`, `title`, `category`, `district`, `free`, `hours`, `imageUrl?`
- imageUrl 없으면 brand gradient placeholder.
- tap callback를 page에서 받아 Detail로 이동.

`CategoryChip`
- label, selected, onTap.

`CurationCard`
- title, subtitle, coverImage?.

`SectionHeader`
- title, actionLabel?, onTap?.

## 4. HomePage
- Backend Query: places / List
- Filter `is_published == true`, `mvp_priority == A`
- limit 10.
- Horizontal ListView > PlaceCardHorizontal.
- Curation query를 별도 추가.
- Hero button은 MapPage로 navigate하며 `mode='tonight'`.

## 5. PlaceDetailPage
- required page parameter `placeId`.
- Backend Query / Single Row / places / id == placeId.
- 텍스트 위젯에 row 필드를 연결.
- Works와 Schedule은 별도 List query.
- Save:
  - logged out -> AuthPage.
  - logged in -> Supabase RPC `toggle_saved_place`.
- Visited:
  - logged in -> RPC `mark_visited_place`.
- Action 후 관련 query refresh.

## 6. Curation
- CurationPage: published curation list.
- CurationDetailPage: RPC `get_curation_places`.
- `지도에서 모두 보기` -> MapPage(curationId).

## 7. Map
좌표가 채워진 뒤 작업.
- Google Maps widget.
- places List Query where latitude/longitude not null.
- marker list = LatLng(latitude, longitude).
- 초기에는 50개 이하라 local filtering도 허용.

## 8. My
- logged out: AuthGate.
- logged in: RPC `get_my_light_stats`.
- saved/visited list queries.
- visited places with coordinates만 My map marker로 사용.

## 9. QA
`qa/QA_Test_Cases.csv`를 순서대로 실행.
