// Hexcall Hub – other people's mods: drop in a .wotmod or an archive (.zip/.7z/.rar), the hub sorts the files into
// mods/<version>/ and res_mods/<version>/ of the current WoT version, remembers exactly which files belong to the mod
// and can switch it off, remove it or bring it over to a new WoT version. Files it overwrites are backed up first.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const ARCHIVE = /\.(zip|7z|rar)$/i;
const VER = /^\d+(\.\d+){3}$/;

module.exports = function createMods({ DATA, gameDir, gameVersion, gameRunning }) {
  const LIB = path.join(DATA, 'mods-library');
  const STATE = path.join(DATA, 'mods.json');
  fs.mkdirSync(LIB, { recursive: true });
  let mods = [];
  try { mods = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
  const save = () => fs.writeFileSync(STATE, JSON.stringify(mods, null, 2));
  const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tar = (args) => new Promise((ok, fail) => execFile('tar', args, { windowsHide: true, maxBuffer: 1 << 26, timeout: 10 * 60 * 1000 },
    (e, out, err) => (e ? fail(new Error(String(err || e.message).trim().split('\n')[0])) : ok(String(out)))));

  function walk(dir, base = dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue; // never follow links out of the archive
      if (e.isDirectory()) walk(f, base, out); else if (e.isFile()) out.push(path.relative(base, f).split(path.sep).join('/'));
    }
    return out;
  }
  // where a file from the archive belongs; "{v}" = the WoT version it gets installed for
  function target(rel) {
    const parts = rel.split('/');
    const i = parts.findIndex((p) => /^(res_)?mods$/i.test(p));
    if (i >= 0 && i < parts.length - 1) {
      const base = parts[i].toLowerCase(), rest = parts.slice(i + 1);
      if (VER.test(rest[0])) return rest.length > 1 ? `${base}/{v}/${rest.slice(1).join('/')}` : null;
      return rest.length > 1 ? `${base}/${rest.join('/')}` : null; // version-free folders such as mods/configs (no loose files)
    }
    if (/\.wotmod$/i.test(rel)) return `mods/{v}/${parts[parts.length - 1]}`;
    return null;
  }
  // name/version from a .wotmod's meta.xml (if it has one)
  async function wotmodMeta(file) {
    try {
      const xml = await tar(['-xOf', file, 'meta.xml']);
      const tag = (t) => { const m = new RegExp(`<${t}>\\s*([^<]{1,80}?)\\s*</${t}>`, 'i').exec(xml); return m ? m[1] : ''; };
      return { name: tag('name'), version: tag('version') };
    } catch { return {}; }
  }

  // file already in the library folder -> work out its files (archive: unpacked into <id>/files)
  async function analyze(id, file, original) {
    const dir = path.join(LIB, id), files = path.join(dir, 'files');
    const m = { id, name: original.replace(/\.(wotmod|zip|7z|rar)$/i, ''), source: original, addedAt: new Date().toISOString(), bytes: fs.statSync(file).size, entries: [], ignored: [], installed: null, enabled: true };
    if (/\.wotmod$/i.test(original)) {
      fs.mkdirSync(files, { recursive: true });
      fs.renameSync(file, path.join(files, original));
      m.entries.push({ from: original, to: `mods/{v}/${original}` });
      const meta = await wotmodMeta(path.join(files, original));
      if (meta.name) m.name = meta.name;
      if (meta.version) m.modVersion = meta.version;
    } else {
      fs.mkdirSync(files, { recursive: true });
      try { await tar(['-xf', file, '-C', files]); } catch (e) { throw new Error(`Archiv lässt sich nicht entpacken (${e.message})`); }
      fs.rmSync(file, { force: true });
      for (const rel of walk(files)) {
        const to = target(rel);
        if (to) m.entries.push({ from: rel, to }); else m.ignored.push(rel);
      }
      if (!m.entries.length) {
        const exe = m.ignored.find((f) => /\.exe$/i.test(f));
        throw new Error(exe ? `Darin steckt ein Installationsprogramm (${path.basename(exe)}) – das musst du selbst ausführen.`
          : 'Darin ist keine WoT-Mod: weder .wotmod-Dateien noch Ordner „mods“ oder „res_mods“.');
      }
      const single = m.entries.filter((e) => /\.wotmod$/i.test(e.to));
      if (single.length === 1 && m.entries.length === 1) {
        const meta = await wotmodMeta(path.join(files, single[0].from));
        if (meta.name) m.name = meta.name;
        if (meta.version) m.modVersion = meta.version;
      }
    }
    return m;
  }

  // which other hub mod owns this game file (for the conflict note)
  const owner = (rel, except) => mods.find((x) => x.id !== except && x.installed && x.installed.files.some((f) => f.toLowerCase() === rel.toLowerCase()));

  function inGame(g, rel) {
    const full = path.resolve(g, rel), low = full.toLowerCase();
    const ok = ['mods', 'res_mods'].some((b) => low.startsWith(path.resolve(g, b).toLowerCase() + path.sep));
    if (!ok) throw new Error(`Ungültiger Zielpfad: ${rel}`);
    return full;
  }
  async function needGameClosed() { if (await gameRunning()) throw new Error('WoT läuft – Mods lassen sich nur ändern, wenn das Spiel geschlossen ist.'); }

  async function install(m) {
    const g = gameDir(); if (!g) throw new Error('WoT nicht gefunden');
    const v = gameVersion(g); if (!v) throw new Error('WoT-Version unbekannt');
    await needGameClosed();
    if (m.installed) await uninstall(m);
    const files = [], backups = [], conflicts = new Set();
    for (const e of m.entries) {
      const rel = e.to.replace('{v}', v);
      const dst = inGame(g, rel);
      if (fs.existsSync(dst)) {
        const o = owner(rel, m.id);
        if (o) conflicts.add(o.name);
        else { // a file that was there before: keep it, it comes back when the mod is removed
          const b = path.join(LIB, m.id, 'backup', rel);
          fs.mkdirSync(path.dirname(b), { recursive: true });
          fs.copyFileSync(dst, b); backups.push(rel);
        }
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(LIB, m.id, 'files', e.from), dst);
      files.push(rel);
    }
    m.installed = { version: v, files, backups, at: new Date().toISOString() };
    m.enabled = true;
    save();
    return { conflicts: [...conflicts] };
  }
  async function uninstall(m) {
    const g = gameDir(); if (!g || !m.installed) return;
    await needGameClosed();
    const dirs = new Set();
    for (const rel of m.installed.files) {
      const dst = inGame(g, rel);
      fs.rmSync(dst, { force: true });
      dirs.add(path.dirname(dst));
    }
    for (const rel of m.installed.backups || []) {
      const b = path.join(LIB, m.id, 'backup', rel);
      if (fs.existsSync(b)) { fs.copyFileSync(b, inGame(g, rel)); }
    }
    fs.rmSync(path.join(LIB, m.id, 'backup'), { recursive: true, force: true });
    // tidy up folders the mod created (never mods/<version> or res_mods/<version> themselves)
    const keep = (d) => { const r = path.relative(g, d).split(path.sep); return r.length <= 1 || (r.length === 2 && VER.test(r[1])); };
    for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
      let cur = d;
      while (!keep(cur)) { try { if (fs.readdirSync(cur).length) break; fs.rmdirSync(cur); } catch { break; } cur = path.dirname(cur); }
    }
    m.installed = null;
    save();
  }

  const peekCache = {};
  const find = (id) => { const m = mods.find((x) => x.id === id); if (!m) throw new Error('Mod nicht gefunden'); return m; };

  return {
    list() {
      const g = gameDir(), cur = g && gameVersion(g);
      return { current: cur, mods: mods.map((m) => ({ id: m.id, name: m.name, modVersion: m.modVersion || '', source: m.source, addedAt: m.addedAt, bytes: m.bytes,
        files: m.entries.length, ignored: m.ignored.length, enabled: m.enabled, installedFor: m.installed ? m.installed.version : null,
        outdated: !!(m.installed && cur && m.installed.version !== cur),
        targets: [...new Set(m.entries.map((e) => e.to.split('/')[0]))], sample: m.entries.slice(0, 6).map((e) => e.to.replace('{v}', cur || '…')) })) };
    },
    // a new file: raw upload stream, or a file from the Downloads folder
    async addStream(name, req, max) {
      const safe = path.basename(String(name || '')).replace(/[^\w.\-()[\] ]/g, '_');
      if (!/\.wotmod$/i.test(safe) && !ARCHIVE.test(safe)) throw new Error('Bitte eine .wotmod-, .zip-, .7z- oder .rar-Datei.');
      const id = newId(), dir = path.join(LIB, id); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `upload-${safe}`);
      await new Promise((ok, fail) => {
        let n = 0; const out = fs.createWriteStream(file);
        req.on('data', (c) => { n += c.length; if (n > max) { req.destroy(); out.destroy(); fail(new Error('Datei zu groß')); } });
        req.pipe(out); out.on('finish', ok); out.on('error', fail); req.on('error', fail);
      });
      return this.addFile(id, file, safe);
    },
    async addPath(p) {
      const dl = path.join(os.homedir(), 'Downloads');
      const full = path.resolve(String(p || ''));
      if (!full.toLowerCase().startsWith(dl.toLowerCase() + path.sep) || !fs.existsSync(full)) throw new Error('Nur Dateien aus deinem Download-Ordner.');
      const id = newId(), dir = path.join(LIB, id); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `upload-${path.basename(full)}`);
      fs.copyFileSync(full, file);
      return this.addFile(id, file, path.basename(full));
    },
    async addFile(id, file, original) {
      let m;
      try { m = await analyze(id, file, original); } catch (e) { fs.rmSync(path.join(LIB, id), { recursive: true, force: true }); throw e; }
      mods.push(m); save();
      let res = { conflicts: [] }, note = '';
      try { res = await install(m); } catch (e) { note = e.message; }
      return { id, name: m.name, files: m.entries.length, installed: !!m.installed, note, conflicts: res.conflicts };
    },
    async enable(id, on) { const m = find(id); if (on) return install(m); await uninstall(m); m.enabled = false; save(); return { ok: true }; },
    async reinstall(id) { return install(find(id)); },
    async remove(id) {
      const m = find(id);
      if (m.installed) await uninstall(m);
      fs.rmSync(path.join(LIB, id), { recursive: true, force: true });
      mods = mods.filter((x) => x !== m); save();
      return { ok: true };
    },
    // mods in the Downloads folder (last 90 days); archives are only listed if they really contain a WoT mod
    async downloads() {
      const dl = path.join(os.homedir(), 'Downloads'), out = [];
      const since = Date.now() - 90 * 864e5;
      let names = [];
      try { names = fs.readdirSync(dl, { withFileTypes: true }).filter((e) => e.isFile() && (/\.wotmod$/i.test(e.name) || ARCHIVE.test(e.name))).map((e) => e.name); } catch {}
      for (const name of names) {
        const full = path.join(dl, name);
        let st; try { st = fs.statSync(full); } catch { continue; }
        if (st.mtimeMs < since) continue;
        if (ARCHIVE.test(name)) {
          const key = `${name}|${st.size}|${st.mtimeMs}`;
          if (!(key in peekCache)) {
            try { peekCache[key] = (await tar(['-tf', full])).split(/\r?\n/).some((rel) => rel && !rel.endsWith('/') && target(rel)); } catch { peekCache[key] = false; }
          }
          if (!peekCache[key]) continue;
        }
        out.push({ name, path: full, bytes: st.size, at: st.mtime.toISOString(), known: mods.some((m) => m.source === name) });
      }
      return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15);
    },
  };
};
