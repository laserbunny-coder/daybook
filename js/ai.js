// "Ask Claude" panel. Signed in, questions go to Claude with the planner's
// current state; in sample mode a few scripted replies show the idea.
import * as store from './store.js';
import { eventsOn, timedOn } from './calendar.js';
import { add, DAYL, dayShort, esc, fmtDur, fmtT, lsGet, lsSet, nowMin, pd, today, weekStart } from './util.js';
import { children, dayItems, hasKids, heldBy, isDone, leaves, node, PALETTE, progress, rootOf, unscheduled } from './tree.js';
import * as blocks from './blocks.js';
import { ruleText } from './repeat.js';
import * as notes from './notes.js';

let ctx = { cloud: false, client: null, anchor: () => today(), showPlan: () => {}, render: () => {} };
const MSGS = lsGet('daybook-chat', []).filter(m => !m.typing).map(m => ({ ...m, u: null }));
const UNDO = {}; let uSeq = 0;

export function initAI(c) { ctx = { ...ctx, ...c }; renderMsgs(); }
export function clearChat() { MSGS.length = 0; persist(); renderMsgs(); }
function persist() { lsSet('daybook-chat', MSGS.filter(m => !m.typing).slice(-40).map(({ u, ...m }) => m)); }
const remember = () => { const k = 'u' + (++uSeq); UNDO[k] = store.snapshot(); return k; };
export function undo(k) { if (!UNDO[k]) return false; store.restore(UNDO[k]); delete UNDO[k]; return true; }

// Returns the reply as plain text, so a spoken question can be answered out loud (voice.js)
export async function ask(q, { voice = false } = {}) {
  MSGS.push({ me: q }); const typing = { typing: true }; MSGS.push(typing); renderMsgs();
  let out;
  try { out = ctx.cloud ? await askClaude(q, voice) : await new Promise(r => setTimeout(() => r(scripted(q)), 600)); }
  catch (e) { console.warn(e); out = { h: `<p>${esc(e.message || "I couldn't reach Claude. Check your connection and try again.")}</p>`, error: true }; }
  MSGS.splice(MSGS.indexOf(typing), 1); MSGS.push(out); persist(); renderMsgs(); ctx.render();
  return out.text || out.h.replace(/<\/(p|li)>/g, '. ').replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/([.!?:])\. /g, '$1 ');
}

