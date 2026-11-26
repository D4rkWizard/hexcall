// Replay -> MP4 renderer (prototype). WoT plays the replay itself on a monitor the user does not look at
// (ideally a virtual one), ffmpeg records that monitor straight from the GPU (Desktop Duplication + hardware encoder).
// Only one job runs at a time; WoT's window settings are changed for the recording and restored afterwards.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const replays = require('./replays');
const stream = require('./replaystream');

const VIRTUAL_RX = /virtual|idd|parsec|amyuni|usbmmidd|spacedesk|sudovda|mttvdd|indirect/i;

module.exports = function createRenderer({ DATA, gameDir, gameRunning }) {
  const SETTINGS = path.join(DATA, 'render.json');
  const RESTORE = path.join(DATA, 'render-restore.json');
  const INBOX = path.join(DATA, 'render-inbox');
  const FFDIR = path.join(DATA, 'ffmpeg');
  fs.mkdirSync(INBOX, { recursive: true });

  const defaults = { monitor: null, fps: 60, quality: 'hoch', mute: true, outDir: path.join(os.homedir(), 'Videos', 'Hexcall Replays'), ffmpeg: '' };
  let settings = { ...defaults };
  try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))); } catch {}
  const saveSettings = () => fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));

  const jobs = []; // { id, file, name, info, state, progress, msg, out, startedAt }
  let current = null, setupState = null, monitorsCache = null;

  /* ---------- helpers ---------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ps = (args) => new Promise((ok, fail) => execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'display.ps1'), ...args], { windowsHide: true, timeout: 30000 }, (e, out) => (e ? fail(e) : ok(out))));

  async function monitors(refresh) {
    if (monitorsCache && !refresh) return monitorsCache;
    const list = JSON.parse((await ps(['-Action', 'list'])).trim() || '[]');
    monitorsCache = list.filter((m) => m.attached).map((m) => ({
      ...m, id: `${m.adapter}:${m.output}`, primary: m.x === 0 && m.y === 0, virtual: VIRTUAL_RX.test(`${m.adapterName} ${m.displayName || ''}`),
    }));
    return monitorsCache;
  }
  async function targetMonitor() {
    const list = await monitors(true);
    return list.find((m) => m.id === settings.monitor) || list.find((m) => m.virtual) || null;
  }

  function ffmpegPath() {
    const cands = [settings.ffmpeg, path.join(FFDIR, 'ffmpeg.exe')].filter(Boolean);
    for (const c of cands) if (fs.existsSync(c)) return c;
    for (const d of String(process.env.PATH || '').split(';')) { const f = path.join(d, 'ffmpeg.exe'); if (d && fs.existsSync(f)) return f; }
    return null;
  }

  // ffmpeg download (on the user's click): official Windows build from gyan.dev, only ffmpeg.exe is kept
  async function setupFfmpeg() {
    if (setupState && setupState.state === 'läuft') return;
    setupState = { state: 'läuft', msg: 'Lade ffmpeg herunter …', pct: 0 };
    const zip = path.join(DATA, 'ffmpeg-download.zip'), tmp = path.join(DATA, 'ffmpeg-tmp');
    try {
      const res = await fetch('https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip');
      if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
      const total = Number(res.headers.get('content-length')) || 0;
      const fh = fs.createWriteStream(zip); let got = 0;
      for await (const chunk of res.body) { fh.write(chunk); got += chunk.length; if (total) setupState.pct = Math.round((got / total) * 100); }
      await new Promise((r) => fh.end(r));
      setupState.msg = 'Entpacke …';
      fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
      await new Promise((ok, fail) => execFile('tar', ['-xf', zip, '-C', tmp], { windowsHide: true }, (e) => (e ? fail(e) : ok())));
      const find = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { const r = find(f); if (r) return r; } else if (e.name.toLowerCase() === 'ffmpeg.exe') return f; } return null; };
      const exe = find(tmp);
      if (!exe) throw new Error('ffmpeg.exe nicht im Archiv gefunden');
      fs.mkdirSync(FFDIR, { recursive: true });
      fs.copyFileSync(exe, path.join(FFDIR, 'ffmpeg.exe'));
      setupState = { state: 'fertig', msg: 'ffmpeg ist eingerichtet.' };
    } catch (e) { setupState = { state: 'fehler', msg: e.message }; }
    finally { fs.rmSync(zip, { force: true }); fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  function gameVersion(dir) {
    try { const m = /v\.(\d+\.\d+\.\d+\.\d+)/.exec(fs.readFileSync(path.join(dir, 'version.xml'), 'utf8')); return m ? m[1] : null; } catch { return null; }
  }
  // best available H.264 encoder: NVIDIA > AMD > Intel > CPU (checked once with a tiny test encode)
  const encCache = {};
  async function encoder(ff) {
    if (encCache[ff]) return encCache[ff];
    for (const e of ['h264_nvenc', 'h264_amf', 'h264_qsv']) {
      const ok = await new Promise((r) => execFile(ff, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=0.1', '-frames:v', '1', '-c:v', e, '-f', 'null', '-'], { windowsHide: true, timeout: 15000 }, (err) => r(!err)));
      if (ok) return (encCache[ff] = e);
    }
    return (encCache[ff] = 'libx264');
  }

  /* ---------- WoT preferences (window mode + volume), always restored ---------- */
  const PREFS = () => path.join(process.env.APPDATA || '', 'Wargaming.net', 'WorldOfTanks', 'preferences.xml');
  function setTags(xml, values) {
    const old = {};
    for (const [k, v] of Object.entries(values)) {
      const rx = new RegExp(`(<${k}>)([^<]*)(</${k}>)`);
      const m = rx.exec(xml);
      if (!m) continue;
      old[k] = m[2];
      xml = xml.replace(rx, `$1${v}$3`);
    }
    return { xml, old };
  }
  /* ---------- sound: WoT is moved to an output device nobody listens to, which is then recorded ---------- */
  const aps = (args, timeout = 20000) => new Promise((ok, fail) => execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'audio.ps1'), ...args], { windowsHide: true, timeout }, (e, out, err) => (e ? fail(new Error(String(err || e.message).trim().split('\n')[0])) : ok(String(out).trim()))));
  let audioCache = null;
  async function audioDevices(refresh) {
    if (audioCache && !refresh) return audioCache;
    try { audioCache = JSON.parse(await aps(['-Action', 'list']) || '[]'); } catch { audioCache = []; }
    return audioCache;
  }
  async function audioRoute(pid, deviceId) {
    try {
      const r = JSON.parse(await aps(['-Action', 'route', '-ProcId', String(pid), '-Device', deviceId]));
      const ok = r.hr.every((h) => h === 0) && (deviceId === 'default' || String(r.now).toLowerCase().includes(deviceId.toLowerCase()));
      return { ok, err: ok ? '' : `Windows meldet 0x${(r.hr.find((h) => h !== 0) >>> 0).toString(16)}` };
    } catch (e) { return { ok: false, err: e.message }; }
  }
  // process id of the running game (win64\WorldOfTanks.exe – the launcher in the game folder exits right away)
  const gamePid = () => new Promise((ok) => execFile('tasklist', ['/FI', 'IMAGENAME eq WorldOfTanks.exe', '/FO', 'CSV', '/NH'], { windowsHide: true }, (e, out) => {
    const pids = [...String(out).matchAll(/"WorldOfTanks\.exe","(\d+)"/gi)].map((m) => Number(m[1]));
    ok(pids.length ? pids[pids.length - 1] : 0);
  }));
  // suggestion: a digital output (S/PDIF) usually has nothing connected = silent, but can still be recorded
  const suggestAudio = (list) => (list.find((d) => /digital|spdif|s\/pdif/i.test(d.name) && !d.default) || null);

  function patchPrefs(mon, keepVolume) {
    const file = PREFS();
    if (!fs.existsSync(file)) return;
    const vals = { windowMode: ' 0 ', windowedWidth: ` ${mon.w} `, windowedHeight: ` ${mon.h} `, windowedMonitorIndex: ` ${mon.output} ` };
    // recording the sound: full volume (nobody hears that device anyway); otherwise optionally silent
    if (keepVolume) vals.masterVolume = ' 1.000000 ';
    else if (settings.mute) vals.masterVolume = ' 0.000000 ';
    const { xml, old } = setTags(fs.readFileSync(file, 'utf8'), vals);
    fs.writeFileSync(RESTORE, JSON.stringify(old)); // written first, so a crash can still be undone
    fs.writeFileSync(file, xml);
  }
  function restorePrefs() {
    let old;
    try { old = JSON.parse(fs.readFileSync(RESTORE, 'utf8')); } catch { return; }
    try { const file = PREFS(); fs.writeFileSync(file, setTags(fs.readFileSync(file, 'utf8'), old).xml); fs.rmSync(RESTORE, { force: true }); } catch {}
  }
  // left over from a crash? undo it as soon as WoT is not running
  gameRunning().then((r) => { if (!r) restorePrefs(); });

  /* ---------- game.log watching ---------- */
  function logWatcher(file) {
    let pos = 0; try { pos = fs.statSync(file).size; } catch {}
    return () => {
      let size = 0; try { size = fs.statSync(file).size; } catch { return ''; }
      if (size < pos) pos = 0; // log was recreated by the new game start
      if (size === pos) return '';
      const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(Math.min(size - pos, 8 * 1024 * 1024));
      fs.readSync(fd, buf, 0, buf.length, pos); fs.closeSync(fd); pos += buf.length;
      return buf.toString('utf8');
    };
  }
  const killGame = () => new Promise((ok) => execFile('taskkill', ['/IM', 'WorldOfTanks.exe', '/T', '/F'], { windowsHide: true }, () => ok()));

  /* ---------- one job ---------- */
  async function run(job) {
    const g = gameDir();
    const ff = ffmpegPath();
    if (!g) throw new Error('WoT nicht gefunden');
    if (!ff) throw new Error('ffmpeg fehlt – bitte zuerst unter „Einrichtung“ herunterladen.');
    const mon = await targetMonitor();
    if (!mon) throw new Error('Kein Zielmonitor – bitte einen virtuellen Monitor einrichten oder in der Einrichtung einen Monitor wählen.');
    if (await gameRunning()) throw new Error('WoT läuft gerade – Videos lassen sich nur erstellen, wenn das Spiel geschlossen ist.');
    const gv = gameVersion(g), rv = job.info && job.info.version;
    if (gv && rv && gv !== rv) throw new Error(`Replay ist von WoT ${rv}, installiert ist ${gv} – WoT spielt nur Replays der eigenen Version ab.`);
    const enc = await encoder(ff);

    const outDir = settings.outDir; fs.mkdirSync(outDir, { recursive: true });
    const base = job.name.replace(/\.wotreplay$/i, '');
    const mkv = path.join(outDir, `${base}.mkv`), wav = path.join(outDir, `${base}.wav`), mp4 = path.join(outDir, `${base}.mp4`);
    const stopFile = path.join(DATA, `audio-stop-${job.id}`);
    // exact replay length from the recorded stream; fallbacks: battle duration from the results, else 16 min
    let replaySecs = 0;
    try { replaySecs = stream.readStream(job.file).last; } catch {}
    const battleSecs = job.info && job.info.duration ? job.info.duration : 0;
    const maxSecs = Math.round(replaySecs ? replaySecs + 3 : battleSecs ? battleSecs + 45 : 16 * 60);
    const audioDev = settings.audio ? (await audioDevices()).find((d) => d.id === settings.audio) : null;

    patchPrefs(mon, !!audioDev);
    let placer = null, rec = null, arec = null, routedPid = 0;
    try {
      job.msg = 'WoT startet unsichtbar …'; job.progress = 2;
      const readLog = logWatcher(path.join(g, 'game.log'));
      placer = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'display.ps1'), '-Action', 'place',
        '-Left', mon.x, '-Top', mon.y, '-Width', mon.w, '-Height', mon.h, '-Seconds', String(maxSecs + 600)].map(String), { windowsHide: true, stdio: 'ignore' });
      spawn(path.join(g, 'WorldOfTanks.exe'), [job.file], { cwd: g, detached: true, stdio: 'ignore' }).unref();

      // wait for the battle to appear (loading screen is skipped in the video); meanwhile move WoT's sound
      // Windows accepts the routing only once WoT has opened its sound (an audio session) – so keep trying
      const loadUntil = Date.now() + 4 * 60 * 1000;
      let log = '', battle = 0, lastTry = 0, routeErr = '';
      const tryRoute = async () => {
        if (!audioDev || routedPid || Date.now() - lastTry < 1500) return;
        lastTry = Date.now();
        const pid = await gamePid(); if (!pid) return;
        const r = await audioRoute(pid, audioDev.id);
        if (r.ok) { routedPid = pid; job.audio = `Ton über ${audioDev.name}`; } else routeErr = r.err;
      };
      for (;;) {
        if (job.cancel) throw new Error('Abgebrochen');
        log += readLog();
        await tryRoute();
        if (!battle && /->\s*ReplayBattleSpace\(\)/.test(log)) battle = Date.now();
        // battle is there: start right away, or after max. 8 s more waiting for the sound routing
        if (battle && (!audioDev || routedPid || Date.now() - battle > 8000)) break;
        if (Date.now() > loadUntil) throw new Error('WoT hat das Gefecht nicht innerhalb von 4 Minuten geladen.');
        job.msg = 'Gefecht wird geladen …';
        await sleep(300);
      }
      if (audioDev && !routedPid) { routedPid = -1; job.audio = `Ton-Umleitung fehlgeschlagen (${routeErr || 'WoT hat keinen Ton geöffnet'}) – Video ohne Ton`; }

      // sound: WASAPI loopback of the device WoT now plays on (only if the routing worked)
      let audioStart = 0;
      if (audioDev && routedPid > 0) {
        fs.rmSync(stopFile, { force: true });
        arec = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'audio.ps1'), '-Action', 'record',
          '-Device', audioDev.id, '-Out', wav, '-Stop', stopFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let aout = '';
        arec.stdout.on('data', (d) => { aout += d; const m = /START (\d+)/.exec(aout); if (m && !audioStart) audioStart = Number(m[1]); });
        for (let i = 0; i < 60 && !audioStart && arec.exitCode === null; i++) await sleep(100);
        if (!audioStart) { job.audio = 'Tonaufnahme startet nicht – Video ohne Ton'; if (arec.exitCode === null) arec.kill(); arec = null; }
      }

      // record
      job.msg = 'Nimmt auf …'; job.progress = 5;
      // [cq, average, peak] – the peak caps the size (first test: cq alone gave ~36 Mbit/s = 3 GB for 11 min at 1440p)
      const big = mon.h > 1200;
      const q = { hoch: [23, big ? '14M' : '9M', big ? '18M' : '12M'], mittel: [26, big ? '9M' : '6M', big ? '12M' : '8M'], klein: [29, big ? '5M' : '3500k', big ? '7M' : '5M'] }[settings.quality] || [23, '14M', '18M'];
      const maxrate = q[2];
      const grab = `ddagrab=output_idx=${mon.output}:framerate=${settings.fps}:draw_mouse=0`;
      const encArgs = {
        h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', String(q[0]), '-b:v', q[1], '-maxrate', maxrate],
        h264_amf: ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'vbr_peak', '-b:v', q[1], '-maxrate', maxrate],
        h264_qsv: ['-c:v', 'h264_qsv', '-preset', 'medium', '-b:v', q[1], '-maxrate', maxrate],
        libx264: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(q[0]), '-pix_fmt', 'yuv420p'],
      }[enc];
      // GPU encoders take the captured D3D11 frames directly; the CPU encoder needs them downloaded first
      const filter = enc === 'h264_qsv' ? `${grab},hwmap=derive_device=qsv,format=qsv` : enc === 'libx264' ? `${grab},hwdownload,format=bgra` : grab;
      const args = ['-hide_banner', '-y', '-loglevel', 'error', '-init_hw_device', `d3d11va=dd:${mon.adapter}`, '-filter_hw_device', 'dd',
        '-filter_complex', filter, ...encArgs, '-progress', 'pipe:1', '-stats_period', '0.5', mkv];
      const t0 = Date.now();
      let ffErr = '', videoStart = 0, prog = '';
      rec = spawn(ff, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      rec.stderr.on('data', (d) => { ffErr = (ffErr + d).slice(-2000); });
      // wall-clock time of the first video frame = now - recorded time (for the audio sync)
      rec.stdout.on('data', (d) => {
        if (videoStart) return;
        prog += d; const m = /out_time_us=(\d+)/.exec(prog);
        if (m && Number(m[1]) > 0) videoStart = Date.now() - Number(m[1]) / 1000;
        prog = prog.slice(-500);
      });
      const recEnded = new Promise((r) => rec.on('close', r));
      log = '';
      for (;;) {
        await sleep(500);
        const secs = (Date.now() - t0) / 1000;
        job.progress = Math.min(97, 5 + (secs / maxSecs) * 92);
        job.msg = `Nimmt auf … ${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')} von ${Math.floor(maxSecs / 60)}:${String(maxSecs % 60).padStart(2, '0')}`;
        log += readLog(); log = log.slice(-20000);
        if (rec.exitCode !== null) throw new Error(`Aufnahme abgebrochen: ${ffErr.trim().split('\n').pop() || 'ffmpeg beendet'}`);
        if (job.cancel) break;
        if (/onReplayTerminated|Space is changed: ReplayBattleSpace\(\) ->/.test(log)) break;
        if (secs > maxSecs) break;
        if (!(await gameRunning())) break;
      }
      rec.stdin.write('q'); // let ffmpeg finish the file properly
      if (arec) fs.writeFileSync(stopFile, '');
      await Promise.race([recEnded, sleep(15000)]);
      if (rec.exitCode === null) rec.kill();
      if (arec) { await Promise.race([new Promise((r) => arec.on('close', r)), sleep(10000)]); if (arec.exitCode === null) arec.kill(); }
      if (routedPid > 0) { await audioRoute(routedPid, 'default'); routedPid = 0; }
      await killGame();

      // MKV is crash-safe while recording; the final file is an MP4 that starts playing immediately
      job.msg = 'Speichere MP4 …'; job.progress = 98;
      const hasAudio = arec && audioStart && videoStart && fs.existsSync(wav) && fs.statSync(wav).size > 1000;
      const mux = ['-hide_banner', '-y', '-loglevel', 'error', '-i', mkv];
      if (hasAudio) {
        const off = (audioStart - videoStart) / 1000; // > 0: sound started after the first frame
        if (off >= 0) mux.push('-itsoffset', off.toFixed(3), '-i', wav); else mux.push('-ss', (-off).toFixed(3), '-i', wav);
        // lift the loudest moment to -1 dB (max. +24 dB), so the video is never too quiet
        const peak = await new Promise((ok) => execFile(ff, ['-hide_banner', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-'], { windowsHide: true, maxBuffer: 1 << 24 }, (e, so, se) => {
          const m = /max_volume:\s*(-?[\d.]+) dB/.exec(String(se)); ok(m ? Number(m[1]) : 0);
        }));
        const gain = Math.max(0, Math.min(24, -1 - peak));
        mux.push('-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', `volume=${gain.toFixed(1)}dB`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest');
        job.audioOffset = off;
      } else mux.push('-c', 'copy');
      mux.push('-movflags', '+faststart', mp4);
      await new Promise((ok, fail) => execFile(ff, mux, { windowsHide: true }, (e, so, se) => (e ? fail(new Error(`MP4 konnte nicht geschrieben werden: ${String(se).trim().split('\n').pop()}`)) : ok())));
      fs.rmSync(mkv, { force: true }); fs.rmSync(wav, { force: true });
      if (job.cancel) { fs.rmSync(mp4, { force: true }); throw new Error('Abgebrochen'); }
      job.out = mp4;
    } finally {
      if (rec && rec.exitCode === null) rec.kill();
      if (arec && arec.exitCode === null) { fs.writeFileSync(stopFile, ''); await sleep(1500); if (arec.exitCode === null) arec.kill(); }
      fs.rmSync(stopFile, { force: true });
      if (routedPid > 0) await audioRoute(routedPid, 'default');
      if (placer && placer.exitCode === null) placer.kill();
      if (await gameRunning()) await killGame();
      for (let i = 0; i < 20 && (await gameRunning()); i++) await sleep(250);
      restorePrefs();
      if (job.cancel) { fs.rmSync(mkv, { force: true }); fs.rmSync(wav, { force: true }); }
    }
  }

  async function pump() {
    if (current) return;
    const job = jobs.find((j) => j.state === 'wartet');
    if (!job) return;
    current = job; job.state = 'läuft'; job.startedAt = Date.now();
    try { await run(job); job.state = 'fertig'; job.progress = 100; job.msg = 'Fertig'; }
    catch (e) { job.state = job.cancel ? 'abgebrochen' : 'fehler'; job.msg = e.message; }
    finally {
      if (job.file.startsWith(INBOX)) fs.rmSync(job.file, { force: true });
      current = null; setTimeout(pump, 500);
    }
  }

  function add(file, name) {
    const info = replays.parse(file);
    if (!info) throw new Error('Keine gültige Replay-Datei');
    let length = 0; try { length = Math.round(stream.readStream(file).last); } catch {}
    const job = { id: String(Date.now()) + Math.random().toString(36).slice(2, 6), file, name, info, length, state: 'wartet', progress: 0, msg: 'In der Warteschlange' };
    jobs.push(job); pump();
    return job;
  }

  const pub = (j) => ({ id: j.id, name: j.name, state: j.state, progress: Math.round(j.progress || 0), msg: j.msg, out: j.out || null,
    tank: j.info && j.info.tank, map: j.info && j.info.map, version: j.info && j.info.version, duration: j.info && j.info.duration, length: j.length || 0, audio: j.audio || '' });

  return {
    async status() {
      let mons = []; try { mons = await monitors(); } catch {}
      const audio = await audioDevices();
      if (settings.audio === undefined) { const sug = suggestAudio(audio); settings.audio = sug ? sug.id : ''; saveSettings(); } // first start: pick a silent output
      return { settings, ffmpeg: ffmpegPath(), audio, setup: setupState, monitors: mons, target: (mons.find((m) => m.id === settings.monitor) || mons.find((m) => m.virtual) || null),
        jobs: jobs.slice(-30).map(pub) };
    },
    async refreshMonitors() { monitorsCache = null; await audioDevices(true); return monitors(true); },
    setSettings(s) {
      if (s.monitor !== undefined) settings.monitor = s.monitor ? String(s.monitor) : null;
      if ([30, 60].includes(Number(s.fps))) settings.fps = Number(s.fps);
      if (['hoch', 'mittel', 'klein'].includes(s.quality)) settings.quality = s.quality;
      if (s.mute !== undefined) settings.mute = !!s.mute;
      if (typeof s.audio === 'string') settings.audio = s.audio;
      if (typeof s.outDir === 'string' && s.outDir.trim() && path.isAbsolute(s.outDir.trim())) settings.outDir = s.outDir.trim();
      saveSettings(); return settings;
    },
    setupFfmpeg() { setupFfmpeg(); return setupState; },
    addUpload(name, buf) {
      const safe = path.basename(String(name || 'replay.wotreplay')).replace(/[^\w.\- ]/g, '_');
      if (!/\.wotreplay$/i.test(safe) || buf.length < 16 || buf.readUInt32LE(0) !== 0x11343212) throw new Error('Das ist keine .wotreplay-Datei');
      const f = path.join(INBOX, `${Date.now()}_${safe}`);
      fs.writeFileSync(f, buf);
      try { return pub(add(f, safe)); } catch (e) { fs.rmSync(f, { force: true }); throw e; }
    },
    addFile(full) { return pub(add(full, path.basename(full))); },
    cancel(id) {
      const j = jobs.find((x) => x.id === id); if (!j) return;
      if (j.state === 'wartet') { j.state = 'abgebrochen'; j.msg = 'Abgebrochen'; if (j.file.startsWith(INBOX)) fs.rmSync(j.file, { force: true }); }
      else if (j.state === 'läuft') { j.cancel = true; j.msg = 'Breche ab …'; }
    },
    clear() { for (let i = jobs.length - 1; i >= 0; i--) if (!['wartet', 'läuft'].includes(jobs[i].state)) jobs.splice(i, 1); },
    outPath(id) { const j = jobs.find((x) => x.id === id); return j && j.out; },
    outDir: () => settings.outDir,
  };
};
