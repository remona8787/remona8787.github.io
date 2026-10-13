# 빛의 건축 — Brand: Arch of Light

건축이 빛을 담는다. 볼트(아치)에 천창 슬롯을 내고, 그 위에 다홍 광원을 두었다. 보라 빛줄기는 슬롯에서 곧장 나와 두 기둥 사이 바닥에 고인다. 안도 다다오의 빛의 교회와 판테온 오큘러스를 하나의 도형으로 압축한 마크다.

*Architecture frames light: a vault cut by a skylight slot, with a vermilion source above it and a purple shaft that leaves the slot and pools on the floor between the piers.*

모든 SVG·PNG는 `tools/build.mjs` 하나에서 생성된다. 손으로 고치지 말고 생성기를 고친 뒤 다시 실행한다(맨 아래 참고).

## 파일

| 파일 | 용도 |
| --- | --- |
| `symbol.svg` | 컬러 심볼, 밝은 배경. 64×64 그리드 (20 px 이상) |
| `symbol-dark.svg` | 컬러 심볼, 네이비·다크 배경 |
| `symbol-mono.svg` | 단색(`currentColor`, 기본값 검정). 인쇄, 스탬프, 각인. 빛줄기를 2.5단위 띄워 볼트와 분리 |
| `symbol-16.svg` | 16 px 전용 컷 (파비콘, 탭). 슬롯을 넓히고 4단위 = 1 px로 스냅. 16·32·48 기기 픽셀(1×·2×·3×)에서만 픽셀에 맞는다 |
| `symbol-16-dark.svg` | 같은 16 px 컷, 네이비·다크 배경 |
| `symbol-padded.svg` / `symbol-padded-dark.svg` | 여백(기둥 폭)을 포함한 정사각 심볼. 광학 보정으로 1.5단위 왼쪽. 아바타, 소셜 |
| `app-icon.svg` | 1024 앱 아이콘 원본. 단색 네이비 필드, 마스커블 안전 원 안에 마크 |
| `logo-ko-{light,dark}-horizontal.svg` | 기본 로고: 심볼 + 빛의 건축 + ARCHITECTURE OF LIGHT |
| `logo-ko-{light,dark}-compact.svg` | 앱 바·헤더: 심볼 + 빛의 건축 (서브라인 없음) |
| `logo-ko-{light,dark}-vertical.svg` | 세로형: 소개 화면, 스플래시, 인쇄물 |
| `logo-en-{light,dark}-horizontal.svg` / `-vertical.svg` | 영문 전용 맥락 |
| `symbol-{192,512,1024}.png` | 투명 배경 컬러 심볼 래스터 |
| `og-image.png` | 1200×630 공유 이미지 (네이비, 국문 + 영문) |

웹 앱 사본 (`site-public-cleared/assets/`): `symbol.svg`, `symbol-dark.svg`, `favicon.svg`(16 px 컷, 브라우저 다크 모드 자동 대응), `favicon-16.png`·`favicon-32.png`·`favicon.png`(48) (모두 16 px 컷의 1×·2×·3× 래스터), `icon-{192,512,1024}.png`(purpose `any`, 슈퍼타원 타일, 투명 모서리), `icon-maskable-512.png`(풀블리드), `apple-touch-icon.png`(180, 불투명), `og-image.png`.

