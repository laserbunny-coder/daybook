import * as store from './store.js';
import * as calendar from './calendar.js';
import { eventsOn, timedOn } from './calendar.js';
import { initAI, ask, undo, renderMsgs, clearChat, breakDownLocal } from './ai.js';
import * as roadmap from './roadmap.js';
import * as track from './track.js';
import { cleanRule, ruleText, splitOcc, WEEK } from './repeat.js';
import { add, DAYL, DAYN, MON, daysBetween, dayShort, esc, fmtDur, fmtShort, fmtT, lsDel, lsGet, lsSet, nowMin, pd, today, weekStart } from './util.js';
import { ancestors, children, colorOf, dayItems, glow, hasKids, isDone, isProj, leaves, node, PALETTE, progress, rootOf } from './tree.js';

const H0 = 6, H1 = 23;
const HP = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hp')) || 48;
// Positions in the time grid are written in hours of --hp, so zooming only has to change --hp
const hpx = h => `calc(var(--hp) * ${+h.toFixed(4)})`;
const phone = () => matchMedia('(max-width:860px)').matches;
// On a computer the main pane shows either the plan or a full Projects board; a phone uses its tab bar instead.
const boardShown = () => !phone() && S.page === 'projects';
// The Roadmap is a page of its own on a computer and a tab on a phone, and it can open inside Quiet too
const roadShown = () => phone() ? S.tab === 'roadmap' : S.page === 'roadmap';
const ICON = {
  prev: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 3L5 8l5 5"/></svg>',
  next: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3l5 5-5 5"/></svg>',
  undo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3.5l-3 3 3 3"/><path d="M2.5 6.5h7a3.5 3.5 0 0 1 0 7H7"/></svg>',
  redo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 3.5l3 3-3 3"/><path d="M13.5 6.5h-7a3.5 3.5 0 0 0 0 7H9"/></svg>',
  cal: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 9.5h17M8 3v4M16 3v4M8 13.5h3M8 16.5h6"/></svg>',
  proj: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 6h14M8 11h11M11 16h8"/><circle cx="5" cy="11" r="1"/><circle cx="8" cy="16" r="1"/></svg>',
  ask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
  note: '<svg class="ni" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" aria-label="Has notes"><path d="M2.5 3h7M2.5 6h7M2.5 9h4"/></svg>',
  link: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.5 9.5l3-3M7.3 4.2l.9-.9a2.8 2.8 0 0 1 4 4l-.9.9M8.7 11.8l-.9.9a2.8 2.8 0 0 1-4-4l.9-.9"/></svg>',
  linkS: '<svg class="ni" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-label="Has a link"><path d="M6.5 9.5l3-3M7.3 4.2l.9-.9a2.8 2.8 0 0 1 4 4l-.9.9M8.7 11.8l-.9.9a2.8 2.8 0 0 1-4-4l.9-.9"/></svg>',
  board: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.3"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1.3"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1.3"/><rect x="9" y="9" width="4.5" height="4.5" rx="1.3"/></svg>',
  min: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 4.5h10M3 8h10M3 11.5h6"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  road: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 6.5h8M8 12h10M6 17.5h7"/><path d="M15.5 4.5l2 2-2 2-2-2z" stroke-linejoin="round"/></svg>',
  ms: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 2.5L13.5 8 8 13.5 2.5 8z"/></svg>',
  wait: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4.5 2.5h7M4.5 13.5h7M5.5 2.5c0 3 5 3.5 5 5.5s-5 2.5-5 5.5M10.5 2.5c0 3-5 3.5-5 5.5s5 2.5 5 5.5"/></svg>',
  rep: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.6 6.2A4.9 4.9 0 0 0 3.7 5M3.4 9.8a4.9 4.9 0 0 0 8.9 1.2"/><path d="M3.4 2.4v2.9h2.9M12.6 13.6v-2.9H9.7"/></svg>',
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 3.8v8.4a.5.5 0 0 0 .76.43l6.6-4.2a.5.5 0 0 0 0-.86l-6.6-4.2a.5.5 0 0 0-.76.43z"/></svg>',
  stop: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5"/></svg>',
  recS: '<svg class="ni rs-i" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-label="Recorded time"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/></svg>',
  repS: '<svg class="ni" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-label="Repeats"><path d="M12.6 6.2A4.9 4.9 0 0 0 3.7 5M3.4 9.8a4.9 4.9 0 0 0 8.9 1.2"/><path d="M3.4 2.4v2.9h2.9M12.6 13.6v-2.9H9.7"/></svg>',
};

/* View state (per device) */
const UI_KEY = 'daybook-ui';
const S = { view: phone() ? 'day' : 'week', mode: 'list', anchor: today(), col: {}, tab: 'plan', page: 'plan', tip: true, demo: false, min: false, ...lsGet(UI_KEY, {}), focus: false, pick: null, adding: null, new: null, drOpen: false, drAt: null, open: null, dtpick: false, confirmDel: false, linkEdit: false, notesEdit: false, waitEdit: false, rpEdit: false, scope: 'one', mcp: null };
S.anchor = today();
const saveUI = () => lsSet(UI_KEY, { view: S.view, mode: S.mode, col: S.col, tab: S.tab, page: S.page, tip: S.tip, demo: S.demo, min: S.min, rmZoom: S.rmZoom, free: S.free });
let client = null, user = null, configured = false, shown = today(), supaUrl = '';

