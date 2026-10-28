// Quest: a day's plan played as a tug of war against Claude, who plays a dragon.
// Every quest on the day (its tasks, project blocks and repeats) holds some gold. All of it starts
// in your vault. When a quest's time passes unchecked, the dragon takes its gold; checking it off
// late wins back half. Keep 70% and you win the day. Kept gold builds your village over the weeks;
// the gold the dragon took lately is what it grows on, and a bigger dragon swoops sooner.
// Everything here is worked out from the plan itself (planned day and time, when it was checked off),
// so nothing new is stored but the day the realm began, and the swipes: moving a quest off its day
// doesn't dodge the dragon, it still takes a quarter of the gold (all of it, if it had already taken it).
import * as store from './store.js';
import { hasKids, isDone } from './tree.js';
import { eventsOn, timedOn } from './calendar.js';
import { add, DAYN, MON, esc, fmtT, lsGet, lsSet, pd, today, weekStart, daysBetween } from './util.js';
import { CAMPAIGN_DAYS, MARCH_AT, REGIONS, regionOf, titleFor } from './regions.js';
import { paint, phaseOf, SW, SH, SWOOP, whenReady } from './keep3d.js';
import * as sfx from './sfx.js';
import { screen, mount } from './crt.js';

const KEY = 'daybook-quest';
const WIN = 0.7;
let client = null, onUpdate = () => {};
let Q = { start: null, swipes: {}, bonus: {}, ...lsGet(KEY, {}) };
Q.bonus = Q.bonus || {};
Q.marks = Q.marks || {}; // the quest the dragon marked on each day
Q.seen = Q.seen || {}; // the quests seen on each day while it was today
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
  if (!Q.start || !('d' in before) || before.d == null || after.done || before.done) return;
  const T = today(), d = before.d; if (d > T || d < Q.start || after.d === d) return;
  const n = store.get(id) || skipped(id); if (!n || n.done || n.k === 'area' || n.r) return;
  if (Q.swipes[d]?.[id]) return;
  const s = 's' in before ? before.s : n.s, m = ('m' in before ? before.m : n.m) ?? 60, g = gold(m);
  const end = deadline(d, s, m, realm().grace) ?? 24 * 60;
  const taken = d < T || new Date() > at(d, end);
  let cost = taken || twistOn(d) === 'marsh' ? g : Math.max(2, Math.round(g / 4)), free = null;
  // the Hydra Scale pays for one move a week
  const wk = weekStart(d);
  if (!taken && relic('marsh', d) && !Object.values(Q.swipes).some(x => Object.values(x).some(w => w.free === wk))) { cost = 0; free = wk; }
  (Q.swipes[d] = Q.swipes[d] || {})[id] = { t: n.t || 'Untitled', g: cost, ...(free ? { free } : {}) };
  for (const k of Object.keys(Q.swipes)) if (daysBetween(k, T) > 21) delete Q.swipes[k];
  saveQ(); sync();
}
const sync = () => { if (client && me) client.auth.updateUser({ data: { quest_swipes: Q.swipes, quest_seen: Q.seen, quest_bonus: Q.bonus, quest_marks: Q.marks, quest_kingdom: Q.kg } }).then(({ data }) => { if (data?.user) me = data.user; }).catch(() => {}); };

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
export const BUILDINGS = [
  [0, 'Campfire'], [100, 'Tent'], [250, 'Hut'], [450, 'Well'], [700, 'Farm'], [1000, 'Watchtower'], [1400, 'Mill'],
  [1900, 'Smithy'], [2500, 'Stone keep'], [3200, 'Market'], [4000, 'Castle walls'], [5000, 'Great hall'], [6500, 'Castle'],
];
const dragonAt = hoard => { let i = 0; DRAGONS.forEach((x, j) => { if (hoard >= x.at) i = j; }); return i; };
export const villageAt = vault => BUILDINGS.filter(b => vault >= b[0]).length; // how many buildings stand
// The buildings you can see, oldest first: the castle replaces the keep and its walls, the keep the campfire, the walls the tent
const standing = vault => { const up = BUILDINGS.slice(0, villageAt(vault)).map(b => b[1]); return up.filter(b => !(b === 'Stone keep' && up.includes('Castle')) && !(b === 'Campfire' && up.includes('Stone keep')) && !(b === 'Tent' && up.includes('Castle walls')) && !(b === 'Castle walls' && up.includes('Castle'))); };

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
  q.you = q.st === 'kept' || q.st === 'open' ? q.g : q.st === 'late' ? Math.ceil(q.g / 2) : 0;
  q.dragon = q.g - q.you;
  q.bank = q.st === 'kept' ? q.g : q.st === 'late' ? q.you : 0; // gold already safe in the vault
  return q;
}
function score(d, now, grace) {
  const tw = twistOn(d), Qs = judged(d, now, grace).concat(swipesOn(d));
  markDay(d, Qs); see(d, Qs);
  const mk = Qs.find(q => q.n.id === Q.marks[d] && q.st !== 'swiped'); if (mk) mk.mark = true;
  const total = Qs.reduce((a, q) => a + q.g, 0), held = Qs.reduce((a, q) => a + q.you, 0);
  // event bonuses add to what you hold and help win the day, but the dragon can't take them
  let bonus = bonusOn(d) * (tw === 'storm' ? 2 : 1);
  const first = Qs.find(q => q.s != null && q.st !== 'swiped'); if (relic('wood', d) && first?.st === 'kept') bonus += 5; // the Dawn Lantern
  if (mk?.st === 'kept') bonus += mk.g; // the dragon's mark, kept: double
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
    const recent = days.slice(-7).reduce((a, x) => a + x.dragon, 0), lvl = dragonAt(recent), H = huntAt(streak);
    const r = score(d, d === T ? now : at(add(d, 1), 0), H.grace);
    r.lvl = lvl; r.hunt = H; r.streak = streak; r.rest = r.total === 0 && !r.ember; r.win = !r.rest && !r.ember && r.you >= r.need;
    days.push(r);
    // relics: the Ember Heart strengthens the streak boost, the Crown adds a tenth
    const boost = (1 + (H.boost - 1) * (relic('ember', d) ? 1.25 : 1)) * (relic('spires', d) ? 1.1 : 1);
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
  const R = { start, days, vault, hoard, lvl: days.length ? days[days.length - 1].lvl : 0, last7, streak, lost, burned, hunt: H, grace: H.grace,
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
  const T = today(), m = new Date().getHours() * 60 + new Date().getMinutes(), seed = r.d + r.dragon + r.you;
  const lastTaken = r.Qs.filter(q => q.st === 'taken').sort((a, b) => b.by - a.by)[0];
  const next = r.Qs.find(q => q.st === 'open');
  if (r.rest) return pick(['No quests today? Then I sleep on my gold. Wake me when there is something to steal.', 'An empty day. I will nap. Plan something and I will be watching.'], seed);
  if (r.d < T) return r.win ? pick([`You held ${r.you} to my ${r.dragon}. I will be hungrier tomorrow.`, `${r.you} kept. Fine. The keep stands, for now.`], seed) : pick([`${r.dragon} gold to me. That was a good day for dragons.`, `I ate well: ${r.dragon} gold. Your walls looked thin.`], seed);
  if (!next && r.Qs.length) return r.dragon === 0 ? 'Not one coin. I circled all day and you left me nothing.' : r.win ? `You win this one, ${r.you} to ${r.dragon}. Sleep with one eye open.` : `${r.dragon} to me. The day is mine. Rematch at dawn.`;
  if (lastTaken && r.dragon > 0 && Date.now() - lastTaken.by < 3 * 3600e3) return pick([`${lastTaken.n.t} went unguarded, so ${lastTaken.dragon} gold is mine. Check it off and I will give back half.`, `I took ${lastTaken.dragon} gold while ${lastTaken.n.t} sat there. Delicious.`], seed);
  if (r.mark?.st === 'open' && PHASE(m) === 'morning') return pick([`I have marked ${r.mark.n.t}. Keep it and it pays double. I'm betting you won't.`, `My mark is on ${r.mark.n.t} today. ${r.mark.g * 2} gold if you keep it. I like my odds.`], seed);
  if (r.dragon === 0) return PHASE(m) === 'morning' ? pick(['Morning. Every coin is still in your vault. I am patient.', `${r.total} gold on the table today. I only need you to look away once.`], seed) : pick(['Nothing for me yet. Annoying.', 'Still not a coin. I am getting hungry.'], seed);
  if (r.holds) return pick([`Your keep holds today. Fine. I'll still take whatever you leave in the field${next ? `, starting with ${next.n.t}` : ''}.`, 'Your walls held. The rest of the field is still fair game.'], seed);
  if (r.falls) return pick(['Too little left out there for you now. Today is mine. Rematch at dawn.', 'The day is mine. Sleep well, keeper. I know I will.'], seed);
  return next ? `${r.need - r.secured} more to secure before your keep holds. ${next.n.t}${next.byMin != null ? ` is mine at ${fmtT(next.byMin)}` : ' is still out there'}.` : 'Not much left for me to take.';
}
const LINES = 'daybook-quest-lines';
let asking = null, lastAsk = 0;
/** What the dragon says right now: a line from Claude when there is one for this moment, otherwise one of its stock lines.
    Claude is asked again when the score moves, or once an hour and a half has passed. */
export function line(r, R) {
  const T = today(), base = fallback(r, R);
  if (r.d !== T) return base;
  const m = new Date().getHours() * 60 + new Date().getMinutes();
  const key = `${r.d}|${r.you}|${r.dragon}|${r.Qs.filter(q => q.st === 'open').length}|${PHASE(m)}`;
  const said = lsGet(LINES, {});
  if (said.d === T && said.L?.[key]) return said.L[key];
  if (client && !asking && Date.now() - lastAsk > 90e3) {
    lastAsk = Date.now();
    asking = askDragon(r, R, PHASE(m)).then(t => { if (t) { const s = lsGet(LINES, {}); if (s.d !== T) { s.d = T; s.L = {}; } s.L[key] = t; lsSet(LINES, s); onUpdate(); } }).finally(() => { asking = null; });
  }
  return base; // until Claude's line for this moment arrives
}
async function askDragon(r, R, phase) {
  const facts = {
    time: fmtT(new Date().getHours() * 60 + new Date().getMinutes()), phase,
    gold_on_table: r.total, secured_in_keep: r.secured, still_in_field: r.field, keep_already_holds_today: r.holds, day_already_lost: r.falls, you_hold_if_rest_kept: r.you, bonus_from_events_attended: r.bonus, dragon_has: r.dragon, need_to_win: r.need,
    dragons_mark: r.mark ? { quest: r.mark.n.t, state: r.mark.st, pays_if_kept: r.mark.g * 2 } : null,
    quests: r.Qs.map(q => ({ title: q.n.t, gold: q.g, ...(q.mark ? { marked: true } : {}), planned: q.s != null ? fmtT(q.s) : 'any time', swoops_at: q.byMin != null ? fmtT(q.byMin) : 'midnight', state: q.st })),
    dragon_form: DRAGONS[R.lvl].name, dragon_took_last_7_days: R.last7, your_win_streak: R.streak, dragon_hunting: R.hunt.name,
    days_lost_in_a_row: R.lost, buildings_burned_by_dragon: R.ruins, your_title: R.title, regions_held: R.held.map(id => regionOf(id).name),
    campaign: R.camp?.begun ? { region: R.camp.reg.name, you_play: `the ${R.camp.reg.dragon} in this region`, twist_today: regionOf(R.camp.twist)?.short, day: R.camp.day, of: CAMPAIGN_DAYS, days_won: R.camp.wins } : null,
    vault: R.vault, village: BUILDINGS.slice(0, villageAt(R.vault)).map(b => b[1]),
    this_week: week(R).map(w => w.res).filter(Boolean).join(' '), days_since_realm_began: daysBetween(R.start, today()),
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
  const built = BUILDINGS.slice(villageAt(before), villageAt(after)).map(b => b[1]);
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
/** What the picture shows right now. */
export function sceneOf(R) {
  const C = R.camp?.begun ? R.camp : null, m = new Date().getHours() * 60 + new Date().getMinutes();
  const held = REGIONS.filter(x => R.held.includes(x.id)), r = R.byDay.get(today());
  const live = { mode: modeOf(r, m), piles: pilesOf(r, m).filter(p => p.st === 'open'), gate: R.lost > 0, fx: fx.map(e => ({ ...e, age: tick - e.t0 })) };
  return C ? { ...live, land: C.id === 'spires' ? 'spires' : C.id, phase: phaseOf(m), buildings: CAMP.filter(b => C.gold >= b[0]).map(b => b[1]), ruins: [], held, lvl: R.lvl, hoard: R.last7, gold: 0, camp: true, campInk: C.reg.ink }
    : { ...live, land: 'vale', phase: phaseOf(m), buildings: standing(R.vault), ruins: R.ruins, held, lvl: R.lvl, hoard: R.last7, gold: R.vault };
}
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
  const now = { d: r.d, st: new Map(r.Qs.map(q => [q.n.id, q.st])), built: villageAt(R.vault), holds: r.holds };
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
  const scr = screen('quest', SW, SH); paint(src, sceneOf(R), tick); scr.show(src);
  const el = document.getElementById('q-canvas'); if (el?.querySelector('canvas') && scr.cv.parentNode !== el) mount(scr, el, el.dataset.label); // a new screen, after the phone dropped the old one
  return scr;
}

/* ---------- the view ---------- */
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
  ['Do a quest, and its gold goes into your keep', 'Gold in the keep is safe. Over the weeks it builds your village, then a castle, then a kingdom.'],
  ['Leave it out, and the dragon takes it', "Once a quest's time passes, the dragon circles for a while, then dives on that pile. Finish it late to chase down half."],
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
const moveTxt = q => q.free ? 'Moved for free: the Hydra Scale paid' : `${q.to ? 'Moved to ' + (q.to === today() ? 'today' : DAYN[pd(q.to).getDay()] + ' ' + pd(q.to).getDate()) : 'Taken off the plan'}, swiped`;
export function html(d, R, opts = {}) {
  const r = dayView(d, R), T = today(), D = DRAGONS[R.lvl], H = R.hunt, C = d === today() ? R.camp : null, B = d === today() ? report(R) : null;
  const sec = r.ahead ? 0 : r.secured, fld = r.ahead ? r.total : r.field, all = Math.max(1, r.total + r.bonus), linePct = WIN * r.total / all * 100;
  const n = villageAt(R.vault), next = BUILDINGS[n];
  const said = esc(line(r, R));
  const cap = r.rest ? 'No quests on this day' : r.ahead ? `${r.total} gold will be out in the field` : r.holds ? (d < T ? `Held with ${sec - r.need} to spare` : `The keep holds${fld ? '. The rest still builds your village' : ''}`) : r.falls ? (d < T ? `${r.need - sec} short` : `Too little left out there to hold today`) : `${r.need - sec} more to hold the keep`;
  const head = d < T && !r.before && !r.rest ? (r.win ? 'The keep held' : 'The dragon won') : d > T ? 'Quests ahead' : r.before ? 'Before the realm began' : d === T && r.holds ? 'The keep holds' : d === T && r.falls ? 'The day is lost' : '';
  const quest = q => {
    const nt = esc(q.n.t || 'Untitled'), cls = q.st === 'open' && !r.ahead && q === r.Qs.find(x => x.st === 'open') ? 'open next' : q.st;
    if (q.st === 'swiped') return `<div class="qx swiped"><span class="qx-t"></span><span class="qx-ck" aria-hidden="true"></span><button class="qx-n" data-act="open" data-id="${q.n.id}"><b>${nt}</b><small>${moveTxt(q)}</small></button><span class="qx-g">−${q.g}</span></div>`;
    const sub = (q.mark && q.st === 'open' ? 'Marked: double if kept. ' : '') + (q.mark && q.st === 'kept' ? 'You beat its mark: double gold' : '') + (q.tw && q.st === 'open' ? q.tw + '. ' : '') + (q.mark && q.st === 'kept' ? '' : q.st === 'open' ? (q.byMin != null ? `The dragon dives at ${fmtT(q.byMin)}${q.shield ? ', it waits out your events' : ''}` : 'Any time today') : q.st === 'taken' ? 'The dragon took it. Finish it to chase down half' : STATE_TXT[q.st]);
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
    <div class="q-scene"><div id="q-canvas" class="q-tv" data-label="${esc(C?.begun ? `Your camp in ${C.reg.name}` : `Your village${n ? ': ' + BUILDINGS.slice(0, n).map(b => b[1]).join(', ') : ''}`)}, and the dragon on its crag"></div>
      <div class="q-tags"><span>${esc(C?.begun ? C.reg.name : BUILDINGS[n - 1]?.[1] || 'Campfire')}${R.streak ? ` · ${R.streak} day streak` : ''}</span><span class="dr">${esc(C?.begun ? C.reg.dragon : D.name)}</span></div></div>
    ${B && !B.closed ? reportCard(B) : ''}
    ${campCard(C, R)}
    ${R.ruins.length ? `<div class="q-ruin">The dragon burned your ${esc(listOf(R.ruins.map(b => b.toLowerCase())))}. Win a day to rebuild ${R.ruins.length > 1 ? 'one' : 'it'}.</div>`
      : R.lost % BURN_AFTER === BURN_AFTER - 1 && d === T && standing(R.vault).length > 1 ? `<div class="q-ruin warn">The dragon has broken your gate ${R.lost} nights running. Lose today and it gets in and burns your ${esc(standing(R.vault).slice(-1)[0].toLowerCase())}.</div>`
      : R.lost && d === T ? `<div class="q-ruin warn">At midnight the dragon smashed your gate. Hold the keep today and the villagers will patch it up.</div>` : ''}
    ${head ? `<div class="q-head${head === 'The dragon won' || head === 'The day is lost' ? ' lost' : ''}">${head}</div>` : ''}
    <div class="q-score">
      <div class="q-sides"><div><small>In the keep</small><b class="you">${sec}</b></div><div class="m"><small>In the field</small><b class="fld">${fld}</b></div><div class="r"><small>The dragon's</small><b class="dr">${r.dragon}</b></div></div>
      <div class="q-rope${r.holds ? ' holds' : ''}" role="img" aria-label="${sec} gold secured in the keep, ${fld} still in the field, ${r.dragon} taken by the dragon. Secure ${r.need} to hold the keep."><i style="width:${(sec / all * 100).toFixed(1)}%"></i><s style="width:${(r.dragon / all * 100).toFixed(1)}%"></s><u style="left:${linePct.toFixed(1)}%"></u></div>
      <div class="q-cap"><span>${cap}</span><span>Secure ${r.need || 0} to hold</span></div>
      <div class="q-say"><i class="q-face" aria-hidden="true"></i><p>${said}</p></div>
    </div>
    <div class="q-bar"><button class="q-pill" data-act="q-kingdom"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M3 14V3m0 0h8l-2 2.5L11 8H3"/></svg>Kingdom</button><button class="q-pill" data-act="q-routine"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4.5h10M3 8h10M3 11.5h6"/></svg>${opts.noHabits ? 'Set up your routine' : 'Your habits'}</button>${opts.remind ? `<button class="q-pill${opts.remind.act === 'off' ? ' on' : ''}" data-act="q-remind" data-v="${opts.remind.act || 'info'}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3z"/><path d="M6.5 14a1.6 1.6 0 0 0 3 0"/></svg>${opts.remind.act === 'off' ? 'Reminders on' : 'Reminders'}</button>` : ''}</div>
    ${opts.noHabits && d >= T ? `<div class="q-setup"><b>Set up your routine</b><p>Tell Claude about your ideal day and it drafts your daily habits. Every habit becomes a quest the dragon watches.</p><button class="q-btn" data-act="q-routine">Set up with Claude</button></div>` : ''}
    <div class="q-list">${rows || `<div class="q-empty">No quests on this day. Plan a task or a habit for it, and the dragon will start watching.</div>`}${opts.adder || ''}</div>
    <div class="q-foot">
      <div class="q-week">${wk}</div>
      <p>This week: <b class="you">the keep held ${wins}</b>, <b class="dr">the dragon won ${losses}</b>${B?.closed ? ` · <button class="q-link" data-act="q-report" data-w="${B.ws}">Read The Dragon's Due</button>` : ''}</p>
      <p class="q-help"><button class="q-link" data-act="q-help">How it works</button> · <button class="q-link" data-act="q-sound" aria-pressed="${sfx.on()}">Sound ${sfx.on() ? 'on' : 'off'}</button></p>
      <p class="q-vault">Vault <b>${R.vault.toLocaleString()} gold</b>${next ? ` · next, a ${esc(next[1].toLowerCase())} at ${next[0].toLocaleString()}` : ' · the castle is complete'}</p>
      ${opts.remind ? `<div class="q-tool"><p>${esc(opts.remind.txt)}</p>${opts.remind.act ? `<button class="q-btn${opts.remind.act === 'off' ? ' quiet' : ''}" data-act="q-remind" data-v="${opts.remind.act}">${esc(opts.remind.btn)}</button>` : ''}</div>` : ''}
      <p class="q-dragon">${!R.streak ? 'No streak yet, so the dragon is dozing' : H.boost > 1 ? `You've held the keep ${R.streak} day${R.streak > 1 ? 's' : ''} in a row, and a rich town draws a hungrier dragon: it's ${H.name}` : `You've held the keep ${R.streak} day${R.streak > 1 ? 's' : ''} in a row. The dragon is still dozing`}. It circles for ${H.grace} minutes after a quest's time ends, then dives${H.boost > 1 ? `, and your kept gold builds ×${H.boost}` : ''}. ${HUNTS.find(x => x.at > R.streak) ? `At ${HUNTS.find(x => x.at > R.streak).at} wins it starts ${HUNTS.find(x => x.at > R.streak).name}. ` : ''}It's a ${esc(D.name.toLowerCase())}, fat on the ${R.last7} gold it took this week.</p>
    </div>
  </div>`;
}
let anim = 0, tick = 0;
/** Starts the picture moving (a slow flap and flicker), and stops when it's gone from the page. */
export function mounted(R) {
  clearInterval(anim);
  const el = document.getElementById('q-canvas'); if (!el) return;
  happenings(R);
  mount(draw(R, tick), el, el.dataset.label);
  whenReady(() => { if (document.getElementById('q-canvas')) draw(R, tick); }); // the 3D library loads once, then the picture fills in
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  anim = setInterval(() => { if (!document.getElementById('q-canvas')) { clearInterval(anim); return; } tick += 1 / 3; draw(R, tick); }, 60); // a tick is still 180ms; drawn three times a tick so flight is smooth
}
