// Task Dragon: the day played as a slow battle against a trash-talking dragon (spec: "Task Dragon: game spec").
// Every quest on the day carries its gold and rides the timeline up into his jaws. At the end of its slot it's
// in his jaws for the grace time, then CHOMP: he eats its gold. Finished in time, the gold is yours; finished
// after he ate it, you chase down half. The day is three rounds (morning, afternoon, evening): keep 70% of a
// round's gold to win it. At bedtime he gives his verdict: he starves, you drive him off, or he's stuffed.
// Like Hold the Keep, nearly everything is worked out from the plan itself. Quests with no time go back to back
// in the free time after the day starts (your wake time, or the first open that day), in your list order.
// Cards bend the day: each dawn three powers are dealt from your deck. Some are scheduling moves made on the plan
// itself (Swap, Send back, Split); the rest change the game only (Shield, Lure, Bet). He plays too: one swoop a round
// on the richest quest in his jaws at that minute, and his mark on one quest, worth double if you save it.
// Stored: the day you began, each day's first open, your wake and bed times, the gold carried over from the keep,
// your deck, and the cards played each day.
import * as store from './store.js';
import { questsOn, gold, deadline, streakOf } from './quest.js';
import { timedOn } from './calendar.js';
import { add, lsGet, lsSet, pd, today, nowMin, daysBetween } from './util.js';

const KEY = 'daybook-dragon';
export const WIN = 0.7;
let client = null, me = null, onUpdate = () => {};
let D = { start: null, startMin: null, open: {}, wake: 8 * 60, bed: 22 * 60 + 30, carry: null, ...lsGet(KEY, {}) };
D.open = D.open || {}; D.played = D.played || {}; D.deck = D.deck || null;
const save = () => lsSet(KEY, D);
const sync = () => { if (client && me) client.auth.updateUser({ data: { dragon: D } }).then(({ data }) => { if (data?.user) me = data.user; }).catch(() => {}); };

export function init(o) { client = o.client ?? client; onUpdate = o.update ?? onUpdate; }
/** The day the fight began, kept on the account so every device agrees. carry: gold brought over from Hold the Keep. */
export function begin(u, carry = 0) {
  me = u || null;
  const theirs = u?.user_metadata?.dragon;
  if (theirs?.start && (!D.start || theirs.start < D.start || (theirs.start === D.start && (theirs.startMin ?? 0) < (D.startMin ?? 0)))) { D.start = theirs.start; D.startMin = theirs.startMin; D.carry = theirs.carry ?? D.carry; }
  if (theirs) {
    for (const [d, m] of Object.entries(theirs.open || {})) D.open[d] = Math.min(m, D.open[d] ?? 1e4);
    if (theirs.wake != null) D.wake = theirs.wake; if (theirs.bed != null) D.bed = theirs.bed;
    for (const [d, L] of Object.entries(theirs.played || {})) { const mine = D.played[d] || []; D.played[d] = mine.concat(L.filter(p => !mine.some(x => x.t === p.t))).sort((a, b) => a.t - b.t); } // cards played on any device
    if (theirs.deck && (!D.deck || theirs.deck.length > D.deck.length)) D.deck = theirs.deck;
    D.marks = { ...(theirs.marks || {}), ...(D.marks || {}) };
  }
  const T = today(); let changed = false;
  if (!D.start) { D.start = T; D.startMin = nowMin(); changed = true; }
  if (D.carry == null && carry) { D.carry = carry; changed = true; } // only once the keep's data has loaded
  if (D.open[T] == null && nowMin() >= D.wake - 120) { D.open[T] = nowMin(); changed = true; } // the day starts the first time you look after waking
  if (!D.deck) { D.deck = STARTER.slice(); changed = true; }
  for (const k of Object.keys(D.open)) if (daysBetween(k, T) > 40) delete D.open[k];
  for (const k of Object.keys(D.played)) if (daysBetween(k, T) > 40) delete D.played[k];
  save(); if (changed || JSON.stringify(theirs) !== JSON.stringify(D)) sync();
}
export const started = () => D.start;
export const times = () => ({ wake: D.wake, bed: D.bed });
export function setTimes(t) { if (t.wake != null) D.wake = t.wake; if (t.bed != null) D.bed = t.bed; save(); sync(); onUpdate(); }

