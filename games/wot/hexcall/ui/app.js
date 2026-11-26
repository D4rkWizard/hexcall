'use strict';
// Hexcall client: talks to tools/server.js on the same origin.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// running inside the Hexhub client (iframe)
if (window.top !== window || /[?&]embed=1/.test(location.search)) document.documentElement.classList.add('embedded');

const icon = (n) => `<svg><use href="#i-${n}"/></svg>`;

let offlineEl = null;
function setOffline(on) {
  if (on && !offlineEl) { offlineEl = document.createElement('div'); offlineEl.className = 'offline'; offlineEl.textContent = 'Verbindung zum Hintergrunddienst unterbrochen – verbinde neu …'; document.body.appendChild(offlineEl); }
  if (!on && offlineEl) { offlineEl.remove(); offlineEl = null; }
}
async function api(path, { method = 'GET', json, body } = {}) {
  const opt = { method, headers: {} };
  if (json !== undefined) { opt.body = JSON.stringify(json); opt.headers['Content-Type'] = 'application/json'; }
  if (body !== undefined) { opt.body = body; opt.headers['Content-Type'] = 'audio/wav'; }
  let r;
  try { r = await fetch(path, opt); setOffline(false); }
  catch { setOffline(true); throw new Error('Keine Verbindung zum Hintergrunddienst – verbinde neu …'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Fehler ${r.status}`);
  return data;
}

const S = { page: 'home', info: null, steps: [], mod: null, files: { stimme: {}, effekte: {} }, kind: 'stimme', idx: 0, fresh: null, askedBranch: false, pending: null, muteApplied: false };
const FIXED = { original: 'Original (WoT)', testton: 'Testton (Piep)' };

/* ---------- toasts & modal ---------- */
function toast(text, type = 'ok', ms = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'err' ? 'help' : type === 'busy' ? 'swap' : 'check')}<div>${esc(text)}</div>`;
  $('#toasts').appendChild(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}

function modal({ title, text = '', input = null, buttons }) {
  return new Promise((resolve) => {
    const m = $('#modal');
    $('#modalTitle').textContent = title;
    $('#modalText').textContent = text;
    const inp = $('#modalInput');
    inp.hidden = input === null;
    inp.value = input || '';
    const acts = $('#modalActions');
    acts.innerHTML = '';
    const close = (v) => { m.hidden = true; document.removeEventListener('keydown', onKey); resolve(v); };
    buttons.forEach((b) => {
      const el = document.createElement('button');
      el.className = `btn ${b.cls || 'ghost'}`;
      el.textContent = b.label;
      el.onclick = () => close(b.value === 'input' ? inp.value.trim() : b.value);
      acts.appendChild(el);
    });
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter') { const def = buttons.find((b) => b.default); if (def) close(def.value === 'input' ? inp.value.trim() : def.value); }
    };
    document.addEventListener('keydown', onKey);
    m.hidden = false;
    if (!inp.hidden) setTimeout(() => inp.focus(), 30);
  });
}

/* ---------- navigation ---------- */
function go(page) {
  $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  if (page !== 'studio' && rec.active) stopRecording(false);
  S.page = page;
}
$$('.nav button').forEach((b) => (b.onclick = () => go(b.dataset.page)));
$$('[data-goto]').forEach((b) => (b.onclick = () => go(b.dataset.goto)));

/* ---------- data ---------- */
async function refresh(force = true) {
  S.info = await api('api/info');
  const i = S.info;
  $("#version").textContent = i.version ? `WoT ${i.version}` : 'WoT nicht gefunden';
  $('#verLink').textContent = `v${String(i.app || '').replace(/\.0$/, '')}`;
  $('#gameBanner').hidden = i.gameFound;
  $('#gameDirText').textContent = i.gameDir || 'Nicht gefunden';
  $('#gameDirSub').textContent = i.gameFound ? `World of Tanks ${i.version || ''} · automatisch erkannt oder von dir gewählt` : 'Bitte den Ordner wählen, in dem WoT installiert ist';
  $('#appVersion').textContent = `Hexcall v${i.app}`;
  $('#dataDir').textContent = i.dataDir;
  const gs = $('#gameStatus');
  gs.classList.toggle('on', i.wotLaeuft);
  $('.txt', gs).textContent = i.wotLaeuft ? 'WoT läuft' : 'WoT nicht gestartet';
  $('#gameStart').hidden = i.wotLaeuft || !i.gameFound;
  const wp = $('#wotPlayer');
  wp.hidden = !(i.wotLaeuft && i.wotSpieler);
  if (i.wotSpieler) { $('span', wp).textContent = i.wotSpieler; wp.title = 'Eingeloggt in World of Tanks'; }
  renderModState();
  renderSlotsSummary();
  renderMods();
  if (!$('.dd-menu')) renderSlotEditor(); // unsaved choices live in S.pending; don't close an open menu
  renderWotUpdate();
  renderStudioPick();
}

const label = (v) => FIXED[v] || v;
const slotKind = (v) => (v === 'original' ? 'orig' : v === 'testton' ? 'test' : 'mod');

const SLOT_DEF = [
  { id: 'standard', title: 'Stimme · Standard', sub: 'WoT-Sprachausgabe „Standard“', ico: 'voice', kind: 'stimme' },
  { id: 'national', title: 'Stimme · Kommandant', sub: 'WoT-Sprachausgabe „Kommandant“', ico: 'swap', kind: 'stimme' },
  { id: 'effekte', title: 'Effekte', sub: 'Kanone, Motor, Turm, Ketten …', ico: 'gun', kind: 'effekte' },
];

function renderModState() {
  const vals = SLOT_DEF.map((d) => S.info.aktiv[d.id] || 'original');
  const mods = [...new Set(vals.filter((v) => v !== 'original' && v !== 'testton'))];
  const el = $('#modState');
  if (!el) return;
  el.className = 'mod-state' + (mods.length ? ' on' : vals.includes('testton') ? ' test' : '');
  $('.txt', el).textContent = mods.length ? `Mod aktiv: ${mods.join(', ')}` : vals.includes('testton') ? 'Testton aktiv' : 'Mod aus – Original';
  // "Mod aus" becomes "Wieder einschalten" once everything is original and a previous state is remembered
  const off = vals.every((v) => v === 'original');
  const btn = $('#allOff');
  const last = S.info.letzter;
  if (off && last) {
    const names = [...new Set(Object.values(last).filter((v) => v !== 'original').map(label))];
    btn.className = 'btn accent';
    btn.innerHTML = `${icon('power')}Wieder einschalten`;
    btn.title = `Stellt wieder her: ${names.join(', ')}`;
    btn.disabled = false;
  } else {
    btn.className = 'btn danger-ghost';
    btn.innerHTML = `${icon('power')}Mod aus (alles Original)`;
    btn.title = '';
    btn.disabled = off;
  }
}

const activeSlotsOf = (name) => SLOT_DEF.filter((d) => S.info.aktiv[d.id] === name);

function renderSlotsSummary() {
  $('#homeSlots').innerHTML = SLOT_DEF.map((d) => {
    const v = S.info.aktiv[d.id] || 'original';
    return `<div class="card slot-card is-${slotKind(v)}">
      <div class="slot-ico">${icon(v === 'testton' ? 'beep' : d.ico)}</div>
      <div class="slot-label">${d.title}</div>
      <div class="slot-value">${esc(label(v))}</div>
      <div class="slot-sub">${d.sub}</div></div>`;
  }).join('');
}

function modCard(m) {
  const c = S.info.counts;
  const slots = activeSlotsOf(m.name);
  const isOn = slots.length > 0;
  const active = slots.map((d) => `<span class="tag on">${d.id === 'effekte' ? 'Effekte' : d.title.replace('Stimme · ', 'Stimme ')}</span>`).join('');
  const pct = (a, b) => Math.round((a / b) * 100);
  return `<div class="card mod-card ${isOn ? 'is-active' : ''}">
    ${isOn ? `<div class="live-badge"><span class="dot"></span>AKTIV</div>` : ''}
    <div class="mc-top">
      <div class="avatar">${esc(m.name.trim()[0].toUpperCase())}</div>
      <div style="min-width:0"><div class="mc-name" title="${esc(m.name)}">${esc(m.name)}</div>
      <div class="mc-sub">${m.dateien} Datei${m.dateien === 1 ? '' : 'en'}</div></div>
    </div>
    <div class="tags">${active || '<span class="tag">nicht aktiv</span>'}</div>
    <div class="meter">
      <div class="meter-row">Stimme<div class="track"><div class="fill" style="width:${pct(m.stimme, c.stimme)}%"></div></div><b>${m.stimme}/${c.stimme}</b></div>
      <div class="meter-row">Effekte<div class="track"><div class="fill fx" style="width:${pct(m.effekte, c.effekte)}%"></div></div><b>${m.effekte}/${c.effekte}</b></div>
    </div>
    <div class="mc-actions">
      <button class="btn primary" data-act="edit" data-mod="${esc(m.name)}">${icon('mic')}Aufnehmen</button>
      ${isOn
        ? `<button class="btn danger-ghost" data-act="deactivate" data-mod="${esc(m.name)}">${icon('power')}Deaktivieren</button>`
        : `<button class="btn ghost" data-act="activate" data-mod="${esc(m.name)}">${icon('bolt')}Aktivieren</button>`}
      <button class="btn ghost icon" data-act="folder" data-mod="${esc(m.name)}" title="Ordner öffnen">${icon('folder')}</button>
    </div></div>`;
}
const newCard = `<div class="card mod-card new" data-act="new">${icon('plus')}<b>Neuer Sound-Mod</b><span>Stimme und Effekte aufnehmen</span></div>`;

function renderMods() {
  // active mods first, so it is obvious which one is running
  const mods = [...S.info.mods].sort((a, b) => (activeSlotsOf(b.name).length > 0) - (activeSlotsOf(a.name).length > 0));
  $('#modGrid').innerHTML = mods.map(modCard).join('') + newCard;
  $('#homeMods').innerHTML = mods.slice(0, 2).map(modCard).join('') + newCard;
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const mod = el.dataset.mod;
  if (el.dataset.act === 'new') return newMod();
  if (el.dataset.act === 'edit') return openStudio(mod);
  if (el.dataset.act === 'folder') return api('api/open', { method: 'POST', json: { mod } });
  if (el.dataset.act === 'activate') return activateMod(mod);
  if (el.dataset.act === 'deactivate') return deactivateMod(mod);
});

async function deactivateMod(mod) {
  const req = {};
  activeSlotsOf(mod).forEach((d) => (req[d.id] = 'original'));
  if (!Object.keys(req).length) return;
  await applyNow(req);
}

async function newMod() {
  const name = await modal({ title: 'Neuer Sound-Mod', text: 'Wie soll dein Sound-Mod heißen?', input: '',
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Erstellen', value: 'input', cls: 'primary', default: true }] });
  if (!name) return;
  try {
    const r = await api('api/mod', { method: 'POST', json: { name } });
    await refresh();
    openStudio(r.name);
  } catch (err) { toast(err.message, 'err'); }
}
$('#heroNew').onclick = newMod;
$('#modsNew').onclick = newMod;
$('#studioNew').onclick = newMod;

async function activateMod(mod) {
  const m = S.info.mods.find((x) => x.name === mod);
  if (!m || !m.dateien) return toast('Dieser Mod hat noch keine Aufnahmen.', 'err');
  const choice = await modal({ title: `„${mod}“ aktivieren`,
    text: `Stimme: ${m.stimme} von ${S.info.counts.stimme} Ansagen\nEffekte: ${m.effekte} von ${S.info.counts.effekte}\n\nFür welche WoT-Sprachausgabe soll die Stimme gelten?`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Kommandant', value: 'national' }, { label: 'Standard', value: 'standard', cls: 'primary', default: true }] });
  if (!choice) return;
  const req = {};
  if (m.stimme) req[choice] = mod;
  if (m.effekte) req.effekte = mod;
  await applyNow(req);
}

/* ---------- slots page ---------- */
// Choices on this page are only a draft (S.pending) until "Neu laden" builds the sound banks.
function slotOptions(kind, value) {
  const opts = [['original', FIXED.original, 'Original-Sounds von WoT', 'orig'], ['testton', FIXED.testton, 'Piepton zum Testen', 'test'],
    ...S.info.mods.map((m) => [m.name, m.name, `${m[kind]} ${kind === 'stimme' ? 'Ansagen' : 'Effekte'}`, 'mod'])];
  return opts.map(([v, l, sub, k]) => `<option value="${esc(v)}" data-sub="${esc(sub)}" data-kind="${k}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('');
}
const activeOf = (id) => S.info.aktiv[id] || 'original';
const chosenOf = (id) => (S.pending && S.pending[id] !== undefined ? S.pending[id] : activeOf(id));
const slotsDirty = () => SLOT_DEF.some((d) => chosenOf(d.id) !== activeOf(d.id));
const isDirty = () => slotsDirty() || $('#muteMissing').checked !== S.muteApplied;

function renderSlotEditor() {
  if (S.pending && !slotsDirty()) S.pending = null;
  $('#slotCards').innerHTML = SLOT_DEF.map((d) => {
    const act = activeOf(d.id), v = chosenOf(d.id), changed = v !== act;
    return `<div class="card slot-card is-${slotKind(v)} ${changed ? 'is-changed' : ''}">
      ${changed ? '<div class="changed-badge">geändert</div>' : ''}
      <div class="row"><div class="slot-ico">${icon(v === 'testton' ? 'beep' : d.ico)}</div>
      <div><div class="slot-label">${d.title}</div><div class="slot-sub">${d.sub}</div></div></div>
      <select class="select slot-select" data-slot="${d.id}">${slotOptions(d.kind, v)}</select>
      <div class="slot-sub">Im Spiel: <b style="color:var(--text)">${esc(label(act))}</b></div></div>`;
  }).join('');
  $$('.slot-select').forEach((s) => {
    enhanceSelect(s);
    s.onchange = () => {
      S.pending = { ...(S.pending || {}), [s.dataset.slot]: s.value };
      renderSlotEditor();
    };
  });
  updateApplyState();
}

function updateApplyState() {
  const dirty = isDirty();
  const btn = $('#applyBtn');
  btn.disabled = !dirty;
  btn.classList.toggle('ready', dirty);
  $('#discardBtn').hidden = !dirty;
  const st = $('#applyState');
  st.className = `apply-state ${dirty ? 'dirty' : ''}`;
  $('.txt', st).textContent = dirty ? 'Änderungen noch nicht übernommen' : 'Alles übernommen';
}
$('#muteMissing').onchange = updateApplyState;
$('#discardBtn').onclick = () => { S.pending = null; $('#muteMissing').checked = S.muteApplied; renderSlotEditor(); };

async function applyNow(req) {
  let restart = false;
  if (S.info.wotLaeuft) {
    const ok = await modal({ title: 'World of Tanks läuft', text: 'WoT lädt die Sounds beim Spielstart. Zuverlässig hörst du die neuen Sounds erst nach einem Neustart des Spiels. Soll Hexcall WoT dafür neu starten? (Nicht mitten im Gefecht!)',
      buttons: [{ label: 'Abbrechen', value: false }, { label: 'Nur anwenden', value: 'apply' }, { label: 'Anwenden & WoT neu starten', value: 'restart', cls: 'primary', default: true }] });
    if (!ok) return;
    restart = ok === 'restart';
  }
  if ($('#muteMissing').checked) req.luecken = 'stumm';
  const t = toast('Baue Sound-Banken …', 'busy', 0);
  try {
    const r = await api('api/apply', { method: 'POST', json: req });
    $('#log').textContent = r.output;
    t.remove();
    toast(r.ok ? 'Angewendet. Wirkt nach einem Neustart von WoT.' : 'Fehler beim Bauen – siehe Protokoll', r.ok ? 'ok' : 'err', 5000);
    if (r.ok) { S.pending = null; S.muteApplied = $('#muteMissing').checked; if (restart) startGame(true); }
    else { go('slots'); $('#logBox').open = true; }
  } catch (err) { t.remove(); toast(err.message, 'err'); }
  await refresh();
}
$('#applyBtn').onclick = () => {
  if (!isDirty()) return;
  const req = {};
  SLOT_DEF.forEach((d) => (req[d.id] = chosenOf(d.id)));
  applyNow(req);
};
$('#allOff').onclick = async () => {
  const vals = SLOT_DEF.map((d) => S.info.aktiv[d.id] || 'original');
  if (vals.every((v) => v === 'original') && S.info.letzter) return restoreLast();
  const ok = await modal({ title: 'Mod ausschalten?', text: 'Alle Slots werden auf die Original-Sounds von WoT zurückgesetzt. Deine Aufnahmen bleiben erhalten.',
    buttons: [{ label: 'Abbrechen', value: false }, { label: 'Alles Original', value: true, cls: 'primary', default: true }] });
  if (ok) applyNow({ deinstallieren: true });
};

async function restoreLast() {
  const t = toast('Schalte wieder ein …', 'busy', 0);
  try {
    const r = await api('api/restore', { method: 'POST', json: {} });
    $('#log').textContent = r.output;
    t.remove();
    toast(r.ok ? 'Wieder eingeschaltet. Wirkt nach einem Neustart von WoT.' : 'Fehler – siehe Protokoll', r.ok ? 'ok' : 'err', 5000);
  } catch (err) { t.remove(); toast(err.message, 'err'); }
  await refresh();
}

/* ---------- studio ---------- */
function renderStudioPick() {
  const pick = $('#studioPick'), keep = pick.value;
  pick.innerHTML = S.info.mods.map((m) => `<option value="${esc(m.name)}" data-sub="${m.dateien === 1 ? '1 Datei' : `${m.dateien} Dateien`}">${esc(m.name)}</option>`).join('') || '<option value="">– noch keine Mods –</option>';
  if (keep && S.info.mods.some((m) => m.name === keep)) pick.value = keep;
  enhanceSelect(pick);
}
$('#studioOpen').onclick = () => { const v = $('#studioPick').value; if (v) openStudio(v); else newMod(); };
$('#closeStudio').onclick = () => { if (rec.active) stopRecording(false); S.mod = null; $('#studio').hidden = true; $('#studioEmpty').hidden = false; refresh(); };

const stepsOf = (kind) => S.steps.filter((s) => s.kind === kind);
const cur = () => stepsOf(S.kind)[S.idx];
const takesOf = (s) => (S.files[s.kind] && S.files[s.kind][s.key]) || [];

async function loadFiles() {
  const r = await api(`api/mod?name=${encodeURIComponent(S.mod)}`);
  S.files = { stimme: r.stimme, effekte: r.effekte };
}

async function openStudio(mod) {
  S.mod = mod; S.kind = 'stimme'; S.idx = 0; S.askedBranch = false; S.fresh = null;
  await loadFiles();
  // start at the first step without a recording
  const first = stepsOf('stimme').findIndex((s) => !takesOf(s).length);
  S.idx = first >= 0 ? first : 0;
  $('#studioMod').textContent = mod;
  $('#studioEmpty').hidden = true;
  $('#studio').hidden = false;
  go('studio');
  renderStepList();
  showStep();
}

function renderStepList() {
  const list = stepsOf(S.kind);
  const done = list.filter((s) => takesOf(s).length).length;
  $('#cntStimme').textContent = `${stepsOf('stimme').filter((s) => takesOf(s).length).length}/${stepsOf('stimme').length}`;
  $('#cntEffekte').textContent = `${stepsOf('effekte').filter((s) => takesOf(s).length).length}/${stepsOf('effekte').length}`;
  $('#progressBar').style.width = `${(done / list.length) * 100}%`;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.kind === S.kind));
  const groups = S.kind === 'stimme' ? VOICE_GROUPS : FX_GROUPS;
  let html = '';
  list.forEach((s, i) => {
    const g = groups.find((x) => x.at === i);
    if (g) html += `<li class="grp">${g.name}</li>`;
    const n = takesOf(s).length;
    html += `<li data-i="${i}" class="${n ? 'done' : ''} ${i === S.idx ? 'active' : ''}">
      <span class="st">${n ? icon('check') : i + 1}</span><span class="nm">${esc(s.title)}</span>${n > 1 ? `<span class="vc">×${n}</span>` : ''}</li>`;
  });
  $('#stepList').innerHTML = html;
  const act = $('#stepList li.active');
  if (act) act.scrollIntoView({ block: 'nearest' });
}
// headings in the step list (index of first step in each group)
const VOICE_GROUPS = [
  { at: 0, name: 'Gefechtsbeginn' }, { at: 1, name: 'Deine Treffer' }, { at: 17, name: 'Zielerfassung' },
  { at: 20, name: 'Schäden am Panzer' }, { at: 41, name: 'Besatzung' }, { at: 48, name: 'Zug' },
];
const FX_GROUPS = [{ at: 0, name: 'Waffen' }, { at: 4, name: 'Fahrzeug' }, { at: 8, name: 'Explosionen & Feuer' }];

$('#stepList').onclick = (e) => { const li = e.target.closest('li[data-i]'); if (li) gotoStep(+li.dataset.i); };
$$('.tab').forEach((t) => (t.onclick = () => { if (rec.active) return; S.kind = t.dataset.kind; S.idx = 0; S.fresh = null; renderStepList(); showStep(); }));

function gotoStep(i) {
  if (rec.active) return;
  S.idx = Math.max(0, Math.min(stepsOf(S.kind).length - 1, i));
  S.fresh = null;
  renderStepList();
  showStep();
}

function showStep() {
  const s = cur();
  const total = stepsOf(S.kind).length;
  $('#stepCount').textContent = `${S.kind === 'stimme' ? 'Stimme' : 'Effekt'} ${S.idx + 1} / ${total}`;
  $('#stepTitle').textContent = s.title;
  const line = $('#stepLine');
  line.classList.toggle('fx', s.kind === 'effekte');
  line.textContent = s.kind === 'stimme' ? I18N.quote(s.text) : s.text;
  $('#stepHint').textContent = s.kind === 'stimme' ? 'Sprich den Satz – oder deine eigene Version – kurz und deutlich ein.' : s.hint;
  const n = takesOf(s).length;
  const b = $('#stepBadge');
  b.className = `badge ${n ? 'done' : ''}`;
  b.textContent = n ? `${n} Aufnahme${n > 1 ? 'n' : ''}` : 'noch offen – bleibt sonst original';
  $('#prevBtn').disabled = S.idx === 0 && S.kind === 'stimme';
  renderTakes();
  clearScope();
  loadOriginalInfo();
}

function renderTakes() {
  const s = cur();
  const files = takesOf(s);
  const box = $('#takes');
  if (!files.length) { box.innerHTML = '<div class="none">Noch keine Aufnahme. Drück den roten Knopf oder die Leertaste.</div>'; return; }
  box.innerHTML = files.map((f) => `<div class="take ${f === S.fresh ? 'new' : ''}" data-file="${esc(f)}">
      <button class="btn icon play" title="Anhören">${icon('play')}</button>
      <div class="tname">${esc(f)}</div><canvas width="280" height="56"></canvas>
      <button class="btn icon ghost del" title="Löschen">${icon('trash')}</button></div>`).join('');
  $$('.take', box).forEach((row) => {
    const url = audioUrl(s.kind, row.dataset.file);
    drawPeaks($('canvas', row), url);
    $('.play', row).onclick = () => playUrl(url, $('.play', row));
    $('.del', row).onclick = () => deleteTake(s, row.dataset.file);
  });
}

/* ---------- playback volume in the studio (only for listening, not for the game) ---------- */
function playVolume() { const v = Number($('#playVol').value); return isNaN(v) ? 0.8 : v / 100; }
(() => {
  let v = 80;
  try { const s = Number(localStorage.getItem('hexcall-play-vol')); if (localStorage.getItem('hexcall-play-vol') !== null && !isNaN(s)) v = s; } catch {}
  const el = $('#playVol'), out = $('#playVolV');
  el.value = v; out.textContent = `${v} %`;
  el.oninput = () => {
    out.textContent = `${el.value} %`;
    if (player) player.volume = playVolume(); // also while something is playing
    try { localStorage.setItem('hexcall-play-vol', el.value); } catch {}
  };
})();

/* ---------- listen to the original WoT sound of the current step ---------- */
const ORIG = { step: null, idx: 0, count: 0 };
async function loadOriginalInfo() {
  const s = cur(), id = `${s.kind}:${s.key}`;
  if (ORIG.step === id) return;
  ORIG.step = id; ORIG.idx = 0; ORIG.count = 0;
  $('#origCount').textContent = '';
  try {
    const r = await api(`api/original/info?kind=${s.kind}&key=${encodeURIComponent(s.key)}`);
    if (ORIG.step !== id) return;
    ORIG.count = r.count;
    $('#origBtn').hidden = !r.count;
    $('#origCount').textContent = r.count > 1 ? `· ${r.count} Varianten` : '';
  } catch { $('#origBtn').hidden = true; }
}
async function ensureVgmstream() {
  const st = await api('api/original/status');
  if (st.ready) return true;
  const ok = await modal({ title: 'Original-Sounds abspielen',
    text: 'WoT speichert seine Sounds in einem Format, das Hexhub erst umwandeln muss. Dafür wird einmalig das freie Programm vgmstream heruntergeladen (ca. 5 MB, von GitHub).',
    buttons: [{ label: 'Abbrechen', value: false }, { label: 'Herunterladen', value: true, cls: 'primary', default: true }] });
  if (!ok) return false;
  toast('Lade vgmstream herunter …');
  const r = await api('api/original/setup', { method: 'POST', json: {} });
  if (!r.ready) throw new Error((r.setup && r.setup.msg) || 'vgmstream konnte nicht eingerichtet werden');
  return true;
}
$('#origBtn').onclick = async () => {
  const btn = $('#origBtn'), s = cur();
  if (playerBtn === btn && player && !player.ended && !player._stopped) return playUrl(null, btn);
  btn.classList.add('busy');
  try {
    if (!(await ensureVgmstream())) return;
    // voice: next variant on every click; effects (hundreds of tank-specific variants): a random one
    const i = s.kind === 'effekte' && ORIG.count > 1 ? Math.floor(Math.random() * ORIG.count) : ORIG.idx++;
    const r = await fetch(`api/original?kind=${s.kind}&key=${encodeURIComponent(s.key)}&i=${i}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Fehler ${r.status}`);
    const url = URL.createObjectURL(await r.blob());
    if (ORIG.count > 1) $('#origCount').textContent = `· ${(i % ORIG.count) + 1} / ${ORIG.count}`;
    playUrl(url, btn, true);
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.classList.remove('busy'); }
};

const audioUrl = (kind, file) => `api/audio?mod=${encodeURIComponent(S.mod)}&kind=${kind}&file=${encodeURIComponent(file)}&v=${Date.now()}`;

let player = null, playerBtn = null;
// keepLabel: only swap the icon of a button with text (the "Original" button)
function setPlayIcon(btn, name) {
  if (!btn) return;
  const svg = btn.querySelector('svg');
  if (btn.id === 'origBtn' && svg) svg.outerHTML = icon(name); else btn.innerHTML = icon(name);
}
function playUrl(url, btn) {
  if (player) { player.pause(); setPlayIcon(playerBtn, 'play'); }
  if (!url || (playerBtn === btn && player && !player.ended && !player._stopped)) { if (player) player._stopped = true; playerBtn = null; return; }
  player = new Audio(url);
  player.volume = playVolume();
  playerBtn = btn;
  setPlayIcon(btn, 'stop');
  player.onended = () => { setPlayIcon(btn, 'play'); playerBtn = null; };
  player.play().catch(() => toast('Kann die Datei nicht abspielen', 'err'));
}

async function deleteTake(s, file) {
  const ok = await modal({ title: 'Aufnahme löschen?', text: file, buttons: [{ label: 'Abbrechen', value: false }, { label: 'Löschen', value: true, cls: 'primary', default: true }] });
  if (!ok) return;
  await api('api/take/delete', { method: 'POST', json: { mod: S.mod, kind: s.kind, file } });
  await loadFiles();
  renderStepList(); showStep();
}

async function next() {
  if (rec.active) return;
  const list = stepsOf(S.kind);
  if (S.idx < list.length - 1) return gotoStep(S.idx + 1);
  if (S.kind === 'stimme') {
    const r = await modal({ title: 'Stimme fertig! 🎖', text: 'Willst du noch weitere Sounds erstellen – Kanone, Motor, Turm, Ketten, Explosionen …?',
      buttons: [{ label: 'Nein, fertig', value: 'done' }, { label: 'Ja, weitere Sounds', value: 'fx', cls: 'primary', default: true }] });
    if (r === 'fx') { S.kind = 'effekte'; S.idx = 0; renderStepList(); showStep(); }
    else if (r === 'done') finish();
  } else finish();
}
$('#nextBtn').onclick = next;
$('#skipBtn').onclick = next;
$('#prevBtn').onclick = () => {
  if (S.idx > 0) return gotoStep(S.idx - 1);
  if (S.kind === 'effekte') { S.kind = 'stimme'; S.idx = stepsOf('stimme').length - 1; renderStepList(); showStep(); }
};
$('#finishBtn').onclick = () => finish();

async function finish() {
  if (rec.active) stopRecording(false);
  await refresh();
  activateMod(S.mod);
}

/* ---------- recording ---------- */
// Fixed 48 kHz context: the browser resamples the microphone (even 192 kHz interfaces) in high quality.
const REC_RATE = 48000;
const rec = { active: false, ctx: null, stream: null, node: null, src: null, sink: null, analyser: null, chunks: [], start: 0, raf: 0, ready: false };

async function recContext() {
  if (!rec.ctx) rec.ctx = new AudioContext({ sampleRate: REC_RATE, latencyHint: 'interactive' });
  if (!rec.ready) { await rec.ctx.audioWorklet.addModule('rec-worklet.js'); rec.ready = true; }
  await rec.ctx.resume();
  return rec.ctx;
}

async function startRecording() {
  if (rec.active || !S.mod) return;
  if (player) player.pause();
  try {
    // No browser "enhancements": noise suppression causes the warbling/"krauseln", AGC pumps.
    rec.stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  } catch (err) {
    toast('Kein Zugriff aufs Mikrofon. Bitte im Fenster erlauben und prüfen, ob ein Mikrofon angeschlossen ist.', 'err', 7000);
    return;
  }
  const ctx = await recContext();
  rec.src = ctx.createMediaStreamSource(rec.stream);
  rec.analyser = ctx.createAnalyser();
  rec.analyser.fftSize = 2048;
  // Capture on the audio thread (AudioWorklet) – no dropouts even when the UI is busy
  rec.node = new AudioWorkletNode(ctx, 'sc-recorder', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
  rec.chunks = [];
  rec.node.port.onmessage = (e) => { if (rec.active) rec.chunks.push(e.data); };
  rec.sink = ctx.createGain();
  rec.sink.gain.value = 0; // keeps the node running without playing the mic back
  rec.src.connect(rec.analyser);
  rec.src.connect(rec.node);
  rec.node.connect(rec.sink);
  rec.sink.connect(ctx.destination);
  rec.active = true;
  rec.start = performance.now();
  $('#recBtn').classList.add('recording');
  $('#booth').classList.add('recording-live');
  $('#recState').textContent = '● Aufnahme läuft – Leertaste zum Stoppen';
  drawLive();
}

async function stopRecording(save = true) {
  if (!rec.active) return;
  if (rec.stopping) return;
  rec.stopping = true;
  await new Promise((r) => setTimeout(r, 60)); // let the last audio blocks arrive
  rec.active = false;
  rec.stopping = false;
  cancelAnimationFrame(rec.raf);
  rec.node.port.onmessage = null;
  rec.node.disconnect(); rec.src.disconnect(); rec.sink.disconnect();
  rec.stream.getTracks().forEach((t) => t.stop());
  $('#recBtn').classList.remove('recording');
  $('#booth').classList.remove('recording-live');
  $('#recState').textContent = 'Bereit – Leertaste oder Knopf drücken';
  if (!save) return;
  const len = rec.chunks.reduce((a, c) => a + c.length, 0);
  const all = new Float32Array(len);
  let o = 0;
  for (const c of rec.chunks) { all.set(c, o); o += c.length; }
  const clean = cleanTake(all, rec.ctx.sampleRate, cur().kind, { cutHead: 0.06, cutTail: 0.2 });
  if (!clean) { toast('Nichts Hörbares aufgenommen – ist das richtige Mikrofon aktiv?', 'err', 6000); return; }
  await saveTake(encodeWav(clean, rec.ctx.sampleRate), true);
}

/* Cleans a take right away, so what you hear in the studio is what goes into the game:
   removes the key/mouse click at start and end, DC offset and rumble (voice),
   trims silence with an adaptive threshold, normalises and adds short fades (no clicks). */
function cleanTake(input, rate, kind, { cutHead = 0, cutTail = 0 } = {}) {
  let s = input.slice(Math.floor(cutHead * rate), Math.max(0, input.length - Math.floor(cutTail * rate)));
  if (s.length < rate * 0.1) return null;
  // DC offset
  let mean = 0;
  for (const v of s) mean += v;
  mean /= s.length;
  for (let i = 0; i < s.length; i++) s[i] -= mean;
  // gentle 2nd-order high-pass at 75 Hz for voice (handling noise, desk rumble)
  if (kind === 'stimme') {
    const w = Math.tan(Math.PI * 75 / rate), k = Math.SQRT2, n = 1 / (1 + k * w + w * w);
    const b0 = n, b1 = -2 * n, b2 = n, a1 = 2 * (w * w - 1) * n, a2 = (1 - k * w + w * w) * n;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < s.length; i++) {
      const x = s[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; s[i] = y;
    }
  }
  // RMS per 10 ms window → adaptive silence threshold
  const win = Math.max(1, Math.floor(rate * 0.01));
  const rms = [];
  for (let i = 0; i < s.length; i += win) {
    let e = 0, n = 0;
    for (let k = i; k < Math.min(i + win, s.length); k++, n++) e += s[k] * s[k];
    rms.push(Math.sqrt(e / Math.max(1, n)));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] || 0;
  const loud = sorted[sorted.length - 1] || 0;
  if (loud < 0.0015) return null; // basically silence
  const thr = Math.max(floor * 4, loud * 0.06, 0.001);
  let a = rms.findIndex((v) => v > thr), b = rms.length - 1;
  while (b > a && rms[b] <= thr) b--;
  const pre = kind === 'stimme' ? 0.06 : 0.015, post = kind === 'stimme' ? 0.12 : 0.2;
  const start = Math.max(0, a * win - Math.floor(pre * rate));
  const end = Math.min(s.length, (b + 1) * win + Math.floor(post * rate));
  s = s.slice(start, end);
  // normalise to -1 dBFS (gain capped so pure noise is not blown up)
  let peak = 0;
  for (const v of s) peak = Math.max(peak, Math.abs(v));
  const gain = Math.min(0.89 / Math.max(peak, 1e-6), 30);
  for (let i = 0; i < s.length; i++) s[i] *= gain;
  // fades: 8 ms in, 30 ms out
  const fi = Math.min(s.length, Math.floor(rate * 0.008)), fo = Math.min(s.length, Math.floor(rate * 0.03));
  for (let i = 0; i < fi; i++) s[i] *= i / fi;
  for (let i = 0; i < fo; i++) s[s.length - 1 - i] *= i / fo;
  return s;
}

async function saveTake(wav, autoplay) {
  const s = cur();
  try {
    const r = await api(`api/take?mod=${encodeURIComponent(S.mod)}&kind=${s.kind}&key=${s.key}&variant=${$('#asVariant').checked ? 1 : 0}`, { method: 'POST', body: wav });
    S.fresh = r.file;
    await loadFiles();
    renderStepList();
    showStep();
    if (autoplay) playUrl(audioUrl(s.kind, r.file), $(`.take[data-file="${CSS.escape(r.file)}"] .play`));
    toast(`Gespeichert: ${r.file}`);
  } catch (err) { toast(err.message, 'err'); }
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Blob([buf], { type: 'audio/wav' });
}

/* scope */
const scope = $('#scope');
const sctx = scope.getContext('2d');
function clearScope() {
  const { width: W, height: H } = scope;
  sctx.clearRect(0, 0, W, H);
  sctx.strokeStyle = cssVar('--scope-line'); sctx.lineWidth = 1;
  sctx.beginPath(); sctx.moveTo(0, H / 2); sctx.lineTo(W, H / 2); sctx.stroke();
  $('#recTime').textContent = '0.0 s';
}
function drawLive() {
  const { width: W, height: H } = scope;
  const data = new Float32Array(rec.analyser.fftSize);
  const loop = () => {
    if (!rec.active) return;
    rec.analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (const x of data) peak = Math.max(peak, Math.abs(x));
    sctx.clearRect(0, 0, W, H);
    // level bar
    const g = sctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#4cc38a'); g.addColorStop(.7, cssVar('--accent')); g.addColorStop(1, '#e5484d');
    sctx.fillStyle = 'rgba(255,255,255,.04)'; sctx.fillRect(0, H - 8, W, 8);
    sctx.fillStyle = g; sctx.fillRect(0, H - 8, W * Math.min(1, peak * 1.4), 8);
    // waveform
    sctx.strokeStyle = cssVar('--accent-hi'); sctx.lineWidth = 2; sctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / data.length) * W, y = (H - 10) / 2 + data[i] * (H - 14) * 0.9;
      i ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
    }
    sctx.stroke();
    $('#recTime').textContent = `${((performance.now() - rec.start) / 1000).toFixed(1)} s`;
    rec.raf = requestAnimationFrame(loop);
  };
  loop();
}

/* mini waveforms */
let decodeCtx;
async function drawPeaks(canvas, url) {
  try {
    decodeCtx = decodeCtx || new AudioContext();
    const ab = await (await fetch(url)).arrayBuffer();
    const audio = await decodeCtx.decodeAudioData(ab);
    const d = audio.getChannelData(0);
    const c = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    const step = Math.max(1, Math.floor(d.length / W));
    let max = 0.001;
    const peaks = [];
    for (let x = 0; x < W; x++) { let p = 0; for (let i = x * step; i < (x + 1) * step && i < d.length; i++) p = Math.max(p, Math.abs(d[i])); peaks.push(p); max = Math.max(max, p); }
    c.clearRect(0, 0, W, H);
    c.fillStyle = cssVar('--accent');
    peaks.forEach((p, x) => { const h = Math.max(1, (p / max) * (H - 4)); c.fillRect(x, (H - h) / 2, 1, h); });
  } catch { /* ignore broken files */ }
}

$('#recBtn').onclick = () => (rec.active ? stopRecording() : startRecording());
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || S.page !== 'studio' || !S.mod || !$('#modal').hidden) return;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  e.preventDefault();
  rec.active ? stopRecording() : startRecording();
});

/* ---------- drag & drop / file picker ---------- */
async function importFiles(files) {
  if (!S.mod || !files.length) return;
  const importCtx = new AudioContext({ sampleRate: REC_RATE }); // decodes + resamples everything to 48 kHz
  const variantBox = $('#asVariant');
  const wasChecked = variantBox.checked;
  let first = true;
  for (const f of files) {
    try {
      const audio = await importCtx.decodeAudioData(await f.arrayBuffer());
      const mono = new Float32Array(audio.length);
      for (let ch = 0; ch < audio.numberOfChannels; ch++) {
        const d = audio.getChannelData(ch);
        for (let i = 0; i < d.length; i++) mono[i] += d[i] / audio.numberOfChannels;
      }
      const clean = cleanTake(mono, audio.sampleRate, cur().kind);
      if (!clean) { toast(`${f.name}: kein hörbarer Inhalt`, 'err'); continue; }
      variantBox.checked = wasChecked || !first; // further files become variants
      await saveTake(encodeWav(clean, audio.sampleRate), false);
      first = false;
    } catch { toast(`${f.name}: Format nicht lesbar`, 'err'); }
  }
  variantBox.checked = wasChecked;
  importCtx.close();
}
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { if (S.page === 'studio' && S.mod) { e.preventDefault(); drop.classList.add('over'); } }));
['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { if (ev === 'dragleave' && e.relatedTarget) return; drop.classList.remove('over'); }));
document.addEventListener('drop', (e) => { if (S.page === 'studio' && S.mod) { e.preventDefault(); importFiles([...e.dataTransfer.files]); } });
// the whole drop zone opens the file picker
$('#drop').onclick = (e) => { if (e.target.id !== 'fileInput') $('#fileInput').click(); }; // input sits inside the zone
$('#fileInput').onchange = (e) => { importFiles([...e.target.files]); e.target.value = ''; };

/* ---------- settings: theme + animations (watermark is always on) ---------- */
const root = document.documentElement;
const cssVar = (n) => getComputedStyle(root).getPropertyValue(n).trim();
function applySettings(s) {
  S.settings = s;
  root.dataset.theme = s.theme;
  root.dataset.watermark = 'on';
  root.dataset.anim = s.animations ? 'on' : 'off';
  $$('.theme-card').forEach((c) => c.classList.toggle('active', c.dataset.themePick === s.theme));
  $$('.lang-card').forEach((c) => c.classList.toggle('active', c.dataset.lang === I18N.lang));
  $('#animToggle').checked = s.animations;
  $('#autoUpdToggle').checked = !!s.autoUpdate;
  try { localStorage.setItem('sc-settings', JSON.stringify(s)); } catch {}
  if (S.mod && S.page === 'studio') { clearScope(); renderTakes(); }
}
async function saveSettings(patch) {
  applySettings({ ...S.settings, ...patch }); // instant feedback
  try { applySettings(await api('api/settings', { method: 'POST', json: patch })); } catch (err) { toast(err.message, 'err'); }
}
let cachedLang = 'en'; // English on first start
try { const c = JSON.parse(localStorage.getItem('sc-settings')); if (c) { root.dataset.theme = c.theme; root.dataset.anim = c.animations ? 'on' : 'off'; if (c.lang) cachedLang = c.lang; } } catch {}
I18N.start(cachedLang);

$$('.theme-card').forEach((c) => (c.onclick = () => saveSettings({ theme: c.dataset.themePick })));
$$('.lang-card').forEach((c) => (c.onclick = async () => {
  if (c.dataset.lang === I18N.lang) return;
  const s = await api('api/settings', { method: 'POST', json: { lang: c.dataset.lang } });
  localStorage.setItem('sc-settings', JSON.stringify(s));
  location.reload(); // re-render everything in the new language
}));
$('#animToggle').onchange = (e) => saveSettings({ animations: e.target.checked });
$('#autoUpdToggle').onchange = (e) => saveSettings({ autoUpdate: e.target.checked });

/* ---------- WoT folder ---------- */
$('#gameDetect').onclick = async () => {
  const r = await api('api/games');
  if (!r.found.length) return toast('Keine WoT-Installation gefunden. Bitte den Ordner selbst wählen.', 'err', 6000);
  await saveSettings({ gameDir: r.found[0] });
  await refresh();
  toast(`Gefunden: ${r.found[0]}`);
};
$('#gamePick').onclick = async () => {
  toast('Ordner-Auswahl geöffnet …', 'busy', 2500);
  const r = await api('api/pickfolder', { method: 'POST', json: {} });
  if (!r.dir) return;
  if (!r.valid) return toast('In diesem Ordner ist kein World of Tanks (version.xml fehlt).', 'err', 6000);
  await saveSettings({ gameDir: r.dir });
  await refresh();
  toast('WoT-Ordner gespeichert');
};

/* ---------- updates (GitHub Releases) ---------- */
function showUpdate(u) {
  const st = $('#updStatus');
  st.className = '';
  if (!u.configured) { st.textContent = 'Update-Prüfung ist noch nicht eingerichtet (kein GitHub-Repository in version.json).'; return; }
  if (u.error) { st.textContent = u.error; st.className = 'err'; return; }
  if (!u.latest) { st.textContent = 'Noch kein Release auf GitHub veröffentlicht.'; return; }
  if (!u.update) { st.textContent = `Du hast die aktuelle Version (v${u.current}).`; st.className = 'ok'; $('#updBanner').hidden = true; return; }
  st.textContent = `Neue Version verfügbar: v${u.latest}`;
  st.className = 'new';
  if (sessionStorage.getItem('upd-dismissed') === u.latest) return;
  $('#updTitle').textContent = `Achtung: veraltete Version (v${u.current})`;
  $('#updSub').textContent = `v${u.latest} ist da. Ohne Update funktioniert der Mod evtl. nicht richtig – deine Mods und Einstellungen bleiben erhalten.`;
  $('#updNotes').href = u.url;
  $('#updInstall').hidden = !u.installable;
  $('#updBanner').hidden = false;
  $('#updBanner').dataset.latest = u.latest;
}
async function checkUpdate(force, startup) {
  let u;
  try { u = await api(`api/update${force ? '?force=1' : ''}`); } catch { return; } // offline: ignore
  showUpdate(u);
  // optional: install new versions right away on start
  if (startup && u.update && u.installable && S.settings && S.settings.autoUpdate && !rec.active) installUpdate(u.latest);
}
$('#updCheck').onclick = async () => { $('#updStatus').textContent = 'Suche …'; await checkUpdate(true); };
$('#updClose').onclick = () => { $('#updBanner').hidden = true; sessionStorage.setItem('upd-dismissed', $('#updBanner').dataset.latest || ''); };
$('#updInstall').onclick = async () => {
  if (rec.active) return;
  const ok = await modal({ title: `Auf v${$('#updBanner').dataset.latest} aktualisieren?`,
    text: 'Das Update wird heruntergeladen und geprüft. Danach schließt sich der Client kurz und startet neu.\nDeine Mods und Einstellungen bleiben erhalten.',
    buttons: [{ label: 'Später', value: false }, { label: 'Jetzt aktualisieren', value: true, cls: 'primary', default: true }] });
  if (ok) installUpdate();
};
async function installUpdate(auto) {
  const t = toast(auto ? `Installiere v${auto} automatisch …` : 'Lade Update herunter und prüfe es …', 'busy', 0);
  try {
    const r = await api('api/update/install', { method: 'POST', json: {} });
    t.remove();
    toast(`v${r.version} wird installiert – der Client startet gleich neu.`, 'ok', 0);
  } catch (err) { t.remove(); toast(err.message, 'err', 8000); }
};

/* ---------- small changelog (Hilfe › Changelog) ---------- */
const CHANGELOG = [
  ['6.2', '25.11.2026', 'Standard & Kommandant', ['Slots heißen wie in WoT: Standard und Kommandant', 'Eigener Testton für Kommandant (drei Pieptöne)', 'Hinweis: Neue Sounds wirken nach einem Neustart von WoT']],
  ['6.1.1', '25.11.2026', 'Alles auch auf Englisch', ['Anleitung und Sprachliste auch auf Englisch', 'Behoben: einige englische Texte blieben deutsch']],
  ['6.1', '25.11.2026', 'Mehr Sprachen, Neu-laden-Knopf & Update-Warnung', ['Russisch, Polnisch, Französisch und Spanisch', '„Im Spiel aktiv“: blauer Neu-laden-Knopf, leuchtet bei Änderungen', 'Eigene Aufklapp-Menüs im Hexcall-Design', 'Warnung bei veralteter Version, auf Wunsch automatische Updates', 'Hinweis nach WoT-Updates mit „Sounds wieder einschalten“', 'Neu: WoT direkt aus dem Client starten bzw. nach „Neu laden“ neu starten']],
  ['6.0', '25.11.2026', 'Bereit zum Veröffentlichen', ['Neuer Name: Hexcall · Sprache Englisch/Deutsch', 'Saubere Aufnahmen: kein Knacken mehr, Stille und Klicks werden sofort entfernt', 'Update-Prüfung über GitHub mit Ein-Klick-Update', 'WoT-Ordner wird automatisch gefunden oder kann gewählt werden', 'Mods und Einstellungen liegen jetzt in %APPDATA%\\Hexcall']],
  ['5.4', '25.11.2026', 'Anleitung & Sprachliste für Windows', ['Anleitung.html und Sprachliste.html: Doppelklick öffnet sie im Browser', 'Sprachliste mit Suche, Kopier-Knopf und Druckansicht', 'Links dazu unter Hilfe']],
  ['5.3', '25.11.2026', 'Aktiver Mod & Wieder einschalten', ['Aktiver Mod in der Bibliothek grün markiert und oben einsortiert', 'Aktivieren/Deaktivieren direkt auf der Mod-Karte', 'Nach „Mod aus“: Wieder einschalten mit einem Klick']],
  ['5.2', '25.11.2026', 'Stabilität & Feinschliff', ['Behoben: „Failed to fetch“ – Hintergrunddienst bleibt aktiv', 'WoT-Spielername in der Seitenleiste', 'Anzeige „Mod aktiv“']],
  ['5.1', '25.11.2026', 'Kleines Changelog', ['Changelog unter Hilfe, Versionsnummer in der Seitenleiste']],
  ['5.0', '25.11.2026', 'DarkWizard Edition', ['DarkWizard-Emblem, Wasserzeichen und Profil', 'Designs: DarkWizard, Commander, Hell', 'Einstellungen-Seite']],
  ['4.0', '25.11.2026', 'Hexcall Client', ['Neue Oberfläche als eigenes Fenster', 'Live-Pegel, Wellenformen, Drag & Drop für MP3/M4A/OGG']],
  ['3.0', '25.11.2026', 'Aufnahme-Assistent & Effekte', ['Mikrofon-Aufnahme mit Überspringen', '12 Effekte: Kanone, Motor, Turm, Ketten …']],
  ['2.0', '25.11.2026', 'Stimmen-Manager', ['Erste Oberfläche, zwei Stimmen-Slots im Spiel umschaltbar']],
  ['1.0', '25.11.2026', 'Sound-Bank-Tool', ['Eigene Commander-Stimme ohne Wwise, alle Nationen']],
];
$('#sub-log').innerHTML = CHANGELOG.map(([v, d, t, items]) => `<div class="cl-item">
  <div><div class="cl-ver">v${v}</div><div class="cl-date">${d}</div></div>
  <div><div class="cl-title">${esc(t)}</div><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div></div>`).join('');
function showSub(sub) {
  $$('.subtabs button').forEach((b) => b.classList.toggle('active', b.dataset.sub === sub));
  $('#sub-guide').hidden = sub !== 'guide';
  $('#sub-log').hidden = sub !== 'log';
}
$$('.subtabs button').forEach((b) => (b.onclick = () => showSub(b.dataset.sub)));
$('#verLink').onclick = () => { go('help'); showSub('log'); };

/* ---------- dropdowns: themed replacement for the native <select> popup ---------- */
// The native select stays in the DOM (hidden) and keeps the value; the button + menu only mirror it.
let ddOpen = null;
function enhanceSelect(sel) {
  let dd = sel.nextElementSibling;
  if (!dd || !dd.classList.contains('dd')) {
    dd = document.createElement('div');
    dd.className = 'dd';
    dd.innerHTML = `<button type="button" class="dd-btn"><span class="dd-dot"></span><span class="dd-val"></span><span class="dd-sub"></span><svg class="dd-chev"><use href="#i-chevron"/></svg></button>`;
    sel.after(dd);
    sel.classList.add('dd-native');
    $('.dd-btn', dd).onclick = (e) => { e.stopPropagation(); ddOpen && ddOpen.sel === sel ? closeDropdown() : openDropdown(sel, dd); };
    $('.dd-btn', dd).onkeydown = (e) => {
      if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      if (!ddOpen) openDropdown(sel, dd);
    };
  }
  dd.classList.toggle('wide', sel.classList.contains('slot-select'));
  const o = sel.selectedOptions[0];
  $('.dd-val', dd).textContent = o ? o.textContent : '–';
  $('.dd-sub', dd).textContent = o && o.dataset.sub ? o.dataset.sub : '';
  $('.dd-dot', dd).className = `dd-dot ${o && o.dataset.kind ? 'k-' + o.dataset.kind : 'none'}`;
}

function openDropdown(sel, dd) {
  closeDropdown();
  const menu = document.createElement('div');
  menu.className = 'dd-menu';
  menu.setAttribute('role', 'listbox');
  menu.innerHTML = [...sel.options].map((o, i) => `<button type="button" class="dd-opt ${o.selected ? 'sel' : ''}" data-i="${i}" role="option">
      <span class="dd-dot ${o.dataset.kind ? 'k-' + o.dataset.kind : 'none'}"></span>
      <span class="dd-txt"><b>${esc(o.textContent)}</b>${o.dataset.sub ? `<small>${esc(o.dataset.sub)}</small>` : ''}</span>
      ${o.selected ? icon('check') : ''}</button>`).join('');
  document.body.appendChild(menu);
  const r = $('.dd-btn', dd).getBoundingClientRect();
  menu.style.minWidth = `${r.width}px`;
  menu.style.left = `${r.left}px`;
  const below = innerHeight - r.bottom - 12, h = Math.min(menu.scrollHeight, 320);
  if (below < h && r.top > below) { menu.style.bottom = `${innerHeight - r.top + 6}px`; menu.classList.add('up'); }
  else menu.style.top = `${r.bottom + 6}px`;
  dd.classList.add('open');
  ddOpen = { sel, dd, menu };
  menu.onclick = (e) => {
    const b = e.target.closest('.dd-opt');
    if (!b) return;
    pick(+b.dataset.i);
  };
  const pick = (i) => {
    const changed = sel.selectedIndex !== i;
    sel.selectedIndex = i;
    closeDropdown();
    enhanceSelect(sel);
    $('.dd-btn', dd).focus();
    if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
  };
  menu.onkeydown = (e) => {
    const opts = $$('.dd-opt', menu), cur = opts.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (opts[cur + 1] || opts[0]).focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (opts[cur - 1] || opts[opts.length - 1]).focus(); }
  };
  ($('.dd-opt.sel', menu) || $('.dd-opt', menu)).focus({ preventScroll: true });
  ($('.dd-opt.sel', menu) || menu).scrollIntoView({ block: 'nearest' });
}
function closeDropdown() {
  if (!ddOpen) return;
  ddOpen.dd.classList.remove('open');
  ddOpen.menu.remove();
  ddOpen = null;
}
document.addEventListener('click', (e) => { if (ddOpen && !e.target.closest('.dd-menu')) closeDropdown(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ddOpen) { const b = $('.dd-btn', ddOpen.dd); closeDropdown(); b.focus(); } }, true);
$('.main').addEventListener('scroll', closeDropdown);
addEventListener('resize', closeDropdown);

/* ---------- WoT was updated: the sounds are gone until they are built again ---------- */
function renderWotUpdate() {
  const u = S.info.wotUpdate, el = $('#wotBanner');
  el.hidden = !u;
  if (!u) return;
  const names = [...new Set(Object.values(u.aktiv).filter((v) => v && v !== 'original').map(label))];
  $('#wotSub').textContent = `${u.from} → ${u.to}: Deine Sounds (${names.join(', ')}) sind deshalb gerade aus.`;
}
$('#wotReapply').onclick = async () => {
  const t = toast('Schalte wieder ein …', 'busy', 0);
  try {
    const r = await api('api/reapply', { method: 'POST', json: {} });
    $('#log').textContent = r.output;
    t.remove();
    toast(r.ok ? 'Wieder eingeschaltet. Wirkt nach einem Neustart von WoT.' : 'Fehler – siehe Protokoll', r.ok ? 'ok' : 'err', 5000);
  } catch (err) { t.remove(); toast(err.message, 'err'); }
  await refresh();
};

/* ---------- start / restart World of Tanks ---------- */
async function startGame(restart) {
  const t = toast(restart ? 'Starte WoT neu …' : 'Starte World of Tanks …', 'busy', 0);
  try { await api('api/game/start', { method: 'POST', json: { restart: !!restart } }); }
  catch (err) { toast(err.message, 'err', 6000); }
  t.remove();
  setTimeout(() => refresh().catch(() => {}), 8000);
}
$('#gameStart').onclick = () => startGame(false);

/* ---------- start ---------- */
setInterval(() => api('api/ping', { method: 'POST', json: {} }).catch(() => {}), 10000);
setInterval(() => { if (!rec.active) refresh(false).catch(() => {}); }, 30000);
(async () => {
  try {
    const settings = await api('api/settings');
    if (settings.lang !== I18N.lang) { localStorage.setItem('sc-settings', JSON.stringify(settings)); location.reload(); return; }
    applySettings(settings);
    S.steps = await api('api/steps');
    if (I18N.lang !== 'de') S.steps = S.steps.map((s) => ({ ...s, ...(s.tr[I18N.lang] || s.tr.en) }));
    await refresh();
    checkUpdate(false, true);
  } catch (err) {
    toast('Backend nicht erreichbar. Bitte über „Sound-Mod-Manager.cmd“ starten.', 'err', 0);
  }
})();
