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
  const L = leaves(id); return { done: L.filter(l => l.done).length, total: L.length };
}
export function isDone(n) { if (!hasKids(n.id)) return n.done; const p = progress(n.id); return p.total > 0 && p.done === p.total; }
export function ancestors(n) { const a = []; let p = n.p && node(n.p); while (p) { a.unshift(p); p = p.p && node(p.p); } return a; }
export const rootOf = n => ancestors(n)[0] || n;
/* Aurora look: project colours glow on the dark glass. Older saved colours map to their glowing twin. */
const GLOW = { '#4B6CB7': '#7FA8FF', '#2E8B6E': '#4FE3C1', '#B7791F': '#FFC56B', '#9B5BA5': '#D58CFF', '#C0564B': '#FF8A8A', '#3E8E9E': '#5FD4F0', '#7A7F2E': '#C9D66B', '#B0567F': '#FF8FC8', '#8A918C': '#B9BCD0' };
export const glow = c => (c && GLOW[c.toUpperCase()]) || c;
export const colorOf = n => glow(rootOf(n).c) || '#B9BCD0';
export const dayItems = d => store.all().filter(n => n.d === d).sort((a, b) => a.o - b.o);
export const unscheduled = () => store.all().filter(n => !n.d && !hasKids(n.id) && !n.done && !n.c);
export const PALETTE = ['#7FA8FF', '#4FE3C1', '#FFC56B', '#D58CFF', '#FF8A8A', '#5FD4F0', '#C9D66B', '#FF8FC8'];
