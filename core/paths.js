// Shared locations of the Hexhub client: app folder, user data folder, version info.
'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');

// User data lives outside the app folder so updates never touch it.
// Portable mode: a file "portable.txt" next to the app keeps everything in the app folder (data\).
const DATA = process.env.HEXHUB_DATA
  || (fs.existsSync(path.join(APP, 'portable.txt')) ? path.join(APP, 'data') : path.join(process.env.APPDATA || APP, 'Hexhub'));
fs.mkdirSync(DATA, { recursive: true });

function versionInfo() {
  try { return JSON.parse(fs.readFileSync(path.join(APP, 'version.json'), 'utf8')); }
  catch { return { name: 'Hexhub', version: '0.0.0', repo: '' }; }
}

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); };

module.exports = { APP, DATA, versionInfo, readJson, writeJson };
