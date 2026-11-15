#!/usr/bin/env node
// Publishes the v2.0 privacy policy and terms (release/policies/v2/*.body.html; decisions in docs/policies/v2-final.md)
// in two steps, so the site keeps the promise in its current privacy policy (section 7): a change is announced on the
// site 7 days before it applies.
//
//   node scripts/policy-v2.mjs notice --mail-provider="<company>" --mail-country="<country>" [--notice-date=YYYY-MM-DD] [--days=7]
//     writes site-public-cleared/privacy-next.html and terms-next.html (the new texts, marked as announced, not indexed)
//     and a notice at the top of privacy.html and terms.html naming the effective date; records the dates and the mail
//     provider in release/policies/v2/state.json. Run again to correct the provider (the dates stay unless given).
//   node scripts/policy-v2.mjs effective [--today=YYYY-MM-DD]
//     on or after the effective date only: keeps the current texts as privacy-v1.html and terms-v1.html (not indexed),
//     writes the new texts into privacy.html and terms.html, removes the -next pages.
//
// Turning the member features on in the public site (config.js SUPABASE_URL and key) is a separate step on the effective
// date; so is the database part of the policy (the retention periods, supabase/migrations/20261115000000_v2_retention.sql,
// installed by the platform workflow's apply).
import {readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import path from 'node:path';

const ROOT=path.resolve(import.meta.dirname,'..');
const KINDS={privacy:{title:'개인정보 처리방침',label:'이 방침'},terms:{title:'이용 안내',label:'이 안내'}};
const DATE=/^\d{4}-\d{2}-\d{2}$/;
// A Korean particle after a word: the first form after a final consonant (방침은, 방침이), the second after a vowel (안내는, 안내가).
export const josa=(word,withFinal,withoutFinal)=>{const c=word.charCodeAt(word.length-1);return word+((c>=0xac00&&c<=0xd7a3&&(c-0xac00)%28)?withFinal:withoutFinal)};
export const esc=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export const addDays=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const kst=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);

// The new text inside the page's own frame (head, header, footer of the current page), with its values filled in.
export function render(kind,page,body,{noticeDate,effectiveDate,mailProvider,mailCountry,banner='',previous=''}){
 for(const [k,v] of Object.entries({noticeDate,effectiveDate}))if(!DATE.test(v||''))throw Error(`${k} must be YYYY-MM-DD`);
 for(const [k,v] of Object.entries({mailProvider,mailCountry}))if(!String(v||'').trim()||String(v).length>80)throw Error(`${k} is required (1 to 80 characters)`);
 const filled=body.replace(/\{\{(\w+)\}\}/g,(m,k)=>({BANNER:banner,PREVIOUS:previous,NOTICE_DATE:noticeDate,EFFECTIVE_DATE:effectiveDate,MAIL_PROVIDER:esc(mailProvider.trim()),MAIL_COUNTRY:esc(mailCountry.trim())})[k]??(()=>{throw Error('unknown placeholder '+m)})());
 return frame(page,labelCells(filled));
}
// Each cell after the first carries its column's name (data-th), which the phone layout shows (styles.css .table-wrap).
export function labelCells(html){
 return html.replace(/<table>([\s\S]*?)<\/table>/g,(t,inner)=>{
  const heads=[...inner.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(m=>m[1]);
  return '<table>'+inner.replace(/<tr>([\s\S]*?)<\/tr>/g,(r,cells)=>{let i=0;return '<tr>'+cells.replace(/<td>/g,()=>{const h=heads[i++];return i>1&&h?`<td data-th="${esc(h)}">`:'<td>'})+'</tr>'})+'</table>';
 });
}
function frame(page,inner){
 const a=page.indexOf('<article class="legal-article">'),b=page.indexOf('</article>');
 if(a<0||b<a)throw Error('the page has no <article class="legal-article">');
 return page.slice(0,a)+'<article class="legal-article">'+inner+page.slice(b);
}
const retitle=(html,suffix)=>html.replace(/<title>([^<·]+?)\s*·/,(m,t)=>`<title>${t.trim()} (${suffix}) ·`);
const noindex=html=>html.includes('name="robots"')?html:html.replace('<meta name="viewport" content="width=device-width,initial-scale=1">','<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">');
const NOTICE_START='<!--policy-v2-notice-->',NOTICE_END='<!--/policy-v2-notice-->';
const withNotice=(html,block)=>{
 const clean=html.includes(NOTICE_START)?html.slice(0,html.indexOf(NOTICE_START))+html.slice(html.indexOf(NOTICE_END)+NOTICE_END.length):html;
 return block?clean.replace(/(<h1>[^<]*<\/h1>)/,`$1${NOTICE_START}${block}${NOTICE_END}`):clean;
};

export function notice(opts){
 const {dir=ROOT,mailProvider,mailCountry,days=7,today=kst()}=opts;
 const statePath=path.join(dir,'release/policies/v2/state.json');
 const prev=existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):null;
 if(prev?.status==='effective')throw Error('the v2.0 policies are already in effect');
 const noticeDate=opts.noticeDate||prev?.notice_date||today;
 if(!DATE.test(noticeDate))throw Error('notice date must be YYYY-MM-DD');
 if(!(Number.isInteger(days)&&days>=7))throw Error('the notice period is at least 7 days');
 // Correcting the provider later keeps the announced dates; a new notice date starts a new period.
 const effectiveDate=prev&&!opts.noticeDate&&opts.days===undefined?prev.effective_date:addDays(noticeDate,days);
 const site=path.join(dir,'site-public-cleared');
 for(const kind of Object.keys(KINDS)){
  const cur=readFileSync(path.join(site,kind+'.html'),'utf8'),body=readFileSync(path.join(dir,'release/policies/v2',kind+'.body.html'),'utf8');
  const banner=`<p class="notice"><b>개정 예고</b> · ${josa(KINDS[kind].label,'은','는')} ${effectiveDate}부터 시행됩니다. 그 전까지는 <a href="./${kind}.html">현재 ${KINDS[kind].title}</a>${josa(KINDS[kind].title,'이','가').slice(KINDS[kind].title.length)} 적용됩니다. 회원 기능(가입·로그인, 후기·댓글·방문 사진, 새 사례 제보, 연구데이터, 기기 동기화) 도입에 따라 개정합니다.</p>`;
  const next=noindex(retitle(render(kind,withNotice(cur,''),body,{noticeDate,effectiveDate,mailProvider,mailCountry,banner}),'개정 예고'));
  writeFileSync(path.join(site,kind+'-next.html'),next);
  writeFileSync(path.join(site,kind+'.html'),withNotice(cur,`<p class="notice"><b>개정 안내</b> · ${josa(KINDS[kind].title,'이','가')} ${effectiveDate}부터 바뀝니다(회원 기능 도입). <a href="./${kind}-next.html">개정된 ${KINDS[kind].title} 보기</a> · 공고일 ${noticeDate}</p>`));
 }
 const state={status:'announced',notice_date:noticeDate,effective_date:effectiveDate,mail_provider:mailProvider.trim(),mail_country:mailCountry.trim(),version:'2.0.0'};
 writeFileSync(statePath,JSON.stringify(state,null,2)+'\n');
 return state;
}

