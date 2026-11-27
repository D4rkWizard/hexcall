# Changelog – Hexhub

## v1.0.0 – 2026-11-26 – Hexhub: one client for all games
- **New name and new client:** Hexhub replaces Hexcall. One window for all games – home page with every game, Play/Close buttons, live "running" status and play time
- **World of Tanks page** with tabs: Sounds (Hexcall, unchanged and with your existing recordings), 3D garage (stickers and 3D parts as a mod), Mods (add/switch off/re-install other mods), mod folders, statistics, replays, hit analysis in 3D, replay → video
- **osu! page:** all your replays (exported and local) with map, mods, accuracy and background; watch them in osu!; render them with **Hexrender** – the Hexrender website is built right in (render, queue, video page), "Render" in the replay list hands the replay over; on the PC that runs Hexrender there is an Admin tab and a start button
- 3D garage: removing stickers while WoT runs no longer fails silently (clear message, nothing is forgotten), a leftover sticker mod can always be removed; sticker buttons wrap instead of being cut off
- 3D garage: collapse the tank list, minimise the panels, hide all panels (H) or switch to a full view of only the model (F, Esc exits) – remembered
- 3D garage: stickers are objects in the 3D view – click and drag them over the tank, corner handles for size, a knob to rotate (Ctrl/Alt + wheel too), and **crop** the image section
- 3D garage: stickers are no longer covered by 2D styles – based on WoT's tank shader the style pattern and paint are switched off under every sticker, it behaves like matte paint and the baked shadows (AO) under it are fully lifted
- 3D garage: **Farbkasten** – paint on the tank with a brush (palette, own colour, size, hardness, opacity, eraser, undo); baked below the stickers with the same 2D-style handling and high resolution
- 3D garage: small stickers stay sharp – mipmapped, gamma-correct filtering with gentle sharpening, and the tank texture is written at 2x/4x resolution (max 4096) when a sticker would get only few pixels
- 3D garage: per sticker brightness, colour strength and contrast (live preview, baked the same way)
- 3D garage: emblem-quality stickers – textures with stickers/paint are written as BC7 (the format WoT uses for its own 3D parts) instead of DXT, so colours, gradients and edges stay clean; mipmaps are averaged in linear light and lightly sharpened; like an emblem's own texture, every sticker now gets about one texel per image pixel (up to 512×512, texture max 4096); the 3D preview after "Apply" shows the full resolution
- 3D garage: stickers and paint also appear on **3D styles** – "Apply" builds them into the textures of every 3D style of the tank; the View & parts panel can show each 3D style's model as a preview
- 3D garage: **edited tanks** overview (stickers, paint, 3D parts, installed or not) with "clear" per tank and "clear all tanks" (with a safety question) – also removes them from WoT
- "Play" for World of Tanks starts the Wargaming Game Center first if it is not running (otherwise WoT is not signed in) – also for Hexcall's restart button and replays
- Language, theme and updates are now set once for the whole client (6 languages, 3 themes)
- Hexcall studio: **Listen to original** – plays WoT's own voice line or effect for every step (converted with the free tool vgmstream, downloaded once on request), with a playback volume slider in the studio
- Hexcall studio: **cut your recordings** – drag start/end on the waveform, listen to the selection, cut silence automatically, save over the take or as a new variant
- Hexcall studio: **in-game volume** – one slider for all voice lines / all effects of a mod and one per recording (0–200 %, a soft limiter keeps loud settings from clipping); applied when the sounds are built – and you hear it just as loud when listening in the studio
- Your Hexcall sounds and settings stay in %APPDATA%\Hexcall and are used automatically


## Hexcall v6.2 – 2026-11-25 – Standard & Commander
- The two voice slots are now named like the WoT voice-over setting: **Standard** and **Commander** (instead of "slot 1 / national")
- Own test tone for the Commander slot: three falling beeps (Standard: two rising beeps) – so you hear which voice is active
- Clear note: with "Commander", special commanders (Battle Pass, bloggers, events) keep their own voice
- All hints now say: new sounds take effect after restarting WoT (the game loads its sound banks on start)

