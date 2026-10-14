import * as store from './store.js';
import * as calendar from './calendar.js';
import { eventsOn, timedOn } from './calendar.js';
import { initAI, ask, undo, renderMsgs, clearChat, breakDownLocal } from './ai.js';
import { add, DAYL, DAYN, MON, daysBetween, dayShort, esc, fmtDur, fmtShort, fmtT, lsGet, lsSet, nowMin, pd, today, weekStart } from './util.js';
import { ancestors, children, colorOf, dayItems, glow, hasKids, isDone, isProj, leaves, node, PALETTE, progress, riders, rootOf, unscheduled } from './tree.js';

const H0 = 6, H1 = 23;
const HP = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hp')) || 48;
// Positions in the time grid are written in hours of --hp, so zooming only has to change --hp
const hpx = h => `calc(var(--hp) * ${+h.toFixed(4)})`;
const phone = () => matchMedia('(max-width:860px)').matches;
const ICON = {
  prev: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 3L5 8l5 5"/></svg>',
  next: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3l5 5-5 5"/></svg>',
  cal: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 9.5h17M8 3v4M16 3v4M8 13.5h3M8 16.5h6"/></svg>',
  proj: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 6h14M8 11h11M11 16h8"/><circle cx="5" cy="11" r="1"/><circle cx="8" cy="16" r="1"/></svg>',
  ask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
  note: '<svg class="ni" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" aria-label="Has notes"><path d="M2.5 3h7M2.5 6h7M2.5 9h4"/></svg>',
  link: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.5 9.5l3-3M7.3 4.2l.9-.9a2.8 2.8 0 0 1 4 4l-.9.9M8.7 11.8l-.9.9a2.8 2.8 0 0 1-4-4l.9-.9"/></svg>',
  linkS: '<svg class="ni" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-label="Has a link"><path d="M6.5 9.5l3-3M7.3 4.2l.9-.9a2.8 2.8 0 0 1 4 4l-.9.9M8.7 11.8l-.9.9a2.8 2.8 0 0 1-4-4l.9-.9"/></svg>',
  min: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 4.5h10M3 8h10M3 11.5h6"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

/* View state (per device) */
const UI_KEY = 'daybook-ui';
const S = { view: phone() ? 'day' : 'week', mode: 'list', anchor: today(), col: {}, tab: 'plan', tip: true, demo: false, min: false, ...lsGet(UI_KEY, {}), pick: null, adding: null, open: null, dtpick: false, confirmDel: false, linkEdit: false, mcp: null };
S.anchor = today();
const saveUI = () => lsSet(UI_KEY, { view: S.view, mode: S.mode, col: S.col, tab: S.tab, tip: S.tip, demo: S.demo, min: S.min });
let client = null, user = null, configured = false, shown = today(), supaUrl = '';

/* Links on items, such as the Thymer page a task came from */
const safeLink = u => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } };
const linkLabel = u => { const h = new URL(u).hostname.replace(/^www\./, ''); return h === 'thymer.com' || h.endsWith('.thymer.com') ? 'Open in Thymer' : 'Open ' + h; };

