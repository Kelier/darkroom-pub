// Non-destructive pipeline in one canvas coordinate system:
// base (original / AI-expanded / erased) → perspective → 2.5D camera → crop → optics → film → local masks → overlays → layers.

import { RATIOS, fontString } from './presets.js';
import { cropSize, clampCrop, mulberry32 } from './analyze.js';
import { mk, filmParams, applyColor, needsColor, localParams, applyClarity, overlayGrain, overlayVignette, overlayLeak, overlayBloom, fillTexture, dateStampText } from './color.js';
import { drawLayer, roundRect } from './layers.js';
import { warpPerspective, parallax } from './gl.js';
import { buildSubjectGeometry } from './flow.js';

export { dateStampText, roundRect, drawLayer };

export const dimsOf = (o) => ({ w: o.naturalWidth || o.width, h: o.naturalHeight || o.height });
export const baseOf = (doc, M) => (doc.base && M.assets?.get(doc.base)) || M.img;

export function canvasAspect(doc, src) {
  const r = RATIOS.find(r => r.id === doc.ratio);
  if (r && r.value) return r.value;
  const d = dimsOf(src); return d.w / d.h;
}

// Geometry of the composition at a given output width.
export function layout(doc, src, outW) {
  const a = canvasAspect(doc, src);
  const W = Math.round(outW), H = Math.round(outW / a);
  const f = doc.frame, m = Math.min(W, H);
  if (doc.kind === 'collage') return { W, H, mode: 'collage', photo: { x: 0, y: 0, w: W, h: H } };
  if (f.mode === 'polaroid') {
    const margin = 0.09 * m, pa = f.photoAspect || 1;
    const fit = (cw) => { const b = 0.055 * cw, pw = cw - 2 * b, ph = pw / pa; return { cw, ch: ph + b * 4.6, b, pw, ph }; };
    let card = fit(W - 2 * margin);
    if (card.ch > H - 2 * margin) card = fit((W - 2 * margin) * (H - 2 * margin) / card.ch);
    const cx = (W - card.cw) / 2, cy = (H - card.ch) / 2 - card.b * 0.2;
    return { W, H, mode: 'polaroid', card: { x: cx, y: cy, w: card.cw, h: card.ch, b: card.b, rot: (f.rot || 0) * Math.PI / 180 },
      photo: { x: cx + card.b, y: cy + card.b, w: card.pw, h: card.ph } };
  }
  if (f.mode === 'film') {
    const strip = H * 0.1, side = W * 0.045;
    return { W, H, mode: 'film', strip, photo: { x: side, y: strip, w: W - 2 * side, h: H - 2 * strip } };
  }
  if (f.mode === 'none') return { W, H, mode: 'none', photo: { x: 0, y: 0, w: W, h: H } };
  if (f.mode === 'mat') {
    const o = (f.border ?? 0.035) * m, p = o + (f.pad ?? 0.09) * m;
    return { W, H, mode: 'mat', o, photo: { x: p, y: p, w: W - 2 * p, h: H - 2 * p - (f.pad ?? 0.09) * m * 0.3 } };
  }
  if (f.mode === 'exif') {
    const s = (f.pad ?? 0.035) * m, bar = Math.max(m * 0.12, H * 0.08);
    return { W, H, mode: 'exif', bar, photo: { x: s, y: s, w: W - 2 * s, h: H - s - bar } };
  }
  if (f.mode === 'stamp') {
    const mg = 0.08 * m, b = 0.05 * m;
    return { W, H, mode: 'stamp', card: { x: mg, y: mg, w: W - 2 * mg, h: H - 2 * mg }, photo: { x: mg + b, y: mg + b, w: W - 2 * (mg + b), h: H - 2 * (mg + b) - b * 0.9 } };
  }
  if (f.mode === 'slide') {
    const mg = 0.06 * m, win = 0.15 * m;
    return { W, H, mode: 'slide', card: { x: mg, y: mg, w: W - 2 * mg, h: H - 2 * mg }, photo: { x: mg + win, y: mg + win, w: W - 2 * (mg + win), h: H - 2 * (mg + win) } };
  }
  if (f.mode === 'scan') { const b = 0.055 * m; return { W, H, mode: 'scan', photo: { x: b, y: b * 1.25, w: W - 2 * b, h: H - 2.5 * b } }; }
  const p = (f.pad || 0) * m, pb = p + (f.bottom || 0) * H;
  return { W, H, mode: f.mode, photo: { x: p, y: p, w: W - 2 * p, h: H - p - pb } };
}

export function photoAspect(doc, src) { const L = layout(doc, src, 1000); return L.photo.w / L.photo.h; }

export function cropRect(doc, src, aspect, crop = doc.crop) {
  const { w: W, h: H } = dimsOf(src);
  const { cw, ch } = cropSize(W, H, aspect, crop.zoom || 1);
  const c = clampCrop(crop, cw, ch);
  return { sx: (c.cx - cw / 2) * W, sy: (c.cy - ch / 2) * H, sw: cw * W, sh: ch * H, cw, ch, cx: c.cx, cy: c.cy };
}

// ---------- source preparation (cached) ----------
const cache = new Map();
const cget = (k) => { const v = cache.get(k); if (v) { cache.delete(k); cache.set(k, v); } return v; };
let transient = false;   // animation / video frames are unique: compute but don't pollute the cache
const cset = (k, v) => { if (transient && !k.startsWith('scaled') && !k.startsWith('fit')) return v; cache.set(k, v); while (cache.size > 14) cache.delete(cache.keys().next().value); return v; };
export const clearRenderCache = () => cache.clear();

