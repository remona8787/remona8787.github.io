# 빛의 건축 v0.1 — FlutterFlow Build Spec

기준일: 2026-09-21  
목표: `Home / Map / Place Detail / Curation / My Light Map` 5개 핵심 화면을 Supabase 데이터와 연결하는 MVP.

## 0. 계정 없이 지금 확정해둔 기술 계약

- Frontend: FlutterFlow
- Backend: Supabase PostgreSQL + Auth + Storage
- Maps: Google Maps widget (FlutterFlow)
- Public browsing: 로그인 불필요
- Login required: 저장, 방문기록, 컬렉션, My Light Map
- Canonical content key: Supabase `places.id` UUID
- Editorial reference key: `places.place_code` (`SEOUL001` 형식)
- Initial data: 서울 50개 장소 + Works 12 + Curations 6

## 1. Design System

### Color tokens
- `bg.primary`: `#0B0E14`
- `bg.surface`: `#151A22`
- `bg.elevated`: `#202632`
- `brand.primary`: `#7C4DFF`
- `brand.lavender`: `#B98CFF`
- `brand.warm`: `#FFD8A8`
- `text.primary`: `#F7F7F5`
- `text.secondary`: `#A8AFBA`
- `line.subtle`: `#303744`
- `success`: `#55C98B`

### Typography
- Korean primary: Pretendard (custom font after account setup)
- Fallback: Noto Sans KR
- Brand/serif accent: use only for logo/section display text if licensing permits.
- Body: 14–16sp
- Card title: 16–18sp / semibold
- Page title: 24–30sp / bold

### Radius / spacing
- Card radius: 16
- Image radius: 14
- Button radius: 14
- Main horizontal padding: 20
- Section gap: 28
- Card gap: 12

## 2. Global Navigation

Bottom Nav:
1. `HomePage`
2. `MapPage`
3. `CurationPage`
4. `SavedPage` (auxiliary; can initially route to MyLightMap saved tab)
5. `MyLightMapPage`

Auxiliary technical pages:
- `AuthPage`
- `SearchPage`
- `CurationDetailPage` (not a primary bottom-nav screen)
- Optional `WebViewPage` for official website links

## 3. Page Contracts

### A. HomePage

**Purpose**
10초 안에 “지금 갈 곳 하나”를 발견시킨다.

**Backend queries**
1. `featuredPlaces`
   - Table: `places`
   - List of rows
   - Filters:
     - `is_published = true`
     - `mvp_priority = A`
   - Order: `verified_at DESC`
   - Limit: 10

2. `featuredCurations`
   - Table: `curations`
   - `is_published = true`
   - Order: `published_at DESC`
   - Limit: 6

**Widget tree**
- SafeArea
  - CustomScrollView
    - Header: logo + search icon
    - Search field (tap -> SearchPage)
    - Hero card: `오늘 밤 뭐 볼까?`
    - Quick filter chips:
      - 내 주변
      - 무료
      - 실내
      - 야외
      - 미디어파사드
    - Section: `지금 볼 수 있어요`
      - Horizontal ListView from `featuredPlaces`
    - Section: `이번 주 큐레이션`
      - Horizontal cards from `featuredCurations`
    - Section: `Editor Pick`

**Actions**
- Hero `오늘 밤 뭐 볼까?`
  - Navigate -> `MapPage`
  - parameter: `mode = tonight`
- Place card tap
  - Navigate -> `PlaceDetailPage`
  - parameter: `placeId = currentRow.id`
- Curation card tap
  - Navigate -> `CurationDetailPage`
  - parameter: `curationId = currentRow.id`

### B. MapPage

**Page parameters**
- `mode: String?`
- `category: String?`
- `curationId: UUID?`

**Required data dependency**
- `places.latitude` and `places.longitude` must be geocoded before map launch.
- Never generate approximate coordinates manually.

**Backend query**
- Table: `places`
- Filters:
  - `is_published = true`
  - `latitude IS NOT NULL`
  - `longitude IS NOT NULL`

**Local/App State**
- `selectedCategory: String = "전체"`
- `freeOnly: bool = false`
- `indoorMode: String = "all"` (`all`, `indoor`, `outdoor`)
- `selectedPlaceId: UUID?`

**Widget tree**
- Stack
  - GoogleMap
  - Top search + filter row
  - Filter chips
  - Current-location control
  - Bottom selected-place card

**Map marker source**
- Build `List<LatLng>` from queried places:
  - `LatLng(row.latitude, row.longitude)`

**Marker/Card action**
- On selected item -> set `selectedPlaceId`
- Detail card tap -> PlaceDetailPage(placeId)

**v0.1 filtering rule**
Use FlutterFlow query filters where possible. If a compound filter becomes awkward, fetch the 50 published rows once and filter with local state; 50 rows is small enough for MVP.

### C. PlaceDetailPage

**Page parameter**
- `placeId: UUID` required

**Backend queries**
1. Single row `places` where `id = placeId`
2. `media` where `place_id = placeId`, order `display_order`
3. `works` where `place_id = placeId`, order `start_date DESC`
4. `schedules` where `place_id = placeId`
5. If authenticated:
   - `saved_places` where `user_id = auth.uid AND place_id = placeId`
   - `visited_places` same condition

