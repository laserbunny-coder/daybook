// The planner's data: every area, project, sub-project and task.
// Areas (Business, Personal…) are rows too, marked kind 'area'; a top-level
// project names its area in area_id. all() leaves areas out, areas() lists them.
// Changes are applied locally at once, cached on the device, and synced to
// Supabase in the background so the phone and computer stay in step.
import { add, lsGet, lsSet, today, uid } from './util.js';
import { nextOn, occId, repeatsOn, shiftRule, splitOcc } from './repeat.js';

const nodes = new Map();          // id -> node (deleted ones kept as tombstones)
const listeners = new Set();
let cacheKey = null;
let sb = null, userId = null, channel = null;
let dirty = new Set();
let cursor = null;                // newest server updated_at we have seen
let flushTimer = null, retryTimer = null;
export const sync = { state: 'local', pending: 0 }; // local | syncing | saved | offline | error

const ROW = { p: 'parent_id', t: 'title', notes: 'notes', done: 'done', d: 'day', s: 'start_min', m: 'duration_min', o: 'sort', c: 'color', due: 'due', link: 'link', a: 'after_min', ds: 'day_sort', k: 'kind', ar: 'area_id', st: 'start', ms: 'milestone', hd: 'hard_deadline', w: 'waits_on', am: 'actual_minutes', r: 'repeat_rule', rs: 'series_id', oc: 'occurs_on', x: 'deleted' };
const toRow = n => { const r = { id: n.id }; for (const [k, col] of Object.entries(ROW)) r[col] = n[k] ?? (k === 'done' || k === 'x' || k === 'ms' || k === 'hd' ? false : k === 'm' ? 60 : k === 'o' ? 0 : null); return r; };
const fromRow = r => { const n = { id: r.id }; for (const [k, col] of Object.entries(ROW)) n[k] = r[col]; return n; };

function emit() { saveCache(); for (const f of listeners) f(); }
function saveCache() { if (cacheKey) lsSet(cacheKey, { nodes: [...nodes.values()], dirty: [...dirty], cursor }); }
function setSync(state) { sync.state = state; sync.pending = dirty.size; for (const f of listeners) f('sync'); }

export function onChange(f) { listeners.add(f); return () => listeners.delete(f); }
// A repeating task's stored occurrences are left out: they show on their days (occOn), not in the project tree
export const all = () => [...nodes.values()].filter(n => !n.x && n.k !== 'area' && !n.rs);
export const areas = () => [...nodes.values()].filter(n => !n.x && n.k === 'area').sort((a, b) => a.o - b.o);
/** An item even if it's been deleted (to name it in Undo). */
export const peek = id => nodes.get(id);
export const get = id => { const n = nodes.get(id); return n && !n.x ? n : ghost(id); };

function touch(n) { nodes.set(n.id, n); IX = null; if (sb) { dirty.add(n.id); scheduleFlush(); } }

/* Repeating tasks (see repeat.js). A series' repeats are worked out from its rule; the ones that were
   changed, checked off or skipped are stored, and those stand in for the worked-out ones on their dates. */
