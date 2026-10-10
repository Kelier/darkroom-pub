// Tone curves: monotone cubic interpolation → 256-entry LUTs, presets, and an interactive editor.

export const IDENT = [[0, 0], [1, 1]];
export const CHANNELS = [['rgb', 'RGB', '#ecebe8'], ['r', 'R', '#ff5a4e'], ['g', 'G', '#3ecf8e'], ['b', 'B', '#5b9bff']];

export const isIdentity = (pts) => !pts || (pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1);
export const curvesActive = (c) => !!c && CHANNELS.some(([k]) => !isIdentity(c[k]));

// Fritsch–Carlson monotone cubic: smooth, never overshoots between control points.
export function curveFn(pts) {
  const p = [...(pts || IDENT)].sort((a, b) => a[0] - b[0]), n = p.length;
  const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

export function curveLUT(pts) {
  const f = curveFn(pts), lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(Math.min(1, Math.max(0, f(i / 255))) * 255);
  return lut;
}

// Combined per-channel LUTs: channel curve applied after the RGB master curve.
export function curveLUTs(c) {
  const m = curveLUT(c?.rgb), out = [];
  for (const k of ['r', 'g', 'b']) { const ch = curveLUT(c?.[k]), l = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) l[i] = ch[m[i]]; out.push(l); }
  return out;
}

export const CURVE_PRESETS = [
  ['线性', {}],
  ['柔和 S', { rgb: [[0, 0], [0.25, 0.21], [0.75, 0.8], [1, 1]] }],
  ['强对比', { rgb: [[0, 0], [0.22, 0.13], [0.5, 0.5], [0.78, 0.88], [1, 1]] }],
  ['褪色胶片', { rgb: [[0, 0.1], [0.3, 0.32], [0.75, 0.76], [1, 0.93]] }],
  ['暗部提亮', { rgb: [[0, 0], [0.2, 0.3], [0.6, 0.66], [1, 1]] }],
  ['青橙', { r: [[0, 0], [0.5, 0.52], [1, 1]], b: [[0, 0.08], [0.45, 0.5], [1, 0.9]] }],
  ['交叉冲印', { r: [[0, 0], [0.3, 0.24], [0.7, 0.8], [1, 1]], g: [[0, 0], [0.3, 0.27], [0.7, 0.76], [1, 1]], b: [[0, 0.16], [0.5, 0.48], [1, 0.82]] }],
  ['暖调高光', { r: [[0, 0], [0.7, 0.74], [1, 1]], b: [[0, 0], [0.7, 0.65], [1, 0.94]] }],
];

