# Android / iOS 출시 절차 — 빌드·제출 아직 미완료

공통 앱 ID 초안 `com.jihyunkim.architectureoflight`. 소유권과 장기 브랜드 정책을 확인한 뒤 첫 제출 전에 확정하세요. Node22+, Capacitor8, Android target/compile SDK36, min SDK24. 공통 웹 소스를 `npm run native:sync`로 복사합니다.

## Android
실제 Android Studio 프로젝트: android/. SDK36, JDK21이 갖춰진 환경에서 `npm run android:apk`. debug APK는 android/app/build/outputs/apk/debug에 생성됩니다. 이번 환경에서는 Gradle 배포 파일 다운로드가 Network is unreachable로 실패하여 APK가 생성되지 않았습니다.

릴리스 서명은 환경변수 AOL_KEYSTORE_PATH, AOL_KEYSTORE_PASSWORD, AOL_KEY_ALIAS, AOL_KEY_PASSWORD를 안전한 CI secret에 등록합니다. `npm run android:aab` 후 bundletool 및 기기 설치로 확인합니다. 릴리스 AAB 경로는 android/app/build/outputs/bundle/release. 키스토어는 Git에 넣지 않습니다. Play App Signing 등록, Console 앱 생성, 내부 테스트 트랙, 계정에 적용되는 비공개 테스트 요건을 확인한 후 프로덕션 검토를 요청합니다. 현재 Play 개발자 계정·서명·제출 권한 미확인입니다.

## iOS
실제 프로젝트: ios/App/App.xcodeproj, SPM 의존성. macOS에서 npm ci → npm run native:sync → Xcode 열기. Team, Bundle ID, 서명 인증서/프로비저닝을 설정합니다. Generic iOS Device 대상으로 Archive → Validate App → Distribute App → App Store Connect → TestFlight 순서입니다. Xcode26 이상 및 제출 시 요구 SDK를 공식 문서에서 다시 확인하세요. 이 Linux 환경에는 Xcode가 없어 빌드/Archive를 실행하지 않았습니다.

현재 네이티브 플러그인: App, Browser, Share, Geolocation, StatusBar, SplashScreen. 공유, 외부 브라우저, 뒤로가기, 요청 시 위치 권한 및 오프라인 기기 기록이 포함됩니다. 단순 포장만으로 최소 기능 심사 통과를 보장하지 않습니다. Native WebView의 JSON/CSV/ICS 파일 다운로드와 Auth 이메일 링크는 실기기에서 검증해야 합니다. Universal/App Links 도메인 검증은 미구현이고 custom scheme은 장소/코스 링크만 처리합니다.

## 제출 전 필수 자료
- 실제 기기/시뮬레이터 스크린샷: 아직 없음. 목업을 실제 화면으로 제출하지 않음.
- 운영자·지원 연락처 확정 및 개인정보처리방침/약관/계정삭제 웹 URL 확인.
- 로그인 기능 실연용 심사 계정 또는 비회원 심사 접근 방법. 심사 계정 아직 생성 안 함.
- 수집: 계정 이메일, 개인 기록, 선택적 위치의 처리 범위에 맞춰 Play Data Safety / Apple App Privacy 작성. 분석·광고 SDK 없음. 호스팅/Supabase 처리 내역과 네이티브 SDK privacy manifest 재검토 필요.
- 연령등급, 국가, 저작권, 수출규정, 콘텐츠 권리 증빙.
- 빌드 번호 증가, 내부 테스트, QA 시나리오 통과, 앱 크래시/네트워크 검증.

## 공식 확인 링크 (제출 시 재확인)
https://capacitorjs.com/docs/getting-started/environment-setup
https://support.google.com/googleplay/android-developer/answer/11926878
https://support.google.com/googleplay/android-developer/answer/14151465
https://developer.apple.com/news/upcoming-requirements/
https://developer.apple.com/app-store/review/guidelines/
https://developer.apple.com/support/offering-account-deletion-in-your-app/
