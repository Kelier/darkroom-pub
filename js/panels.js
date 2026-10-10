// Tool panels: auto · crop/perspective · color · local masks/erase · optics · 2.5D space · canvas/expand · text · layout/collage.

import { RATIOS, FONT_PACKS, FILMS, FILM_PARAMS, CANVAS_COLORS, TEXTURES, CAPTION_STYLES, STICKERS, TEMPLATES, fontString } from './presets.js';
import { composeCandidates, cropSize, clampCrop, mulberry32, lumAt, autoTone, estimateLevel } from './analyze.js';
import { photoAspect, cropRect, baseOf, dimsOf, drawLayer, clearRenderCache } from './render.js';
import { mk } from './color.js';
import { newDoc, applyTemplate, pickCaptions, annotate, subjectInCanvas, bestCrop, newId, FONT_ROLL, randomFilm, COLLAGE_LAYOUTS, applyCollage } from './templates.js';
import { generateCaptions, trendList } from './captions.js';
import { mountCurveEditor, curvesActive } from './curves.js';
import { FLOW_MODES } from './flow.js';
import { ensureSeg, ensureDepth, ensurePlate, brushCanvas, registerPhotos, dilate } from './media.js';
import { inpaint, isLoaded } from './ml/index.js';
import { prefs, setPrefs } from './store.js';
import { S, bus, $, $$, el, esc, clone, toast, task, slider, tog, bindSlider, bindToggle, section } from './state.js';
import { pickTrayPhotos, exportVideo } from './batch.js';

