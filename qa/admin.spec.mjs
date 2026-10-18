// Archive operations console (site-public-cleared/admin/) against a mocked Supabase under the production CSP.
// The exact RPC names and parameter objects asserted here are the console's half of ARCHIVE_SPEC §4.
import {test,expect} from './fixtures.mjs';
import AxeBuilder from '@axe-core/playwright';
import {mockSupabase,signIn,seed,token,USERS,ID,KEY,PASSWORD,XSS,XSS_SCRIPT,XSS_ATTR,TAB_LABELS,TABS_BY_ROLE} from './admin-fixtures.mjs';

const tab=(page,id)=>page.locator('#nav').getByRole('link',{name:TAB_LABELS[id],exact:true});
async function openTab(page,id){
 await tab(page,id).click();
 await expect(page.locator('#view-'+id)).toBeVisible();
 await expect(page.locator('#view-'+id+' h1')).toBeVisible();
}
const drawer=page=>page.locator('#drawer');
// Fails the test on any script dialog: an XSS payload that ran would open one.
const noDialogs=page=>page.on('dialog',d=>{throw Error('unexpected dialog: '+d.message())});
async function noErrorsShown(page,id){
 await page.waitForLoadState('networkidle');
 await expect(page.locator(`#view-${id} .notice.error`)).toHaveCount(0);
}

test.describe('sign-in',()=>{
 test('a wrong password shows a plain error and keeps the login screen',async({page})=>{
  const m=await mockSupabase(page);
  await page.goto('/admin/');
  await page.getByLabel('이메일').fill(USERS.admin.email);
  await page.getByLabel('비밀번호').fill('wrong');
  await page.getByRole('button',{name:'로그인'}).click();
  await expect(page.locator('#loginMsg')).toHaveText('이메일 또는 비밀번호가 맞지 않아요.');
  await expect(page.locator('#nav')).toBeHidden();
  expect(m.rpcs('archive_role')).toHaveLength(0);
 });
 test('an account without a role is signed out with a clear message',async({page})=>{
  const m=await mockSupabase(page);
  await page.goto('/admin/');
  await page.getByLabel('이메일').fill(USERS.nobody.email);
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button',{name:'로그인'}).click();
  await expect(page.locator('#loginMsg')).toContainText('운영 역할이 없어서 로그아웃했어요');
  await expect(page.locator('#nav')).toBeHidden();
  await expect(page.locator('#loginView')).toBeVisible();
  expect(m.last('archive_role').authorization).toBe('Bearer '+token(USERS.nobody));
  await expect.poll(()=>m.calls.filter(c=>c.name==='logout').length).toBe(1);
  expect(m.calls.filter(c=>c.kind==='rpc').map(c=>c.name)).toEqual(['archive_role']);
 });
 test('a database without archive_role signs the user out and says why',async({page})=>{
  await mockSupabase(page,{fail:{archive_role:{status:404,body:{code:'PGRST202',message:'Could not find the function public.archive_role'}}}});
  await page.goto('/admin/');
  await page.getByLabel('이메일').fill(USERS.admin.email);
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button',{name:'로그인'}).click();
  await expect(page.locator('#loginMsg')).toContainText('archive_role 함수가 없어요');
  await expect(page.locator('#nav')).toBeHidden();
 });
 for(const role of ['admin','editor','researcher'])test(`${role}: signs in, sees the role and exactly its tabs`,async({page})=>{
  await mockSupabase(page);
  await signIn(page,role);
  await expect(page.locator('#whoRole')).toHaveText({admin:'관리자',editor:'편집자',researcher:'연구자'}[role]);
  await expect(page.locator('#nav a')).toHaveText(TABS_BY_ROLE[role].map(t=>TAB_LABELS[t]));
  await expect(page.locator('#view-'+TABS_BY_ROLE[role][0])).toBeVisible();
  // A tab outside the role falls back to the first allowed one.
  await page.goto('/admin/#settings');await page.reload();
  await expect(page.locator('#view-'+(role==='admin'?'settings':TABS_BY_ROLE[role][0]))).toBeVisible();
  await page.getByRole('button',{name:'로그아웃'}).click();
  await expect(page.locator('#loginView')).toBeVisible();
  await expect(page.locator('#nav')).toBeHidden();
 });
});

