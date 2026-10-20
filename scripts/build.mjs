import {cp,rm,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
// node scripts/build.mjs [--out=<dir>]   (default dist/, the directory every host deploys; --out is for tests)
// SITE_URL=https://remona8787.github.io node scripts/build.mjs   the public site root (GitHub Pages); without it the
// build keeps the PUBLIC_URL of site-public-cleared/config.js. It is written into config.js PUBLIC_URL,
// config.example.js, robots.txt, sitemap.xml and the canonical/og: URLs of the pages; the Supabase keys are never touched.
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(await readFile(path.join(root,'.openai/hosting.json'),'utf8'));
if(manifest.static?.directory!=='dist')throw Error('Expected dist output');
const outArg=process.argv.find(a=>a.startsWith('--out='));
const out=outArg?path.resolve(outArg.slice(6)):path.join(root,'dist');
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
await cp(path.join(root,'site-public-cleared'),out,{recursive:true});
console.log('Built static app from site-public-cleared →',path.relative(root,out)||'.');

const {build}=await import('esbuild');
await build({entryPoints:[path.join(root,'client/cloud.js'),path.join(root,'client/native.js'),path.join(root,'client/supabase.js'),path.join(root,'client/live-media.js'),path.join(root,'client/global-places.js'),path.join(root,'client/archive.js')],bundle:true,minify:true,format:'esm',target:'es2022',outdir:path.join(out,'assets')});
// Third-party browser libraries are self-hosted (pinned by package-lock) instead of loaded from public CDNs.
const leaflet=path.join(root,'node_modules/leaflet/dist');
await mkdir(path.join(out,'assets/vendor/leaflet'),{recursive:true});
for(const f of ['leaflet.js','leaflet.css','images'])await cp(path.join(leaflet,f),path.join(out,'assets/vendor/leaflet',f),{recursive:true});

// Pretendard Variable (OFL-1.1, npm pretendard pinned by package-lock), self-hosted as the dynamic-subset build: the
// stylesheet splits the font into unicode-range chunks, so a page downloads only the chunks its text uses. Relative
// url()s in the stylesheet keep working because the chunk folder sits next to it. The licence ships with the files.
{
 const pretendard=path.join(root,'node_modules/pretendard/dist'),fonts=path.join(out,'assets/fonts/pretendard');
 await mkdir(fonts,{recursive:true});
 await cp(path.join(pretendard,'web/variable/pretendardvariable-dynamic-subset.css'),path.join(fonts,'pretendardvariable-dynamic-subset.css'));
 await cp(path.join(pretendard,'web/variable/woff2-dynamic-subset'),path.join(fonts,'woff2-dynamic-subset'),{recursive:true});
 await cp(path.join(pretendard,'LICENSE.txt'),path.join(fonts,'LICENSE.txt'));
}

// Icons (Phosphor, MIT, plus the brand arch): one inline SVG sprite replaces the <!--icons--> marker of each built page.
{
 const {sprite}=await import('./icons.mjs');
 const svg=await sprite(root);
 await cp(path.join(root,'node_modules/@phosphor-icons/core/LICENSE'),path.join(out,'assets/ICONS-LICENSE.txt'));
 let n=0;
 for(const name of await readdir(out)){
  if(!name.endsWith('.html'))continue;
  const file=path.join(out,name),html=await readFile(file,'utf8');
  if(!html.includes('<!--icons-->'))continue;
  await writeFile(file,html.replace('<!--icons-->',svg));n++;
 }
 if(!n)throw Error('No page has the <!--icons--> marker');
 console.log('Inlined',svg.length,'byte icon sprite into',n,'page(s)');
}

const htmlPages=async(dir=out)=>(await readdir(dir,{recursive:true})).filter(f=>f.endsWith('.html')).map(f=>path.join(dir,f));

// The public site URL. 404.html links root-absolute (/styles.css) so that it works at any depth, and the service worker
// is scoped to the site root, so SITE_URL must be the root of an https origin.
{
 const source=await readFile(path.join(root,'site-public-cleared/config.js'),'utf8');
 const PUBLIC_URL=/^(\s*PUBLIC_URL:\s*)'([^'\\]*)'/m;
 const current=source.match(PUBLIC_URL)?.[2];
 if(!current)throw Error('site-public-cleared/config.js has no PUBLIC_URL');
 const given=(process.env.SITE_URL||'').trim()||current;
 let site;
 try{site=new URL(given)}catch{throw Error(`SITE_URL is not a URL: ${given}`)}
 if(site.protocol!=='https:'||site.username||site.password||site.search||site.hash||site.pathname!=='/')throw Error(`SITE_URL must be an https site root such as https://remona8787.github.io (got ${given})`);
 const SITE_URL=site.origin;
 const rebase=u=>{try{const x=new URL(u);return SITE_URL+x.pathname+x.search}catch{throw Error('not an absolute URL: '+u)}};
 for(const name of ['config.js','config.example.js']){
  const file=path.join(out,name),js=await readFile(file,'utf8');
  if(!PUBLIC_URL.test(js))throw Error(name+' has no PUBLIC_URL');
  await writeFile(file,js.replace(PUBLIC_URL,(m,lead)=>`${lead}'${SITE_URL}'`));
 }
 const robots=await readFile(path.join(out,'robots.txt'),'utf8');
 if(!/^Sitemap: .*$/m.test(robots))throw Error('robots.txt has no Sitemap line');
 await writeFile(path.join(out,'robots.txt'),robots.replace(/^Sitemap: .*$/m,`Sitemap: ${SITE_URL}/sitemap.xml`));
 const sitemap=await readFile(path.join(out,'sitemap.xml'),'utf8');
 if(!sitemap.includes('<loc>'))throw Error('sitemap.xml lists no page');
 await writeFile(path.join(out,'sitemap.xml'),sitemap.replace(/<loc>([^<]*)<\/loc>/g,(m,u)=>`<loc>${rebase(u)}</loc>`));
 for(const file of await htmlPages()){
  const html=await readFile(file,'utf8');
  const next=html.replace(/(<link rel="canonical" href=")([^"]*)(")/g,(m,a,u,b)=>a+rebase(u)+b)
   .replace(/(<meta (?:property|name)="(?:og:url|og:image|twitter:image)" content=")([^"]*)(")/g,(m,a,u,b)=>a+rebase(u)+b);
  if(next!==html)await writeFile(file,next);
 }
 console.log('Site URL',SITE_URL);
}

// Hosts without custom headers (GitHub Pages) still get the security policy: every page carries the _headers
// Content-Security-Policy as a meta tag right after <meta charset>, without frame-ancestors (ignored in a meta
// element; X-Frame-Options and frame-ancestors need real headers). tests/deploy.test.mjs keeps the two equal.
{
 const headers=await readFile(path.join(out,'_headers'),'utf8');
 const policy=headers.match(/^\s+Content-Security-Policy:\s*(.+)$/m)?.[1].trim();
 if(!policy)throw Error('_headers has no Content-Security-Policy');
 const meta=policy.split(';').map(d=>d.trim()).filter(d=>d&&!/^frame-ancestors\b/.test(d)).join('; ');
 if(meta.includes('"'))throw Error('the policy cannot contain a double quote');
 const tag=`<meta http-equiv="Content-Security-Policy" content="${meta}">`;
 let n=0;
 for(const file of await htmlPages()){
  const html=await readFile(file,'utf8');
  if(/http-equiv="Content-Security-Policy"/i.test(html))throw Error(path.relative(out,file)+' already has a CSP meta tag');
  const charset=html.match(/<meta charset="utf-8">/i);
  if(!charset)throw Error(path.relative(out,file)+' has no <meta charset="utf-8">');
  await writeFile(file,html.slice(0,charset.index+charset[0].length)+tag+html.slice(charset.index+charset[0].length));n++;
 }
 console.log('Content-Security-Policy meta in',n,'page(s)');
}

// GitHub Pages runs Jekyll unless told not to, which would drop files that start with "_" and waste build time.
await writeFile(path.join(out,'.nojekyll'),'');

// The service worker serves the shell cache-first, so its cache name must change whenever any cached file does.
// Derive it from the built files' contents instead of relying on a manual bump.
{
 const {createHash}=await import('node:crypto');
 const swPath=path.join(out,'sw.js');
 const sw=await readFile(swPath,'utf8');
 const assets=JSON.parse(sw.match(/const ASSETS=(\[[^\]]*\]);/)[1].replace(/'/g,'"'));
 const hash=createHash('sha256');
 for(const a of assets)hash.update(a).update(await readFile(path.join(out,a)));
 const name='aol-'+hash.digest('hex').slice(0,12);
 if(!/const CACHE='[^']*';/.test(sw))throw Error('sw.js CACHE declaration not found');
 await writeFile(swPath,sw.replace(/const CACHE='[^']*';/,`const CACHE='${name}';`));
 console.log('Service worker cache',name);
}
