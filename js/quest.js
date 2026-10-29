// Quest: a day's plan played as a tug of war against Claude, who plays a dragon.
// Every quest on the day (its tasks, project blocks and repeats) holds some gold. All of it starts
// in your vault. When a quest's time passes unchecked, the dragon takes its gold; checking it off
// late wins back half. Keep 70% and you win the day. Kept gold builds your village over the weeks;
// the gold the dragon took lately is what it grows on, and a bigger dragon swoops sooner.
// Everything here is worked out from the plan itself (planned day and time, when it was checked off),
// so nothing new is stored but the day the realm began, and the swipes: moving a quest off its day
// doesn't dodge the dragon, it still takes a quarter of the gold (all of it, if it had already taken it).
import * as store from './store.js';
import { occId, repeatsOn } from './repeat.js';
import { hasKids, isDone } from './tree.js';
import { eventsOn, timedOn } from './calendar.js';
import { add, DAYN, MON, esc, fmtT, lsGet, lsSet, pd, today, weekStart, daysBetween } from './util.js';
import { CAMPAIGN_DAYS, MARCH_AT, REGIONS, regionOf, titleFor } from './regions.js';
import { paint, phaseOf, SW, SH, SWOOP, whenReady, nudge, resetView } from './keep3d.js';
import * as sfx from './sfx.js';
import { screen, mount } from './crt.js';

const KEY = 'daybook-quest';
const WIN = 0.7;
let client = null, onUpdate = () => {};
let Q = { start: null, swipes: {}, bonus: {}, ...lsGet(KEY, {}) };
Q.bonus = Q.bonus || {};
Q.marks = Q.marks || {}; // the quest the dragon marked on each day
Q.seen = Q.seen || {}; // the quests seen on each day while it was today
Q.delays = Q.delays || {}; // quests pushed later the same day: a tenth of their gold to the dragon
Q.picks = Q.picks || []; // the village buildings you chose, in order: { b: name, on: day }
Q.kg = { camp: null, past: [], won: {}, v: 0, ...(Q.kg || {}) }; // the kingdom: the campaign under way, past ones, regions held
let me = null;
const saveQ = () => lsSet(KEY, Q);

export function init(o) { client = o.client ?? client; onUpdate = o.update ?? onUpdate; }
/** The day the realm began: set the first time Quest is opened, and kept on the account so every device agrees. */
export function begin(u) {
  me = u || null;
  const sw = u?.user_metadata?.quest_swipes; // swipes made on another device
  if (sw) for (const [d, m] of Object.entries(sw)) Q.swipes[d] = { ...m, ...Q.swipes[d] };
  const bo = u?.user_metadata?.quest_bonus; // events claimed on another device
  if (bo) for (const [d, m] of Object.entries(bo)) Q.bonus[d] = { ...m, ...Q.bonus[d] };
  const se = u?.user_metadata?.quest_seen; // quests another device saw on their day
  if (se) for (const [d, m] of Object.entries(se)) Q.seen[d] = { ...m, ...Q.seen[d] };
  const mk = u?.user_metadata?.quest_marks; // the dragon's marks: the first device to pick one for a day wins
  if (mk) { Object.assign(Q.marks, mk); saveQ(); }
  const dl = u?.user_metadata?.quest_delays; // pushes made on another device
  if (dl) for (const [d, m] of Object.entries(dl)) Q.delays[d] = { ...m, ...Q.delays[d] };
  const pk = u?.user_metadata?.quest_picks; // buildings chosen on another device
  if (pk?.length > Q.picks.length) { Q.picks = pk; saveQ(); }
  const kg = u?.user_metadata?.quest_kingdom; // whichever device changed the kingdom last wins
  if (kg && (kg.v || 0) > (Q.kg.v || 0)) { Q.kg = { camp: null, past: [], won: {}, ...kg }; saveQ(); }
  const theirs = u?.user_metadata?.quest_start;
  if (theirs && theirs !== Q.start && (!Q.start || theirs < Q.start)) { Q.start = theirs; saveQ(); }
  if (!Q.start) { Q.start = today(); saveQ(); }
  if (client && u && theirs !== Q.start) client.auth.updateUser({ data: { quest_start: Q.start } }).catch(() => {});
}
export const started = () => Q.start;

/** Called for each change the person makes. A quest that leaves a day that has come (today or before) without being
    checked off is swiped: a quarter of its gold, or all of it once the dragon had taken it. Putting it back undoes the swipe. */
export function moved(id, before, after) {
  if (pushed(id, before, after)) return;
  if (!Q.start || !('d' in before) || before.d == null || after.done || before.done) return;
  const T = today(), d = before.d; if (d > T || d < Q.start || after.d === d) return;
  const n = store.get(id) || skipped(id); if (!n || n.done || n.k === 'area' || n.r) return;
  if (Q.swipes[d]?.[id]) return;
  const s = 's' in before ? before.s : n.s, m = ('m' in before ? before.m : n.m) ?? 60, g = gold(m);
  const end = deadline(d, s, m, realm().grace) ?? 24 * 60;
  const taken = d < T || new Date() > at(d, end);
  let cost = taken || twistOn(d) === 'marsh' ? g : perk('Market', d) ? Math.max(1, Math.round(g / 8)) : Math.max(2, Math.round(g / 4)), free = null;
  // the Hydra Scale pays for one move a week
  const wk = weekStart(d);
  if (!taken && relic('marsh', d) && !Object.values(Q.swipes).some(x => Object.values(x).some(w => w.free === wk))) { cost = 0; free = wk; }
  (Q.swipes[d] = Q.swipes[d] || {})[id] = { t: n.t || 'Untitled', g: cost, ...(free ? { free } : {}) };
  for (const k of Object.keys(Q.swipes)) if (daysBetween(k, T) > 21) delete Q.swipes[k];
  saveQ(); sync();
}
/** A timed quest pushed later on today itself (or its time taken off) costs a tenth of its gold, once a day.
    If its time had already passed, the dragon had it anyway: it keeps the whole pile, and finishing wins it back. */
function pushed(id, before, after) {
  const T = today(); if (!Q.start || !('s' in before) || 'd' in after || after.done || before.done) return false;
  const n = store.get(id); if (!n || n.done || n.r || plannedDay(n) !== T || Q.delays[T]?.[id] || Q.swipes[T]?.[id]) return false;
  const s0 = before.s, s1 = after.s; if (s0 == null || (s1 != null && s1 <= s0)) return false;
  const m = ('m' in before ? before.m : n.m) ?? 60, g = gold(m), end = deadline(T, s0, m, realm().grace) ?? 24 * 60;
  const late = new Date() > at(T, end);
  (Q.delays[T] = Q.delays[T] || {})[id] = { t: n.t || 'Untitled', g: late ? g : Math.max(1, Math.round(g / 10)), to: s1, ...(late ? { full: 1 } : {}) };
  for (const k of Object.keys(Q.delays)) if (daysBetween(k, T) > 21) delete Q.delays[k];
  saveQ(); sync(); return true;
}
const sync = () => { if (client && me) client.auth.updateUser({ data: { quest_swipes: Q.swipes, quest_seen: Q.seen, quest_bonus: Q.bonus, quest_marks: Q.marks, quest_kingdom: Q.kg, quest_picks: Q.picks, quest_delays: Q.delays } }).then(({ data }) => { if (data?.user) me = data.user; }).catch(() => {}); };

/* ---------- moves made elsewhere ---------- */
// Moves made outside this app (Claude rolling unfinished tasks forward, the connector, another device) never pass
// through moved(), so a day would quietly lose its unfinished quests and look won. The app notes every quest it sees
// on today's list; one that later turns up gone from its day without being done there is swiped just as if it had been
// moved here: a quarter of its gold while its day still runs and its time hasn't passed, all of it after that.
function see(d, Qs) {
  if (d !== today() || !Q.start || d < Q.start) return;
  const S = Q.seen[d] || (Q.seen[d] = {}); let fresh = false;
  for (const q of Qs) if (q.st !== 'swiped' && !q.n.r && !q.n.x && !String(q.n.id).includes('~') && !S[q.n.id]) { S[q.n.id] = { t: q.n.t || 'Untitled', s: q.s, m: q.m }; fresh = true; }
  if (!fresh) return;
  for (const k of Object.keys(Q.seen)) if (daysBetween(k, d) > 7) delete Q.seen[k];
  saveQ(); sync();
}
function catchMoves() {
  const T = today(), now = new Date(); let any = false;
  for (const [d, S] of Object.entries(Q.seen)) {
    if (d > T || !Q.start || d < Q.start) continue;
    for (const [id, w] of Object.entries(S)) {
      if (Q.swipes[d]?.[id]) continue;
      const n = store.get(id); if (!n || n.k === 'area') continue; // deleted, or not loaded yet
      if (plannedDay(n) === d) continue; // still on its day, done or not
      const m = w.m ?? 60, g = gold(m), passed = d < T || (w.s != null && now > at(d, w.s + m));
      (Q.swipes[d] = Q.swipes[d] || {})[id] = { t: w.t, g: passed || twistOn(d) === 'marsh' ? g : Math.max(2, Math.round(g / 4)), away: 1 };
      any = true;
    }
  }
  if (any) { saveQ(); sync(); }
}

/* ---------- event bonuses ---------- */
// Showing up to a calendar event earns a little gold on top of the day's quests. It can be claimed once the event
// has begun, on any day of the realm up to today; tapping it again gives it back.
export const BONUS = 3;
const evKey = e => `${e.s}|${e.t}`;
const bonusOn = d => Object.values(Q.bonus[d] || {}).reduce((a, b) => a + b.g, 0);
export const claimed = (d, e) => !!Q.bonus[d]?.[evKey(e)];
export const claimable = (d, e) => !e.allDay && !!Q.start && d >= Q.start && (d < today() || new Date() >= at(d, e.s));
export function claim(d, i) {
  const e = eventsOn(d)[i]; if (!e) return;
  const k = evKey(e), B = (Q.bonus[d] = Q.bonus[d] || {});
  if (B[k]) delete B[k]; else if (claimable(d, e)) B[k] = { t: e.t, g: BONUS + (relic('storm', d) ? 2 : 0) }; else return;
  if (!Object.keys(B).length) delete Q.bonus[d];
  for (const x of Object.keys(Q.bonus)) if (daysBetween(x, today()) > 60) delete Q.bonus[x];
  saveQ(); sync();
}

