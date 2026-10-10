// Subject-aware text flow: text on a ring / silhouette contour / arc, magazine run-around paragraphs, flanking columns.

import { fontString } from './presets.js';

export const FLOW_MODES = [
  {id:'wave',name:'波浪文字',desc:'横跨照片的流动曲线'},
  {id:'border',name:'四边环绕',desc:'沿相纸四边连续排字'},
  {id:'rays',name:'放射排版',desc:'从中心向四周放射的文字'},
  { id: 'ring', name: '光环环绕', desc: '围绕头部的圆环文字' },
  { id: 'contour', name: '轮廓环绕', desc: '沿人物剪影外沿流动' },
  { id: 'wrap', name: '杂志绕排', desc: '段落绕开主体排版' },
  { id: 'arc', name: '弧形标题', desc: '头顶上方的弧线标题' },
  { id: 'columns', name: '双侧竖排', desc: '主体两侧对称竖排' },
  { id: 'spiral', name: '螺旋', desc: '由主体向外旋出' },
];

// Geometry of the subject in canvas pixels, built once per render from the subject mask (or the detection box).
export function buildSubjectGeometry({ an, crop, photo, mask }) {
  const ph = photo, cr = crop, s = an.subject;
  const map = (nx, ny) => [ph.x + ((nx - (cr.cx - cr.cw / 2)) / cr.cw) * ph.w, ph.y + ((ny - (cr.cy - cr.ch / 2)) / cr.ch) * ph.h];
  let [x0, y0] = map(s.x0, s.y0), [x1, y1] = map(s.x1, s.y1), [cx, cy] = map(s.cx, s.cy);
  let grid = null, gw = 0, gh = 0;
  if (mask) {
    gw = mask.width; gh = mask.height;
    const d = mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, gw, gh).data;
    grid = new Uint8Array(gw * gh);
    let n = 0, sx = 0, sy = 0, a = gw, b = gh, c = 0, e = 0;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (d[(y * gw + x) * 4 + 3] > 110) { grid[y * gw + x] = 1; n++; sx += x; sy += y; a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); e = Math.max(e, y); }
    if (n > gw * gh * 0.004) {
      const px = (gx) => ph.x + gx / gw * ph.w, py = (gy) => ph.y + gy / gh * ph.h;
      x0 = px(a); y0 = py(b); x1 = px(c + 1); y1 = py(e + 1); cx = px(sx / n); cy = py(sy / n);
    } else grid = null;
  }
  const bw = Math.max(20, x1 - x0), bh = Math.max(20, y1 - y0);
  const head = [cx, y0 + Math.min(bh * 0.16, bw * 0.55)];
  const inside = (X, Y) => {
    if (!grid) return X >= x0 && X <= x1 && Y >= y0 && Y <= y1;
    const gx = Math.floor((X - ph.x) / ph.w * gw), gy = Math.floor((Y - ph.y) / ph.h * gh);
    return gx >= 0 && gy >= 0 && gx < gw && gy < gh && grid[gy * gw + gx] === 1;
  };
  // Star-shaped silhouette by radial marching from the centroid, smoothed, pushed outward by `off`.
  const contour = (off) => {
    const N = 144, R = [], maxR = Math.hypot(ph.w, ph.h);
    for (let i = 0; i < N; i++) {
      const t = i / N * Math.PI * 2, dx = Math.cos(t), dy = Math.sin(t);
      let r = 0;
      if (grid) { const step = ph.w / gw; for (let k = step; k < maxR; k += step) if (inside(cx + dx * k, cy + dy * k)) r = k; }
      else r = 1 / Math.hypot(dx / (bw / 2), dy / (bh / 2));
      R.push(r || Math.min(bw, bh) * 0.3);
    }
    const S = R.map((_, i) => { let t = 0; for (let k = -4; k <= 4; k++) t += R[(i + k + N) % N]; return t / 9; });
    return S.map((r, i) => { const t = i / N * Math.PI * 2; return [cx + Math.cos(t) * (r + off), cy + Math.sin(t) * (r + off)]; });
  };
  // Free horizontal spans on a text line (outside the dilated subject).
  const freeSpans = (y, lh, off, xa, xb) => {
    const blocked = new Uint8Array(Math.ceil(xb - xa) + 1), step = Math.max(2, ph.w / (gw || 160));
    for (let yy = y - lh / 2; yy <= y + lh / 2; yy += Math.max(2, lh / 4))
      for (let X = xa; X <= xb; X += step) if (inside(X, yy)) { const a = Math.max(0, Math.floor(X - xa - off)), b = Math.min(blocked.length - 1, Math.ceil(X - xa + off + step)); blocked.fill(1, a, b + 1); }
    const spans = []; let s0 = -1;
    for (let i = 0; i < blocked.length; i++) { if (!blocked[i] && s0 < 0) s0 = i; if ((blocked[i] || i === blocked.length - 1) && s0 >= 0) { spans.push([xa + s0, xa + i]); s0 = -1; } }
    return spans;
  };
  return { box: { x0, y0, x1, y1, w: bw, h: bh }, c: [cx, cy], head, contour, freeSpans, photo: ph, masked: !!grid };
}

