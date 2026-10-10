import {isVideo,stem,videoSource,seek,embeddedMotion,exportLive} from './live.js';
// Contact strip (session tray), batch import / sync / export, collage creation, single & video export.

import { RATIOS, TEMPLATES, FILMS } from './presets.js';
import { analyzeImage } from './analyze.js';
import { render, canvasAspect, baseOf } from './render.js';
import { newDoc, applyTemplate, bestCrop, applyCollage } from './templates.js';
import { saveProject, getProject, listProjects, prefs } from './store.js';
import { loadMedia, analyzeFull, ensureDeps, renderBlob, thumbURL, rawThumb, blobToImage, uid } from './media.js';
import { makeZip } from './zip.js';
import { S, bus, $, $$, el, esc, clone, toast, task, today } from './state.js';

const TRAY_KEY = 'darkroom-tray';
S.tray = (() => { try { return JSON.parse(localStorage.getItem(TRAY_KEY)) || []; } catch { return []; } })();
const saveTray = () => localStorage.setItem(TRAY_KEY, JSON.stringify(S.tray.slice(-60)));
export function addToTray(id) { if (!S.tray.includes(id)) { S.tray.push(id); saveTray(); } }

// ---------------- modal helper ----------------
export function modal(html, { wide = false } = {}) {
  const m = $('#modal'), c = $('#modalCard');
  c.className = 'modal-card' + (wide ? ' wide' : ''); c.innerHTML = html; m.hidden = false;
  const close = () => { m.hidden = true; c.innerHTML = ''; };
  m.onclick = (e) => { if (e.target === m && !m.dataset.lock) close(); };
  $$('[data-close]', c).forEach(b => b.onclick = close);
  return { c, close, lock: (v) => { m.dataset.lock = v ? '1' : ''; } };
}
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
const safeName = (s) => (s || 'darkroom').replace(/[\\/:*?"<>|]/g, '').slice(0, 60);
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// ---------------- contact strip ----------------
let recCache = new Map();
export async function renderStrip() {
  const box = $('#strip'); if (!box) return;
  let all = [];
  try { all = await listProjects(); } catch { }
  recCache = new Map(all.map(r => [r.id, r]));
  S.tray = S.tray.filter(id => recCache.has(id)); saveTray();
  for (const id of [...S.traySel]) if (!S.tray.includes(id)) S.traySel.delete(id);
  const n = S.tray.length, k = S.traySel.size;
  box.classList.toggle('selecting', k > 0);
  box.innerHTML = `<div class="strip-l"><b>片夹</b><small>${n} 张${k ? ` · 已选 ${k}` : ''}</small></div>
    <div class="tray" id="tray">${S.tray.map((id, i) => { const r = recCache.get(id); return `<div class="frame ${S.project?.id === id ? 'cur' : ''} ${S.traySel.has(id) ? 'sel' : ''}" data-id="${id}" title="${esc(r.name)}"><img src="${r.thumb || ''}" alt=""><span class="no">${String(i + 1).padStart(2, '0')}A</span><span class="ck" data-ck></span></div>`; }).join('')}
      <button class="frame add" data-action="upload" title="导入更多照片"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button></div>
    <div class="strip-actions">
      <div class="row2"><button class="btn xs" id="selAll">${k === n && n ? '取消全选' : '全选'}</button><button class="btn xs" id="syncBtn" ${k ? '' : 'disabled'} title="把当前照片的设置同步到选中照片">同步设置 →</button></div>
      <div class="row2"><button class="btn xs" id="colBtn" title="用选中照片创建拼贴">拼贴</button><button class="btn xs" id="bexpBtn" title="批量导出选中照片（ZIP）">批量导出</button></div>
    </div>`;
  $$('.frame[data-id]', box).forEach(f => f.onclick = (e) => {
    const id = f.dataset.id;
    if (e.target.closest('[data-ck]') || e.shiftKey || e.metaKey || e.ctrlKey) { S.traySel.has(id) ? S.traySel.delete(id) : S.traySel.add(id); renderStrip(); return; }
    if (S.project?.id !== id) bus.openById(id);
  });
  $('#selAll', box).onclick = () => { if (S.traySel.size === n) S.traySel.clear(); else S.tray.forEach(id => S.traySel.add(id)); renderStrip(); };
  $('#syncBtn', box).onclick = () => openSyncModal([...S.traySel].filter(id => id !== S.project?.id));
  $('#colBtn', box).onclick = () => createCollage();
  $('#bexpBtn', box).onclick = () => openBatchExport(S.traySel.size ? [...S.traySel] : [...S.tray]);
  const cur = $('.frame.cur', box); if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
bus.renderStrip = renderStrip;

// ---------------- import ----------------
export async function importFiles(files) {
  const all=[...files], videos=all.filter(isVideo), used=new Set(), list=[];
  for(const f of all.filter(f=>f.type.startsWith('image/')||/\.(heic|heif|jpg|png|webp)$/i.test(f.name))){const pair=videos.find(v=>stem(v)===stem(f));if(pair)used.add(pair);list.push({f,video:pair});}
  videos.filter(v=>!used.has(v)).forEach(v=>list.push({f:null,video:v}));
  if(!list.length)return toast('请选择图片、动态 JPG 或 MOV / MP4 视频','err');
  const t=task('import',`导入 ${list.length} 个作品`),ids=[],failures=[];
  for(let i=0;i<list.length;i++){
    const {f,video}=list[i];let source;
    try{
      const motion=video||(f&&await embeddedMotion(f));let cover=f,live=null;
      if(motion){source=await videoSource(motion);await seek(source,0);if(!cover)cover=await new Promise(r=>source.canvas.toBlob(r,'image/jpeg',.95));live={blob:motion,name:video?.name||'motion.mp4',duration:source.v.duration};}
      const img=await blobToImage(cover);
      const rec={id:uid('P'),name:(f||video).name.replace(/\.\w+$/,''),created:Date.now(),updated:Date.now()+i,blob:cover,live,doc:null,hist:[],thumb:rawThumb(img),assets:{}};
      await saveProject(rec);addToTray(rec.id);ids.push(rec.id);
    }catch(e){failures.push((f||video).name+': '+(e.message||'图片无法解码，可转为 JPG 后重试'));}finally{source?.dispose();}
    t.progress((i+1)/list.length,`${i+1}/${list.length}`);
  }
  t.done(`已导入 ${ids.length} 个作品`);
  if(ids.length){await bus.openById(ids[0]);if(ids.length>1){ids.slice(1).forEach(id=>S.traySel.add(id));renderStrip();}}
  if(failures.length)modal(`<h3>部分文件未能导入</h3><p class="sub">已导入 ${ids.length} 个作品。以下文件可转换格式后重试：</p><p>${failures.map(esc).join('<br>')}</p><div class="modal-actions"><button class="btn" data-close>知道了</button></div>`);

}

// ---------------- apply engine (sync / batch style) ----------------
export const SYNC_DIMS = [
  ['film', '调色风格', true], ['frame', '画布边框', true], ['ratio', '画幅 + 智能构图', true], ['template', '版式模板（按每张重新排版）', true],
  ['optics', '光学景深 / 快门', false], ['geo', '透视校正', false], ['locals', '局部调整（AI 蒙版）', false], ['layers', '文字贴纸（原样复制）', false],
];
function specFromDoc(doc, dims) {
  const s = {};
  if (dims.film) s.film = clone(doc.film);
  if (dims.frame) s.frame = clone(doc.frame);
  if (dims.ratio) s.ratio = doc.ratio;
  if (dims.template && doc.template && !doc.template.startsWith('collage')) s.template = doc.template;
  if (dims.optics) { s.optics = clone(doc.optics); delete s.optics.focusX; delete s.optics.focusY; }
  if (dims.geo) s.geo = clone(doc.geo);
  if (dims.locals) s.locals = clone((doc.locals || []).filter(l => l.mask.kind !== 'brush'));
  if (dims.layers) { s.layers = clone(doc.layers.filter(l => l.type !== 'photo')); s.assets=Object.fromEntries(s.layers.filter(l=>l.asset&&S.project.assets[l.asset]).map(l=>[l.asset,S.project.assets[l.asset]])); }
  return s;
}
async function applySpec(id, spec, label) {
  const rec = await getProject(id); if (!rec || rec.doc?.kind === 'collage') return false;
  if(spec.assets)rec.assets={...rec.assets,...spec.assets};
  const M = await loadMedia(rec);
  M.an = await analyzeFull(rec.doc?.base ? M.assets.get(rec.doc.base) || M.img : M.img); M.baseKey = rec.doc?.base || 'o';
  let doc = rec.doc ? bus.migrate(rec.doc) : (() => { const d = newDoc(rec.id); d.ratio = M.an.suggestedRatio; return d; })();
  const b = baseOf(doc, M);
  if (spec.frame) doc.frame = clone(spec.frame);
  if (spec.ratio) doc.ratio = spec.ratio;
  if (spec.ratio || !rec.doc) doc.crop = bestCrop(doc, b, M.an, 1);
  if (spec.template) doc = applyTemplate(spec.template, doc, M.an, b, { seed: 1, keepFilm: true });
  if (spec.film) doc.film = clone(spec.film);
  if (spec.optics) doc.optics = clone(spec.optics);
  if (spec.geo) doc.geo = clone(spec.geo);
  if (spec.locals) doc.locals = clone(spec.locals).map(l => ({ ...l, id: uid('L') }));
  if (spec.layers && !spec.template) doc.layers = clone(spec.layers).map(l => ({ ...l, id: uid('L') }));
  await ensureDeps(doc, M);
  const hist = [...(rec.hist || []), { label, t: Date.now(), doc: clone(doc) }].slice(-40);
  await saveProject({ ...rec, doc, hist, hi: hist.length - 1, updated: Date.now(), thumb: thumbURL(doc, M, 360), template: doc.template, kind: doc.kind });
  return true;
}
async function runApply(ids, spec, label, ui) {
  let ok = 0;
  for (let i = 0; i < ids.length; i++) {
    if (ui.cancelled) break;
    ui.step(i, ids.length);
    try { if (await applySpec(ids[i], spec, label)) ok++; } catch (e) { console.warn(e); }
  }
  ui.step(ids.length, ids.length);
  return ok;
}
function progressUI(m, okLabel) {
  const bar = $('.progress i', m.c), note = $('#pnote', m.c), go = $('#go', m.c);
  const ui = { cancelled: false, step(i, n) { bar.style.width = (i / n * 100) + '%'; note.textContent = i < n ? `处理中 ${i + 1} / ${n}` : `完成 ${n} / ${n}`; } };
  go.disabled = true; go.innerHTML = '<span class="spin"></span>处理中';
  $('[data-close]', m.c).textContent = '取消'; $('[data-close]', m.c).onclick = () => { ui.cancelled = true; m.close(); };
  void okLabel;
  return ui;
}

export function openSyncModal(ids) {
  if (!S.doc) return;
  if (!ids.length) return toast('先在片夹中勾选要同步的照片');
  const m = modal(`<h3>同步设置</h3><p class="sub">把当前照片「${esc($('#projName').value)}」的设置同步到 ${ids.length} 张照片。画幅与模板会按每张照片的主体重新计算。</p>
    <div class="checks">${SYNC_DIMS.map(([k, n, on]) => `<label class="check"><input type="checkbox" data-d="${k}" ${on ? 'checked' : ''}>${n}</label>`).join('')}</div>
    <div class="progress"><i></i></div><small class="muted" id="pnote">准备就绪</small>
    <div class="modal-actions"><button class="btn ghost" data-close>取消</button><button class="btn safe" id="go">同步到 ${ids.length} 张</button></div>`);
  $('#go', m.c).onclick = async () => {
    const dims = Object.fromEntries($$('[data-d]', m.c).map(i => [i.dataset.d, i.checked]));
    const spec = specFromDoc(S.doc, dims);
    m.lock(true); const ui = progressUI(m);
    const ok = await runApply(ids, spec, '同步设置', ui);
    m.lock(false); m.close(); renderStrip(); toast(`已同步 ${ok} 张照片`);
  };
}

export function openBatchStyle(ids) {
  const my = prefs().myFilms || [];
  const m = modal(`<h3>批量套用</h3><p class="sub">对 ${ids.length} 个项目套用同一风格 / 模板 / 画幅。拼贴项目会被跳过。</p>
    <label class="field">调色风格<select id="bFilm"><option value="">保持不变</option>${FILMS.map(f => `<option value="f:${f.id}">${f.name} · ${f.sub}</option>`).join('')}${my.map((s, i) => `<option value="m:${i}">♥ ${esc(s.name)}</option>`).join('')}</select></label>
    <label class="field">版式模板<select id="bTpl"><option value="">保持不变</option>${TEMPLATES.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}</select></label>
    <label class="field">画幅<select id="bRatio"><option value="">保持不变</option>${RATIOS.map(r => `<option value="${r.id}">${r.label}</option>`).join('')}</select></label>
    <div class="progress"><i></i></div><small class="muted" id="pnote">准备就绪</small>
    <div class="modal-actions"><button class="btn ghost" data-close>取消</button><button class="btn safe" id="go">套用到 ${ids.length} 个</button></div>`);
  $('#go', m.c).onclick = async () => {
    const f = $('#bFilm', m.c).value, spec = {};
    if (f.startsWith('f:')) spec.film = { preset: f.slice(2), intensity: 1, adjust: {}, date: f.slice(2) === 'disposable', seed: 3 };
    if (f.startsWith('m:')) { const s = my[+f.slice(2)]; spec.film = { preset: s.preset, intensity: s.intensity, adjust: { ...s.adjust }, date: s.date, seed: 3, curves: s.curves || null }; }
    if ($('#bTpl', m.c).value) spec.template = $('#bTpl', m.c).value;
    if ($('#bRatio', m.c).value) spec.ratio = $('#bRatio', m.c).value;
    if (!Object.keys(spec).length) return toast('请选择至少一项');
    m.lock(true); const ui = progressUI(m);
    const ok = await runApply(ids, spec, '批量套用', ui);
    m.lock(false); m.close(); bus.renderLibrary?.(); renderStrip(); toast(`已套用 ${ok} 个项目`);
  };
}

// ---------------- export ----------------
const expState = { size: '2048', fmt: 'image/jpeg', q: 92 };
function exportFields() {
  const p = prefs(); if (p.expSize) expState.size = p.expSize; if (p.expFmt) expState.fmt = p.expFmt;
  return `<label class="field">长边尺寸<div class="seg" id="expSize">${[['1080', '1080'], ['2048', '2048'], ['4096', '4096'], ['max', '原图']].map(([v, n]) => `<button data-v="${v}" class="${expState.size === v ? 'on' : ''}">${n}</button>`).join('')}</div></label>
    <label class="field">格式<div class="seg" id="expFmt">${[['image/jpeg', 'JPG'], ['image/png', 'PNG'], ['image/webp', 'WebP']].map(([v, n]) => `<button data-v="${v}" class="${expState.fmt === v ? 'on' : ''}">${n}</button>`).join('')}</div></label>
    <label class="field">压缩质量 <span class="mono" id="expQv">${expState.q}</span><input type="range" id="expQ" min="60" max="100" value="${expState.q}" style="--p:${(expState.q - 60) / 40 * 100}%"></label>`;
}
function bindExportFields(c, onChange) {
  $$('#expSize button', c).forEach(b => b.onclick = () => { expState.size = b.dataset.v; $$('#expSize button', c).forEach(x => x.classList.toggle('on', x === b)); onChange?.(); });
  $$('#expFmt button', c).forEach(b => b.onclick = () => { expState.fmt = b.dataset.v; $$('#expFmt button', c).forEach(x => x.classList.toggle('on', x === b)); });
  $('#expQ', c).oninput = (e) => { expState.q = +e.target.value; $('#expQv', c).textContent = e.target.value; e.target.style.setProperty('--p', (expState.q - 60) / 40 * 100 + '%'); };
}
function exportWidth(doc, M) {
  const a = canvasAspect(doc, baseOf(doc, M));
  const long = expState.size === 'max' ? Math.min(6000, Math.max(M.img.naturalWidth, M.img.naturalHeight)) : +expState.size;
  return a >= 1 ? long : Math.round(long * a);
}

export function openExportModal() {
  if (!S.doc) return;
  const m = modal(`<h3>导出</h3><p class="sub">按原图分辨率重新渲染全部参数与图层。导出文件不包含 EXIF / GPS 位置信息。</p>
    <div class="exp-preview"><canvas id="expPreview"></canvas></div>${exportFields()}
    <p class="muted small mono" id="expInfo"></p>
    <div class="modal-actions">${S.project?.live ? '<button class="btn" id="liveExp">Live 动态</button>' : ''}${S.doc.cam?.on ? '<button class="btn" id="vid">2.5D 视频</button>' : ''}<button class="btn ghost" data-close>取消</button><button class="btn primary" id="go">下载</button></div>`);
  if ($('#liveExp',m.c)) $('#liveExp',m.c).onclick=()=>{m.close();exportLive();};
  render($('#expPreview', m.c), S.doc, S.M, 520, { fast: true });
  const info = () => { const w = exportWidth(S.doc, S.M), h = Math.round(w / canvasAspect(S.doc, baseOf(S.doc, S.M))); $('#expInfo', m.c).textContent = `${w} × ${h} px`; };
  bindExportFields(m.c, info); info();
  if ($('#vid', m.c)) $('#vid', m.c).onclick = () => { m.close(); exportVideo(); };
  $('#go', m.c).onclick = async () => {
    const btn = $('#go', m.c); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>渲染中';
    await new Promise(r => setTimeout(r, 30));
    const { blob, w, h } = await renderBlob(S.doc, S.M, exportWidth(S.doc, S.M), expState.fmt, expState.q / 100);
    download(blob, `${safeName($('#projName').value)}-${w}x${h}.${EXT[expState.fmt]}`);
    m.close(); toast(`已导出 ${w}×${h} · ${(blob.size / 1048576).toFixed(1)} MB`); bus.persist();
  };
}

export function openBatchExport(ids) {
  if (!ids.length) return toast('片夹是空的');
  const m = modal(`<h3>批量导出</h3><p class="sub">导出 ${ids.length} 个项目为一个 ZIP。未编辑过的照片会先自动构图。</p>${exportFields()}
    <div class="progress"><i></i></div><small class="muted" id="pnote">准备就绪</small>
    <div class="modal-actions"><button class="btn ghost" data-close>取消</button><button class="btn primary" id="go">导出 ZIP</button></div>`);
  bindExportFields(m.c);
  $('#go', m.c).onclick = async () => {
    m.lock(true); const ui = progressUI(m);
    const files = [], names = new Set();
    for (let i = 0; i < ids.length && !ui.cancelled; i++) {
      ui.step(i, ids.length);
      try {
        const rec = await getProject(ids[i]); if (!rec) continue;
        const M = await loadMedia(rec);
        let doc = rec.doc ? bus.migrate(rec.doc) : null;
        if (!doc) { M.an = await analyzeFull(M.img); M.baseKey = 'o'; doc = newDoc(rec.id); doc.ratio = M.an.suggestedRatio; doc.crop = bestCrop(doc, M.img, M.an, 1); }
        else if (doc.kind === 'collage') { await ensureDeps(doc, M); M.an = analyzeImage(M.img); }
        else await ensureDeps(doc, M);
        const { blob, w, h } = await renderBlob(doc, M, exportWidth(doc, M), expState.fmt, expState.q / 100);
        let name = `${String(i + 1).padStart(2, '0')}-${safeName(rec.name)}-${w}x${h}.${EXT[expState.fmt]}`; while (names.has(name)) name = '_' + name; names.add(name);
        files.push({ name, data: blob });
      } catch (e) { console.warn('export failed', e); }
    }
    ui.step(ids.length, ids.length);
    if (!ui.cancelled && files.length) { download(await makeZip(files), `darkroom-${today()}-${files.length}.zip`); toast(`已导出 ${files.length} 张`); }
    m.lock(false); m.close();
  };
}

// ---------------- 2.5D video ----------------
export async function exportVideo() {
  if (!S.doc || !S.M.depth) return toast('请先在「空间」中生成深度图');
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  if (!mime) return toast('当前浏览器不支持视频录制', 'err');
  bus.stopAnim?.();
  const t = task('video', '导出 2.5D 动态视频');
  const a = canvasAspect(S.doc, baseOf(S.doc, S.M)), W = (a >= 1 ? 960 : Math.round(960 * a)) & ~1, c = document.createElement('canvas');
  c.width = W; c.height = Math.round(W / a);
  const stream = c.captureStream(0), track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10e6 }), chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  rec.start();
  const frames = 108, base = clone(S.doc.cam), amp = base.amp ?? 0.8;
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now(), ang = Math.PI * 2 * i / frames;
    const doc = { ...S.doc, cam: { ...base, on: true, x: amp * Math.sin(ang), y: amp * 0.4 * Math.cos(ang), zoom: (base.zoom || 0) + 0.25 * Math.sin(ang * 0.5) } };
    render(c, doc, S.M, W, { transient: true });
    track.requestFrame?.();
    t.progress(i / frames, `${i + 1}/${frames}`);
    const wait = 1000 / 30 - (performance.now() - t0);
    await new Promise(r => setTimeout(r, Math.max(0, wait)));
  }
  rec.stop(); await done;
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  download(blob, `${safeName($('#projName').value)}-2.5D.${mime.includes('mp4') ? 'mp4' : 'webm'}`);
  t.done(`视频已导出 · ${(blob.size / 1048576).toFixed(1)} MB`);
}

