// Research helper: collects wwsound* event names from item_defs and checks which
// sound banks contain them. Usage: node scan_sfx.js <gameDir> <outJson>
'use strict';
const fs = require('fs');
const path = require('path');
const { zipEntries, extract } = require('./pkg');
const decode = require('./unpackxml');
const { parse, fnv1 } = require('./bnk');
const { eventSounds } = require('./map');

const game = process.argv[2];
const pk = (n) => path.join(game, 'res', 'packages', n);
const names = new Map(); // name -> Set(tag)
for (const e of zipEntries(fs.readFileSync(pk('scripts.pkg')))) {
  if (!e.name.startsWith('scripts/item_defs/') || !e.name.endsWith('.xml')) continue;
  let t; try { t = decode(e.read()); } catch { continue; }
  for (const m of t.matchAll(/<(wwsound\w*|wwreload\w*|ww\w*)>([^<]+)</gi)) {
    for (const v of m[2].trim().split(/\s+/)) {
      if (!/^[A-Za-z][\w]+$/.test(v)) continue;
      if (!names.has(v)) names.set(v, new Set());
      names.get(v).add(m[1]);
    }
  }
}
console.log('names', names.size);
const pkgs = fs.readdirSync(path.join(game, 'res', 'packages')).filter((f) => /^audioww.*\.pkg$/.test(f)).map(pk);
const banks = extract(pkgs, (n) => /^audioww\/[^/]+\.bnk$/.test(n));
const result = {};
for (const [bn, buf] of banks) {
  let b; try { b = parse(buf); } catch { continue; }
  const evs = [...names.keys()].filter((n) => { const o = b.byId.get(fnv1(n)); return o && o.type === 4; });
  if (!evs.length) continue;
  const map = eventSounds(b, evs);
  result[bn] = Object.fromEntries([...map].map(([k, v]) => [k, { tags: [...names.get(k)], sounds: v.length,
    streamed: v.filter((s) => s.body[8] !== 0).length }]));
  console.log(bn, evs.length, 'events');
}
fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 1));
