// Discover (inspiration), Library (片夹) and Me pages.

import { TEMPLATES, FILMS } from './presets.js';
import { render } from './render.js';
import { newDoc, applyTemplate, bestCrop } from './templates.js';
import { listProjects, deleteProject, saveProject, prefs, setPrefs } from './store.js';
import { loadImage, analyzeFull, uid } from './media.js';
import { analyzeImage } from './analyze.js';
import { MODEL_INFO, isLoaded, warmModel, loadDetector, estimateDepth } from './ml/index.js';
import { S, bus, $, $$, el, esc, toast, fmtDate, task } from './state.js';
import { openBatchExport, openBatchStyle, modal, addToTray } from './batch.js';

export const SAMPLES = [
  { id: 'city-night', src: 'assets/samples/city-night.jpg', name: '米兰夜色' },
  { id: 'meadow', src: 'assets/samples/meadow.jpg', name: '旷野散步' },
  { id: 'telephone', src: 'assets/samples/telephone.jpg', name: '红色电话亭' },
  { id: 'reader', src: 'assets/samples/reader.jpg', name: '读书的人' },
  { id: 'tube', src: 'assets/samples/tube.jpg', name: '地铁车厢' },
  { id: 'map', src: 'assets/samples/map.jpg', name: '旅行地图' },
];

const CAPS = [
  ['DETECT', '主体识别', 'EfficientDet 定位人物与物体，构图、模板与批注都围绕主体展开。'],
  ['SEGMENT', '主体分割', 'DeepLab 生成主体蒙版：局部调整、人像虚化、文字被人物遮挡。'],
  ['DEPTH', '深度估计', 'Depth Anything V2 生成深度图：真实景深、深度蒙版、2.5D 视角。'],
  ['INPAINT', '生成式补全', 'MI-GAN 扩展画面、消除路人、补全 2.5D 视角下被遮挡的背景。'],
  ['WARP', '透视与空间', 'WebGL 单应性透视校正，深度分层视差重投影，导出动态照片。'],
  ['BATCH', '批量工作流', '片夹多选：同步设置、批量套用风格、一键打包导出 ZIP。'],
];

let D = null;
export async function initDiscover() {
  const sm = $('#samples');
  sm.innerHTML = `<span class="lab">示例底片 →</span>`;
  SAMPLES.forEach(s => { const b = el(`<button title="${s.name}"><img src="${s.src}" alt="${s.name}"></button>`); b.onclick = () => bus.openSample(s); sm.append(b); });
  $('#caps').innerHTML = CAPS.map(([k, t, d]) => `<div class="cap-card"><span class="mono">${k}</span><h4>${t}</h4><p>${d}</p></div>`).join('');
  const img = await loadImage(SAMPLES[0].src);
  // First paint with the instant heuristic analysis; refine with the detector once the page is idle.
  D = { M: { id: 'sample', img, an: analyzeImage(img), assets: new Map(), photos: new Map(), brush: new Map(), baseKey: 'o' } };
  drawDiscover();
  idle(async () => { const an = await analyzeFull(img); const moved = Math.abs(an.subject.cx - D.M.an.subject.cx) + Math.abs(an.subject.cy - D.M.an.subject.cy) > 0.03; D.M.an = an; if (moved) drawDiscover(); }, 2500);
}
// Background work queue: runs in idle time, one job at a time, paused while the deck animates.
const jobs = []; let pumping = false, pausedUntil = 0;
const idle = (fn, delay = 0) => setTimeout(() => (window.requestIdleCallback || ((f) => setTimeout(() => f({ timeRemaining: () => 8 }), 16)))(fn, { timeout: 1500 }), delay);
function queue(fn) { jobs.push(fn); if (!pumping) { pumping = true; idle(pump); } }
function pump(dl) {
  if (performance.now() < pausedUntil) { setTimeout(() => idle(pump), pausedUntil - performance.now()); return; }
  do { const j = jobs.shift(); if (j) j(); } while (jobs.length && dl && dl.timeRemaining() > 12);
  if (jobs.length) idle(pump); else pumping = false;
}
// Thumbnails render only when scrolled into view.
const io = new IntersectionObserver((ents) => ents.forEach(e => { if (e.isIntersecting && e.target._draw && e.target._stale) { e.target._stale = false; queue(e.target._draw); } }), { root: null, rootMargin: '200px' });
function lazyDraw(c, fn) { c._draw = () => { fn(); c.classList.remove('pending'); }; c._stale = true; io.unobserve(c); io.observe(c); }
async function canvasURL(c) { const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9)); return URL.createObjectURL(b); }
async function swapSrc(img, url) {
  const pre = new Image(); pre.src = url; try { await pre.decode(); } catch { }
  const old = img.src; img.src = url; img.classList.add('ready');
  if (old && old.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(old), 1000);
}