/* Links on items, such as the Thymer page a task came from */
const safeLink = u => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } };
/* Notes text with web addresses turned into links that open in a new tab. Everything else is escaped. */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
function linkify(text) {
  let out = '', last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let raw = m[0];
    while (/[.,;:!?'"]$/.test(raw) || (raw.endsWith(')') && !raw.includes('('))) raw = raw.slice(0, -1);
    const u = safeLink(/^www\./i.test(raw) ? 'https://' + raw : raw);
    if (!u) continue;
    const shown = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    out += esc(text.slice(last, m.index)) + `<a href="${esc(u)}" target="_blank" rel="noopener" title="${esc(u)}">${esc(shown.length > 60 ? shown.slice(0, 57) + '…' : shown)}</a>`;
    last = m.index + raw.length;
  }
  return out + esc(text.slice(last));
}
const linkLabel = u => { const h = new URL(u).hostname.replace(/^www\./, ''); return h === 'thymer.com' || h.endsWith('.thymer.com') ? 'Open in Thymer' : 'Open ' + h; };

/* Rendering */
function ckHTML(n) {
  if (n.r) { const t = esc(ruleText(n.r, n.d)); return `<button class="ck rp" data-act="open" data-id="${n.id}" title="${t}" aria-label="${esc(n.t)} repeats: ${t}">${ICON.rep}</button>`; } // a repeating task is checked off one repeat at a time, on the plan
  if (hasKids(n.id) || n.c) {
    const p = progress(n.id); const pct = p.total ? p.done / p.total : 0;
    return `<button class="ring" data-act="toggle" data-id="${n.id}" style="--p:${pct}" title="${p.done} of ${p.total} done" aria-label="${esc(n.t)}: ${p.done} of ${p.total} done"></button>`;
  }
  return `<button class="ck${n.done ? ' on' : ''}" data-act="toggle" data-id="${n.id}" aria-label="Mark ${esc(n.t)} ${n.done ? 'not done' : 'done'}"></button>`;
}
/* Time tracking (track.js): a small ▶ on every open task and project starts recording it; ■ stops it */
const canRec = n => !!n && !n.r && n.k !== 'area' && !isDone(n);
function recBtn(n) {
  if (!canRec(n)) return '';
  const on = track.isRec(n);
  return `<button class="rec-b${on ? ' on' : ''}" data-act="rec" data-id="${n.id}" aria-label="${on ? 'Stop recording' : 'Record time on'} ${esc(n.t || 'this')}" title="${on ? 'Stop recording' : 'Record time'}">${on ? ICON.stop : ICON.play}</button>`;
}
// Inside a project that's recording, its steps show that it is, with a way to stop it
function recUp(n) {
  const r = track.running(), up = r && ancestors(n).find(a => a.id === r.id);
  return up ? `<button class="chip rec-chip on" data-act="rec" data-id="${up.id}">${ICON.stop}<span>Recording ${esc(short(up.t))} · Stop</span></button>` : '';
}
function chipHTML(n, o = {}) {
  const crumbs = ancestors(n).map(a => a.t); const meta = []; const kids = hasKids(n.id);
  if (!o.min) { // minimal list shows just the title
    if (n.rs) meta.push(ICON.repS);
    if (n.notes) meta.push(ICON.note);
    if (n.link) meta.push(ICON.linkS);
    if (crumbs.length) meta.push(`<span class="pd"></span>${esc(crumbs.slice(-2).join(' › '))}`);
    else if (!kids && areaOf(n)) meta.push(`<span class="pd"></span>${esc(store.get(n.ar).t || 'Untitled area')}`); // a task right in an area
    if (o.time && n.s != null) meta.push(`<span class="tm">${fmtT(n.s)}</span>`);
    if (n.m && !kids) meta.push(fmtDur(n.m));
    if (kids) { const p = progress(n.id); meta.push(`${p.done}/${p.total} done`); }
  }
  return `<div class="item${isDone(n) ? ' done' : ''}${overdue(n) ? ' overdue' : ''}${track.isRec(n) ? ' recording' : ''}${o.compact ? ' compact' : ''}" data-drag data-id="${n.id}" style="--pc:${colorOf(n)}">${ckHTML(n)}<div class="it-body"><div class="it-t">${esc(n.t || 'Untitled')}</div>${meta.length ? `<div class="it-m">${meta.join('<span>·</span>')}</div>` : ''}</div>${o.compact ? '' : recBtn(n)}</div>`;
}
const whenLabel = n => n.r ? ruleText(n.r, n.d, false) + (n.s != null ? ' ' + fmtT(n.s) : '') : dayShort(n.d) + (n.s != null ? ' ' + fmtT(n.s) : '');
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
    ${n.p == null ? recBtn(n) : ''}<button class="plus${isP ? '' : ' leaf'}" data-act="add" data-id="${n.id}" aria-label="Add a step to ${esc(n.t)}" title="Add a step">+</button>
    <button class="when${n.d ? ' set' : ''}" data-act="${n.r ? 'open' : 'pick'}" data-id="${n.id}" aria-label="${n.r ? 'When ' + esc(n.t) + ' repeats' : 'Schedule ' + esc(n.t)}">${n.d ? whenLabel(n) : ICON.cal}</button></div>`;
  if (S.pick === n.id) h += pickerHTML(n, dep);
  const inner = (S.col[n.id] ? '' : kids.map(k => treeRows(k, dep + 1)).join('')) + addRow(n.id, dep + 1);
  return h + (isP ? `<div class="kids" data-drop="sib" data-g="p:${n.id}">${inner}</div>` : inner);
}
function projHTML(p) {
  const pr = progress(p.id), pct = pr.total ? Math.round(pr.done / pr.total * 100) : 0;
  let due = ''; if (p.due) { const left = daysBetween(today(), p.due); due = `<div class="due">Due ${fmtShort(p.due)} · ${left < 0 ? `${-left} days overdue` : left === 0 ? 'today' : `${left} days left`}</div>`; }
  return `<div class="proj" style="--pc:${colorOf(p)}">
    <div class="proj-h" data-drag data-id="${p.id}"><button class="caret${S.col[p.id] ? ' shut' : ''}" data-act="fold" data-id="${p.id}" aria-label="Show or hide ${esc(p.t)}"></button><span class="pdot"></span><span class="proj-t">${esc(p.t || 'Untitled')}</span><span class="proj-n">${pr.total ? pct + '%' : ''}</span><button class="plus" data-act="add" data-id="${p.id}" aria-label="Add a task to ${esc(p.t)}" title="Add a task">+</button></div>
    <div class="bar"><i style="width:${pct}%"></i></div>${due}
    ${S.col[p.id] ? addRow(p.id, 1) : `<div class="tree" data-drop="sib" data-g="p:${p.id}">${children(p.id).map(c => treeRows(c, 1)).join('')}${addRow(p.id, 1)}</div>`}</div>`;
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
/* Areas group the top-level projects, and tasks that belong to an area without being part of a project.
   Such a task becomes a project in that area as soon as it gets steps. A project whose area is gone shows under "No area";
   a task whose area is gone goes back to the Inbox. */
const areaOf = p => (p.ar && store.areas().some(a => a.id === p.ar) ? p.ar : '');
function areaGroups() {
  const roots = store.all().filter(n => n.p == null).sort((a, b) => a.o - b.o);
  const projs = roots.filter(n => isProj(n) || areaOf(n));
  const groups = store.areas().map(a => ({ a, projs: projs.filter(p => areaOf(p) === a.id) }));
  const none = projs.filter(p => !areaOf(p));
  if (none.length || !groups.length) groups.push({ a: null, projs: none });
  return { groups, loose: roots.filter(n => !isProj(n) && !areaOf(n)) };
}
function areaHTML({ a, projs }, board = false) {
  const id = a ? a.id : '', key = 'area:' + id, shut = !board && S.col[key], label = a ? esc(a.t || 'Untitled area') : 'No area';
  const name = a ? `<span class="pdot" style="--pc:${a.c || '#B9BCD0'}"></span><button class="area-t" data-act="open" data-id="${id}" title="Rename or delete this area">${label}</button>` : `<span class="area-t">${label}</span>`;
  const list = (projs.length ? projs.map(p => isProj(p) ? projHTML(p) : treeRows(p, 0)).join('') : '<div class="empty-note">No projects here yet.</div>') + (board ? `<button class="bcol-add" data-act="new-project" data-area="${id}">+ New project</button>` : '');
  return `<section class="area${board ? ' bcol' : ''}" data-drop="area" data-area="${id}">
    <div class="area-h">${board ? '' : `<button class="caret${shut ? ' shut' : ''}" data-act="fold" data-id="${key}" aria-label="Show or hide ${label}"></button>`}${name}<span class="area-n">${projs.length}</span><button class="plus" data-act="new-project" data-area="${id}" aria-label="New project in ${label}" title="New project">+</button></div>
    ${shut ? '' : board ? `<div class="bcol-b vscroll">${list}</div>` : list}</section>`;
}
function renderSide() {
  const el = document.getElementById('side');
  if (boardShown()) { el.innerHTML = ''; return; } // the board has it all, and the sidebar steps aside
  const { groups, loose } = areaGroups();
  const sc = el.querySelector('.side-b')?.scrollTop || 0;
  el.innerHTML = `<div class="side-h"><div class="brand">Daybook</div>${user ? '' : '<span class="tag">Sample</span>'}</div>
  <div class="side-rs" title="Drag to make the sidebar wider or narrower. Double-click to reset." aria-hidden="true"></div>
  <div class="side-b vscroll" data-drop="inbox">
    <div class="sec">Projects <span class="sec-acts"><button class="sec-add q-unpin" data-act="qproj" aria-label="Close projects" title="Close (P)">×</button><button class="sec-add desk-only" data-act="page" data-v="projects" title="See all projects on one big board">Full view</button><button class="sec-add" data-act="new-area">+ Area</button></span></div>
    ${groups.map(g => areaHTML(g)).join('')}
    <div class="sec">Inbox <small>loose tasks</small></div>
    <div class="tree" data-drop="sib" data-g="loose">${loose.map(n => treeRows(n, 0)).join('')}</div>
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
const evRow = e => `<div class="evr"><span>${e.allDay ? 'All day' : fmtT(e.s)}</span><b class="ev-t">${esc(e.t)}</b></div>`;
/* In the List view, tasks sit between the day's calendar events. Gap 0 is before
   the first event, gap i is after event i. A task with a time goes where its time
   falls; one without sits after the event that starts at its "a" minute.
   Inside a gap the order follows Time blocks: timed tasks by start time. A task with no time
   sits after them, unless it was dragged in among them: then its "a" is the minute of the
   timed task it follows, so it stays right below that task. */
const gapOf = (E, min) => min == null ? 0 : E.filter(e => e.s <= min).length;
const gapStart = (E, g) => g ? E[g - 1].s : null;
// Sort key within a gap: [minute, 0 for a timed task / 1 for one without a time]
const gapKey = (n, g0) => n.s != null ? [n.s, 0] : [n.a == null || n.a === g0 ? Infinity : n.a, 1];
function dayGaps(d) {
  const E = timedOn(d), gaps = E.map(() => []).concat([[]]);
  for (const n of dayItems(d)) gaps[gapOf(E, n.s ?? n.a)].push(n);
  gaps.forEach((g, i) => { const g0 = gapStart(E, i), ix = new Map(g.map((n, j) => [n, j])); g.sort((x, y) => { const a = gapKey(x, g0), b = gapKey(y, g0); return a[0] - b[0] || a[1] - b[1] || ix.get(x) - ix.get(y); }); });
  return { E, gaps };
}
function listHTML(d) {
  const { E, gaps } = dayGaps(d);
  const chips = g => g.map(n => chipHTML(n, { time: true, min: S.min })).join('');
  const all = eventsOn(d).filter(e => e.allDay).map(evRow).join('');
  const body = chips(gaps[0]) + E.map((e, i) => evRow(e) + chips(gaps[i + 1])).join('');
  const adder = S.new?.at === 'list' && S.new.d === d ? newHTML() : `<button class="ladd" data-act="new-day" data-d="${d}" aria-label="Add a task to ${esc(dayShort(d))}"><span aria-hidden="true">+</span>${body ? '' : ' Add a task'}</button>`;
  return `${all}<div class="list${body ? '' : ' empty'}" data-drop="list" data-date="${d}">${body}${adder}</div>`;
}
/* Adding a task right on the plan: the + at the end of a day's list, or a tap on an empty time (or the "Any time" row) in Time blocks.
   A small form opens in place with the title ready to type. It goes in the Inbox unless a project is picked. */
// Each area is a choice of its own (the task then belongs to the area, in no project), with its projects indented under it
function projOptions(sel) {
  const o = (v, t, dep) => `<option value="${v}"${sel === v ? ' selected' : ''}>${'\u2003'.repeat(dep)}${esc(t)}</option>`;
  const opt = (p, dep) => isDone(p) || !isProj(p) ? '' : o(p.id, p.t || 'Untitled', dep) + children(p.id).filter(c => hasKids(c.id)).map(c => opt(c, dep + 1)).join('');
  return o('', 'Inbox', 0) + areaGroups().groups.map(g => g.a ? o('area:' + g.a.id, g.a.t || 'Untitled area', 0) + g.projs.map(p => opt(p, 1)).join('')
    : (g.projs.length ? `<optgroup label="No area">${g.projs.map(p => opt(p, 0)).join('')}</optgroup>` : '')).join('');
}
// The colour of what's picked: a project's, an area's, or grey for the Inbox
const pickColor = v => v.startsWith('area:') ? store.get(v.slice(5))?.c || '#B9BCD0' : v && node(v) ? colorOf(node(v)) : '#B9BCD0';
function newHTML() {
  const N = S.new, pc = pickColor(N.p);
  const pos = N.at === 'col' ? `;top:${hpx((N.s - H0 * 60) / 60)};min-height:max(${hpx(N.m / 60)} - 2px, 62px)` : '';
  return `<form class="nt at-${N.at}" data-form="new" style="--pc:${pc}${pos}"><input id="new-in" placeholder="New task" autocomplete="off" enterkeyhint="done" aria-label="New task">
    <div class="nt-r">${N.s != null ? `<span class="nt-time">${fmtT(N.s)} – ${fmtT(N.s + N.m)}</span>` : ''}<label class="nt-p" title="Put it in an area or a project"><span class="pdot"></span><select id="new-p" aria-label="Project">${projOptions(N.p)}</select></label></div></form>`;
}
let newClosed = 0;
function openNew(o) {
  S.new = { p: '', ...o }; S.adding = null; render();
  const i = document.getElementById('new-in'); if (!i) return;
  i.focus({ preventScroll: true }); i.closest('form').scrollIntoView({ block: 'nearest' });
  setTimeout(() => { if (i.isConnected) i.closest('form').scrollIntoView({ block: 'nearest' }); }, 350); // again once a phone's keyboard is up
}
function closeNew() { if (!S.new) return; S.new = null; newClosed = Date.now(); render(); }
// Leaving the form keeps what was typed; an empty one just closes
function finishNew() { const v = document.getElementById('new-in')?.value.trim(); if (S.new && v) addNew(v); closeNew(); }
function addNew(t) {
  const N = S.new, f = { t, d: N.d, m: N.m || 60, p: N.p && node(N.p) ? N.p : null, ds: Date.now() / 1000 };
  if (N.p.startsWith('area:') && store.get(N.p.slice(5))) f.ar = N.p.slice(5);
  if (N.s != null) f.s = N.s;
  else { const E = timedOn(N.d); f.a = E.length ? E[E.length - 1].s : null; } // lands at the end of the day, where the + was
  store.create(f);
}
// A tap on an empty time in Time blocks starts a task on that half hour; a tap on the "Any time" row starts one with no time
function tapNew(e) {
  const t = e.target; if (!(t instanceof Element) || t.closest('form,.block,.ev,.item,.ev-all')) return;
  if (Date.now() - newClosed < 400) return; // this tap just closed the last one
  if (S.new) { finishNew(); return; }
  const col = t.closest('#mbody .col[data-date]');
  if (col) {
    const s = Math.max(H0 * 60, Math.min(H0 * 60 + Math.floor((e.clientY - col.getBoundingClientRect().top) / HP() * 2) * 30, H1 * 60 - 30));
    openNew({ at: 'col', d: col.dataset.date, s, m: Math.min(60, H1 * 60 - s) }); return;
  }
  const tray = t.closest('#mbody .tray[data-date]'); if (tray) openNew({ at: 'tray', d: tray.dataset.date });
}
/* Week view is an endless strip of days: it doesn't stop at Sunday. A faint line and a small label mark where each week starts. */
const isMon = d => pd(d).getDay() === 1;
const rangeLabel = (a, b) => `${MON[pd(a).getMonth()]} ${pd(a).getDate()} – ${pd(a).getMonth() === pd(b).getMonth() ? '' : MON[pd(b).getMonth()] + ' '}${pd(b).getDate()}`;
function weekLabel(d) {
  const w = daysBetween(weekStart(today()), d) / 7, range = rangeLabel(d, add(d, 6));
  const name = w === 0 ? 'This week' : w === 1 ? 'Next week' : w === -1 ? 'Last week' : '';
  return `<span class="wkl">${name ? `<b>${name}</b><span>${range}</span>` : `<b>${range}</b>`}</span>`;
}
// Left unchecked on a day before today: wears a thin red outline until it's checked off or moved to today or later.
// A repeat doesn't: the next one is already on its way.
const overdue = n => !!n.d && !n.rs && n.d < today() && !isDone(n);
const dayCls = d => `${d === today() ? ' today' : ''}${d < today() ? ' past' : ''}${isMon(d) ? ' mon' : ''}`;
function weekList(days) {
  return `<div class="wkx hscroll"><div class="wk" style="--n:${days.length}">${days.map(d => `<section class="wcol${dayCls(d)}" data-day="${d}">${isMon(d) ? weekLabel(d) : ''}
    <button class="dh" data-act="goday" data-d="${d}"><span>${DAYN[pd(d).getDay()]}</span><b>${pd(d).getDate()}</b></button>
    ${listHTML(d)}${S.min ? '' : loadHTML(d)}</section>`).join('')}</div></div>`;
}
function dayList(d) { return `<div class="dl">${listHTML(d)}${S.min ? '' : loadHTML(d)}</div>`; }
addEventListener('popstate', () => { if (qSkip) qSkip = false; else if (qVisit) { qVisit = false; if (S.tab !== 'plan') { S.tab = 'plan'; W = null; render(); } } });
/* Quiet: the whole app rests in a bare look (titles only, events as thin lines, no bars) and the rest waits past the edges.
   Tap the day's name for the controls. Projects come in from the left edge (from the bottom on a phone), Ask Claude from the right. */
const quiet = () => !!S.min;
// On a phone the full Projects screen opens inside Quiet, with the same faint name on top; Back (or the grid button) returns to the plan
const quietLook = quiet;
let qVisit = false, qSkip = false;
function quietProjects(tab = 'projects') { setStrip(false); S.tab = tab; S.drOpen = false; document.body.classList.remove('dr-on'); if (!qVisit) { qVisit = true; history.pushState({ qVisit: 1 }, ''); } render(); }
function quietPlan() { if (S.tab === 'plan') return; setStrip(false); S.tab = 'plan'; W = null; if (qVisit) { qVisit = false; qSkip = true; history.back(); } }
const qProjects = () => quiet() && phone() && S.tab === 'projects';
// The roadmap button (or R) goes to the Roadmap and back to the plan
function toggleRoad() {
  setStrip(false);
  if (phone()) { if (S.tab === 'roadmap') { if (quiet()) quietPlan(); else S.tab = 'plan'; } else if (quiet()) { quietProjects('roadmap'); return; } else { S.tab = 'roadmap'; S.drOpen = false; document.body.classList.remove('dr-on'); } }
  else S.page = S.page === 'roadmap' ? 'plan' : 'roadmap';
  render();
}
function leaveRoad() { if (!phone() && S.page === 'roadmap') S.page = 'plan'; quietPlan(); }
let qSide = false, qPin = false, qT = 0;
function setStrip(on) { S.qstrip = on; document.body.classList.toggle('q-strip', quiet() && on); document.querySelector('.qh')?.setAttribute('aria-expanded', on); }
function setQSide(on) { qSide = on && quiet() && !phone(); if (!qSide) qPin = false; document.body.classList.toggle('q-side', qSide); document.body.classList.toggle('q-pin', qPin); if (!phone()) document.querySelector('.mh [data-act="qproj"]')?.setAttribute('aria-pressed', qPin); if (qSide) setStrip(false); }
// The projects button pins the panel at the side to work in it (reorder, add, rename); the plan moves over to make room
function setQPin(on) { qPin = on && quiet() && !phone(); setQSide(qPin); }
function quietAway() { setStrip(false); setQSide(false); document.body.classList.add('ai-off'); if (S.drOpen) { setDrawer(false); renderTabs(); } }
function setQuiet(on) {
  S.min = on; S.qstrip = false; setQSide(false);
  if (on) { document.body.classList.add('ai-off'); S.page = 'plan'; S.tab = 'plan'; }
  else if (matchMedia('(min-width:1500px)').matches) document.body.classList.remove('ai-off');
  render();
}
// Keys while quiet (Q turns it on and off anywhere): arrows change day or week, D and W pick the range, T switches List and Time blocks, P brings projects, / asks Claude
function quietKey(e) {
  const k = e.key.toLowerCase(), click = a => document.querySelector(`#main [data-act="${a}"]`)?.click();
  if (k === 'arrowleft') click('prev'); else if (k === 'arrowright') click('next');
  else if (k === 'd' || k === 'w') { const v = k === 'd' ? 'day' : 'week'; const away = roadShown(); leaveRoad(); if (S.view !== v || away) { S.view = v; W = null; render(); } }
  else if (k === 't') { if (roadShown()) { leaveRoad(); render(); } else setMode(S.mode === 'list' ? 'timed' : 'list'); }
  else if (k === 'p') setQPin(!qPin);
  else if (k === '/') { openAI(); setTimeout(() => document.getElementById('askq')?.focus(), 50); }
  else return false;
  return true;
}
// While the controls are open, a tap outside them only closes them, so it can't also start a new task or open a block underneath
let stripEat = false, stripEatT = 0;
window.addEventListener('pointerdown', e => {
  if (!quiet() || !S.qstrip || !(e.target instanceof Element) || e.target.closest('.mh, .qh')) return;
  setStrip(false); stripEat = true; clearTimeout(stripEatT); stripEatT = setTimeout(() => { stripEat = false; }, 800);
  e.stopImmediatePropagation();
}, true);
for (const t of ['touchstart', 'mousedown']) window.addEventListener(t, e => { if (stripEat) e.stopImmediatePropagation(); }, true);
window.addEventListener('click', e => { if (stripEat) { stripEat = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
// A tap anywhere else tucks the controls and projects away again
document.addEventListener('click', e => {
  if (!quiet() || !(e.target instanceof Element) || !e.target.isConnected) return;
  if (S.qstrip && !e.target.closest('.mh, .qh')) setStrip(false);
  if (qSide && !qPin && !e.target.closest('.side, .qedge, [data-act="qproj"], #detail')) setQSide(false);
});
// On a computer, resting the mouse at the left or right edge slides projects or Ask Claude in; leaving the projects lets them slide back
for (const side of ['l', 'r']) {
  const z = document.createElement('div'); z.className = 'qedge ' + side; z.setAttribute('aria-hidden', 'true'); document.body.appendChild(z);
  z.addEventListener('mouseenter', () => { clearTimeout(qT); qT = setTimeout(() => { if (!quiet()) return; if (side === 'l') setQSide(true); else { openAI(); aiPeek = true; } }, 140); });
  z.addEventListener('mouseleave', () => clearTimeout(qT));
}
// Ask Claude slid in from the edge is only peeking: it slides back when the mouse leaves, until you click or type in it
let aiPeek = false;
const aiEl = document.getElementById('ai');
aiEl.addEventListener('pointerdown', () => { aiPeek = false; });
aiEl.addEventListener('focusin', () => { aiPeek = false; });
aiEl.addEventListener('mouseleave', () => { if (!aiPeek) return; clearTimeout(qT); qT = setTimeout(() => { if (aiPeek && quiet() && !aiEl.matches(':hover')) { aiPeek = false; document.body.classList.add('ai-off'); } }, 450); });
document.getElementById('side').addEventListener('mouseleave', e => { if (!qSide || qPin || D || e.relatedTarget?.closest?.('#detail')) return; clearTimeout(qT); qT = setTimeout(() => { if (!D && !document.getElementById('side').matches(':hover')) setQSide(false); }, 450); });
document.getElementById('side').addEventListener('mouseenter', () => clearTimeout(qT));
// On a phone: swipe up from the bottom edge for projects and pinch to go between the day and the week.
// Ask Claude sits in the strip (tap the day name), since phones keep the side edges for their own Back gesture.
let QG = null;
document.addEventListener('touchstart', e => {
  QG = null; if (!quiet() || !phone() || S.tab !== 'plan' || D) return;
  if (e.touches.length === 2 && S.mode === 'list') { QG = { pinch: true, d: span(e.touches) }; return; }
  if (e.touches.length !== 1 || S.drOpen || e.target.closest?.('.drawer, .ai, .mh, form')) return;
  const t = e.touches[0];
  if (t.clientY > innerHeight - 40) QG = { up: true, y: t.clientY };
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!QG || D) return; const t = e.touches;
  if (QG.pinch) {
    if (t.length !== 2) { QG = null; return; } if (e.cancelable) e.preventDefault();
    const r = span(t) / Math.max(QG.d, 1), to = r < .72 ? 'week' : r > 1.38 ? 'day' : null;
    // Once switched, keep holding the rest of the pinch so the page itself never zooms
    if (to && !QG.done) { QG.done = true; if (S.view !== to) { S.view = to; W = null; render(); } }
    return;
  }
  if (QG.up && QG.y - t[0].clientY > 36) { QG = null; setDrawer(true); renderTabs(); }
}, { passive: false });
document.addEventListener('touchend', e => { if (QG && (!QG.pinch || !e.touches.length)) QG = null; });
function layout(items) {
  items.sort((a, b) => a.s - b.s || b.m - a.m); const cl = []; let cur = [], end = -1;
  for (const it of items) { if (cur.length && it.s >= end) { cl.push(cur); cur = []; end = -1; } cur.push(it); end = Math.max(end, it.s + it.m); }
  if (cur.length) cl.push(cur);
  for (const c of cl) { const lanes = []; for (const it of c) { let i = lanes.findIndex(e => e <= it.s); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = it.s + it.m; it.lane = i; } c.forEach(it => it.lanes = lanes.length); }
  return items;
}
/* Recorded time shows where it happened: a stretch on the day it started, and the one recording now growing with the clock.
   A finished task's block already sits on its last stretch, so that one isn't drawn twice; guesses only place the block. */
function sessionsOn(d) {
  const out = [], now = track.local(Date.now());
  for (const n of store.logged()) for (const e of n.tl) {
    if (e.guess) continue;
    const a = track.local(e.start); if (a.d !== d) continue;
    const b = e.end ? track.local(e.end) : now, end = b.d === d ? b.m : 1440;
    if (e.end && n.d === d && n.s === a.m) continue;
    out.push({ sess: n, e, s: a.m, m: Math.max(1, end - a.m) });
  }
  return out;
}
function blocksHTML(d) {
  const items = [...timedOn(d).map(e => ({ ev: e, s: e.s, m: e.m })), ...dayItems(d).filter(n => n.s != null).map(n => ({ n, s: n.s, m: n.m || 60 })), ...sessionsOn(d)];
  layout(items);
  // A short block may grow to a readable 18px, but only into free space: never past the start of the next block beneath it
  const x0 = it => it.lane / it.lanes, x1 = it => (it.lane + 1) / it.lanes;
  return items.map(it => {
    const s = Math.max(it.s, H0 * 60), e = Math.min(it.s + it.m, H1 * 60); if (e <= s) return '';
    const below = items.filter(o => o.s >= e && x0(o) < x1(it) && x1(o) > x0(it)).reduce((m, o) => Math.min(m, o.s), H1 * 60);
    const pos = `top:${hpx((s - H0 * 60) / 60)};height:max(${hpx((e - s) / 60)} - 2px, min(18px, ${hpx((below - s) / 60)} - 2px));left:${it.lane / it.lanes * 100}%;width:calc(${100 / it.lanes}% - 4px)`;
    const tm = `${fmtT(it.s)} – ${fmtT(it.s + it.m)}`;
    if (it.ev) return `<div class="ev" style="${pos}" title="${esc(it.ev.cal || '')}"><div class="b-in"><div class="b-t">${esc(it.ev.t)}</div><div class="b-time">${tm}</div></div></div>`;
    if (it.sess) { const n = it.sess, live = !it.e.end; return `<div class="block sess${live ? ' live' : ''}${isDone(n) ? ' done' : ''}" data-act="open" data-id="${n.id}" style="${pos};--pc:${colorOf(n)}" title="${live ? 'Recording now' : isDone(n) ? 'Time you worked on this, now done' : 'Time you worked on this'}"><div class="b-in"><div class="b-t">${esc(n.t || 'Untitled')}</div><div class="b-time">${ICON.recS}${fmtT(it.s)} – ${live ? 'now' : fmtT(it.s + it.m)} · ${fmtDur(Math.max(1, track.mins(it.e)))}</div></div></div>`; }
    const n = it.n, pr = hasKids(n.id) && progress(n.id); // a whole project in a block is a work session: show how far along it is
    return `<div class="block${isDone(n) ? ' done' : ''}${overdue(n) ? ' overdue' : ''}${track.isRec(n) ? ' planned' : ''}" data-drag data-id="${n.id}" style="${pos};--pc:${colorOf(n)}">${ckHTML(n)}<div class="b-in"><div class="b-t">${esc(n.t || 'Untitled')}</div><div class="b-time">${n.rs ? ICON.repS : ''}${tm}${pr ? ` · ${pr.done}/${pr.total}` : ''}</div></div>${recBtn(n)}<div class="rs"></div></div>`;
  }).join('');
}
function nowHTML(d) { if (d !== today()) return ''; const m = nowMin(); if (m < H0 * 60 || m > H1 * 60) return ''; return `<div class="now" style="top:${hpx((m - H0 * 60) / 60)}"></div>`; }
function timed(days) {
  const hrs = []; for (let h = H0 + 1; h < H1; h++) hrs.push(h);
  return `<div class="tw hscroll vscroll"><div class="tg${days.length === 1 ? ' one' : ''}" style="--cols:${days.length};--hours:${H1 - H0}">
    <div class="trow thead"><div class="gut"></div>${days.map(d => `<button class="th${dayCls(d)}" data-act="goday" data-d="${d}" data-day="${d}">${days.length > 1 && isMon(d) ? weekLabel(d) : ''}${DAYN[pd(d).getDay()]} <b>${pd(d).getDate()}</b></button>`).join('')}</div>
    <div class="trow ttray"><div class="gut">Any<br>time</div>${days.map(d => `<div class="tray${isMon(d) ? ' mon' : ''}" data-drop="tray" data-date="${d}">${eventsOn(d).filter(e => e.allDay).map(e => `<div class="ev-all">${esc(e.t)}</div>`).join('')}${dayItems(d).filter(n => n.s == null).map(n => chipHTML(n, { compact: days.length > 1 })).join('')}${S.new?.at === 'tray' && S.new.d === d ? newHTML() : ''}</div>`).join('')}</div>
    <div class="trow tbody"><div class="gut hrs">${hrs.map(h => `<div class="hl" style="top:${hpx(h - H0)}">${h % 12 || 12}${h < 12 ? 'am' : 'pm'}</div>`).join('')}</div>
    ${days.map(d => `<div class="col${d === today() ? ' today' : ''}${isMon(d) ? ' mon' : ''}" data-drop="col" data-date="${d}">${blocksHTML(d)}${nowHTML(d)}${S.new?.at === 'col' && S.new.d === d ? newHTML() : ''}</div>`).join('')}</div>
  </div></div>`;
}
/* Phone: the projects drawer. It pulls up out of the tab bar over the plan; hold anything in it and drag it onto the day.
   A whole project dropped on a time becomes a work session for its steps. */
function drRow(n) {
  const kids = hasKids(n.id), when = n.d ? `<span class="dr-when">${whenLabel(n)}</span>` : '';
  if (!kids) return `<div class="dr-row" data-drag data-id="${n.id}" data-act="open" style="--pc:${colorOf(n)}"><span class="dr-ck"></span><div class="dr-txt"><b>${esc(n.t || 'Untitled')}</b>${n.m ? `<small>${fmtDur(n.m)}</small>` : ''}</div>${when}</div>`;
  const open = leaves(n.id).filter(l => !l.done).length, p = progress(n.id);
  return `<div class="dr-row" data-drag data-id="${n.id}" data-act="dr-in" style="--pc:${colorOf(n)}"><span class="ring" style="--p:${p.total ? p.done / p.total : 0}"></span><div class="dr-txt"><b>${esc(n.t || 'Untitled')}</b><small>${open ? `${open} open step${open > 1 ? 's' : ''}` : 'All done'}</small></div>${when}<span class="chev" aria-hidden="true">›</span></div>`;
}
function drawerHTML() {
  if (!phone()) return '';
  const at = S.drAt && node(S.drAt); if (!at) S.drAt = null;
  let top, body;
  if (at) {
    const kids = children(at.id), open = kids.filter(k => !isDone(k)), done = kids.length - open.length, p = progress(at.id);
    top = `<button class="dr-up" data-act="dr-in" data-id="${at.p || ''}" aria-label="Back">${ICON.prev}</button><div class="dr-title">${esc(at.t || 'Untitled')}</div>`;
    body = `<div class="dr-row dr-sess" data-drag data-id="${at.id}" data-act="open" style="--pc:${colorOf(at)}"><span class="ring" style="--p:${p.total ? p.done / p.total : 0}"></span><div class="dr-txt"><b>Whole ${at.p ? 'part' : 'project'}</b><small>Drag onto your day as a work session</small></div>${at.d ? `<span class="dr-when">${whenLabel(at)}</span>` : ''}</div>
      <div class="dr-sub">Steps</div><div class="dr-grp" data-drop="sib" data-g="p:${at.id}">${open.map(drRow).join('') || `<div class="dr-empty">${kids.length ? 'Every step is done.' : 'No steps yet. Add them in Projects.'}</div>`}</div>
      ${done ? `<div class="dr-empty">${done} done</div>` : ''}`;
  } else {
    const { groups, loose } = areaGroups(), todo = loose.filter(n => !n.done);
    top = `<div class="dr-title">Projects</div><span class="dr-hint">Hold and drag onto your day</span>`;
    body = groups.filter(g => g.projs.length).map(g => `<div class="dr-grp" data-drop="area" data-area="${g.a?.id || ''}"><div class="dr-area"><span class="pdot" style="--pc:${g.a?.c || '#B9BCD0'}"></span>${g.a ? esc(g.a.t || 'Untitled area') : 'No area'}</div>${g.projs.filter(p => isProj(p) || !p.done).map(drRow).join('')}</div>`).join('')
      + (todo.length ? `<div class="dr-grp" data-drop="sib" data-g="loose"><div class="dr-area"><span class="pdot" style="--pc:var(--muted)"></span>Inbox</div>${todo.map(drRow).join('')}</div>` : '')
      || '<div class="dr-empty">No projects yet. Add them in Projects.</div>';
  }
  return `<div class="dr-back${S.drOpen ? ' on' : ''}" data-act="dr-close"></div>
  <section class="drawer${S.drOpen ? ' on' : ''}" id="drawer" aria-label="Projects to schedule"${S.drOpen ? '' : ' inert'}>
    <div class="dr-h" id="dr-h"><span class="dr-grab"></span><div class="dr-top">${top}</div></div>
    <div class="dr-b" id="dr-b" data-k="${S.drAt || ''}">${body}</div></section>`;
}
function setDrawer(open) {
  S.drOpen = open; document.body.classList.toggle('dr-on', open);
  const d = document.getElementById('drawer'); if (!d) return;
  d.classList.toggle('on', open); d.inert = !open; d.previousElementSibling.classList.toggle('on', open);
}
const pageSeg = () => `<div class="seg page-seg" role="group" aria-label="Page"><button data-act="page" data-v="plan" aria-pressed="${!boardShown() && !roadShown()}">Plan</button><button data-act="page" data-v="projects" aria-pressed="${boardShown()}">Projects</button><button data-act="page" data-v="roadmap" aria-pressed="${roadShown()}">Roadmap</button></div>`;
function renderBoard(el) {
  const old = document.getElementById('board'); const hs = old?.scrollLeft || 0, vs = old ? [...old.querySelectorAll('.bcol-b')].map(c => c.scrollTop) : [];
  const { groups, loose } = areaGroups();
  el.innerHTML = `<header class="mh"><div class="mh-l">${pageSeg()}<h1>Projects</h1></div>
    <div class="mh-r"><button class="tb" data-act="new-area">+ New area</button><button class="ask-btn" data-act="ai-toggle">✦ Ask Claude</button></div></header>
  <div class="board hscroll" id="board">${groups.map(g => areaHTML(g, true)).join('')}
    <section class="area bcol inbox" data-drop="inbox"><div class="area-h"><span class="area-t">Inbox</span><small>loose tasks</small></div>
      <div class="bcol-b vscroll"><div class="tree" data-drop="sib" data-g="loose">${loose.map(n => treeRows(n, 0)).join('')}</div>
      <form class="qa" data-form="inbox"><input id="qa-in" placeholder="+ Add a task" autocomplete="off" aria-label="Add a task to the inbox" enterkeyhint="done"></form></div></section></div>`;
  const b = document.getElementById('board'); b.scrollLeft = hs; b.querySelectorAll('.bcol-b').forEach((c, i) => c.scrollTop = vs[i] || 0);
}
/* The Roadmap page (js/roadmap.js draws the timeline) */
const roadBtn = () => `<button class="ib q-only" data-act="road" aria-pressed="${roadShown()}" aria-label="Roadmap" title="Roadmap (R)">${ICON.road}</button>`;
function renderRoad(el) {
  const first = !document.getElementById('rmsc');
  if (first && client && user) client.auth.getUser().then(({ data }) => { const v = +data?.user?.user_metadata?.free_hours; if (v > 0 && v !== +S.free) { S.free = v; saveUI(); later(); } }).catch(() => {}); // set on another device, or by Claude
  const z = S.rmZoom in { 1: 1, 3: 1, 6: 1 } ? +S.rmZoom : 3, free = +S.free > 0 ? +S.free : 10;
  const head = `${quiet() ? `<button class="qh" data-act="qstrip" aria-expanded="${!!S.qstrip}" aria-label="Show the controls"><span id="qtitle">Roadmap</span></button>` : ''}<header class="mh rm-mh">
    <div class="mh-l">${pageSeg()}<h1 id="mtitle">Roadmap</h1><div class="nav"><button class="ib" data-act="prev" aria-label="Earlier">${ICON.prev}</button><button class="tb" data-act="today">Today</button><button class="ib" data-act="next" aria-label="Later">${ICON.next}</button></div>${urBtns()}</div>
    <div class="mh-r"><div class="seg rm-zoom" role="group" aria-label="Zoom">${[1, 3, 6].map(m => `<button data-act="rm-zoom" data-v="${m}" aria-pressed="${z === m}">${m} mo</button>`).join('')}</div>
    <label class="chip rm-free" title="How many hours a week you have for planned tasks. Weeks with more scheduled than this stand out."><input id="rm-free" type="number" inputmode="numeric" min="1" max="168" step="1" value="${free}" aria-label="Free hours per week"><span class="k">h free a week</span></label>
    <div class="mh-i"><button class="ib min-btn" data-act="min" aria-pressed="${!!S.min}" aria-label="Quiet" title="Quiet (Q): titles only, and everything else tucked away until you reach for it">${ICON.min}</button>
    <button class="ib q-only" data-act="qproj" aria-pressed="${qProjects() || qPin}" aria-label="Projects" title="Projects (P)">${ICON.board}</button>${roadBtn()}</div>
    <button class="ask-btn" data-act="ai-toggle">✦ Ask Claude</button></div></header>`;
  const box = document.getElementById('rmsc'); const width = (box ? box.clientWidth : el.clientWidth) || innerWidth;
  el.innerHTML = head + `<div class="mbody rm" id="mbody" data-k="roadmap">${roadmap.html(width)}</div>`;
  roadmap.mounted(first);
}
// Free hours per week follow the person to every device (kept with their account); before sign-in, on this device
function setFree(v) {
  v = Math.round(+v); if (!(v > 0 && v <= 168) || v === +S.free) return;
  S.free = v; saveUI(); if (client && user) client.auth.updateUser({ data: { free_hours: v } }).catch(() => {});
  later();
}
roadmap.init({ S, saveUI, render: () => render(), toast: (...a) => toast(...a) });
addEventListener('resize', () => { if (roadShown()) later(); });
// Time blocks scrolls both ways in one box, so one finger can go sideways and up/down in the same swipe, and the day names stay pinned on top
const vScroller = mb => (mb?.classList.contains('timed') && mb.querySelector('.tw')) || mb;
function renderMain() {
  const el = document.getElementById('main');
  document.body.classList.toggle('quiet', quietLook()); document.body.classList.toggle('q-strip', quiet() && !!S.qstrip);
  if (boardShown()) return renderBoard(el);
  if (roadShown()) return renderRoad(el);
  const strip = S.view === 'week';
  const prev = document.getElementById('mbody'); const key = S.view + S.mode + (strip ? '' : S.anchor);
  const same = prev && prev.dataset.k === key; const sc = same ? vScroller(prev).scrollTop : null;
  const keep = strip && same ? stripPos() : null;
  if (strip && !W) { const ws = weekStart(S.anchor); W = { from: add(ws, -7), to: add(ws, 7 * 5 - 1), jump: phone() ? S.anchor : ws }; }
  const days = strip ? [...Array(daysBetween(W.from, W.to) + 1)].map((_, i) => add(W.from, i)) : [S.anchor];
  calendar.ensure(days[0], days[days.length - 1]);
  const a = pd(S.anchor);
  const qp = qProjects();
  const title = qp ? 'Projects' : strip ? rangeLabel(S.anchor, add(S.anchor, 6)) : `${S.anchor === today() ? 'Today' : DAYL[a.getDay()]}, ${MON[a.getMonth()]} ${a.getDate()}`;
  const P = (k, v) => `aria-pressed="${S[k] === v}"`;
  const prevDr = document.getElementById('dr-b'); const drSc = prevDr && prevDr.dataset.k === (S.drAt || '') ? prevDr.scrollTop : 0;
  const warn = store.sync.state === 'offline' || store.sync.state === 'error' ? `<div class="tip warn"><span>${SYNC_TEXT[store.sync.state]}</span></div>` : '';
  el.innerHTML = `${quiet() ? `<button class="qh" data-act="qstrip" aria-expanded="${!!S.qstrip}" aria-label="Show the controls"><span id="qtitle">${title}</span></button>` : ''}<header class="mh">
    <div class="mh-l">${pageSeg()}<h1 id="mtitle">${title}</h1><div class="nav"><button class="ib" data-act="prev" aria-label="Previous">${ICON.prev}</button><button class="tb" data-act="today">Today</button><button class="ib" data-act="next" aria-label="Next">${ICON.next}</button></div>${urBtns()}</div>
    <div class="mh-r"><div class="seg" role="group" aria-label="Range"><button data-act="view" data-v="day" ${P('view', 'day')}>Day</button><button data-act="view" data-v="week" ${P('view', 'week')}>Week</button></div>
    <div class="seg" role="group" aria-label="Layout"><button data-act="mode" data-v="list" ${P('mode', 'list')}>List</button><button data-act="mode" data-v="timed" ${P('mode', 'timed')}>Time blocks</button></div>
    <div class="mh-i"><button class="ib min-btn" data-act="min" aria-pressed="${!!S.min}" aria-label="Quiet" title="Quiet (Q): titles only, and everything else tucked away until you reach for it">${ICON.min}</button>
    <button class="ib q-only" data-act="qproj" aria-pressed="${qp || qPin}" aria-label="Projects" title="Projects (P)">${ICON.board}</button>${roadBtn()}</div>
    <button class="ask-btn" data-act="ai-toggle">✦ Ask Claude</button></div></header>
  <div class="mbody${S.mode === 'timed' ? ' timed' : ' vscroll'}${strip ? '' : ' day'}${S.min && S.mode === 'list' ? ' min' : ''}" id="mbody" data-k="${key}">${warn}
    ${S.tip ? `<div class="tip"><span>Tap a task to open it and add notes. Tap an empty time, or the + under a day, to add one. Drag to move it. On a phone, press and hold, then drag. Swipe up from the tab bar to pick from your projects.</span><button data-act="tip" aria-label="Dismiss tip">×</button></div>` : ''}
    ${S.mode === 'list' ? (S.view === 'week' ? weekList(days) : dayList(days[0])) : timed(days)}
  </div>${drawerHTML()}${quiet() ? `<button class="qgrab" data-act="drawer" aria-label="Show projects to schedule"></button>` : ''}`;
  const dr = document.getElementById('dr-b'); if (dr) dr.scrollTop = drSc;
  const mb = document.getElementById('mbody');
  fitObs.disconnect(); mb.querySelectorAll('.block,.ev').forEach(b => fitObs.observe(b));
  if (sc != null) vScroller(mb).scrollTop = sc;
  else if (S.mode === 'timed') {
    const target = Math.max(H0, (days.includes(today()) ? Math.floor(nowMin() / 60) - 1 : 8)); vScroller(mb).scrollTop = Math.max(0, (Math.min(target, 17) - H0) * HP());
  }
  if (strip) {
    if (keep) placeDay(keep.d, keep.off);
    if (W.jump && placeDay(W.jump, 0)) W.jump = null;
    const s = stripScroller(); if (s) s.el.addEventListener('scroll', onStrip, { passive: true });
    stripTitle();
  }
}
// A title too long for its block ends on the last line that fits, with an ellipsis, instead of being sliced through.
// Rechecked whenever a block changes size, so it follows pinch-zoom and resizing.
const fitObs = new ResizeObserver(es => {
  for (const { target: b } of es) {
    const t = b.querySelector('.b-t'), box = b.querySelector('.b-in'); if (!t || !box) continue;
    t.classList.remove('clamp');
    const cs = getComputedStyle(t); if (cs.whiteSpace === 'nowrap') continue; // short blocks already use one line
    const avail = box.clientHeight - parseFloat(getComputedStyle(box).paddingTop) * 2, lh = parseFloat(cs.lineHeight);
    if (t.offsetHeight > avail + 1) { t.style.setProperty('--l', Math.max(1, Math.floor(avail / lh))); t.classList.add('clamp'); }
  }
});
/* The strip of days in Week view. W is the range of days drawn; scrolling near either end draws more,
   and re-drawing keeps the same day under the same spot on screen. */
let W = null, stripRaf = 0;
function stripScroller() {
  const mb = document.getElementById('mbody'); if (!mb) return null;
  if (S.mode === 'timed') { const tw = mb.querySelector('.tw'); return tw && { el: tw, x: true, edge: 36 }; }
  const wx = mb.querySelector('.wkx'); if (wx && wx.scrollWidth > wx.clientWidth + 1) return { el: wx, x: true, edge: 0 };
  return { el: mb, x: false, edge: 0 };
}
const dayEls = () => [...document.querySelectorAll('#mbody [data-day]')];
function edgeOf(s) { const r = s.el.getBoundingClientRect(); return s.x ? r.left + s.edge : r.top; }
function stripPos() { // the first day in view and how far it sits past the edge
  const s = stripScroller(); if (!s) return null; const e = edgeOf(s);
  for (const el of dayEls()) { const r = el.getBoundingClientRect(); if ((s.x ? r.right : r.bottom) > e + 1) return { d: el.dataset.day, off: (s.x ? r.left : r.top) - e }; }
  return null;
}
function placeDay(d, off) {
  const s = stripScroller(), el = document.querySelector(`#mbody [data-day="${d}"]`); if (!s || !el) return false;
  const r = el.getBoundingClientRect(); if (!r.width) return false;
  const delta = (s.x ? r.left : r.top) - edgeOf(s) - off;
  if (s.x) s.el.scrollLeft += delta; else s.el.scrollTop += delta;
  return true;
}
function visibleDays() {
  const s = stripScroller(); if (!s) return [];
  const r = s.el.getBoundingClientRect(), a = s.x ? r.left + s.edge : r.top, b = s.x ? r.right : r.bottom;
  return dayEls().filter(el => { const q = el.getBoundingClientRect(), lo = s.x ? q.left : q.top, hi = s.x ? q.right : q.bottom; return Math.min(hi, b) - Math.max(lo, a) > (hi - lo) / 2; }).map(el => el.dataset.day);
}
function stripTitle() {
  const v = visibleDays(); if (!v.length) return;
  S.anchor = v.includes(today()) ? today() : v[0]; // Day view, "Plan my week" and switching layouts start from here
  const t = document.getElementById('mtitle'), q = document.getElementById('qtitle'); if (t) t.textContent = v.length > 1 ? rangeLabel(v[0], v[v.length - 1]) : `${DAYN[pd(v[0]).getDay()]}, ${MON[pd(v[0]).getMonth()]} ${pd(v[0]).getDate()}`;
  if (t && q) q.textContent = t.textContent;
}
function onStrip() {
  if (stripRaf) return;
  stripRaf = requestAnimationFrame(() => {
    stripRaf = 0; if (S.view !== 'week' || !W) return;
    stripTitle(); if (D) return; // don't redraw under a drag
    const s = stripScroller(); if (!s) return; const el = s.el;
    const pos = s.x ? el.scrollLeft : el.scrollTop, size = s.x ? el.clientWidth : el.clientHeight, full = s.x ? el.scrollWidth : el.scrollHeight;
    const MAX = 126; // days kept drawn; the far end is let go as more are added
    if (full - pos - size < size) { W.to = add(W.to, 28); if (daysBetween(W.from, W.to) > MAX) W.from = add(W.from, 28); renderMain(); }
    else if (pos < size / 2) { W.from = add(W.from, -14); if (daysBetween(W.from, W.to) > MAX) W.to = add(W.to, -14); renderMain(); }
  });
}
/* Prev / Next / Today in Week view move along the strip instead of swapping weeks */
function stripGo(d, smooth) {
  if (d < W.from || d > W.to) { W = null; S.anchor = d; renderMain(); return; }
  const s = stripScroller(), el = document.querySelector(`#mbody [data-day="${d}"]`); if (!s || !el) return;
  const delta = (s.x ? el.getBoundingClientRect().left : el.getBoundingClientRect().top) - edgeOf(s);
  s.el.scrollBy({ [s.x ? 'left' : 'top']: delta, behavior: smooth ? 'smooth' : 'auto' });
}
function renderTabs() {
  const t = [['plan', 'Plan', ICON.plan], ['projects', 'Projects', ICON.proj], ['roadmap', 'Roadmap', ICON.road], ['ask', 'Ask Claude', ICON.ask]];
  const nav = document.getElementById('tabs'); nav.dataset.drop = 'inbox';
  nav.innerHTML = t.map(([k, l, i]) => `<button data-act="tab" data-v="${k}" aria-current="${S.tab === k}">${i}<span>${l}</span></button>`).join('')
    + (S.tab === 'plan' ? `<button class="tab-grab" data-act="drawer" aria-label="${S.drOpen ? 'Hide' : 'Show'} projects to schedule" aria-expanded="${S.drOpen}"></button>` : '');
  document.body.dataset.tab = S.tab; document.body.dataset.page = boardShown() ? 'projects' : roadShown() ? 'roadmap' : 'plan';
}

/* Zoomed-in view of one item */
function stepHTML(k) {
  const kk = hasKids(k.id), p = progress(k.id);
  return `<div class="step${isDone(k) ? ' done' : ''}" data-drag data-id="${k.id}" style="--pc:${colorOf(k)}">${ckHTML(k)}<button class="step-t" data-act="open" data-id="${k.id}" data-dragok>${esc(k.t || 'Untitled')}${k.notes ? ICON.note : ''}${k.link ? ICON.linkS : ''}</button>${kk ? `<span class="step-n">${p.done}/${p.total}</span>` : ''}${k.d ? `<span class="when set">${whenLabel(k)}</span>` : ''}<span class="chev" aria-hidden="true">›</span></div>`;
}
const grow = t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
function renderDetail() {
  const el = document.getElementById('detail'); let n = S.open && node(S.open);
  if (!n && S.open) { const o = splitOcc(S.open); if (o && node(o[0])) { S.open = o[0]; n = node(o[0]); } } // a repeat that's gone (its rule changed): show its series
  if (!n) { S.open = null; el.hidden = true; el.innerHTML = ''; return; }
  const ae = document.activeElement;
  if (!el.hidden && el.contains(ae) && ae.matches('textarea,input') && el.querySelector('.dt-body')?.dataset.id === n.id && ae.id !== 'dt-add-in') return; // don't interrupt typing
  const body = el.querySelector('.dt-body'); const same = !el.hidden && body?.dataset.id === n.id; const prevSc = same ? body.scrollTop : 0;
  el.hidden = false;
  if (n.k === 'area') { areaDetail(el, n, same); el.querySelectorAll('textarea').forEach(grow); el.querySelector('.dt-body').scrollTop = prevSc; return; }
  const anc = ancestors(n), kids = children(n.id), pr = progress(n.id), pct = pr.total ? Math.round(pr.done / pr.total * 100) : 0;
  const up = anc[anc.length - 1]; const durs = [5, 10, 15, 20, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480];
  if (!durs.includes(n.m || 60)) durs.push(n.m || 60);
  const count = leaves(n.id).length - (kids.length ? 0 : 1);
  const ser = store.seriesOf(n)?.r ? store.seriesOf(n) : null, rp = !!ser || !!n.rs; // a repeating task, or one of its repeats
  el.innerHTML = `<div class="dt-back" data-act="close"></div>
  <section class="dt${same ? ' still' : ''}" role="dialog" aria-modal="true" aria-label="${esc(n.t)}" style="--pc:${colorOf(n)}">
    <div class="dt-top"><button class="dt-up" data-act="${up ? 'open' : 'close'}" data-id="${up ? up.id : ''}">${ICON.prev}<span>${up ? esc(up.t) : 'Back'}</span></button><button class="ib" data-act="close" aria-label="Close">${ICON.close}</button></div>
    <div class="dt-body vscroll" data-id="${n.id}">
      ${anc.length > 1 ? `<div class="dt-crumbs">${anc.map(a => `<button data-act="open" data-id="${a.id}">${esc(a.t)}</button>`).join('<span>›</span>')}</div>` : ''}
      <div class="dt-head">${ckHTML(n)}<textarea id="dt-title" class="dt-title" rows="1" aria-label="Title" placeholder="Name it" enterkeyhint="done">${esc(n.t)}</textarea></div>
      ${ser && n.rs ? `<div class="rp-scope" role="group" aria-label="Changes apply to"><span>Changes apply to</span><button data-act="scope" data-v="one" aria-pressed="${S.scope !== 'all'}">This one</button><button data-act="scope" data-v="all" aria-pressed="${S.scope === 'all'}">All repeats</button></div>` : ''}
      ${n.r ? '<div class="dt-note rp-note">Changes here go to every repeat. Check off each one on its day.</div>' : ''}
      ${kids.length ? `<div class="dt-prog"><div class="bar"><i style="width:${pct}%"></i></div><span>${pr.done} of ${pr.total} done</span></div>` : ''}
      <div class="dt-meta">
        ${canRec(n) && (n.p == null || n.d || track.isRec(n)) ? `<button class="chip rec-chip${track.isRec(n) ? ' on' : ''}" data-act="rec" data-id="${n.id}">${track.isRec(n) ? ICON.stop : ICON.play}<span>${track.isRec(n) ? 'Recording · Stop' : 'Start'}</span></button>` : recUp(n)}
        ${n.r ? '' : `<button class="chip${n.d ? ' set' : ''}" data-act="dtpick">${ICON.cal}<span>${n.d ? whenLabel(n) : 'Add to a day'}</span></button>`}
        ${kids.length || n.c ? '' : `<button class="chip rp-chip${ser ? ' set' : ''}" data-act="rpedit" aria-expanded="${S.rpEdit}">${ICON.rep}<span>${ser ? esc(ruleText(ser.r, ser.d)) : 'Repeat'}</span></button>`}
        ${kids.length || n.c ? '' : `<label class="chip"><span class="k">Takes about</span><select id="dt-dur">${durs.sort((a, b) => a - b).map(m => `<option value="${m}"${(n.m || 60) === m ? ' selected' : ''}>${fmtDur(m)}</option>`).join('')}</select></label>`}
        ${!kids.length && !n.c && (n.done || n.am) && !track.real(n).length ? `<label class="chip took${n.am ? ' set' : ''}"><span class="k">Took</span><input type="number" id="dt-took" inputmode="numeric" min="1" max="10080" placeholder="${n.m || 60}" value="${n.am || ''}" aria-label="Minutes it really took"><span class="k">min</span></label>` : ''}
        ${kids.length || n.c ? `<label class="chip${n.st ? ' set' : ''}"><span class="k">Starts</span><input type="date" id="dt-start" value="${n.st || ''}"${n.due ? ` max="${n.due}"` : ''}></label>` : ''}
        ${kids.length || n.c || n.due || n.ms ? `<label class="chip${n.due ? ' set' : ''}"><span class="k">Due</span><input type="date" id="dt-due" value="${n.due || ''}"${n.st ? ` min="${n.st}"` : ''}></label>` : ''}
        ${kids.length || n.c || rp ? '' : `<button class="chip ms-chip${n.ms ? ' set' : ''}" data-act="ms" aria-pressed="${!!n.ms}">${ICON.ms}<span>Milestone</span></button>`}
        ${n.ms && !kids.length && !n.c && !rp ? `<button class="chip hd-chip${n.hd ? ' set' : ''}" data-act="hd" aria-pressed="${!!n.hd}" title="A date that can't move">Hard deadline</button>` : ''}
        ${waitHTML(n)}
        ${linkHTML(n)}
        ${n.p == null && !n.rs ? `<label class="chip"><span class="k">Area</span><select id="dt-area">${store.areas().map(a => `<option value="${a.id}"${areaOf(n) === a.id ? ' selected' : ''}>${esc(a.t || 'Untitled area')}</option>`).join('')}<option value=""${areaOf(n) ? '' : ' selected'}>No area</option></select></label>` : ''}
      </div>
      ${S.dtpick && !n.r ? pickerHTML(n, 0) : ''}
      ${S.rpEdit ? repeatHTML(n) : ''}
      ${S.waitEdit ? waitPickHTML(n) : ''}
      ${n.p == null && isProj(n) ? swatchesHTML(n) : ''}
      <div class="dt-sec">Notes</div>
      ${n.notes && !S.notesEdit ? `<div class="dt-notes dt-notes-view" data-act="editnotes" role="button" tabindex="0" aria-label="Notes, tap to edit">${linkify(n.notes)}</div>` : `<textarea id="dt-notes" class="dt-notes" placeholder="Thoughts, links, where to start. These will be here when you sit down to do it." aria-label="Notes">${esc(n.notes || '')}</textarea>`}
      <div class="dt-saved" id="dt-saved" aria-live="polite"></div>
      ${timeHTML(n)}
      ${rp ? '' : `<div class="dt-sec">Steps${kids.length ? `<small>${pr.done}/${pr.total}</small>` : ''}</div>
      <div class="dt-steps" data-drop="sib" data-g="p:${n.id}">${kids.map(stepHTML).join('')}
        <form class="dt-add" data-form="step" data-p="${n.id}"><span class="plus-i" aria-hidden="true">+</span><input id="dt-add-in" placeholder="Add a step" autocomplete="off" aria-label="Add a step" enterkeyhint="done"></form></div>`}
      <div class="dt-foot">
        ${rp ? '<span></span>' : `<button class="dt-ask" data-act="dtbreak">✦ ${kids.length ? 'Ask Claude what else this needs' : 'Ask Claude to break this into steps'}</button>`}
        ${!S.confirmDel ? `<button class="dt-del" data-act="askdelete">Delete</button>`
          : ser && n.rs ? `<div class="confirm"><span>Delete ${esc(n.t || 'this')}?</span><button class="danger" data-act="delete">This one</button><button class="danger" data-act="delete-all">All repeats</button><button data-act="nodelete">Cancel</button></div>`
          : `<div class="confirm"><span>Delete ${esc(n.t || 'this')}${n.r ? ' and all its repeats' : count > 0 ? ` and its ${count} step${count > 1 ? 's' : ''}` : ''}?</span><button class="danger" data-act="delete">Delete</button><button data-act="nodelete">Cancel</button></div>`}
      </div>
    </div></section>`;
  el.querySelectorAll('textarea').forEach(grow); el.querySelector('.dt-body').scrollTop = prevSc;
}
/* The time log: every stretch of time recorded on it, each one tap away from being corrected */
const dayWord = d => d === today() ? 'Today' : d === add(today(), -1) ? 'Yesterday' : `${DAYN[pd(d).getDay()]} ${pd(d).getDate()}`;
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
function timeHTML(n) {
  if (n.r || n.k === 'area' || (n.p != null && !n.d && !n.tl?.length)) return ''; // a step's time goes to its project
  const t = track.total(n), plan = hasKids(n.id) || n.c ? null : n.pl?.duration_min ?? n.m;
  const rows = (n.tl || []).map((e, i) => {
    const a = track.local(e.start), b = e.end && track.local(e.end);
    if (S.tlEdit === i) return `<div class="tl-ed"><input type="date" id="tl-day" value="${a.d}" max="${today()}" aria-label="Day"><input type="time" id="tl-s" value="${hhmm(a.m)}" aria-label="Started"><span>–</span>${b ? `<input type="time" id="tl-e" value="${hhmm(b.m)}" aria-label="Ended">` : '<span class="tl-now">now</span>'}<button class="chip-edit" data-act="tl-del" data-i="${i}">Delete</button><button class="chip-edit" data-act="tl-close">Done</button></div>`;
    return `<button class="tl-row${e.guess ? ' guess' : ''}${b ? '' : ' live'}" data-act="tl-edit" data-i="${i}" title="Tap to correct"><span>${dayWord(a.d)}</span><span class="tl-t">${fmtT(a.m)} – ${b ? fmtT(b.m) : 'now'}</span><span class="tl-m">${e.guess ? 'guessed' : fmtDur(Math.max(1, track.mins(e)))}</span></button>`;
  }).join('');
  const sum = t ? `${fmtDur(t)} recorded${plan ? ` · planned ${fmtDur(plan)}` : ''}` : '';
  return `<div class="dt-sec">Time${sum ? `<small>${sum}</small>` : ''}</div><div class="tl">${rows}<button class="tl-add" data-act="tl-add">+ Add time I forgot</button></div>`;
}
// Saves the stretch being corrected. An end before the start means it ran past midnight.
function saveStretch() {
  const n = S.open && node(S.open), i = S.tlEdit, e = n?.tl?.[i]; if (!e) return;
  const day = document.getElementById('tl-day')?.value, s = document.getElementById('tl-s')?.value, f = document.getElementById('tl-e')?.value;
  if (!day || !s || (e.end && !f)) return;
  const a = new Date(`${day}T${s}`); let b = null;
  if (e.end) { b = new Date(`${day}T${f}`); if (b <= a) b.setDate(b.getDate() + 1); }
  const err = track.edit(n.id, i, a.toISOString(), b && b.toISOString());
  if (err) toast(err === 'future' ? "That's still to come. Pick a time that has passed." : err === 'order' ? 'The end has to come after the start' : "That time didn't work");
}

/* Repeating. The Repeat chip opens a small editor: how often, which days, every how many weeks, and an
   optional end. A repeat opened from the plan edits its whole series' rule here. */
function repeatHTML(n) {
  const s = store.seriesOf(n), r = s?.r, start = r ? s.d : n.d || today();
  const kinds = [['day', 'Daily'], ['weekday', 'Weekdays'], ['week', 'Weekly'], ['month', 'Monthly']];
  let h = `<div class="rp-ed"><div class="rp-k" role="group" aria-label="Repeats">${kinds.map(([v, t]) => `<button data-act="rp-every" data-v="${v}" aria-pressed="${r?.every === v}">${t}</button>`).join('')}</div>`;
  if (r?.every === 'week') {
    const days = r.days?.length ? r.days : [pd(start).getDay()];
    h += `<div class="rp-row"><div class="rp-days" role="group" aria-label="On these days">${WEEK.map(d => `<button data-act="rp-day" data-v="${d}" aria-pressed="${days.includes(d)}" aria-label="${DAYL[d]}" title="${DAYL[d]}">${DAYN[d][0]}</button>`).join('')}</div>
      <label class="chip"><span class="k">Every</span><select id="rp-int" aria-label="Every how many weeks">${[1, 2, 3, 4, 6, 8, 12].map(i => `<option value="${i}"${(r.interval || 1) === i ? ' selected' : ''}>${i === 1 ? 'week' : i + ' weeks'}</option>`).join('')}</select></label></div>`;
  }
  if (r) h += `<div class="rp-row"><label class="chip"><span class="k">Starts</span><input type="date" id="rp-start" value="${s.d}"${r.until ? ` max="${r.until}"` : ''}></label>
    <label class="chip${r.until ? ' set' : ''}"><span class="k">Ends</span><input type="date" id="rp-until" value="${r.until || ''}" min="${s.d}" aria-label="Last day it repeats"></label>
    <button class="chip-edit" data-act="rp-off">Don't repeat</button></div>`;
  else h += `<div class="dt-note">Starts ${start === today() ? 'today' : fmtShort(start)}. Each repeat shows on its day and is checked off on its own.</div>`;
  return h + '</div>';
}
// Sets how a task repeats. A plain task becomes the series itself, starting on its day (or today).
function setRepeat(patch) {
  const n = node(S.open); if (!n) return;
  const s = store.seriesOf(n);
  if (s?.r) store.update(s.id, { r: cleanRule({ ...s.r, ...patch }, s.d) });
  else { const d = n.d || today(); store.update(n.id, { r: cleanRule(patch, d), d, done: false }); }
}
// In an open repeat, a change goes to it alone or to its whole series, as picked at the top of the panel
function edit(id, patch, quiet) {
  const n = node(id);
  if (S.open === id && S.scope === 'all' && n?.rs && store.seriesOf(n)?.r) store.seriesEdit(id, patch);
  else store.update(id, patch, quiet);
}

/* Colour choices. A project in an area can follow the area's colour (the ringed swatch) or have its own. */
function swatchesHTML(n) {
  const area = n.k !== 'area' && areaOf(n) && store.get(n.ar);
  const follow = area ? `<button class="sw follow${n.c === 'area' ? ' on' : ''}" style="--sw:${area.c || '#B9BCD0'}" data-act="color" data-c="area" aria-label="Use the ${esc(area.t)} area's colour" title="Use the area's colour"></button><span class="sw-sep"></span>` : '';
  const own = n.k === 'area' || n.c !== 'area' || !area ? glow(n.c) : null;
  return `<div class="swatches${n.k === 'area' ? ' area-sw' : ''}" role="group" aria-label="Color">${follow}${PALETTE.map(c => `<button class="sw${own === c ? ' on' : ''}" style="--sw:${c}" data-act="color" data-c="${c}" aria-label="Color ${c}"></button>`).join('')}</div>`;
}
// An area opens like a project: rename it, see and add its projects, or delete it (its projects stay).
function areaDetail(el, n, same) {
  const projs = areaGroups().groups.find(g => g.a?.id === n.id)?.projs || [];
  el.innerHTML = `<div class="dt-back" data-act="close"></div>
  <section class="dt${same ? ' still' : ''}" role="dialog" aria-modal="true" aria-label="${esc(n.t)}">
    <div class="dt-top"><button class="dt-up" data-act="close">${ICON.prev}<span>Back</span></button><button class="ib" data-act="close" aria-label="Close">${ICON.close}</button></div>
    <div class="dt-body vscroll" data-id="${n.id}">
      <div class="dt-kind">Area</div>
      <div class="dt-head"><textarea id="dt-title" class="dt-title" rows="1" aria-label="Area name" placeholder="Name this area" enterkeyhint="done">${esc(n.t)}</textarea></div>
      <div class="dt-note">Projects in this area wear its colour, unless you give one its own.</div>
      ${swatchesHTML(n)}
      <div class="dt-sec">${projs.some(p => !isProj(p)) ? 'Projects and tasks' : 'Projects'}<small>${projs.length}</small></div>
      <div class="dt-steps" data-drop="area" data-area="${n.id}">${projs.map(stepHTML).join('')}
        <form class="dt-add" data-form="area-project" data-area="${n.id}"><span class="plus-i" aria-hidden="true">+</span><input id="dt-add-in" placeholder="Add a project" autocomplete="off" aria-label="Add a project" enterkeyhint="done"></form></div>
      <div class="dt-foot"><span></span>
        ${S.confirmDel ? `<div class="confirm"><span>Delete the ${esc(n.t || 'untitled')} area?${projs.length ? ` Everything in it stays: projects under No area, tasks in the Inbox.` : ''}</span><button class="danger" data-act="delete">Delete</button><button data-act="nodelete">Cancel</button></div>` : `<button class="dt-del" data-act="askdelete">Delete area</button>`}
      </div>
    </div></section>`;
}
/* "Waiting on": an item can wait on another one, such as "List footage" on "NAS live". Pick it by typing part of its name. */
const pathOf = n => ancestors(n).map(a => a.t).join(' › ');
function waitHTML(n) {
  const w = n.w && node(n.w);
  if (w) return `<span class="link-pair"><button class="chip set wait-chip${isDone(w) ? ' met' : ''}" data-act="open" data-id="${w.id}" title="${esc(pathOf(w) ? pathOf(w) + ' › ' + w.t : w.t)}">${ICON.wait}<span><span class="k">Waiting on</span> ${esc(w.t || 'Untitled')}</span></button><button class="chip-edit" data-act="unwait">Remove</button></span>`;
  return S.waitEdit ? '' : `<button class="chip" data-act="waitedit">${ICON.wait}<span>Waiting on…</span></button>`;
}
function waitMatches(n, q) {
  const bad = new Set([n.id, ...ancestors(n).map(a => a.id)]); const kidsOf = id => children(id).flatMap(c => [c.id, ...kidsOf(c.id)]); kidsOf(n.id).forEach(i => bad.add(i));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return store.all().filter(x => !bad.has(x.id) && x.t && words.every(w => (x.t + ' ' + pathOf(x)).toLowerCase().includes(w)))
    .sort((a, b) => isDone(a) - isDone(b) || (isProj(b) - isProj(a)) || a.t.localeCompare(b.t)).slice(0, 8);
}
function waitPickHTML(n) {
  return `<form class="wait-pick" data-form="wait" style="--pc:${colorOf(n)}"><div class="chip wait-in">${ICON.wait}<input id="dt-wait" placeholder="Waiting on… type a task or project" autocomplete="off" enterkeyhint="done" aria-label="Waiting on"></div><div class="wait-list" id="wait-list" role="listbox">${waitListHTML(n, '')}</div></form>`;
}
function waitListHTML(n, q) {
  if (!q.trim()) return '<div class="wait-hint">Type part of its name</div>';
  const m = waitMatches(n, q);
  return m.length ? m.map(x => `<button type="button" class="wait-opt" data-act="setwait" data-id="${x.id}" role="option" style="--pc:${colorOf(x)}"><i></i><span>${esc(x.t)}${pathOf(x) ? `<small>${esc(pathOf(x))}</small>` : ''}</span></button>`).join('') : '<div class="wait-hint">Nothing by that name</div>';
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
  else if (S.open && (node(S.open)?.link || null) !== u) edit(S.open, { link: u });
  renderDetail();
}
function openItem(id, focusTitle = false) {
  if (S.open !== id) { S.scope = 'one'; S.rpEdit = false; }
  S.open = id; S.tlEdit = null; S.dtpick = false; S.confirmDel = false; S.linkEdit = false; S.notesEdit = false; S.waitEdit = false; renderDetail();
  if (focusTitle) { const t = document.getElementById('dt-title'); t.focus(); t.select(); }
}

/* Render everything, keeping focus and typing intact */
let raf = 0;
function render() {
  cancelAnimationFrame(raf); raf = 0;
  const ae = document.activeElement; const fid = ae && ae.id && !document.getElementById('detail').contains(ae) ? ae.id : null;
  const val = fid ? ae.value : null;
  renderSide(); renderMain(); renderTabs(); renderDetail(); renderRec(); renderMsgs(); saveUI();
  if (S.view === 'week' && W?.jump && placeDay(W.jump, 0)) { W.jump = null; stripTitle(); } // a phone only lays the plan out once its tab is set
  if (S.adding) { const i = document.getElementById('add-in'); if (i) { if (fid === 'add-in') i.value = val; i.focus({ preventScroll: true }); } }
  else if (fid && fid !== 'askq') { const i = document.getElementById(fid); if (i) { if (val != null && 'value' in i) i.value = val; i.focus({ preventScroll: true }); } }
}
const later = () => { if (!raf) raf = requestAnimationFrame(render); };

/* The recording pill: what's recording and for how long, floating above the bottom of the screen.
   Tap it to open the task or say it started earlier; after three hours untouched it asks if you're still on it. */
const recEl = document.createElement('div'); recEl.id = 'rec'; recEl.className = 'rec'; recEl.hidden = true; document.body.appendChild(recEl);
const ICON_OK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';
const REC_OK = 'daybook-rec-ok', REC_ASK = 3 * 3600e3;
const pad = v => String(v).padStart(2, '0');
function recClock(e) { const t = Math.max(0, Math.floor((Date.now() - Date.parse(e.start)) / 1000)), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60; return (h ? h + ':' + pad(m) : m) + ':' + pad(t % 60); }
function recAsk(e) { const ok = lsGet(REC_OK, {}); return Date.now() - Math.max(Date.parse(e.start), ok.start === e.start ? ok.at : 0) >= REC_ASK; }
function recAck() { const e = track.openOf(track.running()); if (e) lsSet(REC_OK, { start: e.start, at: Date.now() }); renderRec(); }
function renderRec() {
  const r = track.running(), e = track.openOf(r); document.body.classList.toggle('recording', !!e); document.body.classList.remove('rec-open');
  if (!e) { recEl.hidden = true; recEl.innerHTML = ''; delete recEl.dataset.id; S.recOpen = false; return; }
  if (recEl.dataset.id !== r.id) { recEl.dataset.id = r.id; S.recOpen = false; } // something else started: the extras fold away
  recEl.hidden = false; recEl.style.setProperty('--pc', colorOf(r));
  if (recAsk(e)) { recEl.dataset.ask = 1; recEl.innerHTML = `<div class="rec-p ask"><span class="dot"></span><span class="rec-q">Still on ${esc(short(r.t))}?</span><button class="rec-w" data-act="rec-yes">Yes</button><button class="rec-w" data-act="rec-stop">Stop</button></div>`; return; }
  delete recEl.dataset.ask;
  const proj = hasKids(r.id) || !!r.c; document.body.classList.toggle('rec-open', !!S.recOpen);
  recEl.innerHTML = `<div class="rec-p"><button class="rec-main" data-act="rec-open" aria-expanded="${!!S.recOpen}" title="Started earlier? Tap to change"><span class="dot"></span><span class="rec-t">${esc(r.t || 'Untitled')}</span><span class="rec-c" id="rec-c">${recClock(e)}</span></button><button class="rec-i" data-act="rec-stop" aria-label="Stop recording" title="Stop">${ICON.stop}</button>${proj ? '' : `<button class="rec-i ok" data-act="rec-done" aria-label="Check off ${esc(r.t)}" title="Done">${ICON_OK}</button>`}</div>`
    + (S.recOpen ? `<div class="rec-x"><span>Started ${fmtT(track.local(e.start).m)}</span><button data-act="rec-nudge" data-v="-15">−15</button><button data-act="rec-nudge" data-v="-5">−5</button><button data-act="rec-nudge" data-v="5">+5</button><button data-act="rec-task">Open</button></div>` : '');
}
setInterval(() => {
  const e = track.openOf(track.running()); if (!e) return;
  if (!!recEl.dataset.ask !== recAsk(e)) { renderRec(); return; }
  const c = document.getElementById('rec-c'); if (c) c.textContent = recClock(e);
}, 1000);

/* Actions */
let toastT, toastMsg = '', toastAt = 0;
function toast(msg, acts = '', ms = 0) {
  const t = document.getElementById('toast'); toastMsg = msg; toastAt = performance.now();
  t.innerHTML = `<span>${esc(msg)}</span>${acts}`; t.classList.toggle('act', !!acts); t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show', 'act'), ms || (acts ? 5000 : 2600));
}

/* Undo and redo: Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) on a computer. Every change shows a
   pill with Undo for a few seconds; after undoing it offers Redo too. On a phone the
   arrows also sit quietly in the header while there's something to take back.
   Inside a text box, Ctrl+Z is the box's own typing undo. */
const short = t => { t = (t || '').trim() || 'item'; return t.length > 32 ? t.slice(0, 31) + '…' : t; };
function describe(st) {
  const main = st.ch.reduce((m, c) => Object.keys(c[1]).length > Object.keys(m[1]).length ? c : m, st.ch[0]);
  const [id, b, a] = st.ch.find(c => c[2].x === true) || st.ch.find(c => c[1].x === true) || main;
  const t = short(store.peek(id)?.t), k = Object.keys(b), n = st.ch.length;
  if (a.x === true) return `Deleted ${t}`;
  if (b.x === true) return `Added ${t}`;
  const live = l => (l || []).some(e => !e.end), began = st.ch.find(c => 'tl' in c[1] && !('done' in c[1]) && live(c[2].tl) && !live(c[1].tl));
  if (began) return `Recording ${short(store.peek(began[0])?.t)}`;
  if ('done' in b) return n > 1 ? `${a.done ? 'Checked off' : 'Unchecked'} ${n} steps` : `${a.done ? 'Checked off' : 'Unchecked'} ${t}`;
  if ('c' in b) return `Changed the color of ${t}`;
  if ('r' in b) return !a.r ? `${t} no longer repeats` : b.r ? `Changed how ${t} repeats` : `Made ${t} repeat`;
  if ('tl' in b) return live(b.tl) && !live(a.tl) ? `Stopped recording ${t}` : `Changed the time on ${t}`;
  if ('d' in b || 's' in b || 'ar' in b || 'a' in b) return `Moved ${t}`;
  if ('m' in b) return `Changed the length of ${t}`;
  if ('st' in b && 'due' in b) return `Moved ${t} on the roadmap`;
  if ('due' in b) return `Changed the due date of ${t}`;
  if ('st' in b) return `Changed the start date of ${t}`;
  if ('am' in b) return `Changed how long ${t} took`;
  if ('ms' in b) return a.ms ? `Made ${t} a milestone` : `Made ${t} a plain task`;
  if ('hd' in b) return a.hd ? `Made ${t} a hard deadline` : `Made ${t}'s date movable`;
  if ('w' in b) return a.w ? `Set what ${t} waits on` : `${t} no longer waits on anything`;
  if ('t' in b) return `Renamed ${t}`;
  if ('notes' in b) return `Edited the notes of ${t}`;
  if ('link' in b) return `Changed the link of ${t}`;
  if ('o' in b || 'ds' in b) return `Reordered ${t}`;
  return `Changed ${t}`;
}
const lower = s => s[0].toLowerCase() + s.slice(1);
function urActs(fresh) {
  const u = store.canUndo(), r = store.canRedo();
  return (u ? `<button data-act="ur-undo">${ICON.undo}Undo</button>` : '') + (r && !fresh ? `<button data-act="ur-redo">${ICON.redo}Redo</button>` : '');
}
function urBtns() {
  const u = store.canUndo(), r = store.canRedo();
  // Quiet's strip always keeps both, dimmed when there's nothing to undo or redo, so the row never shifts
  if (quiet()) return `<div class="ur"><button class="ib" data-act="ur-undo" aria-label="Undo" title="Undo"${u ? '' : ' disabled'}>${ICON.undo}</button><button class="ib" data-act="ur-redo" aria-label="Redo" title="Redo"${r ? '' : ' disabled'}>${ICON.redo}</button></div>`;
  if (!u && !r) return '';
  return `<div class="ur phone-only">${u ? `<button class="ib" data-act="ur-undo" aria-label="Undo">${ICON.undo}</button>` : ''}${r ? `<button class="ib" data-act="ur-redo" aria-label="Redo">${ICON.redo}</button>` : ''}</div>`;
}
function urSync() { const h = document.querySelector('#main .mh-l'); if (!h) return; h.querySelector('.ur')?.remove(); if (!boardShown()) h.insertAdjacentHTML('beforeend', urBtns()); }
function doUndo() { const st = store.undo(); toast(st ? `Undone: ${lower(describe(st))}` : 'Nothing to undo', st ? urActs() : ''); }
function doRedo() { const st = store.redo(); toast(st ? `Redone: ${lower(describe(st))}` : 'Nothing to redo', st ? urActs() : ''); }
// A change to one repeat on the plan (moved, resized) goes to that one, and the pill offers to make it for every repeat
let occOffer = null, occAll = null;
// A new step: offer Undo, keeping any message the change just showed (like a project's progress)
function onStep(st) {
  urSync();
  const off = occOffer; occOffer = null;
  if (!st || st.text) return; // typing a name or notes: the box is right there, no pill needed
  if (off && st.ch.some(c => c[0] === off.id)) { occAll = off; toast(`${describe(st)}, just this one`, `<button data-act="occ-all">${ICON.rep}All repeats</button>${urActs(true)}`, 8000); return; }
  if (st.ch.length === 1 && st.ch[0][1].x === true && !store.peek(st.ch[0][0])?.t.trim()) return; // a new project or area, about to be named
  toast(performance.now() - toastAt < 100 ? toastMsg : describe(st), urActs(true));
}
// Checking off one task stops its recording and moves its block to when it was really done (track.js); reopening puts it back
// A step of a project that isn't on the plan itself stays off it: its project's recording holds the time
const check = n => store.update(n.id, n.done ? track.undonePatch(n) : track.donePatch(n, !!n.d || n.p == null));
function placedText(id) {
  const n = node(id); if (!n?.done || n.s == null) return '';
  return ` · ${fmtT(n.s)}–${fmtT(n.s + (n.m || 60))}${n.tl?.[n.tl.length - 1]?.guess ? ', as planned' : ''}`;
}
function toggle(id) {
  const n = node(id); if (n.rs) { check(n); if (node(id)?.done) toast(`${short(n.t)} done${placedText(id)}`); return; } // a repeat is checked off on its own
  const anc = ancestors(n); const before = anc.map(isDone);
  if (hasKids(id) || n.c) { const all = isDone(n); store.updateMany(leaves(id).filter(l => !l.c && !l.r).map(l => [l.id, { done: !all }])); }
  else check(n);
  const fin = anc.filter((a, i) => !before[i] && isDone(a)), when = hasKids(id) || n.c ? '' : placedText(id);
  if (fin.length) { const a = fin[fin.length - 1]; const r = rootOf(n); const p = progress(r.id); toast(r === a ? `${a.t} is complete.` : `${a.t} is done. ${r.t} is now ${Math.round(p.done / p.total * 100)}% complete.`); }
  else if (!hasKids(id) && node(id).done && anc.length) { const r = rootOf(n), p = progress(r.id); toast(`${r.t}: ${p.done} of ${p.total} done${when}`); }
  else if (when) toast(`${short(n.t)} done${when}`);
}
// A day's list keeps its own order (ds), apart from the order of a project's steps (o)
function reorder(date, id, idx, patch, more = {}) {
  const list = dayGaps(date).gaps.flat().filter(n => n.id !== id); list.splice(Math.max(0, Math.min(idx, list.length)), 0, node(id));
  store.updateMany(list.map((n, i) => [n.id, n.id === id ? { ...patch, ds: i } : { ...more[n.id], ds: i }]));
}
/* A task dropped in the List view: work out what it needs so the list stays in time order.
   gap/idx say where it landed (idx counts tasks across the whole day). Returns its own patch, plus new times for others. */
function listDrop(n, date, gap, idx) {
  const { E, gaps } = dayGaps(date), g0 = gapStart(E, gap);
  const inGap = gaps[gap].filter(x => x.id !== n.id), k = idx - gaps.slice(0, gap).flat().filter(x => x.id !== n.id).length;
  const above = inGap.slice(0, Math.max(0, k)), below = inGap.slice(Math.max(0, k));
  const timed = l => l.filter(x => x.s != null), patch = { d: date, a: g0 }, more = {};
  const pin = () => { // no time: stay right below whatever is above it, or above whatever is below
    const up = above[above.length - 1], dn = below.find(x => gapKey(x, g0)[0] !== Infinity);
    if (up) { const u = gapKey(up, g0)[0]; if (u !== Infinity) patch.a = u; }
    else if (dn) { const m = gapKey(dn, g0)[0] - 1; if (m >= 0 && (g0 == null || m > g0)) patch.a = m; }
  };
  if (n.s == null) { pin(); return { patch, more }; }
  if (n.d === date && gapOf(E, n.s) === gap) {
    // Moved among the timed tasks of its own gap: they keep the same start times, handed out in the new order
    const order = timed(above).concat([n], timed(below)), slots = order.map(x => x.s).sort((x, y) => x - y);
    order.forEach((x, i) => { if (x.s !== slots[i]) { if (x.id === n.id) patch.s = slots[i]; else more[x.id] = { s: slots[i] }; } });
    patch.a = null; return { patch, more };
  }
  // Moved to another gap or day: start right after what is above it (a task or an event), or end just before what is below
  const up = timed(above).pop(), dn = timed(below)[0], prevEv = gap ? E[gap - 1] : null, nextS = dn ? dn.s : E[gap]?.s;
  let s = up ? up.s + (up.m || 60) : prevEv ? prevEv.s + prevEv.m : nextS != null ? nextS - (n.m || 60) : n.s;
  s = Math.round(s / 5) * 5;
  if (s >= 0 && s + (n.m || 60) <= 1440 && gapOf(E, s) === gap && (!dn || s <= dn.s)) { patch.s = s; patch.a = null; }
  else { patch.s = null; pin(); } // no time fits there, so it keeps its place without one
  return { patch, more };
}
/* Reordering projects, tasks and steps. A list says whose items it holds: data-g="p:<parent>" for a project's steps,
   "loose" for inbox tasks, and an area (data-drop="area") holds top-level projects and its own tasks. Dragged into another area,
   a project or task moves there; an area's task dragged into the Inbox leaves its area. */
const groupOf = n => n.p ? 'p:' + n.p : isProj(n) || areaOf(n) ? 'a:' + areaOf(n) : 'loose';
const keyOf = t => t.dataset.drop === 'area' ? 'a:' + (t.dataset.area || '') : t.dataset.g;
const holds = (t, n) => t.dataset.drop === 'area' ? n.p == null && (isProj(n) || !!t.dataset.area) : t.dataset.drop === 'sib' && (t.dataset.g === groupOf(n) || (t.dataset.g === 'loose' && n.p == null && !isProj(n)));
function siblings(key) {
  if (key.startsWith('p:')) return children(key.slice(2));
  const roots = store.all().filter(n => n.p == null).sort((a, b) => a.o - b.o);
  return key === 'loose' ? roots.filter(n => !isProj(n) && !areaOf(n)) : roots.filter(n => (isProj(n) || areaOf(n)) && 'a:' + areaOf(n) === key);
}
function placeAmong(n, t, at, patch) {
  const key = keyOf(t); if (t.dataset.drop === 'area' && groupOf(n) !== key) patch.ar = t.dataset.area || null;
  if (key === 'loose' && n.ar) patch.ar = null;
  const list = siblings(key).filter(x => x.id !== n.id), i = at.before ? list.findIndex(x => x.id === at.before) : at.after ? list.findIndex(x => x.id === at.after) + 1 : -1;
  list.splice(i < 0 ? list.length : i, 0, n);
  store.updateMany(list.map((x, j) => [x.id, x.id === n.id ? { ...patch, o: j } : { o: j }]).filter(([id, p]) => id === n.id || node(id).o !== p.o));
}
function setDay(id, d) { const n = node(id); const patch = { d: d || null, ds: Date.now() / 1000 }; if (n.d !== d) { patch.s = null; patch.a = null; } S.pick = null; S.dtpick = false; edit(id, patch); if (d) toast(`${n.t} → ${d === today() ? 'today' : DAYL[pd(d).getDay()] + ' ' + fmtShort(d)}`); }
function makeProject(t, ar) {
  // In an area a new project wears the area's colour; with no area it gets a colour of its own
  const used = new Set(store.all().filter(n => n.p == null && n.c && n.c !== 'area').map(n => glow(n.c)));
  const c = ar ? 'area' : PALETTE.find(x => !used.has(x)) || PALETTE[store.all().length % PALETTE.length];
  return store.create({ t, c, ar: ar || null, o: Date.now() / 1000 });
}
function newProject(ar) { const n = makeProject('', ar); if (ar) S.col['area:' + ar] = false; openItem(n.id, true); }
function newArea() { const n = store.create({ k: 'area', t: '', c: store.nextAreaColor(), o: Math.max(0, ...store.areas().map(a => a.o)) + 1 }); openItem(n.id, true); }
// Switching List and Time blocks in Week view stays on the days you were looking at
function setMode(m) {
  const first = S.view === 'week' && W ? visibleDays()[0] : null;
  S.mode = m; if (first) W.jump = first; else W = null; render();
}
function showPlan(view, mode) { if (S.view !== view || S.mode !== mode) W = null; S.view = view; S.mode = mode; S.page = 'plan'; render(); }
function signIn() {
  if (!client) return;
  client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname, scopes: 'https://www.googleapis.com/auth/calendar.readonly', queryParams: { access_type: 'offline', prompt: 'consent' } } });
}
let justDragged = false;
document.addEventListener('click', e => {
  if (justDragged) { e.preventDefault(); e.stopPropagation(); return; }
  const b = e.target.closest('[data-act]');
  if (!b) { const it = e.target.closest('[data-drag]'); if (it && !e.target.closest('input,textarea,select,form')) openItem(it.dataset.id); else if (!it) tapNew(e); return; }
  const a = b.dataset.act, id = b.dataset.id;
  switch (a) {
    case 'open': openItem(id); break;
    case 'close': S.open = null; S.confirmDel = false; S.linkEdit = false; renderDetail(); break;
    case 'editnotes': {
      if (e.target.closest('a') || String(getSelection())) break; // links open in a new tab; selecting text shouldn't start editing
      S.notesEdit = true; renderDetail();
      const t = document.getElementById('dt-notes'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
      break;
    }
    case 'editlink': S.linkEdit = true; renderDetail(); document.getElementById('dt-link')?.focus(); break;
    case 'dtpick': S.dtpick = !S.dtpick; renderDetail(); break;
    case 'scope': S.scope = b.dataset.v; renderDetail(); break;
    case 'rpedit': S.rpEdit = !S.rpEdit; renderDetail(); break;
    case 'rp-every': setRepeat({ every: b.dataset.v }); break;
    case 'rp-day': {
      const s = store.seriesOf(node(S.open)); if (!s?.r) break;
      const d = +b.dataset.v, days = s.r.days?.length ? s.r.days : [pd(s.d).getDay()];
      if (days.includes(d) && days.length === 1) break; // keeps at least one day
      setRepeat({ days: days.includes(d) ? days.filter(x => x !== d) : [...days, d] }); break;
    }
    case 'rp-off': { const t = store.stopRepeat(S.open); if (t) { S.open = t; S.rpEdit = false; S.scope = 'one'; toast(`${short(node(t).t)} no longer repeats`); } break; }
    case 'occ-all': if (occAll) { const o = occAll; occAll = null; const t = short(node(o.id)?.t); store.seriesEdit(o.id, o.patch); toast(`Changed every repeat of ${t}`); } break;
    case 'ms': { const n = node(S.open); store.update(n.id, n.ms ? { ms: false, hd: false } : { ms: true }); break; }
    case 'hd': { const n = node(S.open); store.update(n.id, { hd: !n.hd }); break; }
    case 'waitedit': S.waitEdit = true; renderDetail(); document.getElementById('dt-wait')?.focus(); break;
    case 'setwait': S.waitEdit = false; document.activeElement?.blur(); edit(S.open, { w: id }); break;
    case 'unwait': edit(S.open, { w: null }); break;
    case 'dtbreak': {
      const n = node(S.open);
      if (user) { const q = hasKids(n.id) ? `Look at "${n.t}" and its steps. What's missing? Add any steps it still needs.` : `Break "${n.t}" into steps.`; S.open = null; renderDetail(); openAI(); ask(q); }
      else { breakDownLocal(n.t); }
      break;
    }
    case 'askdelete': S.confirmDel = true; renderDetail(); break;
    case 'nodelete': S.confirmDel = false; renderDetail(); break;
    case 'delete': { const n = node(S.open); S.open = n.p && node(n.p) && !n.rs ? n.p : null; S.confirmDel = false; store.remove(n.id); const on = n.d || n.oc; toast(n.rs ? `Deleted ${n.t || 'item'} on ${on === today() ? 'today' : DAYN[pd(on).getDay()] + ' ' + fmtShort(on)}` : `Deleted ${n.t || 'item'}`); break; }
    case 'delete-all': { const s = store.seriesOf(node(S.open)); S.open = null; S.confirmDel = false; if (s) { store.remove(s.id); toast(`Deleted ${s.t || 'item'} and all its repeats`); } break; }
    case 'color': store.update(S.open, { c: b.dataset.c }); break;
    case 'toggle': toggle(id); break;
    case 'rec': if (track.isRec(node(id))) track.stop(id); else track.start(id); break;
    case 'rec-stop': { const r = track.running(); if (r) track.stop(r.id); break; }
    case 'rec-done': { const r = track.running(); if (r) toggle(r.id); break; }
    case 'rec-open': S.recOpen = !S.recOpen; renderRec(); break;
    case 'rec-task': { const r = track.running(); S.recOpen = false; if (r) openItem(r.id); renderRec(); break; }
    case 'rec-nudge': { const r = track.running(); if (r) track.nudge(r.id, +b.dataset.v); break; }
    case 'rec-yes': recAck(); break;
    case 'tl-edit': S.tlEdit = +b.dataset.i; renderDetail(); break;
    case 'tl-close': S.tlEdit = null; renderDetail(); break;
    case 'tl-del': { const i = +b.dataset.i; S.tlEdit = null; track.remove(S.open, i); break; }
    case 'tl-add': {
      track.addTime(S.open); const tl = node(S.open)?.tl || [];
      S.tlEdit = tl.reduce((k, e, i) => e.end && (k < 0 || Date.parse(e.end) >= Date.parse(tl[k].end)) ? i : k, -1); renderDetail(); break; // open the one just added, to set its times
    }
    case 'fold': S.col[id] = !S.col[id]; render(); break;
    case 'pick': S.pick = S.pick === id ? null : id; render(); break;
    case 'setday': setDay(id, b.dataset.d || null); break;
    case 'add': S.adding = id; S.new = null; S.col[id] = false; render(); break;
    case 'new-day': if (Date.now() - newClosed > 400) openNew({ at: 'list', d: b.dataset.d }); break;
    case 'new-project': newProject(b.dataset.area); break;
    case 'new-area': newArea(); break;
    case 'page': if (quiet() && b.dataset.v === 'projects') setQuiet(false); // the full Projects board is its own page, outside Quiet
      S.page = b.dataset.v; S.pick = null; S.adding = null; render(); break;
    case 'road': toggleRoad(); break;
    case 'rm-zoom': roadmap.setZoom(+b.dataset.v); break;
    case 'rm-fold': S.col['rm:' + id] = !S.col['rm:' + id]; saveUI(); render(); break;
    case 'rm-week': S.anchor = b.dataset.d; S.view = 'week'; W = null; leaveRoad(); render(); break;
    case 'view': leaveRoad(); S.view = b.dataset.v; W = null; render(); break;
    case 'mode': leaveRoad(); setMode(b.dataset.v); break;
    case 'min': setQuiet(!S.min); break;
    case 'qstrip': setStrip(!S.qstrip); break;
    case 'qproj': if (!phone()) setQPin(!qPin); else if (qProjects()) { quietPlan(); render(); } else quietProjects(); break;
    case 'prev': case 'next': if (roadShown()) { roadmap.go(a === 'prev' ? -1 : 1); break; } if (qProjects()) { quietPlan(); render(); break; } {
      const dir = a === 'prev' ? -1 : 1;
      if (S.view !== 'week' || !W) { S.anchor = add(S.anchor, dir * (S.view === 'week' ? 7 : 1)); render(); break; }
      const f = visibleDays()[0] || S.anchor, ws = weekStart(f); // a computer lines weeks up on Monday; a phone steps a week from where you are
      const to = phone() ? add(f, dir * 7) : dir > 0 ? add(ws, 7) : f === ws ? add(ws, -7) : ws;
      // draw a few weeks past where we're headed first, so the strip doesn't redraw mid-glide
      let grew = false; if (add(to, -14) < W.from) { W.from = add(weekStart(to), -21); grew = true; } if (add(to, 21) > W.to) { W.to = add(to, 35); grew = true; }
      if (grew) renderMain();
      stripGo(to, true); break;
    }
    case 'today': if (roadShown()) { roadmap.goToday(); break; } if (qProjects()) { quietPlan(); S.anchor = today(); render(); break; } if (S.view === 'week' && W) { stripGo(phone() ? today() : weekStart(today()), true); break; } S.anchor = today(); render(); break;
    case 'goday': S.anchor = b.dataset.d; S.view = 'day'; W = null; render(); break;
    case 'tip': S.tip = false; render(); break;
    case 'tab': S.tab = b.dataset.v; S.drOpen = false; document.body.classList.remove('dr-on'); render(); break;
    case 'drawer': setDrawer(!S.drOpen); renderTabs(); break;
    case 'dr-close': setDrawer(false); renderTabs(); break;
    case 'dr-in': S.drAt = id || null; renderMain(); break;
    case 'ai-toggle': document.body.classList.toggle('ai-off'); break;
    case 'reset': store.resetLocal(store.sampleData); toast('Sample data restored'); break;
    case 'ask': openAI(); ask(b.dataset.q); break;
    case 'clear-chat': clearChat(); break;
    case 'ur-undo': doUndo(); break;
    case 'ur-redo': doRedo(); break;
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
function openAI() { aiPeek = false; if (quietLook()) { setStrip(false); document.body.classList.remove('ai-off'); return; } if (phone()) { if (S.tab !== 'ask') { S.tab = 'ask'; renderTabs(); } } else document.body.classList.remove('ai-off'); }
document.addEventListener('submit', e => {
  const f = e.target; e.preventDefault();
  if (f.id === 'askf') { const q = document.getElementById('askq'); if (q.value.trim()) { ask(q.value.trim()); q.value = ''; } return; }
  const inp = f.querySelector('input'); const v = inp.value.trim();
  if (f.dataset.form === 'link') { saveLink(); return; }
  if (f.dataset.form === 'wait') { const o = f.querySelector('.wait-opt'); if (o) { S.waitEdit = false; document.activeElement?.blur(); edit(S.open, { w: o.dataset.id }); } return; }
  if (f.dataset.form === 'area-project') { if (v) { makeProject(v, f.dataset.area); inp.value = ''; renderDetail(); document.getElementById('dt-add-in')?.focus(); } return; }
  if (f.dataset.form === 'step') { if (v) { store.create({ t: v, p: f.dataset.p, m: 30 }); S.col[f.dataset.p] = false; inp.value = ''; renderDetail(); document.getElementById('dt-add-in')?.focus(); } return; }
  if (f.dataset.form === 'new') {
    if (!v) { closeNew(); return; }
    inp.value = ''; const at = S.new.at; addNew(v);
    if (at === 'col') closeNew(); // a time block is one task; a day's list stays open for the next one
    return;
  }
  if (f.dataset.form === 'add') { if (!v) { S.adding = null; render(); return; } inp.value = ''; store.create({ t: v, p: f.dataset.p }); return; }
  if (f.dataset.form === 'inbox' && v) { inp.value = ''; store.create({ t: v }); }
});
document.addEventListener('keydown', e => {
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || key === 'y')) {
    if (e.target.closest?.('textarea, input:not([type]), input[type=text], input[type=search], input[type=url], [contenteditable]:not([contenteditable=false])')) return; // the box's own undo
    e.preventDefault(); if (D) return;
    if (key === 'y' || e.shiftKey) doRedo(); else doUndo();
    return;
  }
  if (e.key === 'Escape' && S.waitEdit) { S.waitEdit = false; renderDetail(); return; }
  if (e.key === 'Escape' && S.linkEdit) { S.linkEdit = false; document.activeElement?.blur(); renderDetail(); return; }
  if (e.key === 'Escape' && S.new) { closeNew(); return; }
  if (e.key === 'Escape') { if (S.adding) { S.adding = null; render(); } else if (S.open) { S.open = null; renderDetail(); } else if (quiet() && !D) quietAway(); }
  // Q turns Quiet on and off, anywhere outside a text box
  if (key === 'q' && !D && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable=false])')) { e.preventDefault(); if (S.open) { S.open = null; renderDetail(); } setQuiet(!S.min); return; }
  // R opens the Roadmap and goes back, anywhere outside a text box
  if (key === 'r' && !D && !S.open && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable=false])')) { e.preventDefault(); toggleRoad(); return; }
  if (quiet() && !D && !S.open && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable=false])') && quietKey(e)) { e.preventDefault(); return; }
  if (e.key === 'Enter' && e.target.id === 'dt-title') { e.preventDefault(); e.target.blur(); }
  if (e.key === 'Enter' && e.target.matches('.dt-notes-view')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('focusout', e => { if (e.target.id === 'dt-link') saveLink(); });
// Leaving the "Waiting on" box without picking anything closes it
document.addEventListener('focusout', e => { if (e.target.id === 'dt-wait') setTimeout(() => { if (S.waitEdit && !document.activeElement?.closest?.('.wait-pick')) { S.waitEdit = false; renderDetail(); } }, 200); });
// Leaving the notes box shows them as text with clickable links again. Wait a moment so a tap on something else still lands.
document.addEventListener('focusout', e => { if (e.target.id === 'dt-notes' && S.notesEdit) { S.notesEdit = false; setTimeout(() => { if (!S.notesEdit) renderDetail(); }, 200); } });
document.addEventListener('focusout', e => { if (e.target.id === 'add-in' && !e.target.value.trim()) setTimeout(() => { if (S.adding && !document.activeElement?.matches('#add-in')) { S.adding = null; render(); } }, 150); });
// Picking a project goes back to the title
const inNew = el => !!el?.closest?.('form[data-form="new"]');
document.addEventListener('focusout', e => {
  if (!S.new || !inNew(e.target)) return;
  setTimeout(() => {
    if (S.new && !inNew(document.activeElement)) finishNew();
  }, 150);
});
document.addEventListener('change', e => {
  if (e.target.id !== 'new-p' || !S.new) return;
  S.new.p = e.target.value; e.target.closest('form').style.setProperty('--pc', pickColor(S.new.p));
  document.getElementById('new-in')?.focus({ preventScroll: true });
});
let savedT;
document.addEventListener('input', e => {
  const t = e.target, n = S.open && node(S.open); if (!n) return;
  if (t.id === 'dt-notes') { edit(n.id, { notes: t.value || null }, true); grow(t); const m = document.getElementById('dt-saved'); m.textContent = 'Saved'; clearTimeout(savedT); savedT = setTimeout(() => m.textContent = '', 1200); }
  if (t.id === 'dt-title') { edit(n.id, { t: t.value.replace(/\n/g, ' ') }, true); grow(t); }
  if (t.id === 'dt-wait') document.getElementById('wait-list').innerHTML = waitListHTML(n, t.value);
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.pickdate) { if (t.value) setDay(t.dataset.pickdate, t.value); return; }
  if (t.id === 'rm-free') { setFree(t.value); return; }
  if (t.id === 'tl-day' || t.id === 'tl-s' || t.id === 'tl-e') { saveStretch(); return; }
  const n = S.open && node(S.open); if (!n) return;
  if (t.id === 'dt-title') { if (!n.t.trim()) edit(n.id, { t: n.k === 'area' ? 'New area' : n.c ? 'New project' : 'Untitled' }); else store.updateMany([]); }
  if (t.id === 'dt-area') store.update(n.id, { ar: t.value || null });
  if (t.id === 'dt-notes') store.updateMany([]);
  if (t.id === 'dt-dur') edit(n.id, { m: +t.value });
  if (t.id === 'rp-int') setRepeat({ interval: +t.value });
  if (t.id === 'rp-until') { const s = store.seriesOf(n); if (s?.r && (!t.value || t.value >= s.d)) setRepeat({ until: t.value || null }); else renderDetail(); }
  if (t.id === 'rp-start') { const s = store.seriesOf(n); if (s?.r && t.value && (!s.r.until || t.value <= s.r.until)) store.update(s.id, { d: t.value }); else renderDetail(); }
  if (t.id === 'dt-due') store.update(n.id, { due: t.value || null });
  if (t.id === 'dt-start') store.update(n.id, { st: t.value || null });
  if (t.id === 'dt-took') { const v = Math.round(+t.value); store.update(n.id, { am: v >= 1 && v <= 10080 ? v : null }); }
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
  if (qSide && !qPin && el.closest('.side')) setQSide(false); // Quiet: projects slide away once something is picked up from them, so the whole plan is free
  D.fromDr = !!el.closest('.drawer'); D.x0 = D.x; D.y0 = D.y; // the drawer steps aside after a short carry (see moveDrag)
  D.list = !!el.closest('.side, .board, .dt, .drawer'); // picked up from a list of projects rather than from the plan
  if (D.kind !== 'resize' && node(D.id)?.d) document.body.classList.add('drag-sched'); // the tab bar offers to unschedule it
  el.classList.remove('pressing'); document.body.classList.add('is-dragging'); P = null; moveDrag(D.x, D.y); requestAnimationFrame(autoScroll);
}
function clearMarks() { ind.remove(); ins.remove(); document.querySelectorAll('.over').forEach(x => x.classList.remove('over')); }
function moveDrag(x, y) {
  // Picked up from the drawer, it's headed for the plan: once carried a little way, the drawer sinks away to free the whole day.
  // (Reordering projects and steps belongs to the full Projects screen.)
  if (D.fromDr && !D.sunk && Math.hypot(x - D.x0, y - D.y0) > 24) { D.sunk = true; document.body.classList.add('dr-drag'); }
  if (quiet() && !phone() && !qSide && x < 16 && D.kind !== 'resize') setQSide(true); // carried to the left edge: projects and the Inbox slide in to take it
  D.x = x; D.y = y; const hp = HP();
  if (D.kind === 'resize') { const r = D.block.getBoundingClientRect(); const n = node(D.id); const m = Math.max(15, Math.min(Math.round((y - r.top) / hp * 60 / 15) * 15, H1 * 60 - n.s)); D.newM = m; D.block.style.height = (m / 60 * hp - 2) + 'px'; D.block.querySelector('.b-time').textContent = `${fmtT(n.s)} – ${fmtT(n.s + m)}`; return; }
  D.g.style.transform = `translate(${x - D.offX}px,${y - D.offY}px)`;
  clearMarks(); D.g.classList.remove('off'); D.at = null; D.t = null;
  let t = document.elementFromPoint(x, y)?.closest('[data-drop]'); const n = node(D.id);
  // The nearest list that holds this item's siblings takes it at a new place among them
  if (!D.fromDr) for (let s = t; s && (s.dataset.drop === 'sib' || s.dataset.drop === 'area'); s = s.parentElement.closest('[data-drop]')) if (holds(s, n)) return markAmong(s, n, y);
  while (t && t.dataset.drop === 'sib') t = t.parentElement.closest('[data-drop]');
  if (t && D.list && t.closest('.side, .board, .dt, .drawer')) t = null; // somewhere else among the projects: nothing to do there
  D.t = t || null; if (!t) return;
  const type = t.dataset.drop;
  if (type === 'col') {
    const r = t.getBoundingClientRect(); const dur = node(D.id).m || 60;
    let min = H0 * 60 + Math.round((y - (D.timed ? D.offY : 12) - r.top) / hp * 60 / 15) * 15; min = Math.max(H0 * 60, Math.min(min, H1 * 60 - dur)); D.min = min;
    ind.style.top = ((min - H0 * 60) / 60 * hp) + 'px'; ind.style.height = (dur / 60 * hp - 2) + 'px'; t.appendChild(ind);
    // Over the time grid the dashed outline stands in for the item, so the floating copy hides
    ind.innerHTML = `<div class="ind-t">${esc(node(D.id).t || 'Untitled')}</div><div class="ind-time">${fmtT(min)} – ${fmtT(min + dur)}</div>`; D.g.classList.add('off');
  } else if (type === 'list') {
    // Rows are tasks and calendar events; count how many of each come before the drop point
    const rows = [...t.querySelectorAll(':scope > .item:not(.dragging), :scope > .evr')]; let i = rows.findIndex(it => { const r = it.getBoundingClientRect(); return y < r.top + r.height / 2; }); if (i < 0) i = rows.length;
    const before = rows.slice(0, i); D.gap = before.filter(r => r.classList.contains('evr')).length; D.idx = before.length - D.gap;
    if (rows[i]) t.insertBefore(ins, rows[i]); else t.appendChild(ins); t.classList.add('over');
  } else t.classList.add('over');
}
// Show a line where the item would land among its siblings
function markAmong(t, n, y) {
  const key = keyOf(t), rows = [...t.querySelectorAll('[data-drag]')].filter(el => el.closest('[data-drop]') === t && el.dataset.id !== n.id && !el.classList.contains('dr-sess') && node(el.dataset.id) && groupOf(node(el.dataset.id)) === key);
  const blk = el => el.matches('.proj-h') ? el.parentElement : el, mid = el => { const r = blk(el).getBoundingClientRect(); return r.top + Math.min(r.height, 60) / 2; };
  const i = rows.findIndex(el => y < mid(el)); D.t = t;
  if (groupOf(n) !== key) t.classList.add('over'); // moving to another area
  if (!rows.length) { D.at = {}; return; }
  ins.style.setProperty('--dep', (i < 0 ? rows[rows.length - 1] : rows[i]).style.getPropertyValue('--dep') || 0);
  if (i >= 0) { D.at = { before: rows[i].dataset.id }; blk(rows[i]).before(ins); return; }
  let end = blk(rows[rows.length - 1]); while (end.nextElementSibling?.matches('.pick, .kids, .add')) end = end.nextElementSibling;
  D.at = { after: rows[rows.length - 1].dataset.id }; end.after(ins);
}
function endDrag() {
  const d = D; D = null; clearMarks(); document.body.classList.remove('is-dragging', 'dr-drag', 'drag-sched'); d.g?.remove(); d.el.classList.remove('dragging');
  if (d.fromDr && d.sunk && d.t) { S.drOpen = false; document.body.classList.remove('dr-on'); renderTabs(); }
  const n = node(d.id);
  justDragged = true; setTimeout(() => justDragged = false, 80);
  if (!n) return render();
  if (d.kind === 'resize') { if (d.newM) store.update(n.id, { m: d.newM }); else render(); return; }
  if (!d.t) return render();
  if (n.r && ['col', 'tray', 'list'].includes(d.t.dataset.drop)) { toast(`${short(n.t)} is already on your plan, ${lower(ruleText(n.r, n.d))}`); return render(); }
  if (d.at) return placeAmong(n, d.t, d.at, d.list ? {} : { d: null, s: null, a: null }); // dragged back here from the plan, it comes off the plan
  const type = d.t.dataset.drop, date = d.t.dataset.date || null;
  if (type === 'col') store.update(n.id, { d: date, s: d.min, m: n.m || 60 });
  else if (type === 'tray') store.update(n.id, { d: date, s: null, a: null, ds: Date.now() / 1000 });
  else if (type === 'list') {
    // Dropped between events: a timed task takes a time that fits its new place, so the list never shows times out of order
    const { patch, more } = listDrop(n, date, d.gap, d.idx);
    reorder(date, n.id, d.idx, patch, more);
  }
  else if (type === 'inbox') store.update(n.id, { d: null, s: null, a: null });
  else if (type === 'area') {
    // A top-level project or task moves to that area (and, dragged in from the plan, comes off it); anything else just comes off the plan.
    const fromPlan = !d.el.closest('.side, .board'), off = { d: null, s: null, a: null };
    if (n.p == null && (isProj(n) || d.t.dataset.area)) store.update(n.id, { ar: d.t.dataset.area || null, ...(fromPlan ? off : {}) });
    else store.update(n.id, off);
  }
  else render();
}
function autoScroll() {
  if (!D) return; const el = document.elementFromPoint(D.x, D.y);
  const v = el?.closest('.vscroll, .dr-b'), h = el?.closest('.hscroll'); let moved = false;
  if (v) { const r = v.getBoundingClientRect(); if (D.y < r.top + 50) { v.scrollTop -= 10; moved = true; } else if (D.y > r.bottom - 50) { v.scrollTop += 10; moved = true; } }
  if (h && D.kind !== 'resize') { const r = h.getBoundingClientRect(); if (D.x < r.left + 40) { h.scrollLeft -= 10; moved = true; } else if (D.x > r.right - 40) { h.scrollLeft += 10; moved = true; } }
  if (moved) moveDrag(D.x, D.y); requestAnimationFrame(autoScroll);
}
document.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' || e.button !== 0) return;
  const rs = e.target.closest('.rs'); if (rs) { P = { x: e.clientX, y: e.clientY, el: rs, kind: 'resize', id: rs.closest('.block').dataset.id }; startDrag(); e.preventDefault(); return; }
  if (e.target.closest('button:not([data-dragok]),input,a,form,textarea,select')) return;
  const el = e.target.closest('[data-drag]'); if (el) { e.preventDefault(); P = { x: e.clientX, y: e.clientY, el, kind: 'move', id: el.dataset.id }; }
});
document.addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; if (D) { moveDrag(e.clientX, e.clientY); return; } if (P && Math.hypot(e.clientX - P.x, e.clientY - P.y) > 4) startDrag(); });
document.addEventListener('pointerup', e => { if (e.pointerType === 'touch') return; if (D) endDrag(); P = null; });
document.addEventListener('touchstart', e => {
  if (e.touches.length > 1) { clearTimeout(lp); P = null; return; } const t = e.touches[0];
  const rs = e.target.closest('.rs'); if (rs) { e.preventDefault(); P = { x: t.clientX, y: t.clientY, el: rs, kind: 'resize', id: rs.closest('.block').dataset.id }; startDrag(); return; }
  if (e.target.closest('button:not([data-dragok]),input,a,form,textarea,select')) return;
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
// On a computer, press on an empty time and drag down to choose how long the new task takes; a plain click picks the half hour
let NB = null;
const gridMin = (col, y) => H0 * 60 + Math.round((y - col.getBoundingClientRect().top) / HP() * 4) * 15;
document.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' || e.button !== 0 || S.new || D) return;
  const col = e.target.closest?.('#mbody .col[data-date]'); if (!col || e.target.closest('.block,.ev,form')) return;
  e.preventDefault(); NB = { col, y: e.clientY, on: false };
});
document.addEventListener('pointermove', e => {
  if (!NB || (!NB.on && Math.abs(e.clientY - NB.y) < 6)) return;
  NB.on = true; const a = gridMin(NB.col, Math.min(NB.y, e.clientY)), b = gridMin(NB.col, Math.max(NB.y, e.clientY));
  NB.s = Math.max(H0 * 60, Math.min(a, H1 * 60 - 15)); NB.m = Math.max(15, Math.min(b, H1 * 60) - NB.s);
  const hp = HP(); ind.style.top = ((NB.s - H0 * 60) / 60 * hp) + 'px'; ind.style.height = (NB.m / 60 * hp - 2) + 'px';
  ind.innerHTML = `<div class="ind-t">New task</div><div class="ind-time">${fmtT(NB.s)} – ${fmtT(NB.s + NB.m)}</div>`;
  if (ind.parentElement !== NB.col) NB.col.appendChild(ind);
});
document.addEventListener('pointerup', () => {
  const nb = NB; NB = null; if (!nb?.on) return;
  ind.remove(); justDragged = true; setTimeout(() => justDragged = false, 80);
  openNew({ at: 'col', d: nb.col.dataset.date, s: nb.s, m: nb.m });
});
let SW = null;
document.addEventListener('touchstart', e => {
  const t = e.touches[0], up = S.tab === 'plan' && !S.drOpen && e.target.closest('#tabs'), down = S.drOpen && e.target.closest('#dr-h');
  SW = e.touches.length === 1 && (up || down) ? { x: t.clientX, y: t.clientY, up: !!up } : null;
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!SW || D) return; const t = e.touches[0], dy = t.clientY - SW.y, dx = Math.abs(t.clientX - SW.x);
  if (SW.up ? dy < -18 && -dy > dx : dy > 36 && dy > dx) { setDrawer(SW.up); renderTabs(); SW = null; justDragged = true; setTimeout(() => justDragged = false, 300); }
}, { passive: true });
// A phone's long-press menu would cancel the touch mid-drag. Once the drawer slides away the finger is over the plan, not the item, so block it during any press or drag.
document.addEventListener('contextmenu', e => { if (P || D || e.target.closest('[data-drag]')) e.preventDefault(); });