// --- glyph helpers ---
const tokensOf = (t) => t.match(/[A-Za-z0-9'’\-.,!?:;]+\s*|\s+|./gu) || [];
function placeOnPath(ctx, pts, text, px, letter, { closed, center, repeat, sep = ' · ' }) {
  const seg = []; let L = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); seg.push([a, b, L, l]); L += l; }
  const chars = [...text], w = (ch) => ctx.measureText(ch).width + letter * px;
  let glyphs = chars.map(ch => [ch, w(ch)]);
  let total = glyphs.reduce((s, g) => s + g[1], 0);
  if (repeat && total > 0) {
    const unit = [...chars, ...sep].map(ch => [ch, w(ch)]), uw = unit.reduce((s, g) => s + g[1], 0), k = Math.max(1, Math.floor(L / uw));
    glyphs = Array.from({ length: k }, () => unit).flat(); total = uw * k;
  }
  const spread = repeat && closed ? L / total : 1;
  let s = center ? Math.max(0, (L - total) / 2) : 0;
  const out = [];
  for (const [ch, gw] of glyphs) {
    const mid = s + gw * spread / 2; if (mid > L) break;
    let j = 0; while (j < seg.length - 1 && seg[j][2] + seg[j][3] < mid) j++;
    const [a, b, l0, l] = seg[j], t = (mid - l0) / (l || 1);
    out.push({ ch, x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, a: Math.atan2(b[1] - a[1], b[0] - a[0]) });
    s += gw * spread;
  }
  return out;
}

