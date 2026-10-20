// A generative "LED facade": a grid of light points in the brand palette, slowly animated like a media mesh at night.
// It is a brand graphic, never a picture of a real project: the home hero uses it when no reviewed hero photo exists,
// and smaller copies accent empty states. Each <canvas data-led> is drawn by one shared loop that
//  - runs at most 20 frames a second and only while a canvas is on screen (IntersectionObserver) and the tab visible,
//  - draws one still frame under prefers-reduced-motion,
//  - quantises the light levels into a few colours, so a frame is a handful of fills, not thousands.
const PALETTE = { light: ['#2B2873', '#4D38B6', '#6B52DE', '#A08CFF', '#D9D1FF', '#F4F1FF'], warm: '#FF5A3D' }
const LEVELS = PALETTE.light.length
const reduce = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const items = new Set()
let raf = 0, last = 0

function size(it) {
  const c = it.canvas, r = c.getBoundingClientRect(), dpr = Math.min(1.5, window.devicePixelRatio || 1)
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr))
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
  it.dpr = dpr
  const cell = Math.round((Number(c.dataset.cell) || (r.width < 640 ? 11 : 14)) * dpr)
  it.cell = Math.max(6, cell)
  it.cols = Math.ceil(w / it.cell) + 1; it.rows = Math.ceil(h / it.cell) + 1
}

// The light level of one point at time t: two slow interfering waves, a band sweeping up the facade like a scan, and
// an arch-shaped glow (the brand mark) breathing in the middle. Seeded per canvas so two canvases differ.
function level(x, y, t, it) {
  const s = it.seed, nx = x / it.cols, ny = y / it.rows
  const a = Math.sin(x * 0.21 + t * 0.55 + s) * Math.cos(y * 0.17 - t * 0.35 + s * 0.7)
  const b = Math.sin((x + y) * 0.09 - t * 0.8 + s * 1.3)
  const band = Math.exp(-((((ny + t * 0.06 + s) % 1.4) - 0.7) ** 2) * 40)
  const dx = (nx - 0.68) * 1.6, dy = (ny - 0.62) * 1.1, arch = Math.exp(-((Math.hypot(dx, Math.max(0, dy) * 1.4) - 0.32) ** 2) * 90) * (0.6 + 0.4 * Math.sin(t * 0.9 + s))
  return Math.max(0, Math.min(0.999, 0.18 + 0.22 * a + 0.16 * b + 0.32 * band + 0.55 * arch))
}

function draw(it, now) {
  const c = it.canvas, g = c.getContext('2d')
  if (!g) return
  const t = now / 1000, cell = it.cell, dot = Math.max(2, Math.round(cell * 0.42)), off = (cell - dot) / 2
  g.clearRect(0, 0, c.width, c.height)
  const buckets = Array.from({ length: LEVELS }, () => new Path2D()), warm = new Path2D()
  let warmN = 0
  for (let y = 0; y < it.rows; y++) for (let x = 0; x < it.cols; x++) {
    const v = level(x, y, t, it)
    if (v < 0.12) continue
    const px = x * cell + off, py = y * cell + off
    // A few warm (vermilion) points where the sweep is brightest: the live accent of the brand, used sparingly.
    if (v > 0.9 && ((x * 7 + y * 13 + it.salt) % 11 === 0)) { warm.rect(px, py, dot, dot); warmN++; continue }
    buckets[Math.min(LEVELS - 1, Math.floor(v * LEVELS))].rect(px, py, dot, dot)
  }
  buckets.forEach((p, i) => { g.globalAlpha = 0.35 + 0.65 * (i / (LEVELS - 1)); g.fillStyle = PALETTE.light[i]; g.fill(p) })
  if (warmN) { g.globalAlpha = 0.95; g.fillStyle = PALETTE.warm; g.fill(warm) }
  g.globalAlpha = 1
}

function loop(now) {
  raf = 0
  const live = [...items].filter(it => it.visible && it.canvas.isConnected)
  if (!live.length || document.hidden || reduce()) return
  if (now - last >= 50) { last = now; for (const it of live) draw(it, now) }
  raf = requestAnimationFrame(loop)
}
const kick = () => { if (!raf && !document.hidden && !reduce()) raf = requestAnimationFrame(loop) }

const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
  for (const e of entries) { const it = [...items].find(x => x.canvas === e.target); if (it) { it.visible = e.isIntersecting; if (it.visible) { size(it); draw(it, performance.now()) } } }
  kick()
}, { rootMargin: '64px' }) : null

export function mount(root = document) {
  for (const it of [...items]) if (!it.canvas.isConnected) { io?.unobserve(it.canvas); items.delete(it) }
  for (const canvas of root.querySelectorAll?.('canvas[data-led]') || []) {
    if ([...items].some(it => it.canvas === canvas)) continue
    let h = 0
    for (const ch of String(canvas.dataset.led || 'aol')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    const it = { canvas, seed: (h % 1000) / 160, salt: h % 11, visible: !io }
    items.add(it)
    size(it)
    // The still frame is drawn at once, so a reduced-motion or off-screen canvas is never blank.
    draw(it, 12000 + (h % 5000))
    io?.observe(canvas)
  }
  kick()
}

let resizeTimer = 0
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { for (const it of items) { size(it); draw(it, performance.now()) } }, 120) })
document.addEventListener('visibilitychange', kick)
window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => { for (const it of items) draw(it, performance.now()); kick() })
window.AOLLed = { mount }
mount()
