// UI language of the app (한국어 / English). Every string is one row [Korean, English] keyed by a short id, so the two
// languages cannot drift apart; {name} placeholders are filled from vars. tests/i18n.test.cjs checks that every key the
// app uses exists. Place names and descriptions are data, not UI: see nm() in app.js.
(function(root,factory){const a=factory();if(typeof module==='object'&&module.exports)module.exports=a;else root.AOLi18n=a})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const S={
 'common.all':['전체','All'],'unit.places':['곳',' places'],
 // explore
 'explore.title':['발견','Explore'],'explore.sub':['세계의 미디어파사드와 빛의 건축을 찾아보고 비교해요','Find and compare media facades and light architecture worldwide'],
 'explore.search':['장소 통합 검색','Search all places'],'explore.placeholder':['이름, 도시, 작가, 건물 검색','Search names, cities, artists, buildings'],'explore.toMap':['지도로 보기','View on map'],
 'results.count':['{n}곳','{n} places'],'results.of':['{total}곳 중 {shown}곳','{shown} of {total}'],'results.more':['{n}곳 더 보기','Show {n} more'],'results.dataLink':['이 결과의 통계와 내보내기','Statistics and export of these results'],
 'sort.label':['정렬','Sort'],'sort.relevance':['추천순','Relevance'],'sort.newest':['최신 등록순','Newest'],'sort.updated':['최근 수정순','Recently updated'],'sort.year_desc':['연도 최신순','Year, newest first'],'sort.year_asc':['연도 오래된순','Year, oldest first'],'sort.name':['이름순','Name'],
 'view.label':['목록 모양','Layout'],'view.cards':['카드로 보기','Show as cards'],'view.rows':['한 줄 목록으로 보기','Show as a list'],
 'empty.title':['검색 결과가 없어요','No results'],'empty.body':['검색어를 바꾸거나 범위를 넓혀 보세요.','Try other words or a wider scope.'],'empty.reset':['필터 초기화','Reset filters'],'empty.korea':['전국으로 넓히기','Widen to all of Korea'],'empty.all':['전체 범위로 넓히기','Widen to everything'],
 'global.title':['찾는 프로젝트가 없나요?','Can’t find a project?'],
 'global.body':['Wikidata 공개 데이터에서 직접 찾아 저장할 수 있어요. 저장한 항목은 검수 전 후보예요. 웹·뉴스에서 찾은 후보는 편집 검수 후 공개돼요.','You can search Wikidata’s open data and save what you find. Saved items are unreviewed candidates. Candidates found on the web and in the news are published only after an editor reviews them.'],
 'global.placeholder':['예: teamLab Borderless','e.g. teamLab Borderless'],'global.aria':['Wikidata에서 검색','Search Wikidata'],'global.button':['Wikidata 검색','Search Wikidata'],'global.busy':['검색 중…','Searching…'],
 // filters
 'filter.title':['필터','Filters'],'filter.aria':['상세 필터','Filters'],'filter.ariaActive':['상세 필터, {n}개 적용 중','Filters, {n} applied'],'filter.close':['필터 닫기','Close filters'],'filter.clearAll':['모두 지우기','Clear all'],
 'filter.show':['{n}개 결과 보기','Show {n} results'],'filter.active':['적용된 필터','Active filters'],'chip.remove':['{label} 필터 해제','Remove filter: {label}'],
 'filter.scope':['범위','Scope'],'filter.place':['지역','Location'],'filter.country':['국가','Country'],'filter.city':['도시','City'],'filter.project':['프로젝트','Project'],
 'facet.region':['권역','Region'],'facet.project_type':['프로젝트 유형','Project type'],'facet.installation_method':['설치 방식','Installation method'],'facet.technology':['기술','Technology'],'facet.envelope_type':['건축 외피','Building envelope'],'facet.operating_status':['운영 상태','Operating status'],'facet.origin':['출처·검수','Origin and review'],
 'filter.years':['연도','Year'],'filter.yearFrom':['부터','From'],'filter.yearTo':['까지','To'],
 'filter.yearNote':['설치 연도, 없으면 완공·개시 연도, 프로젝트 연도, 프로그램 시작 연도 순으로 봐요. 연도를 정하면 연도가 없는 곳은 빠져요.','Uses the year installed, else completed or opened, the project year or the programme’s start year. Places without a year drop out once a year is set.'],
 'filter.yearsChip':['{from}–{to}년','{from}–{to}'],'filter.yearFromChip':['{from}년부터','From {from}'],'filter.yearToChip':['{to}년까지','Until {to}'],
 'filter.data':['데이터','Data'],'filter.hasPhoto':['사진 있음','With photos'],'filter.schedule':['일정과 구분','Schedule and kind'],'filter.state':['일정 상태','Schedule'],'filter.kind':['콘텐츠 구분','Kind'],'filter.conditions':['조건','Conditions'],'filter.free':['무료','Free'],'filter.indoor':['실내','Indoor'],
 'state.ongoing':['수록 일정상 진행 중','On now (as listed)'],'state.upcoming':['개막 예정','Opening soon'],'state.ended':['종료','Ended'],'state.permanent':['상설','Permanent'],
 'stateChip.ongoing':['진행 중','On now'],'stateChip.upcoming':['개막 예정','Opening soon'],'stateChip.ended':['종료','Ended'],'stateChip.permanent':['상설','Permanent'],
 'kind.permanent':['상설','Permanent'],'kind.temporary':['기간형','Temporary'],
 // sync status (설정): honest wording, nothing here is live
 'sync.archive':['아카이브 프로젝트','Archive projects'],'sync.archiveOff':['서버에 연결되지 않아 편집부 수록 장소와 Wikidata 장소만 보여요','Not connected to the server: only curated and Wikidata places are shown'],
 'sync.archiveList':['아카이브 목록','Archive list'],'sync.every6h':['6시간마다 자동 갱신 · 마지막 갱신 {time}','Refreshes every 6 hours · last refreshed {time}'],'sync.never':['아직 없음','not yet'],
 'sync.stale':['최근 갱신 실패, 이전 결과 사용 중','the last refresh failed; showing the previous list'],'sync.unavailable':['지금은 불러올 수 없음','unavailable right now'],'sync.loading':['불러오는 중…','loading…'],'sync.truncated':['기기 저장 공간 때문에 일부만 보관','only part is stored on this device'],
 'sync.reviewRule':['웹·뉴스에서 찾은 후보는 편집 검수 후 공개돼요.','Candidates found on the web and in the news are published after an editor reviews them.'],
 // map
 'mode.label':['보기 방식','View'],'mode.list':['목록','List'],'mode.map':['지도','Map'],
 'map.title':['지도에서 만나는 빛','Light on the map'],'map.search':['지도에서 장소 검색','Search the map'],
 'map.consentTitle':['좌표가 확인된 공간을 지도에서 보세요','See places with confirmed coordinates on the map'],
 'map.consentBody':['지도를 열면 OpenStreetMap 타일 서버에 연결해요. 편집 검증 좌표와 Wikidata·수집 출처 좌표를 구분해 보여드려요.','Opening the map connects to the OpenStreetMap tile servers. Coordinates an editor verified are shown apart from those only Wikidata or a collected source reports.'],
 'map.load':['지도 불러오기','Load the map'],'map.nearby':['내 주변 찾기','Find near me'],'map.nearbyAria':['내 위치 주변 보기','Show places near me'],
 'map.sheetHandle':['장소 목록 높이 조절, 위아래 방향키 사용','Resize the list with the arrow keys'],'map.listAria':['지도 장소 목록','Places on the map'],
 'map.here':['이 지역','This area'],'map.counts':['검증 좌표 {v}곳 · Wikidata 좌표 {w}곳','{v} verified · {w} from Wikidata'],'map.countsSource':[' · 출처 좌표 {n}곳',' · {n} from sources'],
 'map.offMap':['좌표가 없거나 도시 수준인 {n}곳은 지도에 없어요.','{n} without usable coordinates are not on the map.'],'map.toList':['목록에서 보기','See the list'],
 'map.emptyTitle':['이 영역에는 좌표가 확인된 장소가 없어요','No places with confirmed coordinates here'],'map.emptyBody':['지도를 넓히거나 필터를 바꿔 보세요. 출처 없는 추정 좌표는 표시하지 않아요.','Zoom out or change the filters. Estimated coordinates without a source are never shown.'],
 'map.loading':['지도를 불러오는 중…','Loading the map…'],'map.loaded':['지도를 움직이면 목록도 함께 바뀌어요.','The list follows the map as you move it.'],'map.failed':['지도를 불러오지 못했어요. 목록과 상세 정보의 외부 지도 링크를 이용하세요.','The map could not load. Use the list and the map link on each place.'],
 'map.zoomIn':['확대','Zoom in'],'map.zoomOut':['축소','Zoom out'],
 'legend.label':['좌표 기준','Coordinates'],'legend.verified':['편집 검증 좌표','Verified by an editor'],'legend.wikidata':['Wikidata 등록 좌표','Reported on Wikidata'],'legend.source':['수집 출처 좌표 · 검증 전','Reported by a source, unverified'],
 'legend.rule':['지도 표시 기준','How places get on the map'],
 'legend.ruleText':['정확한 주소나 거리 수준의 좌표만 지도에 올려요. 편집자나 연구자가 확인한 좌표는 핀으로, Wikidata나 수집한 출처에만 적힌 좌표는 원으로 구분해요. 도시 수준 좌표, 출처 없는 좌표, 좌표가 없는 곳은 지도에 넣지 않고 목록에서만 보여요.','Only coordinates at address or street precision go on the map. Coordinates an editor or researcher confirmed are pins; those only Wikidata or a collected source reports are circles. City-level points, coordinates without a source and places without coordinates stay off the map and appear in the list only.'],
 'coord.verified':['검증 좌표','Verified coordinates'],'coord.wikidata':['Wikidata 좌표','Wikidata coordinates'],'coord.source':['출처 좌표 · 검증 전','Source coordinates, unverified'],
 'pop.details':['상세 보기','Details'],'pop.verified':['좌표 출처: 편집 검증 좌표','Coordinates: verified by an editor'],'pop.wikidata':['좌표 출처: Wikidata 등록 좌표 · 편집 검토 전','Coordinates: reported on Wikidata, not reviewed'],'pop.source':['좌표 출처: 수집한 출처({host}) · 편집 검토 전','Coordinates: reported by a collected source ({host}), not reviewed'],
 'nearby.title':['가까운 좌표 보유 장소','Nearest places with coordinates'],'nearby.distance':['직선 {d}km','{d} km in a straight line'],'nearby.none':['좌표가 확인된 장소가 없어요. 지역 이름으로 검색해 보세요.','No places with confirmed coordinates. Search by a place name.'],'nearby.failed':['위치를 확인하지 못했어요. 발견에서 지역 이름으로 검색해 보세요.','Your location could not be found. Search by a place name in Explore.']
};
const ko={},en={};for(const [k,[a,b]] of Object.entries(S)){ko[k]=a;en[k]=b}
function t(lang,key,vars){let s=(lang==='en'?en:ko)[key];if(s===undefined)return key;return vars?s.replace(/\{(\w+)\}/g,(m,k)=>vars[k]===undefined||vars[k]===null?'':String(vars[k])):s}
return {LANGS:[['ko','한국어'],['en','English']],strings:S,ko,en,t};
});
