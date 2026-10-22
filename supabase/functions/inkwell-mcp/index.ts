// The Inkwell connector for Claude (an MCP server). Its address carries a
// secret made in Inkwell under "Connect Claude to Inkwell"; whoever has the
// address can read that person's writing and add to it, so it's treated like
// a password. It's a separate secret from Daybook's connector.
import { admin, cors } from "../_shared/common.ts";
import { type Db, type Entry, handle } from "./tools.ts";

const COLS = "id,kind,parent_id,sort,title,text,content,tags,type,fields,area_id,links,deleted,created_at,updated_at";
// The outline leaves out the words, which is most of the size.
const SHAPE_COLS = "id,kind,parent_id,sort,title,type,fields,area_id,deleted,created_at,updated_at";
const SHAPE_KINDS = ["area", "world", "project", "page", "act", "chapter"];

const headers = {
  ...cors,
  "Access-Control-Allow-Headers": cors["Access-Control-Allow-Headers"] + ", mcp-session-id, mcp-protocol-version",
  "Content-Type": "application/json",
};

async function sha256(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function tokenFrom(req: Request): string | null {
  const url = new URL(req.url);
  const m = /\/inkwell-mcp\/([0-9a-f]{48})\/?$/.exec(url.pathname);
  if (m) return m[1];
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  return /^[0-9a-f]{48}$/.test(bearer) ? bearer : null;
}

const full = (r: Partial<Entry>): Entry => ({ text: "", content: null, tags: [], links: [], ...r } as Entry);

function dbFor(userId: string): Db {
  const sb = admin();
  const all = async (cols: string, build: (q: any) => any) => {
    const rows: Entry[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await build(sb.from("writing_entries").select(cols).eq("user_id", userId)).order("id").range(from, from + 999);
      if (error) throw error;
      rows.push(...(data as Entry[]).map(full));
      if (data.length < 1000) return rows;
    }
  };
  return {
    outline: () => all(SHAPE_COLS, (q) => q.in("kind", SHAPE_KINDS).eq("deleted", false)),
    async get(ids) {
      if (!ids.length) return [];
      const { data, error } = await sb.from("writing_entries").select(COLS).eq("user_id", userId).in("id", ids.slice(0, 200));
      if (error) throw error;
      return (data as Entry[]).map(full);
    },
    kids: (parentIds) => parentIds.length ? all(COLS, (q) => q.in("parent_id", parentIds.slice(0, 200)).eq("deleted", false)) : Promise.resolve([]),
    async search(words, limit) {
      let q = sb.from("writing_entries").select(COLS).eq("user_id", userId).eq("deleted", false)
        .in("kind", ["line", "para", "heading", "scene", "page", "note", "chapter", "world", "project"]);
      // Every word must appear in the words or the title. Characters that mean
      // something to the filter are dropped from the word.
      for (const w of words.map((x) => x.replace(/[\\%_,()"*]/g, "")).filter(Boolean)) {
        q = q.or(`text.ilike."%${w}%",title.ilike."%${w}%"`);
      }
      const { data, error } = await q.order("updated_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return (data as Entry[]).map(full);
    },
    async insert(rows) {
      if (!rows.length) return;
      const { error } = await sb.from("writing_entries").insert(rows.map((r) => ({ ...r, user_id: userId })));
      if (error) throw error;
    },
    async timeZone() {
      const { data, error } = await sb.auth.admin.getUserById(userId);
      if (error) throw error;
      const tz = data.user?.user_metadata?.tz;
      return typeof tz === "string" && tz ? tz : null;
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });

  const token = tokenFrom(req);
  const { data: owner } = token
    ? await admin().from("inkwell_mcp_tokens").select("user_id").eq("token_hash", await sha256(token)).maybeSingle()
    : { data: null };
  if (!owner) {
    return new Response(JSON.stringify({ error: "This Inkwell connector address isn't valid. Make a new one in Inkwell with Connect Claude to Inkwell." }), { status: 404, headers });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), { status: 400, headers });
  }
  const db = dbFor(owner.user_id);
  const many = Array.isArray(body);
  const out = [];
  for (const m of many ? body as unknown[] : [body]) {
    const r = await handle(m as Parameters<typeof handle>[0], db);
    if (r) out.push(r);
  }
  if (!out.length) return new Response(null, { status: 202, headers });
  return new Response(JSON.stringify(many ? out : out[0]), { headers });
});