/* Real Claude */
function plannerState() {
  const T = today(); const areas = store.areas(), areaIds = new Set(areas.map(a => a.id));
  const items = store.all().map(n => {
    const o = { id: n.id, title: n.t, parent_id: n.p, done: !!n.done };
    if (hasKids(n.id) || n.c) { const p = progress(n.id); o.progress = `${p.done}/${p.total}`; }
    if (n.r) { o.repeats = ruleText(n.r, n.d); o.starts = n.d; } // a repeating task: on each of those days, not on one
    else if (n.d) o.day = n.d;
    else { const h = heldBy(n); if (h) o.scheduled_with = h.id; }
    if (n.s != null) o.start_min = n.s;
    o.duration_min = n.m || 60;
    if (n.due) o.due = n.due;
    if (n.st) o.start = n.st;
    if (n.ms) o.milestone = true;
    if (n.hd) o.hard_deadline = true;
    if (n.w && store.get(n.w)) o.waiting_on = n.w;
    if (n.notes) o.notes = n.notes.slice(0, 500);
    if (n.link) o.link = n.link;
    if (n.p == null && n.ar && areaIds.has(n.ar)) o.area_id = n.ar;
    const lb = (n.lb || []).map(id => store.get(id)?.t).filter(Boolean); if (lb.length) o.labels = lb;
    return o;
  }).filter(o => !o.done || o.progress);
  const calendar_events = [];
  for (let i = -1; i < 14; i++) {
    const d = add(T, i);
    for (const e of eventsOn(d)) calendar_events.push(e.allDay ? { title: e.t, day: d, all_day: true } : { title: e.t, day: d, start_min: e.s, duration_min: e.m });
  }
  // Area time: blocks from the start of this week to two weeks out, a repeating one once per day it falls on
  const blks = [];
  for (let d = weekStart(T); d <= add(T, 14); d = add(d, 1)) for (const b of store.blocksOn(d)) {
    const o = { id: b.id, block_for: b.fo, title: store.get(b.fo)?.t || 'Removed', day: d, start_min: b.s, duration_min: b.m || 60 };
    if (b.rs) { const s = store.get(b.rs); if (s?.r) o.repeats = ruleText(s.r, s.d); }
    if (d <= T) o.worked_min = blocks.worked(b);
    if (b.done && !o.worked_min) o.skipped = true;
    blks.push(o);
  }
  const areaOut = areas.map(a => { const w = blocks.week(a.id), o = { id: a.id, title: a.t, this_week_worked_min: w.done, this_week_blocked_min: w.ahead }; if (a.wk) o.week_hours = Math.round(a.wk / 6) / 10; return o; });
  return { today: T, weekday: DAYL[pd(T).getDay()], now_min: nowMin(), viewing_week_of: weekStart(ctx.anchor()), areas: areaOut, labels: labelWeek(), items, blocks: blks, calendar_events, notes_from_planning_chat: planningNotes() };
}
// Each label with the time recorded under it this week (its own items and everything inside them)
function labelWeek() {
  const a = Date.parse(pd(weekStart(today()))), out = new Map(store.labels().map(l => [l.id, { title: l.t, this_week_min: 0 }]));
  for (const n of store.logged()) {
    const ids = store.labelsOf(n).map(x => x.l.id); if (!ids.length) continue;
    let m = 0; for (const e of n.tl) { const s = Math.max(a, Date.parse(e.start)), f = e.end ? Date.parse(e.end) : Date.now(); if (f > s) m += (f - s) / 60000; }
    for (const id of ids) if (out.has(id)) out.get(id).this_week_min += Math.round(m);
  }
  return [...out.values()];
}
// The latest notes the planning chat (Claude with the Daybook connector) left in Notes: its plans and reasons,
// so Ask Claude follows the same plan
function planningNotes() {
  const since = Date.now() - 21 * 864e5;
  return notes.all().filter(n => Date.parse(n.created_at) > since).slice(0, 8)
    .map(n => ({ written: n.created_at, title: n.title, message: (n.body || '').slice(0, 1500), task_ids: n.task_ids || [] }));
}
// The chat the latest note came from, to carry on there (the Claude app has its own voice mode)
export function planningChat() { for (const n of notes.all()) { try { const u = new URL(n.link); if (u.protocol === 'https:') return u.href; } catch { /* no link */ } } return null; }
function history() {
  const h = [];
  for (let i = 0; i < MSGS.length; i++) {
    const m = MSGS[i];
    if (m.me && MSGS[i + 1]?.text) { h.push({ role: 'user', content: m.me }, { role: 'assistant', content: MSGS[i + 1].text }); }
  }
  return h.slice(-12);
}
async function askClaude(q, voice) {
  const { data, error } = await ctx.client.functions.invoke('ask', { body: { question: q, history: history(), state: plannerState(), voice } });
  if (error) {
    let msg = "I couldn't reach Claude. Check your connection and try again.";
    try { const b = await error.context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep default */ }
    throw new Error(msg);
  }
  const u = data.actions?.length ? remember() : null;
  const changed = applyActions(data.actions || []);
  return { text: data.reply, h: fmtReply(data.reply), u: changed ? u : null, see: changed > 0 };
}
function fmtReply(t) {
  const lines = esc(t).split('\n'); let h = '', list = false;
  for (const l of lines) {
    const li = l.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (li) { if (!list) { h += '<ul>'; list = true; } h += `<li>${bold(li[1])}</li>`; continue; }
    if (list) { h += '</ul>'; list = false; }
    if (l.trim()) h += `<p>${bold(l)}</p>`;
  }
  return h + (list ? '</ul>' : '');
}
const bold = s => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
function applyActions(actions) {
  let count = 0; const valid = id => id && node(id) && node(id).k !== 'area';
  const area = id => (id && store.areas().some(a => a.id === id) ? id : null);
  const isTop = id => valid(id) && node(id).p == null;
  for (const a of actions) {
    const m = a.duration_min && a.duration_min >= 5 ? Math.min(a.duration_min, 1440) : null;
    const s = Number.isInteger(a.start_min) && a.start_min >= 0 && a.start_min < 1440 ? a.start_min : null;
    const day = /^\d{4}-\d{2}-\d{2}$/.test(a.day || '') ? a.day : null;
    if (a.type === 'schedule' && valid(a.id)) { store.update(a.id, { d: day, s: day ? s : null, ...(node(a.id).d !== day ? { a: null, ds: Date.now() / 1000 } : {}), ...(m ? { m } : {}) }, true); count++; }
    else if (a.type === 'add_task' && a.title) { store.create({ t: a.title, p: valid(a.parent_id) ? a.parent_id : null, ar: valid(a.parent_id) ? null : area(a.parent_id), d: day, s: day ? s : null, m: m || 60, notes: a.notes || null }); count++; }
    else if (a.type === 'add_steps' && valid(a.id)) { (a.steps || []).forEach((st, i) => { if (st.title) store.create({ t: st.title, p: a.id, m: Math.max(5, st.duration_min || 30), o: Date.now() / 1000 + i }); count++; }); store.update(a.id, { done: false }, true); }
    else if (a.type === 'add_project' && a.title) {
      const used = new Set(store.all().filter(n => n.p == null && n.c).map(n => n.c)), ar = area(a.parent_id);
      const p = store.create({ t: a.title, ar, c: ar ? 'area' : PALETTE.find(c => !used.has(c)) || PALETTE[store.all().length % PALETTE.length], notes: a.notes || null, due: day });
      (a.steps || []).forEach((st, i) => { if (st.title) store.create({ t: st.title, p: p.id, m: Math.max(5, st.duration_min || 30), o: Date.now() / 1000 + i }); });
      count++;
    }
    else if (a.type === 'move_to_area' && isTop(a.id)) { store.update(a.id, { ar: area(a.parent_id) }, true); count++; }
    else if (a.type === 'rename' && valid(a.id) && a.title) { store.update(a.id, { t: a.title }, true); count++; }
    else if (a.type === 'set_notes' && valid(a.id)) { store.update(a.id, { notes: a.notes || null }, true); count++; }
    else if (a.type === 'set_due' && valid(a.id)) { store.update(a.id, { due: day }, true); count++; }
    else if (a.type === 'add_block' && day && node(a.parent_id) && (node(a.parent_id).k === 'area' || hasKids(a.parent_id) || node(a.parent_id).c)) {
      const t = node(a.parent_id), r = a.repeat === 'daily' ? { every: 'day' } : a.repeat === 'weekdays' ? { every: 'weekday' } : a.repeat === 'weekly' ? { every: 'week', days: [pd(day).getDay()] } : null;
      store.create({ k: 'block', fo: t.id, t: t.t || '', d: day, s, m: m || 90, ds: Date.now() / 1000, ...(r ? { r } : {}) }); count++;
    }
    else if (a.type === 'remove_block' && a.id && node(a.id)?.k === 'block') { store.remove(a.id); count++; }
    else if (a.type === 'set_labels' && valid(a.id) && typeof a.title === 'string') {
      const n0 = node(a.id), h = n0.rs ? store.get(n0.rs) || n0 : n0, ids = [];
      for (const name of a.title.split(',').map(x => x.trim().slice(0, 40)).filter(Boolean)) {
        const l = store.labels().find(x => (x.t || '').trim().toLowerCase() === name.toLowerCase()) || store.create({ k: 'label', t: name, c: store.nextLabelColor(), m: null });
        if (!ids.includes(l.id)) ids.push(l.id);
      }
      if (h.r) store.seriesEdit(h.id, { lb: ids.length ? ids : null }); else store.update(h.id, { lb: ids.length ? ids : null }, true);
      count++;
    }
    else if (a.type === 'set_week_hours' && area(a.parent_id)) { store.update(a.parent_id, { wk: a.duration_min > 0 ? Math.min(Math.round(a.duration_min), 10080) : null }, true); count++; }
  }
  if (count) store.updateMany([]);
  return count;
}