/* Rendering */
function ckHTML(n) {
  if (hasKids(n.id) || n.c) {
    const p = progress(n.id); const pct = p.total ? p.done / p.total : 0;
    return `<button class="ring" data-act="toggle" data-id="${n.id}" style="--p:${pct}" title="${p.done} of ${p.total} done" aria-label="${esc(n.t)}: ${p.done} of ${p.total} done"></button>`;
  }
  return `<button class="ck${n.done ? ' on' : ''}" data-act="toggle" data-id="${n.id}" aria-label="Mark ${esc(n.t)} ${n.done ? 'not done' : 'done'}"></button>`;
}
function chipHTML(n, o = {}) {
  const crumbs = ancestors(n).map(a => a.t); const meta = []; const kids = hasKids(n.id);
  if (!o.min) { // minimal list shows just the title
    if (n.notes) meta.push(ICON.note);
    if (n.link) meta.push(ICON.linkS);
    if (crumbs.length) meta.push(`<span class="pd"></span>${esc(crumbs.slice(-2).join(' › '))}`);
    if (o.time && n.s != null) meta.push(`<span class="tm">${fmtT(n.s)}</span>`);
    if (n.m && !kids) meta.push(fmtDur(n.m));
    if (kids) { const p = progress(n.id); meta.push(`${p.done}/${p.total} done`); }
  }
  return `<div class="item${isDone(n) ? ' done' : ''}${o.compact ? ' compact' : ''}" data-drag data-id="${n.id}" style="--pc:${colorOf(n)}">${ckHTML(n)}<div class="it-body"><div class="it-t">${esc(n.t || 'Untitled')}</div>${meta.length ? `<div class="it-m">${meta.join('<span>·</span>')}</div>` : ''}${subsHTML(n)}</div></div>`;
}
// Steps with no day of their own show inside their scheduled parent; drag one out to give it its own day or time.
function subsHTML(n) {
  const r = n.d ? riders(n.id) : []; if (!r.length) return '';
  return `<div class="subs">${r.map(k => `<div class="sub${k.done ? ' done' : ''}" data-drag data-id="${k.id}" style="--pc:${colorOf(k)}">${ckHTML(k)}<span>${esc(k.t || 'Untitled')}</span></div>`).join('')}</div>`;
}
const whenLabel = n => dayShort(n.d) + (n.s != null ? ' ' + fmtT(n.s) : '');
function pickerHTML(n, dep) {
  const days = [...Array(7)].map((_, i) => add(today(), i));
  return `<div class="pick" style="--dep:${dep}">${days.map(d => `<button data-act="setday" data-id="${n.id}" data-d="${d}" class="${n.d === d ? 'on' : ''}">${d === today() ? 'Today' : DAYN[pd(d).getDay()] + ' ' + pd(d).getDate()}</button>`).join('')}<label class="pick-date"><span>Other day</span><input type="date" data-pickdate="${n.id}" value="${n.d || ''}"></label>${n.d ? `<button data-act="setday" data-id="${n.id}" data-d="">Unschedule</button>` : ''}</div>`;
}
const addRow = (pid, dep) => S.adding === pid ? `<form class="tr add" data-form="add" data-p="${pid}" style="--dep:${dep}"><span class="caret-sp"></span><input id="add-in" placeholder="New task, press Enter" autocomplete="off" enterkeyhint="done"></form>` : '';
function treeRows(n, dep) {
  const kids = children(n.id), isP = kids.length > 0;
  let h = `<div class="tr${isDone(n) ? ' done' : ''}" style="--dep:${dep};--pc:${colorOf(n)}" data-drag data-id="${n.id}">
    ${isP ? `<button class="caret${S.col[n.id] ? ' shut' : ''}" data-act="fold" data-id="${n.id}" aria-label="Show or hide ${esc(n.t)}"></button>` : '<span class="caret-sp"></span>'}
    ${ckHTML(n)}<span class="tr-t">${esc(n.t || 'Untitled')}</span>${n.notes ? ICON.note : ''}
    <button class="plus${isP ? '' : ' leaf'}" data-act="add" data-id="${n.id}" aria-label="Add a step to ${esc(n.t)}" title="Add a step">+</button>
    <button class="when${n.d ? ' set' : ''}" data-act="pick" data-id="${n.id}" aria-label="Schedule ${esc(n.t)}">${n.d ? whenLabel(n) : ICON.cal}</button></div>`;
  if (S.pick === n.id) h += pickerHTML(n, dep);
  if (!S.col[n.id]) h += kids.map(k => treeRows(k, dep + 1)).join('');
  return h + addRow(n.id, dep + 1);
}
function projHTML(p) {
  const pr = progress(p.id), pct = pr.total ? Math.round(pr.done / pr.total * 100) : 0;
  let due = ''; if (p.due) { const left = daysBetween(today(), p.due); due = `<div class="due">Due ${fmtShort(p.due)} · ${left < 0 ? `${-left} days overdue` : left === 0 ? 'today' : `${left} days left`}</div>`; }
  return `<div class="proj" style="--pc:${glow(p.c) || colorOf(p)}">
    <div class="proj-h" data-drag data-id="${p.id}"><button class="caret${S.col[p.id] ? ' shut' : ''}" data-act="fold" data-id="${p.id}" aria-label="Show or hide ${esc(p.t)}"></button><span class="pdot"></span><span class="proj-t">${esc(p.t || 'Untitled')}</span><span class="proj-n">${pr.total ? pct + '%' : ''}</span><button class="plus" data-act="add" data-id="${p.id}" aria-label="Add a task to ${esc(p.t)}" title="Add a task">+</button></div>
    <div class="bar"><i style="width:${pct}%"></i></div>${due}
    ${S.col[p.id] ? addRow(p.id, 1) : `<div class="tree">${children(p.id).map(c => treeRows(c, 1)).join('')}${addRow(p.id, 1)}</div>`}</div>`;
}
const SYNC_TEXT = { saved: 'All changes saved', syncing: 'Saving…', offline: "You're offline. Changes are kept on this device and will sync when you're back.", error: "Couldn't save just now. Trying again.", local: '' };
function mcpHTML() {
  const m = S.mcp; if (!m) return '';
  if (m.url) return `<div class="mcp"><p><b>Your Daybook connector address.</b> It's only shown this once, so copy it now.</p>
    <input class="mcp-url" id="mcp-url" readonly value="${esc(m.url)}" aria-label="Connector address">
    <div class="foot-acts"><button class="tb" data-act="mcp-copy">Copy</button><button class="link" data-act="mcp-close">Done</button></div>
    <p>In Claude, open <b>Settings → Connectors → Add custom connector</b>. Name it Daybook, paste the address, and add it. Then any Claude chat can see and change your tasks.</p></div>`;
  return `<div class="mcp"><p>Let Claude see and change your tasks from any Claude chat, for example to turn notes in Thymer into tasks here.</p>
    <p>This makes a private address. Anyone who has it can see and change your tasks, so keep it to yourself. Making a new one turns the old one off.</p>
    ${m.error ? `<p class="mcp-err">${esc(m.error)}</p>` : ''}
    <div class="foot-acts"><button class="tb" data-act="mcp-make"${m.busy ? ' disabled' : ''}>${m.busy ? 'Making it…' : 'Make my address'}</button><button class="link" data-act="mcp-off">Turn off Claude's access</button><button class="link" data-act="mcp-close">Cancel</button></div></div>`;
}
async function mcpMake() {
  S.mcp = { busy: true }; renderSide();
  const { data, error } = await client.rpc('new_mcp_token');
  S.mcp = error || !data ? { error: "Couldn't make an address. Check your connection and try again." } : { url: `${supaUrl}/functions/v1/mcp/${data}` };
  renderSide();
}
async function mcpOff() {
  const { error } = await client.rpc('revoke_mcp_token');
  S.mcp = null; renderSide(); toast(error ? "Couldn't turn it off. Try again." : "Claude's access to Daybook is off");
}
function footHTML() {
  if (user) {
    const c = calendar.cal;
    return `<div class="side-f">
      <div class="acct">${esc(user.email || '')}</div>
      <div class="sync ${store.sync.state}">${SYNC_TEXT[store.sync.state] || ''}</div>
      <div>${c.connected && !c.reconnect ? 'Google Calendar connected (read-only).' : 'Google Calendar isn\'t connected.'} ${!c.connected || c.reconnect ? '<button class="link" data-act="signin">Connect it</button>' : ''}</div>
      <div class="foot-acts"><button class="link" data-act="mcp">Connect to Claude</button><button class="link" data-act="signout">Sign out</button></div>${mcpHTML()}</div>`;
  }
  return `<div class="side-f">Sample data, stored only on this device. Drag anything onto the plan, or back here to unschedule it.
    <div class="foot-acts">${configured ? '<button class="link" data-act="signin">Sign in with Google</button>' : ''}<button class="link" data-act="reset">Reset sample data</button></div></div>`;
}
function renderSide() {
  const roots = store.all().filter(n => n.p == null).sort((a, b) => a.o - b.o);
  const projs = roots.filter(isProj), loose = roots.filter(n => !isProj(n));
  const el = document.getElementById('side'); const sc = el.querySelector('.side-b')?.scrollTop || 0;
  el.innerHTML = `<div class="side-h"><div class="brand">Daybook</div>${user ? '' : '<span class="tag">Sample</span>'}</div>
  <div class="side-b vscroll" data-drop="inbox">
    <div class="sec">Projects <button class="sec-add" data-act="new-project">+ New</button></div>
    ${projs.length ? projs.map(projHTML).join('') : '<div class="empty-note">No projects yet. Tap <b>+ New</b> to start one.</div>'}
    <div class="sec">Inbox <small>loose tasks</small></div>
    <div class="tree">${loose.map(n => treeRows(n, 0)).join('')}</div>
    <form class="qa" data-form="inbox"><input id="qa-in" placeholder="+ Add a task" autocomplete="off" aria-label="Add a task to the inbox" enterkeyhint="done"></form>
    ${footHTML()}
  </div>`;
  el.querySelector('.side-b').scrollTop = sc;
}
function loadHTML(d) {
  const tasks = dayItems(d).filter(n => !isDone(n) && !hasKids(n.id)).reduce((a, n) => a + (n.m || 60), 0);
  const meet = timedOn(d).reduce((a, e) => a + e.m, 0);
  if (!tasks && !meet) return '';
  return `<div class="load${tasks + meet > 540 ? ' heavy' : ''}">${tasks ? fmtDur(tasks) + ' of tasks' : ''}${tasks && meet ? ' · ' : ''}${meet ? fmtDur(meet) + ' booked' : ''}</div>`;
}
const evRow = e => `<div class="evr"><span>${e.allDay ? 'All day' : fmtT(e.s)}</span>${esc(e.t)}</div>`;
/* In the List view, tasks sit between the day's calendar events. Gap 0 is before
   the first event, gap i is after event i. A task with a time goes where its time
   falls; one without sits after the event that starts at its "a" minute. */