// The swipes that still stand on day d: the quest is still off that day
const skipped = id => { const n = store.peek(id); return n?.x && n.rs ? n : null; }; // a repeat skipped for the day
const delaysOn = d => Object.entries(Q.delays[d] || {}).map(([id, w]) => ({ n: store.get(id) || { id, t: w.t }, s: null, m: 0, g: w.g, st: 'swiped', you: 0, dragon: w.g, bank: 0, pushed: w.to ?? -1, full: !!w.full }));
const swipesOn = d => Object.entries(Q.swipes[d] || {}).filter(([id]) => { const n = store.get(id) || skipped(id); return !n || n.done && plannedDay(n) === d ? false : plannedDay(n) !== d; })
  .map(([id, w]) => { const n = store.get(id) || skipped(id); return { n: n || { id, t: w.t }, s: null, m: 0, g: w.g, st: 'swiped', you: 0, dragon: w.g, bank: 0, to: n?.d ?? null, free: !!w.free }; });

/* ---------- the kingdom: campaigns, twists and relics (regions.js) ---------- */
const SPIRE_TWISTS = ['wood', 'marsh', 'frost', 'storm', 'ember'];
const campaigns = () => [...(Q.kg.past || []), ...(Q.kg.camp ? [{ ...Q.kg.camp, end: add(Q.kg.camp.start, CAMPAIGN_DAYS - 1) }] : [])];
/** The twist the dragon plays by on day d: that of a campaign running then (the Sky Spires change theirs daily). */
export function twistOn(d) {
  const c = campaigns().find(x => d >= x.start && d <= x.end); if (!c) return null;
  return c.id === 'spires' ? SPIRE_TWISTS[daysBetween(c.start, d) % SPIRE_TWISTS.length] : c.id;
}
/** A relic helps from the day after its region was claimed, so the days before stay as they were. */
const relic = (id, d) => !!Q.kg.won?.[id] && Q.kg.won[id] < d;
// The Storm Drake's lightning picks one timed quest a day, the same one on every device
/* ---------- the dragon's mark ---------- */
// The first time a day is looked at, the dragon marks one of its quests, one of the richest still open.
// Keep that quest on time and it pays double; the extra is bonus gold the dragon can't take.
const hash = s => Math.abs([...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7));
function markDay(d, Qs) {
  if (Q.marks[d] || d !== today() || !Q.start || d < Q.start) return;
  const L = Qs.filter(q => q.st === 'open'); if (!L.length) return;
  const top = Math.max(...L.map(q => q.g)), C = L.filter(q => q.g >= top - 5);
  Q.marks[d] = C[hash(d) % C.length].n.id;
  for (const k of Object.keys(Q.marks)) if (daysBetween(k, d) > 60) delete Q.marks[k];
  saveQ(); sync();
}
const lightning = (d, L) => { const T = L.filter(q => q.s != null); if (!T.length) return null; const h = [...d].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 17); return T[Math.abs(h) % T.length]; };
/** The day's quests with its twist applied, each judged at time `now`. */
function judged(d, now, grace) {
  const tw = twistOn(d), L = questsOn(d), bolt = tw === 'storm' ? lightning(d, L) : null;
  for (const q of L) {
    if (tw === 'wood' && q.s != null && q.s < 600) { q.g *= 2; q.grace = 15; q.tw = 'Morning quest, double gold'; }
    if (q === bolt) { q.g *= 3; q.grace = 0; q.tw = 'Struck by lightning: triple gold, no grace'; }
    if (tw === 'frost' && q.s == null) q.fixedBy = 18 * 60;
  }
  return L.map(q => judge(q, d, now, q.grace ?? grace));
}
/** Start a campaign on a region, from tomorrow at dawn. The castle has to stand, and the Sky Spires want four regions held. */
export function march(id, R = realm()) {
  const reg = regionOf(id); if (!reg || Q.kg.camp || Q.kg.won[id] || R.vault < MARCH_AT) return false;
  if (reg.locked && Object.keys(Q.kg.won).length < reg.locked) return false;
  const start = add(today(), 1);
  // the hydra grows a head for each habit you have when you march
  const heads = id === 'marsh' ? store.all().filter(n => n.r && !(n.r.until && n.r.until < start)).map(n => ({ id: n.id, t: n.t || 'Untitled' })) : undefined;
  Q.kg.camp = { id, start, ...(heads ? { heads } : {}) }; Q.kg.v++; saveQ(); sync(); return true;
}
/** Give up the campaign. The twist stops from today; a campaign that hadn't begun leaves no trace. */
export function retreat() {
  const c = Q.kg.camp; if (!c) return;
  const end = add(today(), -1);
  if (end >= c.start) Q.kg.past.push({ id: c.id, start: c.start, end, res: 'retreat' });
  Q.kg.camp = null; Q.kg.v++; saveQ(); sync();
}
/** How the campaign under way stands, from the days already finished. */
function campaignOf(R) {
  const c = Q.kg.camp; if (!c) return null;
  const reg = regionOf(c.id), T = today(), end = add(c.start, CAMPAIGN_DAYS - 1);
  let wins = 0, run = 0, best = 0, gold = 0, done = null;
  const heads = c.heads ? c.heads.map(h => ({ ...h, run: 0, cut: null })) : null;
  for (let d = c.start; d <= end && d < T; d = add(d, 1)) {
    const r = R.byDay.get(d); if (!r) continue;
    if (r.win) { wins++; run++; best = Math.max(best, run); } else if (!r.rest) run = 0;
    if (c.id !== 'ember' || run >= 3) gold += r.you;
    if (heads) for (const h of heads) if (!h.cut) { const q = r.Qs.find(x => x.n.rs === h.id || x.n.id === h.id); if (!q) continue; if (q.st === 'kept') { if (++h.run >= 5) h.cut = d; } else h.run = 0; }
    const met = c.id === 'ember' ? best >= reg.need : heads?.length ? heads.every(h => h.cut) : wins >= reg.need;
    if (met) { done = { res: 'won', on: d }; break; }
  }
  if (!done && end < T) done = { res: 'lost', on: end };
  const t = R.byDay.get(T); if (!done && t && T >= c.start) gold += t.bank;
  return { id: c.id, reg, start: c.start, end, begun: T >= c.start, day: Math.min(daysBetween(c.start, T) + 1, CAMPAIGN_DAYS), wins, run, best, heads, gold, done, twist: twistOn(T) };
}
/** Close a campaign that has been won or run out. Returns true when something changed. */
export function settle() {
  const C = campaignOf(realm()); if (!C?.done) return false;
  Q.kg.past.push({ id: C.id, start: C.start, end: C.done.on, res: C.done.res });
  if (C.done.res === 'won') Q.kg.won = { ...Q.kg.won, [C.id]: C.done.on };
  Q.kg.camp = null; Q.kg.news = { id: C.id, res: C.done.res, on: today() }; Q.kg.v++;
  saveQ(); sync(); return true;
}
export const kingdom = () => Q.kg;

/* ---------- the rules ---------- */
export function gold(m) { m = m || 60; return m <= 15 ? 5 : m <= 30 ? 10 : m <= 60 ? 15 : m <= 90 ? 20 : m <= 150 ? 25 : 30; }
// The dragon grows on what it took over the last seven days: a bad week shows in how big and fierce it looks.
export const DRAGONS = [
  { at: 0, name: 'Hatchling' }, { at: 40, name: 'Drake' }, { at: 100, name: 'Wyvern' }, { at: 180, name: 'Great Wyrm' },
];
// How hard it hunts comes from your win streak instead: the longer it runs, the sooner the dragon swoops after a
// quest's time, and the more your kept gold builds the village. A lost day ends the streak and it dozes off again,
// so a bad stretch never makes the next day harder.
export const HUNTS = [
  { at: 0, name: 'dozing', grace: 60, boost: 1 }, { at: 3, name: 'prowling', grace: 45, boost: 1.25 },
  { at: 7, name: 'hunting', grace: 30, boost: 1.5 }, { at: 14, name: 'relentless', grace: 15, boost: 2 },
];
const huntAt = streak => { let i = 0; HUNTS.forEach((x, j) => { if (streak >= x.at) i = j; }); return HUNTS[i]; };
// Three lost days in a row and the dragon burns your newest building, three more and the next; each day won rebuilds one.
const BURN_AFTER = 3;
// The marks the vault passes. The keep, walls, great hall and castle go up on their own; at the other marks you choose.
// Each mark also names what your settlement has become.
export const BUILDINGS = [
  [0, 'Campfire', 'Camp'], [100, null, 'Outpost'], [250, null, 'Hamlet'], [450, null, 'Village'], [700, null, 'Large village'], [1000, null, 'Township'], [1400, null, 'Town'],
  [1900, null, 'Market town'], [2500, 'Stone keep', 'Keep'], [3200, null, 'Borough'], [4000, 'Castle walls', 'Fort'], [5000, 'Great hall', 'Stronghold'], [6500, 'Castle', 'Castle'],
];
export const rankName = vault => BUILDINGS.filter(b => vault >= b[0]).pop()[2];
/** The village buildings to choose from, each with a perk that starts the day after it goes up. */
export const PERKS = {
  Tent: 'Keep your first timed quest of the day on time: +3 bonus gold.',
  Hut: 'Habits make guard at 5 days and knight at 15.',
  Well: 'The dragon circles 10 minutes longer before it dives.',
  Farm: '+1 gold for every habit you keep.',
  Watchtower: 'Finish a quest late and you win back three quarters, not half.',
  Mill: 'Kept gold builds your village 10% faster.',
  Smithy: 'Each event bonus is worth 2 more gold.',
  Market: 'Moving a quest before its time costs half as much.',
};
const VILLAGE = Object.keys(PERKS);
let RUINED = new Set(); // what the dragon has burned, as of the day being judged: a burned building's perk is off till it's rebuilt
const perk = (b, d) => !RUINED.has(b) && Q.picks.some(p => p.b === b && p.on < d);
/** The buildings raised for this much gold, oldest first. A mark you haven't chosen for yet raises nothing. */
export function raised(vault) {
  let k = 0; const out = [];
  for (const [at, b] of BUILDINGS) { if (vault < at) break; if (b) out.push(b); else { const p = Q.picks[k++]; if (p) out.push(p.b); } }
  return out;
}
/** How many marks are waiting on your choice, and the three buildings offered for the first of them.
    The buildings come in the order they're listed, simple ones first, so early marks offer the basics. */
