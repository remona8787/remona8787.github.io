// Live place photo/info sync in a real browser, against recorded-shape Wikidata/Commons responses,
// under the production CSP. The last test talks to the real APIs when they are reachable.
import {test,expect} from './fixtures.mjs';
import {readFileSync} from 'node:fs';
import {wdqs,commonsPage,commonsResponse} from '../tests/fixtures/live-media-fixtures.mjs';
import {branchIdOf} from '../edge-functions/_shared/global-places.mjs';

const PNG=readFileSync(new URL('../site-public-cleared/assets/icon-512.png',import.meta.url));
const cors={'access-control-allow-origin':'*','content-type':'application/json'};
const WD=wdqs([
 ['동대문디자인플라자','ko','Q482004','DDP night.jpg','Point(127.0095 37.5665)','https://ddp.or.kr/',"Dongdaemun Design Plaza"],
 ['롯데월드타워','ko','Q491381','Lotte World Tower.jpg','Point(127.1025 37.5125)'],
 ['리움미술관','ko','Q482009','Leeum NC.jpg'],
]);
const FILES={
 'DDP night.jpg':commonsPage({artist:'<a href="//commons.wikimedia.org/wiki/User:Kim">Kim Photographer</a>',license:'CC BY-SA 4.0',date:'2019-05-04 19:20:11',templates:['Template:NoFoP-South Korea'],url:'https://upload.wikimedia.org/wikipedia/commons/a/ab/DDP_night.jpg'}),
 'Lotte World Tower.jpg':commonsPage({artist:'Lee',license:'CC BY 2.0',url:'https://upload.wikimedia.org/wikipedia/commons/c/cd/Lotte_World_Tower.jpg'}),
 'Leeum NC.jpg':commonsPage({license:'CC BY-NC 4.0'}),
};

// The nationwide/worldwide place sync (qa/global-places.spec.mjs) posts to the same endpoint; its tagged queries fall
// through to the default block so these tests keep counting only the curated-place photo sync.
const isGlobal=r=>!!branchIdOf(new URLSearchParams(r.request().postData()||'').get('query'));

