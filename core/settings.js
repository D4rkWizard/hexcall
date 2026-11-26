// Client settings (%APPDATA%\Hexhub\settings.json). Game modules keep their own data in sub folders.
'use strict';
const path = require('path');
const { DATA, readJson, writeJson } = require('./paths');

const FILE = path.join(DATA, 'settings.json');
const LANGS = ['en', 'de', 'ru', 'pl', 'fr', 'es'];
const THEMES = ['wizard', 'dark', 'light'];
const DEFAULTS = { lang: 'en', theme: 'wizard', animations: true, autoUpdate: false, lastPage: 'home', games: {} };

const listeners = [];

function clean(s) {
  return {
    lang: LANGS.includes(s.lang) ? s.lang : DEFAULTS.lang,
    theme: THEMES.includes(s.theme) ? s.theme : DEFAULTS.theme,
    animations: s.animations !== false,
    autoUpdate: s.autoUpdate === true,
    lastPage: typeof s.lastPage === 'string' ? s.lastPage.slice(0, 60) : 'home',
    games: s.games && typeof s.games === 'object' ? s.games : {},
  };
}

function read() {
  const s = readJson(FILE, null);
  if (!s) return { ...DEFAULTS, first: true };
  return clean({ ...DEFAULTS, ...s });
}

function save(patch) {
  const cur = read();
  delete cur.first;
  const next = clean({ ...cur, ...patch, games: { ...cur.games, ...(patch.games || {}) } });
  writeJson(FILE, next);
  for (const fn of listeners) try { fn(next, patch); } catch {}
  return next;
}

// per-game settings
const game = (id) => read().games[id] || {};
function saveGame(id, patch) {
  const all = read().games;
  return save({ games: { [id]: { ...(all[id] || {}), ...patch } } }).games[id];
}

module.exports = { read, save, game, saveGame, onChange: (fn) => listeners.push(fn), LANGS, THEMES };
