// DARKROOM — app shell: navigation, project lifecycle, progressive rendering, canvas interaction, history, export.

import { FILMS, RATIOS, TEMPLATES } from './presets.js';
import { cropSize, clampCrop, labelCN } from './analyze.js';
import { render, canvasAspect, baseOf, dimsOf, localMask, clearRenderCache, aux } from './render.js';
import { mk } from './color.js';
import { newDoc, applyTemplate, subjectInCanvas, bestCrop } from './templates.js';
import { saveProject, getProject } from './store.js';
import { loadMedia, analyzeFull, syncBase, ensureSeg, ensureDeps, registerPhotos, thumbURL, uid, canvasToBlob, blobToImage } from './media.js';
import { loadDetector } from './ml/index.js';
import { S, bus, $, $$, el, esc, clone, toast, fmtTime } from './state.js';
import { buildPanel, TOOLS, panelOnRender } from './panels.js';
import { renderStrip, addToTray, importFiles, openExportModal } from './batch.js';
import { initDiscover, renderLibrary, renderMe, SAMPLES, discoverShown } from './pages.js';
import { placeGizmo } from './gizmo.js';
import { mountLive, openLiveImport, stopLive } from './live.js';

// ---------------- navigation ----------------
function go(view) {
  stopLive();
  S.view = view;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  moveIndicator();
  if (view === 'library') renderLibrary();
  if (view === 'me') renderMe();
  if (view === 'discover') discoverShown();
  if (view === 'editor') requestAnimationFrame(() => scheduleRender());
}
function moveIndicator() {
  const b = $('#modules button.active'), ind = $('#modInd'); if (!b) return;
  ind.style.width = b.offsetWidth + 'px'; ind.style.transform = `translateX(${b.offsetLeft - 3}px)`;
}
document.addEventListener('click', (e) => {
  const v = e.target.closest('[data-view]'); if (v) { e.preventDefault(); go(v.dataset.view); }
  if (e.target.closest('[data-action=upload]')) $('#fileInput').click();
});
addEventListener('resize', () => { moveIndicator(); scheduleRender(); });

// ---------------- history ----------------
function commit(label, opts = {}) {
  stopLive();
  if (!S.doc) return;
  S.hist = S.hist.slice(0, S.hi + 1);
  S.hist.push({ label, t: Date.now(), doc: clone(S.doc) });
  if (S.hist.length > 80) S.hist.shift();
  S.hi = S.hist.length - 1;
  renderRolls(); updateHistButtons(); scheduleRender(opts.major); refreshThumbs(); queueSave(); updateHud();
}
async function restore(i) {
  if (i < 0 || i >= S.hist.length) return;
  S.hi = i; S.doc = clone(S.hist[i].doc);
  if (S.selected && !S.doc.layers.find(l => l.id === S.selected)) S.selected = null;
  if (S.selLocal && !(S.doc.locals || []).find(l => l.id === S.selLocal)) S.selLocal = null;
  if (S.doc.kind !== 'collage' && (S.doc.base || 'o') !== S.M.baseKey) { await syncBase(S.doc, S.M); ensureSeg(S.doc, S.M).then(() => scheduleRender()); }
  stopLive(); await mountLive(); renderRolls(); updateHistButtons(); buildPanel(); scheduleRender(true); renderInsights(); buildRatioChips(); queueSave(); updateHud();
}
function updateHistButtons() { $('#undoBtn').disabled = S.hi <= 0; $('#redoBtn').disabled = S.hi >= S.hist.length - 1; }
$('#undoBtn').onclick = () => restore(S.hi - 1);
$('#redoBtn').onclick = () => restore(S.hi + 1);
$('#histBtn').onclick = (e) => {
  const p = $('#histPop');
  if (!p.hidden) { p.hidden = true; return; }
  const r = e.currentTarget.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(innerWidth - 300, r.left - 130)) + 'px'; p.style.top = (r.bottom + 6) + 'px';
  p.innerHTML = `<h5>版本历史 · ${S.hist.length}</h5>` + S.hist.map((h, i) => `<button class="hist-item ${i === S.hi ? 'cur' : ''}" data-i="${i}"><span>${String(i + 1).padStart(2, '0')} · ${esc(h.label)}</span><small>${fmtTime(h.t)}</small></button>`).reverse().join('');
  p.hidden = false;
  $$('.hist-item', p).forEach(b => b.onclick = () => { restore(+b.dataset.i); p.hidden = true; });
};
document.addEventListener('pointerdown', (e) => { const p = $('#histPop'); if (!p.hidden && !p.contains(e.target) && !e.target.closest('#histBtn')) p.hidden = true; });

// ---------------- persistence ----------------
let saveT = null;
function queueSave() { if (!S.project) return; $('#saveState').textContent = '● 未保存'; clearTimeout(saveT); saveT = setTimeout(() => persist(), 1400); }
async function persist(showToast) {
  if (!S.project || !S.doc) return;
  clearTimeout(saveT);
  const rec = { id: S.project.id, name: $('#projName').value || '未命名', created: S.project.created, updated: Date.now(), blob: S.project.blob,
    live: S.project.live, assets: S.project.assets, doc: S.doc, hist: S.hist.slice(-40), hi: Math.max(0, S.hi - Math.max(0,S.hist.length-40)), thumb: thumbURL(S.doc, S.M, 360), template: S.doc.template, kind: S.doc.kind };
  try {
    await saveProject(rec); $('#saveState').textContent = '已保存 ' + fmtTime(rec.updated);
    renderStrip();
    if (showToast) toast('已保存到片夹');
  } catch (err) { $('#saveState').textContent = '保存失败'; console.error(err); }
}
$('#saveBtn').onclick = () => persist(true);
$('#projName').addEventListener('change', () => queueSave());

// ---------------- open ----------------
function migrate(d) {
  const n = newDoc(d.photoId);
  return { ...n, ...d, geo: { ...n.geo, ...(d.geo || {}) }, cam: { ...n.cam, ...(d.cam || {}) }, optics: { ...n.optics, ...(d.optics || {}) }, frame: { ...n.frame, ...(d.frame || {}) }, film: { ...n.film, ...(d.film || {}) }, locals: d.locals || [], layers: d.layers || [] };
}
bus.migrate = migrate;

