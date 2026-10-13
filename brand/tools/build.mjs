// Regenerates every 빛의 건축 brand asset from one geometry and one palette:
//   brand/                          symbols, lockups, app icon, PNGs, OG image
//   site-public-cleared/assets/     web symbol, favicon, PWA / Apple icons, OG image
//   android/…/res/mipmap-*/         launcher icons (legacy, round, adaptive foreground)
//   ios/…/AppIcon.appiconset/       1024 App Store / home-screen icon
// Wordmarks are Pretendard (OFL-1.1) glyph outlines, so no SVG depends on an installed font.
// PNGs are rasterised by Chromium from the app's @playwright/test devDependency.
//
// Usage, from light-architecture/:  npm ci && (cd brand/tools && npm ci) && node brand/tools/build.mjs
// Add --svg to skip the PNG renders.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import opentype from 'opentype.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BRAND = join(ROOT, 'brand');
const ASSETS = join(ROOT, 'site-public-cleared', 'assets');
const ANDROID_RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');
const IOS_ICON = join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
const FONT_DIR = join(HERE, 'node_modules', 'pretendard', 'dist', 'public', 'static');
const SVG_ONLY = process.argv.includes('--svg');

// ---------------------------------------------------------------- palette (7 values, nothing else)
export const PALETTE = {
  navy: '#1C1F4A',          // structure, wordmark, app-icon field
  ink: '#151A38',           // body text
  purple: '#6B52DE',        // light beam, sub-line, UI accent
  purpleOnDark: '#A08CFF',  // beam + sub-line on navy / dark
  lilacWhite: '#F4F1FF',    // structure + wordmark on navy / dark
  vermilion: '#F04E37',     // the source dot (light backgrounds)
  vermilionOnDark: '#FF5A3D', // the source dot (navy / dark backgrounds)
};
const P = PALETTE;
const SCHEME = {
  light: { arch: P.navy, beam: P.purple, dot: P.vermilion, text: P.navy, sub: P.purple },
  dark: { arch: P.lilacWhite, beam: P.purpleOnDark, dot: P.vermilionOnDark, text: P.lilacWhite, sub: P.purpleOnDark },
};

// ---------------------------------------------------------------- mark geometry (64-unit grid)
// Vault: outer R24 / inner R12 about (32,36), piers x8–20 and x44–56, floor y60, top y12.
// A skylight slot is cut through the vault at ~69°; the beam starts flush with the inner radius
// (it leaves the slot) and spreads to a 14-unit pool centred under the opening; the vermilion
// source sits on the slot axis above the vault.
const MARK = {
  arch: 'M8 60V36A24 24 0 0 1 36.18 12.37L33.47 24.09A12 12 0 0 0 20 36V60Z' +
        'M43.31 14.83A24 24 0 0 1 56 36V60H44V36A12 12 0 0 0 40.39 27.42Z',
  beam: 'M33.47 24.09A12 12 0 0 1 40.39 27.42L38 60H24Z',
  // one-colour version: beam offset 2.5 units down its axis so it stays separate from the vault
  beamMono: 'M33.04 26.55L39.96 29.88L38 60H24Z',
  dot: { cx: 41.2, cy: 7.2, r: 5.6 },
};
const BOX = { x0: 8, x1: 56, y0: 1.6, y1: 60, archTop: 12, floor: 60 }; // ink bounds of the mark
const PIER = 12; // clear-space unit: pier width = 12/64 of the symbol box

const f2 = v => String(Math.round(v * 100) / 100);
const pt = p => `${f2(p[0])} ${f2(p[1])}`;
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
function lineCircle(p0, d, c, R) {
  const ox = p0[0] - c[0], oy = p0[1] - c[1];
  const b = ox * d[0] + oy * d[1], disc = b * b - (ox * ox + oy * oy - R * R);
  const s = Math.sqrt(disc); return [-b - s, -b + s];
}

