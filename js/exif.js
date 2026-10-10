// Tiny EXIF reader for JPEG: camera, lens and exposure triangle.

const TAGS = {
  0x010f: 'make', 0x0110: 'model', 0x0112: 'orientation', 0x0132: 'dateTime', 0x8769: 'exifPtr', 0x8825: 'gpsPtr',
  0x829a: 'exposure', 0x829d: 'fNumber', 0x8827: 'iso', 0x9003: 'dateOriginal', 0x920a: 'focal', 0xa405: 'focal35', 0xa434: 'lens',
};

export async function readExif(blob) {
  try {
    const buf = new DataView(await blob.slice(0, 256 * 1024).arrayBuffer());
    if (buf.getUint16(0) !== 0xffd8) return null;
    let p = 2;
    while (p < buf.byteLength - 4) {
      const marker = buf.getUint16(p), len = buf.getUint16(p + 2);
      if (marker === 0xffe1 && buf.getUint32(p + 4) === 0x45786966) return parseTiff(buf, p + 10);
      if ((marker & 0xff00) !== 0xff00) break;
      p += 2 + len;
    }
  } catch (e) { /* ignore malformed */ }
  return null;
}

function parseTiff(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(t + o, le), u32 = (o) => v.getUint32(t + o, le);
  const out = {};
  const readIfd = (off) => {
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4), name = TAGS[tag];
      if (!name) continue;
      const valOff = count * ([0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8][type] || 1) > 4 ? u32(e + 8) : e + 8;
      if (type === 2) { let s = ''; for (let k = 0; k < count - 1; k++) s += String.fromCharCode(v.getUint8(t + valOff + k)); out[name] = s.trim(); }
      else if (type === 3) out[name] = u16(valOff);
      else if (type === 4) out[name] = u32(valOff);
      else if (type === 5 || type === 10) out[name] = u32(valOff) / (u32(valOff + 4) || 1);
    }
  };
  readIfd(u32(4));
  if (out.exifPtr) readIfd(out.exifPtr);
  const fmt = {
    camera: [out.make, out.model && out.make && out.model.startsWith(out.make) ? out.model.slice(out.make.length).trim() : out.model].filter(Boolean).join(' '),
    lens: out.lens,
    shutter: out.exposure ? (out.exposure >= 1 ? `${out.exposure}s` : `1/${Math.round(1 / out.exposure)}`) : null,
    aperture: out.fNumber ? `f/${out.fNumber.toFixed(1)}` : null,
    iso: out.iso ? `ISO ${out.iso}` : null,
    focal: out.focal ? `${Math.round(out.focal)}mm${out.focal35 ? ` (${out.focal35}mm eq.)` : ''}` : null,
    date: (out.dateOriginal || out.dateTime || '').replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1.$2.$3'),
    gps: !!out.gpsPtr,
  };
  return fmt.camera || fmt.shutter || fmt.aperture ? fmt : null;
}
