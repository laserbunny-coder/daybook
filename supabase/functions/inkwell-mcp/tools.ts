// What Claude can do in Inkwell (the writing app) through its connector, and
// the small part of the MCP protocol needed to offer it. Kept free of Deno and
// Supabase imports so it can be tested on its own; index.ts supplies the
// database.
//
// Claude reads anything and adds to it: lines on a page or a daily page,
// paragraphs at the end of (or after a paragraph in) a chapter, new pages,
// worlds and pieces. Everything it writes is marked as Claude's
// (fields.by = "claude"). It never changes or deletes what's already there,
// with one exception: its own one-line summaries ("about" entries), which it
// keeps up to date. The person rarely looks at those; they're Claude's map.
//
// Finding things, as the vault grows ("memory as a map"): map gives a short
// overview to start from (areas, worlds, pages, daily pages, tags, weekly and
// monthly summaries, each with a one-line about and counts), then search,
// tags and links narrow it down, and read opens one thing in full.

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

export type Find = {
  query: string | null; kinds: string[] | null; tag: string | null; under: string | null;
  since: string | null; until: string | null; newest: boolean; limit: number;
};

export type Db = {
  /** Areas, worlds, pieces, pages, acts and chapters: everything that gives the vault its shape (no words). */
  outline(): Promise<Entry[]>;
  /** Entries by id (missing ones left out). */
  get(ids: string[]): Promise<Entry[]>;
  /** Everything directly inside these entries. */
  kids(parentIds: string[]): Promise<Entry[]>;
  /** Search with filters (the inkwell_search database function), best match first unless newest. */
  find(o: Find): Promise<(Entry & { rank?: number })[]>;
  /** Tags in use with how many entries carry them, optionally only inside one thing. */
  tags(under: string | null): Promise<{ tag: string; n: number; last: string }[]>;
  /** For each world, top-level page and daily page: how many entries, last touched, top tags. */
  rollup(): Promise<{ home: string; n: number; last: string; top_tags: string[] }[]>;
  /** Live entries whose links name one of these ids, newest first. */
  linkedFrom(ids: string[], limit: number): Promise<Entry[]>;
  /** Entries of these kinds (about, digest), newest first. */
  byKind(kinds: string[], limit: number): Promise<Entry[]>;
  /** Changes one of Claude's own summaries (kind about). Never touches anything else. */
  updateAbout(id: string, patch: Pick<Entry, "text" | "fields" | "deleted">): Promise<void>;
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
- Inkwell is also the person's second brain: captures, voice notes, links, ideas and research pile up over years. To find things, start with map (a short overview: every world and page with a one-line about, the daily pages, the tags in use, and weekly and monthly summaries of what was written). Then narrow down with search (by words, tag, place, date), tags and links, and open things with read. Don't read everything; follow the map. list_worlds gives the full tree when you need every id.
- Weekly and monthly summaries (in map, opened with read) are the quickest way into what the person was thinking about at a time; each points back to the lines it came from.
- One-line abouts are your own notes on what a world, piece, page or chapter is, so that the map says more than a title. The person doesn't need to see them and won't be shown them unless they look. When you've read something whose about is missing (map lists some under needs_about) or no longer fits, write one with set_about: one plain, factual line on what it is and holds, in under 25 words, not an opinion. Don't mention abouts in your reply unless asked.
- Read before you add, so what you add fits.
- What you add is marked as written by Claude and the person sees it on all their devices. You can't change or delete what's there (only your own abouts); if something should change, say so and they'll do it. Keep to the person's voice and don't add more than they asked for.
- Say what you added and where, in plain words, since the person sees your reply, not the tool calls.`;

const str = (description: string) => ({ type: "string", description });
const LINES = {
  type: "array",
  description: "The lines, in order. A line is text, or { \"text\": \"…\", \"children\": [lines nested under it] }. #tags and [[Page title]] links work as in the app.",
  items: { anyOf: [{ type: "string" }, { type: "object", required: ["text"], properties: { text: { type: "string" }, children: { type: "array" } } }] },
};

export const TOOLS = [
  {
    name: "map",
    title: "Map of Inkwell",
    description: "Start here. A short overview of everything in Inkwell: areas and their worlds, loose pages, daily pages, each with a one-line about, how much is in it and when it was last touched; the tags in use; and the latest weekly and monthly summaries of what was written. Use it to decide where to look, then search, tags, links or read.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
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
    description: "Reads one thing by id: a weekly or monthly summary (ids from map), a world (its bible pages and pieces), a piece (its chapters in full, or its outline), a chapter (its paragraphs, with ids, script elements and scene numbers), or a page (its lines, nested, with ids). Give a date (YYYY-MM-DD) or \"today\" for that day's daily page. Long manuscripts come back in parts: pass from to carry on.",
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
    description: "Finds what was written: lines, paragraphs, notes, page and piece titles, the word-for-word originals of voice recordings, the summaries of shared links, day reviews, shot prompts, and the weekly summaries. Best match first (words match in any form: \"drafts\" finds \"draft\"; \"quotes\" keep a phrase together; -word leaves it out), with where each one is and when it was written. Leave out query to list everything that matches the filters, such as everything tagged #gift, or everything written last week in one world.",
    inputSchema: {
      type: "object",
      properties: {
        query: str("Words to find. Optional when a filter is given."),
        tag: str("Only things carrying this tag (with or without #)."),
        in: str("Only things inside this world, piece, page or chapter (its id)."),
        kinds: { type: "array", items: { type: "string", enum: ["lines", "paragraphs", "notes", "pages", "pieces", "worlds", "chapters", "reviews", "shots", "summaries"] }, description: "Only these kinds of thing. Leave out for all." },
        since: str("Only things written on or after this date (YYYY-MM-DD, or today / yesterday)."),
        until: str("Only things written on or before this date (YYYY-MM-DD, or today / yesterday)."),
        newest: { type: ["boolean", "string"], description: "Newest first instead of best match first." },
        limit: { type: ["integer", "string"], description: "How many, 1 to 50. Defaults to 20." },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "tags",
    title: "Tags",
    description: "Every tag in use, with how many things carry it and when it was last used, most used first. Give in to see only the tags inside one world, piece or page. To see what carries a tag, use search with tag.",
    inputSchema: { type: "object", properties: { in: str("A world, piece or page id. Leave out for all of Inkwell.") } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "links",
    title: "Links",
    description: "Follows [[links]] from one thing: what it links to (for a page, chapter or world, the links in everything inside it) and everything that links to it, with where each is.",
    inputSchema: { type: "object", required: ["id"], properties: { id: str("A world, piece, page, chapter, line or paragraph id.") } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "set_about",
    title: "Set about",
    description: "Writes or updates your one-line about for a world, piece, page or chapter: what it is and holds, plainly, in under 25 words. It's a note for finding things later, shown in map and read; the person rarely sees it. It never changes anything the person wrote.",
    inputSchema: {
      type: "object",
      required: ["id", "about"],
      properties: { id: str("The world, piece, page or chapter."), about: str("One line: what it is and what's in it.") },
    },
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
  /** One-line abouts by the id of what they describe (set by those who load them). */
  about = new Map<string, string>();
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
      return { id: p.id, title: p.title || "Untitled page", ...(this.about.has(p.id) ? { about: this.about.get(p.id) } : {}), ...(inside.length ? { pages: inside } : {}) };
    });
  }
  pieceTree(id: string): unknown[] {
    return this.under(id, "project").map((p) => {
      const inside = this.pieceTree(p.id);
      const pages = this.pageTree(p.id);
      const chapters = this.chapters(p).map((c) => ({ id: c.id, title: c.title, words: c.fields?.words ?? 0 }));
      return {
        id: p.id, title: p.title || "Untitled", ...(this.about.has(p.id) ? { about: this.about.get(p.id) } : {}), label: labelOf(p), written_as: FORMAT[typeOf(p)] ?? "prose", stage: (p.fields?.stage as string) || "Idea",
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
  if (r.kind === "digest") return readDigest(r);
  const shape = await shapeWithAbouts(db);
  const about = shape.about.has(r.id) ? { about: shape.about.get(r.id) } : {};
  const from = intArg(args.from, "from", 0, 10_000_000, 0);
  if (r.kind === "world") {
    return {
      world: r.title, id: r.id, ...about, area: shape.areaPath(r.area_id),
      bible: shape.pageTree(r.id), pieces: shape.pieceTree(r.id),
    };
  }
  if (r.kind === "page" || r.kind === "day") {
    const inside = shape.pageTree(r.id);
    return { page: r.title, id: r.id, ...about, where: shape.where(r), lines: await linesUnder(db, r.id), ...(inside.length ? { pages_inside: inside } : {}) };
  }
  if (r.kind === "chapter") {
    const piece = shape.byId.get(shape.byId.get(r.parent_id ?? "")?.parent_id ?? "");
    return { chapter: r.title, id: r.id, ...about, piece: piece?.title, written_as: piece ? FORMAT[typeOf(piece)] : undefined, ...(await paragraphs(db, r, from)) };
  }
  if (r.kind === "project") {
    const out: Record<string, unknown> = {
      piece: r.title, id: r.id, ...about, label: labelOf(r), written_as: FORMAT[typeOf(r)] ?? "prose", stage: (r.fields?.stage as string) || "Idea",
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
  const shape = await shapeWithAbouts(db);
  const areas = [...shape.byId.values()].filter((r) => r.kind === "area").sort(bySort);
  const worlds = [...shape.byId.values()].filter((r) => r.kind === "world").sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  const labels = new Set<string>();
  for (const r of shape.byId.values()) if (r.kind === "project") labels.add(labelOf(r));
  return {
    areas: areas.map((a) => shape.areaPath(a.id)),
    worlds: worlds.map((w) => ({ id: w.id, title: w.title || "Untitled", ...(shape.about.has(w.id) ? { about: shape.about.get(w.id) } : {}), area: shape.areaPath(w.area_id), pieces: shape.pieceTree(w.id), bible: shape.pageTree(w.id) })),
    loose_pages: shape.under(null, "page").map((p) => ({ id: p.id, title: p.title || "Untitled page", ...(shape.about.has(p.id) ? { about: shape.about.get(p.id) } : {}) })),
    labels_in_use: [...labels].sort(),
  };
}

// ---------- finding things ----------

/** Live abouts, by the id of what they describe. */
function aboutMap(rows: Entry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) if (r.kind === "about" && !gone(r) && !r.fields?.off && r.parent_id && (r.text || "").trim()) m.set(r.parent_id, r.text.trim());
  return m;
}
async function aboutOf(db: Db, id: string): Promise<string | undefined> {
  return aboutMap(await db.get([`ab-${id}`])).get(id);
}
async function shapeWithAbouts(db: Db): Promise<Shape> {
  const [rows, abouts] = await Promise.all([db.outline(), db.byKind(["about"], 5000)]);
  const shape = new Shape(rows);
  shape.about = aboutMap(abouts);
  return shape;
}

/** The person's local date for a moment. */
function localDate(iso: string | undefined, tz: string | null): string | undefined {
  if (!iso) return undefined;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
/** The moment a local date starts, where the person is. */
export function dayStart(date: string, tz: string | null): string {
  const guess = Date.parse(date + "T00:00:00Z");
  let offset = 0;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: tz || "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
    const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    offset = wall - guess;
  } catch { /* UTC */ }
  return new Date(guess - offset).toISOString();
}
const nextDay = (date: string) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Says where each of these rows lives: "World › Piece › Page", "Daily page 2026-10-27". */
async function placer(db: Db, shape: Shape, rows: Entry[]): Promise<(r: Entry) => string> {
  const homes = new Map<string, Entry>();
  let need = rows.filter((h) => !shape.byId.has(h.id)).map((h) => h.parent_id).filter((x): x is string => !!x && !shape.byId.has(x));
  for (let i = 0; need.length && i < 30; i++) {
    const got = await db.get([...new Set(need)].filter((x) => !homes.has(x) && !shape.byId.has(x)));
    for (const g of got) homes.set(g.id, g);
    need = got.filter((g) => !shape.byId.has(g.id)).map((g) => g.parent_id).filter((x): x is string => !!x && !homes.has(x) && !shape.byId.has(x));
  }
  return (r: Entry): string => {
    let x: Entry | undefined = r;
    for (let i = 0; x && !shape.byId.has(x.id) && x.kind !== "day" && i < 40; i++) x = x.parent_id ? homes.get(x.parent_id) ?? shape.byId.get(x.parent_id) : undefined;
    if (x?.kind === "day") return `Daily page ${x.title || x.id.slice(4)}`;
    return shape.where(x);
  };
}

const KIND_NAME: Record<string, string> = {
  line: "line", para: "paragraph", heading: "heading", scene: "script section", note: "note", page: "page", world: "world", project: "piece",
  chapter: "chapter", review: "day review", shot: "shot", about: "about", digest: "summary",
};
const KINDS_IN: Record<string, string[]> = {
  lines: ["line"], paragraphs: ["para", "heading", "scene"], notes: ["note"], pages: ["page"], pieces: ["project"], worlds: ["world"],
  chapters: ["chapter"], reviews: ["review"], shots: ["shot"], summaries: ["about", "digest"],
};
const NAMED_KINDS = ["page", "world", "project", "chapter"];

/** One found thing, the way every finding tool shows it. */
function shown(r: Entry, where: string, tz: string | null, shape: Shape) {
  if (r.kind === "about") {
    const of = r.parent_id ? shape.byId.get(r.parent_id) : undefined;
    return { id: r.parent_id, kind: "about", text: (r.text || "").slice(0, 400), of: of?.title, where: of ? shape.where(of) : where };
  }
  if (r.kind === "digest") return { id: r.id, kind: "summary", text: `${r.title}: ${(r.text || "").slice(0, 600)}` };
  const voice = r.fields?.voice as { raw?: string } | undefined;
  const snap = r.fields?.snapshot as { title?: string; summary?: string } | undefined;
  return {
    id: r.id, kind: KIND_NAME[r.kind] ?? r.kind,
    text: (NAMED_KINDS.includes(r.kind) ? r.title : r.text || r.title || "").slice(0, 400),
    where, ...(r.created_at ? { written: localDate(r.created_at, tz) } : {}),
    ...(r.tags?.length ? { tags: r.tags.map((t) => `#${t}`) } : {}),
    ...(who(r) ? { by: who(r) } : {}),
    ...(voice?.raw && voice.raw.trim() !== (r.text || "").trim() ? { said_word_for_word: voice.raw.slice(0, 400) } : {}),
    ...(snap?.title || snap?.summary ? { link: { title: snap.title, summary: snap.summary?.slice(0, 300), url: r.fields?.url } } : {}),
  };
}

