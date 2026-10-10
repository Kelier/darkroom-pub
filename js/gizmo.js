// 2.5D camera gizmo: an XYZ orbit sphere floating over the preview.
// Drag the sphere to orbit freely, drag an axis handle to constrain, Z handle / wheel to dolly, double-click to reset.

import { S, bus, $ } from './state.js';

const SIZE = 136, R = 46, C = SIZE / 2, DEG = 30;       // full slider range ↔ ±30° of apparent rotation
const AX = [
  { k: 'x', v: [1, 0, 0], col: '#ff5a4e', label: 'X', hint: '俯仰' },
  { k: 'y', v: [0, -1, 0], col: '#3ecf8e', label: 'Y', hint: '偏航' },
  { k: 'z', v: [0, 0, 1], col: '#5b9bff', label: 'Z', hint: '推拉' },
];

let el = null, svg = null, readout = null, drag = null, hoverK = null;
const clamp = (v) => Math.max(-1, Math.min(1, v));

function rot(v, cam) {
  const a = (cam.x || 0) * DEG * Math.PI / 180, b = (cam.y || 0) * DEG * Math.PI / 180;
  // yaw about the screen-vertical axis, then pitch about the horizontal axis
  let [x, y, z] = v;
  [x, z] = [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
  [y, z] = [y * Math.cos(b) - z * Math.sin(b), y * Math.sin(b) + z * Math.cos(b)];
  return [x, y, z];
}

function draw() {
  if (!svg || !S.doc) return;
  const cam = S.doc.cam || {}, zoomR = R * (1 + (cam.zoom || 0) * 0.12);
  const parts = [];
  parts.push(`<defs><radialGradient id="gzS" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#3a3a42"/><stop offset=".6" stop-color="#1a1a1f"/><stop offset="1" stop-color="#0d0d10"/></radialGradient></defs>`);
  parts.push(`<circle cx="${C}" cy="${C}" r="${zoomR}" fill="url(#gzS)" stroke="rgba(255,255,255,.14)" stroke-width="1" class="gz-body"/>`);
  // great circles (rings) perpendicular to each axis, back half dimmed
  for (const ax of AX) {
    const [u, w] = ax.k === 'x' ? [[0, 1, 0], [0, 0, 1]] : ax.k === 'y' ? [[1, 0, 0], [0, 0, 1]] : [[1, 0, 0], [0, 1, 0]];
    let front = '', back = '';
    for (let i = 0; i <= 64; i++) {
      const t = i / 64 * Math.PI * 2, p = rot([u[0] * Math.cos(t) + w[0] * Math.sin(t), u[1] * Math.cos(t) + w[1] * Math.sin(t), u[2] * Math.cos(t) + w[2] * Math.sin(t)], cam);
      const seg = `${i ? 'L' : 'M'}${(C + p[0] * zoomR).toFixed(1)},${(C + p[1] * zoomR).toFixed(1)}`;
      if (p[2] >= 0) front += seg; else back += seg;
    }
    const on = hoverK === ax.k || drag?.k === ax.k;
    parts.push(`<path d="${back.replace(/L/, 'M')}" fill="none" stroke="${ax.col}" stroke-opacity=".18" stroke-width="1"/>`);
    parts.push(`<path d="${front.replace(/^L/, 'M')}" fill="none" stroke="${ax.col}" stroke-opacity="${on ? .95 : .5}" stroke-width="${on ? 2 : 1.3}"/>`);
  }
  // axis handles sorted back-to-front
  const hs = AX.flatMap(ax => [[ax, 1], [ax, -1]]).map(([ax, s]) => { const p = rot(ax.v.map(c => c * s), cam); return { ax, s, p }; }).sort((a, b) => a.p[2] - b.p[2]);
  for (const { ax, s, p } of hs) {
    const x = C + p[0] * (zoomR + 8), y = C + p[1] * (zoomR + 8), on = hoverK === ax.k || drag?.k === ax.k, op = p[2] < 0 ? 0.45 : 1;
    if (s > 0) {
      parts.push(`<line x1="${C}" y1="${C}" x2="${x}" y2="${y}" stroke="${ax.col}" stroke-width="${on ? 2.4 : 1.6}" stroke-opacity="${op}"/>`);
      parts.push(`<g class="gz-h" data-k="${ax.k}" opacity="${op}"><circle cx="${x}" cy="${y}" r="${on ? 11 : 9.5}" fill="${ax.col}"/><text x="${x}" y="${y + 3.6}" text-anchor="middle">${ax.label}</text></g>`);
    } else parts.push(`<circle class="gz-h" data-k="${ax.k}" cx="${x}" cy="${y}" r="5.5" fill="#111113" stroke="${ax.col}" stroke-width="1.5" opacity="${op}"/>`);
  }
  parts.push(`<circle cx="${C}" cy="${C}" r="2.5" fill="#fff" opacity=".7"/>`);
  svg.innerHTML = parts.join('');
  const yaw = Math.round((cam.x || 0) * DEG), pitch = Math.round((cam.y || 0) * DEG), dz = Math.round((cam.zoom || 0) * 100);
  readout.innerHTML = drag || hoverK
    ? `<b>${drag?.k ? AX.find(a => a.k === drag.k)?.hint || '环绕' : hoverK ? AX.find(a => a.k === hoverK).hint : '环绕'}</b> 偏航 ${yaw}° · 俯仰 ${pitch}° · 推拉 ${dz}`
    : (cam.on ? `偏航 ${yaw}° · 俯仰 ${pitch}° · 推拉 ${dz}` : '拖动球体改变视角');
}

function pickHandle(e) { const h = e.target.closest?.('.gz-h'); return h ? h.dataset.k : null; }

function onDown(e) {
  if (!S.doc || S.doc.kind === 'collage') return;
  e.preventDefault(); e.stopPropagation();
  bus.stopAnim?.();
  el.setPointerCapture(e.pointerId);
  const k = pickHandle(e);
  drag = { k: k || 'free', x0: e.clientX, y0: e.clientY, cam0: { ...S.doc.cam } };
  el.classList.add('dragging');
  if (!S.doc.cam.on) S.doc.cam = { ...S.doc.cam, on: true };
  draw();
}
function onMove(e) {
  if (!drag) { const k = pickHandle(e); if (k !== hoverK) { hoverK = k; draw(); } return; }
  const dx = (e.clientX - drag.x0) / (R * 2.2), dy = (e.clientY - drag.y0) / (R * 2.2), c0 = drag.cam0;
  const cam = { ...S.doc.cam };
  if (drag.k === 'free') { cam.x = clamp(c0.x + dx); cam.y = clamp(c0.y + dy); }
  else if (drag.k === 'y') cam.x = clamp(c0.x + dx);          // spin around Y → yaw (horizontal)
  else if (drag.k === 'x') cam.y = clamp(c0.y + dy);          // spin around X → pitch (vertical)
  else if (drag.k === 'z') cam.zoom = clamp((c0.zoom || 0) - (dy - dx * 0.3) * 1.2);
  if (e.shiftKey) { cam.x = Math.round(cam.x * 10) / 10; cam.y = Math.round(cam.y * 10) / 10; cam.zoom = Math.round((cam.zoom || 0) * 10) / 10; }
  S.doc.cam = cam;
  S.lastInput = performance.now(); bus.scheduleRender(); draw();
}
function onUp() {
  if (!drag) return;
  const k = drag.k; drag = null; el.classList.remove('dragging');
  S.lastInput = 0; draw();
  bus.commit({ free: '视角 · 环绕', x: '视角 · 俯仰', y: '视角 · 偏航', z: '视角 · 推拉' }[k], { major: false });
  if (S.tool === 'space') bus.buildPanel();
}

export function initGizmo() {
  if (el) return;
  el = document.createElement('div');
  el.className = 'gizmo'; el.hidden = true;
  el.innerHTML = `<svg viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}"></svg><div class="gz-read"></div>`;
  $('#stageInner').append(el);
  svg = el.querySelector('svg'); readout = el.querySelector('.gz-read');
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerleave', () => { if (!drag && hoverK) { hoverK = null; draw(); } });
  el.addEventListener('dblclick', (e) => { e.stopPropagation(); S.doc.cam = { ...S.doc.cam, x: 0, y: 0, zoom: 0 }; bus.commit('视角 · 复位', { major: true }); if (S.tool === 'space') bus.buildPanel(); draw(); });
  el.addEventListener('wheel', (e) => {
    e.preventDefault(); e.stopPropagation();
    S.doc.cam = { ...S.doc.cam, on: true, zoom: clamp((S.doc.cam.zoom || 0) - Math.sign(e.deltaY) * 0.05) };
    S.lastInput = performance.now(); bus.scheduleRender(); draw();
    clearTimeout(el._t); el._t = setTimeout(() => { S.lastInput = 0; bus.commit('视角 · 推拉'); if (S.tool === 'space') bus.buildPanel(); }, 400);
  }, { passive: false });
}

// Called after every overlay draw: show in the space tool once depth exists, pinned to the photo's bottom-right.
export function placeGizmo() {
  if (!el) initGizmo();
  const show = S.view === 'editor' && S.tool === 'space' && !!S.M?.depth && S.doc?.kind !== 'collage' && !S.compare;
  el.hidden = !show;
  if (!show) return;
  const v = $('#view').getBoundingClientRect(), pr = $('#stageInner').getBoundingClientRect();
  const left = Math.min(v.right - pr.left - SIZE - 10, pr.width - SIZE - 6), top = Math.min(v.bottom - pr.top - SIZE - 30, pr.height - SIZE - 30);
  el.style.transform = `translate(${Math.max(6, left)}px, ${Math.max(6, top)}px)`;
  if (!drag) draw();
}
