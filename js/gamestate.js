// Saved progress for Quest and Task Dragon, kept in its own table (game_state) so every device agrees.
// It used to live on the account (user_metadata), which rides inside every sign-in token; it grew big enough
// that file uploads were refused. Reading still falls back to what's on the account, for anything not moved yet.
let client = null, uid = null, data = {}, loading = null;

/** Fetches this person's saved progress (once per sign-in, or again with again = true). */
export function load(c, u, again = false) {
  if (!c || !u) return Promise.resolve(data);
  if (uid !== u.id) { uid = u.id; data = {}; loading = null; }
  client = c;
  if (!loading || again) loading = c.from('game_state').select('data').eq('user_id', u.id).maybeSingle()
    .then(({ data: row, error }) => { if (error) throw error; if (row?.data) data = row.data; return data; })
    .catch(() => { loading = null; return data; });
  return loading;
}
/** The account as the games read it: the saved progress laid over whatever is still on the account. */
export function view(u) { return u ? { ...u, user_metadata: { ...(u.user_metadata || {}), ...data } } : u; }
export const get = k => data[k];
/** Saves just these keys; the other game's keys are left as they are. */
export function save(patch) {
  Object.assign(data, patch);
  if (!client || !uid) return Promise.resolve();
  return client.rpc('game_state_merge', { patch }).then(({ error }) => { if (error) throw error; }).catch(() => {});
}
