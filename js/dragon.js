// Task Dragon: the day played as a slow battle against a trash-talking dragon (spec: "Task Dragon: game spec").
// Every quest on the day carries its gold and rides the timeline up into his jaws. At the end of its slot it's
// in his jaws for the grace time, then CHOMP: he eats its gold. Finished in time, the gold is yours; finished
// after he ate it, you chase down half. The day is three rounds (morning, afternoon, evening): keep 70% of a
// round's gold to win it. At bedtime he gives his verdict: he starves, you drive him off, or he's stuffed.
// Like Hold the Keep, nearly everything is worked out from the plan itself. Quests with no time go back to back
// in the free time after the day starts (your wake time, or the first open that day), in your list order.
// Stored: the day you began, each day's first open, your wake and bed times, and the gold carried over from the keep.
import * as store from './store.js';
import { questsOn, gold, deadline, streakOf } from './quest.js';
import { timedOn } from './calendar.js';
import { add, lsGet, lsSet, pd, today, nowMin, daysBetween } from './util.js';

const KEY = 'daybook-dragon';
export const WIN = 0.7;
let client = null, me = null, onUpdate = () => {};
let D = { start: null, startMin: null, open: {}, wake: 8 * 60, bed: 22 * 60 + 30, carry: null, ...lsGet(KEY, {}) };
D.open = D.open || {};
const save = () => lsSet(KEY, D);
const sync = () => { if (client && me) client.auth.updateUser({ data: { dragon: D } }).then(({ data }) => { if (data?.user) me = data.user; }).catch(() => {}); };

export function init(o) { client = o.client ?? client; onUpdate = o.update ?? onUpdate; }
/** The day the fight began, kept on the account so every device agrees. carry: gold brought over from Hold the Keep. */
export function begin(u, carry = 0) {
  me = u || null;
  const theirs = u?.user_metadata?.dragon;
  if (theirs?.start && (!D.start || theirs.start < D.start || (theirs.start === D.start && (theirs.startMin ?? 0) < (D.startMin ?? 0)))) { D.start = theirs.start; D.startMin = theirs.startMin; D.carry = theirs.carry ?? D.carry; }
  if (theirs) { for (const [d, m] of Object.entries(theirs.open || {})) D.open[d] = Math.min(m, D.open[d] ?? 1e4); if (theirs.wake != null) D.wake = theirs.wake; if (theirs.bed != null) D.bed = theirs.bed; }
  const T = today(); let changed = false;
  if (!D.start) { D.start = T; D.startMin = nowMin(); changed = true; }
  if (D.carry == null && carry) { D.carry = carry; changed = true; } // only once the keep's data has loaded
  if (D.open[T] == null && nowMin() >= D.wake - 120) { D.open[T] = nowMin(); changed = true; } // the day starts the first time you look after waking
  for (const k of Object.keys(D.open)) if (daysBetween(k, T) > 40) delete D.open[k];
  save(); if (changed || JSON.stringify(theirs) !== JSON.stringify(D)) sync();
}
export const started = () => D.start;
export const times = () => ({ wake: D.wake, bed: D.bed });
export function setTimes(t) { if (t.wake != null) D.wake = t.wake; if (t.bed != null) D.bed = t.bed; save(); sync(); onUpdate(); }

/** The three rounds. Evening ends at bedtime. */
export const rounds = () => [{ id: 'morning', name: 'Morning', end: 12 * 60 }, { id: 'afternoon', name: 'Afternoon', end: 17 * 60 }, { id: 'evening', name: 'Evening', end: D.bed }];
const roundOf = e => e <= 12 * 60 ? 0 : e <= 17 * 60 ? 1 : 2;
/** Grace in his jaws shrinks with your run of days he didn't win: 60, then 45 at 3, 30 at 7, 15 at 14. */
export const HUNTS = [{ at: 0, grace: 60, n: 'Dozing' }, { at: 3, grace: 45, n: 'Prowling' }, { at: 7, grace: 30, n: 'Hunting' }, { at: 14, grace: 15, n: 'Relentless' }];
const huntAt = run => HUNTS.filter(h => run >= h.at).pop();
/** Habits pay a flat 10, and more as their streak grows foil: bronze at 5 days, silver at 10, gold at 30. */
export const FOILS = [{ at: 0, n: '', b: 0 }, { at: 5, n: 'bronze', b: 1 }, { at: 10, n: 'silver', b: 2 }, { at: 30, n: 'gold', b: 3 }];
const foilOf = run => FOILS.filter(f => run >= f.at).pop();

const doneAt = n => { const e = (n.tl || []).filter(x => x.end).pop(); return e ? new Date(e.end) : null; };
const minOf = (t, d) => t ? Math.round((t - pd(d)) / 60000) : null; // minutes after day d's midnight (can run past 1440)
/** The day's start: the first open after waking (or when you began, on day one), never before your wake time. */
const dayStart = d => Math.max(D.wake, D.open[d] ?? D.wake, d === D.start ? (D.startMin ?? 0) : 0);

