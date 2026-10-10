// Live-photo containers, all in-browser:
//  · read  — Google / Samsung / Xiaomi motion JPEG (XMP directory, MicroVideo offset, MotionPhoto_Data trailer),
//            appended MP4 in HEIC, Apple HEIC/JPG + MOV pairs, .livp / .zip bundles.
//  · write — H.264 via WebCodecs into a flat (non-fragmented) MP4 / QuickTime MOV,
//            Google Motion Photo v1 JPEG, Apple Live Photo pair (JPG MakerNote + MOV content identifier).

const te = new TextEncoder(), td = new TextDecoder();

// ---------------- byte helpers ----------------
const u8 = n => Uint8Array.of(n & 255);
const u16 = n => Uint8Array.of(n >>> 8 & 255, n & 255);
const u24 = n => Uint8Array.of(n >>> 16 & 255, n >>> 8 & 255, n & 255);
const u32 = n => Uint8Array.of(n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255);
const i32 = n => u32(n >>> 0);
const zeros = n => new Uint8Array(n);
const str = s => te.encode(s);
function cat(parts) {
  const flat = parts.flat(Infinity).map(p => typeof p === 'string' ? str(p) : p);
  const out = new Uint8Array(flat.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of flat) { out.set(p, o); o += p.length; }
  return out;
}
// ISO-BMFF / QuickTime atoms. A numeric type becomes a 32-bit id (used by ilst / keys entries).
function box(type, ...parts) {
  const body = cat(parts), head = typeof type === 'number' ? u32(type) : str(type);
  return cat([u32(8 + body.length), head, body]);
}
const full = (type, ver, flags, ...parts) => box(type, u8(ver), u24(flags), ...parts);
const find = (b, pat, from = 0, to = b.length) => {
  outer: for (let i = from; i <= to - pat.length; i++) { for (let j = 0; j < pat.length; j++) if (b[i + j] !== pat[j]) continue outer; return i; }
  return -1;
};
const isFtyp = (b, at) => at >= 0 && at + 8 <= b.length && b[at + 4] === 0x66 && b[at + 5] === 0x74 && b[at + 6] === 0x79 && b[at + 7] === 0x70;

// ---------------- read: motion photos ----------------
function jpegSegments(b) {
  const segs = [];
  if (b[0] !== 0xff || b[1] !== 0xd8) return segs;
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const m = b[i + 1]; if (m === 0xda || m === 0xd9) break;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = b[i + 2] << 8 | b[i + 3];
    segs.push({ marker: m, start: i, data: b.subarray(i + 4, i + 2 + len) });
    i += 2 + len;
  }
  return segs;
}
const XMP_NS = 'http://ns.adobe.com/xap/1.0/\0';
function readXmp(b) {
  const s = jpegSegments(b).find(s => s.marker === 0xe1 && td.decode(s.data.subarray(0, XMP_NS.length)) === XMP_NS);
  return s ? td.decode(s.data.subarray(XMP_NS.length)) : '';
}
const attr = (xmp, name) => { const m = xmp.match(new RegExp(name + '\\s*=\\s*"([^"]*)"')) || xmp.match(new RegExp('<' + name + '>([^<]*)<')); return m ? m[1] : null; };

// Returns { video: Blob, keyUs?: number, kind } or null.
export async function readMotionPhoto(file) {
  if (!/image\/(jpeg|heic|heif)/.test(file.type) && !/\.(jpe?g|heic|heif)$/i.test(file.name)) return null;
  const b = new Uint8Array(await file.arrayBuffer()), N = b.length;
  const done = (start, kind, keyUs) => isFtyp(b, start) && start > 16 ? { video: new Blob([b.subarray(start)], { type: 'video/mp4' }), keyUs: keyUs >= 0 ? keyUs : undefined, kind } : null;
  const xmp = readXmp(b);
  if (xmp) {
    const ts = +(attr(xmp, 'GCamera:MotionPhotoPresentationTimestampUs') ?? attr(xmp, 'GCamera:MicroVideoPresentationTimestampUs') ?? -1);
    // v1 container directory: the MotionPhoto item is the trailing Length bytes of the file.
    const items = [...xmp.matchAll(/<Container:Item\b[^>]*>/g)].map(m => m[0]);
    const mp = items.find(i => /Semantic="MotionPhoto"/.test(i));
    if (mp) { const len = +attr(mp, 'Item:Length'); const r = len > 0 && done(N - len, 'google', ts); if (r) return r; }
    const off = +(attr(xmp, 'GCamera:MicroVideoOffset') || 0);
    if (off > 0) { const r = done(N - off, 'google', ts); if (r) return r; }
  }
  // Samsung SEF trailer: "MotionPhoto_Data" immediately precedes the MP4.
  const sm = find(b, str('MotionPhoto_Data'), Math.max(0, N - 64 * 1024 * 1024));
  if (sm > 0) { const r = done(sm + 16, 'samsung'); if (r) return r; }
  // Fallback: last appended ISO-BMFF file (Huawei / older Xiaomi / HEIC motion photos).
  for (let i = 100; i < N - 12; i++) if (b[i] === 0x66 && b[i + 1] === 0x74 && b[i + 2] === 0x79 && b[i + 3] === 0x70) {
    const start = i - 4, size = (b[start] << 24 | b[start + 1] << 16 | b[start + 2] << 8 | b[start + 3]) >>> 0;
    const brand = td.decode(b.subarray(i + 4, i + 8));
    if (size >= 16 && size < 256 && !/^(heic|heix|mif1|msf1|avif)/.test(brand)) return done(start, 'appended');
  }
  return null;
}

