// Layer drawing: text, stickers, shapes and photo cards (collage).

import { fontString } from './presets.js';
import { mulberry32 } from './analyze.js';
import { drawFlow } from './flow.js';

export function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); if (fill) ctx.fill();
}

export function drawLayer(ctx, ly, W, H, env) {
  if (ly.type === 'flow') {   // subject-anchored text: x/y are offsets, rot is the start angle
    ctx.save(); ctx.translate((ly.x || 0) * W, (ly.y || 0) * H); ctx.globalAlpha = ly.opacity ?? 1;
    if (ly.blend) ctx.globalCompositeOperation = ly.blend;
    const b = drawFlow(ctx, ly, W, H, env); ctx.restore();
    return { cx: b.cx + (ly.x || 0) * W, cy: b.cy + (ly.y || 0) * H, w: b.w, h: b.h, rot: 0 };
  }
  ctx.save();
  ctx.translate(ly.x * W, ly.y * H); ctx.rotate((ly.rot || 0) * Math.PI / 180);
  ctx.globalAlpha = ly.opacity ?? 1;
  if (ly.blend) ctx.globalCompositeOperation = ly.blend;
  let box;
  if (ly.type === 'text') box = drawText(ctx, ly, W);
  else if (ly.type === 'rect') {
    const w = ly.w * W, h = ly.h * H;
    if (ly.grad) { const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2); g.addColorStop(ly.grad === 'up' ? 1 : 0, 'rgba(0,0,0,0)'); g.addColorStop(ly.grad === 'up' ? 0 : 1, ly.color); ctx.fillStyle = g; }
    else ctx.fillStyle = ly.color;
    ctx.fillRect(-w / 2, -h / 2, w, h); box = { w, h };
  }
  else if (ly.type === 'photo') box = drawPhotoCard(ctx, ly, W, H, env);
  else if (ly.kind === 'custom') { const img = env?.assets?.get(ly.asset); const w=ly.size*W, h=w*(ly.aspect||1)*(ly.sy||1); if(img) ctx.drawImage(img,-w/2,-h/2,w,h); box={w,h}; }
  else box = drawSticker(ctx, ly, W);
  ctx.restore();
  const a = (ly.rot || 0) * Math.PI / 180, ox = box.ox || 0;
  return { cx: ly.x * W + ox * Math.cos(a), cy: ly.y * H + ox * Math.sin(a), w: box.w, h: box.h, rot: ly.rot || 0 };
}

function drawText(ctx, ly, W) {
  const px = ly.size * W;
  ctx.font = fontString(ly.pack, px, { weight: ly.weight, italic: ly.italic });
  const text = ly.upper ? ly.text.toUpperCase() : ly.text;
  const lines = text.split('\n');
  try { ctx.letterSpacing = `${(ly.letter || 0) * px}px`; } catch (e) { /* older engines */ }
  const lh = px * (ly.line || 1.2);
  let bw, bh;
  if (ly.vertical) {
    const cols = lines.map(l => [...l]);
    const maxLen = Math.max(...cols.map(c => c.length));
    bw = cols.length * lh; bh = maxLen * px * (1 + (ly.letter || 0));
  } else {
    bw = Math.max(...lines.map(l => ctx.measureText(l).width)); bh = lines.length * lh;
  }
  const padX = ly.bg ? px * 0.45 : 0, padY = ly.bg ? px * 0.25 : 0;
  // Left/right aligned text anchors on its edge; centred text anchors on its centre.
  const ox = ly.vertical ? 0 : ly.align === 'left' ? bw / 2 + padX : ly.align === 'right' ? -bw / 2 - padX : 0;
  ctx.translate(ox, 0);
  if (ly.bg) { ctx.fillStyle = ly.bg; roundRect(ctx, -bw / 2 - padX, -bh / 2 - padY, bw + 2 * padX, bh + 2 * padY, px * (ly.bgRadius ?? 0.12), true); }
  ctx.textBaseline = 'middle';
  if (ly.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = px * 0.25; ctx.shadowOffsetY = px * 0.05; }
  ctx.fillStyle = ly.color || '#fff';
  const strokeIt = (fn) => { if (ly.stroke && ly.stroke.w > 0) { ctx.save(); ctx.shadowColor = 'transparent'; ctx.lineJoin = 'round'; ctx.strokeStyle = ly.stroke.color; ctx.lineWidth = ly.stroke.w * px; fn(true); ctx.restore(); } fn(false); };
  if (ly.vertical) {
    ctx.textAlign = 'center';
    const cols = lines.map(l => [...l]);
    strokeIt(st => cols.forEach((col, ci) => col.forEach((ch, i) => {
      const x = bw / 2 - lh * (ci + 0.5), y = -bh / 2 + px * (1 + (ly.letter || 0)) * (i + 0.5);
      st ? ctx.strokeText(ch, x, y) : ctx.fillText(ch, x, y);
    })));
  } else {
    const align = ly.align || 'center';
    ctx.textAlign = align;
    const ax = align === 'left' ? -bw / 2 : align === 'right' ? bw / 2 : 0;
    strokeIt(st => lines.forEach((l, i) => { const y = -bh / 2 + lh * (i + 0.5); st ? ctx.strokeText(l, ax, y) : ctx.fillText(l, ax, y); }));
  }
  return { w: bw + 2 * padX, h: bh + 2 * padY, ox };
}