// 16/24 px favicon cut: same vault on the 64 grid (4 units = 1 px at 16 px), slot widened to
// 8 units (2 px) at the outer edge, beam floor 24–36, dot r6 at (42,6) = a 3 px dot.
function favCut() {
  const c = [32, 36], R = 24, r = 12, rad = Math.PI / 180;
  const pc = [c[0] + 18 * Math.cos(69 * rad), c[1] - 18 * Math.sin(69 * rad)]; // slot centre, mid radius
  const dirDeg = 76.98; // same cut direction as the full mark (parallel slot walls)
  const d = [Math.cos(dirDeg * rad), -Math.sin(dirDeg * rad)], n = [-d[1], d[0]];
  const edges = w => [add(pc, n, -w / 2), add(pc, n, w / 2)].map(p0 => ({
    O: add(p0, d, lineCircle(p0, d, c, R)[1]), I: add(p0, d, lineCircle(p0, d, c, r)[1]),
  })).sort((a, b) => a.O[0] - b.O[0]);
  let w = 8; // solve the perpendicular width that gives an 8-unit chord at the outer edge
  for (let i = 0; i < 30; i++) { const [L, Rt] = edges(w); w *= 8 / Math.hypot(Rt.O[0] - L.O[0], Rt.O[1] - L.O[1]); }
  const [L, Rt] = edges(w);
  return {
    arch: `M8 60V36A24 24 0 0 1 ${pt(L.O)}L${pt(L.I)}A12 12 0 0 0 20 36V60Z` +
          `M${pt(Rt.O)}A24 24 0 0 1 56 36V60H44V36A12 12 0 0 0 ${pt(Rt.I)}Z`,
    beam: `M${pt(L.I)}A12 12 0 0 1 ${pt(Rt.I)}L36 60H24Z`,
    dot: { cx: 42, cy: 6, r: 6 },
  };
}
const FAV = favCut();

const shapes = (m, col, beam = m.beam) =>
  `<path fill="${col.beam}" d="${beam}"/>` +
  `<path fill="${col.arch}" d="${m.arch}"/>` +
  `<circle fill="${col.dot}" cx="${m.dot.cx}" cy="${m.dot.cy}" r="${m.dot.r}"/>`;