/* Zoom the time-blocked view: pinch on a phone, Ctrl (or Cmd) + scroll wheel or trackpad pinch on a computer */
const ZOOM_KEY = 'daybook-zoom', HP_MIN = 20, HP_MAX = 200;
const setHP = v => { v = Math.max(HP_MIN, Math.min(HP_MAX, v)); document.documentElement.style.setProperty('--hp', v + 'px'); return v; };
{ const z = lsGet(ZOOM_KEY, null); if (typeof z === 'number') setHP(z); }
let zoomSave;
function zoomTo(v, y) { // keep the time under y (screen position) in place while zooming
  const mb = document.getElementById('mbody'), col = mb?.querySelector('.col'); if (!col) return;
  const old = HP(), top = col.getBoundingClientRect().top, hrs = (y - top) / old;
  const nv = setHP(v); if (nv === old) return;
  vScroller(mb).scrollTop += hrs * (nv - old);
  clearTimeout(zoomSave); zoomSave = setTimeout(() => lsSet(ZOOM_KEY, HP()), 300);
}
const inGrid = t => S.tab === 'plan' && S.mode === 'timed' && t instanceof Element && !!t.closest('#mbody .tw');
document.addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey) || !inGrid(e.target)) return;
  e.preventDefault();
  const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
  zoomTo(HP() * Math.exp(-Math.max(-50, Math.min(50, dy)) * 0.006), e.clientY);
}, { passive: false });
// Two fingers do both at once: spreading or pinching zooms, moving them together scrolls, so the time under them follows the fingers
let Z = null;
const span = ts => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
const mid = ts => ({ x: (ts[0].clientX + ts[1].clientX) / 2, y: (ts[0].clientY + ts[1].clientY) / 2 });
document.addEventListener('touchstart', e => {
  if (e.touches.length !== 2 || D || !inGrid(e.target)) { if (e.touches.length !== 2) Z = null; return; }
  Z = { d: span(e.touches), hp: HP(), m: mid(e.touches) };
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!Z || e.touches.length !== 2 || D) return;
  const m = mid(e.touches);
  if (e.cancelable) { // otherwise the browser is already scrolling, so only zoom
    e.preventDefault();
    const mb = document.getElementById('mbody'), tw = mb?.querySelector('.tw');
    if (tw) { tw.scrollTop -= m.y - Z.m.y; tw.scrollLeft -= m.x - Z.m.x; }
  }
  Z.m = m;
  zoomTo(Z.hp * span(e.touches) / Math.max(Z.d, 1), m.y);
}, { passive: false });
document.addEventListener('touchend', e => { if (e.touches.length < 2) Z = null; });

