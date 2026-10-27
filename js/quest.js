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
import { add, DAYN, esc, fmtT, lsGet, lsSet, pd, today, weekStart, daysBetween } from './util.js';

const KEY = 'daybook-quest';
const WIN = 0.7;
let client = null, onUpdate = () => {};
let Q = { start: null, swipes: {}, ...lsGet(KEY, {}) };
let me = null;
const saveQ = () => lsSet(KEY, Q);

export function init(o) { client = o.client ?? client; onUpdate = o.update ?? onUpdate; }
/** The day the realm began: set the first time Quest is opened, and kept on the account so every device agrees. */
export function begin(u) {
  me = u || null;
  const sw = u?.user_metadata?.quest_swipes; // swipes made on another device
  if (sw) for (const [d, m] of Object.entries(sw)) Q.swipes[d] = { ...m, ...Q.swipes[d] };
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
  const lvl = realm().lvl, end = s != null ? Math.min(s + m + DRAGONS[lvl].grace, 24 * 60) : 24 * 60;
  const taken = d < T || new Date() > at(d, end);
  (Q.swipes[d] = Q.swipes[d] || {})[id] = { t: n.t || 'Untitled', g: taken ? g : Math.max(2, Math.round(g / 4)) };
  for (const k of Object.keys(Q.swipes)) if (daysBetween(k, T) > 21) delete Q.swipes[k];
  saveQ();
  if (client && me) client.auth.updateUser({ data: { quest_swipes: Q.swipes } }).then(({ data }) => { if (data?.user) me = data.user; }).catch(() => {});
}
// The swipes that still stand on day d: the quest is still off that day
const skipped = id => { const n = store.peek(id); return n?.x && n.rs ? n : null; }; // a repeat skipped for the day
const swipesOn = d => Object.entries(Q.swipes[d] || {}).filter(([id]) => { const n = store.get(id) || skipped(id); return !n || n.done && plannedDay(n) === d ? false : plannedDay(n) !== d; })
  .map(([id, w]) => { const n = store.get(id) || skipped(id); return { n: n || { id, t: w.t }, s: null, m: 0, g: w.g, st: 'swiped', you: 0, dragon: w.g, bank: 0, to: n?.d ?? null }; });

/* ---------- the rules ---------- */
export function gold(m) { m = m || 60; return m <= 15 ? 5 : m <= 30 ? 10 : m <= 60 ? 15 : m <= 90 ? 20 : m <= 150 ? 25 : 30; }
// The dragon grows on what it took over the last seven days, and a bigger one swoops sooner after a quest's time
export const DRAGONS = [
  { at: 0, name: 'Hatchling', grace: 60 },
  { at: 40, name: 'Drake', grace: 45 },
  { at: 100, name: 'Wyvern', grace: 30 },
  { at: 180, name: 'Great Wyrm', grace: 15 },
];
export const BUILDINGS = [
  [0, 'Campfire'], [100, 'Tent'], [250, 'Hut'], [450, 'Well'], [700, 'Farm'], [1000, 'Watchtower'], [1400, 'Mill'],
  [1900, 'Smithy'], [2500, 'Stone keep'], [3200, 'Market'], [4000, 'Castle walls'], [5000, 'Great hall'], [6500, 'Castle'],
];
const dragonAt = hoard => { let i = 0; DRAGONS.forEach((x, j) => { if (hoard >= x.at) i = j; }); return i; };
export const villageAt = vault => BUILDINGS.filter(b => vault >= b[0]).length; // how many buildings stand

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
function judge(q, d, now, grace) {
  const by = q.s != null ? at(d, Math.min(q.s + q.m + grace, 24 * 60)) : at(d, 24 * 60);
  q.by = by; q.byMin = q.s != null ? Math.min(q.s + q.m + grace, 24 * 60) : null;
  if (q.done) { const t = doneAt(q.n); q.st = !t || t <= by ? 'kept' : 'late'; }
  else q.st = now > by ? 'taken' : 'open';
  q.you = q.st === 'kept' || q.st === 'open' ? q.g : q.st === 'late' ? Math.ceil(q.g / 2) : 0;
  q.dragon = q.g - q.you;
  q.bank = q.st === 'kept' ? q.g : q.st === 'late' ? q.you : 0; // gold already safe in the vault
  return q;
}
function score(d, now, grace) {
  const Qs = questsOn(d).map(q => judge(q, d, now, grace)).concat(swipesOn(d));
  const total = Qs.reduce((a, q) => a + q.g, 0), you = Qs.reduce((a, q) => a + q.you, 0);
  return { d, Qs, total, you, dragon: total - you, bank: Qs.reduce((a, q) => a + q.bank, 0), need: Math.ceil(total * WIN) };
}