async function mockApis(page,{fail=false}={}){
 const calls={wdqs:0,commons:0};
 await page.route('https://query.wikidata.org/**',async r=>{if(isGlobal(r))return r.fallback();calls.wdqs++;if(fail)return r.fulfill({status:503,headers:cors,body:'{}'});expect(r.request().method()).toBe('POST');await r.fulfill({headers:cors,body:JSON.stringify(WD)})});
 await page.route('https://commons.wikimedia.org/w/api.php**',async r=>{calls.commons++;const titles=new URL(r.request().url()).searchParams.get('titles').split('|').map(t=>t.replace(/^File:/,''));await r.fulfill({headers:cors,body:JSON.stringify(commonsResponse(Object.fromEntries(titles.filter(t=>FILES[t]).map(t=>[t,FILES[t]]))))})});
 await page.route(/^https:\/\/(upload|thumb)\.wikimedia\.org\//,r=>r.fulfill({contentType:'image/png',body:PNG}));
 return calls;
}

test('photos sync with attribution and appear on cards and detail pages',async({page})=>{
 const calls=await mockApis(page);
 await page.goto('/#home');
 const ddp=page.locator('.place-card',{hasText:'동대문디자인플라자'}).first();
 await expect(ddp.locator('img[data-place-photo]')).toBeVisible();
 await expect(ddp.locator('.image-credit')).toContainText('Kim Photographer · CC BY-SA 4.0');
 await expect.poll(()=>ddp.locator('img[data-place-photo]').evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
 expect(calls.wdqs).toBe(1);

 await page.goto('/#place/SEOUL006');
 const fig=page.locator('.image-gallery figure').filter({hasText:'Kim Photographer'});
 await expect(fig).toContainText('CC BY-SA 4.0');await expect(fig).toContainText('2019-05-04');
 await expect(fig.locator('a',{hasText:'이미지 원본'})).toHaveAttribute('href','https://commons.wikimedia.org/wiki/File:DDP_night.jpg');
 await expect(fig.locator('a',{hasText:'사용조건'})).toHaveAttribute('href','https://creativecommons.org/licenses/by-sa/4.0');
 const info=page.locator('.live-info');
 await expect(info).toContainText('공개 데이터 연동 정보');
 await expect(info.locator('a',{hasText:'Wikidata Q482004'})).toHaveAttribute('href','https://www.wikidata.org/wiki/Q482004');
 await expect(info.locator('a',{hasText:'바로가기'})).toHaveAttribute('href','https://ddp.or.kr/');
 await expect(info).toContainText('37.56650, 127.00950');
 await expect(info).toContainText('6시간마다');
});

test('host-building photos are labelled; non-free licenses are never shown',async({page})=>{
 await mockApis(page);
 await page.goto('/#place/SEOUL018');
 await expect(page.locator('.image-gallery figure')).toContainText('프로젝트가 있는 건물(롯데월드타워)의 사진');
 await expect(page.locator('.live-info')).toContainText('프로젝트가 설치된 건물(롯데월드타워) 기준');
 await page.goto('/#place/SEOUL027');
 await expect(page.locator('.live-info')).toContainText('Q482009');
 await expect(page.locator('.image-gallery figure')).toHaveCount(0);
});

test('results are cached for 6 hours; a failed refresh keeps the last good result',async({page})=>{
 const calls=await mockApis(page);
 await page.goto('/#home');await expect(page.locator('.place-card img[data-place-photo]').first()).toBeVisible();
 await page.reload();await page.waitForLoadState('networkidle');
 expect(calls.wdqs,'fresh cache: no new query').toBe(1);
 // Age the cache past 6 hours and make the source fail.
 await page.evaluate(()=>{const v=JSON.parse(localStorage.getItem('aol_live_v1'));v.fetchedAt=new Date(Date.now()-7*3600e3).toISOString();localStorage.setItem('aol_live_v1',JSON.stringify(v))});
 await page.unroute('https://query.wikidata.org/**');
 let failed=0;await page.route('https://query.wikidata.org/**',r=>{if(isGlobal(r))return r.fallback();failed++;r.fulfill({status:503,headers:cors,body:'{}'})});
 await page.goto('/#settings');await page.reload();
 await expect.poll(()=>failed).toBe(1);
 await expect(page.locator('#liveSyncTime')).toContainText('최근 갱신 실패');
 await page.goto('/#place/SEOUL006');
 await expect(page.locator('.image-gallery figure').filter({hasText:'Kim Photographer'})).toBeVisible();
});

test('manual sync from settings and takedown list',async({page})=>{
 const calls=await mockApis(page);
 await page.goto('/#settings');
 await expect(page.locator('#liveSyncTime')).not.toContainText('아직 없음');
 await expect(page.locator('.panel',{hasText:'장소 사진·정보 동기화'})).toContainText('3곳 / 2장');
 await page.getByRole('button',{name:'지금 동기화'}).click();
 await expect.poll(()=>calls.wdqs).toBe(2);
 await page.route('**/assets/media-blocklist.js',r=>r.fulfill({contentType:'text/javascript',body:"window.AOL_MEDIA_BLOCKLIST=['DDP night.jpg']"}));
 await page.goto('/#place/SEOUL006');await page.reload();
 await expect(page.locator('.live-info')).toBeVisible();
 await expect(page.locator('.image-gallery figure').filter({hasText:'Kim Photographer'})).toHaveCount(0);
});

test.describe('real Wikidata/Commons',()=>{
 test.use({liveApis:true});
 test('live sync matches places and every shown photo carries attribution',async({page,request})=>{
  const reach=await request.get('https://query.wikidata.org/sparql?query=ASK%7B%7D&format=json',{timeout:10000}).then(r=>r.ok(),()=>false);
  test.skip(!reach,'query.wikidata.org unreachable from this runner');
  await page.goto('/#settings');
  await expect.poll(()=>page.evaluate(()=>window.AOL_LIVE?.status),{timeout:45000}).toBe('ok');
  const live=await page.evaluate(()=>window.AOL_LIVE);
  console.log(`live sync: ${Object.keys(live.info).length} places matched, ${live.media.length} photos`);
  expect(Object.keys(live.info).length).toBeGreaterThan(0);
  for(const m of live.media){expect(m.creator).toBeTruthy();expect(m.license_code).toBeTruthy();expect(m.source_url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/)}
 });
});