const markLight = shapes(MARK, SCHEME.light), markDark = shapes(MARK, SCHEME.dark);
const svgDoc = (vb, body, label, attrs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${attrs} role="img" aria-label="${label}"><title>${label}</title>${body}</svg>\n`;
const NAME = '빛의 건축 Architecture of Light';

// ---------------------------------------------------------------- text → outlines (Pretendard)
const loadFont = w => { const b = readFileSync(join(FONT_DIR, `Pretendard-${w}.otf`)); return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const FONT = { Bold: loadFont('Bold'), SemiBold: loadFont('SemiBold') };
// own serialiser: every contour explicitly closed, 2-decimal coordinates
function toD(cmds) {
  let d = '', open = false;
  for (const c of cmds) {
    if (c.type === 'M') { if (open) d += 'Z'; d += `M${f2(c.x)} ${f2(c.y)}`; open = true; }
    else if (c.type === 'L') d += `L${f2(c.x)} ${f2(c.y)}`;
    else if (c.type === 'C') d += `C${f2(c.x1)} ${f2(c.y1)} ${f2(c.x2)} ${f2(c.y2)} ${f2(c.x)} ${f2(c.y)}`;
    else if (c.type === 'Q') d += `Q${f2(c.x1)} ${f2(c.y1)} ${f2(c.x)} ${f2(c.y)}`;
    else if (c.type === 'Z') { d += 'Z'; open = false; }
  }
  return open ? d + 'Z' : d;
}
const ink = (font, str, size, ls) => font.getPath(str, 0, 0, size, { kerning: true, letterSpacing: ls }).getBoundingBox();
// Place a string so that its ink box starts at (x, top) — or, with {cy}, is centred on cy.
function text(font, str, size, ls, { x, top, cy, baseline, cx }) {
  const b = ink(font, str, size, ls);
  const ox = cx !== undefined ? cx - (b.x1 + b.x2) / 2 : x - b.x1;
  const oy = baseline !== undefined ? baseline : top !== undefined ? top - b.y1 : cy - (b.y1 + b.y2) / 2;
  const p = font.getPath(str, ox, oy, size, { kerning: true, letterSpacing: ls });
  return { d: toD(p.commands), bb: p.getBoundingBox() };
}
const KO = '빛의 건축', KO_LS = -0.025, SUB = 'ARCHITECTURE OF LIGHT', SUB_LS = 0.14, EN = 'Architecture of Light', EN_LS = -0.012;
// sub-line keeps 0.14em tracking; its size is solved so it runs exactly the Korean wordmark's width
const subSizeFor = koWidth => { const b = ink(FONT.SemiBold, SUB, 1, SUB_LS); return koWidth / (b.x2 - b.x1); };

const M4 = 4; // inner margin of every lockup viewBox (the dot top at 1.6 → viewBox y starts at -2.4)
const vbOf = (x0, y0, x1, y1) => `${f2(x0 - M4)} ${f2(y0 - M4)} ${f2(x1 - x0 + 2 * M4)} ${f2(y1 - y0 + 2 * M4)}`;
const metrics = {};

// Full horizontal KO: Korean ink top on the arch top, sub-line baseline on the floor line.
function koHorizontal(col) {
  const x = BOX.x1 + 13;
  const ko = text(FONT.Bold, KO, 32.5, KO_LS, { x, top: BOX.archTop });
  const kw = ko.bb.x2 - ko.bb.x1, ss = subSizeFor(kw);
  const sub = text(FONT.SemiBold, SUB, ss, SUB_LS, { x: ko.bb.x1, baseline: BOX.floor });
  metrics.koHorizontal = { koWidth: f2(kw), koInk: [f2(ko.bb.y1), f2(ko.bb.y2)], subSize: f2(ss), subTop: f2(sub.bb.y1) };
  const right = Math.max(ko.bb.x2, sub.bb.x2);
  return svgDoc(vbOf(BOX.x0, BOX.y0, right, BOX.y1), shapes(MARK, col) + `<path fill="${col.text}" d="${ko.d}"/><path fill="${col.sub}" d="${sub.d}"/>`, NAME);
}
// Compact (app bar): symbol + Korean only. Type size = 0.75 × symbol box (24 px mark ↔ 18 px type),
// gap = 1/3 of the symbol box, Korean ink centred on the arch body (y 12–60), dot ignored.
function koCompact(col) {
  const size = 64 * 0.75, gap = 64 / 3;
  const ko = text(FONT.Bold, KO, size, KO_LS, { x: BOX.x1 + gap, cy: (BOX.archTop + BOX.floor) / 2 });
  metrics.koCompact = { size, gap: f2(gap), koInk: [f2(ko.bb.y1), f2(ko.bb.y2)], width: f2(ko.bb.x2 - BOX.x0) };
  return svgDoc(vbOf(BOX.x0, BOX.y0, ko.bb.x2, BOX.y1), shapes(MARK, col) + `<path fill="${col.text}" d="${ko.d}"/>`, '빛의 건축');
}
// Vertical KO: symbol (scaled ×VK) centred over the Korean wordmark and the justified sub-line.
const VK = 1.25;
const scaledMark = (col, k) => `<g transform="scale(${k})">${shapes(MARK, col)}</g>`;
function koVertical(col) {
  const cx = 32 * VK;
  const ko = text(FONT.Bold, KO, 32.5, KO_LS, { cx, top: BOX.floor * VK + 16 });
  const kw = ko.bb.x2 - ko.bb.x1, ss = subSizeFor(kw);
  const capH = FONT.SemiBold.tables.os2.sCapHeight / FONT.SemiBold.unitsPerEm * ss;
  const sub = text(FONT.SemiBold, SUB, ss, SUB_LS, { x: ko.bb.x1, baseline: ko.bb.y2 + 9 + capH });
  metrics.koVertical = { markWidth: 48 * VK, koWidth: f2(kw), subTop: f2(sub.bb.y1), bottom: f2(sub.bb.y2) };
  const x0 = Math.min(ko.bb.x1, sub.bb.x1, BOX.x0 * VK), x1 = Math.max(ko.bb.x2, sub.bb.x2, BOX.x1 * VK);
  return svgDoc(vbOf(x0, BOX.y0 * VK, x1, sub.bb.y2), scaledMark(col, VK) + `<path fill="${col.text}" d="${ko.d}"/><path fill="${col.sub}" d="${sub.d}"/>`, NAME);
}
// Horizontal EN: cap height centred on the arch body's optical centre.
function enHorizontal(col) {
  const size = 30, capH = FONT.SemiBold.tables.os2.sCapHeight / FONT.SemiBold.unitsPerEm * size;
  const base = (BOX.archTop + BOX.floor) / 2 + 1.5 + capH / 2;
  const t = text(FONT.SemiBold, EN, size, EN_LS, { x: BOX.x1 + 12, baseline: base });
  metrics.enHorizontal = { baseline: f2(base), ink: [f2(t.bb.y1), f2(t.bb.y2)] };
  return svgDoc(vbOf(BOX.x0, BOX.y0, t.bb.x2, BOX.y1), shapes(MARK, col) + `<path fill="${col.text}" d="${t.d}"/>`, 'Architecture of Light');
}
// Vertical EN: symbol (scaled ×VE) centred over the English name.
const VE = 1.5;
function enVertical(col) {
  const size = 22, capH = FONT.SemiBold.tables.os2.sCapHeight / FONT.SemiBold.unitsPerEm * size;
  const t = text(FONT.SemiBold, EN, size, EN_LS, { cx: 32 * VE, baseline: BOX.floor * VE + 16 + capH });
  metrics.enVertical = { markWidth: 48 * VE, width: f2(t.bb.x2 - t.bb.x1) };
  const x0 = Math.min(t.bb.x1, BOX.x0 * VE), x1 = Math.max(t.bb.x2, BOX.x1 * VE);
  return svgDoc(vbOf(x0, BOX.y0 * VE, x1, t.bb.y2), scaledMark(col, VE) + `<path fill="${col.text}" d="${t.d}"/>`, 'Architecture of Light');
}

// ---------------------------------------------------------------- icons
// App icon: flat navy field, mark ink box centred horizontally and lifted ~6 px for optical centre.
// Furthest point (pier corners) ≈ 392 px from centre < 409.6 px maskable safe circle.
const ICON_T = { x: 176, y: 182, s: 10.5 };
const iconMark = `<g transform="translate(${ICON_T.x} ${ICON_T.y}) scale(${ICON_T.s})">${markDark}</g>`;
const appIconSvg = svgDoc('0 0 1024 1024', `<rect width="1024" height="1024" fill="${P.navy}"/>${iconMark}`, '빛의 건축 app icon');
{
  const far = [[8, 60], [56, 60], [8, 36], [56, 36]].map(([x, y]) => Math.hypot(ICON_T.x + x * ICON_T.s - 512, ICON_T.y + y * ICON_T.s - 512));
  const dotFar = Math.hypot(ICON_T.x + MARK.dot.cx * ICON_T.s - 512, ICON_T.y + MARK.dot.cy * ICON_T.s - 512) + MARK.dot.r * ICON_T.s;
  metrics.appIcon = { maxDistance: f2(Math.max(...far, dotFar)), dotExtremity: f2(dotFar), safeRadius: 409.6 };
  if (Math.max(...far, dotFar) > 409.6) throw Error('app icon mark leaves the maskable safe circle');
}
// Superellipse (n=5) tile, the shape used for "any"-purpose and legacy launcher icons.
function squircle(cx, cy, a, n = 5, steps = 256) {
  let d = '';
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
    const x = cx + a * Math.sign(c) * Math.abs(c) ** (2 / n), y = cy + a * Math.sign(s) * Math.abs(s) ** (2 / n);
    d += `${i ? 'L' : 'M'}${f2(x)} ${f2(y)}`;
  }
  return d + 'Z';
}
// A tile = the 1024 app-icon composition scaled into a shape of `inset` (0–1) of the canvas.
function tileSvg(shape, inset = 1) {
  const k = inset, o = 512 * (1 - k);
  const clip = shape === 'circle' ? `<circle cx="512" cy="512" r="${512 * k}" fill="${P.navy}"/>` : `<path fill="${P.navy}" d="${squircle(512, 512, 512 * k)}"/>`;
  return svgDoc('0 0 1024 1024', `${clip}<g transform="translate(${f2(o)} ${f2(o)}) scale(${k})">${iconMark}</g>`, '빛의 건축 app icon');
}
// Android adaptive foreground: 108 dp canvas; the 1024 composition maps onto the central 72 dp.
const adaptiveForegroundSvg = svgDoc('0 0 108 108', `<g transform="translate(18 18) scale(${72 / 1024})">${iconMark}</g>`, '빛의 건축 launcher foreground');

// Favicon (16 px cut). The web copy follows the browser's colour scheme.
const favLight = svgDoc('0 0 64 64', shapes(FAV, SCHEME.light), '빛의 건축');
const favAdaptive = svgDoc('0 0 64 64',
  `<style>.b{fill:${P.purple}}.a{fill:${P.navy}}.d{fill:${P.vermilion}}@media (prefers-color-scheme:dark){.b{fill:${P.purpleOnDark}}.a{fill:${P.lilacWhite}}.d{fill:${P.vermilionOnDark}}}</style>` +
  `<path class="b" d="${FAV.beam}"/><path class="a" d="${FAV.arch}"/><circle class="d" cx="${FAV.dot.cx}" cy="${FAV.dot.cy}" r="${FAV.dot.r}"/>`, '빛의 건축');

// Symbol padded to the clear space (one pier width on every side), square, shifted 1.5 units left
// for optical balance — for avatars, splash and social use at 64 px and up.
function paddedSvg(col) {
  const side = (BOX.y1 - BOX.y0) + 2 * PIER;
  const cx = (BOX.x0 + BOX.x1) / 2 + 1.5, cy = (BOX.y0 + BOX.y1) / 2;
  return svgDoc(`${f2(cx - side / 2)} ${f2(cy - side / 2)} ${f2(side)} ${f2(side)}`, shapes(MARK, col), NAME);
}

// ---------------------------------------------------------------- write SVGs
const out = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); };
const svgs = {
  'symbol.svg': svgDoc('0 0 64 64', markLight, NAME),
  'symbol-dark.svg': svgDoc('0 0 64 64', markDark, NAME),
  'symbol-mono.svg': svgDoc('0 0 64 64', shapes(MARK, { arch: 'currentColor', beam: 'currentColor', dot: 'currentColor' }, MARK.beamMono), NAME),
  'symbol-16.svg': favLight,
  'symbol-padded.svg': paddedSvg(SCHEME.light),
  'symbol-padded-dark.svg': paddedSvg(SCHEME.dark),
  'app-icon.svg': appIconSvg,
  'logo-ko-light-horizontal.svg': koHorizontal(SCHEME.light),
  'logo-ko-dark-horizontal.svg': koHorizontal(SCHEME.dark),
  'logo-ko-light-compact.svg': koCompact(SCHEME.light),
  'logo-ko-dark-compact.svg': koCompact(SCHEME.dark),
  'logo-ko-light-vertical.svg': koVertical(SCHEME.light),
  'logo-ko-dark-vertical.svg': koVertical(SCHEME.dark),
  'logo-en-light-horizontal.svg': enHorizontal(SCHEME.light),
  'logo-en-dark-horizontal.svg': enHorizontal(SCHEME.dark),
  'logo-en-light-vertical.svg': enVertical(SCHEME.light),
  'logo-en-dark-vertical.svg': enVertical(SCHEME.dark),
};
for (const [name, svg] of Object.entries(svgs)) out(join(BRAND, name), svg);
out(join(ASSETS, 'symbol.svg'), svgs['symbol.svg']);
out(join(ASSETS, 'symbol-dark.svg'), svgs['symbol-dark.svg']);
out(join(ASSETS, 'favicon.svg'), favAdaptive);
console.log('metrics', JSON.stringify(metrics));
console.log('wrote', Object.keys(svgs).length, 'brand SVGs + 3 web SVGs');
if (SVG_ONLY) process.exit(0);

// ---------------------------------------------------------------- OG image (1200×630)
const lockupDark = svgs['logo-ko-dark-horizontal.svg'];
function ogHtml() {
  const [, , vw, vh] = lockupDark.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  const h = 196, w = h * vw / vh; // lockup stays inside the centred 630×630 square crop
  // A soft shaft of light falls at the mark's beam angle from beyond the top edge and pools on a
  // faint floor line. The beam layer overhangs the canvas so its blur never fades at the edges.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:${P.navy}}
.stage{position:relative;width:1200px;height:630px;overflow:hidden;
 background:radial-gradient(120% 95% at 50% 42%, ${P.navy} 52%, ${P.ink} 100%)}
.beam{position:absolute;left:0;top:-120px;width:1200px;height:870px;filter:blur(24px)}
.floor{position:absolute;left:0;right:0;top:548px;height:1px;background:linear-gradient(90deg,transparent,${P.lilacWhite}1c 25%,${P.lilacWhite}1c 75%,transparent)}
.pool{position:absolute;left:720px;top:512px;width:500px;height:76px;border-radius:50%;background:radial-gradient(closest-side,${P.purpleOnDark}40,transparent);filter:blur(8px)}
.lock{position:absolute;left:${f2(600 - w / 2)}px;top:${f2(315 - h / 2 - 4)}px;width:${f2(w)}px;height:${f2(h)}px}
</style></head><body><div class="stage">
<svg class="beam" viewBox="0 -120 1200 870" width="1200" height="870"><defs><linearGradient id="g" x1="0" y1="-120" x2="0" y2="548" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="${P.purpleOnDark}" stop-opacity=".34"/><stop offset=".55" stop-color="${P.purple}" stop-opacity=".17"/><stop offset="1" stop-color="${P.purple}" stop-opacity=".06"/></linearGradient></defs>
<path d="M1040 -120L1135 -100L1080 548H800Z" fill="url(#g)"/></svg>
<div class="pool"></div><div class="floor"></div>
<img class="lock" src="data:image/svg+xml;base64,${Buffer.from(lockupDark).toString('base64')}" alt="">
</div></body></html>`;
}

