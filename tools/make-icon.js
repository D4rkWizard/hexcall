// Renders the DarkWizard emblem to icon.ico (PNG-in-ICO, 256/64/48/32/16 px) using headless Edge.
//   node tools/make-icon.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'icon.ico');
const edge = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean)
  .map((p) => path.join(p, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find((p) => fs.existsSync(p));
if (!edge) { console.log('  Edge nicht gefunden – icon.ico bleibt unverändert.'); process.exit(0); }

const svg = fs.readFileSync(path.join(APP, 'ui', 'icon.svg'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hexhub-icon-'));
const pngs = [];
for (const size of [256, 64, 48, 32, 16]) {
  const html = path.join(tmp, `i${size}.html`);
  fs.writeFileSync(html, `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  const png = path.join(tmp, `i${size}.png`);
  execFileSync(edge, ['--headless=new', '--disable-gpu', `--user-data-dir=${path.join(tmp, 'p')}`, '--hide-scrollbars',
    '--default-background-color=00000000', `--window-size=${size},${size}`, `--screenshot=${png}`, `file:///${html.replace(/\\/g, '/')}`], { stdio: 'ignore' });
  pngs.push([size, fs.readFileSync(png)]);
}
// ICO container with embedded PNGs
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach(([size, data], i) => {
  const e = 6 + i * 16;
  header[e] = size >= 256 ? 0 : size; header[e + 1] = size >= 256 ? 0 : size;
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(data.length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += data.length;
});
fs.writeFileSync(OUT, Buffer.concat([header, ...pngs.map((p) => p[1])]));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`  icon.ico erzeugt (${pngs.map((p) => p[0]).join('/')} px)`);
