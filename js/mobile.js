// Phone editor: full-screen workspace, draggable tool sheet, pinch-to-zoom, press-and-hold compare, overflow menu.
import { S, bus, $, $$, toast, esc, fmtTime } from './state.js';
import { TOOLS } from './panels.js';
import { cropSize, clampCrop } from './analyze.js';
import { dimsOf, baseOf } from './render.js';
import { openLiveImport, exportLive, isMobileUI } from './live.js';

const editor = $('#editor'), panel = $('#panel'), grip = $('#sheetGrip'), ov = $('#overlay');
const SNAP = { min: 0, mid: 0.36, max: 0.64 };

// ---------------- tool sheet ----------------
function setSheet(state) {
  editor.dataset.sheet = state; editor.style.removeProperty('--sheet-h');
  grip.setAttribute('aria-valuenow', Math.round(SNAP[state] * 100));
}
setSheet('mid');
const syncTool = () => {
  const t = panel.dataset.tool || S.tool; editor.dataset.tool = t;
  $('#sheetTitle').textContent = TOOLS.find(x => x.id === t)?.name || '';
};
new MutationObserver(syncTool).observe(panel, { attributes: true, attributeFilter: ['data-tool'] });
// Tapping the active tool folds the sheet away; tapping another opens it.
$('#tools').addEventListener('click', (e) => {
  if (!isMobileUI()) return;
  const b = e.target.closest('[data-tool]'); if (!b) return;
  if (b.dataset.tool === editor.dataset.tool) setSheet(editor.dataset.sheet === 'min' ? 'mid' : 'min');
  else if (editor.dataset.sheet === 'min') setSheet('mid');
  b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}, true);
const rail = $('#tools');
rail.addEventListener('scroll', () => rail.classList.toggle('at-end', rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4), { passive: true });
// Drag the grip; release snaps to the nearest of folded / half / tall.
let gd = null;
grip.addEventListener('pointerdown', (e) => {
  try { grip.setPointerCapture(e.pointerId); } catch {}
  gd = { y: e.clientY, h: panel.getBoundingClientRect().height, t: performance.now(), moved: false };
  editor.classList.add('sheet-drag');
});
grip.addEventListener('pointermove', (e) => {
  if (!gd) return;
  const dy = gd.y - e.clientY; if (Math.abs(dy) > 4) gd.moved = true;
  const h = Math.max(0, Math.min(innerHeight * 0.72, gd.h + dy));
  editor.style.setProperty('--sheet-h', h + 'px'); gd.last = h;
});
const gripEnd = (e) => {
  if (!gd) return; editor.classList.remove('sheet-drag');
  const d = gd; gd = null;
  if (!d.moved) { setSheet(editor.dataset.sheet === 'min' ? 'mid' : editor.dataset.sheet === 'mid' ? 'max' : 'min'); return; }
  const v = (d.y - e.clientY) / Math.max(1, performance.now() - d.t), f = (d.last ?? d.h) / innerHeight;
  // a quick flick wins over position
  const s = v > 0.5 ? (editor.dataset.sheet === 'min' ? 'mid' : 'max') : v < -0.5 ? (editor.dataset.sheet === 'max' ? 'mid' : 'min')
    : Object.entries(SNAP).sort((a, b) => Math.abs(a[1] - f) - Math.abs(b[1] - f))[0][0];
  setSheet(s);
};
grip.addEventListener('pointerup', gripEnd); grip.addEventListener('pointercancel', gripEnd);

// ---------------- stage gestures: pinch zoom + press-and-hold compare ----------------
const pts = new Map(); let pinch = null, hold = null, holding = false;
const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
ov.addEventListener('pointerdown', (e) => {
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
  clearTimeout(hold);
  if (pts.size === 2 && S.doc && S.doc.kind !== 'collage' && S.info) {
    bus.cancelDrag(); bus.setCompare(false); holding = false;
    pinch = { d0: dist(), z0: S.doc.crop.zoom || 1, cx: S.info.crop.cx, cy: S.info.crop.cy };
    e.stopImmediatePropagation(); return;
  }
  if (pts.size === 1 && e.pointerType !== 'mouse' && S.tool !== 'local' && !S.focusPick) {
    hold = setTimeout(() => { holding = true; bus.cancelDrag(); bus.setCompare(true); navigator.vibrate?.(8); }, 420);
  }
}, true);
ov.addEventListener('pointermove', (e) => {
  const p = pts.get(e.pointerId); if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) clearTimeout(hold);
  if (holding) { e.stopImmediatePropagation(); return; }
  if (!pinch || pts.size < 2) return;
  e.stopImmediatePropagation();
  const ph = S.info.L.photo, { w, h } = dimsOf(baseOf(S.doc, S.M));
  const z = Math.min(4, Math.max(1, pinch.z0 * dist() / Math.max(1, pinch.d0)));
  const { cw, ch } = cropSize(w, h, ph.w / ph.h, z);
  S.doc.crop = clampCrop({ ...S.doc.crop, cx: pinch.cx, cy: pinch.cy, zoom: z }, cw, ch);
  S.lastInput = performance.now(); bus.scheduleRender();
}, true);
const ptEnd = (e) => {
  if (!pts.delete(e.pointerId)) return;
  clearTimeout(hold);
  if (holding && !pts.size) { holding = false; bus.setCompare(false); e.stopImmediatePropagation(); bus.cancelDrag(); }
  if (pinch && pts.size < 2) { pinch = null; S.lastInput = 0; bus.cancelDrag(); bus.commit('缩放构图'); e.stopImmediatePropagation(); }
};
ov.addEventListener('pointerup', ptEnd, true); ov.addEventListener('pointercancel', ptEnd, true);

