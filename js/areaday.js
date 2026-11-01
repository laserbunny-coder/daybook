// Daily area targets: each area can have a number of hours for each day of the week (dg, minutes by weekday,
// such as { mon: 180, wed: 0 }), plus a hint for when in the day it fits best (tp: morning, afternoon or evening).
// A day's area cards show the target and the time logged so far. Time counts for an area when it's recorded on the
// area itself (its own ▶, as often as you like in a day), on anything inside it, or on a block for it.
import * as store from './store.js';
import * as track from './track.js';
import { add, pd } from './util.js';
import { rootOf, targetOf } from './tree.js';

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const PREFS = ['morning', 'afternoon', 'evening'];
const MIN = 60000;
export const keyOf = d => DAYS[pd(d).getDay()];
export const areas = () => store.areas();
// A date key (YYYY-MM-DD) in the same object overrides that weekday's target for that day only (0 = none that day)
const pick = (o, d) => o && d in o ? o[d] : o?.[keyOf(d)];
export const targetOn = (a, d) => Math.max(0, +(pick(a?.dg, d) || 0));
export const isOverride = (o, d) => !!o && d in o;
/** The week's target from Monday w: each day's target, overrides included. Without w, the usual weekdays. */
export const weekTarget = (a, w) => !a?.dg ? null : (w ? [0, 1, 2, 3, 4, 5, 6].reduce((t, i) => t + targetOn(a, add(w, i)), 0) : ORDER.reduce((t, k) => t + Math.max(0, +(a.dg[k] || 0)), 0)) || null;

// Which area an item's time belongs to (a repeat counts where its series lives, a block where its area or project is)
function areaOf(n) {
  let h = n.rs ? store.get(n.rs) || n : n;
  if (h.k === 'block') { h = targetOf(h); if (!h) return null; }
  const r = rootOf(h);
  return r.k === 'area' ? r.id : r.ar || null;
}
const overlap = (e, a, z) => { const s = Date.parse(e.start), f = e.end ? Date.parse(e.end) : Date.now(); return Math.max(0, Math.min(f, z) - Math.max(s, a)) / MIN; };

/** Time logged on a day, by area: { [areaId]: { min, hb (habits' share), items: Map(itemId -> min) } }. Guessed stretches count. */
export function loggedOn(d) {
  const a = pd(d).getTime(), z = pd(add(d, 1)).getTime(), out = {};
  for (const n of store.logged()) {
    const id = areaOf(n); if (!id) continue;
    let m = 0; for (const e of n.tl) m += overlap(e, a, z);
    if (m <= 0) continue;
    const o = out[id] || (out[id] = { min: 0, hb: 0, items: new Map() });
    o.min += m; if ((n.rs ? store.get(n.rs) : n)?.hb) o.hb += m; // habit time counts in its area too
    const host = n.rs ? n.rs : n.id; o.items.set(host, (o.items.get(host) || 0) + m);
  }
  return out;
}
/** A day's area cards: every area with a target that day or time logged, morning ones first. */
export function cardsOn(d) {
  const L = loggedOn(d), pr = a => a.tp ? PREFS.indexOf(a.tp) : 1;
  const cards = areas().map(a => ({ a, target: targetOn(a, d), min: Math.round(L[a.id]?.min || 0), hb: Math.round(L[a.id]?.hb || 0) }))
    .filter(c => c.target > 0 || c.min > 0)
    .sort((x, y) => (x.target > 0 ? 0 : 1) - (y.target > 0 ? 0 : 1) || pr(x.a) - pr(y.a) || (x.a.o ?? 0) - (y.a.o ?? 0));
  return cards;
}
/** Whether the area was marked done for that day (dd: a list of dates). */
export const doneOn = (a, d) => !!a?.dd?.includes(d);
/** dd with that day marked done or not; dates older than 120 days are dropped. */
export function withDone(a, d, on) {
  const cut = add(d, -120), s = new Set((a?.dd || []).filter(x => x >= cut));
  if (on) s.add(d); else s.delete(d);
  return s.size ? [...s].sort() : null;
}
/** Whether the area's own timer is running (as opposed to a task in it). */
export const areaRec = id => track.isRec(store.get(id));
/** Whether anything in the area is recording now. */
export const live = id => { const r = track.running(); return !!r && areaOf(r) === id; };
