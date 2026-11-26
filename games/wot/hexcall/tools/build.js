// Builds the sound mod: puts your recordings into copies of WoT's sound banks.
//
// A sound mod is a folder  mods\<Name>\  with
//   stimme\<event>.wav     commander voice lines   (names: Sprachliste.html / tools\events.js)
//   effekte\<key>.wav      gun, engine, ...         (names: tools\sfx.js)
// Variants: <name>_2.wav, <name>_3.wav ... (the game picks one at random)
//
// Three slots:
//   standard  voice when the WoT voice-over setting is "Standard"
//   national  voice when it is "Commander" (the commander's nation; special commanders keep their own voice)
//   effekte   gun/engine/... sounds
//
//   node tools/build.js --standard "<Mod>" --national "<Mod>" --effekte "<Mod>"
//   node tools/build.js --profil "<Mod>"     (all three slots)
//   node tools/build.js --deinstallieren     (everything back to original)
//   node tools/build.js --liste              (JSON for the manager GUI)
//
// A slot value is a mod name, "original" or "testton".
//   --luecken stumm    voice lines without a recording are silent (default: original)
//   --game <dir>       other install location
//   --kein-install     only write to build\
'use strict';
const fs = require('fs');
const path = require('path');
const { parse, build, soundSource, fnv1 } = require('./bnk');
const { eventSounds } = require('./map');
const { readWav, resample, tidy, toWem } = require('./wav');
const { extract } = require('./pkg');
const EVENTS = require('./events');
const SFX = require('./sfx');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (n) => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };

const paths = require('./paths');
const GAME = val('--game', paths.gameDir());
const MODS = paths.MODS;
if (!paths.isGameDir(GAME)) {
  console.error('FEHLER: World of Tanks wurde nicht gefunden. Bitte im Client unter Einstellungen den WoT-Ordner wählen.');
  process.exit(1);
}
const RATE = 48000; // full quality (the game plays any rate)
const PCM = 0x00010001;
const NATIONS = ['usa', 'ussr', 'germany', 'uk', 'france', 'china', 'japan', 'czech', 'sweden', 'poland', 'italy'];
const SFX_BANKS = [...new Set(SFX.map((c) => c[4]))];
const SLOTS = {
  standard: { kind: 'stimme', banks: ['voiceover.bnk'] },
  national: { kind: 'stimme', banks: NATIONS.map((n) => `${n}/voiceover.bnk`) },
  effekte: { kind: 'effekte', banks: SFX_BANKS },
};
// key -> event names, per kind
const KEYS = {
  stimme: new Map(EVENTS.map((e) => [e[0], ['vo_' + e[0]]])),
  effekte: new Map(SFX.map((c) => [c[0], c[5]])),
};
const bankOfKey = new Map(SFX.map((c) => [c[0], c[4]]));

function gameVersion() {
  const xml = fs.readFileSync(path.join(GAME, 'version.xml'), 'utf8');
  const m = xml.match(/v\.(\d+\.\d+\.\d+\.\d+)/);
  if (!m) throw new Error('Spielversion nicht gefunden in version.xml');
  return m[1];
}
const audioDir = (ver) => path.join(GAME, 'res_mods', ver, 'audioww');
const stateFile = (ver) => path.join(audioDir(ver), 'eigene_stimme.json');
const DEFAULT_STATE = { standard: 'original', national: 'original', effekte: 'original' };

function readState(ver) {
  try { return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(stateFile(ver), 'utf8')) }; } catch { return { ...DEFAULT_STATE }; }
}

const wavCount = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /\.wav$/i.test(f)).length : 0);
function listMods() {
  if (!fs.existsSync(MODS)) return [];
  return fs.readdirSync(MODS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({
    name: d.name,
    stimme: wavCount(path.join(MODS, d.name, 'stimme')),
    effekte: wavCount(path.join(MODS, d.name, 'effekte')),
  }));
}

// Test tones: "Standard" slot = two rising beeps, "Commander" slot = three falling beeps (so you hear which one plays)
// Volume from the studio. Above the normalised level (peak 0.89) a soft limiter keeps it from clipping.
function applyGain(s, g) {
  if (g === 1) return s;
  for (let i = 0; i < s.length; i++) {
    let x = s[i] * g;
    const a = Math.abs(x);
    if (a > 0.9) x = Math.sign(x) * (0.9 + 0.099 * Math.tanh((a - 0.9) / 0.099));
    s[i] = x;
  }
  return s;
}