// Apple MOV: com.apple.quicktime.content.identifier + still-image-time (when present as a moov/meta item).
export async function readQuickTimeId(blob) {
  try {
    const b = new Uint8Array(await blob.slice(Math.max(0, blob.size - 4 * 1024 * 1024)).arrayBuffer());
    const head = blob.size > 4 * 1024 * 1024 ? new Uint8Array(await blob.slice(0, 4 * 1024 * 1024).arrayBuffer()) : null;
    for (const buf of [b, head]) {
      if (!buf) continue;
      const k = find(buf, str('com.apple.quicktime.content.identifier')); if (k < 0) continue;
      const d = find(buf, str('data'), k); if (d < 0) continue;
      const len = (buf[d - 4] << 24 | buf[d - 3] << 16 | buf[d - 2] << 8 | buf[d - 1]) - 16;
      if (len > 0 && len < 128) return td.decode(buf.subarray(d + 12, d + 12 + len));
    }
  } catch {}
  return null;
}

// ---------------- read: .livp / .zip bundles ----------------
export async function readZip(blob) {
  const b = new Uint8Array(await blob.arrayBuffer()), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), out = [];
  let e = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('不是有效的 ZIP / LIVP 文件');
  let p = dv.getUint32(e + 16, true); const n = dv.getUint16(e + 10, true);
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = td.decode(b.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    if (name.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(name)) continue;
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = b.subarray(ds, ds + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8 && 'DecompressionStream' in window) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else continue;
    const base = name.split('/').pop(), ext = base.split('.').pop().toLowerCase();
    const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', heic: 'image/heic', heif: 'image/heif', png: 'image/png', webp: 'image/webp', mov: 'video/quicktime', mp4: 'video/mp4' }[ext];
    if (type) out.push(new File([data], base, { type }));
  }
  return out;
}

// ---------------- write: H.264 elementary stream via WebCodecs ----------------
const CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42001f'];
export async function pickEncoder(width, height, fps) {
  if (!window.VideoEncoder || !window.VideoFrame) return null;
  for (const codec of CODECS) {
    const cfg = { codec, width, height, bitrate: Math.round(width * height * fps * 0.22), framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality' };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch {}
  }
  return null;
}
// drawFrame(i) must paint `canvas` for frame i; resolves to { samples, avcC, width, height, fps }.
export async function encodeH264({ canvas, frames, fps, drawFrame, onProgress }) {
  const width = canvas.width, height = canvas.height, cfg = await pickEncoder(width, height, fps);
  if (!cfg) throw new Error('当前浏览器不支持 H.264 编码');
  const samples = []; let avcC = null, err = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => {
      const d = meta?.decoderConfig?.description;
      if (d && !avcC) avcC = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)) : new Uint8Array(d.slice(0));
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      samples.push({ data, key: chunk.type === 'key', ts: chunk.timestamp });
    },
    error: e => { err = e; },
  });
  enc.configure(cfg);
  try {
    for (let i = 0; i < frames; i++) {
      if (err) throw err;
      await drawFrame(i);
      const f = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      enc.encode(f, { keyFrame: i % fps === 0 }); f.close();
      while (enc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 4));
      onProgress?.((i + 1) / frames);
    }
    await enc.flush(); if (err) throw err;
  } finally { if (enc.state !== 'closed') enc.close(); }
  if (!avcC || !samples.length) throw new Error('视频编码失败');
  samples.sort((a, b) => a.ts - b.ts);
  return { samples, avcC, width, height, fps };
}

