// BigWorld / WoT file formats used by the 3D garage. Read-only, works on the user's own WoT installation.
//  - Pkg:     index of all .pkg archives (plain zip), reads single entries on demand
//  - unpackXml: "packed XML" (.xml in scripts.pkg, .visual_processed, .model) -> plain JS object tree
//  - primitives: .primitives_processed sections (vertices / indices)
//  - dds:     DXT1/DXT3/DXT5 (+ uncompressed) -> RGBA, encodePng for the browser
//  - mo:      gettext .mo catalog (vehicle names)
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- pkg index ---------- */
class Pkg {
  constructor(gameDir, filter) {
    this.dir = path.join(gameDir, 'res', 'packages');
    this.entries = new Map(); // lower-case name -> {file, lho, csize, method, name}
    for (const f of fs.readdirSync(this.dir).filter((n) => n.toLowerCase().endsWith('.pkg'))) {
      if (filter && !filter(f)) continue;
      try { this.indexFile(path.join(this.dir, f)); } catch {}
    }
  }
  indexFile(file) {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const tailLen = Math.min(size, 65557);
      const tail = Buffer.alloc(tailLen);
      fs.readSync(fd, tail, 0, tailLen, size - tailLen);
      let e = tail.length - 22;
      while (e > 0 && tail.readUInt32LE(e) !== 0x06054b50) e--;
      if (e <= 0) return;
      const n = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
      const cd = Buffer.alloc(cdSize);
      fs.readSync(fd, cd, 0, cdSize, cdOff);
      let p = 0;
      for (let i = 0; i < n && p + 46 <= cd.length; i++) {
        const method = cd.readUInt16LE(p + 10), csize = cd.readUInt32LE(p + 20);
        const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
        const lho = cd.readUInt32LE(p + 42);
        const name = cd.toString('utf8', p + 46, p + 46 + nlen);
        p += 46 + nlen + xlen + clen;
        if (!name.endsWith('/')) this.entries.set(name.toLowerCase(), { file, lho, csize, method, name });
      }
    } finally { fs.closeSync(fd); }
  }
  has(name) { return this.entries.has(String(name).toLowerCase().replace(/\\/g, '/')); }
  read(name) {
    const e = this.entries.get(String(name).toLowerCase().replace(/\\/g, '/'));
    if (!e) return null;
    const fd = fs.openSync(e.file, 'r');
    try {
      const lh = Buffer.alloc(30);
      fs.readSync(fd, lh, 0, 30, e.lho);
      const raw = Buffer.alloc(e.csize);
      fs.readSync(fd, raw, 0, e.csize, e.lho + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28));
      return e.method === 8 ? zlib.inflateRawSync(raw) : raw;
    } finally { fs.closeSync(fd); }
  }
  list(prefix) {
    const p = prefix.toLowerCase(), out = [];
    for (const [k, e] of this.entries) if (k.startsWith(p)) out.push(e.name);
    return out;
  }
}

/* ---------- packed XML ----------
   Node = { v: value (string | number | number[] | boolean), c: [[name, Node], ...] } */
const PACKED_MAGIC = 0x62a14e45;
function isPacked(buf) { return buf && buf.length > 5 && buf.readUInt32LE(0) === PACKED_MAGIC; }

