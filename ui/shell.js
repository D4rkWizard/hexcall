'use strict';
// Hexhub shell: navigation, game pages (header + tabs), home, settings, ideas, updates.
// Game modules live in games/<id>/ui and register themselves with Hexhub.register(id, module).

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const locale = () => ({ de: 'de-DE', en: 'en-GB', ru: 'ru-RU', pl: 'pl-PL', fr: 'fr-FR', es: 'es-ES' }[I18N.lang] || 'en-GB');
const fmt = (n, d = 0) => (n == null || isNaN(n) ? '–' : Number(n).toLocaleString(locale(), { maximumFractionDigits: d, minimumFractionDigits: d }));
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const icon = (n, cls = '') => `<svg class="${cls}"><use href="#${n.startsWith('g-') ? n : 'i-' + n}"/></svg>`;

// GET when json is undefined, otherwise POST with a JSON body
async function api(p, json) {
  let r;
  try { r = await fetch(p, json === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) }); setOffline(false); }
  catch (e) { setOffline(true); throw new Error('Keine Verbindung zum Hintergrunddienst'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Fehler ${r.status}`);
  return d;
}
let offlineEl = null;
function setOffline(on) {
  if (on && !offlineEl) { offlineEl = document.createElement('div'); offlineEl.className = 'offline'; offlineEl.textContent = 'Keine Verbindung zum Hintergrunddienst – verbinde neu …'; document.body.appendChild(offlineEl); }
  if (!on && offlineEl) { offlineEl.remove(); offlineEl = null; }
}
function toast(t, err) {
  const el = document.createElement('div');
  el.className = `toast ${err ? 'err' : ''}`; el.textContent = t;
  document.querySelectorAll('.toast').forEach((x, i, all) => { if (all.length > 2) all[0].remove(); });
  document.body.appendChild(el); setTimeout(() => el.remove(), 4500);
}
function fmtDur(ms) {
  const m = Math.floor((ms || 0) / 60000);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
const fmtHours = (ms) => (!ms ? '–' : ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))} min` : `${fmt(ms / 3600000, ms < 36000000 ? 1 : 0)} h`);
const dateFmt = (iso, withTime = true) => (iso ? new Date(iso).toLocaleString(locale(), withTime ? { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–');
function dropZone(el, onFiles) {
  ['dragenter', 'dragover'].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.remove('over'); }));
  el.addEventListener('drop', (e) => onFiles([...e.dataTransfer.files]));
}
// a file dropped anywhere else must not be opened by the window
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

const Hexhub = (() => {
  const S = { info: null, settings: null, games: [], mods: {}, route: { view: 'home', tab: null }, ideas: [], upd: null, loaded: {} };
  const byId = (id) => S.games.find((g) => g.id === id);

  /* ---------------------------------------------------------------- game modules */
  function register(id, mod) { S.mods[id] = mod; }
  const loadScript = (src) => new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error(src)); document.body.appendChild(s); });

  async function loadGame(g) {
    if (S.loaded[g.id]) return S.loaded[g.id];
    return (S.loaded[g.id] = (async () => {
      const base = `/games/${g.id}/`;
      for (const css of (g.ui && g.ui.css) || []) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = base + css; document.head.appendChild(l); }
      const body = $(`#view-game-${g.id} .gbody`);
      const js = (g.ui && g.ui.js) || [];
      // dictionaries first, so the page is translated as soon as it is inserted
      for (const f of js.filter((x) => /^i18n/.test(x))) await loadScript(base + f);
      if (g.ui && g.ui.html) body.innerHTML = await (await fetch(base + g.ui.html)).text();
      for (const f of js.filter((x) => !/^i18n/.test(x))) await loadScript(base + f);
      const mod = S.mods[g.id];
      if (mod && mod.init) await mod.init(body, g);
      return mod;
    })());
  }

  /* ---------------------------------------------------------------- navigation */
  function go(view, tab) {
    if (view.startsWith('game:')) {
      const id = view.slice(5), g = byId(id);
      if (!g) return go('home');
      tab = tab || (S.route.view === view ? S.route.tab : null) || lastTab(id) || g.tabs[0].id;
      S.route = { view, tab };
      showView(`view-game-${id}`);
      $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
      $$(`#view-game-${id} .gtabs button`).forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      loadGame(g).then((mod) => {
        $$(`#view-game-${id} .gbody > .page`).forEach((p) => p.classList.toggle('active', p.dataset.tab === tab));
        if (mod && mod.open) try { mod.open(tab); } catch (e) { console.error(e); }
      }).catch((e) => toast(`Modul ${g.name} konnte nicht geladen werden: ${e.message}`, true));
      try { localStorage.setItem(`hexhub-tab-${id}`, tab); } catch {}
    } else {
      S.route = { view, tab: null };
      showView(`view-${view}`);
      $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
      if (view === 'ideas') loadIdeas();
      if (view === 'settings') renderSettings();
    }
    try { localStorage.setItem('hexhub-route', view); } catch {}
  }
  const lastTab = (id) => { try { const t = localStorage.getItem(`hexhub-tab-${id}`); return byId(id).tabs.some((x) => x.id === t) ? t : null; } catch { return null; } };
  function showView(id) { $$('.view').forEach((v) => v.classList.toggle('active', v.id === id)); }

  document.addEventListener('click', (e) => {
    const v = e.target.closest('[data-view]'); if (v) return go(v.dataset.view, v.dataset.tab);
    const t = e.target.closest('.gtabs [data-tab]'); if (t) return go(S.route.view, t.dataset.tab);
    const gt = e.target.closest('[data-goto]');
    if (gt) { const [g, tab] = gt.dataset.goto.split(':'); return tab ? go(`game:${g}`, tab) : go(g); }
    const act = e.target.closest('[data-gact]');
    if (act) gameAction(act.dataset.gid, act.dataset.gact, act);
  });

  /* ---------------------------------------------------------------- game pages */
  function buildGame(g) {
    $('#gameNav').insertAdjacentHTML('beforeend', `<button class="gnav" data-view="game:${g.id}" style="--g:${g.color}">
      <span class="g-badge">${icon('g-' + g.id)}<span class="run"></span></span><span class="g-txt">${esc(g.name)}<small data-gsub="${g.id}">–</small></span></button>`);
    const tabs = g.tabs.map((t) => (t.sep ? '<span class="sep"></span>' : '') + `<button data-tab="${t.id}">${icon(t.icon)}${esc(t.label)}</button>`).join('');
    $('#main').insertAdjacentHTML('beforeend', `<section class="view game" id="view-game-${g.id}" style="--g:${g.color}">
      <div class="ghead"><div class="ghead-in">
        <div class="g-logo">${icon('g-' + g.id)}</div>
        <div class="g-title"><div class="eyebrow">${esc(g.tagline || 'Spiel')}</div><h1>${esc(g.name)}</h1><div class="g-meta" data-gmeta="${g.id}"></div></div>
        <div class="g-actions">
          <span class="pill" data-gpill="${g.id}"><i></i><span>–</span></span>
          <button class="btn ghost icon" data-gact="folder" data-gid="${g.id}" title="Spielordner öffnen">${icon('folder')}</button>
          <button class="btn primary play" data-gact="launch" data-gid="${g.id}">${icon('play')}<span>Spielen</span></button>
        </div>
      </div>
      <nav class="gtabs">${tabs}</nav></div>
      <div class="gbody"></div></section>`);
  }

  function renderGameStatus(g) {
    const sub = $(`[data-gsub="${g.id}"]`);
    sub.textContent = !g.installed ? 'nicht gefunden' : g.running ? `läuft · ${fmtDur(Date.now() - g.since)}` : 'bereit';
    $(`.gnav[data-view="game:${g.id}"]`).classList.toggle('running', !!g.running);
    const pill = $(`[data-gpill="${g.id}"]`);
    pill.className = `pill ${g.running ? 'on' : !g.installed ? 'warn' : ''}`;
    pill.querySelector('span').textContent = g.running ? `Läuft seit ${fmtDur(Date.now() - g.since)}` : g.installed ? 'Nicht gestartet' : 'Nicht gefunden';
    const btn = $(`[data-gact][data-gid="${g.id}"].play`);
    if (btn) {
      btn.dataset.gact = g.running ? 'close' : 'launch';
      btn.className = `btn play ${g.running ? 'danger' : 'primary'}`;
      btn.innerHTML = g.running ? `${icon('stop')}<span>Schließen</span>` : `${icon('play')}<span>Spielen</span>`;
      btn.disabled = !g.installed && !g.running;
    }
    $(`[data-gact="folder"][data-gid="${g.id}"]`).disabled = !g.dir;
    const meta = [];
    if (g.version) meta.push(`<span>${icon('tag')}${esc(g.version)}</span>`);
    if (g.player) meta.push(`<span>${icon('user')}${esc(g.player)}</span>`);
    if (g.playtime && g.playtime.total) meta.push(`<span title="Gemessen, während Hexhub läuft">${icon('clock')}${fmtHours(g.playtime.total)} gespielt</span>`);
    if (!g.installed) meta.push(`<span>Nicht gefunden – <a href="#" data-view="settings" style="color:var(--g)">Ordner wählen</a></span>`);
    $(`[data-gmeta="${g.id}"]`).innerHTML = meta.join('');
    const mod = S.mods[g.id];
    if (mod && mod.status) try { mod.status(g); } catch {}
  }

  async function gameAction(id, act, btn) {
    const g = byId(id);
    try {
      if (act === 'launch') {
        btn && (btn.disabled = true);
        const r = await api('/api/core/game/launch', { id });
        toast(r.note || `${g.name} wird gestartet …`);
      }
      if (act === 'close') {
        if (!confirm(`${g.name} wirklich schließen? Nicht gespeicherter Fortschritt kann verloren gehen.`)) return;
        btn && (btn.disabled = true);
        const r = await api('/api/core/game/close', { id });
        toast(r.ok ? `${g.name} wurde geschlossen` : `${g.name} ließ sich nicht schließen`, !r.ok);
      }
      if (act === 'folder') await api('/api/core/game/folder', { id });
      if (act === 'open') return go(`game:${id}`);
    } catch (e) { toast(e.message, true); }
    finally { setTimeout(refresh, 1200); if (btn) setTimeout(() => (btn.disabled = false), 1500); }
  }

  /* ---------------------------------------------------------------- home */
  function renderHome() {
    const run = S.games.filter((g) => g.running);
    $('#nowPlaying').innerHTML = run.map((g) => `<div class="now-playing" style="--g:${g.color}"><div class="g-logo">${icon('g-' + g.id)}</div>
      <div class="np-txt"><b>${esc(g.name)} läuft</b><small>seit ${fmtDur(Date.now() - g.since)}${g.player ? ` · ${esc(g.player)}` : ''}</small></div>
      <button class="btn ghost" data-view="game:${g.id}">Öffnen</button><button class="btn danger" data-gact="close" data-gid="${g.id}">${icon('stop')}Schließen</button></div>`).join('');
    const players = S.games.map((g) => g.player).filter(Boolean);
    $('#hello').textContent = players.length ? `Willkommen zurück, ${players[0]}.` : 'Willkommen zurück.';
    const focused = $('#gameCards').contains(document.activeElement);
    if (focused) return;
    $('#gameCards').innerHTML = S.games.map((g) => {
      const mod = S.mods[g.id];
      const stats = (mod && mod.homeStats && mod.homeStats(g)) || [];
      return `<div class="gcard" style="--g:${g.color}">
        <div class="gc-cover" data-view="game:${g.id}">${icon('g-' + g.id, 'big')}
          <span class="pill ${g.running ? 'on' : !g.installed ? 'warn' : ''}"><i></i><span>${g.running ? `Läuft · ${fmtDur(Date.now() - g.since)}` : g.installed ? 'Bereit' : 'Nicht gefunden'}</span></span>
          <h2>${esc(g.name)}</h2></div>
        <div class="gc-body">
          <p>${esc(g.tagline || '')}</p>
          <div class="gc-stats">
            <div><b>${g.version ? esc(g.version) : '–'}</b>Version</div>
            <div><b>${fmtHours(g.playtime && g.playtime.total)}</b>Gespielt</div>
            ${stats.map(([v, l]) => `<div><b>${v}</b>${esc(l)}</div>`).join('')}
          </div>
          <div class="qlinks">${g.tabs.slice(1).map((t) => `<button data-view="game:${g.id}" data-tab="${t.id}">${icon(t.icon)}${esc(t.label)}</button>`).join('')}</div>
          <div class="gc-acts">
            ${g.running ? `<button class="btn danger" style="flex:1" data-gact="close" data-gid="${g.id}">${icon('stop')}Schließen</button>`
              : `<button class="btn primary" data-gact="launch" data-gid="${g.id}" ${g.installed ? '' : 'disabled'}>${icon('play')}Spielen</button>`}
            <button class="btn ghost" data-view="game:${g.id}">Öffnen ${icon('right')}</button>
          </div>
        </div></div>`;
    }).join('');
  }

  /* ---------------------------------------------------------------- status */
  async function refresh() {
    try { S.games = mergeGames(await api('/api/core/games')); } catch { return; }
    for (const g of S.games) renderGameStatus(g);
    const run = S.games.filter((g) => g.running);
    $('#runDot').classList.toggle('on', run.length > 0);
    $('#runTxt').textContent = run.length ? `${run.map((g) => g.short || g.name).join(', ')} läuft` : 'Kein Spiel läuft';
    if (S.route.view === 'home') renderHome();
  }
  // ?anon=1 hides account names (for screenshots)
  const ANON = /[?&]anon=1/.test(location.search);
  const mergeGames = (list) => list.map((g) => ({ ...(byId(g.id) || {}), ...g, ...(ANON && g.player ? { player: 'DarkWizard' } : {}) }));

  /* ---------------------------------------------------------------- settings */
  function applyUi(s) {
    document.documentElement.dataset.theme = s.theme;
    document.documentElement.dataset.anim = s.animations ? 'on' : 'off';
    try { localStorage.setItem('hexhub-ui', JSON.stringify({ theme: s.theme, animations: s.animations })); } catch {}
  }
  async function saveSettings(patch) {
    try {
      const before = S.settings.lang;
      S.settings = await api('/api/core/settings', patch);
      applyUi(S.settings);
      // embedded pages (Hexcall) pick up language/theme on reload
      $$('iframe.embed').forEach((f) => { try { if (f.src) f.contentWindow.location.reload(); } catch {} });
      if (S.settings.lang !== before) return location.reload();
      renderSettings();
    } catch (e) { toast(e.message, true); }
  }
  function renderSettings() {
    const s = S.settings;
    $$('#langs .lang-card').forEach((c) => c.classList.toggle('active', c.dataset.lang === s.lang));
    $$('.theme-card').forEach((c) => c.classList.toggle('active', c.dataset.themePick === s.theme));
    $('#animToggle').checked = s.animations;
    $('#autoUpdToggle').checked = s.autoUpdate;
    $('#setVersion').textContent = `${S.info.name} v${S.info.version}`;
    $('#dataDir').textContent = S.info.data;
    const box = $('#gameSettings');
    if (!box.dataset.built) {
      box.dataset.built = '1';
      box.innerHTML = S.games.map((g) => `<div class="game-set" style="--g:${g.color}" data-gset="${g.id}"><h3><span class="g-badge">${icon('g-' + g.id)}</span>${esc(g.name)}</h3><div class="gs-body"></div></div>`).join('');
    }
    for (const g of S.games) {
      const el = $(`[data-gset="${g.id}"] .gs-body`);
      loadGame(g).then((mod) => { if (mod && mod.settings) mod.settings(el, g); else el.innerHTML = `<div class="card set-row"><div class="sr-text"><b>${esc(g.dir || '–')}</b><span>Spielordner</span></div></div>`; }).catch(() => {});
    }
  }
  $$('#langs .lang-card').forEach((c) => (c.onclick = () => saveSettings({ lang: c.dataset.lang })));
  $$('.theme-card').forEach((c) => (c.onclick = () => saveSettings({ theme: c.dataset.themePick })));
  $('#animToggle').onchange = (e) => saveSettings({ animations: e.target.checked });
  $('#autoUpdToggle').onchange = (e) => saveSettings({ autoUpdate: e.target.checked });

  /* ---------------------------------------------------------------- updates */
  async function checkUpdate(force) {
    try {
      const u = S.upd = await api(`/api/core/update${force ? '?force=1' : ''}`);
      const st = $('#updStatus');
      if (!u.configured) st.textContent = 'Kein Update-Server eingetragen.';
      else if (u.error) st.textContent = u.error;
      else if (u.update) st.textContent = `Neue Version verfügbar: v${u.latest}`;
      else st.textContent = `Du hast die aktuelle Version (v${u.current}).`;
      $('#updChip').hidden = !u.update;
      if (u.update) {
        if (S.settings.autoUpdate && u.installable && !force) { toast(`Installiere v${u.latest} automatisch …`); return installUpdate(); }
        $('#updTitle').textContent = `Update verfügbar: v${u.latest}`;
        $('#updSub').textContent = `Du nutzt v${u.current}. Deine Daten und Einstellungen bleiben erhalten.`;
        $('#updInstall').hidden = !u.installable;
        try { if (sessionStorage.getItem('hexhub-upd-later') !== u.latest) $('#updBanner').hidden = false; } catch { $('#updBanner').hidden = false; }
      }
    } catch (e) { $('#updStatus').textContent = e.message; }
  }
  async function installUpdate() {
    try { const r = await api('/api/core/update/install', {}); toast(`v${r.version} wird installiert – der Client startet gleich neu.`); }
    catch (e) { toast(e.message, true); }
  }
  $('#updCheck').onclick = () => checkUpdate(true);
  $('#updInstall').onclick = () => { if (confirm(`Auf v${S.upd.latest} aktualisieren?`)) installUpdate(); };
  $('#updNotes').onclick = () => S.upd && api('/api/core/open-url', { url: S.upd.url }).catch((e) => toast(e.message, true));
  $('#updClose').onclick = () => { $('#updBanner').hidden = true; try { sessionStorage.setItem('hexhub-upd-later', S.upd.latest); } catch {} };
  $('#updChip').onclick = () => { $('#updBanner').hidden = false; };

  /* ---------------------------------------------------------------- ideas */
  async function loadIdeas() {
    $('#ideaGame').innerHTML = `<option value="">Allgemein</option>${S.games.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}`;
    try { S.ideas = await api('/api/core/ideas'); } catch {}
    renderIdeas();
  }
  function renderIdeas() {
    const name = (id) => (byId(id) ? byId(id).short || byId(id).name : 'Allgemein');
    $('#ideaList').innerHTML = S.ideas.map((i) => `<div class="idea ${i.done ? 'done' : ''}" data-id="${esc(i.id)}"><button class="chk" data-toggle title="Erledigt"></button>
      <span class="gtag">${esc(name(i.game))}</span><div class="txt">${esc(i.text)}</div><span class="when">${dateFmt(i.at, false)}</span>
      <button class="btn sm ghost icon" data-del title="Löschen">${icon('trash')}</button></div>`).join('') || '<div class="empty" style="padding:30px">Noch keine Ideen. Schreib oben die erste rein.</div>';
  }
  async function saveIdeas() { S.ideas = await api('/api/core/ideas', S.ideas); renderIdeas(); }
  $('#ideaAdd').onclick = () => { const t = $('#ideaInput').value.trim(); if (!t) return; S.ideas.unshift({ id: String(Date.now()), game: $('#ideaGame').value, text: t, done: false, at: new Date().toISOString() }); $('#ideaInput').value = ''; saveIdeas(); };
  $('#ideaInput').onkeydown = (e) => { if (e.key === 'Enter') $('#ideaAdd').click(); };
  $('#ideaList').addEventListener('click', (e) => {
    const row = e.target.closest('.idea'); if (!row) return;
    const i = S.ideas.find((x) => x.id === row.dataset.id);
    if (e.target.closest('[data-toggle]')) { i.done = !i.done; saveIdeas(); }
    if (e.target.closest('[data-del]')) { S.ideas = S.ideas.filter((x) => x !== i); saveIdeas(); }
  });

  /* ---------------------------------------------------------------- start */
  async function boot() {
    try {
      [S.info, S.settings] = await Promise.all([api('/api/core/info'), api('/api/core/settings')]);
    } catch (e) { setTimeout(boot, 1500); return; }
    applyUi(S.settings);
    I18N.start(S.settings.lang);
    $('#appVer').textContent = `${S.info.name} v${S.info.version}`;
    S.games = mergeGames(await api('/api/core/games'));
    for (const g of S.games) buildGame(g);
    for (const g of S.games) renderGameStatus(g);
    // load all game modules in the background (home cards show their numbers)
    Promise.all(S.games.map((g) => loadGame(g).catch(() => {}))).then(() => { if (S.route.view === 'home') renderHome(); });
    let start = 'home', tab;
    try { start = localStorage.getItem('hexhub-route') || 'home'; } catch {}
    // direct link: #game:osu/replays, #settings
    const h = /^#([\w:]+)(?:\/(\w+))?$/.exec(location.hash);
    if (h) { start = h[1]; tab = h[2]; }
    go(start.startsWith('game:') && !byId(start.slice(5)) ? 'home' : start, tab);
    renderHome();
    await refresh();
    setInterval(refresh, 3000);
    setTimeout(() => checkUpdate(false), 1500);
  }

  return { register, go, boot, api, refresh, get state() { return S; }, game: byId, saveSettings };
})();

window.addEventListener('DOMContentLoaded', () => Hexhub.boot());