let openSeq = 0;
async function openRecord(rec, opts = {}) {
  const seq = ++openSeq;
  if (S.project && S.project.id !== rec.id) await persist();
  go('editor');
  $('#emptyEditor').hidden = true; $('#editor').hidden = false; $('#busy').hidden = false;
  stopAnim(); stopLive();
  const M = await loadMedia(rec);
  let doc = rec.doc ? migrate(rec.doc) : null;
  if (doc?.kind === 'collage') { registerPhotos(doc, M); M.an = M.photos.get(doc.layers.find(l => l.type === 'photo')?.asset)?.an || await analyzeFull(M.img); M.baseKey = 'o'; }
  else if (doc) await ensureDeps(doc, M);
  else {
    M.an = await analyzeFull(M.img); M.baseKey = 'o';
    doc = newDoc(rec.id); doc.ratio = M.an.suggestedRatio; doc.crop = bestCrop(doc, M.img, M.an, 1);
    if (opts.template) doc = applyTemplate(opts.template, doc, M.an, M.img, { seed: 1 });
  }
  if (seq !== openSeq) return;
  clearRenderCache();
  S.M = M; S.doc = doc; S.selected = null; S.selLocal = null; S.focusPick = false; S.eraseMask = null; S.viewDepth = false;
  S.project = { id: rec.id, created: rec.created || Date.now(), blob: rec.blob, live: rec.live, assets: rec.assets || {} };
  S.seeds = { crop: 1, caption: 0, layout: 1, film: 1, frame: 1, annot: 1, collage: 1 };
  S.captions = [];
  $('#projName').value = rec.name || '未命名';
  if (rec.doc && rec.hist?.length) { S.hist = rec.hist.map(h => ({ ...h, doc: migrate(h.doc) })); S.hi = Math.min(rec.hi ?? S.hist.length - 1, S.hist.length - 1); }
  else { S.hist = []; S.hi = -1; commit(opts.template ? `套用模板 · ${TEMPLATES.find(t => t.id === opts.template)?.name}` : rec.doc ? '打开项目' : '导入 · 智能构图'); }
  await mountLive();
  renderRolls();
  addToTray(rec.id);
  $('#busy').hidden = true;
  bus.recomputeCrops();
  setTool(opts.tool || (doc.kind === 'collage' ? 'layout' : opts.template ? 'layout' : 'auto'));
  renderInsights(); updateHistButtons(); buildRatioChips(); buildLocks(); updateHud();
  scheduleRender(true);
  $('#saveState').textContent = rec.doc ? '已保存' : '';
  if (!rec.doc) { await persist(); if (seq === openSeq) toast(`识别：${M.an.sceneLabel} · ${M.an.mood.join(' / ')}`); }
  else renderStrip();
  if (doc.kind !== 'collage') ensureSeg(doc, M).then((m) => { if (m && S.M === M) { scheduleRender(); renderInsights(); } });
}
bus.openRecord = openRecord;

async function openById(id, opts) { const rec = await getProject(id); if (rec) await openRecord(rec, opts); }
bus.openById = openById;

async function openSample(s, template, tool) {
  const blob = await (await fetch(s.src)).blob();
  const rec = { id: uid('P'), name: s.name, created: Date.now(), updated: Date.now(), blob, doc: null, hist: [], thumb: null, assets: {} };
  await openRecord(rec, { template, tool });
}
bus.openSample = openSample;

// ---------------- render loop (progressive + crossfade) ----------------
let raf = 0, fullT = 0, histoT = 0;
function scheduleRender(major) { if (major) S.ghostNext = true; if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderMain(); }); }
function renderMain() {
  if (!S.M || !S.doc || S.view !== 'editor' || S.anim) return;
  const box = $('#stageInner'), view = $('#view');
  const inset=innerWidth<=760?14:44;
  const bw = box.clientWidth - inset, bh = box.clientHeight - inset;
  if (bw < 40 || bh < 40) return;
  const a = canvasAspect(S.doc, baseOf(S.doc, S.M));
  let dw = bw, dh = bw / a; if (dh > bh) { dh = bh; dw = bh * a; }
  const dpr = Math.min(2, devicePixelRatio || 1);
  const full = Math.min(1800, Math.round(dw * dpr));
  const fast = S.dragging || performance.now() - S.lastInput < 160;
  if (S.ghostNext && view.width > 1 && !fast) ghostFade(view);
  S.ghostNext = false;
  try { S.info = render(view, S.doc, S.M, fast ? Math.round(full * 0.5) : full, { original: S.compare, fast }); }
  catch (e) { console.error(e); }
  view.style.width = dw + 'px'; view.style.height = dh + 'px';
  drawOverlay();
  clearTimeout(fullT);
  if (fast) fullT = setTimeout(() => scheduleRender(), 200);
  else { clearTimeout(histoT); histoT = setTimeout(drawHistogram, 60); panelOnRender?.(); }
}
function ghostFade(view) {
  const g = $('#ghost'), r = view.getBoundingClientRect(), pr = $('#stageInner').getBoundingClientRect();
  g.width = view.width; g.height = view.height; g.getContext('2d').drawImage(view, 0, 0);
  Object.assign(g.style, { left: (r.left - pr.left) + 'px', top: (r.top - pr.top) + 'px', width: r.width + 'px', height: r.height + 'px' });
  g.classList.add('show');
  requestAnimationFrame(() => requestAnimationFrame(() => g.classList.remove('show')));
}

// ---------------- HUD / overlay ----------------
export const fNum = (v) => v < 0.01 ? '关' : 'f/' + (16 * Math.pow(1.2 / 16, v)).toFixed(1);
function updateHud() {
  const h = $('#hud'); if (!S.doc) { h.innerHTML = ''; return; }
  const d = S.doc, tags = [];
  if (S.compare) tags.push('<span class="safe">原图</span>');
  if (d.base) tags.push('<span>'+ (S.project?.live ? 'Live 封面' : 'AI 生成底片') +'</span>');
  if (d.geo && (d.geo.rotate || d.geo.vert || d.geo.horiz)) tags.push('<span>透视校正</span>');
  if (d.cam?.on) tags.push('<span>2.5D 相机</span>');
  if (d.optics?.aperture > 0.01) tags.push(`<span>${d.optics.mode === 'depth' ? '深度景深' : '景深'} ${fNum(d.optics.aperture)}</span>`);
  if (d.locals?.length) tags.push(`<span>局部 ×${d.locals.length}</span>`);
  if (S.viewDepth) tags.push('<span class="safe">深度视图</span>');
  h.innerHTML = tags.join('');
}
bus.updateHud = updateHud;