네이티브: Android `mipmap-*/ic_launcher{,_round,_foreground}.png`, 적응형 아이콘 배경색 `values/ic_launcher_background.xml` = Navy. iOS `AppIcon.appiconset/AppIcon-512@2x.png`(1024, 알파 없음). 스플래시는 아래 [스플래시](#스플래시-네이티브) 참고.

## 팔레트 — 7색, 이외의 색 없음

| 이름 | HEX | 역할 | 대비 |
| --- | --- | --- | --- |
| Navy | `#1C1F4A` | 아치 구조, 워드마크, 앱 아이콘 바탕. UI `--nav` | 흰 배경 위 15.6:1 |
| Ink | `#151A38` | 본문 텍스트 | 흰 배경 위 17.0:1 |
| Purple | `#6B52DE` | 빛줄기, 서브라인, UI 강조 `--accent` | 흰 글자 5.4:1 (AA) |
| Purple on dark | `#A08CFF` | 다크 배경의 빛줄기·서브라인 (앱 아이콘 포함) | Navy 위 5.7:1 |
| Lilac white | `#F4F1FF` | 다크 배경의 아치·워드마크 | Navy 위 14.0:1 |
| Vermilion 다홍 | `#F04E37` | 광원 점 (밝은 배경). UI `--vermilion` | 흰색과 3.6:1 |
| Vermilion on dark | `#FF5A3D` | 광원 점 (네이비·다크 배경, 앱 아이콘) | Navy 위 5.1:1 |

- 비율은 네이비 구조, 보라 빛, 약간의 다홍이다. 다홍은 마크 면적의 약 6%이고 광원 점에만 쓴다.
- UI에서 다홍은 점, LIVE·지금 점등 중 배지, 작은 마커, 저장 하트에만 쓴다. 흰 글자 대비가 3.6:1이므로 본문 텍스트 버튼에는 쓰지 않는다.
- Purple `#6B52DE`은 Navy 위에서 2.9:1이다. 다크 배경에서는 반드시 `#A08CFF`을 쓴다.

## 서체

워드마크는 **Pretendard** (OFL-1.1, © Kil Hyung-jin)의 글리프 윤곽선이라 폰트 설치가 필요 없다.

- 빛의 건축: Pretendard Bold, 자간 −0.025em
- ARCHITECTURE OF LIGHT: Pretendard SemiBold, 자간 0.14em. 크기는 국문 워드마크 폭에 정확히 맞춘다. 전체 로고에서만 쓴다.
- Architecture of Light (영문 로고): Pretendard SemiBold, −0.012em. 생성기는 HarfBuzz(harfbuzzjs)로 글자를 배치해 Pretendard의 GPOS 커닝(rc, re, te 등)을 적용한다. Chromium이 같은 글꼴로 그린 텍스트와 겹쳐 보면 일치한다
- 앱 UI도 같은 패밀리를 쓴다. 제목은 Bold, UI는 SemiBold·Medium.

## 여백 (clear space)

모든 방향으로 **기둥 폭** 이상 비운다. 기둥 폭은 심볼 박스 높이의 12/64(0.1875×)이고, 40 px 심볼이면 7.5 px다. 로고 SVG의 viewBox에는 4단위(심볼 박스의 1/16)의 내부 여백만 들어 있으므로 나머지는 배치할 때 확보한다. 정사각 크롭이 필요하면 `symbol-padded*.svg`를 쓴다.

## 최소 크기

| 형태 | 최소 | 비고 |
| --- | --- | --- |
| 심볼 | 16 px | 16 px에는 `symbol-16*.svg` / `favicon.svg`, 20 px 이상은 `symbol.svg`. 16 px 컷은 16 px 격자에만 스냅되어 있어 20–28 px에서는 가장자리가 반 픽셀에 걸린다 |
| Compact 로고 | 높이 20 px | 앱 바 권장: 심볼 박스 24–28 px, 국문 18–21 px |
| 가로 로고 (서브라인 포함) | 높이 72 px | 서브라인이 약 8.3 px 글자, 대문자 높이 약 5.8 px가 된다. 이보다 작으면 compact를 쓴다 |
| 세로 로고 (국문) | 높이 150 px | 서브라인 대문자 높이 약 5.8 px. 이보다 작으면 심볼 + compact를 쓴다 |
| 영문 가로 / 세로 | 높이 24 px / 72 px | |

## 앱 아이콘

- 1024 그리드에서 마크는 `translate(176 182) scale(10.5)`이다. 가장 먼 점(기둥 모서리)은 중심에서 392 px로, 마스커블 안전 원(반지름 409.6 px, 지름 80%) 안에 있다. 바운딩 박스 중심은 기하 중심보다 약 6 px 위다(광학 보정).
- 바탕은 단색 Navy다. 그라디언트, 그림자, 테두리를 쓰지 않는다.
- iOS·apple-touch 아이콘은 알파 없는 풀블리드다(OS가 마스크를 적용한다). `icon-*.png`(purpose `any`)는 슈퍼타원 타일, 마스커블은 풀블리드다.
- Android 적응형 전경은 108 dp 캔버스의 가운데 72 dp에 1024 구성을 대응시킨다. 마크가 66 dp 안전 원 안에 들어간다.

## 스플래시 (네이티브)

모든 스플래시는 Navy 필드 가운데에 앱 아이콘 구성(다크 마크, `translate(176 182) scale(10.5)`)을 놓은 같은 그림이다. 런처 아이콘에서 스플래시로 넘어갈 때 마크가 바뀌지 않는다.

- **Android** (core-splashscreen이 모든 API 레벨에서 런치 화면을 그린다): `styles.xml`의 런치 테마가 `windowSplashScreenBackground` = `@color/splash_background`(Navy), `windowSplashScreenAnimatedIcon` = `@drawable/splash_mark`를 쓴다. `splash_mark.xml`은 적응형 전경 구성을 벡터로 옮긴 것(108 캔버스, 288 dp)이라 시스템이 192 dp 원으로 잘라도 마크(약 94.5 dp, 411 dp 폰 폭의 약 23%)가 안에 든다. 런치 테마의 `android:background`는 `splash_launch.xml` 레이어 리스트(Navy + 가운데 마크)라 창 비율로 늘어나지 않는다.
- `drawable{,-port-*,-land-*}/splash.png`: Capacitor `SplashScreen.show()`용 래스터. 기존 크기 그대로이고 `capacitor.config.json`의 `androidScaleType: "CENTER_CROP"`으로 비율을 유지한 채 가운데를 자른다.
- **iOS** `Splash.imageset/splash-2732x2732{,-1,-2}.png`: `LaunchScreen.storyboard`가 `scaleAspectFill`로 가운데를 자른다.
- 크롭 안전 영역: 래스터의 마크는 9:19.5 폰에서 보이는 짧은 변의 23% 폭이고, 마크 잉크 박스에 기둥 폭 여백을 더한 영역이 9:21–21:9 화면(세로 폴더는 세로 화면, 가로 폴더는 가로 화면)에서 가운데를 잘라도 남는다. 생성기가 매번 확인하고 벗어나면 실패한다.
- `capacitor.config.json`: `SplashScreen.backgroundColor` = Navy `#1C1F4A`. `StatusBar`는 앱의 밝은 UI에 맞춰 `style: "LIGHT"`(어두운 아이콘), `backgroundColor` = Lilac white `#F4F1FF` (`client/native.js`도 `Style.Light`를 쓴다).

## 웹 연결 예시 (리디자인 단계용)

```html
<link rel="icon" href="./assets/favicon.svg" type="image/svg+xml">
<link rel="icon" href="./assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="./assets/favicon-16.png" sizes="16x16" type="image/png">
<link rel="apple-touch-icon" href="./assets/apple-touch-icon.png">
<meta name="theme-color" content="#1C1F4A">
<meta property="og:image" content="https://<host>/assets/og-image.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
```

파비콘은 모두 16 px 컷이다. `favicon.svg`는 브라우저 다크 모드를 따르고, PNG는 밝은 배경용이다. 16·32·48 px PNG는 같은 격자에 스냅되어 있으므로 크기를 지정해 연결하고, 다른 크기로 늘리거나 줄이지 않는다. 48 px `favicon.png`는 하나의 PNG만 받는 곳(오래된 브라우저, 일부 크롤러)을 위한 것이다.

```json
"icons": [
  { "src": "./assets/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
  { "src": "./assets/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
  { "src": "./assets/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
]
```

## Do

- 밝은 배경에는 `light`·`symbol.svg`를, Navy·다크 배경에는 `dark`·`symbol-dark.svg`를 쓴다.
- 16 px에서는 16 px 컷(`symbol-16.svg`, 다크 배경은 `symbol-16-dark.svg`)을 쓰고, 앱 바와 좁은 헤더에서는 compact 로고를 쓴다.
- 사진이나 보라 위에 올릴 때는 단색(Lilac white 또는 Navy) 심볼을 쓰거나 흰색·Navy 판을 깐다.
- 정사각 크롭(아바타, 소셜 프로필)에는 광학 보정이 들어간 `symbol-padded*.svg`를 쓴다.

## Don't

- 색을 바꾸거나 팔레트 밖의 색을 쓰지 않는다. 광원 점 외에 다홍을 더하지 않는다.
- 회전, 늘이기, 기울이기, 외곽선, 그림자, 글로우, 그라디언트를 쓰지 않는다.
- 컬러 심볼을 보라 위에 올리지 않는다. 다홍 점이 보라 위에서 1.5:1로 사라진다.
- 빛줄기를 슬롯에서 떼거나 점과 막대 모양으로 바꾸지 않는다(단색판 제외). 'i'·'ñ'처럼 읽힌다.
- 워드마크를 다시 타이핑하거나 다른 서체로 대체하지 않는다. 요소 간 비율과 간격을 바꾸지 않는다.
- 서브라인을 높이 72 px보다 작은 가로 로고, 150 px보다 작은 세로 로고, compact에 넣지 않는다.

## 다시 만들기

```sh
cd light-architecture
npm ci                                  # Chromium 렌더용 @playwright/test
(cd brand/tools && npm ci)              # harfbuzzjs 1.6.2, opentype.js 2.0.0, pretendard 1.3.9 (앱 의존성과 분리)
node brand/tools/build.mjs              # 모든 SVG·PNG·네이티브 아이콘·스플래시 생성 (--svg: SVG와 XML만)
```

## 남은 검증

출시 전 한국어 사용자 5–8명에게 48 px 앱 아이콘과 헤더 로고를 5초 보여 주는 인지 테스트를 권장한다. 30% 이상이 글자('i', 'ñ', 'n')로 읽으면 슬롯 중심을 볼트의 약 55°로 옮기고, 약 66° 빛줄기 축과 평행하게 자른다. 그 뒤 마스커블 안전 원을 다시 확인한다.

변형 비교(사용자 테스트 전 디자인 검토)에서는 이 대안(V2)이 글자보다 '빛이 비스듬히 들어오는 아치'로 가장 잘 읽혔다. V2 기하: 슬롯 중심 55°(중간 반지름 18), 슬롯 벽 66°, 바깥 현 7.54, 빛줄기 바닥 21–33(현재 24–38), 광원 점은 같은 축 위 (48.14, 8.2) r5.6. 점만 볼트 꼭대기 쪽으로 옮긴 변형(V1)은 점이 붙은 'ṅ'처럼 읽히고 광원과 빛줄기의 방향이 어긋나므로 권하지 않는다. V2의 16 px 컷은 오른쪽 어깨가 작은 조각으로 남으므로 쓰기 전에 다시 다듬어야 한다.
