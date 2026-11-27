// 3D garage – lists every tank of the installed WoT and serves its parts (geometry + textures) to the browser.
// Everything is read from the user's own game files on demand; nothing from Wargaming is shipped with the hub.
'use strict';
const fs = require('fs');
const path = require('path');
const bw = require('./bw');

const NATIONS = { ussr: 'UdSSR', germany: 'Deutschland', usa: 'USA', china: 'China', france: 'Frankreich', uk: 'Großbritannien', japan: 'Japan', czech: 'Tschechoslowakei', sweden: 'Schweden', poland: 'Polen', italy: 'Italien', intunion: 'International' };
const TYPES = { lightTank: 'LT', mediumTank: 'MT', heavyTank: 'HT', 'AT-SPG': 'JPZ', SPG: 'ARI' };
// vehicles that only exist for special modes – not useful in the garage
const SKIP_TAGS = /\b(observer|bob|battle_royale|fallout|event_battles|clanWarsBattles|epicBattlesOnly|story_mode|halloween|frontline|comp7_special|last_stand)\b/i;

module.exports = function garage({ DATA, gameDir, gameVersion, modsDir }) {
  const CACHE = path.join(DATA, 'garage-cache');
  let state = null; // { dir, pkg, names, tanks }
  const tankCache = new Map();

  function load() {
    const dir = gameDir();
    if (!dir) throw new Error('World of Tanks wurde nicht gefunden');
    if (state && state.dir === dir) return state;
    // tank files are spread over many archives (even particles-*.pkg) – index everything except maps and audio
    const pkg = new bw.Pkg(dir, (f) => !/^\d/.test(f) && !/^audioww/i.test(f));
    const names = new Map();
    const lc = path.join(dir, 'res', 'text', 'lc_messages');
    try {
      for (const f of fs.readdirSync(lc)) {
        const m = /^([a-z]+)_vehicles\.mo$/i.exec(f);
        if (m) names.set(m[1].toLowerCase(), bw.mo(fs.readFileSync(path.join(lc, f))));
      }
    } catch {}
    tankCache.clear();
    state = { dir, pkg, names, tanks: null };
    return state;
  }
  function tr(s, key) {
    const m = /^#([\w.]+?)_vehicles:(.+)$/.exec(key || '');
    if (!m) return key || '';
    const cat = s.names.get(m[1].toLowerCase());
    return (cat && cat.get(m[2])) || m[2];
  }

  function tanks() {
    const s = load();
    if (s.tanks) return s.tanks;
    const out = [];
    for (const nation of Object.keys(NATIONS)) {
      const buf = s.pkg.read(`scripts/item_defs/vehicles/${nation}/list.xml`);
      if (!buf) continue;
      for (const [key, n] of bw.unpackXml(buf).c) {
        const tags = bw.str(bw.kid(n, 'tags'));
        // skip special-mode copies of normal tanks (same model, would only duplicate the list)
        if (SKIP_TAGS.test(tags) || /^(xmlns|Env_)/i.test(key) || /_(IGR|StoryMode|7x7|bot|training|tutorial|SH|FL|BR|LS|bob|fallout|EB)$/i.test(key)) continue;
        const type = tags.split(/\s+/)[0];
        out.push({
          id: `${nation}:${key}`, nation, nationName: NATIONS[nation], key,
          name: tr(s, bw.str(bw.kid(n, 'userString'))), short: tr(s, bw.str(bw.kid(n, 'shortUserString'))),
          level: Number(bw.str(bw.kid(n, 'level'))) || 0, type: TYPES[type] || type,
          premium: /\bpremium\b/.test(tags) || bw.kid(n, 'notInShop') != null,
        });
      }
    }
    out.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name, 'de'));
    s.tanks = out;
    return out;
  }

  // the vehicle definition: model paths of chassis/hull/turret/gun and where they are attached
  // id = "nation:key", optionally "nation:key|turretName|gunName" for a specific module setup (replays)
  function tank(id) {
    const s = load();
    if (tankCache.has(id)) return tankCache.get(id).info;
    const [base, wantTurret, wantGun] = String(id).split('|');
    const [nation, key] = base.split(':');
    if (!NATIONS[nation] || !/^[\w-]+$/.test(key || '')) throw new Error('Unbekannter Panzer');
    const buf = s.pkg.read(`scripts/item_defs/vehicles/${nation}/${key}.xml`);
    if (!buf) throw new Error('Panzerdaten nicht gefunden');
    const V = bw.unpackXml(buf);
    const model = (n) => bw.str(bw.at(n, 'models/undamaged'));
    const v3 = (n) => { const a = bw.vec(n) || [0, 0, 0]; return [a[0] || 0, a[1] || 0, a[2] || 0]; };
    const hull = bw.kid(V, 'hull');
    const chassisList = bw.kid(V, 'chassis') ? bw.kid(V, 'chassis').c : [];
    const chassis = chassisList.length ? chassisList[chassisList.length - 1][1] : null;
    const turrets = bw.kid(V, 'turrets0') ? bw.kid(V, 'turrets0').c : [];
    const pickT = wantTurret && turrets.find(([n]) => n === wantTurret);
    const turret = pickT ? pickT[1] : turrets.length ? turrets[turrets.length - 1][1] : null; // default: top turret
    const guns = turret && bw.kid(turret, 'guns') ? bw.kid(turret, 'guns').c : [];
    const pickG = wantGun && guns.find(([n]) => n === wantGun);
    const gun = pickG ? pickG[1] : guns.length ? guns[guns.length - 1][1] : null; // default: top gun of that turret

    const hullPos = v3(chassis && bw.kid(chassis, 'hullPosition'));
    const turretPos = v3(hull && bw.at(hull, 'turretPositions/turret'));
    const gunPos = v3(turret && bw.kid(turret, 'gunPosition'));
    const add = (a, b) => a.map((x, i) => x + b[i]);
    const parts = [
      { part: 'chassis', label: 'Fahrwerk', model: chassis && model(chassis), offset: [0, 0, 0] },
      { part: 'hull', label: 'Wanne', model: hull && model(hull), offset: hullPos },
      { part: 'turret', label: 'Turm', model: turret && model(turret), offset: add(hullPos, turretPos) },
      { part: 'gun', label: 'Kanone', model: gun && model(gun), offset: add(add(hullPos, turretPos), gunPos) },
    ].filter((p) => p.model);

    const meshes = [];
    for (const p of parts) {
      p.meshes = [];
      const mb = s.pkg.read(p.model);
      if (!mb) continue;
      const visual = bw.str(bw.kid(bw.unpackXml(mb), 'nodefullVisual'));
      const vb = s.pkg.read(`${visual}.visual_processed`) || s.pkg.read(`${visual}.visual`);
      const pb = s.pkg.read(`${visual}.primitives_processed`) || s.pkg.read(`${visual}.primitives`);
      if (!vb || !pb) continue;
      const sections = bw.primitiveSections(pb);
      const vis = bw.unpackXml(vb);
      const worlds = bw.nodeWorlds(vis);
      for (const rs of bw.kids(vis, 'renderSet')) {
        // skinned sets (guns, tracks, wheels) store vertices relative to their bones
        const boneMats = bw.kids(rs, 'node').map((n) => worlds.get(bw.str(n)));
        for (const g of bw.kids(rs, 'geometry')) {
          const vSec = sections[bw.str(bw.kid(g, 'vertices'))], iSec = sections[bw.str(bw.kid(g, 'primitive'))];
          if (!vSec || !iSec) continue;
          let verts = bw.readVertices(vSec);
          const ind = bw.readIndices(iSec);
          if (verts.bones && boneMats.some(Boolean)) verts = bw.applySkin(verts, boneMats);
          for (const pg of bw.kids(g, 'primitiveGroup')) {
            const grp = ind.groups[Number(pg.v) || 0];
            if (!grp) continue;
            const mat = bw.kid(pg, 'material');
            const props = {};
            for (const pr of bw.kids(mat, 'property')) { const [k, val] = pr.c[0] || []; if (k) props[bw.str(pr)] = { type: k, v: val.v }; }
            const tex = (k) => (props[k] && props[k].type === 'Texture' ? String(props[k].v).trim() : null);
            const i = meshes.length;
            meshes.push({ verts, idx: ind.idx.subarray(grp.startIndex, grp.startIndex + grp.primitives * 3), part: p.part, diffuse: tex('diffuseMap'), mask: tex('excludeMaskAndAOMap'), gmm: tex('metallicGlossMap') });
            p.meshes.push({
              i, material: bw.str(bw.kid(mat, 'identifier')), diffuse: tex('diffuseMap'), normal: tex('normalMap'),
              alphaTest: props.alphaTestEnable ? !!props.alphaTestEnable.v : false,
              alphaRef: props.alphaReference ? Number(props.alphaReference.v) || 0 : 0,
              triangles: grp.primitives,
            });
          }
        }
      }
      p.visual = visual; // lod0 visual (without extension) – used when building models
      p.modelPath = p.model;
      delete p.model;
    }
    const partFiles = Object.fromEntries(parts.map((p) => [p.part, { visual: p.visual, model: p.modelPath }]));
    parts.forEach((p) => { delete p.visual; delete p.modelPath; });
    const info = { id, name: tankName(base), nation, key, parts };
    tankCache.set(id, { info, meshes, partFiles });
    if (tankCache.size > 6) tankCache.delete(tankCache.keys().next().value);
    return info;
  }
  function tankName(id) { const t = tanks().find((x) => x.id === id); return t ? t.name : id; }

  // binary mesh: u32 vertexCount, u32 indexCount, f32 pos[3n], f32 nrm[3n], f32 uv[2n], u32 idx[m]
  // the indices are re-based to only the vertices this primitive group uses
  function mesh(id, i) {
    if (!tankCache.has(id)) tank(id);
    const m = tankCache.get(id).meshes[Number(i)];
    if (!m) throw new Error('Teil nicht gefunden');
    const remap = new Map(), list = [];
    const idx = new Uint32Array(m.idx.length);
    for (let k = 0; k < m.idx.length; k++) {
      let r = remap.get(m.idx[k]);
      if (r === undefined) { r = list.length; remap.set(m.idx[k], r); list.push(m.idx[k]); }
      idx[k] = r;
    }
    const n = list.length, V = m.verts;
    const out = Buffer.alloc(8 + n * 32 + idx.length * 4);
    out.writeUInt32LE(n, 0); out.writeUInt32LE(idx.length, 4);
    const f = new Float32Array(out.buffer, out.byteOffset + 8, n * 8);
    list.forEach((src, j) => {
      f[j * 3] = V.pos[src * 3]; f[j * 3 + 1] = V.pos[src * 3 + 1]; f[j * 3 + 2] = V.pos[src * 3 + 2];
      f[n * 3 + j * 3] = V.nrm[src * 3]; f[n * 3 + j * 3 + 1] = V.nrm[src * 3 + 1]; f[n * 3 + j * 3 + 2] = V.nrm[src * 3 + 2];
      f[n * 6 + j * 2] = V.uv[src * 2]; f[n * 6 + j * 2 + 1] = V.uv[src * 2 + 1];
    });
    new Uint32Array(out.buffer, out.byteOffset + 8 + n * 32, idx.length).set(idx);
    return out;
  }

  // texture as PNG (decoded once, then cached in %APPDATA%\HexcallHub\garage-cache)
  // with tank set: the version with that tank's stickers baked in (if applied)
  function texture(p, tankId) {
    const s = load();
    const rel = String(p || '').replace(/\\/g, '/');
    if (!/^vehicles\/[\w\/.-]+\.dds$/i.test(rel) || rel.includes('..')) throw new Error('Ungültige Textur');
    if (tankId) {
      const baked = path.join(OUT, safeId(tankId), rel.replace(/\.dds$/i, '.png'));
      if (fs.existsSync(baked)) return fs.readFileSync(baked);
    }
    const file = path.join(CACHE, rel.replace(/\.dds$/i, '.png'));
    if (fs.existsSync(file)) return fs.readFileSync(file);
    const buf = s.pkg.read(rel);
    if (!buf) throw new Error('Textur nicht gefunden');
    const t = bw.ddsToRgba(buf, 2048);
    const png = bw.encodePng(t.width, t.height, t.rgba, true);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, png);
    return png;
  }

  /* ================= stickers ================= */
  const IMG = path.join(DATA, 'sticker-images');
  const OUT = path.join(DATA, 'sticker-out');
  const STICKERS = path.join(DATA, 'stickers.json');
  const MOD_NAME = 'darkwizard.hexcall_hub_sticker.wotmod';
  const safeId = (id) => String(id).replace(/[^\w-]/g, '_');
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const readAll = () => readJson(STICKERS, { images: [], tanks: {}, applied: {} });
  const writeAll = (d) => { fs.writeFileSync(STICKERS, JSON.stringify(d, null, 1)); };
  const v3ok = (a) => Array.isArray(a) && a.length === 3 && a.every((x) => Number.isFinite(x) && Math.abs(x) < 100);

  function addImage(name, buf) {
    if (!buf || buf.length > 16 * 1024 * 1024) throw new Error('Bild zu groß (max. 16 MB)');
    const img = bw.decodePng(buf); // validates
    fs.mkdirSync(IMG, { recursive: true });
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    fs.writeFileSync(path.join(IMG, `${id}.png`), buf);
    const all = readAll();
    const entry = { id, name: String(name || 'Bild').replace(/\.[^.]+$/, '').slice(0, 60), w: img.width, h: img.height };
    all.images.unshift(entry);
    writeAll(all);
    return entry;
  }
  function image(id) {
    if (!/^[a-z0-9]+$/.test(String(id))) throw new Error('Ungültig');
    return fs.readFileSync(path.join(IMG, `${id}.png`));
  }
  function removeImage(id) {
    const all = readAll();
    if (Object.values(all.tanks).some((l) => l.some((s) => s.image === id))) throw new Error('Das Bild wird noch auf einem Panzer benutzt');
    all.images = all.images.filter((x) => x.id !== id);
    writeAll(all);
    try { fs.unlinkSync(path.join(IMG, `${id}.png`)); } catch {}
    return all.images;
  }
  function stickers(tankId) {
    const all = readAll();
    let modOnDisk = false;
    try { load(); const f = stickerModPath(); modOnDisk = !!f && fs.existsSync(f); } catch {}
    return { images: all.images, stickers: all.tanks[tankId] || [], applied: all.applied[tankId] || null, modOnDisk, paint: Object.keys(paintIndex(tankId)) };
  }
  function saveStickers(tankId, list) {
    tank(tankId); // validates the id
    if (!Array.isArray(list) || list.length > 40) throw new Error('Ungültige Sticker-Liste');
    const all = readAll();
    const ids = new Set(all.images.map((x) => x.id));
    const clean = list.filter((s) => ids.has(s.image) && ['chassis', 'hull', 'turret', 'gun'].includes(s.part) && v3ok(s.p) && v3ok(s.n) && v3ok(s.r) && v3ok(s.u))
      .map((s) => ({ id: String(s.id || Date.now()).slice(0, 30), image: s.image, part: s.part, p: s.p, n: s.n, r: s.r, u: s.u,
        opacity: Math.max(0.05, Math.min(1, Number(s.opacity) || 1)), size: Number(s.size) || 0.5, rot: Number(s.rot) || 0, flip: !!s.flip, crop: cleanCrop(s.crop),
        bright: clampN(s.bright, -1, 1, 0), sat: clampN(s.sat, 0, 2, 1), contrast: clampN(s.contrast, 0.3, 2, 1) }));
    if (clean.length) all.tanks[tankId] = clean; else delete all.tanks[tankId];
    writeAll(all);
    return clean;
  }

  // paint the stickers of one tank into copies of its colour textures (full resolution)
  function bake(tankId, list, paint = new Map()) {
    tank(tankId);
    const { meshes } = tankCache.get(tankId);
    const imgs = new Map();
    const getImg = (id) => { if (!imgs.has(id)) imgs.set(id, bw.decodePng(image(id))); return imgs.get(id); };
    const byPart = {};
    for (const s of list) (byPart[s.part] = byPart[s.part] || []).push({ ...s, img: getImg(s.image), rr: dot(s.r, s.r), uu: dot(s.u, s.u), depth: Math.max(Math.hypot(...s.r), Math.hypot(...s.u)) * 0.6 });
    const ownDiffuse = new Set(meshes.map((m) => m.diffuse).filter(Boolean));
    for (const k of [...paint.keys()]) if (!ownDiffuse.has(k)) paint.delete(k);
    const texNames = [...new Set([...meshes.filter((m) => byPart[m.part] && m.diffuse).map((m) => m.diffuse), ...paint.keys()])];
    const results = [], warnings = [];
    // enlargement factor (max 4096): like WoT's emblems, which bring their own 512 px texture, every sticker gets
    // about one texel per image pixel (budget 512x512) instead of the few texels the tank texture has at that spot;
    // a paint layer gets at least its own resolution
    const STICKER_BUDGET = 512 * 512;
    const factorFor = (counts, w, h, paintW) => {
      let f = 1;
      for (const [st, n] of counts) {
        const k = st.crop || [0, 0, 1, 1], px = st.img.width * (k[2] - k[0]) * st.img.height * (k[3] - k[1]);
        const want = Math.min(px, STICKER_BUDGET);
        while (n * f * f < want * 0.7 && f < 8) f *= 2;
      }
      if (paintW) while (w * f < paintW && f < 8) f *= 2;
      while (f > 1 && Math.max(w, h) * f > 4096) f /= 2;
      return f;
    };
    for (const texName of texNames) {
      const src = state.pkg.read(texName);
      if (!src) { warnings.push(`Textur fehlt: ${texName}`); continue; }
      let t;
      try { t = bw.ddsToRgba(src, 1e9); } catch (e) { warnings.push(`${path.basename(texName)}: ${e.message}`); continue; }
      const group = meshes.filter((m) => m.diffuse === texName);
      const pimg = paint.get(texName);
      // A small sticker only gets a few texels of the tank texture. The texture is written anyway, so it can be
      // written at 2x / 4x resolution (max 4096, like HD mods): the original surface is enlarged bilinearly –
      // looks the same in game – and only the sticker / the paint gains the extra detail.
      const counts = computeLods(group, byPart, t.width, t.height);
      const f = factorFor(counts, t.width, t.height, pimg && pimg.width);
      if (f > 1) { t = { ...t, ...upscaleRgba(t.rgba, t.width, t.height, f) }; computeLods(group, byPart, t.width, t.height); }
      const { width: W, height: H } = t, rgba = t.rgba, painted = new Uint8Array(W * H);
      // pass 0: the paint layer (painted with the brush in UV space) – below the stickers
      if (pimg) {
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const c = sample(pimg, (x + 0.5) / W, (y + 0.5) / H), a = c[3] / 255;
          if (a <= 0.003) continue;
          const o = (y * W + x) * 4;
          rgba[o] = rgba[o] * (1 - a) + c[0] * a; rgba[o + 1] = rgba[o + 1] * (1 - a) + c[1] * a; rgba[o + 2] = rgba[o + 2] * (1 - a) + c[2] * a;
        }
      }
      // pass 1: stickers
      for (const m of group) {
        const st = byPart[m.part];
        if (!st) continue;
        rasterize(m, W, H, (x, y, P, N) => {
          for (const s of st) {
            const c = decalCoord(s, P, N);
            if (!c) continue;
            s.texels = (s.texels || 0) + 1;
            const col = sampleCrop(s, c);
            const a = (col[3] / 255) * s.opacity;
            if (a <= 0.003) continue;
            const o = (y * W + x) * 4;
            rgba[o] = rgba[o] * (1 - a) + col[0] * a; rgba[o + 1] = rgba[o + 1] * (1 - a) + col[1] * a; rgba[o + 2] = rgba[o + 2] * (1 - a) + col[2] * a;
            painted[y * W + x] = 1;
          }
        });
      }
      // pass 2: does another spot of the tank use the same texels? (mirrored / shared UVs)
      let shared = 0, total = 0;
      for (let i = 0; i < painted.length; i++) total += painted[i];
      for (const m of group) {
        const st = byPart[m.part] || [];
        rasterize(m, W, H, (x, y, P, N) => {
          if (painted[y * W + x] !== 1) return;
          if (st.some((s) => decalCoord(s, P, N, 1.15))) return;
          painted[y * W + x] = 2; shared++;
        }, -0.25);
      }
      if (total && shared / total > 0.04) warnings.push(`Auf ${path.basename(texName).replace(/_AM\.dds$/i, '')} teilt sich ein Sticker die Textur mit einer anderen Stelle des Panzers (z. B. der gespiegelten Seite) – er erscheint dort auch. Prüfansicht zeigt es.`);
      results.push({ texName, kind: t.kind, W, H, rgba });
    }
    // Keep 2D styles off stickers and paint – read from WoT's tank shader (PBS_tank_colourised):
    //  * excludeMaskAndAOMap: alpha × 5 switches the style pattern (tintMap) on, red blocks projection decals
    //    (emblems/inscriptions), green = ambient occlusion
    //  * metallicGlossMap: blue = how strongly the style's paint colours are mixed over the colour texture
    // Under every sticker / paint stroke (by its opacity): pattern off (alpha 0), paint off (GMM blue 0), matte
    // (GMM metallic 0, less gloss), no emblems on top (red 255).
    const masks = [];
    const editTexture = (field, fn) => {
      const names = [...new Set(meshes.filter((m) => m.diffuse && m[field] && (byPart[m.part] || paint.has(m.diffuse))).map((m) => m[field]))];
      for (const texName of names) {
        const src = state.pkg.read(texName);
        if (!src) continue;
        let t;
        try { t = bw.ddsToRgba(src, 1e9); } catch { continue; }
        // same enlargement rule as for the colour texture, so the edges stay clean
        const grp = meshes.filter((x) => x[field] === texName);
        const linked = [...new Set(grp.map((m) => m.diffuse).filter((d) => paint.has(d)))].map((d) => paint.get(d));
        const cnt = computeLods(grp, byPart, t.width, t.height);
        const f = factorFor(cnt, t.width, t.height, linked.length ? Math.max(...linked.map((p) => p.width)) / 2 : 0);
        if (f > 1) { t = { ...t, ...upscaleRgba(t.rgba, t.width, t.height, f) }; computeLods(grp, byPart, t.width, t.height); }
        const { width: W, height: H } = t, rgba = t.rgba;
        let set = 0;
        // paint layers use the same UVs as the colour texture
        if (linked.length) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          let a = 0;
          for (const p of linked) a = Math.max(a, sample(p, (x + 0.5) / W, (y + 0.5) / H)[3] / 255);
          if (a > 0.02 && fn(rgba, (y * W + x) * 4, Math.min(1, a * 1.15), t.kind)) set++;
        }
        for (const m of grp) {
          const st = byPart[m.part];
          if (!st) continue;
          rasterize(m, W, H, (x, y, P, N) => {
            for (const s of st) {
              const c = decalCoord(s, P, N);
              if (!c) continue;
              const a = (sampleCrop(s, c)[3] / 255) * s.opacity;
              if (a <= 0.02) continue;
              if (fn(rgba, (y * W + x) * 4, Math.min(1, a * 1.15), t.kind)) set++;
            }
          });
        }
        if (set && !masks.some((q) => q.texName === texName)) masks.push({ texName, kind: t.kind, W, H, rgba });
      }
    };
    editTexture('mask', (px, o, k, kind) => {
      const r = Math.round(px[o] + (255 - px[o]) * k);
      // green = ambient occlusion: mostly lifted under the sticker, so it is not darkened by the baked shadows
      const g = Math.round(px[o + 1] + (255 - px[o + 1]) * 0.7 * k);
      const al = kind === 'DXT1' ? px[o + 3] : Math.round(px[o + 3] * (1 - k));
      if (r === px[o] && g === px[o + 1] && al === px[o + 3]) return false;
      px[o] = r; px[o + 1] = g; px[o + 3] = al; return true;
    });
    // GMM: red = gloss, green = metallic (brightens the albedo and mirrors the surroundings – the "milky" look),
    // blue = style paint. A sticker behaves like matte paint: no metal, less gloss, no style paint.
    editTexture('gmm', (px, o, k) => {
      const r = Math.round(px[o] * (1 - 0.35 * k)), g = Math.round(px[o + 1] * (1 - k)), b = Math.round(px[o + 2] * (1 - k));
      if (r === px[o] && g === px[o + 1] && b === px[o + 2]) return false;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; return true;
    });
    // how many texture pixels each sticker really gets (WoT textures have limited resolution per square metre)
    const resolution = [];
    list.forEach((s0, i) => {
      const s = (byPart[s0.part] || []).find((q) => q.id === s0.id);
      const aspect = Math.hypot(...s0.r) / (Math.hypot(...s0.u) || 1);
      const px = s && s.texels ? Math.round(Math.sqrt(s.texels * aspect)) : 0;
      resolution.push({ id: s0.id, px });
      if (!px) warnings.push(`Sticker ${i + 1} trifft keine Fläche mit Farbtextur – nochmal neu setzen.`);
      else if (px < 90) warnings.push(`Sticker ${i + 1} bekommt an dieser Stelle nur ca. ${px} Pixel Breite (Auflösung der WoT-Textur) – er wirkt im Spiel pixelig. Größer machen oder ein einfacheres Motiv nehmen.`);
    });
    // textures outside the tank's own folder (tracks, common parts) are shared with other tanks
    const key = String(tankId).split(':')[1].toLowerCase();
    for (const r of results) if (!r.texName.toLowerCase().includes(`/${key}/`))
      warnings.push(`${path.basename(r.texName)} ist eine gemeinsame Textur (z. B. Ketten) – Sticker darauf erscheinen auch auf anderen Panzern, die sie benutzen.`);
    return { results, masks, warnings, resolution };
  }

  /* ================= brush paint layers ("Farbkasten") =================
     One PNG per colour texture of a tank, in the texture's UV space (painted in the browser, baked by bake()). */
  const PAINT = path.join(DATA, 'paint');
  const paintDir = (tankId) => path.join(PAINT, safeId(tankId));
  const paintIndex = (tankId) => readJson(path.join(paintDir(tankId), 'index.json'), {});
  const writePaintIndex = (tankId, idx) => { fs.mkdirSync(paintDir(tankId), { recursive: true }); fs.writeFileSync(path.join(paintDir(tankId), 'index.json'), JSON.stringify(idx, null, 1)); };
  const paintFile = (tex) => `${require('crypto').createHash('sha1').update(String(tex).toLowerCase()).digest('hex').slice(0, 16)}.png`;
  function diffuseOf(tankId, tex) {
    tank(tankId);
    const own = tankCache.get(tankId).meshes.some((m) => m.diffuse === tex);
    if (!own) throw new Error('Diese Textur gehört nicht zu diesem Panzer');
    return tex;
  }
  function paintList(tankId) { tank(tankId); return { layers: Object.keys(paintIndex(tankId)) }; }
  function paintImage(tankId, tex) {
    const idx = paintIndex(tankId);
    if (!idx[tex]) throw new Error('Keine Malschicht');
    return fs.readFileSync(path.join(paintDir(tankId), idx[tex]));
  }
  function savePaint(tankId, tex, buf) {
    diffuseOf(tankId, tex);
    if (!buf || buf.length > 64 * 1024 * 1024) throw new Error('Malschicht zu groß');
    const img = bw.decodePng(buf); // validates
    if (img.width > 4096 || img.height > 4096) throw new Error('Malschicht zu groß');
    const idx = paintIndex(tankId), file = paintFile(tex);
    fs.mkdirSync(paintDir(tankId), { recursive: true });
    fs.writeFileSync(path.join(paintDir(tankId), file), buf);
    idx[tex] = file;
    writePaintIndex(tankId, idx);
    return { ok: true, layers: Object.keys(idx) };
  }
  function clearPaint(tankId, tex) {
    tank(tankId);
    const idx = paintIndex(tankId);
    for (const t of tex ? [tex] : Object.keys(idx)) {
      if (!idx[t]) continue;
      try { fs.unlinkSync(path.join(paintDir(tankId), idx[t])); } catch {}
      delete idx[t];
    }
    writePaintIndex(tankId, idx);
    return { ok: true, layers: Object.keys(idx) };
  }
  // decoded paint layers of a tank: Map(colour texture name -> image)
  function loadPaint(tankId) {
    const out = new Map(), idx = paintIndex(tankId);
    for (const [tex, file] of Object.entries(idx)) {
      try { out.set(tex, bw.decodePng(fs.readFileSync(path.join(paintDir(tankId), file)))); } catch {}
    }
    return out;
  }

  // build every applied tank into one .wotmod in mods/<version>/
  function apply(tankId) {
    load();
    const all = readAll();
    const list = all.tanks[tankId] || [];
    const dir = path.join(OUT, safeId(tankId));
    fs.rmSync(dir, { recursive: true, force: true });
    let warnings = [], resolution = [];
    const paint = loadPaint(tankId);
    if (list.length || paint.size) {
      const b = bake(tankId, list, paint);
      warnings = b.warnings; resolution = b.resolution;
      for (const r of b.results) {
        // BC7 (like WoT's own 3D parts) instead of DXT: 8-bit endpoints and 16 steps per block keep sticker colours,
        // gradients and edges intact; mips averaged in linear light + lightly sharpened so they don't go dark/soft at distance
        const dds = bw.encodeDds(r.W, r.H, r.rgba, 'BC7', { linear: true, sharpen: 0.2 });
        const f = path.join(dir, r.texName);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, dds);
        const small = bw.ddsToRgba(dds, 2048);
        fs.writeFileSync(f.replace(/\.dds$/i, '.png'), bw.encodePng(small.width, small.height, small.rgba, true));
      }
      // camouflage exclude masks (same format as the originals) – keep 2D styles off the stickers
      for (const r of b.masks) {
        const f = path.join(dir, r.texName);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, bw.encodeDds(r.W, r.H, r.rgba, r.kind));
      }
      all.applied[tankId] = { at: new Date().toISOString(), textures: b.results.map((r) => r.texName), masks: b.masks.map((r) => r.texName), count: list.length, painted: paint.size };
    } else delete all.applied[tankId];
    const mod = writeMod(all); // throws if the file is locked – then the stored state stays as it was
    if (all.applied[tankId]) all.applied[tankId].resolution = resolution;
    writeAll(all);
    return { ...mod, warnings, resolution, applied: all.applied[tankId] || null };
  }
  // delete a mod file; WoT locks its mods while it runs – say so instead of failing silently
  function removeModFile(target) {
    try { fs.unlinkSync(target); }
    catch (e) {
      if (e.code === 'ENOENT') return;
      throw new Error(e.code === 'EBUSY' || e.code === 'EPERM' ? 'Die Mod-Datei ist gesperrt – bitte World of Tanks schließen und nochmal versuchen.' : e.message);
    }
  }
  const stickerModPath = () => { const g = state.dir, ver = gameVersion(g); return ver ? path.join(modsDir ? modsDir(ver) : path.join(g, 'mods', ver), MOD_NAME) : null; };

  function writeMod(all) {
    const g = state.dir, ver = gameVersion(g);
    if (!ver) throw new Error('WoT-Version nicht erkannt');
    const target = path.join(modsDir ? modsDir(ver) : path.join(g, 'mods', ver), MOD_NAME);
    const files = new Map(), clash = [];
    for (const [id, a] of Object.entries(all.applied)) for (const t of [...a.textures, ...(a.masks || [])]) {
      const f = path.join(OUT, safeId(id), t);
      if (!fs.existsSync(f)) continue;
      if (files.has(t.toLowerCase())) clash.push(t);
      files.set(t.toLowerCase(), { name: `res/${t}`, data: fs.readFileSync(f) });
    }
    if (!files.size) { removeModFile(target); return { mod: null, textures: 0, clash }; }
    const meta = Buffer.from(`<root>\n  <id>darkwizard.hexcall_hub_sticker</id>\n  <version>1.0.0</version>\n  <name>Hexcall Hub Sticker</name>\n  <description>Eigene Sticker aus der 3D-Garage des Hexcall Hub</description>\n</root>\n`);
    const zip = bw.zipStore([{ name: 'meta.xml', data: meta }, ...files.values()]);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, zip);
    try { fs.renameSync(tmp, target); } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw new Error(e.code === 'EBUSY' || e.code === 'EPERM' ? 'Die Mod-Datei ist gesperrt – bitte World of Tanks schließen und nochmal anwenden.' : e.message); }
    return { mod: target, textures: files.size, clash };
  }

  /* ================= stage 3: imported 3D models ================= */
  const MLIB = path.join(DATA, 'models');
  const MOUT = path.join(DATA, 'model-out');
  const MSTATE = path.join(DATA, 'models.json');
  const MOD_MODELS = 'darkwizard.hexcall_hub_models.wotmod';
  const PARTS = ['chassis', 'hull', 'turret', 'gun'];
  const readM = () => readJson(MSTATE, { models: [], tanks: {}, applied: {} });
  const writeM = (d) => fs.writeFileSync(MSTATE, JSON.stringify(d, null, 1));
  const LIMIT = { groups: 8, verts: 300000, tris: 300000 };

  // upload: [u32 json length][json][binary] – the browser already converted .glb/.gltf/.obj into plain arrays + PNG textures
  function addModel(name, buf) {
    if (!buf || buf.length < 8) throw new Error('Leere Datei');
    const jl = buf.readUInt32LE(0);
    const meta = JSON.parse(buf.toString('utf8', 4, 4 + jl));
    const bin = buf.subarray(4 + jl);
    if (!Array.isArray(meta.groups) || !meta.groups.length || meta.groups.length > LIMIT.groups) throw new Error(`Modell braucht 1–${LIMIT.groups} Teile`);
    let off = 0, verts = 0, tris = 0;
    const groups = meta.groups.map((g, i) => {
      const vc = g.vc | 0, ic = g.ic | 0;
      if (vc <= 0 || ic <= 0 || ic % 3) throw new Error('Ungültige Geometrie');
      verts += vc; tris += ic / 3;
      const bytes = vc * 32 + ic * 4;
      if (off + bytes > bin.length) throw new Error('Geometrie unvollständig');
      const idx = new Uint32Array(bin.buffer.slice(bin.byteOffset + off + vc * 32, bin.byteOffset + off + bytes));
      if (idx.some((x) => x >= vc)) throw new Error('Ungültige Indizes');
      off += bytes;
      const color = Array.isArray(g.color) ? g.color.slice(0, 3).map((x) => Math.max(0, Math.min(255, Math.round(Number(x) || 0)))) : [160, 160, 160];
      return { i, vc, ic, color, tex: !!g.tex, name: String(g.name || `Teil ${i + 1}`).slice(0, 40) };
    });
    if (verts > LIMIT.verts || tris > LIMIT.tris) throw new Error(`Modell zu groß (max. ${LIMIT.tris.toLocaleString('de-DE')} Dreiecke)`);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const dir = path.join(MLIB, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mesh.bin'), bin.subarray(0, off));
    meta.groups.forEach((g, i) => { if (g.tex) { const png = Buffer.from(String(g.tex), 'base64'); bw.decodePng(png); fs.writeFileSync(path.join(dir, `g${i}.png`), png); } });
    const entry = { id, name: String(meta.name || name || 'Modell').replace(/\.[^.]+$/, '').slice(0, 60), groups, verts, tris, size: meta.size || null, source: String(meta.source || '').slice(0, 20) };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(entry));
    const all = readM(); all.models.unshift(entry); writeM(all);
    return entry;
  }
  const modelDir = (id) => { if (!/^[a-z0-9]+$/.test(String(id))) throw new Error('Ungültig'); return path.join(MLIB, String(id)); };
  const modelBin = (id) => fs.readFileSync(path.join(modelDir(id), 'mesh.bin'));
  const modelTex = (id, g) => fs.readFileSync(path.join(modelDir(id), `g${Number(g) | 0}.png`));
  function removeModel(id) {
    const all = readM();
    if (Object.values(all.tanks).some((l) => l.some((x) => x.model === id))) throw new Error('Das Modell ist noch an einem Panzer angebaut');
    all.models = all.models.filter((m) => m.id !== id); writeM(all);
    fs.rmSync(modelDir(id), { recursive: true, force: true });
    return all.models;
  }
  function placements(tankId) { const all = readM(); return { models: all.models, list: all.tanks[tankId] || [], applied: all.applied[tankId] || null }; }
  function savePlacements(tankId, list) {
    tank(tankId);
    if (!Array.isArray(list) || list.length > 12) throw new Error('Höchstens 12 Modelle pro Panzer');
    const all = readM(), ids = new Set(all.models.map((m) => m.id));
    const num = (x, d) => (Number.isFinite(Number(x)) ? Number(x) : d);
    const clean = list.filter((x) => ids.has(x.model) && PARTS.includes(x.part) && Array.isArray(x.m) && x.m.length === 12 && x.m.every((v) => Number.isFinite(v) && Math.abs(v) < 1000))
      .map((x) => ({ id: String(x.id).replace(/[^\w]/g, '').slice(0, 20) || Date.now().toString(36), model: x.model, part: x.part, m: x.m,
        pos: (x.pos || [0, 0, 0]).slice(0, 3).map((v) => num(v, 0)), rot: (x.rot || [0, 0, 0]).slice(0, 3).map((v) => num(v, 0)), scale: num(x.scale, 1) }));
    if (clean.length) all.tanks[tankId] = clean; else delete all.tanks[tankId];
    writeM(all);
    return clean;
  }

  // constant texture from the median colour of one of the tank's own maps (flat normal map, typical gloss, no AO)
  function medianDds(texPath, fallback) {
    let px = fallback, kind = 'DXT5';
    try {
      const t = bw.ddsToRgba(state.pkg.read(texPath), 256);
      kind = t.kind;
      px = [0, 1, 2, 3].map((c) => { const a = []; for (let i = c; i < t.rgba.length; i += 4 * 7) a.push(t.rgba[i]); a.sort((x, y) => x - y); return a[a.length >> 1]; });
    } catch {}
    const rgba = new Uint8Array(16 * 16 * 4);
    for (let i = 0; i < 256; i++) rgba.set(px, i * 4);
    return bw.encodeDds(16, 16, rgba, kind);
  }
  function solidPng(color) { const rgba = new Uint8Array(16 * 16 * 4); for (let i = 0; i < 256; i++) rgba.set([...color, 255], i * 4); return { width: 16, height: 16, rgba }; }

  function applyModels(tankId) {
    load();
    tank(tankId);
    const all = readM();
    const list = all.tanks[tankId] || [];
    const outDir = path.join(MOUT, safeId(tankId));
    fs.rmSync(outDir, { recursive: true, force: true });
    const warnings = [], files = [];
    if (list.length) {
      const { partFiles, meshes } = tankCache.get(tankId);
      // template material: a static (non-skinned) material of this tank's hull
      const hullVis = bw.unpackXml(state.pkg.read(`${partFiles.hull.visual}.visual_processed`));
      const tplPg = bw.kids(bw.kid(bw.kids(hullVis, 'renderSet')[0], 'geometry'), 'primitiveGroup')[0];
      const tplMat = bw.kid(tplPg, 'material');
      const texOf = (k) => { const pr = bw.kids(tplMat, 'property').find((p) => bw.str(p) === k); return pr ? bw.str(pr.c[0][1]) : null; };
      const texBase = `vehicles/hexcall_hub/${safeId(tankId)}`;
      const write = (rel, data) => { const f = path.join(outDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); files.push(rel); };
      write(`${texBase}/flat_ANM.dds`, medianDds(texOf('normalMap'), [128, 128, 128, 128]));
      write(`${texBase}/flat_GMM.dds`, medianDds(texOf('metallicGlossMap'), [128, 128, 128, 255]));
      write(`${texBase}/flat_AO.dds`, medianDds(texOf('excludeMaskAndAOMap'), [255, 255, 255, 255]));
      // geometry of every placed model, transformed into the part's local space
      const models = new Map(all.models.map((m) => [m.id, m]));
      const built = []; // {inst, part, groups:[{name, vsec, isec, lo, hi, tex}]}
      let tankR = 0;
      for (const m of meshes) for (let i = 0; i < m.verts.pos.length; i++) tankR = Math.max(tankR, Math.abs(m.verts.pos[i]));
      list.forEach((inst, k) => {
        const meta = models.get(inst.model);
        const bin = modelBin(inst.model);
        let off = 0;
        const M = inst.m;
        const groups = [];
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const g of meta.groups) {
          const f = new Float32Array(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + g.vc * 32));
          const idx = new Uint32Array(bin.buffer.slice(bin.byteOffset + off + g.vc * 32, bin.byteOffset + off + g.vc * 32 + g.ic * 4));
          off += g.vc * 32 + g.ic * 4;
          const pos = new Float32Array(g.vc * 3), nrm = new Float32Array(g.vc * 3), uv = f.slice(g.vc * 6, g.vc * 8);
          for (let i = 0; i < g.vc; i++) {
            const x = f[i * 3], y = f[i * 3 + 1], z = f[i * 3 + 2], nx = f[g.vc * 3 + i * 3], ny = f[g.vc * 3 + i * 3 + 1], nz = f[g.vc * 3 + i * 3 + 2];
            for (let r = 0; r < 3; r++) {
              const v = M[r * 4] * x + M[r * 4 + 1] * y + M[r * 4 + 2] * z + M[r * 4 + 3];
              pos[i * 3 + r] = v; if (v < lo[r]) lo[r] = v; if (v > hi[r]) hi[r] = v;
              nrm[i * 3 + r] = M[r * 4] * nx + M[r * 4 + 1] * ny + M[r * 4 + 2] * nz;
            }
            const l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
            nrm[i * 3] /= l; nrm[i * 3 + 1] /= l; nrm[i * 3 + 2] /= l;
          }
          // winding like WoT's own hulls: (b-a)x(c-a) points along the normal
          for (let t = 0; t < idx.length; t += 3) {
            const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
            const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
            const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
            const an = [nrm[a] + nrm[b] + nrm[c], nrm[a + 1] + nrm[b + 1] + nrm[c + 1], nrm[a + 2] + nrm[b + 2] + nrm[c + 2]];
            if (fn[0] * an[0] + fn[1] * an[1] + fn[2] * an[2] < 0) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
          }
          // colour texture
          const am = `${texBase}/${inst.id}_${g.i}_AM.dds`;
          const img = g.tex ? bw.decodePng(modelTex(inst.model, g.i)) : solidPng(g.color);
          write(am, bw.encodeDds(img.width, img.height, img.rgba, 'DXT1'));
          const name = `hx_${inst.id}_${g.i}`;
          groups.push({ name, vsec: bw.makeVertexSection(pos, nrm, uv), isec: bw.makeIndexSection(idx, g.vc), am, center: [0, 1, 2].map((r) => (lo[r] + hi[r]) / 2) });
        }
        const ext = Math.max(...hi.map((v, r) => Math.max(Math.abs(v), Math.abs(lo[r]))));
        if (ext > tankR * 1.6 + 0.5) warnings.push(`Modell ${k + 1} ragt weit über den Panzer hinaus – im Gefecht wirkt das wie ein größerer Panzer. Bitte kleiner machen.`);
        built.push({ inst, part: inst.part, groups, lo, hi });
      });
      // patch every LOD of every affected part
      for (const part of PARTS) {
        const mine = built.filter((b) => b.part === part);
        if (!mine.length || !partFiles[part]) continue;
        let lods = 0;
        for (let L = 0; L < 8; L++) {
          const base = partFiles[part].visual.replace(/\/lod\d+\//i, `/lod${L}/`);
          const vb = state.pkg.read(`${base}.visual_processed`), pb = state.pkg.read(`${base}.primitives_processed`);
          if (!vb || !pb) continue;
          lods++;
          const vis = bw.unpackXml(vb);
          const sections = Object.entries(bw.primitiveSections(pb));
          const insertAt = vis.c.reduce((last, [k], i) => (k === 'renderSet' ? i : last), -1) + 1;
          const newSets = [];
          for (const b of mine) for (const g of b.groups) {
            sections.push([`${g.name}.vertices`, g.vsec], [`${g.name}.indices`, g.isec]);
            const mat = clone(tplMat);
            setChild(mat, 'identifier', g.name, 1);
            for (const pr of bw.kids(mat, 'property')) {
              const k = bw.str(pr), val = pr.c[0] && pr.c[0][1];
              if (!val) continue;
              if (k === 'diffuseMap') bw.setVal(val, g.am, 1);
              else if (k === 'normalMap') bw.setVal(val, `${texBase}/flat_ANM.dds`, 1);
              else if (k === 'metallicGlossMap') bw.setVal(val, `${texBase}/flat_GMM.dds`, 1);
              else if (k === 'excludeMaskAndAOMap') bw.setVal(val, `${texBase}/flat_AO.dds`, 1);
              else if (k === 'doubleSided') bw.setVal(val, true, 4);
            }
            const pg = bw.mkNode(0, 2, [['material', mat], ['groupOrigin', bw.mkNode(g.center, 3)]]);
            const geo = bw.mkNode('', 1, [['vertices', bw.mkNode(`${g.name}.vertices`, 1)], ['primitive', bw.mkNode(`${g.name}.indices`, 1)], ['primitiveGroup', pg]]);
            newSets.push(['renderSet', bw.mkNode('', 1, [['treatAsWorldSpaceObject', bw.mkNode(false, 4)], ['node', bw.mkNode('Scene Root', 1)], ['geometry', geo]])]);
          }
          vis.c.splice(insertAt, 0, ...newSets);
          growBox(bw.kid(vis, 'boundingBox'), mine);
          write(`${base}.visual_processed`, bw.packXml(vis));
          write(`${base}.primitives_processed`, bw.writePrimitives(sections, pb.subarray(0, 4)));
          // the .model's visibility box decides when the part is culled
          const modelPath = partFiles[part].model.replace(/\/lod\d+\//i, `/lod${L}/`);
          const mb = state.pkg.read(modelPath);
          if (mb && L === 0) { const mt = bw.unpackXml(mb); if (growBox(bw.kid(mt, 'visibilityBox'), mine)) write(modelPath, bw.packXml(mt)); }
        }
        if (!lods) warnings.push(`Für ${part} wurden keine Modelldateien gefunden.`);
      }
      all.applied[tankId] = { at: new Date().toISOString(), files, count: list.length };
    } else delete all.applied[tankId];
    writeM(all);
    const mod = writeModelMod(all);
    return { ...mod, warnings, applied: all.applied[tankId] || null };
  }
  function clone(n) { return { v: Array.isArray(n.v) ? [...n.v] : n.v, t: n.t, raw: n.raw, e: n.e, c: n.c.map(([k, c]) => [k, clone(c)]) }; }
  function setChild(n, name, v, t) { const k = bw.kid(n, name); if (k) bw.setVal(k, v, t); else n.c.push([name, bw.mkNode(v, t)]); }
  function growBox(box, built) {
    if (!box) return false;
    const mn = bw.kid(box, 'min'), mx = bw.kid(box, 'max');
    if (!mn || !mx) return false;
    const a = bw.vec(mn) || [0, 0, 0], b = bw.vec(mx) || [0, 0, 0];
    for (const x of built) for (let r = 0; r < 3; r++) { a[r] = Math.min(a[r], x.lo[r]); b[r] = Math.max(b[r], x.hi[r]); }
    // keep the original encoding (.model files store vectors as text, .visual files as floats)
    const put = (n, v) => (n.t === 1 ? bw.setVal(n, v.map((x) => +x.toFixed(6)).join(' '), 1) : bw.setVal(n, v, 3));
    put(mn, a); put(mx, b);
    return true;
  }
  function writeModelMod(all) {
    const g = state.dir, ver = gameVersion(g);
    if (!ver) throw new Error('WoT-Version nicht erkannt');
    const target = path.join(modsDir ? modsDir(ver) : path.join(g, 'mods', ver), MOD_MODELS);
    const files = new Map();
    for (const [id, a] of Object.entries(all.applied)) for (const rel of a.files) {
      const f = path.join(MOUT, safeId(id), rel);
      if (fs.existsSync(f)) files.set(rel.toLowerCase(), { name: `res/${rel}`, data: fs.readFileSync(f) });
    }
    if (!files.size) { removeModFile(target); return { mod: null, files: 0 }; }
    const meta = Buffer.from(`<root>\n  <id>darkwizard.hexcall_hub_models</id>\n  <version>1.0.0</version>\n  <name>Hexcall Hub Modelle</name>\n  <description>Eigene 3D-Anbauten aus der 3D-Garage des Hexcall Hub</description>\n</root>\n`);
    const zip = bw.zipStore([{ name: 'meta.xml', data: meta }, ...files.values()]);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, zip);
    try { fs.renameSync(tmp, target); } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw new Error(e.code === 'EBUSY' || e.code === 'EPERM' ? 'Die Mod-Datei ist gesperrt – bitte World of Tanks schließen und nochmal anwenden.' : e.message); }
    return { mod: target, files: files.size };
  }

  /* ================= helpers for the hit analysis ================= */
  const compIds = new Map(); // nation -> { turrets: Map(id->name), guns: Map(id->name) }
  function moduleNames(nation, turretId, gunId) {
    load();
    if (!compIds.has(nation)) {
      const read = (f) => { const m = new Map(); try { for (const [k, n] of bw.kid(bw.unpackXml(state.pkg.read(`scripts/item_defs/vehicles/${nation}/components/${f}.xml`)), 'ids').c) m.set(Number(n.v), k); } catch {} return m; };
      compIds.set(nation, { turrets: read('turrets'), guns: read('guns') });
    }
    const c = compIds.get(nation);
    return { turret: c.turrets.get(turretId) || null, gun: c.guns.get(gunId) || null };
  }
  // all triangles of each part in its local space (for ray tests) + bounding box
  function partGeometry(id) {
    tank(id);
    const { meshes } = tankCache.get(id), out = {};
    for (const m of meshes) {
      const g = out[m.part] || (out[m.part] = { list: [], lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] });
      g.list.push({ pos: m.verts.pos, idx: m.idx });
      for (let i = 0; i < m.idx.length; i++) for (let k = 0; k < 3; k++) { const v = m.verts.pos[m.idx[i] * 3 + k]; if (v < g.lo[k]) g.lo[k] = v; if (v > g.hi[k]) g.hi[k] = v; }
    }
    return out;
  }

  return { tanks, tank, mesh, texture, moduleNames, partGeometry, addImage, image, removeImage, stickers, saveStickers, apply, paintList, paintImage, savePaint, clearPaint,
    addModel, modelBin, modelTex, removeModel, placements, savePlacements, applyModels };
};

