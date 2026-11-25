// Generates the Windows-friendly documentation: Anleitung.html and Sprachliste.html
// (self-contained, open with a double-click in any browser, printable).
//   node tools/docs.js
'use strict';
const fs = require('fs');
const path = require('path');
const EVENTS = require('./events');
const SFX = require('./sfx');

const ROOT = path.resolve(__dirname, '..');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const EMBLEM = `<svg viewBox="0 0 120 120" class="emblem" aria-hidden="true"><defs>
<radialGradient id="o" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#cf9bff"/><stop offset="1" stop-color="#7c3aed" stop-opacity="0"/></radialGradient>
<linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cf9bff"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
<path fill="url(#h)" d="M60 6 C46 6 36 14 31 26 L22 14 L24 36 C19 45 17 55 17 64 C17 82 23 96 30 108 L47 100 C41 88 39 76 40 63 C42 43 50 33 60 33 C70 33 78 43 80 63 C81 76 79 88 73 100 L90 108 C97 96 103 82 103 64 C103 55 101 45 96 36 L98 14 L89 26 C84 14 74 6 60 6Z"/>
<path fill="#0b0613" d="M60 33 C50 33 42 43 40 63 C42 77 50 86 60 88 C70 86 78 77 80 63 C78 43 70 33 60 33Z"/>
<path fill="#cf9bff" d="M47 59 L56 62 L55 65 L48 63Z M73 59 L64 62 L65 65 L72 63Z"/>
<circle cx="60" cy="98" r="21" fill="url(#o)" opacity=".55"/><circle cx="60" cy="98" r="10" fill="url(#o)"/>
<path fill="url(#h)" d="M38 104 C40 94 46 88 52 88 L50 100 C48 106 44 110 38 110Z M82 104 C80 94 74 88 68 88 L70 100 C72 106 76 110 82 110Z"/></svg>`;