// ---------------- top bar ----------------
$('#edBack').onclick = () => { bus.persist?.(); bus.go('library'); };
const scrim = $('#mScrim');
function closeInsp() { $('#edMain').classList.remove('show-insp'); scrim.hidden = true; }
scrim.onclick = closeInsp;
$('#moreBtn').onclick = async () => {
  const { modal } = await import('./batch.js');
  const live = !!S.project?.live?.blob, lights = editor.classList.contains('lights-out');
  const items = [
    ['rename', '重命名', esc($('#projName').value || '未命名')],
    ['save', '保存到片夹', $('#saveState').textContent || ''],
    ['hist', '版本历史', `${S.hist.length} 个版本`],
    ['live', live ? '导出实况' : '导入实况 / 动态照片', live ? 'iPhone 实况 · 安卓动态照片 · MP4' : '动态 JPG、HEIC + MOV、LIVP'],
    ['info', 'AI 分析与直方图', ''],
    ['strip', editor.classList.contains('show-strip') ? '收起胶片条' : '显示胶片条', '批量同步、拼贴'],
    ['lights', lights ? '开灯' : '熄灯模式', '隐藏工具，只看作品'],
    ['reset', '还原底片', '回到拍摄原片，可撤销', 'danger'],
  ];
  const list = (isMobileUI() ? items : items.filter(([k]) => !['lights', 'info'].includes(k))).map(([k, t, s, c]) => `<button class="act ${c || ''}" data-a="${k}"><b>${t}</b>${s ? `<small>${s}</small>` : ''}</button>`).join('');
  if (!isMobileUI()) {
    const p = $('#histPop'), r = $('#moreBtn').getBoundingClientRect();
    if (!p.hidden && p.dataset.kind === 'more') { p.hidden = true; return; }
    p.dataset.kind = 'more'; p.innerHTML = `<div class="act-sheet">${list}</div>`; p.hidden = false;
    p.style.left = Math.max(8, r.right - 290) + 'px'; p.style.top = (r.bottom + 8) + 'px';
    $$('[data-a]', p).forEach(b => b.onclick = () => { p.hidden = true; act(b.dataset.a); });
    return;
  }
  const m = modal(`<div class="act-sheet">${list}</div><div class="modal-actions stack"><button class="btn ghost" data-close>取消</button></div>`);
  $$('[data-a]', m.c).forEach(b => b.onclick = () => { m.close(); act(b.dataset.a); });
};
async function act(a) {
  if (a === 'rename') { const { modal } = await import('./batch.js'); const m = modal(`<h3>重命名</h3><input class="m-input" id="mName" value="${esc($('#projName').value)}" maxlength="60" enterkeyhint="done"><div class="modal-actions stack"><button class="btn primary" id="mOk">完成</button><button class="btn ghost" data-close>取消</button></div>`); const i = $('#mName', m.c); setTimeout(() => i.select(), 60); const ok = () => { $('#projName').value = i.value.trim() || '未命名'; $('#projName').dispatchEvent(new Event('change')); m.close(); }; $('#mOk', m.c).onclick = ok; i.onkeydown = (e) => { if (e.key === 'Enter') ok(); }; }
  if (a === 'save') $('#saveBtn').click();
  if (a === 'hist') { const { modal } = await import('./batch.js'); const m = modal(`<h3>版本历史</h3><div class="hist-list">${S.hist.map((h, i) => `<button class="hist-item ${i === S.hi ? 'cur' : ''}" data-i="${i}"><span>${String(i + 1).padStart(2, '0')} · ${esc(h.label)}</span><small>${fmtTime(h.t)}</small></button>`).reverse().join('')}</div><div class="modal-actions stack"><button class="btn ghost" data-close>关闭</button></div>`); $$('.hist-item', m.c).forEach(b => b.onclick = () => { bus.restore(+b.dataset.i); m.close(); }); }
  if (a === 'live') S.project?.live?.blob ? exportLive() : openLiveImport();
  if (a === 'info' && !isMobileUI()) return $('#inspBtn').click();
  if (a === 'info') { $('#edMain').classList.add('show-insp'); scrim.hidden = false; bus.renderInsights?.(); }
  if (a === 'strip') { editor.classList.toggle('show-strip'); }
  if (a === 'lights') $('#darkenBtn').click();
  if (a === 'reset') $('#resetOriginal').click();
}
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInsp(); });
// Leaving lights-out on a phone: tap anywhere on the dark stage.
$('#stage').addEventListener('click', (e) => { if (isMobileUI() && editor.classList.contains('lights-out') && !e.target.closest('button,input')) $('#darkenBtn').click(); });
if (S.view) document.body.dataset.page = S.view;