export const geoOn = (g) => !!g && (Math.abs(g.rotate || 0) > 0.01 || Math.abs(g.vert || 0) > 0.001 || Math.abs(g.horiz || 0) > 0.001);
export const camOn = (doc, M) => !!(doc.cam?.on && M.depth && (Math.abs(doc.cam.x || 0) + Math.abs(doc.cam.y || 0) + Math.abs(doc.cam.zoom || 0) > 0.001));
const camKey = (c) => [c.x, c.y, c.zoom, c.focus].map(v => (+v || 0).toFixed(3)).join(',');

function scaled(src, maxSide, key) {
  const { w, h } = dimsOf(src), k = Math.min(1, maxSide / Math.max(w, h));
  if (k >= 1) return src;
  const ck = 'scaled|' + key + '|' + maxSide; const hit = cget(ck); if (hit) return hit;
  const c = mk(w * k, h * k), x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
  return cset(ck, c);
}
function fitTo(src, w, h, key) {
  const ck = 'fit|' + key + '|' + w + 'x' + h; const hit = cget(ck); if (hit) return hit;
  const c = mk(w, h); c.getContext('2d').drawImage(src, 0, 0, w, h); return cset(ck, c);
}

export function prepareSource(doc, M, maxSide = 2048) {
  const base = baseOf(doc, M), g = geoOn(doc.geo), cam = camOn(doc, M);
  const { w, h } = dimsOf(base);
  const bkey = M.id + ':' + (doc.base || 'o');
  if (!g && !cam) return scaled(base, maxSide, bkey);
  const key = ['src', bkey, maxSide, g ? JSON.stringify(doc.geo) : '', cam ? camKey(doc.cam) + (M.plate ? 'p' : '') : ''].join('|');
  const hit = cget(key); if (hit) return hit;
  let c = scaled(base, maxSide, bkey);
  if (g) c = warpPerspective(c, doc.geo);
  if (cam) {
    const depth = g ? warpPerspective(M.depth.canvas, doc.geo) : M.depth.canvas;
    if (M.plate && M.fg) {
      const W = c.width, H = c.height;
      let plate = fitTo(M.plate, W, H, M.id + ':plate'), pd = M.plateDepth, fgm = M.fg;
      if (g) { plate = warpPerspective(plate, doc.geo); pd = warpPerspective(pd, doc.geo); fgm = warpPerspective(fgm, doc.geo); }
      const out = mk(W, H), x = out.getContext('2d');
      x.drawImage(parallax(plate, pd, doc.cam), 0, 0);
      x.drawImage(parallax(c, depth, doc.cam, fgm), 0, 0);
      c = out;
    } else c = parallax(c, depth, doc.cam);
  }
  void w; void h;
  return cset(key, c);
}

// Auxiliary maps (depth / subject mask) aligned with the prepared source.
export function aux(doc, M, kind) {
  const src = kind === 'depth' ? M.depth?.canvas : M.seg;
  if (!src) return null;
  const g = geoOn(doc.geo), cam = camOn(doc, M);
  if (!g && !cam) return src;
  const key = ['aux', kind, M.id, doc.base || 'o', g ? JSON.stringify(doc.geo) : '', cam ? camKey(doc.cam) : ''].join('|');
  const hit = cget(key); if (hit) return hit;
  let c = src;
  if (g) c = warpPerspective(c, doc.geo);
  if (cam) { const d = g ? warpPerspective(M.depth.canvas, doc.geo) : M.depth.canvas; c = parallax(c, d, doc.cam); }
  return cset(key, c);
}

function cropAux(a, cr, pw, ph) {
  const { w, h } = dimsOf(a);
  const c = mk(pw, ph), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(a, (cr.cx - cr.cw / 2) * w, (cr.cy - cr.ch / 2) * h, cr.cw * w, cr.ch * h, 0, 0, pw, ph);
  return c;
}

let probe = null;
// Focus depth is a property of the object, so sample before the 2.5D camera moves it on screen.
export function sampleDepth(doc, M, nx, ny) {
  const d = aux({ ...doc, cam: { ...(doc.cam || {}), on: false } }, M, 'depth'); if (!d) return null;
  if (!probe) probe = mk(1, 1).getContext('2d', { willReadFrequently: true });
  const { w, h } = dimsOf(d);
  probe.clearRect(0, 0, 1, 1);
  probe.drawImage(d, Math.max(0, Math.min(w - 3, nx * w - 1)), Math.max(0, Math.min(h - 3, ny * h - 1)), 3, 3, 0, 0, 1, 1);
  return probe.getImageData(0, 0, 1, 1).data[0] / 255;
}

// ---------- optics ----------
function ellipseMask(w, h, fx, fy, rx, ry) {
  const m = mk(w, h), x = m.getContext('2d');
  x.save(); x.translate(fx, fy); x.scale(1, ry / rx);
  const g = x.createRadialGradient(0, 0, rx * 0.45, 0, 0, rx);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, rx * 1.05, 0, Math.PI * 2); x.fill(); x.restore();
  return m;
}

function blurred(src, r) {
  const c = mk(src.width, src.height), x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  x.filter = `blur(${r}px)`; x.drawImage(src, 0, 0); x.filter = 'none';
  return c;
}