// ---------------- collage ----------------
export async function pickTrayPhotos(title = '选择照片', min = 1) {
  const all = (await listProjects()).filter(r => r.kind !== 'collage' && r.doc?.kind !== 'collage');
  if (!all.length) { toast('片夹里还没有照片'); return []; }
  return new Promise((resolve) => {
    const sel = new Set([...S.traySel].filter(id => all.some(r => r.id === id)));
    const m = modal(`<h3>${title}</h3><p class="sub">从片夹选择照片（建议 2–9 张）。</p>
      <div class="works-grid" style="padding:0;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;max-height:46vh;overflow:auto">${all.map(r => `<div class="work ${sel.has(r.id) ? 'sel' : ''}" data-id="${r.id}" style="animation:none"><div class="wthumb" style="aspect-ratio:1"><img src="${r.thumb}"><span class="ck"></span></div></div>`).join('')}</div>
      <div class="modal-actions"><button class="btn ghost" data-close>取消</button><button class="btn safe" id="go">确定（<span id="cnt">${sel.size}</span>）</button></div>`, { wide: true });
    $$('.work', m.c).forEach(w => w.onclick = () => { const id = w.dataset.id; sel.has(id) ? sel.delete(id) : sel.add(id); w.classList.toggle('sel'); $('#cnt', m.c).textContent = sel.size; });
    $('[data-close]', m.c).addEventListener('click', () => resolve([]));
    $('#go', m.c).onclick = () => { if (sel.size < min) return toast(`至少选择 ${min} 张`); m.close(); resolve(all.filter(r => sel.has(r.id)).map(r => ({ id: r.id, blob: r.blob, name: r.name }))); };
  });
}

