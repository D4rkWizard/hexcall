# Changelog – Hexcall

## v6.1 – 25.11.2026 – Mehr Sprachen, Neu-laden-Knopf & Update-Warnung
- Neue Sprachen: **Русский, Polski, Français, Español** (Oberfläche und alle 67 Aufnahme-Schritte)
- „Im Spiel aktiv“: Auswahl ist erst ein Entwurf – geänderte Slots werden markiert, der blaue **Neu laden**-Knopf leuchtet auf und baut die Sound-Banken neu; ohne Änderung bleibt er ausgegraut. „Verwerfen“ setzt die Auswahl zurück
- Eigene Aufklapp-Menüs im Hexcall-Design statt der Windows-Standardliste (Slots, Studio-Auswahl), Protokoll-Bereich passend gestaltet
- Beim Start: deutliche Warnung „veraltete Version – Mod funktioniert evtl. nicht richtig“ mit Update-Knopf; in den Einstellungen optional **automatische Updates**
- Nach einem WoT-Update: Hinweis, dass die Sounds aus sind, mit **Sounds wieder einschalten** (baut den alten Stand für die neue Spielversion)
- **WoT starten** direkt aus dem Client (unten links, wenn das Spiel nicht läuft); läuft WoT beim „Neu laden“, bietet Hexcall „Anwenden & WoT neu starten“ an – WoT lädt die Sound-Banken beim Spielstart

## v6.0 – 25.11.2026 – Hexcall: bereit zum Veröffentlichen
- Neuer Name: **Hexcall** (Hex = Zauber, Call = Callouts), Daten ziehen automatisch mit um
- Sprache Englisch/Deutsch in den Einstellungen – beim ersten Start Englisch, danach gespeichert
- Saubere Aufnahmen: Aufnahme im eigenen Audio-Thread mit festen 48 kHz (vorher Aussetzer bei 192-kHz-Geräten), keine Browser-Rauschunterdrückung mehr
- Stille und Klicks am Anfang/Ende werden sofort nach der Aufnahme entfernt, Lautstärke angeglichen, kurze Ein-/Ausblendung
- Hochwertige Abtastraten-Umrechnung (gefiltert statt gemittelt) und 48 kHz im Spiel
- Ganzes Drag-&-Drop-Feld anklickbar
- Update-Prüfung über GitHub Releases mit Ein-Klick-Update (Prüfsumme wird geprüft)
- WoT-Ordner wird automatisch gefunden (Registry, Game Center, übliche Pfade) oder kann gewählt werden
- Mods und Einstellungen liegen in %APPDATA%\Hexcall und bleiben bei Updates erhalten
- Release-Paket mit eingebautem Node.js, Start ohne Konsolenfenster, App-Icon, Installer-Skript, GitHub-Workflow und Download-Seite

## v5.4 – 25.11.2026 – Anleitung & Sprachliste für Windows
- README.md → Anleitung.html, SPRACHLISTE.md → Sprachliste.html (Doppelklick öffnet sie formatiert im Browser)
- Sprachliste mit Suche, Kopier-Knopf und Druckansicht/PDF
- Erzeugt aus den Programmdaten mit `node tools\docs.js`
- Links „Ausführliche Anleitung“ und „Sprachliste“ unter Hilfe im Client

## v5.3 – 25.11.2026 – Aktiver Mod & Wieder einschalten
- Bibliothek: aktiver Mod grün markiert mit „AKTIV“-Abzeichen, seinen Slots und ganz vorne einsortiert
- Aktivieren/Deaktivieren direkt auf der Mod-Karte
- „Mod aus“ merkt sich den Zustand, danach stellt „Wieder einschalten“ ihn mit einem Klick wieder her

## v5.2 – 25.11.2026 – Stabilität & Feinschliff
- Behoben: „Failed to fetch“ – Backend beendete sich bei gedrosseltem Fenster; jetzt Wächter im Starter, der es am Leben hält und neu startet
- Verbindungshinweis statt Fehlermeldung bei kurzer Unterbrechung
- „Mod aktiv“-Anzeige neben „Mod aus“, WoT-Spielername in der Seitenleiste, wenn WoT läuft
- Gamer-Profil entfernt, Wasserzeichen fest

## v5.1 – 25.11.2026 – Kleines Changelog im Client
- Unauffälliger Reiter „Changelog“ auf der Hilfe-Seite (Kurzfassung, dieser Verlauf bleibt extern)
- Versionsnummer in der Seitenleiste öffnet das Changelog

## v5.0 – 25.11.2026 – DarkWizard Edition
- DarkWizard-Emblem (eigenes Design) als Logo, im Banner und als Wasserzeichen
- Drei Designs: DarkWizard (Lila, Standard), Commander (Dark/Bernstein), Hell (White Mode)
- Einstellungen: Design, Gamertag, Profilbild, Wasserzeichen und Animationen an/aus
- Profil-Karte in der Seitenleiste
- Externer Projektverlauf mit Screenshots (dieser Ordner)

## v4.0 – 25.11.2026 – Sound Commander Client
- Neue Oberfläche als eigenes Fenster (Edge-App-Modus) mit lokalem Node-Backend
- Übersicht, Meine Mods, Aufnahme-Studio, Im Spiel aktiv, Hilfe
- Live-Pegel und Wellenform beim Aufnehmen, Drag & Drop für WAV, MP3, M4A und OGG
- WoT-Update auf 2.4.1.1 erkannt, Testtöne neu installiert
- Backup des alten Stands: `backups/WoT-Mod_vor-Redesign_2026-11-25.zip`

## v3.0 – 25.11.2026 – Aufnahme-Assistent & Effekte
- Mikrofon-Aufnahme, Überspringen, Varianten, Drag & Drop (WAV)
- 12 Effekt-Kategorien aus 8 weiteren Sound-Banken, dritter Slot „Effekte“
- Mods als Ordner `mods/<Name>/stimme` und `mods/<Name>/effekte`

## v2.1 – 25.11.2026
- Echte Umlaute im Manager (UTF-8 mit BOM)

## v2.0 – 25.11.2026 – Stimmen-Manager
- Erstes Fenster mit Buttons, mehrere Stimmen als Profile
- Zwei Slots, umschaltbar über die Spieloption „nationale Besatzungsstimmen“

## v1.1 – 25.11.2026
- Alle 12 Stimm-Banken (Standard + 11 Nationen), Testton-Modus, Deinstallation

## v1.0 – 25.11.2026 – Sound-Bank-Tool
- Lesen und Schreiben der Wwise-Banken ohne Wwise, bitgenaue Reproduktion
- 55 Sprach-Events / 595 Sounds zugeordnet, Sprachliste, Build per Kommandozeile
