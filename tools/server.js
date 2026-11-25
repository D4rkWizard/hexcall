// Local backend for the Hexcall client (ui/). Listens on 127.0.0.1 only.
// Its lifetime is managed by tools/start.ps1 (runs while the client window is open).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const EVENTS = require('./events');
const SFX = require('./sfx');
const paths = require('./paths');
const updater = require('./updater');

paths.migrate();
const ROOT = paths.APP;
const UI = path.join(ROOT, 'ui');
const MODS = paths.MODS;
const BUILD = path.join(__dirname, 'build.js');
const PORT = Number(process.env.SOUND_COMMANDER_PORT || 47811);
let GAME = paths.gameDir();

const KEYS = { stimme: EVENTS.map((e) => e[0]), effekte: SFX.map((c) => c[0]) };
// Step texts per language: German in events.js/sfx.js, the others in events_en.js / events_i18n.js
const LANGS = ['en', 'de', 'ru', 'pl', 'fr', 'es'];
const STEP_TR = { en: require('./events_en'), ...require('./events_i18n') };
const trOf = (kind, key) => {
  const out = {};
  for (const [l, d] of Object.entries(STEP_TR)) {
    const t = kind === 'stimme' ? d.voice && d.voice[key] : d.effects && d.effects[key];
    if (t) out[l] = kind === 'stimme' ? { title: t[0], text: t[1] } : { title: t[0], text: t[1], hint: t[2] };
  }
  return out;
};
const STEPS = [
  ...EVENTS.map((e) => ({ kind: 'stimme', key: e[0], title: e[1], text: e[2], tr: trOf('stimme', e[0]) })),
  ...SFX.map((c) => ({ kind: 'effekte', key: c[0], title: c[1], text: c[2], hint: c[3], tr: trOf('effekte', c[0]) })),
];
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.ico': 'image/x-icon' };

const safeName = (n) => typeof n === 'string' && n.trim() && !/[\\/:*?"<>|]/.test(n) && !['original', 'testton', '.', '..'].includes(n.trim().toLowerCase());
const safeFile = (n) => typeof n === 'string' && /^[\w.-]+\.wav$/i.test(n);
const kindOk = (k) => k === 'stimme' || k === 'effekte';

function runBuild(args) {
  GAME = paths.gameDir();
  if (!GAME) return Promise.resolve({ ok: false, output: 'World of Tanks wurde nicht gefunden. Bitte unter Einstellungen den WoT-Ordner wählen.' });
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [BUILD, '--game', GAME, ...args], { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ ok: code === 0, output: out.trim() }));
  });
}

function filesOf(mod, kind) {
  const dir = path.join(MODS, mod, kind);
  const res = {};
  if (!fs.existsSync(dir)) return res;
  const keys = [...KEYS[kind]].sort((a, b) => b.length - a.length);
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/\.wav$/i.test(f)) continue;
    const base = f.replace(/\.wav$/i, '').toLowerCase();
    const k = keys.find((n) => base === n || new RegExp(`^${n}_\\d+$`).test(base));
    if (k) (res[k] = res[k] || []).push(f);
  }
  return res;
}

function listMods() {
  if (!fs.existsSync(MODS)) return [];
  return fs.readdirSync(MODS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const st = filesOf(d.name, 'stimme'), fx = filesOf(d.name, 'effekte');
    const mtime = fs.statSync(path.join(MODS, d.name)).mtimeMs;
    return { name: d.name, stimme: Object.keys(st).length, effekte: Object.keys(fx).length,
      dateien: Object.values(st).flat().length + Object.values(fx).flat().length, mtime };
  }).sort((a, b) => b.mtime - a.mtime);
}

function gameRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq WorldOfTanks.exe', '/NH'], { windowsHide: true },
      (err, out) => resolve(!err && /WorldOfTanks\.exe/i.test(out)));
  });
}

// Last logged-in WoT player name. Reads only <loginInfo>…<user>NAME</user> – nothing else from the file.
function wotPlayer() {
  try {
    const xml = fs.readFileSync(path.join(process.env.APPDATA || '', 'Wargaming.net', 'WorldOfTanks', 'preferences.xml'), 'utf8');
    const block = /<loginInfo>([\s\S]*?)<\/loginInfo>/.exec(xml);
    const user = block && /<user>\s*([^<]{1,40}?)\s*<\/user>/.exec(block[1]);
    return user ? user[1].replace(/[^\w.-]/g, '') : null;
  } catch { return null; }
}

