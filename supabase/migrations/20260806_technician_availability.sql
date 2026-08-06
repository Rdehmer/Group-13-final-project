-- Technician weekly availability (Walmart-style preferred hours) + published shifts
-- Safe to re-run.

create table if not exists public.technician_availability (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles (id) on delete cascade,
  -- 0 = Sunday … 6 = Saturday (matches date-fns getDay)
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null default '08:00',
  end_time time not null default '17:00',
  is_available boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint technician_availability_times check (end_time > start_time)
);

create unique index if not exists technician_availability_unique_window
  on public.technician_availability (technician_id, day_of_week, start_time);

create index if not exists technician_availability_tech_idx
  on public.technician_availability (technician_id);

create table if not exists public.technician_shifts (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles (id) on delete cascade,
  work_date date not null,
  start_time time not null default '08:00',
  end_time time not null default '17:00',
  status text not null default 'published'
    check (status in ('draft', 'published', 'canceled')),
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint technician_shifts_times check (end_time > start_time)
);

create index if not exists technician_shifts_tech_date_idx
  on public.technician_shifts (technician_id, work_date);

create index if not exists technician_shifts_date_idx
  on public.technician_shifts (work_date);

create index if not exists technician_shifts_status_idx
  on public.technician_shifts (status);

alter table public.technician_availability enable row level security;
alter table public.technician_shifts enable row level security;

-- Availability: techs manage own; managers read all
drop policy if exists tech_avail_select on public.technician_availability;
create policy tech_avail_select on public.technician_availability
  for select to authenticated
  using (
    technician_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager')
    )
  );

drop policy if exists tech_avail_upsert_own on public.technician_availability;
create policy tech_avail_insert_own on public.technician_availability
  for insert to authenticated
  with check (
    technician_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager')
    )
  );

drop policy if exists tech_avail_update_own on public.technician_availability;
create policy tech_avail_update_own on public.technician_availability
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

drop policy if exists tech_avail_delete_own on public.technician_availability;
create policy tech_avail_delete_own on public.technician_availability
  for delete to authenticated
  using (
    technician_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager')
    )
  );

-- Shifts: everyone who can select can see team; managers write; tech can read
drop policy if exists tech_shifts_select on public.technician_shifts;
create policy tech_shifts_select on public.technician_shifts
  for select to authenticated
  using (
    technician_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager')
    )
  );

drop policy if exists tech_shifts_manager_write on public.technician_shifts;
create policy tech_shifts_manager_insert on public.technician_shifts
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager')
    )
  );

create policy tech_shifts_manager_update on public.technician_shifts
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager')
    )
  );

create policy tech_shifts_manager_delete on public.technician_shifts
  for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager')
    )
  );

grant select, insert, update, delete on public.technician_availability to authenticated;
grant select, insert, update, delete on public.technician_shifts to authenticated;

comment on table public.technician_availability is
  'Recurring weekly preferred availability (Walmart-style self-service hours).';
comment on table public.technician_shifts is
  'Published/draft work shifts for specific calendar dates (manager schedule).';
