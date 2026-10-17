// Notes Claude leaves through the connector (post_note), such as what the morning plan check moved.
// Unread ones show as one card at the top of the app; every note stays in Notes, newest first.
// Read state lives in Supabase (read_at), so Got it on the phone clears the card on the computer too.
// A Got it made offline is kept on the device and sent when the connection is back.
import { add, lsGet, lsSet, today } from './util.js';

const COLS = 'id,author,title,body,link,task_ids,created_at,read_at';
let sb = null, userId = null, channel = null, key = null, retry = 0;
let list = [];                 // newest first
let reads = new Set();         // marked read here, not saved yet
const listeners = new Set();

export const onChange = f => { listeners.add(f); return () => listeners.delete(f); };
const emit = () => { if (key) lsSet(key, { list, reads: [...reads] }); for (const f of listeners) f(); };
export const all = () => list;
export const unread = () => list.filter(n => !n.read_at);

function load(k) { key = k; const c = lsGet(k, null); list = c?.list || []; reads = new Set(c?.reads || []); }
const sort = () => list.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
// What the server says, except a Got it from here that hasn't reached it yet
function own(row) { const old = list.find(n => n.id === row.id); return reads.has(row.id) && !row.read_at ? { ...row, read_at: old?.read_at || new Date().toISOString() } : row; }

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
export function stop() { if (channel && sb) sb.removeChannel(channel); channel = null; sb = null; userId = null; key = null; list = []; reads = new Set(); clearTimeout(retry); }

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
async function save() {
  if (!sb || !reads.size || !navigator.onLine) return;
  const ids = [...reads];
  const { error } = await sb.from('notes').update({ read_at: new Date().toISOString() }).in('id', ids).is('read_at', null);
  if (error) { console.warn('notes: save failed', error); clearTimeout(retry); retry = setTimeout(save, 8000); return; }
  ids.forEach(id => reads.delete(id)); if (key) lsSet(key, { list, reads: [...reads] });
}
addEventListener('online', () => { save(); pull(); });
addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });

/* Sample mode: two notes kept on this device, so the card and Notes can be tried before signing in. */
export function useLocal(sample) {
  stop(); load('daybook-notes-sample');
  if (!list.length) list = sampleNotes(sample);
  emit();
}
function sampleNotes(ids) {
  const at = (days, h, m) => { const d = new Date(add(today(), days) + 'T00:00'); d.setHours(h, m); return d.toISOString(); };
  return [
    { id: 'note-2', author: 'Claude', title: 'Morning plan check', link: 'https://claude.ai/', task_ids: ids.slice(0, 2), created_at: at(0, 7, 2), read_at: null,
      body: "Yesterday ran long, so I gave today some room:\n\n- **Rewrite services copy** moved to tomorrow morning.\n- **Write About page** stays today, but now it's the first thing after your 9:00.\n\nThe week is at 9 of your 10 free hours." },
    { id: 'note-1', author: 'Claude', title: 'Sunday week review', link: 'https://claude.ai/', task_ids: ids.slice(2, 3), created_at: at(-1, 18, 30), read_at: null,
      body: "Last week you finished 7 of 9 tasks. I put the two that slipped on Tuesday and Thursday, and kept Friday light for the film shoot prep." },
  ];
}