/* ---------- sticker geometry helpers ---------- */
// image section of a sticker (x0, y0, x1, y1 in 0..1, top-left origin) – "zuschneiden" in the 3D garage
function cleanCrop(c) {
  if (!Array.isArray(c) || c.length !== 4 || !c.every(Number.isFinite)) return [0, 0, 1, 1];
  const [x0, y0, x1, y1] = c.map((v) => Math.max(0, Math.min(1, v)));
  return x1 - x0 >= 0.02 && y1 - y0 >= 0.02 ? [x0, y0, x1, y1] : [0, 0, 1, 1];
}
function sampleCrop(s, c) {
  const k = s.crop || [0, 0, 1, 1], su = s.flip ? 1 - c[0] : c[0], sv = 1 - c[1];
  return adjustColor(sampleLod(s.img, k[0] + su * (k[2] - k[0]), k[1] + sv * (k[3] - k[1]), s.lod || 0), s);
}
const clampN = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
// brightness / colour strength / contrast of a sticker – the same formula as the live preview shader (ui/garage.js)
function adjustColor(col, s) {
  const b = s.bright || 0, sat = s.sat == null ? 1 : s.sat, con = s.contrast == null ? 1 : s.contrast;
  if (!b && sat === 1 && con === 1) return col;
  let r = col[0] / 255, g = col[1] / 255, bl = col[2] / 255;
  r = (r - 0.5) * con + 0.5; g = (g - 0.5) * con + 0.5; bl = (bl - 0.5) * con + 0.5;
  const f = b >= 0 ? 1 + b : 1 + b * 0.8; r *= f; g *= f; bl *= f;
  const l = r * 0.3 + g * 0.59 + bl * 0.11; r = l + (r - l) * sat; g = l + (g - l) * sat; bl = l + (bl - l) * sat;
  const c8 = (v) => Math.max(0, Math.min(255, v * 255));
  return [c8(r), c8(g), c8(bl), col[3]];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// decal space: u,v in [0,1] across the sticker, |d| <= 1 through its depth; only surfaces facing the sticker
function decalCoord(s, P, N, grow = 1) {
  const d = [P[0] - s.p[0], P[1] - s.p[1], P[2] - s.p[2]];
  const u = (dot(d, s.r) / s.rr) * 0.5 + 0.5, v = (dot(d, s.u) / s.uu) * 0.5 + 0.5;
  const m = (grow - 1) / 2;
  if (u < -m || u > 1 + m || v < -m || v > 1 + m) return null;
  if (Math.abs(dot(d, s.n)) > s.depth * grow) return null;
  const nl = Math.hypot(...N) || 1;
  if (dot(N, s.n) / nl < 0.2) return null;
  return [Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))];
}
function sample(img, u, v) {
  const x = u * img.width - 0.5, y = v * img.height - 0.5;
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x))), y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  const x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1), fx = Math.min(1, Math.max(0, x - x0)), fy = Math.min(1, Math.max(0, y - y0));
  const o = [], d = img.rgba, w = img.width;
  for (let c = 0; c < 4; c++) {
    const a = d[(y0 * w + x0) * 4 + c] * (1 - fx) + d[(y0 * w + x1) * 4 + c] * fx;
    const b = d[(y1 * w + x0) * 4 + c] * (1 - fx) + d[(y1 * w + x1) * 4 + c] * fx;
    o.push(a * (1 - fy) + b * fy);
  }
  return o;
}
/* ---------- quality when a sticker is small: mipmaps + trilinear filtering ----------
   One texel of the tank texture often covers many pixels of the sticker image. Taking a single sample per texel
   makes small stickers jagged and noisy. Instead the image gets a pyramid of half-size levels (box filter in linear
   light, premultiplied alpha – edges don't darken), and each texture picks the level that matches how many image
   pixels fall on one texel, blending between two levels (like a GPU does). */
