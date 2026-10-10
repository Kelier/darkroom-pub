// Templates, captions and smart annotations. Templates only produce editable doc parameters + layers.

import { CAPTIONS, FONT_PACKS, FILMS } from './presets.js';
import { composeCandidates, mulberry32, lumAt } from './analyze.js';
import { layout, cropRect, photoAspect, dateStampText, dimsOf } from './render.js';

let uid = 1;
export const newId = () => 'L' + Date.now().toString(36) + (uid++);

export function newDoc(photoId) {
  return {
    kind: 'photo', photoId, base: null, ratio: 'orig', crop: { cx: 0.5, cy: 0.5, zoom: 1 },
    geo: { rotate: 0, vert: 0, horiz: 0 }, cam: { on: false, x: 0, y: 0, zoom: 0, focus: 0.5 }, locals: [],
    frame: { mode: 'none', pad: 0.06, bottom: 0, color: '#ffffff', texture: 'none', rot: -2, photoAspect: 1, shadow: false, cardColor: '#fbfaf5' },
    film: { preset: 'none', intensity: 1, adjust: {}, date: false, seed: 3 },
    optics: { aperture: 0, focusR: 0.3, motion: 0, angle: 0, bokeh: 0, keepSubject: true },
    layers: [], template: null, captionIdx: 0, captionStyle: null,
  };
}

const todayDots = () => { const d = new Date(); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };

export function pickCaptions(an, style, seed = 0, n = 5) {
  const pool = [...(CAPTIONS[an.scene] || CAPTIONS.daily), ...CAPTIONS.daily.filter(() => an.scene !== 'daily')];
  const rng = mulberry32(seed * 31 + 5);
  const own = new Set((CAPTIONS[an.scene] || []).map(c => c.t));
  const scored = pool.map(c => ({ ...c, k: (style && c.s === style ? 0 : 1) + (own.has(c.t) ? 0 : 0.55) + rng() * 0.9 }));
  scored.sort((a, b) => a.k - b.k);
  const seen = new Set(); const out = [];
  for (const c of scored) { if (!seen.has(c.t)) { seen.add(c.t); out.push(c); } if (out.length >= n) break; }
  return out;
}

// Subject position mapped into normalized canvas coordinates.
export function subjectInCanvas(doc, img, an) {
  const L = layout(doc, img, 1000);
  const cr = cropRect(doc, img, L.photo.w / L.photo.h);
  const map = (nx, ny) => ({
    x: (L.photo.x + ((nx - (cr.cx - cr.cw / 2)) / cr.cw) * L.photo.w) / L.W,
    y: (L.photo.y + ((ny - (cr.cy - cr.ch / 2)) / cr.ch) * L.photo.h) / L.H,
  });
  const s = an.subject;
  const a = map(s.x0, s.y0), b = map(s.x1, s.y1), c = map(s.cx, s.cy);
  const clip = v => Math.min(0.98, Math.max(0.02, v));
  return { c, a: { x: clip(a.x), y: clip(a.y) }, b: { x: clip(b.x), y: clip(b.y) }, L, cr,
    photo: { x: L.photo.x / L.W, y: L.photo.y / L.H, w: L.photo.w / L.W, h: L.photo.h / L.H } };
}

export function bestCrop(doc, img, an, seed = 1, prefer) {
  const cands = composeCandidates(an, photoAspect(doc, img), seed, 8);
  let pick = cands[0];
  if (prefer === 'left') pick = cands.find(c => c.px < 0.45) || pick;     // subject on left => text right
  if (prefer === 'right') pick = cands.find(c => c.px > 0.55) || pick;
  return pick ? { ...pick.crop } : { cx: 0.5, cy: 0.5, zoom: 1 };
}

const T = (o) => ({ id: newId(), type: 'text', pack: 'minimal', size: 0.04, x: 0.5, y: 0.5, rot: 0, color: '#ffffff', align: 'center', letter: 0, line: 1.2, opacity: 1, ...o });
const S = (o) => ({ id: newId(), type: 'sticker', kind: 'star', size: 0.1, x: 0.5, y: 0.5, rot: 0, color: '#e2502c', opacity: 1, ...o });
const R = (o) => ({ id: newId(), type: 'rect', x: 0.5, y: 0.5, w: 1, h: 0.2, color: '#000', opacity: 1, ...o });