/** Day d's quests in timeline order, each with its slot (s0..e), the minute he eats it (by), its round and gold.
    Yesterday's unfinished one-off quests come back as leftovers worth half. */
export function dealOn(d, grace) {
  const own = questsOn(d).map(q => ({ ...q, left: false }));
  const prev = add(d, -1);
  const left = prev >= (D.start || d) ? questsOn(prev).filter(q => !q.done && !q.n.rs && !q.n.r).map(q => ({ ...q, s: null, left: true })) : [];
  const L = left.concat(own);
  const busy = [...timedOn(d).map(e => [e.s, e.s + e.m]), ...L.filter(q => q.s != null).map(q => [q.s, q.s + q.m])].sort((a, b) => a[0] - b[0]);
  let cur = dayStart(d);
  for (const q of L) {
    if (q.s != null) { q.s0 = q.s; q.soft = false; }
    else { // the earliest free stretch long enough, after the one before it
      let s = cur;
      for (let k = 0; k < 40; k++) { const hit = busy.find(([a, b]) => s < b && s + q.m > a); if (!hit) break; s = hit[1]; }
      q.s0 = Math.min(s, D.bed - Math.min(q.m, 30)); q.soft = true; cur = q.s0 + q.m;
    }
    q.e = Math.min(q.s0 + q.m, D.bed);
    q.by = Math.min(deadline(d, q.s0, q.m, grace) ?? D.bed, D.bed);
    q.r = roundOf(q.e);
    if (q.n.rs) { const run = streakOf(q.n.rs, d, 40); q.foil = foilOf(run); q.run = run; q.g = 10 + q.foil.b; }
    else q.g = q.left ? Math.max(1, Math.ceil(gold(q.m) / 2)) : gold(q.m);
  }
  return L.sort((a, b) => a.s0 - b.s0 || (a.left ? -1 : 0) - (b.left ? -1 : 0));
}
/** How each quest stands at minute `now` of day d (1e5 for a day that's over, -1 for one still ahead). */
function judge(q, d, now) {
  const t = q.done ? minOf(doneAt(q.n), d) : null;
  if (q.done) q.st = t == null || t <= q.by ? 'kept' : 'late';
  else q.st = now > q.by ? 'eaten' : now > q.e ? 'jaws' : 'open';
  q.you = q.st === 'kept' ? q.g : q.st === 'late' ? Math.ceil(q.g / 2) : 0;
  q.him = q.st === 'eaten' ? q.g : q.st === 'late' ? q.g - q.you : 0;
  return q;
}
/** One day: its quests, its three rounds and, once bedtime has passed, the verdict. */
export function dayOf(d, grace, now) {
  const Qs = dealOn(d, grace).map(q => judge(q, d, now));
  const R = rounds().map((x, i) => {
    const L = Qs.filter(q => q.r === i), total = L.reduce((a, q) => a + q.g, 0), kept = L.reduce((a, q) => a + q.you, 0), lost = L.reduce((a, q) => a + q.him, 0);
    const over = now >= x.end, still = L.filter(q => q.st === 'open' || q.st === 'jaws').reduce((a, q) => a + q.g, 0);
    const won = total > 0 && kept >= total * WIN, dead = total > 0 && kept + still < total * WIN;
    return { ...x, i, total, kept, lost, need: Math.ceil(total * WIN), over, live: !over && (i === 0 || now >= rounds()[i - 1].end), res: !total ? 'none' : over || won || dead ? (won ? 'won' : 'lost') : 'open' };
  });
  const total = Qs.reduce((a, q) => a + q.g, 0), you = Qs.reduce((a, q) => a + q.you, 0), him = Qs.reduce((a, q) => a + q.him, 0);
  const played = R.filter(x => x.res !== 'none'), wins = played.filter(x => x.res === 'won').length;
  const rest = !Qs.length, closed = now >= D.bed;
  const verdict = rest ? 'rest' : wins === played.length && you === total ? 'starves' : wins >= Math.min(2, played.length) ? 'driven' : 'stuffed';
  return { d, Qs, R, total, you, him, wins, played: played.length, rest, closed, verdict };
}
/** The whole fight so far: every day since you began, today live, your gold, his belly and your run. */
export function state() {
  const T = today(), start = D.start || T, days = [];
  let run = 0, gold = D.carry || 0, belly = 0;
  for (let d = start; d <= T; d = add(d, 1)) {
    const H = huntAt(run), r = dayOf(d, H.grace, d < T ? 1e5 : nowMin());
    r.hunt = H; r.run = run; days.push(r);
    gold += r.you; belly += r.him;
    if (d < T && !r.rest) run = r.verdict === 'stuffed' ? 0 : run + 1;
  }
  const H = huntAt(run);
  return { start, days, today: days[days.length - 1], gold, belly, run, hunt: H, bed: D.bed, wake: D.wake, byDay: new Map(days.map(x => [x.d, x])) };
}
/** A day before you began, or still ahead: judged at its start. */
export const dayView = (d, S) => S.byDay.get(d) || dayOf(d, S.hunt.grace, d > today() ? -1 : 1e5);
