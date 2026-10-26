// The research data page (fifth brief): the public package of the deployment (data/research/latest.json) with its
// files, checksums and citation, or an honest note while it is missing; the member tier only with a configured server:
// the public catalogue, sign-in, a profile with the two consents, and a download through the Edge Function that shows
// the licence, checksum and citation. Without a server: no button that cannot work.
import {test,expect} from './fixtures.mjs';
import {serveDataset,serveImages} from './fixtures/site-data-routes.mjs';

const SUPABASE='https://aoltest.supabase.co',KEY='sb_publishable_test',cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-expose-headers':'Content-Range','content-type':'application/json'};
const SHA='9f'.repeat(32);
const LATEST={dataset:'architecture-of-light',title:'빛의 건축 공개 데이터',version:'20261026T063755Z-351b7eb5',created:'2026-10-26T06:40:00Z',data_as_of:'2026-10-26',path:'data/research/20261026T063755Z-351b7eb5/',citation:'빛의 건축 아카이브 공개 데이터, 버전 20261026T063755Z-351b7eb5 (2026-10-26 기준).',counts:{projects:279,sources:812,images:1123},files:{'projects.csv':{bytes:204800,sha256:SHA},'projects.json':{bytes:512000,sha256:SHA},'images.csv':{bytes:90000,sha256:SHA},'CITATION.txt':{bytes:300,sha256:SHA}}};
async function base(page){await serveDataset(page);await serveImages(page)}

test('the public package: files with size and checksum, what it leaves out, and the citation to copy',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await base(page);await page.route('**/data/research/latest.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(LATEST)}));
 await page.goto('/#data');
 const pub=page.locator('#researchPublic');
 await expect(pub).toContainText('버전 20261026T063755Z-351b7eb5');
 await expect(pub).toContainText('2026-10-26 기준');
 await expect(pub).toContainText('편집 요약과 이미지는 포함되지 않아요');
 await expect(pub.locator('.rd-files tbody tr')).toHaveCount(4);
 await expect(pub.locator('a[download]').first()).toHaveAttribute('href','data/research/20261026T063755Z-351b7eb5/projects.csv');
 await expect(pub.locator('.rd-sha').first()).toHaveAttribute('title',SHA);
 await pub.getByRole('button',{name:'인용문 복사'}).click();
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(LATEST.citation);
 // The export of the current results stays.
 await expect(page.locator('#dataExport [data-export="csv"]')).toBeVisible();
});

test('without the package or a server: an honest note, the current export, and no member button',async({page})=>{
 await base(page);await page.route('**/data/research/latest.json',r=>r.fulfill({status:404,contentType:'text/html',body:'<!doctype html><title>404</title>'}));
 await page.goto('/#data');
 await expect(page.locator('#researchPublic')).toContainText('공개 데이터 패키지를 준비 중이에요');
 await expect(page.locator('#dataExport [data-export="csv"]')).toBeVisible();
 await expect(page.locator('#researchMember')).toContainText('회원 연구 데이터는 준비 중이에요');
 await expect(page.locator('#researchMember button, #researchMember form')).toHaveCount(0);
});

