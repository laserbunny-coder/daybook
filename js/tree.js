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
export const colorOf = n => rootOf(n).c || '#8A918C';
export const dayItems = d => store.all().filter(n => n.d === d).sort((a, b) => a.o - b.o);
export const unscheduled = () => store.all().filter(n => !n.d && !hasKids(n.id) && !n.done && !n.c);
export const PALETTE = ['#4B6CB7', '#2E8B6E', '#B7791F', '#9B5BA5', '#C0564B', '#3E8E9E', '#7A7F2E', '#B0567F'];