export function choosing(vault) {
  const due = BUILDINGS.filter(([at, b]) => !b && vault >= at).length - Q.picks.length; if (due <= 0) return null;
  return { due, offer: offerNow(), at: BUILDINGS.filter(([, b]) => !b)[Q.picks.length] };
}
const offerNow = () => VILLAGE.filter(b => !Q.picks.some(p => p.b === b)).slice(0, 3);
export function choose(b) { if (!PERKS[b] || Q.picks.some(p => p.b === b) || !choosing(realm().vault)) return; Q.picks.push({ b, on: today() }); saveQ(); sync(); }
const dragonAt = hoard => { let i = 0; DRAGONS.forEach((x, j) => { if (hoard >= x.at) i = j; }); return i; };
export const villageAt = vault => raised(vault).length; // how many buildings stand
// The buildings you can see, oldest first: the castle replaces the keep and its walls, the keep the campfire, the walls the tent
const standing = vault => { const up = raised(vault); return up.filter(b => !(b === 'Stone keep' && up.includes('Castle')) && !(b === 'Campfire' && up.includes('Stone keep')) && !(b === 'Tent' && up.includes('Castle walls')) && !(b === 'Castle walls' && up.includes('Castle'))); };

const plannedDay = n => (n.pl ? n.pl.day : n.d) ?? null;
const doneAt = n => { const e = (n.tl || []).filter(x => x.end).pop(); return e ? new Date(e.end) : null; };
const at = (d, min) => { const t = pd(d); t.setMinutes(min); return t; };

/** The quests on day d, in the order they come up: tasks and project blocks planned for it, and its repeats. */
export function questsOn(d) {
  const plain = store.all().filter(n => !n.r && n.k !== 'area' && plannedDay(n) === d && (!hasKids(n.id) || n.d));
  const reps = store.occOn(d).filter(n => (n.pl ? n.pl.day : n.oc ?? n.d) === d);
  const L = plain.concat(reps).map(n => {
    const s = n.pl ? n.pl.start_min : n.s, m = (n.pl ? n.pl.duration_min : n.m) ?? 60;
    return { n, s: s ?? null, m, g: gold(m), done: isDone(n) };
  });
  return L.sort((a, b) => (a.s ?? 1e4) - (b.s ?? 1e4) || (a.n.ds ?? a.n.o) - (b.n.ds ?? b.n.o));
}
/** A habit's streak: how many of its repeats in a row were done, back from day d (d counts once done, and doesn't break it while open). */
export function streakOf(sid, d, cap = 400) {
  const s = store.get(sid); if (!s?.r) return 0;
  let n = 0, day = d;
  for (let i = 0; i < 400 && n < cap && day >= s.d; i++, day = add(day, -1)) {
    if (!repeatsOn(s.r, s.d, day)) continue;
    const o = store.get(occId(sid, day)); if (!o) continue; // a skipped day neither counts nor breaks it
    if (isDone(o)) n++; else if (day !== d) break;
  }
  return n;
}
/** Each habit is a villager who rises with its streak: a peasant, a guard at 7 days running, a knight at 21.
    A guard brings 1 bonus gold on the days its habit is done, a knight 2. Miss a day and it's a peasant again. */
export const RANKS = [{ n: 'Peasant', at: 0, b: 0 }, { n: 'Guard', at: 7, b: 1 }, { n: 'Knight', at: 21, b: 2 }];
const rankAt = d => perk('Hut', d) ? [0, 5, 15] : [0, 7, 21]; // the Hut drills them faster
export const rankOf = (run, d) => { const a = rankAt(d); return run >= a[2] ? 2 : run >= a[1] ? 1 : 0; };
/** How each quest stands at time `now`, with the dragon's grace (minutes after a timed quest ends). */
/** When the dragon swoops on a quest planned at s for m minutes: when its block ends plus the dragon's grace.
    It waits out your calendar: time in events inside that stretch is added on, and it never swoops mid-event. */
export function deadline(d, s, m, grace) {
  if (s == null) return null;
  const ev = timedOn(d).map(e => [e.s, e.s + e.m]).sort((a, b) => a[0] - b[0]);
  const base = s + m + grace; let end = base;
  for (let k = 0; k < 6; k++) {
    let busy = 0, cur = -1; // minutes of events between s and end, overlaps counted once
    for (const [a, b] of ev) { const x = Math.max(a, s, cur), y = Math.min(b, end); if (y > x) busy += y - x; cur = Math.max(cur, Math.min(b, end)); }
    let next = base + busy;
    for (const [a, b] of ev) if (next > a && next < b) next = b;
    if (next === end) break; end = next;
  }
  return Math.min(end, 24 * 60);
}
function judge(q, d, now, grace) {
  q.byMin = q.fixedBy ?? deadline(d, q.s, q.m, grace); q.shield = q.s != null && q.byMin != null && q.byMin > Math.min(q.s + q.m + grace, 24 * 60);
  const by = at(d, q.byMin ?? 24 * 60);
  q.by = by;
  if (q.done) { const t = doneAt(q.n); q.st = !t || t <= by ? 'kept' : 'late'; }
  else q.st = now > by ? 'taken' : 'open';
  q.you = q.st === 'kept' || q.st === 'open' ? q.g : q.st === 'late' ? Math.ceil(q.g * (perk('Watchtower', d) ? .75 : .5)) : 0;
  q.dragon = q.g - q.you;
  q.bank = q.st === 'kept' ? q.g : q.st === 'late' ? q.you : 0; // gold already safe in the vault
  return q;
}
function score(d, now, grace) {
  const tw = twistOn(d), Qs = judged(d, now, grace).concat(swipesOn(d), delaysOn(d));
  markDay(d, Qs); see(d, Qs);
  const mk = Qs.find(q => q.n.id === Q.marks[d] && q.st !== 'swiped'); if (mk) mk.mark = true;
  const total = Qs.reduce((a, q) => a + q.g, 0), held = Qs.reduce((a, q) => a + q.you, 0);
  // event bonuses add to what you hold and help win the day, but the dragon can't take them
  let bonus = (bonusOn(d) + (perk('Smithy', d) ? 2 * Object.keys(Q.bonus[d] || {}).length : 0)) * (tw === 'storm' ? 2 : 1);
  const first = Qs.find(q => q.s != null && q.st !== 'swiped'); if (relic('wood', d) && first?.st === 'kept') bonus += 5; // the Dawn Lantern
  if (perk('Tent', d) && first?.st === 'kept') bonus += 3;
  if (mk?.st === 'kept') bonus += mk.g; // the dragon's mark, kept: double
  for (const q of Qs) if (q.n.rs && (q.st === 'kept' || q.st === 'late')) { q.rank = rankOf(streakOf(q.n.rs, d, 21), d); bonus += RANKS[q.rank].b + (perk('Farm', d) ? 1 : 0); } // guards and knights, and the Farm
  return { d, Qs, tw, mark: mk || null, total, bonus, you: held + bonus, dragon: total - held, bank: Qs.reduce((a, q) => a + q.bank, 0) + bonus, need: Math.ceil(total * WIN),
    ember: tw === 'ember' && Qs.filter(q => q.st !== 'swiped').length < 3, ...standsOf(Qs, total, bonus) };
}

/** Where the day's gold is: secured in the keep, still out in the field, or carried off by the dragon.
    The keep holds as soon as enough is secured, and the day falls once too little is left out there to get there. */
function standsOf(Qs, total, bonus) {
  const secured = Qs.reduce((a, q) => a + q.bank, 0) + bonus, field = Qs.filter(q => q.st === 'open').reduce((a, q) => a + q.g, 0), need = Math.ceil(total * WIN);
  return { secured, field, holds: total > 0 && secured >= need, falls: total > 0 && secured + field < need };
}
/** The whole realm as of now: every finished day since it began, today live, the vault, the dragon. */
export function realm() {
  catchMoves();
  const T = today(), now = new Date(), start = Q.start || T, days = [];
  let vault = 0, hoard = 0, streak = 0, lost = 0, burned = 0, frozeWk = null;
  for (let d = start; d <= T; d = add(d, 1)) {
    const up = standing(vault), nb = Math.min(burned, Math.max(0, up.length - 1)); RUINED = new Set(nb ? up.slice(-nb) : []);
    const recent = days.slice(-7).reduce((a, x) => a + x.dragon, 0), lvl = dragonAt(recent), H = huntAt(streak);
    const r = score(d, d === T ? now : at(add(d, 1), 0), H.grace + (perk('Well', d) ? 10 : 0));
    r.lvl = lvl; r.hunt = H; r.streak = streak; r.rest = r.total === 0 && !r.ember; r.win = !r.rest && !r.ember && r.you >= r.need;
    days.push(r);
    // relics: the Ember Heart strengthens the streak boost, the Crown adds a tenth
    const boost = (1 + (H.boost - 1) * (relic('ember', d) ? 1.25 : 1)) * (relic('spires', d) ? 1.1 : 1) * (perk('Mill', d) ? 1.1 : 1);
    if (d < T) {
      vault += Math.round(r.you * boost); hoard += r.dragon;
      if (r.win) { streak++; lost = 0; burned = Math.max(0, burned - 1); }
      else if (!r.rest && relic('frost', d) && frozeWk !== weekStart(d)) { frozeWk = weekStart(d); r.frozen = true; } // the Frost Crown holds the streak
      else if (!r.rest) { streak = 0; lost++; if (lost % BURN_AFTER === 0) burned++; }
    } else { vault += Math.round(r.bank * boost); hoard += r.dragon; }
    r.vault = vault; r.streakAfter = streak;
  }
  const last7 = days.slice(-7).reduce((a, x) => a + x.dragon, 0), H = huntAt(streak);
  burned = Math.min(burned, Math.max(0, standing(vault).length - 1));
  const R = { start, days, vault, hoard, lvl: days.length ? days[days.length - 1].lvl : 0, last7, streak, lost, burned, hunt: H, grace: H.grace + (perk('Well', T) ? 10 : 0),
    ruins: standing(vault).slice(standing(vault).length - burned), byDay: new Map(days.map(x => [x.d, x])) };
  R.held = REGIONS.filter(x => Q.kg.won[x.id]).map(x => x.id); R.title = titleFor(R.held.length, R.held.includes('spires'));
  R.camp = campaignOf(R); R.canMarch = !Q.kg.camp && vault >= MARCH_AT;
  return R;
}
/** One day, as the plan shows it. A day before the realm began or still ahead is judged at its start (nothing taken yet). */
export function dayView(d, R) {
  const r = R.byDay.get(d); if (r) return r;
  const x = score(d, d > today() ? at(d, 0) : at(add(d, 1), 0), R.grace); x.ahead = d > today(); x.before = d < R.start; return x;
}