function readBody(req, limit = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('zu groß')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

let lastPing = Date.now();
setInterval(() => { if (Date.now() - lastPing > 12 * 3600 * 1000) process.exit(0); }, 60000);

const routes = {
  'GET /api/info': async () => {
    const r = await runBuild(['--liste']);
    let info = { version: null, aktiv: { standard: 'original', national: 'original', effekte: 'original' } };
    try { info = JSON.parse(r.output); } catch {}
    const laeuft = await gameRunning();
    return { version: info.version, aktiv: info.aktiv, mods: listMods(), wotLaeuft: laeuft, wotSpieler: laeuft ? wotPlayer() : null,
      letzter: readLastState(), wotUpdate: wotUpdated(info), app: paths.versionInfo().version, gameDir: GAME, gameFound: !!GAME, dataDir: paths.DATA,
      counts: { stimme: KEYS.stimme.length, effekte: KEYS.effekte.length } };
  },
  'GET /api/steps': async () => STEPS,
  'GET /api/mod': async (q) => {
    if (!safeName(q.get('name'))) throw new Error('Ungültiger Name');
    const n = q.get('name');
    return { name: n, stimme: filesOf(n, 'stimme'), effekte: filesOf(n, 'effekte') };
  },
  'POST /api/mod': async (q, body) => {
    const { name } = JSON.parse(body || '{}');
    if (!safeName(name)) throw new Error('Ungültiger Name. Bitte keine Zeichen wie \\ / : * ? " < > |');
    for (const k of ['stimme', 'effekte']) fs.mkdirSync(path.join(MODS, name.trim(), k), { recursive: true });
    return { name: name.trim() };
  },
  'POST /api/rename': async (q, body) => {
    const { from, to } = JSON.parse(body || '{}');
    if (!safeName(from) || !safeName(to)) throw new Error('Ungültiger Name');
    if (fs.existsSync(path.join(MODS, to.trim()))) throw new Error('Den Namen gibt es schon');
    fs.renameSync(path.join(MODS, from), path.join(MODS, to.trim()));
    return { name: to.trim() };
  },
  'POST /api/take': async (q, body) => {
    const mod = q.get('mod'), kind = q.get('kind'), key = q.get('key'), variant = q.get('variant') === '1';
    if (!safeName(mod) || !kindOk(kind) || !KEYS[kind].includes(key)) throw new Error('Ungültige Anfrage');
    if (body.toString('latin1', 0, 4) !== 'RIFF' || body.toString('latin1', 8, 12) !== 'WAVE') throw new Error('Keine WAV-Daten');
    const dir = path.join(MODS, mod, kind);
    fs.mkdirSync(dir, { recursive: true });
    let file = `${key}.wav`;
    if (variant && fs.existsSync(path.join(dir, file))) {
      let i = 2;
      while (fs.existsSync(path.join(dir, `${key}_${i}.wav`))) i++;
      file = `${key}_${i}.wav`;
    }
    fs.writeFileSync(path.join(dir, file), body);
    return { file };
  },
  'POST /api/take/delete': async (q, body) => {
    const { mod, kind, file } = JSON.parse(body || '{}');
    if (!safeName(mod) || !kindOk(kind) || !safeFile(file)) throw new Error('Ungültige Anfrage');
    const f = path.join(MODS, mod, kind, file);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    return { ok: true };
  },
  'POST /api/apply': async (q, body) => {
    const a = JSON.parse(body || '{}');
    const args = [];
    if (a.deinstallieren) {
      // remember what was active, so "Mod aus" can be undone with "Wieder einschalten"
      const st = await currentState();
      if (st && Object.values(st).some((v) => v !== 'original')) {
        fs.mkdirSync(USER, { recursive: true });
        fs.writeFileSync(LAST_STATE, JSON.stringify(st, null, 2));
      }
      args.push('--deinstallieren');
    }
    for (const s of ['standard', 'national', 'effekte']) if (a[s]) args.push(`--${s}`, a[s]);
    // a new active setup replaces the remembered one
    if (!a.deinstallieren && ['standard', 'national', 'effekte'].some((s) => a[s] && a[s] !== 'original')) { try { fs.unlinkSync(LAST_STATE); } catch {} }
    if (a.luecken === 'stumm') args.push('--luecken', 'stumm');
    if (!args.length) throw new Error('Nichts ausgewählt');
    return rememberBuild(await runBuild(args));
  },
  'POST /api/restore': async () => {
    const last = readLastState();
    if (!last) throw new Error('Es gibt keinen gespeicherten Zustand zum Wiedereinschalten.');
    const args = [];
    for (const s of ['standard', 'national', 'effekte']) if (last[s]) args.push(`--${s}`, last[s]);
    const r = await rememberBuild(await runBuild(args));
    if (r.ok) { try { fs.unlinkSync(LAST_STATE); } catch {} }
    return r;
  },
  // after a WoT update: build the sounds that were active before again for the new game version
  'POST /api/reapply': async () => {
    const lb = readLastBuild();
    if (!lb || !lb.aktiv) throw new Error('Es gibt keinen gespeicherten Zustand zum Wiedereinschalten.');
    const args = [];
    for (const s of ['standard', 'national', 'effekte']) {
      const v = lb.aktiv[s];
      if (v && (v === 'testton' || v === 'original' || (safeName(v) && fs.existsSync(path.join(MODS, v))))) args.push(`--${s}`, v);
    }
    if (!args.length) throw new Error('Nichts ausgewählt');
    return rememberBuild(await runBuild(args));
  },
  'POST /api/open': async (q, body) => {
    const { mod } = JSON.parse(body || '{}');
    const dir = mod && safeName(mod) ? path.join(MODS, mod) : MODS;
    fs.mkdirSync(dir, { recursive: true });
    spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  },
  'POST /api/ping': async () => { lastPing = Date.now(); return { ok: true }; },
  // Start WoT from the client; "restart" closes the running game first (new sound banks load on game start)
  'POST /api/game/start': async (q, body) => {
    const { restart } = JSON.parse(body || '{}');
    GAME = paths.gameDir();
    const exe = GAME && path.join(GAME, 'WorldOfTanks.exe');
    if (!exe || !fs.existsSync(exe)) throw new Error('World of Tanks konnte nicht gestartet werden (WorldOfTanks.exe fehlt).');
    if (restart && await gameRunning()) {
      execFile('taskkill', ['/IM', 'WorldOfTanks.exe'], { windowsHide: true }, () => {}); // ask nicely first
      for (let i = 0; i < 20 && await gameRunning(); i++) await new Promise((r) => setTimeout(r, 500));
      if (await gameRunning()) await new Promise((r) => execFile('taskkill', ['/F', '/IM', 'WorldOfTanks.exe'], { windowsHide: true }, () => r()));
      await new Promise((r) => setTimeout(r, 1500));
    } else if (await gameRunning()) return { ok: true, already: true };
    spawn(exe, [], { cwd: GAME, detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  },
  'GET /api/games': async () => ({ current: paths.gameDir(), found: paths.findGames() }),
  'POST /api/pickfolder': async () => {
    const dir = await pickFolder();
    if (!dir) return { dir: null };
    return { dir, valid: paths.isGameDir(dir) };
  },
  'GET /api/update': async (q) => updater.check(q.get('force') === '1'),
  'POST /api/update/install': async () => updater.install(),
  'GET /api/settings': async () => readSettings(),
  'POST /api/settings': async (q, body) => {
    const patch = JSON.parse(body || '{}');
    const s = { ...readSettings(), ...patch };
    if (patch.gameDir !== undefined && patch.gameDir !== null && !paths.isGameDir(patch.gameDir)) {
      throw new Error('In diesem Ordner wurde kein World of Tanks gefunden (version.xml / res\\audioww fehlen).');
    }
    const clean = { theme: ['wizard', 'dark', 'light'].includes(s.theme) ? s.theme : DEFAULT_SETTINGS.theme, animations: s.animations !== false,
      gameDir: s.gameDir || null, lang: LANGS.includes(s.lang) ? s.lang : DEFAULT_SETTINGS.lang, autoUpdate: s.autoUpdate === true };
    fs.mkdirSync(USER, { recursive: true });
    fs.writeFileSync(path.join(USER, 'settings.json'), JSON.stringify(clean, null, 2));
    return clean;
  },
};

const USER = paths.USER;
const DEFAULT_SETTINGS = { theme: 'wizard', animations: true, gameDir: null, lang: 'en', autoUpdate: false }; // English on first start
const LAST_STATE = path.join(USER, 'letzter_zustand.json');
async function currentState() {
  const r = await runBuild(['--status']);
  try { return JSON.parse(r.output); } catch { return null; }
}
// Last active state before "Mod aus"; only returned while it still makes sense (mods still exist).
function readLastState() {
  try {
    const s = JSON.parse(fs.readFileSync(LAST_STATE, 'utf8'));
    const clean = {};
    for (const k of ['standard', 'national', 'effekte']) {
      const v = s[k];
      if (v === 'testton' || v === 'original' || (safeName(v) && fs.existsSync(path.join(MODS, v)))) clean[k] = v;
    }
    return Object.values(clean).some((v) => v !== 'original') ? clean : null;
  } catch { return null; }
}
function readSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(USER, 'settings.json'), 'utf8')); } catch {}
  return { theme: ['wizard', 'dark', 'light'].includes(s.theme) ? s.theme : DEFAULT_SETTINGS.theme, animations: s.animations !== false,
    gameDir: s.gameDir || null, lang: LANGS.includes(s.lang) ? s.lang : DEFAULT_SETTINGS.lang, autoUpdate: s.autoUpdate === true };
}