// A configured server: the catalogue is public; downloading needs sign-in and the consents.
async function server(page,{signedIn=false}={}){
 const st={profile:null,upserts:[],calls:[]};
 await page.route('**/config.js',async r=>{const res=await r.fetch();await r.fulfill({contentType:'text/javascript',body:(await res.text())+`\nwindow.AOL_CONFIG.SUPABASE_URL='${SUPABASE}';window.AOL_CONFIG.SUPABASE_PUBLISHABLE_KEY='${KEY}';`})});
 await page.routeWebSocket(/supabase\.co/,ws=>ws.close());
 await page.route(SUPABASE+'/**',async r=>{const u=new URL(r.request().url()),m=r.request().method();st.calls.push(m+' '+u.pathname);
  if(m==='OPTIONS')return r.fulfill({status:204,headers:cors});
  if(u.pathname==='/rest/v1/research_datasets')return r.fulfill({headers:cors,body:JSON.stringify([{id:'kr-facades',title_ko:'국내 미디어파사드 검수 데이터셋',title_en:'Korean media façades, reviewed',description_ko:'편집팀이 검수한 국내 프로젝트 50건.',tier:'member',licence:'CC BY 4.0',licence_url:'https://creativecommons.org/licenses/by/4.0/'}])});
  if(u.pathname==='/rest/v1/research_dataset_versions')return r.fulfill({headers:cors,body:JSON.stringify([{dataset_id:'kr-facades',version:'1.0.0',data_as_of:'2026-10-20',record_count:50,formats:['csv','json'],sha256:{csv:SHA},changelog:'첫 공개',citation:'빛의 건축, 국내 미디어파사드 검수 데이터셋 1.0.0 (2026-10-20 기준).'}])});
  if(u.pathname==='/rest/v1/research_profiles'){if(m==='GET')return r.fulfill({headers:cors,body:JSON.stringify(st.profile?[st.profile]:[])});st.upserts.push(JSON.parse(r.request().postData()||'{}'));st.profile=Array.isArray(st.upserts.at(-1))?st.upserts.at(-1)[0]:st.upserts.at(-1);return r.fulfill({status:201,headers:cors,body:''})}
  if(u.pathname==='/rest/v1/research_downloads')return r.fulfill({headers:cors,body:'[]'});
  if(u.pathname==='/functions/v1/research-download'){const b=JSON.parse(r.request().postData()||'{}');st.download={body:b,auth:r.request().headers().authorization};return r.fulfill({headers:cors,body:JSON.stringify({url:SUPABASE+'/storage/v1/object/sign/research-datasets/kr-facades/1.0.0/kr-facades-1.0.0.csv?token=t',expires_in:300,file_name:'kr-facades-1.0.0.csv',licence:'CC BY 4.0',licence_url:'https://creativecommons.org/licenses/by/4.0/',citation:'빛의 건축, 국내 미디어파사드 검수 데이터셋 1.0.0 (2026-10-20 기준).',sha256:SHA,data_as_of:'2026-10-20',record_count:50})})}
  if(u.pathname==='/auth/v1/user')return r.fulfill({headers:cors,body:JSON.stringify({id:'u-1',aud:'authenticated',email:'r@example.org',email_confirmed_at:'2026-10-01T00:00:00Z'})});
  return r.fulfill({status:503,headers:cors,body:'{"message":"down"}'})});
 if(signedIn)await page.addInitScript(()=>{const now=Math.floor(Date.now()/1000);localStorage.setItem('sb-aoltest-auth-token',JSON.stringify({access_token:'header.payload.sig',token_type:'bearer',expires_in:3600,expires_at:now+3600,refresh_token:'refresh-1',user:{id:'u-1',aud:'authenticated',role:'authenticated',email:'r@example.org',email_confirmed_at:'2026-10-01T00:00:00Z',app_metadata:{},user_metadata:{},created_at:'2026-10-01T00:00:00Z'}}))});
 return st;
}
test('a configured server, signed out: the catalogue with versions and citations; downloading asks for sign-in',async({page})=>{
 await base(page);await server(page);
 await page.goto('/#data');
 const mem=page.locator('#researchMember');
 await expect(mem.locator('.rd-dataset h3')).toHaveText('국내 미디어파사드 검수 데이터셋');
 await expect(mem).toContainText('버전 1.0.0');await expect(mem).toContainText('50건');
 await expect(mem.locator('a[href="#account"]')).toHaveText('로그인·회원가입');
 await expect(mem.locator('[data-rd-download]')).toHaveCount(2);
 for(const b of await mem.locator('[data-rd-download]').all())await expect(b).toBeDisabled();
});
test('signed in: the profile with the two consents first, then a download that names its licence, checksum and citation',async({page})=>{
 await base(page);const st=await server(page,{signedIn:true});
 await page.goto('/#data');
 const mem=page.locator('#researchMember');
 await expect(mem.locator('#rdProfile')).toBeVisible();
 await mem.getByRole('button',{name:'저장하고 계속하기'}).click();
 // The two consents are required (the form does not submit without them).
 expect(await mem.locator('input[name=terms]').evaluate(e=>e.validity.valueMissing)).toBe(true);
 await expect(mem.locator('#rdProfile')).toBeVisible();
 expect(st.upserts).toEqual([]);
 await mem.getByText('이용약관에 동의해요 (필수)').click();await mem.getByText('개인정보 처리방침에 동의해요 (필수)').click();
 await mem.locator('select[name=user_type]').selectOption('researcher');
 await mem.getByRole('button',{name:'저장하고 계속하기'}).click();
 await expect(mem.locator('#rdProfile')).toHaveCount(0);
 const row=Array.isArray(st.upserts[0])?st.upserts[0][0]:st.upserts[0];
 expect(row).toMatchObject({user_id:'u-1',user_type:'researcher',display_name:null});
 expect(row.terms_version).toMatch(/^\d+\.\d+\.\d+$/);expect(row.privacy_version).toBe(row.terms_version);
 const csv=mem.locator('[data-rd-download][data-rd-format="csv"]');
 await expect(csv).toBeEnabled();await csv.click();
 const res=mem.locator('.rd-result');
 await expect(res).toContainText('kr-facades-1.0.0.csv');
 await expect(res).toContainText('CC BY 4.0');
 await expect(res.locator('.rd-sha')).toHaveText(SHA);
 await expect(res.locator('#rdResultCitation')).toHaveText('빛의 건축, 국내 미디어파사드 검수 데이터셋 1.0.0 (2026-10-20 기준).');
 await expect(res.locator('a.button')).toHaveAttribute('href',/\/storage\/v1\/object\/sign\/research-datasets\//);
 expect(st.download.body).toEqual({dataset:'kr-facades',version:'1.0.0',format:'csv'});
 expect(st.download.auth).toBe('Bearer header.payload.sig');
});