function beep(slot) {
  const tones = slot === 'national' ? [1568, 1175, 880] : [880, 1320];
  const len = RATE * 0.12, gap = RATE * 0.05;
  const b = new Float32Array(Math.round(tones.length * (len + gap)));
  tones.forEach((f, n) => {
    const o = Math.round(n * (len + gap));
    for (let i = 0; i < len; i++) b[o + i] = 0.5 * Math.sin(i * 2 * Math.PI * f / RATE) * Math.min(1, i / 200, (len - i) / 200);
  });
  return b;
}

// Map(key -> [{file, wem}]) for a slot value
function loadTakes(value, kind, slot) {
  const keys = KEYS[kind];
  const recs = new Map();
  if (value === 'testton') {
    const t = [{ file: slot === 'national' ? '(Testton-Kommandant)' : '(Testton)', wem: toWem(beep(slot), RATE) }];
    for (const k of keys.keys()) recs.set(k, t);
    return recs;
  }
  const dir = path.join(MODS, value, kind);
  if (!fs.existsSync(path.join(MODS, value))) throw new Error(`Mod nicht gefunden: ${path.join(MODS, value)}`);
  if (!fs.existsSync(dir)) return recs;
  const names = [...keys.keys()].sort((a, b) => b.length - a.length);
  const unknown = [];
  // volume set in the studio (mods\<Name>\volume.json): per kind and per recording, in percent
  let vol = {};
  try { vol = JSON.parse(fs.readFileSync(path.join(MODS, value, 'volume.json'), 'utf8')); } catch {}
  const pct = (v) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(200, v)) / 100 : 1);
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/\.wav$/i.test(f)) continue;
    const base = f.replace(/\.wav$/i, '').replace(/^vo_/, '').toLowerCase();
    const k = names.find((n) => base === n || new RegExp(`^${n}_\\d+$`).test(base));
    if (!k) { unknown.push(f); continue; }
    const w = readWav(fs.readFileSync(path.join(dir, f)), f);
    // Effects keep their attack: only trim the end, don't normalise quiet loops too hard
    const s = tidy(resample(w.samples, w.rate, RATE), RATE, kind === 'stimme' ? {} : { pre: 0.015, post: 0.2 });
    applyGain(s, pct(vol[kind]) * pct(vol.takes && vol.takes[`${kind}/${f}`]));
    if (!recs.has(k)) recs.set(k, []);
    recs.get(k).push({ file: `${value}/${kind}/${f}`, wem: toWem(s, RATE) });
  }
  if (unknown.length) console.log(`  [${value}/${kind}] unbekannte Dateinamen (ignoriert): ${unknown.join(', ')}`);
  return recs;
}

let pkgCache;
function sourceBank(rel) {
  if (rel === 'voiceover.bnk') return fs.readFileSync(path.join(GAME, 'res', 'audioww', rel));
  const direct = path.join(GAME, 'res', 'audioww', rel);
  if (fs.existsSync(direct)) return fs.readFileSync(direct);
  if (!pkgCache) {
    const pkgDir = path.join(GAME, 'res', 'packages');
    const pkgs = fs.readdirSync(pkgDir).filter((f) => /^audioww.*\.pkg$/.test(f)).map((f) => path.join(pkgDir, f));
    const wanted = new Set([...SLOTS.national.banks, ...SFX_BANKS].map((b) => `audioww/${b}`));
    pkgCache = extract(pkgs, (n) => wanted.has(n));
  }
  return pkgCache.get(`audioww/${rel}`);
}

// keyEvents: Map(key -> event names). Returns {out, replaced, keys}
function buildBank(buf, keyEvents, recs, fill) {
  const bank = parse(buf);
  const allNames = [...keyEvents.values()].flat();
  const map = eventSounds(bank, allNames);
  const silence = [{ file: '(Stille)', wem: toWem(new Float32Array(RATE / 20), RATE) }];
  let replaced = 0, keys = 0;
  for (const [key, names] of keyEvents) {
    const takes = recs.get(key) || (fill === 'stumm' ? silence : null);
    if (!takes) continue;
    const sounds = new Set(names.flatMap((n) => map.get(n) || []));
    if (!sounds.size) continue;
    keys++;
    [...sounds].forEach((snd, i) => {
      const t = takes[i % takes.length];
      const mediaId = fnv1(`eigene_stimme/${t.file}`);
      bank.media.set(mediaId, t.wem);
      snd.body.writeUInt32LE(PCM, 4);
      snd.body[8] = 0; // in-memory, not streamed
      snd.body.writeUInt32LE(mediaId, 9);
      snd.body.writeUInt32LE(t.wem.length, 13);
      replaced++;
    });
  }
  const used = new Set(bank.objs.filter((o) => o.type === 2).map((o) => soundSource(o).sourceId));
  const media = new Map([...bank.media].filter(([id]) => used.has(id)));
  return { out: build(bank, media), replaced, keys };
}

