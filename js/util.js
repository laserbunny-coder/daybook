export const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAYL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const fd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const add = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return fd(d); };
export const weekStart = s => { const d = pd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fd(d); };
export const today = () => fd(new Date());
export const nowMin = () => { const t = new Date(); return t.getHours() * 60 + t.getMinutes(); };
export const daysBetween = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);

export const fmtT = m => { let h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 && h < 24 ? 'pm' : 'am'; h = h % 12 || 12; return h + (mm ? ':' + String(mm).padStart(2, '0') : '') + ap; };
export const fmtDur = m => m < 60 ? m + 'm' : (m % 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : (m / 60) + 'h');
export const fmtShort = s => MON[pd(s).getMonth()] + ' ' + pd(s).getDate();
export const dayShort = s => s === today() ? 'Today' : s === add(today(), 1) ? 'Tmrw' : DAYN[pd(s).getDay()];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

export function lsGet(key, fallback = null) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } }
export function lsSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ } }
export function lsDel(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } }
