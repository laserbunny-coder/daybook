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
  /** Place in its day's list; sort is its place among its project's steps. */
  day_sort?: number | null;
  color: string | null;
  due: string | null;
  link: string | null;
  kind: string | null;
  area_id: string | null;
  /** Roadmap: when a project or sub-project starts. */
  start?: string | null;
  /** Roadmap: a milestone task shows as a diamond; a hard deadline's date can't move. */
  milestone?: boolean;
  hard_deadline?: boolean;
  /** Roadmap: the id of the item this one is waiting on. */
  waits_on?: string | null;
  /** When a task was checked off (ISO timestamp). The database stamps it; only sent when set on purpose. */
  done_at?: string | null;
  /** How long a task really took, when someone filled it in. */
  actual_minutes?: number | null;
  /** Time really worked on it, recorded in the app: ISO start and end (end null while recording). guess: filled in at check-off, not recorded. */
  time_log?: { start: string; end: string | null; guess?: boolean }[] | null;
  /** Where a task was planned before checking it off moved its block to when it was really done. */
  planned?: { day: string | null; start_min: number | null; duration_min: number | null } | null;
  /** A repeating task (a series): how it repeats. Its day is the day it starts. */
  repeat_rule?: Rule | null;
  /** A stored repeat of a series: the series' id, and the date it was due. */
  series_id?: string | null;
  occurs_on?: string | null;
  deleted: boolean;
};

/** How a series repeats. days: 0 is Sunday. dom: day of the month. until: its last day. */
export type Rule = { every: "day" | "weekday" | "week" | "month"; days?: number[]; interval?: number; dom?: number; until?: string };

export type Db = {
  /** Every item this person has that isn't deleted, plus skipped repeats (deleted, with occurs_on). */
  load(): Promise<Row[]>;
  /** Inserts or replaces these items. */
  save(rows: Row[]): Promise<void>;
  /** The Roadmap's free hours per week, null when never set. */
  getFreeHours(): Promise<number | null>;
  setFreeHours(hours: number): Promise<void>;
  /** The person's time zone (the app records it), such as Europe/Berlin; null if unknown. */
  timeZone(): Promise<string | null>;
  /** Notes left for the person (post_note), newest first. */
  listNotes(limit: number, unreadOnly: boolean): Promise<Note[]>;
  addNote(n: Pick<Note, "author" | "title" | "body" | "link" | "task_ids">): Promise<Note>;
};

/** A note Claude left for the person, shown in the app until they tap Got it, and kept in Notes after. */
export type Note = { id: string; author: string; title: string; body: string; link: string; task_ids: string[]; created_at: string; read_at: string | null };

/** What the Roadmap assumes until free hours are set (the app shows the same). */
const FREE_DEFAULT = 10;

const PALETTE = ["#4B6CB7", "#2E8B6E", "#B7791F", "#9B5BA5", "#C0564B", "#3E8E9E", "#7A7F2E", "#B0567F"];
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const INSTRUCTIONS = `Daybook is this person's own task and calendar app.
- Everything is an item in a tree. An item with steps under it is a project; steps can be sub-projects or tasks. Checking off tasks moves the parent project's progress.
- Top-level projects are grouped into areas, such as Business, Filmmaking and Personal; list_projects shows them. When you add a project, put it in the area it clearly belongs to, or ask. A task can also sit right in an area without being part of a project (a standalone task, such as a bigger one-off in Filmmaking); it becomes a project in that area once it gets steps.
- A task can sit on a day without a time ("sometime that day"), or in a time block on that day (start_time plus duration). Leave the time empty unless the person asks for a specific time.
- Any item can carry a link back to where its notes live, often a Thymer page. When you make a task from something in Thymer, set its link to that page and put a short summary in notes, so the person can glance at it and tap through for the rest. A Thymer page link looks like https://NAME.thymer.com/?open=WORKSPACE.PAGEID; if you can't tell the address, look at the links on existing tasks for the pattern, or ask.
- Dates are the person's local dates as YYYY-MM-DD, and times are 24-hour HH:MM.
- The Roadmap shows each top-level project as a bar from its start date to its due date (sub-projects as thinner bars under it). Set start and due on projects and sub-projects to place them. A task marked milestone shows as a diamond on its due date (or its day); hard_deadline marks a milestone whose date can't move. waiting_on links an item to another item it waits on, such as "List footage" waiting on "NAS live".
- The Roadmap's top strip weighs each week's scheduled task hours against the person's free hours per week (get_free_hours / set_free_hours), so over-planned weeks stand out. When planning a week, keep its scheduled hours within that number.
- Checking off a task records when (done_at, in the person's local time); reopening clears it. If they say they finished something earlier, pass done_at with update_item to backdate it. actual_minutes is how long a task really took, next to its planned duration_minutes; fill it in when they tell you, or when it was far off. list_tasks with done_since lists what was finished since a date, to see their real pace.
- Time tracking: the person records time in the app with a ▶ on a task or project (one at a time). time_log lists each stretch really worked (start, end, minutes; end is "recording now" while it runs). Checking a task off moves its block (day, start_time, duration_minutes) to when it was really done, and planned keeps where and how long it was planned, so compare planned with the real block and actual_minutes (the recorded total) to learn their pace. A stretch marked guessed wasn't recorded: it was checked off without the timer, so the app assumed it ended then and took as long as planned; don't read its length as real. Time on a project's steps is recorded on the project as a whole.
- A task can repeat (daily, weekdays, weekly on chosen days, every N weeks, or monthly), with an optional last day: pass repeat to add_task or update_item. The task is then a series that starts on its day. Each repeat shows on its own day and is checked off on its own. list_tasks with from and to lists the repeats in that range: each has its own id (series id~date) and a series_id. To change one day's repeat (move it, check it off, rename it), use its id; to change every repeat, use the series_id. A repeat moved off the plan (day null) is skipped. repeat: null stops a series repeating. Repeating tasks count in each week's scheduled hours but have no bar on the Roadmap.
- Notes: post_note leaves the person a note they see in the app as a card the next time they open it (unread notes stack into one card), with a button back to the chat it came from, and it stays in their Notes history. Use it to tell them what a scheduled check changed, such as a morning plan check, with a short title, a few lines, the link to this chat, and the ids of the tasks you changed. list_notes reads back what you already told them, and whether they've read it.
- Say what you changed in plain words, since the person sees your reply, not the tool calls.`;

