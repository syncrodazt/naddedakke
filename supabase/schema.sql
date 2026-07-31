-- nandedakke.com — Supabase schema for cloud session sync and sharing.
--
-- Run this in your Supabase project: Dashboard → SQL Editor → paste → Run.
-- It is idempotent: re-running it after an app update is how you pick up new
-- policies, and it will not touch your data.
--
-- Each learning session is stored as a single row whose `data` column holds the
-- full SessionExport JSON (the same shape as the app's export/import file).
--
-- Security model: Row Level Security is the boundary. Every row is stamped with
-- the owner's auth.uid(). The browser ships the anon key (public by design);
-- RLS — not the key — is what keeps one user's notebooks private from another.

create table if not exists public.rgraph_sessions (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text,
  updated_at  timestamptz not null default now(),
  data        jsonb not null
);

create index if not exists rgraph_sessions_user_id_idx
  on public.rgraph_sessions (user_id);

alter table public.rgraph_sessions enable row level security;


-- ---------------------------------------------------------------------------
-- Sharing
-- ---------------------------------------------------------------------------
--
-- A notebook is PRIVATE unless a share link exists for it. Sharing is by link
-- rather than by invited email address, because the browser cannot look a user
-- up by email — auth.users is not readable from the client — so an email invite
-- would need a server the rest of this app does not have.
--
-- `token` is the secret: it is the unguessable part of the URL, and holding it
-- is what grants access. `role` decides whether that access can write.
-- `is_public` marks a link published Notion-style, which is the same mechanism
-- with the secret deliberately made shareable.
--
-- One link per (session, role) so revoking "can edit" does not also revoke
-- "can read", and re-sharing hands out the same URL rather than a new one.

create table if not exists public.rgraph_shares (
  token       text primary key,
  session_id  text not null references public.rgraph_sessions (id) on delete cascade,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role        text not null check (role in ('viewer', 'editor')),
  is_public   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (session_id, role)
);

create index if not exists rgraph_shares_session_idx on public.rgraph_shares (session_id);

alter table public.rgraph_shares enable row level security;

-- Only the owner manages a notebook's links.
drop policy if exists rgraph_shares_owner on public.rgraph_shares;
create policy rgraph_shares_owner on public.rgraph_shares
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Anyone holding a token may read that single row, which is how the app turns a
-- URL into "which notebook, and may I write to it?". Knowing the token is the
-- credential, so this reveals nothing the token did not already grant. A
-- recipient never LISTS shares — the client always filters by the exact token.
drop policy if exists rgraph_shares_by_token on public.rgraph_shares;
create policy rgraph_shares_by_token on public.rgraph_shares
  for select using (true);


-- ---------------------------------------------------------------------------
-- Session policies
-- ---------------------------------------------------------------------------
--
-- The share token travels as a request header, not as part of a payload the
-- client controls: `request.headers` is populated by PostgREST from the actual
-- HTTP request, so a grant cannot be forged by editing a row being written.

create or replace function public.rgraph_share_token()
  returns text
  language sql
  stable
as $$
  select nullif(current_setting('request.headers', true)::json ->> 'x-rgraph-share', '');
$$;

-- Does the presented token grant `needed` access to this session? An 'editor'
-- token also reads, so viewing accepts either role.
--
-- security definer so the check itself can see rgraph_shares regardless of who
-- is asking; search_path is pinned so the body cannot be redirected.
create or replace function public.rgraph_may(session text, needed text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
      from public.rgraph_shares s
     where s.token = public.rgraph_share_token()
       and s.session_id = session
       and (needed = 'viewer' or s.role = 'editor')
  );
$$;

-- Read: your own notebooks, plus any notebook whose link you are holding.
drop policy if exists rgraph_sessions_select on public.rgraph_sessions;
create policy rgraph_sessions_select on public.rgraph_sessions
  for select using (auth.uid() = user_id or public.rgraph_may(id, 'viewer'));

-- Insert: only ever your own. A share token cannot conjure new notebooks.
drop policy if exists rgraph_sessions_insert on public.rgraph_sessions;
create policy rgraph_sessions_insert on public.rgraph_sessions
  for insert with check (auth.uid() = user_id);

-- Update: the owner, or someone holding an editor link. `with check` repeats the
-- test so an editor cannot re-stamp the row into their own name and walk off
-- with the notebook.
drop policy if exists rgraph_sessions_update on public.rgraph_sessions;
create policy rgraph_sessions_update on public.rgraph_sessions
  for update
  using (auth.uid() = user_id or public.rgraph_may(id, 'editor'))
  with check (auth.uid() = user_id or public.rgraph_may(id, 'editor'));

-- Delete: owner only. Being allowed to edit a notebook is not the same as being
-- allowed to destroy it.
drop policy if exists rgraph_sessions_delete on public.rgraph_sessions;
create policy rgraph_sessions_delete on public.rgraph_sessions
  for delete using (auth.uid() = user_id);

-- Replaced by the four policies above; drop the old catch-all if an earlier
-- version of this file left it behind.
drop policy if exists rgraph_sessions_modify on public.rgraph_sessions;


-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- The app subscribes to this table so a change made elsewhere (another device,
-- a collaborator, or the MCP server writing on Claude's behalf) reaches an open
-- canvas without the learner pressing anything. Realtime honours the policies
-- above, so a subscriber only ever receives rows they may already read.
--
-- Wrapped because adding a table that is already in the publication is an error.
do $$
begin
  alter publication supabase_realtime add table public.rgraph_sessions;
exception
  when duplicate_object then null;
  when undefined_object then
    raise notice 'supabase_realtime publication not found — skipping realtime setup';
end;
$$;
