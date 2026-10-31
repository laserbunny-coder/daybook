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
import { children, colorOf, isDone, leaves, node, rootOf } from './tree.js';

const KEY = 'daybook-dragon';
export const WIN = 0.7;
let client = null, me = null, onUpdate = () => {};
let D = { start: null, startMin: null, open: {}, wake: 8 * 60, bed: 22 * 60 + 30, carry: null, ...lsGet(KEY, {}) };
D.open = D.open || {}; D.played = D.played || {}; D.deck = D.deck || null;
D.charms = D.charms || []; D.eq = D.eq || []; D.spent = D.spent || []; D.packs = D.packs || []; D.off = D.off || {}; D.dawn = D.dawn || {}; D.goals = D.goals || {}; D.hits = D.hits || {};
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
    const byT = (a, b) => [...a, ...b.filter(x => !a.some(y => y.t === x.t))].sort((x, y) => x.t - y.t); // purchases and packs from any device, once each
    D.spent = byT(D.spent, theirs.spent || []); D.packs = byT(D.packs, theirs.packs || []);
    for (const c of theirs.charms || []) if (!D.charms.includes(c)) D.charms.push(c);
    if ((theirs.eqT || 0) > (D.eqT || 0)) { D.eq = theirs.eq || []; D.eqT = theirs.eqT; }
    Object.assign(D.off, theirs.off || {}); Object.assign(D.dawn, theirs.dawn || {});
    for (const [d, M] of Object.entries(theirs.hits || {})) { const mine = D.hits[d] = D.hits[d] || {}; // strikes and flicks from any device
      for (const [id, h] of Object.entries(M)) mine[id] = { s: Math.max(mine[id]?.s || 0, h.s || 0), f: Math.max(mine[id]?.f || 0, h.f || 0) }; }
    for (const [id, g] of Object.entries(theirs.goals || {})) if (!D.goals[id] || (g.u || 0) > (D.goals[id].u || 0)) D.goals[id] = g; // goal dragons: the newest change wins
  }
  const T = today(); let changed = false;
  if (!D.start) { D.start = T; D.startMin = nowMin(); changed = true; }
  if (D.carry == null && carry) { D.carry = carry; changed = true; } // only once the keep's data has loaded
  if (D.open[T] == null && nowMin() >= D.wake - 120) { D.open[T] = nowMin(); changed = true; } // the day starts the first time you look after waking
  if (!D.deck) { D.deck = STARTER.slice(); changed = true; }
  for (const k of Object.keys(D.open)) if (daysBetween(k, T) > 40) delete D.open[k];
  for (const k of Object.keys(D.played)) if (daysBetween(k, T) > 40) delete D.played[k];
  for (const k of Object.keys(D.dawn)) if (daysBetween(k, T) > 10) delete D.dawn[k];
  for (const k of Object.keys(D.hits)) if (daysBetween(k, T) > 40) delete D.hits[k];
  save(); if (changed || JSON.stringify(theirs) !== JSON.stringify(D)) sync();
}
export const started = () => D.start;
export const times = () => ({ wake: D.wake, bed: D.bed });
export function setTimes(t) { if (t.wake != null) D.wake = t.wake; if (t.bed != null) D.bed = t.bed; save(); sync(); onUpdate(); }

