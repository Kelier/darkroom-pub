// Main-thread facade for on-device models: depth, inpainting (worker / ONNX) and segmentation (MediaPipe).

export { detectObjects, loadDetector } from './detect.js';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

let worker = null, seq = 0;
const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id); if (!p) return;
    if (data.progress !== undefined) { p.onProgress?.(data.progress, data.stage); return; }
    pending.delete(data.id);
    data.ok ? p.resolve(data) : p.reject(new Error(data.error));
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'worker error')); pending.clear(); worker = null; };
  return worker;
}
function call(msg, transfer = [], onProgress) {
  return new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...msg, id }, transfer);
  });
}

export const MODEL_INFO = {
  depth: { name: '深度估计 Depth Anything V2', size: '27 MB' },
  inpaint: { name: '生成式补全 MI-GAN', size: '28 MB' },
  segment: { name: '语义分割 DeepLab v3', size: '2.7 MB' },
  detect: { name: '目标检测 EfficientDet-Lite0', size: '4.6 MB' },
};
const loaded = new Set();
export const isLoaded = (m) => loaded.has(m);

// ---------- depth ----------
export async function estimateDepth(src, onProgress) {
  const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
  const k = 518 / Math.max(W, H);
  const w = Math.max(14, Math.round(W * k / 14) * 14), h = Math.max(14, Math.round(H * k / 14) * 14);
  const c = mk(w, h), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, w, h);
  const px = x.getImageData(0, 0, w, h).data, n = w * h;
  const input = new Float32Array(3 * n), mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) for (let ch = 0; ch < 3; ch++) input[ch * n + i] = (px[i * 4 + ch] / 255 - mean[ch]) / std[ch];
  const r = await call({ type: 'depth', w, h, input }, [input.buffer], onProgress);
  loaded.add('depth');
  return depthResult(r.data, r.w, r.h);
}

export function depthResult(data, w, h) {
  const canvas = mk(w, h), x = canvas.getContext('2d'), id = x.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = data[i] * 255; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  x.putImageData(id, 0, 0);
  return { data, w, h, canvas };
}

// ---------- inpainting ----------
// src: image/canvas; holeMask: canvas same aspect, white (alpha>0) = area to synthesize.
export async function inpaint(src, holeMask, onProgress, maxSide = 1024) {
  const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
  const k = Math.min(1, maxSide / Math.max(W, H));
  const w = Math.round(W * k), h = Math.round(H * k), n = w * h;
  const c = mk(w, h), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, w, h);
  const px = x.getImageData(0, 0, w, h).data;
  const m = mk(w, h), mx = m.getContext('2d', { willReadFrequently: true });
  mx.drawImage(holeMask, 0, 0, w, h);
  const md = mx.getImageData(0, 0, w, h).data;
  const image = new Uint8Array(3 * n), mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    image[i] = px[i * 4]; image[n + i] = px[i * 4 + 1]; image[2 * n + i] = px[i * 4 + 2];
    mask[i] = md[i * 4 + 3] > 20 ? 0 : 255;          // MI-GAN: 255 = known, 0 = hole
  }
  const r = await call({ type: 'inpaint', w, h, image, mask }, [image.buffer, mask.buffer], onProgress);
  loaded.add('inpaint');
  const out = mk(w, h), ox = out.getContext('2d'), od = ox.createImageData(w, h);
  for (let i = 0; i < n; i++) { od.data[i * 4] = r.data[i]; od.data[i * 4 + 1] = r.data[n + i]; od.data[i * 4 + 2] = r.data[2 * n + i]; od.data[i * 4 + 3] = 255; }
  ox.putImageData(od, 0, 0);
  // Composite back at full resolution: original pixels where known, synthesized (feathered) where hole.
  const full = mk(W, H), fx = full.getContext('2d');
  fx.drawImage(src, 0, 0, W, H);
  const fill = mk(W, H), fl = fill.getContext('2d');
  fl.drawImage(out, 0, 0, W, H);
  fl.globalCompositeOperation = 'destination-in';
  fl.filter = `blur(${Math.max(1, W * 0.004)}px)`;
  fl.drawImage(holeMask, 0, 0, W, H);
  fx.drawImage(fill, 0, 0);
  return full;
}

export function warmModel(model, onProgress) { return call({ type: 'warm', model }, [], onProgress).then(() => loaded.add(model)); }

// ---------- segmentation ----------
let segLoading = null;
function loadSegmenter() {
  if (segLoading) return segLoading;
  segLoading = (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('../../vendor/mediapipe/vision_bundle.mjs');
    const files = await FilesetResolver.forVisionTasks(new URL('../../vendor/mediapipe/wasm', import.meta.url).href);
    return ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: new URL('../../assets/models/deeplab_v3.tflite', import.meta.url).href, delegate: 'CPU' },
      runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false,
    });
  })().catch((e) => { console.warn('[segment] unavailable', e); segLoading = null; return null; });
  return segLoading;
}

// Returns a feathered alpha canvas (subject = opaque) at the source aspect, or null.
export async function segmentSubject(src, subjectBox) {
  const seg = await loadSegmenter();
  if (!seg) return null;
  const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
  const k = Math.min(1, 640 / Math.max(W, H));
  const c = mk(W * k, H * k); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  let res;
  try { res = seg.segment(c); } catch (e) { console.warn(e); return null; }
  const mask = res.categoryMask, mw = mask.width, mh = mask.height, cat = mask.getAsUint8Array();
  // Prefer the class that dominates the detected subject box; fall back to "any foreground".
  let target = -1;
  if (subjectBox) {
    const hist = new Map();
    for (let y = Math.floor(subjectBox.y0 * mh); y < Math.ceil(subjectBox.y1 * mh); y++)
      for (let x = Math.floor(subjectBox.x0 * mw); x < Math.ceil(subjectBox.x1 * mw); x++) { const v = cat[y * mw + x]; if (v) hist.set(v, (hist.get(v) || 0) + 1); }
    let best = 0; for (const [v, n] of hist) if (n > best) { best = n; target = v; }
  }
  const out = mk(mw, mh), ox = out.getContext('2d'), od = ox.createImageData(mw, mh);
  let fg = 0;
  for (let i = 0; i < mw * mh; i++) { const on = target > 0 ? cat[i] === target : cat[i] > 0; od.data[i * 4 + 3] = on ? 255 : 0; od.data[i * 4] = od.data[i * 4 + 1] = od.data[i * 4 + 2] = 255; fg += on; }
  mask.close?.(); res.close?.();
  loaded.add('segment');
  if (fg < mw * mh * 0.004) return null;
  ox.putImageData(od, 0, 0);
  const soft = mk(mw, mh), sx = soft.getContext('2d');
  sx.filter = `blur(${Math.max(1, mw * 0.004)}px)`; sx.drawImage(out, 0, 0);
  return soft;
}
