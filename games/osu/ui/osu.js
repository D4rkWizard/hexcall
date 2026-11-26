'use strict';
// osu! module UI: overview, replay library and Hexrender – the Hexrender website itself, embedded,
// plus its admin page for the operator (only on the PC that runs Hexrender).
// "Render" in the replay list hands the replay file over to the embedded website (postMessage).
(() => {
  const O = '/api/osu';
  const S = { page: 'home', status: null, replays: null, server: null, src: 'Alle', limit: 150, loading: null, webUrl: null, webReady: false, pending: null };

  /* ------------------------------------------------------------ helpers */
  const modsHtml = (m) => (m ? `<span class="mods">${m.match(/../g).map((x) => `<i>${x}</i>`).join('')}</span>` : '');
  const accPct = (r) => `${fmt((r.accuracy || 0) * 100, 2)} %`;
  function grade(r) {
    const total = r.n300 + r.n100 + r.n50 + r.miss; if (!total) return 'D';
    const p3 = r.n300 / total, p5 = r.n50 / total;
    if (p3 === 1) return 'SS';
    if (p3 > 0.9 && p5 < 0.01 && !r.miss) return 'S';
    if ((p3 > 0.8 && !r.miss) || p3 > 0.9) return 'A';
    if ((p3 > 0.7 && !r.miss) || p3 > 0.8) return 'B';
    return p3 > 0.6 ? 'C' : 'D';
  }
  const SRC = { e: 'Exportiert', l: 'Lokal', u: 'Hochgeladen' };
  const bg = (r) => (r.md5 ? `style="background-image:linear-gradient(90deg,rgba(0,0,0,.15),rgba(0,0,0,.35)),url('${O}/bg?md5=${r.md5}')"` : '');

  function repRow(r) {
    const m = r.map;
    const title = m ? `${esc(m.artist)} - ${esc(m.title)} <small>[${esc(m.version)}]</small>` : esc(r.title);
    return `<div class="orep" data-rid="${esc(r.id)}">
      <div class="thumb" ${bg(r)}>${m && m.stars ? `<span class="stars">★ ${fmt(m.stars, 2)}</span>` : ''}</div>
      <div class="main"><div class="t">${title}</div>
        <div class="m"><span class="grade ${grade(r)}">${grade(r)}</span><span>${esc(r.player)}</span>${modsHtml(r.modString)}<span>${dateFmt(r.date)}</span>${m && m.creator ? `<span>Mapper: ${esc(m.creator)}</span>` : ''}<span class="src">${SRC[r.kind] || ''}</span></div></div>
      <div class="nums"><div><b>${accPct(r)}</b>Genauigkeit</div><div><b>${fmt(r.maxCombo)}x</b>Combo</div><div><b class="${r.miss ? 'miss' : ''}">${fmt(r.miss)}</b>Misses</div><div><b>${fmt(r.score)}</b>Score</div></div>
      <div class="acts"><button class="btn sm primary" data-oact="render" title="In Hexrender öffnen und als Video rendern"><svg><use href="#i-video"/></svg>Rendern</button>
        <button class="btn sm ghost icon" data-oact="watch" title="In osu! ansehen"><svg><use href="#i-play"/></svg></button>
        <button class="btn sm ghost icon" data-oact="show" title="Im Explorer zeigen"><svg><use href="#i-folder"/></svg></button></div>
    </div>`;
  }

  /* ------------------------------------------------------------ render server */
  async function loadServer(force) {
    try { S.server = await api(`${O}/server${force ? '?force=1' : ''}`); } catch (e) { S.server = { online: false, error: e.message }; }
    renderServer();
    syncFrames();
  }
  function renderServer() {
    const s = S.server; if (!s) return;
    const ok = s.online && s.canSubmit, paused = s.online && !s.canSubmit;
    $('#oSrvDot').className = `big-dot ${ok ? 'on' : paused ? 'warn' : 'bad'}`;
    $('#oSrvSub').textContent = !s.online ? (s.error || 'nicht erreichbar') : paused ? 'Nimmt gerade keine neuen Aufträge an' : 'Nimmt Aufträge an';
    const src = { local: 'Auf diesem PC (lokal, mit Admin)', online: 'Online (automatisch)', manual: 'Von dir eingetragen' }[s.source] || '–';
    $('#oSrvKv').innerHTML = `<span>Adresse</span><b>${esc(s.url || '–')}</b><span>Quelle</span><b>${esc(src)}</b>
      ${s.online ? `<span>Warteschlange</span><b>${fmt((s.queued || 0) + (s.running ? 1 : 0))}</b>${s.running ? `<span>Gerade</span><b>${esc(s.running.title)} · ${fmt((s.running.progress || 0) * 100)} %</b>` : ''}` : ''}`;
    // admin tab only for the operator (Hexrender on this PC or its folder is set)
    const adminTab = $('#view-game-osu .gtabs [data-tab="admin"]');
    if (adminTab) adminTab.hidden = !(s.source === 'local' || s.operator);
  }
  // the embedded website (and admin page) follow the resolved server address
  function syncFrames() {
    const s = S.server || {};
    const web = $('#oWeb'), adm = $('#oAdm');
    const url = s.online ? s.url : null;
    $('#oWebOff').hidden = !!url; web.hidden = !url;
    $('#oWebStart').hidden = !s.operator;
    $('#oWebOffTxt').textContent = !s.url ? (s.error || 'Kein Render-Server bekannt.') : `Der Render-Server (${s.url}) antwortet nicht${s.error ? ` (${s.error})` : ''}. Versuch es später nochmal.`;
    if (url && S.webUrl !== url && S.page === 'render') { S.webUrl = url; S.webReady = false; web.src = `${url}/`; }
    const local = s.online && s.source === 'local';
    $('#oAdmOff').hidden = local; adm.hidden = !local;
    $('#oAdmStart').hidden = !s.operator;
    $('#oAdmTxt').textContent = s.operator ? 'Hexrender ist gerade nicht gestartet.' : 'Die Admin-Seite gibt es nur auf dem PC, auf dem Hexrender läuft. Trag dafür unter Einstellungen › osu! den Hexrender-Ordner ein.';
    if (local && S.page === 'admin' && !adm.getAttribute('src')) adm.src = `${s.url}/admin`;
  }
  async function startHexrender(btn) {
    btn.disabled = true;
    try { await api(`${O}/hexrender/start`, {}); toast('Hexrender läuft'); S.webUrl = null; $('#oAdm').removeAttribute('src'); await loadServer(true); }
    catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; }
  }
  $('#oWebStart').onclick = (e) => startHexrender(e.currentTarget);
  $('#oAdmStart').onclick = (e) => startHexrender(e.currentTarget);
  $('#oWebRetry').onclick = () => loadServer(true);
  $('#oSrvRefresh').onclick = () => loadServer(true);

  // the website tells us when its render page is ready; then a chosen replay is handed over
  window.addEventListener('message', (e) => {
    const web = $('#oWeb');
    if (!web || e.source !== web.contentWindow || !e.data || e.data.type !== 'hexrender-ready') return;
    S.webReady = true;
    if (S.pending) sendPending();
  });
  async function sendPending() {
    const r = S.pending; S.pending = null;
    try {
      const res = await fetch(`${O}/replay-file?id=${encodeURIComponent(r.id)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Fehler ${res.status}`);
      const data = await res.arrayBuffer();
      $('#oWeb').contentWindow.postMessage({ type: 'hexhub-replay', name: r.file, data }, new URL(S.webUrl).origin, [data]);
    } catch (e) { toast(e.message, true); }
  }
  function renderReplay(r) {
    if (!r) return;
    S.pending = r;
    Hexhub.go('game:osu', 'render');
    const web = $('#oWeb');
    // back to the render page of the website (the user may be on a video or queue page)
    if (S.webUrl && web.contentWindow) {
      S.webReady = false;
      web.src = `${S.webUrl}/?r=${Date.now()}`;
    }
  }

  /* ------------------------------------------------------------ overview */
  async function loadStatus() { S.status = await api(`${O}/status`); renderOverview(); }
  function renderOverview() {
    const st = S.status; if (!st) return;
    $('#oInstDot').className = `big-dot ${st.osuDir ? 'on' : 'bad'}`;
    $('#oInstSub').textContent = st.osuDir ? 'Gefunden' : 'Nicht gefunden – unter Einstellungen den Ordner wählen';
    $('#oInstKv').innerHTML = st.osuDir ? `<span>Ordner</span><b>${esc(st.osuDir)}</b><span>Spieler</span><b>${esc(st.player || '–')}</b>
      <span>Beatmaps</span><b>${fmt(st.maps)}</b><span>Skin</span><b>${esc(st.skin || '–')}</b>` : '';
    const reps = (S.replays && S.replays.replays) || [];
    const week = reps.filter((r) => new Date(r.date) > Date.now() - 7 * 864e5);
    const best = reps.reduce((a, r) => Math.max(a, r.accuracy || 0), 0);
    const kpi = (l, v, sub, cls = '') => `<div class="card kpi ${cls}"><div class="k-label">${l}</div><div class="k-val">${v}</div><div class="k-sub">${sub}</div></div>`;
    $('#oKpis').innerHTML = [
      kpi('Replays', fmt(reps.length), `${fmt(week.length)} in den letzten 7 Tagen`),
      kpi('Exportiert', fmt(reps.filter((r) => r.kind === 'e').length), 'im Replays-Ordner'),
      kpi('Ø Genauigkeit', reps.length ? `${fmt(reps.reduce((a, r) => a + r.accuracy, 0) / reps.length * 100, 2)} %` : '–', `beste: ${fmt(best * 100, 2)} %`, 'accent'),
      kpi('Beatmaps', fmt(st.maps), 'in deiner osu!-Datenbank'),
    ].join('');
    $('#oRecent').innerHTML = S.replays ? (reps.slice(0, 6).map(repRow).join('') || '<div class="empty">Keine Replays gefunden.</div>') : '<div class="empty">Lese Replays …</div>';
  }

  /* ------------------------------------------------------------ replay library */
  async function loadReplays(force) {
    if (S.loading) return S.loading;
    if (S.replays && !force) return;
    $('#oRepSub').textContent = 'Lese Replays …';
    S.loading = api(`${O}/replays`).then((d) => { S.replays = d; renderReplays(); renderOverview(); })
      .catch((e) => { $('#oRepSub').textContent = e.message; }).finally(() => { S.loading = null; });
    return S.loading;
  }
  function filteredReplays() {
    let l = (S.replays && S.replays.replays) || [];
    const k = { Exportiert: 'e', Lokal: 'l', Hochgeladen: 'u' }[S.src];
    if (k) l = l.filter((r) => r.kind === k);
    const q = $('#oRepSearch').value.trim().toLowerCase();
    if (q) l = l.filter((r) => `${r.title} ${r.map ? r.map.creator : ''} ${r.player} ${r.modString}`.toLowerCase().includes(q));
    const key = { score: (r) => r.score, acc: (r) => r.accuracy, combo: (r) => r.maxCombo, stars: (r) => (r.map && r.map.stars) || 0 }[$('#oRepSort').value];
    if (key) l = [...l].sort((a, b) => key(b) - key(a));
    return l;
  }
  function renderReplays() {
    const all = (S.replays && S.replays.replays) || [];
    const counts = { Alle: all.length, Exportiert: all.filter((r) => r.kind === 'e').length, Lokal: all.filter((r) => r.kind === 'l').length, Hochgeladen: all.filter((r) => r.kind === 'u').length };
    $('#oRepSrc').innerHTML = Object.keys(counts).filter((k) => k === 'Alle' || counts[k]).map((k) => `<button class="chip ${k === S.src ? 'active' : ''}" data-src="${k}">${k} <span class="muted">${fmt(counts[k])}</span></button>`).join('');
    const l = filteredReplays();
    $('#oRepSub').textContent = S.replays ? `${fmt(l.length)} von ${fmt(all.length)} Replays (osu!standard) · ${fmt(S.replays.maps)} Beatmaps bekannt` : 'Lese Replays …';
    $('#oRepList').innerHTML = l.slice(0, S.limit).map(repRow).join('') || '<div class="empty">Keine Replays gefunden.</div>';
    $('#oRepMore').hidden = l.length <= S.limit;
  }
  $('#oRepSrc').onclick = (e) => { const b = e.target.closest('[data-src]'); if (b) { S.src = b.dataset.src; S.limit = 150; renderReplays(); } };
  $('#oRepSearch').oninput = () => { S.limit = 150; renderReplays(); };
  $('#oRepSort').onchange = () => renderReplays();
  $('#oRepMore').onclick = () => { S.limit += 150; renderReplays(); };
  $('#oRepReload').onclick = () => loadReplays(true);

  const findReplay = (id) => ((S.replays && S.replays.replays) || []).find((r) => r.id === id);
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-oact]'); if (!a || !a.closest('#view-game-osu')) return;
    const id = a.closest('[data-rid]').dataset.rid;
    try {
      if (a.dataset.oact === 'render') renderReplay(findReplay(id));
      if (a.dataset.oact === 'watch') { await api(`${O}/replay/watch`, { id }); toast('Replay wird in osu! geöffnet …'); }
      if (a.dataset.oact === 'show') await api(`${O}/replay/show`, { id });
    } catch (er) { toast(er.message, true); }
  });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-oopen]'); if (b) api(`${O}/open`, { what: b.dataset.oopen }).catch((er) => toast(er.message, true)); });

  /* ------------------------------------------------------------ settings (Einstellungen › osu!) */
  async function renderSettings(el) {
    let c = { dir: '', renderServer: '', hexrenderDir: '', found: null };
    try { c = await api(`${O}/config`); } catch {}
    el.innerHTML = `<div class="card set-row"><div class="sr-text" style="min-width:0"><b class="set-path">${esc(c.found || 'Nicht gefunden')}</b><span>osu!-Ordner (stable)${c.dir ? ' · von dir gewählt' : ' · automatisch erkannt'}</span></div>
        <div class="acts">${c.dir ? '<button class="btn ghost" data-oset="auto">Automatisch</button>' : ''}<button class="btn ghost" data-oset="pick"><svg><use href="#i-folder"/></svg>Ordner wählen …</button></div></div>
      <div class="card set-row"><div class="sr-text" style="flex:1"><b>Render-Server (Hexrender)</b><span>Leer lassen = automatisch: Hexrender auf diesem PC, sonst die offizielle Adresse von DarkWizard.</span>
        <div class="row" style="margin-top:10px"><input class="input" id="oSrvUrl" style="flex:1" placeholder="automatisch" value="${esc(c.renderServer)}"><button class="btn ghost" data-oset="srv">Speichern</button></div></div></div>
      <div class="card set-row"><div class="sr-text" style="min-width:0"><b class="set-path">${esc(c.hexrenderDir || '–')}</b><span>Hexrender-Ordner – nur für den Betreiber: Hexhub kann Hexrender dann starten und zeigt die Admin-Seite</span></div>
        <div class="acts">${c.hexrenderDir ? '<button class="btn ghost" data-oset="hxoff">Entfernen</button>' : ''}<button class="btn ghost" data-oset="hxpick"><svg><use href="#i-folder"/></svg>Ordner wählen …</button></div></div>`;
    el.onclick = async (e) => {
      const b = e.target.closest('[data-oset]'); if (!b) return;
      try {
        if (b.dataset.oset === 'pick') { const r = await api(`${O}/pickfolder`, {}); if (!r.dir) return; }
        if (b.dataset.oset === 'auto') await api(`${O}/config`, { dir: '' });
        if (b.dataset.oset === 'srv') await api(`${O}/config`, { renderServer: $('#oSrvUrl').value });
        if (b.dataset.oset === 'hxpick') { const r = await api(`${O}/pickhexrender`, {}); if (!r.dir) return; }
        if (b.dataset.oset === 'hxoff') await api(`${O}/config`, { hexrenderDir: '' });
        toast('Gespeichert'); renderSettings(el); S.replays = null; S.webUrl = null; loadServer(true); Hexhub.refresh();
      } catch (er) { toast(er.message, true); }
    };
  }

  /* ------------------------------------------------------------ module */
  Hexhub.register('osu', {
    init() {
      const adminTab = $('#view-game-osu .gtabs [data-tab="admin"]'); if (adminTab) adminTab.hidden = true;
      loadStatus().catch(() => {});
      loadServer();
      setTimeout(() => loadReplays(), 1500);
      setInterval(() => { if (S.page === 'home' || S.page === 'render' || S.page === 'admin') loadServer(); }, 20000);
    },
    open(p) {
      S.page = p;
      if (p === 'home') { loadStatus().catch(() => {}); loadReplays(); loadServer(); }
      if (p === 'replays') loadReplays();
      if (p === 'render' || p === 'admin') loadServer();
    },
    homeStats() {
      const n = S.replays && S.replays.replays.length;
      return [[n ? fmt(n) : '–', 'Replays'], [S.server && S.server.online ? 'online' : 'offline', 'Hexrender']];
    },
    settings(el) { renderSettings(el); },
  });
})();
