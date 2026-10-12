# FlutterFlow State Variables

## App State
- `selectedCity: String = "서울"`
- `mapCategory: String = "전체"`
- `mapFreeOnly: bool = false`
- `mapIndoorMode: String = "all"`
- `lastSearchQuery: String = ""`

## Page State — MapPage
- `selectedPlaceId: String?`
- `selectedCategory: String = "전체"`
- `freeOnly: bool = false`
- `indoorMode: String = "all"`

## Page State — PlaceDetailPage
- page parameter `placeId: UUID (required)`
- local `isSaved: bool`
- local `isVisited: bool`

## Page State — CurationDetailPage
- page parameter `curationId: UUID (required)`

## Page State — AuthPage
- page parameter `returnRoute: String?`

## Rule
Backend truth wins. Local booleans are optimistic UI only; refresh after RPC/insert/delete.
