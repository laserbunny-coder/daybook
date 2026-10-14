// What Claude can do in Daybook through the connector, and the small part of
// the MCP protocol needed to offer it. Kept free of Deno and Supabase imports
// so it can be tested on its own; index.ts supplies the database.

export type Row = {
  id: string;
  parent_id: string | null;
  title: string;
  notes: string | null;
  done: boolean;
  day: string | null;
  start_min: number | null;
  after_min: number | null;
  duration_min: number;
  sort: number;
  color: string | null;
  due: string | null;
  link: string | null;
  deleted: boolean;
};

export type Db = {
  /** Every item this person has that isn't deleted. */
  load(): Promise<Row[]>;
  /** Inserts or replaces these items. */
  save(rows: Row[]): Promise<void>;
};

const PALETTE = ["#4B6CB7", "#2E8B6E", "#B7791F", "#9B5BA5", "#C0564B", "#3E8E9E", "#7A7F2E", "#B0567F"];
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const INSTRUCTIONS = `Daybook is this person's own task and calendar app.
- Everything is an item in a tree. An item with steps under it is a project; steps can be sub-projects or tasks. Checking off tasks moves the parent project's progress.
- A task can sit on a day without a time ("sometime that day"), or in a time block on that day (start_time plus duration). Leave the time empty unless the person asks for a specific time.
- Any item can carry a link back to where its notes live, often a Thymer page. When you make a task from something in Thymer, set its link to that page and put a short summary in notes, so the person can glance at it and tap through for the rest. A Thymer page link looks like https://NAME.thymer.com/?open=WORKSPACE.PAGEID; if you can't tell the address, look at the links on existing tasks for the pattern, or ask.
- Dates are the person's local dates as YYYY-MM-DD, and times are 24-hour HH:MM.
- Say what you changed in plain words, since the person sees your reply, not the tool calls.`;

const str = (description: string) => ({ type: "string", description });
const orNull = (type: string, description: string) => ({ type: [type, "null"], description });

export const TOOLS = [
  {
    name: "list_tasks",
    title: "List tasks",
    description: "Lists tasks (items with no steps under them), with their project, day, time, duration and link. Filter by a date range, by project, by words in the title, or ask for unscheduled ones. Done tasks are left out unless include_done is true.",
    inputSchema: {
      type: "object",
      properties: {
        from: str("First day to include, YYYY-MM-DD."),
        to: str("Last day to include, YYYY-MM-DD."),
        unscheduled: { type: "boolean", description: "Only tasks with no day." },
        project_id: str("Only tasks anywhere under this project."),
        query: str("Only tasks whose title contains these words."),
        include_done: { type: "boolean", description: "Include tasks already checked off." },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_projects",
    title: "List projects",
    description: "Lists projects and sub-projects with their progress, due date and link.",
    inputSchema: { type: "object", properties: { include_done: { type: "boolean", description: "Include finished projects." } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_item",
    title: "Open an item",
    description: "Everything about one task or project: full notes, link, schedule, and the steps under it.",
    inputSchema: { type: "object", required: ["id"], properties: { id: str("The item's id.") } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_task",
    title: "Add a task",
    description: "Adds a task, either to the inbox or under a project, optionally on a day or in a time block, with notes and a link.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: str("What to do, short."),
        project_id: str("Put it under this project or task. Leave out for the inbox."),
        day: str("Day to do it, YYYY-MM-DD. Leave out to keep it unscheduled."),
        start_time: str("Start time, HH:MM 24-hour. Needs a day. Leave out for 'sometime that day'."),
        duration_minutes: { type: "integer", description: "How long it takes, 5 to 1440. Defaults to 60." },
        notes: str("Notes for when the person sits down to do it, such as a short summary of the source."),
        link: str("Web address the notes came from, such as the Thymer page. Must start with https:// or http://."),
        due: str("Due date, YYYY-MM-DD."),
      },
    },
  },
  {
    name: "add_project",
    title: "Add a project",
    description: "Adds a new top-level project. Add its tasks afterwards with add_task or add_steps.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: { title: str("The project's name."), notes: str("Goal or notes."), link: str("Web address with more notes."), due: str("Due date, YYYY-MM-DD.") },
    },
  },
  {
    name: "add_steps",
    title: "Add steps",
    description: "Breaks a task or project down by adding steps under it, in order.",
    inputSchema: {
      type: "object",
      required: ["parent_id", "steps"],
      properties: {
        parent_id: str("The task or project to add steps to."),
        steps: {
          type: "array",
          items: {
            type: "object",
            required: ["title"],
            properties: { title: { type: "string" }, duration_minutes: { type: "integer", description: "Defaults to 30." } },
          },
        },
      },
    },
  },
  {
    name: "update_item",
    title: "Change an item",
    description: "Changes a task or project: move it to another day or time, unschedule it, check it off, rename it, change its notes or link, or move it under another project. Only the fields you pass change; pass null to clear one. Changing the day without a start_time makes it 'sometime that day'.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: str("The item's id."),
        title: str("New title."),
        day: orNull("string", "New day, YYYY-MM-DD, or null to unschedule."),
        start_time: orNull("string", "New start time, HH:MM 24-hour, or null for 'sometime that day'."),
        duration_minutes: { type: "integer", description: "How long it takes, 5 to 1440." },
        done: { type: "boolean", description: "Check off (true) or reopen (false). On a project this applies to every step under it." },
        notes: orNull("string", "Replaces the notes. null clears them."),
        link: orNull("string", "Replaces the link. null removes it."),
        due: orNull("string", "Due date, YYYY-MM-DD, or null."),
        project_id: orNull("string", "Move under this project, or null to move to the inbox."),
      },
    },
  },
];

