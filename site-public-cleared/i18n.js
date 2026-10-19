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
 'kind.permanent':['상설','Permanent'],'kind.temporary':['기간형','Temporary']
};
const ko={},en={};for(const [k,[a,b]] of Object.entries(S)){ko[k]=a;en[k]=b}
function t(lang,key,vars){let s=(lang==='en'?en:ko)[key];if(s===undefined)return key;return vars?s.replace(/\{(\w+)\}/g,(m,k)=>vars[k]===undefined||vars[k]===null?'':String(vars[k])):s}
return {LANGS:[['ko','한국어'],['en','English']],strings:S,ko,en,t};
});
