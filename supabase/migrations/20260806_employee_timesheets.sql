-- ServiceTitan-style employee timesheets: pay-period workflow + non-job adjustments.
-- Live hours still source from technician_labor; these tables store approval state and shop/admin time.

create table if not exists public.employee_timesheets (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'open'
    check (status in (
      'open',
      'released',
      'employee_approved',
      'disputed',
      'manager_approved',
      'locked'
    )),
  released_at timestamptz,
  released_by uuid references public.profiles (id) on delete set null,
  employee_signed_at timestamptz,
  employee_signature_name text,
  dispute_note text,
  disputed_at timestamptz,
  manager_id uuid references public.profiles (id) on delete set null,
  manager_approved_at timestamptz,
  locked_at timestamptz,
  last_synced_at timestamptz,
  manager_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_timesheets_period check (period_end >= period_start),
  constraint employee_timesheets_unique_period unique (technician_id, period_start)
);

create index if not exists employee_timesheets_period_idx
  on public.employee_timesheets (period_start, period_end);
create index if not exists employee_timesheets_status_idx
  on public.employee_timesheets (status);
create index if not exists employee_timesheets_tech_idx
  on public.employee_timesheets (technician_id);

create table if not exists public.timesheet_adjustments (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles (id) on delete cascade,
  work_date date not null,
  activity_code text not null default 'Admin',
  regular_hours numeric(8,2) not null default 0 check (regular_hours >= 0),
  overtime_hours numeric(8,2) not null default 0 check (overtime_hours >= 0),
  start_time time,
  end_time time,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists timesheet_adjustments_tech_date_idx
  on public.timesheet_adjustments (technician_id, work_date);
create index if not exists timesheet_adjustments_date_idx
  on public.timesheet_adjustments (work_date);

alter table public.employee_timesheets enable row level security;
alter table public.timesheet_adjustments enable row level security;

-- employee_timesheets RLS
drop policy if exists employee_timesheets_select on public.employee_timesheets;
create policy employee_timesheets_select on public.employee_timesheets
  for select to authenticated
  using (
    technician_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager', 'billing')
    )
  );

drop policy if exists employee_timesheets_insert_manager on public.employee_timesheets;
create policy employee_timesheets_insert_manager on public.employee_timesheets
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager', 'billing')
    )
    or technician_id = auth.uid()
  );

drop policy if exists employee_timesheets_update on public.employee_timesheets;
create policy employee_timesheets_update on public.employee_timesheets
  for update to authenticated
  using (
    technician_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager', 'billing')
    )
  )
  with check (
    technician_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager', 'billing')
    )
  );

-- timesheet_adjustments RLS
drop policy if exists timesheet_adjustments_select on public.timesheet_adjustments;
create policy timesheet_adjustments_select on public.timesheet_adjustments
  for select to authenticated
  using (
    technician_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager', 'billing')
    )
  );

drop policy if exists timesheet_adjustments_write_manager on public.timesheet_adjustments;
create policy timesheet_adjustments_write_manager on public.timesheet_adjustments
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager', 'billing')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager', 'billing')
    )
  );

grant select, insert, update on public.employee_timesheets to authenticated;
grant select, insert, update, delete on public.timesheet_adjustments to authenticated;
