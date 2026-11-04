-- Облік рейсів — схема бази даних Supabase.
-- Виконайте один раз: Supabase → SQL Editor → New query → вставте цей файл → Run.

create table if not exists public.app_data (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  key        text        not null check (key in ('trips', 'drivers', 'cars', 'settings')),
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Час зміни завжди ставить сервер
create or replace function public.app_data_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists app_data_touch on public.app_data;
create trigger app_data_touch
  before insert or update on public.app_data
  for each row execute function public.app_data_touch();

-- Row Level Security: кожен користувач бачить і змінює лише власні дані
alter table public.app_data enable row level security;

drop policy if exists "own rows: select" on public.app_data;
drop policy if exists "own rows: insert" on public.app_data;
drop policy if exists "own rows: update" on public.app_data;
drop policy if exists "own rows: delete" on public.app_data;

create policy "own rows: select" on public.app_data
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.app_data
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own rows: update" on public.app_data
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows: delete" on public.app_data
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.app_data from anon;
grant select, insert, update, delete on public.app_data to authenticated;
