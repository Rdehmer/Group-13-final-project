-- Day attendance clock (arrive / leave work) — separate from job labor punches.
-- Safe to re-run.

create table if not exists public.technician_day_clocks (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles (id) on delete cascade,
  work_date date not null,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint technician_day_clocks_order check (
    clock_out_at is null or clock_out_at > clock_in_at
  )
);

-- At most one open (not yet clocked out) punch per technician
create unique index if not exists technician_day_clocks_one_open
  on public.technician_day_clocks (technician_id)
  where clock_out_at is null;

create index if not exists technician_day_clocks_tech_date_idx
  on public.technician_day_clocks (technician_id, work_date);

create index if not exists technician_day_clocks_date_idx
  on public.technician_day_clocks (work_date);

alter table public.technician_day_clocks enable row level security;

drop policy if exists tech_day_clock_select on public.technician_day_clocks;
create policy tech_day_clock_select on public.technician_day_clocks
  for select to authenticated
  using (
    technician_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager', 'billing')
    )
  );

drop policy if exists tech_day_clock_insert_own on public.technician_day_clocks;
create policy tech_day_clock_insert_own on public.technician_day_clocks
  for insert to authenticated
  with check (
    technician_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager')
    )
  );

drop policy if exists tech_day_clock_update_own on public.technician_day_clocks;
create policy tech_day_clock_update_own on public.technician_day_clocks
  for update to authenticated
  using (
    technician_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager')
    )
  )
  with check (
    technician_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager')
    )
  );

drop policy if exists tech_day_clock_delete_mgmt on public.technician_day_clocks;
create policy tech_day_clock_delete_mgmt on public.technician_day_clocks
  for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager')
    )
  );