## Hexcall v6.1.1 – 2026-11-25 – English everywhere
- Guide and line list now also in English (Guide.html, Lines.html) – the client opens them in your language
- README, changelog, release notes, installer and download page in English
- Fixed: some English texts stayed German ("0 Effekte", WoT update notice, outdated-version warning)

## Hexcall v6.1 – 2026-11-25 – More languages, reload button & update warning
- New languages: **Русский, Polski, Français, Español** (interface and all 67 recording steps)
- "Active in Game": your selection is a draft until you apply it – changed slots are marked, the blue **Reload** button lights up and rebuilds the sound banks; without changes it stays greyed out. "Discard" resets the selection
- Own dropdown menus in the Hexcall style instead of the plain Windows list (slots, studio picker); restyled log section
- On start: clear warning "outdated version – the mod may not work properly" with an update button; optional **automatic updates** in the settings
- After a WoT update: a notice that your sounds are off, with **Turn sounds back on** (rebuilds your previous setup for the new game version)
- **Start WoT** right from the client (bottom left, while the game is not running); if WoT is running when you press "Reload", Hexcall offers "Apply & restart WoT" – WoT loads the sound banks when the game starts

## Hexcall v6.0 – 2026-11-25 – Hexcall: ready for release
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

## Hexcall v5.4 – 2026-11-25 – Guide & line list for Windows
- README.md → Anleitung.html, SPRACHLISTE.md → Sprachliste.html (double-click opens them formatted in the browser)
- Line list with search, copy button and print view/PDF
- Generated from the program data with `node tools\docs.js`
- Links "Full guide" and "Line list" under Help in the client

## Hexcall v5.3 – 2026-11-25 – Active mod & turn back on
- Library: the active mod is marked green with an "ACTIVE" badge and its slots, and sorted first
- Activate/deactivate right on the mod card
- "Mod off" remembers the state, then "Turn back on" restores it with one click

## Hexcall v5.2 – 2026-11-25 – Stability & polish
- Fixed: "Failed to fetch" – the backend stopped when the window was throttled; now a watchdog in the launcher keeps it alive and restarts it
- Connection notice instead of an error message on short interruptions
- "Mod active" indicator next to "Mod off", WoT player name in the sidebar while WoT is running
- Gamer profile removed, watermark always on

## Hexcall v5.1 – 2026-11-25 – Small changelog in the client
- Unobtrusive "Changelog" tab on the Help page
- The version number in the sidebar opens the changelog

## Hexcall v5.0 – 2026-11-25 – DarkWizard Edition
- DarkWizard emblem (own design) as logo, in the banner and as a watermark
- Three themes: DarkWizard (purple, default), Commander (dark/amber), Light
- Settings: theme, animations on/off
- Profile card in the sidebar

## Hexcall v4.0 – 2026-11-25 – Sound Commander client
- New interface in its own window (Edge app mode) with a local Node backend
- Overview, My Mods, Recording Studio, Active in Game, Help
- Live meter and waveform while recording, drag & drop for WAV, MP3, M4A and OGG

## Hexcall v3.0 – 2026-11-25 – Recording assistant & effects
- Microphone recording, skip, variants, drag & drop (WAV)
- 12 effect categories from 8 more sound banks, third slot "Effects"
- Mods as folders `mods/<name>/stimme` (voice) and `mods/<name>/effekte` (effects)

## Hexcall v2.1 – 2026-11-25
- Proper umlauts in the manager (UTF-8 with BOM)

## Hexcall v2.0 – 2026-11-25 – Voice manager
- First window with buttons, several voices as profiles
- Two slots, switchable via the game option "national crew voices"

## Hexcall v1.1 – 2026-11-25
- All 12 voice banks (standard + 11 nations), test tone mode, uninstall

## Hexcall v1.0 – 2026-11-25 – Sound bank tool
- Reading and writing Wwise banks without Wwise, bit-exact reproduction
- 55 voice events / 595 sounds mapped, line list, build via command line