let hover = null;
const line = (x, a, b, c, d) => { x.beginPath(); x.moveTo(a, b); x.lineTo(c, d); x.stroke(); };
function cropCanvas(a, cr, w, h) { const { w: aw, h: ah } = dimsOf(a); const c = mk(w, h); c.getContext('2d').drawImage(a, (cr.cx - cr.cw / 2) * aw, (cr.cy - cr.ch / 2) * ah, cr.cw * aw, cr.ch * ah, 0, 0, w, h); return c; }
function toSource(p) { const ph = S.info.L.photo, cr = S.info.crop; return { x: cr.cx - cr.cw / 2 + ((p.x - ph.x) / ph.w) * cr.cw, y: cr.cy - cr.ch / 2 + ((p.y - ph.y) / ph.h) * cr.ch }; }
function toCanvas(nx, ny) { const ph = S.info.L.photo, cr = S.info.crop; return { x: ph.x + ((nx - (cr.cx - cr.cw / 2)) / cr.cw) * ph.w, y: ph.y + ((ny - (cr.cy - cr.ch / 2)) / cr.ch) * ph.h }; }
function focusCanvasPoint() { const o = S.doc.optics; return toCanvas(o.focusX ?? S.M.an.subject.cx, o.focusY ?? S.M.an.subject.cy); }
const brushActive = () => S.tool === 'local' && (S.eraseMask || (S.doc.locals || []).find(l => l.id === S.selLocal)?.mask.kind === 'brush');

// Composition guides inside the photo window.
function drawGuides(x, ph, u) {
  const g = S.guide || 'thirds', L = (a, b, c, d) => line(x, ph.x + a * ph.w, ph.y + b * ph.h, ph.x + c * ph.w, ph.y + d * ph.h);
  x.save(); x.lineWidth = u; x.strokeStyle = 'rgba(255,255,255,.55)'; x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 2 * u;
  if (g === 'thirds') for (const k of [1 / 3, 2 / 3]) { L(k, 0, k, 1); L(0, k, 1, k); }
  if (g === 'golden') for (const k of [0.382, 0.618]) { L(k, 0, k, 1); L(0, k, 1, k); }
  if (g === 'grid') { x.strokeStyle = 'rgba(255,255,255,.3)'; for (let k = 1; k < 8; k++) { L(k / 8, 0, k / 8, 1); L(0, k / 8, 1, k / 8); } }
  if (g === 'diagonal') { L(0, 0, 1, 1); L(1, 0, 0, 1); const a = ph.w / ph.h; if (a > 1) { L(0, 0, 1 / a, 1); L(1, 0, 1 - 1 / a, 1); } else { L(0, 0, 1, a); L(0, 1, 1, 1 - a); } }
  const geo = S.doc.geo;
  if (geo && (Math.abs(geo.rotate || 0) > 0.05 || geo.vert || geo.horiz) && performance.now() - (S.geoTouch || 0) < 1500) { x.strokeStyle = 'rgba(255,179,64,.32)'; x.shadowBlur = 0; for (let k = 1; k < 12; k++) { L(k / 12, 0, k / 12, 1); L(0, k / 12, 1, k / 12); } }
  x.restore();
}

function drawOverlay() {
  const view = $('#view'), ov = $('#overlay');
  const r = view.getBoundingClientRect(), pr = $('#stageInner').getBoundingClientRect();
  Object.assign(ov.style, { left: (r.left - pr.left) + 'px', top: (r.top - pr.top) + 'px', width: r.width + 'px', height: r.height + 'px' });
  if (ov.width !== view.width || ov.height !== view.height) { ov.width = view.width; ov.height = view.height; }
  placeGizmo();
  const x = ov.getContext('2d'); x.clearRect(0, 0, ov.width, ov.height);
  if (!S.info || S.compare || S.anim) return;
  const u = view.width / Math.max(1, r.width), L = S.info.L, ph = L.photo, isPhoto = S.doc.kind !== 'collage';
  if (isPhoto && S.viewDepth && S.M.depth) {
    const d = aux(S.doc, S.M, 'depth');
    if (d) x.drawImage(cropCanvas(d, S.info.crop, Math.round(ph.w), Math.round(ph.h)), ph.x, ph.y);
  }
  if (isPhoto && S.tool === 'crop') {
    drawGuides(x, ph, u);
    const sc = subjectInCanvas(S.doc, baseOf(S.doc, S.M), S.M.an);
    x.strokeStyle = '#ff4836'; x.setLineDash([6 * u, 5 * u]); x.lineWidth = 1.5 * u;
    x.strokeRect(sc.a.x * ov.width, sc.a.y * ov.height, (sc.b.x - sc.a.x) * ov.width, (sc.b.y - sc.a.y) * ov.height);
    x.setLineDash([]);
    const tag = 'AI 主体' + (S.M.an.subject.label ? ' · ' + labelCN(S.M.an.subject.label) + (S.M.an.subject.count > 1 ? ' ×' + S.M.an.subject.count : '') : '');
    x.font = `600 ${11 * u}px Inter, sans-serif`; const tw = x.measureText(tag).width + 12 * u;
    x.fillStyle = '#ff4836'; x.fillRect(sc.a.x * ov.width, sc.a.y * ov.height - 18 * u, tw, 18 * u);
    x.fillStyle = '#fff'; x.fillText(tag, sc.a.x * ov.width + 6 * u, sc.a.y * ov.height - 5 * u);
  }
  if (isPhoto && S.tool === 'optics' && (S.doc.optics.aperture > 0.01 || S.focusPick)) {
    const f = focusCanvasPoint();
    x.strokeStyle = '#ffb340'; x.lineWidth = 1.6 * u;
    x.strokeRect(f.x - 18 * u, f.y - 18 * u, 36 * u, 36 * u);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) line(x, f.x + dx * 18 * u, f.y + dy * 18 * u, f.x + dx * 25 * u, f.y + dy * 25 * u);
  }
  if (isPhoto && S.tool === 'local') {
    const lc = (S.doc.locals || []).find(l => l.id === S.selLocal);
    const tint = (m) => { const t = mk(m.width, m.height), tx = t.getContext('2d'); tx.drawImage(m, 0, 0); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = 'rgba(255,40,30,.5)'; tx.fillRect(0, 0, t.width, t.height); return t; };
    if (S.eraseMask) x.drawImage(tint(cropCanvas(S.eraseMask, S.info.crop, Math.max(8, Math.round(ph.w / 2)), Math.max(8, Math.round(ph.h / 2)))), ph.x, ph.y, ph.w, ph.h);
    else if (lc && S.showMask) {
      const m = localMask(S.doc, S.M, lc, S.info.crop, Math.max(8, Math.round(ph.w / 2)), Math.max(8, Math.round(ph.h / 2)));
      if (m) x.drawImage(tint(m), ph.x, ph.y, ph.w, ph.h);
    }
    if (lc?.mask.kind === 'radial') { const p = toCanvas(lc.mask.cx, lc.mask.cy); x.strokeStyle = '#fff'; x.lineWidth = 1.5 * u; x.beginPath(); x.arc(p.x, p.y, 7 * u, 0, 7); x.stroke(); }
    if (lc?.mask.kind === 'linear') { const a = toCanvas(lc.mask.x0, lc.mask.y0), b = toCanvas(lc.mask.x1, lc.mask.y1); x.strokeStyle = '#fff'; x.lineWidth = 1.5 * u; x.setLineDash([5 * u, 4 * u]); line(x, a.x, a.y, b.x, b.y); x.setLineDash([]); for (const q of [a, b]) { x.beginPath(); x.arc(q.x, q.y, 5 * u, 0, 7); x.stroke(); } }
    if (hover && brushActive()) { x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 1.2 * u; x.beginPath(); x.arc(hover.x, hover.y, S.brush.size * Math.max(ph.w, ph.h) / 2, 0, 7); x.stroke(); }
  }
  const b = S.selected && S.info.boxes.find(b => b.id === S.selected);
  if (b) {
    x.save(); x.translate(b.cx, b.cy); x.rotate(b.rot * Math.PI / 180);
    x.strokeStyle = '#6aa8ff'; x.lineWidth = 1.4 * u; x.setLineDash([5 * u, 4 * u]);
    x.strokeRect(-b.w / 2 - 6 * u, -b.h / 2 - 6 * u, b.w + 12 * u, b.h + 12 * u); x.setLineDash([]);
    x.fillStyle = '#fff'; x.lineWidth = 2 * u;
    x.beginPath(); x.arc(b.w / 2 + 6 * u, b.h / 2 + 6 * u, 6 * u, 0, 7); x.fill(); x.stroke();
    line(x, 0, -b.h / 2 - 6 * u, 0, -b.h / 2 - 24 * u);
    x.beginPath(); x.arc(0, -b.h / 2 - 28 * u, 5 * u, 0, 7); x.fill(); x.stroke();
    x.restore();
  }
}
bus.drawOverlay = drawOverlay;

