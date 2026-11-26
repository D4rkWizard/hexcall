'use strict';
// World of Tanks module UI (former Hexcall Hub): overview, statistics, replays, video, mods, folders, Hexcall tab.
// Garage, hit analysis and 3D view live in garage.js, hits.js, shotview.js.
(() => {
const W = '/api/wot';
const go = (tab) => Hexhub.go('game:wot', tab);
const S = { page: 'home', status: null, replays: [], mode: 'Alle', range: 'Alles', res: 'Alle', sort: { tank: ['n', -1], map: ['n', -1], rep: ['date', -1] }, ideas: [] };

/* status */
async function loadStatus() { S.status = await api(W + '/status'); return S.status; }

/* replays + stats */
const resLabel = { sieg: 'Sieg', niederlage: 'Niederlage', unentschieden: 'Unentschieden', unbekannt: 'verlassen' };
const dateDe = (iso) => dateFmt(iso);
const withResult = (l) => l.filter((r) => r.result !== 'unbekannt');

function filtered() {
  let l = S.replays;
  if (S.mode !== 'Alle') l = l.filter((r) => r.mode === S.mode);
  const days = { '7 Tage': 7, '30 Tage': 30, '90 Tage': 90 }[S.range];
  if (days) { const t = Date.now() - days * 864e5; l = l.filter((r) => r.date && new Date(r.date).getTime() >= t); }
  return l;
}
function summary(l) {
  const f = withResult(l), wins = f.filter((r) => r.result === 'sieg').length;
  const avg = (k) => (f.length ? f.reduce((a, r) => a + (r[k] || 0), 0) / f.length : null);
  return { n: l.length, fin: f.length, wins, wr: pct(wins, f.length), dmg: avg('damage'), xp: avg('xp'), kills: avg('kills'), assist: avg('assist'), surv: pct(f.filter((r) => r.survived).length, f.length) };
}
const kpi = (label, val, sub, cls = '') => `<div class="card kpi ${cls}"><div class="k-label">${label}</div><div class="k-val">${val}</div><div class="k-sub">${sub}</div></div>`;

function renderHome() {
  const s = summary(S.replays), w = summary(S.replays.filter((r) => r.date && new Date(r.date) > Date.now() - 7 * 864e5));
  $('#homeKpis').innerHTML = [
    kpi('Gefechte', fmt(s.n), `${fmt(w.n)} in den letzten 7 Tagen`),
    kpi('Siegquote', `${fmt(s.wr, 1)} %`, w.fin ? `${fmt(w.wr, 1)} % letzte 7 Tage` : 'letzte 7 Tage: –', s.wr >= 50 ? 'good' : ''),
    kpi('Ø Schaden', fmt(s.dmg), w.fin ? `${fmt(w.dmg)} letzte 7 Tage` : '–', 'accent'),
    kpi('Ø Erfahrung', fmt(s.xp), `Überlebt: ${fmt(s.surv)} %`),
  ].join('');
  $('#homeRecent').innerHTML = S.replays.slice(0, 5).map(battleRow).join('') || '<div class="empty">Noch keine Replays gefunden. In WoT unter Einstellungen › Allgemein „Gefechte aufzeichnen“ einschalten.</div>';
}
const battleRow = (r) => `<div class="battle"><span class="res ${r.result}">${resLabel[r.result]}</span>
  <div><b>${esc(r.tank)}</b><div class="muted">${esc(r.mode)}</div></div><div>${esc(r.map)}<div class="muted">${dateDe(r.date)}</div></div>
  <div class="num">${fmt(r.damage)}<div class="muted">Schaden</div></div><div class="num">${fmt(r.xp)}<div class="muted">EP</div></div></div>`;

function chips(el, values, cur, set) {
  el.innerHTML = values.map((v) => `<button class="chip ${v === cur ? 'active' : ''}" data-v="${esc(v)}">${esc(v)}</button>`).join('');
  el.onclick = (e) => { const b = e.target.closest('.chip'); if (b) { set(b.dataset.v); renderStats(); renderReplays(); } };
}

function groupTable(el, list, key, label, sortKey) {
  const groups = {};
  for (const r of withResult(list)) (groups[r[key]] = groups[r[key]] || []).push(r);
  let rows = Object.entries(groups).map(([k, l]) => ({ k, ...summary(l) }));
  const [sk, dir] = S.sort[sortKey];
  rows.sort((a, b) => (typeof a[sk] === 'string' ? a[sk].localeCompare(b[sk]) : (a[sk] || 0) - (b[sk] || 0)) * dir);
  const cols = [['k', label], ['n', 'Gefechte'], ['wr', 'Siege'], ['dmg', 'Ø Schaden'], ['xp', 'Ø EP']];
  el.innerHTML = `<thead><tr>${cols.map(([c, l]) => `<th data-s="${c}" class="${c === sk ? 'sorted' : ''} ${c !== 'k' ? 'num' : ''}">${l}${c === sk ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr><td><b>${esc(r.k)}</b></td><td class="num">${r.n}</td><td class="num">${fmt(r.wr, 1)} %<span class="wr-bar"><i style="width:${r.wr}%"></i></span></td><td class="num">${fmt(r.dmg)}</td><td class="num">${fmt(r.xp)}</td></tr>`).join('')}</tbody>`;
  el.querySelector('thead').onclick = (e) => {
    const th = e.target.closest('th'); if (!th) return;
    const c = th.dataset.s; S.sort[sortKey] = [c, S.sort[sortKey][0] === c ? -S.sort[sortKey][1] : (c === 'k' ? 1 : -1)]; renderStats();
  };
}

function renderStats() {
  const modes = ['Alle', ...[...new Set(S.replays.map((r) => r.mode))].sort((a, b) => S.replays.filter((r) => r.mode === b).length - S.replays.filter((r) => r.mode === a).length)];
  chips($('#modeChips'), modes, S.mode, (v) => (S.mode = v));
  chips($('#rangeChips'), ['Alles', '7 Tage', '30 Tage', '90 Tage'], S.range, (v) => (S.range = v));
  const l = filtered(), s = summary(l);
  $('#statsSub').textContent = `${fmt(S.replays.length)} Replays ausgewertet · ${fmt(s.fin)} mit Ergebnis (verlassene Gefechte zählen nicht)`;
  $('#statKpis').innerHTML = [
    kpi('Siegquote', `${fmt(s.wr, 1)} %`, `${fmt(s.wins)} von ${fmt(s.fin)} Gefechten`, s.wr >= 50 ? 'good' : ''),
    kpi('Ø Schaden', fmt(s.dmg), `Ø Aufklärung/Unterstützung ${fmt(s.assist)}`, 'accent'),
    kpi('Ø Erfahrung', fmt(s.xp), `Ø Abschüsse ${fmt(s.kills, 2)}`),
    kpi('Überlebt', `${fmt(s.surv)} %`, 'der Gefechte'),
  ].join('');
  const last = withResult(l).slice(0, 40).reverse(), max = Math.max(1, ...last.map((r) => r.damage || 0));
  $('#spark').innerHTML = last.map((r) => `<i class="${r.result === 'sieg' ? 'w' : ''}" style="height:${Math.max(4, (r.damage / max) * 100)}%" title="${esc(r.tank)} · ${esc(r.map)} · ${fmt(r.damage)} Schaden"></i>`).join('') || '<span class="sub">Keine Daten</span>';
  groupTable($('#tankTable'), l, 'tank', 'Panzer', 'tank');
  groupTable($('#mapTable'), l, 'map', 'Karte', 'map');
}

function renderReplays() {
  chips($('#resChips'), ['Alle', 'Sieg', 'Niederlage', 'verlassen'], S.res, (v) => (S.res = v));
  const q = $('#repSearch').value.trim().toLowerCase();
  let l = filtered();
  if (S.res !== 'Alle') l = l.filter((r) => resLabel[r.result] === S.res);
  if (q) l = l.filter((r) => `${r.tank} ${r.map} ${r.mode}`.toLowerCase().includes(q));
  const [sk, dir] = S.sort.rep;
  l = [...l].sort((a, b) => (typeof a[sk] === 'string' || sk === 'date' ? String(a[sk] || '').localeCompare(String(b[sk] || '')) : (a[sk] || 0) - (b[sk] || 0)) * dir);
  const cols = [['date', 'Datum'], ['result', 'Ergebnis'], ['tank', 'Panzer'], ['map', 'Karte'], ['mode', 'Modus'], ['damage', 'Schaden'], ['assist', 'Unterst.'], ['kills', 'Absch.'], ['xp', 'EP'], ['', '']];
  $('#repSub').textContent = `${fmt(l.length)} von ${fmt(S.replays.length)} Replays`;
  $('#repTable').innerHTML = `<thead><tr>${cols.map(([c, t]) => `<th data-s="${c}" class="${c === sk ? 'sorted' : ''} ${['damage', 'assist', 'kills', 'xp'].includes(c) ? 'num' : ''}">${t}${c && c === sk ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
  <tbody>${l.slice(0, 400).map((r) => `<tr><td>${dateDe(r.date)}</td><td><span class="res ${r.result}">${resLabel[r.result]}</span></td><td><b>${esc(r.tank)}</b></td><td>${esc(r.map)}</td><td>${esc(r.mode)}</td>
    <td class="num">${fmt(r.damage)}</td><td class="num">${fmt(r.assist)}</td><td class="num">${fmt(r.kills)}</td><td class="num">${fmt(r.xp)}</td>
    <td><button class="btn sm ghost" data-hits="${esc(r.file)}" title="Trefferanalyse"><svg><use href="#i-cross"/></svg></button> <button class="btn sm ghost" data-video="${esc(r.file)}" title="Als Video (MP4) speichern"><svg><use href="#i-video"/></svg></button> <button class="btn sm ghost" data-play="${esc(r.file)}" title="In WoT abspielen"><svg><use href="#i-play"/></svg></button> <button class="btn sm ghost" data-show="${esc(r.file)}" title="Im Explorer zeigen"><svg><use href="#i-folder"/></svg></button></td></tr>`).join('')}</tbody>`;
  $('#repTable thead').onclick = (e) => {
    const th = e.target.closest('th'); if (!th || !th.dataset.s) return;
    const c = th.dataset.s; S.sort.rep = [c, S.sort.rep[0] === c ? -S.sort.rep[1] : -1]; renderReplays();
  };
}
$('#repSearch').oninput = renderReplays;
$('#repTable').addEventListener('click', async (e) => {
  const h = e.target.closest('[data-hits]');
  if (h && window.Hits) { go('hits'); return Hits.open(h.dataset.hits); }
  const p = e.target.closest('[data-play]'), s = e.target.closest('[data-show]'), v = e.target.closest('[data-video]');
  try {
    if (v) { await api(W + '/render/add', { file: v.dataset.video }); toast('Zur Video-Warteschlange hinzugefügt'); go('video'); }
    if (p) { await api(W + '/replay/play', { file: p.dataset.play }); toast('Replay wird in WoT geöffnet …'); }
    if (s) await api(W + '/open', { rel: `replays/${s.dataset.show}`, select: true });
  } catch (err) { toast(err.message, true); }
});
$('#openReplays').onclick = () => api(W + '/open', { rel: 'replays' }).catch((e) => toast(e.message, true));

async function loadReplays() {
  $('#homeRecent').innerHTML = '<div class="empty">Lese Replays …</div>';
  const r = await api(W + '/replays');
  S.replays = r.replays;
  renderHome(); renderStats(); renderReplays();
}

/* replay -> video */
const V = { st: null, timer: null };
const mmss = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');
const devName = (d) => String(d || '').replace(/^\\\\\.\\/, '');
async function loadVideo() {
  const st = V.st = await api(W + '/render/status');
  renderVideo();
  clearTimeout(V.timer);
  const busy = st.jobs.some((j) => j.state === 'läuft' || j.state === 'wartet') || (st.setup && st.setup.state === 'läuft');
  if (S.page === 'video') V.timer = setTimeout(() => loadVideo().catch(() => {}), busy ? 1000 : 4000);
}
function renderVideo() {
  const st = V.st, set = st.settings, t = st.target;
  const warn = [];
  if (!st.ffmpeg) warn.push('ffmpeg fehlt noch – unten bei „Einrichtung“ auf <b>Herunterladen</b> klicken (ca. 100 MB, einmalig).');
  if (!t) warn.push('Kein Zielmonitor gewählt. Am besten einen <b>virtuellen Monitor</b> einrichten (z. B. den kostenlosen „Virtual Display Driver“: <a href="https://github.com/VirtualDrivers/Virtual-Display-Driver" target="_blank">github.com/VirtualDrivers/Virtual-Display-Driver</a>) und dann „Neu suchen“. Zum Testen geht auch ein zweiter echter Monitor.');
  else if (!t.virtual) warn.push(`Aufnahme läuft auf einem echten Monitor (${esc(devName(t.device))}) – dort ist WoT während der Aufnahme sichtbar. Für unsichtbare Aufnahmen einen virtuellen Monitor einrichten.`);
  $('#vidWarn').hidden = !warn.length; $('#vidWarn').innerHTML = warn.join('<br>');

  $('#vidJobs').innerHTML = st.jobs.slice().reverse().map((j) => `<div class="job ${j.state}">
    <div><b>${esc(j.tank || j.name)}</b> · ${esc(j.map || '')}<div class="muted">${esc(j.name)}${j.length ? ` · Replay ${mmss(j.length)}` : ''}${j.version ? ` · WoT ${esc(j.version)}` : ''}</div></div>
    <div><div class="msg muted">${esc(j.msg)}</div>${j.audio ? `<div class="muted" style="font-size:12px">${esc(j.audio)}</div>` : ''}${j.state === 'läuft' ? `<div class="bar"><i style="width:${j.progress}%"></i></div>` : ''}</div>
    <div class="acts">${j.out ? `<button class="btn sm ghost" data-vopen="${j.id}" title="Im Explorer zeigen"><svg><use href="#i-folder"/></svg></button>` : ''}${j.state === 'läuft' || j.state === 'wartet' ? `<button class="btn sm ghost" data-vcancel="${j.id}" title="Abbrechen"><svg><use href="#i-x"/></svg></button>` : ''}</div></div>`).join('')
    || '<div class="empty" style="padding:26px">Noch nichts in der Warteschlange.</div>';

  const sel = $('#vidMon');
  if (document.activeElement !== sel) {
    sel.innerHTML = '<option value="">Automatisch (virtueller Monitor)</option>' + st.monitors.map((m) => `<option value="${m.id}" ${m.id === set.monitor ? 'selected' : ''}>${esc(devName(m.device))} · ${m.w}×${m.h}${m.primary ? ' · Hauptmonitor' : ''}${m.virtual ? ' · virtuell' : ''} · ${esc(m.displayName || m.adapterName)}</option>`).join('');
  }
  $('#vidMonNote').textContent = t ? `Aufnahme auf ${devName(t.device)} (${t.w}×${t.h})${t.primary ? ' – Achtung: das ist dein Hauptmonitor!' : ''}` : 'Kein passender Monitor gefunden.';
  chipsV($('#vidFps'), [['30', '30 fps'], ['60', '60 fps']], String(set.fps), (v) => saveVid({ fps: Number(v) }));
  chipsV($('#vidQ'), [['hoch', 'Hoch'], ['mittel', 'Mittel'], ['klein', 'Klein']], set.quality, (v) => saveVid({ quality: v }));
  const aSel = $('#vidAudio');
  if (document.activeElement !== aSel) {
    aSel.innerHTML = '<option value="">Ohne Ton</option>' + st.audio.map((d) => `<option value="${esc(d.id)}" ${d.id === set.audio ? 'selected' : ''}>Aufnehmen über: ${esc(d.name)}${d.default ? ' (dein Standardgerät – du hörst mit)' : ''}</option>`).join('');
  }
  const ad = st.audio.find((d) => d.id === set.audio);
  $('#vidAudioNote').textContent = !ad ? 'Das Video bekommt keinen Ton.'
    : ad.default ? 'Achtung: Das ist dein normales Ausgabegerät – du hörst WoT während der Aufnahme.'
    : `WoT spielt während der Aufnahme nur auf „${ad.name}“ und wird dort mitgeschnitten. Wenn dort nichts angeschlossen ist, hörst du nichts.`;
  $('#vidMuteRow').hidden = !!ad;
  $('#vidMute').checked = set.mute;
  if (document.activeElement !== $('#vidOut')) $('#vidOut').value = set.outDir;
  const su = st.setup;
  $('#vidFf').textContent = su && su.state === 'läuft' ? `${su.msg} ${su.pct ? su.pct + ' %' : ''}` : su && su.state === 'fehler' ? `Fehler: ${su.msg}` : st.ffmpeg ? `bereit (${st.ffmpeg})` : 'nicht installiert';
  $('#vidFfGet').hidden = !!st.ffmpeg || !!(su && su.state === 'läuft');
}
function chipsV(el, items, cur, set) {
  el.innerHTML = items.map(([v, l]) => `<button class="chip ${v === cur ? 'active' : ''}" data-v="${v}">${l}</button>`).join('');
  el.onclick = (e) => { const b = e.target.closest('.chip'); if (b) set(b.dataset.v); };
}
async function saveVid(p) { try { await api(W + '/render/settings', p); await loadVideo(); } catch (e) { toast(e.message, true); } }
async function uploadReplays(files) {
  for (const f of files) {
    if (!/\.wotreplay$/i.test(f.name)) { toast(`${f.name}: keine .wotreplay-Datei`, true); continue; }
    try {
      const r = await fetch(`${W}/render/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
      const d = await r.json(); if (!r.ok) throw new Error(d.error);
      toast(`${d.tank || f.name} ist in der Warteschlange`);
    } catch (e) { toast(`${f.name}: ${e.message}`, true); }
  }
  loadVideo();
}
$('#vidFile').onchange = (e) => { uploadReplays([...e.target.files]); e.target.value = ''; };
const drop = $('#vidDrop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => uploadReplays([...e.dataTransfer.files]));
$('#vidJobs').addEventListener('click', (e) => {
  const c = e.target.closest('[data-vcancel]'), o = e.target.closest('[data-vopen]');
  if (c) api(W + '/render/cancel', { id: c.dataset.vcancel }).then(loadVideo).catch((er) => toast(er.message, true));
  if (o) api(W + '/render/open', { id: o.dataset.vopen }).catch((er) => toast(er.message, true));
});
$('#vidClear').onclick = () => api(W + '/render/clear', {}).then(loadVideo);
$('#vidOpenDir').onclick = () => api(W + '/render/open', {}).catch((e) => toast(e.message, true));
$('#vidMon').onchange = (e) => saveVid({ monitor: e.target.value || null });
$('#vidMonRefresh').onclick = async () => { await api(W + '/render/monitors', {}); loadVideo(); };
$('#vidMute').onchange = (e) => saveVid({ mute: e.target.checked });
$('#vidAudio').onchange = (e) => saveVid({ audio: e.target.value });
$('#vidOut').onchange = (e) => saveVid({ outDir: e.target.value });
$('#vidFfGet').onclick = async () => { await api(W + '/render/ffmpeg', {}); loadVideo(); };

/* sounds: Hexcall embedded (same backend, mounted under /hexcall/) */
function showSounds() { const f = $('#hxFrame'); if (!f.getAttribute('src')) f.src = '/hexcall/'; }

/* mod folders */
const size = (b) => (b > 1e9 ? `${fmt(b / 1e9, 2)} GB` : b > 1e6 ? `${fmt(b / 1e6, 1)} MB` : `${fmt(b / 1e3)} KB`);
async function loadFolders() {
  const r = await api(W + '/modfolders');
  const old = r.folders.filter((f) => !f.current);
  $('#folderList').innerHTML = r.folders.map((f) => `<div class="folder"><b>${f.base}</b><span>${f.version}</span>
    <span>${f.current ? '<span class="tag cur">aktuell</span>' : '<span class="tag">alt – wird nicht geladen</span>'}${f.hexcall ? '<span class="tag hx">Hexcall</span>' : ''}</span>
    <span class="num" style="text-align:right">${f.files ? `${size(f.bytes)} · ${f.files} Dateien` : 'leer'}</span>
    <button class="btn sm ghost icon" data-open="${f.base}/${f.version}" title="Ordner öffnen"><svg><use href="#i-folder"/></svg></button></div>`).join('') || '<div class="empty">Keine Mod-Ordner gefunden.</div>';
  const oldBytes = old.reduce((a, f) => a + f.bytes, 0);
  $('#folderNote').textContent = old.length ? `${old.length} Ordner gehören zu alten WoT-Versionen (${size(oldBytes)}). Aufräumen kommt in einer späteren Version – bis dahin nur anzeigen.` : '';
}
$('#folderList').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) api(W + '/open', { rel: b.dataset.open }).catch((er) => toast(er.message, true)); });