// Depth-aware lens blur: circle of confusion from |depth - focus depth|, composited in blur levels.
function lensBlur(c, dCrop, fd, o, fast) {
  const w = c.width, h = c.height, maxR = (o.aperture || 0) * 0.03 * Math.max(w, h);
  const N = fast ? 3 : 5, sw = Math.max(8, Math.round(w / 3)), sh = Math.max(8, Math.round(h / 3));
  const sm = mk(sw, sh), sx = sm.getContext('2d', { willReadFrequently: true });
  sx.drawImage(dCrop, 0, 0, sw, sh);
  const dd = sx.getImageData(0, 0, sw, sh).data;
  const dof = 0.03 + (o.focusR || 0.3) * 0.35;
  const coc = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) { const d = dd[i * 4] / 255; coc[i] = Math.min(1, Math.max(0, (Math.abs(d - fd) - dof * 0.35) / dof)); }
  const out = mk(w, h), ox = out.getContext('2d');
  ox.drawImage(c, 0, 0);
  const mcan = mk(sw, sh), mx = mcan.getContext('2d'), mid = mx.createImageData(sw, sh);
  for (let lv = 1; lv <= N; lv++) {
    for (let i = 0; i < sw * sh; i++) { mid.data[i * 4 + 3] = Math.min(255, Math.max(0, (coc[i] * N - (lv - 1)) * 255)); }
    mx.putImageData(mid, 0, 0);
    const layer = blurred(c, Math.max(0.5, maxR * lv / N)), lx = layer.getContext('2d');
    lx.globalCompositeOperation = 'destination-in'; lx.imageSmoothingQuality = 'high'; lx.drawImage(mcan, 0, 0, w, h);
    ox.drawImage(layer, 0, 0);
  }
  if ((o.bokeh || 0) > 0.01) {
    for (let i = 0; i < sw * sh; i++) mid.data[i * 4 + 3] = coc[i] * 255;
    mx.putImageData(mid, 0, 0);
    const hl = mk(w, h), hx = hl.getContext('2d');
    hx.filter = `brightness(0.72) contrast(5) blur(${maxR * 0.7}px)`; hx.drawImage(c, 0, 0); hx.filter = 'none';
    hx.globalCompositeOperation = 'destination-in'; hx.drawImage(mcan, 0, 0, w, h);
    ox.save(); ox.globalCompositeOperation = 'screen'; ox.globalAlpha = Math.min(1, o.bokeh * 1.1); ox.drawImage(hl, 0, 0); ox.restore();
  }
  return out;
}

function applyOptics(base, o, focus, sharpMask, depthCrop, fd, fast) {
  const w = base.width, h = base.height;
  const ap = o.aperture || 0, mo = o.motion || 0;
  if (ap < 0.01 && mo < 0.01) return base;
  let cur = base;
  if (mo >= 0.01) {
    const out = mk(w, h), x = out.getContext('2d');
    const len = mo * 0.09 * w, ang = (o.angle || 0) * Math.PI / 180, steps = fast ? 8 : 16;
    x.drawImage(base, 0, 0);
    for (let i = 1; i <= steps; i++) { const t = i / steps - 0.5; x.globalAlpha = 1 / (i + 1); x.drawImage(base, Math.cos(ang) * len * t, Math.sin(ang) * len * t); }
    x.globalAlpha = 1; cur = out;
  }
  if (ap >= 0.01) {
    if (depthCrop && fd != null && o.mode !== 'classic') cur = lensBlur(cur, depthCrop, fd, o, fast);
    else {
      const blur = ap * 0.022 * Math.max(w, h);
      const b = blurred(cur, blur), bx = b.getContext('2d');
      if (o.bokeh > 0.01) { bx.globalCompositeOperation = 'screen'; bx.globalAlpha = o.bokeh * 0.8; bx.filter = `brightness(0.8) contrast(4) blur(${blur * 0.6}px)`; bx.drawImage(base, 0, 0); }
      cur = b;
    }
  }
  // Keep the subject crisp: real subject mask when available, otherwise a soft ellipse.
  const keep = (ap >= 0.01 && !(depthCrop && fd != null && o.mode !== 'classic')) || (mo >= 0.01 && o.keepSubject !== false);
  if (keep) {
    const s = mk(w, h), sx = s.getContext('2d');
    sx.drawImage(base, 0, 0);
    sx.globalCompositeOperation = 'destination-in';
    sx.drawImage(sharpMask || ellipseMask(w, h, focus.x * w, focus.y * h, Math.max(8, (o.focusR || 0.32) * Math.max(w, h)), Math.max(8, (o.focusR || 0.32) * Math.max(w, h)) * (focus.ry || 1.3)), 0, 0);
    const out = mk(w, h), x = out.getContext('2d'); x.drawImage(cur, 0, 0); x.drawImage(s, 0, 0); cur = out;
  }
  return cur;
}

// ---------- local masks ----------
function smooth(e0, e1, v) { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0 || 1e-6))); return t * t * (3 - 2 * t); }

