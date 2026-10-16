// Repeating tasks. A series is one item with a repeat rule (r); its day (d) is the day it starts.
// Each repeat of it ("occurrence") shows on its day without being stored anywhere. Only once one is
// changed, checked off or skipped does it become an item of its own: id "<series id>~<date>",
// rs = the series' id, oc = the date it was due. A stored one with no day of its own is skipped.
// The connector (supabase/functions/mcp/tools.ts) follows the same rules.
//   r = { every: 'day' | 'weekday' | 'week' | 'month', days: [0-6, Sunday is 0] (week),
//         interval: weeks between repeats (week), dom: day of the month (month), until: 'YYYY-MM-DD' }
import { add, daysBetween, DAYN, fmtShort, pd, weekStart } from './util.js';

export const occId = (sid, d) => sid + '~' + d;
/** [series id, date] for an occurrence's id, or null for any other id. */
export function splitOcc(id) {
  const i = typeof id === 'string' ? id.lastIndexOf('~') : -1;
  return i > 0 && /^\d{4}-\d{2}-\d{2}$/.test(id.slice(i + 1)) ? [id.slice(0, i), id.slice(i + 1)] : null;
}

const lastDay = x => new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
/** Does a series with rule r that starts on start repeat on day d? */
export function repeatsOn(r, start, d) {
  if (!r || !start || d < start || (r.until && d > r.until)) return false;
  const x = pd(d), dow = x.getDay();
  switch (r.every) {
    case 'day': return true;
    case 'weekday': return dow >= 1 && dow <= 5;
    case 'week': {
      if (!(r.days?.length ? r.days : [pd(start).getDay()]).includes(dow)) return false;
      const n = Math.max(1, r.interval || 1);
      return n === 1 || (daysBetween(weekStart(start), weekStart(d)) / 7) % n === 0;
    }
    case 'month': return x.getDate() === Math.min(r.dom || pd(start).getDate(), lastDay(x)); // the 31st falls on a shorter month's last day
  }
  return false;
}
/** The first day on or after from that the series repeats, within a year and a bit; null if none. */
export function nextOn(r, start, from) {
  let d = from < start ? start : from;
  for (let i = 0; i < 400; i++, d = add(d, 1)) { if (r.until && d > r.until) return null; if (repeatsOn(r, start, d)) return d; }
  return null;
}

/** A rule as it's kept: only the parts its kind uses, and days in order. */
export function cleanRule(r, start) {
  const o = { every: r.every };
  if (r.every === 'week') {
    o.days = [...new Set((r.days?.length ? r.days : [pd(start).getDay()]).map(Number))].filter(x => x >= 0 && x <= 6).sort((a, b) => a - b);
    o.interval = Math.max(1, Math.min(12, Math.round(r.interval || 1)));
  }
  if (r.every === 'month') o.dom = Math.max(1, Math.min(31, Math.round(r.dom || pd(start).getDate())));
  if (r.until) o.until = r.until;
  return o;
}
/** A repeat moved from one day to another, for the whole series: the weekday or day of the month moves with it.
    Null when the rule has no day to move (every day, weekdays). */
export function shiftRule(r, from, to) {
  if (r.every === 'week') {
    const a = pd(from).getDay(), b = pd(to).getDay(); if (a === b) return null;
    return { ...r, days: [...new Set((r.days || [a]).map(x => x === a ? b : x))].sort((x, y) => x - y) };
  }
  if (r.every === 'month') { const b = pd(to).getDate(); return b === r.dom ? null : { ...r, dom: b }; }
  return null;
}

// Monday first, the way the week is laid out everywhere else
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const nth = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
/** "Every Mon, Wed", "Weekdays", "Every 2 weeks on Fri", "Monthly on the 16th" (and "until Nov 30" when it ends). */
export function ruleText(r, start, withEnd = true) {
  let t = '';
  if (r.every === 'day') t = 'Every day';
  else if (r.every === 'weekday') t = 'Weekdays';
  else if (r.every === 'week') {
    const days = r.days?.length ? r.days : [pd(start).getDay()], n = r.interval || 1;
    const names = days.length === 7 ? 'every day' : WEEK.filter(d => days.includes(d)).map(d => DAYN[d]).join(', ');
    t = n > 1 ? `Every ${n} weeks on ${names}` : days.length === 7 ? 'Every day' : `Every ${names}`;
  } else if (r.every === 'month') t = `Monthly on the ${nth(r.dom || pd(start).getDate())}`;
  return t + (withEnd && r.until ? ` until ${fmtShort(r.until)}` : '');
}
export { WEEK };