/* ---------- the dragon's voice ---------- */
const PHASE = m => m < 11 * 60 ? 'morning' : m < 17 * 60 ? 'day' : m < 21 * 60 ? 'evening' : 'night';
const pick = (L, seed) => L[Math.abs([...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)) % L.length];
function fallback(r, R) {
  const T = today(), m = new Date().getHours() * 60 + new Date().getMinutes(), seed = r.d + r.dragon + r.you + Math.floor(m / 20);
  const lastTaken = r.Qs.filter(q => q.st === 'taken').sort((a, b) => b.by - a.by)[0];
  const next = r.Qs.find(q => q.st === 'open'), nt = next?.n.t;
  if (r.rest) return pick(['No quests today? Then I sleep on my gold. Wake me when there is something to steal.', 'An empty day. I will nap. Plan something and I will be watching.', 'Nothing on the table. I shall count my hoard instead. Again.', 'A day with no quests is a day with no gold. For either of us.', 'Rest, keeper. I am resting too. On a very comfortable pile of your coins.'], seed);
  if (r.d < T) return r.win ? pick([`You held ${r.you} to my ${r.dragon}. I will be hungrier tomorrow.`, `${r.you} kept. Fine. The keep stands, for now.`, `I remember this day. I do not like this day.`, `${r.dragon} gold. That's all I got. Your villagers sang about it, I heard them.`, 'You won this one. I have filed it under grudges.'], seed)
    : pick([`${r.dragon} gold to me. That was a good day for dragons.`, `I ate well: ${r.dragon} gold. Your walls looked thin.`, 'A fine day. I still have the taste of your gold in my teeth.', `I flew home heavy that night. ${r.dragon} gold heavy.`, 'Ah, this day. One of my favourites.'], seed);
  if (!next && r.Qs.length) return r.dragon === 0 ? pick(['Not one coin. I circled all day and you left me nothing.', 'A clean sweep. I am going to go sulk on my crag.', 'Every pile in the keep. Do you know how embarrassing this is for a dragon?'], seed)
    : r.win ? pick([`You win this one, ${r.you} to ${r.dragon}. Sleep with one eye open.`, `${r.you} to ${r.dragon}. Enjoy it. I'll be back at dawn, and I'll be hungry.`, 'The keep held. I got scraps. I will remember the taste of scraps.'], seed)
    : pick([`${r.dragon} to me. The day is mine. Rematch at dawn.`, 'The field is empty and my belly is full. Good night, keeper.', 'I win. Say hello to your gate for me. I will be visiting it at midnight.'], seed);
  if (lastTaken && r.dragon > 0 && Date.now() - lastTaken.by < 3 * 3600e3) return pick([`${lastTaken.n.t} went unguarded, so ${lastTaken.dragon} gold is mine. Check it off and I will give back half.`, `I took ${lastTaken.dragon} gold while ${lastTaken.n.t} sat there. Delicious.`, `${lastTaken.n.t}? Lovely pile. Was lovely. Is mine.`, `You left ${lastTaken.n.t} in the open. I am a dragon. What did you think would happen?`, `Mmm, ${lastTaken.n.t}. Tastes like procrastination.`], seed);
  if (r.mark?.st === 'open' && PHASE(m) === 'morning') return pick([`I have marked ${r.mark.n.t}. Keep it and it pays double. I'm betting you won't.`, `My mark is on ${r.mark.n.t} today. ${r.mark.g * 2} gold if you keep it. I like my odds.`, `See my red pennant on ${r.mark.n.t}? That pile is spoken for. By me.`], seed);
  if (r.mark?.st === 'kept') return pick([`You kept ${r.mark.n.t}. My pennant is in the mud. I am not talking about it.`, `Double gold for ${r.mark.n.t}. I marked the wrong pile. It happens. Rarely.`], seed);
  const soon = next?.byMin != null && next.byMin - m > 0 && next.byMin - m <= 45 ? next : null;
  if (soon) return pick([`${soon.n.t}. ${soon.byMin - m} minutes. I am stretching my wings.`, `I can see ${soon.n.t} from up here. ${fmtT(soon.byMin)} and it's mine.`, `Tick, tock, ${soon.n.t}. I dive at ${fmtT(soon.byMin)}.`, `Don't mind me. Just circling ${soon.n.t}. No reason.`], seed);
  if (r.dragon === 0) return PHASE(m) === 'morning' ? pick(['Morning. Every coin is still in your vault. I am patient.', `${r.total} gold on the table today. I only need you to look away once.`, 'Good morning, keeper. I have already picked out which pile I want.', `Dawn paid you ${r.total} gold. Generous sun. Careless keeper, I hope.`, `${nt ? nt + ' looks heavy this morning. ' : ''}I do love a heavy pile.`], seed)
    : pick(['Nothing for me yet. Annoying.', 'Still not a coin. I am getting hungry.', 'You are being suspiciously productive today.', `Fine. Keep going. ${nt ? nt + ' is still out there, though.' : 'I can wait.'}`, 'My belly is rumbling and it is your fault.'], seed);
  if (r.holds) return pick([`Your keep holds today. Fine. I'll still take whatever you leave in the field${nt ? `, starting with ${nt}` : ''}.`, 'Your walls held. The rest of the field is still fair game.', 'The day is yours. The leftovers are mine.', `You won the day. ${nt ? `But ${nt} is still lying there, and I am still a dragon.` : 'Enjoy it.'}`], seed);
  if (r.falls) return pick(['Too little left out there for you now. Today is mine. Rematch at dawn.', 'The day is mine. Sleep well, keeper. I know I will.', 'Your gate creaks already. I can hear it from my crag.', 'Do the rest anyway. I like watching you try.'], seed);
  return next ? pick([`${r.need - r.secured} more to secure before your keep holds. ${nt}${next.byMin != null ? ` is mine at ${fmtT(next.byMin)}` : ' is still out there'}.`, `You need ${r.need - r.secured} more. I need you to do nothing. Easier job, mine.`, `${nt} is out in the field. I am up here. Think about it.`, `${r.secured} safe, ${r.field} out there, and me in between.`], seed) : 'Not much left for me to take.';
}
const LINES = 'daybook-quest-lines';
// A different angle each time Claude is asked, so the dragon doesn't fall into one voice
const ANGLES = ['gloat about something specific that happened', 'make a precise threat naming a quest and the minute you dive', 'mock-sympathetic, as if you feel sorry for them', 'a backhanded compliment', 'brag about your hoard or your size', 'propose a cheeky bargain or wager', 'grumble like a sore loser', 'a two-line rhyming couplet', 'gossip about what their villagers are saying', 'an ominous omen about the weather or the sky', 'count coins out loud', 'a dramatic old-world proclamation', 'reminisce about a quest you ate this week', 'pretend to be bored and not watching (you are watching)', 'scheme out loud about your next move', 'tease them about a habit and its villager'];
let asking = null, lastAsk = 0;
/** What the dragon says right now: a line from Claude when there is one for this moment, otherwise one of its stock lines.
    Claude is asked again when the score moves, every twenty minutes, or when the person taps the dragon. */
export function line(r, R, fresh = false) {
  const T = today(), base = fallback(r, R);
  if (r.d !== T) return base;
  const m = new Date().getHours() * 60 + new Date().getMinutes();
  const key = `${r.d}|${r.you}|${r.dragon}|${r.Qs.filter(q => q.st === 'open').length}|${Math.floor(m / 20)}`;
  const said = lsGet(LINES, {});
  const have = said.d === T && said.L?.[key];
  if (client && !asking && (!have || fresh) && Date.now() - lastAsk > (fresh ? 8e3 : 60e3)) {
    lastAsk = Date.now();
    asking = askDragon(r, R, PHASE(m), said.d === T ? said.recent || [] : []).then(t => { if (t) { const s = lsGet(LINES, {}); if (s.d !== T) { s.d = T; s.L = {}; s.recent = []; } s.L[key] = t; s.recent = [...(s.recent || []), t].slice(-6); lsSet(LINES, s); onUpdate(); } }).finally(() => { asking = null; });
  }
  return have || base; // until Claude's line for this moment arrives
}
/** Tap the dragon and it says something new. */
export const taunt = () => { const R = realm(), r = R.byDay.get(today()); if (r) line(r, R, true); };
const SNAP = 'daybook-quest-snap';
/** What changed since the dragon last spoke: quests kept, taken, chased down, moved. */
function sinceLast(r) {
  const was = lsGet(SNAP, {}), now = {}, out = [];
  for (const q of r.Qs) { const k = q.n.id + (q.st === 'swiped' ? '#s' : ''); now[k] = q.st; if (was.d === r.d && was.st?.[k] !== q.st) out.push(q.st === 'swiped' ? `${q.pushed != null ? 'pushed later' : 'moved off today'}: ${q.n.t}` : `${q.st}: ${q.n.t}`); }
  lsSet(SNAP, { d: r.d, st: now });
  return out.slice(0, 6);
}
async function askDragon(r, R, phase, recent) {
  const facts = {
    time: fmtT(new Date().getHours() * 60 + new Date().getMinutes()), phase,
    gold_on_table: r.total, secured_in_keep: r.secured, still_in_field: r.field, keep_already_holds_today: r.holds, day_already_lost: r.falls, you_hold_if_rest_kept: r.you, bonus_from_events_attended: r.bonus, dragon_has: r.dragon, need_to_win: r.need,
    dragons_mark: r.mark ? { quest: r.mark.n.t, state: r.mark.st, pays_if_kept: r.mark.g * 2 } : null,
    quests: r.Qs.map(q => ({ title: q.n.t, gold: q.g, ...(q.mark ? { marked: true } : {}), planned: q.s != null ? fmtT(q.s) : 'any time', swoops_at: q.byMin != null ? fmtT(q.byMin) : 'midnight', state: q.st })),
    dragon_form: DRAGONS[R.lvl].name, dragon_took_last_7_days: R.last7, your_win_streak: R.streak, dragon_hunting: R.hunt.name,
    days_lost_in_a_row: R.lost, buildings_burned_by_dragon: R.ruins, your_title: R.title, regions_held: R.held.map(id => regionOf(id).name),
    campaign: R.camp?.begun ? { region: R.camp.reg.name, you_play: `the ${R.camp.reg.dragon} in this region`, twist_today: regionOf(R.camp.twist)?.short, day: R.camp.day, of: CAMPAIGN_DAYS, days_won: R.camp.wins } : null,
    vault: R.vault, village: raised(R.vault),
    this_week: week(R).map(w => w.res).filter(Boolean).join(' '), days_since_realm_began: daysBetween(R.start, today()),
    settlement: rankName(R.vault), yesterday: (y => y && !y.rest ? (y.win ? `they held the keep, ${y.you} to ${y.dragon}` : `you won, ${y.dragon} gold`) : null)(R.byDay.get(add(today(), -1))),
    habits: r.Qs.filter(q => q.n.rs && q.st !== 'swiped').map(q => { const run = streakOf(q.n.rs, r.d); return { title: q.n.t, villager: RANKS[rankOf(run, r.d)].n, days_running: run, state: q.st }; }),
    moved_or_pushed_today: r.Qs.filter(q => q.st === 'swiped').map(q => ({ title: q.n.t, cost: q.g, how: q.pushed != null ? 'pushed later today' : 'moved off today' })),
    just_happened: sinceLast(r), your_recent_lines_do_not_repeat: recent, angle_for_this_line: ANGLES[Math.floor(Math.random() * ANGLES.length)],
  };
  try {
    const { data, error } = await client.functions.invoke('quest', { body: { facts } });
    if (error || !data?.line) return null;
    return String(data.line).slice(0, 280);
  } catch { return null; }
}