let IX = null; // series, and stored occurrences by series and date and by the day they're on; rebuilt after any change
function index() {
  if (IX) return IX;
  IX = { series: [], bySeries: new Map(), byDay: new Map() };
  for (const n of nodes.values()) {
    if (n.rs) {
      if (n.oc) { let m = IX.bySeries.get(n.rs); if (!m) IX.bySeries.set(n.rs, m = new Map()); m.set(n.oc, n); }
      if (!n.x && n.d) { const l = IX.byDay.get(n.d) || []; l.push(n); IX.byDay.set(n.d, l); }
    } else if (n.r && !n.x && n.k !== 'area') IX.series.push(n);
  }
  return IX;
}
// What a repeat shares with its series
const SHARED = ['p', 't', 'notes', 's', 'o', 'c', 'link', 'a', 'ds', 'ar', 'w'];
function virt(s, d) {
  const v = { id: occId(s.id, d), rs: s.id, oc: d, d, done: false, m: s.m ?? 60, k: null, r: null, due: null, st: null, ms: false, hd: false, am: null, x: false, v: true };
  for (const k of SHARED) v[k] = s[k] ?? null;
  return v;
}
/** A repeat that isn't stored, worked out from its series; null if there's none by that id. */
function ghost(id) {
  const p = splitOcc(id); if (!p) return null;
  const s = nodes.get(p[0]);
  if (!s || s.x || !s.r || !repeatsOn(s.r, s.d, p[1]) || index().bySeries.get(s.id)?.has(p[1])) return null;
  return virt(s, p[1]);
}
/** Every repeat on day d: the stored ones that sit on it, and the worked-out ones due that day. */
export function occOn(d) {
  const I = index(), out = (I.byDay.get(d) || []).slice();
  for (const s of I.series) if (repeatsOn(s.r, s.d, d) && !I.bySeries.get(s.id)?.has(d)) out.push(virt(s, d));
  return out;
}
/** The series a repeat belongs to (or the series itself). */
export const seriesOf = n => (n?.rs ? get(n.rs) : n?.r ? n : null);
const occRows = sid => [...(index().bySeries.get(sid)?.values() || [])];
/** The stored item to change. A worked-out repeat becomes one of its own first, the same as its series. */
function own(id) {
  const n = nodes.get(id); if (n && !n.x) return n;
  const v = ghost(id); if (!v) return n;
  mark(id, n ? { ...n } : { ...v }); delete v.v; nodes.set(id, v); IX = null;
  return v;
}
// Changing one of these on a single repeat can be carried over to the whole series
const EDIT = ['t', 'notes', 'm', 's', 'd', 'link', 'w'];
// What a change to the series hands down to its stored repeats (those still the same as the series was)
const FOLLOW = ['p', 't', 'notes', 's', 'm', 'c', 'link', 'w', 'ar'];
function setOcc(n, patch) {
  if ('d' in patch && !patch.d) patch = { ...patch, x: true }; // a repeat taken off the plan is skipped
  mark(n.id); Object.assign(n, patch); touch(n);
  if (EDIT.some(k => k in patch) && !patch.x) for (const f of listeners) f('occ', { id: n.id, patch });
}
function setSeries(s, patch) {
  const old = { ...s }, rows = occRows(s.id); patch = { ...patch }; delete patch.done;
  mark(s.id); Object.assign(s, patch); touch(s);
  for (const row of rows) if (!row.x && !row.done) {
    const q = {}; for (const k of FOLLOW) if (k in patch && same(row[k], old[k])) q[k] = patch[k];
    if (Object.keys(q).length) { mark(row.id); Object.assign(row, q); touch(row); }
  }
  // A new rule, start or end: stored repeats that no longer fall on the series' days go. Done ones stay, as a record.
  if (('r' in patch || 'd' in patch) && s.r) for (const row of rows) if (!row.x && !row.done && !repeatsOn(s.r, s.d, row.oc)) { mark(row.id); row.x = true; row.oc = null; touch(row); }
}
function set(id, patch) {
  const n = own(id); if (!n) return;
  if (n.rs) setOcc(n, patch);
  else if (n.r && n.k !== 'area') setSeries(n, patch);
  else { mark(id); Object.assign(n, patch); touch(n); }
}
/** Carries a change made to one repeat over to its whole series. Moving it to another day moves
    the weekday (or day of the month) it repeats on, when the rule has one. */
export function seriesEdit(id, patch) {
  const o = get(id), s = seriesOf(o); if (!s || !s.r) return;
  const p = {}; for (const k of FOLLOW) if (k in patch) p[k] = patch[k];
  if (o.rs && patch.d && patch.d !== o.oc) { const r = shiftRule(s.r, o.oc, patch.d); if (r) { p.r = r; if (patch.d < s.d) p.d = patch.d; } }
  if (Object.keys(p).length) { setSeries(s, p); emit(); }
}
/** Stops a series repeating. It becomes a plain task again on the day of the repeat it was stopped from
    (or its next one), keeping that repeat's own changes. Repeats already done stay as they are. */
export function stopRepeat(id) {
  const o = get(id), s = seriesOf(o); if (!s || !s.r) return null;
  const from = o.rs && !o.done ? o : get(occId(s.id, nextOn(s.r, s.d, today()) || s.d)) || s;
  const keep = {}; for (const k of SHARED) keep[k] = from[k] ?? null;
  const rows = occRows(s.id);
  mark(s.id); Object.assign(s, keep, { r: null, d: from.d || s.d, m: from.m ?? s.m, done: false }); touch(s);
  for (const row of rows) if (!row.x && !row.done) { mark(row.id); row.x = true; row.oc = null; touch(row); }
  emit(); return s.id;
}