// Which game version the sounds were last built for. The active state lives in res_mods\<version>,
// so after a WoT update the mod is silently gone – the client warns and offers to re-apply.
const LAST_BUILD = path.join(USER, 'letzter_build.json');
function readLastBuild() {
  try { return JSON.parse(fs.readFileSync(LAST_BUILD, 'utf8')); } catch {}
  // no record yet (older Hexcall): look at the state files build.js left in res_mods\<old version>
  try {
    const rm = path.join(GAME, 'res_mods');
    const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
    const vers = fs.readdirSync(rm).filter((v) => /^\d+(\.\d+){3}$/.test(v)).sort(cmp).reverse();
    for (const v of vers.slice(1, 2)) { // only the version right before the newest (= current) one
      const f = path.join(rm, v, 'audioww', 'eigene_stimme.json');
      if (fs.existsSync(f)) return { version: v, aktiv: { standard: 'original', national: 'original', effekte: 'original', ...JSON.parse(fs.readFileSync(f, 'utf8')) } };
    }
  } catch {}
  return null;
}
async function rememberBuild(r) {
  if (!r.ok) return r;
  try {
    const info = JSON.parse((await runBuild(['--liste'])).output);
    fs.mkdirSync(USER, { recursive: true });
    fs.writeFileSync(LAST_BUILD, JSON.stringify({ version: info.version, aktiv: info.aktiv }, null, 2));
  } catch {}
  return r;
}
function wotUpdated(info) {
  const lb = readLastBuild();
  // first start with this feature: remember what is active right now
  if (!lb && info.version && Object.values(info.aktiv || {}).some((v) => v && v !== 'original')) {
    try { fs.mkdirSync(USER, { recursive: true }); fs.writeFileSync(LAST_BUILD, JSON.stringify({ version: info.version, aktiv: info.aktiv }, null, 2)); } catch {}
    return null;
  }
  if (!lb || !lb.version || !info.version || lb.version === info.version || !lb.aktiv) return null;
  const was = Object.values(lb.aktiv).filter((v) => v && v !== 'original');
  const now = Object.values(info.aktiv || {}).filter((v) => v && v !== 'original');
  if (!was.length || now.length) return null; // nothing was active before, or already re-applied
  return { from: lb.version, to: info.version, aktiv: lb.aktiv };
}