/* ---------- reminders (see remind.js) ---------- */
/** What to send over the coming week, and when: a morning count of the gold at stake, each timed quest as it
    starts, a warning 15 minutes before the dragon swoops on one, and at 8pm whatever is still out. */
export function plan(days = 7) {
  const R = realm(), grace = R.grace, now = new Date(), out = [];
  const push = (key, t, title, body) => { if (t > now) out.push({ key, at: t.toISOString(), title, body, tag: key }); };
  for (let i = 0; i < days; i++) {
    const d = add(today(), i), Qs = judged(d, now, grace).filter(q => !q.done);
    if (pd(d).getDay() === 0 && Q.start && Q.start <= d) push(`${d}|report`, at(d, 18 * 60), 'Your battle report is in', 'The dragon has written up your week. Come and read it.');
    if (!Qs.length) continue;
    const total = Qs.reduce((a, q) => a + q.g, 0), first = Qs.find(q => q.s != null);
    const morn = Math.min(first ? Math.max(first.s - 30, 6 * 60) : 9 * 60, 9 * 60);
    const mk = Qs.find(q => q.n.id === Q.marks[d]);
    push(`${d}|morning`, at(d, morn), `${total} gold on the table today`, `${Qs.length} quest${Qs.length > 1 ? 's' : ''}${first ? `, starting with ${first.n.t} at ${fmtT(first.s)}` : ''}. ${mk ? `The dragon has marked ${mk.n.t}: keep it for double.` : 'The dragon is watching.'}`);
    for (const q of Qs) {
      if (q.s == null) continue;
      if (q.s > morn) push(`${q.n.id}|start`, at(d, q.s), `${q.n.t}, now`, `Worth ${q.g} gold. The dragon swoops at ${fmtT(q.byMin)}.`);
      push(`${q.n.id}|warn`, at(d, q.byMin - 15), `The dragon is circling`, `It takes ${q.n.t} in 15 minutes. Check it off to keep ${q.g} gold.`);
    }
    const loose = Qs.filter(q => q.s == null);
    if (loose.length) push(`${d}|evening`, at(d, 20 * 60), `${loose.reduce((a, q) => a + q.g, 0)} gold still out`, `${loose.map(q => q.n.t).slice(0, 3).join(', ')}${loose.length > 3 ? ' and more' : ''}. The dragon feeds at midnight.`);
  }
  return out;
}

/* ---------- the week ---------- */
export function week(R, anchor = today()) {
  const ws = weekStart(anchor), T = today();
  return [...Array(7)].map((_, i) => {
    const d = add(ws, i), r = R.byDay.get(d);
    const res = !r || d > T ? null : r.rest ? 'rest' : d === T ? 'live' : r.win ? 'W' : 'L';
    return { d, res, r };
  });
}

/* ---------- the battle report ---------- */
// From Sunday at 6pm until Tuesday is over, the dragon writes up the week (Monday to Sunday): who won each day,
// your best moment, the quest it ate most. The numbers are worked out here; Claude writes the letter in the dragon's voice.
const REPORTS = 'daybook-quest-reports';
/** The Monday of the week that has a report to read right now, or null. */
export function reportWeek(now = new Date()) {
  const T = today(), dow = (now.getDay() + 6) % 7; // Monday 0 .. Sunday 6
  const ws = dow === 6 && now.getHours() >= 18 ? weekStart(T) : dow <= 1 ? add(weekStart(T), -7) : null;
  return ws && Q.start && Q.start <= add(ws, 6) ? ws : null;
}
/** The week's numbers, from the realm. */
export function weekStats(R, ws) {
  const days = [...Array(7)].map((_, i) => { const d = add(ws, i), r = R.byDay.get(d); return { d, r, res: !r ? null : r.rest ? 'rest' : d === today() ? (r.win ? 'W' : 'live') : r.win ? 'W' : 'L' }; });
  const played = days.filter(x => x.r && !x.r.rest), won = days.filter(x => x.res === 'W'), lost = days.filter(x => x.res === 'L');
  const kept = played.reduce((a, x) => a + x.r.you, 0), taken = played.reduce((a, x) => a + x.r.dragon, 0);
  const ate = {}; // gold the dragon took from each quest, by title
  for (const x of played) for (const q of x.r.Qs) if (q.dragon > 0 || q.st === 'swiped') ate[q.n.t || 'Untitled'] = (ate[q.n.t || 'Untitled'] || 0) + (q.st === 'swiped' ? q.g : q.dragon);
  const most = Object.entries(ate).sort((a, b) => b[1] - a[1])[0] || null;
  const best = won.map(x => ({ x, m: x.r.total ? x.r.you / x.r.total : 0 })).sort((a, b) => b.m - a.m || b.x.r.you - a.x.r.you)[0]?.x || null;
  const marks = played.filter(x => x.r.mark), marksKept = marks.filter(x => x.r.mark.st === 'kept');
  const before = R.byDay.get(add(ws, -1))?.vault ?? 0, after = days.filter(x => x.r).pop()?.r.vault ?? before;
  const built = raised(after).slice(raised(before).length);
  const bestStreak = Math.max(0, ...days.filter(x => x.r).map(x => x.r.streakAfter ?? 0));
  return { ws, days, played: played.length, won: won.length, lost: lost.length, kept, taken, most, best, marks: marks.length, marksKept: marksKept.length,
    marksKeptT: marksKept.map(x => x.r.mark.n.t), built, bestStreak, streak: R.streak };
}
const reports = () => lsGet(REPORTS, {});
/** The report for week ws: its numbers and the dragon's letter (Claude's, once it has written it). */
export function report(R, ws = reportWeek()) {
  if (!ws) return null;
  const W = weekStats(R, ws); if (!W.played) return null;
  const saved = reports()[ws] || {};
  if (!saved.text && client && !writing) {
    writing = writeReport(W, R).then(t => { if (t) { const all = reports(); all[ws] = { ...(all[ws] || {}), text: t }; for (const k of Object.keys(all)) if (daysBetween(k, ws) > 56) delete all[k]; lsSet(REPORTS, all); onUpdate(); } }).finally(() => { writing = null; });
  }
  return { ...W, text: saved.text || reportFallback(W), closed: !!saved.closed };
}
let writing = null;
export function closeReport(ws, closed = true) { const all = reports(); all[ws] = { ...(all[ws] || {}), closed }; lsSet(REPORTS, all); }
function reportFallback(W) {
  if (W.won > W.lost) return `${W.won} days to you, ${W.lost} to me. I counted every coin you kept: ${W.kept}. Next week I come hungrier.`;
  if (W.lost > W.won) return `${W.lost} days to me, ${W.won} to you. ${W.most ? `${W.most[0]} was delicious.` : ''} Same time next week?`;
  return `${W.won} each. A draw, and I hate a draw. Next week we settle it.`;
}
async function writeReport(W, R) {
  const facts = {
    week_of: `${MON[pd(W.ws).getMonth()]} ${pd(W.ws).getDate()}`, sunday_still_going: W.days[6].res === 'live',
    days: W.days.map(x => ({ day: DAYN[pd(x.d).getDay()], result: x.res === 'W' ? 'you won' : x.res === 'L' ? 'dragon won' : x.res === 'rest' ? 'rest day' : x.res === 'live' ? 'still going' : 'before the realm began', you_kept: x.r?.you, dragon_took: x.r?.dragon })),
    days_you_won: W.won, days_dragon_won: W.lost, gold_you_kept: W.kept, gold_dragon_took: W.taken,
    your_best_day: W.best ? { day: DAYN[pd(W.best.d).getDay()], kept: W.best.r.you, of: W.best.r.total } : null,
    quest_dragon_ate_most: W.most ? { title: W.most[0], gold: W.most[1] } : null,
    dragons_marks_kept: `${W.marksKept} of ${W.marks}`, marks_kept: W.marksKeptT,
    buildings_built_this_week: W.built, win_streak_now: W.streak, best_streak_this_week: W.bestStreak,
    buildings_burned_now: R.ruins, your_title: R.title, vault: R.vault,
    campaign: R.camp?.begun ? { region: R.camp.reg.name, you_play: `the ${R.camp.reg.dragon}`, day: R.camp.day, of: CAMPAIGN_DAYS, days_won: R.camp.wins } : null,
  };
  try {
    const { data, error } = await client.functions.invoke('quest', { body: { facts, kind: 'report' } });
    if (error || !data?.line) return null;
    return String(data.line).slice(0, 900);
  } catch { return null; }
}
function reportCard(B) {
  const cell = x => `<div class="qw-d"><i class="${x.res === 'W' ? 'w' : x.res === 'L' ? 'l' : x.res === 'rest' ? 'r' : x.res === 'live' ? 't' : ''}">${x.res === 'W' || x.res === 'L' ? x.res : x.res === 'rest' ? '–' : x.res === 'live' ? '•' : ''}</i>${DAYN[pd(x.d).getDay()]}</div>`;
  const lines = [
    `<li><span>Gold</span><b><b class="you">${B.kept} kept</b>, <b class="dr">${B.taken} taken</b></b></li>`,
    B.best ? `<li><span>Best moment</span><b>${DAYN[pd(B.best.d).getDay()]}: kept ${B.best.r.you} of ${B.best.r.total}</b></li>` : '',
    B.most ? `<li><span>It ate most</span><b>${esc(B.most[0])} (${B.most[1]} gold)</b></li>` : '',
    B.marks ? `<li><span>Its marks</span><b>${B.marksKept} of ${B.marks} kept</b></li>` : '',
    B.built.length ? `<li><span>Built</span><b>${esc(listOf(B.built.map(b => b.toLowerCase())))}</b></li>` : '',
  ].join('');
  return `<section class="q-report" aria-label="The Dragon's Due: your week"><div class="q-report-top"><b>The Dragon's Due</b><span>Week of ${MON[pd(B.ws).getMonth()]} ${pd(B.ws).getDate()}</span><button class="q-x" data-act="q-report-x" data-w="${B.ws}" aria-label="Close The Dragon's Due">×</button></div>
    <div class="q-week">${B.days.map(cell).join('')}</div>
    <p class="q-report-score">You <b class="you">${B.won}</b> · the dragon <b class="dr">${B.lost}</b></p>
    <ul>${lines}</ul>
    <div class="q-say"><i class="q-face" aria-hidden="true"></i><p>${esc(B.text)}</p></div></section>`;
}

