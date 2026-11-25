// Shared locations: app folder, user data folder, version info and the WoT install.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APP = path.resolve(__dirname, '..');

// User data (mods, settings) lives outside the app folder so updates never touch it.
// Portable mode: a file "portable.txt" next to the app keeps everything in the app folder.
const DATA = process.env.HEXCALL_DATA
  || (fs.existsSync(path.join(APP, 'portable.txt')) ? APP : path.join(process.env.APPDATA || APP, 'Hexcall'));
const MODS = path.join(DATA, 'mods');
const USER = path.join(DATA, 'user');

function versionInfo() {
  try { return JSON.parse(fs.readFileSync(path.join(APP, 'version.json'), 'utf8')); }
  catch { return { name: 'Hexcall', version: '0.0.0', repo: '' }; }
}

// One-time migration from the old layout (mods/ and user/ inside the app folder).
function migrate() {
  if (DATA === APP) return;
  // renamed app: carry data over from the old "Sound Commander" folder
  const old = path.join(process.env.APPDATA || APP, 'SoundCommander');
  if (!process.env.HEXCALL_DATA && fs.existsSync(old) && !fs.existsSync(DATA)) fs.cpSync(old, DATA, { recursive: true });
  for (const dir of ['mods', 'user']) {
    const from = path.join(APP, dir), to = path.join(DATA, dir);
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.cpSync(from, to, { recursive: true });
  }
  fs.mkdirSync(MODS, { recursive: true });
  fs.mkdirSync(USER, { recursive: true });
}

const isGameDir = (d) => !!d && fs.existsSync(path.join(d, 'version.xml')) && fs.existsSync(path.join(d, 'res', 'audioww', 'voiceover.bnk'));

function settingsGameDir() {
  try { return JSON.parse(fs.readFileSync(path.join(USER, 'settings.json'), 'utf8')).gameDir || null; } catch { return null; }
}

// All WoT installations we can find (EU/NA/ASIA clients of Wargaming).
function findGames() {
  const found = new Set();
  const add = (d) => { if (d && isGameDir(d.trim())) found.add(path.resolve(d.trim())); };
  // 1) Windows uninstall entries
  const UNINSTALL = 'Microsoft\\Windows\\CurrentVersion\\Uninstall';
  for (const key of [`HKCU\\Software\\${UNINSTALL}`, `HKLM\\Software\\${UNINSTALL}`, `HKLM\\SOFTWARE\\WOW6432Node\\${UNINSTALL}`]) {
    try {
      const out = execFileSync('reg', ['query', key, '/s', '/v', 'InstallLocation'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      for (const m of out.matchAll(/InstallLocation\s+REG_\w+\s+(.+)/g)) if (/tank/i.test(m[1])) add(m[1]);
    } catch { /* key missing */ }
  }
  // 2) Wargaming Game Center app registry
  const gc = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Wargaming.net', 'GameCenter', 'apps');
  try {
    for (const app of fs.readdirSync(gc)) {
      if (!/^wot/i.test(app)) continue;
      for (const f of fs.readdirSync(path.join(gc, app))) {
        try { add(fs.readFileSync(path.join(gc, app, f), 'utf8').split(/\r?\n/)[0]); } catch {}
      }
    }
  } catch {}
  // 3) common folders on every drive
  for (let c = 67; c <= 90; c++) {
    const drive = String.fromCharCode(c) + ':\\';
    if (!fs.existsSync(drive)) continue;
    for (const base of ['Games', '', 'Program Files', 'Program Files (x86)', 'Wargaming.net']) {
      for (const name of ['World_of_Tanks_EU', 'World_of_Tanks_NA', 'World_of_Tanks_ASIA', 'World_of_Tanks']) add(path.join(drive, base, name));
    }
  }
  return [...found];
}

function gameDir() {
  const fromEnv = process.env.WOT_GAME_DIR;
  if (isGameDir(fromEnv)) return fromEnv;
  const s = settingsGameDir();
  if (isGameDir(s)) return s;
  return findGames()[0] || null;
}

module.exports = { APP, DATA, MODS, USER, versionInfo, migrate, isGameDir, findGames, gameDir };
