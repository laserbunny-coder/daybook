// What Claude can do in Inkwell (the writing app) through its connector, and
// the small part of the MCP protocol needed to offer it. Kept free of Deno and
// Supabase imports so it can be tested on its own; index.ts supplies the
// database.
//
// Claude reads anything and adds to it: lines on a page or a daily page,
// paragraphs at the end of (or after a paragraph in) a chapter, new pages,
// worlds and pieces. Everything it writes is marked as Claude's
// (fields.by = "claude"). It never changes or deletes what's already there.

/** One Inkwell entry, as stored in writing_entries. */
export type Entry = {
  id: string;
  kind: string;
  parent_id: string | null;
  sort: number;
  title: string;
  text: string;
  content: unknown;
  tags: string[];
  type: string | null;
  fields: Record<string, unknown>;
  area_id: string | null;
  links: string[];
  deleted: boolean;
  created_at?: string;
  updated_at?: string;
};

export type Db = {
  /** Areas, worlds, pieces, pages, acts and chapters: everything that gives the vault its shape (no words). */
  outline(): Promise<Entry[]>;
  /** Entries by id (missing ones left out). */
  get(ids: string[]): Promise<Entry[]>;
  /** Everything directly inside these entries. */
  kids(parentIds: string[]): Promise<Entry[]>;
  /** Lines, paragraphs, pages and notes whose words contain every one of these words. */
  search(words: string[], limit: number): Promise<Entry[]>;
  /** Adds new entries. Never used to change existing ones. */
  insert(rows: Entry[]): Promise<void>;
  /** The person's time zone (the Daybook app records it), such as America/Los_Angeles; null if unknown. */
  timeZone(): Promise<string | null>;
};

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const CLAUDE = "claude";
const GAP = 1024;
// Kinds that live in the outline and are never live: hidden from every tool.
const gone = (r: Entry) => r.deleted || !!r.fields?.trashed;

export const INSTRUCTIONS = `Inkwell is this person's own writing app and notebook: novels, screenplays, notes, research and a daily page.
- The Library is organized in areas (Writing, Filmmaking…), which can nest. An area holds worlds.
- A world is everything about one story or show. Its bible is a set of pages (characters, places, rules, running gags…), and pages can hold pages. Its pieces are what gets made in that world, at any size: a gag, a short, an episode, a season, a novel, a film. A piece has a label in the person's own words (Gag, Episode…), a stage (Idea, Written, Boarded, Generated, Edited, Posted), and is written as prose, a script or an outline. Pieces can hold pieces (a season holds its episodes).
- Prose and scripts are written in chapters of paragraphs. In a script each paragraph has an element: scene (heading), action, character, paren, dialogue or transition. Scenes may carry a production scene number such as 3 or 3A; those never change.
- Pages, daily pages and outline pieces are written as nested lines. There is one daily page per day (read it with read and a date, YYYY-MM-DD, or "today").
- Lines and paragraphs can carry #tags and [[links]] to pages by their title.
- Start with list_worlds to find ids, and read before you add, so what you add fits.
- What you add is marked as written by Claude and the person sees it on all their devices. You can't change or delete what's there; if something should change, say so and they'll do it. Keep to the person's voice and don't add more than they asked for.
- Say what you added and where, in plain words, since the person sees your reply, not the tool calls.`;

const str = (description: string) => ({ type: "string", description });
const LINES = {
  type: "array",
  description: "The lines, in order. A line is text, or { \"text\": \"…\", \"children\": [lines nested under it] }. #tags and [[Page title]] links work as in the app.",
  items: { anyOf: [{ type: "string" }, { type: "object", required: ["text"], properties: { text: { type: "string" }, children: { type: "array" } } }] },
};

