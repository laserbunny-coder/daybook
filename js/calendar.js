// Google Calendar events, read-only, shown alongside tasks.
import { add, fd, lsGet, lsSet, pd, today } from './util.js';

let sb = null, mode = 'none';           // none | sample | google
let byDay = new Map();                  // 'YYYY-MM-DD' -> [{t,s,m,allDay,color}]
let loaded = { from: null, to: null, at: 0 };
export const cal = { connected: false, reconnect: false, error: null, loading: false };
let onUpdate = () => {};

export function onCalendarChange(f) { onUpdate = f; }
export const eventsOn = d => (byDay.get(d) || []).slice().sort((a, b) => (a.allDay ? -1 : a.s) - (b.allDay ? -1 : b.s));
export const timedOn = d => eventsOn(d).filter(e => !e.allDay);

export function useSample() {
  mode = 'sample'; sb = null; byDay = new Map(); cal.connected = false;
  const T = today(), D = n => add(T, n);
  [['Team check-in', D(0), 600, 30], ['Lunch with Sam', D(0), 780, 60], ['Client call', D(1), 840, 60], ['Dentist', D(2), 540, 60],
   ['Team check-in', D(3), 600, 30], ['1:1 with Jordan', D(3), 930, 60], ['Haircut', D(4), 720, 45], ['Dinner with family', D(4), 1080, 120],
   ["Kids' soccer", D(5), 600, 120]].forEach(([t, d, s, m]) => push(d, { t, s, m, allDay: false }));
  onUpdate();
}

export function useGoogle(client, userId) {
  mode = 'google'; sb = client; byDay = new Map(); loaded = { from: null, to: null, at: 0 };
  const c = lsGet('daybook-cal-' + userId);
  if (c) { byDay = new Map(c.days); cal.connected = c.connected; }
  cal.key = 'daybook-cal-' + userId;
  onUpdate();
}

function push(d, e) { if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(e); }

/** Make sure events for the given range are loaded (refreshes every 10 minutes). */
export async function ensure(from, to, force = false) {
  if (mode !== 'google' || !sb) return;
  const fresh = Date.now() - loaded.at < 10 * 60e3;
  if (!force && fresh && loaded.from && from >= loaded.from && to <= loaded.to) return;
  const a = from < today() ? from : add(today(), -7), b = to > add(today(), 28) ? to : add(today(), 28);
  cal.loading = true;
  try {
    const { data, error } = await sb.functions.invoke('calendar', {
      body: { timeMin: pd(a).toISOString(), timeMax: pd(add(b, 1)).toISOString() },
    });
    if (error) throw error;
    cal.connected = !!data.connected; cal.reconnect = !!data.reconnect; cal.error = data.error || null;
    const next = new Map();
    for (const [d, list] of byDay) if (d < a || d > b) next.set(d, list); // keep other cached days
    byDay = next;
    for (const ev of data.events || []) place(ev);
    loaded = { from: a, to: b, at: Date.now() };
    lsSet(cal.key, { days: [...byDay], connected: cal.connected });
  } catch (e) {
    console.warn('calendar failed', e); cal.error = "Couldn't load your calendar right now.";
  } finally { cal.loading = false; onUpdate(); }
}

function place(ev) {
  const base = { t: ev.title, color: ev.color, cal: ev.calendar };
  if (ev.allDay) {
    for (let d = ev.start; d < ev.end; d = add(d, 1)) push(d, { ...base, allDay: true });
    return;
  }
  const s = new Date(ev.start), e = new Date(ev.end);
  // Split events that run past midnight into one piece per day.
  for (let day = fd(s); day <= fd(new Date(e - 1)); day = add(day, 1)) {
    const dayStart = pd(day), next = pd(add(day, 1));
    const a = s > dayStart ? s : dayStart, b = e < next ? e : next;
    const sm = Math.round((a - dayStart) / 60e3), em = Math.round((b - dayStart) / 60e3);
    if (em > sm) push(day, { ...base, s: sm, m: em - sm, allDay: false });
  }
}