// ---------------- write: flat MP4 / MOV ----------------
const MATRIX = cat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);
const TS = 90000, MTS = 600, CID_KEY = 'com.apple.quicktime.content.identifier';
// opts: { qt: bool, contentId?: string, stillTime?: seconds (QuickTime still-image-time) }
export function muxH264({ samples, avcC, width, height, fps }, opts = {}) {
  const qt = !!opts.qt, n = samples.length, dur = Math.round(TS / fps), total = dur * n, mdur = Math.round(total / TS * MTS);
  const ftyp = qt ? box('ftyp', 'qt  ', u32(0), 'qt  ') : box('ftyp', 'isom', u32(512), 'isom', 'iso2', 'avc1', 'mp41');
  // Timed still-image-time metadata (Apple Live Photo): one 9-byte item, local key 1, int8 -1.
  const meta = qt && opts.stillTime != null ? cat([u32(9), u32(1), u8(0xff)]) : null;
  const videoBytes = samples.reduce((s, x) => s + x.data.length, 0);
  const mdatHead = 8, videoOff = ftyp.length + mdatHead, metaOff = videoOff + videoBytes;
  const mdat = cat([u32(mdatHead + videoBytes + (meta?.length || 0)), 'mdat', samples.map(s => s.data), meta || []]);
  const hdlr = (sub, name) => full('hdlr', 0, 0, qt ? 'mhlr' : u32(0), sub, zeros(12), qt ? u8(0) : [name, u8(0)]);
  const dinf = box('dinf', full('dref', 0, 0, u32(1), qt ? full('alis', 0, 1) : full('url ', 0, 1)));
  const tkhd = (id, w, h, vol) => full('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(mdur), zeros(8), u16(0), u16(0), u16(vol), u16(0), MATRIX, u32(w << 16), u32(h << 16));
  const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(TS), u32(total), u16(0x55c4), u16(0));
  const keyIdx = samples.map((s, i) => s.key ? i + 1 : 0).filter(Boolean);
  const avc1 = box('avc1', zeros(6), u16(1), u16(0), u16(0), zeros(12), u16(width), u16(height), u32(0x480000), u32(0x480000), u32(0), u16(1),
    u8(0), zeros(31), u16(0x18), u16(0xffff), box('avcC', avcC), box('pasp', u32(1), u32(1)));
  const vstbl = box('stbl',
    full('stsd', 0, 0, u32(1), avc1),
    full('stts', 0, 0, u32(1), u32(n), u32(dur)),
    keyIdx.length < n ? full('stss', 0, 0, u32(keyIdx.length), keyIdx.map(u32)) : [],
    full('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
    full('stsz', 0, 0, u32(0), u32(n), samples.map(s => u32(s.data.length))),
    full('stco', 0, 0, u32(1), u32(videoOff)));
  const vtrak = box('trak', tkhd(1, width, height, 0),
    box('mdia', mdhd, hdlr('vide', 'VideoHandler'), box('minf', full('vmhd', 0, 1, zeros(8)), dinf, vstbl)));
  let mtrak = [];
  if (meta) {
    const st = Math.max(0, Math.min(total - dur, Math.round(opts.stillTime * TS)));
    const mebx = box('mebx', zeros(6), u16(1),
      box('keys', box(1, box('keyd', 'mdta', 'com.apple.quicktime.still-image-time'), box('dtyp', u32(0), u32(65)))));
    const mstbl = box('stbl', full('stsd', 0, 0, u32(1), mebx), full('stts', 0, 0, u32(1), u32(1), u32(dur)),
      full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)), full('stsz', 0, 0, u32(0), u32(1), u32(meta.length)), full('stco', 0, 0, u32(1), u32(metaOff)));
    // An empty edit places the single sample at the still time on the movie timeline.
    const elst = full('elst', 0, 0, u32(st ? 2 : 1), st ? [u32(Math.round(st / TS * MTS)), i32(-1), u32(0x10000)] : [], u32(Math.max(1, Math.round(dur / TS * MTS))), u32(0), u32(0x10000));
    mtrak = box('trak', full('tkhd', 0, 3, u32(0), u32(0), u32(2), u32(0), u32(mdur), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(0), u32(0)),
      box('edts', elst),
      box('mdia', full('mdhd', 0, 0, u32(0), u32(0), u32(TS), u32(dur), u16(0x55c4), u16(0)), hdlr('meta', 'MetadataHandler'), box('minf', full('nmhd', 0, 0), dinf, mstbl)));
  }
  // Movie-level QuickTime metadata (keys / ilst, mdta namespace). QuickTime's 'meta' atom carries no version/flags.
  const udta = qt && opts.contentId ? box('meta',
    full('hdlr', 0, 0, u32(0), 'mdta', zeros(12), u8(0)),
    full('keys', 0, 0, u32(1), u32(8 + CID_KEY.length), 'mdta', CID_KEY),
    box('ilst', box(1, box('data', u32(1), u32(0), opts.contentId)))) : [];
  const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(MTS), u32(mdur), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(meta ? 3 : 2));
  const moov = box('moov', mvhd, vtrak, mtrak, udta);
  return new Blob([ftyp, mdat, moov], { type: qt ? 'video/quicktime' : 'video/mp4' });
}

