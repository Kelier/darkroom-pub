// ML worker: runs ONNX models (depth estimation, generative inpainting) off the main thread.
import * as ort from '../../vendor/ort/ort.wasm.min.mjs';

const base = new URL('../../', import.meta.url).href;
ort.env.wasm.wasmPaths = base + 'vendor/ort/';
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

const MODELS = {
  depth: 'assets/models/depth_anything_v2_small_q8.onnx',
  inpaint: 'assets/models/migan_pipeline_v2.onnx',
};
const sessions = {};

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载模型失败 ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader(), out = new Uint8Array(total);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, got); got += value.length;
    onProgress(got / total);
  }
  return out;
}

function session(name, id) {
  if (!sessions[name]) {
    sessions[name] = (async () => {
      const bytes = await fetchWithProgress(base + MODELS[name], (p) => self.postMessage({ id, progress: p, stage: 'download' }));
      self.postMessage({ id, progress: 1, stage: 'init' });
      return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    })();
    sessions[name].catch(() => { delete sessions[name]; });
  }
  return sessions[name];
}

self.onmessage = async ({ data: msg }) => {
  const { id, type } = msg;
  try {
    if (type === 'depth') {
      const s = await session('depth', id);
      const { w, h, input } = msg;
      const r = await s.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, h, w]) });
      const t = r.predicted_depth, d = t.data;
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < d.length; i++) { if (d[i] < mn) mn = d[i]; if (d[i] > mx) mx = d[i]; }
      const out = new Float32Array(d.length), k = 1 / Math.max(1e-6, mx - mn);
      for (let i = 0; i < d.length; i++) out[i] = (d[i] - mn) * k;
      self.postMessage({ id, ok: true, w: t.dims[2], h: t.dims[1], data: out }, [out.buffer]);
    } else if (type === 'inpaint') {
      const s = await session('inpaint', id);
      const { w, h, image, mask } = msg;
      const r = await s.run({ image: new ort.Tensor('uint8', image, [1, 3, h, w]), mask: new ort.Tensor('uint8', mask, [1, 1, h, w]) });
      const out = new Uint8Array(r.result.data);
      self.postMessage({ id, ok: true, w, h, data: out }, [out.buffer]);
    } else if (type === 'warm') {
      await session(msg.model, id);
      self.postMessage({ id, ok: true });
    }
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message || e) });
  }
};