const S2L = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const L2S = (v) => { v = Math.max(0, Math.min(1, v)); return (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255; };
function mipsOf(img) {
  if (img.mips) return img.mips;
  const w0 = img.width, h0 = img.height, d0 = new Float32Array(w0 * h0 * 4);
  for (let i = 0; i < w0 * h0; i++) {
    const a = img.rgba[i * 4 + 3] / 255;
    d0[i * 4] = S2L[img.rgba[i * 4]] * a; d0[i * 4 + 1] = S2L[img.rgba[i * 4 + 1]] * a; d0[i * 4 + 2] = S2L[img.rgba[i * 4 + 2]] * a; d0[i * 4 + 3] = a;
  }
  const levels = [{ w: w0, h: h0, d: d0 }];
  for (let L = levels[0]; L.w > 1 || L.h > 1;) {
    const w = Math.max(1, L.w >> 1), h = Math.max(1, L.h >> 1), d = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
      const x0 = Math.min(L.w - 1, x * 2), x1 = Math.min(L.w - 1, x * 2 + 1), y0 = Math.min(L.h - 1, y * 2), y1 = Math.min(L.h - 1, y * 2 + 1);
      d[(y * w + x) * 4 + c] = (L.d[(y0 * L.w + x0) * 4 + c] + L.d[(y0 * L.w + x1) * 4 + c] + L.d[(y1 * L.w + x0) * 4 + c] + L.d[(y1 * L.w + x1) * 4 + c]) / 4;
    }
    L = { w, h, d, s: sharpen(d, w, h, 0.45) }; levels.push(L);
  }
  levels[0].s = d0;
  return (img.mips = levels);
}
// gentle unsharp mask for the reduced levels (keeps edges and text crisp after averaging); clamped to the alpha
function sharpen(d, w, h, amount) {
  if (w < 3 || h < 3) return d;
  const o = new Float32Array(d.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, xm = Math.max(0, x - 1), xp = Math.min(w - 1, x + 1), ym = Math.max(0, y - 1), yp = Math.min(h - 1, y + 1);
    for (let c = 0; c < 4; c++) {
      const blur = (d[(ym * w + x) * 4 + c] + d[(yp * w + x) * 4 + c] + d[(y * w + xm) * 4 + c] + d[(y * w + xp) * 4 + c] + 4 * d[i + c]) / 8;
      o[i + c] = d[i + c] + amount * (d[i + c] - blur);
    }
    o[i + 3] = Math.max(0, Math.min(1, o[i + 3]));
    for (let c = 0; c < 3; c++) o[i + c] = Math.max(0, Math.min(o[i + 3], o[i + c]));
  }
  return o;
}
function bilinearLevel(L, u, v, out) {
  const x = u * L.w - 0.5, y = v * L.h - 0.5;
  const x0 = Math.max(0, Math.min(L.w - 1, Math.floor(x))), y0 = Math.max(0, Math.min(L.h - 1, Math.floor(y)));
  const x1 = Math.min(L.w - 1, x0 + 1), y1 = Math.min(L.h - 1, y0 + 1), fx = Math.min(1, Math.max(0, x - x0)), fy = Math.min(1, Math.max(0, y - y0));
  for (let c = 0; c < 4; c++) {
    const S = L.s || L.d;
    const a = S[(y0 * L.w + x0) * 4 + c] * (1 - fx) + S[(y0 * L.w + x1) * 4 + c] * fx;
    const b = S[(y1 * L.w + x0) * 4 + c] * (1 - fx) + S[(y1 * L.w + x1) * 4 + c] * fx;
    out[c] = a * (1 - fy) + b * fy;
  }
}
const _q0 = [0, 0, 0, 0], _q1 = [0, 0, 0, 0];
function sampleLod(img, u, v, lod) {
  const mips = mipsOf(img), l = Math.max(0, Math.min(mips.length - 1, lod)), i0 = Math.floor(l), t = l - i0;
  bilinearLevel(mips[i0], u, v, _q0);
  if (t > 0.001 && i0 + 1 < mips.length) { bilinearLevel(mips[i0 + 1], u, v, _q1); for (let c = 0; c < 4; c++) _q0[c] = _q0[c] * (1 - t) + _q1[c] * t; }
  const a = _q0[3];
  if (a <= 1e-5) return [0, 0, 0, 0];
  return [L2S(_q0[0] / a), L2S(_q0[1] / a), L2S(_q0[2] / a), a * 255];
}
// which mip level each sticker needs on a texture of W x H: log2 of image pixels per texel (per axis)
function computeLods(group, byPart, W, H) {
  const counts = new Map();
  for (const m of group) {
    const st = byPart[m.part];
    if (!st) continue;
    rasterize(m, W, H, (x, y, P, N) => { for (const s of st) if (decalCoord(s, P, N)) counts.set(s, (counts.get(s) || 0) + 1); });
  }
  for (const [s, n] of counts) {
    const k = s.crop || [0, 0, 1, 1], px = s.img.width * (k[2] - k[0]) * s.img.height * (k[3] - k[1]);
    s.lod = n ? Math.max(0, 0.5 * Math.log2(px / n)) : 0;
  }
  return counts;
}
// bilinear enlargement of a decoded texture (what the GPU would do when magnifying it)
function upscaleRgba(src, w, h, f) {
  const W = w * f, H = h * f, out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = (y + 0.5) / f - 0.5, y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(h - 1, y0 + 1), fy = Math.min(1, Math.max(0, sy - y0));
    for (let x = 0; x < W; x++) {
      const sx = (x + 0.5) / f - 0.5, x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(w - 1, x0 + 1), fx = Math.min(1, Math.max(0, sx - x0));
      const o = (y * W + x) * 4, a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = (src[a + k] * (1 - fx) + src[b + k] * fx) * (1 - fy) + (src[c + k] * (1 - fx) + src[d + k] * fx) * fy;
    }
  }
  return { width: W, height: H, rgba: out };
}

