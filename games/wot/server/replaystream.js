// Reads the recorded battle stream of a .wotreplay (after the JSON blocks) to get the exact replay length.
// Stream = Blowfish-ECB encrypted (fixed, publicly known key; every decrypted block is XORed with the previous one),
// then zlib. Packets: uint32 payload length, uint32 type, float32 clock (seconds), payload.
// Blowfish's initial tables are the hex digits of pi – they are computed here instead of being copied in.
'use strict';
const fs = require('fs');
const zlib = require('zlib');

let TABLES = null;
function piWords(count) {
  // pi with enough bits (Machin: pi = 16*atan(1/5) - 4*atan(1/239)), fractional part as 32-bit words
  const bits = BigInt(count * 32 + 64);
  const one = 1n << bits;
  const atanInv = (x) => {
    const xx = x * x; let term = one / x, sum = term, n = 1n, sign = -1n;
    while (term) { term /= xx; n += 2n; sum += sign * (term / n); sign = -sign; }
    return sum;
  };
  const pi = 16n * atanInv(5n) - 4n * atanInv(239n);
  let frac = pi - 3n * one; // drop the leading 3
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i++) { frac <<= 32n; out[i] = Number(frac >> bits); frac &= one - 1n; }
  return out;
}
function tables() {
  if (TABLES) return TABLES;
  const w = piWords(18 + 1024);
  TABLES = { P: w.slice(0, 18), S: [0, 1, 2, 3].map((i) => w.slice(18 + i * 256, 18 + (i + 1) * 256)) };
  return TABLES;
}

function blowfish(key) {
  const t = tables();
  const P = Uint32Array.from(t.P), S = t.S.map((s) => Uint32Array.from(s));
  const F = (x) => ((((S[0][x >>> 24] + S[1][(x >>> 16) & 255]) >>> 0) ^ S[2][(x >>> 8) & 255]) + S[3][x & 255]) >>> 0;
  const enc = (l, r) => {
    for (let i = 0; i < 16; i++) { l = (l ^ P[i]) >>> 0; r = (r ^ F(l)) >>> 0; [l, r] = [r, l]; }
    [l, r] = [r, l];
    return [(l ^ P[17]) >>> 0, (r ^ P[16]) >>> 0];
  };
  for (let i = 0, k = 0; i < 18; i++) {
    let d = 0;
    for (let j = 0; j < 4; j++) { d = ((d << 8) | key[k]) >>> 0; k = (k + 1) % key.length; }
    P[i] = (P[i] ^ d) >>> 0;
  }
  let l = 0, r = 0;
  for (let i = 0; i < 18; i += 2) { [l, r] = enc(l, r); P[i] = l; P[i + 1] = r; }
  for (const s of S) for (let i = 0; i < 256; i += 2) { [l, r] = enc(l, r); s[i] = l; s[i + 1] = r; }
  const dec = (l, r) => {
    for (let i = 17; i > 1; i--) { l = (l ^ P[i]) >>> 0; r = (r ^ F(l)) >>> 0; [l, r] = [r, l]; }
    [l, r] = [r, l];
    return [(l ^ P[0]) >>> 0, (r ^ P[1]) >>> 0];
  };
  return { enc, dec };
}

const KEY = Buffer.from('DE72BEA0DE04BEB1DEFEBEEFDEADBEEF', 'hex');

// whole replay: JSON blocks + decrypted, decompressed packet stream
function readAll(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x11343212) throw new Error('keine Replay-Datei');
  let pos = 8;
  const blocks = [];
  for (let i = 0, n = b.readUInt32LE(4); i < n; i++) { const l = b.readUInt32LE(pos); blocks.push(JSON.parse(b.toString('utf8', pos + 4, pos + 4 + l))); pos += 4 + l; }
  return { blocks, data: decrypt(b.subarray(pos + 8, pos + 8 + b.readUInt32LE(pos + 4))) };
}
function decrypt(enc) {
  const bf = blowfish(KEY);
  const out = Buffer.alloc(enc.length - (enc.length % 8));
  let pl = 0, pr = 0;
  for (let i = 0; i + 8 <= enc.length; i += 8) {
    let [l, r] = bf.dec(enc.readUInt32BE(i), enc.readUInt32BE(i + 4));
    if (i) { l = (l ^ pl) >>> 0; r = (r ^ pr) >>> 0; }
    out.writeUInt32BE(l, i); out.writeUInt32BE(r, i + 4);
    pl = l; pr = r;
  }
  return zlib.inflateSync(out, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
}

// returns { packets, first, last } – clocks in seconds of the recorded stream
function readStream(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x11343212) throw new Error('keine Replay-Datei');
  let pos = 8;
  for (let i = 0, n = b.readUInt32LE(4); i < n; i++) pos += 4 + b.readUInt32LE(pos);
  const enc = b.subarray(pos + 8, pos + 8 + b.readUInt32LE(pos + 4));
  const bf = blowfish(KEY);
  const out = Buffer.alloc(enc.length - (enc.length % 8));
  let pl = 0, pr = 0;
  for (let i = 0; i + 8 <= enc.length; i += 8) {
    let [l, r] = bf.dec(enc.readUInt32BE(i), enc.readUInt32BE(i + 4));
    if (i) { l = (l ^ pl) >>> 0; r = (r ^ pr) >>> 0; }
    out.writeUInt32BE(l, i); out.writeUInt32BE(r, i + 4);
    pl = l; pr = r;
  }
  const data = zlib.inflateSync(out, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  let p = 0, packets = 0, first = null, last = 0;
  while (p + 12 <= data.length) {
    const len = data.readUInt32LE(p), clock = data.readFloatLE(p + 8);
    if (Number.isFinite(clock) && clock >= 0 && clock < 7200) { if (first === null) first = clock; if (clock > last) last = clock; }
    p += 12 + len; packets++;
  }
  return { packets, first: first || 0, last, bytes: data.length };
}

module.exports = { readStream, readAll, blowfish, KEY };
