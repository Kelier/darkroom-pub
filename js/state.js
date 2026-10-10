// Shared editor state, DOM helpers and a late-bound command bus (avoids circular imports between UI modules).

export const S = {
  view: 'discover', tool: 'auto',
  M: null, doc: null, project: null,
  hist: [], hi: -1,
  selected: null, selLocal: null,
  compare: false, focusPick: false, showMask: true, showGrid: true, guide: 'thirds', viewDepth: false,
  brush: { size: 0.06, hard: 0.5, erase: false }, eraseMask: null,
  seeds: { crop: 1, caption: 0, layout: 1, film: 1, frame: 1, annot: 1, collage: 1 },
  locks: { crop: false, frame: false, caption: false, font: false, film: false },
  subjectLock: false,
  cropCands: [], captions: [], captionStyle: null, captionLang: 'zh', captionTab: 'ai', showExpired: false,
  tray: [], traySel: new Set(),
  info: null, lastInput: 0, dragging: false, anim: null,
  tasks: new Map(),
};

export const bus = {};   // filled by app.js: commit, buildPanel, scheduleRender, setTool, renderInsights, ...

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const clone = (o) => structuredClone(o);
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const fmtTime = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export const fmtDate = (t) => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日 ${fmtTime(t)}`; };
export const today = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };

export function toast(msg, kind = '') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + kind;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---- background task indicator (model downloads, inference, batch jobs) ----
export function task(id, label) {
  const box = $('#tasks');
  let row = S.tasks.get(id);
  if (!row) {
    row = el(`<div class="task"><div class="task-l"><span class="spin"></span><b></b><small></small></div><div class="bar"><i></i></div></div>`);
    box.append(row); S.tasks.set(id, row);
    requestAnimationFrame(() => row.classList.add('in'));
  }
  $('b', row).textContent = label;
  const api = {
    progress(p, note = '') { $('.bar i', row).style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%'; $('small', row).textContent = note; return api; },
    label(l) { $('b', row).textContent = l; return api; },
    done(msg) { row.classList.add('ok'); if (msg) $('b', row).textContent = msg; $('.bar i', row).style.width = '100%'; setTimeout(() => { row.classList.remove('in'); setTimeout(() => row.remove(), 300); S.tasks.delete(id); }, 900); },
    fail(msg) { row.classList.add('err'); $('b', row).textContent = msg; setTimeout(() => { row.classList.remove('in'); setTimeout(() => row.remove(), 300); S.tasks.delete(id); }, 3200); },
  };
  return api;
}

// ---- form widgets ----
export const FMT = {};
export const slider = (key, label, min, max, step, val, fmt = v => (+v).toFixed(2)) => (FMT[key] = fmt,
  `<div class="slider" data-sl="${key}"><label>${label}</label><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${fmt(+val)}</output></div>`);
export const tog = (key, label, on, hint = '') => `<div class="toggle"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><button class="switch ${on ? 'on' : ''}" data-tog="${key}" aria-pressed="${on}"></button></div>`;

// Live-preview slider: fast low-res render while dragging, full quality + history commit on release.
export function bindSlider(root, key, apply, label, fmt) {
  const i = $(`[data-k="${key}"]`, root); if (!i) return;
  const out = i.nextElementSibling, f = fmt || FMT[key] || (v => v.toFixed(2));
  const paint = () => { const p = (i.value - i.min) / (i.max - i.min) * 100; i.style.setProperty('--p', p + '%'); };
  paint();
  i.addEventListener('input', () => { apply(+i.value); if (out) out.textContent = f(+i.value); paint(); S.lastInput = performance.now(); bus.scheduleRender(); });
  i.addEventListener('change', () => { S.lastInput = 0; bus.commit(label); });
  i.addEventListener('dblclick', () => { const d = +(i.dataset.def ?? (+i.min < 0 ? 0 : i.min)); i.value = d; apply(d); if (out) out.textContent = f(d); paint(); bus.commit(label + ' · 复位'); });
}
export function bindToggle(root, key, fn) {
  const b = $(`[data-tog="${key}"]`, root); if (!b) return;
  b.onclick = () => { b.classList.toggle('on'); b.setAttribute('aria-pressed', b.classList.contains('on')); fn(b.classList.contains('on')); };
}
export function section(title, body, { open = true, tag = '', id = '' } = {}) {
  return `<details class="sec" ${open ? 'open' : ''} ${id ? `data-sec="${id}"` : ''}><summary>${title}${tag ? ` <span class="tag">${tag}</span>` : ''}<i class="chev"></i></summary><div class="sec-b">${body}</div></details>`;
}