// ---- hero deck: cards glide between three slots; only transform/opacity animate ----
const HERO = ['movie', 'magazine', 'polaroid'];
const SLOTS = [
  { x: -52, y: -6, r: -7, s: 0.9, z: 1 },   // back-left
  { x: 44, y: -14, r: 5, s: 0.94, z: 2 },   // back-right
  { x: -2, y: 12, r: -1.5, s: 1, z: 3 },    // front
];
const deck = { cards: [], order: [0, 1, 2], timer: 0, built: false };
function placeDeck() {
  deck.order.forEach((ci, slot) => {
    const c = deck.cards[ci], p = SLOTS[slot];
    c.style.setProperty('--tx', p.x + '%'); c.style.setProperty('--ty', p.y + '%');
    c.style.setProperty('--rot', p.r + 'deg'); c.style.setProperty('--sc', p.s);
    c.style.zIndex = p.z; c.classList.toggle('front', slot === 2);
  });
}
function cycle(toFront) {
  pausedUntil = performance.now() + 1000;
  const i = toFront == null ? deck.order[1] : toFront;      // default: back-right card comes forward
  deck.order = deck.order.filter(x => x !== i); deck.order.push(i);
  placeDeck();
}
function autoplay(on) {
  clearInterval(deck.timer);
  if (on) deck.timer = setInterval(() => { if (S.view === 'discover' && !document.hidden && !deck.hover) cycle(); }, 4200);
}
function buildDeck() {
  const stack = $('#heroStack');
  stack.innerHTML = '<div class="deck" id="deck"></div>';
  const d = $('#deck', stack);
  deck.cards = HERO.map((id, i) => {
    const b = el(`<button class="print" aria-label="${TEMPLATES.find(t => t.id === id).name}" style="animation-delay:${i * 120}ms"><span class="print-in"><img alt=""></span></button>`);
    b.onclick = () => { const ci = deck.cards.indexOf(b); if (deck.order[2] === ci) bus.openSample(SAMPLES[0], id); else { cycle(ci); autoplay(true); } };
    d.append(b); return b;
  });
  placeDeck();
  // gentle pointer parallax, rAF-throttled
  let tx = 0, ty = 0, raf = 0;
  stack.addEventListener('pointermove', (e) => {
    const r = stack.getBoundingClientRect(); tx = (e.clientX - r.left) / r.width - 0.5; ty = (e.clientY - r.top) / r.height - 0.5;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; d.style.setProperty('--px', tx.toFixed(3)); d.style.setProperty('--py', ty.toFixed(3)); });
  });
  stack.addEventListener('pointerenter', () => { deck.hover = true; });
  stack.addEventListener('pointerleave', () => { deck.hover = false; d.style.setProperty('--px', 0); d.style.setProperty('--py', 0); });
  autoplay(true);
  deck.built = true;
}

let built = false, dirty = false;
function drawDiscover() {
  if (!D) return;
  if (S.view !== 'discover' && built) { dirty = true; return; }   // redraw lazily when the page is shown again
  dirty = false;
  const { M } = D, img = M.img, an = M.an;
  const base = (() => { const d = newDoc('sample'); d.ratio = '4:5'; d.crop = bestCrop(d, img, an, 1); return d; })();
  if (!deck.built) buildDeck();
  HERO.forEach((id, i) => queue(async () => {
    const c = document.createElement('canvas'); render(c, applyTemplate(id, base, an, img, { seed: 2 }), M, 560, { fast: true });
    swapSrc($('img', deck.cards[i]), await canvasURL(c));
  }));
  const g = $('#tplGrid'), fr = $('#filmRow');
  if (!built) {
    g.innerHTML = ''; fr.innerHTML = '';
    for (const t of TEMPLATES) {
      const b = el(`<button class="tpl-card"><div class="thumb"><canvas class="pending"></canvas></div><h4>${t.name} ${t.tag ? `<span class="tag">${t.tag}</span>` : ''}</h4><p>${t.desc}</p></button>`);
      b.onclick = () => bus.openSample(SAMPLES[0], t.id);
      g.append(b);
    }
    for (const f of FILMS) {
      const b = el(`<button class="film-card"><canvas class="pending"></canvas><b>${f.name}</b><small>${f.sub}</small></button>`);
      b.onclick = async () => { await bus.openSample(SAMPLES[0], null, 'color'); S.doc.film = { ...S.doc.film, preset: f.id, intensity: 1, adjust: {} }; bus.commit(`风格 · ${f.name}`, { major: true }); bus.buildPanel(); };
      fr.append(b);
    }
    built = true;
  }
  // redraw in place — no DOM rebuild; offscreen thumbnails wait until they scroll into view
  $$('canvas', g).forEach((c, i) => lazyDraw(c, () => render(c, applyTemplate(TEMPLATES[i].id, base, an, img, { seed: 1 }), M, 320, { fast: true })));
  $$('canvas', fr).forEach((c, i) => lazyDraw(c, () => { const f = FILMS[i]; render(c, { ...base, film: { ...base.film, preset: f.id, date: f.id === 'disposable' } }, M, 300, { fast: true }); }));
}
export const discoverShown = () => { if (dirty) drawDiscover(); };
bus.redrawDiscover = drawDiscover;