/* Undo and redo. Everything changed in one moment (a drop, a check-off, a delete
   with all its steps) is one step, undone together. A step remembers only the
   fields it changed, so undoing it leaves alone whatever arrived from the other
   device meanwhile. Changes from the other device are never steps of their own.
   Typing in one title or notes box is one step, not one per letter. */
const past = [], future = []; let step = null; const KEEP = 100;
const TEXT = ['t', 'notes', 'link'];
const same = (a, b) => (a ?? null) === (b ?? null);
/** Call before changing a node the person changed. */
function mark(id, before) {
  if (!step) { step = new Map(); queueMicrotask(commit); }
  if (!step.has(id)) step.set(id, before !== undefined ? before : nodes.has(id) ? { ...nodes.get(id) } : null);
}
function commit() {
  const s = step; step = null; if (!s) return;
  const ch = [];
  for (const [id, old] of s) {
    const n = nodes.get(id); if (!n) continue; const b = {}, a = {};
    if (!old) { if (n.x) continue; b.x = true; a.x = false; }             // made just now
    else for (const k of Object.keys(ROW)) if (!same(old[k], n[k])) { b[k] = old[k] ?? null; a[k] = n[k] ?? null; }
    if (Object.keys(b).length) ch.push([id, b, a]);
  }
  if (!ch.length) return;
  const top = past[past.length - 1], now = Date.now();
  const text = ch.every(c => Object.keys(c[1]).every(k => TEXT.includes(k))) ? ch.map(c => c[0] + ':' + Object.keys(c[1]).join()).join('|') : null;
  let fresh = null;
  if (text && top && !future.length && top.text === text && now - top.at < 60e3) { top.ch.forEach((c, i) => Object.assign(c[2], ch[i][2])); top.at = now; }
  else {
    // Typing the name of something just made belongs to making it
    const made = text && ch.length === 1 && top && !future.length && now - top.at < 60e3 && top.ch.some(([id, b]) => id === ch[0][0] && b.x === true);
    if (made) { const c = top.ch.find(([id]) => id === ch[0][0]); Object.assign(c[2], ch[0][2]); top.at = now; }
    else { past.push(fresh = { ch, at: now, text }); if (past.length > KEEP) past.shift(); }
  }
  future.length = 0;
  for (const f of listeners) f('step', fresh); // fresh is null when this only added to the last step
}
function apply(st, side) {
  for (const [id, b, a] of st.ch) { const n = nodes.get(id); if (n) { Object.assign(n, side === 'b' ? b : a); touch(n); } }
  emit();
}
/** Takes back the last step; returns it, or null when there's nothing to undo. */
export function undo() { commit(); const st = past.pop(); if (!st) return null; apply(st, 'b'); future.push(st); return st; }
export function redo() { commit(); const st = future.pop(); if (!st) return null; apply(st, 'a'); past.push(st); return st; }
export const canUndo = () => past.length > 0 || !!step;
export const canRedo = () => future.length > 0;
function forget() { past.length = 0; future.length = 0; step = null; }

export function create(fields) {
  const n = { id: uid(), p: null, t: '', notes: null, done: false, d: null, s: null, m: 60, o: Date.now() / 1000, c: null, due: null, link: null, a: null, k: null, ar: null, x: false, ...fields };
  mark(n.id); touch(n); emit(); return n;
}
export function update(id, patch, quiet = false) {
  set(id, patch); if (quiet) saveCache(); else emit();
}
export function updateMany(changes) { for (const [id, patch] of changes) set(id, patch); emit(); }
/** Deletes an item and everything under it. */
export function remove(id) {
  const o = get(id); if (o?.rs) { const n = own(id); mark(id); n.x = true; touch(n); emit(); return; } // just this repeat: skipped
  const n0 = nodes.get(id);
  const kill = i => { const n = nodes.get(i); if (!n) return; mark(i); n.x = true; touch(n); for (const c of [...nodes.values()]) if ((c.p === i || c.rs === i) && !c.x) kill(c.id); };
  kill(id);
  if (n0?.k === 'area') for (const c of nodes.values()) if (c.ar === id && !c.x) { mark(c.id); c.ar = null; if (c.c === 'area') c.c = n0.c; touch(c); } // its projects stay, with no area, keeping the colour they had
  emit();
}
export const snapshot = () => JSON.stringify([...nodes.values()]);
/** Puts everything back the way a snapshot had it (used by Ask Claude's Undo). */
export function restore(snap) {
  const before = new Map(JSON.parse(snap).map(n => [n.id, n]));
  for (const n of [...nodes.values()]) {
    const old = before.get(n.id);
    if (!old) { if (!n.x) { mark(n.id); n.x = true; touch(n); } }
    else if (JSON.stringify(old) !== JSON.stringify(n)) { mark(n.id); touch({ ...old }); }
  }
  emit();
}