const CSS = `
:root { --bg:#0d0915; --panel:#181126; --panel2:#201732; --line:#33264e; --text:#f0eafb; --text2:#cfc3e6; --muted:#9d8fbf;
  --accent:#b46cff; --accent2:#7c3aed; --hi:#cf9bff; --soft:rgba(180,108,255,.14); --ok:#4cc38a; --head:"Bahnschrift","Segoe UI",sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15.5px/1.65 "Segoe UI", system-ui, sans-serif; }
body::before { content: ""; position: fixed; inset: 0; pointer-events: none; background: radial-gradient(900px 480px at 90% -10%, rgba(124,58,237,.25), transparent 70%); }
.wrap { max-width: 980px; margin: 0 auto; padding: 40px 32px 70px; position: relative; }
header { display: flex; align-items: center; gap: 18px; margin-bottom: 8px; }
.emblem { width: 62px; height: 62px; filter: drop-shadow(0 6px 18px rgba(180,108,255,.45)); flex: none; }
.eyebrow { font-family: var(--head); color: var(--accent); letter-spacing: .2em; text-transform: uppercase; font-size: 12px; }
h1 { font-family: var(--head); font-size: 34px; margin: 0; line-height: 1.15; }
h2 { font-family: var(--head); font-size: 22px; margin: 38px 0 12px; display: flex; align-items: center; gap: 10px; }
h2 .n { width: 30px; height: 30px; border-radius: 9px; display: inline-grid; place-items: center; background: var(--soft); color: var(--hi); font-size: 15px; }
h3 { font-family: var(--head); font-size: 17px; margin: 22px 0 8px; }
p { color: var(--text2); margin: 0 0 12px; }
.lead { font-size: 16.5px; color: var(--text2); max-width: 720px; margin: 10px 0 22px; }
a { color: var(--hi); }
b, strong { color: var(--text); }
.toc { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 8px; }
.toc a { text-decoration: none; padding: 6px 12px; border-radius: 20px; border: 1px solid var(--line); background: var(--panel); color: var(--text2); font-size: 13.5px; }
.toc a:hover { border-color: var(--accent); color: var(--text); }
.cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; }
.card h3 { margin-top: 0; }
.card p:last-child { margin-bottom: 0; }
.steps { counter-reset: s; list-style: none; padding: 0; margin: 0 0 12px; display: grid; gap: 10px; }
.steps li { counter-increment: s; position: relative; padding: 12px 16px 12px 56px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; color: var(--text2); }
.steps li::before { content: counter(s); position: absolute; left: 14px; top: 11px; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: linear-gradient(180deg, var(--hi), var(--accent2)); color: #fff; font: 700 14px var(--head); }
ul.dots { padding-left: 20px; color: var(--text2); margin: 0 0 12px; }
ul.dots li { margin: 4px 0; }
table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; margin: 0 0 14px; }
th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-family: var(--head); font-size: 12.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); background: var(--panel2); }
tr:last-child td { border-bottom: 0; }
td { color: var(--text2); }
code, kbd { font-family: "Cascadia Mono", Consolas, monospace; font-size: 13px; background: var(--panel2); border: 1px solid var(--line); border-radius: 6px; padding: 1px 6px; color: var(--hi); white-space: nowrap; }
kbd { color: var(--text); }
.note { border-left: 3px solid var(--accent); background: var(--soft); padding: 10px 14px; border-radius: 0 10px 10px 0; color: var(--text2); margin: 0 0 14px; }
.warn { border-left-color: #e5484d; background: rgba(229,72,77,.1); }
.bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 6px 0 18px; }
.search { flex: 1; min-width: 240px; height: 40px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--text); padding: 0 14px; font: inherit; outline: none; }
.search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--soft); }
.btn { height: 40px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--accent); background: linear-gradient(180deg, var(--hi), var(--accent2)); color: #fff; font: 600 14px "Segoe UI", sans-serif; cursor: pointer; }
.btn.ghost { background: transparent; color: var(--hi); border-color: var(--line); }
.file { font-family: "Cascadia Mono", Consolas, monospace; font-size: 12.5px; color: var(--hi); overflow-wrap: anywhere; }
.copy { border: 0; background: none; color: var(--muted); cursor: pointer; font-size: 13px; padding: 0 0 0 6px; }
.copy:hover { color: var(--hi); }
.line { color: #f2dcff; font-style: italic; }
.grp td { background: var(--panel2); font: 600 12px var(--head); letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }
.count { color: var(--muted); font-size: 13px; }
footer { margin-top: 40px; color: var(--muted); font-size: 13px; text-align: center; }
@media (max-width: 760px) { .cards { grid-template-columns: 1fr; } }
@media print {
  :root { --bg:#fff; --panel:#fff; --panel2:#f3f0f8; --line:#d9d2e6; --text:#111; --text2:#333; --muted:#666; --hi:#6d28d9; --soft:#f3ecff; }
  body::before, .bar, .toc, .copy, .noprint { display: none !important; }
  .wrap { padding: 0; max-width: none; }
  h2 { break-after: avoid; } tr, .card, .steps li { break-inside: avoid; }
  .line { color: #333; }
}`;

