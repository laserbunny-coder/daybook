// Writes Inkwell's weekly and monthly summaries (see digest.ts). Woken at 4 am
// Los Angeles time by the database's job, which proves itself with the secret
// in push_config. Each run catches up on any finished week (up to eight back)
// or month (up to three back) that has something written and no summary yet,
// a few at a time, so a missed night is made up the next.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { admin, json } from "../_shared/common.ts";
import {
  addDays, dayStart, localDate, MODEL, monthEnd, monthPrompt, monthTitle, MONTH_SYSTEM, periodsDue, type Row, SCHEMA, tidy,
  weekPrompt, weekTitle, WEEK_SYSTEM,
} from "./digest.ts";

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
const COLS = "id,kind,parent_id,title,text,tags,fields,created_at";
const PER_RUN = 6;

type Sb = ReturnType<typeof admin>;

async function ask(system: string, text: string) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: text }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    // @ts-ignore: server-side fallback parameter (beta)
    fallbacks: "default",
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") throw new Error(`summary stopped: ${response.stop_reason}`);
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("no summary came back");
  return JSON.parse(block.text);
}

/** "World › Page" or "Daily page 2026-10-27" for each row, walking up through parents. */
async function placer(sb: Sb, userId: string, rows: Row[]) {
  const known = new Map(rows.map((r) => [r.id, r]));
  let need = [...new Set(rows.map((r) => r.parent_id).filter((x): x is string => !!x && !known.has(x)))];
  for (let i = 0; need.length && i < 40; i++) {
    const { data, error } = await sb.from("writing_entries").select(COLS).eq("user_id", userId).in("id", need.slice(0, 200));
    if (error) throw error;
    for (const r of data as Row[]) known.set(r.id, r);
    need = [...new Set((data as Row[]).map((r) => r.parent_id).filter((x): x is string => !!x && !known.has(x)))];
  }
  return (r: Row): string => {
    const parts: string[] = [];
    for (let x: Row | undefined = r, i = 0; x && i < 60; x = x.parent_id ? known.get(x.parent_id) : undefined, i++) {
      if (x.kind === "day") return [`Daily page ${x.id.slice(4)}`, ...parts].join(" › ");
      if (["world", "project", "page", "chapter"].includes(x.kind) && x !== r) parts.unshift(x.title || "Untitled");
    }
    return parts.join(" › ") || "Loose";
  };
}

async function save(sb: Sb, userId: string, row: Record<string, unknown>) {
  const { error } = await sb.from("writing_entries").upsert({ ...row, user_id: userId, sort: 0, content: null, tags: [], links: [], deleted: false, type: null, area_id: null });
  if (error) throw error;
}

async function forUser(sb: Sb, userId: string, tz: string, budget: { left: number }, force: boolean) {
  const today = localDate(Date.now(), tz);
  const due = periodsDue(today);
  const made: string[] = [];
  const { data: have, error } = await sb.from("writing_entries").select("id").eq("user_id", userId).eq("kind", "digest").eq("deleted", false);
  if (error) throw error;
  const exists = new Set((have ?? []).map((r) => r.id));

  let behind = false;
  for (const monday of due.weeks) {
    const id = `dg-week-${monday}`;
    if (exists.has(id) && !force) continue;
    if (budget.left <= 0) { behind = true; break; }
    const { data, error } = await sb.from("writing_entries").select(COLS).eq("user_id", userId).eq("deleted", false)
      .in("kind", ["line", "para", "page", "world", "project"])
      .gte("created_at", dayStart(monday, tz)).lt("created_at", dayStart(addDays(monday, 7), tz))
      .order("created_at").limit(5000);
    if (error) throw error;
    const rows = data as Row[];
    const where = await placer(sb, userId, rows);
    const p = weekPrompt(rows, where);
    if (!p.labels.length && !p.paragraphs) continue;
    budget.left--;
    const out = tidy(await ask(WEEK_SYSTEM, `${weekTitle(monday)}\n\n${p.text}`), p.labels, "L");
    if (!out.summary) continue;
    await save(sb, userId, {
      id, kind: "digest", parent_id: null, title: weekTitle(monday), text: out.summary,
      fields: { period: "week", from: monday, to: addDays(monday, 6), threads: out.threads, keywords: out.keywords, lines: p.lines, paragraphs: p.paragraphs, by: "claude", edited_by: "claude", model: MODEL },
    });
    exists.add(id);
    made.push(id);
  }

  // Months are written from their weeks, so only once the weeks are caught up.
  for (const month of behind ? [] : due.months) {
    const id = `dg-month-${month}`;
    if ((exists.has(id) && !force) || budget.left <= 0) continue;
    const { data, error } = await sb.from("writing_entries").select(COLS).eq("user_id", userId).eq("kind", "digest").eq("deleted", false)
      .like("id", `dg-week-${month}-%`).order("id");
    if (error) throw error;
    const weeks = data as Row[];
    if (!weeks.length) continue;
    const p = monthPrompt(weeks);
    budget.left--;
    const out = tidy(await ask(MONTH_SYSTEM, `${monthTitle(month)}\n\n${p.text}`), p.labels, "W");
    if (!out.summary) continue;
    await save(sb, userId, {
      id, kind: "digest", parent_id: null, title: monthTitle(month), text: out.summary,
      fields: { period: "month", from: `${month}-01`, to: monthEnd(month), threads: out.threads, keywords: out.keywords, weeks: weeks.map((w) => w.id), by: "claude", edited_by: "claude", model: MODEL },
    });
    exists.add(id);
    made.push(id);
  }
  return made;
}

Deno.serve(async (req) => {
  const sb = admin();
  const { data: cfg } = await sb.from("push_config").select("cron_secret").eq("id", 1).single();
  if (!cfg || req.headers.get("x-cron-secret") !== cfg.cron_secret) return json({ error: "Not allowed" }, 401);
  const body = await req.json().catch(() => ({})) as { force?: boolean };
  const { data: users, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) return json({ error: error.message }, 500);
  const budget = { left: PER_RUN };
  const made: Record<string, string[]> = {};
  for (const u of users.users) {
    const tz = typeof u.user_metadata?.tz === "string" && u.user_metadata.tz ? u.user_metadata.tz : "America/Los_Angeles";
    try {
      const got = await forUser(sb, u.id, tz, budget, !!body.force);
      if (got.length) made[u.id] = got;
    } catch (e) {
      console.error("digest", u.id, e);
    }
    if (budget.left <= 0) break;
  }
  return json({ made });
});
