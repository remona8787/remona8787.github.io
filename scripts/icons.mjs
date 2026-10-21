// The app's icon set: Phosphor Icons (MIT, npm @phosphor-icons/core, pinned in package-lock) plus the brand arch.
// scripts/build.mjs inlines them as one SVG sprite into every built page that has an <!--icons--> marker, so icons
// render offline, need no extra request and follow currentColor. Markup uses <svg class="icon"><use href="#i-NAME"/></svg>
// (app.js: I('NAME')). tests/app.test.cjs checks that every icon the app renders is in this list.
import {readFile} from 'node:fs/promises';
import path from 'node:path';

// Regular weight. Keep sorted by role so additions are easy to review.
export const REGULAR=[
 // navigation and shell
 'house','compass','map-trifold','heart','user-circle','user','magnifying-glass','arrow-left','arrow-right','arrow-up-right','arrow-up','arrow-down','caret-left','caret-right','caret-down','x','plus','check','gear-six','wifi-slash','globe',
 // actions
 'share-network','link','arrows-clockwise','download-simple','upload-simple','trash','printer','copy','calendar-plus','note-pencil','camera','images','sliders-horizontal','crosshair','navigation-arrow','list','rows','squares-four','pencil-simple','device-mobile','shield-check','list-checks','sign-in','sign-out','lock-key','cloud-check','dots-three',
 // content
 'map-pin','map-pin-area','bookmarks-simple','path','calendar-blank','notebook','book-open-text','globe-hemisphere-east','info','warning','star','sun','moon','circle-half','clock','seal-check','lifebuoy','file-text','scroll',
 // archive: research data page, citation, language, data status, map legend
 'chart-bar','quotes','translate','database','link-break','seal-question','users-three','circle',
 // categories (catalog.js)
 'buildings','sparkle','monitor-play','lightbulb-filament','moon-stars','shapes','frame-corners','confetti'
];
// Filled weight, used for active and selected states (id i-NAME-fill).
export const FILLED=['house','compass','map-trifold','heart','user-circle','star','buildings','sparkle','globe-hemisphere-east','magnifying-glass','bookmarks-simple'];
export const ALL=[...REGULAR,...FILLED.map(n=>n+'-fill'),'arch'];

const inner=svg=>svg.replace(/^[\s\S]*?<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'').trim();

export async function sprite(root){
 const base=path.join(root,'node_modules/@phosphor-icons/core/assets');
 const symbols=[];
 for(const n of REGULAR)symbols.push(`<symbol id="i-${n}" viewBox="0 0 256 256">${inner(await readFile(path.join(base,'regular',n+'.svg'),'utf8'))}</symbol>`);
 for(const n of FILLED)symbols.push(`<symbol id="i-${n}-fill" viewBox="0 0 256 256">${inner(await readFile(path.join(base,'fill',n+'-fill.svg'),'utf8'))}</symbol>`);
 // The brand mark in one colour (brand/symbol-mono.svg, the source of truth), for empty states and photo placeholders.
 const mono=inner(await readFile(path.join(root,'brand/symbol-mono.svg'),'utf8')).replace(/<title>[\s\S]*?<\/title>/,'');
 symbols.push(`<symbol id="i-arch" viewBox="0 0 64 64">${mono}</symbol>`);
 return `<svg xmlns="http://www.w3.org/2000/svg" class="sprite" width="0" height="0" aria-hidden="true" focusable="false">${symbols.join('')}</svg>`;
}
