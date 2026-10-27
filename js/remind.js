// Reminders for Quest: notifications on this phone or computer before the dragon swoops.
// Turning them on subscribes this browser to Web Push (sw.js shows them). The plan for the coming
// week (quest.plan) is kept on the server in push_plan and replaced whenever the plan changes;
// a job there sends whatever is due, even with Daybook closed.
import * as quest from './quest.js';
import { lsGet, lsSet } from './util.js';

const KEY = 'daybook-remind';
let client = null, timer = 0, sentHash = null;
const S = { on: false, busy: false, ...lsGet(KEY, {}) };
const save = () => lsSet(KEY, { on: S.on });

export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export function init(c) { client = c; if (S.on && client) later(0); }
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

/** What to say about reminders here, and what tapping does. */
export function state() {
  if (!client) return { txt: 'Reminders work once you sign in.', act: null };
  if (!supported()) return { txt: ios() && !installed() ? 'For reminders on iPhone, add Daybook to your Home Screen first (Share, then Add to Home Screen).' : "This browser can't show reminders.", act: null };
  if (Notification.permission === 'denied') return { txt: 'Notifications are blocked for Daybook. Allow them in your browser or phone settings, then come back.', act: null };
  if (S.busy) return { txt: 'Turning reminders on…', act: null };
  return S.on && Notification.permission === 'granted' ? { txt: 'Reminders are on here. The dragon warns you 15 minutes before it swoops.', act: 'off', btn: 'Turn off' } : { txt: 'Get a nudge before the dragon swoops, even with Daybook closed.', act: 'on', btn: 'Turn on reminders' };
}

export async function enable(update) {
  if (!client || !supported()) return 'unsupported';
  S.busy = true; update();
  try {
    if (await Notification.requestPermission() !== 'granted') return 'denied';
    const reg = await navigator.serviceWorker.ready;
    const { data, error } = await client.functions.invoke('push', { body: { action: 'key' } });
    if (error || !data?.key) throw error || new Error('no key');
    let sub = await reg.pushManager.getSubscription();
    if (sub && sub.options?.applicationServerKey && btoaKey(sub.options.applicationServerKey) !== data.key) { await sub.unsubscribe(); sub = null; }
    sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64(data.key) });
    const j = sub.toJSON();
    const { error: e2 } = await client.from('push_subs').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
    if (e2) throw e2;
    S.on = true; save(); sentHash = null;
    await sync();
    client.functions.invoke('push', { body: { action: 'test', title: 'Reminders are on', body: "The dragon will warn you before it swoops." } }).catch(() => {});
    return 'on';
  } catch (e) { console.warn('reminders', e); return 'error'; }
  finally { S.busy = false; update(); }
}
const btoaKey = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function disable(update) {
  S.on = false; save(); update();
  try {
    const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (sub) { await client?.from('push_subs').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
  } catch (e) { console.warn('reminders off', e); }
}

/** After the plan changes: replace what's waiting to be sent with what the plan says now. */
export function later(ms = 3000) { if (!S.on || !client) return; clearTimeout(timer); timer = setTimeout(sync, ms); }
async function sync() {
  if (!S.on || !client) return;
  const rows = quest.plan(), hash = JSON.stringify(rows);
  if (hash === sentHash) return;
  const now = new Date().toISOString();
  const { error } = await client.from('push_plan').delete().is('sent_at', null).gt('at', now);
  if (error) { console.warn('push plan', error); return; }
  if (rows.length) { const { error: e } = await client.from('push_plan').upsert(rows.map(r => ({ ...r, sent_at: null })), { onConflict: 'user_id,key' }); if (e) { console.warn('push plan', e); return; } }
  sentHash = hash;
}
