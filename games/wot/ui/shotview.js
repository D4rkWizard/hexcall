'use strict';
// Hexcall Hub – 3D view for the hit analysis: one tank, one shot. The shell is drawn as a 3D model at the impact point,
// with its flight path; ricochets continue to the next impact. Own small WebGL2 renderer (independent of the garage).
window.ShotView = (() => {
  const M = {
    mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
    t: (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
    s: (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1],
    persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]; },
    look(e, c, u) {
      let z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]]; const zl = Math.hypot(...z); z = z.map((v) => v / zl);
      let x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]]; const xl = Math.hypot(...x) || 1; x = x.map((v) => v / xl);
      const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
      return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1];
    },
    // 4x4 that maps local +Z onto direction d (shell axis), placed at p
    orient(p, d, s) {
      const z = norm(d), ref = Math.abs(z[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
      const x = norm(cross(ref, z)), y = cross(z, x);
      return [x[0] * s, x[1] * s, x[2] * s, 0, y[0] * s, y[1] * s, y[2] * s, 0, z[0] * s, z[1] * s, z[2] * s, 0, p[0], p[1], p[2], 1];
    },
  };
  const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  const VS = `#version 300 es
  layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aUv;
  uniform mat4 uVP, uModel; out vec3 vN; out vec3 vW; out vec2 vUv;
  void main(){ vec4 w = uModel * vec4(aPos,1.0); vW = w.xyz; vN = mat3(uModel) * aNrm; vUv = aUv; gl_Position = uVP * w; }`;
  const FS = `#version 300 es
  precision highp float; in vec3 vN; in vec3 vW; in vec2 vUv;
  uniform sampler2D uTex; uniform float uHasTex, uAlphaRef, uFade, uEmit; uniform vec3 uColor, uEye; out vec4 o;
  void main(){
    vec4 t = uHasTex > 0.5 ? texture(uTex, vUv) : vec4(uColor, 1.0);
    if (uAlphaRef > 0.0 && t.a < uAlphaRef) discard;
    vec3 alb = pow(t.rgb, vec3(2.2));
    vec3 n = normalize(vN); vec3 v = normalize(uEye - vW); if (dot(n,v) < 0.0) n = -n;
    vec3 L1 = normalize(vec3(0.45,0.85,0.35)), L2 = normalize(vec3(-0.6,0.35,-0.7));
    float d1 = max(dot(n,L1),0.0), d2 = max(dot(n,L2),0.0);
    vec3 h = normalize(L1+v); float sp = pow(max(dot(n,h),0.0), 48.0) * (uHasTex > 0.5 ? 0.15 : 0.9);
    vec3 sky = mix(vec3(0.20,0.16,0.27), vec3(0.62,0.58,0.72), n.y*0.5+0.5);
    vec3 c = alb * (sky*0.75 + vec3(1.0,0.96,0.9)*d1*1.55 + vec3(0.55,0.45,0.85)*d2*0.45) + sp;
    c = mix(c, pow(uColor, vec3(2.2)) * 2.2, uEmit);
    c = c / (c + vec3(0.85)) * 1.25;
    c = mix(c, vec3(0.09,0.06,0.14), uFade);
    o = vec4(pow(c, vec3(1.0/2.2)), 1.0);
  }`;
  const GVS = `#version 300 es
  layout(location=0) in vec3 aPos; uniform mat4 uVP; uniform float uR; out vec2 vP;
  void main(){ vP = aPos.xz; gl_Position = uVP * vec4(aPos.x*uR, 0.0, aPos.z*uR, 1.0); }`;
  const GFS = `#version 300 es
  precision highp float; in vec2 vP; out vec4 o;
  void main(){ float r = length(vP); if (r > 1.0) discard; vec2 g = abs(fract(vP*18.0) - 0.5); float line = smoothstep(0.47,0.5,max(g.x,g.y));
    float fade = 1.0 - smoothstep(0.35,1.0,r); o = vec4(vec3(0.10,0.07,0.15) + vec3(0.42,0.24,0.66)*line*0.35*fade, fade*0.95); }`;

  // shell colours by type (body, tip)
  const SHELL = { AP: [[0.55, 0.56, 0.58], [0.35, 0.36, 0.38]], APCR: [[0.30, 0.31, 0.34], [0.85, 0.85, 0.88]], HEAT: [[0.42, 0.45, 0.30], [0.62, 0.62, 0.55]], HE: [[0.47, 0.46, 0.30], [0.86, 0.72, 0.20]], other: [[0.5, 0.5, 0.5], [0.7, 0.7, 0.7]] };
  const BRASS = [0.78, 0.6, 0.28];

  function create(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
    if (!gl) throw new Error('WebGL2 ist in diesem Fenster nicht verfügbar');
    const compile = (vs, fs) => {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); gl.attachShader(p, s); }
      gl.linkProgram(p);
      const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
      return { p, u };
    };
    const prog = compile(VS, FS), gprog = compile(GVS, GFS);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    const V = { tank: null, meshes: [], tex: new Map(), offsets: {}, cam: { yaw: 0.8, pitch: 0.3, dist: 9, target: [0, 1, 0] }, goal: null, radius: 4, shot: null, dirty: true, alive: true };

    // geometry helpers
    const mkVao = (pos, nrm, uv, idx) => {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      [[pos, 0, 3], [nrm, 1, 3], [uv, 2, 2]].forEach(([d, loc, n]) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0); });
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, count: idx.length };
    };
    // lathe: profile [[radius, z], ...] around +Z -> unit-scale solid of revolution
    const lathe = (prof, seg = 28) => {
      const pos = [], nrm = [], uv = [], idx = [];
      for (let i = 0; i < prof.length; i++) {
        const [r, z] = prof[i], [r0, z0] = prof[Math.max(0, i - 1)], [r1, z1] = prof[Math.min(prof.length - 1, i + 1)];
        const dz = z1 - z0, dr = r1 - r0, nl = Math.hypot(dz, dr) || 1;
        for (let k = 0; k <= seg; k++) {
          const a = (k / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
          pos.push(r * c, r * s, z); nrm.push((dz / nl) * c, (dz / nl) * s, -dr / nl); uv.push(k / seg, i / (prof.length - 1));
        }
      }
      for (let i = 0; i + 1 < prof.length; i++) for (let k = 0; k < seg; k++) { const a = i * (seg + 1) + k, b = a + seg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      return mkVao(new Float32Array(pos), new Float32Array(nrm), new Float32Array(uv), new Uint32Array(idx));
    };
    // shell: length 1 = 4.6 calibres (radius 0.109), tip at z = 0, body towards -z; split into body / driving band / tip
    const CR = 0.5 / 4.6;
    // ogive nose from the body (r 0.5 at z -0.32) to the point (z 0)
    const tipProf = []; for (let i = 0; i <= 12; i++) { const t = i / 12; tipProf.push([Math.max(0.0001, CR * Math.pow(1 - t * t, 0.55)), -0.32 + 0.32 * t]); }
    const geo = {
      tip: lathe(tipProf),
      body: lathe([[CR, -0.32], [CR, -0.82], [CR * 0.94, -0.86], [CR * 0.94, -1], [0.0001, -1]]),
      band: lathe([[CR, -0.80], [CR * 1.06, -0.805], [CR * 1.06, -0.86], [CR, -0.865]]),
      tube: lathe([[1, 0], [1, -1]], 12), // trajectory segment, scaled per use
      ring: lathe([[1, 0.004], [1.25, 0.004], [1.25, -0.004], [1, -0.004]], 40),
    };
    // ground disc
    const seg = 96, gv = [0, 0, 0];
    for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; gv.push(Math.cos(a), 0, Math.sin(a)); }
    const ground = gl.createVertexArray(); gl.bindVertexArray(ground);
    const gb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gv), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);

    function texture(p) {
      if (!p) return null;
      if (V.tex.has(p)) return V.tex.get(p);
      const e = { t: gl.createTexture(), ready: false }; V.tex.set(p, e);
      const img = new Image();
      img.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, e.t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
        e.ready = true; V.dirty = true;
      };
      img.src = `/api/wot/garage/tex?p=${encodeURIComponent(p)}`;
      return e;
    }

    // part transform: BigWorld (left-handed) shown mirrored in x, turret/gun at rest
    const partMatrix = (part) => M.mul(M.s(-1, 1, 1), M.t(...(V.offsets[part] || [0, 0, 0])));
    const toWorld = (part, p) => { const o = V.offsets[part] || [0, 0, 0]; return [-(p[0] + o[0]), p[1] + o[1], p[2] + o[2]]; };
    const dirWorld = (d) => [-d[0], d[1], d[2]];

    async function loadTank(id) {
      if (V.tank === id) return;
      V.tank = id;
      const info = await (await fetch(`/api/wot/garage/tank?id=${encodeURIComponent(id)}`)).json();
      if (info.error) throw new Error(info.error);
      const all = info.parts.flatMap((p) => p.meshes.map((m) => ({ ...m, part: p.part })));
      const loaded = await Promise.all(all.map(async (m) => ({ m, buf: await (await fetch(`/api/wot/garage/mesh?id=${encodeURIComponent(id)}&i=${m.i}`)).arrayBuffer() })));
      if (V.tank !== id) return;
      for (const x of V.meshes) gl.deleteVertexArray(x.vao);
      V.meshes = []; V.offsets = Object.fromEntries(info.parts.map((p) => [p.part, p.offset]));
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const { m, buf } of loaded) {
        const dv = new DataView(buf), n = dv.getUint32(0, true), k = dv.getUint32(4, true);
        const f = new Float32Array(buf, 8, n * 8), idx = new Uint32Array(buf, 8 + n * 32, k);
        const g = mkVao(f.subarray(0, n * 3), f.subarray(n * 3, n * 6), f.subarray(n * 6), idx);
        V.meshes.push({ ...g, part: m.part, alphaRef: m.alphaTest ? Math.max(m.alphaRef, 32) / 255 : 0, tex: texture(m.diffuse) });
        const o = V.offsets[m.part];
        for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { const v = f[i * 3 + c] + o[c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
      }
      V.radius = Math.max(1, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
      V.center = [-(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) * 0.45, (lo[2] + hi[2]) / 2];
      V.name = info.name;
      V.dirty = true;
    }

    // shot = { points:[{part, p, dir, effect}], shell:{kind, caliber}, color:[r,g,b] }
    function setShot(shot) {
      V.shot = shot && shot.points.some((pt) => pt.p) ? shot : null;
      if (V.shot) {
        const pts = V.shot.points.filter((pt) => pt.p);
        const W = pts.map((pt) => toWorld(pt.part, pt.p));
        // look at the middle of all impacts (ricochets), far enough to see all of them
        const hit = [0, 1, 2].map((i) => W.reduce((a, w) => a + w[i], 0) / W.length);
        const spread = Math.max(...W.map((w) => Math.hypot(w[0] - hit[0], w[1] - hit[1], w[2] - hit[2])));
        const d = dirWorld(pts[0].dir); // camera stays on the side the shell came from
        // camera behind and a bit beside the shell, looking at the impact
        const side = norm([d[2], 0, -d[0]]); const back = norm([-d[0] + side[0] * 0.55, -d[1] + 0.35, -d[2] + side[2] * 0.55]);
        V.goal = { target: hit, yaw: Math.atan2(back[0], back[2]), pitch: Math.max(0.05, Math.min(1.2, Math.asin(Math.max(-1, Math.min(1, back[1]))))), dist: Math.max(1.8, V.radius * 0.7, spread * 3.2) };
      } else V.goal = { target: V.center || [0, 1, 0], yaw: 0.8, pitch: 0.3, dist: V.radius * 2.9 };
      V.dirty = true;
    }
    function overview() { V.goal = { target: V.center, yaw: V.cam.yaw, pitch: 0.35, dist: V.radius * 2.9 }; V.dirty = true; }

    // input
    let drag = null;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; V.goal = null; });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      const c = V.cam;
      if (drag.pan) { const s = c.dist * 0.0016, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw); c.target = [c.target[0] - dx * s * cy, c.target[1] + dy * s, c.target[2] + dx * s * sy]; }
      else { c.yaw -= dx * 0.008; c.pitch = Math.max(-0.3, Math.min(1.45, c.pitch + dy * 0.006)); }
      V.dirty = true;
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); V.goal = null; V.cam.dist = Math.max(0.6, Math.min(60, V.cam.dist * Math.exp(e.deltaY * 0.0012))); V.dirty = true; }, { passive: false });
    canvas.addEventListener('dblclick', () => setShot(V.shot));
    const ro = new ResizeObserver(() => { V.dirty = true; }); ro.observe(canvas);

    function draw(vao, model, color, opt = {}) {
      gl.uniformMatrix4fv(prog.u.uModel, false, model);
      gl.uniform3fv(prog.u.uColor, color); gl.uniform1f(prog.u.uHasTex, 0); gl.uniform1f(prog.u.uAlphaRef, 0);
      gl.uniform1f(prog.u.uEmit, opt.emit || 0); gl.uniform1f(prog.u.uFade, 0);
      gl.bindVertexArray(vao.vao); gl.drawElements(gl.TRIANGLES, vao.count, gl.UNSIGNED_INT, 0);
    }
    function frame(time) {
      if (!V.alive) return;
      requestAnimationFrame(frame);
      const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (!canvas.clientWidth) return;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; V.dirty = true; }
      // smooth camera flight to the selected shot
      if (V.goal) {
        const c = V.cam, g = V.goal, k = 0.14;
        let dy = g.yaw - c.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
        c.yaw += dy * k; c.pitch += (g.pitch - c.pitch) * k; c.dist += (g.dist - c.dist) * k;
        c.target = c.target.map((v, i) => v + (g.target[i] - v) * k);
        if (Math.abs(dy) < 1e-3 && Math.abs(g.dist - c.dist) < 1e-3 && c.target.every((v, i) => Math.abs(v - g.target[i]) < 1e-3)) V.goal = null;
        V.dirty = true;
      }
      if (V.shot) V.dirty = true; // pulsing impact ring
      if (!V.dirty) return;
      V.dirty = false;
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const c = V.cam;
      const eye = [c.target[0] + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), c.target[1] + c.dist * Math.sin(c.pitch), c.target[2] + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw)];
      const vp = M.mul(M.persp(0.62, w / h, 0.03, 400), M.look(eye, c.target, [0, 1, 0]));
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
      gl.useProgram(gprog.p); gl.uniformMatrix4fv(gprog.u.uVP, false, vp); gl.uniform1f(gprog.u.uR, V.radius * 2.4);
      gl.bindVertexArray(ground); gl.drawArrays(gl.TRIANGLE_FAN, 0, seg + 2); gl.disable(gl.BLEND);

      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.useProgram(prog.p); gl.uniformMatrix4fv(prog.u.uVP, false, vp); gl.uniform3fv(prog.u.uEye, eye); gl.uniform1i(prog.u.uTex, 0);
      const hitPart = V.shot && V.shot.points.find((pt) => pt.p) ? V.shot.points.find((pt) => pt.p).part : null;
      for (const m of V.meshes) {
        gl.uniformMatrix4fv(prog.u.uModel, false, partMatrix(m.part));
        const t = m.tex && m.tex.ready ? m.tex : null;
        if (t) gl.bindTexture(gl.TEXTURE_2D, t.t);
        gl.uniform1f(prog.u.uHasTex, t ? 1 : 0); gl.uniform3fv(prog.u.uColor, [0.55, 0.55, 0.55]);
        gl.uniform1f(prog.u.uAlphaRef, m.alphaRef); gl.uniform1f(prog.u.uEmit, 0);
        gl.uniform1f(prog.u.uFade, hitPart && m.part !== hitPart ? 0.25 : 0); // the hit part stands out a little
        gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
      }
      if (V.shot) {
        const pts = V.shot.points.filter((pt) => pt.p);
        const col = V.shot.color || [1, 0.35, 0.37];
        const cal = (V.shot.shell && V.shot.shell.caliber) || 90;
        const len = (cal / 1000) * 4.6 * 2; // shell length, shown 2x larger
        const rad = Math.max(0.008, cal / 1000 / 5); // flight path thickness
        const W = pts.map((pt) => toWorld(pt.part, pt.p));
        // flight path: 25 m in front of the first impact, then from impact to impact (ricochet)
        const d0 = dirWorld(pts[0].dir);
        const from = W[0].map((v, i) => v - d0[i] * 25);
        const path = [from, ...W];
        for (let i = 0; i + 1 < path.length; i++) {
          const a = path[i], b = path[i + 1], dd = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...dd);
          const m = M.mul(M.orient(b, dd, 1), M.s(rad, rad, L));
          draw(geo.tube, m, col.map((x) => x * (i === 0 ? 0.85 : 1)), { emit: 0.85 });
        }
        // the shell sits with its tip at the last impact, pointing along its last direction
        const last = path[path.length - 1], ld = dirWorld(pts[pts.length - 1].dir);
        const kind = (V.shot.shell && V.shot.shell.kind) || 'other';
        const [bodyC, tipC] = SHELL[kind] || SHELL.other;
        const sm = M.orient(last, ld, len);
        draw(geo.body, sm, bodyC); draw(geo.tip, sm, tipC); draw(geo.band, sm, BRASS);
        // impact rings
        const pulse = 1 + 0.25 * Math.sin(performance.now() / 260);
        W.forEach((p, i) => {
          const pt = pts[i], nd = dirWorld(pt.dir);
          draw(geo.ring, M.orient(p, nd, (cal / 1000) * 1.1 * pulse), V.shot.pointColors ? V.shot.pointColors[i] : col, { emit: 0.9 });
        });
      }
      gl.bindVertexArray(null);
    }
    requestAnimationFrame(frame);
    return { loadTank, setShot, overview, get name() { return V.name; }, destroy() { V.alive = false; ro.disconnect(); } };
  }
  return { create };
})();
