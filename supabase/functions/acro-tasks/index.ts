// Keeps Michael's Acro HQ board tasks and Daybook's Business area in step (see sync.ts). Woken every 2 minutes
// by the database job (migrations/20261103030000_acro_tasks.sql). A wake carries nothing: it only goes and
// looks, through HQ's Acro Meta connector (the ACRO_CONNECTOR_URL secret), so anyone calling it can at most
// make it look. One run at a time (a lock in acro_task_sync).
import { admin, json } from "../_shared/common.ts";
import { callTool } from "../inkwell/acro.ts";
import { BY, type Item, type Link, plan, type Task } from "./sync.ts";

const BOARD_URL = "https://acro-hq.laserbunny.workers.dev";
const CUT = "(cut; board_get has all of it)";
const COLS = "id,parent_id,title,notes,done,due,link,kind,area_id,deleted,sort,repeat_rule,series_id,habit";

async function boardTasks(url: string): Promise<Task[]> {
  const out: Task[] = [];
  for (let offset = 0; offset < 5000; offset += 200) {
    const r = await callTool(url, "board_list", { collection: "tasks", limit: 200, offset });
    const docs = (r.docs ?? []) as Task[];
    out.push(...docs.map((d) => ({ id: d.id, version: Number(d.version), data: d.data ?? {} })));
    if (docs.length < 200) break;
  }
  // board_list shortens long notes; fetch the whole task for those
  for (const t of out) {
    if (typeof t.data.notes === "string" && t.data.notes.endsWith(CUT)) {
      const d = await callTool(url, "board_get", { collection: "tasks", id: t.id }) as unknown as Task;
      t.data = d.data ?? t.data; t.version = Number(d.version);
    }
  }
  return out;
}

export async function run() {
  const url = Deno.env.get("ACRO_CONNECTOR_URL");
  if (!url || !/^https:\/\//.test(url)) return { skipped: "no connector address" };
  const db = admin();
  const { data: areas, error: aErr } = await db.from("items").select("id,user_id").eq("kind", "area").eq("title", "Business").eq("deleted", false);
  if (aErr) throw aErr;
  const want = Deno.env.get("ACRO_DAYBOOK_USER");
  const area = (areas ?? []).find((a) => !want || a.user_id === want);
  if (!area || (!want && (areas ?? []).length > 1)) return { skipped: "no single Business area" };
  const userId = area.user_id as string;

  // One run at a time: take the lock for 90 seconds.
  const nowIso = new Date().toISOString();
  const { data: state } = await db.from("acro_task_sync").select("*").eq("user_id", userId).maybeSingle();
  const firstRun = !state;
  if (!state) {
    const { error } = await db.from("acro_task_sync").insert({ user_id: userId, locked_until: new Date(Date.now() + 90e3).toISOString() });
    if (error) return { skipped: "another run started" };
  } else {
    const { data: got } = await db.from("acro_task_sync").update({ locked_until: new Date(Date.now() + 90e3).toISOString() })
      .eq("user_id", userId).lt("locked_until", nowIso).select("user_id");
    if (!got?.length) return { skipped: "another run is going" };
  }

  const done: string[] = [], failed: string[] = [];
  try {
    const [tasks, itemsRes, linksRes] = await Promise.all([
      boardTasks(url),
      db.from("items").select(COLS).eq("user_id", userId).limit(10000),
      db.from("acro_task_links").select("item_id,task_id,seen").eq("user_id", userId).limit(10000),
    ]);
    if (itemsRes.error) throw itemsRes.error;
    if (linksRes.error) throw linksRes.error;
    const steps = plan({
      tasks, items: (itemsRes.data ?? []) as Item[], links: (linksRes.data ?? []) as Link[],
      businessId: area.id as string, userId, firstRun, now: Date.now(), boardUrl: BOARD_URL, newId: () => crypto.randomUUID(),
    });
    for (const st of steps) {
      const name = `${st.why}: ${st.link?.task_id ?? st.unlink ?? st.link?.item_id}`;
      try {
        if (st.board) await callTool(url, "board_write", { by: BY, writes: [st.board] });
        if (st.insertItem) { const { error } = await db.from("items").insert(st.insertItem); if (error) throw error; }
        if (st.item) { const { error } = await db.from("items").update(st.item.patch).eq("id", st.item.id).eq("user_id", userId); if (error) throw error; }
        if (st.link) {
          const { error } = await db.from("acro_task_links").upsert({ ...st.link, user_id: userId, updated_at: new Date().toISOString() });
          if (error) throw error;
        }
        if (st.unlink) await db.from("acro_task_links").delete().eq("item_id", st.unlink).eq("user_id", userId);
        done.push(name);
      } catch (e) {
        // A refused board write (someone changed the task this moment) is simply tried again next run.
        console.log("acro-tasks step failed", name, (e as Error)?.message || e);
        failed.push(name);
      }
    }
  } finally {
    await db.from("acro_task_sync").update({ locked_until: new Date(0).toISOString(), last_run: new Date().toISOString(), last_result: { done: done.length, failed } }).eq("user_id", userId);
  }
  return { firstRun, done, failed };
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Not found" }, 404);
  try {
    const r = await run();
    return json({ ok: true, done: (r as any).done?.length ?? 0, failed: (r as any).failed?.length ?? 0, skipped: (r as any).skipped });
  } catch (e) {
    console.error("acro-tasks failed", e);
    return json({ ok: false }, 500);
  }
});
