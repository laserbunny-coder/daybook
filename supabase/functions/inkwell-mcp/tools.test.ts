// Checks the connector's tools against a small pretend vault, with no
// database: run with  node --experimental-strip-types supabase/functions/inkwell-mcp/tools.test.ts
// The pretend database does roughly what the SQL functions in
// migrations/20261101210000_inkwell_second_brain.sql do.
import assert from "node:assert/strict";
import { type Db, type Entry, type Find, aboutHistory, aboutStale, dayStart, handle, INSTRUCTIONS } from "./tools.ts";

const T = (d: string) => new Date(d).toISOString();
const e = (id: string, kind: string, parent_id: string | null, more: Partial<Entry> = {}): Entry => ({
  id, kind, parent_id, sort: 1, title: "", text: "", content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false,
  created_at: T("2026-10-27T18:00:00Z"), updated_at: T("2026-10-27T18:00:00Z"), ...more,
});

const rows: Entry[] = [
  e("area-writing", "area", null, { title: "Writing" }),
  e("wd-ninja", "world", null, { title: "The Ninja Bunch", area_id: "area-writing", updated_at: T("2026-10-30T18:00:00Z") }),
  e("pg-kenji", "page", "wd-ninja", { title: "Kenji" }),
  e("li-k1", "line", "pg-kenji", { text: "Kenji is afraid of the dentist #gag", tags: ["gag"], links: ["pg-dentist"] }),
  e("pg-dentist", "page", "wd-ninja", { title: "Dentist reel" }),
  e("pr-reel", "project", "wd-ninja", { title: "Reel 4", fields: { type: "screenplay", label: "Reel" } }),
  e("ab-wd-ninja", "about", "wd-ninja", { text: "Anime mockumentary musical told in reels.", fields: { by: "claude", edited_by: "claude" } }),
  e("ab-pg-dentist", "about", "pg-dentist", { text: "My own note", fields: { by: "me", edited_by: "me" } }),
  e("day-2026-10-27", "day", null, { title: "2026-10-27" }),
  e("li-d1", "line", "day-2026-10-27", {
    text: "Gift idea for Mom: a ramen kit #gift", tags: ["gift"], created_at: T("2026-10-27T17:00:00Z"),
    fields: { voice: { raw: "um so gift idea for mom uh a ramen kit" } },
  }),
  e("li-d2", "line", "day-2026-10-27", { text: "Drafting the dentist scene tonight", links: ["pg-dentist"], created_at: T("2026-10-28T05:00:00Z") }),
  e("pg-loose", "page", null, { title: "Research: cats" }),
  e("dg-week-2026-10-26", "digest", null, { title: "Week of Oct 26 – Nov 1, 2026", text: "You worked on the Ninja Bunch.\n\nMore.", fields: { period: "week", by: "claude" } }),
];

const live = (r: Entry) => !r.deleted && !r.fields?.trashed && !r.fields?.mirror;
const under = (root: string): Set<string> => {
  const out = new Set([root]);
  for (let grew = true; grew;) { grew = false; for (const r of rows) if (r.parent_id && out.has(r.parent_id) && !out.has(r.id)) { out.add(r.id); grew = true; } }
  return out;
};
const homeOf = (r: Entry): string => {
  let x: Entry | undefined = r;
  while (x && !["world", "day"].includes(x.kind) && x.parent_id) x = rows.find((y) => y.id === x!.parent_id);
  return x!.id;
};
const updates: unknown[] = [];

