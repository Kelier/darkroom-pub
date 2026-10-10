// Local "AI" analysis engine: saliency, subject, scene, mood, palette and composition scoring.
// Heuristic and fully in-browser; designed so a cloud model can replace any stage later.

import { SCENE_LABEL } from './presets.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += src[y * w + xx]; n++; } }
    tmp[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; } }
    out[y * w + x] = s / n;
  }
  return out;
}

const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

export function analyzeImage(img) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const S = 112, k = S / Math.max(W, H);
  const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const lum = new Float32Array(n), sat = new Float32Array(n);
  let mr = 0, mg = 0, mb = 0, ml = 0, ms = 0, skin = 0, green = 0, sky = 0, warmth = 0;
  const skinMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const s = mx ? (mx - mn) / mx : 0;
    lum[i] = l; sat[i] = s;
    mr += r; mg += g; mb += b; ml += l; ms += s; warmth += (r - b) / 255;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    if (cb > 80 && cb < 125 && cr > 136 && cr < 170 && l > 0.2 && l < 0.92) { skinMask[i] = 1; skin++; }
    if (g > r * 1.02 && g > b && s > 0.18) green++;
    const y = Math.floor(i / w);
    if (y < h * 0.4 && b > r * 1.05 && b > g * 0.95 && l > 0.45) sky++;
  }
  mr /= n; mg /= n; mb /= n; ml /= n; ms /= n; warmth /= n;

  // Saliency: gradient energy + color rarity + skin boost, with a gentle center prior.
  const grad = new Float32Array(n);
  let gmax = 1e-6;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1] - lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1];
    const gy = lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1] - lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1];
    grad[i] = Math.hypot(gx, gy); if (grad[i] > gmax) gmax = grad[i];
  }
  const gradB = boxBlur(grad, w, h, 2);
  let gbm = 1e-6; for (let i = 0; i < n; i++) gbm = Math.max(gbm, gradB[i]);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const cd = Math.hypot(r - mr, g - mg, b - mb) / 255;
    const x = (i % w) / w - 0.5, y = Math.floor(i / w) / h - 0.5;
    const prior = 1 - 0.9 * (x * x + y * y);
    raw[i] = (0.5 * gradB[i] / gbm + 0.5 * Math.min(1, cd * 1.6) + 1.1 * skinMask[i] + 0.25 * sat[i]) * prior;
  }
  const sal = boxBlur(raw, w, h, 3);
  let smax = 1e-6; for (let i = 0; i < n; i++) smax = Math.max(smax, sal[i]);
  for (let i = 0; i < n; i++) sal[i] /= smax;

  // Subject: anchor on the densest saliency blob, then weighted moments around it.
  const sorted = Array.from(sal).sort((a, b) => a - b);
  const thr = sorted[Math.floor(n * 0.8)];
  const dense = boxBlur(sal, w, h, Math.max(2, Math.round(Math.max(w, h) * 0.07)));
  let ai = 0; for (let i = 1; i < n; i++) if (dense[i] > dense[ai]) ai = i;
  const ax = ai % w, ay = Math.floor(ai / w), sig2 = 2 * (0.2 * Math.max(w, h)) ** 2;
  const wt = (i) => { const dx = (i % w) - ax, dy = Math.floor(i / w) - ay; return sal[i] ** 2 * Math.exp(-(dx * dx + dy * dy) / sig2); };
  let sw = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) if (sal[i] >= thr) { const k = wt(i); sw += k; sx += k * (i % w); sy += k * Math.floor(i / w); }
  const cx = sx / sw, cy = sy / sw;
  let vx = 0, vy = 0;
  for (let i = 0; i < n; i++) if (sal[i] >= thr) { const k = wt(i); vx += k * ((i % w) - cx) ** 2; vy += k * (Math.floor(i / w) - cy) ** 2; }
  const sdx = Math.sqrt(vx / sw), sdy = Math.sqrt(vy / sw);
  const clamp01 = v => Math.min(1, Math.max(0, v));
  const subject = {
    cx: cx / w, cy: cy / h,
    x0: clamp01((cx - 1.5 * sdx) / w), x1: clamp01((cx + 1.5 * sdx) / w),
    y0: clamp01((cy - 1.6 * sdy) / h), y1: clamp01((cy + 1.6 * sdy) / h),
  };

  // Integral image for fast region sums during crop scoring.
  const integ = new Float64Array((w + 1) * (h + 1));
  let total = 0;
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += sal[y * w + x]; integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row; }
    total += row;
  }

  // Palette: tiny k-means.
  const samples = [];
  for (let i = 0; i < n; i += 3) samples.push([px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
  const rng = mulberry32(7);
  let cents = Array.from({ length: 5 }, () => samples[Math.floor(rng() * samples.length)].slice());
  let counts = new Array(5).fill(0);
  for (let it = 0; it < 8; it++) {
    const acc = cents.map(() => [0, 0, 0]); counts = new Array(5).fill(0);
    for (const s of samples) {
      let bi = 0, bd = 1e9;
      cents.forEach((c, j) => { const d = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = j; } });
      acc[bi][0] += s[0]; acc[bi][1] += s[1]; acc[bi][2] += s[2]; counts[bi]++;
    }
    cents = cents.map((c, j) => counts[j] ? acc[j].map(v => v / counts[j]) : c);
  }
  const palette = cents.map((c, j) => ({ c, n: counts[j] })).sort((a, b) => b.n - a.n).map(o => hex(...o.c));

  // Scene & mood.
  const skinF = skin / n, greenF = green / n, skyF = sky / n;
  const isPortraitImg = H > W * 1.05;
  let scene = 'daily';
  if (ml < 0.3) scene = 'night';
  else if (greenF + skyF > 0.28) scene = 'nature';
  else if (skinF > 0.012) scene = 'portrait';
  else if (gmax > 0 && avg(gradB) / gbm > 0.22) scene = 'city';
  const mood = [];
  if (ml < 0.3) mood.push('沉静'); else if (ml > 0.62) mood.push('明亮');
  if (warmth > 0.08) mood.push('温暖'); else if (warmth < -0.04) mood.push('清冷');
  if (ms > 0.42) mood.push('鲜活'); else if (ms < 0.18) mood.push('克制');
  if (!mood.length) mood.push('自然');

  const suggestedRatio = scene === 'nature' && !isPortraitImg ? '16:9' : isPortraitImg ? '4:5' : '3:2';
  const sceneConf = scene === 'daily' ? 0.62 : 0.78 + Math.min(0.17, skinF * 3 + greenF * 0.3);

  const sortedL = Array.from(lum).sort((a, b) => a - b), pct = (q) => sortedL[Math.min(n - 1, Math.floor(n * q))];
  const an = {
    W, H, w, h, sal, lum, integ, total, subject, palette, scene, sceneLabel: SCENE_LABEL[scene], sceneConf,
    mood, suggestedRatio, stats: { lum: ml, sat: ms, warmth, p02: pct(0.02), p50: pct(0.5), p98: pct(0.98), cast: [mr - mg, mb - mg] }, objects: [], engine: 'heuristic',
  };
  deriveComposition(an);
  return an;
}

