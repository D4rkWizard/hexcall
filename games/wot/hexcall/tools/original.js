// "Listen to the original": plays WoT's own voice line / effect for a recording step.
// WoT stores its sounds as Wwise Vorbis/Opus (.wem) inside the sound banks – browsers cannot play that.
// vgmstream (https://github.com/vgmstream/vgmstream, ISC licence) converts them to WAV. It is downloaded once
// on request into the user data folder; converted sounds are cached per game version.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { parse } = require('./bnk');
const { eventSounds } = require('./map');
const { extract } = require('./pkg');
const EVENTS = require('./events');
const SFX = require('./sfx');
const paths = require('./paths');

const TOOL_DIR = path.join(paths.DATA, 'tools', 'vgmstream');
const EXE = path.join(TOOL_DIR, 'vgmstream-cli.exe');
const CACHE = path.join(paths.DATA, 'original-cache');
const VOICE = new Map(EVENTS.map((e) => [e[0], ['vo_' + e[0]]]));
const FX = new Map(SFX.map((c) => [c[0], { bank: c[4], events: c[5] }]));

let setup = { state: 'idle', msg: '' };
let banks = { ver: null, map: new Map() }; // rel -> parsed bank
let pkgList = null;

const gameVersion = (g) => { try { const m = /v\.(\d+\.\d+\.\d+\.\d+)/.exec(fs.readFileSync(path.join(g, 'version.xml'), 'utf8')); return m ? m[1] : 'x'; } catch { return 'x'; } };

function status() { return { ready: fs.existsSync(EXE), setup }; }

async function install() {
  if (setup.state === 'läuft') return status();
  setup = { state: 'läuft', msg: 'Lade vgmstream herunter …' };
  try {
    const H = { 'User-Agent': 'Hexhub', Accept: 'application/vnd.github+json' };
    const rel = await (await fetch('https://api.github.com/repos/vgmstream/vgmstream/releases/latest', { headers: H, signal: AbortSignal.timeout(15000) })).json();
    const asset = (rel.assets || []).find((a) => a.name === 'vgmstream-win64.zip');
    if (!asset || !/^https:\/\/github\.com\//.test(asset.browser_download_url)) throw new Error('vgmstream-Download nicht gefunden');
    const r = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Hexhub' }, signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error(`Download fehlgeschlagen (${r.status})`);
    fs.rmSync(TOOL_DIR, { recursive: true, force: true });
    fs.mkdirSync(TOOL_DIR, { recursive: true });
    const zip = path.join(TOOL_DIR, 'vgmstream.zip');
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    setup.msg = 'Entpacke …';
    await new Promise((ok, fail) => execFile('tar', ['-xf', zip, '-C', TOOL_DIR], { windowsHide: true }, (e) => (e ? fail(new Error(`Entpacken fehlgeschlagen: ${e.message}`)) : ok())));
    fs.unlinkSync(zip);
    if (!fs.existsSync(EXE)) throw new Error('vgmstream-cli.exe nicht im Archiv gefunden');
    fs.writeFileSync(path.join(TOOL_DIR, 'SOURCE.txt'), `vgmstream ${rel.tag_name} – https://github.com/vgmstream/vgmstream (ISC licence)\n`);
    setup = { state: 'fertig', msg: '' };
  } catch (e) { setup = { state: 'fehler', msg: e.message }; }
  return status();
}

function packages(game) {
  if (!pkgList) {
    const dir = path.join(game, 'res', 'packages');
    pkgList = fs.readdirSync(dir).filter((f) => /^audioww.*\.pkg$/.test(f)).map((f) => path.join(dir, f));
  }
  return pkgList;
}
function bank(game, rel) {
  const ver = gameVersion(game);
  if (banks.ver !== ver) { banks = { ver, map: new Map() }; pkgList = null; }
  if (!banks.map.has(rel)) {
    const direct = path.join(game, 'res', 'audioww', rel);
    const buf = fs.existsSync(direct) ? fs.readFileSync(direct) : extract(packages(game), (n) => n === `audioww/${rel}`).get(`audioww/${rel}`);
    if (!buf) throw new Error(`Sound-Bank ${rel} nicht gefunden`);
    banks.map.set(rel, parse(buf));
  }
  return banks.map.get(rel);
}

// all original sounds (media ids) of a step, in a stable order
function sources(game, kind, key) {
  let rel, events;
  if (kind === 'stimme' && VOICE.has(key)) { rel = 'voiceover.bnk'; events = VOICE.get(key); }
  else if (kind === 'effekte' && FX.has(key)) { rel = FX.get(key).bank; events = FX.get(key).events; }
  else throw new Error('Unbekannter Schritt');
  const b = bank(game, rel);
  const map = eventSounds(b, events);
  const seen = new Set(), out = [];
  for (const ev of events) for (const snd of map.get(ev) || []) {
    const id = snd.body.readUInt32LE(9);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, stream: snd.body[8] !== 0, bank: b });
  }
  return out;
}

function list(game, kind, key) { return { count: sources(game, kind, key).length }; }

async function wav(game, kind, key, i) {
  if (!fs.existsSync(EXE)) { const e = new Error('vgmstream fehlt'); e.code = 'SETUP'; throw e; }
  const src = sources(game, kind, key);
  if (!src.length) throw new Error('Für diesen Schritt gibt es keinen Original-Sound.');
  const s = src[((i % src.length) + src.length) % src.length];
  const dir = path.join(CACHE, gameVersion(game));
  const out = path.join(dir, `${s.id}.wav`);
  if (fs.existsSync(out)) return fs.readFileSync(out);
  fs.mkdirSync(dir, { recursive: true });
  // WoT keeps most sounds inside the bank, even those flagged as streamed
  let wem = s.bank.media.get(s.id);
  if (!wem) wem = extract(packages(game), (n) => n === `audioww/${s.id}.wem`).get(`audioww/${s.id}.wem`);
  if (!wem) throw new Error('Original-Sound nicht gefunden (gestreamt).');
  const tmp = path.join(dir, `${s.id}.wem`);
  fs.writeFileSync(tmp, wem);
  await new Promise((ok, fail) => execFile(EXE, ['-o', out, tmp], { windowsHide: true, timeout: 30000 }, (e, so, se) => (e ? fail(new Error(`Umwandeln fehlgeschlagen: ${String(se || e.message).trim().split('\n').pop()}`)) : ok())));
  fs.rmSync(tmp, { force: true });
  return fs.readFileSync(out);
}

module.exports = { status, install, list, wav };