const gapOf = (E, min) => min == null ? 0 : E.filter(e => e.s <= min).length;
function dayGaps(d) {
  const E = timedOn(d), gaps = E.map(() => []).concat([[]]);
  for (const n of dayItems(d)) gaps[gapOf(E, n.s ?? n.a)].push(n);
  return { E, gaps };
}
function listHTML(d) {
  const { E, gaps } = dayGaps(d), chips = g => g.map(n => chipHTML(n, { time: true, min: S.min })).join('');
  const all = eventsOn(d).filter(e => e.allDay).map(evRow).join('');
  const body = chips(gaps[0]) + E.map((e, i) => evRow(e) + chips(gaps[i + 1])).join('');
  return `${all}<div class="list${body ? '' : ' empty'}" data-drop="list" data-date="${d}">${body}</div>`;
}
function weekList(days) {
  return `<div class="wk">${days.map(d => `<section class="wcol${d === today() ? ' today' : ''}${d < today() ? ' past' : ''}">
    <button class="dh" data-act="goday" data-d="${d}"><span>${DAYN[pd(d).getDay()]}</span><b>${pd(d).getDate()}</b></button>
    ${listHTML(d)}${S.min ? '' : loadHTML(d)}</section>`).join('')}</div>`;
}
function dayList(d) { return `<div class="dl">${listHTML(d)}${S.min ? '' : loadHTML(d)}</div>`; }
function layout(items) {
  items.sort((a, b) => a.s - b.s || b.m - a.m); const cl = []; let cur = [], end = -1;
  for (const it of items) { if (cur.length && it.s >= end) { cl.push(cur); cur = []; end = -1; } cur.push(it); end = Math.max(end, it.s + it.m); }
  if (cur.length) cl.push(cur);
  for (const c of cl) { const lanes = []; for (const it of c) { let i = lanes.findIndex(e => e <= it.s); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = it.s + it.m; it.lane = i; } c.forEach(it => it.lanes = lanes.length); }
  return items;
}
function blocksHTML(d) {
  const items = [...timedOn(d).map(e => ({ ev: e, s: e.s, m: e.m })), ...store.all().filter(n => n.d === d && n.s != null).map(n => ({ n, s: n.s, m: n.m || 60 }))];
  return layout(items).map(it => {
    const s = Math.max(it.s, H0 * 60), e = Math.min(it.s + it.m, H1 * 60); if (e <= s) return '';
    const pos = `top:${hpx((s - H0 * 60) / 60)};height:max(${hpx((e - s) / 60)} - 2px, 18px);left:${it.lane / it.lanes * 100}%;width:calc(${100 / it.lanes}% - 4px)`;
    const tm = `${fmtT(it.s)} – ${fmtT(it.s + it.m)}`;
    if (it.ev) return `<div class="ev" style="${pos}" title="${esc(it.ev.cal || '')}"><div class="b-t">${esc(it.ev.t)}</div><div class="b-time">${tm}</div></div>`;
    const n = it.n;
    return `<div class="block${isDone(n) ? ' done' : ''}" data-drag data-id="${n.id}" style="${pos};--pc:${colorOf(n)}">${ckHTML(n)}<div class="b-in"><div class="b-t">${esc(n.t || 'Untitled')}</div><div class="b-time">${tm}</div>${subsHTML(n)}</div><div class="rs"></div></div>`;
  }).join('');
}
function nowHTML(d) { if (d !== today()) return ''; const m = nowMin(); if (m < H0 * 60 || m > H1 * 60) return ''; return `<div class="now" style="top:${hpx((m - H0 * 60) / 60)}"></div>`; }
function timed(days) {
  const hrs = []; for (let h = H0 + 1; h < H1; h++) hrs.push(h);
  return `<div class="tw hscroll"><div class="tg${days.length === 1 ? ' one' : ''}" style="--cols:${days.length};--hours:${H1 - H0}">
    <div class="trow thead"><div class="gut"></div>${days.map(d => `<button class="th${d === today() ? ' today' : ''}" data-act="goday" data-d="${d}">${DAYN[pd(d).getDay()]} <b>${pd(d).getDate()}</b></button>`).join('')}</div>
    <div class="trow ttray"><div class="gut">Any<br>time</div>${days.map(d => `<div class="tray" data-drop="tray" data-date="${d}">${eventsOn(d).filter(e => e.allDay).map(e => `<div class="ev-all">${esc(e.t)}</div>`).join('')}${dayItems(d).filter(n => n.s == null).map(n => chipHTML(n, { compact: days.length > 1 })).join('')}</div>`).join('')}</div>
    <div class="trow tbody"><div class="gut hrs">${hrs.map(h => `<div class="hl" style="top:${hpx(h - H0)}">${h % 12 || 12}${h < 12 ? 'am' : 'pm'}</div>`).join('')}</div>
    ${days.map(d => `<div class="col${d === today() ? ' today' : ''}" data-drop="col" data-date="${d}">${blocksHTML(d)}${nowHTML(d)}</div>`).join('')}</div>
  </div></div>`;
}
function renderMain() {
  const el = document.getElementById('main');
  const prev = document.getElementById('mbody'); const key = S.view + S.mode + S.anchor;
  const same = prev && prev.dataset.k === key; const sc = same ? prev.scrollTop : null; const hsc = same ? prev.querySelector('.tw')?.scrollLeft : null;
  const ws = weekStart(S.anchor); const days = S.view === 'week' ? [...Array(7)].map((_, i) => add(ws, i)) : [S.anchor];
  calendar.ensure(days[0], days[days.length - 1]);
  const we = pd(add(ws, 6)), a = pd(S.anchor);
  const title = S.view === 'week' ? `${MON[pd(ws).getMonth()]} ${pd(ws).getDate()} – ${pd(ws).getMonth() === we.getMonth() ? '' : MON[we.getMonth()] + ' '}${we.getDate()}` : `${S.anchor === today() ? 'Today' : DAYL[a.getDay()]}, ${MON[a.getMonth()]} ${a.getDate()}`;
  const P = (k, v) => `aria-pressed="${S[k] === v}"`; const un = unscheduled();
  const warn = store.sync.state === 'offline' || store.sync.state === 'error' ? `<div class="tip warn"><span>${SYNC_TEXT[store.sync.state]}</span></div>` : '';
  el.innerHTML = `<header class="mh">
    <div class="mh-l"><h1>${title}</h1><div class="nav"><button class="ib" data-act="prev" aria-label="Previous">${ICON.prev}</button><button class="tb" data-act="today">Today</button><button class="ib" data-act="next" aria-label="Next">${ICON.next}</button></div></div>
    <div class="mh-r"><div class="seg" role="group" aria-label="Range"><button data-act="view" data-v="day" ${P('view', 'day')}>Day</button><button data-act="view" data-v="week" ${P('view', 'week')}>Week</button></div>
    <div class="seg" role="group" aria-label="Layout"><button data-act="mode" data-v="list" ${P('mode', 'list')}>List</button><button data-act="mode" data-v="timed" ${P('mode', 'timed')}>Time blocks</button></div>
    ${S.mode === 'list' ? `<button class="ib min-btn" data-act="min" aria-pressed="${!!S.min}" aria-label="Minimal list" title="Minimal list: just task titles">${ICON.min}</button>` : ''}
    <button class="ask-btn" data-act="ai-toggle">✦ Ask Claude</button></div></header>
  <div class="mbody vscroll${S.min && S.mode === 'list' ? ' min' : ''}" id="mbody" data-k="${key}">${warn}
    ${S.tip ? `<div class="tip"><span>Tap a task to open it and add notes. Drag to move it. On a phone, press and hold, then drag.</span><button data-act="tip" aria-label="Dismiss tip">×</button></div>` : ''}
    <div class="strip" data-drop="inbox"><div class="strip-l">Unscheduled · ${un.length}</div><div class="strip-row hscroll">${un.length ? un.map(n => chipHTML(n, { compact: true })).join('') : '<span class="strip-empty">Nothing waiting. Add tasks under Projects.</span>'}</div></div>
    ${S.mode === 'list' ? (S.view === 'week' ? weekList(days) : dayList(days[0])) : timed(days)}
  </div>`;
  const mb = document.getElementById('mbody');
  if (sc != null) { mb.scrollTop = sc; const tw = mb.querySelector('.tw'); if (tw && hsc != null) tw.scrollLeft = hsc; }
  else if (S.mode === 'timed') {
    const target = Math.max(H0, (days.includes(today()) ? Math.floor(nowMin() / 60) - 1 : 8)); mb.scrollTop = Math.max(0, (Math.min(target, 17) - H0) * HP());
    const tw = mb.querySelector('.tw'); const ti = days.indexOf(today()); if (tw && ti > 0 && tw.scrollWidth > tw.clientWidth) tw.scrollLeft = ti * 116;
  }
}
function renderTabs() {
  const t = [['plan', 'Plan', ICON.plan], ['projects', 'Projects', ICON.proj], ['ask', 'Ask Claude', ICON.ask]];
  document.getElementById('tabs').innerHTML = t.map(([k, l, i]) => `<button data-act="tab" data-v="${k}" aria-current="${S.tab === k}">${i}<span>${l}</span></button>`).join('');
  document.body.dataset.tab = S.tab;
}