function unpackXml(buf) {
  if (!isPacked(buf)) return parsePlainXml(buf.toString('utf8'));
  let p = 5; // magic + version byte
  const dict = [];
  for (;;) {
    const z = buf.indexOf(0, p);
    const s = buf.toString('latin1', p, z);
    p = z + 1;
    if (!s) break;
    dict.push(s);
  }
  const desc = () => { const d = buf.readUInt32LE(p); p += 4; return { end: d & 0x0fffffff, type: d >>> 28 }; };
  function readElement() {
    const count = buf.readUInt16LE(p); p += 2;
    const own = desc();
    const kids = [];
    for (let i = 0; i < count; i++) { const ni = buf.readUInt16LE(p); p += 2; kids.push([ni, desc()]); }
    const base = p; // data block start for this element
    const node = { v: null, c: [] };
    let off = 0;
    const readData = (d, target) => {
      const len = d.end - off, start = base + off;
      if (d.type === 0) { p = start; const sub = readElement(); target.v = sub.v; target.c = sub.c; target.t = sub.t; target.raw = sub.raw; target.e = true; }
      else { target.v = decodeValue(buf, start, len, d.type); target.t = d.type; target.raw = buf.subarray(start, start + len); }
      off = d.end;
    };
    readData(own, node);
    for (const [ni, d] of kids) { const child = { v: null, c: [] }; readData(d, child); node.c.push([dict[ni], child]); }
    p = base + off;
    return node;
  }
  return readElement();
}
/* ---------- packed XML writer (inverse of unpackXml; untouched values are written back byte for byte) ---------- */
// set a node's value (drops the original bytes); type: 1 string, 2 int, 3 float(s), 4 bool
function setVal(n, v, t) { n.v = v; n.t = t; n.raw = null; return n; }
function mkNode(v, t, children = []) { return { v, t, raw: null, c: children, e: children.length > 0 }; }
function encodeValue(n) {
  if (n.raw) return Buffer.from(n.raw);
  const v = n.v;
  let t = n.t;
  if (!t) t = typeof v === 'string' ? 1 : typeof v === 'boolean' ? 4 : Array.isArray(v) ? 3 : Number.isInteger(v) ? 2 : typeof v === 'number' ? 3 : 1;
  if (v == null || v === '') return Buffer.alloc(0);
  if (t === 1) return Buffer.from(String(v), 'latin1');
  if (t === 4) return v ? Buffer.from([1]) : Buffer.alloc(0);
  if (t === 2) {
    const x = Number(v);
    if (x === 0) return Buffer.alloc(0);
    if (x >= -128 && x <= 127) { const b = Buffer.alloc(1); b.writeInt8(x); return b; }
    if (x >= -32768 && x <= 32767) { const b = Buffer.alloc(2); b.writeInt16LE(x); return b; }
    const b = Buffer.alloc(4); b.writeInt32LE(x); return b;
  }
  if (t === 3) { const a = Array.isArray(v) ? v : String(v).trim().split(/\s+/).map(Number); const b = Buffer.alloc(a.length * 4); a.forEach((x, i) => b.writeFloatLE(x, i * 4)); return b; }
  if (t === 5) return Buffer.from(String(v), 'base64');
  return Buffer.from(String(v), 'latin1');
}
function packXml(root) {
  const dict = [], index = new Map();
  const collect = (n) => { for (const [name, ch] of n.c) { if (!index.has(name)) { index.set(name, 0); dict.push(name); } collect(ch); } };
  collect(root);
  dict.sort(); // WoT's own files keep the name table in plain (ASCII) order
  dict.forEach((s, i) => index.set(s, i));
  const enc = (n) => {
    const own = encodeValue(n), ownType = n.t || 1;
    const parts = [own], descs = [];
    let end = own.length;
    for (const [name, ch] of n.c) {
      const isEl = ch.e || ch.c.length > 0;
      const data = isEl ? enc(ch) : encodeValue(ch);
      end += data.length;
      descs.push([index.get(name), ((isEl ? 0 : ch.t || 1) << 28 | end) >>> 0]);
      parts.push(data);
    }
    const head = Buffer.alloc(2 + 4 + descs.length * 6);
    head.writeUInt16LE(n.c.length, 0);
    head.writeUInt32LE(((ownType << 28) | own.length) >>> 0, 2);
    descs.forEach(([ni, d], i) => { head.writeUInt16LE(ni, 6 + i * 6); head.writeUInt32LE(d, 8 + i * 6); });
    return Buffer.concat([head, ...parts]);
  };
  const magic = Buffer.alloc(5); magic.writeUInt32LE(PACKED_MAGIC, 0);
  return Buffer.concat([magic, ...dict.map((s) => Buffer.from(`${s}\0`, 'latin1')), Buffer.from([0]), enc(root)]);
}

