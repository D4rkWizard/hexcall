// Update check and installer using GitHub Releases.
//
// Release layout expected on GitHub (created by tools/release.js):
//   tag  vX.Y.Z
//   asset Hexcall-X.Y.Z.zip   (top folder "Hexcall/")
//   asset SHA256SUMS.txt             ("<sha256>  Hexcall-X.Y.Z.zip")
//
// Only the fixed GitHub API host is contacted, nothing about the user is sent.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const paths = require('./paths');

const API = 'https://api.github.com';
const HEADERS = { 'User-Agent': 'Hexcall-Updater', Accept: 'application/vnd.github+json' };
let cache = null; // { at, result }

function parseVer(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function newer(a, b) { // a > b ?
  const x = parseVer(a), y = parseVer(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function repoOf() {
  const repo = paths.versionInfo().repo || '';
  return /^[\w.-]+\/[\w.-]+$/.test(repo) && !repo.startsWith('DEIN-GITHUB-NAME') ? repo : null;
}

async function latestRelease(repo) {
  const r = await fetch(`${API}/repos/${repo}/releases/latest`, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (r.status === 404) return null; // no release yet
  if (!r.ok) throw new Error(`GitHub antwortet mit ${r.status}`);
  return r.json();
}

async function check(force = false) {
  const current = paths.versionInfo().version;
  const repo = repoOf();
  if (!repo) return { current, configured: false };
  if (!force && cache && Date.now() - cache.at < 6 * 3600 * 1000) return cache.result;
  let result;
  try {
    const rel = await latestRelease(repo);
    if (!rel) result = { current, configured: true, latest: null, update: false };
    else {
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      const zip = (rel.assets || []).find((a) => /^Hexcall-.*\.zip$/i.test(a.name));
      const sums = (rel.assets || []).find((a) => a.name === 'SHA256SUMS.txt');
      result = {
        current, configured: true, latest, update: newer(latest, current),
        url: /^https:\/\/github\.com\//.test(rel.html_url || '') ? rel.html_url : `https://github.com/${repo}/releases`,
        notes: String(rel.body || '').slice(0, 2000),
        installable: !!(zip && sums),
      };
    }
  } catch (e) {
    result = { current, configured: true, error: `Update-Prüfung nicht möglich: ${e.message}` };
  }
  cache = { at: Date.now(), result };
  return result;
}

async function download(url, file) {
  const r = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] }, signal: AbortSignal.timeout(300000) });
  if (!r.ok) throw new Error(`Download fehlgeschlagen (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, { windowsHide: true }, (err, out, errOut) => (err ? reject(new Error(errOut || err.message)) : resolve(out))));
}

async function install() {
  const repo = repoOf();
  if (!repo) throw new Error('Kein GitHub-Repository eingetragen (version.json → "repo").');
  const rel = await latestRelease(repo);
  if (!rel) throw new Error('Es gibt noch kein Release.');
  const latest = String(rel.tag_name).replace(/^v/, '');
  if (!newer(latest, paths.versionInfo().version)) throw new Error('Du hast bereits die aktuelle Version.');
  const zip = rel.assets.find((a) => /^Hexcall-.*\.zip$/i.test(a.name));
  const sums = rel.assets.find((a) => a.name === 'SHA256SUMS.txt');
  if (!zip || !sums) throw new Error('Das Release enthält kein installierbares Paket. Bitte manuell von GitHub laden.');
  const okHost = (u) => /^https:\/\/(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//.test(u);
  if (!okHost(zip.browser_download_url) || !okHost(sums.browser_download_url)) throw new Error('Unerwartete Download-Adresse.');

  const work = path.join(os.tmpdir(), `Hexcall-update-${latest}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const sumText = (await download(sums.browser_download_url, path.join(work, 'SHA256SUMS.txt'))).toString('utf8');
  const expected = (sumText.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).find((p) => p[1] && p[1].replace(/^\*/, '') === zip.name) || [])[0];
  if (!/^[a-f0-9]{64}$/i.test(expected || '')) throw new Error('Prüfsumme fehlt im Release.');
  const zipFile = path.join(work, zip.name);
  const data = await download(zip.browser_download_url, zipFile);
  const actual = crypto.createHash('sha256').update(data).digest('hex');
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error('Prüfsumme stimmt nicht – Update abgebrochen.');

  const out = path.join(work, 'neu');
  await run('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipFile.replace(/'/g, "''")}' -DestinationPath '${out.replace(/'/g, "''")}' -Force`]);
  let src = out;
  const entries = fs.readdirSync(out);
  if (entries.length === 1 && fs.statSync(path.join(out, entries[0])).isDirectory()) src = path.join(out, entries[0]);
  if (!fs.existsSync(path.join(src, 'version.json'))) throw new Error('Das Update-Paket ist unvollständig.');

  // Hand over to the updater script: it closes the client, copies the files and restarts it.
  const tmpScript = path.join(work, 'update.ps1'); // run a copy, the original gets replaced
  fs.copyFileSync(path.join(src, 'tools', 'update.ps1'), tmpScript);
  spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', tmpScript,
    '-Source', src, '-Target', paths.APP], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return { ok: true, version: latest };
}

module.exports = { check, install, newer };
