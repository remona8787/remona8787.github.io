// Writes the test fixture of the static archive dataset to qa/fixtures/site-data/ (manifest, home, index, shards,
// stats) from qa/fixtures/site-data-projects.mjs. TEST DATA, never published: see the header of that file.
//   node qa/fixtures/make-site-data.mjs
import {mkdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {RECORDS,siteData} from './site-data-projects.mjs';
const out=path.join(import.meta.dirname,'site-data');
const d=siteData(RECORDS);
await rm(out,{recursive:true,force:true});
await mkdir(path.join(out,'projects'),{recursive:true});
const json=v=>JSON.stringify(v)+'\n';
await writeFile(path.join(out,'manifest.json'),JSON.stringify(d.manifest,null,1)+'\n');
await writeFile(path.join(out,'home.json'),json(d.home));
await writeFile(path.join(out,'index.json'),json(d.index));
await writeFile(path.join(out,'stats.json'),json(d.stats));
for(const [s,v] of Object.entries(d.shards))await writeFile(path.join(out,'projects',s+'.json'),json(v));
console.log('site-data fixture:',RECORDS.length,'projects,',Object.keys(d.shards).length,'shards →',path.relative(process.cwd(),out));