/* ---------- primitives writer ---------- */
function writePrimitives(sections, magic) { // sections: [[name, Buffer], ...] in file order
  const pad = (n) => (4 - (n % 4)) % 4;
  const body = [magic || Buffer.from('654ea142', 'hex')], table = [];
  for (const [name, data] of sections) {
    body.push(data, Buffer.alloc(pad(data.length)));
    const nm = Buffer.from(name, 'latin1'), e = Buffer.alloc(24);
    e.writeUInt32LE(data.length, 0); e.writeUInt32LE(nm.length, 20);
    table.push(e, nm, Buffer.alloc(pad(nm.length)));
  }
  const t = Buffer.concat(table), tl = Buffer.alloc(4); tl.writeUInt32LE(t.length);
  return Buffer.concat([...body, t, tl]);
}
// "set3" 8-bit normal packing (inverse of unpackNormal)
function packN3(n) {
  const enc = (x) => { x = Math.max(-1, Math.min(1, x)); const k = x < 0 ? 0x80 | Math.round(-x * 127) : Math.round(x * 127) ^ 0x7f; return (k ^ 0xff) & 0xff; };
  return (enc(n[0]) | (enc(n[1]) << 8) | (enc(n[2]) << 16)) >>> 0;
}
// static vertex block in the format WoT uses for hulls/turrets: BPVT + set3/xyznuvtbpc, 32 bytes per vertex
function makeVertexSection(pos, nrm, uv, tan) {
  const n = pos.length / 3, out = Buffer.alloc(136 + n * 32);
  out.write('BPVTxyznuvtb', 0, 'latin1'); out.write('set3/xyznuvtbpc', 68, 'latin1'); out.writeUInt32LE(n, 132);
  for (let i = 0; i < n; i++) {
    const o = 136 + i * 32, N = [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]];
    out.writeFloatLE(pos[i * 3], o); out.writeFloatLE(pos[i * 3 + 1], o + 4); out.writeFloatLE(pos[i * 3 + 2], o + 8);
    out.writeUInt32LE(packN3(N), o + 12);
    out.writeFloatLE(uv[i * 2], o + 16); out.writeFloatLE(uv[i * 2 + 1], o + 20);
    let T = tan ? [tan[i * 3], tan[i * 3 + 1], tan[i * 3 + 2]] : (Math.abs(N[1]) < 0.9 ? [N[2], 0, -N[0]] : [1, 0, 0]);
    const d = T[0] * N[0] + T[1] * N[1] + T[2] * N[2]; T = [T[0] - N[0] * d, T[1] - N[1] * d, T[2] - N[2] * d];
    const tl = Math.hypot(...T) || 1; T = T.map((x) => x / tl);
    const B = [N[1] * T[2] - N[2] * T[1], N[2] * T[0] - N[0] * T[2], N[0] * T[1] - N[1] * T[0]];
    out.writeUInt32LE(packN3(T), o + 24); out.writeUInt32LE(packN3(B), o + 28);
  }
  return out;
}
function makeIndexSection(idx, vertexCount) {
  const wide = vertexCount > 65535, size = wide ? 4 : 2;
  const out = Buffer.alloc(72 + idx.length * size + 16);
  out.write(wide ? 'list32' : 'list', 0, 'latin1');
  out.writeUInt32LE(idx.length, 64); out.writeUInt32LE(1, 68);
  for (let i = 0; i < idx.length; i++) wide ? out.writeUInt32LE(idx[i], 72 + i * 4) : out.writeUInt16LE(idx[i], 72 + i * 2);
  const g = 72 + idx.length * size;
  out.writeUInt32LE(0, g); out.writeUInt32LE(idx.length / 3, g + 4); out.writeUInt32LE(0, g + 8); out.writeUInt32LE(vertexCount, g + 12);
  return out;
}

function decodeValue(buf, at, len, type) {
  switch (type) {
    case 1: return buf.toString('latin1', at, at + len);
    case 2:
      if (len === 0) return 0;
      if (len === 1) return buf.readInt8(at);
      if (len === 2) return buf.readInt16LE(at);
      if (len === 4) return buf.readInt32LE(at);
      if (len === 8) return Number(buf.readBigInt64LE(at));
      return 0;
    case 3: {
      const n = len >> 2, a = [];
      for (let i = 0; i < n; i++) a.push(Math.round(buf.readFloatLE(at + i * 4) * 1e6) / 1e6);
      return n === 1 ? a[0] : a;
    }
    case 4: return len === 1 && buf[at] === 1;
    case 5: return buf.toString('base64', at, at + len);
    default: return null;
  }
}
// tiny fallback for unpacked XML (res_mods / plain files)
function parsePlainXml(s) {
  s = s.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, '');
  const root = { v: null, c: [] }, stack = [root];
  const re = /<\s*(\/?)([\w.:-]+)[^>]*?(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(s))) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) { const t = m[4].trim(); if (t) top.v = (top.v ? top.v + ' ' : '') + t; continue; }
    if (m[1]) { stack.pop(); continue; }
    const n = { v: null, c: [] };
    top.c.push([m[2], n]);
    if (!m[3]) stack.push(n);
  }
  const fix = (n) => { if (typeof n.v === 'string') { const t = n.v.trim(); if (/^-?[\d.eE+-]+(\s+-?[\d.eE+-]+)*$/.test(t)) { const a = t.split(/\s+/).map(Number); n.v = a.length === 1 ? a[0] : a; } else n.v = t; } n.c.forEach(([, k]) => fix(k)); };
  const top = root.c.length === 1 ? root.c[0][1] : root;
  fix(top);
  return top;
}
// helpers on the node tree
const kid = (n, name) => { if (!n) return null; const k = n.c.find(([x]) => x === name); return k ? k[1] : null; };
const kids = (n, name) => (n ? n.c.filter(([x]) => x === name).map(([, k]) => k) : []);
const at = (n, pathStr) => pathStr.split('/').reduce((x, s) => kid(x, s), n);
const str = (n) => (n == null || n.v == null ? '' : String(Array.isArray(n.v) ? n.v.join(' ') : n.v).trim());
const vec = (n) => {
  if (!n) return null;
  if (Array.isArray(n.v)) return n.v.map(Number);
  if (typeof n.v === 'number') return [n.v];
  const a = str(n).split(/\s+/).map(Number);
  return a.every((x) => !isNaN(x)) ? a : null;
};