// walk all texels covered by the mesh's triangles in UV space; cb(x, y, localPos, normal)
// pad = how far (in texels) outside a triangle still counts (fills the seams of UV islands)
function rasterize(m, W, H, cb, pad = 0.75) {
  const { idx, verts } = m, P = verts.pos, Nn = verts.nrm, UV = verts.uv;
  const pos = [0, 0, 0], nrm = [0, 0, 0];
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    let u0 = UV[a * 2], v0 = UV[a * 2 + 1], u1 = UV[b * 2], v1 = UV[b * 2 + 1], u2 = UV[c * 2], v2 = UV[c * 2 + 1];
    if (![u0, v0, u1, v1, u2, v2].every(Number.isFinite)) continue;
    const ou = Math.floor(Math.min(u0, u1, u2)), ov = Math.floor(Math.min(v0, v1, v2)); // tiled UVs -> back into 0..1
    const x0 = (u0 - ou) * W, y0 = (v0 - ov) * H, x1 = (u1 - ou) * W, y1 = (v1 - ov) * H, x2 = (u2 - ou) * W, y2 = (v2 - ov) * H;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    const sgn = area > 0 ? 1 : -1;
    const l0 = Math.hypot(x2 - x1, y2 - y1), l1 = Math.hypot(x0 - x2, y0 - y2), l2 = Math.hypot(x1 - x0, y1 - y0);
    const minX = Math.floor(Math.min(x0, x1, x2) - pad), maxX = Math.ceil(Math.max(x0, x1, x2) + pad);
    const minY = Math.floor(Math.min(y0, y1, y2) - pad), maxY = Math.ceil(Math.max(y0, y1, y2) + pad);
    if (maxX - minX > W * 2 || maxY - minY > H * 2) continue;
    for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
      const cx = px + 0.5, cy = py + 0.5;
      const e0 = sgn * ((x2 - x1) * (cy - y1) - (y2 - y1) * (cx - x1));
      const e1 = sgn * ((x0 - x2) * (cy - y2) - (y0 - y2) * (cx - x2));
      const e2 = sgn * ((x1 - x0) * (cy - y0) - (y1 - y0) * (cx - x0));
      if (e0 / l0 < -pad || e1 / l1 < -pad || e2 / l2 < -pad) continue;
      let w0 = Math.max(0, e0), w1 = Math.max(0, e1), w2 = Math.max(0, e2);
      const ws = w0 + w1 + w2 || 1; w0 /= ws; w1 /= ws; w2 /= ws;
      for (let k = 0; k < 3; k++) { pos[k] = P[a * 3 + k] * w0 + P[b * 3 + k] * w1 + P[c * 3 + k] * w2; nrm[k] = Nn[a * 3 + k] * w0 + Nn[b * 3 + k] * w1 + Nn[c * 3 + k] * w2; }
      const tx = ((px % W) + W) % W, ty = ((py % H) + H) % H;
      cb(tx, ty, pos, nrm);
    }
  }
}