// ---------------- library ----------------
const libSel = new Set();
export async function renderLibrary() {
  const g = $('#worksGrid'), act = $('#libActions');
  let list = [];
  try { list = await listProjects(); } catch (e) { console.error(e); }
  for (const id of [...libSel]) if (!list.some(r => r.id === id)) libSel.delete(id);
  const k = libSel.size;
  act.innerHTML = `<span class="muted mono" style="margin-right:6px">${list.length} 个项目${k ? ` · 已选 ${k}` : ''}</span>
    <button class="btn sm" id="lAll">${k && k === list.length ? '取消全选' : '全选'}</button>
    <button class="btn sm" id="lStyle" ${k ? '' : 'disabled'}>批量套用</button>
    <button class="btn sm" id="lExport" ${k ? '' : 'disabled'}>导出 ZIP</button>
    <button class="btn sm" id="lTray" ${k ? '' : 'disabled'}>加入冲洗片夹</button>
    <button class="btn sm ghost" id="lDel" ${k ? '' : 'disabled'}>删除</button>
    <button class="btn sm primary" data-action="upload">导入</button>`;
  $('#lAll', act).onclick = () => { if (k === list.length) libSel.clear(); else list.forEach(r => libSel.add(r.id)); renderLibrary(); };
  $('#lStyle', act).onclick = () => openBatchStyle([...libSel]);
  $('#lExport', act).onclick = () => openBatchExport([...libSel]);
  $('#lTray', act).onclick = () => { [...libSel].forEach(addToTray); bus.renderStrip(); toast('已加入冲洗片夹'); };
  $('#lDel', act).onclick = async () => { if (!confirm(`删除 ${libSel.size} 个项目？此操作不可撤销。`)) return; for (const id of libSel) await deleteProject(id); libSel.clear(); renderLibrary(); bus.renderStrip(); };
  if (!list.length) { g.innerHTML = `<div class="empty-note">片夹是空的。<br><br><button class="btn primary" data-action="upload">导入照片</button></div>`; return; }
  g.innerHTML = '';
  list.forEach((p, i) => {
    const tname = p.doc?.kind === 'collage' ? '拼贴' : TEMPLATES.find(t => t.id === p.template)?.name;
    const w = el(`<div class="work ${libSel.has(p.id) ? 'sel' : ''}" style="animation-delay:${Math.min(i, 12) * 25}ms"><div class="wthumb"><img src="${p.thumb || ''}" alt=""><span class="ck" title="选择"></span></div>
      <div class="wmeta"><div><b>${esc(p.name)}</b><small>${fmtDate(p.updated)} · ${p.doc ? `${(p.hist || []).length} 版${tname ? ' · ' + tname : ''}` : '未冲洗'}</small></div>
      <button class="icon-btn" data-dup title="复制项目"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button></div></div>`);
    $('.ck', w).onclick = (e) => { e.stopPropagation(); libSel.has(p.id) ? libSel.delete(p.id) : libSel.add(p.id); renderLibrary(); };
    $('.wthumb', w).onclick = (e) => { if (e.shiftKey || e.metaKey || libSel.size) { libSel.has(p.id) ? libSel.delete(p.id) : libSel.add(p.id); renderLibrary(); return; } bus.openById(p.id); };
    $('[data-dup]', w).onclick = async () => { await saveProject({ ...p, id: uid('P'), name: p.name + ' 副本', updated: Date.now() }); renderLibrary(); toast('已复制项目'); };
    g.append(w);
  });
}
bus.renderLibrary = renderLibrary;