/* Zoomed-in view of one item */
function stepHTML(k) {
  const kk = hasKids(k.id), p = progress(k.id);
  return `<div class="step${isDone(k) ? ' done' : ''}" style="--pc:${colorOf(k)}">${ckHTML(k)}<button class="step-t" data-act="open" data-id="${k.id}">${esc(k.t || 'Untitled')}${k.notes ? ICON.note : ''}${k.link ? ICON.linkS : ''}</button>${kk ? `<span class="step-n">${p.done}/${p.total}</span>` : ''}${k.d ? `<span class="when set">${whenLabel(k)}</span>` : ''}<span class="chev" aria-hidden="true">›</span></div>`;
}
const grow = t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
function renderDetail() {
  const el = document.getElementById('detail'); const n = S.open && node(S.open);
  if (!n) { S.open = null; el.hidden = true; el.innerHTML = ''; return; }
  const ae = document.activeElement;
  if (!el.hidden && el.contains(ae) && ae.matches('textarea,input') && el.querySelector('.dt-body')?.dataset.id === n.id && ae.id !== 'dt-add-in') return; // don't interrupt typing
  const body = el.querySelector('.dt-body'); const prevSc = body?.dataset.id === n.id ? body.scrollTop : 0;
  el.hidden = false; const anc = ancestors(n), kids = children(n.id), pr = progress(n.id), pct = pr.total ? Math.round(pr.done / pr.total * 100) : 0;
  const up = anc[anc.length - 1]; const durs = [5, 10, 15, 20, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480];
  if (!durs.includes(n.m || 60)) durs.push(n.m || 60);
  const count = leaves(n.id).length - (kids.length ? 0 : 1);
  el.innerHTML = `<div class="dt-back" data-act="close"></div>
  <section class="dt" role="dialog" aria-modal="true" aria-label="${esc(n.t)}" style="--pc:${colorOf(n)}">
    <div class="dt-top"><button class="dt-up" data-act="${up ? 'open' : 'close'}" data-id="${up ? up.id : ''}">${ICON.prev}<span>${up ? esc(up.t) : 'Back'}</span></button><button class="ib" data-act="close" aria-label="Close">${ICON.close}</button></div>
    <div class="dt-body vscroll" data-id="${n.id}">
      ${anc.length > 1 ? `<div class="dt-crumbs">${anc.map(a => `<button data-act="open" data-id="${a.id}">${esc(a.t)}</button>`).join('<span>›</span>')}</div>` : ''}
      <div class="dt-head">${ckHTML(n)}<textarea id="dt-title" class="dt-title" rows="1" aria-label="Title" placeholder="Name it" enterkeyhint="done">${esc(n.t)}</textarea></div>
      ${kids.length ? `<div class="dt-prog"><div class="bar"><i style="width:${pct}%"></i></div><span>${pr.done} of ${pr.total} done</span></div>` : ''}
      <div class="dt-meta">
        <button class="chip${n.d ? ' set' : ''}" data-act="dtpick">${ICON.cal}<span>${n.d ? whenLabel(n) : 'Add to a day'}</span></button>
        ${kids.length || n.c ? '' : `<label class="chip"><span class="k">Takes about</span><select id="dt-dur">${durs.sort((a, b) => a - b).map(m => `<option value="${m}"${(n.m || 60) === m ? ' selected' : ''}>${fmtDur(m)}</option>`).join('')}</select></label>`}
        ${kids.length || n.c || n.due ? `<label class="chip${n.due ? ' set' : ''}"><span class="k">Due</span><input type="date" id="dt-due" value="${n.due || ''}"></label>` : ''}
        ${linkHTML(n)}
      </div>
      ${S.dtpick ? pickerHTML(n, 0) : ''}
      ${n.p == null && isProj(n) ? `<div class="swatches" role="group" aria-label="Color">${PALETTE.map(c => `<button class="sw${glow(n.c) === c ? ' on' : ''}" style="--sw:${c}" data-act="color" data-c="${c}" aria-label="Color ${c}"></button>`).join('')}</div>` : ''}
      <div class="dt-sec">Notes</div>
      <textarea id="dt-notes" class="dt-notes" placeholder="Thoughts, links, where to start. These will be here when you sit down to do it." aria-label="Notes">${esc(n.notes || '')}</textarea>
      <div class="dt-saved" id="dt-saved" aria-live="polite"></div>
      <div class="dt-sec">Steps${kids.length ? `<small>${pr.done}/${pr.total}</small>` : ''}</div>
      <div class="dt-steps">${kids.map(stepHTML).join('')}
        <form class="dt-add" data-form="step" data-p="${n.id}"><span class="plus-i" aria-hidden="true">+</span><input id="dt-add-in" placeholder="Add a step" autocomplete="off" aria-label="Add a step" enterkeyhint="done"></form></div>
      <div class="dt-foot">
        <button class="dt-ask" data-act="dtbreak">✦ ${kids.length ? 'Ask Claude what else this needs' : 'Ask Claude to break this into steps'}</button>
        ${S.confirmDel ? `<div class="confirm"><span>Delete ${esc(n.t || 'this')}${count > 0 ? ` and its ${count} step${count > 1 ? 's' : ''}` : ''}?</span><button class="danger" data-act="delete">Delete</button><button data-act="nodelete">Cancel</button></div>` : `<button class="dt-del" data-act="askdelete">Delete</button>`}
      </div>
    </div></section>`;
  el.querySelectorAll('textarea').forEach(grow); el.querySelector('.dt-body').scrollTop = prevSc;
}
function linkHTML(n) {
  if (S.linkEdit) return `<form class="chip link-edit" data-form="link" novalidate>${ICON.link}<input id="dt-link" type="url" inputmode="url" placeholder="Paste a Thymer page or any link" value="${esc(n.link || '')}" autocomplete="off" enterkeyhint="done" aria-label="Link"></form>`;
  const u = n.link && safeLink(n.link);
  if (u) return `<span class="link-pair"><a class="chip set" href="${esc(u)}" target="_blank" rel="noopener">${ICON.link}<span>${esc(linkLabel(u))}</span></a><button class="chip-edit" data-act="editlink">Change</button></span>`;
  return `<button class="chip" data-act="editlink">${ICON.link}<span>Add link</span></button>`;
}
function saveLink() {
  const i = document.getElementById('dt-link'); if (!S.linkEdit || !i) return;
  const v = i.value.trim(); S.linkEdit = false; i.blur();
  const u = v ? safeLink(v) || safeLink('https://' + v) : null;
  if (v && !u) toast("That doesn't look like a web address");
  else if (S.open && (node(S.open)?.link || null) !== u) store.update(S.open, { link: u });
  renderDetail();
}
function openItem(id, focusTitle = false) {
  S.open = id; S.dtpick = false; S.confirmDel = false; S.linkEdit = false; renderDetail();
  if (focusTitle) { const t = document.getElementById('dt-title'); t.focus(); t.select(); }
}

