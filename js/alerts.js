// Phone alerts: Daybook buzzes this phone or computer even when it's closed (Web Push; sw.js shows them).
// Turning them on here signs this device up (push_subs). What to hear about is one switch per kind,
// kept on the account (alert_prefs) so it's the same on every device:
//   review  the 9 pm "Your day review" from Inkwell
//   needs   a Claude thread putting something on Needs you
//   notes   any other note from Claude (off at first)
// The server sends them as they happen (supabase/functions/alerts).
import { lsGet, lsSet } from './util.js';

const KEY = 'daybook-alerts';
export const KINDS = [
  { k: 'review', name: 'Day review at 9 pm', hint: 'The nudge to look back over today in Inkwell.' },
  { k: 'needs', name: 'Needs you', hint: 'When a Claude thread needs a decision, is blocked on you, or has something to review.' },
  { k: 'notes', name: 'Other notes from Claude', hint: 'Everything else Claude leaves you in Notes.' },
];
let client = null, uid = null, render = () => {};
const S = { on: false, busy: false, prefs: { review: true, needs: true, notes: false }, msg: '', ...lsGet(KEY, {}) };
const save = () => lsSet(KEY, { on: S.on, prefs: S.prefs });

export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const device = () => /Android/.test(navigator.userAgent) ? 'Android phone' : /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Windows/.test(navigator.userAgent) ? 'Windows computer' : 'This device';

export function init(c, userId, onChange) {
  client = c; uid = userId; render = onChange || render;
  if (!client) return;
  client.from('alert_prefs').select('review,needs,notes').maybeSingle().then(({ data }) => { if (data) { S.prefs = { review: data.review, needs: data.needs, notes: data.notes }; save(); render(); } });
  // Each time Daybook opens with alerts on, make sure this device is still signed up. The phone's push
  // service can drop a sign-up on its own (the server then forgets it), so sign up again quietly and resave it.
  if (S.on && supported()) {
    if (Notification.permission !== 'granted') { S.on = false; save(); render(); }
    else signUp().catch(e => console.warn('alerts: renew', e));
  }
}
export const prefs = () => S.prefs;

/** What to say about alerts on this device. */
export function state() {
  if (!client) return { txt: 'Alerts work once you sign in.', act: null };
  if (!supported()) return { txt: "This browser can't show alerts. On your phone, open Daybook from its home screen icon.", act: null };
  if (Notification.permission === 'denied') return { txt: "Notifications are blocked for Daybook. Allow them in your phone's settings (Apps, then Daybook, then Notifications), then come back.", act: null };
  if (S.busy) return { txt: 'Turning alerts on…', act: null };
  return S.on && Notification.permission === 'granted'
    ? { txt: `Alerts are on for this ${/Android|iPhone|iPad/.test(navigator.userAgent) ? 'phone' : 'device'}.`, act: 'off', on: true }
    : { txt: 'Get a buzz for the things below, even when Daybook is closed.', act: 'on', on: false };
}
export const message = () => S.msg;

export async function enable() {
  if (!client || !supported()) return;
  S.busy = true; S.msg = ''; render();
  try {
    if (await Notification.requestPermission() !== 'granted') { S.msg = 'Daybook needs permission to show notifications. Tap Allow when your phone asks.'; return; }
    const endpoint = await signUp();
    S.on = true; save();
    await test(endpoint);
  } catch (e) { console.warn('alerts', e); S.msg = "Couldn't turn alerts on. Check your connection and try again."; }
  finally { S.busy = false; render(); }
}

/** Signs this device up for Web Push (or reuses its sign-up) and saves it on the server. */
async function signUp() {
  const reg = await navigator.serviceWorker.ready;
  const { data, error } = await client.functions.invoke('alerts', { body: { action: 'key' } });
  if (error || !data?.key) throw error || new Error('no key');
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options?.applicationServerKey && b64(sub.options.applicationServerKey) !== data.key) { await sub.unsubscribe(); sub = null; }
  sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64(data.key) });
  const j = sub.toJSON();
  const { error: e2 } = await client.from('push_subs').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: device() });
  if (e2) throw e2;
  return j.endpoint;
}

export async function disable() {
  S.on = false; S.msg = ''; save(); render();
  try {
    const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (sub) { await client?.from('push_subs').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
  } catch (e) { console.warn('alerts off', e); }
}

/** Buzzes this device now, to check it gets through. */
export async function test(endpoint) {
  try {
    if (!endpoint) { const reg = await navigator.serviceWorker.ready; endpoint = (await reg.pushManager.getSubscription())?.endpoint; }
    const { data, error } = await client.functions.invoke('alerts', { body: { action: 'test', endpoint } });
    S.msg = error || !data?.sent ? "The test didn't go out. Turn alerts off and on again." : 'Test sent. It should buzz in a few seconds.';
  } catch { S.msg = "The test didn't go out. Check your connection."; }
  render();
}

/** Flips one kind on or off, for every device. */
export async function setPref(k, on) {
  S.prefs = { ...S.prefs, [k]: on }; save(); render();
  const { error } = await client.from('alert_prefs').upsert({ user_id: uid, ...S.prefs, updated_at: new Date().toISOString() });
  if (error) { S.msg = "Couldn't save that. Check your connection."; render(); }
}
