# 빛의 건축 v0.3 Launch Candidate

이번 버전은 계정 없이 가능한 한계까지 실제 연동을 붙인 **정적 Public Beta / PWA**다.

## 실제로 동작하는 외부 연동
- OpenStreetMap: 실제 interactive map tiles
- Wikidata: `wbsearchentities` + `wbgetentities` live global search
- Wikidata P625: 검색 장소 좌표를 실제 map marker로 표시
- Wikidata P18 -> Wikimedia Commons API: 이미지/저작자/라이선스 metadata 확인
- CC BY / CC BY-SA / CC0 / Public Domain 등 허용 후보만 자동 이미지 표시
- 라이선스가 NC/ND/불명확하면 자동 사용하지 않음

## 정적 Beta는 Supabase 없어도 됨
저장/방문은 localStorage. 따라서 호스팅 계정만 있으면 공개 베타 URL을 만들 수 있다.

## 계정이 여전히 필요한 것
- public hosting URL
- custom domain
- Supabase 회원계정/서버 저장
- TourAPI / 서울 OpenAPI / Google Places / Foursquare key
- App Store / Google Play 개발자 계정
- 이미지 운영사 허가가 필요한 자산의 실제 승인

## 파일
- `site/` : 바로 배포 가능한 Public Beta
- `supabase/` : 이후 계정형 production backend
- `edge-functions/` : provider sync scaffolds
- `data/` : Seed/audit/rights/provider matrix
