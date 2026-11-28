// Estimated total osu! play time.
// The osu! profile only counts the time spent inside beatmaps ("play_time"). Hexhub measures how long osu! itself runs,
// so the ratio client time : map time (menus, song select, pauses) is learned from the sessions Hexhub sees.
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_RATIO = 1.5;   // until enough has been measured
const MIN_MEASURED = 1800;   // at least 30 min of map time measured before the own ratio is used
const REFRESH = 6 * 3600e3;  // profile refresh, and right after osu! was closed

module.exports = function createProfile({ DATA, player, clientMs, running }) {
  const FILE = path.join(DATA, 'profile.json');
  let st = {};
  try { st = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  let busy = false, wasRunning = false;
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(st, null, 2)); } catch {} };

  // public profile page of the player (statistics are in the page's initial data; no API key needed)
  async function fetchProfile(name) {
    const res = await fetch(`https://osu.ppy.sh/users/${encodeURIComponent(name)}/osu`, { headers: { 'User-Agent': 'Hexhub' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`osu! profile: HTTP ${res.status}`);
    const html = (await res.text()).replace(/&quot;/g, '"');
    const t = html.match(/"play_time":(\d+)/), c = html.match(/"play_count":(\d+)/);
    if (!t) throw new Error('osu! profile: play_time not found');
    return { mapSec: +t[1], plays: c ? +c[1] : null };
  }

  async function refresh() {
    const name = player();
    if (busy || !name) return;
    busy = true;
    try {
      const p = await fetchProfile(name);
      const snap = { t: new Date().toISOString(), mapSec: p.mapSec, clientMs: clientMs() };
      if (!st.first || st.player !== name || p.mapSec < st.first.mapSec) st.first = snap; // new player or reset → measure anew
      st.player = name; st.last = snap; st.plays = p.plays; st.error = null;
    } catch (e) { st.error = e.message; st.last = st.last ? { ...st.last, t: new Date().toISOString() } : null; }
    finally { busy = false; save(); }
  }

  function estimate() {
    const run = running();
    const closed = wasRunning && !run; wasRunning = run;
    const age = st.last ? Date.now() - Date.parse(st.last.t) : Infinity;
    if (closed || age > REFRESH || (player() && st.player && st.player !== player())) refresh();
    if (!st.last || st.player !== player()) return null;
    const dMap = st.last.mapSec - st.first.mapSec, dClient = (st.last.clientMs - st.first.clientMs) / 1000;
    const own = dMap >= MIN_MEASURED ? dClient / dMap : null;
    const measured = own != null && own >= 1 && own <= 5;
    const ratio = measured ? own : DEFAULT_RATIO;
    return { kind: 'osu', ms: st.last.mapSec * ratio * 1000, mapMs: st.last.mapSec * 1000, plays: st.plays, ratio, measured, measuredMapMs: Math.max(0, dMap) * 1000 };
  }

  return { estimate, refresh };
};
