// Browser specs: serve a static archive dataset at /data/ (the fixture of qa/fixtures/site-data, or one built in memory
// from records), and answer Commons image requests with the synthetic test images of qa/fixtures/images.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {siteData,RECORDS} from './site-data-projects.mjs';
const dir=import.meta.dirname;
const json=body=>({status:200,contentType:'application/json',body:typeof body==='string'?body:JSON.stringify(body)});
// files: {'manifest.json': {...}, 'home.json': ..., 'index.json': ..., 'projects/000.json': ...}
export function filesOf(d){const out={'manifest.json':d.manifest,'home.json':d.home,'index.json':d.index,'stats.json':d.stats};for(const [s,v] of Object.entries(d.shards))out[`projects/${s}.json`]=v;return out}
// The deployment's public research package (data/research/latest.json, published by scripts/research-package.mjs).
export const RESEARCH_LATEST={dataset:'architecture-of-light',title:'빛의 건축 공개 데이터',version:'fixture-2026-10-20T06-17Z',created:'2026-10-20T06:20:00Z',data_as_of:'2026-10-20',path:'data/research/fixture-2026-10-20T06-17Z/',citation:'빛의 건축 아카이브 공개 데이터 (시험용), 버전 fixture-2026-10-20T06-17Z.',counts:{projects:RECORDS.length},files:{'projects.csv':{bytes:20480,sha256:'ab'.repeat(32)},'projects.json':{bytes:40960,sha256:'cd'.repeat(32)},'images.csv':{bytes:9000,sha256:'ef'.repeat(32)},'CITATION.txt':{bytes:200,sha256:'01'.repeat(32)}}};
export const FIXTURE={...filesOf(siteData(RECORDS)),'research/latest.json':RESEARCH_LATEST};
/** Serves files under /data/; every request is recorded in the returned list (path relative to /data/). */
export async function serveDataset(page,files=FIXTURE,{delay=0}={}){
 const seen=[];
 await page.route(/\/data\/[^?]*\.json(\?.*)?$/,async route=>{
  const u=new URL(route.request().url()),rel=u.pathname.replace(/^.*?\/data\//,'');seen.push(rel);
  if(delay)await new Promise(r=>setTimeout(r,delay));
  if(rel in files)return route.fulfill(json(files[rel]));
  return route.fulfill({status:404,contentType:'text/html',body:'<!doctype html><title>404</title>'});
 });
 return seen;
}
/** No dataset (local development, previews): /data/ answers 404 like a host without the pipeline. */
export async function noDataset(page){await page.route(/\/data\/[^?]*\.json(\?.*)?$/,r=>r.fulfill({status:404,contentType:'text/html',body:'<!doctype html><title>404</title>'}))}
const KIND={hero:'night',night:'night',art:'art',led:'led',day:'day',scene:'art',small:'night'},COUNT={night:3,art:3,led:2,day:2};
const cache=new Map();
async function image(kind,n){const k=KIND[kind]||'night',file=`${k}-${1+(n%COUNT[k])}.jpg`;if(!cache.has(file))cache.set(file,await readFile(path.join(dir,'images',file)));return cache.get(file)}
/** Fixture_<id>_<kind>_<n>.jpg on upload/thumb.wikimedia.org → a synthetic image of that kind; any other image → night.
 * Returns the list of image URLs requested. fail: every image answers 404; fail can also be a function of the URL. */
export async function serveImages(page,{fail=false}={}){
 const seen=[];
 await page.route(/^https:\/\/(upload|thumb)\.wikimedia\.org\//,async route=>{
  const url=route.request().url();seen.push(url);
  if(typeof fail==='function'?fail(url):fail)return route.fulfill({status:404,body:''});
  const m=/Fixture_(.+?)_(hero|night|art|led|day|scene|small)_(\d+)\.jpg/.exec(decodeURIComponent(url));
  let h=0;for(const ch of m?m[1]:route.request().url())h=(h*31+ch.charCodeAt(0))>>>0;
  return route.fulfill({status:200,contentType:'image/jpeg',body:await image(m?m[2]:'night',h+(m?Number(m[3]):0))});
 });
 return seen;
}