async function search(args: Record<string, unknown>, db: Db) {
  const query = typeof args.query === "string" && args.query.trim() ? textArg(args.query, "query", 300) : null;
  const tag = typeof args.tag === "string" && args.tag.trim() ? args.tag.trim().replace(/^#/, "").toLowerCase() : null;
  let under: string | null = null;
  if (typeof args.in === "string" && args.in.trim()) under = (await one(db, args.in.trim(), "in")).id;
  let kinds: string[] | null = null;
  if (args.kinds !== undefined && args.kinds !== null && args.kinds !== "") {
    const list = Array.isArray(args.kinds) ? args.kinds : String(args.kinds).split(/[,\s]+/);
    kinds = [];
    for (const k of list.map((x) => String(x).trim().toLowerCase()).filter(Boolean)) {
      if (!KINDS_IN[k]) throw new Bad(`${JSON.stringify(k)} isn't a kind. Kinds: ${Object.keys(KINDS_IN).join(", ")}.`);
      kinds.push(...KINDS_IN[k]);
    }
    if (!kinds.length) kinds = null;
  }
  const tz = await db.timeZone();
  const sinceDay = args.since ? await dayArg(args.since, db) : null;
  const untilDay = args.until ? await dayArg(args.until, db) : null;
  if (args.since && !sinceDay) throw new Bad("since must be a date, YYYY-MM-DD (or today, yesterday).");
  if (args.until && !untilDay) throw new Bad("until must be a date, YYYY-MM-DD (or today, yesterday).");
  if (!query && !tag && !under && !kinds && !sinceDay && !untilDay) throw new Bad("Give some words to find, or a filter (tag, in, kinds, since, until).");
  const newest = args.newest === true || args.newest === "true";
  const limit = intArg(args.limit, "limit", 1, 50, 20);
  const hits = await db.find({
    query, kinds, tag, under, newest, limit,
    since: sinceDay ? dayStart(sinceDay, tz) : null,
    until: untilDay ? dayStart(nextDay(untilDay), tz) : null,
  });
  const shape = await shapeWithAbouts(db);
  const where = await placer(db, shape, hits);
  return {
    results: hits.map((r) => shown(r, where(r), tz, shape)),
    ...(hits.length === limit ? { more: "There may be more: narrow it down or raise limit." } : {}),
  };
}

async function tags(args: Record<string, unknown>, db: Db) {
  let under: Entry | null = null;
  if (typeof args.in === "string" && args.in.trim()) under = await one(db, args.in.trim(), "in");
  const list = await db.tags(under?.id ?? null);
  const tz = await db.timeZone();
  return {
    ...(under ? { in: under.title || under.id } : {}),
    tags: list.map((t) => ({ tag: `#${t.tag}`, count: t.n, last_used: localDate(t.last, tz) })),
  };
}

async function links(args: Record<string, unknown>, db: Db) {
  const r = await one(db, args.id);
  const shape = await shapeWithAbouts(db);
  const container = ["world", "project", "page", "chapter", "day", "act"].includes(r.kind);
  const inside = container
    ? await db.find({ query: null, kinds: null, tag: null, under: r.id, since: null, until: null, newest: true, limit: 100 })
    : [];
  const out = [...new Set([...(r.links ?? []), ...inside.flatMap((x) => (x.links ?? []) as string[])])].filter((x) => x && x !== r.id);
  const targets = (await db.get(out.slice(0, 200))).filter((t) => !gone(t));
  const from = (await db.linkedFrom([r.id], 50)).filter((t) => !gone(t));
  const tz = await db.timeZone();
  const where = await placer(db, shape, [...targets, ...from]);
  return {
    id: r.id, title: NAMED_KINDS.includes(r.kind) ? r.title : (r.text || "").slice(0, 200), where: shape.where(r) || undefined,
    links_to: targets.map((t) => shown(t, where(t), tz, shape)),
    linked_from: from.map((t) => shown(t, where(t), tz, shape)),
  };
}

const ABOUT_KINDS = ["world", "project", "page", "chapter"];

async function setAbout(args: Record<string, unknown>, db: Db) {
  const r = await one(db, args.id);
  if (!ABOUT_KINDS.includes(r.kind)) throw new Bad("Abouts are for worlds, pieces, pages and chapters.");
  const text = textArg(args.about, "about", 2000).replace(/\s+/g, " ");
  if (text.length > 300) throw new Bad("Keep the about to one short line (under 300 characters).");
  const id = `ab-${r.id}`;
  const [old] = await db.get([id]);
  const fields = { by: CLAUDE, edited_by: CLAUDE, of: r.id, at: new Date().toISOString() };
  if (old) {
    if (old.kind !== "about") throw new Bad("Something else already uses this about's id; leave it.");
    if (!old.deleted && old.fields?.off) throw new Bad("The person switched off the about for this one. Leave it.");
    const by = (old.fields?.edited_by ?? old.fields?.by) as string | undefined;
    if (!old.deleted && by !== CLAUDE && (old.text || "").trim()) throw new Bad(`The person wrote this about themselves ("${old.text}"). Leave it as it is.`);
    await db.updateAbout(id, { text, fields: { ...(old.fields ?? {}), ...fields }, deleted: false });
  } else {
    await db.insert([{ ...row("about", { id, parent_id: r.id, text }), fields }]);
  }
  return { about: text, for: r.title || r.id };
}

/** A week's or month's summary in full. */
function readDigest(r: Entry) {
  return {
    summary: r.title, id: r.id, period: r.fields?.period, from: r.fields?.from, to: r.fields?.to, text: r.text,
    ...(Array.isArray(r.fields?.threads) ? { threads: r.fields.threads } : {}),
  };
}

async function map(db: Db) {
  const tz = await db.timeZone();
  const [outline, roll, tagList, abouts, digests] = await Promise.all([
    db.outline(), db.rollup(), db.tags(null), db.byKind(["about"], 5000), db.byKind(["digest"], 60),
  ]);
  const shape = new Shape(outline);
  shape.about = aboutMap(abouts);
  const R = new Map(roll.map((r) => [r.home, r]));
  const count = (id: string, kind: string): number => shape.under(id).reduce((n, c) => n + (c.kind === kind ? 1 : 0) + count(c.id, kind), 0);
  const stats = (id: string) => {
    const x = R.get(id);
    return x ? { entries: x.n, last_touched: localDate(x.last, tz), ...(x.top_tags?.length ? { top_tags: x.top_tags.map((t) => `#${t}`) } : {}) } : { entries: 0 };
  };
  const worldOut = (w: Entry) => ({
    id: w.id, title: w.title || "Untitled", ...(shape.about.has(w.id) ? { about: shape.about.get(w.id) } : {}),
    pieces: count(w.id, "project"), bible_pages: count(w.id, "page"), ...stats(w.id),
  });
  const areas = [...shape.byId.values()].filter((r) => r.kind === "area").sort(bySort);
  const worlds = [...shape.byId.values()].filter((r) => r.kind === "world");
  const byArea = new Map<string, Entry[]>();
  for (const w of worlds) {
    const k = w.area_id && shape.byId.get(w.area_id)?.kind === "area" ? w.area_id : "";
    byArea.set(k, [...(byArea.get(k) ?? []), w]);
  }
  const recent = (a: Entry, b: Entry) => (R.get(b.id)?.last ?? "").localeCompare(R.get(a.id)?.last ?? "");
  const areaOut = [...areas.map((a) => a.id), ""].filter((k) => byArea.get(k)?.length).map((k) => ({
    area: k ? shape.areaPath(k) : "No area",
    worlds: (byArea.get(k) ?? []).sort(recent).map(worldOut),
  }));
  const loose = shape.under(null, "page").sort(recent);
  const outside = shape.under(null, "project").sort(recent);
  const days = roll.filter((r) => r.home.startsWith("day-")).sort((a, b) => b.home.localeCompare(a.home));
  const live = digests.filter((d) => !gone(d)).sort((a, b) => b.id.localeCompare(a.id));
  const summary = (d: Entry) => ({ id: d.id, covers: d.title, gist: (d.text || "").split(/\n\s*\n/)[0].slice(0, 400) });
  const needs = [...shape.byId.values()]
    .filter((r) => ["world", "project", "page"].includes(r.kind) && !shape.about.has(r.id))
    .map((r) => ({ r, n: R.get(r.id)?.n ?? count(r.id, "page") + count(r.id, "project") }))
    .sort((a, b) => b.n - a.n).slice(0, 10)
    .map(({ r }) => ({ id: r.id, kind: KIND_NAME[r.kind], title: r.title || "Untitled", where: shape.where(r) }));
  return {
    today: today(tz),
    areas: areaOut,
    ...(outside.length ? { pieces_outside_worlds: outside.slice(0, 20).map((p) => ({ id: p.id, title: p.title || "Untitled", ...(shape.about.has(p.id) ? { about: shape.about.get(p.id) } : {}), ...stats(p.id) })) } : {}),
    loose_pages: {
      count: loose.length,
      newest: loose.slice(0, 30).map((p) => ({ id: p.id, title: p.title || "Untitled page", ...(shape.about.has(p.id) ? { about: shape.about.get(p.id) } : {}), ...stats(p.id) })),
    },
    daily_pages: {
      count: days.length, ...(days.length ? { first: days.at(-1)!.home.slice(4), last: days[0].home.slice(4) } : {}),
      recent: days.slice(0, 14).map((d) => ({ date: d.home.slice(4), entries: d.n, ...(d.top_tags?.length ? { top_tags: d.top_tags.map((t) => `#${t}`) } : {}) })),
      how: "Read a day with read and its date. Search with since/until for a stretch of days.",
    },
    tags: { count: tagList.length, most_used: tagList.slice(0, 30).map((t) => `#${t.tag} (${t.n})`) },
    summaries: {
      weeks: live.filter((d) => d.fields?.period === "week").slice(0, 6).map(summary),
      months: live.filter((d) => d.fields?.period === "month").slice(0, 6).map(summary),
      how: "Open one with read and its id. Older ones: search with kinds [\"summaries\"].",
    },
    ...(needs.length ? { needs_about: needs } : {}),
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
    case "map": return map(db);
    case "list_worlds": return listWorlds(db);
    case "tags": return tags(args, db);
    case "links": return links(args, db);
    case "set_about": return setAbout(args, db);
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
        serverInfo: { name: "inkwell", title: "Inkwell", version: "1.1.0" },
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