/* Render everything, keeping focus and typing intact */
let raf = 0;
function render() {
  cancelAnimationFrame(raf); raf = 0;
  const ae = document.activeElement; const fid = ae && ae.id && !document.getElementById('detail').contains(ae) ? ae.id : null;
  const val = fid ? ae.value : null;
  renderSide(); renderMain(); renderTabs(); renderDetail(); renderMsgs(); saveUI();
  if (S.adding) { const i = document.getElementById('add-in'); if (i) { if (fid === 'add-in') i.value = val; i.focus({ preventScroll: true }); } }
  else if (fid && fid !== 'askq') { const i = document.getElementById(fid); if (i) { if (val != null && 'value' in i) i.value = val; i.focus({ preventScroll: true }); } }
}
const later = () => { if (!raf) raf = requestAnimationFrame(render); };

/* Actions */
let toastT; function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
function toggle(id) {
  const n = node(id); const anc = ancestors(n); const before = anc.map(isDone);
  if (hasKids(id) || n.c) { const all = isDone(n); store.updateMany(leaves(id).filter(l => !l.c).map(l => [l.id, { done: !all }])); }
  else store.update(id, { done: !n.done });
  const fin = anc.filter((a, i) => !before[i] && isDone(a));
  if (fin.length) { const a = fin[fin.length - 1]; const r = rootOf(n); const p = progress(r.id); toast(r === a ? `${a.t} is complete.` : `${a.t} is done. ${r.t} is now ${Math.round(p.done / p.total * 100)}% complete.`); }
  else if (!hasKids(id) && node(id).done && anc.length) { const r = rootOf(n), p = progress(r.id); toast(`${r.t}: ${p.done} of ${p.total} done`); }
}
function reorder(date, id, idx, patch) {
  const list = dayGaps(date).gaps.flat().filter(n => n.id !== id); list.splice(Math.max(0, Math.min(idx, list.length)), 0, node(id));
  store.updateMany(list.map((n, i) => [n.id, n.id === id ? { ...patch, o: i } : { o: i }]));
}
function setDay(id, d) { const n = node(id); const patch = { d: d || null, o: Date.now() / 1000 }; if (n.d !== d) { patch.s = null; patch.a = null; } S.pick = null; S.dtpick = false; store.update(id, patch); if (d) toast(`${n.t} → ${d === today() ? 'today' : DAYL[pd(d).getDay()] + ' ' + fmtShort(d)}`); }
function newProject() {
  const used = new Set(store.all().filter(n => n.p == null && n.c).map(n => glow(n.c)));
  const c = PALETTE.find(x => !used.has(x)) || PALETTE[store.all().length % PALETTE.length];
  const n = store.create({ t: '', c, o: Date.now() / 1000 });
  openItem(n.id, true);
}
function showPlan(view, mode) { S.view = view; S.mode = mode; render(); }
function signIn() {
  if (!client) return;
  client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname, scopes: 'https://www.googleapis.com/auth/calendar.readonly', queryParams: { access_type: 'offline', prompt: 'consent' } } });
}
let justDragged = false;
document.addEventListener('click', e => {
  if (justDragged) { e.preventDefault(); e.stopPropagation(); return; }
  const b = e.target.closest('[data-act]');
  if (!b) { const it = e.target.closest('[data-drag]'); if (it && !e.target.closest('input,textarea,select,form')) openItem(it.dataset.id); return; }
  const a = b.dataset.act, id = b.dataset.id;
  switch (a) {
    case 'open': openItem(id); break;
    case 'close': S.open = null; S.confirmDel = false; S.linkEdit = false; renderDetail(); break;
    case 'editlink': S.linkEdit = true; renderDetail(); document.getElementById('dt-link')?.focus(); break;
    case 'dtpick': S.dtpick = !S.dtpick; renderDetail(); break;
    case 'dtbreak': {
      const n = node(S.open);
      if (user) { const q = hasKids(n.id) ? `Look at "${n.t}" and its steps. What's missing? Add any steps it still needs.` : `Break "${n.t}" into steps.`; S.open = null; renderDetail(); openAI(); ask(q); }
      else { breakDownLocal(n.t); }
      break;
    }
    case 'askdelete': S.confirmDel = true; renderDetail(); break;
    case 'nodelete': S.confirmDel = false; renderDetail(); break;
    case 'delete': { const n = node(S.open); S.open = n.p && node(n.p) ? n.p : null; S.confirmDel = false; store.remove(n.id); toast(`Deleted ${n.t || 'item'}`); break; }
    case 'color': store.update(S.open, { c: b.dataset.c }); break;
    case 'toggle': toggle(id); break;
    case 'fold': S.col[id] = !S.col[id]; render(); break;
    case 'pick': S.pick = S.pick === id ? null : id; render(); break;
    case 'setday': setDay(id, b.dataset.d || null); break;
    case 'add': S.adding = id; S.col[id] = false; render(); break;
    case 'new-project': newProject(); break;
    case 'view': S.view = b.dataset.v; render(); break;
    case 'mode': S.mode = b.dataset.v; render(); break;
    case 'min': S.min = !S.min; render(); break;
    case 'prev': case 'next': S.anchor = add(S.anchor, (a === 'prev' ? -1 : 1) * (S.view === 'week' ? 7 : 1)); render(); break;
    case 'today': S.anchor = today(); render(); break;
    case 'goday': S.anchor = b.dataset.d; S.view = 'day'; render(); break;
    case 'tip': S.tip = false; render(); break;
    case 'tab': S.tab = b.dataset.v; render(); break;
    case 'ai-toggle': document.body.classList.toggle('ai-off'); break;
    case 'reset': store.resetLocal(store.sampleData); toast('Sample data restored'); break;
    case 'ask': openAI(); ask(b.dataset.q); break;
    case 'clear-chat': clearChat(); break;
    case 'undo': if (undo(b.dataset.u)) { b.disabled = true; b.textContent = 'Undone'; } break;
    case 'signin': signIn(); break;
    case 'demo': enterDemo(); break;
    case 'signout': client.auth.signOut(); break;
    case 'mcp': S.mcp = S.mcp ? null : {}; renderSide(); break;
    case 'mcp-close': S.mcp = null; renderSide(); break;
    case 'mcp-make': mcpMake(); break;
    case 'mcp-off': mcpOff(); break;
    case 'mcp-copy': {
      const i = document.getElementById('mcp-url'); const manual = () => { i.select(); toast('Select the address and copy it'); };
      if (navigator.clipboard) navigator.clipboard.writeText(i.value).then(() => toast('Copied'), manual); else manual();
      break;
    }
  }
}, true);
function openAI() { if (phone()) { if (S.tab !== 'ask') { S.tab = 'ask'; renderTabs(); } } else document.body.classList.remove('ai-off'); }
document.addEventListener('submit', e => {
  const f = e.target; e.preventDefault();
  if (f.id === 'askf') { const q = document.getElementById('askq'); if (q.value.trim()) { ask(q.value.trim()); q.value = ''; } return; }
  const inp = f.querySelector('input'); const v = inp.value.trim();
  if (f.dataset.form === 'link') { saveLink(); return; }
  if (f.dataset.form === 'step') { if (v) { store.create({ t: v, p: f.dataset.p, m: 30 }); S.col[f.dataset.p] = false; inp.value = ''; renderDetail(); document.getElementById('dt-add-in')?.focus(); } return; }
  if (f.dataset.form === 'add') { if (!v) { S.adding = null; render(); return; } inp.value = ''; store.create({ t: v, p: f.dataset.p }); return; }
  if (f.dataset.form === 'inbox' && v) { inp.value = ''; store.create({ t: v }); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.linkEdit) { S.linkEdit = false; document.activeElement?.blur(); renderDetail(); return; }
  if (e.key === 'Escape') { if (S.adding) { S.adding = null; render(); } else if (S.open) { S.open = null; renderDetail(); } }
  if (e.key === 'Enter' && e.target.id === 'dt-title') { e.preventDefault(); e.target.blur(); }
});
document.addEventListener('focusout', e => { if (e.target.id === 'dt-link') saveLink(); });
document.addEventListener('focusout', e => { if (e.target.id === 'add-in' && !e.target.value.trim()) setTimeout(() => { if (S.adding && !document.activeElement?.matches('#add-in')) { S.adding = null; render(); } }, 150); });
let savedT;
document.addEventListener('input', e => {
  const t = e.target, n = S.open && node(S.open); if (!n) return;
  if (t.id === 'dt-notes') { store.update(n.id, { notes: t.value || null }, true); grow(t); const m = document.getElementById('dt-saved'); m.textContent = 'Saved'; clearTimeout(savedT); savedT = setTimeout(() => m.textContent = '', 1200); }
  if (t.id === 'dt-title') { store.update(n.id, { t: t.value.replace(/\n/g, ' ') }, true); grow(t); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.pickdate) { if (t.value) setDay(t.dataset.pickdate, t.value); return; }
  const n = S.open && node(S.open); if (!n) return;
  if (t.id === 'dt-title') { if (!n.t.trim()) store.update(n.id, { t: n.c ? 'New project' : 'Untitled' }); else store.updateMany([]); }
  if (t.id === 'dt-notes') store.updateMany([]);
  if (t.id === 'dt-dur') store.update(n.id, { m: +t.value });
  if (t.id === 'dt-due') store.update(n.id, { due: t.value || null });
});