// ---------------------------------------------------------------- PNG rendering
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function png(svg, w, h = w, { opaque = false } = {}) {
  await page.setViewportSize({ width: w, height: h });
  const sized = svg.replace('<svg ', `<svg width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" `);
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${sized}</body></html>`);
  return page.screenshot({ clip: { x: 0, y: 0, width: w, height: h }, omitBackground: !opaque, type: 'png' });
}
async function htmlPng(html, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html);
  await page.waitForTimeout(100);
  return page.screenshot({ clip: { x: 0, y: 0, width: w, height: h }, type: 'png' });
}
const written = [];
const save = (path, buf) => { out(path, buf); written.push(path.slice(ROOT.length + 1)); };

// brand
for (const s of [192, 512, 1024]) save(join(BRAND, `symbol-${s}.png`), await png(svgs['symbol.svg'], s));
const og = await htmlPng(ogHtml(), 1200, 630);
save(join(BRAND, 'og-image.png'), og);

// web
save(join(ASSETS, 'og-image.png'), og);
save(join(ASSETS, 'favicon.png'), await png(favLight, 48));
for (const s of [192, 512, 1024]) save(join(ASSETS, `icon-${s}.png`), await png(tileSvg('squircle'), s));
save(join(ASSETS, 'icon-maskable-512.png'), await png(appIconSvg, 512, 512, { opaque: true }));
save(join(ASSETS, 'apple-touch-icon.png'), await png(appIconSvg, 180, 180, { opaque: true }));

// Android (mdpi 1x … xxxhdpi 4x); legacy icons keep a 2 dp margin (44 dp shape in 48 dp)
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [dpi, k] of Object.entries(DENSITY)) {
  const dir = join(ANDROID_RES, `mipmap-${dpi}`);
  save(join(dir, 'ic_launcher.png'), await png(tileSvg('squircle', 44 / 48), 48 * k));
  save(join(dir, 'ic_launcher_round.png'), await png(tileSvg('circle', 44 / 48), 48 * k));
  save(join(dir, 'ic_launcher_foreground.png'), await png(adaptiveForegroundSvg, 108 * k));
}
out(join(ANDROID_RES, 'values', 'ic_launcher_background.xml'), `<resources><color name="ic_launcher_background">${P.navy}</color></resources>\n`);

// iOS: one 1024 universal icon, opaque (App Store rejects alpha)
save(join(IOS_ICON, 'AppIcon-512@2x.png'), await png(appIconSvg, 1024, 1024, { opaque: true }));

await browser.close();
console.log('wrote', written.length, 'PNGs');
