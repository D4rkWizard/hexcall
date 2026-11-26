'use strict';
// Hexcall UI translation. The interface is written in German; for English every visible text
// (static HTML, toasts, dialogs, titles) is translated on the fly by a DOM observer.
// Language: settings.lang ("en" default on first start, then remembered).

const I18N = (() => {
  const EN = {
    // navigation & frame
    'Übersicht': 'Overview', 'Meine Mods': 'My Mods', 'Aufnahme-Studio': 'Recording Studio', 'Im Spiel aktiv': 'Active in Game',
    'Einstellungen': 'Settings', 'Hilfe': 'Help', 'Prüfe Spiel …': 'Checking game …', 'WoT läuft': 'WoT running',
    'WoT nicht gestartet': 'WoT not running', 'WoT nicht gefunden': 'WoT not found', 'Eingeloggt in World of Tanks': 'Logged in to World of Tanks',
    'Was ist neu? – Changelog öffnen': "What's new? – open changelog",
    // banners
    'Update verfügbar': 'Update available', 'Was ist neu?': "What's new?", 'Jetzt aktualisieren': 'Update now', 'Später': 'Later',
    'World of Tanks nicht gefunden': 'World of Tanks not found', 'Bitte unter Einstellungen den WoT-Ordner wählen.': 'Please choose the WoT folder in Settings.',
    'Zu den Einstellungen': 'Go to Settings',
    'Verbindung zum Hintergrunddienst unterbrochen – verbinde neu …': 'Connection to the background service lost – reconnecting …',
    'Keine Verbindung zum Hintergrunddienst – verbinde neu …': 'No connection to the background service – reconnecting …',
    // home
    'Eigene Crew. Eigene Stimme.': 'Your crew. Your voice.',
    'Nimm Kommandanten-Ansagen und Effekte direkt mit dem Mikrofon auf und aktiviere sie mit einem Klick im Spiel.': 'Record commander callouts and sound effects straight from your microphone and switch them on in game with one click.',
    'Neuen Sound-Mod erstellen': 'Create new sound mod', 'Aktive Sounds': 'Active sounds', 'Zuletzt bearbeitet': 'Recently edited', 'Alle Mods': 'All mods',
    'a': 'a', 'production': 'production',
    // slots
    'Stimme · Slot 1': 'Voice · Slot 1', 'Stimme · Slot 2': 'Voice · Slot 2', 'Effekte': 'Effects', 'Stimme': 'Voice', 'Effekt': 'Effect',
    'Nationale Stimmen im Spiel aus': 'National voices off in game', 'Nationale Stimmen im Spiel an': 'National voices on in game',
    'Kanone, Motor, Turm, Ketten …': 'Gun, engine, turret, tracks …', 'Original (WoT)': 'Original (WoT)', 'Testton (Piep)': 'Test tone (beep)',
    'Testton aktiv': 'Test tone active', 'Mod aus – Original': 'Mod off – original', 'Wieder einschalten': 'Turn back on',
    'Mod aus (alles Original)': 'Mod off (all original)', 'Aktuell:': 'Current:', 'Steuerung': 'Control',
    'Zwei Stimmen im Spiel umschalten': 'Switch between two voices in game', 'Fehlende Sätze stumm statt Originalstimme': 'Mute missing lines instead of original voice',
    'Anwenden': 'Apply', 'Protokoll': 'Log', 'Stimme Slot 1': 'Voice slot 1', 'Stimme Slot 2': 'Voice slot 2',
    // library
    'Bibliothek': 'Library', 'Meine Sound-Mods': 'My sound mods', 'Neuer Sound-Mod': 'New sound mod', 'Stimme und Effekte aufnehmen': 'Record voice and effects',
    'nicht aktiv': 'not active', 'AKTIV': 'ACTIVE', 'Aufnehmen': 'Record', 'Aktivieren': 'Activate', 'Deaktivieren': 'Deactivate',
    'Ordner öffnen': 'Open folder', '1 Datei': '1 file',
    // studio
    'Wähle einen Sound-Mod aus oder erstelle einen neuen, um mit der Aufnahme zu beginnen.': 'Pick a sound mod or create a new one to start recording.',
    'Öffnen': 'Open', 'Neu': 'New', 'Aufnehmen (Leertaste)': 'Record (space bar)', 'Bereit – Leertaste oder Knopf drücken': 'Ready – press space or the button',
    '● Aufnahme läuft – Leertaste zum Stoppen': '● Recording – press space to stop',
    'Als zusätzliche Variante speichern (das Spiel wählt zufällig)': 'Save as an additional variant (the game picks one at random)',
    'Aufnahmen': 'Recordings', 'Datei hierher ziehen': 'Drop a file here', '– WAV, MP3, M4A oder OGG': '– WAV, MP3, M4A or OGG',
    'oder': 'or', 'Datei auswählen': 'choose a file', 'Zurück': 'Back', 'Überspringen': 'Skip', 'Weiter': 'Next', 'Studio schließen': 'Close studio',
    'Fertig – im Spiel aktivieren': 'Done – activate in game', 'Anhören': 'Play', 'Löschen': 'Delete',
    'Sprich den Satz – oder deine eigene Version – kurz und deutlich ein.': 'Say the line – or your own version – short and clear.',
    'noch offen – bleibt sonst original': 'still open – otherwise stays original', '1 Aufnahme': '1 recording',
    'Noch keine Aufnahme. Drück den roten Knopf oder die Leertaste.': 'No recording yet. Press the red button or the space bar.',
    'Gefechtsbeginn': 'Battle start', 'Deine Treffer': 'Your hits', 'Zielerfassung': 'Targeting', 'Schäden am Panzer': 'Damage to your tank',
    'Besatzung': 'Crew', 'Zug': 'Platoon', 'Waffen': 'Weapons', 'Fahrzeug': 'Vehicle', 'Explosionen & Feuer': 'Explosions & fire',
    '– noch keine Mods –': '– no mods yet –',
    // settings
    'Design': 'Theme', 'Wähle das Farbschema des Clients.': 'Choose the colour scheme of the client.', 'Dunkel mit Lila-Glow': 'Dark with purple glow',
    'Dark Mode mit Bernstein': 'Dark mode with amber', 'Hell': 'Light', 'White Mode': 'Light mode',
    'Wo dein Spiel installiert ist. Wird normalerweise automatisch gefunden.': 'Where your game is installed. Usually detected automatically.',
    'Spielordner': 'Game folder', 'Automatisch suchen': 'Detect automatically', 'Ordner wählen …': 'Choose folder …', 'Nicht gefunden': 'Not found',
    'Bitte den Ordner wählen, in dem WoT installiert ist': 'Please choose the folder WoT is installed in',
    'Version & Updates': 'Version & updates', 'Beim Start wird automatisch nach Updates gesucht.': 'Updates are checked automatically on start.',
    'Nach Updates suchen': 'Check for updates', 'Suche …': 'Checking …',
    'Deine Mods und Einstellungen liegen in': 'Your mods and settings are stored in', 'und bleiben bei Updates erhalten.': 'and are kept when updating.',
    'Anzeige': 'Display', 'Animationen': 'Animations', 'Schallwellen, Glut und Übergänge': 'Sound waves, embers and transitions',
    'Sprache': 'Language', 'Sprache des Clients.': 'Language of the client.',
    'Update-Prüfung ist noch nicht eingerichtet (kein GitHub-Repository in version.json).': 'Update check is not set up yet (no GitHub repository in version.json).',
    'Noch kein Release auf GitHub veröffentlicht.': 'No release published on GitHub yet.',
    // help
    "So funktioniert's": 'How it works', 'Ausführliche Anleitung': 'Full guide', 'Sprachliste': 'Line list', 'Anleitung': 'Guide', 'Changelog': 'Changelog',
    'Testen': 'Test', 'Effekte ': 'Effects ', 'Aktivieren ': 'Activate ', 'Tipps': 'Tips',
    // dialogs & toasts
    'Wie soll dein Sound-Mod heißen?': 'What should your sound mod be called?', 'Abbrechen': 'Cancel', 'Erstellen': 'Create',
    'Dieser Mod hat noch keine Aufnahmen.': 'This mod has no recordings yet.', 'Slot 2 (National)': 'Slot 2 (National)', 'Slot 1 (Standard)': 'Slot 1 (Standard)',
    'World of Tanks läuft': 'World of Tanks is running',
    'Die neuen Sounds greifen sicher erst nach einem Neustart des Spiels (evtl. schon ab dem nächsten Gefecht). Trotzdem anwenden?': 'The new sounds are guaranteed to work after restarting the game (maybe already from the next battle). Apply anyway?',
    'Baue Sound-Banken …': 'Building sound banks …', 'Angewendet. Wirkt ab dem nächsten Gefecht.': 'Applied. Takes effect from the next battle.',
    'Fehler beim Bauen – siehe Protokoll': 'Build failed – see log', 'Mod ausschalten?': 'Turn mod off?',
    'Alle Slots werden auf die Original-Sounds von WoT zurückgesetzt. Deine Aufnahmen bleiben erhalten.': 'All slots are reset to the original WoT sounds. Your recordings are kept.',
    'Alles Original': 'All original', 'Schalte wieder ein …': 'Turning back on …', 'Wieder eingeschaltet. Wirkt ab dem nächsten Gefecht.': 'Turned back on. Takes effect from the next battle.',
    'Fehler – siehe Protokoll': 'Error – see log', 'Kann die Datei nicht abspielen': "Can't play this file", 'Aufnahme löschen?': 'Delete recording?',
    'Stimme fertig! 🎖': 'Voice done! 🎖', 'Willst du noch weitere Sounds erstellen – Kanone, Motor, Turm, Ketten, Explosionen …?': 'Do you want to create more sounds – gun, engine, turret, tracks, explosions …?',
    'Nein, fertig': "No, I'm done", 'Ja, weitere Sounds': 'Yes, more sounds',
    'Kein Zugriff aufs Mikrofon. Bitte im Fenster erlauben und prüfen, ob ein Mikrofon angeschlossen ist.': 'No microphone access. Please allow it in the window and check that a microphone is connected.',
    'Nichts Hörbares aufgenommen – ist das richtige Mikrofon aktiv?': 'Nothing audible recorded – is the right microphone active?',
    'Keine WoT-Installation gefunden. Bitte den Ordner selbst wählen.': 'No WoT installation found. Please choose the folder yourself.',
    'Ordner-Auswahl geöffnet …': 'Folder picker opened …', 'In diesem Ordner ist kein World of Tanks (version.xml fehlt).': 'There is no World of Tanks in this folder (version.xml missing).',
    'WoT-Ordner gespeichert': 'WoT folder saved', 'Lade Update herunter und prüfe es …': 'Downloading and verifying update …',
    'Das Update wird heruntergeladen und geprüft. Danach schließt sich der Client kurz und startet neu.\nDeine Mods und Einstellungen bleiben erhalten.': 'The update is downloaded and verified. The client then closes briefly and restarts.\nYour mods and settings are kept.',
    'Backend nicht erreichbar. Bitte über „Sound-Mod-Manager.cmd“ starten.': 'Backend not reachable. Please start Hexcall via its shortcut.',
    // server messages
    'World of Tanks wurde nicht gefunden. Bitte unter Einstellungen den WoT-Ordner wählen.': 'World of Tanks was not found. Please choose the WoT folder in Settings.',
    'Ungültiger Name': 'Invalid name', 'Den Namen gibt es schon': 'That name already exists',
    'Es gibt keinen gespeicherten Zustand zum Wiedereinschalten.': 'There is no saved state to turn back on.',
    'Du hast bereits die aktuelle Version.': 'You already have the latest version.', 'Prüfsumme stimmt nicht – Update abgebrochen.': 'Checksum mismatch – update cancelled.',
    // v6.1: reload button, dropdowns, WoT update, auto update
    'geändert': 'changed', 'Im Spiel:': 'In game:', 'Original-Sounds von WoT': 'Original WoT sounds', 'Piepton zum Testen': 'Beep for testing',
    'Änderungen noch nicht übernommen': 'Changes not applied yet', 'Alles übernommen': 'Everything applied', 'Verwerfen': 'Discard', 'Neu laden': 'Reload',
    'Baut die Sound-Banken mit deiner Auswahl neu. Im Spiel ab dem nächsten Gefecht hörbar.': 'Rebuilds the sound banks with your selection. Audible in game from the next battle.',
    'World of Tanks wurde aktualisiert': 'World of Tanks was updated', 'Sounds wieder einschalten': 'Turn sounds back on',
    'Automatische Updates': 'Automatic updates', 'Neue Versionen beim Start sofort installieren statt nur Bescheid zu geben': 'Install new versions right away on start instead of just telling you',
    'Mehr Sprachen, Neu-laden-Knopf & Update-Warnung': 'More languages, reload button & update warning',
    'Russisch, Polnisch, Französisch und Spanisch': 'Russian, Polish, French and Spanish',
    '„Im Spiel aktiv“: blauer Neu-laden-Knopf, leuchtet bei Änderungen': '"Active in Game": blue reload button that lights up on changes',
    'Eigene Aufklapp-Menüs im Hexcall-Design': 'Own dropdown menus in the Hexcall style',
    'Warnung bei veralteter Version, auf Wunsch automatische Updates': 'Warning for outdated versions, automatic updates if you like',
    'Hinweis nach WoT-Updates mit „Sounds wieder einschalten“': 'Notice after WoT updates with "Turn sounds back on"',
    "WoT starten": "Start WoT",
    "World of Tanks starten": "Start World of Tanks",
    "Starte World of Tanks …": "Starting World of Tanks …",
    "Starte WoT neu …": "Restarting WoT …",
    "Nur anwenden": "Apply only",
    "Anwenden & WoT neu starten": "Apply & restart WoT",
    "WoT lädt die Sounds beim Spielstart. Zuverlässig hörst du die neuen Sounds erst nach einem Neustart des Spiels. Soll Hexcall WoT dafür neu starten? (Nicht mitten im Gefecht!)": "WoT loads its sounds when the game starts. You will reliably hear the new sounds only after restarting the game. Should Hexcall restart WoT for you? (Not in the middle of a battle!)",
    "World of Tanks konnte nicht gestartet werden (WorldOfTanks.exe fehlt).": "World of Tanks could not be started (WorldOfTanks.exe missing).",
    "Neu: WoT direkt aus dem Client starten bzw. nach „Neu laden“ neu starten": "New: start WoT from the client, or restart it after \"Reload\"",
    'Alles auch auf Englisch': 'English everywhere', 'Anleitung und Sprachliste auch auf Englisch': 'Guide and line list also in English',
    'Behoben: einige englische Texte blieben deutsch': 'Fixed: some English texts stayed German',
    "Stimme · Standard": "Voice · Standard",
    "Stimme · Kommandant": "Voice · Commander",
    "Stimme Standard": "Voice Standard",
    "Stimme Kommandant": "Voice Commander",
    "WoT-Sprachausgabe „Standard“": "WoT voice-over \"Standard\"",
    "WoT-Sprachausgabe „Kommandant“": "WoT voice-over \"Commander\"",
    "Kommandant": "Commander",
    "Standard": "Standard",
    "Standard oder Kommandant": "Standard or Commander",
    "Angewendet. Wirkt nach einem Neustart von WoT.": "Applied. Takes effect after restarting WoT.",
    "Wieder eingeschaltet. Wirkt nach einem Neustart von WoT.": "Turned back on. Takes effect after restarting WoT.",
    "Baut die Sound-Banken mit deiner Auswahl neu. Im Spiel nach einem Neustart von WoT hörbar.": "Rebuilds the sound banks with your selection. Audible in game after restarting WoT.",
    "Standard & Kommandant": "Standard & Commander",
    "Slots heißen wie in WoT: Standard und Kommandant": "Slots are named like in WoT: Standard and Commander",
    "Eigener Testton für Kommandant (drei Pieptöne)": "Own test tone for Commander (three beeps)",
    "Hinweis: Neue Sounds wirken nach einem Neustart von WoT": "Note: new sounds take effect after restarting WoT",
    // changelog entries
    'Bereit zum Veröffentlichen': 'Ready for release', 'Anleitung & Sprachliste für Windows': 'Guide & line list for Windows',
    'Aktiver Mod & Wieder einschalten': 'Active mod & turn back on', 'Stabilität & Feinschliff': 'Stability & polish', 'Kleines Changelog': 'Small changelog',
    'DarkWizard Edition': 'DarkWizard Edition', 'Sound Commander Client': 'Sound Commander client', 'Aufnahme-Assistent & Effekte': 'Recording assistant & effects',
    'Stimmen-Manager': 'Voice manager', 'Sound-Bank-Tool': 'Sound bank tool',
    'Saubere Aufnahmen: kein Knacken mehr, Stille und Klicks werden sofort entfernt': 'Clean recordings: no more crackling, silence and clicks removed right away',
    'Update-Prüfung über GitHub mit Ein-Klick-Update': 'Update check via GitHub with one-click update',
    'WoT-Ordner wird automatisch gefunden oder kann gewählt werden': 'WoT folder is detected automatically or can be chosen',
    'Mods und Einstellungen liegen jetzt in %APPDATA%\\SoundCommander': 'Mods and settings now live in %APPDATA%\\Hexcall',
    'Neuer Name: Hexcall · Sprache Englisch/Deutsch': 'New name: Hexcall · English/German language',
    'Anleitung.html und Sprachliste.html: Doppelklick öffnet sie im Browser': 'Guide.html and line list: double-click opens them in the browser',
    'Sprachliste mit Suche, Kopier-Knopf und Druckansicht': 'Line list with search, copy button and print view', 'Links dazu unter Hilfe': 'Links under Help',
    'Aktiver Mod in der Bibliothek grün markiert und oben einsortiert': 'Active mod highlighted green and sorted first in the library',
    'Aktivieren/Deaktivieren direkt auf der Mod-Karte': 'Activate/deactivate right on the mod card',
    'Nach „Mod aus“: Wieder einschalten mit einem Klick': 'After "Mod off": turn back on with one click',
    'Behoben: „Failed to fetch“ – Hintergrunddienst bleibt aktiv': 'Fixed: "Failed to fetch" – background service stays alive',
    'WoT-Spielername in der Seitenleiste': 'WoT player name in the sidebar', 'Anzeige „Mod aktiv“': '"Mod active" indicator',
    'Changelog unter Hilfe, Versionsnummer in der Seitenleiste': 'Changelog under Help, version number in the sidebar',
    'DarkWizard-Emblem, Wasserzeichen und Profil': 'DarkWizard emblem, watermark and profile', 'Designs: DarkWizard, Commander, Hell': 'Themes: DarkWizard, Commander, Light',
    'Einstellungen-Seite': 'Settings page', 'Neue Oberfläche als eigenes Fenster': 'New interface in its own window',
    'Live-Pegel, Wellenformen, Drag & Drop für MP3/M4A/OGG': 'Live meter, waveforms, drag & drop for MP3/M4A/OGG',
    'Mikrofon-Aufnahme mit Überspringen': 'Microphone recording with skip', '12 Effekte: Kanone, Motor, Turm, Ketten …': '12 effects: gun, engine, turret, tracks …',
    'Erste Oberfläche, zwei Stimmen-Slots im Spiel umschaltbar': 'First interface, two voice slots switchable in game',
    'Eigene Commander-Stimme ohne Wwise, alle Nationen': 'Your own commander voice without Wwise, all nations',
  };

  Object.assign(EN, {
    'Original anhören': 'Listen to original', 'Lautstärke beim Anhören (ändert nichts im Spiel)': 'Playback volume (does not change anything in game)', 'So klingt es im Spiel ohne Mod': 'This is how it sounds in game without a mod',
    'Original-Sounds abspielen': 'Play original sounds', 'Herunterladen': 'Download', 'Abbrechen': 'Cancel',
    'WoT speichert seine Sounds in einem Format, das Hexhub erst umwandeln muss. Dafür wird einmalig das freie Programm vgmstream heruntergeladen (ca. 5 MB, von GitHub).':
      'WoT stores its sounds in a format Hexhub has to convert first. For that, the free program vgmstream is downloaded once (about 5 MB, from GitHub).',
    'Lade vgmstream herunter …': 'Downloading vgmstream …', 'vgmstream konnte nicht eingerichtet werden': 'vgmstream could not be set up',
    'Für diesen Schritt gibt es keinen Original-Sound.': 'There is no original sound for this step.',
  });

  // texts with variable parts
  const PATTERNS = [
    [/^· (\d+) Varianten$/, '· $1 variants'],
    [/^Mod aktiv: (.+)$/, 'Mod active: $1'],
    [/^Stellt wieder her: (.+)$/, 'Restores: $1'],
    [/^(\d+) Dateien$/, '$1 files'],
    [/^(\d+) Aufnahmen$/, '$1 recordings'],
    [/^Stimme (\d+) \/ (\d+)$/, 'Voice $1 / $2'],
    [/^Effekt (\d+) \/ (\d+)$/, 'Effect $1 / $2'],
    [/^(.+)  \((\d+) Ansagen\)$/, '$1  ($2 lines)'],
    [/^(.+)  \((\d+) Effekte\)$/, '$1  ($2 effects)'],
    [/^„(.+)“ aktivieren$/, 'Activate "$1"'],
    [/^Stimme: (\d+) von (\d+) Ansagen\nEffekte: (\d+) von (\d+)\n\nFür welche WoT-Sprachausgabe soll die Stimme gelten\?$/, 'Voice: $1 of $2 lines\nEffects: $3 of $4\n\nWhich WoT voice-over should the voice be used for?'],
    [/^Gespeichert: (.+)$/, 'Saved: $1'],
    [/^(.+): kein hörbarer Inhalt$/, '$1: no audible content'],
    [/^(.+): Format nicht lesbar$/, '$1: format not readable'],
    [/^Gefunden: (.+)$/, 'Found: $1'],
    [/^World of Tanks (.*) · automatisch erkannt oder von dir gewählt$/, 'World of Tanks $1 · detected automatically or chosen by you'],
    [/^Du hast die aktuelle Version \(v(.+)\)\.$/, 'You have the latest version (v$1).'],
    [/^Neue Version verfügbar: v(.+)$/, 'New version available: v$1'],
    [/^Update verfügbar: v(.+)$/, 'Update available: v$1'],
    [/^Du nutzt v(.+)\. Deine Mods und Einstellungen bleiben erhalten\.$/, "You're on v$1. Your mods and settings are kept."],
    [/^Auf v(.+) aktualisieren\?$/, 'Update to v$1?'],
    [/^v(.+) wird installiert – der Client startet gleich neu\.$/, 'v$1 is being installed – the client restarts in a moment.'],
    [/^Update-Prüfung nicht möglich: (.+)$/, 'Update check not possible: $1'],
    [/^(\d+) Ansagen$/, '$1 lines'],
    [/^(\d+) Effekte$/, '$1 effects'],
    [/^(.+) → (.+): Deine Sounds \((.+)\) sind deshalb gerade aus\.$/, '$1 → $2: your sounds ($3) are off because of that.'],
    [/^Achtung: veraltete Version \(v(.+)\)$/, 'Warning: outdated version (v$1)'],
    [/^v(.+) ist da\. Ohne Update funktioniert der Mod evtl\. nicht richtig – deine Mods und Einstellungen bleiben erhalten\.$/, "v$1 is out. Without updating, the mod may not work properly – your mods and settings are kept."],
    [/^Installiere v(.+) automatisch …$/, 'Installing v$1 automatically …'],
  ];

  // rich paragraphs (contain <b>/<i>): replaced as a whole
  const HTML = {
    'hero-h1': 'Your tank sounds<br>like <span class="accent">you</span>.',
    'slots-info': 'In WoT under <i>Settings › Sound</i>, choose the <i>voice-over</i>: <b>Standard</b> or <b>Commander</b>. With "Commander" you hear the voice of your commander\'s nation – special commanders (Battle Pass, bloggers, events) keep their own voice. New sounds take effect after restarting WoT.',
    'help-1': '<div class="num">1</div><h3>Test</h3><p>Under <b>Active in Game</b>, set everything to <b>Test tone</b> and click <b>Reload</b>. In the training room you will hear beeps instead of voice, gun and engine – two for "Standard", three for "Commander".</p>',
    'help-2': '<div class="num">2</div><h3>Record</h3><p>Create a new sound mod. The studio walks you through every callout. The <b>space bar</b> starts and stops the microphone. Anything you skip stays original.</p>',
    'help-3': '<div class="num">3</div><h3>Effects</h3><p>Switch to <b>Effects</b> at the top of the studio: gun, engine, turret, tracks, explosions … by microphone or by dropping a sound file.</p>',
    'help-4': '<div class="num">4</div><h3>Activate</h3><p><b>Done – activate in game</b> or pick the slots under <b>Active in Game</b> and press <b>Reload</b>. Takes effect after restarting WoT.</p>',
    'help-tips': '<b>Tips</b><p>Keep callouts short (0.5–2 s). Engine, turret, tracks and fire play in a loop: 2–4 s of steady sound. Silence at the start and end is cut automatically and the volume is levelled. Special crew voices (bloggers, events) are not replaced.</p>',
    'drop-text': '<b>Drop a file here</b> – WAV, MP3, M4A or OGG<br><span>or click anywhere in this box</span>',
  };

  // further languages (ui/i18n-langs.js): own dictionary, missing texts fall back to English
  const MORE = (typeof I18N_LANGS !== 'undefined' && I18N_LANGS) || {};
  const QUOTES = { de: ['„', '“'], en: ['"', '"'], ru: ['«', '»'], pl: ['„', '”'], fr: ['« ', ' »'], es: ['«', '»'] };
  let L = { dict: {}, patterns: [], html: {} };
  let lang = 'de';
  const original = new WeakMap(); // node -> German text (for elements we replaced as HTML)

  function tr(s) {
    if (lang === 'de' || typeof s !== 'string') return s;
    const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0], core = s.trim();
    if (!core) return s;
    const word = (k) => (L.dict[k] !== undefined ? L.dict[k] : EN[k]);
    if (word(core) !== undefined) return lead + word(core) + trail;
    const q = /^„(.+)“$/.exec(core);
    if (q && word(q[1]) !== undefined) return lead + quote(word(q[1])) + trail;
    for (const [re, rep] of [...L.patterns, ...PATTERNS]) if (re.test(core)) return lead + core.replace(re, rep) + trail;
    return s;
  }

  function translateNode(node) {
    if (lang === 'de') return;
    if (node.nodeType === 3) { const t = tr(node.data); if (t !== node.data) node.data = t; return; }
    if (node.nodeType !== 1) return;
    const k = node.dataset && node.dataset.i18nHtml, html = k && (L.html[k] || HTML[k]);
    if (html && !original.has(node)) {
      original.set(node, node.innerHTML);
      node.innerHTML = html;
    }
    for (const attr of ['title', 'placeholder']) {
      if (node.hasAttribute && node.hasAttribute(attr)) { const v = node.getAttribute(attr), t = tr(v); if (t !== v) node.setAttribute(attr, t); }
    }
    if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
    for (const c of node.childNodes) translateNode(c);
  }

  function start(l) {
    lang = l === 'de' || MORE[l] ? l : 'en';
    L = MORE[lang] || { dict: {}, patterns: [], html: {} };
    document.documentElement.lang = lang;
    if (lang === 'de') return;
    translateNode(document.body);
    document.title = tr(document.title);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') translateNode(m.target);
        else if (m.type === 'attributes') translateNode(m.target);
        else m.addedNodes.forEach(translateNode);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder'] });
  }

  function quote(t) { const [a, b] = QUOTES[lang] || QUOTES.en; return a + t + b; }

  return { start, tr, quote, get lang() { return lang; } };
})();