function buildIntegral(an) {
  const { w, h, sal } = an;
  const integ = new Float64Array((w + 1) * (h + 1));
  let total = 0;
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += sal[y * w + x]; integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row; }
    total += row;
  }
  an.integ = integ; an.total = total;
}

// Composition diagnosis + typography side derived from the current subject.
function deriveComposition(an) {
  const { subject, integ, w, h } = an, n = w * h;
  const area = (subject.x1 - subject.x0) * (subject.y1 - subject.y0);
  const issues = [];
  if (Math.abs(subject.cx - 0.5) < 0.08) issues.push('主体居中，可尝试三分法让画面更有张力');
  else if (Math.min(Math.abs(subject.cx - 1 / 3), Math.abs(subject.cx - 2 / 3)) < 0.07) issues.push('主体已接近三分线，构图基础良好');
  else issues.push('主体偏离视觉重心，推荐重新裁剪');
  if (area < 0.08) issues.push('主体占比较小，可尝试紧凑特写');
  if (subject.y0 < 0.02 || subject.x0 < 0.01 || subject.x1 > 0.99) issues.push('主体贴近边缘，建议留出呼吸空间');
  if (subject.cy < 0.3) issues.push('视觉重心偏上，可保留下方留白放置文案');
  const regionSal = (x0, y0, x1, y1) => sumRect(integ, w, h, x0, y0, x1, y1) / Math.max(1e-6, (x1 - x0) * (y1 - y0) * n);
  an.space = { left: 1 - regionSal(0, 0, 0.5, 1), right: 1 - regionSal(0.5, 0, 1, 1), top: 1 - regionSal(0, 0, 1, 0.35), bottom: 1 - regionSal(0, 0.65, 1, 1) };
  an.textSide = subject.cx > 0.55 ? 'left' : subject.cx < 0.45 ? 'right' : (an.space.top > an.space.bottom ? 'top' : 'bottom');
  an.issues = issues;
}