/* Scripted replies for sample mode */
function busy(d) { return [...timedOn(d).map(e => [e.s, e.s + e.m]), ...dayItems(d).filter(n => n.s != null && !isDone(n)).map(n => [n.s, n.s + (n.m || 60)])].sort((a, b) => a[0] - b[0]); }
function findSlot(d, dur, from = 540, to = 1080) { if (d === today()) from = Math.max(from, Math.ceil(nowMin() / 15) * 15); let t = from; for (const [s, e] of busy(d)) { if (e <= t) continue; if (s >= t + dur) return t; t = Math.max(t, Math.ceil(e / 15) * 15); } return t + dur <= to ? t : null; }
function freeMin(d) { let f = 0, t = 540; for (const [s, e] of busy(d)) { if (e <= t) continue; if (s > t) f += Math.min(s, 1080) - t; t = Math.max(t, e); } return f + Math.max(0, 1080 - t); }
function weekDays() { const T = today(); const a = ctx.anchor(); const ws = weekStart(a < T ? T : a); return [...Array(7)].map((_, i) => add(ws, i)).filter(d => d >= T); }
function planWeek() {
  const u = remember(); const days = weekDays(); const placed = {}, left = []; let count = 0; const changes = [];
  for (const d of days) for (const n of dayItems(d).filter(n => n.s == null && !isDone(n))) {
    const dur = n.m || 60; const s = findSlot(d, dur);
    if (s != null) { store.update(n.id, { s, m: dur }, true); (placed[d] = placed[d] || []).push(n); count++; } else left.push(n);
  }
  const work = days.filter(d => { const w = pd(d).getDay(); return w > 0 && w < 6; });
  const pulled = unscheduled().filter(n => rootOf(n).due).sort((a, b) => rootOf(a).due.localeCompare(rootOf(b).due) || a.o - b.o).slice(0, 2);
  for (const n of pulled) { const d = (work.length ? work : days).slice().sort((a, b) => freeMin(b) - freeMin(a))[0]; if (!d) continue; const s = findSlot(d, n.m || 60); if (s == null) continue; store.update(n.id, { d, s, ds: Date.now() / 1000 }, true); (placed[d] = placed[d] || []).push(n); count++; }
  store.updateMany(changes); ctx.showPlan('week', 'timed');
  const lines = Object.keys(placed).sort().map(d => `<li><b>${dayShort(d)}</b>: ${placed[d].sort((a, b) => a.s - b.s).map(n => `${esc(n.t)} at ${fmtT(n.s)}`).join(', ')}</li>`).join('');
  let h = count ? `<p>I gave <b>${count} tasks</b> a time this week, between 9am and 6pm and around your calendar events.</p><ul>${lines}</ul>` : `<p>Everything this week already has a time.</p>`;
  if (pulled.length) h += `<p>I also pulled in <b>${pulled.map(n => esc(n.t)).join('</b> and <b>')}</b> from your unscheduled tasks, because ${pulled.length > 1 ? 'their projects have' : 'its project has'} the nearest deadline.</p>`;
  if (left.length) h += `<p>${left.map(n => esc(n.t)).join(', ')} didn't fit, so ${left.length > 1 ? 'they stay' : 'it stays'} under Any time.</p>`;
  return { h, u: count ? u : null, see: true };
}
const BREAK = { 'packing list': ['Clothes and rain gear', 'Hiking and kayak gear', 'Snacks for the drive', 'Chargers and paper maps'], 'collect 3 client testimonials': ['List 6 happy clients', 'Send a short request email', 'Follow up after 3 days', 'Format quotes for the site'], 'homepage mockup': ['Sketch the layout on paper', 'Design the hero section', 'Services and testimonials sections', 'Phone version'], 'cable cleanup': ['Buy cable tray and ties', 'Label power bricks', 'Mount the power strip'] };
export function breakDownLocal(q) {
  const ql = q.toLowerCase(); const all = store.all();
  let target = all.find(n => ql === n.t.toLowerCase()) || all.slice().sort((a, b) => b.t.length - a.t.length).find(n => ql.includes(n.t.toLowerCase()));
  if (!target) target = all.find(n => !hasKids(n.id) && !n.done && n.p);
  if (!target) return { h: '<p>Tell me which task to break down.</p>' };
  if (hasKids(target.id)) return { h: `<p><b>${esc(target.t)}</b> already has ${children(target.id).length} steps.</p>` };
  const u = remember(); const steps = BREAK[target.t.toLowerCase()] || ['Decide what done looks like', 'List the first three steps', 'Do the first step (30 minutes)'];
  const m = Math.max(15, Math.round((target.m || 60) / steps.length / 15) * 15);
  steps.forEach((t, i) => store.create({ t, p: target.id, m, o: i }));
  store.update(target.id, { done: false }); const r = rootOf(target);
  return { h: `<p>I split <b>${esc(target.t)}</b> into ${steps.length} steps:</p><ul>${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ul><p>Checking off a step moves ${esc(r.t)} forward too.</p>`, u };
}
function risks() {
  const out = [];
  for (const d of weekDays()) { const t = dayItems(d).filter(n => !isDone(n) && !hasKids(n.id)).reduce((a, n) => a + (n.m || 60), 0); const f = freeMin(d) + dayItems(d).filter(n => n.s != null && !isDone(n) && n.s >= 540 && n.s < 1080).reduce((a, n) => a + (n.m || 60), 0); if (t > f) out.push(`<li><b>${dayShort(d)}</b> has ${fmtDur(t)} of tasks but about ${fmtDur(f)} of open time between 9 and 6.</li>`); }
  for (const p of store.all().filter(n => n.p == null && n.due)) { const pr = progress(p.id); if (!pr.total) continue; const left = Math.round((pd(p.due) - pd(today())) / 864e5); const open = leaves(p.id).filter(n => !n.done); const un = open.filter(n => !n.d).length; if (pr.done / pr.total < .5 && left < 30) out.push(`<li><b>${esc(p.t)}</b> is ${Math.round(pr.done / pr.total * 100)}% done with ${left} days left, and ${un} of its ${open.length} open tasks have no day yet.</li>`); }
  return { h: out.length ? `<p>A few things to watch:</p><ul>${out.join('')}</ul>` : '<p>This week looks manageable. Every day fits in your open time.</p>', follow: true };
}
function scripted(q) {
  const l = q.toLowerCase();
  if (/plan|schedul|organi[sz]e|arrange/.test(l) && !/break/.test(l)) return planWeek();
  if (/break|split|steps|subtask/.test(l)) return breakDownLocal(q.replace(/^.*?"(.+)".*$/, '$1'));
  if (/risk|behind|worr|overload|too much|watch|deadline/.test(l)) return risks();
  return { h: '<p>This is sample mode, so I only have a few scripted replies. Sign in to ask Claude anything about your plans.</p>' };
}

