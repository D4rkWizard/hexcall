// Reads osu!.db (osu! stable): beatmap MD5 → artist, title, difficulty, folder, .osu file, ids.
// Format: https://github.com/ppy/osu/wiki/Legacy-database-file-structure
'use strict';
const fs = require('fs');

function parse(buf) {
  let p = 0;
  const u8 = () => buf[p++];
  const i16 = () => { const v = buf.readInt16LE(p); p += 2; return v; };
  const i32 = () => { const v = buf.readInt32LE(p); p += 4; return v; };
  const f32 = () => { const v = buf.readFloatLE(p); p += 4; return v; };
  const f64 = () => { const v = buf.readDoubleLE(p); p += 8; return v; };
  const i64 = () => { const v = buf.readBigInt64LE(p); p += 8; return v; };
  const str = () => {
    const t = u8();
    if (t === 0x00) return '';
    if (t !== 0x0b) throw new Error(`osu!.db: unerwartetes Zeichen ${t} bei ${p - 1}`);
    let len = 0, shift = 0, b;
    do { b = u8(); len |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    const s = buf.toString('utf8', p, p + len); p += len; return s;
  };
  const ticksToIso = (t) => { try { return t > 0n ? new Date(Number((t - 621355968000000000n) / 10000n)).toISOString() : null; } catch { return null; } };

  const version = i32();
  i32(); // folder count
  u8(); i64(); // account unlocked, unlock date
  const player = str();
  const count = i32();
  const maps = new Map();
  const floatStars = version >= 20250107;
  for (let n = 0; n < count; n++) {
    if (version < 20191106) i32(); // entry size
    const m = {};
    m.artist = str(); m.artistU = str(); m.title = str(); m.titleU = str(); m.creator = str(); m.version = str();
    str(); // audio file
    m.md5 = str(); m.osuFile = str();
    m.status = u8(); i16(); i16(); i16(); // ranked status, circles, sliders, spinners
    i64(); // last modified
    if (version < 20140609) { m.ar = u8(); m.cs = u8(); m.hp = u8(); m.od = u8(); } else { m.ar = f32(); m.cs = f32(); m.hp = f32(); m.od = f32(); }
    f64(); // slider velocity
    if (version >= 20140609) {
      for (let mode = 0; mode < 4; mode++) {
        const c = i32();
        for (let k = 0; k < c; k++) {
          u8(); const mods = i32(); u8(); const sr = floatStars ? f32() : f64();
          if (mode === 0 && mods === 0) m.stars = sr;
        }
      }
    }
    m.drain = i32(); m.length = i32(); i32(); // drain time (s), total time (ms), preview
    const tp = i32(); p += tp * 17;
    m.beatmapId = i32(); m.setId = i32(); i32();
    u8(); u8(); u8(); u8(); // grades
    i16(); f32(); m.mode = u8();
    str(); str(); // source, tags
    i16(); str(); // online offset, title font
    u8(); m.lastPlayed = ticksToIso(i64()); u8(); // unplayed, last played, osz2
    m.folder = str();
    i64(); // last checked
    u8(); u8(); u8(); u8(); u8(); // ignore sound/skin, disable storyboard/video, visual override
    if (version < 20140609) i16();
    i32(); u8(); // last modification, mania scroll speed
    if (m.md5) maps.set(m.md5, m);
  }
  return { version, player, maps };
}

// cached by modification time
let cache = { file: null, mtime: 0, data: null };
function load(file) {
  const st = fs.statSync(file);
  if (cache.file === file && cache.mtime === st.mtimeMs && cache.data) return cache.data;
  const data = parse(fs.readFileSync(file));
  cache = { file, mtime: st.mtimeMs, data };
  return data;
}

module.exports = { parse, load };
