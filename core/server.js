// Hexhub – local backend (127.0.0.1:47810).
// Loads the game modules (games/<id>/index.js), watches which games are running and serves the UI.
//   /api/core/...      client: games, settings, updates, ideas
//   /api/<game>/...    routes of a game module
//   /games/<game>/...  UI files of a game module (games/<game>/ui)
//   /                  shell UI (ui/)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const paths = require('./paths');
const settings = require('./settings');
const updater = require('./updater');
const { createWatcher } = require('./procs');

const { APP, DATA } = paths;
const UI = path.join(APP, 'ui');
const PORT = Number(process.env.HEXHUB_PORT || 47810);
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.woff2': 'font/woff2',
};

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  if (res.headersSent) return;
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((ok, fail) => {
    const parts = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { fail(new Error('Datei zu groß')); req.destroy(); } else parts.push(c); });
    req.on('end', () => ok(Buffer.concat(parts)));
    req.on('error', fail);
  });
}
function serveStatic(res, base, rel) {
  const f = path.normalize(path.join(base, rel));
  if (!f.startsWith(base + path.sep) && f !== base) return send(res, 403, 'forbidden', 'text/plain');
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
  return send(res, 200, fs.readFileSync(f), MIME[path.extname(f).toLowerCase()] || 'application/octet-stream');
}
// opens a web address in the default browser (only http/https)
function openUrl(u) {
  let url;
  try { url = new URL(String(u)); } catch { throw new Error('Ungültige Adresse'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Ungültige Adresse');
  spawn('rundll32', ['url.dll,FileProtocolHandler', url.href], { detached: true, stdio: 'ignore' }).unref();
  return { ok: true };
}
function openPath(p, select) {
  if (!p || !fs.existsSync(p)) throw new Error('Pfad nicht gefunden');
  spawn('explorer.exe', select ? [`/select,${p}`] : [p], { detached: true, stdio: 'ignore' }).unref();
  return { ok: true };
}
// native folder picker (small STA PowerShell dialog on the local machine)
function pickFolder(title) {
  return new Promise((resolve) => {
    const t = String(title || 'Ordner wählen').replace(/'/g, "''");
    const ps = "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
      `$d.Description = '${t}'; $d.ShowNewFolderButton = $false; ` +
      '$f = New-Object System.Windows.Forms.Form; $f.TopMost = $true; ' +
      "if ($d.ShowDialog($f) -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $d.SelectedPath }";
    execFile('powershell', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true, encoding: 'utf8' }, (err, out) => resolve(err ? null : (out || '').trim() || null));
  });
}

// ---------------------------------------------------------------- game modules
const ctx = {
  APP, DATA, settings, send, readBody, serveStatic, openUrl, openPath, pickFolder, LOCAL_ORIGIN,
  dataDir: (id) => { const d = path.join(DATA, id); fs.mkdirSync(d, { recursive: true }); return d; },
};
const GAME_IDS = ['wot', 'osu'];
const games = [];
const watcher = createWatcher(games); // reads the list on every tick, so modules can use it while loading
for (const id of GAME_IDS) {
  try {
    const def = require(path.join(APP, 'games', id));
    const inst = def.create({ ...ctx, game: def, watcher: () => watcher });
    games.push({ ...def, ...inst, def });
  } catch (e) { console.error(`Spiel-Modul ${id} konnte nicht geladen werden:`, e); }
}
const byId = Object.fromEntries(games.map((g) => [g.id, g]));
watcher.start();

// settings shared with modules (e.g. language/theme for the embedded Hexcall)
settings.onChange((s, patch) => { for (const g of games) if (g.onSettings) try { g.onSettings(s, patch); } catch {} });

async function gameInfo(g, deep) {
  let info = {};
  try { info = (await g.info(deep)) || {}; } catch (e) { info = { error: e.message }; }
  return {
    id: g.id, name: g.name, short: g.short, tagline: g.tagline, color: g.color, tabs: g.tabs, ui: g.ui,
    ...info, ...watcher.get(g.id),
  };
}

const IDEAS = path.join(DATA, 'ideas.json');
const coreRoutes = {
  'GET /info': async () => {
    const v = paths.versionInfo();
    return { name: v.name, version: v.version, repo: v.repo, data: DATA, first: !!settings.read().first, games: games.map((g) => g.id) };
  },
  'GET /games': async (q) => Promise.all(games.map((g) => gameInfo(g, q.get('deep') === '1'))),
  'GET /game': async (q) => { const g = byId[q.get('id')]; if (!g) throw new Error('Unbekanntes Spiel'); return gameInfo(g, true); },
  'POST /game/launch': async (b) => {
    const g = byId[b.id]; if (!g) throw new Error('Unbekanntes Spiel');
    await watcher.tick();
    if (watcher.get(g.id).running) return { ok: true, already: true };
    const r = await g.launch(b);
    setTimeout(() => watcher.tick().catch(() => {}), 1500);
    return r || { ok: true };
  },
  'POST /game/close': async (b) => {
    const g = byId[b.id]; if (!g) throw new Error('Unbekanntes Spiel');
    return watcher.close(g);
  },
  'POST /game/folder': async (b) => {
    const g = byId[b.id]; if (!g) throw new Error('Unbekanntes Spiel');
    const info = await g.info(false);
    return openPath(info.dir);
  },
  'GET /settings': async () => settings.read(),
  'POST /settings': async (b) => settings.save(b || {}),
  'POST /open-url': async (b) => openUrl(b.url),
  'GET /update': async (q) => updater.check(q.get('force') === '1'),
  'POST /update/install': async () => updater.install(),
  'GET /ideas': async () => paths.readJson(IDEAS, []),
  'POST /ideas': async (list) => {
    if (!Array.isArray(list)) throw new Error('Ungültig');
    const clean = list.slice(0, 500).map((x) => ({ id: String(x.id || Date.now()), game: String(x.game || ''), text: String(x.text || '').slice(0, 500), done: !!x.done, at: x.at || new Date().toISOString() })).filter((x) => x.text.trim());
    paths.writeJson(IDEAS, clean);
    return clean;
  },
};
// ideas of the old Hexcall Hub prototype come along once
if (!fs.existsSync(IDEAS)) {
  const old = paths.readJson(path.join(process.env.APPDATA || '', 'HexcallHub', 'ideen.json'), null);
  if (Array.isArray(old)) paths.writeJson(IDEAS, old.map((x) => ({ ...x, game: 'wot' })));
}

async function runRoute(table, key, req, url) {
  const fn = table[key];
  if (!fn) return false;
  let arg = url.searchParams;
  if (req.method === 'POST') {
    const raw = (await readBody(req)).toString('utf8');
    try { arg = raw ? JSON.parse(raw) : {}; } catch { throw new Error('Ungültige Anfrage'); }
  }
  return { result: await fn(arg, req, url) };
}

http.createServer(async (req, res) => {
  // only answer requests addressed to us (blocks DNS rebinding from other sites)
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) return send(res, 403, { error: 'forbidden' });
  if (req.method === 'POST' && req.headers.origin && !LOCAL_ORIGIN.test(req.headers.origin)) return send(res, 403, { error: 'forbidden' });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (p.startsWith('/api/core/')) {
      const r = await runRoute(coreRoutes, `${req.method} ${p.slice(9)}`, req, url);
      return r ? send(res, 200, r.result) : send(res, 404, { error: 'not found' });
    }
    const m = /^\/api\/([a-z0-9]+)(\/.*)$/.exec(p);
    if (m && byId[m[1]]) {
      const g = byId[m[1]];
      const sub = new URL(url.href); sub.pathname = m[2];
      if (g.raw && (await g.raw(req, res, sub)) !== false) return; // binary / streamed routes
      const r = await runRoute(g.routes || {}, `${req.method} ${m[2]}`, req, sub);
      return r ? send(res, 200, r.result) : send(res, 404, { error: 'not found' });
    }
    // extra mounts of a module (e.g. /hexcall/ = embedded sound mod)
    for (const g of games) if (g.mount && p.startsWith(g.mount.prefix)) {
      if ((await g.mount.handle(req, res, url)) !== false) return;
    }
    if (req.method !== 'GET') return send(res, 404, { error: 'not found' });
    const gm = /^\/games\/([a-z0-9]+)\/(.+)$/.exec(p);
    if (gm && byId[gm[1]]) return serveStatic(res, path.join(APP, 'games', gm[1], 'ui'), decodeURIComponent(gm[2]));
    return serveStatic(res, UI, p === '/' ? 'index.html' : decodeURIComponent(p.slice(1)));
  } catch (e) {
    return send(res, 400, { error: e.message || String(e) });
  }
}).on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.log('Hexhub läuft bereits'); process.exit(0); }
  throw e;
}).listen(PORT, '127.0.0.1', () => console.log(`Hexhub: http://127.0.0.1:${PORT}`));
