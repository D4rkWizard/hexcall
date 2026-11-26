'use strict';
// Hexcall Hub – 3D garage: every tank of the installed WoT as a 3D model (own small WebGL2 renderer, no libraries).
// Stage 2: stickers – upload an image, click on the tank, adjust it live, bake it into the tank texture as a .wotmod.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  const PART_LABEL = { chassis: 'Fahrwerk', hull: 'Wanne', turret: 'Turm', gun: 'Kanone' };
  const MAX_DECALS = 6; // live preview: stickers per part
  const G = { tanks: [], nation: 'alle', level: 0, type: 'alle', q: '', current: null, opened: false };
  // sticker state of the current tank
  const ST = { images: [], list: [], sel: null, place: null, applied: null, review: false, saveTimer: 0 };
  // imported 3D models: library, placements on the current tank, GPU cache per library model
  const MD = { models: [], list: [], sel: null, place: null, applied: null, dirty: false, saveTimer: 0, gpu: new Map(), anchor: {} };

  /* ---------------- math (column-major 4x4) ---------------- */
  const M = {
    mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
    t: (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
    s: (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1],
    ry: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
    rx: (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; },
    rz: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
    persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]; },
    look(e, c, u) {
      let z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]]; const zl = Math.hypot(...z); z = z.map((v) => v / zl);
      let x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]]; const xl = Math.hypot(...x); x = x.map((v) => v / xl);
      const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
      return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1];
    },
    inv(m) {
      const o = new Array(16), [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
      const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
      const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
      o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d; o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
      o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d; o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
      o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d; o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
      o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d; o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
      return o;
    },
    xf(m, p, w = 1) { return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] * w); },
  };
  const V = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); },
    scale: (a, s) => a.map((x) => x * s),
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  };

  /* ---------------- renderer ---------------- */
  const VS = `#version 300 es
  layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aUv;
  uniform mat4 uVP, uModel; out vec3 vN; out vec3 vW; out vec2 vUv; out vec3 vL; out vec3 vNL;
  void main(){ vec4 w = uModel * vec4(aPos,1.0); vW = w.xyz; vN = mat3(uModel) * aNrm; vUv = aUv; vL = aPos; vNL = aNrm; gl_Position = uVP * w; }`;
  const FS = `#version 300 es
  precision highp float; in vec3 vN; in vec3 vW; in vec2 vUv; in vec3 vL; in vec3 vNL;
  uniform sampler2D uTex; uniform float uHasTex, uAlphaRef, uHi; uniform vec3 uEye; out vec4 o;
  uniform int uDC; uniform vec3 uDP[${MAX_DECALS}], uDR[${MAX_DECALS}], uDU[${MAX_DECALS}], uDN[${MAX_DECALS}]; uniform vec4 uDX[${MAX_DECALS}], uDK[${MAX_DECALS}]; uniform vec3 uDA[${MAX_DECALS}];
  uniform sampler2D uD0, uD1, uD2, uD3, uD4, uD5;
  vec4 dtex(int i, vec2 uv){ if(i==0) return texture(uD0,uv); if(i==1) return texture(uD1,uv); if(i==2) return texture(uD2,uv); if(i==3) return texture(uD3,uv); if(i==4) return texture(uD4,uv); return texture(uD5,uv); }
  void main(){
    vec4 t = uHasTex > 0.5 ? texture(uTex, vUv) : vec4(0.55,0.55,0.55,1.0);
    if (uAlphaRef > 0.0 && t.a < uAlphaRef) discard;
    vec3 base = t.rgb;
    // live sticker preview – same projection as the bake on the server
    for (int i = 0; i < ${MAX_DECALS}; i++) {
      if (i >= uDC) break;
      vec3 d = vL - uDP[i];
      float u = dot(d, uDR[i]) / dot(uDR[i], uDR[i]) * 0.5 + 0.5, v = dot(d, uDU[i]) / dot(uDU[i], uDU[i]) * 0.5 + 0.5;
      if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) continue;
      if (abs(dot(d, uDN[i])) > uDX[i].z) continue;
      if (dot(normalize(vNL), uDN[i]) < 0.2) continue;
      vec2 su = vec2(uDX[i].y > 0.5 ? 1.0 - u : u, 1.0 - v);
      vec4 s = dtex(i, uDK[i].xy + su * (uDK[i].zw - uDK[i].xy)); // image section (crop)
      // brightness / colour strength / contrast – same formula as the bake on the server
      vec3 cc = (s.rgb - 0.5) * uDA[i].z + 0.5; cc *= uDA[i].x >= 0.0 ? 1.0 + uDA[i].x : 1.0 + uDA[i].x * 0.8;
      float lu = dot(cc, vec3(0.3, 0.59, 0.11)); s.rgb = clamp(lu + (cc - lu) * uDA[i].y, 0.0, 1.0);
      float a = s.a * uDX[i].x;
      base = mix(base, s.rgb, a);
      if (uDX[i].w > 0.5 && (u < 0.012 || u > 0.988 || v < 0.012 || v > 0.988)) base = vec3(0.81,0.61,1.0);
    }
    vec3 alb = pow(base, vec3(2.2));
    vec3 n = normalize(vN); vec3 v = normalize(uEye - vW); if (dot(n,v) < 0.0) n = -n;
    vec3 L1 = normalize(vec3(0.45,0.85,0.35)), L2 = normalize(vec3(-0.6,0.35,-0.7));
    float d1 = max(dot(n,L1),0.0), d2 = max(dot(n,L2),0.0);
    vec3 h = normalize(L1+v); float sp = pow(max(dot(n,h),0.0), 40.0) * 0.18;
    vec3 sky = mix(vec3(0.20,0.16,0.27), vec3(0.62,0.58,0.72), n.y*0.5+0.5);
    float rim = pow(1.0 - max(dot(n,v),0.0), 3.0);
    vec3 c = alb * (sky*0.75 + vec3(1.0,0.96,0.9)*d1*1.55 + vec3(0.55,0.45,0.85)*d2*0.45) + sp + vec3(0.71,0.42,1.0)*rim*0.22;
    c += vec3(0.71,0.42,1.0) * uHi * 0.25;
    c = c / (c + vec3(0.85)) * 1.25;
    o = vec4(pow(c, vec3(1.0/2.2)), 1.0);
  }`;
  const GVS = `#version 300 es
  layout(location=0) in vec3 aPos; uniform mat4 uVP; uniform float uR; out vec2 vP;
  void main(){ vP = aPos.xz; gl_Position = uVP * vec4(aPos.x*uR, 0.0, aPos.z*uR, 1.0); }`;
  const GFS = `#version 300 es
  precision highp float; in vec2 vP; uniform vec2 uShadow; out vec4 o;
  void main(){
    float r = length(vP); if (r > 1.0) discard;
    vec2 g = abs(fract(vP*18.0) - 0.5); float line = smoothstep(0.47,0.5,max(g.x,g.y));
    float fade = 1.0 - smoothstep(0.35,1.0,r);
    vec3 c = vec3(0.10,0.07,0.15) + vec3(0.42,0.24,0.66)*line*0.35*fade;
    vec2 s = vP / uShadow; float sh = smoothstep(1.0,0.2,length(s));
    o = vec4(c*(1.0-sh*0.75), fade*0.95);
  }`;

  const R = { gl: null, canvas: null, prog: null, gprog: null, meshes: [], tex: new Map(), cam: { yaw: 0.75, pitch: 0.28, dist: 9, target: [0, 1.2, 0] }, home: null, yaw: 0, pitch: 0, auto: true, hidden: new Set(), dirty: true, radius: 4, ext: [3, 5], offsets: {} };

  function compile(gl, vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  }

  function initGl() {
    if (R.gl) return true;
    R.canvas = $('#garCanvas');
    const gl = R.canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) { $('#garMsg').textContent = 'WebGL2 ist in diesem Fenster nicht verfügbar.'; $('#garMsg').hidden = false; return false; }
    R.gl = gl;
    R.prog = compile(gl, VS, FS);
    R.gprog = compile(gl, GVS, GFS);
    R.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    // 1x1 transparent texture for unused sticker slots
    R.blank = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, R.blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    // ground disc
    const seg = 96, v = [0, 0, 0];
    for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; v.push(Math.cos(a), 0, Math.sin(a)); }
    R.ground = gl.createVertexArray(); gl.bindVertexArray(R.ground);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    R.groundN = seg + 2;
    gl.bindVertexArray(null);
    bindInput();
    new ResizeObserver(() => { R.dirty = true; }).observe(R.canvas);
    requestAnimationFrame(frame);
    return true;
  }

  // textures by key (url); sticker images are clamped, tank textures repeat
  function texture(url, clamp) {
    if (!url) return null;
    if (R.tex.has(url)) return R.tex.get(url);
    const gl = R.gl, entry = { t: gl.createTexture(), ready: false };
    R.tex.set(url, entry);
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, entry.t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      const wrap = clamp ? gl.CLAMP_TO_EDGE : gl.REPEAT;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      if (R.aniso) gl.texParameterf(gl.TEXTURE_2D, R.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      entry.ready = true; R.dirty = true;
    };
    img.onerror = () => { entry.failed = true; };
    img.src = url;
    return entry;
  }
  const tankTexUrl = (p, baked) => p && `/api/wot/garage/tex?p=${encodeURIComponent(p)}${baked ? `&tank=${encodeURIComponent(G.current)}&v=${encodeURIComponent((ST.applied && ST.applied.at) || '')}` : ''}`;
  const stickerTex = (id) => texture(`/api/wot/garage/sticker-image?id=${id}`, true);

  function upload(buf) {
    const gl = R.gl, dv = new DataView(buf), n = dv.getUint32(0, true), m = dv.getUint32(4, true);
    const f = new Float32Array(buf, 8, n * 8), idx = new Uint32Array(buf, 8 + n * 32, m);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const mk = (data, loc, size) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); return b;
    };
    const pos = f.subarray(0, n * 3), nrm = f.subarray(n * 3, n * 6);
    const bufs = [mk(pos, 0, 3), mk(nrm, 1, 3), mk(f.subarray(n * 6, n * 8), 2, 2)];
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = f[i * 3 + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
    return { vao, count: m, bufs: [...bufs, ib], lo, hi, pos, nrm, idx }; // pos/nrm/idx stay for picking
  }
  function clearMeshes() {
    const gl = R.gl;
    for (const m of R.meshes) { gl.deleteVertexArray(m.vao); m.bufs.forEach((b) => gl.deleteBuffer(b)); }
    R.meshes = [];
  }

  // part transforms: BigWorld is left-handed (x right, y up, z forward) -> mirror x for WebGL
  function partMatrix(part) {
    const t = R.offsets[part] || [0, 0, 0];
    const mirror = M.s(-1, 1, 1);
    if (part === 'chassis' || part === 'hull') return M.mul(mirror, M.t(...t));
    const tur = R.offsets.turret || t;
    const turret = M.mul(mirror, M.mul(M.t(...tur), M.ry(R.yaw)));
    if (part === 'turret') return turret;
    const g = R.offsets.gun || t;
    return M.mul(turret, M.mul(M.t(g[0] - tur[0], g[1] - tur[1], g[2] - tur[2]), M.rx(-R.pitch)));
  }
  function camera() {
    const cam = R.cam, c = R.canvas;
    const eye = [cam.target[0] + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw), cam.target[1] + cam.dist * Math.sin(cam.pitch), cam.target[2] + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw)];
    const vp = M.mul(M.persp(0.62, c.clientWidth / Math.max(1, c.clientHeight), 0.05, 400), M.look(eye, cam.target, [0, 1, 0]));
    return { eye, vp };
  }

  function frame() {
    requestAnimationFrame(frame);
    const gl = R.gl, c = R.canvas;
    if (!$('#page-garage').classList.contains('active') || !$('#view-game-wot').classList.contains('active')) { if (document.documentElement.classList.contains('garage-full')) setFull(false); return; }
    if (!gl || !G.opened) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; R.dirty = true; }
    if (R.auto && !R.drag && R.meshes.length) { R.cam.yaw += 0.0025; R.dirty = true; }
    if (!R.dirty) return;
    R.dirty = false;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const { eye, vp } = camera();

    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(R.gprog.p);
    gl.uniformMatrix4fv(R.gprog.u.uVP, false, vp);
    gl.uniform1f(R.gprog.u.uR, R.radius * 2.2);
    gl.uniform2f(R.gprog.u.uShadow, R.ext[0] / (R.radius * 2.2), R.ext[1] / (R.radius * 2.2));
    gl.bindVertexArray(R.ground); gl.drawArrays(gl.TRIANGLE_FAN, 0, R.groundN);
    gl.disable(gl.BLEND);

    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    const P = R.prog;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, vp);
    gl.uniform3fv(P.u.uEye, eye);
    gl.uniform1i(P.u.uTex, 0);
    for (let i = 0; i < MAX_DECALS; i++) gl.uniform1i(P.u[`uD${i}`], i + 1);
    const mats = {}, decals = {};
    for (const m of R.meshes) {
      if (R.hidden.has(m.part)) continue;
      const mm = mats[m.part] || (mats[m.part] = partMatrix(m.part));
      gl.uniformMatrix4fv(P.u.uModel, false, mm);
      // stickers of this part (live preview only – the review shows the baked texture instead)
      const ds = decals[m.part] || (decals[m.part] = ST.review ? [] : ST.list.filter((s) => s.part === m.part).slice(0, MAX_DECALS));
      gl.uniform1i(P.u.uDC, ds.length);
      if (ds.length) {
        gl.uniform3fv(P.u.uDP, ds.flatMap((s) => s.p)); gl.uniform3fv(P.u.uDR, ds.flatMap((s) => s.r));
        gl.uniform3fv(P.u.uDU, ds.flatMap((s) => s.u)); gl.uniform3fv(P.u.uDN, ds.flatMap((s) => s.n));
        gl.uniform4fv(P.u.uDX, ds.flatMap((s) => [s.opacity, s.flip ? 1 : 0, Math.max(Math.hypot(...s.r), Math.hypot(...s.u)) * 0.6, s.id === ST.sel ? 1 : 0]));
        gl.uniform4fv(P.u.uDK, ds.flatMap((s) => s.crop || [0, 0, 1, 1]));
        gl.uniform3fv(P.u.uDA, ds.flatMap((s) => [s.bright || 0, s.sat == null ? 1 : s.sat, s.contrast == null ? 1 : s.contrast]));
      }
      for (let i = 0; i < MAX_DECALS; i++) {
        gl.activeTexture(gl.TEXTURE1 + i);
        const t = ds[i] && stickerTex(ds[i].image);
        gl.bindTexture(gl.TEXTURE_2D, t && t.ready ? t.t : R.blank);
      }
      gl.activeTexture(gl.TEXTURE0);
      const t = (ST.review && m.texBaked) || m.tex;
      const ready = t && t.ready ? t : m.tex && m.tex.ready ? m.tex : null;
      if (ready) gl.bindTexture(gl.TEXTURE_2D, ready.t);
      gl.uniform1f(P.u.uHasTex, ready ? 1 : 0);
      gl.uniform1f(P.u.uAlphaRef, m.alphaTest ? Math.max(m.alphaRef, 32) / 255 : 0);
      gl.uniform1f(P.u.uHi, R.hover === m.part ? 1 : 0);
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
    }
    // imported models (preview of the placements)
    gl.uniform1i(P.u.uDC, 0);
    gl.uniform1f(P.u.uAlphaRef, 0);
    for (const inst of MD.list) {
      if (R.hidden.has(inst.part)) continue;
      const gm = gpuModel(inst.model);
      if (!gm) continue;
      gl.uniformMatrix4fv(P.u.uModel, false, M.mul(mats[inst.part] || (mats[inst.part] = partMatrix(inst.part)), instMatrix(inst)));
      gl.uniform1f(P.u.uHi, inst.id === MD.sel ? 0.8 : 0);
      for (const g of gm.groups) {
        gl.activeTexture(gl.TEXTURE0);
        const t = g.tex && g.tex.ready ? g.tex : null;
        gl.bindTexture(gl.TEXTURE_2D, t ? t.t : g.solid);
        gl.uniform1f(P.u.uHasTex, 1);
        gl.bindVertexArray(g.vao);
        gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
      }
    }
    gl.bindVertexArray(null);
    drawGizmo(vp);
  }

  /* ---------------- picking: ray from the mouse onto the model (in part-local BigWorld coords) ---------------- */
  function pick(clientX, clientY) {
    const r = R.canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((clientY - r.top) / r.height) * 2;
    const { vp } = camera(), ivp = M.inv(vp);
    const unproj = (z) => { const v = [0, 1, 2, 3].map((k) => ivp[k] * nx + ivp[4 + k] * ny + ivp[8 + k] * z + ivp[12 + k]); return [v[0] / v[3], v[1] / v[3], v[2] / v[3]]; };
    const a = unproj(-1), b = unproj(1);
    let best = null;
    const inv = {};
    for (const m of R.meshes) {
      if (R.hidden.has(m.part)) continue;
      const im = inv[m.part] || (inv[m.part] = M.inv(partMatrix(m.part)));
      const o = M.xf(im, a), d = V.sub(M.xf(im, b), o);
      const { pos, idx } = m;
      for (let t = 0; t < idx.length; t += 3) {
        const i0 = idx[t] * 3, i1 = idx[t + 1] * 3, i2 = idx[t + 2] * 3;
        const e1 = [pos[i1] - pos[i0], pos[i1 + 1] - pos[i0 + 1], pos[i1 + 2] - pos[i0 + 2]], e2 = [pos[i2] - pos[i0], pos[i2 + 1] - pos[i0 + 1], pos[i2 + 2] - pos[i0 + 2]];
        const p = V.cross(d, e2), det = V.dot(e1, p);
        if (Math.abs(det) < 1e-12) continue;
        const s = [o[0] - pos[i0], o[1] - pos[i0 + 1], o[2] - pos[i0 + 2]], u = V.dot(s, p) / det;
        if (u < 0 || u > 1) continue;
        const q = V.cross(s, e1), v = V.dot(d, q) / det;
        if (v < 0 || u + v > 1) continue;
        const tt = V.dot(e2, q) / det;
        if (tt <= 0 || (best && tt >= best.t)) continue;
        let n = V.norm(V.cross(e1, e2));
        if (V.dot(n, d) > 0) n = V.scale(n, -1); // face the camera
        best = { t: tt, part: m.part, p: V.add(o, V.scale(d, tt)), n };
      }
    }
    return best;
  }

  /* ---------------- sticker geometry ---------------- */
  function imgOf(id) { return ST.images.find((x) => x.id === id) || { w: 1, h: 1 }; }
  // recompute right/up vectors from position, normal, size, rotation, aspect
  function orient(s) {
    const n = V.norm(s.n);
    const ref = Math.abs(n[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
    // BigWorld is left-handed and is shown mirrored – this order keeps the image the right way round on screen
    let right = V.norm(V.cross(n, ref));
    let up = V.cross(right, n);
    const a = (s.rot * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
    const r2 = V.add(V.scale(right, c), V.scale(up, sn)), u2 = V.sub(V.scale(up, c), V.scale(right, sn));
    const im = imgOf(s.image), half = s.size / 2, k = s.crop || [0, 0, 1, 1];
    s.r = V.scale(r2, half);
    s.u = V.scale(u2, half * ((im.h * (k[3] - k[1])) / (im.w * (k[2] - k[0])))); // size = width of the visible section
    s.n = n;
    return s;
  }

  /* ---------------- sticker as an object in the 3D view: select, drag, scale, rotate ---------------- */
  const selSticker = () => ST.list.find((q) => q.id === ST.sel);
  function toScreen(part, p, vp) {
    const w = M.xf(partMatrix(part), p);
    const c = [0, 1, 2, 3].map((k) => vp[k] * w[0] + vp[4 + k] * w[1] + vp[8 + k] * w[2] + vp[12 + k]);
    if (c[3] <= 0.0001) return null;
    return [(c[0] / c[3] * 0.5 + 0.5) * R.canvas.clientWidth, (0.5 - c[1] / c[3] * 0.5) * R.canvas.clientHeight];
  }
  function stickerAt(hit) {
    if (!hit) return null;
    return ST.list.find((s) => s.part === hit.part && (() => { const d = V.sub(hit.p, s.p); return Math.abs(V.dot(d, s.r) / V.dot(s.r, s.r)) <= 1 && Math.abs(V.dot(d, s.u) / V.dot(s.u, s.u)) <= 1 && Math.abs(V.dot(d, s.n)) < Math.max(Math.hypot(...s.r), Math.hypot(...s.u)) * 0.6; })()) || null;
  }
  // corners + rotation handle of the selected sticker, drawn as SVG over the canvas
  function drawGizmo(vp) {
    const g = $('#stkGizmo'), s = selSticker();
    if (!s || ST.review || ST.place || MD.place || R.hidden.has(s.part) || $('#tab-stk').hidden) { if (g.innerHTML) g.innerHTML = ''; R.gz = null; return; }
    const P = (v) => toScreen(s.part, v, vp);
    const c = [V.add(V.sub(s.p, s.r), s.u), V.add(V.add(s.p, s.r), s.u), V.sub(V.add(s.p, s.r), s.u), V.sub(V.sub(s.p, s.r), s.u)].map(P);
    const mid = P(s.p), top = P(V.add(s.p, s.u)), knob = P(V.add(s.p, V.scale(s.u, 1.45)));
    if (c.some((x) => !x) || !mid || !knob) { g.innerHTML = ''; R.gz = null; return; }
    // keep the rotation knob at least 26 px away from the top edge
    const dk = Math.hypot(knob[0] - top[0], knob[1] - top[1]), dir = dk > 0.1 ? [(knob[0] - top[0]) / dk, (knob[1] - top[1]) / dk] : [0, -1];
    const kn = [top[0] + dir[0] * Math.max(26, dk), top[1] + dir[1] * Math.max(26, dk)];
    R.gz = { mid, corners: c, knob: kn };
    g.innerHTML = `<polygon class="gz-body" data-gz="move" points="${c.map((p) => p.join(',')).join(' ')}"/>
      <line class="gz-line" x1="${top[0]}" y1="${top[1]}" x2="${kn[0]}" y2="${kn[1]}"/>
      ${c.map((p, i) => `<rect class="gz-scale" data-gz="scale" x="${p[0] - 6}" y="${p[1] - 6}" width="12" height="12" rx="2" style="cursor:${i % 2 ? 'nesw' : 'nwse'}-resize"/>`).join('')}
      <circle class="gz-rot" data-gz="rot" cx="${kn[0]}" cy="${kn[1]}" r="8"/>`;
  }
  // light update of the edit sliders while dragging (no full re-render of the panel)
  function syncEdit(s) {
    $('#stkSize').value = s.size; $('#stkSizeV').textContent = `${s.size.toFixed(2)} m`;
    $('#stkRot').value = s.rot; $('#stkRotV').textContent = `${Math.round(s.rot)}°`;
  }
  const normRot = (r) => ((r + 540) % 360) - 180;
  function startStickerDrag(mode, e) {
    const s = selSticker(); if (!s) return;
    const r = R.canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const mid = R.gz ? R.gz.mid : [mx, my];
    const d = { mode, s, size: s.size, rot: s.rot, mid, a0: Math.atan2(my - mid[1], mx - mid[0]), r0: Math.max(4, Math.hypot(mx - mid[0], my - mid[1])), moved: false, raf: 0, last: null };
    if (mode === 'rot') {
      // which way does the knob turn on screen for +rot? (the model is shown mirrored)
      const { vp } = camera(), probe = { ...s, rot: s.rot + 5 }; orient(probe);
      const k0 = toScreen(s.part, V.add(s.p, s.u), vp), k1 = toScreen(s.part, V.add(probe.p, probe.u), vp);
      const a0 = Math.atan2(k0[1] - mid[1], k0[0] - mid[0]), a1 = Math.atan2(k1[1] - mid[1], k1[0] - mid[0]);
      d.sign = Math.sign(normRot(((a1 - a0) * 180) / Math.PI)) || 1;
    }
    R.sdrag = d; R.auto = false; syncAuto();
    const move = (ev) => {
      d.last = ev;
      if (d.raf) return;
      d.raf = requestAnimationFrame(() => {
        d.raf = 0; const q = d.last, x = q.clientX - r.left, y = q.clientY - r.top;
        if (d.mode === 'move') {
          const hit = pick(q.clientX, q.clientY);
          if (hit) { Object.assign(s, { part: hit.part, p: hit.p, n: hit.n }); orient(s); d.moved = true; }
        } else if (d.mode === 'scale') {
          s.size = Math.max(0.05, Math.min(4, d.size * (Math.hypot(x - d.mid[0], y - d.mid[1]) / d.r0))); orient(s); d.moved = true;
        } else if (d.mode === 'rot') {
          const da = ((Math.atan2(y - d.mid[1], x - d.mid[0]) - d.a0) * 180) / Math.PI;
          let rot = normRot(d.rot + d.sign * da);
          if (q.shiftKey) rot = Math.round(rot / 15) * 15; // snap
          s.rot = rot; orient(s); d.moved = true;
        }
        syncEdit(s); R.dirty = true;
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      R.sdrag = null;
      if (d.moved) changed(); else renderStickers();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  /* ---------------- crop (image section of the selected sticker) ---------------- */
  const CR = { s: null, crop: null, start: null };
  function openCrop() {
    const s = selSticker(); if (!s) return;
    CR.s = s; CR.start = { crop: [...(s.crop || [0, 0, 1, 1])], size: s.size }; CR.crop = [...CR.start.crop];
    const img = $('#cropImg');
    img.onload = () => drawCropRect();
    img.src = `/api/wot/garage/sticker-image?id=${s.image}`;
    $('#cropBox').hidden = false;
    if (img.complete) drawCropRect();
  }
  function drawCropRect() {
    const img = $('#cropImg'), [x0, y0, x1, y1] = CR.crop, w = img.clientWidth, h = img.clientHeight;
    const ox = img.offsetLeft, oy = img.offsetTop; // the stage has padding so the edge handles stay grabbable
    Object.assign($('#cropRect').style, { left: `${ox + x0 * w}px`, top: `${oy + y0 * h}px`, width: `${(x1 - x0) * w}px`, height: `${(y1 - y0) * h}px` });
  }
  function applyCropLive() {
    const s = CR.s; if (!s) return;
    const w0 = CR.start.crop[2] - CR.start.crop[0], w1 = CR.crop[2] - CR.crop[0];
    s.crop = [...CR.crop];
    s.size = Math.max(0.05, Math.min(4, CR.start.size * (w1 / w0))); // the visible part keeps its size on the tank
    orient(s); syncEdit(s); R.dirty = true;
  }
  function closeCrop(keep) {
    if (!CR.s) return;
    if (!keep) { CR.s.crop = CR.start.crop; CR.s.size = CR.start.size; orient(CR.s); R.dirty = true; }
    $('#cropBox').hidden = true;
    const changedCrop = keep && CR.s.crop.join() !== CR.start.crop.join();
    CR.s = null;
    if (changedCrop) changed(); else renderStickers();
  }
  function bindCrop() {
    const stage = $('#cropStage');
    stage.addEventListener('pointerdown', (e) => {
      const handle = e.target.dataset.c, inRect = e.target.closest('#cropRect');
      if (!handle && !inRect) return;
      e.preventDefault(); stage.setPointerCapture(e.pointerId);
      const img = $('#cropImg'), W = img.clientWidth, H = img.clientHeight, sx = e.clientX, sy = e.clientY, c0 = [...CR.crop], min = 0.03;
      const move = (ev) => {
        const dx = (ev.clientX - sx) / W, dy = (ev.clientY - sy) / H;
        let [x0, y0, x1, y1] = c0;
        if (!handle) { const w = x1 - x0, h = y1 - y0; x0 = Math.max(0, Math.min(1 - w, x0 + dx)); y0 = Math.max(0, Math.min(1 - h, y0 + dy)); x1 = x0 + w; y1 = y0 + h; }
        else {
          if (handle.includes('w')) x0 = Math.max(0, Math.min(x1 - min, x0 + dx));
          if (handle.includes('e')) x1 = Math.min(1, Math.max(x0 + min, x1 + dx));
          if (handle.includes('n')) y0 = Math.max(0, Math.min(y1 - min, y0 + dy));
          if (handle.includes('s')) y1 = Math.min(1, Math.max(y0 + min, y1 + dy));
        }
        CR.crop = [x0, y0, x1, y1]; drawCropRect(); applyCropLive();
      };
      const up = () => { stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); };
      stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', up);
    });
    $('#cropReset').addEventListener('click', () => { CR.crop = [0, 0, 1, 1]; drawCropRect(); applyCropLive(); });
    $('#cropCancel').addEventListener('click', () => closeCrop(false));
    $('#cropOk').addEventListener('click', () => closeCrop(true));
    $('#stkCrop').addEventListener('click', () => (CR.s ? closeCrop(true) : openCrop()));
    $('#stkGizmo').addEventListener('pointerdown', (e) => {
      const mode = e.target.dataset && e.target.dataset.gz;
      if (!mode || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      startStickerDrag(mode, e);
    });
  }

  /* ---------------- layout: collapse the tank list / panels, full view (remembered) ---------------- */
  const LAY = { side: false, stk: false, panel: false, off: false };
  try { Object.assign(LAY, JSON.parse(localStorage.getItem('hexhub-garage-layout') || '{}')); } catch {}
  function applyLayout() {
    $('.gar').classList.toggle('side-min', LAY.side);
    $('.stk').classList.toggle('min', LAY.stk);
    $('.gar-panel').classList.toggle('min', LAY.panel);
    $('.gar').classList.toggle('panels-off', LAY.off);
    $('#garSideBtn').title = LAY.side ? 'Panzerliste ausklappen' : 'Panzerliste einklappen';
    $('#stkMin').title = $('#garPanelMin').title = 'Panel minimieren';
    if (LAY.stk) $('#stkMin').title = 'Panel öffnen';
    if (LAY.panel) $('#garPanelMin').title = 'Panel öffnen';
    $('#garPanels').classList.toggle('active', LAY.off);
    $('#garPanels span').textContent = LAY.off ? 'Panels ein' : 'Panels aus';
    const full = document.documentElement.classList.contains('garage-full');
    $('#garFull').classList.toggle('active', full);
    $('#garFull span').textContent = full ? 'Vollbild beenden' : 'Vollbild';
    try { localStorage.setItem('hexhub-garage-layout', JSON.stringify(LAY)); } catch {}
    R.dirty = true;
  }
  function setFull(on) { document.documentElement.classList.toggle('garage-full', on); applyLayout(); }
  function bindLayout() {
    $('#garSideBtn').addEventListener('click', () => { LAY.side = !LAY.side; applyLayout(); });
    $('#stkMin').addEventListener('click', () => { LAY.stk = !LAY.stk; applyLayout(); });
    $('#garPanelMin').addEventListener('click', () => { LAY.panel = !LAY.panel; applyLayout(); });
    $('#garPanels').addEventListener('click', () => { LAY.off = !LAY.off; applyLayout(); });
    $('#garFull').addEventListener('click', () => setFull(!document.documentElement.classList.contains('garage-full')));
    applyLayout();
  }

  /* ---------------- input ---------------- */
  function bindInput() {
    const c = R.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      // a sticker under the mouse: select it and drag it over the tank (instead of turning the camera)
      if (e.button === 0 && !e.shiftKey && !ST.place && !MD.place && !ST.review && !$('#tab-stk').hidden) {
        const found = stickerAt(pick(e.clientX, e.clientY));
        if (found) {
          e.preventDefault();
          if (found.id !== ST.sel) { ST.sel = found.id; renderStickers(); }
          R.dirty = true;
          startStickerDrag('move', e);
          return;
        }
      }
      c.setPointerCapture(e.pointerId);
      R.drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, pan: e.button === 2 || e.shiftKey, button: e.button };
      R.auto = false; syncAuto();
    });
    c.addEventListener('pointermove', (e) => {
      if (!R.drag) return;
      const dx = e.clientX - R.drag.x, dy = e.clientY - R.drag.y; R.drag.x = e.clientX; R.drag.y = e.clientY;
      const cam = R.cam;
      if (R.drag.pan) {
        const s = cam.dist * 0.0016, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
        cam.target[0] -= dx * s * cy; cam.target[2] += dx * s * sy; cam.target[1] += dy * s;
      } else { cam.yaw -= dx * 0.008; cam.pitch = Math.max(-0.1, Math.min(1.45, cam.pitch + dy * 0.006)); }
      R.dirty = true;
    });
    c.addEventListener('pointerup', (e) => {
      const d = R.drag; R.drag = null;
      if (!d || d.button !== 0 || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) return;
      onClick(e.clientX, e.clientY);
    });
    c.addEventListener('wheel', (e) => {
      // Ctrl + wheel = size, Alt + wheel = rotation of the selected sticker
      const s = selSticker();
      if (s && (e.ctrlKey || e.altKey) && !ST.review) {
        e.preventDefault();
        if (e.ctrlKey) s.size = Math.max(0.05, Math.min(4, s.size * Math.exp(-e.deltaY * 0.0015)));
        else s.rot = normRot(s.rot + (e.deltaY > 0 ? 5 : -5));
        orient(s); syncEdit(s); R.dirty = true;
        clearTimeout(R.wheelSave); R.wheelSave = setTimeout(changed, 300);
        return;
      }
    }, { passive: false });
    c.addEventListener('wheel', (e) => { if (e.defaultPrevented) return; e.preventDefault(); R.cam.dist = Math.max(1.5, Math.min(60, R.cam.dist * Math.exp(e.deltaY * 0.0012))); R.dirty = true; }, { passive: false });
    c.addEventListener('dblclick', () => { if (!ST.place) resetView(); });
    // drop images straight onto the tank
    const view = $('.gar-view');
    view.addEventListener('dragover', (e) => { e.preventDefault(); view.classList.add('over'); });
    view.addEventListener('dragleave', () => view.classList.remove('over'));
    view.addEventListener('drop', (e) => {
      e.preventDefault(); view.classList.remove('over');
      const fl = [...e.dataTransfer.files];
      if (fl.some((f) => /\.(glb|gltf|obj)$/i.test(f.name))) { showTab('mdl'); importModel(fl); } else addFiles(fl);
    });
  }
  function onClick(x, y) {
    const hit = pick(x, y);
    if (MD.place) return placeModel(hit);
    if (ST.place) {
      if (!hit) return toast('Daneben – klick direkt auf den Panzer.', true);
      if (ST.place.id) { // move an existing sticker
        const s = ST.list.find((q) => q.id === ST.place.id);
        if (s) { Object.assign(s, { part: hit.part, p: hit.p, n: hit.n }); orient(s); }
      } else {
        const im = imgOf(ST.place.image);
        const s = orient({ id: Date.now().toString(36), image: im.id, part: hit.part, p: hit.p, n: hit.n, size: Math.min(1.2, R.radius * 0.25), rot: 0, opacity: 1, flip: false });
        const same = ST.list.filter((q) => q.part === hit.part).length;
        if (same >= MAX_DECALS) toast(`Auf ${PART_LABEL[hit.part]} werden in der Vorschau nur ${MAX_DECALS} Sticker angezeigt (eingebrannt werden alle).`);
        ST.list.push(s); ST.sel = s.id;
      }
      ST.place = null;
      changed();
      return;
    }
    // select a sticker by clicking on it
    if (hit) {
      const found = ST.list.find((s) => s.part === hit.part && (() => { const d = V.sub(hit.p, s.p); return Math.abs(V.dot(d, s.r) / V.dot(s.r, s.r)) <= 1 && Math.abs(V.dot(d, s.u) / V.dot(s.u, s.u)) <= 1 && Math.abs(V.dot(d, s.n)) < Math.max(Math.hypot(...s.r), Math.hypot(...s.u)) * 0.6; })());
      if (found && found.id !== ST.sel) { ST.sel = found.id; renderStickers(); R.dirty = true; }
    }
  }
  function resetView() { if (R.home) { R.cam = JSON.parse(JSON.stringify(R.home)); R.dirty = true; } }
  function syncAuto() { $('#garAuto').classList.toggle('active', R.auto); }
  function toast(t, err) {
    const el = document.createElement('div');
    el.className = `toast ${err ? 'err' : ''}`; el.textContent = t;
    document.body.appendChild(el); setTimeout(() => el.remove(), 5000);
  }

  /* ---------------- sticker panel ---------------- */
  async function loadStickers(id) {
    const d = await (await fetch(`/api/wot/garage/stickers?tank=${encodeURIComponent(id)}`)).json();
    if (G.current !== id) return;
    if (CR.s) { CR.s = null; $('#cropBox').hidden = true; }
    ST.images = d.images || []; ST.list = (d.stickers || []).map((s) => orient({ ...s })); ST.applied = d.applied; ST.modOnDisk = !!d.modOnDisk; ST.sel = null; ST.place = null;
    ST.review = false;
    renderStickers(); R.dirty = true;
  }
  function changed() {
    if (ST.review) setReview(false);
    renderStickers(); R.dirty = true;
    clearTimeout(ST.saveTimer);
    const id = G.current, list = ST.list.map(({ id: sid, image, part, p, n, r, u, opacity, size, rot, flip, crop, bright, sat, contrast }) => ({ id: sid, image, part, p, n, r, u, opacity, size, rot, flip, crop, bright, sat, contrast }));
    ST.saveTimer = setTimeout(() => fetch('/api/wot/garage/stickers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tank: id, stickers: list }) })
      .then((r) => r.json()).then((d) => { if (d.error) toast(d.error, true); }), 350);
    ST.dirty = true;
    syncApply();
  }
  function syncApply() {
    const a = ST.applied;
    const note = $('#stkStatus');
    if (ST.dirty && (ST.list.length || a)) note.innerHTML = '<span class="warn">Noch nicht in WoT – „Anwenden“ drücken.</span>';
    else if (a) note.innerHTML = `In WoT eingebaut: ${a.count} Sticker · ${new Date(a.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    else if (!ST.list.length && ST.modOnDisk) note.innerHTML = '<span class="warn">Im Spielordner liegt noch eine Sticker-Mod – „Sticker aus WoT entfernen“ drücken.</span>';
    else note.textContent = ST.list.length ? '' : 'Noch keine Sticker auf diesem Panzer.';
    // a sticker mod may still be in the game folder although nothing is stored here (e.g. removal failed while WoT ran)
    const removable = !ST.list.length && (a || ST.modOnDisk);
    $('#stkApply').disabled = !ST.list.length && !removable;
    $('#stkApply').lastChild.textContent = removable ? 'Sticker aus WoT entfernen' : 'Anwenden (in WoT einbauen)';
    $('#stkReview').disabled = !a || ST.dirty;
    $('#stkReview').classList.toggle('active', ST.review);
  }
  function renderStickers() {
    $('#stkImages').innerHTML = ST.images.map((im) => `<button class="stk-img ${ST.place && ST.place.image === im.id && !ST.place.id ? 'active' : ''}" data-img="${im.id}" title="${esc(im.name)} – anklicken, dann auf den Panzer klicken">
      <img src="/api/wot/garage/sticker-image?id=${im.id}" alt=""><i data-delimg="${im.id}" title="Bild löschen">×</i></button>`).join('')
      + '<label class="stk-img add" title="Bild hinzufügen (PNG, JPG, WebP, SVG)"><input type="file" id="stkFile" accept="image/*" multiple hidden><svg><use href="#i-plus"/></svg></label>';
    $('#stkPlaceHint').hidden = !(ST.place || MD.place);
    $('#garCanvas').classList.toggle('placing', !!(ST.place || MD.place));
    const res = !ST.dirty && ST.applied && ST.applied.resolution ? Object.fromEntries(ST.applied.resolution.map((x) => [x.id, x.px])) : {};
    $('#stkList').innerHTML = ST.list.map((s, i) => `<button class="stk-item ${s.id === ST.sel ? 'active' : ''}" data-stk="${s.id}">
      <img src="/api/wot/garage/sticker-image?id=${s.image}" alt=""><span>Sticker ${i + 1}<small>${PART_LABEL[s.part]}${res[s.id] != null ? ` · <b class="${res[s.id] < 90 ? 'lowres' : ''}" title="So viele Pixel breit ist der Sticker in der WoT-Textur">≈ ${res[s.id]} px</b>` : ''}</small></span></button>`).join('');
    const s = ST.list.find((q) => q.id === ST.sel);
    $('#stkEdit').hidden = !s;
    if (s) {
      $('#stkSize').value = s.size; $('#stkSizeV').textContent = `${s.size.toFixed(2)} m`;
      $('#stkRot').value = s.rot; $('#stkRotV').textContent = `${Math.round(s.rot)}°`;
      $('#stkOp').value = Math.round(s.opacity * 100); $('#stkOpV').textContent = `${Math.round(s.opacity * 100)} %`;
      $('#stkFlip').checked = !!s.flip;
      const br = Math.round((s.bright || 0) * 100), sa = Math.round((s.sat == null ? 1 : s.sat) * 100), co = Math.round((s.contrast == null ? 1 : s.contrast) * 100);
      $('#stkBright').value = br; $('#stkBrightV').textContent = `${br > 0 ? '+' : ''}${br} %`;
      $('#stkSat').value = sa; $('#stkSatV').textContent = `${sa} %`;
      $('#stkCon').value = co; $('#stkConV').textContent = `${co} %`;
      $('#stkMove').classList.toggle('active', !!(ST.place && ST.place.id === s.id));
    }
    syncApply();
  }
  function setReview(on) {
    ST.review = on;
    if (on) for (const m of R.meshes) if (m.diffuse && ST.applied && ST.applied.textures.includes(m.diffuse)) m.texBaked = texture(tankTexUrl(m.diffuse, true));
    R.dirty = true; syncApply();
  }
  async function addFiles(files) {
    for (const f of [...(files || [])].filter((x) => /^image\//.test(x.type))) {
      try {
        // normalise in the browser: max 1024 px, PNG with alpha – the server only needs to read plain PNG
        const url = URL.createObjectURL(f);
        const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('Bild konnte nicht gelesen werden')); i.src = url; });
        const k = Math.min(1, 1024 / Math.max(img.naturalWidth || 512, img.naturalHeight || 512));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round((img.naturalWidth || 512) * k)); cv.height = Math.max(1, Math.round((img.naturalHeight || 512) * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
        const r = await fetch(`/api/wot/garage/sticker-image?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: blob });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Upload fehlgeschlagen');
        ST.images.unshift(d);
        ST.place = { image: d.id };
        renderStickers();
        toast('Bild hinzugefügt – jetzt auf den Panzer klicken, um es zu platzieren.');
      } catch (e) { toast(`${f.name}: ${e.message}`, true); }
    }
  }
  async function applyStickers() {
    const btn = $('#stkApply');
    btn.disabled = true; document.body.classList.add('wait');
    $('#stkStatus').textContent = 'Brenne Sticker in die Texturen ein …';
    try {
      clearTimeout(ST.saveTimer);
      await fetch('/api/wot/garage/stickers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tank: G.current, stickers: ST.list }) });
      const r = await fetch('/api/wot/garage/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tank: G.current }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Fehler');
      ST.applied = d.applied; ST.modOnDisk = !!d.mod; ST.dirty = false;
      for (const m of R.meshes) m.texBaked = null;
      for (const w of d.warnings || []) toast(w, true);
      if (d.clash && d.clash.length) toast('Ein anderer Panzer benutzt dieselbe Textur – dessen Sticker überschreiben sich gegenseitig.', true);
      if (ST.applied) { setReview(true); toast('In WoT eingebaut. Wirkt nach dem nächsten Start von World of Tanks. Du siehst jetzt die Prüfansicht.'); }
      else toast('Sticker dieses Panzers aus WoT entfernt.');
      renderStickers();
    } catch (e) { toast(e.message, true); syncApply(); }
    finally { document.body.classList.remove('wait'); btn.disabled = false; syncApply(); }
  }

  /* ---------------- imported 3D models (stage 3) ---------------- */
  const modelOf = (id) => MD.models.find((m) => m.id === id);
  const fmtM = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)} m`;
  // T(pos) * Ry * Rx * Rz * S – column-major 4x4 for the preview
  function instMatrix(inst) {
    const d = Math.PI / 180, [rx, ry, rz] = inst.rot;
    return M.mul(M.t(...inst.pos), M.mul(M.ry(ry * d), M.mul(M.rx(rx * d), M.mul(M.rz(rz * d), M.s(inst.scale, inst.scale, inst.scale)))));
  }
  // row-major 3x4 for the server (same transform)
  function instRows(inst) { const m = instMatrix(inst); return [0, 1, 2].flatMap((r) => [m[r], m[4 + r], m[8 + r], m[12 + r]]); }

  function gpuModel(id) {
    if (MD.gpu.has(id)) return MD.gpu.get(id).ready ? MD.gpu.get(id) : null;
    const entry = { ready: false, groups: [] };
    MD.gpu.set(id, entry);
    const meta = modelOf(id);
    if (!meta) return null;
    fetch(`/api/wot/garage/model-bin?id=${id}`).then((r) => r.arrayBuffer()).then((buf) => {
      const gl = R.gl;
      let off = 0;
      for (const g of meta.groups) {
        const f = new Float32Array(buf, off, g.vc * 8), idx = new Uint32Array(buf, off + g.vc * 32, g.ic);
        off += g.vc * 32 + g.ic * 4;
        const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        [[f.subarray(0, g.vc * 3), 0, 3], [f.subarray(g.vc * 3, g.vc * 6), 1, 3], [f.subarray(g.vc * 6), 2, 2]].forEach(([data, loc, n]) => {
          const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
          gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
        });
        const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
        gl.bindVertexArray(null);
        const solid = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, solid);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([...g.color, 255]));
        entry.groups.push({ vao, count: g.ic, solid, tex: g.tex ? texture(`/api/wot/garage/model-tex?id=${id}&g=${g.i}`) : null });
      }
      entry.ready = true; R.dirty = true;
    }).catch(() => toast('Modell konnte nicht geladen werden', true));
    return null;
  }

  async function loadPlacements(id) {
    const d = await (await fetch(`/api/wot/garage/placements?tank=${encodeURIComponent(id)}`)).json();
    if (G.current !== id) return;
    MD.models = d.models || []; MD.list = d.list || []; MD.applied = d.applied; MD.sel = null; MD.place = null; MD.dirty = false;
    MD.anchor = Object.fromEntries(MD.list.map((x) => [x.id, [...x.pos]]));
    renderModels();
  }
  async function importModel(files) {
    document.body.classList.add('wait');
    try {
      const { meta, body } = await Import3D.fromFiles(files);
      const r = await fetch(`/api/wot/garage/model?name=${encodeURIComponent(meta.name)}`, { method: 'POST', body });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Import fehlgeschlagen');
      MD.models.unshift(d);
      MD.place = { model: d.id };
      renderModels();
      toast(`„${d.name}“ importiert (${d.tris.toLocaleString('de-DE')} Dreiecke) – jetzt auf den Panzer klicken.`);
    } catch (e) { toast(e.message, true); }
    finally { document.body.classList.remove('wait'); }
  }
  function placeModel(hit) {
    if (!hit) return toast('Daneben – klick direkt auf den Panzer.', true);
    if (MD.place.id) {
      const inst = MD.list.find((x) => x.id === MD.place.id);
      if (inst) { inst.part = hit.part; inst.pos = hit.p; MD.anchor[inst.id] = [...hit.p]; }
    } else {
      const meta = modelOf(MD.place.model);
      const size = Math.max(...(meta.size || [1, 1, 1])) || 1;
      const inst = { id: Date.now().toString(36), model: meta.id, part: hit.part, pos: hit.p, rot: [0, 0, 0], scale: Math.min(50, Math.max(0.01, (R.radius * 0.18) / size)) };
      MD.list.push(inst); MD.anchor[inst.id] = [...hit.p]; MD.sel = inst.id;
    }
    MD.place = null;
    modelsChanged();
  }
  function modelsChanged() {
    MD.dirty = true;
    renderModels(); R.dirty = true;
    clearTimeout(MD.saveTimer);
    const id = G.current, list = MD.list.map((x) => ({ ...x, m: instRows(x) }));
    MD.saveTimer = setTimeout(() => fetch('/api/wot/garage/placements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tank: id, list }) })
      .then((r) => r.json()).then((d) => { if (d.error) toast(d.error, true); }), 350);
  }
  function renderModels() {
    $('#mdlLib').innerHTML = MD.models.map((m) => `<div class="mdl-it ${MD.place && MD.place.model === m.id && !MD.place.id ? 'active' : ''}">
      <span class="nm" title="${esc(m.name)}">${esc(m.name)}<br><small>${m.tris.toLocaleString('de-DE')} Dreiecke · ${m.groups.length} Teil${m.groups.length > 1 ? 'e' : ''}</small></span>
      <button class="btn ghost" data-add="${m.id}">Anbauen</button><button class="btn ghost icon" data-delmdl="${m.id}" title="Aus der Sammlung löschen"><svg><use href="#i-trash"/></svg></button></div>`).join('');
    $('#mdlList').innerHTML = MD.list.map((x, i) => `<button class="stk-item ${x.id === MD.sel ? 'active' : ''}" data-inst="${x.id}">
      <span class="ico3d"><svg><use href="#i-tank"/></svg></span><span>${esc((modelOf(x.model) || {}).name || 'Modell')}<small>Anbau ${i + 1} · ${PART_LABEL[x.part]}</small></span></button>`).join('');
    $('#stkPlaceHint').hidden = !(ST.place || MD.place);
    $('#garCanvas').classList.toggle('placing', !!(ST.place || MD.place));
    const inst = MD.list.find((x) => x.id === MD.sel);
    $('#mdlEdit').hidden = !inst;
    if (inst) {
      const a = MD.anchor[inst.id] || inst.pos, meta = modelOf(inst.model) || { size: [1, 1, 1] };
      const set = (id, v, txt) => { $(`#${id}`).value = v; $(`#${id}V`).textContent = txt; };
      set('mdlScale', Math.log(inst.scale).toFixed(2), `${(Math.max(...meta.size) * inst.scale).toFixed(2)} m`);
      // ← → is shown mirrored like the screen (WoT x points the other way)
      set('mdlX', -(inst.pos[0] - a[0]), fmtM(-(inst.pos[0] - a[0])));
      set('mdlY', inst.pos[1] - a[1], fmtM(inst.pos[1] - a[1]));
      set('mdlZ', inst.pos[2] - a[2], fmtM(inst.pos[2] - a[2]));
      set('mdlRY', inst.rot[1], `${Math.round(inst.rot[1])}°`); set('mdlRX', inst.rot[0], `${Math.round(inst.rot[0])}°`); set('mdlRZ', inst.rot[2], `${Math.round(inst.rot[2])}°`);
      $('#mdlInfo').textContent = `an ${PART_LABEL[inst.part]}`;
      $('#mdlMove').classList.toggle('active', !!(MD.place && MD.place.id === inst.id));
    }
    const ap = MD.applied, note = $('#mdlStatus');
    if (MD.dirty && (MD.list.length || ap)) note.innerHTML = '<span class="warn">Noch nicht in WoT – „Anwenden“ drücken.</span>';
    else if (ap) note.textContent = `In WoT eingebaut: ${ap.count} Anbau${ap.count > 1 ? 'ten' : ''} · ${new Date(ap.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    else note.textContent = MD.list.length ? '' : MD.models.length ? 'Noch nichts an diesem Panzer angebaut.' : 'Noch keine Modelle importiert.';
    $('#mdlApply').disabled = !MD.list.length && !ap;
    $('#mdlApply').lastChild.textContent = !MD.list.length && ap ? 'Anbauten aus WoT entfernen' : 'Anwenden (in WoT einbauen)';
  }
  async function applyModels() {
    const btn = $('#mdlApply');
    btn.disabled = true; document.body.classList.add('wait');
    $('#mdlStatus').textContent = 'Baue die Modelle in die Panzerdateien ein …';
    try {
      clearTimeout(MD.saveTimer);
      await fetch('/api/wot/garage/placements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tank: G.current, list: MD.list.map((x) => ({ ...x, m: instRows(x) })) }) });
      const r = await fetch('/api/wot/garage/apply-models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tank: G.current }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Fehler');
      MD.applied = d.applied; MD.dirty = false;
      for (const w of d.warnings || []) toast(w, true);
      toast(MD.applied ? 'In WoT eingebaut. Wirkt nach dem nächsten Start von World of Tanks.' : 'Anbauten dieses Panzers aus WoT entfernt.');
    } catch (e) { toast(e.message, true); }
    finally { document.body.classList.remove('wait'); btn.disabled = false; renderModels(); }
  }
  function showTab(t) {
    document.querySelectorAll('.stk-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    $('#tab-stk').hidden = t !== 'stk'; $('#tab-mdl').hidden = t !== 'mdl';
    if (t === 'stk') MD.place = null; else ST.place = null;
    renderStickers(); renderModels();
  }

  /* ---------------- loading a tank ---------------- */
  async function loadTank(id) {
    if (!initGl()) return;
    G.current = id;
    renderList();
    const msg = $('#garMsg');
    msg.textContent = 'Lade Modell …'; msg.hidden = false;
    try {
      const info = await (await fetch(`/api/wot/garage/tank?id=${encodeURIComponent(id)}`)).json();
      if (info.error) throw new Error(info.error);
      if (G.current !== id) return;
      const all = info.parts.flatMap((p) => p.meshes.map((m) => ({ ...m, part: p.part })));
      if (!all.length) throw new Error('Für diesen Panzer gibt es kein Modell in deiner Installation.');
      let done = 0;
      const [loaded] = await Promise.all([Promise.all(all.map(async (m) => {
        const buf = await (await fetch(`/api/wot/garage/mesh?id=${encodeURIComponent(id)}&i=${m.i}`)).arrayBuffer();
        msg.textContent = `Lade Modell … ${++done}/${all.length}`;
        return { m, buf };
      })), loadStickers(id), loadPlacements(id)]);
      if (G.current !== id) return;
      clearMeshes();
      R.offsets = Object.fromEntries(info.parts.map((p) => [p.part, p.offset]));
      R.yaw = 0; R.pitch = 0; $('#garYaw').value = 0; $('#garPitch').value = 0;
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const { m, buf } of loaded) {
        const g = upload(buf);
        R.meshes.push({ ...g, part: m.part, alphaTest: m.alphaTest, alphaRef: m.alphaRef, diffuse: m.diffuse, tex: texture(tankTexUrl(m.diffuse)) });
        const o = R.offsets[m.part] || [0, 0, 0];
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], g.lo[k] + o[k]); hi[k] = Math.max(hi[k], g.hi[k] + o[k]); }
      }
      const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      const rad = Math.max(1, Math.hypot(...size) / 2);
      R.radius = rad; R.ext = [size[0] * 0.62, size[2] * 0.56];
      const asp = R.canvas.clientWidth / Math.max(1, R.canvas.clientHeight);
      R.home = { yaw: 0.75, pitch: 0.28, dist: rad * 3.0 * Math.max(1, 1.5 / asp), target: [-(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) * 0.42, (lo[2] + hi[2]) / 2] };
      R.cam = JSON.parse(JSON.stringify(R.home));
      R.dirty = true;
      const t = G.tanks.find((x) => x.id === id) || {};
      $('#garTitle').textContent = info.name;
      $('#garMeta').textContent = [t.nationName, t.level ? `Stufe ${ROMAN[t.level]}` : '', t.type, t.premium ? 'Premium/Spezial' : ''].filter(Boolean).join(' · ');
      $('#garParts').innerHTML = info.parts.map((p) => `<button class="chip ${R.hidden.has(p.part) ? '' : 'active'}" data-part="${p.part}">${esc(p.label)}</button>`).join('');
      const tris = info.parts.reduce((a, p) => a + p.meshes.reduce((b, m) => b + m.triangles, 0), 0);
      $('#garStats').textContent = `${tris.toLocaleString('de-DE')} Dreiecke · ${all.length} Teile`;
      $('#garHud').hidden = false;
      ST.dirty = false;
      renderStickers();
      msg.hidden = true;
    } catch (e) {
      if (G.current === id) { msg.textContent = e.message; msg.hidden = false; }
    }
  }

  /* ---------------- list ---------------- */
  function filtered() {
    const q = G.q.trim().toLowerCase();
    return G.tanks.filter((t) => (G.nation === 'alle' || t.nation === G.nation) && (!G.level || t.level === G.level) && (G.type === 'alle' || t.type === G.type)
      && (!q || t.name.toLowerCase().includes(q) || t.short.toLowerCase().includes(q) || t.key.toLowerCase().includes(q)));
  }
  function renderList() {
    const l = filtered();
    $('#garCount').textContent = `${l.length} Panzer`;
    $('#garList').innerHTML = l.slice(0, 400).map((t) => `<button class="gt ${t.id === G.current ? 'active' : ''}" data-tank="${esc(t.id)}">
      <span class="gt-lvl">${ROMAN[t.level] || ''}</span><span class="gt-name">${esc(t.name)}${t.premium ? ' <i class="gt-prem">★</i>' : ''}</span><span class="gt-type">${esc(t.type)}</span></button>`).join('')
      + (l.length > 400 ? `<div class="note" style="padding:8px 12px">… ${l.length - 400} weitere – Suche oder Filter benutzen</div>` : '');
  }
  function fillFilters() {
    const nations = [...new Map(G.tanks.map((t) => [t.nation, t.nationName])).entries()];
    $('#garNation').innerHTML = '<option value="alle">Alle Nationen</option>' + nations.map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    $('#garLevel').innerHTML = '<option value="0">Alle Stufen</option>' + ROMAN.slice(1).map((r, i) => `<option value="${i + 1}">Stufe ${r}</option>`).join('');
    const types = [...new Set(G.tanks.map((t) => t.type))];
    $('#garType').innerHTML = '<option value="alle">Alle Klassen</option>' + types.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  }

  async function open() {
    G.opened = true;
    R.dirty = true;
    if (G.tanks.length) return;
    $('#garList').innerHTML = '<div class="note" style="padding:12px">Lese Panzerliste aus deiner WoT-Installation …</div>';
    try {
      const r = await fetch('/api/wot/garage/tanks'); const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Fehler');
      G.tanks = d; fillFilters(); renderList();
      const first = d.find((t) => t.key === 'G12_Ltraktor') || d[0];
      if (first) loadTank(first.id);
    } catch (e) { $('#garList').innerHTML = `<div class="note" style="padding:12px">${esc(e.message)}</div>`; }
  }

  // the module is loaded after the page (Hexhub loads it on demand): run right away if the DOM is ready
  const whenReady = (fn) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn());
  whenReady(() => {
    $('#garSearch').addEventListener('input', (e) => { G.q = e.target.value; renderList(); });
    $('#garNation').addEventListener('change', (e) => { G.nation = e.target.value; renderList(); });
    $('#garLevel').addEventListener('change', (e) => { G.level = Number(e.target.value); renderList(); });
    $('#garType').addEventListener('change', (e) => { G.type = e.target.value; renderList(); });
    $('#garList').addEventListener('click', (e) => { const b = e.target.closest('[data-tank]'); if (b) loadTank(b.dataset.tank); });
    $('#garParts').addEventListener('click', (e) => {
      const b = e.target.closest('[data-part]'); if (!b) return;
      const p = b.dataset.part; R.hidden.has(p) ? R.hidden.delete(p) : R.hidden.add(p);
      b.classList.toggle('active', !R.hidden.has(p)); R.dirty = true;
    });
    $('#garParts').addEventListener('mouseover', (e) => { const b = e.target.closest('[data-part]'); R.hover = b ? b.dataset.part : null; R.dirty = true; });
    $('#garParts').addEventListener('mouseleave', () => { R.hover = null; R.dirty = true; });
    $('#garYaw').addEventListener('input', (e) => { R.yaw = (Number(e.target.value) * Math.PI) / 180; R.dirty = true; });
    $('#garPitch').addEventListener('input', (e) => { R.pitch = (Number(e.target.value) * Math.PI) / 180; R.dirty = true; });
    $('#garReset').addEventListener('click', resetView);
    $('#garAuto').addEventListener('click', () => { R.auto = !R.auto; syncAuto(); });

    // stickers
    $('#stkImages').addEventListener('change', (e) => { if (e.target.id === 'stkFile') { addFiles(e.target.files); e.target.value = ''; } });
    $('#stkImages').addEventListener('click', async (e) => {
      const del = e.target.closest('[data-delimg]');
      if (del) {
        e.preventDefault(); e.stopPropagation();
        if (!confirm('Dieses Bild aus deiner Sticker-Sammlung löschen?')) return;
        const r = await fetch('/api/wot/garage/sticker-image/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: del.dataset.delimg }) });
        const d = await r.json();
        if (!r.ok) return toast(d.error, true);
        ST.images = d; if (ST.place && ST.place.image === del.dataset.delimg) ST.place = null; renderStickers();
        return;
      }
      const b = e.target.closest('[data-img]');
      if (!b) return;
      ST.place = ST.place && ST.place.image === b.dataset.img && !ST.place.id ? null : { image: b.dataset.img };
      R.auto = false; syncAuto();
      renderStickers();
    });
    bindCrop();
    bindLayout();
    $('#stkList').addEventListener('click', (e) => { const b = e.target.closest('[data-stk]'); if (!b) return; ST.sel = ST.sel === b.dataset.stk ? null : b.dataset.stk; ST.place = null; renderStickers(); R.dirty = true; });
    const edit = (fn) => () => { const s = ST.list.find((q) => q.id === ST.sel); if (!s) return; fn(s); orient(s); changed(); };
    $('#stkSize').addEventListener('input', edit((s) => { s.size = Number($('#stkSize').value); }));
    $('#stkRot').addEventListener('input', edit((s) => { s.rot = Number($('#stkRot').value); }));
    $('#stkOp').addEventListener('input', edit((s) => { s.opacity = Number($('#stkOp').value) / 100; }));
    $('#stkFlip').addEventListener('change', edit((s) => { s.flip = $('#stkFlip').checked; }));
    $('#stkBright').addEventListener('input', edit((s) => { s.bright = Number($('#stkBright').value) / 100; }));
    $('#stkSat').addEventListener('input', edit((s) => { s.sat = Number($('#stkSat').value) / 100; }));
    $('#stkCon').addEventListener('input', edit((s) => { s.contrast = Number($('#stkCon').value) / 100; }));
    $('#stkMove').addEventListener('click', () => { const s = ST.list.find((q) => q.id === ST.sel); if (!s) return; ST.place = ST.place && ST.place.id === s.id ? null : { id: s.id, image: s.image }; R.auto = false; syncAuto(); renderStickers(); });
    $('#stkDel').addEventListener('click', () => { ST.list = ST.list.filter((q) => q.id !== ST.sel); ST.sel = null; changed(); });
    $('#stkApply').addEventListener('click', applyStickers);
    $('#stkReview').addEventListener('click', () => setReview(!ST.review));
    // 3D models
    document.querySelector('.stk-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
    $('#mdlFile').addEventListener('change', (e) => { importModel(e.target.files); e.target.value = ''; });
    $('#mdlLib').addEventListener('click', async (e) => {
      const add = e.target.closest('[data-add]'), del = e.target.closest('[data-delmdl]');
      if (add) { MD.place = MD.place && MD.place.model === add.dataset.add && !MD.place.id ? null : { model: add.dataset.add }; R.auto = false; syncAuto(); renderModels(); }
      if (del) {
        if (!confirm('Dieses Modell aus deiner Sammlung löschen?')) return;
        const r = await fetch('/api/wot/garage/model/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: del.dataset.delmdl }) });
        const d = await r.json();
        if (!r.ok) return toast(d.error, true);
        MD.models = d; renderModels();
      }
    });
    $('#mdlList').addEventListener('click', (e) => { const b = e.target.closest('[data-inst]'); if (!b) return; MD.sel = MD.sel === b.dataset.inst ? null : b.dataset.inst; MD.place = null; renderModels(); R.dirty = true; });
    const medit = (fn) => () => { const x = MD.list.find((q) => q.id === MD.sel); if (!x) return; fn(x, MD.anchor[x.id] || x.pos); modelsChanged(); };
    $('#mdlScale').addEventListener('input', medit((x) => { x.scale = Math.exp(Number($('#mdlScale').value)); }));
    $('#mdlX').addEventListener('input', medit((x, a) => { x.pos = [a[0] - Number($('#mdlX').value), x.pos[1], x.pos[2]]; }));
    $('#mdlY').addEventListener('input', medit((x, a) => { x.pos = [x.pos[0], a[1] + Number($('#mdlY').value), x.pos[2]]; }));
    $('#mdlZ').addEventListener('input', medit((x, a) => { x.pos = [x.pos[0], x.pos[1], a[2] + Number($('#mdlZ').value)]; }));
    $('#mdlRY').addEventListener('input', medit((x) => { x.rot = [x.rot[0], Number($('#mdlRY').value), x.rot[2]]; }));
    $('#mdlRX').addEventListener('input', medit((x) => { x.rot = [Number($('#mdlRX').value), x.rot[1], x.rot[2]]; }));
    $('#mdlRZ').addEventListener('input', medit((x) => { x.rot = [x.rot[0], x.rot[1], Number($('#mdlRZ').value)]; }));
    $('#mdlMove').addEventListener('click', () => { const x = MD.list.find((q) => q.id === MD.sel); if (!x) return; MD.place = MD.place && MD.place.id === x.id ? null : { id: x.id, model: x.model }; R.auto = false; syncAuto(); renderModels(); });
    $('#mdlDel').addEventListener('click', () => { MD.list = MD.list.filter((q) => q.id !== MD.sel); MD.sel = null; modelsChanged(); });
    $('#mdlApply').addEventListener('click', applyModels);

    document.addEventListener('keydown', (e) => {
      if (!$('#page-garage').classList.contains('active') || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === 'Escape' && CR.s) { closeCrop(false); return; }
      if (e.key === 'Escape' && document.documentElement.classList.contains('garage-full') && !ST.place && !MD.place) { setFull(false); return; }
      if (!e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'f' || e.key === 'F')) { setFull(!document.documentElement.classList.contains('garage-full')); return; }
      if (!e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'h' || e.key === 'H')) { LAY.off = !LAY.off; applyLayout(); return; }
      if (e.key === 'Escape' && (ST.place || MD.place)) { ST.place = null; MD.place = null; renderStickers(); renderModels(); }
      if (e.key === 'Delete' || e.key === 'Entf') { if (!$('#tab-mdl').hidden && MD.sel) $('#mdlDel').click(); else if (ST.sel) $('#stkDel').click(); }
    });
  });

  window.Garage = { open };
  if (/[?&]debug\b/.test(location.search)) Object.assign(window.Garage, { _r: R, _st: ST, _md: MD, _pick: pick, _orient: orient, _changed: changed, _placeModel: placeModel, _modelsChanged: modelsChanged });
})();