const I = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
const isCollage = () => S.doc?.kind === 'collage';
export const TOOLS = [
  { id: 'auto', name: '推荐', icon: I('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>') },
  { id: 'crop', name: '构图', icon: I('<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>'), disabled: isCollage },
  { id: 'color', name: '调色', icon: I('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" opacity=".35"/>') },
  { id: 'local', name: '局部', icon: I('<path d="M9.5 14.5 4 20"/><path d="M14 4l6 6-7.5 7.5a3 3 0 0 1-4.2 0l-1.8-1.8a3 3 0 0 1 0-4.2z"/>'), disabled: isCollage },
  { id: 'optics', name: '光学', icon: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v5M21 12h-5M12 21v-5M3 12h5"/>'), disabled: isCollage },
  { id: 'space', name: '空间', icon: I('<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>'), disabled: isCollage },
  { id: 'canvas', name: '画布', icon: I('<rect x="3" y="3" width="18" height="18" rx="1"/><rect x="7" y="7" width="10" height="10"/>'), div: true },
  { id: 'text', name: '文字', icon: I('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>') },
  { id: 'layout', name: '版式', icon: I('<rect x="3" y="3" width="8" height="10"/><rect x="13" y="3" width="8" height="6"/><rect x="13" y="11" width="8" height="10"/><rect x="3" y="15" width="8" height="6"/>') },
];

const base = () => baseOf(S.doc, S.M);
const an = () => S.M.an;
const commit = (l, o) => bus.commit(l, o);
const render = () => bus.scheduleRender();
const head = (title, code, sub) => `<div class="p-head"><h3>${title}</h3><span class="mono">${code}</span></div>${sub ? `<p class="sub">${sub}</p>` : ''}`;
export let panelOnRender = null;

export function buildPanel() {
  const p = $('#panel');
  if (!S.doc) { p.innerHTML = ''; return; }
  const st = p.scrollTop, same = p.dataset.tool === S.tool;
  const open = new Set($$('details.sec[data-sec]', p).filter(d => !d.open).map(d => d.dataset.sec));
  p.innerHTML = ''; panelOnRender = null; bus.syncBrush = null; bus.onAnimChange = null;
  const wrap = el(`<div class="${same ? '' : 'panel-in'}"></div>`);
  const tool = TOOLS.find(t => t.id === S.tool);
  if (tool?.disabled?.()) { S.tool = 'layout'; bus.renderRail(); }
  const sel = S.selected && bus.layerById(S.selected);
  if (sel && (S.tool === 'text' || S.tool === 'layout')) wrap.append(inspector(sel));
  P[S.tool](wrap);
  p.append(wrap); p.dataset.tool = S.tool;
  if (same) { $$('details.sec[data-sec]', p).forEach(d => { if (open.has(d.dataset.sec)) d.open = false; }); p.scrollTop = st; } else p.scrollTop = 0;
}
bus.buildPanel = buildPanel;

const P = {};

// ======================= 推荐 =======================
const LOOK_BY_SCENE = { night: ['cinema', 0.6], city: ['cinema', 0.5], nature: ['warm-neg', 0.6], portrait: ['instant', 0.55], daily: ['warm-neg', 0.5] };
function autoDevelop() {
  const a = an();
  S.doc.film = { ...S.doc.film, preset: LOOK_BY_SCENE[a.scene][0], intensity: LOOK_BY_SCENE[a.scene][1], adjust: autoTone(a) };
  if (S.doc.ratio === 'orig') S.doc.ratio = a.suggestedRatio;
  S.doc.crop = bestCrop(S.doc, base(), a, 1);
}
P.auto = (p) => {
  if (isCollage()) { P.layout(p); return; }
  const a = an();
  p.append(el(`<div>${head('智能推荐', 'AUTO', `识别为「${a.sceneLabel} · ${a.mood.join(' / ')}」。先一键成片，再对任何一个维度单独 Roll。`)}</div>`));
  const q = el(`<div class="grid2" style="margin-bottom:12px">
    <button class="btn safe" id="oneTap">${I('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>')}一键成片</button>
    <button class="btn" id="autoTone">AUTO 调色</button></div>`);
  $('#oneTap', q).onclick = () => { autoDevelop(); commit('一键成片', { major: true }); bus.recomputeCrops(); bus.buildRatioChips(); buildPanel(); toast('已自动构图 + 调色'); };
  $('#autoTone', q).onclick = () => { S.doc.film.adjust = autoTone(a); commit('AUTO 调色', { major: true }); toast('已按直方图自动校正曝光、对比与偏色'); };
  p.append(q);
  const grid = el(`<div class="cards"></div>`);
  for (const t of TEMPLATES) {
    const b = el(`<button class="card ${S.doc.template === t.id ? 'on' : ''}"><div class="cv"></div><b>${t.name} ${t.tag ? `<span class="tag">${t.tag}</span>` : ''}</b><small>${t.desc}</small></button>`);
    $('.cv', b).append(bus.thumbSlot(() => applyTemplate(t.id, S.doc, a, base(), { seed: S.seeds.layout, caption: currentCaption(), style: S.captionStyle }), 200));
    b.onclick = () => useTemplate(t.id);
    grid.append(b);
  }
  p.append(el(`<div class="mini-h">版式方案</div>`)); p.append(grid);
  const r = el(`<div class="row" style="margin-top:12px"><button class="btn" id="rollTpl">${I('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>')}换一批</button><button class="btn" id="resetDoc">回到原片</button></div>`);
  $('#rollTpl', r).onclick = rollLayout;
  $('#resetDoc', r).onclick = () => bus.resetOriginal();
  p.append(r);
};

function currentCaption() { return S.doc?.layers.find(l => l.role === 'caption' && l.type === 'text')?.text?.replace(/\n/g, '') || null; }
bus.currentCaption = currentCaption;

function useTemplate(id) {
  let d = applyTemplate(id, S.doc, an(), base(), { seed: S.seeds.layout, caption: currentCaption(), style: S.captionStyle, keepFilm: S.locks.film });
  if (S.locks.crop) d.crop = S.doc.crop;
  S.doc = d; S.selected = null;
  commit(`版式 · ${TEMPLATES.find(t => t.id === id).name}`, { major: true });
  recomputeCrops(); buildPanel(); bus.buildRatioChips();
}
bus.useTemplate = useTemplate;

// ======================= 构图 + 透视 =======================
function recomputeCrops() {
  if (!S.doc || isCollage()) return;
  const asp = photoAspect(S.doc, base()), { w, h } = dimsOf(base());
  let c = composeCandidates(an(), asp, S.seeds.crop, 6);
  if (S.subjectLock) c = c.map(x => { const { cw, ch } = cropSize(w, h, asp, S.doc.crop.zoom); return { ...x, crop: clampCrop({ ...x.crop, zoom: S.doc.crop.zoom }, cw, ch) }; });
  S.cropCands = c;
}
bus.recomputeCrops = recomputeCrops;

const GUIDES = [['thirds', '三分'], ['golden', '黄金'], ['diagonal', '对角'], ['grid', '网格'], ['none', '关']];
const ROLL_ICON = I('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>');

P.crop = (p) => {
  const b0 = base(), asp = photoAspect(S.doc, b0), { w: bw, h: bh } = dimsOf(b0);
  p.append(el(`<div>${head('构图', 'CROP', '悬停预览，点击应用。拖动画面平移，滚轮缩放。')}</div>`));

  // ---- AI suggestions: compact 3×2 contact sheet with live hover preview ----
  const cur = S.cropCands.findIndex(c => Math.abs(c.crop.cx - S.doc.crop.cx) < 0.004 && Math.abs(c.crop.cy - S.doc.crop.cy) < 0.004 && Math.abs(c.crop.zoom - S.doc.crop.zoom) < 0.01);
  const sug = el(`<div class="comp">
    <div class="comp-h"><span>AI 构图建议</span><button class="icon-btn sm" id="rollCrop" title="Roll 一组新方案">${ROLL_ICON}</button></div>
    <div class="comp-grid" style="--a:${asp}">${S.cropCands.map((c, i) => `<button class="comp-cell ${i === cur ? 'on' : ''}" data-ci="${i}"><span class="comp-th"></span><i class="comp-l">${String.fromCharCode(65 + i)}</i></button>`).join('')}</div>
    <div class="comp-info" id="compInfo"></div></div>`);
  const info = $('#compInfo', sug);
  const showInfo = (i, hover) => {
    const c = S.cropCands[i];
    info.innerHTML = c ? `<b>${String.fromCharCode(65 + i)}</b><span>${c.label}</span><span class="meter"><i style="width:${c.rating}%"></i></span><em>${c.rating}</em>${hover ? '<small>点击应用</small>' : ''}`
      : `<span class="muted">当前为手动构图 · 悬停任一方案预览</span>`;
  };
  showInfo(cur, false);
  let saved = null;
  $$('.comp-cell', sug).forEach((btn) => {
    const i = +btn.dataset.ci, c = S.cropCands[i];
    $('.comp-th', btn).append(bus.thumbSlot(() => ({ ...S.doc, crop: c.crop, layers: [], frame: { ...S.doc.frame, mode: 'none' }, ratio: 'orig' === S.doc.ratio ? 'orig' : S.doc.ratio }), 150));
    btn.onpointerenter = () => { if (!saved) saved = { ...S.doc.crop }; S.doc.crop = { ...c.crop }; S.lastInput = performance.now(); render(); showInfo(i, true); };
    btn.onpointerleave = () => { if (saved) { S.doc.crop = saved; saved = null; S.lastInput = performance.now(); render(); } showInfo(cur, false); };
    btn.onclick = () => { saved = null; S.doc.crop = { ...c.crop }; commit(`构图 · ${c.label}`, { major: true }); buildPanel(); };
  });
  $('#rollCrop', sug).onclick = (e) => { e.currentTarget.classList.add('spin'); rollCrop(); commit('Roll 构图', { major: true }); buildPanel(); };
  p.append(sug);

  // ---- aspect: proportional shape tiles + orientation flip ----
  const sugId = an().suggestedRatio, tiles = RATIOS.map(r => {
    const a = r.value || bw / bh, k = 22 / Math.max(a, 1 / a), w = Math.round(a >= 1 ? 22 : 22 * a), h = Math.round(a >= 1 ? 22 / a : 22);
    void k;
    return `<button class="ar ${S.doc.ratio === r.id ? 'on' : ''}" data-r="${r.id}" title="${r.label}${r.id === sugId ? ' · AI 建议' : ''}"><span class="ar-box"><i style="width:${w}px;height:${h}px"></i></span><span>${r.label}</span>${r.id === sugId ? '<b class="ar-dot"></b>' : ''}</button>`;
  }).join('');
  const FLIP = { '3:4': '4:3', '4:5': '5:4', '2:3': '3:2', '3:2': '2:3', '9:16': '16:9', '16:9': '9:16' };
  const rat = el(`<div>${section('画幅', `<div class="ar-grid">${tiles}</div>
    <div class="row" style="margin-top:8px"><button class="btn sm" id="flipAr" ${FLIP[S.doc.ratio] && RATIOS.some(r => r.id === FLIP[S.doc.ratio]) ? '' : 'disabled'}>${I('<path d="M7 7h10l-3-3M17 17H7l3 3"/>')}横竖互换</button><button class="btn sm" id="cropBest">${I('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>')}自动最佳</button></div>`, { id: 'ratio' })}</div>`);
  $$('[data-r]', rat).forEach(b => b.onclick = () => setRatio(b.dataset.r));
  $('#flipAr', rat).onclick = () => { const f = FLIP[S.doc.ratio]; if (f) setRatio(f); };
  $('#cropBest', rat).onclick = () => { S.doc.crop = bestCrop(S.doc, b0, an(), 1); commit('自动最佳构图', { major: true }); buildPanel(); };
  p.append(rat);

  // ---- straighten ruler + keystone ----
  const g = S.doc.geo;
  const geo = el(`<div>${section('拉直与透视', `
    <div class="ruler" id="ruler" title="左右拖动拉直 · 双击归零"><div class="ruler-ticks" id="rTicks"></div><span class="ruler-mark"></span><output id="rVal">${(g.rotate || 0).toFixed(1)}°</output></div>
    ${slider('vert', I('<path d="M8 4 5 20M16 4l3 16"/>') + '垂直', -1, 1, 0.01, g.vert || 0, v => Math.round(v * 100))}
    ${slider('horiz', I('<path d="M4 8l16-3M4 16l16 3"/>') + '水平', -1, 1, 0.01, g.horiz || 0, v => Math.round(v * 100))}
    <div class="row" style="margin-top:8px"><button class="btn sm" id="autoLevel">${I('<path d="M3 12h18"/><path d="M12 3v18" opacity=".4"/>')}自动拉直</button><button class="btn sm" id="geoReset">复位</button></div>`, { id: 'geo', tag: 'WebGL' })}</div>`);
  const ticks = $('#rTicks', geo), rv = $('#rVal', geo), PX = 6;   // px per 0.5°
  const paintRuler = () => { ticks.style.transform = `translateX(${-(S.doc.geo.rotate || 0) * 2 * PX}px)`; rv.textContent = (S.doc.geo.rotate || 0).toFixed(1) + '°'; rv.classList.toggle('on', Math.abs(S.doc.geo.rotate || 0) > 0.05); };
  paintRuler();
  const ruler = $('#ruler', geo);
  ruler.onpointerdown = (e) => {
    ruler.setPointerCapture(e.pointerId); ruler.classList.add('drag');
    const x0 = e.clientX, r0 = S.doc.geo.rotate || 0;
    ruler.onpointermove = (ev) => { let r = Math.max(-15, Math.min(15, r0 - (ev.clientX - x0) / (2 * PX))); if (Math.abs(r) < 0.25) r = 0; S.doc.geo = { ...S.doc.geo, rotate: Math.round(r * 10) / 10 }; S.geoTouch = performance.now(); paintRuler(); bus.updateHud(); S.lastInput = performance.now(); render(); };
    ruler.onpointerup = () => { ruler.onpointermove = null; ruler.classList.remove('drag'); S.lastInput = 0; commit('拉直'); };
  };
  ruler.ondblclick = () => { S.doc.geo = { ...S.doc.geo, rotate: 0 }; paintRuler(); commit('拉直 · 归零'); };
  ruler.onwheel = (e) => { e.preventDefault(); S.doc.geo = { ...S.doc.geo, rotate: Math.max(-15, Math.min(15, Math.round(((S.doc.geo.rotate || 0) - Math.sign(e.deltaY) * 0.1) * 10) / 10)) }; paintRuler(); S.lastInput = performance.now(); render(); clearTimeout(ruler._t); ruler._t = setTimeout(() => commit('拉直'), 400); };
  for (const k of ['vert', 'horiz']) bindSlider(geo, k, (v) => { S.doc.geo = { ...S.doc.geo, [k]: v }; S.geoTouch = performance.now(); bus.updateHud(); }, '透视校正');
  const fadeGrid = () => setTimeout(() => bus.drawOverlay(), 1600); geo.addEventListener('pointerup', fadeGrid); geo.addEventListener('change', fadeGrid);
  $('#autoLevel', geo).onclick = () => { const r = estimateLevel(b0); S.doc.geo = { ...S.doc.geo, ...r }; commit('自动拉直', { major: true }); buildPanel(); toast(r.rotate || r.vert ? `已校正：旋转 ${r.rotate}° · 垂直 ${Math.round(r.vert * 100)}` : '画面已经是水平的'); };
  $('#geoReset', geo).onclick = () => { S.doc.geo = { rotate: 0, vert: 0, horiz: 0 }; commit('复位透视', { major: true }); buildPanel(); };
  p.append(geo);

  // ---- framing & guides ----
  const fr = el(`<div>${section('取景', `${slider('zoom', '缩放', 1, 4, 0.01, S.doc.crop.zoom || 1, v => (+v).toFixed(2) + '×')}
    <div class="mini-h">辅助线</div><div class="seg guides">${GUIDES.map(([k, n]) => `<button data-g="${k}" class="${S.guide === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    ${tog('subjectLock', '主体锁定', S.subjectLock, 'Roll 时保持主体大小')}
    <button class="btn sm" id="cropReset" style="margin-top:4px">重置裁剪</button>`, { id: 'fine' })}</div>`);
  bindSlider(fr, 'zoom', (v) => { const { cw, ch } = cropSize(bw, bh, asp, v); S.doc.crop = clampCrop({ ...S.doc.crop, zoom: v }, cw, ch); }, '缩放构图');
  $$('[data-g]', fr).forEach(b => b.onclick = () => { S.guide = b.dataset.g; $$('[data-g]', fr).forEach(x => x.classList.toggle('on', x === b)); bus.drawOverlay(); });
  bindToggle(fr, 'subjectLock', (v) => { S.subjectLock = v; recomputeCrops(); buildPanel(); });
  $('#cropReset', fr).onclick = () => { S.doc.crop = { cx: 0.5, cy: 0.5, zoom: 1 }; commit('重置裁剪', { major: true }); buildPanel(); };
  p.append(fr);
};

function rollCrop() {
  S.seeds.crop++; recomputeCrops();
  const pick = S.cropCands[(S.seeds.crop - 1) % Math.max(1, S.cropCands.length)] || S.cropCands[0];
  if (pick) S.doc.crop = { ...pick.crop };
}

function setRatio(id) {
  if (isCollage()) { S.doc.ratio = id; commit('画幅', { major: true }); bus.buildRatioChips(); return; }
  const b = base(), oldAsp = photoAspect(S.doc, b), oc = cropRect(S.doc, b, oldAsp), s = an().subject;
  const px = (s.cx - (oc.cx - oc.cw / 2)) / oc.cw, py = (s.cy - (oc.cy - oc.ch / 2)) / oc.ch;
  const subjFrac = (s.y1 - s.y0) / oc.ch;
  S.doc.ratio = id;
  const asp = photoAspect(S.doc, b), { w, h } = dimsOf(b), b1 = cropSize(w, h, asp, 1);
  const zoom = Math.max(1, Math.min(4, b1.ch * subjFrac / Math.max(0.01, s.y1 - s.y0)));
  const { cw, ch } = cropSize(w, h, asp, zoom);
  S.doc.crop = clampCrop({ cx: s.cx - (px - 0.5) * cw, cy: s.cy - (py - 0.5) * ch, zoom }, cw, ch);
  commit(`画幅 · ${RATIOS.find(r => r.id === id).label}`, { major: true });
  recomputeCrops(); bus.buildRatioChips(); buildPanel();
}
bus.setRatio = setRatio;

// ======================= 调色 =======================
// Histogram of the current view (R, G, B, luma) for the curve editor background.
let curveHisto = null;
function histoFromView() {
  const v = $('#view'); if (!v || !v.width || v.width < 8) return null;
  const c = mk(128, Math.max(1, Math.round(128 * v.height / v.width))), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(v, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data, H = [0, 1, 2, 3].map(() => new Float32Array(64));
  for (let i = 0; i < d.length; i += 4) { H[0][d[i] >> 2]++; H[1][d[i + 1] >> 2]++; H[2][d[i + 2] >> 2]++; H[3][((d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0) >> 2]++; }
  return H;
}

P.color = (p) => {
  const fm = S.doc.film;
  p.append(el(`<div>${head('调色', 'COLOR', '胶片风格 + 独立参数。风格为自有命名，不代表任何品牌官方模拟。')}</div>`));
  const top = el(`<div class="grid2" style="margin-bottom:10px"><button class="btn" id="autoTone2">AUTO 自动调色</button><button class="btn roll" id="rollFilm">${I('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>')}Roll 风格</button></div>`);
  $('#autoTone2', top).onclick = () => { S.doc.film.adjust = autoTone(an()); commit('AUTO 调色', { major: true }); buildPanel(); };
  $('#rollFilm', top).onclick = () => { S.doc.film = { ...S.doc.film, preset: randomFilm(mulberry32(++S.seeds.film * 29), S.doc.film.preset), intensity: 1, adjust: {} }; commit('Roll 风格', { major: true }); buildPanel(); };
  p.append(top);
  const g = el(`<div class="films"></div>`);
  for (const f of FILMS) {
    const b = el(`<button class="film ${fm.preset === f.id ? 'on' : ''}"><span>${f.name}</span></button>`);
    b.prepend(bus.thumbSlot(() => isCollage() ? null : ({ ...S.doc, ratio: '1:1', frame: { ...S.doc.frame, mode: 'none' }, layers: [], locals: [], optics: { ...S.doc.optics, aperture: 0, motion: 0 }, film: { ...fm, preset: f.id, intensity: 1, adjust: {}, date: false } }), 120));
    b.onclick = () => bus.loadFilm(f.id);
    g.append(b);
  }
  p.append(g);
  if (isCollage()) $$('canvas', g).forEach(c => { c.classList.remove('pending'); c.style.background = 'linear-gradient(135deg,#333,#111)'; });
  const it = el(`<div style="margin:10px 0">${slider('intensity', '强度', 0, 1.5, 0.01, fm.intensity, v => Math.round(v * 100) + '%')}</div>`);
  bindSlider(it, 'intensity', v => { S.doc.film.intensity = v; }, '风格强度');
  p.append(it);
  const my = prefs().myFilms || [];
  // ---- tone curves ----
  const cs = el(`<div>${section('曲线', '<div id="curveHost"></div>', { id: 'curves', tag: curvesActive(fm.curves) ? '已调整' : '' })}</div>`);
  const ed = mountCurveEditor($('#curveHost', cs), {
    get: () => S.doc.film.curves,
    set: (c) => { S.doc.film = { ...S.doc.film, curves: c }; },
    live: () => { S.lastInput = performance.now(); render(); },
    commit: (label) => { S.lastInput = 0; commit(label); },
    histogram: () => curveHisto,
  });
  panelOnRender = () => { curveHisto = histoFromView(); ed.redraw(); };
  curveHisto = histoFromView();
  ed.redraw();
  p.append(cs);
  const sec = el(`<div>
    ${section('参数微调', `${FILM_PARAMS.map(x => slider('a_' + x.key, x.label, x.min, x.max, 0.01, fm.adjust?.[x.key] || 0, v => (v > 0 ? '+' : '') + Math.round(v * 100))).join('')}<div class="row" style="margin-top:6px"><button class="btn sm" id="adjReset">重置参数</button><button class="btn sm" id="saveStyle">♡ 存为我的风格</button></div><p class="hint">双击任意滑杆复位。</p>`, { id: 'adj' })}
    ${my.length ? section('我的风格', `<div class="chips">${my.map((s, i) => `<button class="chip" data-my="${i}">♥ ${esc(s.name)}</button>`).join('')}</div>`, { id: 'my' }) : ''}
    ${section('相机效果', `${tog('date', '日期戳', fm.date)}<input class="txt mono" id="dateText" value="${esc(fm.dateText || '')}" placeholder="'26 10 09" style="margin:4px 0 8px">
      <button class="btn sm" id="leakSeed">换一种漏光</button>`, { id: 'cam', open: false })}</div>`);
  FILM_PARAMS.forEach(x => bindSlider(sec, 'a_' + x.key, v => { S.doc.film.adjust = { ...S.doc.film.adjust, [x.key]: v }; }, `调整${x.label}`));
  $('#adjReset', sec).onclick = () => { S.doc.film.adjust = {}; commit('重置参数', { major: true }); buildPanel(); };
  $('#saveStyle', sec).onclick = () => {
    const name = prompt('给这个风格起个名字', `我的${FILMS.find(f => f.id === fm.preset).name}`); if (!name) return;
    const list = prefs().myFilms || []; list.push({ name, preset: fm.preset, intensity: fm.intensity, adjust: { ...fm.adjust }, date: fm.date, curves: fm.curves ? structuredClone(fm.curves) : null }); setPrefs({ myFilms: list }); toast('已保存到「我的风格」，可在片夹中批量套用'); buildPanel();
  };
  $$('[data-my]', sec).forEach(b => b.onclick = () => { const s = my[+b.dataset.my]; S.doc.film = { ...S.doc.film, preset: s.preset, intensity: s.intensity, adjust: { ...s.adjust }, date: s.date, curves: s.curves ? structuredClone(s.curves) : null }; commit(`我的风格 · ${s.name}`, { major: true }); buildPanel(); });
  bindToggle(sec, 'date', v => { S.doc.film.date = v; commit(v ? '日期戳' : '移除日期戳'); });
  $('#dateText', sec).oninput = (e) => { S.doc.film.dateText = e.target.value; render(); };
  $('#dateText', sec).onchange = () => commit('编辑日期戳');
  $('#leakSeed', sec).onclick = () => { S.doc.film.seed = (S.doc.film.seed || 3) + 1; if (!(S.doc.film.adjust?.leak > 0) && !(FILMS.find(f => f.id === S.doc.film.preset).p.leak > 0)) S.doc.film.adjust = { ...S.doc.film.adjust, leak: 0.5 }; commit('更换漏光'); buildPanel(); };
  p.append(sec);
};

// ======================= 局部（蒙版 + AI 消除） =======================
const LOCAL_KINDS = [
  ['subject', '主体', I('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>')],
  ['background', '背景', I('<rect x="3" y="4" width="18" height="16" rx="1"/><path d="m3 16 5-5 4 4 3-3 6 6"/>')],
  ['depth', '深度范围', I('<path d="M2 20h20M5 20V9l7-5 7 5v11"/>')],
  ['radial', '径向', I('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>')],
  ['linear', '渐变', I('<path d="M4 4h16M4 9h16M4 14h16" opacity=".5"/><path d="M4 19h16"/>')],
  ['brush', '画笔', I('<path d="M9.5 14.5 4 20"/><path d="M14 4l6 6-7.5 7.5a3 3 0 0 1-4.2 0l-1.8-1.8a3 3 0 0 1 0-4.2z"/>')],
];
const ADJ = [['exposure', '曝光'], ['contrast', '对比度'], ['highlights', '高光'], ['shadows', '阴影'], ['temp', '色温'], ['tint', '色调'], ['saturation', '饱和度'], ['clarity', '清晰度']];

async function addLocal(kind) {
  const s = an().subject;
  const lc = { id: newId(), name: LOCAL_KINDS.find(k => k[0] === kind)[1], mask: { kind, invert: false }, adj: {} };
  if (kind === 'subject' || kind === 'background') {
    const t = task('seg', '主体分割 · DeepLab v3');
    const m = await ensureSeg(S.doc, S.M);
    if (!m) { t.fail('未能分割出主体'); return; }
    t.done('主体蒙版就绪');
    lc.adj = kind === 'subject' ? { exposure: 0.15, clarity: 0.25 } : { exposure: -0.2, saturation: -0.25 };
  }
  if (kind === 'depth') { try { await ensureDepth(S.doc, S.M); } catch { return; } Object.assign(lc.mask, { near: 0, far: 0.35, feather: 0.08 }); lc.adj = { exposure: -0.25, saturation: -0.2, clarity: -0.3 }; lc.name = '远景'; }
  if (kind === 'radial') { Object.assign(lc.mask, { cx: s.cx, cy: (s.cy + s.y0) / 2, rx: Math.max(0.12, (s.x1 - s.x0) * 0.7), ry: Math.max(0.12, (s.y1 - s.y0) * 0.6), feather: 0.6 }); lc.adj = { exposure: 0.25, temp: 0.08 }; }
  if (kind === 'linear') { Object.assign(lc.mask, { x0: 0.5, y0: 0, x1: 0.5, y1: 0.45 }); lc.adj = { exposure: -0.3, highlights: -0.3, saturation: 0.1 }; lc.name = '渐变（天空）'; }
  if (kind === 'brush') { S.M.brush.set(lc.id, brushCanvas(S.doc, S.M)); lc.adj = { exposure: 0.3 }; }
  S.doc.locals = [...(S.doc.locals || []), lc]; S.selLocal = lc.id; S.eraseMask = null;
  commit(`局部 · ${lc.name}`); buildPanel();
  if (kind === 'brush') toast('在画面上涂抹以绘制蒙版，[ ] 调整笔刷大小');
  if (kind === 'radial') toast('在画面上点击/拖动以移动径向中心');
  if (kind === 'linear') toast('在画面上拖拽以绘制渐变方向');
}

P.local = (p) => {
  p.append(el(`<div>${head('局部', 'MASK', '用 AI 主体 / 背景 / 深度范围，或径向、渐变、画笔蒙版，只调整画面的一部分。')}</div>`));
  const add = el(`<div class="grid3" style="margin-bottom:10px">${LOCAL_KINDS.map(([k, n, ic]) => `<button class="mode" data-add="${k}">${ic}${n}</button>`).join('')}</div>`);
  $$('[data-add]', add).forEach(b => b.onclick = () => addLocal(b.dataset.add));
  p.append(add);
  const locals = S.doc.locals || [];
  if (locals.length) {
    const list = el(`<div class="local-list"></div>`);
    for (const lc of locals) {
      const r = el(`<div class="local ${S.selLocal === lc.id ? 'on' : ''}"><span class="dot" style="${lc.hidden ? 'opacity:.3' : ''}"></span><span class="nm">${esc(lc.name)}${lc.mask.invert ? ' · 反相' : ''}</span>
        <button data-a="hide" title="显示/隐藏">${I(lc.hidden ? '<path d="M3 3l18 18"/><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.4 3"/><path d="M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6a9 9 0 0 0 4-1"/>' : '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>')}</button>
        <button data-a="del" title="删除">${I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>')}</button></div>`);
      r.onclick = (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'hide') { lc.hidden = !lc.hidden; commit(lc.hidden ? '隐藏局部' : '显示局部'); }
        else if (a === 'del') { S.doc.locals = S.doc.locals.filter(x => x !== lc); if (S.selLocal === lc.id) S.selLocal = null; commit('删除局部'); }
        else { S.selLocal = lc.id; S.eraseMask = null; }
        buildPanel(); bus.drawOverlay();
      };
      list.append(r);
    }
    p.append(list);
  }
  const lc = locals.find(l => l.id === S.selLocal);
  if (lc) {
    const m = lc.mask;
    let maskUi = tog('inv', '反相蒙版', !!m.invert) + tog('show', '显示红色蒙版', S.showMask);
    if (m.kind === 'radial') maskUi += slider('rx', '宽度', 0.04, 0.9, 0.005, m.rx) + slider('ry', '高度', 0.04, 0.9, 0.005, m.ry) + slider('feather', '羽化', 0.05, 1, 0.01, m.feather ?? 0.5);
    if (m.kind === 'depth') maskUi += slider('near', '起始', 0, 1, 0.01, m.near ?? 0) + slider('far', '结束', 0, 1, 0.01, m.far ?? 0.35) + slider('dfeather', '过渡', 0.01, 0.3, 0.005, m.feather ?? 0.08) + '<p class="hint">深度 0 = 最远，1 = 最近。</p>';
    if (m.kind === 'brush') maskUi += slider('bsize', '笔刷', 0.01, 0.4, 0.005, S.brush.size) + slider('bhard', '硬度', 0, 0.95, 0.01, S.brush.hard) + tog('berase', '橡皮擦', S.brush.erase) + '<button class="btn sm" id="bclear">清空画笔</button>';
    const box = el(`<div class="insp"><div class="insp-h">${esc(lc.name)} <span class="tag gray">${LOCAL_KINDS.find(k => k[0] === m.kind)[1]}</span></div>
      <input class="txt" id="lname" value="${esc(lc.name)}" style="margin-bottom:6px">
      ${maskUi}<div class="mini-h">调整</div>${ADJ.map(([k, n]) => slider('j_' + k, n, -1, 1, 0.01, lc.adj[k] || 0, v => (v > 0 ? '+' : '') + Math.round(v * 100))).join('')}</div>`);
    $('#lname', box).onchange = (e) => { lc.name = e.target.value || lc.name; commit('重命名局部'); buildPanel(); };
    bindToggle(box, 'inv', v => { m.invert = v; commit('反相蒙版'); });
    bindToggle(box, 'show', v => { S.showMask = v; bus.drawOverlay(); });
    for (const k of ['rx', 'ry', 'feather', 'near', 'far']) bindSlider(box, k, v => { m[k] = v; }, '调整蒙版');
    bindSlider(box, 'dfeather', v => { m.feather = v; }, '调整蒙版');
    bindSlider(box, 'bsize', v => { S.brush.size = v; bus.drawOverlay(); }, '笔刷');
    bindSlider(box, 'bhard', v => { S.brush.hard = v; }, '笔刷');
    bindToggle(box, 'berase', v => { S.brush.erase = v; });
    if ($('#bclear', box)) $('#bclear', box).onclick = () => { const c = S.M.brush.get(lc.id); c.getContext('2d').clearRect(0, 0, c.width, c.height); m.data = null; clearRenderCache(); commit('清空画笔'); };
    ADJ.forEach(([k]) => bindSlider(box, 'j_' + k, v => { lc.adj = { ...lc.adj, [k]: v }; }, '局部调整'));
    p.append(box);
    bus.syncBrush = () => { const i = $('[data-k="bsize"]', box); if (i) { i.value = S.brush.size; i.dispatchEvent(new Event('input')); } };
  } else if (!locals.length) p.append(el(`<p class="hint" style="margin:0 0 12px">选择一种蒙版开始。主体 / 背景使用语义分割模型（2.7 MB），深度范围使用深度估计模型（27 MB），均在本机运行。</p>`));

  const er = !!S.eraseMask;
  const e = el(`<div>${section('AI 消除', `<p class="hint" style="margin-top:0">涂抹想要移除的物体或路人，生成式模型（MI-GAN · 28 MB）会根据周围内容补全。</p>
    ${er ? `${slider('esize', '笔刷', 0.01, 0.4, 0.005, S.brush.size)}${tog('eerase', '橡皮擦', S.brush.erase)}<div class="row" style="margin-top:8px"><button class="btn safe" id="eraseGo">✦ 执行消除</button><button class="btn" id="eraseCancel">取消</button></div>`
      : `<button class="btn block" id="eraseStart">${I('<path d="M20 20H9L4 15l10-10 7 7-6 6"/>')}开始涂抹</button>`}
    ${S.doc.base ? '<button class="btn sm" id="baseReset" style="margin-top:8px">还原原始底片</button>' : ''}`, { id: 'erase', tag: 'AI' })}</div>`);
  if ($('#eraseStart', e)) $('#eraseStart', e).onclick = () => { S.eraseMask = brushCanvas(S.doc, S.M); S.selLocal = null; S.brush.erase = false; buildPanel(); bus.drawOverlay(); toast('在画面上涂抹要消除的区域'); };
  if ($('#eraseCancel', e)) $('#eraseCancel', e).onclick = () => { S.eraseMask = null; buildPanel(); bus.drawOverlay(); };
  bindSlider(e, 'esize', v => { S.brush.size = v; bus.drawOverlay(); }, '笔刷');
  bindToggle(e, 'eerase', v => { S.brush.erase = v; });
  if ($('#eraseGo', e)) $('#eraseGo', e).onclick = async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>生成中…';
    const t = task('erase', 'AI 消除 · MI-GAN');
    try {
      const hole = dilate(S.eraseMask, 3, S.eraseMask.width, S.eraseMask.height);
      const out = await inpaint(base(), hole, (pp, stage) => t.progress(stage === 'download' ? pp * 0.85 : 0.92, stage === 'download' ? `下载模型 ${Math.round(pp * 100)}%` : '补全中…'));
      t.done('消除完成'); S.eraseMask = null;
      await bus.setBase(out, 'AI 消除');
    } catch (err) { t.fail('消除失败：' + err.message); btn.disabled = false; btn.textContent = '重试'; }
  };
  if ($('#baseReset', e)) $('#baseReset', e).onclick = async () => { S.doc.base = null; await import('./media.js').then(m => m.syncBase(S.doc, S.M)); commit('还原原始底片', { major: true }); recomputeCrops(); bus.renderInsights(); buildPanel(); ensureSeg(S.doc, S.M).then(render); };
  p.append(e);
};