/* ---------- primitives_processed ---------- */
function primitiveSections(buf) {
  const tableLen = buf.readUInt32LE(buf.length - 4);
  let q = buf.length - 4 - tableLen;
  let pos = 4;
  const out = {};
  while (q + 24 <= buf.length - 4) {
    const size = buf.readUInt32LE(q);
    const nameLen = buf.readUInt32LE(q + 20);
    const name = buf.toString('latin1', q + 24, q + 24 + nameLen);
    q += 24 + nameLen + ((4 - (nameLen % 4)) % 4);
    out[name] = buf.subarray(pos, pos + size);
    pos += size + ((4 - (size % 4)) % 4);
  }
  return out;
}
const cstr = (b, o, n) => { const z = b.indexOf(0, o); return b.toString('latin1', o, z < 0 || z > o + n ? o + n : z); };

function readIndices(b) {
  const fmt = cstr(b, 0, 64);
  const count = b.readUInt32LE(64), groupCount = b.readUInt32LE(68);
  const wide = fmt.includes('32');
  const size = wide ? 4 : 2;
  const idx = new Uint32Array(count);
  for (let i = 0; i < count; i++) idx[i] = wide ? b.readUInt32LE(72 + i * 4) : b.readUInt16LE(72 + i * 2);
  let g = 72 + count * size;
  const groups = [];
  for (let i = 0; i < groupCount && g + 16 <= b.length; i++, g += 16)
    groups.push({ startIndex: b.readUInt32LE(g), primitives: b.readUInt32LE(g + 4), startVertex: b.readUInt32LE(g + 8), vertices: b.readUInt32LE(g + 12) });
  return { idx, groups };
}

// Returns positions (Float32Array xyz) and uvs (Float32Array uv). Normals are recomputed in the browser.
function readVertices(b) {
  let fmt = cstr(b, 0, 64), o = 64;
  if (fmt.includes('BPVT')) { o += 4; fmt = cstr(b, o, 64); o += 64; }
  const count = b.readUInt32LE(o); o += 4;
  if (!count) return { fmt, count: 0, pos: new Float32Array(0), uv: new Float32Array(0) };
  const stride = Math.floor((b.length - o) / count);
  const f = fmt.replace(/^set3\//, '');
  // unpacked float normals: xyznuv -> pos(12) normal(12) uv(8); everything else packs the normal into 4 bytes
  const uvOff = /^xyznuv$/.test(f) || (/^xyznuv/.test(f) && stride === 32 && !/tb|iii/.test(f)) ? 24 : 16;
  const set3 = /^set3\//.test(fmt);
  // skinned formats ("iiiww"): 3 bone indices (stored x3) + 2 weights, the third weight is the rest
  const skinned = /iiiww/.test(f) && uvOff === 16;
  const bones = skinned ? new Uint8Array(count * 3) : null, weights = skinned ? new Float32Array(count * 3) : null;
  if (skinned) for (let i = 0; i < count; i++) {
    const v = o + i * stride + 24;
    bones[i * 3] = b[v] / 3; bones[i * 3 + 1] = b[v + 1] / 3; bones[i * 3 + 2] = b[v + 2] / 3;
    const w1 = b[v + 3] / 255, w2 = b[v + 4] / 255;
    weights[i * 3] = w1; weights[i * 3 + 1] = w2; weights[i * 3 + 2] = Math.max(0, 1 - w1 - w2);
  }
  const pos = new Float32Array(count * 3), uv = new Float32Array(count * 2), nrm = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = o + i * stride;
    pos[i * 3] = b.readFloatLE(v); pos[i * 3 + 1] = b.readFloatLE(v + 4); pos[i * 3 + 2] = b.readFloatLE(v + 8);
    uv[i * 2] = b.readFloatLE(v + uvOff); uv[i * 2 + 1] = b.readFloatLE(v + uvOff + 4);
    if (uvOff === 24) { nrm[i * 3] = b.readFloatLE(v + 12); nrm[i * 3 + 1] = b.readFloatLE(v + 16); nrm[i * 3 + 2] = b.readFloatLE(v + 20); }
    else { const n = unpackNormal(b.readUInt32LE(v + 12), set3); nrm[i * 3] = n[0]; nrm[i * 3 + 1] = n[1]; nrm[i * 3 + 2] = n[2]; }
  }
  return { fmt, count, stride, pos, uv, nrm, bones, weights };
}

