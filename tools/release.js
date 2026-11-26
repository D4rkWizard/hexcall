// Builds a release for GitHub:
//   dist/Hexhub-<version>.zip          portable package (bundled Node.js, no personal data)
//   dist/SHA256SUMS.txt                checksum used by the in-app updater
//   dist/Hexhub-Setup-<version>.exe    installer (only if Inno Setup is installed)
//   dist/RELEASE_NOTES.md              text for the GitHub release
//
//   node tools/release.js
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const APP = path.resolve(__dirname, '..');
const { version, repo } = JSON.parse(fs.readFileSync(path.join(APP, 'version.json'), 'utf8'));
const DIST = path.join(APP, 'dist');
const STAGE = path.join(DIST, 'Hexhub');
const ZIP = path.join(DIST, `Hexhub-${version}.zip`);

// Only these go into the package – never personal data, dev notes or local tools
const INCLUDE = ['core', 'ui', 'games', 'version.json', 'Hexhub.vbs', 'icon.ico'];
const DEV_ONLY = new Set(['findvo.js', 'scan_sfx.js', 'unpackxml.js', 'docs.js', 'virtual-display', 'node_modules', '.git']);

function step(t) { console.log(`• ${t}`); }

step(`Hexhub v${version}`);
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('version.json: version must be X.Y.Z');
if (!repo) console.warn('  ⚠ version.json → "repo" is not set – update checks stay off in this release.');

step('Hexcall guide + line list');
execFileSync(process.execPath, [path.join(APP, 'games', 'wot', 'hexcall', 'tools', 'docs.js')], { stdio: 'inherit' });
if (!fs.existsSync(path.join(APP, 'icon.ico'))) throw new Error('icon.ico missing – run "node tools/make-icon.js" once');

step('Collect files');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const item of INCLUDE) {
  const src = path.join(APP, item);
  if (!fs.existsSync(src)) throw new Error(`Missing: ${item}`);
  fs.cpSync(src, path.join(STAGE, item), { recursive: true, filter: (p) => !DEV_ONLY.has(path.basename(p)) });
}

step('Bundle Node.js');
fs.mkdirSync(path.join(STAGE, 'runtime'));
fs.copyFileSync(process.execPath, path.join(STAGE, 'runtime', 'node.exe'));
const nodeLicense = path.join(path.dirname(process.execPath), 'LICENSE');
if (fs.existsSync(nodeLicense)) fs.copyFileSync(nodeLicense, path.join(STAGE, 'runtime', 'NODE-LICENSE.txt'));
fs.writeFileSync(path.join(STAGE, 'runtime', 'README.txt'), `Node.js ${process.version} – bundled with Hexhub (https://nodejs.org).\n`);

step('Pack ZIP (takes a moment)');
// Entries are added one by one with forward slashes – Windows PowerShell's built-in zip helpers
// write backslashes, which non-Windows tools treat as part of the file name.
const q = (p) => p.replace(/'/g, "''");
const ps = `Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$stage = '${q(STAGE)}'; $base = Split-Path $stage -Leaf
$zip = [IO.Compression.ZipFile]::Open('${q(ZIP)}', 'Create')
try {
  Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object {
    $rel = $base + '/' + $_.FullName.Substring($stage.Length + 1).Replace('\\', '/')
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, [IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $zip.Dispose() }`;
execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });

const files = [ZIP];
const iscc = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]
  .filter(Boolean).map((p) => path.join(p, 'Inno Setup 6', 'ISCC.exe')).find((p) => fs.existsSync(p));
if (iscc) {
  step('Build installer (Inno Setup)');
  execFileSync(iscc, [`/DAppVersion=${version}`, `/DSourceDir=${STAGE}`, `/O${DIST}`, path.join(__dirname, 'installer.iss')], { stdio: 'inherit' });
  files.push(path.join(DIST, `Hexhub-Setup-${version}.exe`));
} else {
  console.log('  (Inno Setup not installed – ZIP only. Installer: https://jrsoftware.org/isdl.php)');
}

step('Checksums');
const sums = files.map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}  ${path.basename(f)}`).join('\n') + '\n';
fs.writeFileSync(path.join(DIST, 'SHA256SUMS.txt'), sums);

step('Release notes');
let notes = `Hexhub v${version}\n`;
try {
  const cl = fs.readFileSync(path.join(APP, 'CHANGELOG.md'), 'utf8');
  const m = new RegExp(`## (?:Hexhub )?v${version.replace(/\./g, '\\.')}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`).exec(cl);
  if (m) notes = `## New in v${version}\n${m[1].trim()}\n`;
} catch {}
notes += `\n**Download:** ` + (iscc ? `run the installer \`Hexhub-Setup-${version}.exe\` – or ` : '') +
  `unzip \`Hexhub-${version}.zip\` and start \`Hexhub.vbs\`.` +
  `\nExisting installations update themselves on the next start via the notice in the client.\n`;
fs.writeFileSync(path.join(DIST, 'RELEASE_NOTES.md'), notes);
fs.rmSync(STAGE, { recursive: true, force: true });

console.log('\nDone. In the dist folder:');
for (const f of fs.readdirSync(DIST)) console.log(`  ${f}  (${(fs.statSync(path.join(DIST, f)).size / 1048576).toFixed(1)} MB)`);
console.log(`\nOn GitHub: push a tag v${version} – the workflow builds and publishes the release.`);