/* ---------- cards ---------- */
/** Every card. aim: what you tap after it (0 = plays at once, 1 = one quest, 2 = two quests). */
export const CARDS = {
  shield: { n: 'Shield', t: 'One quest stays in his jaws an hour longer, and he can\'t swoop on it.', aim: 1 },
  swap: { n: 'Swap', t: 'Two quests trade time slots.', aim: 2, plan: true },
  back: { n: 'Send back', t: 'One quest moves after everything else today. Already last? Tomorrow.', aim: 1, plan: true },
  lure: { n: 'Lure', t: 'Everything still coming backs off 30 minutes.', aim: 0 },
  bet: { n: 'Bet', t: 'Save the next 3 quests on time for double. Miss one and he takes their gold.', aim: 0 },
  split: { n: 'Split', t: 'Cut a big quest in two halves, each with half the gold and its own time.', aim: 1, plan: true },
  wind: { n: 'Second Wind', t: 'One quest finished late pays its full gold instead of half.', aim: 1, comeback: true }
};
/** Charms sit there and change how gold counts. Up to three equipped. */
export const CHARMS = {
  early: { n: 'Early Bird', t: 'Quests finished before 9am pay ×1.5.', r: 'Common' },
  batch: { n: 'Batch', t: 'Two quests from the same area back to back: the second pays ×2.', r: 'Common' },
  iron: { n: 'Iron Habit', t: 'Habits on a 7+ day streak can\'t be swooped.', r: 'Rare' },
  ember: { n: 'Ember Raid', t: 'Every 3 saves in a row steal 10 gold back from his belly.', r: 'Rare' },
  calm: { n: 'Calm Before', t: 'Nothing in his jaws when a round ends: +20% for that round.', r: 'Rare' }
};
/** His cards: a stuffed day slips one into your deck (two at most); every day he doesn't win burns one. */
export const CURSES = {
  sloth: { n: 'Sloth', t: 'One quest a day starts half eaten.' }
}; // Fog (far quests face down) was dropped 2026-10-31: in a planner, hiding your own tasks costs too much
export const EQUIP = 3, PRICE = { card: 40, charm: 100 }, SELL = 5, PACK = 5;
const POOL = [...['shield', 'swap', 'back', 'lure', 'bet', 'split'].map(id => ({ k: 'card', id })), ...Object.keys(CHARMS).map(id => ({ k: 'charm', id }))];
export const itemOf = it => ({ ...it, ...(it.k === 'card' ? CARDS[it.id] : CHARMS[it.id]) });
const STARTER = ['shield', 'swap', 'back', 'lure', 'bet', 'split'];
export const HAND = 3;
/** Where an item sits in its day's list (the same key questsOn sorts by). */
export const orderOf = n => n.ds ?? n.o ?? 0;
const seedOf = s => Math.abs([...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7));
/** Day d's hand: three cards dealt from your deck, the same on every device, less the ones already played. */
export function handOn(d, comeback = false) {
  const deck = (D.deck || STARTER).slice(), out = [];
  // cards gained that day join tomorrow's deal, so buying one doesn't reshuffle the hand you're holding
  for (const id of [...D.spent.filter(x => x.d === d && x.k === 'card').map(x => x.id), ...D.packs.filter(p => p.d === d && CARDS[p.kept]).map(p => p.kept)]) { const j = deck.lastIndexOf(id); if (j >= 0) deck.splice(j, 1); }
  let h = seedOf(d + 'deal');
  while (out.length < HAND && deck.length) { h = (h * 16807) % 2147483647; out.push(deck.splice(h % deck.length, 1)[0]); }
  if (comeback) out.push('wind'); // two stuffed days in a row: a free Second Wind
  const P = D.played[d] || [];
  return out.map((c, i) => ({ c, i, ...CARDS[c], used: P.some(p => p.i === i || (p.i == null && p.c === c)) }));
}
export const playedOn = d => D.played[d] || [];
/** Plays a card from today's hand on the given quests (their ids). The plan-changing cards edit the plan here. */
/** What a plan-changing card would do to the plan, in words, before it's played. null when it can't be played there.
    Swap trades the two quests' slots: both take the other's start time (two untimed ones just trade order).
    Send back moves a quest after the last one today, keeping a time if it had one; already last, it goes to tomorrow.
    A leftover from yesterday that a card moves becomes today's. */