// ======================= 光学 =======================
export const fNum = (v) => v < 0.01 ? '关闭' : 'f/' + (16 * Math.pow(1.2 / 16, v)).toFixed(1);
const shutter = (v) => { if (v < 0.01) return '1/1000'; const s = Math.pow(2, -10 + v * 10); return s >= 0.5 ? s.toFixed(1) + 's' : '1/' + Math.round(1 / s); };
P.optics = (p) => {
  const o = S.doc.optics, depthMode = o.mode === 'depth';
  p.append(el(`<div>${head('光学', 'OPTICS', '景深、散景与快门拖影。基于单张照片的模拟与生成，不是恢复真实拍摄参数。')}</div>`));
  const box = el(`<div>
    <div class="tabs"><button data-mode="depth" class="${depthMode ? 'on' : ''}">AI 深度景深</button><button data-mode="classic" class="${!depthMode ? 'on' : ''}">经典（主体蒙版）</button></div>
    ${depthMode && !S.M.depth ? `<div class="ml-card" style="margin-bottom:10px"><div class="t"><span class="spin"></span>正在生成深度图<small>27 MB</small></div></div>` : ''}
    ${section('景深 · 光圈', `${slider('aperture', '光圈', 0, 1, 0.01, o.aperture, fNum)}${slider('focusR', depthMode ? '景深范围' : '焦点范围', 0.05, 0.8, 0.01, o.focusR)}${slider('bokeh', '散景高光', 0, 1, 0.01, o.bokeh)}
      ${tog('pick', '点击画面对焦', S.focusPick, depthMode ? '按焦点所在深度计算虚化' : '')}
      <div class="row" style="margin-top:6px"><button class="btn sm" id="focusSubj">对焦主体</button><button class="btn sm safe" id="portrait">一键人像虚化</button></div>`, { id: 'dof' })}
    ${section('快门 · 运动', `${slider('motion', '快门', 0, 1, 0.01, o.motion, shutter)}${slider('angle', '方向', 0, 180, 1, o.angle, v => Math.round(v) + '°')}${tog('keep', '主体保持清晰', o.keepSubject !== false, '追焦摇拍效果')}`, { id: 'shutter' })}</div>`);
  $$('[data-mode]', box).forEach(b => b.onclick = async () => {
    S.doc.optics.mode = b.dataset.mode; commit(b.dataset.mode === 'depth' ? '深度景深' : '经典景深'); buildPanel();
    if (b.dataset.mode === 'depth') { await ensureDepth(S.doc, S.M).catch(() => {}); buildPanel(); render(); bus.renderInsights(); }
  });
  bindSlider(box, 'aperture', v => { S.doc.optics.aperture = v; bus.updateHud(); }, '光圈', fNum);
  bindSlider(box, 'focusR', v => { S.doc.optics.focusR = v; }, '景深范围');
  bindSlider(box, 'bokeh', v => { S.doc.optics.bokeh = v; }, '散景');
  bindToggle(box, 'pick', v => { S.focusPick = v; if (v && S.doc.optics.aperture < 0.05) { S.doc.optics.aperture = 0.55; commit('开启景深'); buildPanel(); } bus.drawOverlay(); });
  $('#focusSubj', box).onclick = () => { delete S.doc.optics.focusX; delete S.doc.optics.focusY; commit('对焦主体'); };
  $('#portrait', box).onclick = async () => { Object.assign(S.doc.optics, { aperture: 0.72, focusR: 0.25, bokeh: 0.35 }); delete S.doc.optics.focusX; delete S.doc.optics.focusY; commit('一键人像虚化', { major: true }); buildPanel(); };
  bindSlider(box, 'motion', v => { S.doc.optics.motion = v; }, '快门', shutter);
  bindSlider(box, 'angle', v => { S.doc.optics.angle = v; }, '运动方向');
  bindToggle(box, 'keep', v => { S.doc.optics.keepSubject = v; commit('追焦'); });
  p.append(box);
  if (depthMode && !S.M.depth) ensureDepth(S.doc, S.M).then(() => { buildPanel(); render(); bus.renderInsights(); }).catch(() => {});
};