// world transforms of all nodes in a .visual tree. BigWorld matrices are row-vector 4x3:
// [r0x r0y r0z, r1x r1y r1z, r2x r2y r2z, tx ty tz]; p' = p.x*r0 + p.y*r1 + p.z*r2 + t
function mul43(a, b) { // a then b
  const o = new Array(12);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++)
    o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c] + (r === 3 ? b[9 + c] : 0);
  return o;
}
function nodeWorlds(visual) {
  const out = new Map();
  const walk = (n, parent) => {
    const t = vec(kid(n, 'transform'));
    const local = t && t.length === 12 ? t : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    const world = parent ? mul43(local, parent) : local;
    out.set(str(kid(n, 'identifier')), world);
    for (const c of kids(n, 'node')) walk(c, world);
  };
  for (const n of kids(visual, 'node')) walk(n, null);
  return out;
}
// bake bone transforms into skinned vertices (returns new pos/nrm arrays)
function applySkin(verts, boneMats) {
  const { count, bones, weights } = verts;
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = [verts.pos[i * 3], verts.pos[i * 3 + 1], verts.pos[i * 3 + 2]], n = [verts.nrm[i * 3], verts.nrm[i * 3 + 1], verts.nrm[i * 3 + 2]];
    let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0, wsum = 0;
    for (let k = 0; k < 3; k++) {
      const w = weights[i * 3 + k], m = boneMats[bones[i * 3 + k]];
      if (!w || !m) continue;
      px += w * (p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + m[9]);
      py += w * (p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + m[10]);
      pz += w * (p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + m[11]);
      nx += w * (n[0] * m[0] + n[1] * m[3] + n[2] * m[6]);
      ny += w * (n[0] * m[1] + n[1] * m[4] + n[2] * m[7]);
      nz += w * (n[0] * m[2] + n[1] * m[5] + n[2] * m[8]);
      wsum += w;
    }
    if (!wsum) { px = p[0]; py = p[1]; pz = p[2]; nx = n[0]; ny = n[1]; nz = n[2]; wsum = 1; }
    pos[i * 3] = px / wsum; pos[i * 3 + 1] = py / wsum; pos[i * 3 + 2] = pz / wsum;
    nrm[i * 3] = nx; nrm[i * 3 + 1] = ny; nrm[i * 3 + 2] = nz;
  }
  return { ...verts, pos, nrm };
}
// packed normals: "set3/" formats use 3 x 8 bit, older ones 11/11/10 bit
function unpackNormal(p, set3) {
  if (set3) {
    const f = (k) => (k > 0x7f ? -(k & 0x7f) / 0x7f : (k ^ 0x7f) / 0x7f);
    return [f((p & 0xff) ^ 0xff), f(((p >> 8) & 0xff) ^ 0xff), f(((p >> 16) & 0xff) ^ 0xff)];
  }
  const x = p & 0x7ff, y = (p >> 11) & 0x7ff, z = (p >>> 22) & 0x3ff;
  const s11 = (k) => (k > 0x3ff ? -(((k & 0x3ff) ^ 0x3ff) + 1) / 0x3ff : k / 0x3ff);
  return [s11(x), s11(y), z > 0x1ff ? -(((z & 0x1ff) ^ 0x1ff) + 1) / 0x1ff : z / 0x1ff];
}