/** The whole realm as of now: every finished day since it began, today live, the vault, the dragon. */
export function realm() {
  const T = today(), now = new Date(), start = Q.start || T, days = [];
  let vault = 0, hoard = 0;
  for (let d = start; d <= T; d = add(d, 1)) {
    const recent = days.slice(-7).reduce((a, x) => a + x.dragon, 0), lvl = dragonAt(recent);
    const r = score(d, d === T ? now : at(add(d, 1), 0), DRAGONS[lvl].grace);
    r.lvl = lvl; r.rest = r.total === 0; r.win = !r.rest && r.you >= r.need;
    days.push(r);
    if (d < T) { vault += r.you; hoard += r.dragon; } else { vault += r.bank; hoard += r.dragon; }
  }
  const last7 = days.slice(-7).reduce((a, x) => a + x.dragon, 0);
  return { start, days, vault, hoard, lvl: days.length ? days[days.length - 1].lvl : 0, last7, byDay: new Map(days.map(x => [x.d, x])) };
}
/** One day, as the plan shows it. A day before the realm began or still ahead is judged at its start (nothing taken yet). */
export function dayView(d, R) {
  const r = R.byDay.get(d); if (r) return r;
  const x = score(d, d > today() ? at(d, 0) : at(add(d, 1), 0), DRAGONS[R.lvl].grace); x.ahead = d > today(); x.before = d < R.start; return x;
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
    gold_on_table: r.total, you_hold: r.you, dragon_has: r.dragon, need_to_win: r.need,
    quests: r.Qs.map(q => ({ title: q.n.t, gold: q.g, planned: q.s != null ? fmtT(q.s) : 'any time', swoops_at: q.byMin != null ? fmtT(q.byMin) : 'midnight', state: q.st })),
    dragon_form: DRAGONS[R.lvl].name, dragon_took_last_7_days: R.last7,
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
  const R = realm(), grace = DRAGONS[R.lvl].grace, now = new Date(), out = [];
  const push = (key, t, title, body) => { if (t > now) out.push({ key, at: t.toISOString(), title, body, tag: key }); };
  for (let i = 0; i < days; i++) {
    const d = add(today(), i), Qs = questsOn(d).map(q => judge(q, d, now, grace)).filter(q => !q.done);
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
  const n = villageAt(R.vault), up = BUILDINGS.slice(0, n).map(b => b[1]);
  // a castle replaces the keep; walls stand behind the rest
  const shown = up.filter(b => !(b === 'Stone keep' && up.includes('Castle')) && !(b === 'Campfire' && up.includes('Stone keep')));
  ORDER.filter(b => shown.includes(b)).forEach(b => DRAW[b](c, SLOTS[b], g, tick));
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
const STATE_TXT = { kept: 'Kept', late: 'Late, half back', taken: 'Taken', open: '' };
const moveTxt = q => `${q.to ? 'Moved to ' + (q.to === today() ? 'today' : DAYN[pd(q.to).getDay()] + ' ' + pd(q.to).getDate()) : 'Taken off the plan'}, swiped`;
export function html(d, R, opts = {}) {
  const r = dayView(d, R), T = today(), D = DRAGONS[R.lvl];
  const pct = r.total ? r.you / r.total * 100 : 100, linePct = WIN * 100;
  const n = villageAt(R.vault), next = BUILDINGS[n];
  const said = esc(line(r, R));
  const cap = r.rest ? 'No quests on this day' : r.ahead ? `${r.total} gold on the table` : r.dragon === 0 ? (d < T ? 'Not a coin lost' : 'All yours so far') : r.you >= r.need ? `${r.you - r.need} above the line` : `${r.need - r.you} below the line`;
  const head = d < T && !r.before && !r.rest ? (r.win ? 'The keep held' : 'The dragon won') : d > T ? 'Quests ahead' : r.before ? 'Before the realm began' : '';
  const rows = r.Qs.map(q => {
    const nt = esc(q.n.t || 'Untitled'), cls = q.st === 'open' && !r.ahead && q === r.Qs.find(x => x.st === 'open') ? 'open next' : q.st;
    if (q.st === 'swiped') return `<div class="qx swiped"><span class="qx-t"></span><span class="qx-ck" aria-hidden="true"></span><button class="qx-n" data-act="open" data-id="${q.n.id}"><b>${nt}</b><small>${moveTxt(q)}</small></button><span class="qx-g">−${q.g}</span></div>`;
    const sub = q.st === 'open' ? (q.byMin != null ? `Dragon swoops at ${fmtT(q.byMin)}` : 'Any time today') : q.st === 'taken' ? 'Taken by the dragon. Check it off to win half back' : STATE_TXT[q.st];
    const pts = q.st === 'taken' ? `−${q.g}` : q.st === 'late' ? `+${q.you}` : `${q.st === 'kept' ? '+' : ''}${q.g}`;
    return `<div class="qx ${cls}" data-id="${q.n.id}"><span class="qx-t">${q.s != null ? fmtT(q.s) : ''}</span><button class="qx-ck" data-act="toggle" data-id="${q.n.id}" aria-label="Mark ${nt} ${q.done ? 'not done' : 'done'}"></button><button class="qx-n" data-act="open" data-id="${q.n.id}"><b>${nt}</b>${r.ahead ? '' : `<small>${sub}</small>`}</button><span class="qx-g">${pts}</span></div>`;
  }).join('');
  const wk = week(R, d).map(w => `<div class="qw-d${w.d === d ? ' on' : ''}"><i class="${w.res === 'W' ? 'w' : w.res === 'L' ? 'l' : w.res === 'rest' ? 'r' : w.res === 'live' ? 't' : ''}">${w.res === 'W' || w.res === 'L' ? w.res : w.res === 'rest' ? '–' : w.res === 'live' ? '•' : ''}</i>${DAYN[pd(w.d).getDay()]}</div>`).join('');
  const wins = week(R, d).filter(w => w.res === 'W').length, losses = week(R, d).filter(w => w.res === 'L').length;
  return `<div class="qv">
    <div class="q-scene"><canvas id="q-canvas" width="${W_}" height="${H_}" aria-label="Your village${n ? ': ' + BUILDINGS.slice(0, n).map(b => b[1]).join(', ') : ''}, and the dragon on its crag"></canvas>
      <div class="q-tags"><span>${esc(BUILDINGS[n - 1]?.[1] || 'Campfire')}</span><span class="dr">${esc(D.name)}</span></div></div>
    ${head ? `<div class="q-head">${head}</div>` : ''}
    <div class="q-score">
      <div class="q-sides"><div><small>Your gold</small><b class="you">${r.you}</b></div><div class="r"><small>The dragon</small><b class="dr">${r.dragon}</b></div></div>
      <div class="q-rope" role="img" aria-label="You hold ${r.you} of ${r.total} gold; keep ${r.need} to win"><i style="width:${pct.toFixed(1)}%"></i><u style="left:${linePct}%"></u></div>
      <div class="q-cap"><span>${cap}</span><span>Keep ${r.need || 0} to win</span></div>
      <div class="q-say"><i class="q-face" aria-hidden="true"></i><p>${said}</p></div>
    </div>
    <div class="q-bar"><button class="q-pill" data-act="q-routine"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4.5h10M3 8h10M3 11.5h6"/></svg>${opts.noHabits ? 'Set up your routine' : 'Add habits with Claude'}</button>${opts.remind ? `<button class="q-pill${opts.remind.act === 'off' ? ' on' : ''}" data-act="q-remind" data-v="${opts.remind.act || 'info'}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3z"/><path d="M6.5 14a1.6 1.6 0 0 0 3 0"/></svg>${opts.remind.act === 'off' ? 'Reminders on' : 'Reminders'}</button>` : ''}</div>
    ${opts.noHabits && d >= T ? `<div class="q-setup"><b>Set up your routine</b><p>Tell Claude about your ideal day and it drafts your daily habits. Every habit becomes a quest the dragon watches.</p><button class="q-btn" data-act="q-routine">Set up with Claude</button></div>` : ''}
    <div class="q-list">${rows || `<div class="q-empty">No quests on this day. Plan a task or a habit for it, and the dragon will start watching.</div>`}${opts.adder || ''}</div>
    <div class="q-foot">
      <div class="q-week">${wk}</div>
      <p>This week: <b class="you">you ${wins}</b>, <b class="dr">the dragon ${losses}</b></p>
      <p class="q-vault">Vault <b>${R.vault.toLocaleString()} gold</b>${next ? ` · next, a ${esc(next[1].toLowerCase())} at ${next[0].toLocaleString()}` : ' · the castle is complete'}</p>
      ${opts.remind ? `<div class="q-tool"><p>${esc(opts.remind.txt)}</p>${opts.remind.act ? `<button class="q-btn${opts.remind.act === 'off' ? ' quiet' : ''}" data-act="q-remind" data-v="${opts.remind.act}">${esc(opts.remind.btn)}</button>` : ''}</div>` : ''}
      <p class="q-dragon">The dragon took ${R.last7} gold this week, so it's a ${esc(D.name.toLowerCase())}: it swoops ${D.grace} minutes after a quest's time ends.</p>
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
