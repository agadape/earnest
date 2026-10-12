-- Wallets that have walked the museum. Run this once in the Supabase SQL editor.
--
-- A row says: a browser with this wallet connected opened the museum, first and last at these
-- times. The app's server writes it; nothing else may read or write the table. The address is
-- taken as the browser sent it and nobody signs for it, so a row proves nothing about who was
-- there. It is used for one thing: the figures that stroll the rooms when their owners are away.

create table if not exists public.visitors (
  wallet     text        primary key,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

alter table public.visitors enable row level security;

create index if not exists visitors_last_seen on public.visitors (last_seen desc);