/* Drag and drop: mouse uses pointer events, touch uses press-and-hold */
let P = null, D = null, lp = null; const ind = document.createElement('div'); ind.className = 'ind'; const ins = document.createElement('div'); ins.className = 'ins';
function startDrag() {
  const el = P.el, r = el.getBoundingClientRect();
  D = { id: P.id, kind: P.kind, el, x: P.x, y: P.y, offY: P.y - r.top, offX: Math.min(P.x - r.left, 40), timed: el.classList.contains('block'), t: null };
  if (D.kind === 'resize') D.block = el.closest('.block');
  else {
    const g = el.cloneNode(true); g.classList.add('ghost'); g.classList.remove('pressing'); const w = Math.min(r.width, 280); g.style.width = w + 'px';
    if (D.timed) { g.style.height = r.height + 'px'; D.offX = Math.min(P.x - r.left, w - 10); } else D.offY = Math.min(D.offY, 24);
    document.body.appendChild(g); D.g = g; el.classList.add('dragging');
  }
  el.classList.remove('pressing'); document.body.classList.add('is-dragging'); P = null; moveDrag(D.x, D.y); requestAnimationFrame(autoScroll);
}
function clearMarks() { ind.remove(); ins.remove(); document.querySelectorAll('.over').forEach(x => x.classList.remove('over')); }
function moveDrag(x, y) {
  D.x = x; D.y = y; const hp = HP();
  if (D.kind === 'resize') { const r = D.block.getBoundingClientRect(); const n = node(D.id); const m = Math.max(15, Math.min(Math.round((y - r.top) / hp * 60 / 15) * 15, H1 * 60 - n.s)); D.newM = m; D.block.style.height = (m / 60 * hp - 2) + 'px'; D.block.querySelector('.b-time').textContent = `${fmtT(n.s)} – ${fmtT(n.s + m)}`; return; }
  D.g.style.transform = `translate(${x - D.offX}px,${y - D.offY}px)`;
  const t = document.elementFromPoint(x, y)?.closest('[data-drop]'); clearMarks(); D.t = t || null; if (!t) return;
  const type = t.dataset.drop;
  if (type === 'col') {
    const r = t.getBoundingClientRect(); const dur = node(D.id).m || 60;
    let min = H0 * 60 + Math.round((y - (D.timed ? D.offY : 12) - r.top) / hp * 60 / 15) * 15; min = Math.max(H0 * 60, Math.min(min, H1 * 60 - dur)); D.min = min;
    ind.style.top = ((min - H0 * 60) / 60 * hp) + 'px'; ind.style.height = (dur / 60 * hp - 2) + 'px'; ind.textContent = `${fmtT(min)} – ${fmtT(min + dur)}`; t.appendChild(ind);
  } else if (type === 'list') {
    // Rows are tasks and calendar events; count how many of each come before the drop point
    const rows = [...t.querySelectorAll(':scope > .item:not(.dragging), :scope > .evr')]; let i = rows.findIndex(it => { const r = it.getBoundingClientRect(); return y < r.top + r.height / 2; }); if (i < 0) i = rows.length;
    const before = rows.slice(0, i); D.gap = before.filter(r => r.classList.contains('evr')).length; D.idx = before.length - D.gap;
    if (rows[i]) t.insertBefore(ins, rows[i]); else t.appendChild(ins); t.classList.add('over');
  } else t.classList.add('over');
}
function endDrag() {
  const d = D; D = null; clearMarks(); document.body.classList.remove('is-dragging'); d.g?.remove(); d.el.classList.remove('dragging');
  const n = node(d.id);
  justDragged = true; setTimeout(() => justDragged = false, 80);
  if (!n) return render();
  if (d.kind === 'resize') { if (d.newM) store.update(n.id, { m: d.newM }); else render(); return; }
  if (!d.t) return render();
  const type = d.t.dataset.drop, date = d.t.dataset.date || null;
  if (type === 'col') store.update(n.id, { d: date, s: d.min, m: n.m || 60 });
  else if (type === 'tray') store.update(n.id, { d: date, s: null, a: null, o: Date.now() / 1000 });
  else if (type === 'list') {
    // Dropped between events: remember which event it follows, but no exact time.
    // A task that has a time keeps it only if that time still fits where it was dropped.
    const E = timedOn(date), patch = { d: date, a: d.gap ? E[d.gap - 1].s : null };
    if (n.s != null && gapOf(E, n.s) !== d.gap) patch.s = null;
    reorder(date, n.id, d.idx, patch);
  }
  else if (type === 'inbox') store.update(n.id, { d: null, s: null, a: null });
  else render();
}
function autoScroll() {
  if (!D) return; const el = document.elementFromPoint(D.x, D.y);
  const v = el?.closest('.vscroll'), h = el?.closest('.hscroll'); let moved = false;
  if (v) { const r = v.getBoundingClientRect(); if (D.y < r.top + 50) { v.scrollTop -= 10; moved = true; } else if (D.y > r.bottom - 50) { v.scrollTop += 10; moved = true; } }
  if (h && D.kind !== 'resize') { const r = h.getBoundingClientRect(); if (D.x < r.left + 40) { h.scrollLeft -= 10; moved = true; } else if (D.x > r.right - 40) { h.scrollLeft += 10; moved = true; } }
  if (moved) moveDrag(D.x, D.y); requestAnimationFrame(autoScroll);
}
document.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' || e.button !== 0) return;
  const rs = e.target.closest('.rs'); if (rs) { P = { x: e.clientX, y: e.clientY, el: rs, kind: 'resize', id: rs.closest('.block').dataset.id }; startDrag(); e.preventDefault(); return; }
  if (e.target.closest('button,input,a,form,textarea,select')) return;
  const el = e.target.closest('[data-drag]'); if (el) { e.preventDefault(); P = { x: e.clientX, y: e.clientY, el, kind: 'move', id: el.dataset.id }; }
});
document.addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; if (D) { moveDrag(e.clientX, e.clientY); return; } if (P && Math.hypot(e.clientX - P.x, e.clientY - P.y) > 4) startDrag(); });
document.addEventListener('pointerup', e => { if (e.pointerType === 'touch') return; if (D) endDrag(); P = null; });
document.addEventListener('touchstart', e => {
  if (e.touches.length > 1) { clearTimeout(lp); P = null; return; } const t = e.touches[0];
  const rs = e.target.closest('.rs'); if (rs) { e.preventDefault(); P = { x: t.clientX, y: t.clientY, el: rs, kind: 'resize', id: rs.closest('.block').dataset.id }; startDrag(); return; }
  if (e.target.closest('button,input,a,form,textarea,select')) return;
  const el = e.target.closest('[data-drag]'); if (!el) return;
  P = { x: t.clientX, y: t.clientY, el, kind: 'move', id: el.dataset.id }; el.classList.add('pressing');
  lp = setTimeout(() => { if (P) { navigator.vibrate?.(12); startDrag(); } }, 280);
}, { passive: false });
document.addEventListener('touchmove', e => {
  const t = e.touches[0]; if (D) { e.preventDefault(); moveDrag(t.clientX, t.clientY); return; }
  if (P && Math.hypot(t.clientX - P.x, t.clientY - P.y) > 8) { clearTimeout(lp); P.el.classList.remove('pressing'); P = null; }
}, { passive: false });
const tend = e => { clearTimeout(lp); if (D) { e.preventDefault(); endDrag(); } if (P) { P.el.classList.remove('pressing'); P = null; } };
document.addEventListener('touchend', tend, { passive: false }); document.addEventListener('touchcancel', tend, { passive: false });
document.addEventListener('contextmenu', e => { if (e.target.closest('[data-drag]')) e.preventDefault(); });