export function planOf(c, ids, deal) {
  const T = today(), q = id => deal.find(x => x.n.id === id), at = x => Math.round(x.s0 / 5) * 5;
  const here = x => x.left ? { d: T } : {}, name = x => x.n.t || 'Untitled';
  if (c === 'swap') {
    const [a, b] = ids.map(q); if (!a || !b || a === b) return null;
    const timed = a.s != null || b.s != null;
    const pa = { ...here(a), ds: orderOf(b.n), ...(timed ? { s: at(b) } : {}) }, pb = { ...here(b), ds: orderOf(a.n), ...(timed ? { s: at(a) } : {}) };
    return { changes: [[a.n.id, pa], [b.n.id, pb]], text: timed ? `${name(a)} moves to ${fmt(at(b))}, ${name(b)} moves to ${fmt(at(a))}.` : `${name(a)} and ${name(b)} trade places in your list.` };
  }
  if (c === 'back') {
    const a = q(ids[0]); if (!a) return null;
    const rest = deal.filter(x => !x.done && x !== a && x.st !== 'eaten'), last = rest[rest.length - 1];
    if (last && last.e > a.e) {
      const end = Math.max(...rest.map(x => x.e)), s = Math.min(Math.ceil(end / 5) * 5, D.bed - a.m);
      if (a.s != null && s > a.s0) return { changes: [[a.n.id, { ...here(a), s, ds: Math.max(...deal.map(x => orderOf(x.n))) + 1 }]], text: `${name(a)} moves from ${fmt(at(a))} to ${fmt(s)}, after everything else today.` };
      return { changes: [[a.n.id, { ...here(a), s: null, ds: Math.max(...deal.map(x => orderOf(x.n))) + 1 }]], text: `${name(a)} goes to the end of today's list.` };
    }
    return { changes: [[a.n.id, { d: add(T, 1), s: null }]], text: `${name(a)} moves to tomorrow, with no time set.` };
  }
  if (c === 'split') {
    const a = q(ids[0]); if (!a || a.m < 20 || a.n.rs) return null;
    const half = Math.round(a.m / 2 / 5) * 5;
    return { changes: [[a.n.id, { ...here(a), m: half, t: name(a) + ' (part 1)' }]], create: { t: name(a) + ' (part 2)', d: T, s: a.s != null ? at(a) + half : null, m: a.m - half, p: a.n.p ?? null, ar: a.n.ar ?? null, ds: orderOf(a.n) + 0.5 },
      text: `${name(a)} becomes two parts: ${half} minutes${a.s != null ? ` at ${fmt(at(a))}` : ''} and ${a.m - half} minutes${a.s != null ? ` at ${fmt(at(a) + half)}` : ''}.` };
  }
  return null;
}
const fmt = m => { let h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 && h < 24 ? 'pm' : 'am'; h = h % 12 || 12; return h + (mm ? ':' + String(mm).padStart(2, '0') : '') + ap; };
/** Plays a card from today's hand on the given quests (their ids). The plan-changing cards edit the plan here. */
export function play(c, ids = [], ctx = {}) {
  const T = today(), card = CARDS[c], slot = (ctx.hand || handOn(T)).find(h => h.c === c && !h.used); if (!card || !slot) return false;
  const m = nowMin(), deal = ctx.deal || [];
  if (card.plan) {
    const P = planOf(c, ids, deal); if (!P) return false;
    store.updateMany(P.changes); if (P.create) store.create(P.create);
  }
  const bet = c === 'bet' ? deal.filter(x => !x.done && x.st !== 'eaten').slice(0, 3).map(x => x.n.id) : null;
  const lure = c === 'lure' ? deal.filter(x => !x.done && x.st !== 'eaten').map(x => x.n.id) : null;
  (D.played[T] = D.played[T] || []).push({ c, i: slot.i, ids: bet || lure || ids, at: m, t: Date.now() });
  save(); sync(); onUpdate(); return true;
}

/** Takes back today's last card (its plan change is undone by the caller). */
export function unplay() { const L = D.played[today()]; if (!L?.length) return; L.pop(); save(); sync(); onUpdate(); }

/* ---------- the quick hit after a check-off ---------- */
/** Strike: tap while his eye flashes for a critical hit. Flick: swipe the coins cleanly into your purse.
    Each pays once per quest, only on gold you actually won back. */
export const STRIKE = g => Math.max(2, Math.ceil(g * 0.25)), FLICK = g => Math.max(1, Math.ceil(g * 0.1));
/** Combo: quests kept on time within half an hour of the last one climb +10% a step, up to +50%.
    Ticked in the same minute doesn't count, so a pile of check-offs at bedtime earns nothing extra. */
