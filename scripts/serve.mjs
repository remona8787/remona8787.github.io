// Minimal static server for dist/ that applies the same _headers (CSP etc.) as Netlify/Cloudflare Pages.
// Usage: node scripts/serve.mjs [dir=dist] [port=4173]
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
const dir=path.resolve(process.argv[2]||'dist'),port=Number(process.argv[3]||4173);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.xml':'application/xml','.txt':'text/plain; charset=utf-8'};
const rules=[];let current;
for(const line of (await readFile(path.join(dir,'_headers'),'utf8').catch(()=>'')).split('\n')){
 if(!line.trim())continue;
 if(!/^\s/.test(line)){current={pattern:line.trim(),headers:{}};rules.push(current);continue}
 const i=line.indexOf(':');if(current&&i>0)current.headers[line.slice(0,i).trim()]=line.slice(i+1).trim();
}
const matches=(p,u)=>p.endsWith('*')?u.startsWith(p.slice(0,-1)):p===u;
createServer(async(req,res)=>{
 let url=decodeURIComponent(new URL(req.url,'http://x').pathname);
 let file=path.join(dir,url);if(!file.startsWith(dir)){res.writeHead(403).end();return}
 try{if((await stat(file)).isDirectory())file=path.join(file,'index.html');}catch{}
 const headers={};for(const r of rules)if(matches(r.pattern,url))Object.assign(headers,r.headers);
 try{const body=await readFile(file);res.writeHead(200,{...headers,'Content-Type':types[path.extname(file)]||'application/octet-stream'}).end(body)}
 catch{const body=await readFile(path.join(dir,'404.html')).catch(()=>'Not found');res.writeHead(404,{...headers,'Content-Type':types['.html']}).end(body)}
}).listen(port,'127.0.0.1',()=>console.log(`Serving ${dir} on http://127.0.0.1:${port}`));