for(const role of ['admin','editor','researcher'])test(`every tab renders for ${role}`,async({page})=>{
 await mockSupabase(page);noDialogs(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await signIn(page,role);
 for(const id of TABS_BY_ROLE[role]){await openTab(page,id);await noErrorsShown(page,id)}
 if(role!=='researcher'){
  await openTab(page,'dashboard');
  await expect(page.locator('#runNowCard')).toBeVisible({visible:role==='admin'});
  await expect(page.locator('#dashTiles .tile').first()).toBeVisible();
  await expect(page.locator('#dashTiles')).toContainText('검수 대기');
  await expect(page.locator('#dashTiles .tile').first().locator('.tile-num')).toHaveText('5');
  await expect(page.locator('#dashRules')).toContainText('Archinect RSS');
  await expect(page.locator('#dashRuns tbody tr')).toHaveCount(4);
  await openTab(page,'runs');
  await expect(page.getByRole('button',{name:'다시 시도'})).toHaveCount(role==='admin'?5:0);
 }
 expect(errors).toEqual([]);
});

test.describe('review queue',()=>{
 test('lists candidates with label, score, confidence, hits and dates; j/k/Enter/Esc and / work',async({page})=>{
  const m=await mockSupabase(page);
  await signIn(page,'editor','#queue');
  const items=page.locator('#queueList .qitem');
  await expect(items).toHaveCount(5);
  expect(m.last('archive_admin_list_candidates').body).toEqual({p_status:null,p_q:null,p_min_conf:0,p_limit:50,p_offset:0});
  await expect(items.first()).toContainText('BIX Media Facade, Kunsthaus Graz');
  await expect(items.first()).toContainText('미디어파사드 프로젝트');
  await expect(items.first()).toContainText('점수 82');
  await expect(items.first()).toContainText('신뢰도 76');
  await expect(items.first()).toContainText('기사 2건');
  await expect(items.first()).toContainText('처음');
  await expect(page.locator('#queueKeys')).toContainText('j 다음 후보');
  await page.locator('body').press('j');
  await expect(items.nth(0)).toHaveAttribute('aria-current','true');
  await expect(drawer(page).locator('h2')).toHaveText('BIX Media Facade, Kunsthaus Graz');
  await page.keyboard.press('j');await page.keyboard.press('j');
  await expect(items.nth(2)).toHaveAttribute('aria-current','true');
  await expect(items.nth(0)).not.toHaveAttribute('aria-current','true');
  await page.keyboard.press('k');
  await expect(items.nth(1)).toHaveAttribute('aria-current','true');
  await expect(drawer(page).locator('h2')).toHaveText('Medienfassade am Hauptbahnhof');
  await page.keyboard.press('Escape');
  await expect(page.locator('#queueList [aria-current]')).toHaveCount(0);
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(drawer(page).locator('h2')).toHaveText('Medienfassade am Hauptbahnhof');
  await page.keyboard.press('/');
  await expect(page.locator('#queueSearch')).toBeFocused();
  // j typed into the search box is text, not navigation.
  await page.keyboard.type('jk');
  await expect(page.locator('#queueSearch')).toHaveValue('jk');
  await expect(items.nth(1)).toHaveAttribute('aria-current','true');
 });
 test('the detail shows every hit, the reasons, the location and suggested projects',async({page})=>{
  await mockSupabase(page);
  await signIn(page,'editor','#queue');
  await page.locator('#queueList .qitem').first().click();
  const d=drawer(page);
  await expect(d.locator('.hit')).toHaveCount(2);
  const a=d.locator('.hit a').first();
  await expect(a).toHaveText('BIX media facade at Kunsthaus Graz is relit after restoration');
  await expect(a).toHaveAttribute('href','https://www.dezeen.com/2026/10/10/bix-media-facade-kunsthaus-graz-relit/');
  await expect(a).toHaveAttribute('target','_blank');
  await expect(a).toHaveAttribute('rel','noopener noreferrer');
  await expect(d.locator('.hit').first()).toContainText('Dezeen');
  await expect(d.locator('.hit').first()).toContainText('acrylic skin');
  await expect(d.locator('.reasons li')).toHaveCount(4);
  await expect(d).toContainText('오스트리아 (AT)');
  await expect(d).toContainText('47.0713, 15.4342');
  await expect(d.locator('.picklist')).toContainText('Kunsthaus Graz BIX');
  await expect(d.locator('.picklist')).toContainText('유사도 62%');
 });
 test('approve_new sends the exact payload from the prefilled form',async({page})=>{
  const m=await mockSupabase(page);
  await signIn(page,'editor','#queue');
  await page.locator('#queueList .qitem').first().click();
  await drawer(page).getByRole('button',{name:'새 프로젝트로 승인'}).click();
  const f=page.locator('form[data-form="rv-approve"]');
  await expect(f.getByLabel('원어 이름')).toHaveValue('BIX Media Facade, Kunsthaus Graz');
  await expect(f.getByLabel('국가')).toHaveValue('AT');
  await expect(f.getByLabel('국가').locator('option:checked')).toHaveText('오스트리아 (AT)');
  await expect(f.getByLabel('프로젝트 유형')).toHaveValue('media_facade');
  await expect(f.getByLabel('프로젝트 유형').locator('option:checked')).toHaveText('미디어파사드');
  await f.getByLabel('한국어 이름').fill('쿤스트하우스 그라츠 BIX');
  await f.getByLabel('설치 연도').fill('2003');
  await f.getByLabel('설치 방식').selectOption('led_linear_pixel');
  await f.getByLabel('승인하면서 바로 공개').check();
  await f.getByRole('button',{name:'승인하고 프로젝트 만들기'}).click();
  await expect(page.locator('#toast')).toHaveText('새 프로젝트로 승인했어요.');
  expect(m.last('archive_admin_review_candidate').body).toEqual({p_id:ID.c1,p_action:'approve_new',p_payload:{
   name_original:'BIX Media Facade, Kunsthaus Graz',name_original_lang:'en',name_ko:'쿤스트하우스 그라츠 BIX',country_iso2:'AT',city:'Graz',
   latitude:47.0713,longitude:15.4342,project_type:'media_facade',installation_method:'led_linear_pixel',year_installed:2003,publish:true}});
  // The approved candidate leaves the queue and the next one opens.
  await expect(page.locator('#queueList .qitem')).toHaveCount(4);
  await expect(drawer(page).locator('h2')).toHaveText('Medienfassade am Hauptbahnhof');
 });
 test('reject needs a note; attach, merge, ignore and reopen send their payloads',async({page})=>{
  const m=await mockSupabase(page);
  await signIn(page,'editor','#queue');
  await page.locator('#queueList .qitem',{hasText:'강남대로'}).click();
  await drawer(page).getByRole('button',{name:'반려',exact:true}).click();
  await page.getByRole('button',{name:'반려하기'}).click();
  await expect(page.locator('#rvNoteErr')).toHaveText('반려 사유를 적어 주세요.');
  await expect(page.locator('#rvNote')).toHaveAttribute('aria-invalid','true');
  await expect(page.locator('#rvNote')).toBeFocused();
  expect(m.rpcs('archive_admin_review_candidate')).toHaveLength(0);
  await page.locator('#rvNote').fill('광고 전광판 임대 기사예요.');
  await page.getByRole('button',{name:'반려하기'}).click();
  await expect(page.locator('#toast')).toHaveText('반려했어요.');
  expect(m.last('archive_admin_review_candidate').body).toEqual({p_id:ID.c3,p_action:'reject',p_payload:{note:'광고 전광판 임대 기사예요.'}});
  // Attach through a suggested match.
  await page.locator('#queueList .qitem',{hasText:'BIX'}).click();
  await drawer(page).getByRole('button',{name:'이 프로젝트에 연결'}).click();
  await expect.poll(()=>m.last('archive_admin_review_candidate').body).toEqual({p_id:ID.c1,p_action:'attach',p_payload:{project_id:ID.p2}});
  // Attach through the project search.
  await page.locator('#queueList .qitem',{hasText:'東京'}).click();
  await drawer(page).getByRole('button',{name:'기존 프로젝트에 연결'}).click();
  await page.getByRole('searchbox',{name:'연결할 프로젝트 검색'}).fill('갤러리아');
  await page.locator('form[data-form="rv-attach-search"]').getByRole('button',{name:'검색'}).click();
  await expect.poll(()=>m.last('archive_admin_list_projects')?.body).toEqual({p_q:'갤러리아',p_visibility:null,p_limit:10,p_offset:0});
  await page.locator('#rvAttachResults').getByRole('button',{name:'이 프로젝트에 연결'}).click();
  await expect.poll(()=>m.last('archive_admin_review_candidate').body).toEqual({p_id:ID.c4,p_action:'attach',p_payload:{project_id:ID.p1}});
  // Merge into another candidate.
  await page.locator('#queueList .qitem',{hasText:'Medienfassade'}).click();
  await drawer(page).getByRole('button',{name:'다른 후보와 병합'}).click();
  await page.getByLabel('합칠 대상 후보').selectOption(ID.c2);
  await page.getByRole('button',{name:'병합하기'}).click();
  await expect.poll(()=>m.last('archive_admin_review_candidate').body).toEqual({p_id:ID.c5,p_action:'merge',p_payload:{into_candidate_id:ID.c2}});
  // Ignore, then reopen it from the "자동 제외" filter.
  await page.locator('#queueList .qitem').first().click();
  await drawer(page).getByRole('button',{name:'무시'}).click();
  await expect.poll(()=>m.last('archive_admin_review_candidate').body).toEqual({p_id:ID.c2,p_action:'ignore',p_payload:{}});
  await page.locator('#queueFilter').getByLabel('상태').selectOption('auto_ignored');
  await page.getByLabel('최소 신뢰도').selectOption('60');
  await page.locator('#queueFilter').getByRole('button',{name:'적용'}).click();
  await expect.poll(()=>m.last('archive_admin_list_candidates').body).toEqual({p_status:'auto_ignored',p_q:null,p_min_conf:60,p_limit:50,p_offset:0});
  await page.locator('#queueList .qitem').first().click();
  await drawer(page).getByRole('button',{name:'다시 열기'}).click();
  await expect.poll(()=>m.last('archive_admin_review_candidate').body).toEqual({p_id:ID.c2,p_action:'reopen',p_payload:{}});
 });
});

test('the project editor sends only changed fields, shows field states, and manages sources, media, visibility and merges',async({page})=>{
 const m=await mockSupabase(page);
 await signIn(page,'editor','#projects');
 expect(m.last('archive_admin_list_projects').body).toEqual({p_q:null,p_visibility:null,p_limit:50,p_offset:0});
 await page.locator('#projectList .pitem',{hasText:'갤러리아 센터시티'}).click();
 const ed=page.locator('#projectEditor'),pf=page.locator('#projectForm');
 const state=k=>pf.locator(`[data-state-for="${k}"]`);
 await expect(state('name_ko')).toHaveText('편집 확인');
 await expect(state('city')).toHaveText('출처 기재');
 await expect(state('project_type')).toHaveText('분류 추정');
 await expect(state('display_area_m2')).toHaveText('미확인');
 await expect(state('building_name')).toHaveText('미확인');
 await expect(pf.getByLabel('표출 면적 (m²)')).toHaveAttribute('placeholder','미확인');
 await expect(pf.locator('fieldset.group > legend')).toHaveText(['기본 정보','기술·건축','맥락','크레딧']);
 await pf.getByLabel('도시',{exact:true}).fill('천안시');
 await expect(state('city')).toHaveText('편집 확인 · 저장 전');
 await pf.getByLabel('표출 면적 (m²)').fill('1500');
 await pf.locator('[data-field="technology"]').getByLabel('센서').check();
 await pf.getByRole('button',{name:'외피 유형 값이 맞다고 확인'}).click();
 await expect(page.locator('#dirtyNote')).toHaveText('저장하지 않은 항목 4개');
 await ed.getByRole('button',{name:'크레딧 추가'}).click();
 const row=ed.locator('[data-credit]').last();
 await row.getByLabel('역할').selectOption('media_artist');
 await row.getByLabel('이름',{exact:true}).fill('Studio Light');
 await ed.getByRole('button',{name:'저장',exact:true}).click();
 await expect(page.locator('#toast')).toHaveText('저장했어요.');
 expect(m.last('archive_admin_upsert_project').body).toEqual({p_project:{id:ID.p1,city:'천안시',envelope_type:'glass_curtain_wall',technology:['led_rgb','sensors'],display_area_m2:1500,
  credits:[{role:'architect',name:'UNStudio',name_en:'UNStudio',wikidata_qid:'Q1361437'},{role:'media_artist',name:'Studio Light',name_en:null,wikidata_qid:null}]}});
 await expect(state('city')).toHaveText('편집 확인');
 await expect(state('envelope_type')).toHaveText('편집 확인');
 // Validation stays in the browser.
 await pf.getByLabel('설치 연도',{exact:true}).fill('20100');
 await ed.getByRole('button',{name:'저장',exact:true}).click();
 await expect(page.locator('#toast')).toContainText('설치 연도: 1800~2100 사이의 연도를 적어 주세요.');
 await expect(pf.getByLabel('설치 연도',{exact:true})).toHaveAttribute('aria-invalid','true');
 expect(m.rpcs('archive_admin_upsert_project')).toHaveLength(1);
 await pf.getByLabel('설치 연도',{exact:true}).fill('2010');
 // Sources: add with kind, licence and supported fields; remove with a second press.
 await ed.locator('summary',{hasText:'출처 추가'}).click();
 const sf=ed.locator('form[data-form="source-add"]');
 await sf.getByLabel('출처 주소').fill('javascript:alert(1)');
 await sf.getByRole('button',{name:'출처 추가'}).click();
 await expect(page.locator('#toast')).toHaveText('출처 주소는 http:// 또는 https://로 시작해야 해요.');
 await sf.getByLabel('출처 주소').fill('https://www.archdaily.com/1000000/galleria-centercity-revisited');
 await sf.getByLabel('제목').fill('Galleria Centercity revisited');
 await sf.getByLabel('발행처').fill('ArchDaily');
 await sf.getByLabel('출처 종류').selectOption('specialist_media');
 await sf.getByLabel('언어',{exact:true}).selectOption('en');
 await sf.getByLabel('라이선스',{exact:true}).fill('저작권 있음(링크만)');
 await sf.getByLabel('건물 이름').check();
 await sf.getByLabel('설치 방식').check();
 await sf.getByRole('button',{name:'출처 추가'}).click();
 await expect(page.locator('#toast')).toHaveText('출처를 추가했어요.');
 expect(m.last('archive_admin_add_source').body).toEqual({p_project_id:ID.p1,p_source:{url:'https://www.archdaily.com/1000000/galleria-centercity-revisited',source_kind:'specialist_media',title:'Galleria Centercity revisited',publisher:'ArchDaily',language:'en',license:'저작권 있음(링크만)'},p_supports:['building_name','installation_method']});
 await expect(ed.locator('.source')).toHaveCount(2);
 const rm=ed.locator('.source').first().getByRole('button',{name:'출처 빼기'});
 await rm.click();
 await expect(ed.locator('.source').first().getByRole('button',{name:'한 번 더 누르면 빼요'})).toBeVisible();
 expect(m.rpcs('archive_admin_remove_source')).toHaveLength(0);
 await ed.locator('.source').first().getByRole('button',{name:'한 번 더 누르면 빼요'}).click();
 await expect.poll(()=>m.last('archive_admin_remove_source')?.body).toEqual({p_project_id:ID.p1,p_source_id:'s1'});
 // Media: only a cleared, free licence may be primary.
 await ed.locator('.media-item').nth(1).getByRole('button',{name:'고치기'}).click();
 const mf=ed.locator('form[data-form="media-set"]');
 const primary=mf.getByLabel('대표 이미지로 쓰기');
 await expect(primary).toBeDisabled();
 await mf.getByLabel('사용 권리').selectOption('cleared');
 await expect(primary).toBeDisabled();
 await mf.getByLabel('라이선스',{exact:true}).fill('CC BY-NC 4.0');
 await expect(primary).toBeDisabled();
 await mf.getByRole('button',{name:'미디어 저장'}).click();
 await expect(page.locator('#toast')).toContainText('CC0, CC BY, CC BY-SA');
 await mf.getByLabel('라이선스',{exact:true}).fill('CC BY 4.0');
 await expect(primary).toBeEnabled();
 await primary.check();
 await mf.getByRole('button',{name:'미디어 저장'}).click();
 await expect(page.locator('#toast')).toHaveText('사용 가능한 이미지에는 저작자나 표기 문구가 있어야 해요.');
 await mf.getByLabel('저작자').fill('Press Office');
 await mf.getByRole('button',{name:'미디어 저장'}).click();
 await expect(page.locator('#toast')).toHaveText('미디어를 저장했어요.');
 expect(m.last('archive_admin_set_media').body).toEqual({p_project_id:ID.p1,p_media:{id:'m2',url:'https://example.org/press/galleria.jpg',page_url:'https://example.org/press',commons_file:null,license:'CC BY 4.0',license_url:null,author:'Press Office',attribution:null,rights_status:'cleared',is_primary:true}});
 await ed.locator('.media-item').first().getByRole('button',{name:'빼기'}).click();
 await ed.locator('.media-item').first().getByRole('button',{name:'한 번 더 누르면 빼요'}).click();
 await expect.poll(()=>m.last('archive_admin_remove_media')?.body).toEqual({p_media_id:'m1'});
 // Visibility: hiding needs a note.
 const vf=ed.locator('form[data-form="visibility"]');
 await vf.getByLabel('비공개').check();
 await vf.getByRole('button',{name:'공개 상태 바꾸기'}).click();
 await expect(page.locator('#toast')).toHaveText('비공개로 바꾸는 사유를 적어 주세요.');
 await vf.getByLabel('메모').fill('운영 종료 확인 중');
 await vf.getByRole('button',{name:'공개 상태 바꾸기'}).click();
 await expect(page.locator('#toast')).toHaveText('비공개로 바꿨어요.');
 expect(m.last('archive_admin_set_visibility').body).toEqual({p_project_id:ID.p1,p_visibility:'hidden',p_note:'운영 종료 확인 중'});
 // Merge another project into this one.
 await ed.getByRole('searchbox',{name:'합칠 프로젝트 검색'}).fill('Graz');
 await ed.locator('form[data-form="merge-search"]').getByRole('button',{name:'검색'}).click();
 await ed.locator('#mergeResults').getByRole('button',{name:'이 프로젝트로 합치기'}).click();
 await ed.locator('#mergeResults').getByRole('button',{name:'한 번 더 누르면 합쳐요'}).click();
 await expect.poll(()=>m.last('archive_admin_merge_projects')?.body).toEqual({p_keep:ID.p1,p_drop:ID.p2});
});

test('a new project sends its non-empty fields; the visibility filter is sent',async({page})=>{
 const m=await mockSupabase(page);
 await signIn(page,'editor','#projects');
 await page.locator('#projectFilter').getByLabel('공개 상태').selectOption('draft');
 await page.locator('#projectFilter').getByRole('button',{name:'검색'}).click();
 await expect.poll(()=>m.last('archive_admin_list_projects').body).toEqual({p_q:null,p_visibility:'draft',p_limit:50,p_offset:0});
 await expect(page.locator('#projectList .pitem')).toHaveCount(1);
 await page.getByRole('button',{name:'새 프로젝트'}).click();
 const ed=page.locator('#projectEditor');
 await ed.getByRole('button',{name:'프로젝트 만들기'}).click();
 await expect(page.locator('#toast')).toHaveText('바뀐 내용이 없어요.');
 await ed.getByLabel('영어 이름').fill('Uniqa Tower');
 await ed.getByLabel('국가').selectOption('AT');
 await ed.getByLabel('도시',{exact:true}).fill('Wien');
 await ed.getByLabel('프로젝트 유형').selectOption('media_facade');
 await ed.locator('#pf-interactive').selectOption('false');
 await ed.getByRole('button',{name:'프로젝트 만들기'}).click();
 await expect(page.locator('#toast')).toHaveText('프로젝트를 만들었어요.');
 expect(m.last('archive_admin_upsert_project').body).toEqual({p_project:{name_en:'Uniqa Tower',country_iso2:'AT',city:'Wien',project_type:'media_facade',interactive:false}});
});

test.describe('rules, keywords and settings',()=>{
 test('an editor sees rules and keywords read-only',async({page})=>{
  await mockSupabase(page);
  await signIn(page,'editor','#rules');
  await expect(page.locator('#rulesReadOnly')).toBeVisible();
  await expect(page.locator('#ruleList .rule')).toHaveCount(5);
  await expect(page.locator('#ruleList')).toContainText('"media facade" OR "media façade"');
  await expect(page.locator('#kwTable tbody tr')).toHaveCount(5);
  const view=page.locator('#view-rules');
  await expect(view.locator('button:visible',{hasText:/고치기|켜기|끄기|지우기|추가|저장/})).toHaveCount(0);
  await expect(view.locator('input:visible:not([type=search]),textarea:visible')).toHaveCount(0);
  await expect(view.locator('details:visible')).toHaveCount(0);
  await expect(view.locator('#kwEdit')).toBeHidden();
 });
 test('an admin toggles and edits rules and creates, edits and deletes keywords',async({page})=>{
  const m=await mockSupabase(page);
  await signIn(page,'admin','#rules');
  await expect(page.locator('#rulesReadOnly')).toBeHidden();
  const naver=page.locator('.rule',{hasText:'네이버 뉴스'});
  await naver.getByRole('button',{name:'켜기'}).click();
  await expect.poll(()=>m.last('archive_admin_upsert_rule')?.body).toEqual({p_rule:{id:ID.naver,enabled:true}});
  // Brave costs money: enabling it takes a second press.
  const brave=page.locator('.rule',{hasText:'Brave'});
  await brave.getByRole('button',{name:'켜기'}).click();
  await expect(brave.getByRole('button',{name:/비용이 나올 수 있어요/})).toBeVisible();
  expect(m.rpcs('archive_admin_upsert_rule')).toHaveLength(1);
  const dez=page.locator('.rule',{hasText:'Dezeen'});
  await dez.getByRole('button',{name:'고치기'}).click();
  await dez.getByLabel('주기 (시간)').fill('12');
  await dez.getByLabel('메모').fill('ETag 지원');
  await dez.getByRole('button',{name:'규칙 저장'}).click();
  await expect(page.locator('#toast')).toHaveText('규칙을 저장했어요.');
  expect(m.last('archive_admin_upsert_rule').body).toEqual({p_rule:{id:ID.dezeen,enabled:true,cadence_hours:12,query:null,url:'https://www.dezeen.com/feed/',terms_url:'https://www.dezeen.com/terms-conditions/',notes:'ETag 지원'}});
  await page.locator('summary',{hasText:'새 규칙 추가'}).click();
  const nf=page.locator('#ruleNew form');
  await nf.getByLabel('종류').selectOption('rss');
  await nf.getByLabel('이름').fill('designboom RSS');
  await nf.getByRole('button',{name:'규칙 추가'}).click();
  await expect(page.locator('#toast')).toHaveText('RSS·WebSub 규칙에는 피드 주소가 있어야 해요.');
  await nf.getByLabel('피드 주소 (RSS·WebSub)').fill('https://www.designboom.com/feed/');
  await nf.getByLabel('언어').selectOption('en');
  await nf.getByRole('button',{name:'규칙 추가'}).click();
  await expect(page.locator('#toast')).toHaveText('규칙을 추가했어요.');
  expect(m.last('archive_admin_upsert_rule').body).toEqual({p_rule:{enabled:false,cadence_hours:6,query:null,url:'https://www.designboom.com/feed/',terms_url:null,notes:null,kind:'rss',name:'designboom RSS',language:'en',region_hint:null}});
  // Keywords.
  const kf=page.locator('#kwEdit form');
  await kf.getByLabel('낱말').fill('fachada multimedia');
  await kf.getByLabel('언어').selectOption('es');
  await kf.getByLabel('가중치 (0~100)').fill('28');
  await kf.getByRole('button',{name:'키워드 추가'}).click();
  await expect(page.locator('#toast')).toHaveText('키워드를 저장했어요.');
  expect(m.last('archive_admin_upsert_keyword').body).toEqual({p_kw:{term:'fachada multimedia',language:'es',polarity:'positive',weight:28,enabled:true}});
  const kwRow=page.locator('#kwTable tr',{hasText:'building'});
  await kwRow.getByRole('button',{name:'고치기'}).click();
  await page.locator('#kwEdit').getByLabel('성격').selectOption('negative');
  await page.locator('#kwEdit').getByRole('button',{name:'키워드 저장'}).click();
  await expect.poll(()=>m.last('archive_admin_upsert_keyword').body).toEqual({p_kw:{id:'k3',term:'building',language:'en',polarity:'negative',weight:8,enabled:true}});
  const del=page.locator('#kwTable tr',{hasText:'임대'});
  await del.getByRole('button',{name:'지우기'}).click();
  await del.getByRole('button',{name:'한 번 더 누르면 지워요'}).click();
  await expect.poll(()=>m.last('archive_admin_delete_keyword')?.body).toEqual({p_term:'임대',p_language:'ko'});
  await expect(page.locator('#kwTable tr',{hasText:'임대'})).toHaveCount(0);
 });
 test('an admin saves the settings; the thresholds are checked first',async({page})=>{
  const m=await mockSupabase(page);
  await signIn(page,'admin','#settings');
  const f=page.locator('#settingsBox form');
  await expect(f.getByLabel('Wikidata 구조화 항목 자동 목록')).toBeChecked();
  await expect(f.getByLabel('검수 기준 점수')).toHaveValue('60');
  await f.getByLabel('자동 제외 기준 점수').fill('70');
  await f.getByRole('button',{name:'설정 저장'}).click();
  await expect(page.locator('#toast')).toHaveText('자동 제외 기준은 0 이상이고 검수 기준보다 낮아야 해요.');
  expect(m.rpcs('archive_admin_set_settings')).toHaveLength(0);
  await f.getByLabel('자동 제외 기준 점수').fill('30');
  await f.getByLabel('Wikidata 구조화 항목 자동 목록').uncheck();
  await f.getByRole('button',{name:'설정 저장'}).click();
  await expect(page.locator('#toast')).toHaveText('설정을 저장했어요.');
  expect(m.last('archive_admin_set_settings').body).toEqual({p_settings:{auto_list_structured:false,auto_ignore_below:30,review_threshold:60}});
 });
});

test('run now and retry send the user JWT, the apikey and the rule id; tokens never reach the console',async({page})=>{
 const m=await mockSupabase(page);const logs=[];
 page.on('console',msg=>logs.push(msg.text()));
 await signIn(page,'admin','#dashboard');
 await expect(page.locator('#runRule option')).toHaveCount(5);
 await page.locator('#runRule').selectOption(ID.dezeen);
 await page.getByRole('button',{name:'수집 실행'}).click();
 await expect(page.locator('#runResult')).toContainText('수집 요청을 마쳤어요.');
 await expect(page.locator('#runResult')).toContainText('새 후보 2');
 let call=m.calls.filter(c=>c.kind==='fn'&&c.name==='archive-collect').at(-1);
 expect(call).toMatchObject({authorization:'Bearer '+token(USERS.admin),apikey:KEY,body:{rule_ids:[ID.dezeen]}});
 await page.getByLabel('실행할 때가 된 규칙').check();
 await page.getByLabel('최대 규칙 수').fill('4');
 await page.getByRole('button',{name:'수집 실행'}).click();
 await expect.poll(()=>m.calls.filter(c=>c.name==='archive-collect').at(-1).body).toEqual({max_rules:4});
 // Retry from the jobs screen.
 await openTab(page,'runs');
 await page.locator('#ruleHealth tr',{hasText:'Archinect RSS'}).getByRole('button',{name:'다시 시도'}).click();
 await expect(page.locator('#ruleHealth [data-result]')).toContainText('수집 요청을 마쳤어요.');
 call=m.calls.filter(c=>c.name==='archive-collect').at(-1);
 expect(call).toMatchObject({authorization:'Bearer '+token(USERS.admin),apikey:KEY,body:{rule_ids:[ID.archinect]}});
 await expect(page.locator('#ruleHealth tr',{hasText:'Archinect RSS'})).toContainText('뒤');
 await page.locator('#runsRule').selectOption(ID.gdelt);
 await page.locator('#runsFilter').getByRole('button',{name:'보기'}).click();
 await expect.poll(()=>m.last('archive_admin_list_runs').body).toEqual({p_limit:50,p_rule_id:ID.gdelt});
 await expect(page.locator('#runsTable tbody tr')).toHaveCount(2);
 expect(logs.filter(l=>l.includes(token(USERS.admin)))).toEqual([]);
});

test('error states are shown in place with a plain explanation',async({page})=>{
 await mockSupabase(page,{fail:{
  archive_admin_list_candidates:{status:500,body:{code:'XX000',message:'connection reset'}},
  archive_admin_dashboard:{status:403,body:{code:'42501',message:'permission denied for function archive_admin_dashboard'}},
  archive_admin_list_updates:{status:404,body:{code:'PGRST202',message:'Could not find the function public.archive_admin_list_updates'}},
  'archive-collect':{status:502,body:{error:'upstream timeout'}}
 }});
 await signIn(page,'admin','#dashboard');
 await expect(page.locator('#dashTiles .notice.error')).toContainText('권한이 없어요.');
 await page.getByRole('button',{name:'수집 실행'}).click();
 await expect(page.locator('#runResult .notice.error')).toContainText('수집을 실행하지 못했어요.');
 await expect(page.locator('#runResult .notice.error')).toContainText('upstream timeout');
 await openTab(page,'queue');
 await expect(page.locator('#queueList .notice.error')).toContainText('후보를 불러오지 못했어요.');
 await expect(page.locator('#queueList .notice.error')).toContainText('connection reset');
 await openTab(page,'updates');
 await expect(page.locator('#updateList .notice.error')).toContainText('서버에 이 기능이 아직 없어요.');
});

test('XSS fixtures stay text on every screen and javascript: links never become links',async({page})=>{
 await mockSupabase(page);noDialogs(page);
 const check=async()=>{
  await expect(page.locator('img[src="x"],svg[onload],script:not([src]),b[onmouseover],i:not([class])')).toHaveCount(0);
  expect(await page.locator('a[href^="javascript"]').count()).toBe(0);
 };
 await signIn(page,'admin','#queue');
 await page.locator('#queueList .qitem').nth(2).click();
 await expect(drawer(page).locator('h2')).toHaveText(XSS);
 await expect(drawer(page).locator('.hit')).toContainText(XSS_SCRIPT);
 await expect(drawer(page).locator('.hit .unsafe')).toContainText('(열 수 없는 주소)');
 await expect(drawer(page).locator('.reasons')).toHaveText(XSS);
 await expect(drawer(page)).toContainText('<i>Seoul</i>');
 await expect(drawer(page).locator('.picklist')).toContainText(XSS_ATTR);
 await expect(page.locator('#queueList')).toContainText(XSS);
 await check();
 await openTab(page,'projects');
 await page.locator('#projectList .pitem',{hasText:XSS_ATTR}).click();
 await expect(page.locator('#editorTitle')).toHaveText(XSS_ATTR);
 await expect(page.locator('#projectEditor .source')).toContainText(XSS);
 await expect(page.locator('#projectEditor .source')).toContainText(XSS_SCRIPT);
 await expect(page.locator('#pf-official_url')).toHaveValue('javascript:alert(5)');
 await check();
 await openTab(page,'updates');
 await expect(page.locator('#updateList')).toContainText(XSS_ATTR);
 await check();
 await openTab(page,'runs');
 await expect(page.locator('#errorList')).toContainText('Service Unavailable '+XSS);
 await check();
 await openTab(page,'rules');
 await expect(page.locator('#ruleList')).toContainText(XSS);
 await expect(page.locator('#kwTable')).toContainText(XSS);
 await check();
 await openTab(page,'places');
 await page.locator('#legacyRows .pitem',{hasText:XSS}).click();
 await expect(page.locator('#legacyTitle')).toHaveText(XSS);
 await expect(page.locator('#legacyDetail .raw')).toContainText(XSS);
 await check();
});

test('researchers read published projects and add assessments kept apart from collected data',async({page})=>{
 const m=await mockSupabase(page);
 await signIn(page,'researcher');
 await expect(page.locator('#view-research')).toBeVisible();
 expect(m.last('archive_search').body).toEqual({p_q:null,p_filters:{},p_sort:'updated',p_limit:50,p_offset:0});
 await page.locator('#researchList .pitem').first().click();
 const d=page.locator('#researchDetail');
 await expect(d.locator('h2')).toHaveText('갤러리아 센터시티');
 await expect(d).toContainText('외장재 후면 LED');
 await expect(d).toContainText('UNStudio');
 await expect(d.locator('input:not([type=checkbox]):not([type=hidden]):not(#asMethod)')).toHaveCount(0);
 await expect(d.locator('.assessments li')).toHaveCount(1);
 await d.getByLabel('항목').selectOption('operating_status');
 await d.getByLabel('평가 값: 운영 상태').selectOption('seasonal');
 await d.getByRole('button',{name:'평가 저장'}).click();
 await expect(page.locator('#toast')).toHaveText('어떤 방법으로 판단했는지 적어 주세요.');
 await d.getByLabel('확신 정도').selectOption('high');
 await d.getByLabel('방법').fill('현장 조사 2026-09');
 await d.getByLabel('메모').fill('겨울에만 켜요.');
 await d.getByRole('button',{name:'평가 저장'}).click();
 await expect(page.locator('#toast')).toContainText('평가를 저장했어요.');
 expect(m.last('archive_research_add_assessment').body).toEqual({p_project_id:ID.p1,p_attribute:'operating_status',p_value:'seasonal',p_confidence:'high',p_method:'현장 조사 2026-09',p_note:'겨울에만 켜요.'});
 await expect(d.locator('.assessments li')).toHaveCount(2);
 await d.getByLabel('항목').selectOption('significance');
 await d.getByLabel('평가 값').fill('국내 첫 유리 외피 LED 파사드 사례');
 await d.getByLabel('방법').fill('문헌 검토');
 await d.getByRole('button',{name:'평가 저장'}).click();
 await expect.poll(()=>m.last('archive_research_add_assessment').body).toEqual({p_project_id:ID.p1,p_attribute:'significance',p_value:'국내 첫 유리 외피 LED 파사드 사례',p_confidence:'medium',p_method:'문헌 검토',p_note:null});
});

test('change detection resolves updates and opens the project',async({page})=>{
 const m=await mockSupabase(page);
 await signIn(page,'editor','#updates');
 expect(m.last('archive_admin_list_updates').body).toEqual({p_status:'open',p_limit:100});
 const cards=page.locator('#updateList .update');
 await expect(cards).toHaveCount(3);
 await expect(cards.first()).toContainText('새 출처');
 await expect(cards.first().getByRole('link',{name:'Galleria Centercity revisited'})).toHaveAttribute('rel','noopener noreferrer');
 await expect(cards.nth(2)).toContainText('설치 연도: 2003 → 2004');
 await cards.nth(2).getByRole('button',{name:'반영'}).click();
 await expect.poll(()=>m.last('archive_admin_resolve_update')?.body).toEqual({p_id:ID.u3,p_action:'apply'});
 await expect(cards).toHaveCount(2);
 await cards.first().getByRole('button',{name:'무시'}).click();
 await expect.poll(()=>m.last('archive_admin_resolve_update')?.body).toEqual({p_id:ID.u1,p_action:'dismiss'});
 await cards.first().getByRole('button',{name:'프로젝트 열기'}).click();
 await expect(page.locator('#view-projects')).toBeVisible();
 await expect(page.locator('#editorTitle')).toHaveText(XSS_ATTR);
});

test('the existing tools still work: magazine article and legacy place candidates',async({page})=>{
 const m=await mockSupabase(page);
 await signIn(page,'editor','#magazine');
 const art=page.locator('#articleForm');
 await art.getByLabel('제목').fill('빛으로 쓴 도시');
 await art.getByLabel('본문').fill('본문입니다.');
 await art.getByLabel('출처 URL').fill('javascript:alert(1)');
 await art.getByRole('button',{name:'글 등록'}).click();
 await expect(page.locator('#toast')).toHaveText('출처 URL을 확인하세요.');
 await art.getByLabel('출처 URL').fill('https://example.org/story');
 await art.getByLabel('상태').selectOption('published');
 await art.getByRole('button',{name:'글 등록'}).click();
 await expect(page.locator('#articleMsg')).toHaveText('등록했어요.');
 const ins=m.calls.find(c=>c.name==='archive_articles');
 expect(ins.method).toBe('POST');
 expect(ins.body).toMatchObject({title:'빛으로 쓴 도시',author:null,summary:'',body:'본문입니다.',source_url:'https://example.org/story',status:'published'});
 expect(typeof ins.body.published_at).toBe('string');
 await openTab(page,'places');
 await expect.poll(()=>m.last('admin_list_candidates')?.body).toEqual({p_city_code:null,p_status:null,p_min_score:0,p_search:null,p_limit:200,p_offset:0});
 await expect.poll(()=>m.last('admin_list_ingestion_jobs')?.body).toEqual({p_limit:20});
 await expect(page.locator('#legacyStats .tile').first()).toContainText('10');
 await page.locator('#legacyRows .pitem',{hasText:'Seoullo'}).click();
 await page.locator('#legacyDetail').getByRole('button',{name:'Ready'}).click();
 await expect.poll(()=>m.last('admin_update_candidate')?.body).toEqual({p_candidate_id:ID.l1,p_action:'ready',p_reason:null});
 await page.locator('#legacyRows .pitem',{hasText:'Seoullo'}).click();
 await page.locator('#legacyDetail').getByRole('button',{name:'반려',exact:true}).click();
 await page.getByRole('button',{name:'반려하기'}).click();
 await expect(page.locator('#toast')).toHaveText('반려 사유를 적어 주세요.');
 await page.getByLabel('반려 사유').fill('중복');
 await page.getByRole('button',{name:'반려하기'}).click();
 await expect.poll(()=>m.last('admin_update_candidate').body).toEqual({p_candidate_id:ID.l1,p_action:'reject',p_reason:'중복'});
 await page.locator('#legacyRows .pitem',{hasText:'Seoullo'}).click();
 await page.locator('#legacyDetail').getByRole('button',{name:'정식 장소로 만들기'}).click();
 await expect(page.getByLabel('새 place_code')).toHaveValue('AUTO-SEOUL-E1000000');
 await page.getByRole('button',{name:'만들기',exact:true}).click();
 await expect(page.locator('#toast')).toContainText('정식 장소를 만들었어요');
 expect(m.last('admin_promote_candidate').body).toEqual({p_candidate_id:ID.l1,p_place_code:'AUTO-SEOUL-E1000000'});
 await page.getByRole('button',{name:'서울',exact:true}).click();
 await expect(page.locator('#discoverMsg')).toContainText('가져옴 42');
 expect(m.calls.find(c=>c.name==='admin-discovery-command')).toMatchObject({authorization:'Bearer '+token(USERS.editor),body:{city_code:'SEOUL',candidate_limit_per_city:100}});
});

test.describe('layout',()=>{
 test.use({viewport:{width:390,height:844}});
 test('no horizontal scroll at 390 px on any tab, with details open',async({page})=>{
  await mockSupabase(page);
  const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  await page.goto('/admin/');
  expect(await overflow()).toBeLessThanOrEqual(0);
  await signIn(page,'admin');
  for(const id of TABS_BY_ROLE.admin){
   await page.locator('#nav').getByRole('link',{name:TAB_LABELS[id],exact:true}).click();
   await expect(page.locator('#view-'+id+' h1')).toBeVisible();
   await page.waitForLoadState('networkidle');
   expect(await overflow(),id).toBeLessThanOrEqual(0);
  }
  await page.locator('#nav').getByRole('link',{name:'검수 대기열'}).click();
  await page.locator('#queueList .qitem').first().click();
  await expect(drawer(page)).toBeVisible();
  await expect(page.locator('#drawerTitle')).toBeFocused();
  await drawer(page).getByRole('button',{name:'새 프로젝트로 승인'}).click();
  expect(await overflow(),'queue drawer').toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await expect(drawer(page)).toBeHidden();
  await page.locator('#nav').getByRole('link',{name:'프로젝트'}).click();
  await page.locator('#projectList .pitem').first().click();
  await expect(page.locator('#projectList')).toBeHidden();
  await page.locator('summary',{hasText:'출처 추가'}).click();
  expect(await overflow(),'project editor').toBeLessThanOrEqual(0);
  await page.getByRole('button',{name:'← 목록'}).click();
  await expect(page.locator('#projectList')).toBeVisible();
 });
});

const scan=async page=>{
 const {violations}=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
 return violations.map(v=>`${v.id} (${v.impact}): ${v.nodes.slice(0,3).map(n=>n.target.join(' ')).join(' | ')}`);
};
for(const scheme of ['light','dark'])test.describe(`a11y ${scheme}`,()=>{
 test.use({colorScheme:scheme});
 for(const width of [390,1440])test(`axe on the login and every tab @${width}`,async({page})=>{
  test.setTimeout(90000);
  await mockSupabase(page);
  await page.setViewportSize({width,height:900});
  await page.goto('/admin/');await page.waitForLoadState('networkidle');
  expect(await scan(page),'login').toEqual([]);
  await signIn(page,'admin');
  for(const id of TABS_BY_ROLE.admin){
   await page.locator('#nav').getByRole('link',{name:TAB_LABELS[id],exact:true}).click();
   await expect(page.locator('#view-'+id+' h1')).toBeVisible();
   await page.waitForLoadState('networkidle');
   if(id==='queue'){await page.locator('#queueList .qitem').first().click();await drawer(page).getByRole('button',{name:'새 프로젝트로 승인'}).click()}
   if(id==='projects')await page.locator('#projectList .pitem').first().click();
   if(id==='research')await page.locator('#researchList .pitem').first().click();
   expect(await scan(page),id).toEqual([]);
   if(id==='queue'&&width<900){await page.keyboard.press('Escape');await page.keyboard.press('Escape')}
  }
 });
});