/* ---------- the picture: the village (or a campaign camp) and the dragon, in 3D from a corner, drawn tiny (keep3d.js, crt.js) ---------- */
const CAMP = [[0, 'Campfire'], [40, 'Tent'], [100, 'Hut'], [180, 'Well'], [280, 'Watchtower']]; // a campaign's camp grows on the gold kept there
const src = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: SW, height: SH }) : null;
// The picture's size: a strip over the list, taller, or the whole screen. The button in its corner steps through them.
const SIZES = ['strip', 'tall', 'full'], SIZE = 'daybook-keep-size';
let size = SIZES.includes(lsGet(SIZE, 'strip')) ? lsGet(SIZE, 'strip') : 'strip';
const heightOf = () => size === 'tall' ? 208 : size === 'full' && typeof innerWidth !== 'undefined' ? Math.max(SH, Math.min(560, Math.round(SW * innerHeight / Math.max(1, innerWidth) / 2) * 2)) : SH;
/** What the picture shows right now. */
export function sceneOf(R) {
  const C = R.camp?.begun ? R.camp : null, m = new Date().getHours() * 60 + new Date().getMinutes();
  const held = REGIONS.filter(x => R.held.includes(x.id)), r = R.byDay.get(today());
  const live = { folk: folkOf(r), mode: modeOf(r, m), piles: pilesOf(r, m).filter(p => p.st === 'open'), gate: R.lost > 0, fx: fx.map(e => ({ ...e, age: tick - e.t0 })) };
  return C ? { ...live, land: C.id === 'spires' ? 'spires' : C.id, phase: phaseOf(m), buildings: CAMP.filter(b => C.gold >= b[0]).map(b => b[1]), ruins: [], held, lvl: R.lvl, hoard: R.last7, gold: 0, camp: true, campInk: C.reg.ink }
    : { ...live, land: 'vale', phase: phaseOf(m), buildings: standing(R.vault), ruins: R.ruins, held, lvl: R.lvl, hoard: R.last7, gold: R.vault };
}
/** Today's habits as villagers in the picture: done ones are out on their rounds, the rest wait by the well. */
const folkOf = r => (r?.Qs || []).filter(q => q.n.rs && q.st !== 'swiped').slice(0, 8).map(q => ({ rank: rankOf(streakOf(q.n.rs, r.d, 21), r.d), done: q.st === 'kept' || q.st === 'late' }));
/** What the dragon is up to right now. It sleeps when there's nothing left to take, and circles over your gold in the
    grace after a quest's time ends, unless you're out at an event: it won't dive into a crowd, so it waits on its crag. */
function modeOf(r, m) {
  if (!r || r.rest) return 'sleep';
  const open = r.Qs.filter(q => q.st === 'open'); if (!open.length) return 'sleep';
  const crowd = timedOn(r.d).some(e => m >= e.s && m < e.s + e.m);
  return !crowd && open.some(q => q.s != null && m >= q.s + q.m && m < q.byMin) ? 'circle' : 'perch';
}
let fx = [], seen = null;
/** Today's quests as piles of gold in the field, each in a fixed spot for the day. */
const pilesOf = (r, m = -1) => { const L = (r?.Qs || []).filter(q => q.st !== 'swiped'); return L.map((q, slot) => ({ id: q.n.id, slot, of: L.length, g: q.g, mark: !!q.mark, st: q.st, hot: q.s != null && m >= q.s + q.m && m < q.byMin })); }; // hot: in its grace, the dragon circling it
const RECKONED = 'daybook-keep-reckoned';
/** Compares the day with how it looked last time, and plays what changed: gold into the keep, a dive, a new building. */
function happenings(R) {
  const r = R.byDay.get(today()); if (!r) return;
  const now = { d: r.d, st: new Map(r.Qs.filter(q => q.st !== 'swiped').map(q => [q.n.id, q.st])), built: villageAt(R.vault), holds: r.holds };
  fx = fx.filter(e => tick - e.t0 < 60);
  // midnight's reckoning: the first time the app is open on a new day, yesterday's verdict plays out at the gate
  const y = add(today(), -1), ry = R.byDay.get(y);
  if (ry && !ry.rest && lsGet(RECKONED, '') < y) {
    lsSet(RECKONED, y);
    fx.push({ kind: ry.win ? 'held' : 'breach', t0: tick + 4 });
    setTimeout(ry.win ? sfx.thud : sfx.crash, 4 * 180 + 1400); if (ry.win) setTimeout(sfx.fanfare, 4 * 180 + 1900); else setTimeout(sfx.roar, 4 * 180 + 2300);
  }
  if (seen && seen.d === now.d) {
    let dove = null;
    for (const p of pilesOf(r)) {
      const was = seen.st.get(p.id); if (was === p.st) continue;
      if (p.st === 'kept') { fx.push({ kind: 'kept', t0: tick, n: p.mark ? 10 : 6, slot: p.slot, of: p.of }); sfx.coin(p.mark); }
      else if (p.st === 'late') { fx.push({ kind: 'kept', t0: tick, n: 3, slot: p.slot, of: p.of }); sfx.chase(); }
      else if (p.st === 'taken' && was === 'open') dove = dove || p;
    }
    if (dove && !fx.some(e => e.kind === 'swoop' && tick - e.t0 < SWOOP)) { fx.push({ kind: 'swoop', t0: tick, slot: dove.slot, of: dove.of, g: dove.g }); sfx.roar(); }
    if (now.holds && !seen.holds) { fx.push({ kind: 'held', t0: tick + 6 }); setTimeout(sfx.thud, 6 * 180 + 1400); setTimeout(sfx.fanfare, 6 * 180 + 1900); }
    if (now.built > seen.built) { fx.push({ kind: 'built', t0: tick }); setTimeout(sfx.fanfare, 900); }
  }
  seen = now;
}
export function draw(R, tick = 0) {
  const h = heightOf(); if (src.height !== h) src.height = h;
  const scr = screen('quest', SW, h); paint(src, sceneOf(R), tick); scr.show(src);
  const el = document.getElementById('q-canvas'); if (el?.querySelector('canvas') && scr.cv.parentNode !== el) mount(scr, el, el.dataset.label); // a new screen, after the phone dropped the old one
  return scr;
}

