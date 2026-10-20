// Live estimate: Wikipedia articles that mention a media facade, per language, mapped to Wikidata items with coordinates.
import {writeFile} from 'node:fs/promises';
const UA='LightArchitectureArchive/0.17 (+https://remona8787.github.io/; remona56@hanmail.net)';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(u){for(let i=0;i<4;i++){const r=await fetch(u,{headers:{'User-Agent':UA}});if(r.ok)return r.json();await sleep(4000*(i+1))}throw Error('failed '+u)}
const Q={en:['"media facade"','"media façade"','"LED facade"'],de:['"Medienfassade"'],ko:['"미디어파사드"','"미디어 파사드"'],ja:['"メディアファサード"'],zh:['"媒体立面"','"媒体幕墙"','"媒体外墙"'],fr:['"façade médiatique"','"façade média"'],es:['"fachada multimedia"','"fachada de medios"'],it:['"facciata mediatica"'],nl:['"mediagevel"'],pl:['"fasada multimedialna"'],ru:['"медиафасад"'],pt:['"fachada de mídia"','"fachada multimídia"'],tr:['"medya cephe"']};
const out={at:new Date().toISOString(),langs:{},items:{}};
for(const [lang,terms] of Object.entries(Q)){out.langs[lang]={};const api=`https://${lang}.wikipedia.org/w/api.php`;
 for(const t of terms){let hits=[],total=0,off=0;
  try{do{const s=await get(`${api}?action=query&format=json&list=search&srnamespace=0&srlimit=50&sroffset=${off}&srprop=snippet&srsearch=${encodeURIComponent(t)}&maxlag=5`);total=s.query.searchinfo.totalhits;hits.push(...s.query.search.map(h=>({title:h.title,snippet:h.snippet.replace(/<[^>]+>/g,'').slice(0,240)})));off=s.continue?.sroffset;await sleep(1000)}while(off&&off<500)}catch(e){out.langs[lang][t]={error:String(e)};continue}
  for(let i=0;i<hits.length;i+=50){const titles=hits.slice(i,i+50).map(h=>h.title).join('|');try{const p=await get(`${api}?action=query&format=json&prop=pageprops|coordinates&ppprop=wikibase_item&titles=${encodeURIComponent(titles)}&maxlag=5`);for(const pg of Object.values(p.query.pages)){const h=hits.find(x=>x.title===pg.title);if(h){h.qid=pg.pageprops?.wikibase_item||null;h.coords=!!pg.coordinates}}}catch{}await sleep(1000)}
  out.langs[lang][t]={total,fetched:hits.length,with_qid:hits.filter(h=>h.qid).length,with_coords:hits.filter(h=>h.coords).length,hits};
  for(const h of hits)if(h.qid){(out.items[h.qid]??={langs:[],coords:false,titles:[]});out.items[h.qid].langs.push(lang);out.items[h.qid].coords||=h.coords;out.items[h.qid].titles.push(lang+':'+h.title)}
 }}
out.summary={unique_items:Object.keys(out.items).length,with_coords:Object.values(out.items).filter(x=>x.coords).length};
await writeFile('explore/wiki-search.json',JSON.stringify(out,null,1));console.log(out.summary);
