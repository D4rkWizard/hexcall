'use strict';
// Hexcall Hub – 3D model import in the browser (.glb / .gltf with embedded data / .obj + .mtl + images).
// Produces plain arrays per material group in WoT (BigWorld) orientation: x mirrored, y up, z forward, metres,
// centred horizontally and standing on y = 0. Textures become power-of-two PNGs (max 1024 px).
window.Import3D = (() => {
  const MAX_GROUPS = 8;

  async function fromFiles(fileList) {
    const files = [...fileList];
    const main = files.find((f) => /\.(glb|gltf)$/i.test(f.name)) || files.find((f) => /\.obj$/i.test(f.name));
    if (!main) throw new Error('Keine .glb-, .gltf- oder .obj-Datei dabei');
    const groups = /\.obj$/i.test(main.name) ? await readObj(main, files) : await readGltf(main);
    return finish(main.name, groups, /\.obj$/i.test(main.name) ? 'obj' : 'gltf');
  }

  /* ---------- glTF 2.0 ---------- */
  async function readGltf(file) {
    const buf = await file.arrayBuffer();
    let json, bin = null;
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) === 0x46546c67) { // 'glTF' binary
      let p = 12;
      while (p < buf.byteLength) {
        const len = dv.getUint32(p, true), type = dv.getUint32(p + 4, true);
        if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, p + 8, len)));
        else if (type === 0x004e4942) bin = buf.slice(p + 8, p + 8 + len);
        p += 8 + len;
      }
    } else json = JSON.parse(new TextDecoder().decode(buf));
    if (!json) throw new Error('glTF-Datei nicht lesbar');
    if ((json.extensionsRequired || []).some((e) => /draco|meshopt/i.test(e))) throw new Error('Komprimierte glTF-Modelle (Draco/Meshopt) werden nicht unterstützt – bitte ohne Kompression exportieren');
    const buffers = (json.buffers || []).map((b, i) => {
      if (b.uri === undefined) return bin;
      const m = /^data:[^;]*;base64,(.*)$/.exec(b.uri);
      if (!m) throw new Error('Das .gltf verweist auf externe Dateien – bitte als .glb exportieren');
      const s = atob(m[1]), a = new Uint8Array(s.length);
      for (let k = 0; k < s.length; k++) a[k] = s.charCodeAt(k);
      return a.buffer;
    });
    const view = (i) => { const v = json.bufferViews[i]; return { buf: buffers[v.buffer || 0], off: v.byteOffset || 0, len: v.byteLength, stride: v.byteStride || 0 }; };
    const accessor = (i) => {
      const a = json.accessors[i];
      const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
      const out = new Float32Array(a.count * n);
      if (a.bufferView === undefined) return out;
      const v = view(a.bufferView);
      const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
      const stride = v.stride || size * n;
      const d = new DataView(v.buf, v.off + (a.byteOffset || 0));
      const rd = { 5126: (o) => d.getFloat32(o, true), 5125: (o) => d.getUint32(o, true), 5123: (o) => d.getUint16(o, true), 5121: (o) => d.getUint8(o), 5122: (o) => d.getInt16(o, true), 5120: (o) => d.getInt8(o) }[a.componentType];
      const norm = a.normalized ? { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 }[a.componentType] || 1 : 1;
      for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = rd(k * stride + c * size) / norm;
      return out;
    };
    // node transforms
    const mat = (node) => {
      if (node.matrix) return node.matrix;
      const [tx, ty, tz] = node.translation || [0, 0, 0], [x, y, z, w] = node.rotation || [0, 0, 0, 1], [sx, sy, sz] = node.scale || [1, 1, 1];
      return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
        2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
        2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
    };
    const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
    const byMat = new Map();
    const visit = (ni, parent) => {
      const node = json.nodes[ni], world = mul(parent, mat(node));
      if (node.mesh !== undefined) for (const pr of json.meshes[node.mesh].primitives) {
        if (pr.mode !== undefined && pr.mode !== 4) continue;
        const pos = accessor(pr.attributes.POSITION);
        const nrm = pr.attributes.NORMAL !== undefined ? accessor(pr.attributes.NORMAL) : null;
        const uv = pr.attributes.TEXCOORD_0 !== undefined ? accessor(pr.attributes.TEXCOORD_0) : new Float32Array((pos.length / 3) * 2);
        const idx = pr.indices !== undefined ? Uint32Array.from(accessor(pr.indices)) : Uint32Array.from({ length: pos.length / 3 }, (_, k) => k);
        const P = new Float32Array(pos.length), N = new Float32Array(pos.length);
        for (let k = 0; k < pos.length / 3; k++) {
          const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
          for (let r = 0; r < 3; r++) P[k * 3 + r] = world[r] * x + world[4 + r] * y + world[8 + r] * z + world[12 + r];
          if (nrm) { const a = nrm[k * 3], b = nrm[k * 3 + 1], c = nrm[k * 3 + 2]; for (let r = 0; r < 3; r++) N[k * 3 + r] = world[r] * a + world[4 + r] * b + world[8 + r] * c; }
        }
        const key = pr.material ?? -1;
        if (!byMat.has(key)) byMat.set(key, { parts: [], material: key });
        byMat.get(key).parts.push({ P, N: nrm ? N : null, uv, idx });
      }
      for (const c of node.children || []) visit(c, world);
    };
    const scene = json.scenes ? json.scenes[json.scene || 0] : { nodes: json.nodes.map((_, i) => i) };
    for (const n of scene.nodes) visit(n, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const groups = [];
    for (const g of byMat.values()) {
      const m = g.material >= 0 ? json.materials[g.material] : null;
      const pbr = (m && m.pbrMetallicRoughness) || {};
      const f = pbr.baseColorFactor || [1, 1, 1, 1];
      let image = null;
      if (pbr.baseColorTexture) {
        const tex = json.textures[pbr.baseColorTexture.index], img = tex && json.images[tex.source];
        if (img) {
          if (img.bufferView !== undefined) { const v = view(img.bufferView); image = new Blob([new Uint8Array(v.buf, v.off, v.len)], { type: img.mimeType || 'image/png' }); }
          else if (/^data:/.test(img.uri || '')) image = await (await fetch(img.uri)).blob();
        }
      }
      groups.push({ name: (m && m.name) || `Teil ${groups.length + 1}`, ...merge(g.parts), image, tint: f });
    }
    return groups;
  }

  /* ---------- Wavefront OBJ ---------- */
  async function readObj(file, files) {
    const text = await file.text();
    const mtls = {};
    for (const f of files.filter((x) => /\.mtl$/i.test(x.name))) {
      let cur = null;
      for (const line of (await f.text()).split(/\r?\n/)) {
        const t = line.trim().split(/\s+/);
        if (t[0] === 'newmtl') { cur = t.slice(1).join(' '); mtls[cur] = { kd: [1, 1, 1], map: null }; }
        else if (cur && t[0] === 'Kd') mtls[cur].kd = t.slice(1, 4).map(Number);
        else if (cur && t[0] === 'map_Kd') mtls[cur].map = t[t.length - 1].split(/[\\/]/).pop();
      }
    }
    const v = [], vt = [], vn = [], groups = new Map();
    let cur = groups.set('', { verts: [], key: new Map(), idx: [] }).get('');
    let curName = '';
    const add = (s) => {
      if (cur.key.has(s)) return cur.key.get(s);
      const [a, b, c] = s.split('/');
      const ri = (x, arr, n) => { const k = parseInt(x, 10); return k < 0 ? arr.length / n + k : k - 1; };
      const pi = ri(a, v, 3), ti = b ? ri(b, vt, 2) : -1, ni = c ? ri(c, vn, 3) : -1;
      const k = cur.verts.length;
      cur.verts.push([v[pi * 3], v[pi * 3 + 1], v[pi * 3 + 2], ti >= 0 ? vt[ti * 2] : 0, ti >= 0 ? 1 - vt[ti * 2 + 1] : 0, ni >= 0 ? vn[ni * 3] : NaN, ni >= 0 ? vn[ni * 3 + 1] : 0, ni >= 0 ? vn[ni * 3 + 2] : 0]);
      cur.key.set(s, k);
      return k;
    };
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim().split(/\s+/);
      if (t[0] === 'v') v.push(+t[1], +t[2], +t[3]);
      else if (t[0] === 'vt') vt.push(+t[1], +(t[2] || 0));
      else if (t[0] === 'vn') vn.push(+t[1], +t[2], +t[3]);
      else if (t[0] === 'usemtl') { curName = t.slice(1).join(' '); if (!groups.has(curName)) groups.set(curName, { verts: [], key: new Map(), idx: [] }); cur = groups.get(curName); }
      else if (t[0] === 'f') { const ids = t.slice(1).map(add); for (let k = 1; k + 1 < ids.length; k++) cur.idx.push(ids[0], ids[k], ids[k + 1]); }
    }
    const out = [];
    for (const [name, g] of groups) {
      if (!g.idx.length) continue;
      const n = g.verts.length, P = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      const hasN = g.verts.every((x) => !Number.isNaN(x[5]));
      const N = hasN ? new Float32Array(n * 3) : null;
      g.verts.forEach((x, k) => { P.set(x.slice(0, 3), k * 3); uv.set(x.slice(3, 5), k * 2); if (N) N.set(x.slice(5, 8), k * 3); });
      const m = mtls[name] || { kd: [0.7, 0.7, 0.7], map: null };
      const img = m.map && files.find((f) => f.name.toLowerCase() === m.map.toLowerCase());
      out.push({ name: name || 'Teil', P, N, uv, idx: Uint32Array.from(g.idx), image: img || null, tint: [...m.kd, 1] });
    }
    return out;
  }

  /* ---------- shared ---------- */
  function merge(parts) {
    const vc = parts.reduce((a, p) => a + p.P.length / 3, 0), ic = parts.reduce((a, p) => a + p.idx.length, 0);
    const P = new Float32Array(vc * 3), N = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idx = new Uint32Array(ic);
    let vo = 0, io = 0, allN = true;
    for (const p of parts) {
      P.set(p.P, vo * 3); uv.set(p.uv, vo * 2);
      if (p.N) N.set(p.N, vo * 3); else allN = false;
      for (let k = 0; k < p.idx.length; k++) idx[io + k] = p.idx[k] + vo;
      vo += p.P.length / 3; io += p.idx.length;
    }
    return { P, N: allN ? N : null, uv, idx };
  }
  function smoothNormals(P, idx) {
    const N = new Float32Array(P.length);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      for (const i of [a, b, c]) for (let r = 0; r < 3; r++) N[i + r] += n[r];
    }
    for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
    return N;
  }
  async function texturePng(image, tint) {
    const pow2 = (x) => Math.min(1024, Math.max(16, 2 ** Math.round(Math.log2(Math.max(1, x)))));
    let w = 16, h = 16, bmp = null;
    if (image) { try { bmp = await createImageBitmap(image); w = pow2(bmp.width); h = pow2(bmp.height); } catch { bmp = null; } }
    if (!bmp) return null;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.drawImage(bmp, 0, 0, w, h);
    if (tint && tint.slice(0, 3).some((x) => x < 0.999)) { c.globalCompositeOperation = 'multiply'; c.fillStyle = `rgb(${tint.slice(0, 3).map((x) => Math.round(x * 255)).join(',')})`; c.fillRect(0, 0, w, h); }
    const url = cv.toDataURL('image/png');
    return url.slice(url.indexOf(',') + 1);
  }

  async function finish(fileName, groups, source) {
    groups = groups.filter((g) => g.idx.length);
    if (!groups.length) throw new Error('Im Modell wurden keine Dreiecke gefunden');
    // more materials than WoT parts we create: merge the rest into the last group (keeps its texture)
    if (groups.length > MAX_GROUPS) { const rest = groups.splice(MAX_GROUPS - 1); groups.push({ ...merge(rest.map((g) => ({ P: g.P, N: g.N || smoothNormals(g.P, g.idx), uv: g.uv, idx: g.idx }))), name: 'Rest', image: rest[0].image, tint: rest[0].tint }); }
    // bounds -> centre horizontally, stand on y = 0
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const g of groups) for (let k = 0; k < g.P.length; k++) { const r = k % 3; if (g.P[k] < lo[r]) lo[r] = g.P[k]; if (g.P[k] > hi[r]) hi[r] = g.P[k]; }
    const c = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
    const meta = { name: fileName.replace(/\.[^.]+$/, ''), source, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], groups: [] };
    const chunks = [];
    for (const g of groups) {
      const n = g.P.length / 3;
      const N = g.N || smoothNormals(g.P, g.idx);
      const f = new Float32Array(n * 8);
      for (let k = 0; k < n; k++) {
        // glTF/OBJ are right-handed with +x to the model's left; WoT is left-handed -> mirror x
        f[k * 3] = -(g.P[k * 3] - c[0]); f[k * 3 + 1] = g.P[k * 3 + 1] - c[1]; f[k * 3 + 2] = g.P[k * 3 + 2] - c[2];
        const l = Math.hypot(N[k * 3], N[k * 3 + 1], N[k * 3 + 2]) || 1;
        f[n * 3 + k * 3] = -N[k * 3] / l; f[n * 3 + k * 3 + 1] = N[k * 3 + 1] / l; f[n * 3 + k * 3 + 2] = N[k * 3 + 2] / l;
        f[n * 6 + k * 2] = g.uv[k * 2]; f[n * 6 + k * 2 + 1] = g.uv[k * 2 + 1];
      }
      chunks.push(f.buffer, g.idx.buffer.slice(g.idx.byteOffset, g.idx.byteOffset + g.idx.byteLength));
      const tex = await texturePng(g.image, g.tint);
      meta.groups.push({ name: g.name, vc: n, ic: g.idx.length, tex, color: g.tint.slice(0, 3).map((x) => Math.round(Math.pow(x, 1 / 2.2) * 255)) });
    }
    const js = new TextEncoder().encode(JSON.stringify(meta));
    const head = new Uint32Array([js.length]);
    return { meta, body: new Blob([head, js, ...chunks]) };
  }

  return { fromFiles };
})();
