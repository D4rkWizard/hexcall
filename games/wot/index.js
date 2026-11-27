// World of Tanks module: statistics/replays, hit analysis, replay → video, 3D garage (stickers, 3D parts),
// mod manager, mod folders and the Hexcall sound mod (embedded under /hexcall/).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HEXCALL = path.join(__dirname, 'hexcall');
const wgc = require('./server/wgc');

module.exports = {
  id: 'wot',
  name: 'World of Tanks',
  short: 'WoT',
  tagline: 'Sounds, 3D-Garage, Replays, Trefferanalyse',
  color: '#f2a33a',
  exe: ['WorldOfTanks.exe'],
  tabs: [
    { id: 'home', label: 'Übersicht', icon: 'home' },
    { id: 'sounds', label: 'Sounds (Hexcall)', icon: 'voice', sep: true },
    { id: 'garage', label: '3D-Garage', icon: 'tank' },
    { id: 'mods', label: 'Mods', icon: 'upload' },
    { id: 'folders', label: 'Mod-Ordner', icon: 'folder' },
    { id: 'stats', label: 'Statistik', icon: 'chart', sep: true },
    { id: 'replays', label: 'Replays', icon: 'film' },
    { id: 'hits', label: 'Trefferanalyse', icon: 'cross' },
    { id: 'video', label: 'Replay → Video', icon: 'video' },
  ],
  ui: { css: ['wot.css'], html: 'view.html', js: ['i18n-en.js', 'wot.js', 'import3d.js', 'garage.js', 'shotview.js', 'hits.js'] },

  create(ctx) {
    const DATA = ctx.dataDir('wot');
    migrateHub(DATA);
    if (fs.existsSync(path.join(ctx.APP, 'portable.txt')) && !process.env.HEXCALL_DATA) process.env.HEXCALL_DATA = path.join(ctx.DATA, 'hexcall');

    const gamePaths = require(path.join(HEXCALL, 'tools', 'paths.js'));
    const hexcall = require(path.join(HEXCALL, 'tools', 'server.js'));
    try { gamePaths.migrate(); } catch {}
    // Hexcall follows the client's language and theme
    const s0 = ctx.settings.read();
    try { hexcall.applyShared(s0); } catch {}

    let dirCache = { at: 0, dir: null };
    const gameDir = () => {
      if (Date.now() - dirCache.at > 30000) dirCache = { at: Date.now(), dir: gamePaths.gameDir() };
      return dirCache.dir;
    };
    const running = () => !!ctx.watcher().get('wot').running;
    const gameRunning = async () => { await ctx.watcher().tick(); return running(); };

    function gameVersion(dir) {
      try { const m = /v\.(\d+\.\d+\.\d+\.\d+)/.exec(fs.readFileSync(path.join(dir, 'version.xml'), 'utf8')); return m ? m[1] : null; } catch { return null; }
    }
    function dirSize(d, depth = 0) {
      let n = 0, files = 0;
      try {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name);
          if (e.isDirectory()) { if (depth < 8) { const s = dirSize(f, depth + 1); n += s.bytes; files += s.files; } } else { try { n += fs.statSync(f).size; files++; } catch {} }
        }
      } catch {}
      return { bytes: n, files };
    }
    const cmpVer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
    // only paths inside the game folder may be opened
    function insideGame(p) {
      const g = gameDir();
      if (!g || typeof p !== 'string') return null;
      const full = path.resolve(g, p);
      const base = path.resolve(g).toLowerCase();
      return full.toLowerCase().startsWith(base + path.sep) || full.toLowerCase() === base ? full : null;
    }
    const replayPath = (file) => {
      if (!/^[^\\/:*?"<>|]+\.wotreplay$/i.test(file || '')) throw new Error('Ungültige Datei');
      const p = insideGame(path.join('replays', file));
      if (!p || !fs.existsSync(p)) throw new Error('Replay nicht gefunden');
      return p;
    };

    const replays = require('./server/replays');
    const renderer = require('./server/render')({ DATA, gameDir, gameRunning });
    const mods = require('./server/mods')({ DATA, gameDir, gameVersion, gameRunning });
    // HEXHUB_WOT_MODS_DIR: test runs write the garage mods there instead of into the game folder
    const garage = require('./server/garage')({ DATA, gameDir, gameVersion, modsDir: process.env.HEXHUB_WOT_MODS_DIR ? (v) => path.join(process.env.HEXHUB_WOT_MODS_DIR, v) : null });
    const hits = require('./server/hits')({ DATA, gameDir, garage });
    const readRaw = (req, max) => ctx.readBody(req, max);
    const localPost = (req) => req.headers.origin && ctx.LOCAL_ORIGIN.test(req.headers.origin);

    const routes = {
      'GET /status': async () => {
        const g = gameDir();
        return { gameDir: g, version: g && gameVersion(g), running: running(), player: hexcall.wotPlayer() };
      },
      'GET /replays': async () => {
        const g = gameDir();
        if (!g) return { replays: [], dir: null };
        const dir = path.join(g, 'replays');
        return { replays: replays.scan(dir, path.join(DATA, 'replay-cache.json')), dir };
      },
      'GET /modfolders': async () => {
        const g = gameDir();
        if (!g) return { folders: [] };
        const cur = gameVersion(g);
        const folders = [];
        for (const base of ['res_mods', 'mods']) {
          let vers = [];
          try { vers = fs.readdirSync(path.join(g, base)).filter((v) => /^\d+(\.\d+){3}$/.test(v)).sort(cmpVer).reverse(); } catch {}
          for (const v of vers) {
            const s = dirSize(path.join(g, base, v));
            folders.push({ base, version: v, current: v === cur, bytes: s.bytes, files: s.files, hexcall: fs.existsSync(path.join(g, base, v, 'audioww', 'eigene_stimme.json')) });
          }
        }
        return { current: cur, folders };
      },
      'POST /open': async ({ rel, select }) => {
        const p = insideGame(rel);
        if (!p || !fs.existsSync(p)) throw new Error('Pfad nicht gefunden');
        return ctx.openPath(p, select);
      },
      'GET /hits': async (q) => hits.analyze(replayPath(q.get('file'))),
      // plays a replay in WoT (the game is registered for .wotreplay files)
      'POST /replay/play': async ({ file }) => {
        const p = replayPath(file);
        if (await gameRunning()) throw new Error('WoT läuft bereits – Replays lassen sich nur starten, wenn das Spiel geschlossen ist.');
        return startWot([p]);
      },
      // replay -> video
      'GET /render/status': async () => renderer.status(),
      'POST /render/monitors': async () => renderer.refreshMonitors(),
      'POST /render/settings': async (b) => renderer.setSettings(b),
      'POST /render/ffmpeg': async () => renderer.setupFfmpeg(),
      'POST /render/add': async ({ file }) => renderer.addFile(replayPath(file)),
      'POST /render/cancel': async ({ id }) => { renderer.cancel(String(id || '')); return { ok: true }; },
      'POST /render/clear': async () => { renderer.clear(); return { ok: true }; },
      'POST /render/open': async ({ id }) => {
        const out = id ? renderer.outPath(String(id)) : null;
        fs.mkdirSync(renderer.outDir(), { recursive: true });
        return out && fs.existsSync(out) ? ctx.openPath(out, true) : ctx.openPath(renderer.outDir());
      },
      // other people's mods
      'GET /mods': async () => mods.list(),
      'GET /mods/downloads': async () => mods.downloads(),
      'POST /mods/add': async (b) => mods.addPath(b.path),
      'POST /mods/enable': async ({ id, on }) => mods.enable(String(id), !!on),
      'POST /mods/reinstall': async ({ id }) => mods.reinstall(String(id)),
      'POST /mods/remove': async ({ id }) => mods.remove(String(id)),
      // 3D garage
      'GET /garage/tanks': async () => garage.tanks(),
      'GET /garage/tank': async (q) => garage.tank(q.get('id')),
      'GET /garage/stickers': async (q) => garage.stickers(String(q.get('tank'))),
      'POST /garage/stickers': async ({ tank, stickers }) => garage.saveStickers(String(tank), stickers),
      'POST /garage/sticker-image/remove': async ({ id }) => garage.removeImage(String(id)),
      'POST /garage/apply': async ({ tank }) => garage.apply(String(tank)),
      'GET /garage/edited': async () => garage.edited(),
      'POST /garage/clear': async ({ tank }) => garage.clearTank(String(tank)),
      'POST /garage/clear-all': async ({ confirm }) => { if (confirm !== true) throw new Error('Bestätigung fehlt'); return garage.clearAll(); },
      'GET /garage/placements': async (q) => garage.placements(String(q.get('tank'))),
      'POST /garage/placements': async ({ tank, list }) => garage.savePlacements(String(tank), list),
      'POST /garage/model/remove': async ({ id }) => garage.removeModel(String(id)),
      'POST /garage/apply-models': async ({ tank }) => garage.applyModels(String(tank)),
      // brush paint layers (Farbkasten)
      'GET /garage/paint': async (q) => garage.paintList(String(q.get('tank'))),
      'POST /garage/paint/clear': async ({ tank, tex }) => garage.clearPaint(String(tank), tex ? String(tex) : null),
      // game folder (shared with Hexcall)
      'GET /folders': async () => ({ current: gameDir(), found: gamePaths.findGames() }),
      'POST /pickfolder': async () => {
        const dir = await ctx.pickFolder('World of Tanks-Ordner wählen (enthält version.xml)');
        if (!dir) return { dir: null };
        if (!gamePaths.isGameDir(dir)) throw new Error('In diesem Ordner wurde kein World of Tanks gefunden (version.xml / res\\audioww fehlen).');
        setGameDir(dir);
        return { dir };
      },
      'POST /setfolder': async ({ dir }) => {
        if (dir && !gamePaths.isGameDir(dir)) throw new Error('In diesem Ordner wurde kein World of Tanks gefunden.');
        setGameDir(dir || null);
        return { dir: gameDir() };
      },
    };
    function setGameDir(dir) {
      // the game folder is stored in Hexcall's settings, so both parts use the same installation
      const file = path.join(gamePaths.USER, 'settings.json');
      let s = {};
      try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      s.gameDir = dir;
      fs.mkdirSync(gamePaths.USER, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(s, null, 2));
      dirCache.at = 0;
    }

    // WoT only signs in while the Wargaming Game Center runs: start it first if needed (in the background)
    async function startWot(args) {
      const g = gameDir(), exe = path.join(g, 'WorldOfTanks.exe');
      if (await wgc.isRunning() || !wgc.findWgc()) return ctx.watcher().launch(exe, args, g);
      wgc.launchWithLauncher(() => ctx.watcher().launch(exe, args, g));
      return { ok: true, launcher: true, note: 'Wargaming Game Center wird gestartet – World of Tanks startet danach automatisch.' };
    }

    // binary and large uploads
    async function raw(req, res, url) {
      const p = url.pathname, q = url.searchParams;
      if (req.method === 'POST' && p === '/render/upload') {
        if (req.headers.origin && !ctx.LOCAL_ORIGIN.test(req.headers.origin)) return ctx.send(res, 403, { error: 'forbidden' });
        return ctx.send(res, 200, renderer.addUpload(q.get('name'), await readRaw(req, 64 * 1024 * 1024)));
      }
      if (req.method === 'POST' && p === '/mods/upload') {
        if (!localPost(req)) return ctx.send(res, 403, { error: 'forbidden' });
        return ctx.send(res, 200, await mods.addStream(q.get('name'), req, 4 * 1024 ** 3));
      }
      if (req.method === 'GET' && p === '/garage/mesh') return ctx.send(res, 200, garage.mesh(q.get('id'), q.get('i')), 'application/octet-stream');
      if (req.method === 'GET' && p === '/garage/tex') {
        const tank = q.get('tank');
        return ctx.send(res, 200, garage.texture(q.get('p'), tank), 'image/png', { 'Cache-Control': tank ? 'no-store' : 'max-age=86400' });
      }
      if (req.method === 'GET' && p === '/garage/sticker-image') return ctx.send(res, 200, garage.image(q.get('id')), 'image/png', { 'Cache-Control': 'max-age=86400' });
      if (req.method === 'GET' && p === '/garage/paint-image') return ctx.send(res, 200, garage.paintImage(String(q.get('tank')), String(q.get('tex'))), 'image/png');
      if (req.method === 'POST' && p === '/garage/paint-image') {
        if (!localPost(req)) return ctx.send(res, 403, { error: 'forbidden' });
        return ctx.send(res, 200, garage.savePaint(String(q.get('tank')), String(q.get('tex')), await readRaw(req, 64 * 1024 * 1024)));
      }
      if (req.method === 'GET' && p === '/garage/model-bin') return ctx.send(res, 200, garage.modelBin(q.get('id')), 'application/octet-stream');
      if (req.method === 'GET' && p === '/garage/model-tex') return ctx.send(res, 200, garage.modelTex(q.get('id'), q.get('g')), 'image/png', { 'Cache-Control': 'max-age=86400' });
      if (req.method === 'POST' && p === '/garage/model') {
        if (!localPost(req)) return ctx.send(res, 403, { error: 'forbidden' });
        return ctx.send(res, 200, garage.addModel(q.get('name'), await readRaw(req, 96 * 1024 * 1024)));
      }
      if (req.method === 'POST' && p === '/garage/sticker-image') {
        if (!localPost(req)) return ctx.send(res, 403, { error: 'forbidden' });
        return ctx.send(res, 200, garage.addImage(q.get('name'), await readRaw(req, 16 * 1024 * 1024)));
      }
      return false;
    }

    // Hexcall (sound mod) under /hexcall/
    const mount = {
      prefix: '/hexcall',
      handle: async (req, res, url) => {
        if (url.pathname === '/hexcall') { res.writeHead(302, { Location: '/hexcall/' }); res.end(); return true; }
        const sub = new URL(url.href); sub.pathname = url.pathname.slice('/hexcall'.length) || '/';
        await hexcall.handle(req, res, sub);
        return true;
      },
    };

    return {
      routes, raw, mount,
      onSettings: (s, patch) => { if ('lang' in patch || 'theme' in patch || 'animations' in patch) hexcall.applyShared(s); },
      async info() {
        const g = gameDir();
        return { installed: !!g, dir: g, version: g ? gameVersion(g) : null, player: hexcall.wotPlayer(), hexcall: gamePaths.versionInfo().version };
      },
      async launch() {
        const g = gameDir();
        const exe = g && path.join(g, 'WorldOfTanks.exe');
        if (!exe || !fs.existsSync(exe)) throw new Error('World of Tanks wurde nicht gefunden. Bitte in den Einstellungen den Spielordner wählen.');
        return startWot([]);
      },
    };
  },
};

// one-time copy of the data of the old "Hexcall Hub" prototype (%APPDATA%\HexcallHub); caches are rebuilt
function migrateHub(DATA) {
  const old = path.join(process.env.APPDATA || '', 'HexcallHub');
  const flag = path.join(DATA, '.migrated');
  if (fs.existsSync(flag) || !fs.existsSync(old)) return;
  try {
    for (const e of fs.readdirSync(old)) {
      if (['garage-cache', 'hits-cache', 'render-inbox', 'ideen.json'].includes(e) || /^render-(diag|frames)/.test(e)) continue;
      const to = path.join(DATA, e);
      if (!fs.existsSync(to)) fs.cpSync(path.join(old, e), to, { recursive: true });
    }
  } catch (e) { console.error('Übernahme aus HexcallHub:', e.message); }
  try { fs.writeFileSync(flag, new Date().toISOString()); } catch {}
}
