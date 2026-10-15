// The planner's data: every area, project, sub-project and task.
// Areas (Business, Personal…) are rows too, marked kind 'area'; a top-level
// project names its area in area_id. all() leaves areas out, areas() lists them.
// Changes are applied locally at once, cached on the device, and synced to
// Supabase in the background so the phone and computer stay in step.
import { add, lsGet, lsSet, today, uid } from './util.js';

const nodes = new Map();          // id -> node (deleted ones kept as tombstones)
const listeners = new Set();
let cacheKey = null;
let sb = null, userId = null, channel = null;
let dirty = new Set();
let cursor = null;                // newest server updated_at we have seen
let flushTimer = null, retryTimer = null;
export const sync = { state: 'local', pending: 0 }; // local | syncing | saved | offline | error

const ROW = { p: 'parent_id', t: 'title', notes: 'notes', done: 'done', d: 'day', s: 'start_min', m: 'duration_min', o: 'sort', c: 'color', due: 'due', link: 'link', a: 'after_min', ds: 'day_sort', k: 'kind', ar: 'area_id', x: 'deleted' };
const toRow = n => { const r = { id: n.id }; for (const [k, col] of Object.entries(ROW)) r[col] = n[k] ?? (k === 'done' || k === 'x' ? false : k === 'm' ? 60 : k === 'o' ? 0 : null); return r; };
const fromRow = r => { const n = { id: r.id }; for (const [k, col] of Object.entries(ROW)) n[k] = r[col]; return n; };

function emit() { saveCache(); for (const f of listeners) f(); }
function saveCache() { if (cacheKey) lsSet(cacheKey, { nodes: [...nodes.values()], dirty: [...dirty], cursor }); }
function setSync(state) { sync.state = state; sync.pending = dirty.size; for (const f of listeners) f('sync'); }

export function onChange(f) { listeners.add(f); return () => listeners.delete(f); }
export const all = () => [...nodes.values()].filter(n => !n.x && n.k !== 'area');
export const areas = () => [...nodes.values()].filter(n => !n.x && n.k === 'area').sort((a, b) => a.o - b.o);
/** An item even if it's been deleted (to name it in Undo). */
export const peek = id => nodes.get(id);
export const get = id => { const n = nodes.get(id); return n && !n.x ? n : null; };

function touch(n) { nodes.set(n.id, n); if (sb) { dirty.add(n.id); scheduleFlush(); } }

/* Undo and redo. Everything changed in one moment (a drop, a check-off, a delete
   with all its steps) is one step, undone together. A step remembers only the
   fields it changed, so undoing it leaves alone whatever arrived from the other
   device meanwhile. Changes from the other device are never steps of their own.
   Typing in one title or notes box is one step, not one per letter. */
const past = [], future = []; let step = null; const KEEP = 100;
const TEXT = ['t', 'notes', 'link'];
const same = (a, b) => (a ?? null) === (b ?? null);
/** Call before changing a node the person changed. */
function mark(id) {
  if (!step) { step = new Map(); queueMicrotask(commit); }
  if (!step.has(id)) step.set(id, nodes.has(id) ? { ...nodes.get(id) } : null);
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
  const text = ch.length === 1 && Object.keys(ch[0][1]).every(k => TEXT.includes(k)) ? ch[0][0] + ':' + Object.keys(ch[0][1]).join() : null;
  let fresh = null;
  if (text && top && !future.length && top.text === text && now - top.at < 60e3) { Object.assign(top.ch[0][2], ch[0][2]); top.at = now; }
  else {
    // Typing the name of something just made belongs to making it
    const made = text && top && !future.length && now - top.at < 60e3 && top.ch.some(([id, b]) => id === ch[0][0] && b.x === true);
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
  const n = nodes.get(id); if (!n) return;
  mark(id); Object.assign(n, patch); touch(n); if (quiet) saveCache(); else emit();
}
export function updateMany(changes) { for (const [id, patch] of changes) { const n = nodes.get(id); if (n) { mark(id); Object.assign(n, patch); touch(n); } } emit(); }
/** Deletes an item and everything under it. */
export function remove(id) {
  const n0 = nodes.get(id);
  const kill = i => { const n = nodes.get(i); if (!n) return; mark(i); n.x = true; touch(n); for (const c of [...nodes.values()]) if (c.p === i && !c.x) kill(c.id); };
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
  stopCloud(); forget(); cacheKey = key; nodes.clear(); dirty = new Set();
  const c = lsGet(key);
  (c?.nodes?.length ? c.nodes : seedFn()).forEach(n => nodes.set(n.id, n));
  ensureAreas('local'); setSync('local'); emit();
}
export function resetLocal(seedFn) { forget(); nodes.clear(); seedFn().forEach(n => nodes.set(n.id, n)); ensureAreas('local'); emit(); }

/* Cloud mode: this person's items in Supabase. */
export async function useCloud(client, user) {
  stopCloud(); forget(); sb = client; userId = user.id; cacheKey = 'daybook-cache-' + user.id;
  nodes.clear();
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
  nodes.set(row.id, fromRow(row));
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