// ======================= 空间 2.5D =======================
const CAM_PRESETS = [['左摇', { x: -0.8, y: 0, zoom: 0 }], ['右摇', { x: 0.8, y: 0, zoom: 0 }], ['俯视', { x: 0, y: -0.8, zoom: 0 }], ['仰视', { x: 0, y: 0.8, zoom: 0 }], ['推近', { x: 0, y: 0, zoom: 0.8 }], ['滑动变焦', { x: 0, y: 0, zoom: -0.9 }]];
P.space = (p) => {
  const c = S.doc.cam, has = !!S.M.depth;
  p.append(el(`<div>${head('空间', '2.5D', '深度估计 → 分层视差 → 生成式遮挡补全：改变观察视角，生成 2.5D 动态照片。')}</div>`));
  const card = el(`<div class="ml-card" style="margin-bottom:12px">
    <div class="t">${has ? '<span class="tag ok">✓</span>' : '<span class="spin"></span>'} 深度图 <small>Depth Anything V2 · 27 MB</small></div>
    ${has ? `<canvas class="depth-thumb" id="dthumb"></canvas>${tog('vd', '叠加深度视图', S.viewDepth)}` : '<p class="hint" style="margin:0">首次使用会下载模型并缓存，之后秒开。</p>'}</div>`);
  if (has) {
    const t = $('#dthumb', card), d = S.M.depth.canvas; t.width = d.width; t.height = d.height;
    const tx = t.getContext('2d'); tx.drawImage(d, 0, 0);
    bindToggle(card, 'vd', v => { S.viewDepth = v; bus.updateHud(); bus.drawOverlay(); });
  }
  p.append(card);
  if (!has) { ensureDepth(S.doc, S.M).then(() => { if (S.tool === 'space') buildPanel(); bus.renderInsights(); }).catch(() => {}); return; }
  const box = el(`<div>
    ${tog('on', '启用 2.5D 相机', !!c.on, '基于深度的视差重投影')}
    <p class="hint" style="margin:2px 0 6px">${I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18"/>')} 也可以直接拖动预览右下角的 <b>XYZ 球体</b>：拖球体环绕，拖 X / Y 手柄锁定俯仰 / 偏航，拖 Z 或滚轮推拉，双击复位，按住 Shift 吸附。</p>
    <div class="preset-row" style="margin:8px 0">${CAM_PRESETS.map(([n], i) => `<button class="chip" data-cp="${i}">${n}</button>`).join('')}</div>
    ${section('相机', `${slider('cx', '横移', -1, 1, 0.01, c.x || 0, v => Math.round(v * 100))}${slider('cy', '纵移', -1, 1, 0.01, c.y || 0, v => Math.round(v * 100))}${slider('cz', '推拉', -1, 1, 0.01, c.zoom || 0, v => Math.round(v * 100))}${slider('cf', '焦平面', 0, 1, 0.01, c.focus ?? 0.5, v => Math.round(v * 100))}<button class="btn sm" id="camReset">复位相机</button>`, { id: 'cam' })}
    ${section('遮挡补全', `${tog('fill', '生成被遮挡的背景', !!c.fill, '主体分层 + MI-GAN 补全背景板')}${S.M.plate ? '<p class="hint">✓ 背景板已生成，移动视角时主体后方不再拉伸。</p>' : '<p class="hint">开启后会移除主体并补全背后的场景（28 MB 模型）。</p>'}`, { id: 'fill', tag: 'AI' })}
    ${section('动态照片', `${slider('amp', '幅度', 0.2, 1, 0.01, c.amp ?? 0.8, v => Math.round(v * 100))}<div class="row" style="margin-top:8px"><button class="btn" id="play">${S.anim ? '■ 停止预览' : '▶ 播放预览'}</button><button class="btn" id="vid">导出视频</button></div><p class="hint">导出 3.6 秒循环 WebM，可直接发布为动态照片。</p>`, { id: 'motion' })}</div>`);
  const on = () => { if (!S.doc.cam.on) { S.doc.cam.on = true; $('[data-tog="on"]', box)?.classList.add('on'); } };
  bindToggle(box, 'on', v => { S.doc.cam.on = v; if (v && !S.doc.cam.x && !S.doc.cam.y && !S.doc.cam.zoom) S.doc.cam.x = 0.6; commit(v ? '启用 2.5D 相机' : '关闭 2.5D 相机', { major: true }); buildPanel(); });
  $$('[data-cp]', box).forEach(b => b.onclick = () => { S.doc.cam = { ...S.doc.cam, ...CAM_PRESETS[+b.dataset.cp][1], on: true }; commit(`视角 · ${CAM_PRESETS[+b.dataset.cp][0]}`, { major: true }); buildPanel(); });
  bindSlider(box, 'cx', v => { on(); S.doc.cam.x = v; }, '相机横移');
  bindSlider(box, 'cy', v => { on(); S.doc.cam.y = v; }, '相机纵移');
  bindSlider(box, 'cz', v => { on(); S.doc.cam.zoom = v; }, '相机推拉');
  bindSlider(box, 'cf', v => { S.doc.cam.focus = v; }, '焦平面');
  bindSlider(box, 'amp', v => { S.doc.cam.amp = v; }, '动态幅度');
  $('#camReset', box).onclick = () => { S.doc.cam = { ...S.doc.cam, x: 0, y: 0, zoom: 0, focus: 0.5 }; commit('复位相机', { major: true }); buildPanel(); };
  bindToggle(box, 'fill', async v => { S.doc.cam.fill = v; if (v) { on(); try { await ensurePlate(S.doc, S.M); } catch { } } clearRenderCache(); commit(v ? '遮挡补全' : '关闭遮挡补全', { major: true }); buildPanel(); bus.renderInsights(); });
  $('#play', box).onclick = () => { if (!S.doc.cam.on) { S.doc.cam.on = true; } bus.playAnim(); };
  $('#vid', box).onclick = () => exportVideo();
  bus.onAnimChange = () => { const b = $('#play'); if (b) b.textContent = S.anim ? '■ 停止预览' : '▶ 播放预览'; };
  p.append(box);
};