// ---------------- me ----------------
export function renderMe() {
  const p = prefs(), g = $('#meGrid');
  const my = p.myFilms || [], fav = p.favCaptions || [];
  const models = [['detect', '自动'], ['segment', '自动'], ['depth', '按需'], ['inpaint', '按需']];
  g.innerHTML = `
  <div class="me-card"><h4>端侧模型 <span class="tag ok">本机运行</span></h4>
    ${models.map(([k, mode]) => `<div class="model-row"><span>${MODEL_INFO[k].name}</span><span class="tag ${isLoaded(k) || (k === 'detect') ? 'ok' : 'gray'}">${isLoaded(k) || k === 'detect' ? '已就绪' : mode}</span><small>${MODEL_INFO[k].size} · ${{ detect: '构图与模板定位', segment: '主体蒙版 / 人像虚化 / 文字遮挡', depth: '深度景深 / 深度蒙版 / 2.5D', inpaint: 'AI 扩图 / 消除 / 遮挡补全' }[k]}</small><span></span></div>`).join('')}
    <button class="btn sm" id="warm" style="margin-top:10px">预加载全部模型（约 62 MB）</button>
    <p class="hint">模型文件随应用分发，首次使用时下载并由浏览器缓存。照片与生成结果从不离开本机。</p></div>
  <div class="me-card"><h4>我的风格</h4>${my.length ? `<div class="chips">${my.map((s, i) => `<button class="chip" data-delf="${i}">♥ ${esc(s.name)} · ${FILMS.find(f => f.id === s.preset)?.name} ✕</button>`).join('')}</div><p class="hint">可在片夹「批量套用」中一键应用到多张照片。</p>` : '<p class="hint">在「调色 → 参数微调」中调好后点「存为我的风格」。</p>'}</div>
  <div class="me-card"><h4>收藏的文案</h4>${fav.length ? `<div class="cap-list">${fav.map((t, i) => `<div class="cap"><span>${esc(t)}</span><small data-delc="${i}" style="cursor:pointer">✕</small></div>`).join('')}</div>` : '<p class="hint">在「文字」推荐列表里点 ♡ 收藏。</p>'}</div>
  <div class="me-card"><h4>导出偏好</h4>
    <label class="field">默认长边<div class="seg" id="pSize">${[['1080', '1080'], ['2048', '2048'], ['4096', '4096'], ['max', '原图']].map(([v, n]) => `<button data-v="${v}" class="${(p.expSize || '2048') === v ? 'on' : ''}">${n}</button>`).join('')}</div></label>
    <label class="field">默认格式<div class="seg" id="pFmt">${[['image/jpeg', 'JPG'], ['image/png', 'PNG'], ['image/webp', 'WebP']].map(([v, n]) => `<button data-v="${v}" class="${(p.expFmt || 'image/jpeg') === v ? 'on' : ''}">${n}</button>`).join('')}</div></label>
    <p class="hint">导出时自动移除 EXIF 与 GPS 位置信息。</p></div>
  <div class="me-card"><h4>快捷键</h4><div class="kbd-list">
    <span><kbd>1</kbd>–<kbd>9</kbd></span><span>切换工具</span><span><kbd>Space</kbd></span><span>按住对比原图</span>
    <span><kbd>R</kbd></span><span>Roll 全部未锁定维度</span><span><kbd>⌘Z</kbd> <kbd>⇧⌘Z</kbd></span><span>撤销 / 重做</span>
    <span><kbd>⌘S</kbd> <kbd>⌘E</kbd></span><span>保存 / 导出</span><span><kbd>[</kbd> <kbd>]</kbd></span><span>笔刷大小</span>
    <span><kbd>⇧</kbd> 点击</span><span>片夹多选</span><span>双击滑杆</span><span>复位参数</span></div></div>`;
  $('#warm', g).onclick = async (e) => {
    e.currentTarget.disabled = true;
    loadDetector();
    const t = task('warm', '预加载模型');
    try {
      await warmModel('depth', (pp) => t.progress(pp * 0.5, '深度 ' + Math.round(pp * 100) + '%'));
      await warmModel('inpaint', (pp) => t.progress(0.5 + pp * 0.5, '补全 ' + Math.round(pp * 100) + '%'));
      t.done('模型已就绪'); renderMe();
    } catch (err) { t.fail('加载失败：' + err.message); }
  };
  $$('[data-delf]', g).forEach(b => b.onclick = () => { my.splice(+b.dataset.delf, 1); setPrefs({ myFilms: my }); renderMe(); });
  $$('[data-delc]', g).forEach(b => b.onclick = () => { fav.splice(+b.dataset.delc, 1); setPrefs({ favCaptions: fav }); renderMe(); });
  $$('#pSize button', g).forEach(b => b.onclick = () => { setPrefs({ expSize: b.dataset.v }); renderMe(); });
  $$('#pFmt button', g).forEach(b => b.onclick = () => { setPrefs({ expFmt: b.dataset.v }); renderMe(); });
}
void modal; void estimateDepth;