// ---------------- canvas interaction ----------------
const ov = $('#overlay');
let drag = null;
function evPt(e) { const r = ov.getBoundingClientRect(); const k = ov.width / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k }; }
function hit(p) {
  if (!S.info) return null;
  for (let i = S.info.boxes.length - 1; i >= 0; i--) {
    const b = S.info.boxes[i], a = -b.rot * Math.PI / 180, dx = p.x - b.cx, dy = p.y - b.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    const l = layerById(b.id);
    if (l?.type === 'rect' && l.role === 'shade') continue;
    if (Math.abs(lx) < b.w / 2 + 8 * p.k && Math.abs(ly) < b.h / 2 + 8 * p.k) return b;
  }
  return null;
}
function handleAt(p) {
  const b = S.selected && S.info?.boxes.find(b => b.id === S.selected); if (!b) return null;
  const a = b.rot * Math.PI / 180, u = p.k;
  for (const [k, [lx, ly]] of Object.entries({ scale: [b.w / 2 + 6 * u, b.h / 2 + 6 * u], rotate: [0, -b.h / 2 - 28 * u] })) {
    const hx = b.cx + lx * Math.cos(a) - ly * Math.sin(a), hy = b.cy + lx * Math.sin(a) + ly * Math.cos(a);
    if (Math.hypot(p.x - hx, p.y - hy) < 14 * u) return { kind: k, b };
  }
  return null;
}
function paintBrush(canvas, from, to, erase) {
  const x = canvas.getContext('2d'), W = canvas.width, H = canvas.height, ph = S.info.L.photo, cr = S.info.crop;
  const rad = Math.max(1, S.brush.size * Math.max(ph.w, ph.h) / 2 / ph.w * cr.cw * W);
  const a = toSource(from), b = toSource(to), dist = Math.hypot((b.x - a.x) * W, (b.y - a.y) * H), steps = Math.max(1, Math.ceil(dist / (rad * 0.25)));
  x.save(); x.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, px = (a.x + (b.x - a.x) * t) * W, py = (a.y + (b.y - a.y) * t) * H;
    const g = x.createRadialGradient(px, py, rad * S.brush.hard * 0.95, px, py, rad);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, 7); x.fill();
  }
  x.restore();
}
ov.addEventListener('pointerdown', (e) => {
  if (!S.info || S.anim) return;
  ov.setPointerCapture(e.pointerId);
  const p = evPt(e), isPhoto = S.doc.kind !== 'collage';
  S.dragging = true;
  if (isPhoto && S.tool === 'local') {
    const lc = (S.doc.locals || []).find(l => l.id === S.selLocal);
    if (S.eraseMask) { paintBrush(S.eraseMask, p, p, S.brush.erase); drag = { kind: 'erase', last: p, moved: true }; drawOverlay(); return; }
    if (lc?.mask.kind === 'brush') { paintBrush(S.M.brush.get(lc.id), p, p, S.brush.erase); drag = { kind: 'brush', last: p, lc, moved: true }; clearRenderCache(); scheduleRender(); return; }
    if (lc?.mask.kind === 'radial') { const s = toSource(p); lc.mask.cx = s.x; lc.mask.cy = s.y; drag = { kind: 'radial', lc, moved: true }; scheduleRender(); return; }
    if (lc?.mask.kind === 'linear') { const s = toSource(p); Object.assign(lc.mask, { x0: s.x, y0: s.y, x1: s.x, y1: s.y + 0.001 }); drag = { kind: 'linear', lc, moved: true }; scheduleRender(); return; }
  }
  const hd = handleAt(p);
  if (hd) { drag = { kind: hd.kind, p0: p, ly0: clone(layerById(S.selected)), cx: hd.b.cx, cy: hd.b.cy, moved: false }; return; }
  const b = hit(p);
  if (b) {
    const changed = S.selected !== b.id; S.selected = b.id;
    const ly = layerById(b.id);
    drag = { kind: 'move', p0: p, ly0: clone(ly), moved: false };
    if (changed) { const want = (ly.type === 'text' || ly.type === 'flow') ? 'text' : 'layout'; if (S.tool !== 'layout' && S.tool !== 'text') setTool(want); else buildPanel(); }
    drawOverlay(); return;
  }
  if (S.selected) { S.selected = null; buildPanel(); }
  if (!isPhoto) { drawOverlay(); return; }
  if (S.tool === 'optics' && S.focusPick) { setFocus(p); drag = { kind: 'focus', moved: true }; return; }
  const ph = S.info.L.photo;
  if (p.x >= ph.x && p.x <= ph.x + ph.w && p.y >= ph.y && p.y <= ph.y + ph.h) { drag = { kind: 'pan', p0: p, crop0: { ...S.doc.crop, cx: S.info.crop.cx, cy: S.info.crop.cy }, moved: false }; ov.style.cursor = 'grabbing'; }
  drawOverlay();
});
ov.addEventListener('pointermove', (e) => {
  const p = evPt(e);
  if (S.tool === 'local') { hover = p; if (!drag) drawOverlay(); }
  if (!drag) {
    if (!S.info) return;
    const h = handleAt(p);
    ov.style.cursor = brushActive() ? 'none' : h ? (h.kind === 'scale' ? 'nwse-resize' : 'grab') : hit(p) ? 'move'
      : (S.tool === 'optics' && S.focusPick) || S.tool === 'local' ? 'crosshair' : S.doc.kind === 'collage' ? 'default' : 'grab';
    return;
  }
  const W = S.info.L.W, H = S.info.L.H;
  if (drag.kind === 'erase') { paintBrush(S.eraseMask, drag.last, p, S.brush.erase); drag.last = p; drawOverlay(); return; }
  if (drag.kind === 'brush') { paintBrush(S.M.brush.get(drag.lc.id), drag.last, p, S.brush.erase); drag.last = p; clearRenderCache(); }
  else if (drag.kind === 'radial') { const s = toSource(p); drag.lc.mask.cx = s.x; drag.lc.mask.cy = s.y; }
  else if (drag.kind === 'linear') { const s = toSource(p); drag.lc.mask.x1 = s.x; drag.lc.mask.y1 = s.y; }
  else if (drag.kind === 'move') { const ly = layerById(S.selected); ly.x = drag.ly0.x + (p.x - drag.p0.x) / W; ly.y = drag.ly0.y + (p.y - drag.p0.y) / H; drag.moved = true; }
  else if (drag.kind === 'scale') {
    const ly = layerById(S.selected), k = Math.hypot(p.x - drag.cx, p.y - drag.cy) / Math.max(1, Math.hypot(drag.p0.x - drag.cx, drag.p0.y - drag.cy));
    if (ly.type === 'rect' || ly.type === 'photo') { ly.w = drag.ly0.w * k; ly.h = drag.ly0.h * k; } else ly.size = Math.max(0.005, drag.ly0.size * k);
    drag.moved = true;
  } else if (drag.kind === 'rotate') {
    const ly = layerById(S.selected); let ang = Math.atan2(p.y - drag.cy, p.x - drag.cx) * 180 / Math.PI + 90;
    if (e.shiftKey) ang = Math.round(ang / 15) * 15;
    ly.rot = Math.round(((ang + 540) % 360) - 180); drag.moved = true;
  } else if (drag.kind === 'pan') {
    const ph = S.info.L.photo, { w, h } = dimsOf(baseOf(S.doc, S.M));
    const { cw, ch } = cropSize(w, h, ph.w / ph.h, S.doc.crop.zoom);
    S.doc.crop = clampCrop({ ...S.doc.crop, cx: drag.crop0.cx - (p.x - drag.p0.x) / ph.w * cw, cy: drag.crop0.cy - (p.y - drag.p0.y) / ph.h * ch }, cw, ch);
    drag.moved = true;
  } else if (drag.kind === 'focus') setFocus(p);
  S.lastInput = performance.now();
  scheduleRender();
});
const endDrag = () => {
  S.dragging = false;
  if (!drag) return;
  const d = drag; drag = null; ov.style.cursor = '';
  if (d.kind === 'erase') return;
  if (d.kind === 'brush') d.lc.mask.data = S.M.brush.get(d.lc.id).toDataURL('image/png');
  S.lastInput = 0;
  if (!d.moved) { scheduleRender(); return; }
  commit({ move: '移动图层', scale: '缩放图层', rotate: '旋转图层', pan: '平移构图', focus: '设置焦点', brush: '画笔蒙版', radial: '径向蒙版', linear: '渐变蒙版' }[d.kind]);
  if (['move', 'scale', 'rotate'].includes(d.kind) && (S.tool === 'text' || S.tool === 'layout')) buildPanel();
};
ov.addEventListener('pointerup', endDrag);
ov.addEventListener('pointercancel', endDrag);
ov.addEventListener('pointerleave', () => { hover = null; if (!drag) drawOverlay(); });
ov.addEventListener('dblclick', (e) => { const b = hit(evPt(e)); if (b && ['text', 'flow'].includes(layerById(b.id).type)) { S.selected = b.id; setTool('text'); setTimeout(() => $('#insText')?.focus(), 40); } });
let wheelT = null;
$('#stage').addEventListener('wheel', (e) => {
  if (!S.info || S.view !== 'editor' || S.doc.kind === 'collage' || S.anim) return;
  e.preventDefault();
  if (brushActive()) { S.brush.size = Math.max(0.01, Math.min(0.4, S.brush.size * Math.exp(-e.deltaY * 0.002))); drawOverlay(); bus.syncBrush?.(); return; }
  const ph = S.info.L.photo, { w, h } = dimsOf(baseOf(S.doc, S.M));
  const z = Math.min(4, Math.max(1, (S.doc.crop.zoom || 1) * Math.exp(-e.deltaY * 0.0015)));
  const { cw, ch } = cropSize(w, h, ph.w / ph.h, z);
  S.doc.crop = clampCrop({ ...S.doc.crop, cx: S.info.crop.cx, cy: S.info.crop.cy, zoom: z }, cw, ch);
  S.lastInput = performance.now(); scheduleRender();
  clearTimeout(wheelT); wheelT = setTimeout(() => { S.lastInput = 0; commit('缩放构图'); }, 350);
}, { passive: false });
function setFocus(p) { const s = toSource(p); S.doc.optics.focusX = s.x; S.doc.optics.focusY = s.y; scheduleRender(); }