function removeBank(ver, rel) {
  const f = path.join(audioDir(ver), rel);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

function applySlot(ver, slot, value) {
  const { kind, banks } = SLOTS[slot];
  if (value === 'original') {
    for (const rel of banks) removeBank(ver, rel);
    console.log(`${slot.padEnd(9)} → Original`);
    return;
  }
  const recs = loadTakes(value, kind, slot);
  const fill = kind === 'stimme' ? val('--luecken', 'original') : 'original';
  let keys = 0;
  for (const rel of banks) {
    let keyEvents = KEYS[kind];
    if (kind === 'effekte') {
      keyEvents = new Map([...keyEvents].filter(([k]) => bankOfKey.get(k) === rel));
      if (![...keyEvents.keys()].some((k) => recs.has(k))) { removeBank(ver, rel); continue; }
    }
    const buf = sourceBank(rel);
    if (!buf) { console.log(`  ${rel} nicht im Spiel gefunden, übersprungen`); continue; }
    const info = buildBank(buf, keyEvents, recs, fill);
    keys += info.keys;
    const targets = [];
    if (opt('--kein-install')) targets.push(path.join(ROOT, 'build', slot, 'res_mods', ver, 'audioww', rel));
    if (!opt('--kein-install')) targets.push(path.join(audioDir(ver), rel));
    for (const t of targets) {
      fs.mkdirSync(path.dirname(t), { recursive: true });
      fs.writeFileSync(t, info.out);
    }
  }
  if (kind === 'stimme') keys = Math.round(keys / banks.length);
  const total = KEYS[kind].size;
  const rest = kind === 'stimme' ? `, Rest ${fill}` : ', Rest original';
  console.log(`${slot.padEnd(9)} → "${value}"  (${keys} von ${total} ${kind === 'stimme' ? 'Sätzen' : 'Effekten'} eigene Sounds${rest})`);
}

function main() {
  const ver = gameVersion();
  if (opt('--liste')) {
    console.log(JSON.stringify({ version: ver, mods: listMods(), aktiv: readState(ver) }));
    return;
  }
  if (opt('--status')) { console.log(JSON.stringify(readState(ver))); return; }
  if (opt('--schritte')) {
    // steps for the recording assistant
    const steps = [
      ...EVENTS.map((e) => ({ kind: 'stimme', key: e[0], title: e[1], text: `„${e[2]}“`,
        hint: 'Sprich den Satz (oder deine eigene Version) kurz und deutlich ein.' })),
      ...SFX.map((c) => ({ kind: 'effekte', key: c[0], title: c[1], text: c[2], hint: c[3] })),
    ];
    console.log(JSON.stringify(steps));
    return;
  }

  const state = readState(ver);
  const all = opt('--deinstallieren') ? 'original' : val('--profil');
  const want = { standard: val('--standard', all), national: val('--national', all), effekte: val('--effekte', all) };
  if (!want.standard && !want.national && !want.effekte) {
    console.log('Nichts zu tun. Beispiele:\n  --profil "Mein Mod"\n  --standard "Mein Mod" --national testton --effekte original\n  --deinstallieren');
    return;
  }
  console.log(`World of Tanks ${ver}  (${GAME})`);
  for (const slot of Object.keys(SLOTS)) {
    if (!want[slot]) continue;
    applySlot(ver, slot, want[slot]);
    state[slot] = want[slot];
  }
  if (!opt('--kein-install')) {
    fs.mkdirSync(audioDir(ver), { recursive: true });
    if (Object.values(state).every((v) => v === 'original')) { try { fs.unlinkSync(stateFile(ver)); } catch {} }
    else fs.writeFileSync(stateFile(ver), JSON.stringify(state, null, 2));
  }
  console.log('Fertig. Wirkt nach einem Neustart von WoT.');
}

try { main(); } catch (e) { console.error('FEHLER:', e.message); process.exit(1); }
