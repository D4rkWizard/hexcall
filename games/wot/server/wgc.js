// Wargaming Game Center: WoT only logs in automatically while the Game Center (wgc.exe) is running.
// Before WoT is started, the Game Center is started (if it is not running yet) and given a moment to sign in.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync, spawn } = require('child_process');

function findWgc() {
  const cands = [];
  const pd = process.env.PROGRAMDATA || 'C:\\ProgramData';
  try { cands.push(path.join(fs.readFileSync(path.join(pd, 'Wargaming.net', 'GameCenter', 'data', 'wgc_path.dat'), 'utf8').trim(), 'wgc.exe')); } catch {}
  for (const key of ['HKCU\\Software\\Classes\\wgc\\shell\\open\\command', 'HKCR\\wgc\\shell\\open\\command']) {
    try {
      const out = execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const m = /"([^"]+wgc\.exe)"/i.exec(out); if (m) cands.push(m[1]);
    } catch {}
  }
  cands.push(path.join(pd, 'Wargaming.net', 'GameCenter', 'wgc.exe'));
  return cands.find((f) => f && fs.existsSync(f)) || null;
}

const isRunning = () => new Promise((ok) => execFile('tasklist', ['/FI', 'IMAGENAME eq wgc.exe', '/NH'], { windowsHide: true }, (e, out) => ok(!e && /wgc\.exe/i.test(out))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Makes sure the Game Center runs. Resolves with { started: bool, found: bool }.
// wait: how long to give a freshly started Game Center to sign in before the game is launched.
async function ensure({ wait = Number(process.env.HEXHUB_WGC_WAIT) || 9000 } = {}) {
  const W = module.exports; // through the exports, so tests can replace the checks
  if (await W.isRunning()) return { started: false, found: true };
  const exe = W.findWgc();
  if (!exe) return { started: false, found: false }; // e.g. Steam version – start the game anyway
  const p = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' });
  p.on('error', () => {}); // a broken Game Center must not take the client down – the game is started anyway
  p.unref();
  for (let i = 0; i < 40 && !(await W.isRunning()); i++) await sleep(500);
  await sleep(wait);
  return { started: true, found: true };
}

// Starts the Game Center if needed, then the game. Runs in the background; onDone gets an error message or null.
function launchWithLauncher(start, onDone = () => {}) {
  (async () => {
    try { await module.exports.ensure(); start(); onDone(null); }
    catch (e) { onDone(e.message); }
  })();
}

module.exports = { findWgc, isRunning, ensure, launchWithLauncher };