/* ---------- DDS ---------- */
function dds(buf) {
  if (!buf || buf.toString('latin1', 0, 4) !== 'DDS ') throw new Error('keine DDS-Datei');
  const height = buf.readUInt32LE(12), width = buf.readUInt32LE(16);
  const pfFlags = buf.readUInt32LE(80), four = buf.toString('latin1', 84, 88);
  let off = 128, kind;
  if (pfFlags & 4) {
    kind = four;
    if (four === 'DX10') { const dxgi = buf.readUInt32LE(128); off += 20; kind = { 71: 'DXT1', 72: 'DXT1', 74: 'DXT3', 75: 'DXT3', 77: 'DXT5', 78: 'DXT5', 28: 'RGBA', 29: 'RGBA', 87: 'BGRA', 98: 'BC7', 99: 'BC7' }[dxgi] || `DXGI${dxgi}`; }
  } else kind = buf.readUInt32LE(88) === 32 ? (buf.readUInt32LE(92) === 0xff ? 'RGBA' : 'BGRA') : 'RGB?';
  return { width, height, kind, data: buf.subarray(off) };
}
function c565(c) { return [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31]; }
// decode the top mip level to RGBA (Uint8Array), optionally downscaled by an integer factor
function ddsToRgba(buf, maxSize = 2048) {
  const d = dds(buf);
  const { width: w, height: h, data } = d;
  const out = new Uint8Array(w * h * 4);
  if (d.kind === 'DXT1' || d.kind === 'DXT3' || d.kind === 'DXT5') {
    const bs = d.kind === 'DXT1' ? 8 : 16;
    const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const b = (by * bw + bx) * bs;
      const cb = d.kind === 'DXT1' ? b : b + 8;
      const c0 = data.readUInt16LE(cb), c1 = data.readUInt16LE(cb + 2), bits = data.readUInt32LE(cb + 4);
      const p0 = c565(c0), p1 = c565(c1), pal = [p0, p1];
      if (c0 > c1 || d.kind !== 'DXT1') { pal.push(p0.map((x, i) => (2 * x + p1[i]) / 3), p0.map((x, i) => (x + 2 * p1[i]) / 3)); }
      else { pal.push(p0.map((x, i) => (x + p1[i]) / 2), [0, 0, 0]); }
      let alpha = null;
      if (d.kind === 'DXT5') {
        const a0 = data[b], a1 = data[b + 1];
        const ap = [a0, a1];
        if (a0 > a1) for (let i = 1; i < 7; i++) ap.push(((7 - i) * a0 + i * a1) / 7);
        else { for (let i = 1; i < 5; i++) ap.push(((5 - i) * a0 + i * a1) / 5); ap.push(0, 255); }
        let abits = 0n;
        for (let i = 0; i < 6; i++) abits |= BigInt(data[b + 2 + i]) << BigInt(8 * i);
        alpha = (k) => ap[Number((abits >> BigInt(3 * k)) & 7n)];
      } else if (d.kind === 'DXT3') {
        alpha = (k) => ((data[b + (k >> 1)] >> ((k & 1) * 4)) & 15) * 17;
      }
      for (let k = 0; k < 16; k++) {
        const x = bx * 4 + (k & 3), y = by * 4 + (k >> 2);
        if (x >= w || y >= h) continue;
        const sel = (bits >>> (2 * k)) & 3, c = pal[sel], o = (y * w + x) * 4;
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
        out[o + 3] = alpha ? alpha(k) : d.kind === 'DXT1' && c0 <= c1 && sel === 3 ? 0 : 255;
      }
    }
  } else if (d.kind === 'RGBA' || d.kind === 'BGRA') {
    for (let i = 0; i < w * h; i++) {
      const s = i * 4;
      if (d.kind === 'RGBA') { out[s] = data[s]; out[s + 1] = data[s + 1]; out[s + 2] = data[s + 2]; }
      else { out[s] = data[s + 2]; out[s + 1] = data[s + 1]; out[s + 2] = data[s]; }
      out[s + 3] = data[s + 3];
    }
  } else throw new Error(`Texturformat ${d.kind} wird noch nicht unterstützt`);
  // downscale (box filter by integer factor) so big textures stay light for the preview
  let f = 1;
  while (Math.max(w, h) / f > maxSize) f *= 2;
  if (f === 1) return { width: w, height: h, rgba: out, kind: d.kind };
  const W = Math.max(1, w / f | 0), H = Math.max(1, h / f | 0), small = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += out[((y * f + j) * w + x * f + i) * 4 + c];
    small[(y * W + x) * 4 + c] = s / (f * f);
  }
  return { width: W, height: H, rgba: small, kind: d.kind };
}

