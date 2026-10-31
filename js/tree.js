// Helpers for the project tree.
import * as store from './store.js';

export const node = id => store.get(id);
export const children = id => store.all().filter(n => n.p === id).sort((a, b) => a.o - b.o);
export const hasKids = id => store.all().some(n => n.p === id);
export const isProj = n => hasKids(n.id) || (n.p == null && !!n.c);
export function leaves(id) { const k = children(id); return k.length ? k.flatMap(c => leaves(c.id)) : [node(id)]; }
export function progress(id) {
  const k = children(id); const n = node(id);
  if (!k.length) return { done: n.done ? 1 : 0, total: n.c ? 0 : 1 };
  const L = leaves(id).filter(l => !l.r); return { done: L.filter(l => l.done).length, total: L.length }; // a repeating task never finishes, so it doesn't count
}
export function isDone(n) { if (!hasKids(n.id)) return n.done; const p = progress(n.id); return p.total > 0 && p.done === p.total; }
export function ancestors(n) { const a = []; let p = n.p && node(n.p); while (p) { a.unshift(p); p = p.p && node(p.p); } return a; }
export const rootOf = n => ancestors(n)[0] || n;
/* Saved colours stay the old glowing ones (so the connector and older data keep working); each look shows them in its own ink.
   Older saved colours map to their glowing twin first. */
const GLOW = { '#4B6CB7': '#7FA8FF', '#2E8B6E': '#4FE3C1', '#B7791F': '#FFC56B', '#9B5BA5': '#D58CFF', '#C0564B': '#FF8A8A', '#3E8E9E': '#5FD4F0', '#7A7F2E': '#C9D66B', '#B0567F': '#FF8FC8', '#8A918C': '#B9BCD0' };
export const glow = c => (c && GLOW[c.toUpperCase()]) || c;
const INKS = {
  ink: { '#7FA8FF': '#86A6DA', '#4FE3C1': '#6FC0B1', '#FFC56B': '#DDAE68', '#D58CFF': '#AD97E3', '#FF8A8A': '#E0877B', '#5FD4F0': '#78BCD2', '#C9D66B': '#BBBF78', '#FF8FC8': '#DC97B6', '#B9BCD0': '#ADA597' },
  paper: { '#7FA8FF': '#3F6195', '#4FE3C1': '#2A7466', '#FFC56B': '#A86F1E', '#D58CFF': '#7454A0', '#FF8A8A': '#B04A3E', '#5FD4F0': '#2F7C93', '#C9D66B': '#6F7526', '#FF8FC8': '#A4507A', '#B9BCD0': '#8F8677' },
};
export const look = () => document.documentElement.dataset.look === 'paper' ? 'paper' : 'ink';
/* A colour as the current look shows it */
export const ink = c => { const g = glow(c || '#B9BCD0'); return INKS[look()][g.toUpperCase()] || g; };
/* A project's colour is its own, or 'area' to wear its area's colour. Tasks wear their project's; a task right in an area wears the area's. */
export const projColor = p => ink((p.c === 'area' || (!p.c && p.ar) ? store.get(p.ar)?.c : p.c) || '#B9BCD0');
export const colorOf = n => n?.k === 'block' ? blockColor(n) : projColor(rootOf(n));
/* Time blocks: a stretch of time for a whole area or project (fo names it). The block wears its colour. */
export const isBlock = n => n?.k === 'block';
export const targetOf = b => { const t = b?.fo && store.get(b.fo); return t && !t.x ? t : null; };
export function blockColor(b) { const t = targetOf(b); return !t ? ink(null) : t.k === 'area' ? ink(t.c) : colorOf(t); }
export const blockTitle = b => targetOf(b)?.t || 'Removed area';
/** Whether an item's work belongs inside a block for target id: the area itself (its projects and loose tasks) or the project and its steps. */
export function within(n, id) {
  if (!n || !id) return false;
  if (n.k === 'block') return n.fo === id;
  if (n.id === id) return true;
  const r = rootOf(n.rs ? store.get(n.rs) || n : n);
  return r.id === id || r.ar === id || ancestors(n).some(a => a.id === id);
}
/* Order in a day's list (ds) is kept apart from order among a project's steps (o).
   A repeating task shows as its repeats on their days (store.occOn), never as itself. */
export const dayItems = d => store.all().filter(n => n.d === d && !n.r).concat(store.occOn(d), store.blocksOn(d)).sort((a, b) => (a.ds ?? a.o) - (b.ds ?? b.o));
/* A step with no day of its own rides along with the nearest scheduled project above it. */
export const heldBy = n => { let p = n.p && node(n.p); while (p) { if (p.d) return p; p = p.p && node(p.p); } return null; };
export const riders = id => children(id).filter(c => !c.d).flatMap(c => hasKids(c.id) ? riders(c.id) : [c]);
export const unscheduled = () => store.all().filter(n => !n.d && !hasKids(n.id) && !n.done && !n.c && !heldBy(n));
export const PALETTE = ['#7FA8FF', '#4FE3C1', '#FFC56B', '#D58CFF', '#FF8A8A', '#5FD4F0', '#C9D66B', '#FF8FC8'];
