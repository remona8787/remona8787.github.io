// scripts/policy-v2.mjs: the v2.0 privacy policy and terms go up in two steps (announced 7 days ahead, then in effect),
// in the pages' own frame, with every value filled and nothing unescaped. Runs on a copy of the two pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {notice,effective,addDays,josa} from '../scripts/policy-v2.mjs';

const root=path.resolve(import.meta.dirname,'..');
function copy(){
 const dir=mkdtempSync(path.join(tmpdir(),'policy-v2-'));
 mkdirSync(path.join(dir,'site-public-cleared'));mkdirSync(path.join(dir,'release/policies/v2'),{recursive:true});
 // The 1.0.0 pages as they were before the notice (tests/fixtures/policy-v1; the site's own pages are 2.0.0 now).
 for(const f of ['privacy.html','terms.html'])cpSync(path.join(root,'tests/fixtures/policy-v1',f),path.join(dir,'site-public-cleared',f));
 for(const f of ['privacy.body.html','terms.body.html'])cpSync(path.join(root,'release/policies/v2',f),path.join(dir,'release/policies/v2',f));
 return dir;
}
const read=(dir,f)=>readFileSync(path.join(dir,'site-public-cleared',f),'utf8');

test('the site carries the announced texts: notice on the current pages, -next pages not indexed, dates recorded', ()=>{
 const state=JSON.parse(readFileSync(path.join(root,'release/policies/v2/state.json'),'utf8'));
 if(state.status==='effective'){
  for(const kind of ['privacy','terms']){
   assert.match(readFileSync(path.join(root,'site-public-cleared',kind+'.html'),'utf8'),new RegExp(`시행일 ${state.effective_date}[^<]*문서 버전 2\\.0\\.0`),kind);
   assert.match(readFileSync(path.join(root,'site-public-cleared',kind+'-v1.html'),'utf8'),/name="robots" content="noindex"/);
   assert.equal(existsSync(path.join(root,'site-public-cleared',kind+'-next.html')),false);
  }
  return;
 }
 for(const kind of ['privacy','terms']){
  const cur=readFileSync(path.join(root,'site-public-cleared',kind+'.html'),'utf8'),next=readFileSync(path.join(root,'site-public-cleared',kind+'-next.html'),'utf8');
  assert.ok(cur.includes(`<a href="./${kind}-next.html">`)&&cur.includes(state.effective_date),kind+': notice with the effective date');
  assert.match(next,/name="robots" content="noindex"/);assert.doesNotMatch(next,/\{\{/);
  assert.doesNotMatch(cur+next,/안내은|안내이 |방침는|방침가 /,kind+': particles');
 }
 assert.equal(state.effective_date,addDays(state.notice_date,7));
});

test('the bodies name every value the policy needs and keep the operator placeholders the build fills', ()=>{
 for(const kind of ['privacy','terms']){
  const body=readFileSync(path.join(root,'release/policies/v2',kind+'.body.html'),'utf8');
  assert.deepEqual([...new Set(body.match(/\{\{\w+\}\}/g))].sort(),(kind==='privacy'?['{{BANNER}}','{{EFFECTIVE_DATE}}','{{MAIL_COUNTRY}}','{{MAIL_PROVIDER}}','{{NOTICE_DATE}}','{{PREVIOUS}}']:['{{BANNER}}','{{EFFECTIVE_DATE}}','{{NOTICE_DATE}}','{{PREVIOUS}}']));
  assert.match(body,/<span data-config="OPERATOR_NAME"><\/span>/);assert.match(body,/<span data-config="SUPPORT_EMAIL"><\/span>/);
  assert.doesNotMatch(body,/\[[^\]]*\]\s*$/m,'no open [decision] left from the drafts');
 }
 const privacy=readFileSync(path.join(root,'release/policies/v2/privacy.body.html'),'utf8');
 for(const must of ['만 14세 미만은 회원으로 가입할 수 없습니다','1년 뒤 자동 삭제','3년 뒤 자동 삭제','Supabase Inc.','국외 이전','외부 인공지능 서비스로 보내지 않습니다','쿠키를 사용하지 않습니다'])assert.ok(privacy.includes(must),must);
});

test('notice: the new texts as -next pages (not indexed), a dated notice on the current pages, the current texts unchanged', ()=>{
 const dir=copy(),before=read(dir,'privacy.html');
 assert.throws(()=>notice({dir,mailProvider:'',mailCountry:'미국',noticeDate:'2026-11-16'}),/mailProvider is required/);
 assert.throws(()=>notice({dir,mailProvider:'X',mailCountry:'미국',noticeDate:'2026-11-16',days:3}),/at least 7 days/);
 const s=notice({dir,mailProvider:'Mail <Co>',mailCountry:'미국',noticeDate:'2026-11-16'});
 assert.deepEqual(s,{status:'announced',notice_date:'2026-11-16',effective_date:'2026-11-23',mail_provider:'Mail <Co>',mail_country:'미국',version:'2.0.0'});
 const next=read(dir,'privacy-next.html');
 assert.doesNotMatch(next,/\{\{/);assert.match(next,/Mail &lt;Co&gt;\(미국\)/);assert.doesNotMatch(next,/Mail <Co>/);
 assert.match(next,/<meta name="robots" content="noindex">/);assert.match(next,/<title>개인정보 처리방침 \(개정 예고\) ·/);
 assert.match(next,/개정 예고<\/b> · 이 방침은 2026-11-23부터 시행됩니다/);
 assert.equal(next.slice(0,next.indexOf('<article')).replace(/<meta name="robots"[^>]*>/,'').replace(/<title>[^<]*<\/title>/,''),before.slice(0,before.indexOf('<article')).replace(/<title>[^<]*<\/title>/,''),'same frame as the current page');
 const cur=read(dir,'privacy.html');
 assert.match(cur,/<a href="\.\/privacy-next\.html">개정된 개인정보 처리방침 보기<\/a> · 공고일 2026-11-16/);
 assert.equal(cur.replace(/<!--policy-v2-notice-->.*?<!--\/policy-v2-notice-->/,''),before,'only the notice is added');
 assert.match(read(dir,'terms-next.html'),/공고일 2026-11-16 · 시행일 2026-11-23 · 문서 버전 2\.0\.0 · 서비스 버전 1\.0\.0</);
 // Correcting the provider keeps the dates and does not stack notices.
 notice({dir,mailProvider:'Other Mail',mailCountry:'아일랜드'});
 assert.equal((read(dir,'privacy.html').match(/policy-v2-notice-->/g)||[]).length,2);
 assert.match(read(dir,'privacy-next.html'),/Other Mail\(아일랜드\)/);
 assert.equal(JSON.parse(readFileSync(path.join(dir,'release/policies/v2/state.json'),'utf8')).effective_date,'2026-11-23');
});

test('effective: refused before the date; then the new texts are the policy, the old ones stay readable', ()=>{
 const dir=copy();
 assert.throws(()=>effective({dir,today:'2026-11-30'}),/announce first/);
 notice({dir,mailProvider:'Mail Co',mailCountry:'미국',noticeDate:'2026-11-16'});
 assert.throws(()=>effective({dir,today:'2026-11-22'}),/apply from 2026-11-23/);
 const s=effective({dir,today:'2026-11-23'});
 assert.equal(s.status,'effective');
 const p=read(dir,'privacy.html');
 assert.doesNotMatch(p,/\{\{|policy-v2-notice|개정 예고/);assert.match(p,/공고일 2026-11-16 · 시행일 2026-11-23\(회원 기능 도입에 따라 개정\) · 문서 버전 2\.0\.0 · 서비스 버전 1\.0\.0 · <a href="\.\/privacy-v1\.html">이전 버전\(1\.0\.0\)<\/a>/);
 assert.doesNotMatch(p,/name="robots"/,'the policy itself is indexed');
 const old=read(dir,'privacy-v1.html');
 assert.match(old,/이전 버전\(1\.0\.0\)입니다/);assert.match(old,/회원가입·로그인 없이/);assert.match(old,/name="robots" content="noindex"/);
 assert.equal(existsSync(path.join(dir,'site-public-cleared/privacy-next.html')),false);
 assert.equal(effective({dir,today:'2026-12-01'}).status,'effective','running it again changes nothing');
 assert.equal(addDays('2026-12-28',7),'2027-01-04');
 assert.deepEqual([josa('이 방침','은','는'),josa('이 안내','은','는'),josa('이용 안내','이','가'),josa('개인정보 처리방침','이','가')],['이 방침은','이 안내는','이용 안내가','개인정보 처리방침이']);
});

test('effective --now: only with a reason; the announced date is kept beside the real one', ()=>{
 const dir=copy();
 notice({dir,mailProvider:'Supabase Inc.',mailCountry:'미국',noticeDate:'2026-11-15'});
 assert.throws(()=>effective({dir,today:'2026-11-15',early:true}),/needs the reason/);
 const s=effective({dir,today:'2026-11-15',early:true,reason:'운영자 결정: 회원 기능을 바로 공개'});
 assert.deepEqual([s.status,s.effective_date,s.announced_effective_date,s.early_reason],['effective','2026-11-15','2026-11-22','운영자 결정: 회원 기능을 바로 공개']);
 assert.match(read(dir,'privacy.html'),/공고일 2026-11-15 · 시행일 2026-11-15/);
 assert.match(read(dir,'terms-v1.html'),/2026-11-15 전까지 적용된 이전 버전/);
});