/* ---------- the view ---------- */
const a_n = w => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w.toLowerCase();
/** How far the gold is toward the next building: a bar under the picture. */
function buildBar(list, gold, where) {
  const i = list.findIndex(b => gold < b[0]);
  if (i < 0) return `<div class="q-build done"><span>${where === 'camp' ? 'Your camp is complete' : 'Your castle is complete. March on a region from the Kingdom'}</span></div>`;
  const from = list[i - 1]?.[0] || 0, to = list[i][0], pct = Math.max(0, Math.min(100, (gold - from) / (to - from) * 100));
  const [, b, rank] = list[i], or = L => L.length > 1 ? L.slice(0, -1).join(', ') + ' or ' + L[L.length - 1] : L[0] || '';
  const what = b ? (rank && rank !== b ? `${rank}: ${a_n(b)}` : a_n(b)) : where === 'vale' && choosing(gold) ? `${rank}: another building to choose` : `${rank}: pick ${or(offerNow().map(x => x.toLowerCase()))}`;
  return `<div class="q-build" role="img" aria-label="Next: ${esc(what)}, ${gold} of ${to} gold"><div class="q-build-top"><span>Next: <b>${esc(what.split(':')[0])}</b>${what.includes(':') ? esc(':' + what.split(':')[1]) : ''}</span><span class="n">${gold.toLocaleString()} / ${to.toLocaleString()}</span></div><div class="q-build-bar"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
}
/** At a mark you haven't chosen for, the villagers wait for your call: three buildings, each with its perk. */
function pickCard(R) {
  const c = choosing(R.vault); if (!c) return '';
  return `<div class="q-pick"><b>Your settlement is now ${esc(a_n(c.at[2]))}. Choose what to build</b><p>Pick one of these. Its perk starts tomorrow.${c.due > 1 ? ` You have ${c.due} buildings to choose.` : ''}</p>
    <div class="q-pick-opts">${c.offer.map(b => `<button data-act="q-pick" data-b="${b}"><b>${b}</b><small>${esc(PERKS[b])}</small></button>`).join('')}</div></div>`;
}
const BUILT = 'daybook-keep-built';
/** The day a new building goes up, a card says so. The first time the app sees your village, it just remembers it. */
function builtCard(n, R) {
  const was = lsGet(BUILT, null);
  if (!was || n < was.n) { lsSet(BUILT, { n, on: null }); return ''; }
  if (n > was.n) lsSet(BUILT, { n, on: today() });
  const b = lsGet(BUILT, {}); if (b.on !== today() || n < 2) return '';
  const name = raised(R.vault)[n - 1], nx = BUILDINGS.find(b => R.vault < b[0]);
  return `<div class="q-built"><b>Your villagers raised ${esc(name === 'Castle walls' ? 'the castle walls' : name === 'Castle' ? 'the castle' : a_n(name))}</b><p>${nx ? `At ${nx[0].toLocaleString()} gold your settlement becomes ${esc(a_n(nx[2]))}${nx[1] ? ` with ${esc(a_n(nx[1]))}` : ', and you choose another building'}.` : 'Your castle is complete. You can march on a region from the Kingdom.'}</p></div>`;
}
/** The campaign under way, or how the last one ended (shown the day it was settled). */
function campCard(C, R) {
  const news = Q.kg.news;
  if (!C) {
    if (!news || news.on !== today()) return '';
    const g = regionOf(news.id);
    return news.res === 'won' ? `<div class="q-camp won" style="--rc:${g.ink}"><b>${esc(g.name)} is yours</b><p>The ${esc(g.dragon)} has fled. You take the ${esc(g.relic)}: ${esc(g.relicTxt)} You are now ${/^[AEIOU]/.test(R.title) ? 'an' : 'a'} ${esc(R.title)}.</p></div>`
      : `<div class="q-camp" style="--rc:${g.ink}"><b>The ${esc(g.dragon)} held ${esc(g.name)}</b><p>The campaign is over. Rest, then march again from the Kingdom whenever you're ready.</p></div>`;
  }
  const g = C.reg;
  if (!C.begun) return `<div class="q-camp" style="--rc:${g.ink}"><b>Marching on ${esc(g.name)}</b><p>The campaign begins tomorrow at dawn. ${esc(g.twist)}</p></div>`;
  const tw = C.id === 'spires' ? `Today's twist: ${regionOf(C.twist).short.toLowerCase()}.` : g.short + '.';
  const prog = C.heads?.length ? `${C.heads.filter(h => h.cut).length} of ${C.heads.length} heads cut` : C.id === 'ember' ? `Best streak ${C.best} of ${g.need}${C.run ? `, now ${C.run}` : ''}` : `${C.wins} of ${g.need} days won`;
  const pct = C.heads?.length ? C.heads.filter(h => h.cut).length / C.heads.length : C.id === 'ember' ? C.best / g.need : C.wins / g.need;
  const heads = C.heads?.length ? `<div class="q-heads">${C.heads.map(h => `<span class="${h.cut ? 'cut' : ''}">${esc(h.t)}<i>${h.cut ? 'cut' : `${h.run}/5`}</i></span>`).join('')}</div>` : '';
  return `<div class="q-camp" style="--rc:${g.ink}"><div class="q-camp-top"><b>${esc(g.name)}</b><span>Day ${C.day} of ${CAMPAIGN_DAYS}</span></div><p>${esc(tw)}</p>
    <div class="q-camp-bar"><i style="width:${Math.min(100, pct * 100).toFixed(0)}%"></i></div><small>${prog} · ${CAMPAIGN_DAYS - C.day} days left</small>${heads}</div>`;
}
/* ---------- how it works: the first time, the story in four screens ---------- */
const INTRO = 'daybook-keep-intro-2'; // bumped when the story changes, so it's told again
const STORY = [
  ['Hold the Keep', 'Every day has a dragon: the hours that slip away. Here, it has wings, and it plays against you.'],
  ['Each dawn, the sun pays you the day', 'Every quest on your plan, each task and habit, lays a pile of gold out in the field, bigger for the longer ones. It\'s yours for the taking.'],
  ['Do a quest, and its gold goes into your keep', 'Gold in the keep is safe. Over the weeks it builds your village, and you choose what goes up, each building with its own perk. Then a castle, then a kingdom.'],
  ['Leave it out, and the dragon takes it', "Once a quest's time passes, the dragon circles for a while, then dives on that pile. Finish it late to chase down half."],
  ['Your habits are your villagers', 'Keep a habit 7 days running and its villager becomes a guard, worth 1 bonus gold each day it\'s done. At 21 days it\'s a knight, worth 2. Miss a day and it\'s a peasant again.'],
  ['Secure enough, and the keep holds', "The score shows what's in your keep, what's still in the field, and what the dragon took. Cross the line and the day is yours. Lose a day and the dragon smashes your gate at midnight."],
];
let step = null;
export const help = () => { step = 0; };
export function next() { step++; if (step >= STORY.length) { step = null; lsSet(INTRO, 1); } }
function intro() {
  if (step == null && !lsGet(INTRO, 0)) step = 0;
  if (step == null) return '';
  const [h, p] = STORY[step], last = step === STORY.length - 1;
  return `<div class="q-intro" role="dialog" aria-modal="true" aria-label="How Hold the Keep works"><div class="q-intro-card">
    <div class="q-intro-dots" aria-hidden="true">${STORY.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>
    <b>${esc(h)}</b><p>${esc(p)}</p>
    <button class="q-btn" data-act="q-intro">${last ? 'Hold the keep' : 'Next'}</button></div></div>`;
}