/* other people's mods */
const M = { busy: false };
async function loadMods() {
  const r = await api(W + '/mods');
  $('#modList').innerHTML = r.mods.slice().reverse().map((m) => {
    const state = !m.installedFor ? (m.enabled ? '<span class="tag">nicht installiert</span>' : '<span class="tag">aus</span>')
      : m.outdated ? `<span class="tag warn">für WoT ${esc(m.installedFor)} – neu einspielen</span>` : '<span class="tag cur">aktiv</span>';
    return `<div class="job mod" data-id="${esc(m.id)}">
      <div><b>${esc(m.name)}</b>${m.modVersion ? ` <span class="muted">v${esc(m.modVersion)}</span>` : ''}
        <div class="muted">${esc(m.source)} · ${size(m.bytes)} · ${m.files} ${m.files === 1 ? 'Datei' : 'Dateien'} in ${m.targets.map(esc).join(' + ')}${m.ignored ? ` · ${m.ignored} ignoriert (z. B. Liesmich)` : ''}</div>
        <div class="muted mono" title="${esc(m.sample.join('\n'))}">${esc(m.sample[0] || '')}${m.files > 1 ? ' …' : ''}</div></div>
      <div>${state}</div>
      <div class="acts">
        ${m.outdated || (!m.installedFor && m.enabled) ? '<button class="btn sm primary" data-mre>Einspielen</button>' : ''}
        ${m.installedFor && !m.outdated ? '<button class="btn sm ghost" data-moff title="Dateien aus WoT nehmen, Mod bleibt hier gespeichert">Ausschalten</button>' : ''}
        ${!m.enabled ? '<button class="btn sm ghost" data-mon>Einschalten</button>' : ''}
        <button class="btn sm ghost icon" data-mdel title="Entfernen (Dateien aus WoT löschen, Gesichertes zurücklegen)"><svg><use href="#i-trash"/></svg></button>
      </div></div>`;
  }).join('') || '<div class="empty" style="padding:26px">Noch keine Mods hinzugefügt.</div>';
  api(W + '/mods/downloads').then((d) => {
    $('#modDlWrap').hidden = !d.length;
    $('#modDl').innerHTML = d.map((f) => `<div class="job"><div><b>${esc(f.name)}</b><div class="muted">${size(f.bytes)} · ${new Date(f.at).toLocaleDateString(locale())}</div></div>
      <div>${f.known ? '<span class="tag cur">schon hinzugefügt</span>' : ''}</div>
      <div class="acts"><button class="btn sm ${f.known ? 'ghost' : 'primary'}" data-madd="${esc(f.path)}"><svg><use href="#i-plus"/></svg>Hinzufügen</button></div></div>`).join('');
  }).catch(() => {});
}
function modResult(d) {
  if (!d.installed) toast(`${d.name}: gespeichert, aber nicht installiert – ${d.note}`, true);
  else toast(`${d.name} ist drin (${d.files} Dateien)${d.conflicts.length ? ` – überschreibt Dateien von: ${d.conflicts.join(', ')}` : ''}`);
}
async function modBusy(fn) {
  if (M.busy) return; M.busy = true; document.body.classList.add('wait');
  try { await fn(); } catch (e) { toast(e.message, true); } finally { M.busy = false; document.body.classList.remove('wait'); loadMods().catch(() => {}); }
}
function uploadMods(files) {
  modBusy(async () => {
    for (const f of files) {
      if (!/\.(wotmod|zip|7z|rar)$/i.test(f.name)) { toast(`${f.name}: keine .wotmod-, .zip-, .7z- oder .rar-Datei`, true); continue; }
      toast(`${f.name} wird hinzugefügt …`);
      try {
        const r = await fetch(`${W}/mods/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
        const d = await r.json(); if (!r.ok) throw new Error(d.error);
        modResult(d);
      } catch (e) { toast(`${f.name}: ${e.message}`, true); }
    }
  });
}
$('#modFile').onchange = (e) => { uploadMods([...e.target.files]); e.target.value = ''; };
const mdrop = $('#modDrop');
['dragenter', 'dragover'].forEach((ev) => mdrop.addEventListener(ev, (e) => { e.preventDefault(); mdrop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => mdrop.addEventListener(ev, (e) => { e.preventDefault(); mdrop.classList.remove('over'); }));
mdrop.addEventListener('drop', (e) => uploadMods([...e.dataTransfer.files]));
$('#modDl').addEventListener('click', (e) => {
  const b = e.target.closest('[data-madd]'); if (!b) return;
  modBusy(async () => { toast('Wird hinzugefügt …'); modResult(await api(W + '/mods/add', { path: b.dataset.madd })); });
});
$('#modList').addEventListener('click', (e) => {
  const row = e.target.closest('.mod'); if (!row) return;
  const id = row.dataset.id, name = $('b', row).textContent;
  if (e.target.closest('[data-mre]')) modBusy(async () => { const r = await api(W + '/mods/reinstall', { id }); toast(`${name} eingespielt${r.conflicts.length ? ` – überschreibt Dateien von: ${r.conflicts.join(', ')}` : ''}`); });
  if (e.target.closest('[data-moff]')) modBusy(async () => { await api(W + '/mods/enable', { id, on: false }); toast(`${name} ist aus`); });
  if (e.target.closest('[data-mon]')) modBusy(async () => { await api(W + '/mods/enable', { id, on: true }); toast(`${name} ist wieder an`); });
  if (e.target.closest('[data-mdel]') && confirm(`„${name}“ entfernen? Die Dateien werden aus WoT gelöscht und überschriebene Originale zurückgelegt.`)) modBusy(async () => { await api(W + '/mods/remove', { id }); toast(`${name} entfernt`); });
});
$('#modOpenDir').onclick = () => api(W + '/open', { rel: `mods/${(S.status && S.status.version) || ''}` }).catch((e) => toast(e.message, true));

/* module */
let loadedReplays = false;
async function ensureReplays() {
  if (loadedReplays) return;
  loadedReplays = true;
  try { await loadReplays(); } catch (e) { loadedReplays = false; $('#homeRecent').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
Hexhub.register('wot', {
  async init() { loadStatus().catch(() => {}); setTimeout(ensureReplays, 800); },
  open(p) {
    S.page = p;
    if (['home', 'stats', 'replays'].includes(p)) ensureReplays();
    if (p === 'sounds') showSounds();
    if (p === 'folders') loadFolders().catch((e) => toast(e.message, true));
    if (p === 'mods') loadMods().catch((e) => toast(e.message, true));
    if (p === 'video') loadVideo().catch((e) => toast(e.message, true));
    if (p === 'garage' && window.Garage) Garage.open();
    if (p === 'hits' && window.Hits) Hits.open();
  },
  status(g) { S.game = g; },
  homeStats() {
    if (!S.replays.length) return [];
    const s = summary(S.replays);
    return [[fmt(s.n), 'Gefechte'], [`${fmt(s.wr, 1)} %`, 'Siegquote']];
  },
  settings(el) { renderSettings(el); },
});

/* settings: game folder (shared with Hexcall) */
async function renderSettings(el) {
  let f = { current: null, found: [] };
  try { f = await api(W + '/folders'); } catch {}
  el.innerHTML = `<div class="card set-row"><div class="sr-text" style="min-width:0"><b class="set-path">${esc(f.current || 'Nicht gefunden')}</b><span>Spielordner (gilt auch für Hexcall)</span></div>
    <div class="acts"><button class="btn ghost" data-wset="auto">Automatisch suchen</button><button class="btn ghost" data-wset="pick"><svg><use href="#i-folder"/></svg>Ordner wählen …</button></div></div>
    ${f.found.length > 1 ? `<div class="note">Gefunden: ${f.found.map((d) => `<a href="#" data-wdir="${esc(d)}" style="color:var(--g)">${esc(d)}</a>`).join(' · ')}</div>` : ''}`;
  el.onclick = async (e) => {
    const b = e.target.closest('[data-wset],[data-wdir]'); if (!b) return;
    e.preventDefault();
    try {
      if (b.dataset.wset === 'pick') { const r = await api(W + '/pickfolder', {}); if (!r.dir) return; }
      else await api(W + '/setfolder', { dir: b.dataset.wdir || null });
      toast('Spielordner gespeichert'); loadedReplays = false; renderSettings(el); Hexhub.refresh();
    } catch (er) { toast(er.message, true); }
  };
}
})();