// Draw text in pixel space from inside a unit-scaled sticker box.
function uText(ctx, w, h, text, ux, uy, pack, px) {
  ctx.save(); ctx.scale(1 / w, 1 / h); ctx.font = fontString(pack, px); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, ux * w, uy * h); ctx.restore();
}

const STICKER_ASPECT = { tape: 0.32, tape2: 0.32, star: 1, heart: 0.9, arrow: 0.55, circle: 0.75, stamp: 1, sparkle: 1, barcode: 0.42, label: 0.38, scribble: 0.35, ticket: 0.45 };

function wobble(ctx, pts, seed) { const r = mulberry32(seed); ctx.beginPath(); pts.forEach(([x, y], i) => { const jx = x + (r() - 0.5) * 0.01, jy = y + (r() - 0.5) * 0.01; i ? ctx.lineTo(jx, jy) : ctx.moveTo(jx, jy); }); }

function drawSticker(ctx, ly, W) {
  if (!ly.isolated && ['stamp','ticket'].includes(ly.kind)) { const c=document.createElement('canvas'); c.width=Math.ceil(ly.size*W*1.2); c.height=c.width; const x=c.getContext('2d'); x.translate(c.width/2,c.height/2); const box=drawSticker(x,{...ly,isolated:true},W); ctx.drawImage(c,-c.width/2,-c.height/2); return box; }
  const s = ly.size * W, asp = (STICKER_ASPECT[ly.kind] || 1) * (ly.sy || 1), w = s, h = s * asp;
  const col = ly.color || '#e2502c';
  ctx.save(); ctx.scale(w, h); // unit box -0.5..0.5
  switch (ly.kind) {
    case 'sun': case 'flower': case 'asterisk': case 'diamond': case 'cross': {
      ctx.fillStyle=col; ctx.strokeStyle=col; ctx.lineWidth=.045;
      const n=ly.kind==='flower'?8:ly.kind==='diamond'?4:ly.kind==='cross'?4:12;
      if(ly.kind==='sun') { ctx.beginPath();ctx.arc(0,0,.23,0,Math.PI*2);ctx.fill(); }
      for(let i=0;i<n;i++){const a=i*Math.PI*2/n;ctx.save();ctx.rotate(a);
        if(ly.kind==='flower'){ctx.beginPath();ctx.ellipse(.27,0,.22,.10,0,0,7);ctx.fill();}
        else if(ly.kind==='diamond'){ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(.5,0);ctx.lineTo(0,.2);ctx.fill();}
        else {ctx.beginPath();ctx.moveTo(ly.kind==='sun'?.32:0,0);ctx.lineTo(.48,0);ctx.stroke();}ctx.restore();} break;
    }
    case 'moon': {ctx.fillStyle=col;ctx.beginPath();ctx.arc(0,0,.48,.5,5.8);ctx.bezierCurveTo(-.08,-.22,-.08,.22,.42,.23);ctx.fill();break;}
    case 'brackets': case 'negative': case 'postage': {ctx.strokeStyle=col;ctx.lineWidth=.035;
      if(ly.kind==='brackets') for(let i=0;i<4;i++){ctx.save();ctx.rotate(i*Math.PI/2);ctx.beginPath();ctx.moveTo(-.48,-.24);ctx.lineTo(-.48,-.48);ctx.lineTo(-.24,-.48);ctx.stroke();ctx.restore();}
      else {ctx.strokeRect(-.44,-.44,.88,.88);ctx.lineWidth=.015;ctx.strokeRect(-.34,-.32,.68,.64);ctx.fillStyle=col;for(let i=0;i<6;i++){ctx.fillRect(-.39+i*.14,-.48,.06,.08);ctx.fillRect(-.39+i*.14,.4,.06,.08);}}break;}
    case 'wave': case 'dashes': case 'chevron': {ctx.strokeStyle=col;ctx.lineWidth=.05;ctx.lineCap='round';
      if(ly.kind==='dashes')ctx.setLineDash([.07,.045]);ctx.beginPath();
      for(let i=0;i<=60;i++){const x=-.48+i*.016,y=ly.kind==='wave'?Math.sin(i/60*Math.PI*4)*.12:0;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();
      if(ly.kind==='chevron')for(let i=0;i<2;i++){ctx.beginPath();ctx.moveTo(i*.3-.25,-.28);ctx.lineTo(i*.3,0);ctx.lineTo(i*.3-.25,.28);ctx.stroke();}break;}
    case 'seal': {ctx.fillStyle=col;ctx.fillRect(-.44,-.44,.88,.88);ctx.strokeStyle='#fff2db';ctx.lineWidth=.015;ctx.strokeRect(-.37,-.37,.74,.74);ctx.fillStyle='#fff2db';uText(ctx,w,h,ly.text||'光陰',0,0,'mincho',w*.29);break;}
    case 'note': {ctx.fillStyle=col;ctx.fillRect(-.45,-.45,.9,.9);ctx.strokeStyle='rgba(30,20,10,.4)';ctx.lineWidth=.012;for(let i=0;i<4;i++){ctx.beginPath();ctx.moveTo(-.33,-.2+i*.16);ctx.lineTo(.33,-.2+i*.16);ctx.stroke();}break;}
    case 'ribbon': {ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(-.5,-.22);ctx.lineTo(.5,-.22);ctx.lineTo(.36,0);ctx.lineTo(.5,.22);ctx.lineTo(-.5,.22);ctx.lineTo(-.36,0);ctx.fill();break;}
    case 'dots': {ctx.fillStyle=col;for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){ctx.beginPath();ctx.arc(x*.3,y*.3,.05,0,7);ctx.fill();}break;}
    case 'tape': case 'tape2': {
      ctx.globalAlpha *= 0.82; ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(-0.5, -0.5);
      for (let i = 0; i <= 6; i++) ctx.lineTo(0.5 + (i % 2 ? -0.025 : 0.012), -0.5 + i / 6);
      for (let i = 6; i >= 0; i--) ctx.lineTo(-0.5 + (i % 2 ? 0.025 : -0.012), -0.5 + i / 6);
      ctx.closePath(); ctx.fill();
      if (ly.kind === 'tape2') { ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.02; for (let i = -0.4; i <= 0.4; i += 0.1) { ctx.beginPath(); ctx.moveTo(i, -0.5); ctx.lineTo(i, 0.5); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(-0.5, 0); ctx.lineTo(0.5, 0); ctx.lineWidth = 0.06; ctx.stroke(); }
      break;
    }
    case 'star': case 'sparkle': {
      const n = ly.kind === 'star' ? 5 : 4, inner = ly.kind === 'star' ? 0.2 : 0.09;
      ctx.fillStyle = col; ctx.beginPath();
      for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? inner : 0.5; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); break;
    }
    case 'heart': {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, 0.45);
      ctx.bezierCurveTo(-0.6, 0.05, -0.45, -0.55, 0, -0.22); ctx.bezierCurveTo(0.45, -0.55, 0.6, 0.05, 0, 0.45); ctx.fill(); break;
    }
    case 'arrow': {
      ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 0.045;
      ctx.beginPath(); ctx.moveTo(-0.48, -0.3); ctx.bezierCurveTo(-0.1, -0.55, 0.25, 0.1, 0.44, 0.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.26, 0.32); ctx.lineTo(0.46, 0.32); ctx.lineTo(0.42, 0.02); ctx.stroke(); break;
    }
    case 'circle': {
      ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineWidth = 0.022;
      ctx.beginPath(); for (let t = 0; t <= Math.PI * 2.25; t += 0.05) { const r = 0.47 + 0.025 * Math.sin(t * 3); const x = Math.cos(t - 0.4) * r, y = Math.sin(t - 0.4) * r * 0.96; t ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); break;
    }
    case 'stamp': {
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 0.035;
      ctx.beginPath(); ctx.arc(0, 0, 0.46, 0, 7); ctx.stroke(); ctx.lineWidth = 0.015; ctx.beginPath(); ctx.arc(0, 0, 0.38, 0, 7); ctx.stroke();
      uText(ctx, w, h, ly.text || 'POST', 0, -0.04, 'bold', 0.16 * w);
      uText(ctx, w, h, ly.sub || '2026 · 10', 0, 0.16, 'stamp', 0.085 * w);
      ctx.globalCompositeOperation = 'destination-out'; const r = mulberry32(5); for (let i = 0; i < 90; i++) { ctx.beginPath(); ctx.arc((r() - 0.5), (r() - 0.5), r() * 0.02, 0, 7); ctx.fill(); }
      break;
    }
    case 'barcode': {
      ctx.fillStyle = '#fff'; ctx.fillRect(-0.5, -0.5, 1, 1); ctx.fillStyle = '#111'; const r = mulberry32(11);
      let x = -0.44; while (x < 0.44) { const bw = 0.008 + r() * 0.022; if (r() > 0.4) ctx.fillRect(x, -0.38, bw, 0.56); x += bw + 0.006 + r() * 0.01; }
      uText(ctx, w, h, '9 772026 101009', 0, 0.38, 'stamp', 0.16 * h);
      break;
    }
    case 'label': {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-0.5, -0.45); ctx.lineTo(0.48, -0.5); ctx.lineTo(0.5, 0.42); ctx.lineTo(-0.47, 0.5); ctx.closePath(); ctx.fill(); break;
    }
    case 'scribble': {
      ctx.strokeStyle = col; ctx.lineWidth = 0.05; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(-0.48, 0);
      for (let i = 0; i < 9; i++) ctx.quadraticCurveTo(-0.44 + i * 0.11, i % 2 ? 0.45 : -0.45, -0.38 + i * 0.11, 0); ctx.stroke(); break;
    }
    case 'ticket': {
      ctx.fillStyle = col; ctx.beginPath(); ctx.rect(-0.5, -0.5, 1, 1); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.ellipse(-0.5, 0, 0.04, 0.09, 0, 0, 7); ctx.ellipse(0.5, 0, 0.04, 0.09, 0, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#1b1a17'; uText(ctx, w, h, ly.text || 'ADMIT ONE', 0, -0.06, 'bold', 0.3 * h); uText(ctx, w, h, 'NO. 0282 · ROW 7', 0, 0.28, 'stamp', 0.13 * h);
      break;
    }
  }
  ctx.restore();
  return { w, h: Math.abs(h) };
}