const LABEL_CN = { person: '人物', dog: '狗', cat: '猫', bird: '鸟', car: '汽车', bicycle: '自行车', motorcycle: '摩托车', bus: '巴士', train: '列车', handbag: '手提包', backpack: '背包', umbrella: '雨伞', book: '书', 'cell phone': '手机', cup: '杯子', bottle: '瓶子', 'traffic light': '交通灯', bench: '长椅', chair: '椅子', clock: '时钟', 'potted plant': '盆栽', vase: '花瓶', laptop: '笔记本电脑', tv: '屏幕', cake: '蛋糕', pizza: '披萨', bowl: '碗', 'dining table': '餐桌', 'teddy bear': '玩偶', suitcase: '行李箱', horse: '马', 'fire hydrant': '消防栓', 'stop sign': '路牌', kite: '风筝', skateboard: '滑板', surfboard: '冲浪板', sheep: '羊', cow: '牛', boat: '船', airplane: '飞机', truck: '卡车', tie: '领带', camera: '相机' };
export const labelCN = (l) => LABEL_CN[l] || l;

// Refine the heuristic analysis with real object detections (normalized boxes).
export function refineWithDetections(an, dets) {
  if (!dets || !dets.length) return an;
  an.objects = dets;
  const persons = dets.filter(d => d.label === 'person' && d.score > 0.35);
  const score = d => d.score * Math.sqrt(d.w * d.h) * (1.15 - Math.hypot(d.x + d.w / 2 - 0.5, d.y + d.h / 2 - 0.5) * 0.5);
  let group;
  if (persons.length) {
    const top = persons.reduce((a, b) => (score(b) > score(a) ? b : a));
    group = persons.filter(p => p.w * p.h > top.w * top.h * 0.3);
  } else {
    const ignore = new Set(['dining table', 'bench', 'chair', 'traffic light', 'tv']);
    const cands = dets.filter(d => !ignore.has(d.label) && d.w * d.h < 0.85);
    if (!cands.length) return an;
    group = [cands.reduce((a, b) => (score(b) > score(a) ? b : a))];
  }
  const x0 = Math.min(...group.map(d => d.x)), y0 = Math.min(...group.map(d => d.y));
  const x1 = Math.max(...group.map(d => d.x + d.w)), y1 = Math.max(...group.map(d => d.y + d.h));
  const isPerson = group[0].label === 'person';
  // Visual anchor: head/upper torso for people, centre for objects.
  an.subject = { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: isPerson ? y0 + (y1 - y0) * 0.3 : (y0 + y1) / 2, label: group[0].label, count: group.length };
  // Boost saliency inside the subject so crop scoring respects it.
  const { w, h, sal } = an;
  for (let y = Math.floor(y0 * h); y < Math.min(h, Math.ceil(y1 * h)); y++)
    for (let x = Math.floor(x0 * w); x < Math.min(w, Math.ceil(x1 * w)); x++) sal[y * w + x] = Math.min(1.6, sal[y * w + x] + 0.6);
  buildIntegral(an);
  if (isPerson && an.scene !== 'night' && (x1 - x0) * (y1 - y0) > 0.06) an.scene = an.scene === 'nature' && (x1 - x0) * (y1 - y0) < 0.2 ? 'nature' : 'portrait';
  an.sceneLabel = SCENE_LABEL[an.scene];
  an.sceneConf = Math.max(an.sceneConf, 0.86);
  an.engine = 'detector';
  deriveComposition(an);
  return an;
}

function avg(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; }

