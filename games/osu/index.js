// osu! module: replay library (exported + local replays from the osu! folder), map info from osu!.db,
// and Hexrender: replays are sent to the Hexrender render server, the finished video comes back as a link.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFileSync } = require('child_process');
const { readOsr } = require('./server/osr');
const osudb = require('./server/osudb');

const LOCAL_HEXRENDER = 'http://127.0.0.1:24056';

module.exports = {
  id: 'osu',
  name: 'osu!',
  short: 'osu!',
  tagline: 'Replays, Hexrender (Replay → Video)',
  color: '#ff66aa',
  exe: ['osu!.exe'],
  tabs: [
    { id: 'home', label: 'Übersicht', icon: 'home' },
    { id: 'replays', label: 'Replays', icon: 'film', sep: true },
    { id: 'render', label: 'Hexrender', icon: 'video' },
    { id: 'admin', label: 'Admin', icon: 'server' },
  ],
  ui: { css: ['osu.css'], html: 'view.html', js: ['i18n-en.js', 'osu.js'] },

  create(ctx) {
    const DATA = ctx.dataDir('osu');
    const UPLOADS = path.join(DATA, 'uploads');
    const CACHE = path.join(DATA, 'replay-cache.json');
    fs.mkdirSync(UPLOADS, { recursive: true });
    const set = () => ctx.settings.game('osu');
    const version = (() => { try { return require(path.join(ctx.APP, 'version.json')).version; } catch { return '0'; } })();

    /* ------------------------------------------------------------ osu! installation */
    const isOsuDir = (d) => !!d && fs.existsSync(path.join(d, 'osu!.exe'));
    let dirCache = { at: 0, dir: null };
    function findOsu() {
      const cands = [set().dir, path.join(process.env.LOCALAPPDATA || '', 'osu!')];
      for (const key of ['HKCR\\osu\\shell\\open\\command', 'HKCR\\osu!\\shell\\open\\command', 'HKCR\\osustable.File.osr\\shell\\open\\command']) {
        try {
          const out = execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
          const m = /"([^"]+osu!\.exe)"/i.exec(out); if (m) cands.push(path.dirname(m[1]));
        } catch {}
      }
      for (let c = 67; c <= 90; c++) for (const b of ['Games\\osu!', 'osu!', 'Program Files\\osu!']) cands.push(`${String.fromCharCode(c)}:\\${b}`);
      return cands.find(isOsuDir) || null;
    }
    const osuDir = () => {
      if (Date.now() - dirCache.at > 30000) dirCache = { at: Date.now(), dir: findOsu() };
      return dirCache.dir;
    };
    function userCfg(dir) {
      const out = {};
      try {
        const f = fs.readdirSync(dir).find((n) => /^osu!\..+\.cfg$/i.test(n) && n.toLowerCase() !== 'osu!.cfg');
        if (!f) return out;
        for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)) {
          const m = /^\s*(BeatmapDirectory|LastVersion|Username|Skin)\s*=\s*(.*)$/.exec(line);
          if (m) out[m[1]] = m[2].trim();
        }
      } catch {}
      return out;
    }
    function db() {
      const d = osuDir();
      if (!d) return null;
      try { return osudb.load(path.join(d, 'osu!.db')); } catch (e) { return null; }
    }
    const songsDir = (d) => { const b = userCfg(d).BeatmapDirectory || 'Songs'; return path.isAbsolute(b) ? b : path.join(d, b); };

    /* ------------------------------------------------------------ replays */
    // id: "e:<file>" = Replays (exported), "l:<file>" = Data\r (local scores), "u:<file>" = dropped into Hexhub
    const SAFE = /^[^\\/:*?"<>|]+\.osr$/i;
    function replayFile(id) {
      const m = /^([elu]):(.+)$/.exec(String(id || ''));
      if (!m || !SAFE.test(m[2])) throw new Error('Ungültiges Replay');
      const d = osuDir();
      const base = m[1] === 'u' ? UPLOADS : m[1] === 'e' ? d && path.join(d, 'Replays') : d && path.join(d, 'Data', 'r');
      if (!base) throw new Error('osu! wurde nicht gefunden');
      const f = path.join(base, m[2]);
      if (!fs.existsSync(f)) throw new Error('Replay nicht gefunden');
      return f;
    }
    let cache = null;
    const loadCache = () => { if (!cache) { try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { cache = {}; } } return cache; };
    async function headerOf(full, st) {
      const c = loadCache(), k = full.toLowerCase();
      if (c[k] && c[k].m === st.mtimeMs) return c[k].h;
      const fh = await fsp.open(full, 'r');
      try {
        const buf = Buffer.alloc(Math.min(st.size, 4096));
        await fh.read(buf, 0, buf.length, 0);
        const h = readOsr(buf);
        delete h.dataLength;
        c[k] = { m: st.mtimeMs, h };
        return h;
      } finally { await fh.close(); }
    }
    async function pool(items, n, fn) {
      let i = 0;
      await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
    }
    function mapInfo(md5, maps) {
      const m = maps && maps.get(md5);
      if (!m) return null;
      return { artist: m.artist, title: m.title, version: m.version, creator: m.creator, stars: m.stars, length: m.length, setId: m.setId, beatmapId: m.beatmapId, status: m.status };
    }
    let scanning = null;
    async function listReplays() {
      if (scanning) return scanning;
      scanning = (async () => {
        const d = osuDir();
        const sources = [['u', UPLOADS]];
        if (d) sources.push(['e', path.join(d, 'Replays')], ['l', path.join(d, 'Data', 'r')]);
        const items = [];
        for (const [kind, dir] of sources) {
          let names = [];
          try { names = (await fsp.readdir(dir)).filter((n) => /\.osr$/i.test(n)); } catch {}
          for (const n of names) items.push({ kind, dir, name: n });
        }
        const data = db();
        const maps = data && data.maps;
        const out = [];
        let dirty = false;
        const before = Object.keys(loadCache()).length;
        await pool(items, 24, async (it) => {
          const full = path.join(it.dir, it.name);
          try {
            const st = await fsp.stat(full);
            const h = await headerOf(full, st);
            if (h.mode !== 0) return; // osu!standard only (Hexrender renders only standard)
            const map = mapInfo(h.md5, maps);
            let title = map ? `${map.artist} - ${map.title} [${map.version}]` : '';
            if (!title && it.kind !== 'l') { const m = /^.+? - (.+?) \(\d{4}-\d{2}-\d{2}\)/.exec(it.name); title = m ? m[1] : it.name.replace(/\.osr$/i, ''); }
            out.push({ id: `${it.kind}:${it.name}`, kind: it.kind, file: it.name, mtime: st.mtimeMs, size: st.size, title: title || 'Unbekannte Map', map, ...h });
          } catch {}
        });
        if (Object.keys(loadCache()).length !== before) dirty = true;
        if (dirty) fsp.writeFile(CACHE, JSON.stringify(cache)).catch(() => {});
        out.sort((a, b) => new Date(b.date) - new Date(a.date));
        return { replays: out, player: data ? data.player : null, maps: maps ? maps.size : 0, osuDir: d };
      })().finally(() => { scanning = null; });
      return scanning;
    }

    // background image of a beatmap (from the [Events] section of its .osu file)
    const bgCache = new Map();
    function bgFile(md5) {
      if (bgCache.has(md5)) return bgCache.get(md5);
      let f = null;
      try {
        const d = osuDir(), data = db(), m = data && data.maps.get(md5);
        if (m) {
          const folder = path.join(songsDir(d), m.folder);
          const text = fs.readFileSync(path.join(folder, m.osuFile), 'utf8');
          const ev = /\[Events\]([\s\S]*?)(\n\[|$)/.exec(text);
          const bg = ev && /^\s*0\s*,\s*0\s*,\s*"([^"]+)"/m.exec(ev[1]);
          if (bg) { const cand = path.join(folder, bg[1]); if (cand.startsWith(folder) && fs.existsSync(cand)) f = cand; }
        }
      } catch {}
      bgCache.set(md5, f);
      return f;
    }

    /* ------------------------------------------------------------ Hexrender (render server) */
    const fetchJson = async (url, opt = {}, timeout = 8000) => {
      const r = await fetch(url, { ...opt, headers: { 'User-Agent': `Hexhub/${version}`, ...(opt.headers || {}) }, signal: AbortSignal.timeout(timeout) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Render-Server antwortet mit ${r.status}`);
      return d;
    };
    let services = { at: 0, data: null };
    async function servicesJson() {
      if (services.data && Date.now() - services.at < 10 * 60000) return services.data;
      const v = require(path.join(ctx.APP, 'version.json'));
      if (!v.services) return {};
      try { services = { at: Date.now(), data: await fetchJson(v.services, {}, 6000) }; } catch { services = { at: Date.now() - 9 * 60000, data: services.data || {} }; }
      return services.data;
    }
    const cleanUrl = (u) => String(u || '').trim().replace(/\/+$/, '');
    let resolved = { at: 0, val: null };
    async function server(force) {
      if (!force && resolved.val && Date.now() - resolved.at < 30000) return resolved.val;
      const manual = cleanUrl(set().renderServer);
      let val = null;
      if (manual) val = { url: manual, source: 'manual' };
      else {
        try { await fetchJson(`${LOCAL_HEXRENDER}/api/hx/status`, {}, 800); val = { url: LOCAL_HEXRENDER, source: 'local' }; } catch {}
        if (!val) { const s = await servicesJson(); if (s && /^https:\/\//.test(s.hexrender || '')) val = { url: cleanUrl(s.hexrender), source: 'online' }; }
      }
      resolved = { at: Date.now(), val };
      return val;
    }
    async function serverStatus(force) {
      const sv = await server(force);
      if (!sv) return { url: null, online: false, operator: isHexrenderDir(set().hexrenderDir), error: 'Kein Render-Server bekannt. Trag in den Einstellungen eine Adresse ein.' };
      try {
        const st = await fetchJson(`${sv.url}/api/hx/status`, {}, 6000);
        return { ...sv, online: true, ...st, operator: isHexrenderDir(set().hexrenderDir) };
      } catch (e) { return { ...sv, online: false, operator: isHexrenderDir(set().hexrenderDir), error: e.message }; }
    }

    // Hexrender on this PC (only for the operator): folder with server.js + hexrender/site.js, started from the client
    const isHexrenderDir = (d) => !!d && fs.existsSync(path.join(d, "server.js")) && fs.existsSync(path.join(d, "hexrender", "site.js"));
    async function startHexrender() {
      const d = set().hexrenderDir;
      if (!isHexrenderDir(d)) throw new Error("Hexrender-Ordner ist nicht eingetragen (Einstellungen › osu!).");
      try { await fetchJson(`${LOCAL_HEXRENDER}/api/hx/status`, {}, 800); return { ok: true, already: true }; } catch {}
      const { spawn } = require("child_process");
      spawn(process.execPath, [path.join(d, "server.js")], { cwd: d, detached: true, stdio: "ignore", windowsHide: true }).unref();
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 250));
        try { await fetchJson(`${LOCAL_HEXRENDER}/api/hx/status`, {}, 500); resolved.at = 0; return { ok: true }; } catch {}
      }
      throw new Error("Hexrender startet nicht – Konsole im Hexrender-Ordner prüfen (start.bat).");
    }

    /* ------------------------------------------------------------ routes */
    const routes = {
      'GET /status': async () => {
        const d = osuDir(), cfg = d ? userCfg(d) : {}, data = db();
        return { osuDir: d, songsDir: d ? songsDir(d) : null, player: (data && data.player) || cfg.Username || null, version: cfg.LastVersion || null, skin: cfg.Skin || null, maps: data ? data.maps.size : 0 };
      },
      'GET /replays': async () => listReplays(),
      'GET /replay': async (q) => {
        const f = replayFile(q.get('id')); const buf = await fsp.readFile(f); const h = readOsr(buf); const data = db();
        return { id: q.get('id'), ...h, map: mapInfo(h.md5, data && data.maps) };
      },
      'POST /replay/watch': async ({ id }) => {
        const f = replayFile(id), d = osuDir();
        if (!d) throw new Error('osu! wurde nicht gefunden');
        ctx.watcher().launch(path.join(d, 'osu!.exe'), [f], d);
        return { ok: true };
      },
      'POST /replay/show': async ({ id }) => ctx.openPath(replayFile(id), true),
      'POST /replay/delete-upload': async ({ id }) => { if (!/^u:/.test(id)) throw new Error('Nur hochgeladene Replays'); fs.unlinkSync(replayFile(id)); return { ok: true }; },
      'POST /open': async ({ what }) => {
        const d = osuDir(); if (!d) throw new Error('osu! wurde nicht gefunden');
        return ctx.openPath(what === 'replays' ? path.join(d, 'Replays') : what === 'songs' ? songsDir(d) : d);
      },
      'GET /server': async (q) => serverStatus(q.get('force') === '1'),
      'POST /hexrender/start': async () => startHexrender(),
      'POST /open-url': async ({ url }) => ctx.openUrl(url),
      'GET /config': async () => ({ dir: set().dir || '', renderServer: set().renderServer || '', hexrenderDir: set().hexrenderDir || '', found: osuDir() }),
      'POST /config': async (b) => {
        const patch = {};
        if (b.dir !== undefined) { if (b.dir && !isOsuDir(b.dir)) throw new Error('In diesem Ordner gibt es keine osu!.exe.'); patch.dir = b.dir || ''; dirCache.at = 0; }
        if (b.renderServer !== undefined) {
          const u = cleanUrl(b.renderServer);
          if (u && !/^https?:\/\/[^\s/]+/i.test(u)) throw new Error('Ungültige Adresse (z. B. https://render.example.com)');
          patch.renderServer = u; resolved.at = 0;
        }
        if (b.hexrenderDir !== undefined) { if (b.hexrenderDir && !isHexrenderDir(b.hexrenderDir)) throw new Error('In diesem Ordner liegt kein Hexrender (server.js + hexrender/site.js).'); patch.hexrenderDir = b.hexrenderDir || ''; }
        ctx.settings.saveGame('osu', patch);
        return { ok: true };
      },
      'POST /pickhexrender': async () => {
        const dir = await ctx.pickFolder('Hexrender-Ordner wählen (enthält server.js)');
        if (!dir) return { dir: null };
        if (!isHexrenderDir(dir)) throw new Error('In diesem Ordner liegt kein Hexrender (server.js + hexrender/site.js).');
        ctx.settings.saveGame('osu', { hexrenderDir: dir });
        return { dir };
      },
      'POST /pickfolder': async () => {
        const dir = await ctx.pickFolder('osu!-Ordner wählen (enthält osu!.exe)');
        if (!dir) return { dir: null };
        if (!isOsuDir(dir)) throw new Error('In diesem Ordner gibt es keine osu!.exe.');
        ctx.settings.saveGame('osu', { dir }); dirCache.at = 0;
        return { dir };
      },
    };

    async function raw(req, res, url) {
      if (req.method === 'POST' && url.pathname === '/upload') {
        if (!req.headers.origin || !ctx.LOCAL_ORIGIN.test(req.headers.origin)) return ctx.send(res, 403, { error: 'forbidden' });
        const name = String(url.searchParams.get('name') || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(-120);
        if (!/\.osr$/i.test(name)) return ctx.send(res, 400, { error: 'Das ist keine .osr-Datei.' });
        const buf = await ctx.readBody(req, 20 * 1024 * 1024);
        let h;
        try { h = readOsr(buf); } catch { return ctx.send(res, 400, { error: 'Das ist keine gültige .osr-Datei.' }); }
        if (h.mode !== 0) return ctx.send(res, 400, { error: 'Nur osu!standard-Replays werden unterstützt.' });
        fs.writeFileSync(path.join(UPLOADS, name), buf);
        const data = db();
        return ctx.send(res, 200, { id: `u:${name}`, kind: 'u', file: name, ...h, map: mapInfo(h.md5, data && data.maps) });
      }
      if (req.method === 'GET' && url.pathname === '/replay-file') {
        const f = replayFile(url.searchParams.get('id'));
        return ctx.send(res, 200, fs.readFileSync(f), 'application/octet-stream');
      }
      if (req.method === 'GET' && url.pathname === '/bg') {
        const f = bgFile(String(url.searchParams.get('md5') || ''));
        if (!f) return ctx.send(res, 404, 'none', 'text/plain');
        const ext = path.extname(f).toLowerCase();
        return ctx.send(res, 200, fs.readFileSync(f), ext === '.png' ? 'image/png' : 'image/jpeg', { 'Cache-Control': 'max-age=86400' });
      }
      return false;
    }

    /* ------------------------------------------------------------ estimated total play time */
    const playerName = () => { const d = osuDir(); if (!d) return null; let p = userCfg(d).Username || null; try { const data = db(); if (data && data.player) p = data.player; } catch {} return p; };
    const profile = require('./server/profile')({
      DATA, player: playerName,
      clientMs: () => { const w = ctx.watcher().get('osu'); return (w.playtime && w.playtime.total) || 0; },
      running: () => !!ctx.watcher().get('osu').running,
    });

    return {
      routes, raw,
      async info() {
        const d = osuDir(), cfg = d ? userCfg(d) : {};
        let player = cfg.Username || null;
        try { const data = db(); if (data && data.player) player = data.player; } catch {}
        return { installed: !!d, dir: d, version: cfg.LastVersion || null, player, playtimeEst: profile.estimate() };
      },
      async launch() {
        const d = osuDir();
        if (!d) throw new Error('osu! wurde nicht gefunden. Bitte in den Einstellungen den Ordner wählen.');
        return ctx.watcher().launch(path.join(d, 'osu!.exe'), [], d);
      },
    };
  },
};