// compare / inspector toggle
const cmp = $('#compareBtn');
const setCompare = (v) => { if (S.compare === v) return; S.compare = v; cmp.classList.toggle('on', v); updateHud(); scheduleRender(); };
cmp.addEventListener('pointerdown', () => setCompare(true));
['pointerup', 'pointerleave'].forEach(ev => cmp.addEventListener(ev, () => setCompare(false)));
$('#inspBtn').onclick = () => {
  const m = $('#edMain');
  if (innerWidth <= 1180) m.classList.toggle('show-insp'); else m.classList.toggle('no-insp');
  $('#inspBtn').classList.toggle('on', innerWidth <= 1180 ? m.classList.contains('show-insp') : !m.classList.contains('no-insp'));
  setTimeout(scheduleRender, 320);
};

addEventListener('keydown', (e) => {
  if (S.view !== 'editor' || !S.doc) return;
  const ae = document.activeElement, typing = /INPUT|TEXTAREA|SELECT/.test(ae?.tagName) && ae.type !== 'range';
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? restore(S.hi + 1) : restore(S.hi - 1); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); persist(true); return; }
  if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); openExportModal(); return; }
  if (typing || mod) return;
  if (e.code === 'Space' && !e.repeat) { e.preventDefault(); setCompare(true); }
  if (/^[1-9]$/.test(e.key)) { const t = TOOLS[+e.key - 1]; if (t && !t.disabled?.()) setTool(t.id); }
  if (e.key === 'r' || e.key === 'R') $('#rollAll').click();
  if (e.key === '[') { S.brush.size = Math.max(0.01, S.brush.size * 0.85); drawOverlay(); bus.syncBrush?.(); }
  if (e.key === ']') { S.brush.size = Math.min(0.4, S.brush.size * 1.18); drawOverlay(); bus.syncBrush?.(); }
  if (e.key === 'Escape') { S.selected = null; S.focusPick = false; buildPanel(); drawOverlay(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.selected) removeLayer(S.selected);
  if (S.selected && e.key.startsWith('Arrow')) {
    const ly = layerById(S.selected), st = e.shiftKey ? 0.01 : 0.002;
    if (e.key === 'ArrowLeft') ly.x -= st; if (e.key === 'ArrowRight') ly.x += st; if (e.key === 'ArrowUp') ly.y -= st; if (e.key === 'ArrowDown') ly.y += st;
    e.preventDefault(); scheduleRender(); clearTimeout(wheelT); wheelT = setTimeout(() => commit('微调位置'), 500);
  }
});
addEventListener('keyup', (e) => { if (e.code === 'Space') setCompare(false); });