const MASTHEADS = ['MUSE', 'LUMEN', 'ODE', 'NEGATIVE', 'FRAME'];
const MOVIE = [['慢城', 'SLOW CITY'], ['夜行', 'NIGHT WALK'], ['旷野来信', 'LETTERS FROM THE FIELD'], ['第二幕', 'ACT TWO'], ['绿灯以后', 'AFTER THE GREEN LIGHT']];

export function applyTemplate(id, doc0, an, img, opts = {}) {
  const seed = opts.seed || 1, rng = mulberry32(seed * 7 + id.length);
  const doc = structuredClone(doc0);
  doc.template = id; doc.layers = [];
  const caps = pickCaptions(an, opts.style, seed, 5);
  const cap = opts.caption || caps[0].t;
  const land = dimsOf(img).w > dimsOf(img).h * 1.1;
  const film = (p, k = 1) => { if (!opts.keepFilm) doc.film = { ...doc.film, preset: p, intensity: k, adjust: {}, date: false }; };
  const set = (ratio, frame) => { doc.ratio = ratio; doc.frame = { ...doc.frame, ...frame }; };
  const flip = rng() < 0.5;

  switch (id) {
    case 'orbit': case 'book': case 'waveprint': case 'borderpoem': {
      const book=id==='book', border=id==='borderpoem';
      set(book?'3:2':border?'1:1':'3:4', {mode:book?'solid':border?'mat':'none',color:'#eee7d7',texture:book||border?'paper':'none',pad:book?.17:.075,bottom:book?.22:0});
      doc.crop=bestCrop(doc,img,an,seed);
      film(book?'warm-neg':'clear',.65);
      if(book) {
        doc.layers.push(T({role:'title',text:'光阴\n手帖',pack:'mincho',vertical:true,size:.052,x:.90,y:.40,color:'#312b24',letter:.2}));
        doc.layers.push(T({role:'caption',text:cap,pack:'hina',size:.023,x:.5,y:.87,color:'#312b24'}));
      } else {
        doc.layers.push({id:newId(),type:'flow',role:'flow',mode:border?'border':id==='orbit'?'ring':'wave',text:cap,pack:'mincho',size:border?.025:.039,x:0,y:0,rot:seed%2?0:20,color:border?'#312b24':'#fff8e5',repeat:true,offset:.02,letter:.12,shadow:!border});
        doc.layers.push(T({role:'caption',text:book?'': '光 阴 的 形 状',pack:'hina',size:.022,x:.5,y:.9,color:border?'#312b24':'#fff8e5'}));
      }
      break;
    }
    case 'polaroid': {
      set(land ? '1:1' : '4:5', { mode: 'polaroid', color: ['#e9e2d5', '#d9e4dc', '#f1d9d4', '#2a2723'][Math.floor(rng() * 4)], texture: 'paper', rot: (rng() - 0.5) * 6, photoAspect: land ? 1.15 : 0.92 });
      film('instant', 0.9);
      doc.crop = bestCrop(doc, img, an, seed);
      const L = layout(doc, img, 1000), cd = L.card;
      const by = (cd.y + cd.h - cd.b * 1.75) / L.H;
      doc.layers.push(T({ role: 'caption', text: cap, pack: 'hand', size: Math.min(0.06, 0.95 * cd.w / L.W / Math.max(8, [...cap].length) * 1.6), x: 0.5, y: by, color: '#2b2a28', rot: cd.rot * 180 / Math.PI }));
      doc.layers.push(T({ role: 'date', text: todayDots(), pack: 'hand', size: 0.03, x: (cd.x + cd.w - cd.b * 2.6) / L.W, y: (cd.y + cd.h - cd.b * 0.75) / L.H, color: '#7a7368', rot: cd.rot * 180 / Math.PI, align: 'center' }));
      if (rng() < 0.6) doc.layers.push(S({ role: 'deco', kind: 'tape', size: 0.2, x: 0.5, y: (cd.y + cd.b * 0.2) / L.H, rot: (rng() - 0.5) * 14, color: '#d9c7a6' }));
      break;
    }
    case 'magazine': {
      set('3:4', { mode: 'none' });
      film('warm-neg', 0.55);
      doc.crop = bestCrop(doc, img, an, seed, flip ? 'right' : 'left');
      const sc = subjectInCanvas(doc, img, an);
      const side = sc.c.x > 0.5 ? 'left' : 'right';
      const topLum = lumAt(an, sc.cr.cx - sc.cr.cw / 2, sc.cr.cy - sc.cr.ch / 2, sc.cr.cx + sc.cr.cw / 2, sc.cr.cy - sc.cr.ch / 2 + sc.cr.ch * 0.2);
      const ink = topLum > 0.55 ? '#141414' : '#ffffff';
      const mh = MASTHEADS[Math.floor(rng() * MASTHEADS.length)];
      doc.layers.push(T({ role: 'title', text: mh, pack: 'serif', size: mh.length > 5 ? 0.2 : 0.25, x: 0.5, y: 0.12, color: ink, letter: -0.02, weight: 900 }));
      doc.layers.push(T({ role: 'issue', text: `NO.${10 + Math.floor(rng() * 30)}  ·  OCTOBER 2026  ·  ¥38`, pack: 'minimal', size: 0.018, x: 0.5, y: 0.215, color: ink, letter: 0.25 }));
      const x = side === 'left' ? 0.06 : 0.94, al = side;
      const mcap = /[A-Z]{4}/.test(cap) ? (caps.find(c => !/[A-Z]{4}/.test(c.t))?.t || cap) : cap;
      const sub = { night: 'THE NIGHT ISSUE', city: 'CITY NOTES', nature: 'OUTSIDE', portrait: 'THE QUIET ISSUE', daily: 'EVERYDAY' }[an.scene];
      const lineInk = ink === '#ffffff' ? '#ffffff' : '#141414';
      doc.layers.push(T({ role: 'caption', text: wrap(mcap, 9), pack: 'serif', size: 0.05, x, y: 0.56, color: lineInk, align: al, italic: true, weight: 400, line: 1.15, shadow: lineInk === '#ffffff' }));
      doc.layers.push(T({ role: 'kicker', text: sub, pack: 'minimal', size: 0.022, x, y: 0.47, color: '#e2502c', align: al, letter: 0.2, weight: 700 }));
      doc.layers.push(T({ role: 'note', text: `${an.mood.join(' / ')}\n${an.sceneLabel} 特辑`, pack: 'minimal', size: 0.022, x, y: 0.68, color: lineInk, align: al, line: 1.5, shadow: lineInk === '#ffffff' }));
      doc.layers.push(S({ role: 'deco', kind: 'barcode', size: 0.16, x: side === 'left' ? 0.13 : 0.87, y: 0.92 }));
      break;
    }
    case 'movie': {
      set('2:3', { mode: 'none' });
      film('cinema', 1);
      doc.crop = bestCrop(doc, img, an, seed);
      const [cn, en] = MOVIE[Math.floor(rng() * MOVIE.length)];
      doc.layers.push(R({ role: 'shade', x: 0.5, y: 0.84, w: 1, h: 0.34, color: 'rgba(5,5,8,0.92)', grad: 'down' }));
      doc.layers.push(R({ role: 'shade', x: 0.5, y: 0.07, w: 1, h: 0.16, color: 'rgba(5,5,8,0.7)', grad: 'up' }));
      doc.layers.push(T({ role: 'tagline', text: cap, pack: 'minimal', size: 0.024, x: 0.5, y: 0.06, color: '#ffffff', letter: 0.12, opacity: 0.9 }));
      doc.layers.push(T({ role: 'title', text: cn, pack: flip ? 'serif' : 'bold', size: 0.13, x: 0.5, y: 0.77, color: '#ffffff', letter: 0.08, weight: 900, shadow: true }));
      doc.layers.push(T({ role: 'title2', text: en, pack: 'bold', size: 0.036, x: 0.5, y: 0.845, color: '#f2c14e', letter: 0.32, weight: 400 }));
      doc.layers.push(T({ role: 'credits', text: 'DARKROOM PICTURES PRESENTS  A FILM BY YOU  STARRING THE CITY\nDIRECTOR OF PHOTOGRAPHY AI STUDIO  MUSIC BY THE STREET  EDITED BY ROLL', pack: 'minimal', size: 0.0125, x: 0.5, y: 0.915, color: '#cfcac0', letter: 0.06, line: 1.6 }));
      doc.layers.push(T({ role: 'date', text: '10.09  IN CINEMAS', pack: 'minimal', size: 0.022, x: 0.5, y: 0.96, color: '#ffffff', letter: 0.3, weight: 700 }));
      break;
    }
    case 'filmstrip': {
      set(land ? '3:2' : '4:5', { mode: 'film' });
      film(flip ? 'warm-neg' : 'disposable', 1);
      doc.film.date = true; doc.film.dateText = dateStampText();
      doc.crop = bestCrop(doc, img, an, seed);
      const ph = layout(doc, img, 1000).photo, L = layout(doc, img, 1000);
      doc.layers.push(T({ role: 'caption', text: cap, pack: 'type', size: 0.026, x: (ph.x + ph.w * 0.05) / L.W, y: (ph.y + ph.h * 0.08) / L.H, color: '#fff7e8', align: 'left', shadow: true, bg: 'rgba(20,16,12,0.55)' }));
      break;
    }
    case 'journal': {
      set('4:5', { mode: 'solid', pad: 0.1, bottom: 0.16, color: '#f3ead8', texture: flip ? 'kraft' : 'paper', shadow: true });
      film('retro', 0.75);
      doc.crop = bestCrop(doc, img, an, seed);
      const sc = subjectInCanvas(doc, img, an), p = sc.photo;
      doc.layers.push(S({ role: 'deco', kind: 'tape', size: 0.22, x: p.x + 0.02, y: p.y + 0.01, rot: -38, color: '#e8c9a0' }));
      doc.layers.push(S({ role: 'deco', kind: 'tape2', size: 0.22, x: p.x + p.w - 0.02, y: p.y + 0.01, rot: 36, color: '#a7c4c2' }));
      doc.layers.push(T({ role: 'caption', text: cap, pack: 'hand', size: 0.05, x: 0.42, y: p.y + p.h + 0.075, color: '#2b2622', align: 'center' }));
      doc.layers.push(T({ role: 'date', text: todayDots(), pack: 'type', size: 0.022, x: 0.42, y: p.y + p.h + 0.13, color: '#7b6f5f', letter: 0.1 }));
      doc.layers.push(S({ role: 'deco', kind: 'stamp', size: 0.15, x: 0.86, y: p.y + p.h + 0.09, rot: -12, color: '#b8452f', text: an.scene === 'nature' ? 'FIELD' : 'CITY', sub: todayDots().slice(0, 7).replace('.', ' · ') }));
      doc.layers.push(...annotate(doc, img, an, { seed, withDate: false, withTag: false, minimal: true }));
      break;
    }
    case 'minimal': {
      set('4:5', { mode: 'solid', pad: 0.11, bottom: 0.1, color: flip ? '#ffffff' : '#f4efe6', texture: 'none' });
      film('clear', 0.6);
      doc.crop = bestCrop(doc, img, an, seed);
      const p = subjectInCanvas(doc, img, an).photo;
      doc.layers.push(T({ role: 'caption', text: cap, pack: flip ? 'minimal' : 'jp', size: 0.026, x: p.x, y: p.y + p.h + 0.055, color: '#222222', align: 'left' }));
      doc.layers.push(T({ role: 'date', text: todayDots(), pack: 'minimal', size: 0.018, x: p.x + p.w, y: p.y + p.h + 0.055, color: '#9a948a', letter: 0.15, align: 'right' }));
      break;
    }
    case 'gig': {
      set('3:4', { mode: 'none' });
      film('bw', 1);
      doc.crop = bestCrop(doc, img, an, seed);
      const col = ['#e2502c', '#2f5cff', '#f2c14e', '#19a974'][Math.floor(rng() * 4)];
      doc.layers.push(R({ role: 'block', x: 0.5, y: 0.83, w: 1, h: 0.34, color: col, blend: 'multiply' }));
      doc.layers.push(T({ role: 'title', text: 'NIGHT\nSHIFT', pack: 'bold', size: 0.17, x: 0.06, y: 0.8, color: '#ffffff', align: 'left', line: 0.95, upper: true }));
      doc.layers.push(T({ role: 'caption', text: '10.09 SHANGHAI\n10.12 TOKYO\n10.18 SEOUL\n10.25 TAIPEI', pack: 'minimal', size: 0.022, x: 0.66, y: 0.82, color: '#ffffff', align: 'left', weight: 700, line: 1.6 }));
      doc.layers.push(T({ role: 'tagline', text: 'LIVE TOUR 2026 — ' + cap, pack: 'minimal', size: 0.016, x: 0.5, y: 0.04, color: '#ffffff', letter: 0.2 }));
      doc.layers.push(S({ role: 'deco', kind: 'sparkle', size: 0.08, x: 0.86, y: 0.12, color: col }));
      break;
    }
    case 'japan': {
      set('3:4', { mode: 'solid', pad: 0.07, bottom: 0.0, color: '#f7f5f0', texture: 'paper' });
      film('clear', 0.9);
      doc.crop = bestCrop(doc, img, an, seed, flip ? 'right' : 'left');
      const sc = subjectInCanvas(doc, img, an);
      const right = sc.c.x < 0.5;
      const jcap = { night: '夜の街は\n少しだけ優しい', nature: '風のむこうへ\n歩いていく', city: 'ゆっくり\n街をあるく', portrait: 'なんでもない日\nを残して', daily: 'ふつうの日\nの記録' }[an.scene];
      const ink = lumAt(an, 0, 0, 1, 1) < 0.45 ? '#ffffff' : '#1d1d1b';
      doc.layers.push(T({ role: 'title', text: jcap, pack: 'jp', size: 0.06, x: right ? 0.82 : 0.18, y: 0.34, color: ink, vertical: true, line: 1.5, letter: 0.12, shadow: ink === '#ffffff' }));
      doc.layers.push(T({ role: 'issue', text: 'TRAVEL NOTE  vol.07', pack: 'minimal', size: 0.018, x: right ? 0.8 : 0.2, y: 0.08, color: ink, letter: 0.25 }));
      doc.layers.push(T({ role: 'num', text: '07', pack: 'jp', size: 0.11, x: right ? 0.84 : 0.16, y: 0.86, color: ink, italic: true }));
      doc.layers.push(T({ role: 'caption', text: cap, pack: 'minimal', size: 0.02, x: 0.5, y: 0.965, color: '#55524c', letter: 0.06 }));
      break;
    }
  }
  doc.captionIdx = 0;
  return doc;
}

