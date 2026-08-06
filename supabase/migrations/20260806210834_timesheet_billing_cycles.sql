-- Timesheet billing cycles: daily tech entries grouped into weekly/bi-weekly cycles.
-- Technicians = profiles with role technician (no separate Technician table).

-- 1) Global settings (single-row style; cycle length is configurable)
create table if not exists public.timesheet_settings (
  id uuid primary key default gen_random_uuid(),
  cycle_type text not null default 'biweekly'
    check (cycle_type in ('weekly', 'biweekly')),
  -- 0 = Sunday … 6 = Saturday (ISO often uses Monday = 1; we store JS getDay() style)
  week_starts_on smallint not null default 1
    check (week_starts_on between 0 and 6),
  updated_at timestamptz not null default now()
);

comment on table public.timesheet_settings is
  'Payroll/timesheet cycle config. Default biweekly; managers can switch to weekly.';

insert into public.timesheet_settings (cycle_type, week_starts_on)
select 'biweekly', 1
where not exists (select 1 from public.timesheet_settings);

-- 2) Billing cycles
create table if not exists public.timesheet_cycles (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  label text not null,
  status text not null default 'Open'
    check (status in ('Open', 'Closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timesheet_cycles_date_range check (end_date >= start_date),
  constraint timesheet_cycles_unique_range unique (start_date, end_date)
);

create index if not exists timesheet_cycles_dates_idx
  on public.timesheet_cycles (start_date, end_date);

comment on table public.timesheet_cycles is
  'Payroll/billing windows that group daily timesheet entries.';

-- 3) Daily time entries
create table if not exists public.timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles (id) on delete cascade,
  cycle_id uuid not null references public.timesheet_cycles (id) on delete cascade,
  work_date date not null,
  hours numeric(5, 2) not null
    check (hours > 0 and hours <= 24),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timesheet_entries_one_per_day unique (technician_id, work_date)
);

create index if not exists timesheet_entries_cycle_idx
  on public.timesheet_entries (cycle_id);

create index if not exists timesheet_entries_tech_idx
  on public.timesheet_entries (technician_id);

create index if not exists timesheet_entries_date_idx
  on public.timesheet_entries (work_date);

comment on table public.timesheet_entries is
  'Daily hours logged by a technician for a billing cycle (date, hours, notes).';

-- 4) Per-tech submission / approval for a cycle
create table if not exists public.timesheet_submissions (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles (id) on delete cascade,
  cycle_id uuid not null references public.timesheet_cycles (id) on delete cascade,
  status text not null default 'Draft'
    check (status in ('Draft', 'Submitted', 'Approved', 'Rejected')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timesheet_submissions_unique unique (technician_id, cycle_id)
);

create index if not exists timesheet_submissions_cycle_idx
  on public.timesheet_submissions (cycle_id);

comment on table public.timesheet_submissions is
  'Technician submit + manager approve/reject for a cycle.';

-- 5) RLS
alter table public.timesheet_settings enable row level security;
alter table public.timesheet_cycles enable row level security;
alter table public.timesheet_entries enable row level security;
alter table public.timesheet_submissions enable row level security;

-- Settings: staff read; managers/admins/billing update
drop policy if exists timesheet_settings_select on public.timesheet_settings;
create policy timesheet_settings_select
  on public.timesheet_settings for select to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role,
      'technician'::user_role
    )
  );

drop policy if exists timesheet_settings_mgmt on public.timesheet_settings;
create policy timesheet_settings_mgmt
  on public.timesheet_settings for all to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  )
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

-- Cycles: staff read; managers/admins/billing write
drop policy if exists timesheet_cycles_select on public.timesheet_cycles;
create policy timesheet_cycles_select
  on public.timesheet_cycles for select to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role,
      'technician'::user_role
    )
  );

drop policy if exists timesheet_cycles_mgmt on public.timesheet_cycles;
create policy timesheet_cycles_mgmt
  on public.timesheet_cycles for all to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  )
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

-- Entries: techs CRUD own (while cycle open + not approved); managers/billing full
drop policy if exists timesheet_entries_select on public.timesheet_entries;
create policy timesheet_entries_select
  on public.timesheet_entries for select to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
    or (
      app_user_role() = 'technician'::user_role
      and technician_id = auth.uid()
    )
  );