// ---------------- layers / tools ----------------
const layerById = (id) => S.doc.layers.find(l => l.id === id);
function removeLayer(id) { S.doc.layers = S.doc.layers.filter(l => l.id !== id); if (S.selected === id) S.selected = null; commit('删除图层'); buildPanel(); }
bus.layerById = layerById; bus.removeLayer = removeLayer;

function setTool(t) {
  if (S.tool !== t) { S.focusPick = false; if (t !== 'local') S.eraseMask = null; }
  S.tool = t; stopAnim();
  renderRail(); buildPanel(); drawOverlay();
}
function renderRail() {
  const r = $('#tools');
  r.innerHTML = TOOLS.map((t, i) => `${t.div ? '<span class="div"></span>' : ''}<button data-tool="${t.id}" class="${S.tool === t.id ? 'active' : ''}" ${S.doc && t.disabled?.() ? 'disabled style="opacity:.28;pointer-events:none"' : ''} title="${t.name} · 快捷键 ${i + 1}">${t.icon}<span>${t.name}</span><span class="k">${i + 1}</span></button>`).join('');
  $$('button', r).forEach(b => b.onclick = () => setTool(b.dataset.tool));
}

// thumbnails: rendered lazily in idle frames so panels open instantly
const thumbQ = []; let thumbBusy = false;
function pumpThumbs() {
  if (thumbBusy) return; thumbBusy = true;
  const step = () => {
    const t0 = performance.now();
    while (thumbQ.length && performance.now() - t0 < 14) {
      const j = thumbQ.shift(); if (!j.c.isConnected || !S.M) continue;
      try { const d = j.fn(); if (d) render(j.c, d, S.M, j.w, { fast: true }); } catch (e) { console.warn(e); }
      j.c.classList.remove('pending');
    }
    if (thumbQ.length) requestAnimationFrame(step); else thumbBusy = false;
  };
  requestAnimationFrame(step);
}
function thumbSlot(fn, w) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 5; c.className = 'pending'; c.dataset.thumb = '1';
  c._draw = () => { thumbQ.push({ c, fn, w }); pumpThumbs(); };
  c._draw();
  return c;
}
let thumbT = null;
function refreshThumbs() { clearTimeout(thumbT); thumbT = setTimeout(() => { $$('#panel [data-thumb]').forEach(c => c._draw?.()); renderRecs(); }, 160); }

