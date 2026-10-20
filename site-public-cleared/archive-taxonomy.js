// Controlled vocabularies of the media facade archive (docs/ARCHIVE_SPEC.md §4), with Korean and English labels.
// One source for the app, the admin console, the collector tests and the SQL check constraints (tests compare them).
(function(root,factory){const a=factory();if(typeof module==='object'&&module.exports)module.exports=a;else root.AOLTaxonomy=a})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
// [key, Korean, English]
const vocab={
 project_type:[['media_facade','미디어파사드','Media facade'],['projection_mapping','프로젝션 매핑','Projection mapping'],['urban_screen','도시 대형 스크린','Urban screen'],['media_wall','미디어월','Media wall'],['interactive_installation','인터랙티브 설치','Interactive installation'],['light_art','라이트아트','Light art'],['festival_program','축제·전시 프로그램','Festival / exhibition programme'],['media_architecture','미디어 건축·공간','Media architecture'],['other','기타','Other']],
 installation_method:[['led_mesh','LED 메시','LED mesh'],['led_cabinet_screen','LED 캐비닛 스크린','LED cabinet screen'],['led_linear_pixel','LED 라인·픽셀 부착','Linear / point LED pixels'],['led_media_glass','미디어 글라스','Media glass'],['led_backlit_cladding','외장재 후면 LED','Backlit cladding'],['projection','프로젝션','Projection'],['kinetic','키네틱','Kinetic'],['lcd_panel','LCD 패널','LCD panels'],['mixed','복합','Mixed'],['other','기타','Other']],
 envelope_type:[['glass_curtain_wall','유리 커튼월','Glass curtain wall'],['metal_mesh','금속 메시','Metal mesh'],['perforated_metal','타공 금속판','Perforated metal'],['stone_masonry','석재·조적','Stone / masonry'],['concrete','콘크리트','Concrete'],['membrane_etfe','막·ETFE','Membrane / ETFE'],['louvres_fins','루버·핀','Louvres / fins'],['bridge_infrastructure','교량·인프라','Bridge / infrastructure'],['historic_facade','역사 건축물 입면','Historic facade'],['other','기타','Other']],
 technology:[['led_rgb','RGB LED','RGB LED'],['led_mono','단색 LED','Monochrome LED'],['pixel_points','포인트 픽셀','Point pixels'],['laser_projector','레이저 프로젝터','Laser projector'],['lamp_projector','램프 프로젝터','Lamp projector'],['sensors','센서','Sensors'],['mobile_interaction','모바일 연동','Mobile interaction'],['sound','사운드','Sound'],['realtime_data','실시간 데이터','Real-time data'],['generative','제너러티브','Generative'],['anamorphic_3d','아나모픽 3D','Anamorphic 3D']],
 content_type:[['artwork','예술 작품','Artwork'],['generative','제너러티브','Generative'],['data_visualization','데이터 시각화','Data visualisation'],['advertising','광고','Advertising'],['information','정보 안내','Information'],['event_program','행사 프로그램','Event programme'],['interactive','인터랙티브','Interactive'],['anamorphic_3d','아나모픽 3D','Anamorphic 3D'],['mixed','복합','Mixed']],
 spatial_context:[['plaza','광장','Plaza'],['street','가로','Street'],['waterfront','수변','Waterfront'],['skyline','스카이라인·고층','Skyline / high-rise'],['transit_hub','교통 거점','Transit hub'],['cultural_district','문화 지구','Cultural district'],['commercial_district','상업 지구','Commercial district'],['campus','캠퍼스','Campus'],['park','공원','Park'],['heritage_site','역사 유산','Heritage site'],['bridge','교량','Bridge'],['interior_atrium','실내 아트리움','Interior atrium']],
 operating_status:[['operating','운영 중','Operating'],['seasonal','시즌 운영','Seasonal'],['event_based','행사 때 운영','Event-based'],['ended','종료','Ended'],['inactive','운영 중단','Inactive'],['demolished','철거','Demolished'],['unknown','확인 필요','Unknown']],
 region:[['east_asia','동아시아','East Asia'],['southeast_asia','동남아시아','Southeast Asia'],['south_asia','남아시아','South Asia'],['central_asia','중앙아시아','Central Asia'],['middle_east','중동','Middle East'],['europe','유럽','Europe'],['africa','아프리카','Africa'],['north_america','북미','North America'],['latin_america','중남미','Latin America'],['oceania','오세아니아','Oceania']],
 record_origin:[['curated','편집부 수록','Curated'],['auto_collected','자동 수집','Auto-collected'],['editor_created','편집부 등록','Editor-created']],
 review_status:[['unreviewed','미검수','Unreviewed'],['editor_verified','편집 검수','Editor-verified'],['researcher_assessed','연구자 평가','Researcher-assessed']],
 field_state:[['unverified','미확인','Unverified'],['source_reported','출처 기재','Source-reported'],['derived','분류 추정','Derived'],['editor_verified','편집 확인','Editor-verified'],['researcher_assessed','연구자 평가','Researcher-assessed']],
 visibility:[['draft','초안','Draft'],['published','공개','Published'],['hidden','비공개','Hidden']],
 update_status:[['current','최신','Current'],['new_info','새 정보 확인 중','New information'],['stale','갱신 필요','Stale'],['link_broken','링크 오류','Broken link']],
 source_kind:[['official','공식','Official'],['public_agency','공공기관','Public agency'],['academic','학술','Academic'],['specialist_media','전문 매체','Specialist media'],['news','뉴스','News'],['blog','블로그','Blog'],['wikidata','Wikidata','Wikidata'],['search_result','검색 결과','Search result']],
 link_state:[['unknown','미점검','Not checked'],['ok','정상','OK'],['redirect','이동됨','Redirected'],['broken','연결 안 됨','Broken'],['robots_disallowed','점검 제외(robots)','Excluded by robots.txt'],['blocked','차단','Blocked']],
 candidate_status:[['needs_review','검수 대기','Needs review'],['uncertain','판단 보류','Uncertain'],['auto_ignored','자동 제외','Auto-ignored'],['approved','승인','Approved'],['merged','병합','Merged'],['rejected','반려','Rejected'],['duplicate','중복','Duplicate']],
 candidate_label:[['facade_project','미디어파사드 프로젝트','Facade project'],['event_program','행사·프로그램','Event / programme'],['ad_screen','광고 전광판','Advertising screen'],['product_vendor','제품·업체 홍보','Product / vendor'],['irrelevant','무관','Irrelevant'],['uncertain','불확실','Uncertain']],
 credit_role:[['architect','건축가','Architect'],['facade_designer','파사드 설계','Facade designer'],['media_artist','미디어아티스트','Media artist'],['lighting_designer','조명 디자이너','Lighting designer'],['manufacturer','제작사','Manufacturer'],['operator','운영기관','Operator'],['owner','소유주','Owner'],['curator','큐레이터','Curator'],['producer','제작·기획','Producer'],['other','기타','Other']],
 rule_kind:[['gdelt','GDELT 뉴스','GDELT news'],['rss','RSS 피드','RSS feed'],['websub','WebSub 푸시','WebSub push'],['naver_news','네이버 뉴스','NAVER news'],['naver_blog','네이버 블로그','NAVER blog'],['brave','Brave 검색','Brave Search'],['wikidata','Wikidata','Wikidata']]
};
// ISO 3166-1 alpha-2 → region. Middle East is its own region (as the archive brief asks), Mexico and the Caribbean
// belong to Latin America, Egypt to Africa, Turkey and the Caucasus to the Middle East / Europe as listed.
const R={
 east_asia:'KR KP JP CN TW HK MO MN',
 southeast_asia:'SG MY TH VN PH ID KH LA MM BN TL',
 south_asia:'IN PK BD LK NP BT MV AF',
 central_asia:'KZ UZ TM KG TJ',
 middle_east:'AE SA QA KW BH OM YE IQ IR IL PS JO LB SY TR CY',
 europe:'GB IE FR DE NL BE LU CH AT IT ES PT GR MT DK NO SE FI IS EE LV LT PL CZ SK HU SI HR BA RS ME MK AL XK BG RO MD UA BY RU GE AM AZ LI MC SM VA AD FO GL GI IM JE GG AX',
 africa:'EG MA DZ TN LY SD SS ET ER DJ SO KE UG TZ RW BI CD CG CF CM GA GQ ST NG NE TD ML BF SN GM GW GN SL LR CI GH TG BJ MR CV AO ZM ZW MW MZ MG MU SC KM NA BW ZA LS SZ RE YT SH EH',
 north_america:'US CA BM PM',
 latin_america:'MX GT BZ SV HN NI CR PA CU JM HT DO PR BS BB TT AG DM GD KN LC VC AW CW SX BQ KY TC VG VI AI MS GP MQ BL MF CO VE GY SR GF EC PE BO BR PY UY AR CL FK',
 oceania:'AU NZ PG FJ SB VU NC PF WS TO KI TV NR FM MH PW GU MP AS CK NU TK WF'
};
const regionByIso={};for(const [r,codes] of Object.entries(R))for(const c of codes.split(' '))regionByIso[c]=r;
function keys(name){return (vocab[name]||[]).map(v=>v[0])}
function valid(name,key){return keys(name).includes(key)}
function label(name,key,lang){const v=(vocab[name]||[]).find(x=>x[0]===key);return v?(lang==='en'?v[2]:v[1]):''}
function regionOf(iso2){return regionByIso[String(iso2||'').toUpperCase()]||null}
// Korean regions (docs/STATIC_ARCHIVE.md, v0.18 addendum "kr_region"), kept apart from vocab so the pipeline's own
// kr_region vocabulary can sit next to it: the eight keys in display order with labels, and a gazetteer the app uses
// only when a record has no kr_region field at all (datasets older than v0.18). The first place name in the text wins
// ("경기도 광주시" is Gyeonggi, "광주광역시" Gwangju); ambiguous names (고성) are left out, so they stay unknown.
const krRegions=[['seoul','서울','Seoul'],['gyeonggi_incheon','경기·인천','Gyeonggi · Incheon'],['gangwon','강원','Gangwon'],['daejeon_sejong_chungcheong','대전·세종·충청','Daejeon · Sejong · Chungcheong'],['gwangju_jeolla','광주·전라','Gwangju · Jeolla'],['daegu_gyeongbuk','대구·경북','Daegu · Gyeongbuk'],['busan_ulsan_gyeongnam','부산·울산·경남','Busan · Ulsan · Gyeongnam'],['jeju','제주','Jeju']];
const KR_PLACES={
 seoul:'서울 seoul',
 gyeonggi_incheon:'경기 인천 gyeonggi incheon 수원 suwon 성남 seongnam 고양 goyang 용인 yongin 부천 bucheon 안산 ansan 안양 anyang 남양주 namyangju 화성 hwaseong 평택 pyeongtaek 의정부 uijeongbu 시흥 siheung 파주 paju 김포 gimpo 광명 gwangmyeong 하남 hanam 군포 gunpo 오산 osan 이천 icheon 안성 anseong 구리 guri 양주 yangju 포천 pocheon 의왕 uiwang 여주 yeoju 동두천 dongducheon 과천 gwacheon 가평 gapyeong 양평 yangpyeong 연천 yeoncheon 송도 songdo 판교 pangyo 일산 ilsan',
 gangwon:'강원 gangwon 춘천 chuncheon 원주 wonju 강릉 gangneung 속초 sokcho 동해 donghae 삼척 samcheok 태백 taebaek 평창 pyeongchang 정선 jeongseon 홍천 hongcheon 양양 yangyang 인제 inje 철원 cheorwon 화천 hwacheon 양구 yanggu 영월 yeongwol 횡성 hoengseong',
 daejeon_sejong_chungcheong:'대전 daejeon 세종 sejong 충청 충청북 충청남 충북 충남 chungcheong chungcheongbuk chungcheongnam chungbuk chungnam 청주 cheongju 충주 chungju 제천 jecheon 천안 cheonan 아산 asan 공주 gongju 보령 boryeong 서산 seosan 논산 nonsan 당진 dangjin 계룡 gyeryong 단양 danyang 부여 buyeo 태안 taean 홍성 hongseong 예산 yesan 서천 seocheon 옥천 okcheon 보은 boeun 영동 yeongdong 진천 jincheon 음성 eumseong 괴산 goesan 증평 jeungpyeong 청양 cheongyang 금산 geumsan',
 gwangju_jeolla:'광주 gwangju 전라 전라북 전라남 전북 전남 jeolla jeollabuk jeollanam jeonbuk jeonnam 전주 jeonju 익산 iksan 군산 gunsan 정읍 jeongeup 남원 namwon 김제 gimje 목포 mokpo 여수 yeosu 순천 suncheon 나주 naju 광양 gwangyang 담양 damyang 곡성 gokseong 구례 gurye 보성 boseong 화순 hwasun 장흥 jangheung 강진 gangjin 해남 haenam 영암 yeongam 무안 muan 함평 hampyeong 영광 yeonggwang 장성 jangseong 완도 wando 진도 jindo 신안 sinan 고창 gochang 부안 buan 무주 muju 진안 jinan 장수 jangsu 임실 imsil 순창 sunchang 완주 wanju',
 daegu_gyeongbuk:'대구 daegu 경상북 경북 gyeongsangbuk gyeongbuk 포항 pohang 경주 gyeongju 구미 gumi 안동 andong 김천 gimcheon 영주 yeongju 영천 yeongcheon 상주 sangju 문경 mungyeong 경산 gyeongsan 울진 uljin 울릉 ulleung 청도 cheongdo 칠곡 chilgok 성주 seongju 고령 goryeong 예천 yecheon 봉화 bonghwa 의성 uiseong 청송 cheongsong 영양 yeongyang 영덕 yeongdeok 군위 gunwi',
 busan_ulsan_gyeongnam:'부산 busan 울산 ulsan 경상남 경남 gyeongsangnam gyeongnam 창원 changwon 마산 masan 진해 jinhae 진주 jinju 김해 gimhae 양산 yangsan 거제 geoje 통영 tongyeong 사천 sacheon 밀양 miryang 함안 haman 창녕 changnyeong 남해 namhae 하동 hadong 산청 sancheong 함양 hamyang 거창 geochang 합천 hapcheon 의령 uiryeong 해운대 haeundae',
 jeju:'제주 jeju 서귀포 seogwipo'
};
const krPlace=new Map();for(const [k,v] of Object.entries(KR_PLACES))for(const n of v.split(' '))krPlace.set(n,k);
for(const [a,b] of [['north chungcheong','chungcheongbuk'],['south chungcheong','chungcheongnam'],['north jeolla','jeollabuk'],['south jeolla','jeollanam'],['north gyeongsang','gyeongsangbuk'],['south gyeongsang','gyeongsangnam']])krPlace.set(a,krPlace.get(b));
const KR_SUFFIX=/(특별자치시|특별자치도|특별시|광역시|시|군|구|도|읍|면)$/;
function krRegionOf(...texts){for(const raw of texts){const words=String(raw||'').normalize('NFKC').toLowerCase().split(/[^0-9a-z가-힣]+/).filter(Boolean);for(let i=0;i<words.length;i++){const w=words[i],pair=i?words[i-1]+' '+w:'',hit=krPlace.get(pair)||krPlace.get(w)||(/[가-힣]/.test(w)?krPlace.get(w.replace(KR_SUFFIX,'')):null);if(hit)return hit}}return null}
function krRegionLabel(key,lang){const v=krRegions.find(x=>x[0]===key);return v?(lang==='en'?v[2]:v[1]):''}
// Archive fields shown on a project page, grouped as in the brief (§5: basic, technical/architectural, context).
const fields={
 basic:['name_original','name_en','name_ko','country_iso2','city','address','year_installed','year_completed','year_operating_since','operating_status','building_name','project_type','credits'],
 technical:['installation_method','envelope_type','technology','display_area_m2','resolution_text','pixel_pitch_mm','content_type','interactive'],
 context:['viewing_points','spatial_context','urban_context']
};
// [field, Korean, English] labels of archive fields (project page, exports, data dictionary). Added by the app track.
const fieldLabels=Object.fromEntries([
 ['name_original','원어 이름','Original name'],['name_original_lang','원어','Original language'],['name_en','영문 이름','English name'],['name_ko','한국어 이름','Korean name'],['aliases','다른 이름','Other names'],
 ['country_iso2','국가','Country'],['region','권역','Region'],['city','도시','City'],['district','구역','District'],['address','주소','Address'],['latitude','위도','Latitude'],['longitude','경도','Longitude'],['location_precision','위치 정밀도','Location precision'],
 ['year_installed','설치 연도','Year installed'],['year_completed','완공·개시 연도','Year completed or opened'],['year_operating_since','운영 시작 연도','Operating since'],['year_ended','운영 종료 연도','Year ended'],['operating_status','운영 상태','Operating status'],
 ['building_name','건물','Building'],['project_type','프로젝트 유형','Project type'],['credits','참여자','Credits'],
 ['installation_method','설치 방식','Installation method'],['envelope_type','건축 외피','Building envelope'],['technology','기술','Technology'],['display_area_m2','표시 면적(㎡)','Display area (m²)'],['resolution_text','해상도','Resolution'],['pixel_pitch_mm','픽셀 피치(mm)','Pixel pitch (mm)'],['content_type','콘텐츠 유형','Content type'],['interactive','인터랙션','Interactive'],
 ['viewing_points','관람 위치','Viewing points'],['spatial_context','공간 맥락','Spatial context'],['urban_context','도시 맥락','Urban context'],
 ['summary_ko','요약(한국어)','Summary (Korean)'],['summary_en','요약(영어)','Summary (English)'],['wikidata_qid','Wikidata','Wikidata'],['official_url','공식 웹사이트','Official website'],
 ['record_origin','기록 출처','Record origin'],['review_status','검수 상태','Review status'],['update_status','갱신 상태','Update status'],['field_status','항목별 상태','Field states'],
 ['first_collected_at','처음 수집','First collected'],['last_collected_at','마지막 수집','Last collected'],['last_verified_at','마지막 검수','Last verified']
].map(([k,ko,en])=>[k,[ko,en]]));
const groupLabels={basic:['기본 정보','Basic information'],technical:['기술·건축 정보','Technical and architectural'],context:['맥락','Context']};
function fieldLabel(key,lang){const v=fieldLabels[key];return v?(lang==='en'?v[1]:v[0]):key}
// Country names come from the runtime's own locale data (Intl.DisplayNames), so no list of names is kept here.
const names={};
function countryName(iso2,lang){const c=String(iso2||'').toUpperCase();if(!/^[A-Z]{2}$/.test(c))return '';const l=lang==='en'?'en':'ko';try{const d=names[l]||(names[l]=new Intl.DisplayNames([l],{type:'region'}));const n=d.of(c);return n&&n!==c?n:c}catch{return c}}
return {vocab,keys,valid,label,regionOf,regionByIso,fields,fieldLabels,groupLabels,fieldLabel,countryName,krRegions,krRegionOf,krRegionLabel};
});
