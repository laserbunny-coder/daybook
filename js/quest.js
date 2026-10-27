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
import { add, DAYN, esc, fmtT, lsGet, lsSet, pd, today, weekStart, daysBetween } from './util.js';
import { CAMPAIGN_DAYS, MARCH_AT, REGIONS, regionOf, titleFor } from './regions.js';

const KEY = 'daybook-quest';
const WIN = 0.7;
let client = null, onUpdate = () => {};
let Q = { start: null, swipes: {}, bonus: {}, ...lsGet(KEY, {}) };
Q.bonus = Q.bonus || {};
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
const sync = () => { if (client && me) client.auth.updateUser({ data: { quest_swipes: Q.swipes, quest_bonus: Q.bonus, quest_kingdom: Q.kg } }).then(({ data }) => { if (data?.user) me = data.user; }).catch(() => {}); };

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
// The buildings you can see, oldest first: a castle replaces the keep, and the campfire goes once the keep stands
const standing = vault => { const up = BUILDINGS.slice(0, villageAt(vault)).map(b => b[1]); return up.filter(b => !(b === 'Stone keep' && up.includes('Castle')) && !(b === 'Campfire' && up.includes('Stone keep'))); };

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
  const total = Qs.reduce((a, q) => a + q.g, 0), held = Qs.reduce((a, q) => a + q.you, 0);
  // event bonuses add to what you hold and help win the day, but the dragon can't take them
  let bonus = bonusOn(d) * (tw === 'storm' ? 2 : 1);
  const first = Qs.find(q => q.s != null && q.st !== 'swiped'); if (relic('wood', d) && first?.st === 'kept') bonus += 5; // the Dawn Lantern
  return { d, Qs, tw, total, bonus, you: held + bonus, dragon: total - held, bank: Qs.reduce((a, q) => a + q.bank, 0) + bonus, need: Math.ceil(total * WIN),
    ember: tw === 'ember' && Qs.filter(q => q.st !== 'swiped').length < 3 };
}

