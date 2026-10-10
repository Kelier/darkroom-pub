// Colour science: film looks, tone curve, split toning, grain / vignette / leaks, paper textures.

import { FILMS, NEUTRAL_FILM } from './presets.js';
import { mulberry32 } from './analyze.js';
import { curvesActive, curveLUTs } from './curves.js';

export const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

// ---------- film / colour ----------
export function filmParams(film) {
  const base = (FILMS.find(f => f.id === film.preset) || FILMS[0]).p;
  const k = film.intensity ?? 1;
  const adj = film.adjust || {};
  const out = {};
  for (const key of Object.keys(NEUTRAL_FILM)) {
    if (key === 'mono') continue;
    if (Array.isArray(base[key])) out[key] = [base[key][0], base[key][1] * k];
    else out[key] = (base[key] || 0) * k + (adj[key] || 0);
  }
  out.mono = base.mono && k > 0.5;
  out.curves = curvesActive(film.curves) ? film.curves : null;
  return out;
}

function hueRGB(h) {
  const f = n => { const k = (n + h / 30) % 12; return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export function applyColor(ctx, w, h, p) {
  const id = ctx.getImageData(0, 0, w, h), d = id.data;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    v *= Math.pow(2, p.exposure * 0.9);
    v += p.shadows * 0.28 * (1 - v) * (1 - v) * (v < 1 ? 1 : 0);
    v += p.highlights * 0.25 * v * v;
    v = Math.min(1, Math.max(0, v));
    const c = p.contrast;
    const s = 1 / (1 + Math.exp(-(v - 0.5) * 6)); const s0 = 1 / (1 + Math.exp(3)), s1 = 1 / (1 + Math.exp(-3));
    const sig = (s - s0) / (s1 - s0);
    v = c >= 0 ? v + (sig - v) * Math.min(1, c * 1.4) : v + (0.5 - v) * Math.min(0.9, -c * 0.7);
    v = p.fade * 0.16 + v * (1 - p.fade * 0.16 - p.fade * 0.07);
    lut[i] = v * 255;
  }
  const sat = p.mono ? -1 : Math.max(-1, p.saturation);
  const tr = p.temp * 20 + p.tint * 5, tg = -p.tint * 14, tb = -p.temp * 22 + p.tint * 5;
  const [sh, ss] = p.splitShadow, [hh, hs] = p.splitHighlight;
  const scol = hueRGB(sh).map(v => (v - 128) * ss * 0.55), hcol = hueRGB(hh).map(v => (v - 128) * hs * 0.55);
  const doSplit = ss > 0.001 || hs > 0.001;
  const cl = p.curves ? curveLUTs(p.curves) : null, [cr, cg, cb] = cl || [];
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
    r += tr; g += tg; b += tb;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    if (sat !== 0) { const k = 1 + sat; r = l + (r - l) * k; g = l + (g - l) * k; b = l + (b - l) * k; }
    if (doSplit) {
      const t = Math.min(1, Math.max(0, l / 255)), ws = (1 - t) * (1 - t), wh = t * t;
      r += scol[0] * ws + hcol[0] * wh; g += scol[1] * ws + hcol[1] * wh; b += scol[2] * ws + hcol[2] * wh;
    }
    if (cl) { r = cr[r < 0 ? 0 : r > 255 ? 255 : r | 0]; g = cg[g < 0 ? 0 : g > 255 ? 255 : g | 0]; b = cb[b < 0 ? 0 : b > 255 ? 255 : b | 0]; }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(id, 0, 0);
}

let noiseTile = null;
function getNoise() {
  if (noiseTile) return noiseTile;
  const c = mk(256, 256), x = c.getContext('2d'), id = x.createImageData(256, 256), r = mulberry32(42);
  for (let i = 0; i < id.data.length; i += 4) { const v = 128 + (r() + r() + r() - 1.5) * 150; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  x.putImageData(id, 0, 0); noiseTile = c; return c;
}

export function overlayGrain(ctx, w, h, amt, scale) {
  if (amt <= 0.001) return;
  const pat = ctx.createPattern(getNoise(), 'repeat');
  pat.setTransform(new DOMMatrix().scale(scale, scale));
  ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = Math.min(1, amt * 0.6); ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h); ctx.restore();
}

export function overlayVignette(ctx, w, h, amt) {
  if (amt <= 0.001) return;
  const r = Math.hypot(w, h) / 2;
  const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.35, w / 2, h / 2, r);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${Math.min(0.92, amt * 0.85)})`);
  ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
}

export function overlayLeak(ctx, w, h, amt, seed) {
  if (amt <= 0.001) return;
  const r = mulberry32(seed || 3);
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  const spots = [[r() < 0.5 ? 0 : w, r() * h, '255,96,32'], [r() < 0.5 ? 0 : w, r() * h, '255,40,90'], [r() * w, 0, '255,180,60']];
  for (const [x, y, col] of spots) {
    const R = Math.max(w, h) * (0.35 + r() * 0.3);
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, `rgba(${col},${0.85 * amt})`); g.addColorStop(0.5, `rgba(${col},${0.28 * amt})`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

export function overlayBloom(ctx, src, w, h, amt) {
  if (amt <= 0.001) return;
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = Math.min(1, amt * 0.9);
  ctx.filter = `brightness(0.9) contrast(3) blur(${Math.max(2, w * 0.012)}px)`;
  ctx.drawImage(src, 0, 0); ctx.restore();
}


// ---------- textures ----------
const texCache = {};
export function getTexture(id) {
  if (texCache[id]) return texCache[id];
  const c = mk(512, 512), x = c.getContext('2d'), r = mulberry32(id.length * 97);
  const id2 = x.createImageData(512, 512), d = id2.data;
  const base = { paper: [246, 241, 231], photo: [252, 251, 248], kraft: [196, 160, 118], magazine: [238, 230, 210], grain: [235, 235, 235] }[id] || [255, 255, 255];
  const amp = { paper: 10, photo: 4, kraft: 22, magazine: 14, grain: 40 }[id] || 0;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amp; d[i] = base[0] + n; d[i + 1] = base[1] + n; d[i + 2] = base[2] + n; d[i + 3] = 255; }
  x.putImageData(id2, 0, 0);
  if (id === 'paper' || id === 'kraft') {
    x.strokeStyle = id === 'kraft' ? 'rgba(90,60,30,0.18)' : 'rgba(150,130,100,0.12)'; x.lineWidth = 0.7;
    for (let i = 0; i < 260; i++) { const a = r() * 512, b = r() * 512, l = 4 + r() * 18, t = r() * Math.PI; x.beginPath(); x.moveTo(a, b); x.quadraticCurveTo(a + Math.cos(t) * l / 2 + r() * 3, b + Math.sin(t) * l / 2, a + Math.cos(t) * l, b + Math.sin(t) * l); x.stroke(); }
  }
  if (id === 'magazine') {
    x.fillStyle = 'rgba(120,100,60,0.06)';
    for (let yy = 0; yy < 512; yy += 6) for (let xx = (yy / 6) % 2 * 3; xx < 512; xx += 6) { x.beginPath(); x.arc(xx, yy, 1.1, 0, 7); x.fill(); }
    for (let i = 0; i < 18; i++) { const gx = r() * 512, gy = r() * 512, g = x.createRadialGradient(gx, gy, 0, gx, gy, 60 + r() * 90); g.addColorStop(0, 'rgba(160,120,40,0.08)'); g.addColorStop(1, 'rgba(160,120,40,0)'); x.fillStyle = g; x.fillRect(0, 0, 512, 512); }
  }
  texCache[id] = c; return c;
}

export function fillTexture(ctx, id, x, y, w, h, scale) {
  if (!id || id === 'none') return;
  const pat = ctx.createPattern(getTexture(id), 'repeat');
  pat.setTransform(new DOMMatrix().scale(scale, scale));
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = pat; ctx.fillRect(x, y, w, h); ctx.restore();
}


export function needsColor(p) {
  return ['exposure', 'contrast', 'highlights', 'shadows', 'temp', 'tint', 'saturation', 'fade'].some(k => Math.abs(p[k] || 0) > 0.001) || p.mono || !!p.curves || p.splitShadow?.[1] > 0.001 || p.splitHighlight?.[1] > 0.001;
}

// Local adjustment params -> full colour params (no split toning / fade).
export function localParams(adj) {
  return { exposure: adj.exposure || 0, contrast: adj.contrast || 0, highlights: adj.highlights || 0, shadows: adj.shadows || 0,
    temp: adj.temp || 0, tint: adj.tint || 0, saturation: adj.saturation || 0, fade: 0, splitShadow: [0, 0], splitHighlight: [0, 0], mono: false };
}

// Clarity / softness: unsharp mask (amt > 0) or blend toward blur (amt < 0).
export function applyClarity(canvas, amt) {
  if (Math.abs(amt) < 0.01) return;
  const w = canvas.width, h = canvas.height, x = canvas.getContext('2d', { willReadFrequently: true });
  const b = mk(w, h), bx = b.getContext('2d', { willReadFrequently: true });
  bx.filter = `blur(${Math.max(1, Math.max(w, h) * (amt > 0 ? 0.006 : 0.012))}px)`; bx.drawImage(canvas, 0, 0);
  if (amt < 0) { x.save(); x.globalAlpha = Math.min(1, -amt); x.drawImage(b, 0, 0); x.restore(); return; }
  const a = x.getImageData(0, 0, w, h), bd = bx.getImageData(0, 0, w, h).data, d = a.data, k = amt * 1.6;
  for (let i = 0; i < d.length; i += 4) { d[i] += (d[i] - bd[i]) * k; d[i + 1] += (d[i + 1] - bd[i + 1]) * k; d[i + 2] += (d[i + 2] - bd[i + 2]) * k; }
  x.putImageData(a, 0, 0);
}

export function dateStampText(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `'${String(d.getFullYear()).slice(2)} ${p(d.getMonth() + 1)} ${p(d.getDate())}`;
}
