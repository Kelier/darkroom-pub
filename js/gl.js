// WebGL2 image warps: perspective correction (homography) and depth-based 2.5D parallax.

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

const VS = `#version 300 es
in vec2 p; out vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const FS_WARP = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D t; uniform mat3 H;
void main(){
  vec2 q = vec2(uv.x, 1.0 - uv.y);
  vec3 s = H * vec3(q, 1.0); vec2 st = s.xy / s.z;
  if (st.x < -0.002 || st.y < -0.002 || st.x > 1.002 || st.y > 1.002) { o = vec4(0.0); return; }
  o = texture(t, vec2(st.x, 1.0 - st.y));
}`;

// Inverse parallax mapping with fixed-point iteration: near pixels (depth→1) move more.
const FS_PARALLAX = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D tc; uniform sampler2D td; uniform sampler2D tm;
uniform vec2 shift; uniform float zoom; uniform float focus; uniform float scale; uniform float useMask;
float D(vec2 p){ return texture(td, vec2(p.x, 1.0 - p.y)).r; }
void main(){
  vec2 q = vec2(uv.x, 1.0 - uv.y), c = vec2(0.5);
  vec2 p = q;
  for (int i = 0; i < 12; i++) {
    float k = D(p) - focus;
    p = c + (q - c) / (scale * (1.0 + zoom * k)) - shift * k;
  }
  vec2 st = clamp(p, 0.0, 1.0);
  vec4 col = texture(tc, vec2(st.x, 1.0 - st.y));
  if (useMask > 0.5) col.a *= texture(tm, vec2(st.x, 1.0 - st.y)).a;
  o = col;
}`;

let G = null;
function gl() {
  if (G !== null) return G;
  const c = mk(4, 4);
  const g = c.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
  if (!g) { G = false; return G; }
  const prog = (fs) => {
    const p = g.createProgram();
    for (const [type, src] of [[g.VERTEX_SHADER, VS], [g.FRAGMENT_SHADER, fs]]) {
      const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s));
      g.attachShader(p, s);
    }
    g.bindAttribLocation(p, 0, 'p'); g.linkProgram(p);
    return p;
  };
  const buf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, buf);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
  g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
  g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
  G = { c, g, warp: prog(FS_WARP), parallax: prog(FS_PARALLAX) };
  return G;
}

function tex(g, unit, src) {
  const t = g.createTexture();
  g.activeTexture(g.TEXTURE0 + unit); g.bindTexture(g.TEXTURE_2D, t);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src);
  return t;
}

function draw(G, w, h) {
  const { c, g } = G;
  c.width = w; c.height = h; g.viewport(0, 0, w, h);
  g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  const out = mk(w, h); out.getContext('2d').drawImage(c, 0, 0);
  return out;
}

export const glAvailable = () => !!gl();

// ---------- perspective ----------
// Solve homography mapping 4 points a[i] -> b[i]. Returns row-major 3x3.
function homography(a, b) {
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = a[i], [u, v] = b[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  for (let i = 0; i < 8; i++) {          // Gaussian elimination with partial pivoting
    let m = i; for (let r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
    [A[i], A[m]] = [A[m], A[i]]; [B[i], B[m]] = [B[m], B[i]];
    for (let r = i + 1; r < 8; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < 8; c++) A[r][c] -= f * A[i][c]; B[r] -= f * B[i]; }
  }
  const h = new Array(8);
  for (let i = 7; i >= 0; i--) { let s = B[i]; for (let c = i + 1; c < 8; c++) s -= A[i][c] * h[c]; h[i] = s / A[i][i]; }
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

// Source quad (normalized, top-left origin) that will be stretched to fill the output.
export function geoQuad(geo, aspect) {
  const v = (geo.vert || 0) * 0.32, hz = (geo.horiz || 0) * 0.32, rot = (geo.rotate || 0) * Math.PI / 180;
  // keystone: narrow the edge that should be widened in the output
  let q = [[0, 0], [1, 0], [1, 1], [0, 1]];
  if (v > 0) { q[0][0] += v / 2; q[1][0] -= v / 2; } else if (v < 0) { q[3][0] -= v / 2; q[2][0] += v / 2; }
  if (hz > 0) { q[0][1] += hz / 2; q[3][1] -= hz / 2; } else if (hz < 0) { q[1][1] -= hz / 2; q[2][1] += hz / 2; }
  // rotation about centre in pixel space, then shrink so the quad stays inside the image
  if (rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    q = q.map(([x, y]) => { const px = (x - 0.5) * aspect, py = y - 0.5; return [(px * c - py * s) / aspect + 0.5, px * s + py * c + 0.5]; });
  }
  // uniform shrink toward centre until every corner is inside [0,1]
  let k = 1;
  for (const [x, y] of q) { const dx = Math.abs(x - 0.5), dy = Math.abs(y - 0.5); if (dx > 0.5) k = Math.min(k, 0.5 / dx); if (dy > 0.5) k = Math.min(k, 0.5 / dy); }
  if (rot) {
    // inscribed rectangle for a rotated frame
    const a = Math.abs(rot), w = aspect, h = 1;
    const fit = Math.min(w / (w * Math.cos(a) + h * Math.sin(a)), h / (w * Math.sin(a) + h * Math.cos(a)));
    k = Math.min(k, fit);
  }
  return q.map(([x, y]) => [(x - 0.5) * k + 0.5, (y - 0.5) * k + 0.5]);
}

export function warpPerspective(src, geo) {
  const G = gl(); if (!G) return src;
  const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
  const quad = geoQuad(geo, W / H);
  const Hm = homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad);
  const { g } = G;
  g.useProgram(G.warp);
  const t = tex(g, 0, src);
  g.uniform1i(g.getUniformLocation(G.warp, 't'), 0);
  g.uniformMatrix3fv(g.getUniformLocation(G.warp, 'H'), true, new Float32Array(Hm));
  const out = draw(G, W, H);
  g.deleteTexture(t);
  return out;
}

// ---------- 2.5D parallax ----------
// cam: {x, y, zoom, focus}; x/y in [-1,1] (fraction of max shift), zoom in [-1,1] (dolly).
export function parallaxScale(cam) {
  const sx = (cam.x || 0) * 0.06, sy = (cam.y || 0) * 0.06;
  return 1 + Math.max(Math.abs(sx), Math.abs(sy)) * 1.25 + Math.abs(cam.zoom || 0) * 0.08;
}
export function parallax(color, depth, cam, mask = null) {
  const G = gl(); if (!G) return color;
  const W = color.naturalWidth || color.width, H = color.naturalHeight || color.height;
  const { g } = G;
  g.useProgram(G.parallax);
  const tc = tex(g, 0, color), td = tex(g, 1, depth), tm = mask ? tex(g, 2, mask) : null;
  const U = (n) => g.getUniformLocation(G.parallax, n);
  g.uniform1i(U('tc'), 0); g.uniform1i(U('td'), 1); g.uniform1i(U('tm'), 2);
  g.uniform2f(U('shift'), (cam.x || 0) * 0.06, (cam.y || 0) * 0.06 * (W / H) * 0.75);
  g.uniform1f(U('zoom'), (cam.zoom || 0) * 0.35);
  g.uniform1f(U('focus'), cam.focus ?? 0.5);
  g.uniform1f(U('scale'), parallaxScale(cam));
  g.uniform1f(U('useMask'), mask ? 1 : 0);
  const out = draw(G, W, H);
  g.deleteTexture(tc); g.deleteTexture(td); if (tm) g.deleteTexture(tm);
  return out;
}
