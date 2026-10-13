// "Ask Claude" panel. Signed in, questions go to Claude with the planner's
// current state; in sample mode a few scripted replies show the idea.
import * as store from './store.js';
import { eventsOn, timedOn } from './calendar.js';
import { add, DAYL, dayShort, esc, fmtDur, fmtT, lsGet, lsSet, nowMin, pd, today, weekStart } from './util.js';
import { children, dayItems, hasKids, isDone, leaves, node, progress, rootOf, unscheduled } from './tree.js';

let ctx = { cloud: false, client: null, anchor: () => today(), showPlan: () => {}, render: () => {} };
const MSGS = lsGet('daybook-chat', []).filter(m => !m.typing).map(m => ({ ...m, u: null }));
const UNDO = {}; let uSeq = 0;

export function initAI(c) { ctx = { ...ctx, ...c }; renderMsgs(); }
export function clearChat() { MSGS.length = 0; persist(); renderMsgs(); }
function persist() { lsSet('daybook-chat', MSGS.filter(m => !m.typing).slice(-40).map(({ u, ...m }) => m)); }
const remember = () => { const k = 'u' + (++uSeq); UNDO[k] = store.snapshot(); return k; };
export function undo(k) { if (!UNDO[k]) return false; store.restore(UNDO[k]); delete UNDO[k]; return true; }

export async function ask(q) {
  MSGS.push({ me: q }); const typing = { typing: true }; MSGS.push(typing); renderMsgs();
  let out;
  try { out = ctx.cloud ? await askClaude(q) : await new Promise(r => setTimeout(() => r(scripted(q)), 600)); }
  catch (e) { console.warn(e); out = { h: `<p>${esc(e.message || "I couldn't reach Claude. Check your connection and try again.")}</p>`, error: true }; }
  MSGS.splice(MSGS.indexOf(typing), 1); MSGS.push(out); persist(); renderMsgs(); ctx.render();
}

/* Real Claude */
function plannerState() {
  const T = today();
  const items = store.all().map(n => {
    const o = { id: n.id, title: n.t, parent_id: n.p, done: !!n.done };
    if (hasKids(n.id) || n.c) { const p = progress(n.id); o.progress = `${p.done}/${p.total}`; }
    if (n.d) o.day = n.d;
    if (n.s != null) o.start_min = n.s;
    o.duration_min = n.m || 60;
    if (n.due) o.due = n.due;
    if (n.notes) o.notes = n.notes.slice(0, 500);
    if (n.link) o.link = n.link;
    return o;
  }).filter(o => !o.done || o.progress);
  const calendar_events = [];
  for (let i = -1; i < 14; i++) {
    const d = add(T, i);
    for (const e of eventsOn(d)) calendar_events.push(e.allDay ? { title: e.t, day: d, all_day: true } : { title: e.t, day: d, start_min: e.s, duration_min: e.m });
  }
  return { today: T, weekday: DAYL[pd(T).getDay()], now_min: nowMin(), viewing_week_of: weekStart(ctx.anchor()), items, calendar_events };
}
function history() {
  const h = [];
  for (let i = 0; i < MSGS.length; i++) {
    const m = MSGS[i];
    if (m.me && MSGS[i + 1]?.text) { h.push({ role: 'user', content: m.me }, { role: 'assistant', content: MSGS[i + 1].text }); }
  }
  return h.slice(-12);
}
async function askClaude(q) {
  const { data, error } = await ctx.client.functions.invoke('ask', { body: { question: q, history: history(), state: plannerState() } });
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
  let count = 0; const valid = id => id && node(id);
  for (const a of actions) {
    const m = a.duration_min && a.duration_min >= 5 ? Math.min(a.duration_min, 1440) : null;
    const s = Number.isInteger(a.start_min) && a.start_min >= 0 && a.start_min < 1440 ? a.start_min : null;
    const day = /^\d{4}-\d{2}-\d{2}$/.test(a.day || '') ? a.day : null;
    if (a.type === 'schedule' && valid(a.id)) { store.update(a.id, { d: day, s: day ? s : null, ...(m ? { m } : {}) }, true); count++; }
    else if (a.type === 'add_task' && a.title) { store.create({ t: a.title, p: valid(a.parent_id) ? a.parent_id : null, d: day, s: day ? s : null, m: m || 60, notes: a.notes || null }); count++; }
    else if (a.type === 'add_steps' && valid(a.id)) { (a.steps || []).forEach((st, i) => { if (st.title) store.create({ t: st.title, p: a.id, m: Math.max(5, st.duration_min || 30), o: Date.now() / 1000 + i }); count++; }); store.update(a.id, { done: false }, true); }
    else if (a.type === 'rename' && valid(a.id) && a.title) { store.update(a.id, { t: a.title }, true); count++; }
    else if (a.type === 'set_notes' && valid(a.id)) { store.update(a.id, { notes: a.notes || null }, true); count++; }
    else if (a.type === 'set_due' && valid(a.id)) { store.update(a.id, { due: day }, true); count++; }
  }
  if (count) store.updateMany([]);
  return count;
}

/* Scripted replies for sample mode */
function busy(d) { return [...timedOn(d).map(e => [e.s, e.s + e.m]), ...store.all().filter(n => n.d === d && n.s != null && !isDone(n)).map(n => [n.s, n.s + (n.m || 60)])].sort((a, b) => a[0] - b[0]); }
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
  for (const n of pulled) { const d = (work.length ? work : days).slice().sort((a, b) => freeMin(b) - freeMin(a))[0]; if (!d) continue; const s = findSlot(d, n.m || 60); if (s == null) continue; store.update(n.id, { d, s }, true); (placed[d] = placed[d] || []).push(n); count++; }
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
  for (const d of weekDays()) { const t = dayItems(d).filter(n => !isDone(n) && !hasKids(n.id)).reduce((a, n) => a + (n.m || 60), 0); const f = freeMin(d) + store.all().filter(n => n.d === d && n.s != null && !isDone(n) && n.s >= 540 && n.s < 1080).reduce((a, n) => a + (n.m || 60), 0); if (t > f) out.push(`<li><b>${dayShort(d)}</b> has ${fmtDur(t)} of tasks but about ${fmtDur(f)} of open time between 9 and 6.</li>`); }
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
    m.innerHTML = `<div class="msg ai"><p>${open ? `You have ${open} open tasks, and ${unscheduled().length} of them don't have a day yet.` : 'Add a few projects and tasks, then ask me to plan them out.'}</p><p>Ask me to plan your week, break a task into steps, or check what's at risk.</p></div>`;
  } else m.innerHTML = MSGS.map(x => x.me ? `<div class="msg me">${esc(x.me)}</div>` : x.typing ? `<div class="msg ai typing">Thinking…</div>` : `<div class="msg ai${x.error ? ' err' : ''}">${x.h}${x.u || x.see || x.follow ? `<div class="acts">${x.follow ? `<button data-act="ask" data-q="Plan my week">Plan my week</button>` : ''}${x.see ? `<button data-act="tab" data-v="plan" class="phone-only">See the plan</button>` : ''}${x.u ? `<button data-act="undo" data-u="${x.u}">Undo</button>` : ''}</div>` : ''}</div>`).join('');
  m.scrollTop = m.scrollHeight;
  document.getElementById('sugs').innerHTML = ['Plan my week', "What's at risk this week?", ...(MSGS.length ? ['Start over'] : [])].map(s => `<button data-act="${s === 'Start over' ? 'clear-chat' : 'ask'}" data-q="${esc(s)}">${esc(s)}</button>`).join('');
}