// ---------------- editor ----------------
// opts: { get(): curves, set(curves), live(), commit(label), histogram(): Float32Array[4] | null }
export function mountCurveEditor(host, opts) {
  let ch = 'rgb', drag = -1, hover = null;
  host.innerHTML = `<div class="curve">
    <div class="tabs curve-ch">${CHANNELS.map(([k, n, c]) => `<button data-ch="${k}" class="${k === ch ? 'on' : ''}"><i style="background:${c}"></i>${n}</button>`).join('')}</div>
    <div class="curve-box"><canvas class="curve-c" width="480" height="480"></canvas><span class="curve-io"></span></div>
    <div class="curve-presets">${CURVE_PRESETS.map(([n], i) => `<button class="chip" data-cp="${i}">${n}</button>`).join('')}</div>
    <div class="row curve-foot"><button class="btn xs" data-reset="ch">重置当前通道</button><button class="btn xs" data-reset="all">全部重置</button><span class="hint" style="margin:0">点击加点 · 双击删点</span></div></div>`;
  const cv = host.querySelector('.curve-c'), io = host.querySelector('.curve-io'), x = cv.getContext('2d'), W = cv.width, H = cv.height, PAD = 0;
  const get = () => ({ rgb: IDENT, r: IDENT, g: IDENT, b: IDENT, ...(opts.get() || {}) });
  const pts = () => get()[ch].map(p => [...p]);
  const toPx = (p) => [PAD + p[0] * (W - 2 * PAD), H - PAD - p[1] * (H - 2 * PAD)];
  const fromEv = (e) => { const r = cv.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))]; };

  function draw() {
    const c = get();
    x.clearRect(0, 0, W, H);
    // histogram
    const hs = opts.histogram?.();
    if (hs) {
      const arr = hs[{ rgb: 3, r: 0, g: 1, b: 2 }[ch]], mx = Math.max(1, ...arr), col = CHANNELS.find(q => q[0] === ch)[2];
      x.beginPath(); x.moveTo(0, H);
      arr.forEach((v, i) => x.lineTo(i / (arr.length - 1) * W, H - Math.sqrt(v / mx) * H * 0.9));
      x.lineTo(W, H); x.closePath(); x.fillStyle = col + '22'; x.fill();
    }
    // grid
    x.strokeStyle = 'rgba(255,255,255,.07)'; x.lineWidth = 1;
    for (let k = 1; k < 4; k++) { x.beginPath(); x.moveTo(W * k / 4, 0); x.lineTo(W * k / 4, H); x.moveTo(0, H * k / 4); x.lineTo(W, H * k / 4); x.stroke(); }
    x.setLineDash([4, 5]); x.strokeStyle = 'rgba(255,255,255,.18)'; x.beginPath(); x.moveTo(0, H); x.lineTo(W, 0); x.stroke(); x.setLineDash([]);
    // other channels faintly, active channel bold
    for (const [k, , col] of CHANNELS) {
      if (k === ch || isIdentity(c[k])) continue;
      const f = curveFn(c[k]); x.strokeStyle = col + '55'; x.lineWidth = 1.5; x.beginPath();
      for (let i = 0; i <= 96; i++) { const [px, py] = toPx([i / 96, Math.min(1, Math.max(0, f(i / 96)))]); i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke();
    }
    const col = CHANNELS.find(q => q[0] === ch)[2], f = curveFn(c[ch]);
    x.strokeStyle = col; x.lineWidth = 2.5; x.beginPath();
    for (let i = 0; i <= 160; i++) { const [px, py] = toPx([i / 160, Math.min(1, Math.max(0, f(i / 160)))]); i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke();
    c[ch].forEach((p, i) => { const [px, py] = toPx(p); x.beginPath(); x.arc(px, py, i === drag ? 8 : 6.5, 0, 7); x.fillStyle = i === drag ? col : '#111113'; x.fill(); x.lineWidth = 2; x.strokeStyle = col; x.stroke(); });
    if (hover) { const [px] = toPx([hover[0], 0]); x.strokeStyle = 'rgba(255,255,255,.25)'; x.lineWidth = 1; x.beginPath(); x.moveTo(px, 0); x.lineTo(px, H); x.stroke(); }
  }
  const readout = (inp) => { const out = curveFn(get()[ch])(inp); io.textContent = `输入 ${Math.round(inp * 255)} → 输出 ${Math.round(Math.min(1, Math.max(0, out)) * 255)}`; io.classList.add('on'); };
  const setPts = (p) => { opts.set({ ...get(), [ch]: p }); };
  const nearest = (q) => { const p = pts(), r = cv.getBoundingClientRect(), k = r.width; let best = -1, bd = 14 / k; p.forEach((pt, i) => { const dd = Math.hypot(pt[0] - q[0], pt[1] - q[1]); if (dd < bd) { bd = dd; best = i; } }); return best; };

  cv.onpointerdown = (e) => {
    cv.setPointerCapture(e.pointerId);
    const q = fromEv(e); let p = pts(), i = nearest(q);
    if (i < 0) { const y = Math.min(1, Math.max(0, curveFn(p)(q[0]))); p.push([q[0], y]); p.sort((a, b) => a[0] - b[0]); i = p.findIndex(t => t[0] === q[0]); setPts(p); }
    drag = i; draw();
  };
  cv.onpointermove = (e) => {
    const q = fromEv(e);
    if (drag < 0) { hover = q; draw(); readout(q[0]); return; }
    const p = pts(), lo = drag > 0 ? p[drag - 1][0] + 0.01 : 0, hi = drag < p.length - 1 ? p[drag + 1][0] - 0.01 : 1;
    const isEnd = drag === 0 || drag === p.length - 1;
    p[drag] = [isEnd ? Math.min(Math.max(q[0], drag === 0 ? 0 : lo), drag === 0 ? hi : 1) : Math.min(hi, Math.max(lo, q[0])), q[1]];
    setPts(p); readout(p[drag][0]); draw(); opts.live();
  };
  const up = () => { if (drag >= 0) { drag = -1; draw(); opts.commit('曲线 · ' + CHANNELS.find(q => q[0] === ch)[1]); } };
  cv.onpointerup = up; cv.onpointercancel = up;
  cv.onpointerleave = () => { hover = null; if (drag < 0) { io.classList.remove('on'); draw(); } };
  cv.ondblclick = (e) => { const p = pts(), i = nearest(fromEv(e)); if (i > 0 && i < p.length - 1) { p.splice(i, 1); setPts(p); draw(); opts.live(); opts.commit('曲线 · 删除控制点'); } };
  host.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => { ch = b.dataset.ch; host.querySelectorAll('[data-ch]').forEach(t => t.classList.toggle('on', t === b)); draw(); });
  host.querySelectorAll('[data-cp]').forEach(b => b.onclick = () => { const pr = CURVE_PRESETS[+b.dataset.cp]; opts.set({ rgb: IDENT, r: IDENT, g: IDENT, b: IDENT, ...structuredClone(pr[1]) }); draw(); opts.live(); opts.commit('曲线预设 · ' + pr[0]); });
  host.querySelector('[data-reset="ch"]').onclick = () => { setPts(IDENT.map(p => [...p])); draw(); opts.live(); opts.commit('重置曲线通道'); };
  host.querySelector('[data-reset="all"]').onclick = () => { opts.set(null); draw(); opts.live(); opts.commit('重置曲线'); };
  draw();
  return { redraw: draw };
}
