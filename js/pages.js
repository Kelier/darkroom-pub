// Discover (inspiration), Library (片夹) and Me pages.

import { TEMPLATES, FILMS } from './presets.js';
import { render } from './render.js';
import { newDoc, applyTemplate, bestCrop, subjectInCanvas } from './templates.js';
import { STICKERS } from './stickers.js';
export const STOCK_COLORS = ['#ddd2b8', '#d4a638', '#9bac8a', '#c8aa91', '#d78053', '#829ea4', '#c1beb3', '#90a8b1', '#b7825c'];
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


let D = null;
// Six chapters; each one pins a darkroom sticker to the print as it scrolls into view.
const STEPS = [
  { k: 'canister', code: 'LOAD', t: '装片', d: '九款自有胶卷。装载即显影，色彩、颗粒、暗角与漏光一次到位，强度与曲线还能再调。', go: ['color'] },
  { k: 'loupe', code: 'FRAME', t: '构图', d: '端侧模型找到主体，给出构图候选。人物落在最好的位置，拖动或双指缩放即可微调。', go: ['crop'] },
  { k: 'seal', code: 'TYPE', t: '排字', d: '文字绕开人物流动：光环、螺旋、波浪、四边诗笺。明朝与书法字体，随手可换。', go: ['layout', 'orbit'] },
  { k: 'polaroid', code: 'LAYOUT', t: '版式', d: '拍立得、杂志、电影海报。锁定想保留的维度，其余交给 Roll 重新洗牌。', go: ['layout', 'magazine'] },
  { k: 'live', code: 'LIVE', t: '实况', d: 'iPhone 实况与安卓动态照片直接放进来；冲洗完导出原生格式，回到相册依然会动。', go: ['auto'] },
  { k: 'timer', code: 'DEVELOP', t: '显影', d: '原片从不被覆盖，每一步都能回退。熄灯，作品留在桌上；导出，即是定影。', go: ['layout', 'polaroid'] },
];
const SLOTS = [[-15, 8, -14], [83, 2, 10], [-13, 64, 8], [86, 58, -9], [36, -12, -5], [62, 88, 6]];
export async function initDiscover() {
  const sm = $('#samples');
  sm.innerHTML = '';
  SAMPLES.forEach((s, i) => { const b = el(`<button title="${s.name}"><img src="${s.src}" alt="${s.name}"><i>${String(i + 1).padStart(2, '0')}</i></button>`); b.onclick = () => bus.openSample(s); sm.append(b); });
  $('#heroSign').innerHTML = STICKERS.donotopen; $('#heroBadge').innerHTML = STICKERS.safelight; $('#finalStk').innerHTML = STICKERS.seal;
  $('#heroSample').onclick = () => bus.openSample(SAMPLES[0]);
  buildStory();
  const img = await loadImage(SAMPLES[0].src);
  // First paint with the instant heuristic analysis; refine with the detector once the page is idle.
  D = { M: { id: 'sample', img, an: analyzeImage(img), assets: new Map(), photos: new Map(), brush: new Map(), baseKey: 'o' } };
  drawDiscover();
  idle(async () => { const an = await analyzeFull(img); const moved = Math.abs(an.subject.cx - D.M.an.subject.cx) + Math.abs(an.subject.cy - D.M.an.subject.cy) > 0.03; D.M.an = an; if (moved) drawDiscover(); }, 2500);
}
function buildStory() {
  $('#storySteps').innerHTML = STEPS.map((s, i) => `<li class="step" data-i="${i}"><span class="step-stk">${STICKERS[s.k]}</span><span class="step-no">${String(i + 1).padStart(2, '0')} <i>/ 06</i> · ${s.code}</span><h3>${s.t}</h3><p>${s.d}</p><button class="step-go" data-i="${i}">在暗房里试试 <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></li>`).join('');
  $('#storyIndex').innerHTML = STEPS.map((s, i) => `<button data-i="${i}"><b>${String(i + 1).padStart(2, '0')}</b>${s.t}</button>`).join('');
  $('#storyStickers').innerHTML = STEPS.map((s, i) => `<span class="pin" data-i="${i}" style="--x:${SLOTS[i][0]}%;--y:${SLOTS[i][1]}%;--r:${SLOTS[i][2]}deg">${STICKERS[s.k]}</span>`).join('');
  $('#storyPrint').innerHTML = STEPS.map((s, i) => `<div class="ly ${i === 0 ? 'on' : ''}" data-i="${i}"><canvas class="pending"></canvas>${s.k === 'live' ? '<span class="live-badge"><i></i>LIVE</span>' : ''}</div>`).join('');
  $$('.step-go').forEach(b => b.onclick = () => { const [tool, tpl] = STEPS[+b.dataset.i].go; bus.openSample(SAMPLES[0], tpl, tool); });
  $$('#storyIndex button').forEach(b => b.onclick = () => $(`.step[data-i="${b.dataset.i}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' }));
  const setStep = (i) => {
    $$('.step').forEach(x => x.classList.toggle('on', +x.dataset.i === i));
    $$('#storyIndex button').forEach(x => x.classList.toggle('on', +x.dataset.i === i));
    $$('#storyPrint .ly').forEach(x => x.classList.toggle('on', +x.dataset.i === i));
    $$('#storyStickers .pin').forEach(x => { const k = +x.dataset.i; x.classList.toggle('stuck', k <= i); x.classList.toggle('cur', k === i); });
  };
  const obs = new IntersectionObserver((ents) => ents.forEach(e => { if (e.isIntersecting) setStep(+e.target.dataset.i); }), { root: $('#view-discover'), rootMargin: matchMedia('(max-width:760px)').matches ? '-66% 0px -26% 0px' : '-45% 0px -45% 0px' });
  $$('.step').forEach(x => obs.observe(x));
  // hero: the print develops as you arrive, then drifts with the scroll
  const v = $('#view-discover'), hero = $('#drHero');
  v.addEventListener('scroll', () => { const k = Math.min(1, v.scrollTop / Math.max(1, hero.offsetHeight)); hero.style.setProperty('--k', k.toFixed(3)); }, { passive: true });
  setStep(0);
}
// Marks the detected subject on the framing chapter, like a grease-pencil box on a proof.
function markSubject(c, doc, img, an) {
  const sc = subjectInCanvas(doc, img, an), x = c.getContext('2d'), u = c.width / 400;
  const X = sc.a.x * c.width, Y = sc.a.y * c.height, W = (sc.b.x - sc.a.x) * c.width, H = (sc.b.y - sc.a.y) * c.height;
  x.save(); x.strokeStyle = '#ff4836'; x.lineWidth = 2 * u; x.setLineDash([7 * u, 5 * u]); x.strokeRect(X, Y, W, H); x.setLineDash([]);
  x.font = `600 ${11 * u}px Inter, sans-serif`; const tag = 'AI 主体 · ' + (an.subject.label === 'person' ? '人物' : '主体'), tw = x.measureText(tag).width + 12 * u;
  x.fillStyle = '#ff4836'; x.fillRect(X, Y - 20 * u, tw, 20 * u); x.fillStyle = '#fff'; x.fillText(tag, X + 6 * u, Y - 6 * u); x.restore();
}
// Background work queue: runs in idle time, one job at a time.
const jobs = []; let pumping = false;
const idle = (fn, delay = 0) => setTimeout(() => (window.requestIdleCallback || ((f) => setTimeout(() => f({ timeRemaining: () => 8 }), 16)))(fn, { timeout: 1500 }), delay);
function queue(fn) { jobs.push(fn); if (!pumping) { pumping = true; idle(pump); } }
function pump(dl) {
  do { const j = jobs.shift(); if (j) j(); } while (jobs.length && dl && dl.timeRemaining() > 12);
  if (jobs.length) idle(pump); else pumping = false;
}
// Thumbnails render only when scrolled into view.
const io = new IntersectionObserver((ents) => ents.forEach(e => { if (e.isIntersecting && e.target._draw && e.target._stale) { e.target._stale = false; queue(e.target._draw); } }), { root: null, rootMargin: '300px' });
function lazyDraw(c, fn) { c._draw = () => { fn(); c.classList.remove('pending'); }; c._stale = true; io.unobserve(c); io.observe(c); }

let built = false, dirty = false;
function drawDiscover() {
  if (!D) return;
  if (S.view !== 'discover' && built) { dirty = true; return; }   // redraw lazily when the page is shown again
  dirty = false;
  const { M } = D, img = M.img, an = M.an;
  const base = (() => { const d = newDoc('sample'); d.ratio = '4:5'; d.crop = bestCrop(d, img, an, 1); return d; })();
  const film = (id) => ({ ...base, film: { ...base.film, preset: id, intensity: 1, date: id === 'disposable' } });
  const docs = [film('cinema'), base, applyTemplate('orbit', base, an, img, { seed: 2 }), applyTemplate('magazine', base, an, img, { seed: 2 }), film('warm-neg'), applyTemplate('polaroid', film('instant'), an, img, { seed: 2 })];
  $$('#storyPrint canvas').forEach((c, i) => lazyDraw(c, () => { render(c, docs[i], M, 720, { fast: true }); if (i === 1) markSubject(c, docs[i], img, an); }));
  const g = $('#tplGrid'), fr = $('#filmRow');
  if (!built) {
    g.innerHTML = ''; fr.innerHTML = '';
    TEMPLATES.forEach((t, i) => {
      const b = el(`<button class="tpl-card"><div class="thumb"><canvas class="pending"></canvas><span class="grease"></span></div><span class="fno">${String(i + 1).padStart(2, '0')}A ▸</span><h4>${t.name}</h4><p>${t.desc}</p></button>`);
      b.onclick = () => bus.openSample(SAMPLES[0], t.id);
      g.append(b);
    });
    FILMS.forEach((f, i) => {
      const b = el(`<button class="stock lg" style="--stock:${STOCK_COLORS[i % STOCK_COLORS.length]}"><span class="stock-img"><canvas class="pending"></canvas></span><span class="stock-meta"><b>${f.name}</b><em>${f.sub}</em></span></button>`);
      b.onclick = async () => { await bus.openSample(SAMPLES[0], null, 'color'); bus.loadFilm(f.id); };
      fr.append(b);
    });
    built = true;
  }
  // redraw in place — no DOM rebuild; offscreen thumbnails wait until they scroll into view
  $$('canvas', g).forEach((c, i) => lazyDraw(c, () => render(c, applyTemplate(TEMPLATES[i].id, base, an, img, { seed: 1 }), M, 360, { fast: true })));
  $$('canvas', fr).forEach((c, i) => lazyDraw(c, () => render(c, film(FILMS[i].id), M, 300, { fast: true })));
}
export const discoverShown = () => { if (dirty) drawDiscover(); };
bus.redrawDiscover = drawDiscover;

// ---------------- library: one 35 mm roll pulled down from its canister ----------------
const libSel = new Set();
let rollIO = null;
export async function renderLibrary() {
  const g = $('#worksGrid'), act = $('#libActions');
  let list = [];
  try { list = await listProjects(); } catch (e) { console.error(e); }
  for (const id of [...libSel]) if (!list.some(r => r.id === id)) libSel.delete(id);
  const k = libSel.size;
  $('#rollCan').innerHTML = STICKERS.canister;
  $('#rollCount').textContent = list.length ? `${list.length} 帧${k ? ` · 已圈选 ${k}` : ''} · 点帧冲洗，点圈圈选` : '还没有底片';
  act.innerHTML = `<button class="btn sm" id="lAll">${k && k === list.length ? '取消全选' : '全选'}</button>
    <button class="btn sm" id="lStyle" ${k ? '' : 'disabled'}>批量套用</button>
    <button class="btn sm" id="lExport" ${k ? '' : 'disabled'}>导出 ZIP</button>
    <button class="btn sm" id="lTray" ${k ? '' : 'disabled'}>加入冲洗片夹</button>
    <button class="btn sm ghost" id="lDel" ${k ? '' : 'disabled'}>删除</button>
    <button class="btn sm primary" data-action="upload">放入底片</button>`;
  $('#lAll', act).onclick = () => { if (k === list.length) libSel.clear(); else list.forEach(r => libSel.add(r.id)); renderLibrary(); };
  $('#lStyle', act).onclick = () => openBatchStyle([...libSel]);
  $('#lExport', act).onclick = () => openBatchExport([...libSel]);
  $('#lTray', act).onclick = () => { [...libSel].forEach(addToTray); bus.renderStrip(); toast('已加入冲洗片夹'); };
  $('#lDel', act).onclick = async () => { if (!confirm(`删除 ${libSel.size} 个项目？此操作不可撤销。`)) return; for (const id of libSel) await deleteProject(id); libSel.clear(); renderLibrary(); bus.renderStrip(); };
  const fresh = !g.children.length;
  if (!list.length) { g.className = 'reel empty'; g.innerHTML = `<div class="roll-leader"></div><div class="empty-note">这卷胶片还是空的。<br><button class="btn primary" data-action="upload">放入第一张底片</button></div>`; return; }
  g.className = 'reel' + (fresh ? ' unspool' : '');
  g.innerHTML = '<div class="roll-leader"><span>DARKROOM 400 · 36 EXP</span></div>';
  rollIO?.disconnect();
  rollIO = new IntersectionObserver((ents) => ents.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); rollIO.unobserve(e.target); } }), { root: $('#view-library'), rootMargin: '0px 0px -8% 0px' });
  list.forEach((p, i) => {
    const tname = p.doc?.kind === 'collage' ? '拼贴' : TEMPLATES.find(t => t.id === p.template)?.name;
    const no = String(i + 1).padStart(2, '0');
    const w = el(`<article class="rf ${libSel.has(p.id) ? 'sel' : ''}" style="--d:${Math.min(i, 8) * 70}ms">
      <span class="rf-edge l">DARKROOM 400 ▸ ${no}</span><span class="rf-edge r">${no}A ◂ ${i % 2 ? 'KD' : 'DR'}·${(37 - i % 36)}</span>
      <div class="rf-win"><img src="${p.thumb || ''}" alt="${esc(p.name)}" loading="lazy">${p.live ? '<span class="wlive"><i></i>LIVE</span>' : ''}<span class="rf-open">冲洗 →</span></div>
      <aside class="rf-note"><button class="ck" title="圈选"><svg viewBox="0 0 60 40"><path d="M8 22c2-12 20-17 33-14 13 3 15 14 6 21-10 7-32 6-38-2-3-4-1-9 3-12"/></svg></button>
        <b>${esc(p.name)}</b><small>${fmtDate(p.updated)}</small><small>${p.doc ? `${(p.hist || []).length} 版${tname ? ' · ' + tname : ''}` : '未冲洗'}</small>
        <button class="rf-dup" data-dup title="复制项目">复制</button></aside></article>`);
    $('.ck', w).onclick = (e) => { e.stopPropagation(); libSel.has(p.id) ? libSel.delete(p.id) : libSel.add(p.id); renderLibrary(); };
    $('.rf-win', w).onclick = (e) => { if (e.shiftKey || e.metaKey || libSel.size) { libSel.has(p.id) ? libSel.delete(p.id) : libSel.add(p.id); renderLibrary(); return; } bus.openById(p.id); };
    $('[data-dup]', w).onclick = async () => { await saveProject({ ...p, id: uid('P'), name: p.name + ' 副本', updated: Date.now() }); renderLibrary(); toast('已复制项目'); };
    g.append(w);
    if (fresh) rollIO.observe(w); else w.classList.add('in');
  });
  g.append(el(`<div class="roll-tail"><span>END OF ROLL · ${list.length} EXP</span></div>`));
}
// The canister spool turns as the roll is pulled.
$('#view-library').addEventListener('scroll', (e) => $('#rollCan').style.setProperty('--spin', (e.target.scrollTop / 3) + 'deg'), { passive: true });
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
