// Watches which games are running (one tasklist call for all games) and keeps a small play-time log.
'use strict';
const path = require('path');
const { execFile, spawn } = require('child_process');
const { DATA, readJson, writeJson } = require('./paths');

const PLAYTIME = path.join(DATA, 'playtime.json');

function runningImages() {
  return new Promise((ok) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
    const set = new Map(); // image name (lower case) -> pid
    if (!err) for (const line of String(out).split(/\r?\n/)) {
      const m = /^"([^"]+)","(\d+)"/.exec(line);
      if (m && !set.has(m[1].toLowerCase())) set.set(m[1].toLowerCase(), +m[2]);
    }
    ok(set);
  }));
}

function createWatcher(games) {
  const state = {}; // id -> { running, since, pid, exe }
  const play = readJson(PLAYTIME, {}); // id -> { total (ms), last (iso), sessions }
  let timer = null, lastTick = Date.now();

  async function tick() {
    const imgs = await runningImages();
    const now = Date.now();
    for (const g of games) {
      const exe = g.exe.find((e) => imgs.has(e.toLowerCase())) || null;
      const was = state[g.id] || { running: false };
      const running = !!exe;
      if (running && !was.running) { play[g.id] = play[g.id] || { total: 0, sessions: 0 }; play[g.id].sessions++; }
      if (running) {
        const p = play[g.id] = play[g.id] || { total: 0, sessions: 0 };
        p.total += Math.min(now - lastTick, 15000); p.last = new Date(now).toISOString();
      }
      state[g.id] = { running, exe, pid: exe ? imgs.get(exe.toLowerCase()) : null, since: running ? (was.running ? was.since : now) : null };
    }
    lastTick = now;
    try { writeJson(PLAYTIME, play); } catch {}
  }

  function start(ms = 3000) {
    const loop = async () => { try { await tick(); } catch {} timer = setTimeout(loop, ms); };
    loop();
  }

  const get = (id) => ({ ...(state[id] || { running: false }), playtime: play[id] || null });

  // close a game: ask nicely first, force after a few seconds
  async function close(g) {
    const exes = g.exe;
    for (const e of exes) execFile('taskkill', ['/IM', e], { windowsHide: true }, () => {});
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500));
      await tick();
      if (!state[g.id].running) return { ok: true };
    }
    for (const e of exes) await new Promise((r) => execFile('taskkill', ['/F', '/IM', e], { windowsHide: true }, () => r()));
    await new Promise((r) => setTimeout(r, 800));
    await tick();
    return { ok: !state[g.id].running, forced: true };
  }

  function launch(exePath, args = [], cwd) {
    spawn(exePath, args, { cwd: cwd || path.dirname(exePath), detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => tick().catch(() => {}), 2500);
    return { ok: true };
  }

  return { start, tick, get, close, launch, state };
}

module.exports = { createWatcher, runningImages };