/* Zoom the time-blocked view: pinch on a phone, Ctrl (or Cmd) + scroll wheel or trackpad pinch on a computer */
const ZOOM_KEY = 'daybook-zoom', HP_MIN = 20, HP_MAX = 200;
const setHP = v => { v = Math.max(HP_MIN, Math.min(HP_MAX, v)); document.documentElement.style.setProperty('--hp', v + 'px'); return v; };
{ const z = lsGet(ZOOM_KEY, null); if (typeof z === 'number') setHP(z); }
let zoomSave;
function zoomTo(v, y) { // keep the time under y (screen position) in place while zooming
  const mb = document.getElementById('mbody'), col = mb?.querySelector('.col'); if (!col) return;
  const old = HP(), top = col.getBoundingClientRect().top, hrs = (y - top) / old;
  const nv = setHP(v); if (nv === old) return;
  mb.scrollTop += hrs * (nv - old);
  clearTimeout(zoomSave); zoomSave = setTimeout(() => lsSet(ZOOM_KEY, HP()), 300);
}
const inGrid = t => S.tab === 'plan' && S.mode === 'timed' && t instanceof Element && !!t.closest('#mbody .tw');
document.addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey) || !inGrid(e.target)) return;
  e.preventDefault();
  const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
  zoomTo(HP() * Math.exp(-Math.max(-50, Math.min(50, dy)) * 0.006), e.clientY);
}, { passive: false });
let Z = null;
const span = ts => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
document.addEventListener('touchstart', e => {
  if (e.touches.length !== 2 || D || !inGrid(e.target)) { if (e.touches.length !== 2) Z = null; return; }
  Z = { d: span(e.touches), hp: HP() };
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!Z || e.touches.length !== 2 || D) return;
  e.preventDefault();
  zoomTo(Z.hp * span(e.touches) / Math.max(Z.d, 1), (e.touches[0].clientY + e.touches[1].clientY) / 2);
}, { passive: false });
document.addEventListener('touchend', e => { if (e.touches.length < 2) Z = null; });

