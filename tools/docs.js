// Generates the Windows-friendly documentation in English and German:
// Guide.html + Lines.html (EN), Anleitung.html + Sprachliste.html (DE) and the download page docs/index.html.
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

const EN_STEPS = require('./events_en');
const today = (lang) => new Date().toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB');

function page(lang, title, eyebrow, body, script = '') {
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${esc(title)} – Hexcall</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head>
<body><div class="wrap">
<header>${EMBLEM}<div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1></div></header>
${body}
<footer>Hexcall · a DarkWizard production · ${lang === 'de' ? 'erstellt am' : 'generated on'} ${today(lang)}</footer>
</div>${script ? `<script>${script}</script>` : ''}</body></html>`;
}

// Text for both languages: T(de, en)
const docsFor = (lang) => {
  const T = (de, en) => (lang === 'de' ? de : en);
  const lines = T('Sprachliste.html', 'Lines.html');
  const other = T('<p class="count"><a href="Guide.html">English version</a></p>', '<p class="count"><a href="Anleitung.html">Deutsche Version</a></p>');

  // ---------- guide ----------
  const guide = page(lang, T('Anleitung', 'Guide'), T('Hexcall für World of Tanks', 'Hexcall for World of Tanks'), `
<p class="lead">${T('Eigene Commander-Stimme und eigene Effekte (Kanone, Motor, Turm …) für World of Tanks – aufgenommen mit deinem Mikrofon, aktiviert mit einem Klick. Kein Wwise nötig, alles läuft lokal.',
  'Your own commander voice and your own sound effects (gun, engine, turret …) for World of Tanks – recorded with your microphone, switched on with one click. No Wwise needed, everything runs locally.')}</p>
${other}
<nav class="toc">
  <a href="#start">Start</a><a href="#areas">${T('Bereiche', 'Areas')}</a><a href="#studio">${T('Aufnahme-Studio', 'Recording studio')}</a><a href="#slots">${T('Standard & Kommandant', 'Standard & Commander')}</a>
  <a href="#test">${T('Testen', 'Testing')}</a><a href="#tips">${T('Tipps', 'Tips')}</a><a href="#update">Updates</a><a href="#folders">${T('Ordner', 'Folders')}</a><a href="#limits">${T('Grenzen', 'Limits')}</a>
</nav>

<h2 id="start"><span class="n">1</span>Start</h2>
<ol class="steps">
  <li>${T('Über das Startmenü oder die Desktop-Verknüpfung <b>Hexcall</b> starten (ohne Installer: <b>Hexcall.vbs</b> im Programmordner). Der Client öffnet sich als eigenes Fenster.', 'Start <b>Hexcall</b> from the Start menu or the desktop shortcut (without the installer: <b>Hexcall.vbs</b> in the program folder). The client opens in its own window.')}</li>
  <li>${T('Beim ersten Aufnehmen fragt das Fenster nach dem Mikrofon: auf <b>Zulassen</b> klicken.', 'The first time you record, the window asks for the microphone: click <b>Allow</b>.')}</li>
  <li>${T('Fenster schließen beendet alles. Ein Hintergrunddienst läuft nur, solange das Fenster offen ist.', 'Closing the window stops everything. A background service only runs while the window is open.')}</li>
  <li>${T('WoT wird automatisch gefunden. Falls nicht: <b>Einstellungen → World of Tanks → Ordner wählen</b>.', 'WoT is detected automatically. If not: <b>Settings → World of Tanks → Choose folder</b>.')}</li>
  <li>${T('Sprache: Englisch, Deutsch, Russisch, Polnisch, Französisch oder Spanisch unter <b>Einstellungen → Sprache</b>.', 'Language: English, German, Russian, Polish, French or Spanish under <b>Settings → Language</b>.')}</li>
</ol>

<h2 id="areas"><span class="n">2</span>${T('Die Bereiche im Client', 'The areas of the client')}</h2>
<div class="cards">
  <div class="card"><h3>${T('Übersicht', 'Overview')}</h3><p>${T('Was gerade im Spiel aktiv ist, deine zuletzt bearbeiteten Mods und „Neuen Sound-Mod erstellen“.', 'What is active in game right now, your recently edited mods and "Create new sound mod".')}</p></div>
  <div class="card"><h3>${T('Meine Mods', 'My Mods')}</h3><p>${T('Alle Sound-Mods mit Fortschritt (Stimme x/55, Effekte x/12). Der aktive Mod ist grün markiert. Aufnehmen, Aktivieren/Deaktivieren, Ordner öffnen.', 'All sound mods with progress (voice x/55, effects x/12). The active mod is marked green. Record, activate/deactivate, open folder.')}</p></div>
  <div class="card"><h3>${T('Aufnahme-Studio', 'Recording Studio')}</h3><p>${T('Schritt für Schritt aufnehmen. Oben zwischen <b>Stimme</b> und <b>Effekte</b> wechseln.', 'Record step by step. Switch between <b>Voice</b> and <b>Effects</b> at the top.')}</p></div>
  <div class="card"><h3>${T('Im Spiel aktiv', 'Active in Game')}</h3><p>${T('Slots wählen (Mod, Original, Testton). Geänderte Slots werden markiert und der blaue Knopf <b>Neu laden</b> leuchtet auf – er baut die Sounds. <b>Mod aus</b> schaltet alles auf Original, <b>Wieder einschalten</b> holt den vorherigen Zustand zurück.', 'Choose the slots (mod, original, test tone). Changed slots are marked and the blue <b>Reload</b> button lights up – it builds the sounds. <b>Mod off</b> switches everything to original, <b>Turn back on</b> restores the previous state.')}</p></div>
  <div class="card"><h3>${T('Einstellungen', 'Settings')}</h3><p>${T('Sprache, Design (DarkWizard, Commander, Hell), WoT-Ordner, Updates (auf Wunsch automatisch), Animationen.', 'Language, theme (DarkWizard, Commander, Light), WoT folder, updates (automatic if you like), animations.')}</p></div>
  <div class="card"><h3>${T('Hilfe', 'Help')}</h3><p>${T('Kurzanleitung und ein kleines Changelog. Unten links: WoT-Status, <b>WoT starten</b> und – wenn WoT läuft – dein Spielername.', 'Quick guide and a small changelog. Bottom left: WoT status, <b>Start WoT</b> and – while WoT runs – your player name.')}</p></div>
</div>

<h2 id="studio"><span class="n">3</span>${T('Aufnahme-Studio', 'Recording studio')}</h2>
<ul class="dots">
  <li>${T('Jede Ansage mit Situation und Beispielsatz. Links die Liste, ein Häkchen zeigt erledigte Schritte.', 'Every callout with its situation and an example line. The list is on the left, a tick marks finished steps.')}</li>
  <li>${T('<b>Roter Knopf</b> oder <kbd>Leertaste</kbd>: Aufnahme starten und stoppen, mit Live-Pegel. Danach wird die Aufnahme sofort abgespielt.', '<b>Red button</b> or <kbd>Space</kbd>: start and stop recording, with a live meter. The take is played back right away.')}</li>
  <li>${T('<b>Überspringen</b>: Die Ansage bleibt im Spiel original.', '<b>Skip</b>: the callout stays original in game.')}</li>
  <li>${T('<b>Als zusätzliche Variante speichern</b>: mehrere Versionen pro Ansage, das Spiel wählt zufällig.', '<b>Save as an additional variant</b>: several versions per callout, the game picks one at random.')}</li>
  <li>${T('<b>Drag &amp; Drop</b>: WAV, MP3, M4A oder OGG einfach ins Fenster ziehen.', '<b>Drag &amp; drop</b>: simply drop WAV, MP3, M4A or OGG files into the window.')}</li>
  <li>${T('Nach der letzten Ansage fragt das Studio, ob du mit den Effekten weitermachen willst.', 'After the last callout the studio asks whether you want to continue with the effects.')}</li>
  <li>${T('<b>Fertig – im Spiel aktivieren</b> baut den Mod und schaltet ihn ein.', '<b>Done – activate in game</b> builds the mod and switches it on.')}</li>
</ul>
<p>${T('Welche Ansagen und Effekte es gibt, steht in der', 'All callouts and effects are listed in the')} <a href="${lines}">${T('Sprachliste', 'line list')}</a>.</p>

<h2 id="slots"><span class="n">4</span>${T('Zwei Stimmen: Standard und Kommandant', 'Two voices: Standard and Commander')}</h2>
<table>
  <tr><th>${T('Einstellung in WoT (Ton › Sprachausgabe)', 'WoT setting (Sound › voice-over)')}</th><th>${T('Was du hörst', 'What you hear')}</th></tr>
  <tr><td>Standard</td><td>${T('Stimme · Standard (Testton: zwei Pieptöne)', 'Voice · Standard (test tone: two beeps)')}</td></tr>
  <tr><td>${T('Kommandant', 'Commander')}</td><td>${T('Stimme · Kommandant (Testton: drei Pieptöne)', 'Voice · Commander (test tone: three beeps)')}</td></tr>
</table>
<p>${T('Bei „Kommandant“ nutzt WoT die Stimme der Nation deines Kommandanten. Spezial-Kommandanten (Battle Pass, Blogger, Events) haben eine eigene Stimme – mit ihnen hörst du weiter deren Original. ', 'With "Commander" WoT uses the voice of your commander\'s nation. Special commanders (Battle Pass, bloggers, events) have a voice of their own – with them you keep hearing their original. ')}${T('Effekte gelten immer. WoT lädt die Sounds beim Spielstart: Läuft das Spiel beim <b>Neu laden</b>, bietet Hexcall <b>Anwenden &amp; WoT neu starten</b> an.', 'Effects always apply. WoT loads its sounds when the game starts: if the game is running when you press <b>Reload</b>, Hexcall offers <b>Apply &amp; restart WoT</b>.')}</p>

<h2 id="test"><span class="n">5</span>${T('Testen', 'Testing')}</h2>
<ol class="steps">
  <li>${T('Unter <b>Im Spiel aktiv</b> alles auf <b>Testton (Piep)</b> stellen und <b>Neu laden</b>.', 'Under <b>Active in Game</b> set everything to <b>Test tone (beep)</b> and press <b>Reload</b>.')}</li>
  <li>${T('WoT starten (oder neu starten) und im Trainingsraum ein paar Schüsse abgeben und fahren.', 'Start (or restart) WoT and fire a few shots and drive around in the training room.')}</li>
  <li>${T('Statt Stimme, Kanone und Motor hörst du Pieptöne – zwei bei „Standard“, drei bei „Kommandant“. Dann funktioniert alles.', 'Instead of voice, gun and engine you hear beeps – two with "Standard", three with "Commander". Then everything works.')}</li>
</ol>

<h2 id="tips"><span class="n">6</span>${T('Tipps für gute Aufnahmen', 'Tips for good recordings')}</h2>
<div class="cards">
  <div class="card"><h3>${T('Stimme', 'Voice')}</h3><p>${T('Kurz halten: 0,5 bis 2 Sekunden. Deutlich, ruhig auch mal laut – es soll nach Gefecht klingen.', 'Keep it short: 0.5 to 2 seconds. Clear, and loud when it fits – it should sound like battle.')}</p></div>
  <div class="card"><h3>${T('Schleifen', 'Loops')}</h3><p>${T('Motor, Turm, Ketten und Feuer laufen in Schleife: 2–4 Sekunden gleichmäßiges Geräusch ohne Anfang und Ende. Die Motor-Tonhöhe ändert das Spiel selbst.', 'Engine, turret, tracks and fire play in a loop: 2–4 seconds of steady sound without a start or end. The game changes the engine pitch itself.')}</p></div>
  <div class="card"><h3>${T('Knall', 'Bangs')}</h3><p>${T('Kanone und Explosionen: ein kurzer, kräftiger Knall.', 'Gun and explosions: a short, punchy bang.')}</p></div>
  <div class="card"><h3>${T('Automatik', 'Automatic')}</h3><p>${T('Stille und Klicks am Anfang und Ende werden entfernt, die Lautstärke angeglichen, alles in 48 kHz ins Spiel gebaut.', 'Silence and clicks at the start and end are removed, the volume is levelled and everything is built into the game at 48 kHz.')}</p></div>
</div>

<h2 id="update"><span class="n">7</span>Updates</h2>
<p>${T('<b>Hexcall:</b> Beim Start prüft der Client, ob es eine neue Version gibt, und warnt bei einer veralteten Version mit <b>Jetzt aktualisieren</b>. Auf Wunsch installiert er Updates automatisch. Deine Mods bleiben erhalten.', '<b>Hexcall:</b> on start the client checks for a new version and warns you about an outdated one with <b>Update now</b>. If you like, it installs updates automatically. Your mods are kept.')}</p>
<p>${T('<b>World of Tanks:</b> Die Sounds liegen pro Spielversion in <code>res_mods\\&lt;Version&gt;</code>. Nach einem WoT-Update zeigt Hexcall einen Hinweis mit <b>Sounds wieder einschalten</b> – das baut deinen Stand für die neue Version.', '<b>World of Tanks:</b> the sounds live in <code>res_mods\\&lt;version&gt;</code> for each game version. After a WoT update Hexcall shows a notice with <b>Turn sounds back on</b> – this builds your setup for the new version.')}</p>

<h2 id="folders"><span class="n">8</span>${T('Ordner', 'Folders')}</h2>
<table>
  <tr><th>${T('Ordner / Datei', 'Folder / file')}</th><th>${T('Inhalt', 'Contents')}</th></tr>
  <tr><td><code>Hexcall.vbs</code></td><td>${T('Startet den Client (ohne Konsolenfenster)', 'Starts the client (without a console window)')}</td></tr>
  <tr><td><code>%APPDATA%\\Hexcall\\mods\\&lt;${T('Name', 'name')}&gt;\\stimme</code></td><td>${T('Deine Sprachaufnahmen', 'Your voice recordings')} (<a href="${lines}">${T('Sprachliste', 'line list')}</a>)</td></tr>
  <tr><td><code>%APPDATA%\\Hexcall\\mods\\&lt;${T('Name', 'name')}&gt;\\effekte</code></td><td>${T('Deine Effekte', 'Your effects')}</td></tr>
  <tr><td><code>%APPDATA%\\Hexcall\\user</code></td><td>${T('Einstellungen', 'Settings')}</td></tr>
  <tr><td><code>ui</code>, <code>tools</code>, <code>runtime</code></td><td>${T('Programmdateien (werden bei Updates ersetzt)', 'Program files (replaced on updates)')}</td></tr>
</table>
<details class="noprint"><summary><b>${T('Für Fortgeschrittene: Kommandozeile', 'Advanced: command line')}</b></summary>
<p>${T('In PowerShell im Programmordner:', 'In PowerShell in the program folder:')}</p>
<table>
  <tr><td><code>node tools\\build.js --profil "My Mod"</code></td><td>${T('Mod in alle Slots', 'Mod in all slots')}</td></tr>
  <tr><td><code>node tools\\build.js --standard "My Mod" --national original --effekte "My Mod"</code></td><td>${T('Slots einzeln', 'Slots one by one')}</td></tr>
  <tr><td><code>node tools\\build.js --deinstallieren</code></td><td>${T('Alles Original', 'Everything original')}</td></tr>
  <tr><td><code>node tools\\docs.js</code></td><td>${T('Anleitung und Sprachliste neu erzeugen', 'Regenerate guide and line list')}</td></tr>
</table></details>

<h2 id="limits"><span class="n">9</span>${T('Grenzen', 'Limits')}</h2>
<ul class="dots">
  <li>${T('Spezielle Besatzungsstimmen (Blogger, Events, Sabaton usw.) werden nicht ersetzt.', 'Special crew voices (bloggers, events, Sabaton etc.) are not replaced.')}</li>
  <li>${T('Motorsounds gibt es für die 14 Motortypen, die das Spiel aktuell nutzt.', 'Engine sounds cover the 14 engine types the game currently uses.')}</li>
  <li>${T('Nachladegeräusche und Treffer am eigenen Panzer sind (noch) nicht dabei.', 'Reload sounds and hits on your own tank are not included (yet).')}</li>
</ul>
`);

  // ---------- line list ----------
  const GROUPS = [[0, T('Gefechtsbeginn', 'Battle start')], [1, T('Deine Treffer', 'Your hits')], [17, T('Zielerfassung', 'Targeting')], [20, T('Schäden am Panzer', 'Damage to your tank')], [41, T('Besatzung', 'Crew')], [48, T('Zug', 'Platoon')]];
  const q = (s) => T(`„${s}“`, `"${s}"`);
  const copyT = T('Dateiname kopieren', 'Copy file name');
  let voiceRows = '';
  EVENTS.forEach(([key, whenDe, lineDe], i) => {
    const [whenEn, lineEn] = EN_STEPS.voice[key] || [whenDe, lineDe];
    const when = T(whenDe, whenEn), line = T(lineDe, lineEn);
    const g = GROUPS.find((x) => x[0] === i);
    if (g) voiceRows += `<tr class="grp"><td colspan="3">${esc(g[1])}</td></tr>`;
    voiceRows += `<tr data-s="${esc((key + ' ' + when + ' ' + line).toLowerCase())}"><td>${esc(when)}</td><td class="line">${esc(q(line))}</td>
    <td><span class="file">${esc(key)}.wav</span><button class="copy" data-c="${esc(key)}.wav" title="${copyT}">⧉</button></td></tr>`;
  });
  let fxRows = '';
  SFX.forEach(([key, labelDe, whenDe, hintDe]) => {
    const [labelEn, whenEn, hintEn] = EN_STEPS.effects[key] || [labelDe, whenDe, hintDe];
    const label = T(labelDe, labelEn), when = T(whenDe, whenEn), hint = T(hintDe, hintEn);
    fxRows += `<tr data-s="${esc((key + ' ' + label + ' ' + when + ' ' + hint).toLowerCase())}"><td><b>${esc(label)}</b><br>${esc(when)}</td><td>${esc(hint)}</td>
    <td><span class="file">${esc(key)}.wav</span><button class="copy" data-c="${esc(key)}.wav" title="${copyT}">⧉</button></td></tr>`;
  });
  const list = page(lang, T('Sprachliste', 'Line list'), T('Was du aufnehmen kannst', 'What you can record'), `
<p class="lead">${T(`Alle ${EVENTS.length} Ansagen und ${SFX.length} Effekte. Am einfachsten nimmst du sie direkt im <b>Aufnahme-Studio</b> des Clients auf – diese Liste hilft beim Vorbereiten oder wenn du fertige Sounddateien selbst in den Mod-Ordner legst.`,
  `All ${EVENTS.length} callouts and ${SFX.length} effects. The easiest way is to record them right in the client's <b>Recording Studio</b> – this list helps you prepare, or if you put finished sound files into the mod folder yourself.`)}</p>
${T('<p class="count"><a href="Lines.html">English version</a></p>', '<p class="count"><a href="Sprachliste.html">Deutsche Version</a></p>')}
<div class="note">${T('Dateien gehören nach <code>%APPDATA%\\Hexcall\\mods\\&lt;Name&gt;\\stimme</code> bzw. <code>…\\effekte</code> (im Client: Meine Mods → Ordner-Symbol). Varianten: <span class="file">name_2.wav</span>, <span class="file">name_3.wav</span> … – das Spiel wählt zufällig. Was fehlt, bleibt original. Die Beispielsätze sind nur Vorschläge.',
  'Files go into <code>%APPDATA%\\Hexcall\\mods\\&lt;name&gt;\\stimme</code> (voice) or <code>…\\effekte</code> (effects) – in the client: My Mods → folder icon. Variants: <span class="file">name_2.wav</span>, <span class="file">name_3.wav</span> … – the game picks one at random. Anything missing stays original. The example lines are only suggestions.')}</div>
<div class="bar"><input class="search" id="q" placeholder="${T('Suchen, z. B. „Kette“, „Feuer“, „Durchschlag“ …', 'Search, e.g. track, fire, penetration …')}"><button class="btn ghost" onclick="window.print()">${T('Drucken / als PDF', 'Print / save as PDF')}</button></div>
<nav class="toc"><a href="#voice">${T('Stimme', 'Voice')} (${EVENTS.length})</a><a href="#effects">${T('Effekte', 'Effects')} (${SFX.length})</a></nav>

<h2 id="voice"><span class="n">1</span>${T('Stimme', 'Voice')} <span class="count">(${EVENTS.length} ${T('Ansagen', 'callouts')})</span></h2>
<table id="t1"><tr><th style="width:30%">${T('Wann', 'When')}</th><th style="width:32%">${T('Beispielsatz', 'Example line')}</th><th>${T('Dateiname', 'File name')}</th></tr>${voiceRows}</table>

<h2 id="effects"><span class="n">2</span>${T('Effekte', 'Effects')} <span class="count">(${SFX.length})</span></h2>
<table id="t2"><tr><th style="width:30%">${T('Effekt', 'Effect')}</th><th style="width:40%">${T('So klingt es gut', 'How it sounds good')}</th><th>${T('Dateiname', 'File name')}</th></tr>${fxRows}</table>
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
  return { guide, list };
};