function wrap(t, n) {
  if ([...t].length <= n || /[a-zA-Z]{3}/.test(t)) return t.length > 22 && /\s/.test(t) ? t.replace(/(.{8,16})\s/, '$1\n') : t;
  const parts = t.split(/(?<=[，。,、])/);
  if (parts.length > 1) return parts.join('\n').replace(/\n$/, '');
  const a = [...t]; const h = Math.ceil(a.length / 2); return a.slice(0, h).join('') + '\n' + a.slice(h).join('');
}

// Smart annotation: circle the subject, hand-drawn arrow + note, date & place tags.
export function annotate(doc, img, an, opts = {}) {
  const rng = mulberry32((opts.seed || 1) * 13);
  const sc = subjectInCanvas(doc, img, an);
  const L = sc.L, asp = L.W / L.H;
  const { a, b, c } = sc;
  const out = [];
  const bw = Math.max(0.12, b.x - a.x), bh = Math.max(0.12, (b.y - a.y));
  const circleW = Math.min(0.7, bw * 1.15), sy = Math.min(2.4, Math.max(0.6, (bh / asp) * 1.1 / circleW / 0.75));
  if (!opts.minimal) out.push(S({ role: 'annot', kind: 'circle', size: circleW, sy, x: c.x, y: c.y, color: '#ff5a36', rot: (rng() - 0.5) * 10 }));
  const toLeft = c.x > 0.5;
  const ax = toLeft ? Math.max(0.16, a.x - 0.13) : Math.min(0.84, b.x + 0.13), ay = Math.max(0.14, Math.min(0.75, c.y - 0.12));
  const notes = { night: 'me, waiting\nfor the light', city: 'this corner!', nature: 'the wind was\nlike this →', portrait: 'today’s mood', daily: 'keep this one' };
  out.push(S({ role: 'annot', kind: 'arrow', size: 0.16, x: ax, y: ay + 0.04, rot: toLeft ? 20 : 160, sy: toLeft ? 1 : -1, color: '#ffffff' }));
  out.push(T({ role: 'note', text: notes[an.scene], pack: 'hand', size: 0.042, x: Math.min(sc.photo.x + sc.photo.w - 0.13, Math.max(sc.photo.x + 0.13, ax + (toLeft ? -0.03 : 0.03))), y: ay - 0.045, color: '#ffffff', shadow: true, rot: (rng() - 0.5) * 8, line: 1 }));
  if (opts.withDate !== false) out.push(T({ role: 'date', text: todayDots(), pack: 'stamp', size: 0.03, x: sc.photo.x + sc.photo.w - 0.12, y: sc.photo.y + sc.photo.h - 0.04, color: '#ffa04a', shadow: true }));
  if (opts.withTag !== false) out.push(T({ role: 'tag', text: `◎ ${an.sceneLabel}`, pack: 'minimal', size: 0.022, x: sc.photo.x + 0.14, y: sc.photo.y + 0.05, color: '#1b1a17', bg: 'rgba(255,255,255,0.88)', bgRadius: 0.6, weight: 700 }));
  return out;
}

