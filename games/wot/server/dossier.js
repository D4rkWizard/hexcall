// Reads WoT's local statistics cache (%APPDATA%\Wargaming.net\WorldOfTanks\dossier_cache) to estimate the total play time.
// Each *PlayerAccount*.dat is a Python pickle: (cacheVersion, { (type, vehicleCompDescr): (time, dossierBlob) }).
// A vehicle dossier blob is: u16 version, n × u16 block sizes, then the blocks. Block 0 = random battles (xp, battlesCount, …),
// block 9 = "total" (creationTime, lastBattleTime, battleLifeTime, treesCut u16, mileage).
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(process.env.APPDATA || '', 'Wargaming.net', 'WorldOfTanks', 'dossier_cache');
const OVERHEAD = 150; // seconds per battle for garage, queue, loading – a rough guess, the game does not record it

// minimal pickle reader (protocol 2, only what the dossier cache uses)
function unpickle(b) {
  let i = 0; const st = [], memo = {}, marks = [];
  const popMark = () => st.splice(marks.pop());
  for (;;) {
    if (i >= b.length) throw new Error('pickle ended early');
    const op = b[i++];
    switch (op) {
      case 0x80: i++; break;
      case 0x4b: st.push(b[i]); i += 1; break;
      case 0x4d: st.push(b.readUInt16LE(i)); i += 2; break;
      case 0x4a: st.push(b.readInt32LE(i)); i += 4; break;
      case 0x8a: { const n = b[i++]; let v = 0; for (let k = n - 1; k >= 0; k--) v = v * 256 + b[i + k]; i += n; st.push(v); break; }
      case 0x47: st.push(b.readDoubleBE(i)); i += 8; break;
      case 0x4e: st.push(null); break;
      case 0x88: st.push(true); break;
      case 0x89: st.push(false); break;
      case 0x7d: st.push(new Map()); break;
      case 0x5d: case 0x29: st.push([]); break;
      case 0x28: marks.push(st.length); break;
      case 0x71: memo[b[i++]] = st[st.length - 1]; break;
      case 0x72: memo[b.readUInt32LE(i)] = st[st.length - 1]; i += 4; break;
      case 0x68: st.push(memo[b[i++]]); break;
      case 0x6a: st.push(memo[b.readUInt32LE(i)]); i += 4; break;
      case 0x85: st.push([st.pop()]); break;
      case 0x86: { const y = st.pop(), x = st.pop(); st.push([x, y]); break; }
      case 0x87: { const z = st.pop(), y = st.pop(), x = st.pop(); st.push([x, y, z]); break; }
      case 0x74: st.push(popMark()); break;
      case 0x54: { const n = b.readUInt32LE(i); i += 4; st.push(b.subarray(i, i + n)); i += n; break; }
      case 0x55: { const n = b[i++]; st.push(b.subarray(i, i + n)); i += n; break; }
      case 0x58: { const n = b.readUInt32LE(i); i += 4; st.push(b.toString('utf8', i, i + n)); i += n; break; }
      case 0x73: { const v = st.pop(), k = st.pop(); st[st.length - 1].set(k, v); break; }
      case 0x75: { const it = popMark(), d = st[st.length - 1]; for (let k = 0; k < it.length; k += 2) d.set(it[k], it[k + 1]); break; }
      case 0x61: { const v = st.pop(); st[st.length - 1].push(v); break; }
      case 0x65: { const it = popMark(); st[st.length - 1].push(...it); break; }
      case 0x2e: return st.pop();
      default: throw new Error(`unknown pickle op 0x${op.toString(16)}`);
    }
  }
}

// block offsets of a vehicle dossier: the number of blocks differs per version, so find n where the sizes add up
function blocks(blob) {
  for (let n = 5; 2 + 2 * n <= blob.length && n < 400; n++) {
    let sum = 0;
    for (let k = 0; k < n; k++) sum += blob.readUInt16LE(2 + 2 * k);
    if (2 + 2 * n + sum !== blob.length) continue;
    const sizes = [], offs = []; let off = 2 + 2 * n;
    for (let k = 0; k < n; k++) { const s = blob.readUInt16LE(2 + 2 * k); sizes.push(s); offs.push(off); off += s; }
    return { sizes, offs };
  }
  return null;
}

let cache = { key: '', val: null };

// newest account cache file (the account that played last on this PC)
function accountFile() {
  try {
    return fs.readdirSync(DIR).filter((f) => f.endsWith('.dat'))
      .map((f) => { const p = path.join(DIR, f); return { p, t: fs.statSync(p).mtimeMs, s: fs.statSync(p).size }; })
      .filter((f) => f.s > 1000)
      .sort((a, b) => b.t - a.t)[0] || null;
  } catch { return null; }
}

function estimate() {
  const f = accountFile();
  if (!f) return null;
  const key = `${f.p}|${f.t}`;
  if (cache.key === key) return cache.val;
  let val = null;
  try {
    const top = unpickle(fs.readFileSync(f.p));
    const dict = Array.isArray(top) ? top[1] : top;
    let life = 0, battles = 0, vehicles = 0, first = 0, last = 0, mileage = 0;
    for (const v of dict.values()) {
      const blob = v && v[1];
      if (!Buffer.isBuffer(blob)) continue;
      const bl = blocks(blob);
      if (!bl) continue;
      if (bl.sizes[9] === 18) {
        const t = bl.offs[9], c = blob.readUInt32LE(t), l = blob.readUInt32LE(t + 4);
        life += blob.readUInt32LE(t + 8); mileage += blob.readUInt32LE(t + 14);
        if (c > 1e9 && (!first || c < first)) first = c;
        if (l > last) last = l;
        vehicles++;
      }
      if (bl.sizes[0] >= 8) battles += blob.readUInt32LE(bl.offs[0] + 4);
    }
    if (vehicles) val = {
      kind: 'wot', ms: (life + battles * OVERHEAD) * 1000, battleMs: life * 1000, battles, vehicles, km: Math.round(mileage / 1000),
      since: first ? new Date(first * 1000).toISOString() : null, lastBattle: last ? new Date(last * 1000).toISOString() : null,
    };
  } catch (e) { console.error('WoT-Statistik (dossier_cache):', e.message); }
  cache = { key, val };
  return val;
}

module.exports = { estimate };
