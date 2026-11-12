// v0.26: the calendar's festivals and exhibitions (data/events.json) and the collector's status (data/status.json).
// Statuses are worked out in the browser from each edition's dates in its own time zone; filters by period, region and
// admission; a series links to its archive record only when the record exists; no events file, no section.
import {test,expect} from './fixtures.mjs';
import {serveDataset,FIXTURE} from './fixtures/site-data-routes.mjs';

const day=(offset,tz='Asia/Seoul')=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+offset*864e5));
const ed=(id,start,end,extra={})=>({id,title:null,start,end,hours:null,venue:null,admission:null,state:null,status:'unconfirmed',source:'https://example.go.kr/'+id,checked_at:'2026-11-11',...extra});
const series=(id,name,o,editions)=>({id,project_id:null,kind:'festival',project_type:'festival_program',name_ko:name,name_en:null,name_original:null,country_iso2:'KR',kr_division:'busan',city:'Busan',city_ko:'부산광역시',timezone:'Asia/Seoul',recurrence:'annual',official_url:null,admission:null,editions,...o});
const EVENTS={schema:1,build_id:FIXTURE['manifest.json'].build_id,generated_at:'2026-10-20T06:17:00Z',counts:{},series:[
 series('REG-KR-0001','진행 중인 빛축제',{admission:'free'},[ed('now',day(-3),day(3))]),
 series('REG-KR-0002','다음 달 미디어아트',{kr_division:'jeju',city:'Jeju',city_ko:'제주시',admission:'paid'},[ed('next',day(20),day(40))]),
 series('REG-KR-0003','지난 유등축제',{kr_division:'gyeongnam'},[ed('past',day(-60),day(-40))]),
 series('REG-KR-0004','일정 미정 축제',{},[ed('tbd',null,null)]),
 series('REG-FR-0001','Fête des Lumières (test)',{country_iso2:'FR',kr_division:null,city:'Lyon',city_ko:null,timezone:'Europe/Paris',name_ko:null,name_original:'Fête des Lumières (test)'},[ed('fr',day(5,'Europe/Paris'),day(8,'Europe/Paris'))]),
 series('REG-KR-0005','취소된 행사',{},[ed('cx',day(2),day(4),{state:'cancelled'})]),
]};
const FILES={...FIXTURE,'manifest.json':{...FIXTURE['manifest.json'],files:{...FIXTURE['manifest.json'].files,events:'events.json'}},'events.json':EVENTS};

test('calendar: festivals and exhibitions by period, region and admission, statuses in local time',async({page})=>{
 await serveDataset(page,FILES);
 await page.setViewportSize({width:390,height:844});
 await page.goto('/#calendar');
 const rows=page.locator('#events .event-row'),count=page.locator('#events .result-meta');
 await expect(count).toHaveAttribute('data-count','3');
 await expect(rows.locator('h3')).toHaveText(['진행 중인 빛축제','Fête des Lumières (test)','다음 달 미디어아트']);
 await expect(rows.first()).toHaveAttribute('data-status','ongoing');
 await page.locator('[data-ev-filter="past"]').click();
 await expect(rows.locator('h3')).toHaveText(['취소된 행사','지난 유등축제'],{timeout:5000}); // the latest end first
 await page.locator('[data-ev-filter="unconfirmed"]').click();
 await expect(rows.locator('h3')).toHaveText(['일정 미정 축제']);
 await expect(rows.first().locator('.pill').first()).toHaveText('일정 확인 필요');
 await page.locator('[data-ev-filter="live"]').click();
 await page.locator('[data-ev-scope="world"]').click();
 await expect(rows.locator('h3')).toHaveText(['Fête des Lumières (test)']);
 await page.locator('[data-ev-div="jeju"]').click();
 await expect(rows.locator('h3')).toHaveText(['다음 달 미디어아트']);
 await page.locator('[data-ev-scope="all"]').click();
 await page.locator('[data-ev-fee="free"]').click();
 await expect(rows.locator('h3')).toHaveText(['진행 중인 빛축제']);
 await page.locator('[data-ev-fee="paid"]').click();
 await expect(rows.locator('h3')).toHaveText(['다음 달 미디어아트']);
 for (const r of await rows.all()) await expect(r.locator('a[href^="https://example.go.kr/"]')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(0);
});

test('calendar: a dataset without events.json is never asked for it; no events section',async({page})=>{
 const seen=await serveDataset(page,FIXTURE);
 await page.goto('/#calendar');
 await expect(page.locator('.large-title')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.AOL_DATASET?.status)).toBe('ok');
 await expect(page.locator('#events')).toHaveCount(0);
 expect(seen.filter(f=>f.startsWith('events.json'))).toHaveLength(0);
});