export const FONT_ROLL = { caption: ['hand', 'serif', 'minimal', 'type', 'jp', 'deco', 'mincho', 'wenkai', 'hina'], title: ['serif', 'bold', 'deco', 'jp', 'minimal', 'b1', 'tokumin', 'brush'] };

export function randomFilm(rng, current) {
  const opts = FILMS.filter(f => f.id !== 'none' && f.id !== current);
  return opts[Math.floor(rng() * opts.length)].id;
}

export { FONT_PACKS };

// ---------- collage ----------
export const COLLAGE_LAYOUTS = [
  { id: 'grid', name: '网格', desc: '等分网格 · 细白缝' },
  { id: 'mosaic', name: '主次', desc: '一大多小 · 叙事' },
  { id: 'strip', name: '大头贴', desc: '竖条连拍' },
  { id: 'contact', name: '印样', desc: '胶片联张 · 编号' },
  { id: 'polaroids', name: '拍立得墙', desc: '相纸 · 随机角度' },
  { id: 'scrap', name: '手账散落', desc: '胶带 · 自由拼贴' },
];

function cellCrop(an, img, aspect) {
  if (!an) return { cx: 0.5, cy: 0.5, zoom: 1 };
  const c = composeCandidates(an, aspect, 1, 1)[0];
  return c ? { ...c.crop } : { cx: 0.5, cy: 0.5, zoom: 1 };
}