// Photo card for collages: border (optionally deeper at the bottom), radius, shadow, film-processed photo.
function drawPhotoCard(ctx, ly, W, H, env) {
  const w = ly.w * W, h = ly.h * H, m = Math.min(w, h);
  const b = (ly.border || 0) * m, bb = b + (ly.bottom || 0) * h, r = (ly.radius || 0) * m;
  if (ly.shadow !== false) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = m * 0.05; ctx.shadowOffsetY = m * 0.02; ctx.fillStyle = ly.borderColor || '#fff'; roundRect(ctx, -w / 2, -h / 2, w, h, r, true); ctx.restore(); }
  else if (b > 0) { ctx.fillStyle = ly.borderColor || '#fff'; roundRect(ctx, -w / 2, -h / 2, w, h, r, true); }
  const iw = Math.max(1, Math.round(w - 2 * b)), ih = Math.max(1, Math.round(h - b - bb));
  const pc = env?.photoCanvas?.(ly, iw, ih);
  ctx.save();
  roundRect(ctx, -w / 2 + b, -h / 2 + b, iw, ih, Math.max(0, r - b * 0.6)); ctx.clip();
  if (pc) ctx.drawImage(pc, -w / 2 + b, -h / 2 + b, iw, ih);
  else { ctx.fillStyle = '#2a2a2d'; ctx.fillRect(-w / 2 + b, -h / 2 + b, iw, ih); }
  ctx.restore();
  return { w, h };
}