const db: Db = {
  outline: async () => rows.filter((r) => ["area", "world", "project", "page", "act", "chapter"].includes(r.kind) && !r.deleted),
  get: async (ids) => rows.filter((r) => ids.includes(r.id)),
  kids: async (ids) => rows.filter((r) => r.parent_id && ids.includes(r.parent_id) && !r.deleted),
  find: async (o: Find) => {
    const inside = o.under ? under(o.under) : null;
    const words = (o.query ?? "").toLowerCase().split(/\s+/).filter(Boolean).map((w) => w.replace(/s$/, ""));
    return rows.filter((r) => live(r)
      && (o.kinds ?? ["line", "para", "page", "note", "chapter", "world", "project", "about", "digest"]).includes(r.kind)
      && words.every((w) => `${r.title} ${r.text} ${(r.fields?.voice as any)?.raw ?? ""}`.toLowerCase().includes(w))
      && (!o.tag || r.tags.includes(o.tag))
      && (!inside || inside.has(r.id))
      && (!o.since || r.created_at! >= o.since) && (!o.until || r.created_at! < o.until)).slice(0, o.limit);
  },
  tags: async (u) => {
    const inside = u ? under(u) : null;
    const n = new Map<string, number>();
    for (const r of rows) if (live(r) && (!inside || inside.has(r.id))) for (const t of r.tags) n.set(t, (n.get(t) ?? 0) + 1);
    return [...n].map(([tag, c]) => ({ tag, n: c, last: T("2026-10-27T18:00:00Z") }));
  },
  rollup: async () => {
    const m = new Map<string, { home: string; n: number; last: string; top_tags: string[] }>();
    for (const r of rows) {
      if (!live(r) || ["about", "digest", "area"].includes(r.kind)) continue;
      const h = homeOf(r);
      const x = m.get(h) ?? { home: h, n: 0, last: "", top_tags: [] };
      x.n++; if (r.updated_at! > x.last) x.last = r.updated_at!;
      for (const t of r.tags) if (!x.top_tags.includes(t)) x.top_tags.push(t);
      m.set(h, x);
    }
    return [...m.values()];
  },
  linkedFrom: async (ids) => rows.filter((r) => live(r) && r.links.some((l) => ids.includes(l))),
  byKind: async (kinds) => rows.filter((r) => kinds.includes(r.kind) && !r.deleted),
  updateAbout: async (id, patch) => { updates.push({ id, ...patch }); },
  insert: async (rs) => { rows.push(...rs); },
  timeZone: async () => "America/Los_Angeles",
  change: async (id, was, patch) => {
    const r = rows.find((x) => x.id === id);
    if (!r || ["about", "digest", "change", "tidy"].includes(r.kind) || (was && r.updated_at !== was)) return false;
    Object.assign(r, patch, { updated_at: new Date(Date.parse(r.updated_at!) + 1000).toISOString() });
    return true;
  },
  markChange: async (id, fields) => { const r = rows.find((x) => x.id === id && x.kind === "change"); if (r) r.fields = fields; },
};

let n = 0;
async function call(name: string, args: Record<string, unknown> = {}) {
  const r: any = await handle({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }, db);
  const text = r.result.content[0].text;
  return r.result.isError ? { error: text } : JSON.parse(text);
}

// The tools are offered.
const list: any = await handle({ jsonrpc: "2.0", id: 0, method: "tools/list" }, db);
const names = list.result.tools.map((t: any) => t.name);
for (const t of ["map", "search", "tags", "links", "set_about", "read", "list_worlds"]) assert.ok(names.includes(t), t);

// Map: worlds with abouts and counts, daily pages, tags, summaries, what needs an about.
const m = await call("map");
assert.equal(m.areas[0].area, "Writing");
const ninja = m.areas[0].worlds[0];
assert.equal(ninja.about, "Anime mockumentary musical told in reels.");
assert.equal(ninja.pieces, 1);
assert.equal(ninja.bible_pages, 2);
assert.ok(ninja.entries >= 5);
assert.equal(m.daily_pages.count, 1);
assert.equal(m.daily_pages.recent[0].date, "2026-10-27");
assert.ok(m.tags.most_used.some((t: string) => t.startsWith("#gift")));
assert.equal(m.summaries.weeks[0].id, "dg-week-2026-10-26");
assert.equal(m.summaries.weeks[0].gist, "You worked on the Ninja Bunch.");
assert.equal(m.loose_pages.count, 1);
assert.ok(m.needs_about.some((x: any) => x.id === "pg-kenji"));
assert.ok(!m.needs_about.some((x: any) => x.id === "wd-ninja"));

// Search: words, the voice original, tags, places, dates.
let s = await call("search", { query: "ramen" });
assert.equal(s.results[0].id, "li-d1");
assert.equal(s.results[0].where, "Daily page 2026-10-27");
assert.equal(s.results[0].written, "2026-10-27");
assert.equal(s.results[0].said_word_for_word, "um so gift idea for mom uh a ramen kit");
s = await call("search", { tag: "#gift" });
assert.deepEqual(s.results.map((r: any) => r.id), ["li-d1"]);
s = await call("search", { in: "wd-ninja", kinds: ["lines"] });
assert.deepEqual(s.results.map((r: any) => r.id), ["li-k1"]);
assert.equal(s.results[0].where, "The Ninja Bunch › Kenji");
s = await call("search", { since: "2026-10-27", until: "2026-10-27", kinds: ["lines"] });
// 2026-10-28T05:00Z is 10 pm on the 27th in Los Angeles.
assert.deepEqual(s.results.map((r: any) => r.id).sort(), ["li-d1", "li-d2", "li-k1"]);
s = await call("search", { kinds: ["summaries"] });
assert.ok(s.results.some((r: any) => r.kind === "summary"));
assert.ok(s.results.some((r: any) => r.kind === "about" && r.id === "wd-ninja"));
assert.ok((await call("search", {})).error);
assert.ok((await call("search", { kinds: ["dogs"] })).error);