export function localMask(doc, M, lc, cr, pw, ph) {
  const m = lc.mask, c = mk(pw, ph), x = c.getContext('2d', { willReadFrequently: true });
  const toX = (nx) => ((nx - (cr.cx - cr.cw / 2)) / cr.cw) * pw, toY = (ny) => ((ny - (cr.cy - cr.ch / 2)) / cr.ch) * ph;
  if (m.kind === 'subject' || m.kind === 'background') {
    const s = aux(doc, M, 'seg'); if (!s) return null;
    x.drawImage(cropAux(s, cr, pw, ph), 0, 0);
    if (m.kind === 'background') invert(x, pw, ph);
  } else if (m.kind === 'depth') {
    const d = aux(doc, M, 'depth'); if (!d) return null;
    const sw = Math.max(8, Math.round(pw / 2)), sh = Math.max(8, Math.round(ph / 2));
    const dc = cropAux(d, cr, sw, sh), dx = dc.getContext('2d', { willReadFrequently: true }), id = dx.getImageData(0, 0, sw, sh);
    const lo = Math.min(m.near ?? 0.6, m.far ?? 1), hi = Math.max(m.near ?? 0.6, m.far ?? 1), f = Math.max(0.01, m.feather ?? 0.08);
    for (let i = 0; i < sw * sh; i++) { const v = id.data[i * 4] / 255; id.data[i * 4 + 3] = 255 * smooth(lo - f, lo + f, v) * (1 - smooth(hi - f, hi + f, v)); }
    dx.putImageData(id, 0, 0); x.imageSmoothingQuality = 'high'; x.drawImage(dc, 0, 0, pw, ph);
  } else if (m.kind === 'radial') {
    const cx = toX(m.cx), cy = toY(m.cy), rx = (m.rx / cr.cw) * pw, ry = (m.ry / cr.ch) * ph;
    x.save(); x.translate(cx, cy); x.scale(1, ry / Math.max(1, rx));
    const g = x.createRadialGradient(0, 0, rx * (1 - (m.feather ?? 0.5)), 0, 0, rx);
    g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(-rx * 2, -rx * 2, rx * 4, rx * 4); x.restore();
  } else if (m.kind === 'linear') {
    const g = x.createLinearGradient(toX(m.x0), toY(m.y0), toX(m.x1), toY(m.y1));
    g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, pw, ph);
  } else if (m.kind === 'brush') {
    const b = M.brush?.get(lc.id); if (!b) return null;
    x.drawImage(cropAux(b, cr, pw, ph), 0, 0);
  }
  if (m.invert) invert(x, pw, ph);
  return c;
}
function invert(x, w, h) {
  const t = mk(w, h), tx = t.getContext('2d'); tx.fillStyle = '#000'; tx.fillRect(0, 0, w, h);
  tx.globalCompositeOperation = 'destination-out'; tx.drawImage(x.canvas, 0, 0);
  x.clearRect(0, 0, w, h); x.drawImage(t, 0, 0);
}

function applyLocals(c, doc, M, cr) {
  const w = c.width, h = c.height, x = c.getContext('2d');
  for (const lc of doc.locals || []) {
    if (lc.hidden) continue;
    const mask = localMask(doc, M, lc, cr, w, h); if (!mask) continue;
    const adj = lc.adj || {};
    const t = mk(w, h), tx = t.getContext('2d', { willReadFrequently: true });
    tx.drawImage(c, 0, 0);
    const p = localParams(adj);
    if (needsColor(p)) applyColor(tx, w, h, p);
    if (Math.abs(adj.clarity || 0) > 0.01) applyClarity(t, adj.clarity);
    tx.globalCompositeOperation = 'destination-in'; tx.drawImage(mask, 0, 0);
    x.drawImage(t, 0, 0);
  }
}

// ---------- photo layer ----------
export function renderPhotoLayer(doc, M, pw, ph, opts = {}) {
  const src = prepareSource(doc, M, opts.hi ? 4096 : opts.transient ? 1280 : opts.fast ? 1400 : 2048);
  const cr = cropRect(doc, src, pw / ph);
  let c = mk(pw, ph), x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, cr.sx, cr.sy, cr.sw, cr.sh, 0, 0, pw, ph);
  const o = doc.optics || {}, an = M.an;
  if ((o.aperture || 0) > 0.01 || (o.motion || 0) > 0.01) {
    const fxN = o.focusX ?? an?.subject.cx ?? 0.5, fyN = o.focusY ?? an?.subject.cy ?? 0.5;
    const sb = an?.subject, { w: SW, h: SH } = dimsOf(src);
    const ryRatio = sb ? Math.max(0.6, Math.min(2.6, ((sb.y1 - sb.y0) * SH) / Math.max(1, (sb.x1 - sb.x0) * SW))) : 1.3;
    const focus = { x: (fxN - (cr.cx - cr.cw / 2)) / cr.cw, y: (fyN - (cr.cy - cr.ch / 2)) / cr.ch, ry: ryRatio };
    const seg = aux(doc, M, 'seg'), dep = aux(doc, M, 'depth');
    const useSeg = seg && o.focusX == null;
    const fd = dep ? sampleDepth(doc, M, fxN, fyN) : null;
    c = applyOptics(c, o, focus, useSeg ? cropAux(seg, cr, pw, ph) : null, dep ? cropAux(dep, cr, pw, ph) : null, fd, opts.fast);
    x = c.getContext('2d', { willReadFrequently: true });
  }
  const p = filmParams(doc.film);
  if (needsColor(p)) applyColor(x, c.width, c.height, p);
  if (doc.locals?.length) applyLocals(c, doc, M, cr);
  if (p.bloom > 0.001) { const s2 = mk(c.width, c.height); s2.getContext('2d').drawImage(c, 0, 0); overlayBloom(x, s2, c.width, c.height, p.bloom); }
  overlayLeak(x, c.width, c.height, p.leak, doc.film.seed);
  overlayVignette(x, c.width, c.height, p.vignette);
  overlayGrain(x, c.width, c.height, p.grain, Math.max(0.6, pw / 1100));
  if (doc.film.date) {
    const s = pw * 0.05;
    x.save(); x.font = fontString('stamp', s); x.textAlign = 'right'; x.textBaseline = 'bottom';
    x.shadowColor = 'rgba(255,120,40,0.9)'; x.shadowBlur = s * 0.35; x.fillStyle = '#ffa04a';
    x.fillText(doc.film.dateText || dateStampText(), pw - s * 0.9, ph - s * 0.7); x.restore();
  }
  return { canvas: c, crop: cr, src };
}