function sumRect(integ, w, h, x0, y0, x1, y1) {
  const X0 = Math.max(0, Math.min(w, Math.round(x0 * w))), X1 = Math.max(0, Math.min(w, Math.round(x1 * w)));
  const Y0 = Math.max(0, Math.min(h, Math.round(y0 * h))), Y1 = Math.max(0, Math.min(h, Math.round(y1 * h)));
  const W1 = w + 1;
  return integ[Y1 * W1 + X1] - integ[Y0 * W1 + X1] - integ[Y1 * W1 + X0] + integ[Y0 * W1 + X0];
}

// Crop size (normalized to image dims) for target aspect and zoom.
export function cropSize(imgW, imgH, aspect, zoom = 1) {
  const ia = imgW / imgH;
  let cw, ch;
  if (ia > aspect) { ch = 1; cw = aspect / ia; } else { cw = 1; ch = ia / aspect; }
  return { cw: cw / zoom, ch: ch / zoom };
}

export function clampCrop(crop, cw, ch) {
  return {
    ...crop,
    cx: Math.min(1 - cw / 2, Math.max(cw / 2, crop.cx)),
    cy: Math.min(1 - ch / 2, Math.max(ch / 2, crop.cy)),
  };
}

// Generate N diverse, scored composition proposals for a photo-area aspect.
export function composeCandidates(an, aspect, seed = 1, count = 6) {
  const rng = mulberry32(seed);
  const { subject: s, integ, w, h, total } = an;
  const sbW = s.x1 - s.x0, sbH = s.y1 - s.y0;
  const cands = [];
  const zooms = [1, 1.18, 1.4, 1.7, 2.1];
  const tx = [1 / 3, 0.5, 2 / 3], ty = [1 / 3, 0.42, 0.5, 0.62];
  for (const z0 of zooms) {
    const zoom = z0 * (1 + (rng() - 0.5) * 0.08 * (seed > 1 ? 1 : 0));
    const { cw, ch } = cropSize(an.W, an.H, aspect, Math.max(1, zoom));
    for (const ax of tx) for (const ay of ty) {
      const jx = seed > 1 ? (rng() - 0.5) * 0.04 : 0, jy = seed > 1 ? (rng() - 0.5) * 0.04 : 0;
      let crop = clampCrop({ cx: s.cx - (ax - 0.5) * cw + jx, cy: s.cy - (ay - 0.5) * ch + jy, zoom: Math.max(1, zoom) }, cw, ch);
      const x0 = crop.cx - cw / 2, y0 = crop.cy - ch / 2, x1 = x0 + cw, y1 = y0 + ch;
      const ox = Math.max(0, Math.min(x1, s.x1) - Math.max(x0, s.x0)), oy = Math.max(0, Math.min(y1, s.y1) - Math.max(y0, s.y0));
      const kept = (ox * oy) / Math.max(1e-6, sbW * sbH);
      const inside = sumRect(integ, w, h, x0, y0, x1, y1) / total;
      const e = 0.035;
      const border = (sumRect(integ, w, h, x0, y0, x0 + e * cw, y1) + sumRect(integ, w, h, x1 - e * cw, y0, x1, y1) +
        sumRect(integ, w, h, x0, y0, x1, y0 + e * ch) + sumRect(integ, w, h, x0, y1 - e * ch, x1, y1)) / Math.max(1e-6, total * e * 4 * cw * ch);
      const px = (s.cx - x0) / cw, py = (s.cy - y0) / ch;
      const pts = [[1 / 3, 1 / 3], [2 / 3, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 2 / 3], [0.5, 0.45]];
      const td = Math.min(...pts.map(([a, b]) => Math.hypot(px - a, py - b)));
      const score = 2.2 * Math.min(1, kept) + 0.9 * inside - 0.7 * Math.min(2, border) - 1.4 * td + 0.15 * (zoom > 1.05 && zoom < 1.8 ? 1 : 0) + rng() * 0.05;
      cands.push({ crop, score, ax, ay, zoom: crop.zoom, px, py });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of cands) {
    if (picked.every(p => Math.abs(p.crop.cx - c.crop.cx) + Math.abs(p.crop.cy - c.crop.cy) + 0.35 * Math.abs(p.zoom - c.zoom) > 0.09)) picked.push(c);
    if (picked.length >= count) break;
  }
  const best = picked[0]?.score || 1;
  return picked.map((c, i) => ({ ...c, label: labelFor(c), rating: Math.round(Math.max(60, Math.min(98, 92 - (best - c.score) * 18 - i))) }));
}

function labelFor(c) {
  const z = c.zoom;
  const lr = c.px < 0.42 ? '主体居左' : c.px > 0.58 ? '主体居右' : '居中对称';
  if (z >= 1.6) return `紧凑特写 · ${lr}`;
  if (z <= 1.05) return `完整环境 · ${lr}`;
  if (c.py > 0.58) return `低重心 · 上方留白`;
  if (c.py < 0.4) return `高视线 · 下方留白`;
  return `三分法 · ${lr}`;
}

// Mean luminance of a normalized image region.
export function lumAt(an, x0, y0, x1, y1) {
  const { w, h, lum } = an; let s = 0, n = 0;
  const X0 = Math.max(0, Math.floor(x0 * w)), X1 = Math.min(w, Math.ceil(x1 * w)), Y0 = Math.max(0, Math.floor(y0 * h)), Y1 = Math.min(h, Math.ceil(y1 * h));
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { s += lum[y * w + x]; n++; }
  return n ? s / n : 0.5;
}

// One-tap auto tone: exposure toward a scene-aware target, stretch contrast, gently neutralise casts.
export function autoTone(an) {
  const st = an.stats, night = an.scene === 'night';
  const target = night ? 0.3 : 0.47;
  const exposure = Math.max(-0.6, Math.min(0.6, Math.log2(target / Math.max(0.04, st.p50)) * 0.55));
  const spread = st.p98 - st.p02;
  const contrast = Math.max(-0.3, Math.min(0.35, (0.82 - spread) * 0.6));
  const shadows = st.p02 < 0.04 ? 0.18 : 0, highlights = st.p98 > 0.97 ? -0.22 : 0;
  const temp = Math.max(-0.25, Math.min(0.25, -(st.cast[0] - st.cast[1]) / 255 * 1.2 * (night ? 0.3 : 1)));
  const tint = Math.max(-0.2, Math.min(0.2, ((st.cast[0] + st.cast[1]) / 2) / 255 * 0.8));
  const saturation = st.sat < 0.2 ? 0.12 : st.sat > 0.5 ? -0.08 : 0.04;
  const r = (v) => Math.round(v * 100) / 100;
  return { exposure: r(exposure), contrast: r(contrast), shadows: r(shadows), highlights: r(highlights), temp: r(temp), tint: r(tint), saturation: r(saturation) };
}

// Auto level / upright: dominant edge orientation near horizontal & vertical, plus vertical convergence.
export function estimateLevel(img) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height, k = 480 / Math.max(W, H);
  const w = Math.round(W * k), h = Math.round(H * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const bins = 81, hist = new Float32Array(bins), vl = [], vr = [];
  for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
    const i = y * w + xx;
    const gx = L[i + 1] - L[i - 1], gy = L[i + w] - L[i - w], mag = Math.hypot(gx, gy);
    if (mag < 40) continue;
    let a = Math.atan2(gy, gx) * 180 / Math.PI;           // gradient direction; edge is perpendicular
    a = ((a % 90) + 90) % 90; if (a > 45) a -= 90;          // deviation from nearest axis, [-45,45]
    if (Math.abs(a) <= 10) {
      hist[Math.round((a + 10) * 4)] += mag;
      const vertEdge = Math.abs(gx) > Math.abs(gy);
      if (vertEdge) (xx < w / 2 ? vl : vr).push([a, mag]);
    }
  }
  let best = 40; for (let i = 0; i < bins; i++) if (hist[i] > hist[best]) best = i;
  const rotate = Math.abs((best / 4) - 10) < 0.3 ? 0 : -((best / 4) - 10);
  const mean = (arr) => { let s = 0, m = 0; for (const [a, g] of arr) { s += a * g; m += g; } return m ? s / m : 0; };
  const conv = mean(vl) - mean(vr);                         // converging verticals => keystone
  const vert = Math.abs(conv) < 0.6 ? 0 : Math.max(-0.6, Math.min(0.6, conv / 12));
  return { rotate: Math.round(rotate * 10) / 10, vert: Math.round(vert * 100) / 100, horiz: 0 };
}