// ---------------- write: Google Motion Photo (single JPEG) ----------------
function insertAfterHeaders(jpeg, segments) {
  // Keep SOI, drop existing APP0/APP1 (canvas output carries only JFIF), insert our APP segments first.
  const segs = jpegSegments(jpeg), keep = segs.filter(s => s.marker !== 0xe0 && s.marker !== 0xe1);
  const after = segs.length ? segs[segs.length - 1].start + 2 + (jpeg[segs[segs.length - 1].start + 2] << 8 | jpeg[segs[segs.length - 1].start + 3]) : 2;
  return cat([jpeg.subarray(0, 2), segments, keep.map(s => jpeg.subarray(s.start, s.start + 4 + s.data.length)), jpeg.subarray(after)]);
}
const app1 = (payload) => cat([u8(0xff), u8(0xe1), u16(payload.length + 2), payload]);
export async function motionPhotoJpeg(jpegBlob, mp4Blob, presentationUs) {
  const jpeg = new Uint8Array(await jpegBlob.arrayBuffer()), mp4 = new Uint8Array(await mp4Blob.arrayBuffer()), ts = Math.max(0, Math.round(presentationUs));
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="DARKROOM"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" GCamera:MotionPhoto="1" GCamera:MotionPhotoVersion="1" GCamera:MotionPhotoPresentationTimestampUs="${ts}" GCamera:MicroVideo="1" GCamera:MicroVideoVersion="1" GCamera:MicroVideoOffset="${mp4.length}" GCamera:MicroVideoPresentationTimestampUs="${ts}"><Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0" Item:Padding="0"/></rdf:li><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${mp4.length}" Item:Padding="0"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>`;
  const out = insertAfterHeaders(jpeg, [app1(cat([XMP_NS, xmp]))]);
  return new Blob([out, mp4], { type: 'image/jpeg' });
}

// ---------------- write: Apple Live Photo still (EXIF + Apple MakerNote ContentIdentifier) ----------------
function ifd(entries, base, nextData) {
  // entries: [tag, type, count, valueBytes]; values > 4 bytes go to the data area starting at base + ifd size.
  const size = 2 + entries.length * 12 + 4; let dataOff = base + size; const data = [], out = [u16(entries.length)];
  for (const [tag, type, count, val] of entries) {
    out.push(u16(tag), u16(type), u32(count));
    if (val.length <= 4) out.push(cat([val, zeros(4 - val.length)]));
    else { out.push(u32(dataOff)); data.push(val); dataOff += val.length + (val.length & 1); if (val.length & 1) data.push(u8(0)); }
  }
  out.push(u32(0));
  return { bytes: cat([out, data]), end: dataOff };
}
export async function appleLiveJpeg(jpegBlob, contentId, date = new Date()) {
  const jpeg = new Uint8Array(await jpegBlob.arrayBuffer()), p = n => String(n).padStart(2, '0');
  const dt = str(`${date.getFullYear()}:${p(date.getMonth() + 1)}:${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}\0`);
  // Apple MakerNote: "Apple iOS\0" 00 01 "MM", IFD with offsets relative to the MakerNote start.
  const mnHead = cat(['Apple iOS', u8(0), u16(1), 'MM']);
  const mnIfd = ifd([[0x0001, 9, 1, i32(14)], [0x0011, 2, 37, cat([contentId.slice(0, 36), u8(0)])]], mnHead.length);
  const maker = cat([mnHead, mnIfd.bytes]);
  // TIFF: IFD0 (Make, Orientation, ExifIFD) → Exif IFD (ExifVersion, DateTimeOriginal, MakerNote).
  const ifd0Size = 2 + 3 * 12 + 4, make = str('Apple\0');
  const exifBase = 8 + ifd0Size + make.length + (make.length & 1);
  const exifIfd = ifd([[0x9000, 7, 4, str('0232')], [0x9003, 2, 20, dt], [0x927c, 7, maker.length, maker]], exifBase);
  const ifd0 = ifd([[0x010f, 2, make.length, make], [0x0112, 3, 1, u16(1)], [0x8769, 4, 1, u32(exifBase)]], 8);
  const tiff = cat(['MM', u16(42), u32(8), ifd0.bytes, exifIfd.bytes]);
  return new Blob([insertAfterHeaders(jpeg, [app1(cat(['Exif', u8(0), u8(0), tiff]))])], { type: 'image/jpeg' });
}

export const uuid = () => (crypto.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : r & 3 | 8).toString(16); })).toUpperCase();
