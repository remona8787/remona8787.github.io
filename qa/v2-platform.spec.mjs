// v2.0 member platform screens (site-public-cleared/platform.js, docs/PLATFORM.md) in a real browser.
// Without a backend (the public site today): no member form anywhere, an honest "준비 중", no community menu entry,
// and the photo contribution guide with a working e-mail link on a project without photos.
// With a fake backend (window.AOLPlatformAPI injected before the app, in memory): the flows a member uses, with what
// the screens send to the API. The database rules themselves are tested on Postgres (tests/platform-sql.test.mjs).
import {test,expect} from './fixtures.mjs';
import {serveDataset,serveImages} from './fixtures/site-data-routes.mjs';

const FAKE=({signedIn=true,application=null,terms='2026-11'}={})=>{
 const calls=[];window.__calls=calls;let nextId=100;
 const posts=[{id:1,kind:'review',project_id:'piccadilly-lights',author_name:'밤의 산책자',title:'피카딜리 후기 <img src=x onerror="window.__xss=1">',body:'광고판이 정말 밝았어요. <script>window.__xss=2</script>',visited_on:null,published_at:'2026-11-01T00:00:00Z',like_count:2,comment_count:0}];
 window.AOLPlatformAPI={configured:true,user:()=>signedIn?{id:'u1'}:null,
  account:async()=>({user_id:'u1',email_confirmed:true,state:{state:'active'},staff_role:null,research_terms_version:terms,application,grants:application?.status==='approved'?[{dataset_id:'aol-research',expires_at:'2027-11-01T00:00:00Z',revoked:false}]:[]}),
  profile:async()=>({display_name:'밤의 산책자',bio:null}),saveProfile:async p=>{calls.push(['saveProfile',p])},
  posts:async q=>{calls.push(['posts',q]);return posts.filter(p=>(!q.kind||p.kind===q.kind)&&(!q.project||p.project_id===q.project))},
  post:async id=>({post:posts.find(p=>p.id===id)||null,comments:[]}),
  createPost:async p=>{calls.push(['createPost',p]);return {id:nextId++,status:p.status}},
  comment:async(id,b)=>{calls.push(['comment',id,b]);return {id:nextId++,status:'pending'}},
  like:async id=>{calls.push(['like',id])},
  photos:async pid=>pid==='piccadilly-lights'?[{id:7,project_id:pid,author_name:'사진가',caption:'밤 풍경',licence:'cc-by-4.0',url:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2230%22/%3E',width:1600,height:1200}]:[],
  uploadPhoto:async f=>{calls.push(['uploadPhoto',{...f,blob:{type:f.blob.type,size:f.blob.size}}]);return {id:nextId++,status:'pending'}},
  saveSubmission:async s=>{calls.push(['saveSubmission',s]);if(s.status==='pending'&&!s.country_iso2)throw new Error('missing_fields: country_iso2,city_or_venue,source');return {id:nextId++,status:s.status}},
  mine:async()=>({posts:[{id:5,kind:'review',title:'반려된 후기',status:'rejected',decision_reason:'작품과 관련 없는 광고 문구가 있어요.'}],photos:[{id:8,project_id:'piccadilly-lights',caption:null,status:'needs_review',decision_reason:null}],submissions:[{id:9,kind:'new_project',name:'청주 미디어파사드',status:'approved',decision_reason:null,approved_project_id:'REG-CM-0001'}],appeals:[]}),
  flag:async f=>{calls.push(['flag',f])},appeal:async a=>{calls.push(['appeal',a])},
  applyResearcher:async a=>{calls.push(['applyResearcher',a]);return {id:1,status:'submitted'}},acceptTerms:async v=>{calls.push(['acceptTerms',v])}};
};
const calls=page=>page.evaluate(()=>window.__calls);

test.describe('without a backend (the public site today)',()=>{
 test('no member form, an honest "준비 중", no community menu entry',async({page})=>{
  for(const h of ['community','community/write','profile','research-apply']){
   await page.goto('/#'+h);
   await expect(page.locator('[data-platform="not-configured"]')).toBeVisible();
   await expect(page.locator('#view form')).toHaveCount(0);
  }
  await expect(page.locator('#moreMenu a[href="#community"]')).toHaveCount(0);
  await serveDataset(page);await serveImages(page);
  await page.goto('/#place/AR-piccadilly-lights');
  await expect(page.locator('#view h1')).toBeVisible();
  await expect(page.locator('#dpCommunity')).toHaveCount(0,{timeout:5000});
 });
 test('a project without photos offers the photo guide with a working e-mail link',async({page})=>{
  await serveDataset(page);await serveImages(page);
  await page.goto('/#place/AR-medialab-prado');
  await expect(page.locator('#detailPhotos .dp-nophoto')).toBeVisible();
  const link=page.locator('#detailPhotos .dp-contribute a');
  await expect(link).toHaveAttribute('href','#contribute/medialab-prado');
  await link.click();
  await expect(page.locator('#view h1')).toHaveText('사진 제공하기');
  const mail=page.locator('#view a[href^="mailto:"]');
  await expect(mail).toHaveCount(1);
  const href=decodeURIComponent(await mail.getAttribute('href'));
  expect(href).toContain('remona56@hanmail.net');
  expect(href).toContain('[사진 제공] medialab-prado');
  expect(href).toContain('제가 직접 찍은 사진입니다.');
  await expect(page.locator('#view input[type=file]')).toHaveCount(0);
 });
});

test.describe('with a backend (fake API in memory)',()=>{
 test('community home: approved posts as text only, sign-in prompt for guests',async({page})=>{
  await page.addInitScript(FAKE,{signedIn:false});
  await page.goto('/#community');
  await expect(page.locator('#pfFeed .pf-card')).toHaveCount(1);
  await expect(page.locator('#pfFeed .pf-card h3')).toContainText('<img src=x');
  expect(await page.evaluate(()=>window.__xss)).toBeUndefined();
  await expect(page.locator('.pf-signin')).toBeVisible();
  await expect(page.locator('#view .pf-actions')).toHaveCount(0);
  await expect(page.locator('#moreMenu a[href="#community"]')).toHaveCount(1);
 });
 test('writing a review sends pending (or draft); the visit date is never called verified',async({page})=>{
  await page.addInitScript(FAKE,{});
  await page.goto('/#community/write/AR-piccadilly-lights');
  await expect(page.locator('#pfWrite [name=project_id]')).toHaveValue('piccadilly-lights');
  await expect(page.locator('#view')).not.toContainText('방문 인증');
  await page.fill('#pfWrite [name=title]','두 번째 방문');
  await page.fill('#pfWrite [name=body]','이번에는 비 오는 날 갔는데 화면이 젖은 바닥에 비쳐서 좋았어요.');
  await page.click('#pfWrite button[value=pending]');
  await expect(page.locator('#pfMessage')).toContainText('검수 후 공개');
  const c=(await calls(page)).find(x=>x[0]==='createPost')[1];
  expect(c).toMatchObject({kind:'review',project_id:'piccadilly-lights',title:'두 번째 방문',status:'pending'});
 });
 test('photo: all statements required, re-encoded to JPEG without metadata, size checked',async({page})=>{
  await page.addInitScript(FAKE,{});
  await page.goto('/#community/photo/AR-piccadilly-lights');
  await page.waitForLoadState('networkidle');
  const png=await page.evaluate(async([w,h])=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle='#2040a0';x.fillRect(0,0,w,h);const b=await new Promise(r=>c.toBlob(r,'image/png'));return Array.from(new Uint8Array(await b.arrayBuffer()))},[1200,800]);
  await page.setInputFiles('#pfPhoto [name=file]',{name:'night.png',mimeType:'image/png',buffer:Buffer.from(png)});
  await expect(page.locator('#pfChosen')).toHaveText('선택한 파일: night.png');
  // A background re-render of the view keeps the chosen file.
  await page.evaluate(()=>window.AOLApp.render());
  await expect(page.locator('#pfChosen')).toHaveText('선택한 파일: night.png');
  await page.click('#pfPhoto button');
  expect((await calls(page)).filter(x=>x[0]==='uploadPhoto')).toHaveLength(0);
  for(const n of ['own_photo','can_license','people_ok','artwork_rights_notice'])await page.check(`#pfPhoto [name=${n}]`);
  await page.click('#pfPhoto button');
  await expect(page.locator('#pfMessage')).toContainText('운영자가 확인한 뒤 공개');
  const u=(await calls(page)).find(x=>x[0]==='uploadPhoto')[1];
  expect(u).toMatchObject({project_id:'piccadilly-lights',width:1200,height:800,licence:'display',own_photo:true,artwork_rights_notice:true,offer_official:false});
  expect(u.blob.type).toBe('image/jpeg');
  const small=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=300;c.height=200;const b=await new Promise(r=>c.toBlob(r,'image/png'));return Array.from(new Uint8Array(await b.arrayBuffer()))});
  await page.setInputFiles('#pfPhoto [name=file]',{name:'small.png',mimeType:'image/png',buffer:Buffer.from(small)});
  for(const n of ['own_photo','can_license','people_ok','artwork_rights_notice'])await page.check(`#pfPhoto [name=${n}]`);
  await page.click('#pfPhoto button');
  await expect(page.locator('#pfMessage')).toContainText('너무 작아요');
 });
 test('case submission: a draft saves, submitting names the missing fields',async({page})=>{
  await page.addInitScript(FAKE,{});
  await page.goto('/#community/submit');
  await page.fill('#pfSubmit [name=name]','청주 문화제조창 미디어파사드');
  await page.click('#pfSubmit button[value=draft]');
  await expect(page.locator('#pfMessage')).toHaveText('임시 저장했어요.');
  await page.click('#pfSubmit button[value=pending]');
  await expect(page.locator('#pfMessage')).toHaveText('빠진 항목: 국가, 도시 또는 장소, 출처 링크');
  const subs=(await calls(page)).filter(x=>x[0]==='saveSubmission').map(x=>x[1]);
  expect(subs.map(s=>s.status)).toEqual(['draft','pending']);
  expect(subs[1].id).toBe(100);
 });
 test('my submissions: statuses, reasons, an appeal; reports go to staff',async({page})=>{
  await page.addInitScript(FAKE,{});
  await page.goto('/#community/mine');
  await expect(page.locator('#pfMine .pf-row')).toHaveCount(3);
  await expect(page.locator('#pfMine')).toContainText('작품과 관련 없는 광고 문구가 있어요.');
  await expect(page.locator('#pfMine a[href="#place/REG-CM-0001"]')).toHaveCount(1);
  await page.click('#pfMine [data-pf-appeal="post:5"]');
  await page.fill('#modal [name=message]','광고가 아니라 전시 안내였어요. 다시 봐 주세요.');
  await page.click('#modal button[value=ok]');
  await expect(page.locator('#modal')).not.toBeVisible();
  expect((await calls(page)).find(x=>x[0]==='appeal')[1]).toEqual({target_type:'post',target_id:5,message:'광고가 아니라 전시 안내였어요. 다시 봐 주세요.'});
  await page.goto('/#community/post/1');
  await page.click('[data-pf-report="post:1"]');
  await page.selectOption('#modal [name=reason]','spam');
  await page.click('#modal button[value=ok]');
  expect((await calls(page)).find(x=>x[0]==='flag')[1]).toMatchObject({target_type:'post',target_id:1,reason:'spam'});
 });
 test('project page: member photos and reviews apart from the archive, labelled as member material',async({page})=>{
  await page.addInitScript(FAKE,{});
  await serveDataset(page);await serveImages(page);
  await page.goto('/#place/AR-piccadilly-lights');
  const box=page.locator('#dpCommunity');
  await expect(box).toBeVisible();
  await expect(box.locator('.pf-note')).toContainText('공식 검증 자료와 다르며');
  await expect(box.locator('.pf-photo .pf-tag')).toHaveText('이용자 사진');
  await expect(box.locator('#dpCommunityPosts .pf-card')).toHaveCount(1);
  await expect(page.locator('#detailPhotos .pf-photo')).toHaveCount(0,{timeout:2000});
 });
 test('researcher application: what signing in does not prove, alternative verification, terms updates',async({page})=>{
  await page.addInitScript(FAKE,{});
  await page.goto('/#research-apply');
  await expect(page.locator('#view .page-sub')).toContainText('연구자 신원이나 소속을 확인하는 것이 아니에요');
  await expect(page.locator('#pfResearch input[type=file]')).toHaveCount(0);
  await page.fill('#pfResearch [name=full_name]','앨리스');
  await page.fill('#pfResearch [name=research_field]','미디어 건축');
  await page.fill('#pfResearch [name=purpose]','국내 미디어파사드의 지역 분포와 운영 기간을 분석하는 석사 논문에 사용합니다.');
  await page.check('#pfResearch [name=terms]');
  await page.click('#pfResearch button');
  expect((await calls(page)).find(x=>x[0]==='applyResearcher')[1]).toMatchObject({full_name:'앨리스',terms_version:'2026-11',requested_datasets:['aol-research']});
 });
 test('an approved researcher is asked to accept changed terms before downloading again',async({page})=>{
  await page.addInitScript(FAKE,{application:{id:1,status:'approved',terms_version:'2026-11',expires_at:'2027-11-01T00:00:00Z',created_at:'2026-11-02T00:00:00Z',decision_reason:'확인 완료'},terms:'2027-01'});
  await page.goto('/#research-apply');
  await expect(page.locator('#pfResearchStatus .pf-approved')).toBeVisible();
  await expect(page.locator('#pfResearch')).toHaveCount(0);
  await page.click('[data-pf-terms="2027-01"]');
  expect((await calls(page)).find(x=>x[0]==='acceptTerms')[1]).toBe('2027-01');
 });
});
