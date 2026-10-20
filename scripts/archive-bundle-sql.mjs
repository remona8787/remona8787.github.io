// Copies the archive migration into release/launch/complete-backend.sql. The bundle runs in one transaction, so the
// migration's own begin;/commit; lines are left out; everything else is carried verbatim, between its
// "-- SOURCE: migrations/20261018000000_media_facade_archive.sql" marker and the next "-- SOURCE:" marker.
// tests/archive-sql.test.mjs checks the result. Run after every change to the migration: npm run archive:bundle-sql
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const NAME='migrations/20261018000000_media_facade_archive.sql';
const MARK='-- SOURCE: '+NAME+'\n';
const migration=await readFile(path.join(root,'supabase',NAME),'utf8');
const body=migration.split('\n').filter(l=>!['begin;','commit;'].includes(l.trim())).join('\n').trim();
const file=path.join(root,'release/launch/complete-backend.sql');
const bundle=await readFile(file,'utf8');
const start=bundle.indexOf(MARK);
if(start<0)throw Error('complete-backend.sql has no '+MARK.trim()+' section');
const next=bundle.indexOf('\n-- SOURCE: ',start+MARK.length);
if(next<0)throw Error('the archive section must be followed by another -- SOURCE: section');
const out=bundle.slice(0,start)+MARK+body+bundle.slice(next);
if(out===bundle)console.log('complete-backend.sql already carries the archive migration');
else{await writeFile(file,out);console.log('Wrote the archive migration into release/launch/complete-backend.sql');}