/* Day view: swipe sideways to go to the next or previous day. The day slides along under the finger and the
   day it's heading to peeks in from the side. A trackpad's two-finger sideways swipe does the same on a computer. */
let DS = null, WS = null, swBusy = false; const swp = document.createElement('div'); swp.className = 'swp';
const dayBody = t => { const mb = document.getElementById('mbody'); return mb?.classList.contains('day') && t instanceof Element && mb.contains(t) ? mb : null; };
function swSet(dx, o) {
  const mb = document.getElementById('mbody'); if (!mb) return; const w = mb.clientWidth || 1;
  mb.classList.add('swiping'); mb.style.setProperty('--swx', dx + 'px'); mb.style.setProperty('--swo', o ?? 1 - Math.min(1, Math.abs(dx) / w) * .6);
  if (!dx || o != null) { swp.classList.remove('show'); return; }
  const dir = dx < 0 ? 1 : -1, d = add(S.anchor, dir), r = mb.getBoundingClientRect();
  swp.innerHTML = dir < 0 ? `‹ <span>${d === today() ? 'Today' : `${DAYN[pd(d).getDay()]} ${pd(d).getDate()}`}</span>` : `<span>${d === today() ? 'Today' : `${DAYN[pd(d).getDay()]} ${pd(d).getDate()}`}</span> ›`;
  swp.style.top = (r.top + Math.min(r.height * .4, 240)) + 'px';
  swp.style.left = dir < 0 ? (r.left + 12) + 'px' : ''; swp.style.right = dir > 0 ? (innerWidth - r.right + 12) + 'px' : '';
  swp.style.opacity = Math.min(1, Math.abs(dx) / 90); swp.style.setProperty('--pk', (Math.min(Math.abs(dx), 90) / 90 - 1) * dir * -14 + 'px');
  if (!swp.isConnected) document.body.appendChild(swp); swp.classList.add('show');
}
function swDone(mb) { mb.classList.remove('swiping', 'sw-anim'); mb.style.removeProperty('--swx'); mb.style.removeProperty('--swo'); }
function swBack() { const mb = document.getElementById('mbody'); if (!mb) return; mb.classList.add('sw-anim'); swSet(0); setTimeout(() => swDone(mb), 220); }
function swGo(dir) { // dir 1 = next day, -1 = previous
  const mb = document.getElementById('mbody'); if (!mb) return; swBusy = true;
  const w = mb.clientWidth; mb.classList.add('sw-anim'); swSet(-dir * w, 0);
  justDragged = true;
  setTimeout(() => {
    const sc = S.mode === 'timed' ? vScroller(mb).scrollTop : null; // Time blocks keeps the same hours in view from day to day
    S.anchor = add(S.anchor, dir); render(); justDragged = false;
    const nb = document.getElementById('mbody'); if (!nb) { swBusy = false; return; }
    if (sc != null) vScroller(nb).scrollTop = sc;
    swSet(dir * w * .3, 0); nb.offsetWidth; nb.classList.add('sw-anim'); swSet(0, 1);
    setTimeout(() => { swDone(nb); swBusy = false; }, 240);
  }, 170);
}
document.addEventListener('touchstart', e => {
  DS = null; if (e.touches.length !== 1 || swBusy || D) return;
  const mb = dayBody(e.target); if (!mb || e.target.closest('input,textarea,select,.rs')) return;
  if (quiet() && e.touches[0].clientY > innerHeight - 40) return; // Quiet: the bottom edge brings in projects
  const t = e.touches[0]; DS = { x: t.clientX, y: t.clientY, lx: t.clientX, h: [[e.timeStamp, t.clientX]], on: false };
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!DS) return;
  if (D || e.touches.length !== 1) { if (DS.on) swBack(); DS = null; return; } // a drag or a pinch took over
  const t = e.touches[0], dx = t.clientX - DS.x, dy = t.clientY - DS.y;
  if (!DS.on) {
    // Forgiving on angle: anything closer to sideways than to up-and-down counts as a swipe
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx) * 1.2) { DS = null; return; } // scrolling up or down, as usual
    if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
    DS.on = true; clearTimeout(lp); if (P) { P.el.classList.remove('pressing'); P = null; }
  }
  if (e.cancelable) e.preventDefault();
  DS.lx = t.clientX; DS.h.push([e.timeStamp, t.clientX]); if (DS.h.length > 12) DS.h.shift();
  swSet(t.clientX - DS.x);
}, { passive: false });
const swEnd = () => {
  const s = DS; DS = null; if (!s?.on) return;
  const mb = document.getElementById('mbody'), dx = s.lx - s.x, w = mb?.clientWidth || 1;
  justDragged = true; setTimeout(() => justDragged = false, 80);
  // Speed over the last tenth of a second, so a quick flick counts even if the finger slows as it lifts
  const now = s.h[s.h.length - 1], old = s.h.find(p => now[0] - p[0] <= 100) || now, v = now[0] > old[0] ? (now[1] - old[1]) / (now[0] - old[0]) : 0;
  if (Math.abs(dx) > Math.min(w * .2, 90) || (Math.abs(dx) > 24 && Math.abs(v) > .2 && Math.sign(v) === Math.sign(dx))) swGo(dx < 0 ? 1 : -1); else swBack();
};
document.addEventListener('touchend', swEnd); document.addEventListener('touchcancel', swEnd);
document.addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey || !dayBody(e.target)) return;
  const ax = Math.abs(e.deltaX), ay = Math.abs(e.deltaY);
  if (WS?.lock || swBusy) { if (ax > ay) e.preventDefault(); clearTimeout(WS?.tm); WS = { lock: true, tm: setTimeout(() => WS = null, 300) }; return; } // let a flick's glide run out
  if (!WS && ax <= ay * 1.2) return; // up and down scrolls as usual
  e.preventDefault(); if (!WS) WS = { x: 0 }; clearTimeout(WS.tm);
  WS.x -= e.deltaX * (e.deltaMode === 1 ? 33 : 1);
  const w = document.getElementById('mbody').clientWidth;
  if (Math.abs(WS.x) > Math.min(150, w * .25)) { swGo(WS.x < 0 ? 1 : -1); WS = { lock: true, tm: setTimeout(() => WS = null, 300) }; return; }
  swSet(WS.x); WS.tm = setTimeout(() => { WS = null; swBack(); }, 150);
}, { passive: false });

