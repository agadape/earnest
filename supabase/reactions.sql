-- Reactions to campaigns. Run this once in the Supabase SQL editor.
--
-- A row says: this wallet reacted to this campaign in this way. The primary key is what makes
-- it one reaction of each kind per wallet. Rows are only ever written by the app's server,
-- after it has checked a message signed by that wallet; nothing else may read or write the
-- table, which is what row level security without any policy means.

create table if not exists public.reactions (
  campaign   text        not null,
  wallet     text        not null,
  kind       text        not null check (kind in ('want', 'clever', 'watching')),
  created_at timestamptz not null default now(),
  primary key (campaign, wallet, kind)
);

alter table public.reactions enable row level security;

create index if not exists reactions_wallet on public.reactions (wallet);

-- How many reactions of each kind every campaign has.
create or replace function public.reaction_counts()
returns table (campaign text, kind text, n bigint)
language sql
stable
as $$
  select campaign, kind, count(*) from public.reactions group by campaign, kind
$$;

revoke all on function public.reaction_counts() from anon, authenticated;