// ---------------- ratio, locks, roll ----------------
function buildRatioChips() {
  const box = $('#ratioChips'); if (!S.doc) return;
  box.innerHTML = RATIOS.map(r => `<button class="${S.doc.ratio === r.id ? 'on' : ''}" data-r="${r.id}">${r.label}</button>`).join('');
  $$('button', box).forEach(b => b.onclick = () => bus.setRatio(b.dataset.r));
}
const LOCK_SVG = (on) => on ? '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>' : '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>';
const LOCKS = [['crop', '构图'], ['frame', '画布'], ['caption', '文案'], ['font', '字体'], ['film', '调色']];
function buildLocks() {
  const box = $('#locks');
  box.innerHTML = LOCKS.map(([k, n]) => `<button class="lock ${S.locks[k] ? 'on' : ''}" data-l="${k}" title="锁定后 Roll 不会改变${n}">${LOCK_SVG(S.locks[k])}${n}</button>`).join('');
  $$('[data-l]', box).forEach(b => b.onclick = () => { S.locks[b.dataset.l] = !S.locks[b.dataset.l]; buildLocks(); });
}
$('#rollAll').onclick = () => { if (!S.doc) return; const b = $('#rollAll'); b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin'); bus.rollAll(); };

// ---------------- insights ----------------
function renderInsights() {
  const box = $('#insights'); if (!S.M?.an) { box.innerHTML = ''; return; }
  const an = S.M.an, s = an.subject, ex = S.M.exif;
  const objs = {}; (an.objects || []).filter(o => o.score > 0.4).forEach(o => { const k = labelCN(o.label); objs[k] = (objs[k] || 0) + 1; });
  const objTxt = Object.entries(objs).slice(0, 4).map(([k, v]) => v > 1 ? `${k}×${v}` : k).join(' · ') || '—';
  const pos = `${s.cx < 0.4 ? '左' : s.cx > 0.6 ? '右' : '中'} · ${s.cy < 0.4 ? '上' : s.cy > 0.6 ? '下' : '中'}`;
  const dep = (ok, name) => `<span class="tag ${ok ? 'ok' : 'gray'}">${ok ? '✓' : '○'} ${name}</span>`;
  const { w: bw, h: bh } = dimsOf(baseOf(S.doc, S.M));
  box.innerHTML = `
    <div class="ins-h">Histogram <span id="clipInfo"></span></div>
    <canvas class="histo" id="histo" width="512" height="168"></canvas>
    ${ex ? `<div class="exif"><div><small>SHUTTER</small>${ex.shutter || '—'}</div><div><small>APERTURE</small>${ex.aperture || '—'}</div><div><small>ISO</small>${(ex.iso || '—').replace('ISO ', '')}</div><div><small>FOCAL</small>${ex.focal ? ex.focal.split(' ')[0] : '—'}</div></div>
      <div class="exif-cam" title="${esc(ex.camera)} ${esc(ex.lens || '')}">${esc(ex.camera || '')}${ex.lens ? ' · ' + esc(ex.lens) : ''}${ex.gps ? ' · <span style="color:var(--amber)">含 GPS</span>' : ''}</div>` : `<div class="exif-cam">无 EXIF 拍摄信息 · ${bw}×${bh}px</div>`}
    <div class="ins-h">AI 分析 <span class="tag ${an.engine === 'detector' ? 'ok' : 'gray'}">${an.engine === 'detector' ? '端侧模型' : '启发式'}</span></div>
    <div class="an-row"><span>识别对象</span><b>${objTxt}</b></div>
    <div class="an-row"><span>场景</span><b>${an.sceneLabel} <small class="muted mono">${Math.round(an.sceneConf * 100)}%</small></b></div>
    <div class="an-row"><span>情绪</span><b>${an.mood.join(' · ')}</b></div>
    <div class="an-row"><span>主体</span><b>${pos} · ${Math.round((s.x1 - s.x0) * (s.y1 - s.y0) * 100)}%</b></div>
    <div class="an-row"><span>建议画幅</span><b><button class="btn xs" id="useSug">${an.suggestedRatio}</button></b></div>
    <ul class="an-issues">${an.issues.map(i => `<li>${i}</li>`).join('')}</ul>
    <div class="row" style="gap:4px;margin:6px 0 2px">${dep(!!S.M.seg, '主体分割')}${dep(!!S.M.depth, '深度图')}${dep(!!S.M.plate, '背景补全')}</div>
    <div class="ins-h">色板 <span class="muted" style="letter-spacing:0;text-transform:none;font-family:var(--ui)">点击设为画布色</span></div>
    <div class="palette">${an.palette.map(c => `<button style="background:${c}" data-pc="${c}" title="${c}"></button>`).join('')}</div>
    <div class="ins-h">一键方案</div><div class="rec" id="recs"></div>`;
  $('#useSug', box).onclick = () => bus.setRatio(an.suggestedRatio);
  $$('[data-pc]', box).forEach(b => b.onclick = () => { S.doc.frame.color = b.dataset.pc; if (S.doc.frame.mode === 'none' && S.doc.kind !== 'collage') { S.doc.frame.mode = 'solid'; S.doc.frame.pad = 0.06; } commit('色板 → 画布', { major: true }); bus.recomputeCrops(); if (S.tool === 'canvas') buildPanel(); });
  renderRecs(); drawHistogram();
}
function renderRecs() {
  const r = $('#recs'); if (!r || !S.doc) return;
  if (S.doc.kind === 'collage') { r.innerHTML = '<p class="hint" style="grid-column:1/-1">拼贴项目可在「版式」中切换布局。</p>'; return; }
  r.innerHTML = '';
  for (const [id, n] of [['polaroid', '拍立得'], ['magazine', '杂志'], ['filmstrip', '胶片']]) {
    const b = el(`<button class="rec-card"><b>${n}</b></button>`);
    b.prepend(thumbSlot(() => applyTemplate(id, S.doc, S.M.an, baseOf(S.doc, S.M), { seed: S.seeds.layout, caption: bus.currentCaption?.() }), 150));
    b.onclick = () => bus.useTemplate(id);
    r.append(b);
  }
}
function drawHistogram() {
  const c = $('#histo'), v = $('#view'); if (!c || !v.width || v.width < 8) return;
  const s = mk(160, Math.max(1, Math.round(160 * v.height / v.width))), sx = s.getContext('2d', { willReadFrequently: true });
  sx.drawImage(v, 0, 0, s.width, s.height);
  const d = sx.getImageData(0, 0, s.width, s.height).data, R = new Float32Array(64), G = new Float32Array(64), B = new Float32Array(64), Lh = new Float32Array(64);
  let lo = 0, hi = 0;
  for (let i = 0; i < d.length; i += 4) { R[d[i] >> 2]++; G[d[i + 1] >> 2]++; B[d[i + 2] >> 2]++; const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0; Lh[l >> 2]++; if (l < 3) lo++; if (l > 252) hi++; }
  let mx = 1; for (const a of [R, G, B, Lh]) for (const v2 of a) if (v2 > mx) mx = v2;
  const x = c.getContext('2d'), W = c.width, H = c.height;
  x.clearRect(0, 0, W, H);
  x.strokeStyle = 'rgba(255,255,255,.05)'; for (let i = 1; i < 4; i++) line(x, W * i / 4, 0, W * i / 4, H);
  const plot = (arr, col) => { x.beginPath(); x.moveTo(0, H); arr.forEach((v2, i) => x.lineTo(i / 63 * W, H - Math.sqrt(v2 / mx) * (H - 6))); x.lineTo(W, H); x.closePath(); x.fillStyle = col; x.fill(); };
  x.globalCompositeOperation = 'screen';
  plot(R, 'rgba(255,70,60,.55)'); plot(G, 'rgba(60,220,120,.5)'); plot(B, 'rgba(70,130,255,.55)');
  x.globalCompositeOperation = 'source-over'; plot(Lh, 'rgba(236,235,232,.14)');
  const n = d.length / 4, ci = $('#clipInfo');
  if (ci) ci.innerHTML = `${lo / n > 0.01 ? '<span style="color:var(--info)">▼ 暗部溢出</span> ' : ''}${hi / n > 0.01 ? '<span style="color:var(--safe)">▲ 高光溢出</span>' : ''}`;
}
bus.renderInsights = renderInsights;

// ---------------- 2.5D animation preview ----------------
function stopAnim() {
  if (!S.anim) return;
  cancelAnimationFrame(S.anim.raf); S.doc.cam = S.anim.base; S.anim = null;
  scheduleRender(); bus.onAnimChange?.();
}
function playAnim() {
  if (S.anim) return stopAnim();
  const base = clone(S.doc.cam), t0 = performance.now(), v = $('#view');
  const w = Math.min(900, Math.round(parseFloat(v.style.width) * Math.min(1.5, devicePixelRatio || 1)));
  const tick = () => {
    const t = ((performance.now() - t0) / 3600) % 1, a = Math.PI * 2 * t, amp = base.amp ?? 0.8;
    const doc = { ...S.doc, cam: { ...base, on: true, x: amp * Math.sin(a), y: amp * 0.4 * Math.cos(a), zoom: (base.zoom || 0) + 0.25 * Math.sin(a * 0.5) } };
    render(v, doc, S.M, w, { fast: true, transient: true });
    S.anim.raf = requestAnimationFrame(tick);
  };
  S.anim = { raf: requestAnimationFrame(tick), base };
  drawOverlay(); bus.onAnimChange?.();
}
bus.playAnim = playAnim; bus.stopAnim = stopAnim;

// ---------------- base image replacement (AI expand / erase) ----------------
async function setBase(canvas, label) {
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
  const id = uid('B');
  S.project.assets = { ...S.project.assets, [id]: blob };
  S.M.assets.set(id, await blobToImage(blob));
  S.doc.base = id;
  await syncBase(S.doc, S.M);
  S.doc.locals = (S.doc.locals || []).filter(l => l.mask.kind !== 'brush');
  commit(label, { major: true });
  bus.recomputeCrops(); renderInsights(); buildPanel();
  ensureSeg(S.doc, S.M).then(() => { scheduleRender(); renderInsights(); });
}
bus.setBase = setBase;

Object.assign(bus, { commit, restore, scheduleRender, setTool, buildRatioChips, buildLocks, thumbSlot, refreshThumbs, persist, go, renderRail, toSource, queueSave });

// ---------------- file input / drag & drop ----------------
const fileInput = $('#fileInput');
fileInput.onchange = () => { importFiles(fileInput.files); fileInput.value = ''; };
let dragN = 0;
addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { dragN++; $('#dropveil').classList.add('show'); } });
addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('#dropveil').classList.remove('show'); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); dragN = 0; $('#dropveil').classList.remove('show'); if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });
$('#exportBtn').onclick = () => openExportModal();