/* Sidebar width: drag its right edge on a computer; double-click the edge to reset */
const SIDE_KEY = 'daybook-side-w';
const setSideW = w => { w = Math.round(Math.max(220, Math.min(w, 720, innerWidth - 420))); document.documentElement.style.setProperty('--side-w', w + 'px'); return w; };
{ const w = lsGet(SIDE_KEY, null); if (typeof w === 'number') setSideW(w); }
let SR = null;
document.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !e.target.closest?.('.side-rs')) return;
  e.preventDefault(); SR = { x: e.clientX, w: document.getElementById('side').getBoundingClientRect().width }; document.body.classList.add('resizing');
});
document.addEventListener('pointermove', e => { if (SR) SR.now = setSideW(SR.w + e.clientX - SR.x); });
document.addEventListener('pointerup', () => { if (!SR) return; if (SR.now) lsSet(SIDE_KEY, SR.now); SR = null; document.body.classList.remove('resizing'); });
document.addEventListener('dblclick', e => { if (e.target.closest?.('.side-rs')) { document.documentElement.style.removeProperty('--side-w'); lsDel(SIDE_KEY); } });
matchMedia('(max-width:860px)').addEventListener('change', () => { W = null; later(); });

/* Start-up: sign-in, sample mode, and keeping "today" current */
function showWelcome(show) { document.getElementById('welcome').hidden = !show; }
function enterDemo() {
  S.demo = true; saveUI(); user = null; showWelcome(false);
  store.useLocal('daybook-sample', store.sampleData); calendar.useSample();
  initAI({ cloud: false, client: null }); render();
}
async function enterCloud(u) {
  user = u; S.demo = false; if (u.user_metadata?.free_hours) S.free = u.user_metadata.free_hours; saveUI(); showWelcome(false);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; // so Claude reads and writes finish times in local time
  if (tz && u.user_metadata?.tz !== tz) client.auth.updateUser({ data: { tz } }).catch(() => {});
  calendar.useGoogle(client, u.id); initAI({ cloud: true, client });
  render();
  await store.useCloud(client, u);
  calendar.ensure(add(today(), -7), add(today(), 28), true);
}
store.onChange((kind, st) => { if (kind === 'occ') { if (!S.open && !('done' in st.patch) && !('tl' in st.patch)) occOffer = occOffer || st; return; } if (kind === 'step') return onStep(st); if (kind === 'sync') { if (!D) later(); return; } if (!D) later(); });
calendar.onCalendarChange(() => { if (!D) later(); });
initAI({ anchor: () => S.anchor, showPlan, render: later });
setInterval(() => { if (today() !== shown) { shown = today(); if (S.anchor === add(today(), -1)) S.anchor = today(); later(); } else if (track.running() && !D) later(); // what's recording grows in Time blocks
  else if (S.mode === 'timed' && !D) { document.querySelectorAll('.now').forEach(n => n.style.top = hpx((nowMin() - H0 * 60) / 60)); } }, 60e3);
if (!matchMedia('(min-width:1500px)').matches) document.body.classList.add('ai-off');
if (S.min) { document.body.classList.add('ai-off'); S.page = 'plan'; S.tab = 'plan'; }

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