function page(title, eyebrow, body, script = '') {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${esc(title)} – Hexcall</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head>
<body><div class="wrap">
<header>${EMBLEM}<div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1></div></header>
${body}
<footer>Hexcall · a DarkWizard production · erstellt am ${new Date().toLocaleDateString('de-DE')}</footer>
</div>${script ? `<script>${script}</script>` : ''}</body></html>`;
}

// ---------- Anleitung ----------
const anleitung = page('Anleitung', 'Hexcall für World of Tanks', `
<p class="lead">Eigene Commander-Stimme und eigene Effekte (Kanone, Motor, Turm …) für World of Tanks – aufgenommen mit deinem Mikrofon,
aktiviert mit einem Klick. Du brauchst kein Wwise, nur Node.js und Microsoft Edge (bei Windows dabei).</p>
<nav class="toc">
  <a href="#start">Start</a><a href="#bereiche">Bereiche</a><a href="#studio">Aufnahme-Studio</a><a href="#slots">Zwei Stimmen</a>
  <a href="#testen">Testen</a><a href="#tipps">Tipps</a><a href="#update">Nach einem WoT-Update</a><a href="#ordner">Ordner</a><a href="#grenzen">Grenzen</a>
</nav>

<h2 id="start"><span class="n">1</span>Start</h2>
<ol class="steps">
  <li>Über das Startmenü oder die Desktop-Verknüpfung <b>Hexcall</b> starten (ohne Installer: <b>Hexcall.vbs</b> im Programmordner). Der Client öffnet sich als eigenes Fenster.</li>
  <li>Beim ersten Aufnehmen fragt das Fenster nach dem Mikrofon: auf <b>Zulassen</b> klicken.</li>
  <li>Fenster schließen beendet alles. Ein Hintergrunddienst läuft nur, solange das Fenster offen ist.</li>
  <li>WoT wird automatisch gefunden. Falls nicht: <b>Einstellungen → World of Tanks → Ordner wählen</b>.</li>
</ol>

<h2 id="bereiche"><span class="n">2</span>Die Bereiche im Client</h2>
<div class="cards">
  <div class="card"><h3>Übersicht</h3><p>Was gerade im Spiel aktiv ist, deine zuletzt bearbeiteten Mods und „Neuen Sound-Mod erstellen“.</p></div>
  <div class="card"><h3>Meine Mods</h3><p>Alle Sound-Mods mit Fortschritt (Stimme x/55, Effekte x/12). Der aktive Mod ist grün markiert. Aufnehmen, Aktivieren/Deaktivieren, Ordner öffnen.</p></div>
  <div class="card"><h3>Aufnahme-Studio</h3><p>Schritt für Schritt aufnehmen. Oben zwischen <b>Stimme</b> und <b>Effekte</b> wechseln.</p></div>
  <div class="card"><h3>Im Spiel aktiv</h3><p>Slots wählen (Mod, Original, Testton) und <b>Anwenden</b>. <b>Mod aus</b> schaltet alles auf Original, danach holt <b>Wieder einschalten</b> den vorherigen Zustand zurück.</p></div>
  <div class="card"><h3>Einstellungen</h3><p>Design: DarkWizard (Lila), Commander (Dark) oder Hell. Animationen an/aus.</p></div>
  <div class="card"><h3>Hilfe</h3><p>Kurzanleitung und ein kleines Changelog. Läuft WoT, steht unten links dein Spielername.</p></div>
</div>

<h2 id="studio"><span class="n">3</span>Aufnahme-Studio</h2>
<ul class="dots">
  <li>Jede Ansage mit Situation und Beispielsatz. Links die Liste, ein Häkchen zeigt erledigte Schritte.</li>
  <li><b>Roter Knopf</b> oder <kbd>Leertaste</kbd>: Aufnahme starten und stoppen, mit Live-Pegel. Danach wird die Aufnahme sofort abgespielt.</li>
  <li><b>Überspringen</b>: Die Ansage bleibt im Spiel original.</li>
  <li><b>Als zusätzliche Variante speichern</b>: mehrere Versionen pro Ansage, das Spiel wählt zufällig.</li>
  <li><b>Drag &amp; Drop</b>: WAV, MP3, M4A oder OGG einfach ins Fenster ziehen.</li>
  <li>Nach der letzten Ansage fragt das Studio, ob du mit den Effekten weitermachen willst.</li>
  <li><b>Fertig – im Spiel aktivieren</b> baut den Mod und schaltet ihn ein.</li>
</ul>
<p>Welche Ansagen und Effekte es gibt, steht in der <a href="Sprachliste.html">Sprachliste</a>.</p>

<h2 id="slots"><span class="n">4</span>Zwei Stimmen im Spiel umschalten</h2>
<table>
  <tr><th>Einstellung in WoT (Ton › nationale Besatzungsstimmen)</th><th>Was du hörst</th></tr>
  <tr><td>aus</td><td>Stimme – Slot 1</td></tr>
  <tr><td>an</td><td>Stimme – Slot 2</td></tr>
</table>
<p>Effekte gelten immer. Änderungen hörst du ab dem nächsten Gefecht – falls nicht, WoT neu starten.</p>

<h2 id="testen"><span class="n">5</span>Testen</h2>
<ol class="steps">
  <li>Unter <b>Im Spiel aktiv</b> alles auf <b>Testton (Piep)</b> stellen und <b>Anwenden</b>.</li>
  <li>WoT starten und im Trainingsraum ein paar Schüsse abgeben und fahren.</li>
  <li>Statt Stimme, Kanone und Motor hörst du einen Doppel-Piep – dann funktioniert alles.</li>
</ol>

<h2 id="tipps"><span class="n">6</span>Tipps für gute Aufnahmen</h2>
<div class="cards">
  <div class="card"><h3>Stimme</h3><p>Kurz halten: 0,5 bis 2 Sekunden. Deutlich, ruhig auch mal laut – es soll nach Gefecht klingen.</p></div>
  <div class="card"><h3>Schleifen</h3><p>Motor, Turm, Ketten und Feuer laufen in Schleife: 2–4 Sekunden gleichmäßiges Geräusch ohne Anfang und Ende. Die Motor-Tonhöhe ändert das Spiel selbst.</p></div>
  <div class="card"><h3>Knall</h3><p>Kanone und Explosionen: ein kurzer, kräftiger Knall.</p></div>
  <div class="card"><h3>Automatik</h3><p>Stille am Anfang und Ende wird abgeschnitten, die Lautstärke angeglichen und auf 24 kHz mono umgerechnet.</p></div>
</div>

<h2 id="update"><span class="n">7</span>Updates</h2>
<p><b>Hexcall:</b> Beim Start prüft der Client, ob es eine neue Version gibt, und zeigt dann oben einen Hinweis mit <b>Jetzt aktualisieren</b>. Deine Mods bleiben dabei erhalten.</p>
<p><b>World of Tanks:</b></p>
<p>Die eingebauten Sounds liegen pro Spielversion in <code>res_mods\\&lt;Version&gt;</code>. Nach einem Update ist der Mod deshalb erst einmal aus:
Client öffnen und unter <b>Im Spiel aktiv</b> auf <b>Anwenden</b> klicken – er wird für die neue Version gebaut.</p>

<h2 id="ordner"><span class="n">8</span>Ordner</h2>
<table>
  <tr><th>Ordner / Datei</th><th>Inhalt</th></tr>
  <tr><td><code>Hexcall.vbs</code></td><td>Startet den Client (ohne Konsolenfenster)</td></tr>
  <tr><td><code>%APPDATA%\\Hexcall\\mods\\&lt;Name&gt;\\stimme</code></td><td>Deine Sprachaufnahmen (Namen siehe <a href="Sprachliste.html">Sprachliste</a>)</td></tr>
  <tr><td><code>%APPDATA%\\Hexcall\\mods\\&lt;Name&gt;\\effekte</code></td><td>Deine Effekte</td></tr>
  <tr><td><code>%APPDATA%\\Hexcall\\user</code></td><td>Einstellungen (Design, Animationen, WoT-Ordner)</td></tr>
  <tr><td><code>ui</code>, <code>tools</code>, <code>runtime</code></td><td>Programmdateien (werden bei Updates ersetzt)</td></tr>
</table>
<details class="noprint"><summary><b>Für Fortgeschrittene: Kommandozeile</b></summary>
<p>In PowerShell im Projektordner:</p>
<table>
  <tr><td><code>node tools\\build.js --profil "Mein Mod"</code></td><td>Mod in alle Slots</td></tr>
  <tr><td><code>node tools\\build.js --standard "Mein Mod" --national original --effekte "Mein Mod"</code></td><td>Slots einzeln</td></tr>
  <tr><td><code>node tools\\build.js --deinstallieren</code></td><td>Alles Original</td></tr>
  <tr><td><code>node tools\\docs.js</code></td><td>Anleitung und Sprachliste neu erzeugen</td></tr>
</table></details>

<h2 id="grenzen"><span class="n">9</span>Grenzen</h2>
<ul class="dots">
  <li>Spezielle Besatzungsstimmen (Blogger, Events, Sabaton usw.) werden nicht ersetzt.</li>
  <li>Motorsounds gibt es für die 14 Motortypen, die das Spiel aktuell nutzt.</li>
  <li>Nachladegeräusche und Treffer am eigenen Panzer sind (noch) nicht dabei.</li>
</ul>
`);

// ---------- Sprachliste ----------
const GROUPS = [[0, 'Gefechtsbeginn'], [1, 'Deine Treffer'], [17, 'Zielerfassung'], [20, 'Schäden am Panzer'], [41, 'Besatzung'], [48, 'Zug']];
let voiceRows = '';
EVENTS.forEach(([key, when, line], i) => {
  const g = GROUPS.find((x) => x[0] === i);
  if (g) voiceRows += `<tr class="grp"><td colspan="3">${esc(g[1])}</td></tr>`;
  voiceRows += `<tr data-s="${esc((key + ' ' + when + ' ' + line).toLowerCase())}"><td>${esc(when)}</td><td class="line">„${esc(line)}“</td>
    <td><span class="file">${esc(key)}.wav</span><button class="copy" data-c="${esc(key)}.wav" title="Dateiname kopieren">⧉</button></td></tr>`;
});
let fxRows = '';
SFX.forEach(([key, label, when, hint]) => {
  fxRows += `<tr data-s="${esc((key + ' ' + label + ' ' + when + ' ' + hint).toLowerCase())}"><td><b>${esc(label)}</b><br>${esc(when)}</td><td>${esc(hint)}</td>
    <td><span class="file">${esc(key)}.wav</span><button class="copy" data-c="${esc(key)}.wav" title="Dateiname kopieren">⧉</button></td></tr>`;
});
const sprachliste = page('Sprachliste', 'Was du aufnehmen kannst', `
<p class="lead">Alle ${EVENTS.length} Ansagen und ${SFX.length} Effekte. Am einfachsten nimmst du sie direkt im <b>Aufnahme-Studio</b> des Clients auf –
diese Liste hilft beim Vorbereiten oder wenn du fertige Sounddateien selbst in den Mod-Ordner legst.</p>
<div class="note">Dateien gehören nach <code>%APPDATA%\\Hexcall\\mods\\&lt;Name&gt;\\stimme</code> bzw. <code>…\\effekte</code> (im Client: Meine Mods → Ordner-Symbol).
Varianten: <span class="file">name_2.wav</span>, <span class="file">name_3.wav</span> … – das Spiel wählt zufällig. Was fehlt, bleibt original.
Die Beispielsätze sind nur Vorschläge.</div>
<div class="bar"><input class="search" id="q" placeholder="Suchen, z. B. „Kette“, „Feuer“, „Durchschlag“ …"><button class="btn ghost" onclick="window.print()">Drucken / als PDF</button></div>
<nav class="toc"><a href="#stimme">Stimme (${EVENTS.length})</a><a href="#effekte">Effekte (${SFX.length})</a></nav>

<h2 id="stimme"><span class="n">1</span>Stimme <span class="count">(${EVENTS.length} Ansagen)</span></h2>
<table id="t1"><tr><th style="width:30%">Wann</th><th style="width:32%">Beispielsatz</th><th>Dateiname</th></tr>${voiceRows}</table>

<h2 id="effekte"><span class="n">2</span>Effekte <span class="count">(${SFX.length})</span></h2>
<table id="t2"><tr><th style="width:30%">Effekt</th><th style="width:40%">So klingt es gut</th><th>Dateiname</th></tr>${fxRows}</table>
`, `
const q = document.getElementById('q');
q.addEventListener('input', () => {
  const v = q.value.trim().toLowerCase();
  document.querySelectorAll('tr[data-s]').forEach((r) => (r.style.display = !v || r.dataset.s.includes(v) ? '' : 'none'));
  document.querySelectorAll('tr.grp').forEach((g) => { let n = g.nextElementSibling, any = false; while (n && !n.classList.contains('grp')) { if (n.style.display !== 'none') any = true; n = n.nextElementSibling; } g.style.display = any ? '' : 'none'; });
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('.copy'); if (!b) return;
  navigator.clipboard.writeText(b.dataset.c).then(() => { b.textContent = '✓'; setTimeout(() => (b.textContent = '⧉'), 1200); });
});`);

fs.writeFileSync(path.join(ROOT, 'Anleitung.html'), anleitung);
fs.writeFileSync(path.join(ROOT, 'Sprachliste.html'), sprachliste);
console.log('Anleitung.html und Sprachliste.html erzeugt.');

// ---------- Download page for GitHub Pages (docs/index.html) ----------
const { version, repo } = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
const configured = repo && !repo.startsWith('DEIN-GITHUB-NAME');
const repoUrl = configured ? `https://github.com/${repo}` : '#';
const DOCS = path.join(ROOT, 'docs');
fs.mkdirSync(path.join(DOCS, 'img'), { recursive: true });
const shots = [['v5-home-wizard.jpg', 'Übersicht'], ['v5-studio-wizard.jpg', 'Aufnahme-Studio'], ['v5.3-bibliothek-aktiv.jpg', 'Bibliothek mit aktivem Mod'], ['v5-home-light.jpg', 'Design „Hell“']];
for (const [f] of shots) {
  const src = path.join(ROOT, 'Projektverlauf', 'img', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DOCS, 'img', f));
}
fs.copyFileSync(path.join(ROOT, 'ui', 'icon-emblem.svg'), path.join(DOCS, 'img', 'emblem.svg'));
fs.copyFileSync(path.join(ROOT, 'Anleitung.html'), path.join(DOCS, 'anleitung.html'));
fs.copyFileSync(path.join(ROOT, 'Sprachliste.html'), path.join(DOCS, 'sprachliste.html'));
const site = page('Hexcall', 'Sound-Mods für World of Tanks', `
<p class="lead">Nimm deine eigene Commander-Stimme und eigene Effekte mit dem Mikrofon auf und aktiviere sie mit einem Klick im Spiel.
Kostenlos, ohne Wwise, alles läuft lokal auf deinem PC.</p>
<div class="bar">
  <a class="btn" id="dlSetup" href="${repoUrl}/releases/latest" style="display:inline-grid;place-items:center;text-decoration:none">⬇ Herunterladen (Windows)</a>
  <a class="btn ghost" id="dlZip" href="${repoUrl}/releases/latest" style="display:inline-grid;place-items:center;text-decoration:none">ZIP (ohne Installation)</a>
  <span class="count" id="dlVer">Version ${esc(version)}</span>
</div>
<div class="cards">
  <div class="card"><h3>🎙 Aufnahme-Studio</h3><p>Alle 55 Ansagen Schritt für Schritt einsprechen. Stille und Klicks werden automatisch entfernt.</p></div>
  <div class="card"><h3>💥 Effekte</h3><p>Kanone, Motor, Turm, Ketten, Explosionen und Feuer, für deinen Panzer und für andere.</p></div>
  <div class="card"><h3>🔁 Zwei Stimmen</h3><p>Im Spiel über „nationale Besatzungsstimmen“ zwischen zwei eigenen Stimmen umschalten.</p></div>
  <div class="card"><h3>⬆ Automatische Updates</h3><p>Der Client meldet neue Versionen und aktualisiert sich mit einem Klick.</p></div>
</div>
<h2><span class="n">▶</span>So sieht es aus</h2>
<div class="cards">${shots.map(([f, t]) => `<div class="card" style="padding:8px"><img src="img/${f}" alt="${esc(t)}" style="width:100%;border-radius:8px;display:block"><p style="margin:8px 4px 2px">${esc(t)}</p></div>`).join('')}</div>
<h2><span class="n">?</span>Installation</h2>
<ol class="steps">
  <li>Installer herunterladen und ausführen. Alternativ das ZIP entpacken und <b>Hexcall.vbs</b> starten.</li>
  <li>Falls Windows warnt („Der Computer wurde durch Windows geschützt“): <b>Weitere Informationen → Trotzdem ausführen</b>. Das Programm ist nicht signiert.</li>
  <li>Im Client unter <b>Im Spiel aktiv</b> erst den <b>Testton</b> ausprobieren, dann eigenen Sound-Mod erstellen.</li>
</ol>
<p><a href="anleitung.html">Ausführliche Anleitung</a> · <a href="sprachliste.html">Sprachliste</a>${configured ? ` · <a href="${repoUrl}">Quellcode auf GitHub</a>` : ''}</p>
<div class="note">Fan-Projekt, nicht mit Wargaming verbunden. Es werden keine Spieldateien verbreitet, die Sounds entstehen lokal aus deiner WoT-Installation.
Voraussetzungen: Windows 10/11, World of Tanks (Wargaming-Client EU/NA/ASIA).</div>
`, configured ? `
fetch('https://api.github.com/repos/${repo}/releases/latest').then((r) => r.ok ? r.json() : null).then((rel) => {
  if (!rel) return;
  const a = rel.assets || [];
  const setup = a.find((x) => /Setup.*\\.exe$/i.test(x.name)), zip = a.find((x) => /^Hexcall-.*\\.zip$/i.test(x.name));
  if (setup) document.getElementById('dlSetup').href = setup.browser_download_url;
  if (zip) document.getElementById('dlZip').href = zip.browser_download_url;
  document.getElementById('dlVer').textContent = 'Version ' + String(rel.tag_name).replace(/^v/, '');
}).catch(() => {});` : '');
fs.writeFileSync(path.join(DOCS, 'index.html'), site);
console.log(`Download-Seite docs/index.html erzeugt${configured ? '' : ' (Repository noch nicht eingetragen)'}.`);