drop policy if exists timesheet_entries_tech_insert on public.timesheet_entries;
create policy timesheet_entries_tech_insert
  on public.timesheet_entries for insert to authenticated
  with check (
    (
      app_user_role() = 'technician'::user_role
      and technician_id = auth.uid()
      and exists (
        select 1 from public.timesheet_cycles c
        where c.id = cycle_id and c.status = 'Open'
      )
      and not exists (
        select 1 from public.timesheet_submissions s
        where s.cycle_id = cycle_id
          and s.technician_id = auth.uid()
          and s.status = 'Approved'
      )
    )
    or app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

drop policy if exists timesheet_entries_tech_update on public.timesheet_entries;
create policy timesheet_entries_tech_update
  on public.timesheet_entries for update to authenticated
  using (
    (
      app_user_role() = 'technician'::user_role
      and technician_id = auth.uid()
      and exists (
        select 1 from public.timesheet_cycles c
        where c.id = cycle_id and c.status = 'Open'
      )
      and not exists (
        select 1 from public.timesheet_submissions s
        where s.cycle_id = cycle_id
          and s.technician_id = auth.uid()
          and s.status in ('Submitted', 'Approved')
      )
    )
    or app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  )
  with check (
    (
      app_user_role() = 'technician'::user_role
      and technician_id = auth.uid()
    )
    or app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

drop policy if exists timesheet_entries_tech_delete on public.timesheet_entries;
create policy timesheet_entries_tech_delete
  on public.timesheet_entries for delete to authenticated
  using (
    (
      app_user_role() = 'technician'::user_role
      and technician_id = auth.uid()
      and exists (
        select 1 from public.timesheet_cycles c
        where c.id = cycle_id and c.status = 'Open'
      )
      and not exists (
        select 1 from public.timesheet_submissions s
        where s.cycle_id = cycle_id
          and s.technician_id = auth.uid()
          and s.status in ('Submitted', 'Approved')
      )
    )
    or app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

-- Submissions
drop policy if exists timesheet_submissions_select on public.timesheet_submissions;
create policy timesheet_submissions_select
  on public.timesheet_submissions for select to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
    or (
      app_user_role() = 'technician'::user_role
      and technician_id = auth.uid()
    )
  );

drop policy if exists timesheet_submissions_tech_write on public.timesheet_submissions;
create policy timesheet_submissions_tech_write
  on public.timesheet_submissions for insert to authenticated
  with check (
    (
      app_user_role() = 'technician'::user_role
      and technician_id = auth.uid()
    )
    or app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

drop policy if exists timesheet_submissions_update on public.timesheet_submissions;
create policy timesheet_submissions_update
  on public.timesheet_submissions for update to authenticated
  using (
    (
      app_user_role() = 'technician'::user_role
      and technician_id = auth.uid()
      and status in ('Draft', 'Rejected')
    )
    or app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  )
  with check (
    (
      app_user_role() = 'technician'::user_role
      and technician_id = auth.uid()
    )
    or app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

grant select, insert, update, delete on public.timesheet_settings to authenticated;
grant select, insert, update, delete on public.timesheet_cycles to authenticated;
grant select, insert, update, delete on public.timesheet_entries to authenticated;
grant select, insert, update, delete on public.timesheet_submissions to authenticated;

-- Seed current + previous biweekly cycles (Mon start) and a few demo entries
do $$
declare
  today date := current_date;
  -- Align to Monday: extract(dow) is 0=Sun … 6=Sat
  dow int := extract(dow from today)::int;
  days_from_monday int := case when dow = 0 then 6 else dow - 1 end;
  this_monday date := today - days_from_monday;
  -- Biweekly: use even ISO weeks so cycles are stable; simpler: current Mon..Sun+7
  cur_start date := this_monday - ((extract(week from this_monday)::int % 2) * 7);
  cur_end date := cur_start + 13;
  prev_start date := cur_start - 14;
  prev_end date := cur_start - 1;
  cur_id uuid;
  prev_id uuid;
  tech1 uuid;
  tech2 uuid;
begin
  insert into public.timesheet_cycles (start_date, end_date, label, status)
  values (
    prev_start,
    prev_end,
    to_char(prev_start, 'Mon DD') || ' – ' || to_char(prev_end, 'Mon DD, YYYY'),
    'Closed'
  )
  on conflict (start_date, end_date) do update set label = excluded.label
  returning id into prev_id;

  if prev_id is null then
    select id into prev_id from public.timesheet_cycles
    where start_date = prev_start and end_date = prev_end;
  end if;

  insert into public.timesheet_cycles (start_date, end_date, label, status)
  values (
    cur_start,
    cur_end,
    to_char(cur_start, 'Mon DD') || ' – ' || to_char(cur_end, 'Mon DD, YYYY'),
    'Open'
  )
  on conflict (start_date, end_date) do update set label = excluded.label
  returning id into cur_id;

  if cur_id is null then
    select id into cur_id from public.timesheet_cycles
    where start_date = cur_start and end_date = cur_end;
  end if;

  select id into tech1 from public.profiles where email = 'tech1@ridley-demo.test' limit 1;
  select id into tech2 from public.profiles where email = 'tech2@ridley-demo.test' limit 1;

  if tech1 is not null and cur_id is not null then
    insert into public.timesheet_entries (technician_id, cycle_id, work_date, hours, notes)
    values
      (tech1, cur_id, cur_start, 8, 'Northwind PM — condensers'),
      (tech1, cur_id, cur_start + 1, 7.5, 'Emergency call — iced evaporator'),
      (tech1, cur_id, cur_start + 2, 8, 'Parts run + follow-up')
    on conflict (technician_id, work_date) do nothing;

    insert into public.timesheet_submissions (technician_id, cycle_id, status)
    values (tech1, cur_id, 'Draft')
    on conflict (technician_id, cycle_id) do nothing;
  end if;

  if tech2 is not null and cur_id is not null then
    insert into public.timesheet_entries (technician_id, cycle_id, work_date, hours, notes)
    values
      (tech2, cur_id, cur_start, 8, 'Summit Cold Express install assist'),
      (tech2, cur_id, cur_start + 1, 4, 'Half day — training')
    on conflict (technician_id, work_date) do nothing;

    insert into public.timesheet_submissions (technician_id, cycle_id, status)
    values (tech2, cur_id, 'Draft')
    on conflict (technician_id, cycle_id) do nothing;
  end if;
end $$;
