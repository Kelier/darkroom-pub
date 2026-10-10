// Media context per project: images, analysis, on-device model outputs (depth, subject mask, background plate).

import { analyzeImage, refineWithDetections } from './analyze.js';
import { detectObjects, segmentSubject, estimateDepth, inpaint } from './ml/index.js';
import { readExif } from './exif.js';
import { render, clearRenderCache, baseOf, dimsOf } from './render.js';
import { mk } from './color.js';
import { task } from './state.js';

export const loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
export const blobToImage = async (blob) => { const url=URL.createObjectURL(blob); try { return await loadImage(url); } finally { URL.revokeObjectURL(url); } };
export const canvasToBlob = (c, type = 'image/jpeg', q = 0.92) => new Promise(r => c.toBlob(r, type, q));
export const uid = (p = 'A') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export async function analyzeFull(src) {
  const an = analyzeImage(src);
  const d = await detectObjects(src);
  if (d) refineWithDetections(an, d);
  return an;
}

export async function loadMedia(rec) {
  const img = await blobToImage(rec.blob);
  const M = { id: rec.id, img, an: null, assets: new Map(), photos: new Map(), depth: null, seg: null, plate: null, plateDepth: null, fg: null,
    brush: new Map(), exif: null, baseKey: null };
  for (const [id, b] of Object.entries(rec.assets || {})) M.assets.set(id, await blobToImage(b));
  M.exif = await readExif(rec.blob);
  return M;
}

// Collage photos need their own analysis for per-cell smart crops.
export function registerPhotos(doc, M) {
  for (const ly of doc.layers) if (ly.type === 'photo' && !M.photos.has(ly.asset) && M.assets.has(ly.asset)) {
    const img = M.assets.get(ly.asset); M.photos.set(ly.asset, { img, an: analyzeImage(img) });
  }
}

// Keep analysis / model outputs in sync with the current base image (original, expanded, or erased).
export async function syncBase(doc, M) {
  const key = doc.base || 'o';
  if (M.baseKey === key && M.an) return false;
  M.an = await analyzeFull(baseOf(doc, M));
  M.depth = M.seg = M.plate = M.plateDepth = M.fg = null; M.segTried = false;
  M.baseKey = key; clearRenderCache();
  return true;
}

export async function ensureSeg(doc, M) {
  if (M.seg || M.segTried) return M.seg;
  M.segTried = true;
  M.seg = await segmentSubject(baseOf(doc, M), M.an?.subject);
  if (!M.seg && M.depth) M.seg = depthMask(M.depth, 0.62);
  if (M.seg) clearRenderCache();
  return M.seg;
}

export async function ensureDepth(doc, M) {
  if (M.depth) return M.depth;
  if (M.depthPending) return M.depthPending;
  const t = task('depth', '深度估计 · Depth Anything V2');
  M.depthPending = estimateDepth(baseOf(doc, M), (p, stage) => t.progress(stage === 'download' ? p * 0.9 : 0.95, stage === 'download' ? `下载模型 ${Math.round(p * 100)}%` : '推理中…'))
    .then(d => { M.depth = d; t.done('深度图已生成'); clearRenderCache(); return d; })
    .catch(e => { t.fail('深度估计失败：' + e.message); throw e; })
    .finally(() => { M.depthPending = null; });
  return M.depthPending;
}

function depthMask(depth, thr) {
  const c = mk(depth.w, depth.h), x = c.getContext('2d'), id = x.createImageData(depth.w, depth.h);
  for (let i = 0; i < depth.w * depth.h; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = depth.data[i] > thr ? 255 : 0; }
  x.putImageData(id, 0, 0);
  const s = mk(depth.w, depth.h), sx = s.getContext('2d'); sx.filter = 'blur(1.5px)'; sx.drawImage(c, 0, 0);
  return s;
}

// Grow a soft mask outward (for inpainting holes that fully cover edges/halos).
export function dilate(mask, px, w, h) {
  const c = mk(w, h), x = c.getContext('2d');
  x.filter = `blur(${px}px)`;
  for (let i = 0; i < 4; i++) x.drawImage(mask, 0, 0, w, h);
  x.filter = 'none';
  const id = x.getImageData(0, 0, w, h);
  for (let i = 3; i < id.data.length; i += 4) id.data[i] = id.data[i] > 8 ? 255 : 0;
  x.putImageData(id, 0, 0);
  return c;
}

