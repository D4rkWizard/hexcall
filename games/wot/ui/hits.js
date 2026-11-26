'use strict';
// Hexcall Hub – hit analysis page (ProMod-style): list of shots on the left (mine / on me), the selected shot in 3D
// in the middle (shell + flight path on the tank that was hit), details on the right, enemy overview below.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => (n == null ? '–' : Number(n).toLocaleString('de-DE'));
  const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const EFF = {
    pierced: { c: '#ff5a5f', l: 'Durchschlag', rgb: [1, 0.35, 0.37] }, critical: { c: '#ffb020', l: 'Durchschlag + Modul', rgb: [1, 0.69, 0.13] },
    blocked: { c: '#5aa7ff', l: 'Nicht durchschlagen', rgb: [0.35, 0.65, 1] }, nodamage: { c: '#8cbcff', l: 'Ohne Schaden', rgb: [0.55, 0.74, 1] },
    ricochet: { c: '#c9bfe0', l: 'Abpraller', rgb: [0.8, 0.76, 0.9] }, other: { c: '#ffffff', l: 'Treffer', rgb: [1, 1, 1] },
  };
  const SHELL = { AP: 'Panzergranate (AP)', APCR: 'Hartkern (APCR)', HEAT: 'Hohlladung (HEAT)', HE: 'Sprenggranate (HE)', other: 'Granate' };
  const PART = { chassis: 'Fahrwerk', hull: 'Wanne', turret: 'Turm', gun: 'Kanone' };
  const H = { list: [], file: null, data: null, tab: 'out', sel: 0, only: null, view: null };

  async function api(p) { const r = await fetch(p); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `Fehler ${r.status}`); return d; }
  const veh = (id) => (H.data && H.data.vehicles[id]) || { name: '?', typeName: '?' };

  async function open(file) {
    if (!H.view) { try { H.view = ShotView.create($('#hitCanvas')); } catch (e) { $('#hvMsg').textContent = e.message; $('#hvMsg').hidden = false; } }
    if (!H.list.length) {
      try { H.list = (await api('/api/wot/replays')).replays || []; } catch (e) { $('#hitList').innerHTML = `<div class="note">${esc(e.message)}</div>`; return; }
      $('#hitSel').innerHTML = H.list.map((r) => `<option value="${esc(r.file)}">${esc(r.date ? new Date(r.date).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–')} · ${esc(r.tank)} · ${esc(r.map)}${r.result === 'unbekannt' ? ' (verlassen)' : ''}</option>`).join('');
    }
    const want = file || H.file || (H.list[0] && H.list[0].file);
    if (!want) { $('#hitList').innerHTML = '<div class="note" style="padding:12px">Keine Replays gefunden. In WoT unter Einstellungen › Allgemein „Gefechte aufzeichnen“ aktivieren.</div>'; return; }
    if (want === H.file && H.data) return;
    H.file = want; $('#hitSel').value = want; H.data = null; H.only = null;
    $('#hitList').innerHTML = '<div class="note" style="padding:12px">Lese das Replay aus …</div>';
    $('#hitKpis').innerHTML = ''; $('#hitEnemies').innerHTML = ''; $('#hitInfo').innerHTML = '';
    try { H.data = await api(`/api/wot/hits?file=${encodeURIComponent(want)}`); }
    catch (e) { $('#hitList').innerHTML = `<div class="note" style="padding:12px">${esc(e.message)}</div>`; return; }
    renderKpis(); renderEnemies();
    const mine = shots('out');
    setTab(mine.length || !shots('in').length ? 'out' : 'in');
  }

  // all events of one tab (filtered to one enemy if chosen), in time order
  function shots(tab) {
    const d = H.data, me = d.me;
    return d.events.filter((e) => (tab === 'out' ? e.attacker === me : e.target === me) && (!H.only || (tab === 'out' ? e.target : e.attacker) === H.only)).sort((a, b) => a.t - b.t);
  }
  // result of a shot = its last impact (codes: 0 ricochet with follow-up, 1 final ricochet, 2 not pierced, 3 pierced without damage, 4 pierced, 5/6 critical)
  const RESULT = { 0: ['ricochet', 'Abpraller *'], 1: ['ricochet', 'Abpraller'], 2: ['blocked', 'Nicht durchschlagen'], 3: ['nodamage', 'Treffer'], 4: ['pierced', 'Schaden'], 5: ['critical', 'Kritisch'], 6: ['critical', 'Kritisch'] };
  const outcome = (e) => {
    if (e.kind === 'explosion') return { key: e.damage ? 'pierced' : 'blocked', label: 'Splash', rank: 1 };
    if (e.kind === 'health') return { key: 'pierced', label: e.reason || 'Schaden', rank: 1 };
    const pts = e.points; if (!pts.length) return { key: 'other', label: 'Treffer', rank: 0 };
    const last = pts[pts.length - 1];
    const [key, label] = RESULT[last.code] || ['other', 'Treffer'];
    return { key, label: pts.length > 1 && pts[0].code === 0 ? `Abpraller * → ${label}` : label, rank: { ricochet: 0, blocked: 1, nodamage: 2, pierced: 3, critical: 4 }[key] ?? 0 };
  };

  function setTab(tab) {
    H.tab = tab; H.sel = 0;
    document.querySelectorAll('.hv-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('#hvOut').textContent = shots('out').length; $('#hvIn').textContent = shots('in').length;
    renderList(); select(0);
  }
  function sorted() {
    const list = shots(H.tab).map((e, n) => ({ e, n: n + 1 }));
    const k = H.sort || 'n', dir = H.sortDir || 1;
    const val = ({ e, n }) => (k === 'tank' ? veh(H.tab === 'out' ? e.target : e.attacker).typeName : k === 'result' ? outcome(e).rank : k === 'damage' ? e.damage || 0 : n);
    return list.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'string' ? x.localeCompare(y, 'de') : x - y) * dir || a.n - b.n; });
  }
  function renderList() {
    const list = sorted();
    $('#hitHead').innerHTML = [['n', '№'], ['tank', 'Panzer'], ['result', 'Resultat'], ['damage', 'Schaden']].map(([k, t]) => `<button data-sort="${k}" class="${(H.sort || 'n') === k ? 'on' : ''}">${t}${(H.sort || 'n') === k ? ((H.sortDir || 1) > 0 ? ' ▲' : ' ▼') : ''}</button>`).join('');
    $('#hitOnly').innerHTML = H.only ? `<span class="chip active">nur ${esc(veh(H.only).typeName)} <b data-clear>×</b></span>` : '';
    $('#hitList').innerHTML = list.length ? list.map(({ e, n }, i) => {
      const o = outcome(e), other = H.tab === 'out' ? e.target : e.attacker, v = veh(other);
      const sh = e.shell && e.shell.kind !== 'other' ? e.shell.kind : e.kind === 'explosion' ? 'HE' : '';
      return `<button class="hv-item ${i === H.sel ? 'active' : ''}" data-i="${i}">
        <span class="t">${n}<small>${fmtT(e.t)}</small></span>
        <span class="who"><b>${esc(v.typeName)}</b><small>${esc(v.name)}</small></span>
        <span class="res"><i style="background:${(EFF[o.key] || EFF.other).c}"></i>${esc(o.label)}${sh ? `<small>${esc(sh)}</small>` : ''}</span>
        <span class="dmg ${e.damage ? '' : 'zero'}">${e.damage ? num(e.damage) : '0'}</span></button>`;
    }).join('') : `<div class="note" style="padding:12px">${H.tab === 'out' ? 'Keine Treffer von dir im Replay.' : 'Du wurdest nicht getroffen (oder es war nicht im Replay).'}</div>`;
  }

  async function select(i) {
    const list = sorted().map((x) => x.e);
    H.sel = Math.max(0, Math.min(list.length - 1, i));
    document.querySelectorAll('.hv-item').forEach((b) => b.classList.toggle('active', Number(b.dataset.i) === H.sel));
    const el = document.querySelector(`.hv-item[data-i="${H.sel}"]`); if (el) el.scrollIntoView({ block: 'nearest' });
    const e = list[H.sel];
    const msg = $('#hvMsg');
    if (!e) { $('#hitInfo').innerHTML = ''; if (H.view) H.view.setShot(null); return; }
    const d = H.data, target = veh(e.target), attacker = veh(e.attacker), o = outcome(e);
    renderInfo(e, target, attacker, o);
    if (!H.view) return;
    const tankId = target.cfg || target.type;
    if (!tankId) { msg.textContent = 'Panzer nicht bekannt'; msg.hidden = false; return; }
    msg.textContent = 'Lade Panzer …'; msg.hidden = false;
    try {
      await H.view.loadTank(tankId);
      if (sorted().map((x) => x.e)[H.sel] !== e) return;
      const pc = e.points.map((pt) => (EFF[pt.effect] || EFF.other).rgb);
      H.view.setShot(e.points.some((pt) => pt.p) ? { points: e.points, shell: e.shell, color: (EFF[o.key] || EFF.other).rgb, pointColors: pc } : null);
      msg.hidden = e.points.some((pt) => pt.p);
      if (!msg.hidden) msg.textContent = e.kind === 'shot' ? 'Für diesen Treffer gibt es keine Position.' : 'Splash- und sonstiger Schaden hat keinen Einschlagpunkt.';
    } catch (err) { msg.textContent = err.message; msg.hidden = false; }
  }

  function renderInfo(e, target, attacker, o) {
    const pts = e.points.filter((pt) => pt.part);
    const approx = pts.some((pt) => pt.p && pt.exact === false);
    const rows = [
      ['Schütze', `${esc(attacker.typeName)}<small>${esc(attacker.name)}${e.attacker === H.data.me ? ' (du)' : ''}</small>`],
      ['Ziel', `${esc(target.typeName)}<small>${esc(target.name)}${e.target === H.data.me ? ' (du)' : ''}</small>`],
      ['Zeit', fmtT(e.t)],
      ['Resultat', `<span class="res"><i style="background:${(EFF[o.key] || EFF.other).c}"></i>${esc(o.label)}</span>`],
      ['Schaden', e.damage ? `${num(e.damage)}${e.hp ? `<small>${num(e.hp[0])} → ${num(e.hp[1])} HP</small>` : ''}` : '0'],
      ['Getroffen', pts.length ? pts.map((pt) => `${PART[pt.part] || '?'}${pt.p && pt.exact === false ? ' ◌' : ''}`).join(' → ') : '–'],
      ['Granate', e.shell ? `${esc(SHELL[e.shell.kind] || SHELL.other)}<small>${e.shell.caliber ? `${e.shell.caliber} mm · ` : ''}${esc(String(e.shell.gun || '').replace(/^_/, '').replace(/_/g, ' '))}</small>` : e.kind === 'explosion' ? 'Splash' : '–'],
    ];
    $('#hitInfo').innerHTML = `${rows.map(([k, v]) => `<div class="hv-row"><span>${k}</span><b>${v}</b></div>`).join('')}
      ${approx ? '<div class="note" style="font-size:11.5px">◌ Turm/Kanone: Einschlagstelle ungefähr – WoTs Panzerungsmodell weicht dort vom sichtbaren Modell ab.</div>' : ''}
      <div class="note" style="font-size:11.5px">Granate vergrößert dargestellt · ↑/↓ nächster Treffer · Doppelklick = zurück zum Treffer</div>`;
  }

  function renderKpis() {
    const d = H.data, s = d.summary, me = d.me;
    const mine = d.events.filter((e) => e.attacker === me), onMe = d.events.filter((e) => e.target === me);
    const sum = (l) => l.reduce((a, e) => a + (e.damage || 0), 0);
    $('#hitSub').textContent = `${d.map || ''} · ${veh(me).typeName}${s && s.result ? ` · ${{ sieg: 'Sieg', niederlage: 'Niederlage', unentschieden: 'Unentschieden' }[s.result]}` : ''}`;
    const k = s
      ? [['Schüsse', num(s.shots)], ['Treffer / Durchschläge', `${num(s.hits)} / ${num(s.pierced)}`], ['Schaden gemacht', num(s.damage), 'accent'], ['Abschüsse', num(s.kills)],
        ['Treffer kassiert', `${num(s.hitsIn)} / ${num(s.piercedIn)}`], ['Schaden kassiert', num(s.damageIn)], ['Geblockt', num(s.blocked), 'good'],
        ['Zerstört von', s.killer ? esc(veh(s.killer).typeName) : 'überlebt', s.killer ? '' : 'good']]
      : [['Treffer (gesehen)', mine.length], ['Schaden gemacht', num(sum(mine)), 'accent'], ['Treffer kassiert', onMe.length], ['Schaden kassiert', num(sum(onMe))]];
    $('#hitKpis').innerHTML = k.map(([l, v, cls]) => `<div class="card kpi ${cls || ''}"><div class="k-label">${l}</div><div class="k-val">${v}</div></div>`).join('')
      + (s ? '' : '<div class="note" style="grid-column:1/-1;margin:0">Keine Gefechtsauswertung im Replay (vorzeitig verlassen) – nur, was du im Gefecht gesehen hast.</div>');
  }

  function renderEnemies() {
    const d = H.data, s = d.summary, me = d.me;
    const mine = d.events.filter((e) => e.attacker === me), onMe = d.events.filter((e) => e.target === me);
    const sum = (l) => l.reduce((a, e) => a + (e.damage || 0), 0);
    const ids = new Set([...(s ? s.rows.map((r) => r.id) : []), ...mine.map((e) => e.target), ...onMe.map((e) => e.attacker)]);
    ids.delete(me);
    const myTeam = veh(me).team;
    const rows = [...ids].map((id) => {
      const r = s && s.rows.find((x) => x.id === id), out = mine.filter((e) => e.target === id), inn = onMe.filter((e) => e.attacker === id);
      return { id, r, out, inn, dmg: r ? r.damage : sum(out), dmgIn: r ? r.damageIn : sum(inn) };
    }).sort((a, b) => b.dmg - a.dmg || b.dmgIn - a.dmgIn);
    const max = Math.max(1, ...rows.map((x) => Math.max(x.dmg, x.dmgIn)));
    $('#hitEnemies').innerHTML = rows.length ? `<div class="table-wrap" style="max-height:none"><table class="table hit-table"><thead><tr>
      <th>Panzer</th><th>Spieler</th><th class="num">Meine Treffer</th><th class="num">Durchschl.</th><th>Mein Schaden</th><th class="num">Seine Treffer</th><th>Sein Schaden</th><th></th></tr></thead><tbody>
      ${rows.map(({ id, r, out, inn, dmg, dmgIn }) => {
        const v = veh(id);
        const hits = r ? r.hits : out.reduce((a, e) => a + e.points.length, 0), pierced = r ? r.pierced : out.filter((e) => ['pierced', 'critical'].includes(outcome(e).key)).length;
        return `<tr><td class="${v.team === myTeam ? 'team1' : 'team2'}">${esc(v.typeName)}${r && r.kill ? ' <span class="kill" title="von dir zerstört">✕</span>' : ''}${s && s.killer === id ? ' <span class="kill" title="hat dich zerstört">☠</span>' : ''}</td>
          <td>${esc(v.name)}</td><td class="num">${num(hits)}</td><td class="num">${num(pierced)}</td>
          <td>${num(dmg)}<span class="bar" style="width:${Math.round((70 * dmg) / max)}px"></span></td>
          <td class="num">${r ? num(r.hitsIn) : num(inn.length)}</td><td class="in">${num(dmgIn)}<span class="bar" style="width:${Math.round((70 * dmgIn) / max)}px"></span></td>
          <td>${out.length ? `<button class="btn sm ghost" data-only="out:${id}">Meine Treffer</button>` : ''}${inn.length ? ` <button class="btn sm ghost" data-only="in:${id}">Auf mich</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>` : '';
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#hitSel').addEventListener('change', (e) => open(e.target.value));
    document.querySelector('.hv-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b && H.data) setTab(b.dataset.tab); });
    $('#hitList').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) select(Number(b.dataset.i)); });
    $('#hitHead').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sort]'); if (!b) return;
      if (H.sort === b.dataset.sort) H.sortDir = -(H.sortDir || 1); else { H.sort = b.dataset.sort; H.sortDir = b.dataset.sort === 'damage' || b.dataset.sort === 'result' ? -1 : 1; }
      renderList(); select(0);
    });
    $('#hitOnly').addEventListener('click', (e) => { if (e.target.closest('[data-clear]')) { H.only = null; setTab(H.tab); } });
    $('#hitEnemies').addEventListener('click', (e) => {
      const b = e.target.closest('[data-only]'); if (!b) return;
      const [tab, id] = b.dataset.only.split(':'); H.only = Number(id); setTab(tab);
      document.querySelector('.hv').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('#hvOverview').addEventListener('click', () => H.view && H.view.overview());
    $('#hvShot').addEventListener('click', () => select(H.sel));
    document.addEventListener('keydown', (e) => {
      if (!$('#page-hits').classList.contains('active') || !H.data || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); select(H.sel + 1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); select(H.sel - 1); }
    });
  });

  window.Hits = { open };
})();