export function renderMsgs() {
  const m = document.getElementById('msgs'); if (!m) return;
  if (!MSGS.length) {
    const open = store.all().filter(n => !hasKids(n.id) && !n.done && !n.c).length;
    m.innerHTML = `<div class="msg bot"><p>${open ? `You have ${open} open tasks, and ${unscheduled().length} of them don't have a day yet.` : 'Add a few projects and tasks, then ask me to plan them out.'}</p><p>Ask me to plan your week, break a task into steps, or check what's at risk.</p></div>`;
  } else m.innerHTML = MSGS.map(x => x.me ? `<div class="msg me">${esc(x.me)}</div>` : x.typing ? `<div class="msg bot typing">Thinking…</div>` : `<div class="msg bot${x.error ? ' err' : ''}">${x.h}${x.u || x.see || x.follow ? `<div class="acts">${x.follow ? `<button data-act="ask" data-q="Plan my week">Plan my week</button>` : ''}${x.see ? `<button data-act="tab" data-v="plan" class="phone-only">See the plan</button>` : ''}${x.u ? `<button data-act="undo" data-u="${x.u}">Undo</button>` : ''}</div>` : ''}</div>`).join('');
  m.scrollTop = m.scrollHeight;
  const chat = planningChat();
  document.getElementById('sugs').innerHTML = ['Plan my week', "What's at risk this week?", ...(MSGS.length ? ['Start over'] : [])].map(s => `<button data-act="${s === 'Start over' ? 'clear-chat' : 'ask'}" data-q="${esc(s)}">${esc(s)}</button>`).join('')
    + (chat ? `<a class="plan-chat" href="${esc(chat)}" target="_blank" rel="noopener" title="Open the Claude chat you plan with">Planning chat ↗</a>` : '');
}
