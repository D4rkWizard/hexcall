# Changelog – Hexcall

## v6.1.1 – 2026-11-25 – English everywhere
- Guide and line list now also in English (Guide.html, Lines.html) – the client opens them in your language
- README, changelog, release notes, installer and download page in English
- Fixed: some English texts stayed German ("0 Effekte", WoT update notice, outdated-version warning)

## v6.1 – 2026-11-25 – More languages, reload button & update warning
- New languages: **Русский, Polski, Français, Español** (interface and all 67 recording steps)
- "Active in Game": your selection is a draft until you apply it – changed slots are marked, the blue **Reload** button lights up and rebuilds the sound banks; without changes it stays greyed out. "Discard" resets the selection
- Own dropdown menus in the Hexcall style instead of the plain Windows list (slots, studio picker); restyled log section
- On start: clear warning "outdated version – the mod may not work properly" with an update button; optional **automatic updates** in the settings
- After a WoT update: a notice that your sounds are off, with **Turn sounds back on** (rebuilds your previous setup for the new game version)
- **Start WoT** right from the client (bottom left, while the game is not running); if WoT is running when you press "Reload", Hexcall offers "Apply & restart WoT" – WoT loads the sound banks when the game starts

## v6.0 – 2026-11-25 – Hexcall: ready for release
- New name: **Hexcall** (hex = spell, call = callouts); your data moves over automatically
- English/German language in the settings – English on first start, then remembered
- Clean recordings: capture on its own audio thread at a fixed 48 kHz (previously dropouts on 192 kHz devices), no browser noise suppression any more
- Silence and clicks at the start/end are removed right after recording, volume levelled, short fade in/out
- High-quality sample-rate conversion (filtered instead of averaged) and 48 kHz in game
- The whole drag & drop area is clickable
- Update check via GitHub Releases with one-click update (checksum verified)
- WoT folder is detected automatically (registry, Game Center, common paths) or can be chosen
- Mods and settings live in %APPDATA%\Hexcall and are kept on updates
- Release package with bundled Node.js, start without a console window, app icon, installer script, GitHub workflow and download page

## v5.4 – 2026-11-25 – Guide & line list for Windows
- README.md → Anleitung.html, SPRACHLISTE.md → Sprachliste.html (double-click opens them formatted in the browser)
- Line list with search, copy button and print view/PDF
- Generated from the program data with `node tools\docs.js`
- Links "Full guide" and "Line list" under Help in the client

## v5.3 – 2026-11-25 – Active mod & turn back on
- Library: the active mod is marked green with an "ACTIVE" badge and its slots, and sorted first
- Activate/deactivate right on the mod card
- "Mod off" remembers the state, then "Turn back on" restores it with one click

## v5.2 – 2026-11-25 – Stability & polish
- Fixed: "Failed to fetch" – the backend stopped when the window was throttled; now a watchdog in the launcher keeps it alive and restarts it
- Connection notice instead of an error message on short interruptions
- "Mod active" indicator next to "Mod off", WoT player name in the sidebar while WoT is running
- Gamer profile removed, watermark always on

## v5.1 – 2026-11-25 – Small changelog in the client
- Unobtrusive "Changelog" tab on the Help page
- The version number in the sidebar opens the changelog

## v5.0 – 2026-11-25 – DarkWizard Edition
- DarkWizard emblem (own design) as logo, in the banner and as a watermark
- Three themes: DarkWizard (purple, default), Commander (dark/amber), Light
- Settings: theme, animations on/off
- Profile card in the sidebar

## v4.0 – 2026-11-25 – Sound Commander client
- New interface in its own window (Edge app mode) with a local Node backend
- Overview, My Mods, Recording Studio, Active in Game, Help
- Live meter and waveform while recording, drag & drop for WAV, MP3, M4A and OGG

## v3.0 – 2026-11-25 – Recording assistant & effects
- Microphone recording, skip, variants, drag & drop (WAV)
- 12 effect categories from 8 more sound banks, third slot "Effects"
- Mods as folders `mods/<name>/stimme` (voice) and `mods/<name>/effekte` (effects)

## v2.1 – 2026-11-25
- Proper umlauts in the manager (UTF-8 with BOM)

## v2.0 – 2026-11-25 – Voice manager
- First window with buttons, several voices as profiles
- Two slots, switchable via the game option "national crew voices"

## v1.1 – 2026-11-25
- All 12 voice banks (standard + 11 nations), test tone mode, uninstall

## v1.0 – 2026-11-25 – Sound bank tool
- Reading and writing Wwise banks without Wwise, bit-exact reproduction
- 55 voice events / 595 sounds mapped, line list, build via command line