// Film-processed photo for collage cards (cached per asset / size / look).
function collagePhoto(doc, M, ly, iw, ih) {
  const ph = M.photos?.get(ly.asset); if (!ph) return null;
  const key = ['card', ly.asset, iw, ih, JSON.stringify(ly.crop || {}), JSON.stringify(doc.film)].join('|');
  const hit = cget(key); if (hit) return hit;
  const crop = ly.crop || { cx: 0.5, cy: 0.5, zoom: 1 };
  const cr = cropRect({ crop }, ph.img, iw / ih, crop);
  const c = mk(iw, ih), x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high'; x.drawImage(ph.img, cr.sx, cr.sy, cr.sw, cr.sh, 0, 0, iw, ih);
  const p = filmParams(doc.film);
  if (needsColor(p)) applyColor(x, iw, ih, p);
  overlayVignette(x, iw, ih, p.vignette * 0.7);
  overlayGrain(x, iw, ih, p.grain, Math.max(0.6, iw / 1100));
  return cset(key, c);
}

export function render(target, doc, M, outW, opts = {}) {
  const prev = transient; transient = !!opts.transient;
  try { return renderInner(target, doc, M, outW, opts); } finally { transient = prev; }
}

function renderInner(target, doc, M, outW, opts) {
  const base = baseOf(doc, M);
  const L = layout(doc, base, outW);
  target.width = L.W; target.height = L.H;
  const ctx = target.getContext('2d');
  const f = doc.frame, unit = L.W / 1000;
  const env = { assets: M.assets, photoCanvas: (ly, iw, ih) => collagePhoto(doc, M, ly, iw, ih) };
  ctx.save(); ctx.clearRect(0, 0, L.W, L.H);

  if (doc.kind === 'collage') {
    ctx.fillStyle = f.color || '#f4efe6'; ctx.fillRect(0, 0, L.W, L.H);
    fillTexture(ctx, f.texture, 0, 0, L.W, L.H, Math.max(0.5, L.W / 900));
    const boxes = [];
    for (const ly of doc.layers) { if (ly.hidden) continue; boxes.push({ id: ly.id, ...drawLayer(ctx, ly, L.W, L.H, env) }); }
    ctx.restore();
    return { L, crop: null, boxes };
  }

  const ph = L.photo;
  const photo = opts.original ? null : renderPhotoLayer(doc, M, Math.round(ph.w), Math.round(ph.h), opts);
  let geoC = null;
  env.subject = () => geoC || (geoC = (() => {
    if (!M.an) return null;
    const crop = photo?.crop || cropRect(doc, base, ph.w / ph.h), seg = aux(doc, M, 'seg');
    const gw = 160, gh = Math.max(8, Math.round(160 * ph.h / ph.w));
    return buildSubjectGeometry({ an: M.an, crop, photo: ph, mask: seg ? cropAux(seg, crop, gw, gh) : null });
  })());

  // background
  if (L.mode === 'blur' || L.mode === 'glass') {
    const { w: bw, h: bh } = dimsOf(base);
    ctx.filter = `blur(${L.W * 0.04}px) brightness(0.92) saturate(1.1)`;
    const s = Math.max(L.W / bw, L.H / bh) * 1.15;
    ctx.drawImage(base, (L.W - bw * s) / 2, (L.H - bh * s) / 2, bw * s, bh * s);
    ctx.filter = 'none';
  } else if (L.mode === 'mirror' && photo) {
    const pc = photo.canvas;
    ctx.save(); ctx.filter = `blur(${L.W * 0.006}px)`;
    const draw = (sx, sy, tx, ty) => { ctx.save(); ctx.translate(tx, ty); ctx.scale(sx, sy); ctx.drawImage(pc, 0, 0, ph.w, ph.h); ctx.restore(); };
    draw(-1, 1, ph.x, ph.y); draw(-1, 1, ph.x + 2 * ph.w, ph.y); draw(1, -1, ph.x, ph.y); draw(1, -1, ph.x, ph.y + 2 * ph.h);
    draw(-1, -1, ph.x, ph.y); draw(-1, -1, ph.x + 2 * ph.w, ph.y); draw(-1, -1, ph.x, ph.y + 2 * ph.h); draw(-1, -1, ph.x + 2 * ph.w, ph.y + 2 * ph.h);
    ctx.restore(); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(0, 0, L.W, L.H);
  } else if (L.mode === 'film' || L.mode === 'scan') {
    ctx.fillStyle = L.mode === 'scan' ? '#0a0a0a' : '#17130f'; ctx.fillRect(0, 0, L.W, L.H);
  } else if (L.mode === 'gradient') {
    const pal = M.an?.palette || ['#333', '#777', '#bbb'], k = (f.gseed || 0) % 3;
    const g = ctx.createLinearGradient(0, 0, L.W, L.H);
    g.addColorStop(0, lighten(pal[k], 0.35)); g.addColorStop(1, lighten(pal[(k + 2) % pal.length], -0.1));
    ctx.fillStyle = g; ctx.fillRect(0, 0, L.W, L.H);
    const r = ctx.createRadialGradient(L.W * 0.3, L.H * 0.2, 0, L.W * 0.3, L.H * 0.2, Math.max(L.W, L.H) * 0.8);
    r.addColorStop(0, 'rgba(255,255,255,.25)'); r.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = r; ctx.fillRect(0, 0, L.W, L.H);
  } else {
    ctx.fillStyle = f.color || '#ffffff'; ctx.fillRect(0, 0, L.W, L.H);
    if (L.mode !== 'none') fillTexture(ctx, f.texture, 0, 0, L.W, L.H, Math.max(0.5, L.W / 900));
  }

  // Draw a canvas in the photo window (handles the rotated instant-film card).
  const inPhoto = (fn) => {
    ctx.save();
    if (L.mode === 'polaroid') { const cd = L.card; ctx.translate(cd.x + cd.w / 2, cd.y + cd.h / 2); ctx.rotate(cd.rot); ctx.translate(-cd.w / 2 + cd.b, -cd.h / 2 + cd.b); }
    else {
      const rr = frameRadius(f, L);
      if (L.mode === 'scan') { jaggedPath(ctx, ph.x, ph.y, ph.w, ph.h, unit * 2.2, 7, unit * 9); ctx.clip(); }
      else if (rr > 0) { roundRect(ctx, ph.x, ph.y, ph.w, ph.h, rr); ctx.clip(); }
      ctx.translate(ph.x, ph.y);
    }
    fn(); ctx.restore();
  };
  const drawPhoto = () => inPhoto(() => photo ? ctx.drawImage(photo.canvas, 0, 0) : drawOriginal(ctx, M.img, 0, 0, ph.w, ph.h));

  if (L.mode === 'polaroid') {
    const cd = L.card;
    ctx.save(); ctx.translate(cd.x + cd.w / 2, cd.y + cd.h / 2); ctx.rotate(cd.rot);
    ctx.shadowColor = 'rgba(30,20,10,0.32)'; ctx.shadowBlur = 28 * unit; ctx.shadowOffsetY = 12 * unit;
    ctx.fillStyle = f.cardColor || '#fbfaf5'; ctx.fillRect(-cd.w / 2, -cd.h / 2, cd.w, cd.h);
    ctx.shadowColor = 'transparent';
    fillTexture(ctx, 'photo', -cd.w / 2, -cd.h / 2, cd.w, cd.h, unit);
    ctx.restore();
    drawPhoto();
    inPhoto(() => { ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = unit; ctx.strokeRect(0, 0, ph.w, ph.h); });
  } else if (L.mode === 'film') {
    const s = L.strip, holeW = L.W * 0.028, holeH = s * 0.36, gap = holeW * 1.9;
    ctx.fillStyle = '#efe6d6';
    for (const yy of [s * 0.32, L.H - s * 0.32 - holeH]) for (let xx = gap * 0.4; xx < L.W; xx += gap) roundRect(ctx, xx, yy, holeW, holeH, holeW * 0.22, true);
    ctx.fillStyle = '#e58a2d'; ctx.font = fontString('stamp', s * 0.2); ctx.textBaseline = 'middle';
    ctx.fillText('DARKROOM 400   ▸ 14A', L.W * 0.06, s * 0.82); ctx.fillText('15   ▸ 15A        DARKROOM 400', L.W * 0.4, L.H - s * 0.82);
    drawPhoto();
  } else if (['mat', 'exif', 'stamp', 'slide', 'scan', 'torn', 'rounded', 'glass', 'gradient'].includes(L.mode)) {
    drawFrameDecor(ctx, L, f, unit, M, 'under');
    drawPhoto();
    drawFrameDecor(ctx, L, f, unit, M, 'over');
  } else {
    if (L.mode !== 'none' && f.shadow) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = 24 * unit; ctx.shadowOffsetY = 8 * unit; ctx.fillStyle = '#000'; ctx.fillRect(ph.x, ph.y, ph.w, ph.h); ctx.restore(); }
    drawPhoto();
  }

  // layers — "behind" layers sit under a subject cut-out (text occluded by the person).
  const boxes = [];
  if (!opts.original) {
    const behind = doc.layers.filter(l => l.behind && !l.hidden);
    const seg = behind.length && photo ? aux(doc, M, 'seg') : null;
    for (const ly of behind) boxes.push({ id: ly.id, ...drawLayer(ctx, ly, L.W, L.H, env) });
    if (seg) {
      const cut = cropAux(seg, photo.crop, photo.canvas.width, photo.canvas.height), cx = cut.getContext('2d');
      cx.globalCompositeOperation = 'source-in'; cx.drawImage(photo.canvas, 0, 0);
      inPhoto(() => ctx.drawImage(cut, 0, 0));
    }
    for (const ly of doc.layers) { if (ly.hidden || ly.behind) continue; boxes.push({ id: ly.id, ...drawLayer(ctx, ly, L.W, L.H, env) }); }
  }
  ctx.restore();
  return { L, crop: photo?.crop || cropRect(doc, base, ph.w / ph.h), boxes, src: photo?.src || base };
}

