-- nandedakke.com — Supabase schema for cloud session sync.
--
-- Run this once in your Supabase project: Dashboard → SQL Editor → paste → Run.
-- Each learning session is stored as a single row whose `data` column holds the
-- full SessionExport JSON (the same shape as the app's export/import file).
--
-- Security model: Row Level Security is the boundary. Every row is stamped with
-- the owner's auth.uid(), and the policies below let a signed-in user read and
-- write ONLY their own rows. The browser ships the anon key (public by design);
-- RLS — not the key — is what keeps one user's sessions private from another.

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

-- A user can see only their own sessions.
drop policy if exists rgraph_sessions_select on public.rgraph_sessions;
create policy rgraph_sessions_select on public.rgraph_sessions
  for select using (auth.uid() = user_id);

-- ...and insert/update/delete only their own (the WITH CHECK stops a client
-- from writing a row owned by someone else).
drop policy if exists rgraph_sessions_modify on public.rgraph_sessions;
create policy rgraph_sessions_modify on public.rgraph_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
