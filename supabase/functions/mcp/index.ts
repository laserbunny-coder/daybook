// The Daybook connector for Claude (an MCP server). Its address carries a
// secret made in the app under "Connect to Claude"; whoever has the address
// can read and change that person's tasks, so it's treated like a password.
import { admin, cors } from "../_shared/common.ts";
import { type Db, handle, type Row } from "./tools.ts";

const COLS = "id,parent_id,title,notes,done,day,start_min,after_min,duration_min,sort,day_sort,color,due,link,kind,area_id,start,milestone,hard_deadline,waits_on,deleted";

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
  const m = /\/mcp\/([0-9a-f]{48})\/?$/.exec(url.pathname);
  if (m) return m[1];
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  return /^[0-9a-f]{48}$/.test(bearer) ? bearer : null;
}

function dbFor(userId: string): Db {
  const sb = admin();
  return {
    async load() {
      const rows: Row[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("items").select(COLS).eq("user_id", userId).eq("deleted", false).order("id").range(from, from + 999);
        if (error) throw error;
        rows.push(...(data as Row[]));
        if (data.length < 1000) return rows;
      }
    },
    async save(rows) {
      const { error } = await sb.from("items").upsert(rows.map((r) => ({ ...r, user_id: userId })));
      if (error) throw error;
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });

  const token = tokenFrom(req);
  const { data: owner } = token
    ? await admin().from("mcp_tokens").select("user_id").eq("token_hash", await sha256(token)).maybeSingle()
    : { data: null };
  if (!owner) {
    return new Response(JSON.stringify({ error: "This Daybook connector address isn't valid. Make a new one in Daybook under Connect to Claude." }), { status: 404, headers });
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