function drawOriginal(ctx, img, x, y, w, h) {
  const { w: iw, h: ih } = dimsOf(img), s = Math.min(w / iw, h / ih);
  ctx.fillStyle = '#111'; ctx.fillRect(x, y, w, h);
  ctx.drawImage(img, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s);
}

// ---------- extended frames ----------
function lighten(hex, k) {
  const n = parseInt((hex || '#888888').slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k)));
  return `rgb(${c.join(',')})`;
}
export function frameRadius(f, L) {
  if (['rounded', 'glass', 'gradient'].includes(L.mode)) return (f.radius ?? 0.04) * Math.min(L.photo.w, L.photo.h);
  if (L.mode === 'film' || L.mode === 'slide') return L.W * 0.008;
  return 0;
}
// Irregular rectangle outline (torn paper / film-scan carrier edge).
function jaggedPath(ctx, x, y, w, h, amp, seed, step) {
  const r = mulberry32(seed), pts = [];
  const edge = (x0, y0, x1, y1) => { const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(4, Math.round(len / step)); for (let i = 0; i < n; i++) { const t = i / n, nx = -(y1 - y0) / len, ny = (x1 - x0) / len, j = (r() - 0.5) * 2 * amp; pts.push([x0 + (x1 - x0) * t + nx * j, y0 + (y1 - y0) * t + ny * j]); } };
  edge(x, y, x + w, y); edge(x + w, y, x + w, y + h); edge(x + w, y + h, x, y + h); edge(x, y + h, x, y);
  ctx.beginPath(); pts.forEach(([a, b], i) => i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)); ctx.closePath();
}
function shadowed(ctx, unit, fn, k = 1) { ctx.save(); ctx.shadowColor = `rgba(0,0,0,${0.32 * k})`; ctx.shadowBlur = 30 * unit * k; ctx.shadowOffsetY = 12 * unit * k; fn(); ctx.restore(); }