// Background plate for 2.5D: subject removed by generative inpainting, plus a hole-filled depth map.
export async function ensurePlate(doc, M) {
  if (M.plate) return M.plate;
  await ensureDepth(doc, M);
  await ensureSeg(doc, M);
  const base = baseOf(doc, M), { w, h } = dimsOf(base);
  const fg = M.seg || depthMask(M.depth, 0.62);
  const mw = Math.round(Math.min(1024, w)), mh = Math.round(mw * h / w);
  const hole = dilate(fg, Math.max(3, mw * 0.018), mw, mh);
  const t = task('plate', '遮挡补全 · MI-GAN');
  try {
    M.plate = await inpaint(base, hole, (p, stage) => t.progress(stage === 'download' ? p * 0.85 : 0.92, stage === 'download' ? `下载模型 ${Math.round(p * 100)}%` : '生成背景中…'));
    // depth: cut the subject out, then diffuse surrounding background depth into the hole
    const dw = M.depth.w, dh = M.depth.h;
    let acc = mk(dw, dh); const ax = acc.getContext('2d');
    ax.drawImage(M.depth.canvas, 0, 0); ax.globalCompositeOperation = 'destination-out'; ax.drawImage(dilate(fg, 3, dw, dh), 0, 0);
    for (const r of [2, 4, 8, 16, 32]) {
      const n = mk(dw, dh), nx = n.getContext('2d');
      nx.filter = `blur(${r}px)`; nx.drawImage(acc, 0, 0); nx.filter = 'none'; nx.drawImage(acc, 0, 0);
      // normalise premultiplied blur by its own alpha coverage
      const id = nx.getImageData(0, 0, dw, dh);
      for (let i = 0; i < id.data.length; i += 4) if (id.data[i + 3] > 0 && id.data[i + 3] < 255) { const a = id.data[i + 3] / 255; id.data[i] = Math.min(255, id.data[i]); id.data[i + 1] = id.data[i]; id.data[i + 2] = id.data[i]; id.data[i + 3] = a > 0.02 ? 255 : 0; }
      nx.putImageData(id, 0, 0); acc = n;
    }
    const pd = mk(dw, dh), px = pd.getContext('2d'); px.fillStyle = '#000'; px.fillRect(0, 0, dw, dh); px.drawImage(acc, 0, 0);
    M.plateDepth = pd; M.fg = fg;
    clearRenderCache();
    t.done('遮挡补全完成');
    return M.plate;
  } catch (e) { t.fail('遮挡补全失败：' + e.message); throw e; }
}

export function needsDeps(doc) {
  const o = doc.optics || {};
  return {
    depth: !!(doc.cam?.on) || (o.aperture > 0.01 && o.mode === 'depth') || (doc.locals || []).some(l => l.mask.kind === 'depth'),
    seg: (o.aperture > 0.01 || o.motion > 0.01) || (doc.locals || []).some(l => l.mask.kind === 'subject' || l.mask.kind === 'background') || doc.layers.some(l => l.behind),
    plate: !!(doc.cam?.on && doc.cam.fill),
  };
}

export async function ensureDeps(doc, M) {
  if (doc.kind === 'collage') { registerPhotos(doc, M); return; }
  await syncBase(doc, M);
  const n = needsDeps(doc);
  if (n.seg) await ensureSeg(doc, M);
  if (n.depth) await ensureDepth(doc, M).catch(() => {});
  if (n.plate) await ensurePlate(doc, M).catch(() => {});
  await decodeBrushes(doc, M);
}

export function brushCanvas(doc, M) {
  const { w, h } = dimsOf(baseOf(doc, M)), k = 1024 / Math.max(w, h);
  return mk(w * k, h * k);
}
export async function decodeBrushes(doc, M) {
  for (const l of doc.locals || []) if (l.mask.kind === 'brush' && l.mask.data && !M.brush.has(l.id)) {
    const img = await loadImage(l.mask.data); const c = brushCanvas(doc, M); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); M.brush.set(l.id, c);
  }
}

export async function renderBlob(doc, M, width, type = 'image/jpeg', q = 0.92) {
  const c = document.createElement('canvas');
  render(c, doc, M, width, { hi: true });
  return { blob: await canvasToBlob(c, type, q), w: c.width, h: c.height };
}

export function thumbURL(doc, M, w = 360) {
  const c = document.createElement('canvas'); render(c, doc, M, w, { fast: true });
  return c.toDataURL('image/jpeg', 0.8);
}

export function rawThumb(img, side = 360) {
  const { w, h } = dimsOf(img), k = side / Math.max(w, h);
  const c = mk(w * k, h * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}