export const COMBO = { gap: 30, step: 0.1, max: 0.5 };
export const hits = id => D.hits[today()]?.[id] || {};
export function hit(id, kind) {
  const T = today(), M = D.hits[T] = D.hits[T] || {}, h = M[id] = M[id] || { s: 0, f: 0 };
  if (h[kind]) return; h[kind] = 1; save(); sync(); onUpdate();
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
  const left = prev >= (D.start || d) && prev < today() ? questsOn(prev).filter(q => !q.done && !q.n.rs && !q.n.r).map(q => ({ ...q, s: null, left: true })) : [];
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
      else if (p.c === 'wind') q.wind = true;
    }
    q.r = roundOf(q.e);
    if (q.n.rs) { const run = streakOf(q.n.rs, d, 40); q.foil = foilOf(run); q.run = run; q.g = 10 + q.foil.b; }
    else q.g = q.left ? Math.max(1, Math.ceil(gold(q.m) / 2)) : gold(q.m);
    const G = goalOf(q.n);
    if (G) { q.goal = G.id; if (G.esc) q.g = Math.round(q.g * (1 + 0.25 * G.esc)); // he came back bigger: his quests are worth more
      if (q.n.ms && !q.left) { q.boss = true; q.g *= 3; } } // a milestone of a goal is his boss day
  }
  return L.sort((a, b) => a.s0 - b.s0 || (a.left ? -1 : 0) - (b.left ? -1 : 0));
}
/** How each quest stands at minute `now` of day d (1e5 for a day that's over, -1 for one still ahead). */
function judge(q, d, now) {
  const t = q.done ? minOf(doneAt(q.n), d) : null;
  q.dm = t;
  if (q.done) q.st = t == null || t <= q.by ? 'kept' : 'late';
  else q.st = now > q.by ? 'eaten' : now > q.e ? 'jaws' : 'open';
  q.you = q.st === 'kept' || (q.st === 'late' && q.wind) ? q.g : q.st === 'late' ? Math.ceil(q.g / 2) : 0;
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
export function dayOf(d, grace, now, o = {}) {
  const eq = new Set(o.eq || []), curses = o.curses || [];
  const Qs = dealOn(d, grace).map(q => judge(q, d, now));
  if (D.off[d]) { for (const q of Qs) { q.g = 0; q.you = 0; q.him = 0; q.off = true; } } // a day off: he sleeps, nothing counts
  // Sloth: one quest starts half eaten
  if (curses.includes('sloth') && !D.off[d]) { const L = Qs.filter(q => q.g >= 10); const v = L.length && L[seedOf(d + 'sloth') % L.length];
    if (v) { const bite = Math.floor(v.g / 2); v.g -= bite; v.sloth = bite; judge(v, d, now); } }
  // each swoop takes the richest unshielded quest in his jaws at that minute
  const sw = swoopsOn(d).map(t => {
    const L = Qs.filter(q => !q.shield && !q.off && !(eq.has('iron') && q.n.rs && (q.run || 0) >= 7) && q.e <= t && t < q.by && (q.dm == null || q.dm > t));
    const v = L.sort((a, b) => b.g - a.g)[0];
    if (v) { v.by = t; v.swooped = true; judge(v, d, now); }
    return { t, q: v || null, past: now >= t };
  });
  const mk = D.off[d] ? null : markOf(d, Qs); if (mk) { mk.mark = true; if (mk.st === 'kept') mk.you += mk.g; }
  // charms
  const byDone = Qs.filter(q => q.st === 'kept' && q.dm != null).sort((a, b) => a.dm - b.dm);
  if (eq.has('early')) for (const q of byDone) if (q.dm < 9 * 60) { const b = Math.ceil(q.g / 2); q.you += b; q.charm = 'Early Bird'; }
  if (eq.has('batch')) for (let i = 1; i < byDone.length; i++) { const a = byDone[i - 1], b = byDone[i]; if (a.n.ar && a.n.ar === b.n.ar && !a.batched) { b.you += b.g; b.batched = true; b.charm = 'Batch'; } }
  // combo: kept on time, each within half an hour of the one before
  let chain = 0, prevT = null;
  for (const q of byDone) {
    if (prevT != null && q.dm - prevT < 1) continue; // ticked the same minute: no step, no break
    chain = prevT != null && q.dm - prevT <= COMBO.gap ? chain + 1 : 1; prevT = q.dm; q.combo = chain;
    if (chain > 1 && !D.off[d]) { q.comboB = Math.ceil(q.g * Math.min(COMBO.max, COMBO.step * (chain - 1))); q.you += q.comboB; }
  }
  const combo = byDone.length ? { n: chain, until: prevT + COMBO.gap } : null;
  // the quick hits: a strike and a clean flick, once each
  const H = D.hits[d] || {};
  for (const q of Qs) { const h = H[q.n.id]; if (!h || D.off[d] || (q.st !== 'kept' && q.st !== 'late')) continue;
    if (h.s) { q.strike = STRIKE(q.g); q.you += q.strike; } if (h.f) { q.flick = FLICK(q.g); q.you += q.flick; } }
  let raid = 0;
  if (eq.has('ember')) { let n = 0; for (const q of Qs.slice().sort((a, b) => a.by - b.by)) { if (q.st === 'kept') { if (++n % 3 === 0) raid += 10; } else if (q.st !== 'open' && q.st !== 'jaws') n = 0; } }
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
  if (eq.has('calm')) for (const x of R) if (x.over && x.total && !Qs.some(q => q.e <= x.end && x.end < q.by && (q.dm == null || q.dm > x.end))) x.calm = Math.round(x.kept * 0.2);
  const bonus = raid + R.reduce((a, x) => a + (x.calm || 0), 0);
  const v = D.off[d] ? 'off' : verdict;
  return { d, Qs, R, total, you: you + bonus, him, bonus, raid, wins, played: played.length, rest: rest || !!D.off[d], off: D.off[d] || null, closed, verdict: v, swoops: sw, mark: mk, combo, hand: handOn(d, !!o.comeback), curses, chest: closed ? CHEST[v] || 0 : 0 };
}
/** The whole fight so far: every day since you began, today live, your gold, his belly and your run. */
/** The chest at bedtime: bigger the better the verdict. */
export const CHEST = { starves: 30, driven: 15, stuffed: 5, rest: 0, off: 0 };
export function state() {
  const T = today(), start = D.start || T, days = [];
  let run = 0, gold = D.carry || 0, belly = 0, shards = 0, stuffedRun = 0, best = 0, kept = 0; const curses = [], tally = { starves: 0, driven: 0, stuffed: 0 };
  const eqOn = d => D.eq.filter(c => D.charms.includes(c));
  for (let d = start; d <= T; d = add(d, 1)) {
    const H = huntAt(run), r = dayOf(d, H.grace, d < T ? 1e5 : nowMin(), { eq: eqOn(d), curses: curses.slice(), comeback: stuffedRun >= 2 });
    r.hunt = H; r.run = run; days.push(r);
    gold += r.you + r.chest; belly += r.him; kept += r.you; shards += r.Qs.filter(q => q.st === 'kept').length;
    if (d < T && !r.rest) {
      if (r.verdict === 'stuffed') { run = 0; stuffedRun++; if (!curses.length) curses.push('sloth'); }
      else { run++; stuffedRun = 0; curses.pop(); }
      best = Math.max(best, run); if (r.verdict in tally) tally[r.verdict]++;
    }
  }
  gold -= D.spent.reduce((a, x) => a + x.g, 0); gold += D.packs.reduce((a, p) => a + (p.sold || 0), 0);
  const G = goals(), gifts = G.filter(g => g.status === 'tamed').length;
  const H = huntAt(run), packs = Math.floor(shards / PACK) + gifts - D.packs.length;
  return { start, days, today: days[days.length - 1], gold, belly, run, hunt: H, bed: D.bed, wake: D.wake, shards, packs, toPack: PACK - shards % PACK, curses,
    deck: D.deck || STARTER, charms: D.charms, eq: eqOn(T), byDay: new Map(days.map(x => [x.d, x])), goals: G, best, kept, tally, rank: rankOf(shards + 50 * gifts + 5 * best) };
}

/* ---------- dawn: the Market, packs, days off ---------- */
/** Today's three Market offers, the same on every device. Already-owned charms aren't offered. */
export function market(d = today()) {
  // charms gained today stay on today's shelf, so buying one doesn't reshuffle the Market
  const fresh = new Set([...D.spent.filter(x => x.d === d).map(x => x.id), ...D.packs.filter(p => p.d === d).map(p => p.kept)]);
  const L = POOL.filter(it => it.k === 'card' || !D.charms.includes(it.id) || fresh.has(it.id)), out = []; let h = seedOf(d + 'market');
  while (out.length < 3 && L.length) { h = (h * 16807) % 2147483647; out.push(L.splice(h % L.length, 1)[0]); }
  const bought = D.spent.filter(x => x.d === d).map(x => x.id);
  return out.map(it => ({ ...itemOf(it), g: PRICE[it.k], bought: bought.includes(it.id), owned: it.k === 'charm' && D.charms.includes(it.id) }));
}
export const marketOpen = () => nowMin() < 12 * 60;
function gain(it) {
  if (it.k === 'card') D.deck = [...(D.deck || STARTER), it.id];
  else if (!D.charms.includes(it.id)) { D.charms.push(it.id); if (D.eq.length < EQUIP) { D.eq.push(it.id); D.eqT = Date.now(); } }
}
export function buy(id, S) {
  const it = market().find(x => x.id === id); if (!it || it.bought || it.owned || !marketOpen() || S.gold < it.g) return false;
  D.spent.push({ t: Date.now(), d: today(), id, k: it.k, g: it.g }); gain(it); save(); sync(); onUpdate(); return true;
}
/** The next pack: three picks, keep one, the other two turn into gold. */
export function packOffer() {
  const L = POOL.filter(it => it.k === 'card' || !D.charms.includes(it.id)), out = []; let h = seedOf('pack' + D.packs.length + (D.start || ''));
  while (out.length < 3 && L.length) { h = (h * 16807) % 2147483647; out.push(L.splice(h % L.length, 1)[0]); }
  return out.map(itemOf);
}
export function openPack(keep, S) {
  if (S.packs < 1) return false;
  const offer = packOffer(), it = offer.find(x => x.id === keep); if (!it) return false;
  D.packs.push({ t: Date.now(), d: today(), kept: keep, sold: SELL * (offer.length - 1) }); gain(it); save(); sync(); onUpdate(); return true;
}
export function equip(id, on) {
  if (!D.charms.includes(id)) return;
  D.eq = on ? [...D.eq.filter(x => x !== id), id].slice(-EQUIP) : D.eq.filter(x => x !== id); D.eqT = Date.now(); save(); sync(); onUpdate();
}
/** A day off: rest (one free a week) or sick or on holiday. He sleeps and nothing counts. */
export const restLeft = d => !Object.entries(D.off).some(([k, v]) => v === 'rest' && k !== d && weekOf(k) === weekOf(d));
const weekOf = d => { const t = pd(d); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return t.toDateString(); };
export function dayOff(d, kind) {
  if (kind === 'rest' && !restLeft(d)) return false;
  if (kind) D.off[d] = kind; else delete D.off[d]; save(); sync(); onUpdate(); return true;
}
export const dawnSeen = d => !!D.dawn[d];
export function seeDawn(d) { D.dawn[d] = 1; save(); sync(); onUpdate(); }
/** A day before you began, or still ahead: judged at its start. */
export const dayView = (d, S) => S.byDay.get(d) || dayOf(d, S.hunt.grace, d > today() ? -1 : 1e5, { eq: S.eq, curses: S.curses });

/* ---------- goal dragons ---------- */
/** A big goal is a top-level project with a dragon of its own. His Wildness is the share of the project's planned
    minutes still left. Finish the project and he's tamed into your lair (and leaves you a pack). If the due date passes
    first he escapes; push the date and he's back, bigger and smugger: each escape makes his quests worth 25% more. */
const mins = n => n.m || 30;
export function goals() {
  const T = today(), out = []; let changed = false;
  for (const [id, g] of Object.entries(D.goals)) {
    const p = node(id); if (!p) continue;
    const L = leaves(id).filter(n => n && n.id !== id), total = L.reduce((a, n) => a + mins(n), 0), left = L.filter(n => !n.done).reduce((a, n) => a + mins(n), 0);
    const done = L.length > 0 && isDone(p), due = p.due || null;
    let status = done ? 'tamed' : due && due < T ? 'escaped' : 'hunting';
    if (done && !g.tamed) { g.tamed = T; g.u = Date.now(); changed = true; }
    if (!done && g.tamed) { g.tamed = null; g.u = Date.now(); changed = true; }
    if (status === 'escaped' && g.gone !== due) { g.gone = due; g.esc = (g.esc || 0) + 1; g.u = Date.now(); changed = true; } // counted once per due date
    const bosses = all().filter(n => n.ms && rootOf(n).id === id).map(n => ({ n, d: n.due || n.d || null, done: !!n.done })).sort((a, b) => (a.d || '9') < (b.d || '9') ? -1 : 1);
    out.push({ id, p, name: g.n, at: g.at, esc: g.esc || 0, tamed: g.tamed || null, status, wild: total ? left / total : 1, left, total, due, bosses, color: colorOf(p), steps: L.length });
  }
  if (changed) { save(); sync(); }
  return out.sort((a, b) => (a.status === 'tamed') - (b.status === 'tamed') || ((a.due || '9') < (b.due || '9') ? -1 : 1));
}
const all = () => store.all();
/** The goal dragon a quest belongs to, while he's being hunted. */
export function goalOf(n) {
  const id = n && rootOf(n.rs ? (store.get(n.rs) || n) : n)?.id, g = id && D.goals[id]; if (!g) return null;
  const p = node(id); if (!p || (p.due && p.due < today() && !g.tamed && !isDone(p))) return null;
  return { id, n: g.n, esc: g.esc || 0 };
}
export const isGoal = id => !!D.goals[id];
/** Turns a top-level project into a big goal and hatches his dragon. */
export function hatch(id, name) { if (D.goals[id]) return; D.goals[id] = { n: name || nameFor(node(id)?.t || id), at: Date.now(), esc: 0, u: Date.now() }; save(); sync(); onUpdate(); }
export function rename(id, name) { const g = D.goals[id]; if (!g || !name) return; g.n = name.slice(0, 40); g.u = Date.now(); save(); sync(); onUpdate(); }
export function release(id) { delete D.goals[id]; save(); sync(); onUpdate(); }
/** A name of his own, until Claude gives him a better one. */
const SYL = [['Grim', 'Vex', 'Mor', 'Skar', 'Thal', 'Ash', 'Drav', 'Kel', 'Zor', 'Fen', 'Bram', 'Ruk'], ['a', 'o', 'u', 'e', 'i', 'ae'], ['rath', 'gul', 'mir', 'thax', 'vorn', 'lisk', 'dor', 'nax', 'grim', 'scale', 'wyrm', 'fang']];
const EPI = ['the Unfinished', 'the Patient', 'Deadline-Eater', 'the Looming', 'Who Waits', 'the Procrastinator', 'Many-Steps', 'the Smouldering'];
export function nameFor(t) { const h = seedOf(t); return `${SYL[0][h % 12]}${SYL[1][(h >> 4) % 6]}${SYL[2][(h >> 8) % 12]} ${EPI[(h >> 12) % EPI.length]}`; }

/* ---------- Hunter rank ---------- */
/** Your rank grows with every quest saved, every dragon tamed and your best run. */
export const RANKS = [{ at: 0, n: 'Squire' }, { at: 40, n: 'Tracker' }, { at: 120, n: 'Hunter' }, { at: 300, n: 'Slayer' }, { at: 700, n: 'Wyrmwarden' }, { at: 1500, n: 'Dragonmaster' }];
export function rankOf(xp) { const i = RANKS.filter(r => xp >= r.at).length - 1, nx = RANKS[i + 1]; return { ...RANKS[i], i, xp, next: nx || null, to: nx ? nx.at - xp : 0, p: nx ? (xp - RANKS[i].at) / (nx.at - RANKS[i].at) : 1 }; }