/* ---------- cards ---------- */
/** Every card. aim: what you tap after it (0 = plays at once, 1 = one quest, 2 = two quests). */
export const CARDS = {
  shield: { n: 'Shield', t: 'One quest stays in his jaws an hour longer, and he can\'t swoop on it.', aim: 1 },
  swap: { n: 'Swap', t: 'Two quests trade places, even close ones.', aim: 2 },
  back: { n: 'Send back', t: 'One quest goes to the end of today, free. Already last? Tomorrow.', aim: 1 },
  lure: { n: 'Lure', t: 'Everything still coming backs off 30 minutes.', aim: 0 },
  bet: { n: 'Bet', t: 'Save the next 3 quests on time for double. Miss one and he takes their gold.', aim: 0 },
  split: { n: 'Split', t: 'Cut a big quest in two halves, each with half the gold and its own time.', aim: 1 }
};
const STARTER = ['shield', 'swap', 'back', 'lure', 'bet', 'split'];
export const HAND = 3;
/** Where an item sits in its day's list (the same key questsOn sorts by). */
export const orderOf = n => n.ds ?? n.o ?? 0;
const seedOf = s => Math.abs([...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7));
/** Day d's hand: three cards dealt from your deck, the same on every device, less the ones already played. */
export function handOn(d) {
  const deck = (D.deck || STARTER).slice(), out = [];
  let h = seedOf(d + 'deal');
  while (out.length < HAND && deck.length) { h = (h * 16807) % 2147483647; out.push(deck.splice(h % deck.length, 1)[0]); }
  const used = (D.played[d] || []).map(p => p.c);
  return out.map((c, i) => ({ c, i, ...CARDS[c], used: used.includes(c) }));
}
export const playedOn = d => D.played[d] || [];
/** Plays a card from today's hand on the given quests (their ids). The plan-changing cards edit the plan here. */
export function play(c, ids = [], ctx = {}) {
  const T = today(), card = CARDS[c]; if (!card || !handOn(T).some(h => h.c === c && !h.used)) return false;
  const m = nowMin(), deal = ctx.deal || [];
  const q = id => deal.find(x => x.n.id === id);
  if (c === 'swap') {
    const [a, b] = ids.map(q); if (!a || !b || a === b) return false;
    const pa = { s: a.s, ds: orderOf(a.n) }, pb = { s: b.s, ds: orderOf(b.n) };
    store.updateMany([[a.n.id, { s: pb.s, ds: pb.ds }], [b.n.id, { s: pa.s, ds: pa.ds }]]);
  } else if (c === 'back') {
    const a = q(ids[0]); if (!a) return false;
    const last = deal.filter(x => !x.done).pop();
    if (last && last !== a) store.update(a.n.id, { s: null, ds: Math.max(...deal.map(x => orderOf(x.n))) + 1 });
    else store.update(a.n.id, { d: add(T, 1), s: null });
  } else if (c === 'split') {
    const a = q(ids[0]); if (!a || a.m < 20 || a.n.rs) return false;
    const half = Math.round(a.m / 2 / 5) * 5;
    store.update(a.n.id, { m: half, t: a.n.t + ' (part 1)' });
    store.create({ t: a.n.t + ' (part 2)', d: T, s: a.s != null ? a.s + half : null, m: a.m - half, p: a.n.p ?? null, ar: a.n.ar ?? null, ds: orderOf(a.n) + 0.5 });
  }
  const bet = c === 'bet' ? deal.filter(x => !x.done && x.st !== 'eaten').slice(0, 3).map(x => x.n.id) : null;
  const lure = c === 'lure' ? deal.filter(x => !x.done && x.st !== 'eaten').map(x => x.n.id) : null;
  (D.played[T] = D.played[T] || []).push({ c, ids: bet || lure || ids, at: m, t: Date.now() });
  save(); sync(); onUpdate(); return true;
}

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
    for (const p of D.played[d] || []) {
      if (!p.ids.includes(q.n.id)) continue;
      if (p.c === 'shield') { q.by = Math.min(q.by + 60, D.bed); q.shield = true; }
      else if (p.c === 'lure' && q.e > p.at - 1) { q.e = Math.min(q.e + 30, D.bed); q.by = Math.min(q.by + 30, D.bed); q.lured = true; }
      else if (p.c === 'bet') q.bet = true;
    }
    q.r = roundOf(q.e);
    if (q.n.rs) { const run = streakOf(q.n.rs, d, 40); q.foil = foilOf(run); q.run = run; q.g = 10 + q.foil.b; }
    else q.g = q.left ? Math.max(1, Math.ceil(gold(q.m) / 2)) : gold(q.m);
  }
  return L.sort((a, b) => a.s0 - b.s0 || (a.left ? -1 : 0) - (b.left ? -1 : 0));
}
/** How each quest stands at minute `now` of day d (1e5 for a day that's over, -1 for one still ahead). */
function judge(q, d, now) {
  const t = q.done ? minOf(doneAt(q.n), d) : null;
  q.dm = t;
  if (q.done) q.st = t == null || t <= q.by ? 'kept' : 'late';
  else q.st = now > q.by ? 'eaten' : now > q.e ? 'jaws' : 'open';
  q.you = q.st === 'kept' ? q.g : q.st === 'late' ? Math.ceil(q.g / 2) : 0;
  q.him = q.st === 'eaten' ? q.g : q.st === 'late' ? q.g - q.you : 0;
  return q;
}
/** One day: its quests, its three rounds and, once bedtime has passed, the verdict. */
/** His three swoops: one a round, at a minute he picks at dawn (the same on every device). */
export function swoopsOn(d) {
  const h = seedOf(d + 'swoop'), win = [[9 * 60 + 30, 120], [13 * 60 + 30, 180], [18 * 60 + 30, Math.max(30, D.bed - 30 - (18 * 60 + 30))]];
  return win.map(([a, w], i) => a + Math.round(((h >> (i * 5)) % 97) / 97 * w / 5) * 5);
}
/** His mark: one quest a day (not a habit or a leftover), worth double if you save it. */
const markOf = (d, Qs) => {
  const was = D.marks?.[d] && Qs.find(q => q.n.id === D.marks[d]); if (was) return was; // once marked, it stays marked
  const L = Qs.filter(q => !q.n.rs && !q.left && q.g >= 10 && q.st === 'open'); if (!L.length || d !== today()) return null;
  const q = L[seedOf(d + 'mark') % L.length]; D.marks = { ...(D.marks || {}), [d]: q.n.id };
  for (const k of Object.keys(D.marks)) if (daysBetween(k, d) > 40) delete D.marks[k];
  save(); sync(); return q;
};
export function dayOf(d, grace, now) {
  const Qs = dealOn(d, grace).map(q => judge(q, d, now));
  // each swoop takes the richest unshielded quest in his jaws at that minute
  const sw = swoopsOn(d).map(t => {
    const L = Qs.filter(q => !q.shield && q.e <= t && t < q.by && (q.dm == null || q.dm > t));
    const v = L.sort((a, b) => b.g - a.g)[0];
    if (v) { v.by = t; v.swooped = true; judge(v, d, now); }
    return { t, q: v || null, past: now >= t };
  });
  const mk = markOf(d, Qs); if (mk) { mk.mark = true; if (mk.st === 'kept') mk.you += mk.g; }
  // a bet: all three saved in time pays double, one missed and he takes the lot
  const bet = Qs.filter(q => q.bet);
  if (bet.length) { const all = bet.every(q => q.st === 'kept'), lost = bet.some(q => q.st === 'eaten' || q.st === 'late');
    for (const q of bet) { if (all) q.you += q.g; else if (lost && q.st === 'kept') { q.him += q.you; q.you = 0; q.forfeit = true; } } }
  const R = rounds().map((x, i) => {
    const L = Qs.filter(q => q.r === i), total = L.reduce((a, q) => a + q.g, 0), kept = L.reduce((a, q) => a + q.you, 0), lost = L.reduce((a, q) => a + q.him, 0);
    const over = now >= x.end, still = L.filter(q => q.st === 'open' || q.st === 'jaws').reduce((a, q) => a + q.g, 0);
    const won = total > 0 && kept >= total * WIN, dead = total > 0 && kept + still < total * WIN;
    return { ...x, i, total, kept, lost, need: Math.ceil(total * WIN), over, live: !over && (i === 0 || now >= rounds()[i - 1].end), res: !total ? 'none' : over || won || dead ? (won ? 'won' : 'lost') : 'open' };
  });
  const total = Qs.reduce((a, q) => a + q.g, 0), you = Qs.reduce((a, q) => a + q.you, 0), him = Qs.reduce((a, q) => a + q.him, 0);
  const played = R.filter(x => x.res !== 'none'), wins = played.filter(x => x.res === 'won').length;
  const rest = !Qs.length, closed = now >= D.bed;
  const verdict = rest ? 'rest' : wins === played.length && Qs.every(q => q.st === 'kept') ? 'starves' : wins >= Math.min(2, played.length) ? 'driven' : 'stuffed';
  return { d, Qs, R, total, you, him, wins, played: played.length, rest, closed, verdict, swoops: sw, mark: mk, hand: handOn(d) };
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