/* ---------- PNG encoder (RGBA) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba, alpha = true) {
  const ch = alpha ? 4 : 3, row = w * ch + 1, raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) raw[y * row + 1 + x * ch + c] = rgba[(y * w + x) * 4 + c];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- PNG decoder (8-bit RGB/RGBA/grey, non-interlaced – what a browser canvas exports) ---------- */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Keine PNG-Datei');
  let p = 8, w = 0, h = 0, depth = 0, type = 0, inter = 0, palette = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), t = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; inter = d[12]; }
    else if (t === 'PLTE') palette = d;
    else if (t === 'tRNS') trns = d;
    else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || inter) throw new Error('PNG-Format nicht unterstützt');
  if (w * h > 4096 * 4096) throw new Error('Bild zu groß');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!ch) throw new Error('PNG-Format nicht unterstützt');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = new Uint8Array(w * h * 4), line = new Uint8Array(stride), prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * ch;
      if (type === 6) { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = line[s + 3]; }
      else if (type === 2) { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = 255; }
      else if (type === 0) { out[o] = out[o + 1] = out[o + 2] = line[s]; out[o + 3] = 255; }
      else if (type === 4) { out[o] = out[o + 1] = out[o + 2] = line[s]; out[o + 3] = line[s + 1]; }
      else { const k = line[s]; out[o] = palette[k * 3]; out[o + 1] = palette[k * 3 + 1]; out[o + 2] = palette[k * 3 + 2]; out[o + 3] = trns && k < trns.length ? trns[k] : 255; }
    }
    prev.set(line);
  }
  return { width: w, height: h, rgba: out };
}

/* ---------- DXT1 / DXT5 encoder with full mip chain ---------- */
const to565 = (r, g, b) => ((r * 31 / 255 + 0.5) << 11) | ((g * 63 / 255 + 0.5) << 5) | (b * 31 / 255 + 0.5);
function encodeColorBlock(px, out, o, dxt1Alpha) {
  // endpoints along the bounding-box diagonal (flipped per channel by covariance with the main axis), slightly inset
  let mn = [255, 255, 255], mx = [0, 0, 0], mean = [0, 0, 0], n = 0;
  for (let k = 0; k < 16; k++) { if (dxt1Alpha && px[k * 4 + 3] < 128) continue; n++; for (let c = 0; c < 3; c++) { const v = px[k * 4 + c]; mean[c] += v; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; } }
  if (!n) { out.writeUInt16LE(0, o); out.writeUInt16LE(0, o + 2); out.writeUInt32LE(0xffffffff, o + 4); return; }
  mean = mean.map((v) => v / n);
  let main = 0; for (let c = 1; c < 3; c++) if (mx[c] - mn[c] > mx[main] - mn[main]) main = c;
  const lo = [...mn], hi = [...mx];
  for (let c = 0; c < 3; c++) {
    if (c === main) continue;
    let cov = 0; for (let k = 0; k < 16; k++) { if (dxt1Alpha && px[k * 4 + 3] < 128) continue; cov += (px[k * 4 + c] - mean[c]) * (px[k * 4 + main] - mean[main]); }
    if (cov < 0) { lo[c] = mx[c]; hi[c] = mn[c]; }
  }
  for (let c = 0; c < 3; c++) { const inset = (hi[c] - lo[c]) / 16; lo[c] += inset; hi[c] -= inset; }
  let c0 = to565(...hi), c1 = to565(...lo);
  const transparent = dxt1Alpha && n < 16;
  if (transparent ? c0 > c1 : c0 < c1) [c0, c1] = [c1, c0];
  if (!transparent && c0 === c1) { if (c1 > 0) c1--; else c0++; }
  const p0 = c565(c0), p1 = c565(c1);
  const pal = transparent ? [p0, p1, p0.map((x, i) => (x + p1[i]) / 2)] : [p0, p1, p0.map((x, i) => (2 * x + p1[i]) / 3), p0.map((x, i) => (x + 2 * p1[i]) / 3)];
  let bits = 0;
  for (let k = 0; k < 16; k++) {
    let best = 0, bd = Infinity;
    if (transparent && px[k * 4 + 3] < 128) best = 3;
    else for (let i = 0; i < pal.length; i++) { const d = (px[k * 4] - pal[i][0]) ** 2 + (px[k * 4 + 1] - pal[i][1]) ** 2 + (px[k * 4 + 2] - pal[i][2]) ** 2; if (d < bd) { bd = d; best = i; } }
    bits |= best << (2 * k);
  }
  out.writeUInt16LE(c0, o); out.writeUInt16LE(c1, o + 2); out.writeUInt32LE(bits >>> 0, o + 4);
}
function encodeAlphaBlock(px, out, o) {
  let a0 = 0, a1 = 255;
  for (let k = 0; k < 16; k++) { const a = px[k * 4 + 3]; if (a > a0) a0 = a; if (a < a1) a1 = a; }
  out[o] = a0; out[o + 1] = a1;
  const pal = [a0, a1]; for (let i = 1; i < 7; i++) pal.push(((7 - i) * a0 + i * a1) / 7);
  let bits = 0n;
  for (let k = 0; k < 16; k++) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < 8; i++) { const d = Math.abs(px[k * 4 + 3] - pal[i]); if (d < bd) { bd = d; best = i; } }
    if (a0 === a1) best = 0;
    bits |= BigInt(best) << BigInt(3 * k);
  }
  for (let i = 0; i < 6; i++) out[o + 2 + i] = Number((bits >> BigInt(8 * i)) & 255n);
}
function encodeDds(w, h, rgba, kind) {
  const dxt5 = kind === 'DXT5' || kind === 'DXT3';
  const bs = dxt5 ? 16 : 8;
  const levels = [];
  let cw = w, chh = h, cur = rgba;
  for (;;) {
    const bw = Math.max(1, (cw + 3) >> 2), bh = Math.max(1, (chh + 3) >> 2), out = Buffer.alloc(bw * bh * bs), px = new Uint8Array(64);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      for (let k = 0; k < 16; k++) {
        const x = Math.min(cw - 1, bx * 4 + (k & 3)), y = Math.min(chh - 1, by * 4 + (k >> 2)), s = (y * cw + x) * 4;
        px[k * 4] = cur[s]; px[k * 4 + 1] = cur[s + 1]; px[k * 4 + 2] = cur[s + 2]; px[k * 4 + 3] = cur[s + 3];
      }
      const o = (by * bw + bx) * bs;
      if (dxt5) { encodeAlphaBlock(px, out, o); encodeColorBlock(px, out, o + 8, false); }
      else encodeColorBlock(px, out, o, true);
    }
    levels.push(out);
    if (cw === 1 && chh === 1) break;
    const nw = Math.max(1, cw >> 1), nh = Math.max(1, chh >> 1), next = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
      const x0 = Math.min(cw - 1, x * 2), x1 = Math.min(cw - 1, x * 2 + 1), y0 = Math.min(chh - 1, y * 2), y1 = Math.min(chh - 1, y * 2 + 1);
      next[(y * nw + x) * 4 + c] = (cur[(y0 * cw + x0) * 4 + c] + cur[(y0 * cw + x1) * 4 + c] + cur[(y1 * cw + x0) * 4 + c] + cur[(y1 * cw + x1) * 4 + c] + 2) >> 2;
    }
    cur = next; cw = nw; chh = nh;
  }
  const head = Buffer.alloc(128);
  head.write('DDS ', 0, 'latin1');
  head.writeUInt32LE(124, 4);
  head.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x20000 | 0x80000, 8); // caps|height|width|pixelformat|mipmapcount|linearsize
  head.writeUInt32LE(h, 12); head.writeUInt32LE(w, 16); head.writeUInt32LE(levels[0].length, 20);
  head.writeUInt32LE(levels.length, 28);
  head.writeUInt32LE(32, 76); head.writeUInt32LE(0x4, 80); head.write(dxt5 ? 'DXT5' : 'DXT1', 84, 'latin1');
  head.writeUInt32LE(0x1000 | 0x400000 | 0x8, 108); // texture|mipmap|complex
  return Buffer.concat([head, ...levels]);
}