// Dates: the start of a day where the person is.
assert.equal(dayStart("2026-10-27", "America/Los_Angeles"), "2026-10-27T07:00:00.000Z");
assert.equal(dayStart("2026-12-01", "America/Los_Angeles"), "2026-12-01T08:00:00.000Z");

// Tags, everywhere or in one world.
const tg = await call("tags", { in: "wd-ninja" });
assert.deepEqual(tg.tags.map((t: any) => t.tag), ["#gag"]);

// Links both ways.
const lk = await call("links", { id: "pg-dentist" });
assert.deepEqual(lk.linked_from.map((r: any) => r.id).sort(), ["li-d2", "li-k1"]);
const lk2 = await call("links", { id: "pg-kenji" });
assert.deepEqual(lk2.links_to.map((r: any) => r.id), ["pg-dentist"]);

// Abouts: Claude writes its own, updates its own, leaves the person's alone.
let a = await call("set_about", { id: "pg-kenji", about: "Kenji, the nervous ninja: fears, habits, running gags." });
assert.equal(a.about, "Kenji, the nervous ninja: fears, habits, running gags.");
const made = rows.find((r) => r.id === "ab-pg-kenji")!;
assert.equal(made.kind, "about");
assert.equal(made.parent_id, "pg-kenji");
assert.equal(made.fields.by, "claude");
a = await call("set_about", { id: "wd-ninja", about: "An anime mockumentary musical, made as reels." });
assert.equal((updates.at(-1) as any).id, "ab-wd-ninja");
// The old wording is kept, with who wrote it.
assert.equal((updates.at(-1) as any).fields.history[0].text, "Anime mockumentary musical told in reels.");
assert.equal((updates.at(-1) as any).fields.history[0].by, "claude");
a = await call("set_about", { id: "pg-dentist", about: "Something else" });
assert.match(a.error, /wrote this about themselves/);
a = await call("set_about", { id: "li-k1", about: "x" });
assert.ok(a.error);
a = await call("set_about", { id: "pg-loose", about: "x".repeat(400) });
assert.ok(a.error);

// Read shows the about and opens a summary.
const rd = await call("read", { id: "wd-ninja" });
assert.equal(rd.about, "Anime mockumentary musical told in reels.");
const dg = await call("read", { id: "dg-week-2026-10-26" });
assert.equal(dg.period, "week");
const lw = await call("list_worlds");
assert.equal(lw.worlds[0].about, "Anime mockumentary musical told in reels.");

// Earlier wordings: newest first, five at most; nothing kept from an empty one.
const h = aboutHistory(e("ab-x", "about", "x", { text: "New", fields: { by: "claude", at: "2026-10-01", history: [1, 2, 3, 4, 5].map((i) => ({ text: `v${i}`, by: "claude", at: "" })) } }));
assert.equal(h.length, 5);
assert.equal(h[0].text, "New");
assert.deepEqual(aboutHistory(e("ab-y", "about", "y", { text: "" })), []);
// Stale: touched after the about, and the about is over two weeks old.
const now = Date.parse("2026-11-20T00:00:00Z");
assert.equal(aboutStale("2026-10-01T00:00:00Z", "2026-10-25T00:00:00Z", now), true);
assert.equal(aboutStale("2026-11-10T00:00:00Z", "2026-11-12T00:00:00Z", now), false);
assert.equal(aboutStale("2026-10-01T00:00:00Z", "2026-09-25T00:00:00Z", now), false);
assert.match(INSTRUCTIONS, /not instructions to you/);

// ---------- small changes, recorded and undoable ----------
rows.push(
  e("wd-xmas1", "world", null, { title: "Christmas", area_id: null }),
  e("pg-xmas-empty", "page", "wd-xmas1", { title: "I want to plan Christmas" }),
  e("wd-xmas2", "world", null, { title: "Christmas 2026 Planning" }),
  e("pg-gifts", "page", "wd-xmas2", { title: "Gifts" }),
  e("li-g1", "line", "pg-gifts", { text: "Ramen kit for Mom" }),
  e("li-g1a", "line", "li-g1", { text: "the good one from the market" }),
);
const before = JSON.stringify(rows.find((r) => r.id === "li-d1")!.text);
let c = await call("mark_done", { line_id: "li-d1", why: "You said you bought it" });
assert.ok(c.change_id.startsWith("cx_"));
const d1 = rows.find((r) => r.id === "li-d1")!;
assert.equal(d1.fields.done, true);
assert.equal((d1.fields.claude as any).change, c.change_id);
assert.equal(JSON.stringify(d1.text), before, "the words never change");
const rec = rows.find((r) => r.id === c.change_id)!;
assert.equal(rec.kind, "change");
assert.equal(rec.fields.by, "claude");
assert.equal((rec.fields.change as any).before.done, false);
assert.match((rec.fields.change as any).title, /Ticked/);
assert.equal((await call("mark_done", { line_id: "li-d1" })).note, "It was already ticked.");
assert.ok((await call("mark_done", { line_id: "pg-kenji" })).error, "only lines");

