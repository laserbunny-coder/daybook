// Area time: a block of time for a whole area or project ("Filmmaking, 9 to 12"), as opposed to one task.
// A block is an item of kind 'block' whose fo names the area or project. It can repeat like a task and it records
// time like one, but it's never checked off: it fills with the time really worked in it. That's the time recorded on
// the block itself, plus time recorded on anything in its area or project while the block was on.
// A block that's over with nothing recorded asks once whether it happened (did it, part of it, skipped).
// An area can also have a rough number of hours a week (wk, in minutes); its bar shows hours worked and still planned.
import * as store from './store.js';
import * as track from './track.js';
import { add, pd, today, weekStart } from './util.js';
import { children, hasKids, isDone, leaves, rootOf, targetOf, within } from './tree.js';
import { weekTarget } from './areaday.js';

const MIN = 60000;
export const dayOf = b => b.oc || b.d;
/** When a block runs, in ms. A block with no time takes the whole day. */
export function windowOf(b) {
  const a = pd(dayOf(b));
  if (b.s == null) return [a.getTime(), a.getTime() + 864e5];
  a.setMinutes(b.s); return [a.getTime(), a.getTime() + (b.m || 60) * MIN];
}
const overlap = (e, a, z) => { const s = Date.parse(e.start), f = e.end ? Date.parse(e.end) : Date.now(); return Math.max(0, Math.min(f, z) - Math.max(s, a)) / MIN; };
/** Minutes worked in a block. */
export function worked(b) {
  const [a, z] = windowOf(b); let m = 0;
  for (const n of store.logged()) {
    if (n.id === b.id) { m += n.tl.reduce((t, e) => t + track.mins(e), 0); continue; }
    if (n.k === 'block' || !within(n, b.fo)) continue;
    for (const e of n.tl) m += overlap(e, a, z);
  }
  return Math.round(m);
}
/** Whether something in the block's area or project is recording right now, during the block. */
export function live(b) {
  const r = track.running(); if (!r) return false;
  if (r.id === b.id) return true;
  const [a, z] = windowOf(b), now = Date.now();
  return r.k !== 'block' && within(r, b.fo) && now >= a && now < z;
}
/** Tasks of its area or project checked off while the block was on (a finished task sits where it was really done). */
export function doneIn(b) {
  const [a, z] = windowOf(b), day = dayOf(b), t0 = pd(day).getTime();
  return store.all().filter(n => n.done && !hasKids(n.id) && n.d === day && n.s != null && within(n, b.fo) && (e => e > a && e <= z + 15 * MIN)(t0 + (n.s + (n.m || 0)) * MIN));
}
export const isPast = b => windowOf(b)[1] <= Date.now();
export const isNow = b => { const [a, z] = windowOf(b), t = Date.now(); return b.s != null && t >= a && t < z; };
/** A block that's over, with nothing recorded and no answer yet: it asks whether it happened. Only for the last two weeks. */
export const asks = b => b.s != null && !b.done && isPast(b) && dayOf(b) >= add(today(), -14) && worked(b) === 0;
/** Answers for a block that's over: it happened (all of it or part), so its time counts; or it was skipped. */
export function answer(b, how) {
  if (how === 'skip') { store.update(b.id, { done: true }); return; }
  const [a, z] = windowOf(b), m = how === 'part' ? Math.round((z - a) / MIN / 2) : (z - a) / MIN;
  store.update(b.id, { tl: [...(b.tl || []), { start: new Date(a).toISOString(), end: new Date(a + m * MIN).toISOString(), guess: true }] });
}

/* What's inside a block: a card for each project of the area (or each part of the project), with its open steps in
   order, plus the loose tasks. Each card knows when it was last worked on. */
const lastWorked = g => { let t = 0; for (const n of store.logged()) if (n.k !== 'block' && within(n, g.id)) for (const e of n.tl) t = Math.max(t, e.end ? Date.parse(e.end) : Date.now()); return t || null; };
const openOf = g => leaves(g.id).filter(l => l.id !== g.id && !l.done && !l.r);
export function inside(b) {
  const t = targetOf(b); if (!t) return { t: null, cards: [], loose: [] };
  let groups, loose;
  if (t.k === 'area') {
    const roots = store.all().filter(n => n.p == null && n.ar === t.id).sort((x, y) => x.o - y.o);
    groups = roots.filter(n => hasKids(n.id)); loose = roots.filter(n => !hasKids(n.id) && !n.c && !n.done && !n.r);
  } else {
    const kids = children(t.id); groups = kids.filter(k => hasKids(k.id)); loose = kids.filter(k => !hasKids(k.id) && !k.done && !k.r);
    if (!groups.length) { groups = [t]; loose = []; } // a project without parts is one card
  }
  const cards = groups.filter(g => !isDone(g)).map(g => ({ g, open: openOf(g), last: lastWorked(g) })).filter(c => c.open.length);
  return { t, cards, loose };
}
/** Where to start: something planned for today or overdue first, then whatever is due soonest (within two weeks). */
export function suggest(b) {
  const { cards, loose } = inside(b), T = today(), soon = add(T, 14);
  const all = cards.map(c => c.open[0]).concat(loose);
  const dueOf = n => n.due || [...ancestorsDue(n)].sort()[0] || null;
  const pick = all.filter(n => n.d && n.d <= T).sort((x, y) => (x.d < y.d ? -1 : 1))[0];
  if (pick) return { n: pick, why: pick.d < T ? 'overdue' : 'planned for today' };
  const due = all.map(n => ({ n, due: dueOf(n) })).filter(x => x.due && x.due <= soon).sort((x, y) => (x.due < y.due ? -1 : 1))[0];
  return due ? { n: due.n, due: due.due } : null;
}
function* ancestorsDue(n) { let p = n.p && store.get(n.p); while (p) { if (p.due) yield p.due; p = p.p && store.get(p.p); } }

/* Hours a week per area */
const areaOfItem = n => { const r = rootOf(n); return r.k === 'area' ? r.id : r.ar || null; };
const inArea = (n, id) => { if (n.k === 'block') { const t = targetOf(n); return !!t && (t.id === id || areaOfItem(t) === id); } return areaOfItem(n) === id; };
/** This week (Monday to Sunday) for an area: minutes worked, minutes of blocks still to come, and the rough target. */
export function week(id, at = today()) {
  const w = weekStart(at), w0 = pd(w).getTime(), w1 = pd(add(w, 7)).getTime(), now = Date.now(); let done = 0, ahead = 0;
  for (const n of store.logged()) if (inArea(n.rs ? store.get(n.rs) || n : n, id)) for (const e of n.tl) done += overlap(e, w0, w1);
  for (let i = 0, d = w; i < 7; i++, d = add(d, 1)) for (const b of store.blocksOn(d)) if (b.s != null && !b.done && inArea(b, id)) { const [a, z] = windowOf(b); if (z > now) ahead += (z - Math.max(a, now)) / MIN; }
  const a = store.get(id); // hours per day, added up for the week; else the older rough weekly number
  return { done: Math.round(done), ahead: Math.round(ahead), target: weekTarget(a) || a?.wk || null };
}
