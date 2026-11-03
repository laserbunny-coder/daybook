-- The Quest and Task Dragon games kept their saved progress on the account (auth user_metadata). It grew to
-- ~11 KB, and since user_metadata rides inside every sign-in token, uploads to file storage started failing
-- with "431 headers too large" (Inkwell recordings). This moves it to its own table, one row per person.

create table if not exists public.game_state (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.game_state enable row level security;
drop policy if exists "own game state" on public.game_state;
create policy "own game state" on public.game_state for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.game_state to authenticated;

-- Saves only the keys sent, so Quest and Task Dragon don't overwrite each other's progress.
create or replace function public.game_state_merge(patch jsonb) returns void
language sql security invoker set search_path = public as $$
  insert into public.game_state (user_id, data) values (auth.uid(), patch)
  on conflict (user_id) do update set data = public.game_state.data || excluded.data, updated_at = now();
$$;
revoke all on function public.game_state_merge(jsonb) from public, anon;
grant execute on function public.game_state_merge(jsonb) to authenticated;

-- The game keys, as kept in user_metadata.
create or replace function public.game_state_keys(md jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(coalesce(md, '{}'::jsonb)) as e(k, v)
  where k like 'quest\_%' or k = 'dragon';
$$;

-- A copy of everyone's metadata as it stood before the move, kept in case anything was missed.
create table if not exists public.game_state_backup (
  user_id uuid primary key,
  user_metadata jsonb not null,
  taken_at timestamptz not null default now()
);
alter table public.game_state_backup enable row level security; -- no policies: only the service role reads it
insert into public.game_state_backup (user_id, user_metadata)
  select id, raw_user_meta_data from auth.users where raw_user_meta_data is not null
  on conflict (user_id) do nothing;

-- Copy the progress over. Nothing is removed from the account here: that happens only once the copy is checked.
insert into public.game_state (user_id, data)
  select id, public.game_state_keys(raw_user_meta_data) from auth.users
  where public.game_state_keys(raw_user_meta_data) <> '{}'::jsonb
  on conflict (user_id) do update set data = excluded.data || public.game_state.data, updated_at = now();

-- A device still running the old app would keep writing game progress onto the account. Catch it on the way in:
-- send those keys to the table and keep them off the account. Never let this get in the way of a sign-in.
create or replace function public.game_state_off_account() returns trigger
language plpgsql security definer set search_path = public as $$
declare g jsonb;
begin
  g := public.game_state_keys(new.raw_user_meta_data);
  if g = '{}'::jsonb then return new; end if;
  begin
    insert into public.game_state (user_id, data) values (new.id, g)
    on conflict (user_id) do update set data = public.game_state.data || excluded.data, updated_at = now();
    new.raw_user_meta_data := new.raw_user_meta_data - array(select jsonb_object_keys(g));
  exception when others then
    raise warning 'game_state_off_account: %', sqlerrm; -- keep the account update as it was
  end;
  return new;
end;
$$;
revoke all on function public.game_state_off_account() from public, anon, authenticated;