const listOf = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const STATE_TXT = { kept: 'Safe in the keep', late: 'Chased down: half back', taken: 'Taken', open: '' };
const moveTxt = q => q.pushed != null ? (q.pushed >= 0 ? `Pushed back to ${fmtT(q.pushed)}` : 'Its time taken off') + (q.full ? ' after its time: the dragon keeps it, finish it to win it back' : ', a tenth to the dragon') : q.free ? 'Moved for free: the Hydra Scale paid' : `${q.to ? 'Moved to ' + (q.to === today() ? 'today' : DAYN[pd(q.to).getDay()] + ' ' + pd(q.to).getDate()) : 'Taken off the plan'}, swiped`;
export function html(d, R, opts = {}) {
  const r = dayView(d, R), T = today(), D = DRAGONS[R.lvl], H = R.hunt, C = d === today() ? R.camp : null, B = d === today() ? report(R) : null;
  const sec = r.ahead ? 0 : r.secured, fld = r.ahead ? r.total : r.field, all = Math.max(1, r.total + r.bonus), linePct = WIN * r.total / all * 100;
  const n = villageAt(R.vault), next = BUILDINGS.find(b => R.vault < b[0]);
  const said = esc(line(r, R));
  const cap = r.rest ? 'No quests on this day' : r.ahead ? `${r.total} gold will be out in the field` : r.holds ? (d < T ? `Held with ${sec - r.need} to spare` : `The keep holds${fld ? '. The rest still builds your village' : ''}`) : r.falls ? (d < T ? `${r.need - sec} short` : `Too little left out there to hold today`) : `${r.need - sec} more to hold the keep`;
  const head = d < T && !r.before && !r.rest ? (r.win ? 'The keep held' : 'The dragon won') : d > T ? 'Quests ahead' : r.before ? 'Before the realm began' : d === T && r.holds ? 'The keep holds' : d === T && r.falls ? 'The day is lost' : '';
  const quest = q => {
    const nt = esc(q.n.t || 'Untitled'), hb = q.n.rs ? ' habit' : '', cls = (q.st === 'open' && !r.ahead && q === r.Qs.find(x => x.st === 'open') ? 'open next' : q.st) + hb;
    // A habit shows how many days running it's been kept
    const run = hb && !r.ahead ? streakOf(q.n.rs, d) : 0, ri = rankOf(run, d), rk = RANKS[ri], nx = RANKS[ri + 1] && { ...RANKS[ri + 1], at: rankAt(d)[ri + 1] };
    const runTxt = hb && !r.ahead ? `${rk.n}${run ? `, ${run} day${run > 1 ? 's' : ''} running` : ''}${rk.b && (q.st === 'kept' || q.st === 'late') ? `: +${rk.b} bonus` : nx && run ? `, ${nx.at - run} more to ${nx.n.toLowerCase()}` : ''}. ` : '';
    if (q.st === 'swiped') return `<div class="qx swiped${hb}"><span class="qx-t"></span><span class="qx-ck" aria-hidden="true"></span><button class="qx-n" data-act="open" data-id="${q.n.id}"><b>${nt}</b><small>${moveTxt(q)}</small></button><span class="qx-g">−${q.g}</span></div>`;
    const sub = runTxt + (q.mark && q.st === 'open' ? 'Marked: double if kept. ' : '') + (q.mark && q.st === 'kept' ? 'You beat its mark: double gold' : '') + (q.tw && q.st === 'open' ? q.tw + '. ' : '') + (q.mark && q.st === 'kept' ? '' : q.st === 'open' ? (q.byMin != null ? `The dragon dives at ${fmtT(q.byMin)}${q.shield ? ', it waits out your events' : ''}` : 'Any time today') : q.st === 'taken' ? 'The dragon took it. Finish it to chase down half' : q.st === 'late' && perk('Watchtower', d) ? 'Chased down: three quarters back' : STATE_TXT[q.st]);
    const pts = q.st === 'taken' ? `−${q.g}` : q.st === 'late' ? `+${q.you}` : q.mark && !r.ahead ? `${q.st === 'kept' ? '+' : ''}${q.g * 2}` : `${q.st === 'kept' ? '+' : ''}${q.g}`;
    return `<div class="qx ${cls}${q.mark ? ' marked' : ''}" data-id="${q.n.id}"><span class="qx-t">${q.s != null ? fmtT(q.s) : ''}</span><button class="qx-ck" data-act="toggle" data-id="${q.n.id}" aria-label="Mark ${nt} ${q.done ? 'not done' : 'done'}"></button><button class="qx-n" data-act="open" data-id="${q.n.id}"><b>${q.mark ? `<i class="qx-mk" title="The dragon's mark"></i>` : ''}${nt}</b>${r.ahead ? '' : `<small>${sub}</small>`}</button><span class="qx-g">${pts}</span></div>`;
  };
  // Calendar events sit among the quests by time, hatched like everywhere else in Daybook. They hold no gold.
  const evc = e => /^#[0-9a-f]{3,8}$/i.test(e.color || '') ? ` style="--evc:${e.color}"` : '';
  // A timed event also holds a little bonus gold, claimed with a tap once it has begun.
  const ev = eventsOn(d);
  const evBonus = e => { if (e.allDay || d < R.start) return ''; const i = ev.indexOf(e), got = claimed(d, e), can = got || claimable(d, e);
    return `<button class="qe-g${got ? ' got' : ''}" data-act="q-bonus" data-d="${d}" data-i="${i}"${can ? '' : ' disabled'} aria-label="${got ? `Give back the bonus for ${esc(e.t)}` : `I went to ${esc(e.t)}: claim ${BONUS} bonus gold`}" title="${got ? 'Bonus claimed. Tap to give it back' : can ? 'Went to it? Claim the bonus' : 'Claim once it starts'}">${got ? '✓ ' : ''}+${BONUS}</button>`; };
  const evRow = e => `<div class="qe"${evc(e)}><span class="qx-t">${e.allDay ? 'All day' : fmtT(e.s)}</span><span class="qe-t"><b>${esc(e.t)}</b>${e.allDay ? '' : `<small>${fmtT(e.s)} – ${fmtT(e.s + e.m)}</small>`}</span>${evBonus(e)}</div>`;
  const timedQ = r.Qs.filter(q => q.s != null && q.st !== 'swiped'), loose = r.Qs.filter(q => q.s == null || q.st === 'swiped');
  const seq = [...ev.filter(e => !e.allDay).map(e => [e.s, 0, evRow(e)]), ...timedQ.map(q => [q.s, 1, quest(q)])].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const rows = ev.filter(e => e.allDay).map(evRow).join('') + seq.map(x => x[2]).join('') + loose.map(quest).join('');
  const wk = week(R, d).map(w => `<div class="qw-d${w.d === d ? ' on' : ''}"><i class="${w.res === 'W' ? 'w' : w.res === 'L' ? 'l' : w.res === 'rest' ? 'r' : w.res === 'live' ? 't' : ''}">${w.res === 'W' || w.res === 'L' ? w.res : w.res === 'rest' ? '–' : w.res === 'live' ? '•' : ''}</i>${DAYN[pd(w.d).getDay()]}</div>`).join('');
  const wins = week(R, d).filter(w => w.res === 'W').length, losses = week(R, d).filter(w => w.res === 'L').length;
  return `<div class="qv">${d === T ? intro() : ''}
    <div class="q-scene"><button class="q-size" title="Change the picture's size" aria-label="Change the picture's size"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5H2.5V6M10 2.5h3.5V6M6 13.5H2.5V10M10 13.5h3.5V10"/></svg></button><div id="q-canvas" class="q-tv" data-label="${esc(C?.begun ? `Your camp in ${C.reg.name}` : `Your village${n ? ': ' + raised(R.vault).join(', ') : ''}`)}, and the dragon on its crag"></div>
      <div class="q-tags"><span>${esc(C?.begun ? C.reg.name : rankName(R.vault))}${R.streak ? ` · ${R.streak} day streak` : ''}</span><span class="dr">${esc(C?.begun ? C.reg.dragon : D.name)}</span></div></div>
    ${d === T && !r.before ? (C?.begun ? buildBar(CAMP, C.gold, 'camp') : buildBar(BUILDINGS, R.vault, 'vale')) : ''}
    ${d === T ? pickCard(R) : ''}
    ${d === T && !C?.begun ? builtCard(n, R) : ''}
    ${B && !B.closed ? reportCard(B) : ''}
    ${campCard(C, R)}
    ${R.ruins.length ? `<div class="q-ruin">The dragon burned your ${esc(listOf(R.ruins.map(b => b.toLowerCase())))}. Win a day to rebuild ${R.ruins.length > 1 ? 'one' : 'it'}.${R.ruins.some(x => PERKS[x]) ? ` Until then, ${R.ruins.filter(x => PERKS[x]).length > 1 ? 'their perks are' : `the ${esc(R.ruins.find(x => PERKS[x]).toLowerCase())}'s perk is`} lost.` : ''}</div>`
      : R.lost % BURN_AFTER === BURN_AFTER - 1 && d === T && standing(R.vault).length > 1 ? `<div class="q-ruin warn">The dragon has broken your gate ${R.lost} nights running. Lose today and it gets in and burns your ${esc(standing(R.vault).slice(-1)[0].toLowerCase())}${PERKS[standing(R.vault).slice(-1)[0]] ? ', and you lose its perk until you rebuild it' : ''}.</div>`
      : R.lost && d === T ? `<div class="q-ruin warn">At midnight the dragon smashed your gate. Hold the keep today and the villagers will patch it up.</div>` : ''}
    ${head ? `<div class="q-head${head === 'The dragon won' || head === 'The day is lost' ? ' lost' : ''}">${head}</div>` : ''}
    <div class="q-score">
      <div class="q-sides"><div><small>In the keep</small><b class="you">${sec}</b></div><div class="m"><small>In the field</small><b class="fld">${fld}</b></div><div class="r"><small>The dragon's</small><b class="dr">${r.dragon}</b></div></div>
      <div class="q-rope${r.holds ? ' holds' : ''}" role="img" aria-label="${sec} gold secured in the keep, ${fld} still in the field, ${r.dragon} taken by the dragon. Secure ${r.need} to hold the keep."><i style="width:${(sec / all * 100).toFixed(1)}%"></i><s style="width:${(r.dragon / all * 100).toFixed(1)}%"></s><u style="left:${linePct.toFixed(1)}%"></u></div>
      <div class="q-cap"><span>${cap}</span><span>Secure ${r.need || 0} to hold</span></div>
      ${d === T ? `<button class="q-say" data-act="q-taunt" title="Poke the dragon"><i class="q-face" aria-hidden="true"></i><p>${said}</p></button>` : `<div class="q-say"><i class="q-face" aria-hidden="true"></i><p>${said}</p></div>`}
    </div>
    <div class="q-bar"><button class="q-pill" data-act="q-kingdom"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M3 14V3m0 0h8l-2 2.5L11 8H3"/></svg>Kingdom</button><button class="q-pill" data-act="q-routine"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4.5h10M3 8h10M3 11.5h6"/></svg>${opts.noHabits ? 'Set up your routine' : 'Your habits'}</button>${opts.remind ? `<button class="q-pill${opts.remind.act === 'off' ? ' on' : ''}" data-act="q-remind" data-v="${opts.remind.act || 'info'}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3z"/><path d="M6.5 14a1.6 1.6 0 0 0 3 0"/></svg>${opts.remind.act === 'off' ? 'Reminders on' : 'Reminders'}</button>` : ''}</div>
    ${opts.noHabits && d >= T ? `<div class="q-setup"><b>Set up your routine</b><p>Tell Claude about your ideal day and it drafts your daily habits. Every habit becomes a quest the dragon watches.</p><button class="q-btn" data-act="q-routine">Set up with Claude</button></div>` : ''}
    <div class="q-list">${rows || `<div class="q-empty">No quests on this day. Plan a task or a habit for it, and the dragon will start watching.</div>`}${opts.adder || ''}</div>
    <div class="q-foot">
      <div class="q-week">${wk}</div>
      <p>This week: <b class="you">the keep held ${wins}</b>, <b class="dr">the dragon won ${losses}</b>${B?.closed ? ` · <button class="q-link" data-act="q-report" data-w="${B.ws}">Read The Dragon's Due</button>` : ''}</p>
      <p class="q-help"><button class="q-link" data-act="q-help">How it works</button> · <button class="q-link" data-act="q-sound" aria-pressed="${sfx.on()}">Sound ${sfx.on() ? 'on' : 'off'}</button></p>
      <p class="q-vault">Vault <b>${R.vault.toLocaleString()} gold</b>${next ? ` · next, ${next[1] ? esc(a_n(next[1])) : 'your choice'} at ${next[0].toLocaleString()}` : ' · the castle is complete'}</p>
      ${opts.remind ? `<div class="q-tool"><p>${esc(opts.remind.txt)}</p>${opts.remind.act ? `<button class="q-btn${opts.remind.act === 'off' ? ' quiet' : ''}" data-act="q-remind" data-v="${opts.remind.act}">${esc(opts.remind.btn)}</button>` : ''}</div>` : ''}
      <p class="q-dragon">${!R.streak ? 'No streak yet, so the dragon is dozing' : H.boost > 1 ? `You've held the keep ${R.streak} day${R.streak > 1 ? 's' : ''} in a row, and a rich town draws a hungrier dragon: it's ${H.name}` : `You've held the keep ${R.streak} day${R.streak > 1 ? 's' : ''} in a row. The dragon is still dozing`}. It circles for ${H.grace} minutes after a quest's time ends, then dives${H.boost > 1 ? `, and your kept gold builds ×${H.boost}` : ''}. ${HUNTS.find(x => x.at > R.streak) ? `At ${HUNTS.find(x => x.at > R.streak).at} wins it starts ${HUNTS.find(x => x.at > R.streak).name}. ` : ''}It's a ${esc(D.name.toLowerCase())}, fat on the ${R.last7} gold it took this week.</p>
    </div>
  </div>`;
}
let anim = 0, tick = 0, sizing = null;
if (typeof addEventListener !== 'undefined') {
  addEventListener('keydown', e => { if (e.key === 'Escape' && size === 'full' && sizing && document.contains(sizing.el)) sizing.setSize('strip'); });
  addEventListener('resize', () => { if (size === 'full' && sizing && document.contains(sizing.el)) sizing.fit(); });
}
/** Touch the picture to look around, like a 3D app: drag with one finger to orbit (around and up or down), drag with two
    to pan, pinch to zoom (on a computer: drag to orbit, shift-drag or right-drag to pan, scroll to zoom). Double-tap puts it back. */
const ORBIT = 3.2; // how far a drag across the whole picture turns it, in radians
function controls(el, R) {
  const pts = new Map(), sz = el.parentNode.querySelector('.q-size');
  const fit = () => { const sc = el.parentNode; sc.classList.toggle('full', size === 'full'); el.style.aspectRatio = `${SW} / ${heightOf()}`; if (sz) sz.dataset.v = size; };
  fit();
  const setSize = v => { size = v; lsSet(SIZE, v === 'full' ? 'tall' : v); fit(); draw(R, tick); }; // the whole screen isn't kept for next time
  if (sz) sz.onclick = () => setSize(SIZES[(SIZES.indexOf(size) + 1) % SIZES.length]);
  sizing = { setSize, fit: () => { fit(); draw(R, tick); }, el };
  let last = 0, moved = 0, prev = null;
  const show = () => draw(R, tick);
  const reset = () => { resetView(); show(); };
  const pair = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) }; };
  el.onpointerdown = e => { el.setPointerCapture?.(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY, turn: e.shiftKey || e.button === 2 }); moved = 0; prev = pts.size === 2 ? pair() : null; };
  el.onpointermove = e => {
    const p = pts.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y, w = el.clientWidth; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    if (pts.size >= 2) { const q = pair(); if (prev) nudge(q.x - prev.x, q.y - prev.y, w, q.d / Math.max(1, prev.d)); prev = q; }
    else if (p.turn) nudge(dx, dy, w);
    else nudge(0, 0, w, 1, -dx / w * ORBIT, dy / w * ORBIT);
    show();
  };
  el.onpointerup = el.onpointercancel = e => {
    pts.delete(e.pointerId); prev = pts.size === 2 ? pair() : null;
    if (e.type === 'pointerup' && moved < 6) { if (performance.now() - last < 320) { reset(); last = 0; } else last = performance.now(); }
  };
  el.onwheel = e => { e.preventDefault(); nudge(0, 0, el.clientWidth, Math.exp(-e.deltaY / 400)); show(); };
  el.oncontextmenu = e => e.preventDefault();
}
/** Starts the picture moving (a slow flap and flicker), and stops when it's gone from the page. */
export function mounted(R) {
  clearInterval(anim);
  const el = document.getElementById('q-canvas'); if (!el) return;
  happenings(R);
  mount(draw(R, tick), el, el.dataset.label);
  controls(el, R);
  whenReady(() => { if (document.getElementById('q-canvas')) draw(R, tick); }); // the 3D library loads once, then the picture fills in
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  anim = setInterval(() => { if (!document.getElementById('q-canvas')) { clearInterval(anim); return; } tick += 1 / 3; draw(R, tick); }, 60); // a tick is still 180ms; drawn three times a tick so flight is smooth
}