export const TOOLS = [
  {
    name: "list_worlds",
    title: "List worlds",
    description: "The Library: areas, the worlds in them with their pieces (label, how each is written, stage, chapters) and bible pages, and loose pages. Gives the ids every other tool uses.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "read",
    title: "Read",
    description: "Reads one thing by id: a world (its bible pages and pieces), a piece (its chapters in full, or its outline), a chapter (its paragraphs, with ids, script elements and scene numbers), or a page (its lines, nested, with ids). Give a date (YYYY-MM-DD) or \"today\" for that day's daily page. Long manuscripts come back in parts: pass from to carry on.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: str("The id of a world, piece, chapter or page; or a date YYYY-MM-DD, or \"today\", for a daily page."),
        from: { type: ["integer", "string"], description: "For a long piece or chapter: the paragraph to start from (the next_from of the last part)." },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "search",
    title: "Search",
    description: "Finds lines, paragraphs, notes and page titles containing all of these words (any order, any case), newest first, with where each one is.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: { query: str("Words to find."), limit: { type: ["integer", "string"], description: "How many, 1 to 50. Defaults to 20." } },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_lines",
    title: "Add lines",
    description: "Adds lines to a page, a daily page or an outline piece: at the end, or nested under one of its lines (under_line_id, from read). Marked as written by Claude.",
    inputSchema: {
      type: "object",
      required: ["to", "lines"],
      properties: {
        to: str("A page or outline piece id, or a date (YYYY-MM-DD) or \"today\" for the daily page."),
        under_line_id: str("Nest the new lines under this line, after any lines already under it."),
        lines: LINES,
      },
    },
  },
  {
    name: "add_paragraphs",
    title: "Add paragraphs",
    description: "Adds paragraphs to a chapter of a novel or a script: at the end, or after one of its paragraphs (after_id, from read). In a script, give each paragraph's element. Marked as written by Claude.",
    inputSchema: {
      type: "object",
      required: ["chapter_id", "paragraphs"],
      properties: {
        chapter_id: str("The chapter (from read on the piece, or list_worlds)."),
        after_id: str("Put them after this paragraph. Leave out to add at the end."),
        paragraphs: {
          type: "array",
          items: {
            anyOf: [
              { type: "string" },
              { type: "object", required: ["text"], properties: { text: { type: "string" }, element: { type: "string", enum: ["scene", "action", "character", "paren", "dialogue", "transition"] } } },
            ],
          },
        },
      },
    },
  },
  {
    name: "new_page",
    title: "New page",
    description: "Makes a new page, optionally with lines on it: in a world's bible, inside another page, in a piece, or loose (no parent). Marked as written by Claude.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: str("The page's title."),
        parent_id: str("A world, page or piece to put it in. Leave out for a loose page."),
        lines: LINES,
      },
    },
  },
  {
    name: "new_world",
    title: "New world",
    description: "Makes a new world (a story, a show, a film) in an area, with an Idea page in its bible.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: { title: str("The world's name."), area: str("The area it belongs in, by name (see list_worlds). Defaults to Writing.") },
    },
  },
  {
    name: "new_piece",
    title: "New piece",
    description: "Makes a new piece in a world, or inside another piece (an episode in a season). A script starts with one empty chapter; prose with Act One, Chapter 1; an outline is written as lines (add_lines).",
    inputSchema: {
      type: "object",
      required: ["parent_id", "title", "written_as"],
      properties: {
        parent_id: str("The world, or the piece it goes inside."),
        title: str("Its name, like \"Reel 4: The Dentist\"."),
        written_as: { type: "string", enum: ["script", "prose", "outline"], description: "How it's written." },
        label: str("What it is, in the person's words: Gag, Short, Episode, Season, Film… (see list_worlds for ones already used)."),
        stage: { type: "string", enum: ["Idea", "Written", "Boarded", "Generated", "Edited", "Posted"], description: "Defaults to Idea." },
      },
    },
  },
];

class Bad extends Error {}

// ---------- small helpers, the same rules as the app ----------

/** Time-ordered random ids, the same shape as the app makes (src/model.js). */
export function newId(prefix: string): string {
  const t = Date.now().toString(36).padStart(9, "0");
  const r = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join("");
  return `${prefix}_${t}${r}`;
}
export function tagsIn(text: string): string[] {
  const tags = new Set<string>();
  for (const m of text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)) tags.add(m[1].toLowerCase());
  return [...tags];
}
const FORMAT: Record<string, string> = { novel: "prose", screenplay: "script", lines: "outline", notes: "pages" };
const LABEL: Record<string, string> = { novel: "Novel", screenplay: "Screenplay", lines: "Outline", notes: "Notes" };
const typeOf = (r: Entry) => (r.fields?.type as string) || "novel";
const labelOf = (r: Entry) => (r.fields?.label as string) || LABEL[typeOf(r)] || "Piece";
const bySort = (a: Entry, b: Entry) => (a.sort || 0) - (b.sort || 0) || (a.created_at || "").localeCompare(b.created_at || "") || a.id.localeCompare(b.id);
const who = (r: Entry) => {
  const by = (r.fields?.edited_by || r.fields?.by) as string | undefined;
  return by === CLAUDE ? "Claude" : undefined;
};

