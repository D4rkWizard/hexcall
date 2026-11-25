// Builds a release for GitHub:
//   dist/Hexcall-<version>.zip   portable package (bundled Node.js, no personal data)
//   dist/SHA256SUMS.txt                 checksum used by the in-app updater
//   dist/Hexcall-Setup-<version>.exe   installer (only if Inno Setup is installed)
//   dist/RELEASE_NOTES.md               text for the GitHub release
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
const STAGE = path.join(DIST, 'Hexcall');
const ZIP = path.join(DIST, `Hexcall-${version}.zip`);

// Only these go into the package – never mods/, user/, backups/, Projektverlauf/, build/
const INCLUDE = ['ui', 'tools', 'version.json', 'Sound-Mod-Manager.cmd', 'Hexcall.vbs', 'Anleitung.html', 'Sprachliste.html', 'icon.ico'];
const DEV_ONLY = new Set(['findvo.js', 'scan_sfx.js', 'release.js', 'installer.iss']);

function step(t) { console.log(`• ${t}`); }

step(`Hexcall v${version}`);
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('version.json: Version muss X.Y.Z sein');
if (!repo || repo.startsWith('DEIN-GITHUB-NAME')) console.warn('  ⚠ version.json → "repo" ist noch nicht gesetzt – die Update-Prüfung bleibt in diesem Release aus.');

step('Doku neu erzeugen');
execFileSync(process.execPath, [path.join(__dirname, 'docs.js')], { stdio: 'inherit' });
if (!fs.existsSync(path.join(APP, 'icon.ico'))) throw new Error('icon.ico fehlt – einmal "node tools/make-icon.js" ausführen');

step('Dateien zusammenstellen');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const item of INCLUDE) {
  const src = path.join(APP, item);
  if (!fs.existsSync(src)) throw new Error(`Fehlt: ${item}`);
  fs.cpSync(src, path.join(STAGE, item), { recursive: true, filter: (p) => !DEV_ONLY.has(path.basename(p)) });
}

step('Node.js einbauen');
fs.mkdirSync(path.join(STAGE, 'runtime'));
fs.copyFileSync(process.execPath, path.join(STAGE, 'runtime', 'node.exe'));
const nodeLicense = path.join(path.dirname(process.execPath), 'LICENSE');
if (fs.existsSync(nodeLicense)) fs.copyFileSync(nodeLicense, path.join(STAGE, 'runtime', 'NODE-LICENSE.txt'));
fs.writeFileSync(path.join(STAGE, 'runtime', 'README.txt'), `Node.js ${process.version} – wird von Hexcall mitgeliefert (https://nodejs.org).\n`);

step('ZIP packen (dauert etwas)');
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
  step('Installer bauen (Inno Setup)');
  execFileSync(iscc, [`/DAppVersion=${version}`, `/DSourceDir=${STAGE}`, `/O${DIST}`, path.join(__dirname, 'installer.iss')], { stdio: 'inherit' });
  files.push(path.join(DIST, `Hexcall-Setup-${version}.exe`));
} else {
  console.log('  (Inno Setup nicht installiert – nur ZIP. Installer: https://jrsoftware.org/isdl.php)');
}

step('Prüfsummen');
const sums = files.map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}  ${path.basename(f)}`).join('\n') + '\n';
fs.writeFileSync(path.join(DIST, 'SHA256SUMS.txt'), sums);

step('Release-Text');
let notes = `Hexcall v${version}\n`;
try {
  const clFile = [path.join(APP, 'CHANGELOG.md'), path.join(APP, 'Projektverlauf', 'CHANGELOG.md')].find((f) => fs.existsSync(f));
  const cl = fs.readFileSync(clFile, 'utf8');
  const m = new RegExp(`## v${version.replace(/\.0$/, '').replace(/\./g, '\\.')}(\\.0)?[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`).exec(cl);
  if (m) notes = `## Neu in v${version}\n${m[2].trim()}\n`;
} catch {}
notes += `\n**Download:** \`Hexcall-${version}.zip\` entpacken und \`Hexcall.vbs\` starten` +
  (iscc ? ` – oder den Installer \`Hexcall-Setup-${version}.exe\` ausführen.` : '.') +
  `\nBestehende Installationen aktualisieren sich beim nächsten Start über den Hinweis im Client.\n`;
fs.writeFileSync(path.join(DIST, 'RELEASE_NOTES.md'), notes);
fs.rmSync(STAGE, { recursive: true, force: true });

console.log('\nFertig. Im Ordner dist:');
for (const f of fs.readdirSync(DIST)) console.log(`  ${f}  (${(fs.statSync(path.join(DIST, f)).size / 1048576).toFixed(1)} MB)`);
console.log(`\nAuf GitHub: neues Release mit Tag v${version} anlegen und alle Dateien aus dist hochladen.`);