export function effective({dir=ROOT,today=kst()}){
 const statePath=path.join(dir,'release/policies/v2/state.json');
 if(!existsSync(statePath))throw Error('announce first: node scripts/policy-v2.mjs notice …');
 const state=JSON.parse(readFileSync(statePath,'utf8'));
 if(state.status==='effective')return state;
 if(today<state.effective_date)throw Error(`the v2.0 policies apply from ${state.effective_date} (announced ${state.notice_date}); today is ${today}`);
 const site=path.join(dir,'site-public-cleared');
 for(const kind of Object.keys(KINDS)){
  const cur=withNotice(readFileSync(path.join(site,kind+'.html'),'utf8'),''),body=readFileSync(path.join(dir,'release/policies/v2',kind+'.body.html'),'utf8');
  const old=cur.replace(/(<h1>[^<]*<\/h1>)/,`$1<p class="notice">이 문서는 ${state.effective_date} 전까지 적용된 이전 버전(1.0.0)입니다. <a href="./${kind}.html">현재 ${KINDS[kind].title}</a></p>`);
  writeFileSync(path.join(site,kind+'-v1.html'),noindex(retitle(old,'이전 버전')));
  writeFileSync(path.join(site,kind+'.html'),render(kind,cur,body,{noticeDate:state.notice_date,effectiveDate:state.effective_date,mailProvider:state.mail_provider,mailCountry:state.mail_country,previous:` · <a href="./${kind}-v1.html">이전 버전(1.0.0)</a>`}));
  rmSync(path.join(site,kind+'-next.html'),{force:true});
 }
 const next={...state,status:'effective',effective_on:today};
 writeFileSync(statePath,JSON.stringify(next,null,2)+'\n');
 return next;
}

if(import.meta.url===`file://${process.argv[1]}`){
 const [cmd,...rest]=process.argv.slice(2),arg=k=>rest.find(a=>a.startsWith(`--${k}=`))?.slice(k.length+3);
 try{
  const out=cmd==='notice'?notice({mailProvider:arg('mail-provider'),mailCountry:arg('mail-country'),noticeDate:arg('notice-date'),...(arg('days')?{days:Number(arg('days'))}:{}),...(arg('today')?{today:arg('today')}:{})})
   :cmd==='effective'?effective(arg('today')?{today:arg('today')}:{}):(()=>{throw Error('usage: node scripts/policy-v2.mjs notice --mail-provider=… --mail-country=… | effective')})();
  console.log(JSON.stringify(out));
 }catch(e){console.error('policy-v2: '+e.message);process.exit(1)}
}