/** The whole realm as of now: every finished day since it began, today live, the vault, the dragon. */
export function realm() {
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
  if (r.dragon === 0) return PHASE(m) === 'morning' ? pick(['Morning. Every coin is still in your vault. I am patient.', `${r.total} gold on the table today. I only need you to look away once.`], seed) : pick(['Nothing for me yet. Annoying.', 'Still not a coin. I am getting hungry.'], seed);
  if (r.you < r.need) return `I'm ahead of the line. You need ${r.need - r.you} back to hold the keep${next ? `, and ${next.n.t} is your next chance` : ''}.`;
  return next ? `${r.you - r.need} above the line. ${next.n.t}${next.byMin != null ? ` is mine at ${fmtT(next.byMin)}` : ' is still out there'}.` : 'Not much left for me to take.';
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
    gold_on_table: r.total, you_hold: r.you, bonus_from_events_attended: r.bonus, dragon_has: r.dragon, need_to_win: r.need,
    quests: r.Qs.map(q => ({ title: q.n.t, gold: q.g, planned: q.s != null ? fmtT(q.s) : 'any time', swoops_at: q.byMin != null ? fmtT(q.byMin) : 'midnight', state: q.st })),
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
    if (!Qs.length) continue;
    const total = Qs.reduce((a, q) => a + q.g, 0), first = Qs.find(q => q.s != null);
    const morn = Math.min(first ? Math.max(first.s - 30, 6 * 60) : 9 * 60, 9 * 60);
    push(`${d}|morning`, at(d, morn), `${total} gold on the table today`, `${Qs.length} quest${Qs.length > 1 ? 's' : ''}${first ? `, starting with ${first.n.t} at ${fmtT(first.s)}` : ''}. The dragon is watching.`);
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

/* ---------- the picture: the village and the dragon, in pixels ---------- */
const DRAGON = [ // facing left; k body, d dark, e eye, w wing, f belly
  '...........ww...',
  '..........wwww..',
  '.........wwwwww.',
  '..kk....wwwwwww.',
  '.kekk...wwwwww..',
  'kkkkkk.kkkwww...',
  '...kkkkkkkkkk...',
  '....kfffkkkkkkk.',
  '....kkkkkkk..kkk',
  '....d.d..d.d...k',
];
const DRAGON_UP = [
  '................',
  '................',
  '..kk............',
  '.kekk...wwwwww..',
  'kkkkkk.wwwwwwwww',
  '...kkkkkkwwwwww.',
  '....kfffkkkkkkk.',
  '....kkkkkkk..kkk',
  '....d.d..d.d...k',
  '................',
];
const SKY = {
  night: ['#0d1026', '#141836', '#1b2046', '#232858'], dawn: ['#2b2a4a', '#5a3f5e', '#a2596a', '#e08f6e'],
  day: ['#4f86b8', '#6a9cc8', '#8ab3d6', '#b5cfe2'], dusk: ['#2a2346', '#5b3157', '#a44b4e', '#d9784a'],
};
const skyOf = m => m < 6 * 60 || m >= 21 * 60 ? 'night' : m < 8 * 60 ? 'dawn' : m < 18 * 60 ? 'day' : 'dusk';
function sprite(c, rows, x, y, s, pal) {
  rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') { c.fillStyle = pal[ch]; c.fillRect(x + i * s, y + j * s, s, s); } }));
}
const R_ = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
function roof(c, col, x, y, w) { for (let i = 0; i < Math.ceil(w / 2); i++) R_(c, col, x + i, y - i, w - i * 2, 1); }
// Each building draws itself standing on the ground line g, from its left edge x
const DRAW = {
  'Campfire': (c, x, g, t) => { R_(c, '#5b3a22', x, g - 2, 7, 2); R_(c, '#f2a33a', x + 2, g - 5 - (t % 2), 3, 3); R_(c, '#ffe08a', x + 3, g - 4, 1, 2); },
  'Tent': (c, x, g) => { for (let i = 0; i < 6; i++) R_(c, i < 3 ? '#c9b48a' : '#a8916a', x + i, g - 6 + Math.abs(3 - i), 1, 6 - Math.abs(3 - i)); R_(c, '#3a2a1a', x + 3, g - 3, 1, 3); },
  'Hut': (c, x, g) => { R_(c, '#8a6440', x, g - 6, 9, 6); roof(c, '#b8873a', x - 1, g - 7, 11); R_(c, '#3a2a1a', x + 4, g - 4, 2, 4); },
  'Well': (c, x, g) => { R_(c, '#7c7f86', x, g - 3, 6, 3); R_(c, '#5b3a22', x, g - 8, 1, 5); R_(c, '#5b3a22', x + 5, g - 8, 1, 5); R_(c, '#9c4a32', x - 1, g - 9, 8, 1); },
  'Farm': (c, x, g) => { for (let i = 0; i < 4; i++) R_(c, i % 2 ? '#6c8a3a' : '#d9b54a', x + i * 3, g - 2, 3, 2); R_(c, '#8a2f2a', x + 3, g - 9, 7, 7); roof(c, '#5a2220', x + 2, g - 10, 9); },
  'Watchtower': (c, x, g) => { R_(c, '#7c7f86', x + 1, g - 16, 5, 16); R_(c, '#7c7f86', x, g - 18, 7, 2); [0, 2, 4, 6].forEach(i => R_(c, '#7c7f86', x + i, g - 19, 1, 1)); R_(c, '#1a1a24', x + 3, g - 12, 1, 2); },
  'Mill': (c, x, g, t) => { R_(c, '#c9b48a', x + 1, g - 11, 6, 11); roof(c, '#8a6440', x, g - 12, 8); const k = t % 2; R_(c, '#e8e2d6', x + 3 - 4 * k, g - 13, 1 + 8 * k, 1 + 0 * k); R_(c, '#e8e2d6', x + 3, g - 17 + 4 * (1 - k), 1, 1 + 8 * (1 - k)); },
  'Smithy': (c, x, g, t) => { R_(c, '#6a5a4a', x, g - 7, 10, 7); roof(c, '#3a3440', x - 1, g - 8, 12); R_(c, '#3a3440', x + 7, g - 12, 2, 4); R_(c, t % 2 ? '#f2a33a' : '#c46a2a', x + 2, g - 4, 3, 2); },
  'Stone keep': (c, x, g) => { R_(c, '#8e9098', x, g - 16, 14, 16); [0, 3, 6, 9, 12].forEach(i => R_(c, '#8e9098', x + i, g - 18, 2, 2)); R_(c, '#2a2430', x + 5, g - 6, 4, 6); R_(c, '#2a2430', x + 3, g - 12, 1, 2); R_(c, '#2a2430', x + 10, g - 12, 1, 2); R_(c, '#5b3a22', x + 6, g - 25, 1, 7); R_(c, '#e3b663', x + 7, g - 25, 4, 3); },
  'Market': (c, x, g) => { [['#b8473a', 0], ['#3a6ab8', 6]].forEach(([col, o]) => { R_(c, '#8a6440', x + o, g - 4, 5, 4); R_(c, col, x + o - 1, g - 6, 7, 2); }); },
  'Castle walls': (c, x, g) => { R_(c, '#7c7f86', x, g - 7, 22, 7); for (let i = 0; i < 22; i += 3) R_(c, '#7c7f86', x + i, g - 9, 2, 2); R_(c, '#2a2430', x + 9, g - 5, 4, 5); },
  'Great hall': (c, x, g) => { R_(c, '#a0927e', x, g - 10, 16, 10); roof(c, '#5a2220', x - 1, g - 11, 18); for (let i = 2; i < 16; i += 4) R_(c, '#e3b663', x + i, g - 7, 2, 3); },
  'Castle': (c, x, g) => { R_(c, '#9a9ca6', x, g - 24, 8, 24); R_(c, '#9a9ca6', x + 18, g - 24, 8, 24); R_(c, '#8e9098', x + 6, g - 18, 14, 18); [0, 3, 6, 18, 21, 24].forEach(i => R_(c, '#9a9ca6', x + i, g - 26, 2, 2)); roof(c, '#3a6ab8', x - 1, g - 25, 10); roof(c, '#3a6ab8', x + 17, g - 25, 10); R_(c, '#2a2430', x + 11, g - 7, 4, 7); },
};
// Where each building stands, left to right; the keep and castle take the middle
const SLOTS = { 'Campfire': 70, 'Tent': 58, 'Hut': 44, 'Well': 82, 'Farm': 22, 'Watchtower': 6, 'Mill': 92, 'Smithy': 30, 'Stone keep': 62, 'Market': 80, 'Castle walls': 52, 'Great hall': 34, 'Castle': 58 };
const ORDER = ['Farm', 'Watchtower', 'Great hall', 'Smithy', 'Hut', 'Castle walls', 'Tent', 'Stone keep', 'Castle', 'Campfire', 'Market', 'Well', 'Mill'];
const W_ = 160, H_ = 64;
// A burned building: drawn on its own, charred, with smoke rising and an ember or two
let scratch = null;
function ruin(c, b, g, t) {
  scratch = scratch || Object.assign(document.createElement('canvas'), { width: W_, height: H_ });
  const o = scratch.getContext('2d'); o.globalCompositeOperation = 'source-over'; o.clearRect(0, 0, W_, H_);
  DRAW[b](o, SLOTS[b], g, 0);
  o.globalCompositeOperation = 'source-atop'; o.fillStyle = 'rgba(24,16,14,.78)'; o.fillRect(0, 0, W_, H_);
  const px = o.getImageData(0, 0, W_, H_).data; let x0 = W_, x1 = 0, y0 = H_;
  for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) if (px[(y * W_ + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); }
  c.drawImage(scratch, 0, 0);
  if (x1 < x0) return;
  const mx = Math.round((x0 + x1) / 2);
  for (let i = 0; i < 4; i++) { const k = (t + i) % 4; R_(c, `rgba(140,134,128,${0.55 - k * 0.12})`, mx - 1 + ((i + t) % 3) - 1, y0 - 2 - k * 3, 2, 2); }
  R_(c, t % 2 ? '#f2a33a' : '#c4503a', x0 + 1 + (t % 3), g - 2, 1, 1); R_(c, '#c4503a', x1 - 1 - (t % 2), g - 3, 1, 1);
}
export function draw(canvas, R, tick = 0) {
  const c = canvas.getContext('2d'); if (!c) return;
  const m = new Date().getHours() * 60 + new Date().getMinutes(), sky = SKY[skyOf(m)], g = 56;
  sky.forEach((col, i) => R_(c, col, 0, i * 12, W_, 12)); R_(c, sky[3], 0, 48, W_, 16);
  if (skyOf(m) === 'night') for (let i = 0; i < 22; i++) R_(c, '#e8e2d6', (i * 37) % W_, (i * 13) % 34, 1, 1);
  else { const sx = skyOf(m) === 'day' ? 24 + (m - 480) / 600 * 110 : skyOf(m) === 'dawn' ? 18 : 140; R_(c, '#ffe9a8', sx, 10, 5, 5); R_(c, '#ffe9a8', sx - 1, 11, 7, 3); }
  // far hills, and the dragon's crag on the right
  for (let x = 0; x < W_; x++) { const h = 8 + Math.round(4 * Math.sin(x / 9) + 3 * Math.sin(x / 4.3)); R_(c, '#3b4a52', x, g - h, 1, h); }
  for (let x = 112; x < W_; x++) { const h = Math.max(0, Math.round(28 - Math.abs(x - 140) * 1.1)); R_(c, '#2e3540', x, g - h, 1, h); }
  R_(c, '#3f5a2e', 0, g, W_, H_ - g); R_(c, '#567a3a', 0, g, W_, 1);
  const shown = standing(R.vault), ruins = R.ruins || [];
  ORDER.filter(b => shown.includes(b)).forEach(b => ruins.includes(b) ? ruin(c, b, g, tick) : DRAW[b](c, SLOTS[b], g, tick));
  // the vault's gold, piled by the keep
  const pile = Math.min(6, Math.floor(R.vault / 200));
  for (let i = 0; i <= pile; i++) R_(c, i % 2 ? '#e3b663' : '#c99a3a', 100 - i, g - 1 - Math.floor(i / 2), 2 + i * 2 > 10 ? 10 : 2 + i * 2, 1);
  // the dragon on its crag, bigger as it feeds; its hoard beneath
  const lvl = R.lvl, s = lvl >= 2 ? 3 : 2, pal = { k: lvl >= 3 ? '#a8302a' : '#c4503a', d: '#5a1a16', e: '#ffe08a', w: lvl >= 3 ? '#6a1e2a' : '#8a3a3a', f: '#e3b663' };
  const dx = 160 - 16 * s - 4, dy = g - 28 - 10 * s + (lvl >= 1 ? 0 : 6) + (tick % 2);
  sprite(c, tick % 2 ? DRAGON_UP : DRAGON, dx, dy, s, pal);
  const hp = Math.min(8, Math.ceil(R.last7 / 25));
  for (let i = 0; i < hp; i++) R_(c, '#e3b663', 136 + (i % 4) * 3, g - 3 - Math.floor(i / 4) * 2, 2, 1);
  if (lvl >= 1 && tick % 4 === 0) { R_(c, '#f2a33a', dx - 3 * s, dy + 5 * s, 3 * s, s); R_(c, '#ffe08a', dx - 5 * s, dy + 5 * s, 2 * s, s); }
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
const listOf = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const STATE_TXT = { kept: 'Kept', late: 'Late, half back', taken: 'Taken', open: '' };
const moveTxt = q => q.free ? 'Moved for free: the Hydra Scale paid' : `${q.to ? 'Moved to ' + (q.to === today() ? 'today' : DAYN[pd(q.to).getDay()] + ' ' + pd(q.to).getDate()) : 'Taken off the plan'}, swiped`;
export function html(d, R, opts = {}) {
  const r = dayView(d, R), T = today(), D = DRAGONS[R.lvl], H = R.hunt, C = d === today() ? R.camp : null;
  const pct = r.total ? Math.min(100, r.you / r.total * 100) : 100, linePct = WIN * 100;
  const n = villageAt(R.vault), next = BUILDINGS[n];
  const said = esc(line(r, R));
  const cap = r.rest ? 'No quests on this day' : r.ahead ? `${r.total} gold on the table` : r.dragon === 0 ? (d < T ? 'Not a coin lost' : 'All yours so far') : r.you >= r.need ? `${r.you - r.need} above the line` : `${r.need - r.you} below the line`;
  const head = d < T && !r.before && !r.rest ? (r.win ? 'The keep held' : 'The dragon won') : d > T ? 'Quests ahead' : r.before ? 'Before the realm began' : '';
  const quest = q => {
    const nt = esc(q.n.t || 'Untitled'), cls = q.st === 'open' && !r.ahead && q === r.Qs.find(x => x.st === 'open') ? 'open next' : q.st;
    if (q.st === 'swiped') return `<div class="qx swiped"><span class="qx-t"></span><span class="qx-ck" aria-hidden="true"></span><button class="qx-n" data-act="open" data-id="${q.n.id}"><b>${nt}</b><small>${moveTxt(q)}</small></button><span class="qx-g">−${q.g}</span></div>`;
    const sub = (q.tw && q.st === 'open' ? q.tw + '. ' : '') + (q.st === 'open' ? (q.byMin != null ? `Dragon swoops at ${fmtT(q.byMin)}${q.shield ? ', after your events' : ''}` : 'Any time today') : q.st === 'taken' ? 'Taken by the dragon. Check it off to win half back' : STATE_TXT[q.st]);
    const pts = q.st === 'taken' ? `−${q.g}` : q.st === 'late' ? `+${q.you}` : `${q.st === 'kept' ? '+' : ''}${q.g}`;
    return `<div class="qx ${cls}" data-id="${q.n.id}"><span class="qx-t">${q.s != null ? fmtT(q.s) : ''}</span><button class="qx-ck" data-act="toggle" data-id="${q.n.id}" aria-label="Mark ${nt} ${q.done ? 'not done' : 'done'}"></button><button class="qx-n" data-act="open" data-id="${q.n.id}"><b>${nt}</b>${r.ahead ? '' : `<small>${sub}</small>`}</button><span class="qx-g">${pts}</span></div>`;
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
  return `<div class="qv">
    <div class="q-scene"><canvas id="q-canvas" width="${W_}" height="${H_}" aria-label="Your village${n ? ': ' + BUILDINGS.slice(0, n).map(b => b[1]).join(', ') : ''}, and the dragon on its crag"></canvas>
      <div class="q-tags"><span>${esc(C?.begun ? C.reg.name : BUILDINGS[n - 1]?.[1] || 'Campfire')}${R.streak ? ` · ${R.streak} day streak` : ''}</span><span class="dr">${esc(C?.begun ? C.reg.dragon : D.name)}</span></div></div>
    ${campCard(C, R)}
    ${R.ruins.length ? `<div class="q-ruin">The dragon burned your ${esc(listOf(R.ruins.map(b => b.toLowerCase())))}. Win a day to rebuild ${R.ruins.length > 1 ? 'one' : 'it'}.</div>`
      : R.lost % BURN_AFTER === BURN_AFTER - 1 && d === T && standing(R.vault).length > 1 ? `<div class="q-ruin warn">${R.lost} lost days in a row. Lose today and the dragon burns your ${esc(standing(R.vault).slice(-1)[0].toLowerCase())}.</div>` : ''}
    ${head ? `<div class="q-head">${head}</div>` : ''}
    <div class="q-score">
      <div class="q-sides"><div><small>Your gold</small><b class="you">${r.you}</b></div><div class="r"><small>The dragon</small><b class="dr">${r.dragon}</b></div></div>
      <div class="q-rope" role="img" aria-label="You hold ${r.you} of ${r.total} gold; keep ${r.need} to win"><i style="width:${pct.toFixed(1)}%"></i><u style="left:${linePct}%"></u></div>
      <div class="q-cap"><span>${cap}</span><span>Keep ${r.need || 0} to win</span></div>
      <div class="q-say"><i class="q-face" aria-hidden="true"></i><p>${said}</p></div>
    </div>
    <div class="q-bar"><button class="q-pill" data-act="q-kingdom"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M3 14V3m0 0h8l-2 2.5L11 8H3"/></svg>Kingdom</button><button class="q-pill" data-act="q-routine"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4.5h10M3 8h10M3 11.5h6"/></svg>${opts.noHabits ? 'Set up your routine' : 'Your habits'}</button>${opts.remind ? `<button class="q-pill${opts.remind.act === 'off' ? ' on' : ''}" data-act="q-remind" data-v="${opts.remind.act || 'info'}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3z"/><path d="M6.5 14a1.6 1.6 0 0 0 3 0"/></svg>${opts.remind.act === 'off' ? 'Reminders on' : 'Reminders'}</button>` : ''}</div>
    ${opts.noHabits && d >= T ? `<div class="q-setup"><b>Set up your routine</b><p>Tell Claude about your ideal day and it drafts your daily habits. Every habit becomes a quest the dragon watches.</p><button class="q-btn" data-act="q-routine">Set up with Claude</button></div>` : ''}
    <div class="q-list">${rows || `<div class="q-empty">No quests on this day. Plan a task or a habit for it, and the dragon will start watching.</div>`}${opts.adder || ''}</div>
    <div class="q-foot">
      <div class="q-week">${wk}</div>
      <p>This week: <b class="you">you ${wins}</b>, <b class="dr">the dragon ${losses}</b></p>
      <p class="q-vault">Vault <b>${R.vault.toLocaleString()} gold</b>${next ? ` · next, a ${esc(next[1].toLowerCase())} at ${next[0].toLocaleString()}` : ' · the castle is complete'}</p>
      ${opts.remind ? `<div class="q-tool"><p>${esc(opts.remind.txt)}</p>${opts.remind.act ? `<button class="q-btn${opts.remind.act === 'off' ? ' quiet' : ''}" data-act="q-remind" data-v="${opts.remind.act}">${esc(opts.remind.btn)}</button>` : ''}</div>` : ''}
      <p class="q-dragon">${R.streak ? `You've won ${R.streak} day${R.streak > 1 ? 's' : ''} in a row, so the dragon is ${H.name}` : 'No win streak yet, so the dragon is dozing'}: it swoops ${H.grace} minutes after a quest's time ends${H.boost > 1 ? `, and your kept gold builds ×${H.boost}` : ''}. ${HUNTS.find(x => x.at > R.streak) ? `At ${HUNTS.find(x => x.at > R.streak).at} wins it starts ${HUNTS.find(x => x.at > R.streak).name}. ` : ''}It's a ${esc(D.name.toLowerCase())} because it took ${R.last7} gold this week.</p>
    </div>
  </div>`;
}
let anim = 0, tick = 0;
/** Starts the picture moving (a slow flap and flicker), and stops when it's gone from the page. */
export function mounted(R) {
  cancelAnimationFrame(anim); clearInterval(anim);
  const cv = document.getElementById('q-canvas'); if (!cv) return;
  draw(cv, R, tick);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  anim = setInterval(() => { const el = document.getElementById('q-canvas'); if (!el) { clearInterval(anim); return; } tick++; draw(el, R, tick); }, 700);
}
