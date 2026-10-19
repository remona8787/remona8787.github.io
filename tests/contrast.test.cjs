// WCAG 2.x contrast of the design tokens, read from site-public-cleared/styles.css in both themes.
// Text needs 4.5:1, non-text UI (focus rings, control borders, the saved heart, selected chips) 3:1.
// Translucent colours (#RRGGBBAA: glass bars, photo credit pills, scrims) are composited over what sits under them,
// including a pure white and a pure black photo.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const css=fs.readFileSync(__dirname+'/../site-public-cleared/styles.css','utf8');
function tokens(re,name){const m=css.match(re);assert.ok(m,'token block not found: '+name);return Object.fromEntries([...m[1].matchAll(/--([a-z0-9-]+):(#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?);/g)].map(x=>[x[1],x[2].toUpperCase()]))}
const themes={
 light:tokens(/:root\{\s*color-scheme:light;([^}]*)\}/,'light'),
 dark:tokens(/:root\[data-theme=dark\]\{([^}]*)\}/,'dark'),
};
const system=tokens(/@media \(prefers-color-scheme:dark\)\{\s*:root:not\(\[data-theme=light\]\)\{([^}]*)\}/,'system dark');

const rgba=h=>{h=h.replace('#','');return [0,2,4,6].map(i=>i<h.length?parseInt(h.slice(i,i+2),16):255)};
const over=(fg,bg)=>{const a=fg[3]/255;return [0,1,2].map(i=>fg[i]*a+bg[i]*(1-a)).concat(255)};
const lum=c=>{const [r,g,b]=c.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b};
function ratio(t,fg,bg,under){const v=k=>k.startsWith('#')?k:t[k];for(const k of [fg,bg,under].filter(Boolean))assert.ok(v(k),'unknown token '+k);let b=rgba(v(bg));if(b[3]<255)b=over(b,rgba(v(under||'#FFFFFF')));let f=rgba(v(fg));if(f[3]<255)f=over(f,b);const [x,y]=[lum(f),lum(b)];return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}

const TEXT=4.5,UI=3;
const each=(fgs,bgs,min,label,under)=>fgs.flatMap(f=>bgs.map(b=>[f,b,min,label,under]));
const pairs=[
 ...each(['text'],['bg','surface','elevated','panel','panel-strong'],TEXT,'body text'),
 ...each(['text-muted'],['bg','surface','elevated','panel'],TEXT,'metadata'),
 ...each(['text-subtle'],['surface','elevated'],TEXT,'placeholder (surface only)'),
 ...each(['accent','accent-strong'],['bg','surface','elevated','panel'],TEXT,'accent text and links'),
 ...each(['accent-ink'],['accent','accent-strong'],TEXT,'primary button label'),
 ['accent-on-soft','accent-soft',TEXT,'tonal button, info pill, active sidebar item'],
 ['accent-on-soft','surface',TEXT,'active sidebar count'],
 ['chip-on-ink','chip-on-bg',TEXT,'selected chip label'],
 ...each(['navy-ink','navy-muted'],['navy','navy-deep','hero-start','hero-mid','hero-end'],TEXT,'text on navy and the hero gradient'),
 ['vermilion-ink','vermilion-strong',TEXT,'LIVE badge, destructive confirm'],
 ...each(['vermilion-strong'],['bg','surface','elevated','panel'],TEXT,'destructive and error text'),
 ['vermilion-on-soft','vermilion-soft',TEXT,'destructive button'],
 ...each(['success'],['success-bg','surface'],TEXT,'success'),
 ['warning-ink','warning-bg',TEXT,'warning notice, offline pill'],
 ...each(['inverse-ink','inverse-accent'],['inverse-bg'],TEXT,'toast'),
 ...['bg','#FFFFFF','#000000'].map(u=>['text','glass',TEXT,'app bar and glass buttons over '+u,u]),
 ...['bg','#FFFFFF','#000000'].flatMap(u=>[['text-muted','tabbar',TEXT,'inactive tab over '+u,u],['accent','tabbar',TEXT,'active tab over '+u,u]]),
 ...['#FFFFFF','#000000'].map(u=>['#FFFFFF','credit-bg',TEXT,'photo credit pill over a '+u+' photo',u]),
 ['#FFFFFF','scrim',TEXT,'text on the photo scrim over a white photo','#FFFFFF'],
 // non-text
 ...each(['vermilion'],['bg','surface'],UI,'live dot, saved heart'),
 ['vermilion','glass',UI,'saved heart on its glass button over a white photo','#FFFFFF'],
 ...each(['focus'],['bg','surface','elevated','panel'],UI,'focus ring'),
 ...each(['line-strong'],['bg','surface','elevated'],UI,'input and switch borders'),
 ...each(['chip-on-bg'],['bg','surface'],UI,'selected chip against its container'),
 ['accent','accent-soft',UI,'icon in a tinted square, active tab indicator'],
 ...each(['chart-bar'],['surface','elevated','panel'],UI,'data-page chart bars'),
];
for(const [name,t] of Object.entries(themes))for(const [fg,bg,min,label,under] of pairs)
 test(`${name}: ${label} — ${fg} on ${bg}${under?' over '+under:''} ≥ ${min}`,()=>{const r=ratio(t,fg,bg,under);assert.ok(r>=min,`${r.toFixed(2)}:1`)});

test('the system dark theme uses exactly the explicit dark theme values',()=>assert.deepEqual(system,themes.dark));
test('brand values from brand/README.md are the UI anchors',()=>{
 const l=themes.light,d=themes.dark;
 assert.equal(l.navy,'#1C1F4A');assert.equal(l.text,'#151A38');assert.equal(l.accent,'#6B52DE');assert.equal(l.vermilion,'#F04E37');
 assert.equal(d.accent,'#A08CFF');assert.equal(d.text,'#F4F1FF');assert.equal(d.vermilion,'#FF5A3D');
});
test('every colour token is defined in both themes',()=>assert.deepEqual(Object.keys(themes.dark).sort(),Object.keys(themes.light).sort()));