const str = (description: string) => ({ type: "string", description });
const REPEAT = {
  type: "object",
  description: "Makes it a repeating task that starts on its day (today if it has none). every: day, weekday (Monday to Friday), week or month. For week: days, such as [\"mon\", \"thu\"] (defaults to the start day's weekday), and interval for every 2, 3… weeks. A monthly task repeats on its start day's date. until: its last day, YYYY-MM-DD (optional).",
  properties: {
    every: { type: "string", enum: ["day", "weekday", "week", "month"] },
    days: { type: "array", items: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] } },
    interval: { type: "integer", description: "Weeks between repeats, 1 to 12. Defaults to 1." },
    until: { type: ["string", "null"], description: "Last day it repeats, YYYY-MM-DD." },
  },
  required: ["every"],
};
const orNull = (type: string, description: string) => ({ type: [type, "null"], description });

export const TOOLS = [
  {
    name: "list_tasks",
    title: "List tasks",
    description: "Lists tasks (items with no steps under them), with their project, day, time, duration and link. Filter by a date range, by project, by words in the title, or ask for unscheduled ones. With from and/or to, a repeating task is listed as each of its repeats in that range (up to a year); without dates, once, with how it repeats. Done tasks are left out unless include_done is true.",
    inputSchema: {
      type: "object",
      properties: {
        from: str("First day to include, YYYY-MM-DD."),
        to: str("Last day to include, YYYY-MM-DD."),
        unscheduled: { type: "boolean", description: "Only tasks with no day of their own and no scheduled project above them (steps of a scheduled project are worked on with it)." },
        project_id: str("Only tasks anywhere under this project."),
        query: str("Only tasks whose title contains these words."),
        include_done: { type: "boolean", description: "Include tasks already checked off." },
        done_since: str("Only tasks checked off on or after this local date, YYYY-MM-DD (includes done tasks)."),
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_projects",
    title: "List projects",
    description: "Lists the person's areas, and their projects and sub-projects with area, progress, start and due dates, what they wait on, and link.",
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
    description: "Adds a task to the inbox, right in an area, or under a project, optionally on a day or in a time block, with notes and a link.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: str("What to do, short."),
        project_id: str("Put it under this project or task. Leave out for the inbox or an area."),
        area: str("Put it right in this area, by name, without a project. Not with project_id."),
        day: str("Day to do it, YYYY-MM-DD. Leave out to keep it unscheduled."),
        start_time: str("Start time, HH:MM 24-hour. Needs a day. Leave out for 'sometime that day'."),
        duration_minutes: { type: "integer", description: "How long it takes, 5 to 1440. Defaults to 60." },
        notes: str("Notes for when the person sits down to do it, such as a short summary of the source."),
        link: str("Web address the notes came from, such as the Thymer page. Must start with https:// or http://."),
        due: str("Due date, YYYY-MM-DD. For a milestone, the date its diamond sits on."),
        start: str("Start date, YYYY-MM-DD, for an item that will get steps of its own (a sub-project)."),
        milestone: { type: ["boolean", "string"], enum: [true, false, "true", "false"], description: "Mark it as a milestone: a diamond on the Roadmap on its due date (or its day)." },
        hard_deadline: { type: ["boolean", "string"], enum: [true, false, "true", "false"], description: "A milestone whose date can't move (drawn red). Makes it a milestone too." },
        waiting_on: str("Id of another item this one waits on."),
        repeat: REPEAT,
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
      properties: {
        title: str("The project's name."),
        area: str("The area it belongs in, by name, such as Business (see list_projects)."),
        notes: str("Goal or notes."),
        link: str("Web address with more notes."),
        start: str("Start date, YYYY-MM-DD: where its bar begins on the Roadmap."),
        due: str("Due date, YYYY-MM-DD: where its bar ends on the Roadmap."),
        waiting_on: str("Id of another item this project waits on."),
      },
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
    name: "get_free_hours",
    title: "Free hours per week",
    description: "How many hours a week the person has for the tasks in Daybook. The Roadmap compares each week's scheduled task hours with this, so over-planned weeks stand out. Also gives the scheduled hours for this week and the next three.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "set_free_hours",
    title: "Set free hours per week",
    description: "Sets how many hours a week the person has for the tasks in Daybook (1 to 168). Only change it when they tell you their number.",
    inputSchema: { type: "object", required: ["hours"], properties: { hours: { type: ["integer", "string"], description: "Whole hours per week, 1 to 168." } } },
  },
  {
    name: "post_note",
    title: "Leave a note",
    description: "Leaves the person a note in Daybook: a card at the top of the app the next time they open it, on phone or computer, with a Talk about this button that opens link, and the tasks it mentions to tap. Unread notes stack into one card with a count. Tapping Got it marks it read; every note stays in their Notes history. Use it to say what you did, for example after a morning plan check moved tasks.",
    inputSchema: {
      type: "object",
      required: ["title", "message", "link"],
      properties: {
        title: str("Short title, such as Morning plan check (up to 120 characters). The card reads 'Claude: <title>'."),
        message: str("The note itself, a few lines. Markdown is fine: **bold**, *italic*, lists, links (up to 6000 characters)."),
        link: str("The Claude chat this note came from, so the person can talk about it there. Must start with https:// or http://."),
        task_ids: { type: "array", items: { type: "string" }, description: "Ids of the tasks or projects the note is about, such as the ones you moved (up to 50). They show as tappable chips." },
        from: str("Who it's from, shown before the title. Defaults to Claude."),
      },
    },
  },
  {
    name: "list_notes",
    title: "List notes",
    description: "The notes already left for the person with post_note, newest first: title, message, link, the tasks they mention, when, and whether they've read it (read_at).",
    inputSchema: {
      type: "object",
      properties: {
        unread_only: { type: ["boolean", "string"], enum: [true, false, "true", "false"], description: "Only notes they haven't marked read yet." },
        limit: { type: ["integer", "string"], description: "How many, 1 to 100. Defaults to 20." },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "update_item",
    title: "Change an item",
    description: "Changes a task or project: move it to another day or time, unschedule it, check it off, rename it, change its notes or link, set its start and due dates, mark it a milestone or hard deadline, set what it's waiting on, move it under another project, or make it repeat. Only the fields you pass change; pass null to clear one. Changing the day without a start_time makes it 'sometime that day'. For a repeating task: a repeat's id (series id~date) changes only that day's repeat (day null skips it); the series_id changes every repeat (its day is the day the series starts).",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: str("The item's id."),
        title: str("New title."),
        day: orNull("string", "New day, YYYY-MM-DD, or null to unschedule."),
        start_time: orNull("string", "New start time, HH:MM 24-hour, or null for 'sometime that day'."),
        duration_minutes: { type: "integer", description: "How long it takes, 5 to 1440." },
        done: { type: "boolean", description: "Check off (true) or reopen (false). On a project this applies to every step under it. Checking off records the time in done_at; reopening clears it." },
        done_at: str("When it was really finished, to backdate a check-off: YYYY-MM-DD HH:MM in the person's local time (or just YYYY-MM-DD, read as noon), or ISO 8601 with an offset. The item must be done, or pass done: true too. Not in the future."),
        actual_minutes: { type: ["integer", "string", "null"], description: "How long it really took, in minutes (1 to 10080), or null to clear." },
        notes: orNull("string", "Replaces the notes. null clears them."),
        link: orNull("string", "Replaces the link. null removes it."),
        due: orNull("string", "Due date, YYYY-MM-DD, or null."),
        start: orNull("string", "Start date of a project or sub-project, YYYY-MM-DD, or null."),
        milestone: { type: ["boolean", "string"], enum: [true, false, "true", "false"], description: "Make it a milestone (true) or a plain task (false, which also clears hard_deadline)." },
        hard_deadline: { type: ["boolean", "string"], enum: [true, false, "true", "false"], description: "Mark a milestone's date as one that can't move. true also makes it a milestone." },
        waiting_on: orNull("string", "Id of the item this one waits on, or null to clear."),
        project_id: orNull("string", "Move under this project, or null to move to the inbox."),
        area: orNull("string", "For a top-level project or task: move it to this area, by name, or null for no area (a task goes back to the inbox)."),
        repeat: { ...REPEAT, type: ["object", "null"], description: REPEAT.description + " On a series (or one of its repeats) this changes how the whole series repeats; null stops it repeating, leaving it a plain task on its next day." },
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

/* Repeating tasks, worked out the same way as the app (js/repeat.js). A series' repeats aren't stored;
   one is only stored once it's changed, checked off or skipped: id "<series id>~<date>". */
const utc = (s: string) => new Date(s + "T00:00:00Z");
const addDays = (s: string, n: number) => { const d = utc(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const dow = (s: string) => utc(s).getUTCDay();
const mondayOf = (s: string) => addDays(s, -((dow(s) + 6) % 7));
const between = (a: string, b: string) => Math.round((utc(b).getTime() - utc(a).getTime()) / 864e5);
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_TEXT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function repeatsOn(r: Rule | null | undefined, start: string | null, d: string): boolean {
  if (!r || !start || d < start || (r.until && d > r.until)) return false;
  const w = dow(d);
  switch (r.every) {
    case "day": return true;
    case "weekday": return w >= 1 && w <= 5;
    case "week": {
      if (!(r.days?.length ? r.days : [dow(start)]).includes(w)) return false;
      const n = Math.max(1, r.interval || 1);
      return n === 1 || (between(mondayOf(start), mondayOf(d)) / 7) % n === 0;
    }
    case "month": {
      const x = utc(d), last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
      return x.getUTCDate() === Math.min(r.dom || utc(start).getUTCDate(), last);
    }
  }
  return false;
}
function ruleText(r: Rule, start: string): string {
  let t = "";
  if (r.every === "day") t = "every day";
  else if (r.every === "weekday") t = "weekdays";
  else if (r.every === "week") {
    const days = r.days?.length ? r.days : [dow(start)], n = r.interval || 1;
    const names = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => DAY_TEXT[d]).join(", ");
    t = n > 1 ? `every ${n} weeks on ${names}` : `every ${names}`;
  } else t = `monthly on day ${r.dom || utc(start).getUTCDate()}`;
  return t + (r.until ? ` until ${r.until}` : "");
}
/** A repeat rule from Claude: an object (or the same as JSON text). */
function repeatArg(v: unknown, start: string): Rule {
  let o = v;
  if (typeof o === "string") { try { o = JSON.parse(o); } catch { o = { every: o.trim().toLowerCase() }; } }
  if (!o || typeof o !== "object") throw new Bad("repeat must be an object such as {\"every\": \"week\", \"days\": [\"mon\"]}.");
  const a = o as Record<string, unknown>;
  const every = String(a.every ?? "").trim().toLowerCase().replace(/^(daily|days)$/, "day").replace(/^(weekdays)$/, "weekday").replace(/^(weekly|weeks)$/, "week").replace(/^(monthly|months)$/, "month");
  if (!["day", "weekday", "week", "month"].includes(every)) throw new Bad("repeat.every must be day, weekday, week or month.");
  const r: Rule = { every: every as Rule["every"] };
  if (every === "week") {
    const raw = a.days == null ? [] : Array.isArray(a.days) ? a.days : [a.days];
    const days = raw.map((d) => {
      const i = typeof d === "number" ? d : DAY_NAMES.indexOf(String(d).trim().toLowerCase().slice(0, 3));
      if (!Number.isInteger(i) || i < 0 || i > 6) throw new Bad(`repeat.days: ${JSON.stringify(d)} isn't a weekday. Use mon, tue, wed, thu, fri, sat or sun.`);
      return i;
    });
    r.days = [...new Set(days.length ? days : [dow(start)])].sort((x, y) => x - y);
    const n = a.interval == null ? 1 : Number(a.interval);
    if (!Number.isInteger(n) || n < 1 || n > 12) throw new Bad("repeat.interval must be a whole number of weeks from 1 to 12.");
    r.interval = n;
  } else if (a.days != null || (a.interval != null && Number(a.interval) !== 1)) throw new Bad("repeat.days and repeat.interval are only for every: week.");
  if (every === "month") r.dom = utc(start).getUTCDate();
  if (a.until != null && a.until !== "") {
    r.until = dayArg(a.until, "repeat.until");
    if (r.until < start) throw new Bad(`repeat.until (${r.until}) is before the day it starts (${start}).`);
  }
  return r;
}
// What a stored repeat shares with its series, and what a change to the series hands down to them
const SHARED: (keyof Row)[] = ["parent_id", "title", "notes", "start_min", "after_min", "duration_min", "sort", "day_sort", "color", "link", "area_id", "waits_on"];
const FOLLOW: (keyof Row)[] = ["parent_id", "title", "notes", "start_min", "duration_min", "color", "link", "waits_on", "area_id"];

/** The person's items as a tree, with the lookups the tools need. */
class Tree {
  byId = new Map<string, Row>();
  /** The person's time zone, for showing done_at; UTC when unknown. */
  tz: string | null = null;
  kids = new Map<string, Row[]>();
  /** Areas (Business, Personal…) are rows too, kept apart from the items. */
  areas: Row[];
  /** Stored repeats of each series by the date they were due (skipped ones too), and the ones still on the plan. */
  occ = new Map<string, Map<string, Row>>();
  occLive = new Map<string, Row>();
  series: Row[] = [];
  raw: Row[];
  constructor(all: Row[]) {
    this.raw = all;
    this.areas = all.filter((r) => r.kind === "area" && !r.deleted).sort((a, b) => a.sort - b.sort);
    for (const r of all) if (r.series_id) {
      if (r.occurs_on) { const m = this.occ.get(r.series_id) ?? new Map(); m.set(r.occurs_on, r); this.occ.set(r.series_id, m); }
      if (!r.deleted) this.occLive.set(r.id, r);
    }
    const rows = all.filter((r) => r.kind !== "area" && !r.deleted && !r.series_id);
    this.series = rows.filter((r) => r.repeat_rule);
    for (const r of rows) this.byId.set(r.id, r);
    for (const r of rows) if (r.parent_id && this.byId.has(r.parent_id)) {
      const k = this.kids.get(r.parent_id) ?? [];
      k.push(r);
      this.kids.set(r.parent_id, k);
    }
    for (const k of this.kids.values()) k.sort((a, b) => a.sort - b.sort);
  }
  get(id: unknown): Row {
    const r = typeof id === "string" ? this.byId.get(id) ?? this.occLive.get(id) ?? this.ghost(id) : undefined;
    if (!r) throw new Bad(`No item with id ${JSON.stringify(id)}. Use list_tasks or list_projects to find ids.`);
    return r;
  }
  /** A repeat that isn't stored, worked out from its series (not saved until it's changed). */
  ghost(id: string): Row | undefined {
    const m = /^(.+)~(\d{4}-\d{2}-\d{2})$/.exec(id);
    const s = m ? this.byId.get(m[1]) : undefined;
    if (!m || !s?.repeat_rule || !repeatsOn(s.repeat_rule, s.day, m[2]) || this.occ.get(s.id)?.has(m[2])) return undefined;
    return this.virt(s, m[2]);
  }
  virt(s: Row, d: string): Row {
    const r = newRow({ id: `${s.id}~${d}`, day: d, series_id: s.id, occurs_on: d, repeat_rule: null });
    for (const k of SHARED) (r as Record<string, unknown>)[k] = s[k] ?? null;
    return r;
  }
  /** Every repeat on day d: stored ones on it, and worked-out ones due that day. */
  occOn(d: string): Row[] {
    const out = [...this.occLive.values()].filter((r) => r.day === d);
    for (const s of this.series) if (repeatsOn(s.repeat_rule, s.day, d) && !this.occ.get(s.id)?.has(d)) out.push(this.virt(s, d));
    return out;
  }
  occBetween(from: string, to: string): Row[] {
    const out: Row[] = [];
    for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) out.push(...this.occOn(d));
    return out;
  }
  /** This tree with some rows changed or added. */
  with(changed: Row[]) {
    const ids = new Set(changed.map((c) => c.id));
    const t = new Tree([...this.raw.filter((r) => !ids.has(r.id)), ...changed]);
    t.tz = this.tz;
    return t;
  }
  children = (id: string) => this.kids.get(id) ?? [];
  areaOf = (r: Row) => (r.parent_id == null && r.area_id ? this.areas.find((a) => a.id === r.area_id) : undefined);
  area(v: unknown): Row {
    const name = typeof v === "string" ? v.trim().toLowerCase() : "";
    const a = this.areas.find((x) => x.id === v || x.title.trim().toLowerCase() === name);
    if (!a) throw new Bad(`No area called ${JSON.stringify(v)}. The areas are: ${this.areas.map((x) => x.title).join(", ") || "none yet"}.`);
    return a;
  }
  isProject = (r: Row) => this.children(r.id).length > 0 || (r.parent_id == null && !!r.color);
  leaves(r: Row): Row[] {
    const k = this.children(r.id);
    return k.length ? k.flatMap((c) => this.leaves(c)) : [r];
  }
  progress(r: Row) {
    const L = this.children(r.id).length ? this.leaves(r).filter((l) => !l.repeat_rule) : []; // a repeating task never finishes
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
    const area = this.areaOf(this.ancestors(r)[0] ?? r);
    if (area) o.area = area.title;
    if (this.children(r.id).length) { const p = this.progress(r); o.progress = `${p.done}/${p.total} done`; }
    else {
      o.done = r.done;
      if (r.done && r.done_at) o.done_at = localStamp(r.done_at, this.tz);
    }
    if (r.actual_minutes) o.actual_minutes = r.actual_minutes;
    if (r.time_log?.length) o.time_log = r.time_log.map((e) => ({
      start: localStamp(e.start, this.tz), end: e.end ? localStamp(e.end, this.tz) : "recording now",
      minutes: Math.max(0, Math.round(((e.end ? Date.parse(e.end) : Date.now()) - Date.parse(e.start)) / 60000)), ...(e.guess ? { guessed: true } : {}),
    }));
    if (r.planned) o.planned = { day: r.planned.day, ...(r.planned.start_min != null ? { start_time: hhmm(r.planned.start_min) } : {}), duration_minutes: r.planned.duration_min };
    if (r.repeat_rule && r.day) {
      o.repeats = ruleText(r.repeat_rule, r.day); o.starts = r.day;
      o.repeat = { every: r.repeat_rule.every, ...(r.repeat_rule.every === "week" ? { days: (r.repeat_rule.days ?? []).map((d) => DAY_NAMES[d]), interval: r.repeat_rule.interval ?? 1 } : {}), ...(r.repeat_rule.until ? { until: r.repeat_rule.until } : {}) };
      delete o.done;
    } else if (r.day) o.day = r.day;
    if (r.series_id) { o.series_id = r.series_id; const s = this.byId.get(r.series_id); if (s?.repeat_rule && s.day) o.repeats = ruleText(s.repeat_rule, s.day); }
    if (r.start_min != null) o.start_time = hhmm(r.start_min);
    if (!this.isProject(r)) o.duration_minutes = r.duration_min;
    if (r.start) o.start = r.start;
    if (r.due) o.due = r.due;
    if (r.milestone) o.milestone = true;
    if (r.hard_deadline) o.hard_deadline = true;
    if (r.waits_on) { const w = this.byId.get(r.waits_on); if (w) o.waiting_on = { id: w.id, title: w.title }; }
    if (r.link) o.link = r.link;
    if (r.notes) o.notes = full || r.notes.length <= 200 ? r.notes : r.notes.slice(0, 200) + "…";
    return o;
  }
}

function newRow(fields: Partial<Row>): Row {
  return { id: crypto.randomUUID(), parent_id: null, title: "", notes: null, done: false, day: null, start_min: null, after_min: null, duration_min: 60, sort: now(), color: null, due: null, link: null, kind: null, area_id: null, start: null, milestone: false, hard_deadline: false, waits_on: null, deleted: false, ...fields };
}

/** true or false, also written as the text "true" or "false" (some clients send flags as text). */
function boolArg(v: unknown, name: string): boolean {
  if (typeof v === "boolean") return v;
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (t === "true" || t === "false") return t === "true";
  throw new Bad(`${name} must be true or false.`);
}
/** Start, due, milestone, hard deadline and waiting on, shared by add_task, add_project and update_item. */
function roadmapArgs(t: Tree, args: Record<string, unknown>, r: Partial<Row> & { id?: string }) {
  if (has(args, "start")) r.start = args.start === null ? null : dayArg(args.start, "start");
  if (has(args, "milestone")) { r.milestone = boolArg(args.milestone, "milestone"); if (!r.milestone) r.hard_deadline = false; }
  if (has(args, "hard_deadline")) { r.hard_deadline = boolArg(args.hard_deadline, "hard_deadline"); if (r.hard_deadline) r.milestone = true; }
  if (has(args, "waiting_on")) {
    if (args.waiting_on === null || args.waiting_on === "") r.waits_on = null;
    else {
      const w = t.get(args.waiting_on);
      if (w.id === r.id) throw new Bad("An item can't wait on itself.");
      r.waits_on = w.id;
    }
  }
  if (r.start && r.due && r.start > r.due) throw new Bad(`start (${r.start}) is after due (${r.due}). Change both together, or pass the other one too.`);
}

/** The wall-clock parts of an instant in a time zone, and that zone's offset from UTC in minutes. */
function zoned(ms: number, tz: string | null) {
  let p: Record<string, string>;
  try {
    p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz ?? "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  } catch { return zoned(ms, null); } // an unknown zone name
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, off: Math.round((wall - Math.floor(ms / 1000) * 1000) / 60000) };
}
/** done_at as the person reads it: local time with its offset, such as 2026-10-16T14:05+02:00. */
function localStamp(iso: string, tz: string | null): string {
  const ms = Date.parse(iso);
  if (isNaN(ms)) return iso;
  const z = zoned(ms, tz), a = Math.abs(z.off);
  return `${z.date}T${z.time}${z.off ? (z.off < 0 ? "-" : "+") + String(Math.floor(a / 60)).padStart(2, "0") + ":" + String(a % 60).padStart(2, "0") : "Z"}`;
}
/** A finish time from Claude: local wall time (in tz), a bare date (noon), or ISO 8601 with an offset. */
function doneAtArg(v: unknown, tz: string | null, nowMs = Date.now()): string {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(v.trim()) : null;
  if (!m) throw new Bad("done_at must be a local time like 2026-10-14 16:30, a date like 2026-10-14, or ISO 8601 with an offset.");
  const [, y, mo, d, h = "12", mi = "00", sec = "00", zone] = m;
  dayArg(`${y}-${mo}-${d}`, "done_at");
  if (+h > 23) throw new Bad("done_at's hour must be 0 to 23.");
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
  let ms: number;
  if (zone) {
    const z = zone.toUpperCase() === "Z" ? 0 : (zone[0] === "-" ? -1 : 1) * (+zone.slice(1, 3) * 60 + +zone.slice(-2));
    ms = wall - z * 60000;
  } else {
    ms = wall - zoned(wall, tz).off * 60000;
    ms = wall - zoned(ms, tz).off * 60000; // settle the offset near a clock change
  }
  if (ms > nowMs + 5 * 60000) throw new Bad("done_at can't be in the future.");
  if (ms < Date.UTC(2000, 0, 1)) throw new Bad("done_at is too far back.");
  return new Date(ms).toISOString();
}
function minutesArg(v: unknown): number {
  const n = typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 10080) throw new Bad("actual_minutes must be a whole number of minutes from 1 to 10080.");
  return n;
}

const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

function hoursArg(v: unknown): number {
  const n = typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 168) throw new Bad("hours must be a whole number from 1 to 168.");
  return n;
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Scheduled task hours in each of the next weeks (Monday first), as the Roadmap counts them: every repeat counts. */
function weekLoad(t: Tree, free: number, today = new Date(), weeks = 4) {
  const rows = [...t.byId.values()].filter((r) => !r.repeat_rule);
  const mon = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  mon.setUTCDate(mon.getUTCDate() - (mon.getUTCDay() + 6) % 7);
  return Array.from({ length: weeks }, (_, i) => {
    const a = new Date(mon); a.setUTCDate(a.getUTCDate() + i * 7);
    const b = new Date(a); b.setUTCDate(b.getUTCDate() + 6);
    const from = ymd(a), to = ymd(b);
    const h = [...rows.filter((r) => r.day && r.day >= from && r.day <= to), ...t.occBetween(from, to)].reduce((s, r) => s + (r.duration_min || 60) / 60, 0);
    const hours = Math.round(h * 2) / 2;
    return { week_of: from, scheduled_hours: hours, ...(hours > free ? { over_by: Math.round((hours - free) * 2) / 2 } : {}) };
  });
}

/** A note as Claude reads it back: local times, and the tasks it mentions by name. */
function noteOut(t: Tree, n: Note) {
  const tasks = n.task_ids.map((id) => { try { const r = t.get(id); return { id, title: r.title, ...(t.isDone(r) ? { done: true } : {}) }; } catch { return { id, title: null, deleted: true }; } });
  return { id: n.id, from: n.author, title: n.title, message: n.body, link: n.link, ...(tasks.length ? { tasks } : {}), posted_at: localStamp(n.created_at, t.tz), read: !!n.read_at, ...(n.read_at ? { read_at: localStamp(n.read_at, t.tz) } : {}) };
}

export async function runTool(name: string, args: Record<string, unknown>, db: Db): Promise<unknown> {
  if (name === "set_free_hours") { const h = hoursArg(args.hours); await db.setFreeHours(h); return { free_hours_per_week: h }; }
  const t = new Tree(await db.load());
  if (["list_tasks", "list_projects", "get_item", "update_item", "add_task", "post_note", "list_notes"].includes(name)) t.tz = await db.timeZone();
  const today = () => zoned(Date.now(), t.tz).date;
  switch (name) {
    case "get_free_hours": {
      const set = await db.getFreeHours(), free = set ?? FREE_DEFAULT;
      return { free_hours_per_week: free, ...(set == null ? { note: `Not set yet; the Roadmap assumes ${FREE_DEFAULT}.` } : {}), weeks: weekLoad(t, free) };
    }
    case "list_tasks": {
      const from = has(args, "from") ? dayArg(args.from, "from") : null;
      const to = has(args, "to") ? dayArg(args.to, "to") : null;
      const under = has(args, "project_id") ? t.get(args.project_id) : null;
      const words = typeof args.query === "string" ? args.query.toLowerCase().split(/\s+/).filter(Boolean) : [];
      let rows = [...t.byId.values()].filter((r) => !t.isProject(r));
      const since = has(args, "done_since") ? dayArg(args.done_since, "done_since") : null;
      // With dates, a repeating task is each of its repeats in the range; without, the series itself
      if (from || to) {
        const lo = from ?? (to! < today() ? to! : today()), hi = to ?? addDays(lo, 31);
        rows = rows.filter((r) => !r.repeat_rule).concat(hi >= lo ? t.occBetween(lo, hi < addDays(lo, 366) ? hi : addDays(lo, 366)) : []);
      } else if (since) rows = rows.concat([...t.occLive.values()].filter((r) => r.done));
      if (since) rows = rows.filter((r) => r.done && r.done_at && zoned(Date.parse(r.done_at), t.tz).date >= since);
      else if (!args.include_done) rows = rows.filter((r) => !r.done);
      if (args.unscheduled) rows = rows.filter((r) => !r.day && !t.ancestors(r).some((a) => a.day));
      if (from) rows = rows.filter((r) => r.day && r.day >= from);
      if (to) rows = rows.filter((r) => r.day && r.day <= to);
      if (under) rows = rows.filter((r) => t.ancestors(r).includes(under));
      if (words.length) rows = rows.filter((r) => words.every((w) => r.title.toLowerCase().includes(w)));
      if (since) rows.sort((a, b) => (a.done_at ?? "").localeCompare(b.done_at ?? ""));
      else rows.sort((a, b) => (a.day ?? "9999").localeCompare(b.day ?? "9999") || (a.start_min ?? 1e4) - (b.start_min ?? 1e4) || (a.day_sort ?? a.sort) - (b.day_sort ?? b.sort));
      const out = rows.slice(0, 300).map((r) => t.describe(r));
      return rows.length > 300 ? { tasks: out, note: `Showing 300 of ${rows.length}. Narrow it down with dates or a project.` } : { tasks: out };
    }
    case "post_note": {
      const title = textArg(args.title, "title", 120).trim(), body = textArg(args.message, "message", 6000).trim();
      if (!title) throw new Bad("title can't be empty.");
      if (!body) throw new Bad("message can't be empty.");
      if (!has(args, "link")) throw new Bad("link is required: the address of this Claude chat, so the person can come back to it.");
      const link = linkArg(args.link);
      const author = has(args, "from") ? textArg(args.from, "from", 40).trim() || "Claude" : "Claude";
      const raw = has(args, "task_ids") ? args.task_ids : [];
      if (!Array.isArray(raw)) throw new Bad("task_ids must be a list of item ids.");
      if (raw.length > 50) throw new Bad("task_ids can list up to 50 items.");
      const task_ids = [...new Set(raw.map((id) => t.get(id).id))];
      const n = await db.addNote({ author, title, body, link, task_ids });
      return { posted: noteOut(t, n) };
    }
    case "list_notes": {
      const unread = has(args, "unread_only") ? boolArg(args.unread_only, "unread_only") : false;
      const lim = has(args, "limit") ? Number(args.limit) : 20;
      if (!Number.isInteger(lim) || lim < 1 || lim > 100) throw new Bad("limit must be a whole number from 1 to 100.");
      const notes = await db.listNotes(lim, unread);
      return { notes: notes.map((n) => noteOut(t, n)), ...(notes.length ? {} : { note: unread ? "No unread notes." : "No notes yet." }) };
    }
    case "list_projects": {
      const rows = [...t.byId.values()].filter((r) => t.isProject(r) && (args.include_done || !t.isDone(r)));
      rows.sort((a, b) => t.ancestors(a).length - t.ancestors(b).length || a.sort - b.sort);
      return { areas: t.areas.map((a) => a.title), projects: rows.map((r) => t.describe(r)) };
    }
    case "get_item": {
      const r = t.get(args.id);
      return { ...t.describe(r, true), steps: t.children(r.id).map((c) => t.describe(c)) };
    }
    case "add_task": {
      const f: Partial<Row> = { title: textArg(args.title, "title", 500).trim() };
      if (!f.title) throw new Bad("title can't be empty.");
      if (has(args, "project_id")) f.parent_id = t.get(args.project_id).id;
      if (has(args, "area")) { if (f.parent_id) throw new Bad("Give either project_id or area, not both."); f.area_id = t.area(args.area).id; }
      if (has(args, "day")) f.day = dayArg(args.day, "day");
      if (has(args, "start_time")) { if (!f.day) throw new Bad("start_time needs a day."); f.start_min = timeArg(args.start_time); }
      if (has(args, "duration_minutes")) f.duration_min = durArg(args.duration_minutes);
      if (has(args, "notes")) f.notes = textArg(args.notes, "notes", 20000) || null;
      if (has(args, "link")) f.link = linkArg(args.link);
      if (has(args, "due")) f.due = dayArg(args.due, "due");
      roadmapArgs(t, args, f);
      if (has(args, "repeat")) {
        if (f.milestone) throw new Bad("A repeating task can't be a milestone.");
        if (!f.day) f.day = today();
        f.repeat_rule = repeatArg(args.repeat, f.day);
      }
      const r = newRow(f);
      await db.save([r]);
      return { added: t.with([r]).describe(r) };
    }
    case "add_project": {
      const used = new Set([...t.byId.values()].filter((r) => r.parent_id == null && r.color).map((r) => r.color));
      const f: Partial<Row> = { title: textArg(args.title, "title", 500).trim(), color: PALETTE.find((c) => !used.has(c)) ?? PALETTE[t.byId.size % PALETTE.length] };
      if (!f.title) throw new Bad("title can't be empty.");
      if (has(args, "area")) { f.area_id = t.area(args.area).id; f.color = "area"; } // wears its area's colour
      if (has(args, "notes")) f.notes = textArg(args.notes, "notes", 20000) || null;
      if (has(args, "link")) f.link = linkArg(args.link);
      if (has(args, "due")) f.due = dayArg(args.due, "due");
      roadmapArgs(t, args, f);
      const r = newRow(f);
      await db.save([r]);
      return { added: { id: r.id, title: r.title, ...(f.area_id ? { area: t.area(f.area_id).title } : {}), ...(r.start ? { start: r.start } : {}), ...(r.due ? { due: r.due } : {}) } };
    }
    case "add_steps": {
      const p = t.get(args.parent_id);
      if (p.repeat_rule || p.series_id) throw new Bad("A repeating task can't have steps.");
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
      const occ = !!r.series_id, series = !!r.repeat_rule, before = { ...r };
      if (occ) {
        // One day's repeat: changing it stores it. How it repeats, and where it sits, belong to the series.
        if (has(args, "repeat")) {
          if (Object.keys(args).some((k) => k !== "id" && k !== "repeat" && has(args, k))) throw new Bad(`repeat changes the whole series; pass it on its own, or use the series_id (${r.series_id}).`);
          return runTool(name, { id: r.series_id, repeat: args.repeat }, db);
        }
        for (const k of ["project_id", "area", "start", "due", "milestone", "hard_deadline"]) if (has(args, k)) throw new Bad(`${k} belongs to the whole series; pass its series_id (${r.series_id}) instead.`);
      }
      if (series) {
        if (has(args, "done") || has(args, "done_at") || has(args, "actual_minutes")) throw new Bad("Check off one day's repeat, not the whole series: list_tasks with from and to gives each repeat's id.");
        if (has(args, "day") && args.day === null) throw new Bad("A repeating task needs the day it starts. To stop it repeating, pass repeat: null.");
        if (args.milestone === true || args.hard_deadline === true) throw new Bad("A repeating task can't be a milestone.");
      }
      if (has(args, "title")) { r.title = textArg(args.title, "title", 500).trim(); if (!r.title) throw new Bad("title can't be empty."); }
      if (has(args, "day")) {
        const d = args.day === null ? null : dayArg(args.day, "day");
        if (d !== r.day && series) r.day = d; // the day the series starts; its time stays
        else if (d !== r.day) { r.day = d; r.start_min = null; r.after_min = null; r.day_sort = now(); }
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
      roadmapArgs(t, args, r);
      if (has(args, "project_id")) {
        if (args.project_id === null) r.parent_id = null;
        else {
          const p = t.get(args.project_id);
          if (p.id === r.id || t.ancestors(p).some((a) => a.id === r.id)) throw new Bad("Can't move an item under itself or one of its own steps.");
          r.parent_id = p.id;
        }
        r.sort = now();
      }
      if (has(args, "area")) {
        if (r.parent_id != null) throw new Bad("Only top-level projects and tasks sit in an area; this item is inside another project.");
        if (args.area === null && r.color === "area") r.color = t.areaOf(r)?.color ?? null; // keep the colour it had
        r.area_id = args.area === null ? null : t.area(args.area).id;
      }
      // done_at isn't sent unless set on purpose, so the database stamps check-offs itself
      const k = t.children(r.id);
      delete r.done_at;
      if (has(args, "actual_minutes")) {
        if (k.length) throw new Bad("actual_minutes is for a task; set it on the steps.");
        r.actual_minutes = args.actual_minutes === null || args.actual_minutes === "" ? null : minutesArg(args.actual_minutes);
      }
      const at = has(args, "done_at") ? doneAtArg(args.done_at, t.tz) : undefined;
      if (has(args, "done")) {
        const done = boolArg(args.done, "done");
        if (at && !done) throw new Bad("done_at is for a finished item; it can't go with done: false.");
        if (k.length) {
          for (const l of t.leaves(r)) if (l.done !== done || at) { const c: Row = { ...l, done }; delete c.done_at; if (at) c.done_at = at; changed.push(c); }
        } else r.done = done;
      } else if (at && (k.length ? !t.isDone(r) : !r.done)) throw new Bad("This isn't checked off yet; pass done: true with done_at.");
      else if (at && k.length) for (const l of t.leaves(r)) { const c: Row = { ...l }; c.done_at = at; changed.push(c); }
      if (at && !k.length) r.done_at = at;
      if (has(args, "repeat")) {
        if (args.repeat === null) {
          if (series) { // a plain task again, on its next repeat's day; its stored repeats that aren't done go
            const next = t.occBetween(today() > r.day! ? today() : r.day!, addDays(today() > r.day! ? today() : r.day!, 400)).find((o) => o.series_id === r.id && !o.done);
            r.repeat_rule = null; r.day = next?.day ?? r.day; r.done = false;
            if (next) for (const k of SHARED) (r as Record<string, unknown>)[k] = next[k] ?? null;
            for (const o of t.occLive.values()) if (o.series_id === r.id && !o.done) changed.push({ ...o, deleted: true, occurs_on: null });
          }
        } else {
          if (k.length) throw new Bad("A project can't repeat; make one of its tasks repeat instead.");
          if (!series && (r.milestone || r.hard_deadline)) throw new Bad("A milestone can't repeat.");
          if (!r.day) r.day = today();
          r.repeat_rule = repeatArg(args.repeat, r.day);
          r.done = false;
        }
      }
      if (r.repeat_rule && r.repeat_rule.until && r.day && r.repeat_rule.until < r.day) throw new Bad(`The series would end (${r.repeat_rule.until}) before it starts (${r.day}).`);
      if (series && r.repeat_rule) {
        // A change to the series goes to its stored repeats that were still the same as the series (not done ones),
        // and those no longer on its days (a new rule, start or end) go
        for (const o0 of t.occLive.values()) {
          if (o0.series_id !== r.id || o0.done) continue;
          const o = { ...o0 }; let ch = false;
          for (const key of FOLLOW) if ((r[key] ?? null) !== (before[key] ?? null) && (o[key] ?? null) === (before[key] ?? null)) { (o as Record<string, unknown>)[key] = r[key]; ch = true; }
          if (!repeatsOn(r.repeat_rule, r.day, o.occurs_on!)) { o.deleted = true; o.occurs_on = null; ch = true; }
          if (ch) changed.push(o);
        }
      }
      if (occ && !r.day) { r.deleted = true; r.start_min = null; r.day = before.day; } // a repeat taken off the plan is skipped
      changed.unshift(r);
      await db.save(changed);
      if (r.deleted) return { skipped: { id: r.id, title: r.title, day: r.occurs_on, series_id: r.series_id } };
      for (const c of changed) if (c.done_at === undefined) { const o = t.byId.get(c.id) ?? t.occLive.get(c.id); c.done_at = !c.done ? null : o?.done ? o.done_at ?? null : new Date().toISOString(); } // what the database stamped
      const after = t.with(changed);
      return { updated: after.describe(after.get(r.id)), ...(changed.length > 1 ? { [series ? "stored_repeats_changed" : "steps_changed"]: changed.length - 1 } : {}) };
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
