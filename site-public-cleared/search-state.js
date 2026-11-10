(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AOLSearchState=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const pages=new Set(['explore','map','data']);
const strings={q:200,country:80,city:80,state:40,kind:40,category:80,district:80};
const facets=['region','kr_region','project_type','installation_method','technology','envelope_type','operating_status','origin'];
const sorts=new Set(['relevance','newest','name','year_desc','year_asc']);
function clean(input={}){
 const f={};for(const [key,max] of Object.entries(strings))if(typeof input[key]==='string'&&input[key].trim()&&input[key]!=='전체')f[key]=input[key].trim().slice(0,max);
 for(const key of facets){const values=Array.isArray(input[key])?input[key]:typeof input[key]==='string'?input[key].split(','):[];const list=[...new Set(values.filter(v=>typeof v==='string'&&/^[a-z0-9_-]{1,64}$/.test(v)))].slice(0,12);if(list.length)f[key]=list}
 for(const key of ['free','indoor','has_photo'])if(input[key]===true||input[key]==='1')f[key]=true;
 for(const key of ['year','year_from','year_to'])if(/^\d{4}$/.test(String(input[key]||''))&&+input[key]>=1000&&+input[key]<=2100)f[key]=String(input[key]);
 if(sorts.has(input.sort)&&input.sort!=='relevance')f.sort=input.sort;
 return f;
}
function read(hash){
 const raw=String(hash||'').replace(/^#/,''),i=raw.indexOf('?'),path=(i<0?raw:raw.slice(0,i))||'home';
 if(!pages.has(path.split('/')[0]))return null;
 const p=new URLSearchParams(i<0?'':raw.slice(i+1,6000)),input={};
 for(const key of [...Object.keys(strings),...facets,'free','indoor','has_photo','year','year_from','year_to','sort'])if(p.has(key))input[key]=facets.includes(key)?p.getAll(key).flatMap(v=>v.split(',')):p.get(key);
 return {path,hasState:i>=0,filters:clean(input),scope:['korea','world','seoul'].includes(p.get('scope'))?p.get('scope'):'all',view:p.get('view')==='rows'?'rows':'cards'};
}
function write(path,{filters={},scope='all',view='cards'}={}){
 if(!pages.has(String(path).split('/')[0]))return '#'+path;
 const p=new URLSearchParams();for(const [key,value] of Object.entries(clean(filters)))p.set(key,Array.isArray(value)?value.join(','):value===true?'1':value);
 if(['korea','world','seoul'].includes(scope))p.set('scope',scope);
 if(view==='rows')p.set('view','rows');
 // A trailing ? marks an explicitly unfiltered route and makes a shared link independent of in-memory filters.
 return '#'+path+'?'+p.toString();
}
function relax(input,mode){
 const result=clean(input);
 if(mode==='photos')delete result.has_photo;
 if(mode==='location')for(const key of ['country','city','district','region','kr_region'])delete result[key];
 return result;
}
return {clean,read,write,relax};
});
