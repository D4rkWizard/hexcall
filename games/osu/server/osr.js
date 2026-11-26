// Liest die Kopfdaten einer .osr-Datei (ohne die komprimierten Cursor-Daten zu entpacken).
'use strict';

const MOD_NAMES = [['NF', 1], ['EZ', 2], ['TD', 4], ['HD', 8], ['HR', 16], ['SD', 32], ['DT', 64], ['RX', 128], ['HT', 256], ['NC', 512],
  ['FL', 1024], ['AT', 2048], ['SO', 4096], ['AP', 8192], ['PF', 16384], ['V2', 1 << 29]];

function modString(mods) {
  let list = MOD_NAMES.filter(([, b]) => mods & b).map(([n]) => n);
  if (list.includes('NC')) list = list.filter(m => m !== 'DT');
  if (list.includes('PF')) list = list.filter(m => m !== 'SD');
  return list.join('');
}

function readOsr(buf) {
  let p = 0;
  const need = n => { if (p + n > buf.length) throw new Error('Replay-Datei ist unvollständig'); };
  const u8 = () => { need(1); return buf[p++]; };
  const i16 = () => { need(2); const v = buf.readInt16LE(p); p += 2; return v; };
  const i32 = () => { need(4); const v = buf.readInt32LE(p); p += 4; return v; };
  const i64 = () => { need(8); const v = buf.readBigInt64LE(p); p += 8; return v; };
  const str = () => {
    if (u8() !== 0x0b) return '';
    let len = 0, shift = 0, b;
    do { b = u8(); len |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    need(len); const s = buf.toString('utf8', p, p + len); p += len; return s;
  };
  const r = {};
  r.mode = u8(); r.version = i32();
  r.md5 = str(); r.player = str(); r.replayMd5 = str();
  r.n300 = i16(); r.n100 = i16(); r.n50 = i16(); r.geki = i16(); r.katu = i16(); r.miss = i16();
  r.score = i32(); r.maxCombo = i16(); r.perfect = u8() === 1; r.mods = i32();
  str(); // Lebensbalken
  const ticks = i64();
  r.date = new Date(Number((ticks - 621355968000000000n) / 10000n)).toISOString();
  r.dataLength = i32();
  const total = r.n300 + r.n100 + r.n50 + r.miss;
  r.accuracy = total ? (300 * r.n300 + 100 * r.n100 + 50 * r.n50) / (300 * total) : 1;
  r.modString = modString(r.mods);
  return r;
}

module.exports = { readOsr, modString };