/* ---------- zip writer (stored, no compression – required for .wotmod) ---------- */
function zipStore(files) { // [{name, data}]
  const parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), crc = crc32(f.data), size = f.data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(0x00210000, 10); // fixed DOS time/date (1980-01-01)
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(size, 18); lh.writeUInt32LE(size, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8);
    ch.writeUInt32LE(0x00210000, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(size, 20); ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + size;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

/* ---------- gettext .mo ---------- */
function mo(buf) {
  const map = new Map();
  if (!buf || buf.length < 28) return map;
  const le = buf.readUInt32LE(0) === 0x950412de;
  const r = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const n = r(8), oT = r(12), tT = r(16);
  for (let i = 0; i < n; i++) {
    const kl = r(oT + i * 8), ko = r(oT + i * 8 + 4), vl = r(tT + i * 8), vo = r(tT + i * 8 + 4);
    map.set(buf.toString('utf8', ko, ko + kl), buf.toString('utf8', vo, vo + vl));
  }
  return map;
}

module.exports = { Pkg, unpackXml, packXml, setVal, mkNode, writePrimitives, makeVertexSection, makeIndexSection, packN3, isPacked, kid, kids, at, str, vec, primitiveSections, readIndices, readVertices, nodeWorlds, applySkin, dds, ddsToRgba, encodePng, decodePng, encodeDds, zipStore, mo };