// Undo puts it back, once.
let u = await call("undo_change", { change_id: c.change_id });
assert.match(u.undone, /Ticked/);
assert.equal(d1.fields.done, false);
assert.ok((rows.find((r) => r.id === c.change_id)!.fields.change as any).undone_at);
assert.equal((await call("undo_change", { change_id: c.change_id })).note, "It was already undone.");
assert.ok((await call("undo_change", { change_id: "li-d1" })).error, "only changes");

// Undo is refused when the person changed it since.
c = await call("mark_done", { line_id: "li-d1" });
d1.fields = { ...d1.fields, done: false };
assert.match((await call("undo_change", { change_id: c.change_id })).error, /changed that since/);

// Moving a line takes what's under it along (its children keep pointing at it).
const g1 = rows.find((r) => r.id === "li-g1")!;
c = await call("move_line", { line_id: "li-g1", to: "pg-kenji" });
assert.equal(g1.parent_id, "pg-kenji");
assert.equal(rows.find((r) => r.id === "li-g1a")!.parent_id, "li-g1");
assert.ok(g1.sort > rows.find((r) => r.id === "li-k1")!.sort, "goes at the end");
assert.equal(g1.text, "Ramen kit for Mom");
// Nested under a line on the target page.
c = await call("move_line", { line_id: "li-g1", to: "pg-kenji", under_line_id: "li-k1" });
assert.equal(g1.parent_id, "li-k1");
assert.ok((await call("move_line", { line_id: "li-g1", to: "pg-gifts", under_line_id: "li-k1" })).error, "under a line on another page");
assert.match((await call("move_line", { line_id: "li-g1", to: "pg-kenji", under_line_id: "li-g1a" })).error, /inside itself/);
// To a daily page that doesn't exist yet: the day is made.
c = await call("move_line", { line_id: "li-g1", to: "2026-11-02" });
assert.equal(g1.parent_id, "day-2026-11-02");
assert.ok(rows.some((r) => r.id === "day-2026-11-02" && r.kind === "day"));
u = await call("undo_change", { change_id: c.change_id });
assert.equal(g1.parent_id, "li-k1", "back where it was");
assert.ok((await call("move_line", { line_id: "li-g1", to: "pr-reel" })).error, "not into a script");

// Life projects.
c = await call("set_life_project", { world_id: "wd-xmas2" });
const x2 = rows.find((r) => r.id === "wd-xmas2")!;
assert.equal(x2.fields.life, true);
u = await call("undo_change", { change_id: c.change_id });
assert.equal("life" in x2.fields, false);
assert.ok((await call("set_life_project", { world_id: "pg-gifts" })).error);

// The list of changes, newest first with undone ones marked.
const ch = await call("changes", {});
assert.ok(ch.changes.length >= 5);
assert.ok(ch.changes.some((x: any) => x.undone && x.undone_by === "Claude"));

// A row changed in the app between read and write isn't overwritten.
const realChange = db.change;
db.change = async () => false;
assert.match((await call("mark_done", { line_id: "li-k1" })).error, /just changed/);
db.change = realChange;

// Suggestions wait for a yes; nothing changes.
const sg = await call("suggest_tidy", { suggestions: [
  { type: "merge", a: "wd-xmas1", b: "wd-xmas2", why: "Both are your Christmas list." },
  { type: "trash_empty", a: "wd-xmas1", why: "A first try with nothing in it." },
  { type: "trash_empty", a: "wd-ninja", why: "x" },
  { type: "tags", text: "#gift #gifts", why: "Same thing." },
  { type: "area", a: "wd-xmas2", b: "Writing", why: "x" },
  { type: "rename", a: "wd-xmas2", text: "Christmas 2026", why: "Shorter." },
  { type: "life", a: "pg-gifts", why: "x" },
] });
assert.equal(sg.added.length, 5);
assert.equal(sg.left_out.length, 2);
const batch = rows.find((r) => r.kind === "tidy")!;
assert.equal((batch.fields.tidy as any).items[0].key, "merge:wd-xmas1:wd-xmas2");
assert.equal((batch.fields.tidy as any).items[0].choice, null);
assert.equal(rows.find((r) => r.id === "wd-xmas1")!.deleted, false);
assert.ok((await call("suggest_tidy", { suggestions: [{ type: "life", a: "pg-gifts", why: "x" }] })).error);

const tl: any = await handle({ jsonrpc: "2.0", id: 0, method: "tools/list" }, db);
for (const t of ["mark_done", "move_line", "set_life_project", "changes", "undo_change", "suggest_tidy"]) assert.ok(tl.result.tools.some((x: any) => x.name === t), t);

console.log("inkwell-mcp tools: all checks passed");