/* Local-only mode with sample data (before sign-in, or when not set up). */
export function useLocal(key, seedFn) {
  stopCloud(); forget(); cacheKey = key; nodes.clear(); IX = null; dirty = new Set();
  const c = lsGet(key);
  (c?.nodes?.length ? c.nodes : seedFn()).forEach(n => nodes.set(n.id, n));
  ensureAreas('local'); setSync('local'); emit();
}
export function resetLocal(seedFn) { forget(); nodes.clear(); IX = null; seedFn().forEach(n => nodes.set(n.id, n)); ensureAreas('local'); emit(); }

/* Cloud mode: this person's items in Supabase. */
export async function useCloud(client, user) {
  stopCloud(); forget(); sb = client; userId = user.id; cacheKey = 'daybook-cache-' + user.id;
  nodes.clear(); IX = null;
  const c = lsGet(cacheKey);
  if (c) { c.nodes.forEach(n => nodes.set(n.id, n)); dirty = new Set(c.dirty || []); cursor = c.cursor || null; } else { dirty = new Set(); cursor = null; }
  emit();
  channel = sb.channel('items-' + userId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items', filter: 'user_id=eq.' + userId }, p => { if (p.new && p.new.id) { merge(p.new); emit(); } })
    .subscribe(status => { if (status === 'SUBSCRIBED') pull(); });
  if (await pull()) { ensureAreas(userId); emit(); }
  flush();
}
export function stopCloud() { if (channel && sb) sb.removeChannel(channel); channel = null; sb = null; userId = null; clearTimeout(flushTimer); clearTimeout(retryTimer); }
export const isEmpty = () => all().length === 0;

function merge(row) {
  if (cursor == null || row.updated_at > cursor) cursor = row.updated_at;
  if (dirty.has(row.id)) return;           // our newer local change wins until it's saved
  nodes.set(row.id, fromRow(row)); IX = null;
}
export async function pull() {
  if (!sb) return;
  try {
    setSync('syncing');
    // Look back a minute past the cursor so nothing written at the same moment is missed.
    const since = cursor ? new Date(new Date(cursor).getTime() - 60e3).toISOString() : '1970-01-01T00:00:00Z';
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('items').select('*').gt('updated_at', since).order('updated_at').range(from, from + 999);
      if (error) throw error;
      data.forEach(merge);
      if (data.length < 1000) break;
    }
    emit(); setSync(dirty.size ? 'syncing' : 'saved'); return true;
  } catch (e) { console.warn('pull failed', e); setSync(navigator.onLine ? 'error' : 'offline'); return false; }
}
function scheduleFlush() { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 400); sync.pending = dirty.size; }
export async function flush() {
  if (!sb || !dirty.size) { if (sb) setSync('saved'); return; }
  if (!navigator.onLine) { setSync('offline'); return; }
  const ids = [...dirty]; const rows = ids.map(id => nodes.get(id)).filter(Boolean).map(toRow);
  ids.forEach(id => dirty.delete(id));
  setSync('syncing');
  const { error } = await sb.from('items').upsert(rows);
  if (error) {
    console.warn('save failed', error);
    ids.forEach(id => { if (!dirty.has(id)) dirty.add(id); });
    saveCache(); setSync(navigator.onLine ? 'error' : 'offline');
    clearTimeout(retryTimer); retryTimer = setTimeout(flush, 8000);
    return;
  }
  saveCache(); setSync(dirty.size ? 'syncing' : 'saved');
  if (dirty.size) scheduleFlush();
}
addEventListener('online', () => { flush(); pull(); });
addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); else flush(); });

/* Everyone starts with three areas, and projects from before areas existed
   go under Personal. Runs only when no area has ever existed here (deleted ones
   count), and the ids are fixed so two devices doing it at once agree.
   Each area has a colour; a project whose colour is 'area' wears its area's colour. */
