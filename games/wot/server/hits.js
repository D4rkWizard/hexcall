// Hit analysis from a .wotreplay: who hit whom, where on the tank, with what result.
//  - battle results block (if the battle was played to the end): per-enemy totals, killer
//  - recorded stream: Vehicle.showDamageFromShot (hit points on the model), showDamageFromExplosion, onHealthChanged
// Hit point = 64-bit "segment": byte0 effect code, byte1 part (0 chassis, 1 hull, 2 turret, 3 gun),
// bytes 2-4 start and 5-7 end of the shell's path, each 0..255 inside the part's bounding box.
// The exact impact = first intersection of that path with the part's mesh (meshes come from the 3D garage).
'use strict';
const fs = require('fs');
const path = require('path');
const bw = require('./bw');
const { readAll } = require('./replaystream');

const PARTS = ['chassis', 'hull', 'turret', 'gun'];
const NATION_IDX = ['ussr', 'germany', 'usa', 'china', 'france', 'uk', 'japan', 'czech', 'sweden', 'poland', 'italy', 'intunion'];
// effect codes (byte 0 of a hit point)
const EFFECTS = {
  0: { key: 'ricochet', label: 'Abpraller' }, 1: { key: 'ricochet', label: 'Abpraller' },
  2: { key: 'blocked', label: 'nicht durchschlagen' }, 3: { key: 'nodamage', label: 'durchschlagen ohne Schaden' },
  4: { key: 'pierced', label: 'durchschlagen' }, 5: { key: 'critical', label: 'durchschlagen + Modul' }, 6: { key: 'critical', label: 'durchschlagen + Modul' },
};
const DEATH = { 0: 'zerstört', 1: 'Feuer', 2: 'Rammen', 3: 'Absturz', 4: 'Ertrinken', 5: 'umgekippt', 6: 'Explosion', 7: 'Munitionslager', 8: 'Artillerie/Bombe' };
const ATTACK = { 0: 'Schuss', 1: 'Feuer', 2: 'Rammen', 3: 'Sturz', 4: 'Ertrinken', 5: 'Umkippen', 6: 'Todeszone', 7: 'Artillerie', 8: 'Bomber', 9: 'Rekonstruktion' };