// photos: [{ id, img, an }]
export function applyCollage(layoutId, doc0, photos, seed = 1) {
  const rng = mulberry32(seed * 13 + layoutId.length);
  const doc = structuredClone(doc0);
  doc.kind = 'collage'; doc.template = 'collage:' + layoutId;
  const keepText = doc.layers.filter(l => l.type === 'text' && l.role !== 'num');
  doc.layers = [];
  const n = photos.length;
  const ratio = { strip: '9:16', contact: n > 4 ? '3:2' : '16:9' }[layoutId] || (doc0.kind === 'collage' && doc0.ratio !== 'orig' ? doc0.ratio : '4:5');
  doc.ratio = ratio;
  const A = { '9:16': 9 / 16, '3:2': 1.5, '16:9': 16 / 9, '4:5': 0.8, '1:1': 1, '3:4': 0.75, '2:3': 2 / 3 }[ratio] || 0.8;
  const card = (p, x, y, w, h, extra = {}) => {
    const hp = h / A, m = Math.min(w, hp), b = (extra.border || 0) * m;
    const asp = Math.max(0.1, w - 2 * b) / Math.max(0.05, hp - 2 * b - (extra.bottom || 0) * hp);
    doc.layers.push({ id: newId(), type: 'photo', role: 'photo', asset: p.id, x, y, w, h, rot: 0, crop: cellCrop(p.an, p.img, asp), border: 0, borderColor: '#ffffff', shadow: false, radius: 0, opacity: 1, ...extra });
  };
  const bg = { grid: '#f4f1ea', mosaic: '#f4f1ea', strip: '#111111', contact: '#151311', polaroids: '#d9d2c5', scrap: '#efe6d4' }[layoutId];
  doc.frame = { ...doc.frame, mode: 'none', color: bg, texture: layoutId === 'scrap' ? 'kraft' : layoutId === 'polaroids' ? 'paper' : 'none' };
  if (layoutId === 'grid') {
    const cols = Math.max(1, Math.round(Math.sqrt(n * A))), rows = Math.ceil(n / cols), g = 0.018;
    const cw = (1 - g * (cols + 1)) / cols, chh = (1 - g * A * (rows + 1)) / rows;
    photos.forEach((p, i) => { const c = i % cols, r = Math.floor(i / cols); card(p, g + cw / 2 + c * (cw + g), g * A + chh / 2 + r * (chh + g * A), cw, chh); });
  } else if (layoutId === 'mosaic') {
    const g = 0.018, rest = photos.slice(1), m = Math.max(1, rest.length);
    card(photos[0], 0.5, g * A + 0.62 / 2, 1 - 2 * g, 0.62 - g * A);
    const w = (1 - g * (m + 1)) / m, top = 0.62 + g * A * 0.5, h = 1 - top - g * A;
    rest.forEach((p, i) => card(p, g + w / 2 + i * (w + g), top + h / 2, w, h));
  } else if (layoutId === 'strip') {
    const k = Math.min(n, 4), g = 0.05, h = (1 - g * A * (k + 2)) / k;
    photos.slice(0, k).forEach((p, i) => card(p, 0.5, g * A * 2 + h / 2 + i * (h + g * A), 1 - 2 * g, h));
    doc.layers.push({ id: newId(), type: 'text', role: 'date', text: 'DARKROOM · ' + todayDots(), pack: 'stamp', size: 0.05, x: 0.5, y: g * A, rot: 0, color: '#f2efe8', align: 'center', letter: 0.1, line: 1.2, opacity: 0.9 });
  } else if (layoutId === 'contact') {
    const cols = Math.min(n, n > 4 ? 3 : n), rows = Math.ceil(n / cols), g = 0.03, cw = (1 - g * (cols + 1)) / cols, chh = (0.86 - g * A * (rows - 1)) / rows;
    photos.forEach((p, i) => { const c = i % cols, r = Math.floor(i / cols); card(p, g + cw / 2 + c * (cw + g), 0.07 + chh / 2 + r * (chh + g * A), cw, chh, { radius: 0.02 });
      doc.layers.push({ id: newId(), type: 'text', role: 'num', text: `▸ ${i + 12}A`, pack: 'stamp', size: 0.018, x: g + c * (cw + g), y: 0.07 + r * (chh + g * A) + chh + 0.018, rot: 0, color: '#e58a2d', align: 'left', letter: 0.05, line: 1.2, opacity: 1 }); });
    doc.layers.push({ id: newId(), type: 'text', role: 'num', text: 'DARKROOM 400  ·  CONTACT SHEET  ·  ' + todayDots(), pack: 'stamp', size: 0.018, x: 0.03, y: 0.035, rot: 0, color: '#e58a2d', align: 'left', letter: 0.1, line: 1.2, opacity: 1 });
  } else {
    const cols = Math.max(1, Math.round(Math.sqrt(n * A * 0.9))), rows = Math.ceil(n / cols);
    const cw = 0.86 / cols, chh = 0.84 / rows, pol = layoutId === 'polaroids';
    photos.forEach((p, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const w = cw * (pol ? 0.92 : 0.95), h = Math.min(chh * 0.92, pol ? w * A * 1.18 : w * A * (0.75 + rng() * 0.5));
      card(p, 0.07 + cw / 2 + c * cw + (rng() - 0.5) * 0.03, 0.08 + chh / 2 + r * chh + (rng() - 0.5) * 0.03, w, h,
        { rot: (rng() - 0.5) * 12, border: pol ? 0.06 : 0.035, bottom: pol ? 0.16 : 0, shadow: true, borderColor: pol ? '#fbfaf5' : '#ffffff' });
      if (!pol || rng() < 0.4) doc.layers.push({ id: newId(), type: 'sticker', role: 'deco', kind: rng() < 0.5 ? 'tape' : 'tape2', size: w * 0.45, x: 0.07 + cw / 2 + c * cw, y: 0.08 + chh / 2 + r * chh - h / 2, rot: (rng() - 0.5) * 30, color: ['#e8c9a0', '#a7c4c2', '#e7b7b0'][Math.floor(rng() * 3)], opacity: 1 });
    });
  }
  doc.layers.push(...keepText);
  return doc;
}