function textArg(v: unknown, name: string, max = 20000): string {
  if (typeof v !== "string" || !v.trim()) throw new Bad(`${name} must be some text.`);
  if (v.length > max) throw new Bad(`${name} is too long (over ${max} characters).`);
  return v.trim();
}
function intArg(v: unknown, name: string, lo: number, hi: number, dflt: number): number {
  if (v === undefined || v === null || v === "") return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new Bad(`${name} must be a whole number from ${lo} to ${hi}.`);
  return n;
}

/** Today's date where the person is. */
function today(tz: string | null, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
async function dayArg(v: unknown, db: Db): Promise<string | null> {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s === "today") return today(await db.timeZone());
  if (s === "yesterday" || s === "tomorrow") {
    const d = new Date(today(await db.timeZone()) + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + (s === "yesterday" ? -1 : 1));
    return d.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"))) return s;
  return null;
}

/** One entry, live, or a clear message. */
async function one(db: Db, id: unknown, what = "id"): Promise<Entry> {
  if (typeof id !== "string" || !id) throw new Bad(`${what} is missing.`);
  const [r] = await db.get([id]);
  if (!r || gone(r)) throw new Bad(`Nothing in Inkwell has the id ${JSON.stringify(id)} (or it's in the Trash). Use list_worlds or search to find ids.`);
  return r;
}

// ---------- the shape of the vault ----------

class Shape {
  byId = new Map<string, Entry>();
  kids = new Map<string, Entry[]>();
  constructor(rows: Entry[]) {
    for (const r of rows) if (!gone(r)) this.byId.set(r.id, r);
    for (const r of this.byId.values()) {
      const k = r.parent_id ?? "";
      this.kids.set(k, [...(this.kids.get(k) ?? []), r]);
    }
    for (const k of this.kids.values()) k.sort(bySort);
  }
  under(id: string | null, kind?: string) { return (this.kids.get(id ?? "") ?? []).filter((r) => !kind || r.kind === kind); }
  /** The world something is in. */
  worldOf(r: Entry | undefined): Entry | null {
    for (let x = r, i = 0; x && i < 80; x = x.parent_id ? this.byId.get(x.parent_id) : undefined, i++) if (x.kind === "world") return x;
    return null;
  }
  /** "World › Piece › Page", for saying where something is. */
  where(r: Entry | undefined): string {
    const parts: string[] = [];
    for (let x = r, i = 0; x && i < 80; x = x.parent_id ? this.byId.get(x.parent_id) : undefined, i++) {
      if (["world", "project", "page", "chapter"].includes(x.kind)) parts.unshift(x.title || "Untitled");
      if (x.kind === "day") parts.unshift(`Daily page ${x.title}`);
    }
    return parts.join(" › ");
  }
  areaPath(id: string | null): string {
    const parts: string[] = [];
    for (let a = id ? this.byId.get(id) : undefined, i = 0; a && a.kind === "area" && i < 20; a = a.parent_id ? this.byId.get(a.parent_id) : undefined, i++) parts.unshift(a.title);
    return parts.join(" › ") || "No area";
  }
  chapters(piece: Entry): Entry[] {
    return this.under(piece.id, "act").flatMap((a) => this.under(a.id, "chapter"));
  }
  pageTree(id: string): unknown[] {
    return this.under(id, "page").map((p) => {
      const inside = this.pageTree(p.id);
      return { id: p.id, title: p.title || "Untitled page", ...(inside.length ? { pages: inside } : {}) };
    });
  }
  pieceTree(id: string): unknown[] {
    return this.under(id, "project").map((p) => {
      const inside = this.pieceTree(p.id);
      const pages = this.pageTree(p.id);
      const chapters = this.chapters(p).map((c) => ({ id: c.id, title: c.title, words: c.fields?.words ?? 0 }));
      return {
        id: p.id, title: p.title || "Untitled", label: labelOf(p), written_as: FORMAT[typeOf(p)] ?? "prose", stage: (p.fields?.stage as string) || "Idea",
        ...(p.fields?.numbered ? { scenes_numbered: true } : {}),
        ...(chapters.length ? { chapters } : {}), ...(pages.length ? { pages } : {}), ...(inside.length ? { pieces: inside } : {}),
      };
    });
  }
}

// ---------- reading ----------

type Line = { id: string; text: string; by?: string; done?: boolean; lines?: Line[] };

async function linesUnder(db: Db, rootId: string): Promise<Line[]> {
  const out: Line[] = [];
  const byParent = new Map<string, Line[]>([[rootId, out]]);
  let level = [rootId];
  for (let depth = 0; level.length && depth < 40; depth++) {
    const rows = (await db.kids(level)).filter((r) => r.kind === "line" && !gone(r)).sort(bySort);
    const next: string[] = [];
    for (const r of rows) {
      const line: Line = { id: r.id, text: r.text || "", ...(who(r) ? { by: who(r) } : {}), ...(r.fields?.done ? { done: true } : {}) };
      const list = byParent.get(r.parent_id!)!;
      list.push(line);
      line.lines = [];
      byParent.set(r.id, line.lines);
      next.push(r.id);
    }
    level = next;
  }
  const prune = (ls: Line[]) => { for (const l of ls) { if (l.lines?.length) prune(l.lines); else delete l.lines; } };
  prune(out);
  return out;
}

const PART = 400;
async function paragraphs(db: Db, chapter: Entry, from = 0) {
  const rows = (await db.kids([chapter.id])).filter((r) => ["para", "heading", "scene"].includes(r.kind) && !gone(r)).sort(bySort);
  const part = rows.slice(from, from + PART).map((r) => {
    // A script's sections nest (1 act, 2 sequence, 3 scene…) and can carry a summary.
    if (r.kind === "scene") return { id: r.id, section: r.title || "", ...(Number(r.fields?.level) > 1 ? { level: Number(r.fields.level) } : {}), ...(r.fields?.synopsis ? { summary: String(r.fields.synopsis) } : {}) };
    const el = r.fields?.el as string | undefined;
    return {
      id: r.id, text: r.text || "",
      ...(el ? { element: el } : {}), ...(r.fields?.code && el === "scene" ? { scene_number: r.fields.code } : {}),
      ...(r.kind === "heading" ? { heading: true } : {}), ...(who(r) ? { by: who(r) } : {}),
    };
  });
  return { paragraphs: part, total: rows.length, ...(from + PART < rows.length ? { next_from: from + PART } : {}) };
}

async function read(args: Record<string, unknown>, db: Db) {
  const date = await dayArg(args.id, db);
  if (date) {
    const id = `day-${date}`;
    const [day] = await db.get([id]);
    return { daily_page: date, id, lines: day && !gone(day) ? await linesUnder(db, id) : [] };
  }
  const r = await one(db, args.id);
  const shape = new Shape(await db.outline());
  const from = intArg(args.from, "from", 0, 10_000_000, 0);
  if (r.kind === "world") {
    return {
      world: r.title, id: r.id, area: shape.areaPath(r.area_id),
      bible: shape.pageTree(r.id), pieces: shape.pieceTree(r.id),
    };
  }
  if (r.kind === "page" || r.kind === "day") {
    const inside = shape.pageTree(r.id);
    return { page: r.title, id: r.id, where: shape.where(r), lines: await linesUnder(db, r.id), ...(inside.length ? { pages_inside: inside } : {}) };
  }
  if (r.kind === "chapter") {
    const piece = shape.byId.get(shape.byId.get(r.parent_id ?? "")?.parent_id ?? "");
    return { chapter: r.title, id: r.id, piece: piece?.title, written_as: piece ? FORMAT[typeOf(piece)] : undefined, ...(await paragraphs(db, r, from)) };
  }
  if (r.kind === "project") {
    const out: Record<string, unknown> = {
      piece: r.title, id: r.id, label: labelOf(r), written_as: FORMAT[typeOf(r)] ?? "prose", stage: (r.fields?.stage as string) || "Idea",
      world: shape.worldOf(r)?.title,
    };
    if (typeOf(r) === "lines") out.lines = await linesUnder(db, r.id);
    // The manuscript in full, chapter by chapter, a part at a time.
    const chapters = shape.chapters(r);
    let skip = from;
    const parts = [];
    let next: number | undefined;
    let room = PART;
    for (const ch of chapters) {
      if (room <= 0) { next = from + PART; break; }
      const all = (await db.kids([ch.id])).filter((x) => ["para", "heading", "scene"].includes(x.kind) && !gone(x)).length;
      if (skip >= all) { skip -= all; continue; }
      const got = await paragraphs(db, ch, skip);
      const take = got.paragraphs.slice(0, room);
      parts.push({ chapter: ch.title, id: ch.id, paragraphs: take });
      room -= take.length;
      if (take.length < got.paragraphs.length || got.next_from !== undefined) { next = from + PART; break; }
      skip = 0;
    }
    if (chapters.length) out.chapters = parts;
    if (next !== undefined) out.next_from = next;
    const pages = shape.pageTree(r.id);
    if (pages.length) out.pages = pages;
    const inside = shape.pieceTree(r.id);
    if (inside.length) out.pieces = inside;
    return out;
  }
  if (r.kind === "line" || r.kind === "para") return { id: r.id, text: r.text, where: shape.where(r), ...(who(r) ? { by: who(r) } : {}) };
  throw new Bad(`That id is a ${r.kind}, which read doesn't open. Give a world, piece, chapter or page.`);
}

async function listWorlds(db: Db) {
  const shape = new Shape(await db.outline());
  const areas = [...shape.byId.values()].filter((r) => r.kind === "area").sort(bySort);
  const worlds = [...shape.byId.values()].filter((r) => r.kind === "world").sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  const labels = new Set<string>();
  for (const r of shape.byId.values()) if (r.kind === "project") labels.add(labelOf(r));
  return {
    areas: areas.map((a) => shape.areaPath(a.id)),
    worlds: worlds.map((w) => ({ id: w.id, title: w.title || "Untitled", area: shape.areaPath(w.area_id), pieces: shape.pieceTree(w.id), bible: shape.pageTree(w.id) })),
    loose_pages: shape.under(null, "page").map((p) => ({ id: p.id, title: p.title || "Untitled page" })),
    labels_in_use: [...labels].sort(),
  };
}

async function search(args: Record<string, unknown>, db: Db) {
  const q = textArg(args.query, "query", 200);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const limit = intArg(args.limit, "limit", 1, 50, 20);
  const hits = (await db.search(words, limit)).filter((r) => !gone(r));
  const shape = new Shape(await db.outline());
  // Lines and paragraphs say which page or chapter they're on.
  const homes = new Map<string, Entry>();
  let need = hits.filter((h) => !shape.byId.has(h.id)).map((h) => h.parent_id).filter((x): x is string => !!x);
  for (let i = 0; need.length && i < 30; i++) {
    const got = await db.get([...new Set(need)].filter((x) => !homes.has(x) && !shape.byId.has(x)));
    for (const g of got) homes.set(g.id, g);
    need = got.filter((g) => !shape.byId.has(g.id)).map((g) => g.parent_id).filter((x): x is string => !!x && !homes.has(x) && !shape.byId.has(x));
  }
  const whereOf = (r: Entry): string => {
    let x: Entry | undefined = r;
    for (let i = 0; x && !shape.byId.has(x.id) && i < 40; i++) x = x.parent_id ? homes.get(x.parent_id) ?? shape.byId.get(x.parent_id) : undefined;
    if (x?.kind === "day") return `Daily page ${x.title}`;
    return shape.where(x);
  };
  return {
    results: hits.map((r) => ({
      id: r.id, kind: { line: "line", para: "paragraph", note: "note", page: "page", world: "world", project: "piece", chapter: "chapter" }[r.kind] ?? r.kind,
      text: (r.kind === "page" || r.kind === "world" || r.kind === "project" || r.kind === "chapter" ? r.title : r.text).slice(0, 400),
      where: whereOf(r), ...(who(r) ? { by: who(r) } : {}),
    })),
  };
}

// ---------- writing ----------

function row(kind: string, fields: Partial<Entry>): Entry {
  return {
    id: fields.id ?? newId(kind.slice(0, 2)),
    kind, parent_id: null, sort: 0, title: "", text: "", content: null, tags: [], type: null,
    area_id: null, links: [], deleted: false, ...fields,
    fields: { by: CLAUDE, edited_by: CLAUDE, ...(fields.fields ?? {}) },
  };
}

/** Text to the app's inline content, with [[Title]] made into links where the title names one page, world or piece. */
function inline(text: string, shape: Shape): { content: unknown; links: string[]; text: string } {
  const named = new Map<string, Entry[]>();
  for (const r of shape.byId.values()) if (["page", "world", "project", "chapter"].includes(r.kind) && r.title) {
    const k = r.title.trim().toLowerCase();
    named.set(k, [...(named.get(k) ?? []), r]);
  }
  const content: unknown[] = [];
  const links: string[] = [];
  let plain = "";
  let at = 0;
  for (const m of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const hit = named.get(m[1].trim().toLowerCase());
    if (!hit || hit.length !== 1) continue;
    if (m.index! > at) { content.push({ type: "text", text: text.slice(at, m.index) }); plain += text.slice(at, m.index); }
    content.push({ type: "entryRef", attrs: { id: hit[0].id, title: hit[0].title } });
    plain += hit[0].title;
    links.push(hit[0].id);
    at = m.index! + m[0].length;
  }
  if (at < text.length) { content.push({ type: "text", text: text.slice(at) }); plain += text.slice(at); }
  return { content: content.length ? content : null, links: [...new Set(links)], text: plain };
}

type LineIn = string | { text: string; children?: LineIn[]; lines?: LineIn[] };
function lineRows(lines: unknown, parentId: string, startSort: number, shape: Shape, depth = 0): Entry[] {
  if (!Array.isArray(lines) || !lines.length) throw new Bad("lines must be a list with at least one line.");
  if (depth > 12) throw new Bad("lines are nested too deep (12 levels at most).");
  const out: Entry[] = [];
  lines.forEach((l: LineIn, i) => {
    const text = textArg(typeof l === "string" ? l : l?.text, "Each line", 5000);
    const { content, links, text: plain } = inline(text, shape);
    const r = row("line", { id: newId("li"), parent_id: parentId, sort: startSort + (i + 1) * GAP, text: plain, content, links, tags: tagsIn(plain), fields: { done: false } });
    out.push(r);
    // Lines inside a line come as children (or lines, the name read uses).
    const inside = typeof l === "object" ? l.children ?? l.lines : null;
    if (Array.isArray(inside) && inside.length) out.push(...lineRows(inside, r.id, 0, shape, depth + 1));
  });
  return out;
}

async function addLines(args: Record<string, unknown>, db: Db) {
  const shape = new Shape(await db.outline());
  const date = await dayArg(args.to, db);
  const rows: Entry[] = [];
  let target: Entry;
  let name: string;
  if (date) {
    const id = `day-${date}`;
    const [day] = await db.get([id]);
    // A day is only saved once something is written on it.
    target = day && !day.deleted ? day : row("day", { id, title: date, fields: {} });
    if (!day || day.deleted) rows.push({ ...target, fields: {} });
    name = `the daily page for ${date}`;
  } else {
    target = await one(db, args.to, "to");
    if (!(target.kind === "page" || target.kind === "day" || (target.kind === "project" && typeOf(target) === "lines"))) {
      throw new Bad(`${JSON.stringify(target.title)} is a ${target.kind === "project" ? `${FORMAT[typeOf(target)]} piece` : target.kind}; lines go on a page, a daily page or an outline piece. For a chapter use add_paragraphs.`);
    }
    name = shape.where(target) || target.title;
  }
  let parentId = target.id;
  if (args.under_line_id !== undefined && args.under_line_id !== null && args.under_line_id !== "") {
    const under = await one(db, args.under_line_id, "under_line_id");
    if (under.kind !== "line") throw new Bad("under_line_id must be a line (ids come from read).");
    // It has to be on the page we're adding to.
    let x: Entry | undefined = under;
    for (let i = 0; x && x.id !== target.id && i < 40; i++) x = x.parent_id ? (await db.get([x.parent_id]))[0] : undefined;
    if (!x) throw new Bad("That line isn't on this page.");
    parentId = under.id;
  }
  const siblings = (await db.kids([parentId])).filter((r) => r.kind === "line" && !r.deleted);
  const last = siblings.reduce((m, r) => Math.max(m, r.sort || 0), 0);
  const made = lineRows(args.lines, parentId, last, shape);
  rows.push(...made);
  await db.insert(rows);
  return { added: made.length, to: name, ids: made.filter((r) => r.parent_id === parentId).map((r) => r.id) };
}

async function addParagraphs(args: Record<string, unknown>, db: Db) {
  const ch = await one(db, args.chapter_id, "chapter_id");
  if (ch.kind !== "chapter") throw new Bad("chapter_id must be a chapter (see read on the piece).");
  const shape = new Shape(await db.outline());
  const piece = shape.byId.get(shape.byId.get(ch.parent_id ?? "")?.parent_id ?? "");
  const script = piece && typeOf(piece) === "screenplay";
  const list = args.paragraphs;
  if (!Array.isArray(list) || !list.length) throw new Bad("paragraphs must be a list with at least one paragraph.");
  if (list.length > 400) throw new Bad("Up to 400 paragraphs at a time.");
  const rows = (await db.kids([ch.id])).filter((r) => ["para", "heading", "scene"].includes(r.kind) && !r.deleted).sort(bySort);
  let lo: number;
  let hi: number;
  if (args.after_id) {
    const i = rows.findIndex((r) => r.id === args.after_id);
    if (i < 0) throw new Bad("after_id isn't a paragraph in this chapter (ids come from read).");
    lo = rows[i].sort || 0;
    hi = rows[i + 1] ? rows[i + 1].sort || 0 : lo + (list.length + 1) * GAP;
  } else {
    lo = rows.length ? rows[rows.length - 1].sort || 0 : 0;
    hi = lo + (list.length + 1) * GAP;
  }
  const step = (hi - lo) / (list.length + 1);
  if (!(step > 0)) throw new Bad("There's no room after that paragraph just now. Add at the end instead, or ask the person to open the chapter once.");
  const made = list.map((p: unknown, i: number) => {
    const o = typeof p === "string" ? { text: p } : (p as { text?: unknown; element?: unknown });
    const text = textArg(o?.text, "Each paragraph", 20000);
    const el = typeof o?.element === "string" ? o.element : script ? "action" : null;
    if (el && !["scene", "action", "character", "paren", "dialogue", "transition"].includes(el)) throw new Bad(`${JSON.stringify(el)} isn't a script element.`);
    const { content, links, text: plain } = inline(text, shape);
    return row("para", {
      id: newId("pa"), parent_id: ch.id, sort: lo + step * (i + 1), text: plain, content, links, tags: tagsIn(plain),
      fields: script && el ? { el } : {},
    });
  });
  await db.insert(made);
  return { added: made.length, to: `${piece?.title ?? ""} › ${ch.title}`, ids: made.map((r) => r.id) };
}

async function newPage(args: Record<string, unknown>, db: Db) {
  const title = textArg(args.title, "title", 300);
  let parent: Entry | null = null;
  if (args.parent_id) {
    parent = await one(db, args.parent_id, "parent_id");
    if (!["world", "page", "project"].includes(parent.kind)) throw new Bad("parent_id must be a world, a page or a piece.");
  }
  const siblings = parent ? (await db.kids([parent.id])).filter((r) => r.kind === "page" && !r.deleted) : [];
  const page = row("page", { id: newId("pg"), parent_id: parent?.id ?? null, title, sort: siblings.reduce((m, r) => Math.max(m, r.sort || 0), 0) + 1 });
  const shape = new Shape([...(await db.outline()), page]);
  const lines = args.lines === undefined ? [] : lineRows(args.lines, page.id, 0, shape);
  await db.insert([page, ...lines]);
  return { page: title, id: page.id, where: parent ? shape.where(page) : "Loose pages", lines: lines.length };
}

async function newWorld(args: Record<string, unknown>, db: Db) {
  const title = textArg(args.title, "title", 300);
  const shape = new Shape(await db.outline());
  const areas = [...shape.byId.values()].filter((r) => r.kind === "area");
  let area = areas.find((a) => a.id === "area-writing") ?? null;
  if (args.area) {
    const want = String(args.area).trim().toLowerCase();
    area = areas.find((a) => a.title.toLowerCase() === want) ?? null;
    if (!area) throw new Bad(`No area called ${JSON.stringify(args.area)}. Areas: ${areas.map((a) => a.title).join(", ")}.`);
  }
  const world = row("world", { id: newId("wd"), title, area_id: area?.id ?? "area-writing" });
  const idea = row("page", { id: newId("pg"), parent_id: world.id, title: "Idea", sort: 1 });
  await db.insert([world, idea]);
  return { world: title, id: world.id, area: area?.title ?? "Writing", idea_page_id: idea.id };
}

async function newPiece(args: Record<string, unknown>, db: Db) {
  const parent = await one(db, args.parent_id, "parent_id");
  if (!["world", "project"].includes(parent.kind)) throw new Bad("parent_id must be a world, or a piece to put this one inside.");
  const title = textArg(args.title, "title", 300);
  const type = { script: "screenplay", prose: "novel", outline: "lines" }[String(args.written_as)] as string | undefined;
  if (!type) throw new Bad("written_as must be script, prose or outline.");
  const shape = new Shape(await db.outline());
  const world = parent.kind === "world" ? parent : shape.worldOf(parent);
  const siblings = shape.under(parent.id, "project");
  const levels = type === "novel" ? ["Act", "Chapter", "Scene"] : type === "screenplay" ? ["Act", "Script", "Scene"] : null;
  const fields: Record<string, unknown> = { type, ...(levels ? { levels } : {}) };
  if (typeof args.label === "string" && args.label.trim() && args.label.trim() !== LABEL[type]) fields.label = args.label.trim().slice(0, 60);
  if (typeof args.stage === "string" && args.stage) fields.stage = args.stage;
  const piece = row("project", { id: newId("pr"), parent_id: parent.id, title, area_id: world?.area_id ?? null, sort: (siblings.at(-1)?.sort ?? 0) + 1, fields });
  const rows = [piece];
  let chapter: Entry | null = null;
  if (type === "novel" || type === "screenplay") {
    const act = row("act", { id: newId("ac"), parent_id: piece.id, title: type === "screenplay" ? "Screenplay" : "Act One", sort: 1 });
    chapter = row("chapter", { id: newId("ch"), parent_id: act.id, title: type === "screenplay" ? "Script" : "Chapter 1", sort: 1 });
    rows.push(act, chapter);
  }
  await db.insert(rows);
  return { piece: title, id: piece.id, in: parent.title, written_as: args.written_as, ...(chapter ? { chapter_id: chapter.id } : {}) };
}

async function runTool(name: string, args: Record<string, unknown>, db: Db): Promise<unknown> {
  switch (name) {
    case "list_worlds": return listWorlds(db);
    case "read": return read(args, db);
    case "search": return search(args, db);
    case "add_lines": return addLines(args, db);
    case "add_paragraphs": return addParagraphs(args, db);
    case "new_page": return newPage(args, db);
    case "new_world": return newWorld(args, db);
    case "new_piece": return newPiece(args, db);
  }
  throw new Bad(`There's no tool called ${name}.`);
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export async function handle(msg: Rpc, db: Db): Promise<unknown | null> {
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") {
    return msg && "id" in msg ? { jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32600, message: "Invalid request" } } : null;
  }
  if (msg.id === undefined) return null; // a notification, such as notifications/initialized
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const p = msg.params ?? {};
  switch (msg.method) {
    case "initialize": {
      const want = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
      return ok({
        protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "inkwell", title: "Inkwell", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = String(p.name ?? "");
      const args = (p.arguments && typeof p.arguments === "object" ? p.arguments : {}) as Record<string, unknown>;
      try {
        const out = await runTool(name, args, db);
        return ok({ content: [{ type: "text", text: JSON.stringify(out) }] });
      } catch (e) {
        if (e instanceof Bad) return ok({ content: [{ type: "text", text: e.message }], isError: true });
        console.error(e);
        return ok({ content: [{ type: "text", text: "Inkwell couldn't do that just now. Try again in a moment." }], isError: true });
      }
    }
  }
  return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } };
}
