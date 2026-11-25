// Scans WoT .pkg archives (zip) for XML files mentioning voice-over events ("vo_...").
// Usage: node findvo.js <gameDir> [pattern]
const fs = require('fs');
const path = require('path');
const decode = require('./unpackxml');
const { zipEntries } = require('./pkg');

const game = process.argv[2];
const pat = new RegExp(process.argv[3] || '\\bvo_[a-z0-9_]+', 'g');
const pkgDir = path.join(game, 'res', 'packages');

const found = new Map();
for (const f of fs.readdirSync(pkgDir)) {
  if (!/^(gui|scripts|misc)/.test(f)) continue;
  const buf = fs.readFileSync(path.join(pkgDir, f));
  for (const e of zipEntries(buf)) {
    if (!e.name.endsWith('.xml')) continue;
    let txt;
    try { txt = decode(e.read()); } catch { continue; }
    const m = txt.match(pat);
    if (m) {
      console.log(`${f}:${e.name}  (${new Set(m).size} unique)`);
      for (const x of m) found.set(x, (found.get(x) || 0) + 1);
    }
  }
}
if (process.argv[4]) fs.writeFileSync(process.argv[4], [...found.keys()].sort().join('\n') + '\n');
console.log('total unique', found.size);