const START_AREAS = [['business', 'Business', '#7FA8FF'], ['filmmaking', 'Filmmaking', '#FFC56B'], ['personal', 'Personal', '#4FE3C1']];
const AREA_COLORS = ['#7FA8FF', '#FFC56B', '#4FE3C1', '#D58CFF', '#FF8A8A', '#5FD4F0', '#C9D66B', '#FF8FC8'];
/** A colour for a new area, one no other area has yet if possible. */
export function nextAreaColor() { const used = new Set(areas().map(a => a.c)); return AREA_COLORS.find(c => !used.has(c)) || AREA_COLORS[areas().length % AREA_COLORS.length]; }
function ensureAreas(who) {
  if (![...nodes.values()].some(n => n.k === 'area')) {
    START_AREAS.forEach(([slug, t, c], i) => touch({ id: `area-${slug}-${who}`, p: null, t, notes: null, done: false, d: null, s: null, m: 60, o: i + 1, c, due: null, link: null, a: null, k: 'area', ar: null, x: false }));
    const home = `area-personal-${who}`;
    for (const n of nodes.values()) if (!n.x && n.k !== 'area' && n.p == null && !n.ar && (n.c || [...nodes.values()].some(c => c.p === n.id && !c.x))) { n.ar = home; n.c = 'area'; touch(n); }
  }
  for (const a of areas()) if (!a.c) { a.c = START_AREAS.find(([slug]) => a.id === `area-${slug}-${who}`)?.[2] || nextAreaColor(); touch(a); } // areas from before colours
}

/* Sample projects for trying the app without signing in. */
export function sampleData() {
  let i = 0; const N = []; const T = today(); const D = n => add(T, n);
  const mk = (t, p, o = {}) => { const n = { id: 's' + (++i), t, p, notes: null, done: false, d: null, s: null, m: 60, o: i, c: null, due: null, k: null, ar: null, x: false, ...o }; N.push(n); return n.id; };
  const [biz, film, life] = START_AREAS.map(([slug, t, c], j) => { N.push({ id: `area-${slug}-local`, t, p: null, notes: null, done: false, d: null, s: null, m: 60, o: j + 1, c, due: null, k: 'area', ar: null, x: false }); return `area-${slug}-local`; });
  const w = mk('Website relaunch', null, { ar: biz, c: 'area', due: D(18), notes: 'Goal: the new site is live before the end of the month.\nSimpler than the old one, fast on phones, and it should say clearly who we help.' });
  const wc = mk('Content', w);
  mk('Write About page', wc, { d: D(0), m: 90, notes: 'Start from the old About text and cut it in half.\nLead with who we help, then the short story of how we started.\nEnd with one clear next step: book a call.' });
  mk('Rewrite services copy', wc, { d: D(1), s: 540, m: 120 });
  mk('Collect 3 client testimonials', wc);
  const wd = mk('Design', w);
  mk('Pick color palette', wd, { done: true });
  mk('Homepage mockup', wd, { d: D(2), m: 180 });
  mk('Review mobile navigation', wd, { d: D(3), m: 45 });
  mk('Choose hosting', w, { d: D(4), m: 45 });
  const t = mk('Family trip to Maine', null, { ar: life, c: 'area', due: D(25) });
  mk('Book cabin', t, { done: true });
  mk('Plan driving route', t, { d: D(1), m: 30 });
  mk('Packing list', t, { notes: 'The cabin has linens and a full kitchen.\nCheck the weather two days before we leave.' });
  mk('Reserve kayak rental', t, { m: 20 });
  const h = mk('Home office refresh', null, { ar: biz, c: '#B7791F' }); // keeps its own colour
  mk('Measure desk wall', h, { d: D(0), s: 960, m: 30 });
  mk('Order shelving', h, { d: D(2), m: 30 });
  mk('Cable cleanup', h, { m: 45 });
  const r = mk('Half marathon training', null, { ar: life, c: 'area', due: D(40) });
  mk('Easy run, 4 miles', r, { d: D(0), s: 420, m: 45 });
  mk('Tempo run', r, { d: D(2), s: 420, m: 45 });
  mk('Long run, 8 miles', r, { d: D(5), s: 480, m: 90 });
  mk('Register for race', r, { m: 15 });
  const f = mk('Short film: Low Tide', null, { ar: film, c: 'area', due: D(60), notes: 'A five-minute short about a lighthouse keeper on her last night.' });
  mk('Finish script draft', f, { d: D(1), m: 120 });
  mk('Scout the harbor at golden hour', f, { d: D(4), s: 1080, m: 90 });
  mk('Make a shot list', f, { m: 60 });
  mk('Call insurance about claim', null, { d: D(0), m: 30 });
  mk('Renew passport', null, { m: 30 });
  mk('Return library books', null, { d: D(3), m: 20 });
  return N;
}