**Sections**
1. Hero image / image gallery
2. Name / category / district
3. Save + Visited controls
4. `이곳을 추천하는 이유`
5. Visit facts:
   - address
   - typical_hours
   - free
   - recommended_time
6. `빛의 건축 해설`
7. `현재 프로그램`
8. Works
9. Source / official website
10. `길찾기`

**Save action**
- If logged out -> AuthPage
- If not saved -> Insert Row `saved_places`
  - user_id = authenticated user id
  - place_id = page.placeId
- If saved -> Delete matching row
- Refresh saved query

**Visited action**
- If logged out -> AuthPage
- If no row -> Insert `visited_places`
- If row exists -> Update:
  - `last_visited_at = Current Time`
  - `visit_count = visit_count + 1`
- Refresh visited query

### D. CurationPage

**Backend query**
- `curations`
- `is_published = true`
- Order `published_at DESC`

**Layout**
- Large featured curation
- category chips: 전체 / 지역 / 테마 / 에디터
- card list

**Card action**
- -> `CurationDetailPage(curationId)`

### E. CurationDetailPage (auxiliary)

**Parameter**
- `curationId: UUID`

**Queries**
1. single `curations`
2. `curation_places` where `curation_id = curationId`, order `sort_order ASC`
3. For each relation row, fetch/reference place

**Actions**
- `지도에서 모두 보기`
  - Navigate MapPage(curationId)
- place row -> PlaceDetailPage(placeId)

### F. MyLightMapPage

**Login state**
- If unauthenticated: show benefit copy + login CTA.
- If authenticated: query personal data.

**Queries**
1. `saved_places` where user_id = auth.uid
2. `visited_places` where user_id = auth.uid
3. linked `places` for map/card display

**Top KPIs**
- 방문 = number of visited rows
- 저장 = number of saved rows
- 도시 = distinct districts among visited places
- 발자국 = sum(visit_count) (optional)

**Layout**
- profile
- KPI strip
- tabs: `저장한 장소 / 방문한 장소 / 컬렉션`
- My Light Map using visited places with coordinates
- recent visits
- saved places

## 4. Component Library

Create these once in FlutterFlow Components:
- `PlaceCardHorizontal`
- `PlaceCardCompact`
- `CategoryChip`
- `InfoPill`
- `CurationCard`
- `EmptyState`
- `AuthGateSheet`
- `SectionHeader`

### PlaceCardHorizontal inputs
- placeId UUID
- title String
- category String
- district String
- free Bool
- hours String
- imageUrl String?
- distanceKm double? (later)

## 5. Auth UX

v0.1 rule:
- Browsing is public.
- Ask for login only on:
  - Save
  - Visited
  - Create collection
  - My page personal features

FlutterFlow auth target:
- Supabase Authentication
- public companion table: `public.users`
- Schema already includes FK to `auth.users` and auto-create trigger.

## 6. Images

Supabase bucket: `place-images`

Recommended path:
`{place_code}/cover.webp`
`{place_code}/01.webp`
`{place_code}/02.webp`

`media` table stores:
- image_url
- caption
- copyright_holder
- photographer
- source_url
- display_order
- is_cover

Do not upload third-party images until usage rights are confirmed.

## 7. Geocoding Requirement

Current seed intentionally contains no fabricated lat/lng.

Before Map QA:
1. Resolve `data/geocoding_queue.csv`.
2. Use a single provider consistently (Google/Naver/Kakao).
3. Validate ambiguous entries manually.
4. Update:
   - latitude
   - longitude
   - geocode_status = verified

## 8. v0.1 Acceptance Tests

### Public
- Home opens without login.
- At least 10 place cards load.
- Curation cards load.
- Map shows only rows with verified coordinates.
- Place detail dynamically changes by `placeId`.
- Official URL opens correctly.

### Authenticated
- Save adds one row only.
- Save toggle deletes that row.
- Visited creates/updates personal row.
- User A cannot read User B saved/visited rows.
- My Light Map uses only current user data.

### Data
- All 50 places exist.
- 6 curations exist.
- every curation_place resolves to a valid place.
- all seed sources keep their URL.
- no place image is published without copyright/source metadata.

## 9. Build Order inside FlutterFlow

1. Theme tokens
2. Supabase integration + Get Schema
3. Bottom navigation
4. `PlaceCardHorizontal` component
5. HomePage
6. PlaceDetailPage
7. CurationPage + CurationDetailPage
8. MapPage after coordinates/API key
9. Supabase Auth
10. Save/Visited actions
11. MyLightMapPage
12. Device QA

## 10. Official documentation references

- FlutterFlow Supabase Setup:
  https://docs.flutterflow.io/integrations/supabase/setup/
- FlutterFlow Supabase Auth initial setup:
  https://docs.flutterflow.io/integrations/authentication/supabase/initial-setup/
- FlutterFlow Backend Query:
  https://docs.flutterflow.io/resources/backend-query/
- FlutterFlow Supabase Query:
  https://docs.flutterflow.io/resources/backend-query/query-collection/
- FlutterFlow Supabase Database Actions:
  https://docs.flutterflow.io/integrations/database/supabase/database-actions/
- FlutterFlow Google Maps:
  https://docs.flutterflow.io/integrations/google-maps/google-maps-widget/
- Supabase RLS:
  https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Auth:
  https://supabase.com/docs/guides/auth
- Supabase Storage access:
  https://supabase.com/docs/guides/storage/security/access-control