/* Start-up: sign-in, sample mode, and keeping "today" current */
function showWelcome(show) { document.getElementById('welcome').hidden = !show; }
function enterDemo() {
  S.demo = true; saveUI(); user = null; showWelcome(false);
  store.useLocal('daybook-sample', store.sampleData); calendar.useSample();
  initAI({ cloud: false, client: null }); render();
}
async function enterCloud(u) {
  user = u; S.demo = false; saveUI(); showWelcome(false);
  calendar.useGoogle(client, u.id); initAI({ cloud: true, client });
  render();
  await store.useCloud(client, u);
  calendar.ensure(add(today(), -7), add(today(), 28), true);
}
store.onChange(kind => { if (kind === 'sync') { if (!D) later(); return; } if (!D) later(); });
calendar.onCalendarChange(() => { if (!D) later(); });
initAI({ anchor: () => S.anchor, showPlan, render: later });
setInterval(() => { if (today() !== shown) { shown = today(); if (S.anchor === add(today(), -1)) S.anchor = today(); later(); } else if (S.mode === 'timed' && !D) { document.querySelectorAll('.now').forEach(n => n.style.top = hpx((nowMin() - H0 * 60) / 60)); } }, 60e3);
if (!matchMedia('(min-width:1500px)').matches) document.body.classList.add('ai-off');

async function boot() {
  let cfg = {};
  try { cfg = (await import('./config.js')).default || {}; } catch { /* not set up yet */ }
  configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  if (!configured) { enterDemo(); return; }
  supaUrl = cfg.supabaseUrl.replace(/\/+$/, '');
  client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } });
  client.auth.onAuthStateChange((event, session) => {
    if (session?.provider_refresh_token) {
      client.rpc('save_google_token', { refresh: session.provider_refresh_token }).then(() => calendar.ensure(add(today(), -7), add(today(), 28), true));
    }
    if (event === 'SIGNED_OUT') { store.stopCloud(); user = null; S.demo = false; saveUI(); showWelcome(true); }
    else if (event === 'SIGNED_IN' && session?.user && (!user || user.id !== session.user.id)) enterCloud(session.user);
  });
  const { data: { session } } = await client.auth.getSession();
  if (session?.user) { if (!user) enterCloud(session.user); }
  else if (S.demo) enterDemo();
  else { renderTabs(); showWelcome(true); }
}
boot();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