module.exports = function hits({ DATA, gameDir, garage }) {
  const CACHE = path.join(DATA, 'hits-cache');
  let methods = null; // { dir, ids: {name: index} }

  /* ---- client method ids of the Vehicle entity: sorted by fixed argument size, variable-sized last ---- */
  function methodIds() {
    const dir = gameDir();
    if (methods && methods.dir === dir) return methods.ids;
    const pkg = new bw.Pkg(dir, (f) => /^scripts/i.test(f));
    const def = (n) => pkg.read(`scripts/entity_defs/${n}.def`) || pkg.read(`scripts/entity_defs/interfaces/${n}.def`);
    const aliases = new Map();
    try { for (const [k, n] of bw.unpackXml(pkg.read('scripts/entity_defs/alias.xml')).c) aliases.set(k, n); } catch {}
    const BASE = { INT8: 1, UINT8: 1, BOOL: 1, INT16: 2, UINT16: 2, INT32: 4, UINT32: 4, FLOAT32: 4, FLOAT: 4, INT64: 8, UINT64: 8, FLOAT64: 8, VECTOR2: 8, VECTOR3: 12, VECTOR4: 16 };
    const size = (node, depth = 0) => {
      if (depth > 8) return Infinity;
      const t = bw.str(node).split(/\s+/)[0];
      if (BASE[t] != null) return BASE[t];
      if (t === 'FIXED_DICT') { let s = 0; for (const [, p] of (bw.kid(node, 'Properties') || { c: [] }).c) s += size(bw.kid(p, 'Type'), depth + 1); return s; }
      if (aliases.has(t)) return size(aliases.get(t), depth + 1);
      return Infinity; // ARRAY, STRING, PYTHON, TUPLE, ... -> variable size
    };
    const list = [];
    const walk = (name, seen = new Set()) => {
      if (seen.has(name)) return; seen.add(name);
      const b = def(name); if (!b) return;
      const t = bw.unpackXml(b);
      for (const i of bw.kids(bw.kid(t, 'Implements'), 'Interface')) walk(bw.str(i), seen);
      for (const [k, n] of (bw.kid(t, 'ClientMethods') || { c: [] }).c) list.push({ name: k, size: bw.kids(n, 'Arg').reduce((a, x) => a + size(x), 0) });
    };
    walk('Vehicle');
    const sorted = list.map((m, i) => ({ ...m, i })).sort((a, b) => (a.size === b.size ? a.i - b.i : a.size - b.size));
    const ids = {}; sorted.forEach((m, k) => { ids[m.name] = k; });
    methods = { dir, ids };
    return ids;
  }

  /* ---- list.xml ids (vehicle type id inside its nation) for the compact descriptor search ---- */
  const typeIds = new Map(); // nation -> Map(id -> key)
  let scriptsPkg = null;
  function vehicleKeyById(nation, id) {
    if (!typeIds.has(nation)) {
      const m = new Map();
      try {
        if (!scriptsPkg) scriptsPkg = new bw.Pkg(gameDir(), (f) => /^scripts/i.test(f));
        for (const [k, n] of bw.unpackXml(scriptsPkg.read(`scripts/item_defs/vehicles/${nation}/list.xml`)).c) m.set(Number(bw.str(bw.kid(n, 'id'))), k);
      } catch {}
      typeIds.set(nation, m);
    }
    return typeIds.get(nation).get(id) || null;
  }
  // compact vehicle descriptor inside an entity-create packet:
  // [len][header = 1 | nation<<4 | (2 if the type id needs 16 bit)][type id u8/u16][chassis][engine][fuel tank][radio][turret][gun] (u16 each)
  function findDescriptor(pay) {
    for (let i = 1; i + 15 <= pay.length; i++) {
      const hdr = pay[i];
      if ((hdr & 0x0d) !== 1) continue;
      const wide = (hdr & 2) !== 0, nation = NATION_IDX[hdr >> 4];
      if (!nation || pay[i - 1] !== (wide ? 16 : 15)) continue;
      const id = wide ? pay.readUInt16LE(i + 1) : pay[i + 1];
      const key = vehicleKeyById(nation, id);
      if (!key) continue;
      const m = i + (wide ? 3 : 2);
      if (m + 12 > pay.length) continue;
      const names = garage.moduleNames(nation, pay.readUInt16LE(m + 8), pay.readUInt16LE(m + 10));
      if (!names.turret || !names.gun) continue;
      return { type: `${nation}:${key}`, turret: names.turret, gun: names.gun };
    }
    return null;
  }

  // shell type: showDamageFromShot's effectsIndex = position in shot_effects.xml ("mediumArmorPiercing", "mainAPCR", ...)
  let shotEffects = null;
  function shellOf(index, attacker) {
    if (!shotEffects) {
      shotEffects = [];
      try { if (!scriptsPkg) scriptsPkg = new bw.Pkg(gameDir(), (f) => /^scripts/i.test(f)); shotEffects = bw.unpackXml(scriptsPkg.read('scripts/item_defs/vehicles/common/shot_effects.xml')).c.map(([k]) => k); } catch {}
    }
    const name = shotEffects[index] || '';
    const kind = /APCR/.test(name) ? 'APCR' : /ArmorPiercing/.test(name) ? 'AP' : /HollowCharge/.test(name) ? 'HEAT' : /HighExplosive/.test(name) ? 'HE' : 'other';
    const gun = attacker && attacker.cfg ? attacker.cfg.split('|')[2] || '' : '';
    const cal = Number((/(\d{2,3})(?:[.,]\d)?\s*mm/i.exec(gun) || [])[1]) || null;
    return { kind, effect: name, caliber: cal, gun };
  }

  function analyze(file) {
    const st = fs.statSync(file);
    const cacheFile = path.join(CACHE, `${path.basename(file)}.json`);
    const cacheKey = `h6|${st.size}|${Math.round(st.mtimeMs)}`;
    try { const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); if (c.cacheKey === cacheKey) return c; } catch {}

    const { blocks, data } = readAll(file);
    const head = blocks[0];
    const ids = methodIds();
    const M = { shot: ids.showDamageFromShot, expl: ids.showDamageFromExplosion, hp: ids.onHealthChanged };
    const vehicles = {};
    const tankNames = new Map(garage.tanks().map((t) => [t.id, t.name]));
    for (const [vid, v] of Object.entries(head.vehicles || {})) {
      vehicles[vid] = { id: Number(vid), name: v.name || v.fakeName || '?', type: v.vehicleType, typeName: tankNames.get(v.vehicleType) || String(v.vehicleType).split(':')[1], team: v.team, cfg: null };
    }
    const meId = Object.keys(vehicles).find((k) => vehicles[k].name === head.playerName);

    // pass 1: module setup of every vehicle (compact descriptor in its create packet)
    let p = 0;
    while (p + 12 <= data.length) {
      const len = data.readUInt32LE(p), type = data.readUInt32LE(p + 4);
      if (type === 5 && len > 20) {
        const eid = data.readUInt32LE(p + 12), v = vehicles[eid];
        if (v && !v.cfg) {
          const d = findDescriptor(data.subarray(p + 12, p + 12 + len));
          // the header hides enemy types in some modes (e.g. Onslaught) – the descriptor has it
          if (d && (!v.type || v.type === d.type)) {
            if (!v.type) { v.type = d.type; v.typeName = tankNames.get(d.type) || d.type.split(':')[1]; }
            v.cfg = `${d.type}|${d.turret}|${d.gun}`;
          }
        }
      }
      p += 12 + len;
    }
    for (const v of Object.values(vehicles)) if (!v.cfg) v.cfg = v.type || '';

    // pass 2: events that involve me
    const geoCache = new Map();
    const geo = (cfg) => { if (!geoCache.has(cfg)) { let g = null; try { g = garage.partGeometry(cfg); } catch {} geoCache.set(cfg, g); } return geoCache.get(cfg); };
    const events = [];
    const lastShot = new Map(); // target -> last shot event (to attach the following health change)
    p = 0;
    while (p + 12 <= data.length) {
      const len = data.readUInt32LE(p), type = data.readUInt32LE(p + 4), clock = data.readFloatLE(p + 8);
      if (type === 8 && len >= 12) {
        const eid = data.readUInt32LE(p + 12), mid = data.readUInt32LE(p + 16), a = p + 24, end = p + 12 + len;
        const target = vehicles[eid];
        if (target) {
          if (mid === M.shot && a + 5 <= end) {
            const attacker = data.readInt32LE(a), cnt = data[a + 4];
            const tail = a + 5 + cnt * 16;
            if (tail + 6 <= end && (String(attacker) === meId || String(eid) === meId)) {
              const g = geo(target.cfg);
              const points = [];
              for (let k = 0; k < cnt; k++) {
                const q = a + 5 + k * 16;
                const seg = data.subarray(q + 4, q + 12);
                const part = PARTS[seg[1]];
                const pt = { code: seg[0], effect: (EFFECTS[seg[0]] || { key: 'other' }).key, part: part || null };
                const G = part && g && g[part];
                if (G) {
                  const dl = [0, 1, 2].map((i) => (G.hi[i] - G.lo[i]) / 255);
                  const s = [0, 1, 2].map((i) => G.lo[i] + dl[i] * seg[2 + i]), e = [0, 1, 2].map((i) => G.lo[i] + dl[i] * seg[5 + i]);
                  const o = [0, 1, 2].map((i) => (e[i] - s[i]) * 0.01);
                  const s2 = s.map((x, i) => x - o[i]), e2 = e.map((x, i) => x + o[i]);
                  const hit = firstHit(G.list, s2, e2);
                  const dir = norm(sub(e2, s2));
                  // no exact intersection (turret/gun: WoT's armour model differs from the visible one): snap to the nearest surface point
                  pt.p = (hit || nearestOnMesh(G.list, s2, e2) || mid3(s2, e2)).map(r3); pt.dir = dir.map(r3); pt.exact = !!hit;
                }
                points.push(pt);
              }
              const ev = { t: r1(clock), kind: 'shot', target: Number(eid), attacker, damage: Math.max(0, data.readInt32LE(tail + 2)), points,
                shell: shellOf(data[tail], vehicles[attacker]) };
              events.push(ev); lastShot.set(Number(eid), ev);
            }
          } else if (mid === M.expl && a + 23 <= end) {
            const attacker = data.readInt32LE(a);
            if (String(attacker) === meId || String(eid) === meId) events.push({ t: r1(clock), kind: 'explosion', target: Number(eid), attacker, damage: Math.max(0, data.readInt32LE(a + 17)), points: [] });
          } else if (mid === M.hp && a + 10 <= end) {
            const now = data.readInt16LE(a), before = data.readInt16LE(a + 2), attacker = data.readInt32LE(a + 4), reason = data[a + 8];
            if (String(attacker) === meId || String(eid) === meId) {
              const ev = lastShot.get(Number(eid));
              const dmg = Math.max(0, before - now);
              if (ev && ev.attacker === attacker && Math.abs(ev.t - clock) < 0.6 && ev.kind === 'shot') { ev.hp = [before, now]; if (!ev.damage) ev.damage = dmg; }
              else if (dmg > 0) events.push({ t: r1(clock), kind: 'health', target: Number(eid), attacker, damage: dmg, reason: ATTACK[reason] || `Grund ${reason}`, hp: [before, now], points: [] });
            }
          }
        }
      }
      p += 12 + len;
    }

    // battle results (only if the battle was played to the end)
    const res = Array.isArray(blocks[1]) ? blocks[1][0] : null;
    let summary = null;
    if (res && res.personal) {
      const pers = Object.values(res.personal).find((x) => x && typeof x === 'object' && x.details);
      if (pers) {
        const rows = [];
        for (const [key, d] of Object.entries(pers.details || {})) {
          const vid = (/\((\d+)/.exec(key) || [])[1];
          if (!vid || !vehicles[vid]) continue;
          if (!d.directHits && !d.damageDealt && !d.directHitsReceived && !d.damageReceived && !d.spotted && !d.damageAssistedTrack && !d.damageAssistedRadio && !d.explosionHits) continue;
          rows.push({ id: Number(vid), hits: d.directHits || 0, pierced: d.piercings || 0, splash: d.explosionHits || 0, damage: d.damageDealt || 0, crits: countBits(d.crits), kill: !!d.targetKills, spotted: !!d.spotted,
            assist: (d.damageAssistedTrack || 0) + (d.damageAssistedRadio || 0) + (d.damageAssistedStun || 0),
            hitsIn: d.directHitsReceived || 0, noDmgIn: d.noDamageDirectHitsReceived || 0, ricochetIn: d.rickochetsReceived || 0, damageIn: d.damageReceived || 0, blocked: d.damageBlockedByArmor || 0 });
        }
        rows.sort((x, y) => y.damage - x.damage || y.damageIn - x.damageIn);
        summary = { shots: pers.shots || 0, hits: pers.directHits || 0, pierced: pers.piercings || 0, damage: pers.damageDealt || 0, kills: pers.kills || 0,
          hitsIn: pers.directHitsReceived || 0, piercedIn: pers.piercingsReceived || 0, damageIn: pers.damageReceived || 0, blocked: pers.damageBlockedByArmor || 0,
          killer: pers.killerID || 0, death: pers.deathReason === -1 ? null : DEATH[pers.deathReason] || `Grund ${pers.deathReason}`, rows,
          result: res.common ? (res.common.winnerTeam === 0 ? 'unentschieden' : res.common.winnerTeam === pers.team ? 'sieg' : 'niederlage') : null };
      }
    }

    const out = { cacheKey, file: path.basename(file), map: head.mapDisplayName || head.mapName, date: head.dateTime, me: meId ? Number(meId) : null,
      vehicles, events, summary, methods: M };
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(out));
    return out;
  }

  return { analyze, methodIds };
};

