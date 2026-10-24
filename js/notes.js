// Notes Claude leaves through the connector (post_note), such as what the morning plan check moved.
// Unread ones show as one card at the top of the app; every note stays in Notes, newest first.
// Read state lives in Supabase (read_at), so Got it on the phone clears the card on the computer too.
// A Got it made offline is kept on the device and sent when the connection is back.
// Needs you items live here too: a note with a kind (decision, blocked, review) and the Claude project it came from,
// raised by a thread in any Claude project. They stay out of Notes and show on the Plan until cleared (resolved_at).
import { add, lsGet, lsSet, today } from './util.js';

const COLS = 'id,author,title,body,link,task_ids,created_at,read_at,kind,project,project_link,resolved_at';
let sb = null, userId = null, channel = null, key = null, retry = 0;
let list = [];                 // newest first
let reads = new Set();         // marked read here, not saved yet
let clears = {};               // Needs you items cleared (or taken back, null) here, not saved yet: id → resolved_at
const listeners = new Set();

export const onChange = f => { listeners.add(f); return () => listeners.delete(f); };
const keep = () => { if (key) lsSet(key, { list, reads: [...reads], clears }); };
const emit = () => { keep(); for (const f of listeners) f(); };
export const all = () => list.filter(n => !n.kind);
export const unread = () => all().filter(n => !n.read_at);
/** What's waiting on the person across their Claude projects, oldest first. */
export const needs = () => list.filter(n => n.kind && !n.resolved_at).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));

function load(k) { key = k; const c = lsGet(k, null); list = c?.list || []; reads = new Set(c?.reads || []); clears = c?.clears || {}; }
const sort = () => list.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
// What the server says, except a Got it from here that hasn't reached it yet
function own(row) {
  const old = list.find(n => n.id === row.id);
  if (reads.has(row.id) && !row.read_at) row = { ...row, read_at: old?.read_at || new Date().toISOString() };
  if (row.id in clears) row = { ...row, resolved_at: clears[row.id] };
  return row;
}

export async function useCloud(client, user) {
  stop(); sb = client; userId = user.id; load('daybook-notes-' + user.id); emit();
  channel = sb.channel('notes-' + userId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: 'user_id=eq.' + userId }, p => {
      if (p.new?.id) { const n = own(p.new), i = list.findIndex(x => x.id === n.id); if (i < 0) list.push(n); else list[i] = n; sort(); emit(); }
      else if (p.old?.id) { list = list.filter(n => n.id !== p.old.id); emit(); }
    })
    .subscribe(s => { if (s === 'SUBSCRIBED') pull(); });
  await pull();
}
export function stop() { if (channel && sb) sb.removeChannel(channel); channel = null; sb = null; userId = null; key = null; list = []; reads = new Set(); clears = {}; clearTimeout(retry); }

export async function pull() {
  if (!sb) return;
  const { data, error } = await sb.from('notes').select(COLS).order('created_at', { ascending: false }).limit(300);
  if (error) { console.warn('notes: pull failed', error); return; }
  list = data.map(own); emit(); save();
}

/** Marks these notes read, on this device at once and then everywhere. */
export function markRead(ids) {
  const at = new Date().toISOString();
  for (const n of list) if (ids.includes(n.id) && !n.read_at) { n.read_at = at; reads.add(n.id); }
  emit(); save();
}
/** Clears a Needs you item (at = now), or takes the clear back (at = null), here at once and then everywhere. */
export function setCleared(id, on) {
  const n = list.find(x => x.id === id); if (!n?.kind) return;
  n.resolved_at = on ? new Date().toISOString() : null; clears[id] = n.resolved_at;
  emit(); save();
}
async function save() {
  if (!sb || !navigator.onLine) return;
  let failed = false;
  if (reads.size) {
    const ids = [...reads];
    const { error } = await sb.from('notes').update({ read_at: new Date().toISOString() }).in('id', ids).is('read_at', null);
    if (error) { console.warn('notes: save failed', error); failed = true; } else ids.forEach(id => reads.delete(id));
  }
  for (const [id, at] of Object.entries(clears)) {
    const { error } = await sb.from('notes').update({ resolved_at: at }).eq('id', id);
    // Taking a clear back fails when the thread has raised a new item since; the new one stands
    if (error && !(at === null && error.code === '23505')) { console.warn('notes: clear failed', error); failed = true; continue; }
    if (clears[id] === at) delete clears[id];
  }
  keep();
  if (failed) { clearTimeout(retry); retry = setTimeout(save, 8000); }
}
addEventListener('online', () => { save(); pull(); });
addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });

/* Sample mode: two notes and a few Needs you items kept on this device, so they can be tried before signing in. */
export function useLocal(sample) {
  stop(); load('daybook-notes-sample');
  if (!list.length) list = sampleNotes(sample);
  else if (!list.some(n => n.kind)) list.push(...sampleNotes(sample).filter(n => n.kind));
  emit();
}
function sampleNotes(ids) {
  const at = (days, h, m) => { const d = new Date(add(today(), days) + 'T00:00'); d.setHours(h, m); return d.toISOString(); };
  const need = (id, kind, project, title, days, h, body = '') => ({ id, kind, project, title, body, author: 'Claude', link: 'https://claude.ai/', project_link: 'https://claude.ai/', task_ids: [], created_at: at(days, h, 0), read_at: null, resolved_at: null });
  return [
    need('need-1', 'blocked', 'Life Planning', 'Needs your free hours for November before it can plan the month', -5, 8, 'Tell it how many hours a week you have for projects in November, and it will lay out the month.'),
    need('need-2', 'decision', 'Life Planning', 'Short film or course launch first in Q1?', -3, 19),
    need('need-3', 'blocked', 'Business Dashboard', 'Meta ads numbers need a fresh sign-in', -2, 10),
    need('need-4', 'review', 'Business Dashboard', 'October report draft is ready to read', 0, 6),
    need('need-5', 'decision', 'Daybook', 'Pick a look for the Needs you line', 0, 4),
    { id: 'note-2', author: 'Claude', title: 'Morning plan check', link: 'https://claude.ai/', task_ids: ids.slice(0, 2), created_at: at(0, 7, 2), read_at: null,
      body: "Yesterday ran long, so I gave today some room:\n\n- **Rewrite services copy** moved to tomorrow morning.\n- **Write About page** stays today, but now it's the first thing after your 9:00.\n\nThe week is at 9 of your 10 free hours." },
    { id: 'note-1', author: 'Claude', title: 'Sunday week review', link: 'https://claude.ai/', task_ids: ids.slice(2, 3), created_at: at(-1, 18, 30), read_at: null,
      body: "Last week you finished 7 of 9 tasks. I put the two that slipped on Tuesday and Thursday, and kept Friday light for the film shoot prep." },
  ];
}