test('home: a home.json without status_file is never followed by a status request',async({page})=>{
 const seen=await serveDataset(page,FIXTURE);
 await page.goto('/#home');
 await expect.poll(()=>page.evaluate(()=>window.AOL_DATASET?.status)).toBe('ok');
 await page.waitForTimeout(300);
 expect(seen.filter(f=>f.startsWith('status.json'))).toHaveLength(0);
});

test('home: data change and last collection check are two different times',async({page})=>{
 const status={schema:1,last_check_at:'2026-10-20T12:20:00Z',data_changed_at:'2026-10-20T06:17:00Z',build_id:FIXTURE['manifest.json'].build_id,last_check:{outcome:'unchanged'}};
 await serveDataset(page,{...FIXTURE,'home.json':{...FIXTURE['home.json'],status_file:'status.json'},'status.json':status});
 await page.goto('/#home');
 const f=page.locator('.dataset-freshness').first();
 await expect(f.locator('time').first()).toHaveAttribute('datetime','2026-10-20T06:17:00Z');
 await expect(f.locator('.freshness-check time')).toHaveAttribute('datetime','2026-10-20T12:20:00Z');
});

// v1.0.1: the collection status says when collection is late or has stopped, from the last check's age, and never
// shows a run as healthy without a status file.
for(const [hoursAgo,label,warn] of [[2,'정상',false],[9,'수집 지연',true],[30,'수집 중단 의심',true]]){
 test(`collection status: last check ${hoursAgo} h ago reads ${label}`,async({page})=>{
  const at=new Date(Date.now()-hoursAgo*3600e3).toISOString();
  const status={schema:1,last_check_at:at,data_changed_at:'2026-10-20T06:17:00Z',build_id:FIXTURE['manifest.json'].build_id,last_check:{outcome:'unchanged',status:'ok'}};
  await serveDataset(page,{...FIXTURE,'home.json':{...FIXTURE['home.json'],status_file:'status.json'},'status.json':status});
  await page.goto('/#home');
  await expect(page.locator('.dataset-freshness').first()).toBeVisible();
  await expect(page.locator('.dataset-freshness .freshness-warn')).toHaveCount(warn?1:0);
  await page.goto('/#data');
  await expect(page.locator('#collectionStatus .cs-state b')).toHaveText(label);
  await expect(page.locator('#collectionStatus .cs-list')).toContainText(FIXTURE['manifest.json'].build_id);
 });
}
test('collection status: a run that kept the previous data needs a check; no status file is never shown as on schedule',async({page})=>{
 const status={schema:1,last_check_at:new Date(Date.now()-3600e3).toISOString(),data_changed_at:'2026-10-20T06:17:00Z',build_id:FIXTURE['manifest.json'].build_id,last_check:{outcome:'kept_previous_drop_guard',status:'ok'}};
 await serveDataset(page,{...FIXTURE,'home.json':{...FIXTURE['home.json'],status_file:'status.json'},'status.json':status});
 await page.goto('/#data');
 await expect(page.locator('#collectionStatus .cs-state b')).toHaveText('이전 자료 유지 중 — 확인 필요');
 await serveDataset(page,FIXTURE);await page.goto('/#home');await page.goto('/#data');await page.reload();
 await expect(page.locator('#collectionStatus .cs-state b')).toHaveText('상태 확인 불가');
});