function drawFrameDecor(ctx, L, f, unit, M, phase) {
  const ph = L.photo, W = L.W, H = L.H, m = Math.min(W, H);
  if (phase === 'under') {
    if (L.mode === 'mat') {
      ctx.fillStyle = f.frameColor || '#1b1a17'; ctx.fillRect(0, 0, W, H);
      const o = L.o;
      // subtle moulding highlight on the outer frame
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(0,0,0,.18)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      shadowed(ctx, unit, () => { ctx.fillStyle = f.color || '#f6f3ec'; ctx.fillRect(o, o, W - 2 * o, H - 2 * o); }, 0.6);
      fillTexture(ctx, 'paper', o, o, W - 2 * o, H - 2 * o, Math.max(0.5, W / 900));
      // bevel cut around the window
      const bv = Math.max(2, 4 * unit);
      ctx.fillStyle = '#fffdf8'; ctx.fillRect(ph.x - bv, ph.y - bv, ph.w + 2 * bv, ph.h + 2 * bv);
      ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = unit; ctx.strokeRect(ph.x - bv, ph.y - bv, ph.w + 2 * bv, ph.h + 2 * bv);
    }
    if (L.mode === 'rounded' || L.mode === 'gradient' || L.mode === 'glass') {
      const rr = frameRadius(f, L);
      shadowed(ctx, unit, () => { ctx.fillStyle = '#000'; roundRect(ctx, ph.x, ph.y, ph.w, ph.h, rr, true); }, L.mode === 'glass' ? 1.3 : 1);
    }
    if (L.mode === 'torn') {
      const e = 0.035 * m;
      shadowed(ctx, unit, () => { ctx.fillStyle = f.cardColor || '#fbfaf6'; jaggedPath(ctx, ph.x - e, ph.y - e, ph.w + 2 * e, ph.h + 2 * e, e * 0.22, 11, e * 0.35); ctx.fill(); }, 0.8);
      ctx.save(); jaggedPath(ctx, ph.x - e, ph.y - e, ph.w + 2 * e, ph.h + 2 * e, e * 0.22, 11, e * 0.35); ctx.clip(); fillTexture(ctx, 'paper', ph.x - e * 1.5, ph.y - e * 1.5, ph.w + 3 * e, ph.h + 3 * e, unit); ctx.restore();
    }
    if (L.mode === 'stamp') {
      const c = L.card, hole = 0.018 * m, gap = hole * 2.7;
      const st = mk(W, H), sx = st.getContext('2d');
      sx.fillStyle = f.cardColor || '#fbfaf6'; sx.fillRect(c.x, c.y, c.w, c.h);
      sx.globalCompositeOperation = 'destination-out';
      const nx = Math.round(c.w / gap), ny = Math.round(c.h / gap);
      for (let i = 0; i <= nx; i++) for (const yy of [c.y, c.y + c.h]) { sx.beginPath(); sx.arc(c.x + i * c.w / nx, yy, hole, 0, 7); sx.fill(); }
      for (let i = 0; i <= ny; i++) for (const xx of [c.x, c.x + c.w]) { sx.beginPath(); sx.arc(xx, c.y + i * c.h / ny, hole, 0, 7); sx.fill(); }
      shadowed(ctx, unit, () => ctx.drawImage(st, 0, 0), 0.7);
    }
    if (L.mode === 'slide') {
      const c = L.card, rr = 0.045 * m;
      shadowed(ctx, unit, () => { ctx.fillStyle = f.cardColor || '#ece8df'; roundRect(ctx, c.x, c.y, c.w, c.h, rr, true); }, 0.9);
      const g = ctx.createLinearGradient(0, c.y, 0, c.y + c.h); g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(0,0,0,.08)');
      ctx.fillStyle = g; roundRect(ctx, c.x, c.y, c.w, c.h, rr, true);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; roundRect(ctx, ph.x - 2 * unit, ph.y - 2 * unit, ph.w + 4 * unit, ph.h + 4 * unit, L.W * 0.01, true);
    }
  } else {
    if (L.mode === 'glass') { ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1.5 * unit; roundRect(ctx, ph.x + unit, ph.y + unit, ph.w - 2 * unit, ph.h - 2 * unit, frameRadius(f, L)); ctx.stroke(); ctx.restore(); }
    if (L.mode === 'scan') {
      ctx.save(); ctx.fillStyle = '#e8a33d'; ctx.font = fontString('stamp', m * 0.022); ctx.textBaseline = 'middle';
      ctx.fillText('DARKROOM 400', ph.x + m * 0.02, ph.y * 0.5); ctx.textAlign = 'right'; ctx.fillText('▸ 23   24', ph.x + ph.w - m * 0.02, ph.y * 0.5);
      ctx.textAlign = 'left'; ctx.fillText('23A', ph.x + m * 0.02, H - (H - ph.y - ph.h) * 0.5); ctx.restore();
    }
    if (L.mode === 'stamp') {
      const c = L.card, b = 0.05 * m;
      ctx.save(); ctx.fillStyle = '#2b2622'; ctx.textBaseline = 'middle';
      ctx.font = fontString('serif', b * 0.62, { italic: true, weight: 700 }); ctx.fillText(f.sign || 'DARKROOM', c.x + b, c.y + c.h - b * 0.95);
      ctx.textAlign = 'right'; ctx.font = fontString('bold', b * 0.8); ctx.fillStyle = '#c0392b'; ctx.fillText('80分', c.x + c.w - b, c.y + c.h - b * 0.95); ctx.restore();
    }
    if (L.mode === 'slide') {
      const c = L.card;
      ctx.save(); ctx.fillStyle = 'rgba(40,36,30,.7)'; ctx.font = fontString('stamp', m * 0.024); ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(f.sign || 'DARKROOM · 36', c.x + c.w / 2, c.y + (ph.y - c.y) * 0.5);
      ctx.fillText(new Date().toISOString().slice(0, 10).replace(/-/g, '.') + '   ▲', c.x + c.w / 2, ph.y + ph.h + (c.y + c.h - ph.y - ph.h) * 0.5); ctx.restore();
    }
    if (L.mode === 'exif') {
      const ex = M.exif || {}, bar = L.bar, y0 = ph.y + ph.h, cy = y0 + bar / 2, pad = ph.x + m * 0.01, fs = Math.min(bar * 0.2, m * 0.034);
      const ink = isDark(f.color) ? '#f2f0ea' : '#1b1a17', sub = isDark(f.color) ? 'rgba(242,240,234,.55)' : 'rgba(27,26,23,.5)';
      ctx.save(); ctx.textBaseline = 'middle';
      ctx.fillStyle = ink; ctx.font = fontString('minimal', fs, { weight: 700 }); ctx.fillText(f.sign || ex.camera || 'DARKROOM', pad, cy - fs * 0.62);
      ctx.fillStyle = sub; ctx.font = fontString('minimal', fs * 0.72); ctx.fillText(ex.lens || 'AI Photo Lab · 端侧冲洗', pad, cy + fs * 0.7);
      const params = [ex.focal?.split(' ')[0], ex.aperture, ex.shutter && ex.shutter + (ex.shutter.endsWith('s') ? '' : 's'), ex.iso].filter(Boolean).join('  ') || '35mm  f/2.0  1/125s  ISO 200';
      ctx.textAlign = 'right'; const rx = ph.x + ph.w - m * 0.01;
      ctx.fillStyle = ink; ctx.font = fontString('minimal', fs * 0.9, { weight: 600 }); ctx.fillText(params, rx, cy - fs * 0.62);
      ctx.fillStyle = sub; ctx.font = fontString('minimal', fs * 0.72); ctx.fillText(ex.date || new Date().toISOString().slice(0, 16).replace('T', ' ').replace(/-/g, '.'), rx, cy + fs * 0.7);
      // divider + safelight mark
      const tw = ctx.measureText(params).width; ctx.font = fontString('minimal', fs * 0.9, { weight: 600 }); const pw = ctx.measureText(params).width;
      const dx = rx - Math.max(tw, pw) - fs * 0.9;
      ctx.fillStyle = sub; ctx.fillRect(dx, cy - fs * 1.05, Math.max(1, unit), fs * 2.1);
      ctx.fillStyle = '#ff4836'; ctx.beginPath(); ctx.arc(dx - fs * 0.95, cy, fs * 0.42, 0, 7); ctx.fill();
      ctx.restore();
    }
  }
}
function isDark(hex) { const n = parseInt((hex || '#ffffff').slice(1), 16); return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) < 128; }
