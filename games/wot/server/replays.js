// Reads World of Tanks replay headers (.wotreplay) – only the JSON blocks at the start of the file,
// never the (large) recorded battle itself. Results are cached by file name + size + date.
'use strict';
const fs = require('fs');
const path = require('path');

const MAGIC = 0x11343212;

// Battle types (battleType in the replay header) – the common ones
const BATTLE_TYPES = {
  1: 'Zufallsgefecht', 2: 'Trainingsraum', 7: 'Gefechtsauftrag', 13: 'Clangefecht', 22: 'Rangliste',
  24: 'Frontlinie', 27: 'Stahljäger', 32: 'Event', 37: 'Zufallsgefecht (Event)', 43: 'Angriff',
};

function readBlocks(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, 0);
    if (head.readUInt32LE(0) !== MAGIC) return null;
    const count = Math.min(head.readUInt32LE(4), 3);
    const blocks = [];
    let pos = 8;
    const len = Buffer.alloc(4);
    for (let i = 0; i < count; i++) {
      fs.readSync(fd, len, 0, 4, pos);
      const n = len.readUInt32LE(0);
      if (n <= 0 || n > 8 * 1024 * 1024) break;
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, pos + 4);
      blocks.push(JSON.parse(buf.toString('utf8')));
      pos += 4 + n;
    }
    return blocks;
  } finally { fs.closeSync(fd); }
}

// "czech-Cz04_T50_51" -> "T 50 51" (readable enough without the game's localisation files)
function tankName(id) {
  const raw = String(id || '').split('-').slice(1).join('-') || String(id || '');
  return raw.replace(/^[A-Za-z]{1,3}\d+[a-z]?_/, '').replace(/_/g, ' ').trim();
}
const nationOf = (id) => String(id || '').split('-')[0];

function parse(file) {
  const blocks = readBlocks(file);
  if (!blocks || !blocks.length) return null;
  const h = blocks[0];
  const m = /^(\d\d)\.(\d\d)\.(\d{4}) (\d\d):(\d\d):(\d\d)$/.exec(h.dateTime || '');
  const date = m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}` : null;
  const r = {
    file: path.basename(file), date, map: h.mapDisplayName || h.mapName || '?', mapId: h.mapName || '',
    tankId: h.playerVehicle, tank: tankName(h.playerVehicle), nation: nationOf(h.playerVehicle),
    player: h.playerName || '', mode: BATTLE_TYPES[h.battleType] || (h.gameplayID && h.gameplayID !== 'ctf' ? `Event: ${h.gameplayID}` : `Typ ${h.battleType}`), battleType: h.battleType,
    version: h.clientVersionFromExe || '', result: 'unbekannt',
  };
  // second block = battle results (missing if you left the battle before it ended)
  const res = blocks[1] && Array.isArray(blocks[1]) ? blocks[1][0] : null;
  if (res && res.common && res.personal) {
    const p = Object.values(res.personal).find((x) => x && typeof x === 'object' && x.damageDealt !== undefined);
    if (p) {
      const win = res.common.winnerTeam;
      r.result = win === 0 ? 'unentschieden' : win === p.team ? 'sieg' : 'niederlage';
      Object.assign(r, {
        damage: p.damageDealt || 0, xp: p.xp || 0, kills: p.kills || 0, spotted: p.spotted || 0,
        assist: (p.damageAssistedRadio || 0) + (p.damageAssistedTrack || 0) + (p.damageAssistedStun || 0),
        blocked: p.damageBlockedByArmor || 0, credits: p.credits || 0, duration: res.common.duration || 0,
        survived: p.deathReason === -1,
      });
    }
  }
  return r;
}

function scan(dir, cacheFile) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
  const out = [], next = {};
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.wotreplay$/i.test(f) && f !== 'temp.wotreplay'); } catch { return []; }
  for (const f of files) {
    const full = path.join(dir, f);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    const key = `v2|${f}|${st.size}|${Math.round(st.mtimeMs)}`;
    let r = cache[key];
    if (r === undefined) { try { r = parse(full); } catch { r = null; } }
    next[key] = r;
    if (r) out.push(r);
  }
  try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(next)); } catch {}
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

module.exports = { scan, parse, tankName };