// Physical film shelf. Presets replace the whole color recipe, never accumulate.
function renderRolls() {
  const dock=$('#rollDock'); if(!S.doc) return;
  const colors=['#ddd2b8','#d4a638','#9bac8a','#c8aa91','#d78053','#829ea4','#c1beb3','#90a8b1','#b7825c','#a58aa3'];
  dock.innerHTML=FILMS.map((f,i)=>`<button class="film-roll ${S.doc.film.preset===f.id?'loaded':''}" data-stock="${f.id}" aria-pressed="${S.doc.film.preset===f.id}" style="--stock:${colors[i%colors.length]}" title="装载 ${f.name}"><span class="spool"></span><span class="canister"><small>${f.sub}</small><b>${f.name}</b><em>${f.id==='none'?'ORIGINAL':'35 mm / 36 EXP'}</em></span></button>`).join('');
  $$('[data-stock]',dock).forEach(b=>b.onclick=()=>bus.loadFilm(b.dataset.stock));
}
bus.loadFilm=(id)=>{
  if(!S.doc)return;stopLive();
  S.doc.film={...newDoc(S.project.id).film,preset:id,date:id==='disposable'};
  commit('装载胶卷 · '+FILMS.find(f=>f.id===id).name,{major:true}); buildPanel();
  $('#stage').classList.remove('developing');void $('#stage').offsetWidth;$('#stage').classList.add('developing');
  toast(id==='none'?'已卸下胶卷，恢复原始色彩':'胶卷已装载 · '+FILMS.find(f=>f.id===id).name);
};
bus.resetOriginal=async()=>{
  if(!S.doc)return;stopLive();stopAnim();
  S.doc=newDoc(S.project.id);S.selected=null;S.selLocal=null;S.compare=false;S.viewDepth=false;
  await syncBase(S.doc,S.M);clearRenderCache();
  await mountLive();commit('还原原始底片',{major:true});buildPanel();bus.recomputeCrops();buildRatioChips();renderInsights();toast('已还原拍摄底片 · 可撤销');
};
$('#resetOriginal').onclick=()=>bus.resetOriginal();
$('#liveBtn').onclick=()=>openLiveImport();
$('#darkenBtn').onclick=()=>{
 const on=$('#editor').classList.toggle('lights-out');$('#darkenBtn').textContent=on?'开灯':'熄灯';$('#darkenBtn').setAttribute('aria-pressed',on);S.showGrid=!on;bus.drawOverlay();requestAnimationFrame(()=>scheduleRender(true));
};
addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#editor').classList.contains('lights-out'))$('#darkenBtn').click();});

// ---------------- boot ----------------
async function loadFonts() {
  const { FONT_PACKS, fontString } = await import('./presets.js');
  await Promise.allSettled([...Object.keys(FONT_PACKS).map(id => document.fonts.load(fontString(id, 24), 'Aa永和夜の')),
    document.fonts.load(fontString('serif', 24, { weight: 900 }), 'MUSE'), document.fonts.load(fontString('serif', 24, { italic: true, weight: 400 }), 'Aa城市')]);
}
let fontT = null;
document.fonts.addEventListener?.('loadingdone', () => { clearTimeout(fontT); fontT = setTimeout(() => { clearRenderCache(); if (S.M) { scheduleRender(); refreshThumbs(); } bus.redrawDiscover?.(); }, 600); });

renderRail(); buildLocks(); moveIndicator();
// fonts first so the first discover paint is final; heavy model init waits until the intro has settled
Promise.race([loadFonts(), new Promise(r => setTimeout(r, 1800))]).then(initDiscover);
setTimeout(() => (window.requestIdleCallback || setTimeout)(() => loadDetector()), 3000);
renderStrip();
window.__darkroom = { S, bus, openSample: (i = 0, t, tool) => openSample(SAMPLES[i], t, tool), go, setTool };