// ======================= 画布 + AI 扩图 =======================
const FRAME_MODES = [
  ['none', '无边框', '<rect x="4" y="4" width="16" height="16"/>', '基础'],
  ['solid', '纯色补边', '<rect x="3" y="3" width="18" height="18"/><rect x="7" y="7" width="10" height="10" fill="currentColor" opacity=".3"/>', '基础'],
  ['blur', '模糊背景', '<circle cx="12" cy="12" r="8" stroke-dasharray="2 2"/>', '基础'],
  ['mirror', '镜像延伸', '<path d="M12 3v18M8 7l-4 5 4 5M16 7l4 5-4 5"/>', '基础'],
  ['gradient', '渐变背景', '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15 15 3M3 21 21 3M9 21l12-12" opacity=".5"/>', '基础'],
  ['polaroid', '拍立得', '<rect x="5" y="3" width="14" height="18" rx="1"/><rect x="7" y="5" width="10" height="10"/>', '相纸胶片'],
  ['film', '胶片条', '<rect x="3" y="5" width="18" height="14"/><path d="M6 5v2M10 5v2M14 5v2M18 5v2M6 17v2M10 17v2M14 17v2M18 17v2"/>', '相纸胶片'],
  ['scan', '扫描底片', '<path d="M3 4h18v16H3z" fill="currentColor" opacity=".25"/><path d="M6 7l1 .5L6 9l.6 2-1 1 .8 2L6 17h12l-.6-2 1-1.5-.7-2 .9-1.6L18 7z"/>', '相纸胶片'],
  ['slide', '幻灯片框', '<rect x="3" y="3" width="18" height="18" rx="3"/><rect x="7" y="7" width="10" height="10" rx="1"/>', '相纸胶片'],
  ['mat', '卡纸装裱', '<rect x="2.5" y="2.5" width="19" height="19"/><rect x="5.5" y="5.5" width="13" height="13"/><rect x="8.5" y="8.5" width="7" height="7"/>', '装裱展示'],
  ['exif', '参数水印', '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 16h18"/><circle cx="6.5" cy="18.5" r=".8" fill="currentColor"/><path d="M9 18.5h4M15 18.5h3"/>', '装裱展示'],
  ['rounded', '圆角卡片', '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="6.5" y="6.5" width="11" height="11" rx="3"/>', '装裱展示'],
  ['glass', '玻璃卡片', '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="2 2"/><rect x="6.5" y="6.5" width="11" height="11" rx="3"/>', '装裱展示'],
  ['stamp', '邮票齿边', '<path d="M5 4h14v16H5z" stroke-dasharray="1.6 1.6"/><rect x="8" y="7" width="8" height="8"/>', '装裱展示'],
  ['torn', '撕纸边', '<path d="M4 5l2 .8 2-.8 2 .7 2-.7 2 .8 2-.6 2 .6v14l-2-.7-2 .7-2-.6-2 .6-2-.7-2 .7-2-.7z"/>', '装裱展示'],
];
// Sensible starting values when a frame is picked.
const MODE_DEF = {
  solid: { pad: 0.06 }, mat: { pad: 0.09, border: 0.035, color: '#f6f3ec', frameColor: '#1b1a17' }, exif: { pad: 0.035, color: '#ffffff' },
  rounded: { pad: 0.07, radius: 0.04, color: '#efebe4' }, glass: { pad: 0.08, radius: 0.05 }, gradient: { pad: 0.08, radius: 0.035 },
  torn: { pad: 0.1, color: '#26231f' }, stamp: { color: '#e9e2d5' }, slide: { color: '#1c1b19', cardColor: '#ece8df' },
};
const PAD_MODES = ['solid', 'blur', 'mirror', 'gradient', 'mat', 'exif', 'rounded', 'glass', 'torn'];
const COLOR_MODES = ['none', 'solid', 'polaroid', 'mat', 'exif', 'rounded', 'stamp', 'slide', 'torn'];
const FRAME_COLORS = [['#1b1a17', '黑'], ['#3b2a1e', '胡桃'], ['#b08a5a', '橡木'], ['#f4f2ee', '白'], ['#c9c9c9', '银']];
P.canvas = (p) => {
  const f = S.doc.frame;
  p.append(el(`<div>${head('画布', 'CANVAS', isCollage() ? '拼贴底板的颜色与纹理。' : '补边、相纸、胶片条，或用生成式模型真正扩展画面。')}</div>`));
  if (!isCollage()) {
    const groups = [...new Set(FRAME_MODES.map(x => x[3]))];
    const mg = el(`<div class="frame-groups">${groups.map(g => `<div class="mini-h">${g}</div><div class="mode-grid">${FRAME_MODES.filter(x => x[3] === g).map(([id, n, ic]) => `<button class="mode ${f.mode === id ? 'on' : ''}" data-m="${id}">${I(ic)}${n}</button>`).join('')}</div>`).join('')}</div>`);
    $$('[data-m]', mg).forEach(b => b.onclick = () => {
      const id = b.dataset.m; S.doc.frame = { ...S.doc.frame, mode: id, ...(MODE_DEF[id] || {}) };
      commit(`画布 · ${b.textContent.trim()}`, { major: true }); recomputeCrops(); buildPanel();
    });
    p.append(mg);
  }
  let body = '';
  const m = f.mode, nc = !isCollage();
  if (nc && PAD_MODES.includes(m)) body += section('边距', `${slider('pad', m === 'exif' ? '边框' : m === 'mat' ? '卡纸宽度' : '四周', 0, m === 'mat' ? 0.2 : 0.25, 0.005, f.pad ?? 0.06)}
    ${['solid', 'blur', 'mirror', 'gradient', 'rounded', 'glass', 'torn'].includes(m) ? slider('bottom', '底部加宽', 0, 0.3, 0.005, f.bottom || 0) : ''}
    ${['rounded', 'glass', 'gradient'].includes(m) ? slider('radius', '圆角', 0, 0.2, 0.002, f.radius ?? 0.04) : ''}
    ${m === 'mat' ? slider('border', '外框宽度', 0, 0.08, 0.002, f.border ?? 0.035) : ''}
    ${['solid', 'blur', 'mirror'].includes(m) ? tog('shadow', '照片投影', f.shadow) : ''}`, { id: 'pad' });
  if (nc && m === 'mat') body += section('外框', `<div class="chips">${FRAME_COLORS.map(([c, n]) => `<button class="chip ${f.frameColor === c ? 'on' : ''}" data-fc="${c}"><span class="dot" style="background:${c}"></span>${n}</button>`).join('')}</div>`, { id: 'fc' });
  if (nc && ['exif', 'stamp', 'slide'].includes(m)) body += section(m === 'exif' ? '水印信息' : '标注文字', `<input class="txt" id="sign" value="${esc(f.sign || '')}" placeholder="${m === 'exif' ? (S.M.exif?.camera || '留空显示相机型号 / DARKROOM') : 'DARKROOM'}">
    ${m === 'exif' ? `<p class="hint">${S.M.exif ? '已读取照片 EXIF：' + esc([S.M.exif.camera, S.M.exif.aperture, S.M.exif.shutter, S.M.exif.iso].filter(Boolean).join(' · ')) : '这张照片没有 EXIF，水印使用示例参数；导入相机直出 JPG 会自动读取。'}</p>` : ''}`, { id: 'sign' });
  if (nc && m === 'gradient') body += section('渐变', `<button class="btn sm" id="gseed">${I('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>')}换一组照片配色</button><p class="hint">渐变色取自照片色板，与画面自然协调。</p>`, { id: 'grad' });
  if (nc && m === 'polaroid') body += section('相纸', `${slider('rot', '旋转', -12, 12, 0.5, f.rot, v => (+v).toFixed(1) + '°')}<div class="chips" style="margin-top:8px">${[[1, '方形 SQ'], [0.78, '竖幅 Mini'], [1.35, '宽幅 Wide']].map(([v, n]) => `<button class="chip ${Math.abs((f.photoAspect || 1) - v) < 0.01 ? 'on' : ''}" data-pa="${v}">${n}</button>`).join('')}</div>`, { id: 'pol' });
  if (COLOR_MODES.includes(m) || isCollage()) {
    body += section(m === 'polaroid' || m === 'stamp' || m === 'slide' || m === 'torn' ? '桌面颜色' : m === 'mat' ? '卡纸颜色' : m === 'exif' ? '边框颜色' : '底色', `<div class="swatches">${CANVAS_COLORS.map(c => `<button class="sw ${f.color === c ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}<input type="color" value="${f.color}" id="cc"></div>
      <div class="mini-h">取自照片</div><div class="swatches">${an().palette.map(c => `<button class="sw" data-c="${c}" style="background:${c}"></button>`).join('')}</div>`, { id: 'color' });
    if (!['exif', 'slide'].includes(m)) body += section('纹理', `<div class="chips">${TEXTURES.map(x => `<button class="chip ${f.texture === x.id ? 'on' : ''}" data-t="${x.id}">${x.name}</button>`).join('')}</div>`, { id: 'tex' });
  }
  const sec = el(`<div>${body}<button class="btn roll block" id="rollFrame" style="margin:8px 0 4px">${I('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>')}Roll 画布</button></div>`);
  bindSlider(sec, 'pad', v => { S.doc.frame.pad = v; }, '边距'); bindSlider(sec, 'bottom', v => { S.doc.frame.bottom = v; }, '底边');
  bindSlider(sec, 'radius', v => { S.doc.frame.radius = v; }, '圆角'); bindSlider(sec, 'border', v => { S.doc.frame.border = v; }, '外框宽度');
  $$('[data-fc]', sec).forEach(b => b.onclick = () => { S.doc.frame.frameColor = b.dataset.fc; commit('外框颜色', { major: true }); buildPanel(); });
  if ($('#sign', sec)) { $('#sign', sec).oninput = (e) => { S.doc.frame.sign = e.target.value; render(); }; $('#sign', sec).onchange = () => commit('水印文字'); }
  if ($('#gseed', sec)) $('#gseed', sec).onclick = () => { S.doc.frame.gseed = (S.doc.frame.gseed || 0) + 1; commit('换渐变', { major: true }); };
  bindToggle(sec, 'shadow', v => { S.doc.frame.shadow = v; commit('照片投影'); });
  bindSlider(sec, 'rot', v => { S.doc.frame.rot = v; }, '旋转相纸');
  $$('[data-pa]', sec).forEach(b => b.onclick = () => { S.doc.frame.photoAspect = +b.dataset.pa; S.doc.crop = bestCrop(S.doc, base(), an(), S.seeds.crop); commit('相纸尺寸', { major: true }); recomputeCrops(); buildPanel(); });
  $$('[data-c]', sec).forEach(b => b.onclick = () => { S.doc.frame.color = b.dataset.c; if (S.doc.frame.mode === 'none' && !isCollage()) S.doc.frame = { ...S.doc.frame, mode: 'solid', pad: S.doc.frame.pad || 0.06 }; commit('画布颜色', { major: true }); buildPanel(); });
  if ($('#cc', sec)) { $('#cc', sec).oninput = (e) => { S.doc.frame.color = e.target.value; render(); }; $('#cc', sec).onchange = () => commit('自定义颜色'); }
  $$('[data-t]', sec).forEach(b => b.onclick = () => { S.doc.frame.texture = b.dataset.t; commit('纹理', { major: true }); buildPanel(); });
  $('#rollFrame', sec).onclick = () => {
    if (!isCollage()) {   // the button also tries a different frame style
      const pool = ['solid', 'gradient', 'mat', 'exif', 'rounded', 'glass', 'polaroid', 'stamp', 'slide', 'torn', 'scan', 'film'].filter(x => x !== S.doc.frame.mode);
      const id = pool[Math.floor(mulberry32(++S.seeds.frame * 31)() * pool.length)];
      S.doc.frame = { ...S.doc.frame, mode: id, ...(MODE_DEF[id] || {}) };
      if (!['mat', 'exif', 'stamp', 'slide', 'scan', 'film', 'glass', 'gradient'].includes(id)) rollFrame();
      recomputeCrops(); commit(`Roll 画布 · ${FRAME_MODES.find(x => x[0] === id)[1]}`, { major: true });
    } else { rollFrame(); commit('Roll 画布', { major: true }); }
    buildPanel();
  };
  p.append(sec);
  if (!isCollage()) p.append(expandSection());
};

function rollFrame() {
  const r = mulberry32(++S.seeds.frame * 17), f = S.doc.frame;
  const cols = [...CANVAS_COLORS, ...an().palette.slice(0, 3)];
  f.color = cols[Math.floor(r() * cols.length)];
  if (f.mode === 'none' && !isCollage()) { f.mode = 'solid'; f.pad = 0.05 + r() * 0.06; }
  f.texture = TEXTURES[Math.floor(r() * TEXTURES.length)].id;
  if (f.mode === 'polaroid') f.rot = (r() - 0.5) * 7;
}

const EXP = { ratio: '1:1', extra: 0.12, align: 'center' };
function expandSection() {
  const opts = RATIOS.filter(r => r.value);
  const s = el(`<div>${section('AI 扩图', `<p class="hint" style="margin-top:0">生成式模型（MI-GAN · 28 MB）延展原图场景并补全背景，生成新的底片版本；原图始终保留。</p>
    <div class="mini-h">目标画幅</div><div class="chips">${opts.map(r => `<button class="chip ${EXP.ratio === r.id ? 'on' : ''}" data-er="${r.id}">${r.label}</button>`).join('')}</div>
    ${slider('extra', '额外留白', 0, 0.4, 0.01, EXP.extra, v => '+' + Math.round(v * 100) + '%')}
    <div class="mini-h">主体位置</div><div class="chips">${[['center', '居中'], ['start', '偏左/上'], ['end', '偏右/下']].map(([v, n]) => `<button class="chip ${EXP.align === v ? 'on' : ''}" data-ea="${v}">${n}</button>`).join('')}</div>
    <button class="btn safe block" id="expGo" style="margin-top:10px">${I('<path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/>')}生成扩图</button>
    ${S.doc.base ? '<button class="btn sm" id="expUndo" style="margin-top:6px">还原原始底片</button>' : ''}`, { id: 'expand', tag: 'AI' })}</div>`);
  $$('[data-er]', s).forEach(b => b.onclick = () => { EXP.ratio = b.dataset.er; $$('[data-er]', s).forEach(x => x.classList.toggle('on', x === b)); });
  $$('[data-ea]', s).forEach(b => b.onclick = () => { EXP.align = b.dataset.ea; $$('[data-ea]', s).forEach(x => x.classList.toggle('on', x === b)); });
  const i = $('[data-k="extra"]', s); i.oninput = () => { EXP.extra = +i.value; i.nextElementSibling.textContent = '+' + Math.round(EXP.extra * 100) + '%'; i.style.setProperty('--p', (EXP.extra / 0.4 * 100) + '%'); }; i.style.setProperty('--p', (EXP.extra / 0.4 * 100) + '%');
  $('#expGo', s).onclick = async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>生成中…';
    const t = task('expand', 'AI 扩图 · MI-GAN');
    try {
      const src = base(), { w, h } = dimsOf(src), A = RATIOS.find(r => r.id === EXP.ratio).value;
      let W = w, H = h;
      if (A > w / h) W = h * A; else H = w / A;
      W *= 1 + EXP.extra; H *= 1 + EXP.extra;
      const k = Math.min(1, 3000 / Math.max(W, H));
      W = Math.round(W * k); H = Math.round(H * k);
      const iw = Math.round(w * k), ih = Math.round(h * k);
      const pos = (free, a) => a === 'start' ? free * 0.18 : a === 'end' ? free * 0.82 : free / 2;
      const ox = Math.round(pos(W - iw, EXP.align)), oy = Math.round(pos(H - ih, EXP.align));
      const canvas = mk(W, H), cx = canvas.getContext('2d');
      cx.filter = `blur(${Math.max(W, H) * 0.03}px)`; cx.drawImage(src, 0, 0, W, H); cx.filter = 'none';
      cx.drawImage(src, ox, oy, iw, ih);
      const hole = mk(W, H), hx = hole.getContext('2d'); hx.fillStyle = '#fff'; hx.fillRect(0, 0, W, H);
      const inset = Math.max(2, Math.round(Math.min(iw, ih) * 0.006));
      hx.clearRect(ox + inset, oy + inset, iw - 2 * inset, ih - 2 * inset);
      const out = await inpaint(canvas, hole, (pp, stage) => t.progress(stage === 'download' ? pp * 0.85 : 0.92, stage === 'download' ? `下载模型 ${Math.round(pp * 100)}%` : '延展画面中…'));
      t.done('扩图完成');
      S.doc.ratio = EXP.ratio; S.doc.frame.mode = 'none'; S.doc.crop = { cx: 0.5, cy: 0.5, zoom: 1 };
      await bus.setBase(out, `AI 扩图 · ${EXP.ratio}`);
      bus.buildRatioChips();
    } catch (err) { t.fail('扩图失败：' + err.message); btn.disabled = false; btn.textContent = '重试'; }
  };
  if ($('#expUndo', s)) $('#expUndo', s).onclick = async () => { S.doc.base = null; const m = await import('./media.js'); await m.syncBase(S.doc, S.M); S.doc.crop = bestCrop(S.doc, base(), an(), 1); commit('还原原始底片', { major: true }); recomputeCrops(); bus.renderInsights(); buildPanel(); ensureSeg(S.doc, S.M).then(render); };
  return s;
}

// ======================= 文字 =======================
P.text = (p) => {
  p.append(el(`<div>${head('文字', 'TYPE', '先理解照片的场景与情绪再给文案。可以只换文案、只换排版，或只换字体。')}</div>`));
  const tab = S.captionTab;
  const tabs = el(`<div class="tabs"><button data-tab="ai" class="${tab === 'ai' ? 'on' : ''}">AI 原创</button><button data-tab="trend" class="${tab === 'trend' ? 'on' : ''}">热门趋势</button><button data-tab="lib" class="${tab === 'lib' ? 'on' : ''}">精选库</button></div>`);
  $$('[data-tab]', tabs).forEach(b => b.onclick = () => { S.captionTab = b.dataset.tab; buildPanel(); });
  p.append(tabs);
  const cur = currentCaption(), favs = prefs().favCaptions || [];
  const capRow = (c, i, extra = '') => `<button class="cap ${cur === c.t.replace(/\n/g, '') ? 'on' : ''} ${c.expired ? 'expired' : ''}" data-ci="${i}" style="animation-delay:${i * 30}ms"><span>${esc(c.t)}</span><small>${extra}<span class="fav ${favs.includes(c.t) ? 'on' : ''}" data-fav="${i}">${favs.includes(c.t) ? '♥' : '♡'}</span></small>${c.heat != null ? `<span class="heat"><i style="width:${c.heat}%"></i></span>` : ''}</button>`;
  let list = [], top = '';
  if (tab === 'ai') {
    top = `<div class="row" style="margin-bottom:6px">${[['zh', '中文'], ['en', 'EN'], ['ja', '日本語']].map(([v, n]) => `<button class="chip ${S.captionLang === v ? 'on' : ''}" data-lang="${v}">${n}</button>`).join('')}</div>
      <div class="chips" style="margin-bottom:8px"><button class="chip ${!S.captionStyle ? 'on' : ''}" data-st="">全部风格</button>${CAPTION_STYLES.map(s => `<button class="chip ${S.captionStyle === s ? 'on' : ''}" data-st="${s}">${s}</button>`).join('')}</div>`;
    list = generateCaptions(an(), { style: S.captionStyle, lang: S.captionLang, seed: S.seeds.caption + 1, n: 5 });
  } else if (tab === 'trend') {
    top = `<div class="row" style="margin-bottom:6px">${[['all', '全部'], ['zh', '中文'], ['en', 'EN'], ['ja', '日本語']].map(([v, n]) => `<button class="chip ${(S.trendLang || 'all') === v ? 'on' : ''}" data-tl="${v}">${n}</button>`).join('')}</div>${tog('exp', '显示已过期', S.showExpired, '趋势有时效，过期条目默认隐藏')}`;
    list = trendList(an(), { lang: S.trendLang || 'all', showExpired: S.showExpired });
  } else {
    top = `<div class="chips" style="margin-bottom:8px"><button class="chip ${!S.captionStyle ? 'on' : ''}" data-st="">智能匹配</button>${CAPTION_STYLES.map(s => `<button class="chip ${S.captionStyle === s ? 'on' : ''}" data-st="${s}">${s}</button>`).join('')}</div>`;
    list = pickCaptions(an(), S.captionStyle, S.seeds.caption, 6);
  }
  S.captions = list;
  const TR = { hot: '<span class="tag">HOT</span>', up: '<span class="tag amber">↑</span>', new: '<span class="tag ok">NEW</span>', stable: '', down: '<span class="tag gray">↓</span>' };
  const cl = el(`<div>${top}<div class="cap-list">${list.map((c, i) => capRow(c, i, tab === 'trend' ? `${TR[c.trend]}${c.fit ? '<span class="tag ok">适配</span>' : ''}<span title="来源">${c.source}</span>` : c.s)).join('') || '<p class="hint">没有符合条件的条目。</p>'}</div>
    ${tab === 'trend' ? '<p class="hint">热度来自编辑精选、公开趋势与用户授权素材，按场景适配度与热度排序。不收录歌词、影视台词等受版权保护的长文本。</p>' : ''}
    <div class="row" style="margin-top:10px"><button class="btn roll" id="rollCap">${I('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>')}Roll 文案</button><button class="btn" id="rollLay">Roll 排版</button></div></div>`);
  $$('[data-lang]', cl).forEach(b => b.onclick = () => { S.captionLang = b.dataset.lang; buildPanel(); });
  $$('[data-tl]', cl).forEach(b => b.onclick = () => { S.trendLang = b.dataset.tl; buildPanel(); });
  $$('[data-st]', cl).forEach(b => b.onclick = () => { S.captionStyle = b.dataset.st || null; buildPanel(); });
  bindToggle(cl, 'exp', v => { S.showExpired = v; buildPanel(); });
  $$('[data-ci]', cl).forEach(b => b.onclick = (e) => {
    const c = list[+b.dataset.ci];
    if (e.target.dataset.fav !== undefined) { const f = new Set(prefs().favCaptions || []); f.has(c.t) ? f.delete(c.t) : f.add(c.t); setPrefs({ favCaptions: [...f] }); buildPanel(); return; }
    setCaption(c.t); buildPanel();
  });
  $('#rollCap', cl).onclick = () => { rollCaption(); commit('Roll 文案', { major: true }); buildPanel(); };
  $('#rollLay', cl).onclick = rollLayout;
  p.append(cl);
  const cap = S.doc.layers.find(l => l.role === 'caption' && l.type === 'text');
  const add = el(`<div>${section('添加', `<div class="grid2"><button class="btn" id="addText">＋ 文字</button><button class="btn" id="annot">✎ 智能批注</button></div>
      ${!isCollage() ? tog('behindCap', '文案置于主体后方', !!cap?.behind, '用主体分割让人物遮挡文字') : ''}
      <p class="hint">智能批注：圈出主体，生成手写箭头、注释、日期与地点标签。</p>`, { id: 'add' })}</div>`);
  $('#addText', add).onclick = () => { const l = { id: newId(), type: 'text', role: 'free', text: '双击编辑文字', pack: 'hand', size: 0.05, x: 0.5, y: 0.5, rot: 0, color: '#ffffff', align: 'center', letter: 0, line: 1.2, opacity: 1, shadow: true }; S.doc.layers.push(l); S.selected = l.id; commit('添加文字'); buildPanel(); setTimeout(() => $('#insText')?.select(), 30); };
  $('#annot', add).onclick = () => { if (isCollage()) return toast('拼贴项目暂不支持智能批注'); S.doc.layers = S.doc.layers.filter(l => !['annot', 'note', 'tag'].includes(l.role)); S.doc.layers.push(...annotate(S.doc, base(), an(), { seed: S.seeds.annot++ })); commit('智能批注', { major: true }); buildPanel(); };
  bindToggle(add, 'behindCap', async v => { if (!cap) { toast('先添加一段文案'); buildPanel(); return; } if (v && !(await ensureSeg(S.doc, S.M))) { toast('未能识别主体'); buildPanel(); return; } cap.behind = v;
    if (v) {   // big title tucked behind the subject's upper body
      const sc = subjectInCanvas(S.doc, base(), an()), n = Math.max(4, [...cap.text.replace(/\n/g, '')].length);
      Object.assign(cap, { x: 0.5, y: Math.max(0.12, sc.a.y + (sc.b.y - sc.a.y) * 0.22), size: Math.min(0.2, 0.92 / n * (/[a-z]/i.test(cap.text) ? 1.7 : 1)), pack: 'bold', upper: true, rot: 0, align: 'center', shadow: false, letter: 0.02 });
    } commit(v ? '文字置于主体后方' : '文字置前', { major: true }); buildPanel(); });
  p.append(add);
  // ---- subject-aware run-around typography ----
  const fl = el(`<div>${section('环绕排版', `<div class="flow-grid">${FLOW_MODES.map(f => `<button class="flow-card ${S.doc.layers.some(l => l.type === 'flow' && l.mode === f.id) ? 'on' : ''}" data-flow="${f.id}" title="${f.desc}"><span class="flow-th"></span><b>${f.name}</b></button>`).join('')}</div>
    <p class="hint">按 AI 主体的位置与剪影自动排布文字，移动、缩放、换构图都会跟随主体。${isCollage() ? '拼贴中以画面中心为主体。' : ''}</p>`, { id: 'flow', tag: 'AUTO' })}</div>`);
  $$('[data-flow]', fl).forEach(b => {
    const mode = b.dataset.flow;
    $('.flow-th', b).append(bus.thumbSlot(() => ({ ...S.doc, layers: [makeFlow(mode, true)] }), 150));
    b.onclick = async () => {
      const ex = S.doc.layers.find(l => l.type === 'flow' && l.mode === mode);
      if (ex) { S.selected = ex.id; buildPanel(); bus.drawOverlay(); return; }
      if (!isCollage() && (mode === 'contour' || mode === 'wrap')) await ensureSeg(S.doc, S.M);
      const ly = makeFlow(mode); S.doc.layers.push(ly); S.selected = ly.id;
      commit(`环绕排版 · ${FLOW_MODES.find(f => f.id === mode).name}`, { major: true }); buildPanel();
    };
  });
  p.append(fl);

  const target = (S.selected && ['text', 'flow'].includes(bus.layerById(S.selected)?.type)) ? bus.layerById(S.selected) : cap;
  const fontBtn = ([id, f]) => `<button class="font ${target?.pack === id ? 'on' : ''}" data-f="${id}"><span class="spec" style="font:${fontString(id, 21)}">${f.group ? '永和 明朝' : 'Aa 永和'}</span><b>${f.name}</b><small>${f.hint}</small></button>`;
  const packs = Object.entries(FONT_PACKS).filter(([id]) => id !== 'stamp');
  const fp = el(`<div>${section('字体包', `<div class="mini-h" style="margin-top:0">古典明朝 · 书法</div><div class="fonts">${packs.filter(([, f]) => f.group).map(fontBtn).join('')}</div>
    <div class="mini-h">常用</div><div class="fonts">${packs.filter(([, f]) => !f.group).map(fontBtn).join('')}</div>
    <button class="btn sm" id="rollFont" style="margin-top:8px">只换字体</button>`, { id: 'fonts' })}</div>`);
  $$('[data-f]', fp).forEach(b => b.onclick = () => { if (!target) return toast('先选择或添加一段文字'); target.pack = b.dataset.f; commit(`字体 · ${FONT_PACKS[b.dataset.f].name}`, { major: true }); buildPanel(); });
  $('#rollFont', fp).onclick = () => { rollFont(); commit('Roll 字体', { major: true }); buildPanel(); };
  p.append(fp);
};

// Default content & styling for each run-around mode.
function makeFlow(mode, preview) {
  const a = an(), light = a.stats.lum > 0.58, cap = currentCaption();
  const zh = (t) => /[一-鿿぀-ヿ]/.test(t);
  const ai = generateCaptions(a, { lang: 'zh', seed: S.seeds.caption + 3, n: 6 }).map(c => c.t);
  const short = cap || ai[0] || '一张照片，多种表达';
  const base = { id: newId(), type: 'flow', role: 'flow', mode, x: 0, y: 0, rot: 0, opacity: 1, color: light ? '#1b1a17' : '#ffffff', shadow: !light, repeat: true, offset: 0.02, letter: 0.06 };
  const M = {
    wave: {text:short,pack:'mincho',size:.035},
    border: {text:short,pack:'hina',size:.025,offset:.025},
    rays: {text:short,pack:'b1',size:.022},
    ring: { text: short.replace(/[。.]$/, ''), pack: 'mincho', size: 0.03, letter: 0.12 },
    contour: { text: short.replace(/[。.]$/, ''), pack: 'hina', size: 0.024, offset: 0.012, letter: 0.08 },
    wrap: { text: [short, ...ai].join('　'), pack: 'mincho', size: 0.021, line: 1.65, offset: 0.022, opacity: 0.92, letter: 0.02 },
    arc: { text: zh(short) ? short.replace(/[，。,.].*$/, '') : short.toUpperCase().split(/[,.]/)[0], pack: 'b1', size: 0.062, repeat: false, offset: 0.03, letter: 0.18 },
    columns: { text: short.replace(/[，。,.\s]/g, ''), pack: 'mincho', size: 0.038, offset: 0.03, letter: 0.1 },
    spiral: { text: short.replace(/[。.]$/, ''), pack: 'wenkai', size: 0.026, offset: 0.015, letter: 0.06 },
  };
  void preview;
  return { ...base, ...M[mode] };
}


function setCaption(text) {
  const cap = S.doc.layers.find(l => l.role === 'caption' && l.type === 'text');
  if (cap) { cap.text = text; commit('更换文案', { major: true }); return; }
  S.doc.layers.push(placeCaption(text)); commit('添加文案', { major: true });
}
function placeCaption(text) {
  const baseL = { id: newId(), type: 'text', role: 'caption', text, pack: S.captionStyle === '时尚编辑' ? 'serif' : S.captionStyle === '冷淡' ? 'minimal' : 'hand', size: 0.045, x: 0.5, y: 0.88, rot: 0, color: '#ffffff', align: 'center', letter: 0, line: 1.2, opacity: 1, shadow: true };
  if (isCollage()) return { ...baseL, color: '#1b1a17', shadow: false, y: 0.95, size: 0.035 };
  const sc = subjectInCanvas(S.doc, base(), an()), f = S.doc.frame, ph = sc.photo;
  if (f.mode === 'polaroid') { const L = sc.L, cd = L.card; return { ...baseL, pack: 'hand', color: '#2b2a28', shadow: false, y: (cd.y + cd.h - cd.b * 1.75) / L.H, rot: cd.rot * 180 / Math.PI }; }
  if (f.mode === 'solid' && f.bottom > 0.05) return { ...baseL, color: '#2b2622', shadow: false, y: ph.y + ph.h + (1 - ph.y - ph.h) / 2 };
  const y = sc.c.y < 0.5 ? ph.y + ph.h * 0.88 : ph.y + ph.h * 0.12;
  const cr = sc.cr, iy = cr.cy - cr.ch / 2 + ((y - ph.y) / ph.h) * cr.ch;
  const l = lumAt(an(), cr.cx - cr.cw / 2, iy - 0.05, cr.cx + cr.cw / 2, iy + 0.05);
  return { ...baseL, y, color: l > 0.62 ? '#1b1a17' : '#ffffff', shadow: l <= 0.62 };
}
function rollCaption() {
  S.seeds.caption++;
  const pool = S.captionTab === 'trend' ? trendList(an(), { lang: S.trendLang || 'all' }) : S.captionTab === 'lib' ? pickCaptions(an(), S.captionStyle, S.seeds.caption, 6) : generateCaptions(an(), { style: S.captionStyle, lang: S.captionLang, seed: S.seeds.caption + 1, n: 6 });
  const cur = currentCaption(), next = pool.find(c => c.t !== cur) || pool[0];
  if (!next) return;
  const cap = S.doc.layers.find(l => l.role === 'caption' && l.type === 'text');
  if (cap) cap.text = next.t; else S.doc.layers.push(placeCaption(next.t));
}
function rollLayout() {
  if (isCollage()) { rollCollage(); return; }
  S.seeds.layout++;
  const crop = S.doc.crop;
  const choices = TEMPLATES.filter(t => t.id !== S.doc.template);
  const next = choices[(S.seeds.layout - 1) % choices.length].id;
  const d = applyTemplate(next, S.doc, an(), base(), { seed: S.seeds.layout, caption: currentCaption(), style: S.captionStyle, keepFilm: true });
  if (S.locks.crop) { d.crop = crop; d.ratio = S.doc.ratio; }
  if (S.locks.frame) d.frame = clone(S.doc.frame);
  if (S.locks.font) { const pack = S.doc.layers.find(l=>l.pack)?.pack; if(pack) d.layers.forEach(l=>{if(l.pack) l.pack=pack;}); }
  d.layers.push(...S.doc.layers.filter(l=>l.role==='deco'||l.role==='free'));
  S.doc = d; S.selected = null;
  commit('Roll 排版', { major: true }); recomputeCrops(); buildPanel(); bus.buildRatioChips();
}
function rollFont() {
  const r = mulberry32(++S.seeds.caption * 3 + 11);
  for (const l of S.doc.layers) {
    if (!['text','flow'].includes(l.type)) continue;
    const pool = l.type === 'flow' ? Object.keys(FONT_PACKS) : l.role === 'caption' || l.role === 'free' ? FONT_ROLL.caption : l.role === 'title' ? FONT_ROLL.title : null;
    if (!pool) continue;
    const opts = pool.filter(x => x !== l.pack); l.pack = opts[Math.floor(r() * opts.length)];
  }
}

// ======================= 版式 / 拼贴 =======================
function collagePhotos() {
  const ids = [...new Set(S.doc.layers.filter(l => l.type === 'photo').map(l => l.asset))];
  return ids.map(id => ({ id, img: S.M.photos.get(id)?.img, an: S.M.photos.get(id)?.an })).filter(x => x.img);
}
function rollCollage(layoutId) {
  const cur = (S.doc.template || '').replace('collage:', '') || 'grid';
  const id = layoutId || cur;
  if (!layoutId) S.seeds.collage++;
  S.doc = applyCollage(id, S.doc, collagePhotos(), S.seeds.collage); S.selected = null;
  commit(`拼贴 · ${COLLAGE_LAYOUTS.find(c => c.id === id).name}`, { major: true }); buildPanel(); bus.buildRatioChips();
}

P.layout = (p) => {
  p.append(el(`<div>${head('版式', 'LAYOUT', isCollage() ? '多图拼贴：切换布局、拖拽照片、添加胶带与文字。' : '模板感知主体位置：人物在右侧时标题优先放在左侧留白。所有元素都是可编辑图层。')}</div>`));
  if (isCollage()) {
    const c = el(`<div><div class="cards">${COLLAGE_LAYOUTS.map(l => `<button class="card ${(S.doc.template || '') === 'collage:' + l.id ? 'on' : ''}" data-cl="${l.id}"><div class="cv"></div><b>${l.name}</b><small>${l.desc}</small></button>`).join('')}</div>
      <div class="row" style="margin-top:10px"><button class="btn roll" id="rollCol">${I('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>')}Roll 布局</button><button class="btn" id="addPhotos">＋ 照片</button></div></div>`);
    $$('[data-cl]', c).forEach(b => { $('.cv', b).append(bus.thumbSlot(() => applyCollage(b.dataset.cl, S.doc, collagePhotos(), S.seeds.collage), 180)); b.onclick = () => rollCollage(b.dataset.cl); });
    $('#rollCol', c).onclick = () => rollCollage();
    $('#addPhotos', c).onclick = async () => {
      const picks = await pickTrayPhotos('添加到拼贴'); if (!picks.length) return;
      for (const pk of picks) { const id = 'C' + pk.id; S.project.assets = { ...S.project.assets, [id]: pk.blob }; const img = await import('./media.js').then(m => m.blobToImage(pk.blob)); S.M.assets.set(id, img); }
      const extra = picks.map(pk => ({ id: 'C' + pk.id }));
      S.doc.layers.push(...extra.map((e, i) => ({ id: newId(), type: 'photo', role: 'photo', asset: e.id, x: 0.3 + i * 0.08, y: 0.4 + i * 0.06, w: 0.36, h: 0.32, rot: (i % 2 ? 4 : -4), crop: { cx: 0.5, cy: 0.5, zoom: 1 }, border: 0.04, shadow: true, borderColor: '#fff', radius: 0, opacity: 1 })));
      registerPhotos(S.doc, S.M); rollCollage((S.doc.template || 'collage:grid').replace('collage:', ''));
    };
    p.append(c);
  } else {
    const t = el(`<div><div class="cards">${TEMPLATES.map(x => `<button class="card ${S.doc.template === x.id ? 'on' : ''}" data-t="${x.id}"><div class="cv"></div><b>${x.name}</b><small>${x.desc}</small></button>`).join('')}</div>
      <div class="row" style="margin-top:10px"><button class="btn roll" id="rollLay2">${I('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>')}只重新排版</button><button class="btn" id="rollFont2">只换字体</button></div>
      <button class="btn block" id="mkCollage" style="margin-top:6px">${I('<rect x="3" y="3" width="8" height="10"/><rect x="13" y="3" width="8" height="6"/><rect x="13" y="11" width="8" height="10"/><rect x="3" y="15" width="8" height="6"/>')}用片夹照片创建拼贴</button></div>`);
    $$('[data-t]', t).forEach(b => { $('.cv', b).append(bus.thumbSlot(() => applyTemplate(b.dataset.t, S.doc, an(), base(), { seed: S.seeds.layout, caption: currentCaption(), style: S.captionStyle }), 180)); b.onclick = () => useTemplate(b.dataset.t); });
    $('#rollLay2', t).onclick = rollLayout;
    $('#rollFont2', t).onclick = () => { rollFont(); commit('Roll 字体', { major: true }); buildPanel(); };
    $('#mkCollage', t).onclick = () => bus.createCollage();
    p.append(t);
  }
  const st = el(`<div>${section('贴纸 · 胶带 · 手绘', '<div class="stickers"></div>', { id: 'stk' })}</div>`);
  for (const s of STICKERS) {
    const b = el(`<button class="stk" title="${s.name}"></button>`);
    const c = document.createElement('canvas'); c.width = c.height = 80;
    drawLayer(c.getContext('2d'), { type: 'sticker', kind: s.id, x: 0.5, y: 0.5, size: s.id.startsWith('tape') ? 0.95 : 0.7, rot: 0, color: s.id.startsWith('tape') ? '#e8c9a0' : s.id === 'label' ? '#f4ead2' : s.id === 'ticket' ? '#f2c14e' : '#ff4836' }, 80, 80);
    b.append(c); b.append(s.name);
    b.onclick = () => addSticker(s.id);
    $('.stickers', st).append(b);
  }
  const upload=el('<label class="btn block" style="margin-top:12px">导入自己的贴纸<input id="stickerInput" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple hidden></label>');
  upload.querySelector('input').onchange=async(e)=>{
    for(const file of e.target.files) try {
      if(file.size>15*1024*1024) throw new Error('贴纸须小于 15 MB');
      const {blobToImage,canvasToBlob}=await import('./media.js');
      const image=await blobToImage(file), scale=Math.min(1,2048/Math.max(image.naturalWidth,image.naturalHeight));
      const c=document.createElement('canvas'); c.width=Math.round(image.naturalWidth*scale);c.height=Math.round(image.naturalHeight*scale);c.getContext('2d').drawImage(image,0,0,c.width,c.height);
      const blob=await canvasToBlob(c,'image/png'), id=newId();
      S.project.assets[id]=blob;S.M.assets.set(id,await blobToImage(blob));
      const ly={id:newId(),type:'sticker',role:'deco',kind:'custom',asset:id,name:file.name,aspect:c.height/c.width,size:.25,x:.5,y:.5,rot:0,opacity:1};
      S.doc.layers.push(ly);S.selected=ly.id;commit('导入贴纸 · '+file.name);
    } catch(error){toast(error.message||'无法读取贴纸','err');}
    buildPanel();
  };
  st.append(upload);st.append(el('<p class="hint">PNG 透明底 / JPG / WebP / SVG，单张最多 15 MB。随项目保存，可缩放、旋转和叠加。</p>'));
  p.append(st);
  const lw = el(`<div>${section(`图层 <span class="muted" style="font-weight:400">${S.doc.layers.length}</span>`, '<div class="layers"></div>', { id: 'layers' })}</div>`);
  const list = $('.layers', lw);
  [...S.doc.layers].reverse().forEach((l) => {
    const r = el(`<div class="layer ${S.selected === l.id ? 'on' : ''}"><span class="nm">${esc(layerName(l))}</span>
      <button data-a="up" title="上移">${I('<path d="m6 15 6-6 6 6"/>')}</button><button data-a="down" title="下移">${I('<path d="m6 9 6 6 6-6"/>')}</button>
      <button data-a="hide" title="显示/隐藏">${I(l.hidden ? '<path d="M3 3l18 18"/><path d="M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6a9 9 0 0 0 4-1"/>' : '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>')}</button>
      <button data-a="del" title="删除">${I('<path d="M6 6l12 12M18 6 6 18"/>')}</button></div>`);
    r.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a, i = S.doc.layers.indexOf(l);
      if (a === 'up' && i < S.doc.layers.length - 1) { S.doc.layers.splice(i, 1); S.doc.layers.splice(i + 1, 0, l); commit('图层上移'); }
      else if (a === 'down' && i > 0) { S.doc.layers.splice(i, 1); S.doc.layers.splice(i - 1, 0, l); commit('图层下移'); }
      else if (a === 'hide') { l.hidden = !l.hidden; commit(l.hidden ? '隐藏图层' : '显示图层'); }
      else if (a === 'del') { bus.removeLayer(l.id); return; }
      else S.selected = l.id;
      buildPanel(); bus.drawOverlay();
    };
    list.append(r);
  });
  if (!S.doc.layers.length) list.append(el(`<p class="hint">还没有图层。套用模板、添加文案或贴纸。</p>`));
  p.append(lw);
};

function layerName(l) {
  if (l.type === 'flow') return '◎  ' + (FLOW_MODES.find(f => f.id === l.mode)?.name || '环绕') + ' · ' + l.text.slice(0, 14);
  if (l.kind === 'custom') return '贴纸 · '+l.name;
  if (l.type === 'text') return 'T  ' + l.text.replace(/\n/g, ' ');
  if (l.type === 'rect') return '▭  色块';
  if (l.type === 'photo') return '▣  照片';
  return '✿  ' + (STICKERS.find(s => s.id === l.kind)?.name || l.kind);
}

function addSticker(kind) {
  const sc = isCollage() ? { a: { x: 0.3, y: 0.3 }, b: { x: 0.7, y: 0.7 }, c: { x: 0.5, y: 0.5 }, photo: { x: 0.1, y: 0.1 } } : subjectInCanvas(S.doc, base(), an());
  const l = { id: newId(), type: 'sticker', role: 'deco', kind, size: kind.startsWith('tape') ? 0.24 : kind === 'barcode' ? 0.16 : kind === 'circle' ? Math.min(0.6, (sc.b.x - sc.a.x) * 1.1) : 0.12, x: 0.5, y: 0.5, rot: 0, opacity: 1,
    color: kind.startsWith('tape') ? '#e8c9a0' : kind === 'label' ? '#f4ead2' : kind === 'ticket' ? '#f2c14e' : kind === 'arrow' || kind === 'scribble' ? '#ffffff' : '#ff4836' };
  if (kind === 'circle') { l.x = sc.c.x; l.y = sc.c.y; }
  else if (kind.startsWith('tape')) { l.x = sc.photo.x + 0.04; l.y = sc.photo.y + 0.01; l.rot = -35; }
  else { l.x = 0.5 + (Math.random() - 0.5) * 0.3; l.y = 0.5 + (Math.random() - 0.5) * 0.3; l.rot = Math.round((Math.random() - 0.5) * 20); }
  S.doc.layers.push(l); S.selected = l.id; commit(`贴纸 · ${STICKERS.find(s => s.id === kind).name}`); buildPanel();
}

// ======================= inspector =======================
function inspector(l) {
  const box = el(`<div class="insp"><div class="insp-h">选中图层 <span class="row" style="gap:4px"><button class="btn xs" id="dup">复制</button><button class="btn xs" id="del">删除</button></span></div></div>`);
  const sw = ['#ffffff', '#111111', '#ff4836', '#f2c14e', '#2f5cff', ...an().palette.slice(0, 3)];
  const colorRow = (key, val) => `<div class="swatches" style="margin:8px 0">${sw.map(c => `<button class="sw ${val === c ? 'on' : ''}" data-col="${key}|${c}" style="background:${c}"></button>`).join('')}<input type="color" data-colin="${key}" value="${/^#[0-9a-f]{6}$/i.test(val || '') ? val : '#ffffff'}"></div>`;
  if (l.type === 'text') {
    box.append(el(`<div><textarea class="txt" id="insText">${esc(l.text)}</textarea>
      <select id="insPack" style="margin:6px 0">${Object.entries(FONT_PACKS).map(([id, f]) => `<option value="${id}" ${l.pack === id ? 'selected' : ''}>${f.name}</option>`).join('')}</select>
      ${slider('size', '字号', 0.01, 0.3, 0.001, l.size, v => Math.round(v * 1000))}${slider('rot', '旋转', -180, 180, 1, l.rot || 0, v => Math.round(v) + '°')}
      ${slider('letter', '字距', -0.1, 0.6, 0.01, l.letter || 0)}${slider('line', '行距', 0.8, 2.2, 0.01, l.line || 1.2)}${slider('opacity', '透明度', 0.05, 1, 0.01, l.opacity ?? 1)}
      ${colorRow('color', l.color)}
      <div class="tabs" style="margin:6px 0">${[['left', '左对齐'], ['center', '居中'], ['right', '右对齐']].map(([v, n]) => `<button class="${(l.align || 'center') === v ? 'on' : ''}" data-align="${v}">${n}</button>`).join('')}</div>
      ${tog('vertical', '竖排', !!l.vertical)}${tog('shadow', '阴影', !!l.shadow)}${tog('stroke', '描边', !!(l.stroke && l.stroke.w))}${tog('bg', '底色标签', !!l.bg)}${tog('upper', '全大写', !!l.upper)}
      ${!isCollage() ? tog('behind', '置于主体后方', !!l.behind, '人物遮挡文字') : ''}
      <div class="slider"><label>混合</label><select id="insBlend" style="grid-column:span 2">${['source-over|正常', 'multiply|正片叠底', 'screen|滤色', 'overlay|叠加', 'difference|差值', 'soft-light|柔光'].map(s => { const [v, n] = s.split('|'); return `<option value="${v}" ${(l.blend || 'source-over') === v ? 'selected' : ''}>${n}</option>`; }).join('')}</select></div></div>`));
  } else if (l.type === 'sticker') {
    box.append(el(`<div>${slider('size', '大小', 0.03, 0.9, 0.001, l.size, v => Math.round(v * 100))}${slider('rot', '旋转', -180, 180, 1, l.rot || 0, v => Math.round(v) + '°')}
      ${slider('sy', '纵横比', 0.4, 2.5, 0.01, Math.abs(l.sy || 1))}${slider('opacity', '透明度', 0.05, 1, 0.01, l.opacity ?? 1)}${colorRow('color', l.color)}</div>`));
  } else if (l.type === 'flow') {
    box.append(el(`<div><div class="tabs" style="margin-bottom:6px">${FLOW_MODES.map(f => `<button data-fm="${f.id}" class="${l.mode === f.id ? 'on' : ''}" title="${f.desc}">${f.name.slice(0, 2)}</button>`).join('')}</div>
      <textarea class="txt" id="insText">${esc(l.text)}</textarea>
      <select id="insPack" style="margin:6px 0">${Object.entries(FONT_PACKS).map(([id, f]) => `<option value="${id}" ${l.pack === id ? 'selected' : ''}>${f.group ? '明朝 · ' : ''}${f.name}</option>`).join('')}</select>
      ${slider('size', '字号', 0.008, 0.12, 0.001, l.size, v => Math.round(v * 1000))}${slider('offset', '距主体', 0, 0.15, 0.002, l.offset ?? 0.02, v => Math.round(v * 1000))}
      ${slider('letter', '字距', -0.05, 0.6, 0.01, l.letter || 0)}${l.mode === 'wrap' ? slider('line', '行距', 1, 2.4, 0.01, l.line || 1.5) : slider('rot', '起始角', -180, 180, 1, l.rot || 0, v => Math.round(v) + '°')}
      ${slider('opacity', '透明度', 0.05, 1, 0.01, l.opacity ?? 1)}${colorRow('color', l.color)}
      ${l.mode !== 'arc' ? tog('repeat', '循环填满', l.repeat !== false) : ''}${tog('shadow', '阴影', l.shadow !== false)}${tog('upper', '全大写', !!l.upper)}
      <button class="btn sm" id="flowText" style="margin-top:6px">换一段 AI 文案</button></div>`));
  } else if (l.type === 'photo') {
    box.append(el(`<div>${slider('w', '宽度', 0.05, 1.2, 0.005, l.w)}${slider('h', '高度', 0.05, 1.2, 0.005, l.h)}${slider('rot', '旋转', -45, 45, 0.5, l.rot || 0, v => Math.round(v) + '°')}
      ${slider('border', '白边', 0, 0.15, 0.002, l.border || 0)}${slider('bottom', '底边', 0, 0.3, 0.005, l.bottom || 0)}${slider('radius', '圆角', 0, 0.2, 0.002, l.radius || 0)}${slider('pzoom', '缩放', 1, 3, 0.01, l.crop?.zoom || 1)}
      ${tog('pshadow', '投影', l.shadow !== false)}${colorRow('borderColor', l.borderColor || '#ffffff')}</div>`));
  } else {
    box.append(el(`<div>${slider('w', '宽度', 0.05, 1.2, 0.01, l.w)}${slider('h', '高度', 0.02, 1.2, 0.01, l.h)}${slider('opacity', '透明度', 0.05, 1, 0.01, l.opacity ?? 1)}${colorRow('color', l.color)}</div>`));
  }
  const upd = (label) => { render(); if (label) commit(label); };
  for (const k of ['size', 'rot', 'letter', 'line', 'opacity', 'w', 'h', 'border', 'bottom', 'radius', 'offset']) bindSlider(box, k, v => { l[k] = v; }, '调整图层');
  if (l.type === 'flow') {
    $$('[data-fm]', box).forEach(b => b.onclick = async () => { if (b.dataset.fm === 'contour' || b.dataset.fm === 'wrap') await ensureSeg(S.doc, S.M); const n = makeFlow(b.dataset.fm); Object.assign(l, { mode: n.mode, size: n.size, offset: n.offset, repeat: n.repeat, letter: n.letter, line: n.line, ...(b.dataset.fm === 'wrap' || l.mode === 'wrap' ? { text: n.text } : {}) }); commit('环绕方式', { major: true }); buildPanel(); });
    bindToggle(box, 'repeat', v => { l.repeat = v; render(); commit('循环填满'); });
    $('#flowText', box).onclick = () => { S.seeds.caption++; l.text = makeFlow(l.mode).text; commit('换文案', { major: true }); buildPanel(); };
  }
  bindSlider(box, 'sy', v => { l.sy = (l.sy || 1) < 0 ? -v : v; }, '调整纵横比');
  bindSlider(box, 'pzoom', v => { l.crop = { ...(l.crop || { cx: 0.5, cy: 0.5 }), zoom: v }; }, '照片缩放');
  bindToggle(box, 'pshadow', v => { l.shadow = v; upd('投影'); });
  $$('[data-col]', box).forEach(b => b.onclick = () => { const [k, c] = b.dataset.col.split('|'); l[k] = c; upd('图层颜色'); buildPanel(); });
  $$('[data-colin]', box).forEach(i => { i.oninput = () => { l[i.dataset.colin] = i.value; render(); }; i.onchange = () => commit('图层颜色'); });
  const ta = $('#insText', box);
  if (ta) {
    ta.oninput = () => { l.text = ta.value; render(); };
    ta.onchange = () => commit('编辑文字');
    $('#insPack', box).onchange = (e) => { l.pack = e.target.value; upd('更换字体'); };
    if ($('#insBlend', box)) $('#insBlend', box).onchange = (e) => { l.blend = e.target.value === 'source-over' ? undefined : e.target.value; upd('混合模式'); };
    $$('[data-align]', box).forEach(b => b.onclick = () => { l.align = b.dataset.align; upd('对齐'); buildPanel(); });
    bindToggle(box, 'vertical', v => { l.vertical = v; upd('竖排'); });
    bindToggle(box, 'shadow', v => { l.shadow = v; upd('阴影'); });  // flow layers treat undefined as on
    bindToggle(box, 'stroke', v => { l.stroke = v ? { w: 0.12, color: l.color === '#ffffff' ? '#111111' : '#ffffff' } : null; upd('描边'); });
    bindToggle(box, 'bg', v => { l.bg = v ? (l.color === '#ffffff' ? 'rgba(20,18,15,0.7)' : 'rgba(255,255,255,0.9)') : null; upd('底色'); });
    bindToggle(box, 'upper', v => { l.upper = v; upd('大小写'); });
    bindToggle(box, 'behind', async v => { if (v && !(await ensureSeg(S.doc, S.M))) { toast('未能识别主体'); buildPanel(); return; } l.behind = v; upd(v ? '置于主体后方' : '置于前方'); });
  }
  $('#dup', box).onclick = () => { const c = { ...clone(l), id: newId(), x: l.x + 0.03, y: l.y + 0.03 }; S.doc.layers.push(c); S.selected = c.id; commit('复制图层'); buildPanel(); };
  $('#del', box).onclick = () => bus.removeLayer(l.id);
  return box;
}

// ======================= Roll 全部 =======================
bus.rollAll = () => {
  const changed = [];
  if (isCollage()) {
    if (!S.locks.crop) { S.seeds.collage++; S.doc = applyCollage((S.doc.template || 'collage:grid').replace('collage:', ''), S.doc, collagePhotos(), S.seeds.collage); changed.push('布局'); }
  } else if (!S.locks.crop) { rollCrop(); changed.push('构图'); }
  if (!S.locks.film) { S.doc.film = { ...S.doc.film, preset: randomFilm(mulberry32(++S.seeds.film * 29), S.doc.film.preset), intensity: 1, adjust: {} }; changed.push('调色'); }
  if (!S.locks.frame && (isCollage() || (S.doc.frame.mode !== 'none' && S.doc.frame.mode !== 'film'))) { rollFrame(); changed.push('画布'); }
  if (!S.locks.caption && S.doc.layers.some(l => l.role === 'caption')) { rollCaption(); changed.push('文案'); }
  if (!S.locks.font && S.doc.layers.some(l => l.type === 'text')) { rollFont(); changed.push('字体'); }
  if (!changed.length) return toast('所有维度都已锁定');
  commit('Roll · ' + changed.join(' / '), { major: true }); buildPanel();
  toast('已 Roll：' + changed.join(' · '));
};
void isLoaded;