export async function createCollage() {
  let picks = [];
  const fromTray = [...S.traySel];
  if (fromTray.length >= 2) {
    for (const id of fromTray) { const r = await getProject(id); if (r && r.doc?.kind !== 'collage' && r.kind !== 'collage') picks.push({ id: r.id, blob: r.blob, name: r.name }); }
  }
  if (picks.length < 2) picks = await pickTrayPhotos('创建拼贴', 2);
  if (picks.length < 2) return;
  picks = picks.slice(0, 9);
  const t = task('collage', `拼贴 · ${picks.length} 张`);
  const assets = {}, photos = [];
  for (const p of picks) { const id = 'C' + p.id; assets[id] = p.blob; const img = await blobToImage(p.blob); photos.push({ id, img, an: analyzeImage(img) }); }
  const d0 = newDoc('collage'); d0.kind = 'collage'; d0.film = { ...d0.film, preset: 'warm-neg', intensity: 0.5 };
  const doc = applyCollage(picks.length > 4 ? 'grid' : 'polaroids', d0, photos, 1);
  const rec = { id: uid('P'), name: `拼贴 · ${picks.length} 张`, created: Date.now(), updated: Date.now(), blob: picks[0].blob, assets, doc, hist: [{ label: '创建拼贴', t: Date.now(), doc: clone(doc) }], hi: 0, kind: 'collage', thumb: null, template: doc.template };
  await saveProject(rec); t.done('拼贴已创建');
  S.traySel.clear();
  await bus.openRecord(rec, { tool: 'layout' });
  bus.persist();
}
bus.createCollage = createCollage;
void RATIOS;
