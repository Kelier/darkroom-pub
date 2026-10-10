// On-device object detection (MediaPipe EfficientDet-Lite0, vendored). Falls back silently to heuristics.

let loading = null;

export function loadDetector() {
  if (loading) return loading;
  loading = (async () => {
    const { FilesetResolver, ObjectDetector } = await import('../../vendor/mediapipe/vision_bundle.mjs');
    const files = await FilesetResolver.forVisionTasks(new URL('../../vendor/mediapipe/wasm', import.meta.url).href);
    return ObjectDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: new URL('../../assets/models/efficientdet_lite0.tflite', import.meta.url).href, delegate: 'CPU' },
      scoreThreshold: 0.3, maxResults: 10, runningMode: 'IMAGE',
    });
  })().catch((e) => { console.warn('[detector] unavailable, using heuristics only', e); return null; });
  return loading;
}

const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);

// Returns normalized detections [{label, score, x, y, w, h}] or null.
export async function detectObjects(img, timeout = 8000) {
  const det = await withTimeout(loadDetector(), timeout);
  if (!det) return null;
  try {
    const W = img.naturalWidth, H = img.naturalHeight;
    const res = det.detect(img);
    return res.detections.map(d => ({
      label: d.categories[0].categoryName, score: d.categories[0].score,
      x: Math.max(0, d.boundingBox.originX / W), y: Math.max(0, d.boundingBox.originY / H),
      w: Math.min(1, d.boundingBox.width / W), h: Math.min(1, d.boundingBox.height / H),
    }));
  } catch (e) { console.warn('[detector] failed', e); return null; }
}