export function drawFlow(ctx, ly, W, H, env) {
  const g = env?.subject?.() || fallbackGeo(W, H);
  const px = Math.max(4, ly.size * W), off = (ly.offset ?? 0.02) * W, letter = ly.letter || 0;
  ctx.font = fontString(ly.pack, px, { weight: ly.weight });
  ctx.fillStyle = ly.color || '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (ly.shadow !== false) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = px * 0.25; }
  const text = (ly.upper ? ly.text.toUpperCase() : ly.text).replace(/\n/g, ' ');
  if (!text.trim()) return {cx:W/2,cy:H/2,w:0,h:0};
  const rot = (ly.rot || 0) * Math.PI / 180;
  let glyphs = [];
  const { box, c, head } = g;
  const P = g.photo, edge = px * 1.1;
  if (['wave','border','rays'].includes(ly.mode)) {
    const m = px * 1.8 + off, x = P.x + m, y = P.y + m, w = Math.max(px,P.w-2*m), h = Math.max(px,P.h-2*m);
    let pts = [];
    if (ly.mode === 'wave') for (let i=0;i<=160;i++) { const u=i/160; pts.push([x+u*w,P.y+P.h*.5+Math.sin(u*Math.PI*3+rot)*P.h*.17]); }
    if (ly.mode === 'border') pts = [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
    if (ly.mode === 'rays') {
      for (let j=0;j<8;j++) { const a=rot+j*Math.PI/4, r=Math.min(P.w,P.h)*.24; const pts=[[c[0]+Math.cos(a)*r,c[1]+Math.sin(a)*r],[c[0]+Math.cos(a)*(r+Math.min(P.w,P.h)*.2),c[1]+Math.sin(a)*(r+Math.min(P.w,P.h)*.2)]]; glyphs.push(...placeOnPath(ctx,pts,text,px,letter,{closed:false,repeat:false})); }
    } else glyphs = placeOnPath(ctx,pts,text,px,letter,{closed:ly.mode==='border',repeat:ly.repeat!==false});
  } else if (ly.mode === 'ring') {
    const sq = ly.squash ?? 0.92;
    // keep the halo inside the photo: shrink to the side margins, then slide down if it would leave the top
    let R = Math.max(box.w * 0.62, px * 3) + off;
    R = Math.max(px * 2.5, Math.min(R, head[0] - P.x - edge, P.x + P.w - head[0] - edge, (P.h - 2 * edge) / (2 * sq)));
    const hy = Math.min(Math.max(head[1], P.y + edge + R * sq), P.y + P.h - edge - R * sq);
    const N = 120, pts = [];
    for (let i = 0; i < N; i++) { const t = -Math.PI / 2 + rot + i / N * Math.PI * 2; pts.push([head[0] + Math.cos(t) * R, hy + Math.sin(t) * R * sq]); }
    glyphs = placeOnPath(ctx, pts, text, px, letter, { closed: true, repeat: ly.repeat !== false });
  } else if (ly.mode === 'contour') {
    let pts = g.contour(off + px * 0.7);
    const k = Math.round(((rot / (Math.PI * 2)) % 1 + 1) % 1 * pts.length + pts.length * 0.75) % pts.length;   // start at the top
    pts = [...pts.slice(k), ...pts.slice(0, k)];
    glyphs = placeOnPath(ctx, pts, text, px, letter, { closed: true, repeat: ly.repeat !== false });
  } else if (ly.mode === 'arc') {
    const R = Math.max(box.w * 1.1, px * 6), apex = Math.max(box.y0 - off, P.y + edge), cy0 = apex + R, span = Math.min(Math.PI * 0.9, (ctx.measureText(text).width + [...text].length * letter * px) / R * 1.05), pts = [];
    for (let i = 0; i <= 64; i++) { const t = -Math.PI / 2 - span / 2 + rot + span * i / 64; pts.push([c[0] + Math.cos(t) * R, cy0 + Math.sin(t) * R]); }
    glyphs = placeOnPath(ctx, pts, text, px, letter, { closed: false, center: true, repeat: false });
  } else if (ly.mode === 'spiral') {
    const turns = 2.6, N = 260, r0 = Math.min(Math.max(box.w * 0.55, px * 2.5) + off, Math.min(P.w, P.h) * 0.3), r1 = r0 + px * 1.35 * turns, pts = [];
    for (let i = 0; i <= N; i++) { const u = i / N, t = -Math.PI / 2 + rot + u * Math.PI * 2 * turns, r = r0 + (r1 - r0) * u; pts.push([c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r]); }
    glyphs = placeOnPath(ctx, pts, text, px, letter, { closed: false, repeat: ly.repeat !== false });
  } else if (ly.mode === 'columns') {
    const chars = [...text.replace(/\s+/g, '')], step = px * (1.08 + letter), top = box.y0 + px * 0.6, rows = Math.max(3, Math.floor((box.h - px) / step));
    const fill = ly.repeat !== false ? Array.from({ length: rows * 2 }, (_, i) => chars[i % chars.length]) : chars;
    const half = Math.ceil(Math.min(fill.length, rows * 2) / 2);
    const colL = box.x0 - off - px * 0.6, colR = box.x1 + off + px * 0.6;
    fill.slice(0, half).forEach((ch, i) => glyphs.push({ ch, x: colL, y: top + i * step, a: 0 }));
    fill.slice(half, half * 2).forEach((ch, i) => glyphs.push({ ch, x: colR, y: top + i * step, a: 0 }));
  } else if (ly.mode === 'wrap') {
    const ph = g.photo, lh = px * (ly.line || 1.5), m = px * 1.2, xa = ph.x + m, xb = ph.x + ph.w - m;
    const toks = tokensOf(text + (/[A-Za-z]$/.test(text) ? ' ' : '　')); let ti = 0, loops = 0;
    const y0 = ph.y + m + (ly.top ?? 0) * ph.h, y1 = ph.y + ph.h - m - (ly.bottom ?? 0) * ph.h;
    ctx.textAlign = 'left';
    outer: for (let y = y0 + lh / 2; y < y1; y += lh) {
      for (const [sa, sb] of g.freeSpans(y, lh, off, xa, xb)) {
        if (sb - sa < px * 2.2) continue;
        let x = sa;
        for (;;) {
          if (ti >= toks.length) { if (ly.repeat === false || ++loops > 40) break outer; ti = 0; }
          const tk = toks[ti], tw = ctx.measureText(tk).width + letter * px * [...tk].length;
          if (x + tw > sb) { if (x === sa && tw > sb - sa) ti++; break; }
          glyphs.push({ ch: tk, x, y, a: 0, left: true }); x += tw; ti++;
        }
      }
    }
  }
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const gl of glyphs) {
    ctx.save(); ctx.translate(gl.x, gl.y); if (gl.a) ctx.rotate(gl.a); ctx.fillText(gl.ch, 0, 0); ctx.restore();
    mnx = Math.min(mnx, gl.x - px); mny = Math.min(mny, gl.y - px); mxx = Math.max(mxx, gl.x + (gl.left ? ctx.measureText(gl.ch).width : px)); mxy = Math.max(mxy, gl.y + px);
  }
  if (!glyphs.length) { mnx = c[0] - 40; mxx = c[0] + 40; mny = c[1] - 40; mxy = c[1] + 40; }
  return { cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2, w: mxx - mnx, h: mxy - mny };
}

function fallbackGeo(W, H) {
  const box = { x0: W * 0.35, y0: H * 0.25, x1: W * 0.65, y1: H * 0.8, w: W * 0.3, h: H * 0.55 }, c = [W / 2, H * 0.52];
  const photo = { x: 0, y: 0, w: W, h: H };
  return { box, c, head: [W / 2, H * 0.33], photo, contour: (off) => Array.from({ length: 120 }, (_, i) => { const t = i / 120 * Math.PI * 2; return [c[0] + Math.cos(t) * (box.w / 2 + off), c[1] + Math.sin(t) * (box.h / 2 + off)]; }),
    freeSpans: (y, lh, off, xa, xb) => (y > box.y0 - off && y < box.y1 + off) ? [[xa, box.x0 - off], [box.x1 + off, xb]] : [[xa, xb]] };
}