// Native folder picker (runs a small STA PowerShell dialog on the local machine)
function pickFolder() {
  return new Promise((resolve) => {
    const ps = "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
      "$d.Description = 'World of Tanks-Ordner wählen (enthält version.xml)'; $d.ShowNewFolderButton = $false; " +
      "$f = New-Object System.Windows.Forms.Form; $f.TopMost = $true; " +
      "if ($d.ShowDialog($f) -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $d.SelectedPath }";
    execFile('powershell', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true, encoding: 'utf8' }, (err, out) => resolve(err ? null : (out || '').trim() || null));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // Only answer requests addressed to us (blocks DNS-rebinding from other sites)
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) return send(res, 403, { error: 'forbidden' });
  lastPing = Date.now();
  try {
    if (req.method === 'GET' && url.pathname === '/api/audio') {
      const mod = url.searchParams.get('mod'), kind = url.searchParams.get('kind'), file = url.searchParams.get('file');
      if (!safeName(mod) || !kindOk(kind) || !safeFile(file)) return send(res, 400, { error: 'bad' });
      const f = path.join(MODS, mod, kind, file);
      if (!fs.existsSync(f)) return send(res, 404, { error: 'not found' });
      return send(res, 200, fs.readFileSync(f), 'audio/wav');
    }
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) {
      if (req.method === 'POST' && req.headers.origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(req.headers.origin)) return send(res, 403, { error: 'forbidden' });
      const body = req.method === 'POST' ? await readBody(req) : null;
      const isWav = url.pathname === '/api/take';
      return send(res, 200, await route(url.searchParams, isWav ? body : body && body.toString('utf8')));
    }
    if (req.method !== 'GET') return send(res, 404, { error: 'not found' });
    const DOCS = { '/docs/anleitung': 'Anleitung.html', '/docs/sprachliste': 'Sprachliste.html' };
    if (DOCS[url.pathname]) {
      const f = path.join(ROOT, DOCS[url.pathname]);
      if (!fs.existsSync(f)) return send(res, 404, 'Bitte "node tools\\docs.js" ausführen.', 'text/plain; charset=utf-8');
      return send(res, 200, fs.readFileSync(f), MIME['.html']);
    }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const f = path.normalize(path.join(UI, rel));
    if (!f.startsWith(UI) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
    return send(res, 200, fs.readFileSync(f), MIME[path.extname(f).toLowerCase()] || 'application/octet-stream');
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.log('läuft bereits'); process.exit(0); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => console.log(`Hexcall: http://127.0.0.1:${PORT}`));