const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const mid3 = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
function countBits(x) { let n = 0, v = Number(x) || 0; while (v) { n += v & 1; v = Math.floor(v / 2); } return n; }
// mesh vertex closest to the segment a->b (within 0.8 m), preferring the side the shell came from
function nearestOnMesh(list, a, b) {
  const d = sub(b, a), L = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
  let best = null, bestScore = Infinity;
  for (const { pos, idx } of list) {
    for (let i = 0; i < idx.length; i++) {
      const j = idx[i] * 3;
      const w = [pos[j] - a[0], pos[j + 1] - a[1], pos[j + 2] - a[2]];
      const t = Math.max(0, Math.min(1, (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / L));
      const dist = Math.hypot(a[0] + d[0] * t - pos[j], a[1] + d[1] * t - pos[j + 1], a[2] + d[2] * t - pos[j + 2]);
      const score = dist + t * 0.05;
      if (dist < 0.8 && score < bestScore) { bestScore = score; best = [pos[j], pos[j + 1], pos[j + 2]]; }
    }
  }
  return best;
}
// first intersection of segment a->b with any triangle (Möller–Trumbore), returns the point or null
function firstHit(list, a, b) {
  const d = sub(b, a);
  let best = Infinity;
  for (const { pos, idx } of list) {
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const i0 = idx[t] * 3, i1 = idx[t + 1] * 3, i2 = idx[t + 2] * 3;
      const e1x = pos[i1] - pos[i0], e1y = pos[i1 + 1] - pos[i0 + 1], e1z = pos[i1 + 2] - pos[i0 + 2];
      const e2x = pos[i2] - pos[i0], e2y = pos[i2 + 1] - pos[i0 + 1], e2z = pos[i2 + 2] - pos[i0 + 2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const sx = a[0] - pos[i0], sy = a[1] - pos[i0 + 1], sz = a[2] - pos[i0 + 2];
      const u = (sx * px + sy * py + sz * pz) / det;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) / det;
      if (tt >= 0 && tt <= 1 && tt < best) best = tt;
    }
  }
  return best === Infinity ? null : [a[0] + d[0] * best, a[1] + d[1] * best, a[2] + d[2] * best];
}