const de = docsFor('de'), en = docsFor('en');
fs.writeFileSync(path.join(ROOT, 'Anleitung.html'), de.guide);
fs.writeFileSync(path.join(ROOT, 'Sprachliste.html'), de.list);
fs.writeFileSync(path.join(ROOT, 'Guide.html'), en.guide);
fs.writeFileSync(path.join(ROOT, 'Lines.html'), en.list);
console.log('Guide.html, Lines.html (EN) and Anleitung.html, Sprachliste.html (DE) generated.');

// ---------- download page for GitHub Pages (docs/index.html, English) ----------
const { version, repo } = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
const configured = repo && !repo.startsWith('DEIN-GITHUB-NAME');
const repoUrl = configured ? `https://github.com/${repo}` : '#';
const DOCS = path.join(ROOT, 'docs');
fs.mkdirSync(path.join(DOCS, 'img'), { recursive: true });
const shots = [['v6.0-home-en.png', 'Overview'], ['v6.0-studio-en.jpg', 'Recording studio'], ['v6.1-reload-en.png', 'Active in game: changed slots and the Reload button'], ['v6.0-settings-en.jpg', 'Settings: language, WoT folder, updates']];
for (const [f] of shots) {
  const src = path.join(ROOT, 'Projektverlauf', 'img', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DOCS, 'img', f));
}
fs.copyFileSync(path.join(ROOT, 'ui', 'icon-emblem.svg'), path.join(DOCS, 'img', 'emblem.svg'));
for (const [f, out] of [['Guide.html', 'guide.html'], ['Lines.html', 'lines.html'], ['Anleitung.html', 'anleitung.html'], ['Sprachliste.html', 'sprachliste.html']]) {
  // links inside the copied pages point to the lower-case names used on the site
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/href="(Guide|Lines|Anleitung|Sprachliste)\.html"/g, (m, n) => `href="${n.toLowerCase()}.html"`);
  fs.writeFileSync(path.join(DOCS, out), html);
}
const site = page('en', 'Hexcall', 'Sound mods for World of Tanks', `
<p class="lead">Record your own commander voice and your own sound effects with your microphone and switch them on in game with one click.
Free, no Wwise, everything runs locally on your PC.</p>
<div class="bar">
  <a class="btn" id="dlSetup" href="${repoUrl}/releases/latest" style="display:inline-grid;place-items:center;text-decoration:none">⬇ Download (Windows)</a>
  <a class="btn ghost" id="dlZip" href="${repoUrl}/releases/latest" style="display:inline-grid;place-items:center;text-decoration:none">ZIP (no installation)</a>
  <span class="count" id="dlVer">Version ${esc(version)}</span>
</div>
<div class="cards">
  <div class="card"><h3>🎙 Recording studio</h3><p>Record all 55 callouts step by step. Silence and clicks are removed automatically.</p></div>
  <div class="card"><h3>💥 Effects</h3><p>Gun, engine, turret, tracks, explosions and fire – for your tank and for others.</p></div>
  <div class="card"><h3>🔁 Two voices</h3><p>One voice for the WoT voice-over "Standard", another one for "Commander".</p></div>
  <div class="card"><h3>🌍 6 languages</h3><p>English, German, Russian, Polish, French and Spanish. Automatic update check with one-click updates.</p></div>
</div>
<h2><span class="n">▶</span>Screenshots</h2>
<div class="cards">${shots.map(([f, t]) => `<div class="card" style="padding:8px"><img src="img/${f}" alt="${esc(t)}" style="width:100%;border-radius:8px;display:block"><p style="margin:8px 4px 2px">${esc(t)}</p></div>`).join('')}</div>
<h2><span class="n">?</span>Installation</h2>
<ol class="steps">
  <li>Download and run the installer. Or unzip the ZIP and start <b>Hexcall.vbs</b>.</li>
  <li>If Windows warns you ("Windows protected your PC"): <b>More info → Run anyway</b>. The program is not signed.</li>
  <li>In the client, try the <b>test tone</b> under <b>Active in Game</b> first, then create your own sound mod.</li>
</ol>
<p><a href="guide.html">Full guide</a> · <a href="lines.html">Line list</a> · <a href="anleitung.html">Anleitung (Deutsch)</a>${configured ? ` · <a href="${repoUrl}">Source code on GitHub</a>` : ''}</p>
<div class="note">Fan project, not affiliated with Wargaming. No game files are distributed – the sounds are built locally from your own WoT installation.
Requirements: Windows 10/11, World of Tanks (Wargaming client EU/NA/ASIA).</div>
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
console.log(`Download page docs/index.html generated${configured ? '' : ' (repository not set yet)'}.`);