class Bad extends Error {}

function dayArg(v: unknown, name: string): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + "T00:00:00Z")) || new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v) {
    throw new Bad(`${name} must be a date like 2026-10-14.`);
  }
  return v;
}
function timeArg(v: unknown): number {
  const m = typeof v === "string" ? /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v) : null;
  if (!m) throw new Bad("start_time must be a 24-hour time like 09:30.");
  return +m[1] * 60 + +m[2];
}
function durArg(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 5 || v > 1440) throw new Bad("duration_minutes must be a whole number from 5 to 1440.");
  return v;
}
function linkArg(v: unknown): string {
  if (typeof v !== "string" || v.length > 2000) throw new Bad("link must be a web address.");
  let u: URL;
  try { u = new URL(v.trim()); } catch { throw new Bad("link must be a full web address starting with https://."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Bad("link must start with https:// or http://.");
  return u.href;
}
function textArg(v: unknown, name: string, max: number): string {
  if (typeof v !== "string") throw new Bad(`${name} must be text.`);
  if (v.length > max) throw new Bad(`${name} is too long (over ${max} characters).`);
  return v;
}
const hhmm = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const now = () => Date.now() / 1000;

/** The person's items as a tree, with the lookups the tools need. */
class Tree {
  byId = new Map<string, Row>();
  kids = new Map<string, Row[]>();
  constructor(rows: Row[]) {
    for (const r of rows) this.byId.set(r.id, r);
    for (const r of rows) if (r.parent_id && this.byId.has(r.parent_id)) {
      const k = this.kids.get(r.parent_id) ?? [];
      k.push(r);
      this.kids.set(r.parent_id, k);
    }
    for (const k of this.kids.values()) k.sort((a, b) => a.sort - b.sort);
  }
  get(id: unknown): Row {
    const r = typeof id === "string" ? this.byId.get(id) : undefined;
    if (!r) throw new Bad(`No item with id ${JSON.stringify(id)}. Use list_tasks or list_projects to find ids.`);
    return r;
  }
  children = (id: string) => this.kids.get(id) ?? [];
  isProject = (r: Row) => this.children(r.id).length > 0 || (r.parent_id == null && !!r.color);
  leaves(r: Row): Row[] {
    const k = this.children(r.id);
    return k.length ? k.flatMap((c) => this.leaves(c)) : [r];
  }
  progress(r: Row) {
    const L = this.children(r.id).length ? this.leaves(r) : [];
    return { done: L.filter((l) => l.done).length, total: L.length };
  }
  isDone(r: Row) {
    if (!this.children(r.id).length) return r.done;
    const p = this.progress(r);
    return p.total > 0 && p.done === p.total;
  }
  ancestors(r: Row): Row[] {
    const a: Row[] = [];
    let p = r.parent_id ? this.byId.get(r.parent_id) : undefined;
    while (p && a.length < 50) { a.unshift(p); p = p.parent_id ? this.byId.get(p.parent_id) : undefined; }
    return a;
  }
  describe(r: Row, full = false) {
    const o: Record<string, unknown> = { id: r.id, title: r.title };
    const path = this.ancestors(r).map((a) => a.title).join(" › ");
    if (path) o.project = path;
    if (this.children(r.id).length) { const p = this.progress(r); o.progress = `${p.done}/${p.total} done`; }
    else o.done = r.done;
    if (r.day) o.day = r.day;
    if (r.start_min != null) o.start_time = hhmm(r.start_min);
    if (!this.isProject(r)) o.duration_minutes = r.duration_min;
    if (r.due) o.due = r.due;
    if (r.link) o.link = r.link;
    if (r.notes) o.notes = full || r.notes.length <= 200 ? r.notes : r.notes.slice(0, 200) + "…";
    return o;
  }
}

function newRow(fields: Partial<Row>): Row {
  return { id: crypto.randomUUID(), parent_id: null, title: "", notes: null, done: false, day: null, start_min: null, after_min: null, duration_min: 60, sort: now(), color: null, due: null, link: null, deleted: false, ...fields };
}

const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

export async function runTool(name: string, args: Record<string, unknown>, db: Db): Promise<unknown> {
  const t = new Tree(await db.load());
  switch (name) {
    case "list_tasks": {
      const from = has(args, "from") ? dayArg(args.from, "from") : null;
      const to = has(args, "to") ? dayArg(args.to, "to") : null;
      const under = has(args, "project_id") ? t.get(args.project_id) : null;
      const words = typeof args.query === "string" ? args.query.toLowerCase().split(/\s+/).filter(Boolean) : [];
      let rows = [...t.byId.values()].filter((r) => !t.isProject(r));
      if (!args.include_done) rows = rows.filter((r) => !r.done);
      if (args.unscheduled) rows = rows.filter((r) => !r.day);
      if (from) rows = rows.filter((r) => r.day && r.day >= from);
      if (to) rows = rows.filter((r) => r.day && r.day <= to);
      if (under) rows = rows.filter((r) => t.ancestors(r).includes(under));
      if (words.length) rows = rows.filter((r) => words.every((w) => r.title.toLowerCase().includes(w)));
      rows.sort((a, b) => (a.day ?? "9999").localeCompare(b.day ?? "9999") || (a.start_min ?? 1e4) - (b.start_min ?? 1e4) || a.sort - b.sort);
      const out = rows.slice(0, 300).map((r) => t.describe(r));
      return rows.length > 300 ? { tasks: out, note: `Showing 300 of ${rows.length}. Narrow it down with dates or a project.` } : { tasks: out };
    }
    case "list_projects": {
      const rows = [...t.byId.values()].filter((r) => t.isProject(r) && (args.include_done || !t.isDone(r)));
      rows.sort((a, b) => t.ancestors(a).length - t.ancestors(b).length || a.sort - b.sort);
      return { projects: rows.map((r) => t.describe(r)) };
    }
    case "get_item": {
      const r = t.get(args.id);
      return { ...t.describe(r, true), steps: t.children(r.id).map((c) => t.describe(c)) };
    }
    case "add_task": {
      const f: Partial<Row> = { title: textArg(args.title, "title", 500).trim() };
      if (!f.title) throw new Bad("title can't be empty.");
      if (has(args, "project_id")) f.parent_id = t.get(args.project_id).id;
      if (has(args, "day")) f.day = dayArg(args.day, "day");
      if (has(args, "start_time")) { if (!f.day) throw new Bad("start_time needs a day."); f.start_min = timeArg(args.start_time); }
      if (has(args, "duration_minutes")) f.duration_min = durArg(args.duration_minutes);
      if (has(args, "notes")) f.notes = textArg(args.notes, "notes", 20000) || null;
      if (has(args, "link")) f.link = linkArg(args.link);
      if (has(args, "due")) f.due = dayArg(args.due, "due");
      const r = newRow(f);
      await db.save([r]);
      return { added: { ...new Tree([...t.byId.values(), r]).describe(r) } };
    }
    case "add_project": {
      const used = new Set([...t.byId.values()].filter((r) => r.parent_id == null && r.color).map((r) => r.color));
      const f: Partial<Row> = { title: textArg(args.title, "title", 500).trim(), color: PALETTE.find((c) => !used.has(c)) ?? PALETTE[t.byId.size % PALETTE.length] };
      if (!f.title) throw new Bad("title can't be empty.");
      if (has(args, "notes")) f.notes = textArg(args.notes, "notes", 20000) || null;
      if (has(args, "link")) f.link = linkArg(args.link);
      if (has(args, "due")) f.due = dayArg(args.due, "due");
      const r = newRow(f);
      await db.save([r]);
      return { added: { id: r.id, title: r.title } };
    }
    case "add_steps": {
      const p = t.get(args.parent_id);
      if (!Array.isArray(args.steps) || !args.steps.length || args.steps.length > 50) throw new Bad("steps must list 1 to 50 steps.");
      const base = Math.max(now(), ...t.children(p.id).map((c) => c.sort));
      const rows = args.steps.map((s: Record<string, unknown>, i: number) => {
        const title = textArg(s?.title, "step title", 500).trim();
        if (!title) throw new Bad("A step's title can't be empty.");
        return newRow({ parent_id: p.id, title, duration_min: s.duration_minutes == null ? 30 : durArg(s.duration_minutes), sort: base + (i + 1) / 1000 });
      });
      await db.save(rows);
      return { added: rows.map((r) => ({ id: r.id, title: r.title })), under: p.title };
    }
    case "update_item": {
      const r = { ...t.get(args.id) };
      const changed: Row[] = [];
      if (has(args, "title")) { r.title = textArg(args.title, "title", 500).trim(); if (!r.title) throw new Bad("title can't be empty."); }
      if (has(args, "day")) {
        const d = args.day === null ? null : dayArg(args.day, "day");
        if (d !== r.day) { r.day = d; r.start_min = null; r.after_min = null; r.sort = now(); }
      }
      if (has(args, "start_time")) {
        if (args.start_time === null) r.start_min = null;
        else { if (!r.day) throw new Bad("start_time needs a day; pass day too."); r.start_min = timeArg(args.start_time); }
      }
      if (!r.day) r.start_min = null;
      if (has(args, "duration_minutes")) r.duration_min = durArg(args.duration_minutes);
      if (has(args, "notes")) r.notes = args.notes === null ? null : textArg(args.notes, "notes", 20000) || null;
      if (has(args, "link")) r.link = args.link === null || args.link === "" ? null : linkArg(args.link);
      if (has(args, "due")) r.due = args.due === null ? null : dayArg(args.due, "due");
      if (has(args, "project_id")) {
        if (args.project_id === null) r.parent_id = null;
        else {
          const p = t.get(args.project_id);
          if (p.id === r.id || t.ancestors(p).some((a) => a.id === r.id)) throw new Bad("Can't move an item under itself or one of its own steps.");
          r.parent_id = p.id;
        }
        r.sort = now();
      }
      if (has(args, "done")) {
        if (typeof args.done !== "boolean") throw new Bad("done must be true or false.");
        const k = t.children(r.id);
        if (k.length) {
          for (const l of t.leaves(r)) if (l.done !== args.done) changed.push({ ...l, done: args.done });
        } else r.done = args.done;
      }
      changed.unshift(r);
      await db.save(changed);
      const after = new Tree([...t.byId.values()].map((x) => changed.find((c) => c.id === x.id) ?? x));
      return { updated: after.describe(after.get(r.id)), ...(changed.length > 1 ? { steps_changed: changed.length - 1 } : {}) };
    }
  }
  throw new Bad(`Unknown tool ${name}.`);
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/** Answers one JSON-RPC message. Returns null for notifications. */
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
        serverInfo: { name: "daybook", title: "Daybook", version: "1.0.0" },
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
        return ok({ content: [{ type: "text", text: "Daybook couldn't do that just now. Try again in a moment." }], isError: true });
      }
    }
  }
  return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } };
}
