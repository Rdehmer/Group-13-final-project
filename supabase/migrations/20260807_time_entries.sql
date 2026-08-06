-- Field-service time entries (ServiceTitan-style).
-- Source of truth for clock in/out, categories, approval, costs.
-- Billable job time also mirrors to technician_labor for invoice prep (linked via technician_labor_id).

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles (id) on delete cascade,
  work_order_id uuid references public.work_orders (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  equipment_id uuid references public.equipment (id) on delete set null,
  service_location text,
  entry_date date not null,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  total_minutes integer not null default 0 check (total_minutes >= 0),
  activity_type text not null default 'regular_work'
    check (activity_type in (
      'regular_work',
      'overtime',
      'travel',
      'shop',
      'training',
      'meeting',
      'break',
      'admin_nonbillable'
    )),
  billable_status text not null default 'billable'
    check (billable_status in ('billable', 'nonbillable', 'contract_included')),
  regular_hours numeric(10, 2) not null default 0 check (regular_hours >= 0),
  overtime_hours numeric(10, 2) not null default 0 check (overtime_hours >= 0),
  hourly_cost_rate numeric(12, 2) not null default 0,
  overtime_cost_rate numeric(12, 2) not null default 0,
  billing_rate numeric(12, 2) not null default 0,
  labor_cost numeric(14, 2) not null default 0,
  billable_amount numeric(14, 2) not null default 0,
  notes text,
  manual_entry_reason text,
  is_manual boolean not null default false,
  approval_status text not null default 'complete'
    check (approval_status in (
      'active',
      'complete',
      'pending_approval',
      'approved',
      'rejected',
      'locked'
    )),
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  locked_at timestamptz,
  locked_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,
  technician_labor_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_entries_clock_order check (
    clock_out_at is null or clock_in_at is null or clock_out_at >= clock_in_at
  ),
  constraint time_entries_job_activity check (
    work_order_id is not null
    or activity_type in ('shop', 'training', 'meeting', 'break', 'admin_nonbillable', 'travel')
  )
);

create index if not exists time_entries_tech_date_idx
  on public.time_entries (technician_id, entry_date)
  where deleted_at is null;
create index if not exists time_entries_wo_idx
  on public.time_entries (work_order_id)
  where deleted_at is null;
create index if not exists time_entries_status_idx
  on public.time_entries (approval_status)
  where deleted_at is null;
create index if not exists time_entries_customer_idx
  on public.time_entries (customer_id)
  where deleted_at is null;
create unique index if not exists time_entries_one_active_per_tech
  on public.time_entries (technician_id)
  where approval_status = 'active' and deleted_at is null;

create table if not exists public.time_entry_audit (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.time_entries (id) on delete cascade,
  action text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists time_entry_audit_entry_idx
  on public.time_entry_audit (time_entry_id, created_at desc);

alter table public.time_entries enable row level security;
alter table public.time_entry_audit enable row level security;

-- SELECT policies
drop policy if exists time_entries_select on public.time_entries;
create policy time_entries_select on public.time_entries
  for select to authenticated
  using (
    deleted_at is null
    and (
      technician_id = auth.uid()
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role in ('administrator', 'service_manager', 'billing')
      )
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role = 'customer'
          and p.customer_id is not null
          and p.customer_id = time_entries.customer_id
          and time_entries.approval_status in ('approved', 'locked', 'complete')
          and time_entries.billable_status in ('billable', 'contract_included')
      )
    )
  );

drop policy if exists time_entries_insert on public.time_entries;
create policy time_entries_insert on public.time_entries
  for insert to authenticated
  with check (
    (
      technician_id = auth.uid()
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('technician', 'administrator', 'service_manager')
      )
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager')
    )
  );

drop policy if exists time_entries_update on public.time_entries;
create policy time_entries_update on public.time_entries
  for update to authenticated
  using (
    deleted_at is null
    and (
      (
        technician_id = auth.uid()
        and approval_status in ('active', 'complete', 'pending_approval', 'rejected')
        and locked_at is null
      )
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role in ('administrator', 'service_manager', 'billing')
      )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager', 'billing')
    )
    or (
      technician_id = auth.uid()
      and approval_status in ('active', 'complete', 'pending_approval', 'rejected')
      and locked_at is null
    )
  );

-- Soft delete only via update; no hard DELETE for techs
drop policy if exists time_entries_delete_manager on public.time_entries;
create policy time_entries_delete_manager on public.time_entries
  for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager')
    )
  );

drop policy if exists time_entry_audit_select on public.time_entry_audit;
create policy time_entry_audit_select on public.time_entry_audit
  for select to authenticated
  using (
    exists (
      select 1 from public.time_entries te
      where te.id = time_entry_audit.time_entry_id
        and (
          te.technician_id = auth.uid()
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.role in ('administrator', 'service_manager', 'billing')
          )
        )
    )
  );

drop policy if exists time_entry_audit_insert on public.time_entry_audit;
create policy time_entry_audit_insert on public.time_entry_audit
  for insert to authenticated
  with check (actor_id = auth.uid() or actor_id is null);

grant select, insert, update, delete on public.time_entries to authenticated;
grant select, insert on public.time_entry_audit to authenticated;

-- ---------------------------------------------------------------------------
-- Demo seed (safe to re-run: only inserts when demo techs exist and few rows)
-- ---------------------------------------------------------------------------
do $$
declare
  tech1 uuid;
  tech2 uuid;
  tech3 uuid;
  mgr uuid;
  wo1 uuid;
  wo2 uuid;
  wo3 uuid;
  cust1 uuid;
  cust2 uuid;
  eq1 uuid;
  seed_count int;
begin
  select id into tech1 from public.profiles where email = 'tech1@equipmentiq-demo.test' limit 1;
  select id into tech2 from public.profiles where email = 'tech2@equipmentiq-demo.test' limit 1;
  select id into tech3 from public.profiles where lower(email) like 'tech%@equipmentiq-demo.test' and id <> tech1 limit 1;
  select id into mgr from public.profiles where email = 'manager@equipmentiq-demo.test' limit 1;

  if tech1 is null then
    raise notice 'time_entries seed skipped: demo techs not found';
    return;
  end if;

  if tech2 is null then tech2 := tech1; end if;
  if tech3 is null then tech3 := tech1; end if;
  if mgr is null then mgr := tech1; end if;

  select count(*) into seed_count
  from public.time_entries
  where notes like '[SEED]%';

  if seed_count > 0 then
    raise notice 'time_entries seed already present';
    return;
  end if;

  select w.id, w.customer_id, w.equipment_id
    into wo1, cust1, eq1
  from public.work_orders w
  where w.assigned_technician_id = tech1
  order by w.created_at desc
  limit 1;

  select w.id, w.customer_id
    into wo2, cust2
  from public.work_orders w
  where w.id is distinct from wo1
  order by w.created_at desc
  limit 1;

  select w.id into wo3
  from public.work_orders w
  where w.id is distinct from wo1 and w.id is distinct from wo2
  order by w.created_at desc
  limit 1;

  if wo1 is null then
    select id, customer_id, equipment_id into wo1, cust1, eq1 from public.work_orders order by created_at desc limit 1;
  end if;
  if wo2 is null then wo2 := wo1; cust2 := cust1; end if;
  if wo3 is null then wo3 := wo1; end if;

  -- Regular completed job work (approved)
  insert into public.time_entries (
    technician_id, work_order_id, customer_id, equipment_id, service_location, entry_date,
    clock_in_at, clock_out_at, total_minutes, activity_type, billable_status,
    regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate, billing_rate,
    labor_cost, billable_amount, notes, is_manual, approval_status,
    approved_by, approved_at, created_by, updated_by
  ) values (
    tech1, wo1, cust1, eq1, 'Demo service site A', current_date - 2,
    (current_date - 2) + time '08:00', (current_date - 2) + time '12:00', 240, 'regular_work', 'billable',
    4, 0, 45, 67.5, 95, 180, 380, '[SEED] AM PM visit — compressor inspect', false, 'approved',
    mgr, now() - interval '1 day', tech1, mgr
  );

  -- Travel on same job (approved)
  insert into public.time_entries (
    technician_id, work_order_id, customer_id, entry_date,
    clock_in_at, clock_out_at, total_minutes, activity_type, billable_status,
    regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate, billing_rate,
    labor_cost, billable_amount, notes, is_manual, approval_status,
    approved_by, approved_at, created_by
  ) values (
    tech1, wo1, cust1, current_date - 2,
    (current_date - 2) + time '07:15', (current_date - 2) + time '08:00', 45, 'travel', 'billable',
    0.75, 0, 45, 67.5, 95, 33.75, 71.25, '[SEED] Drive to site', false, 'approved',
    mgr, now() - interval '1 day', tech1
  );

  -- Overtime-ish long day fragments to push weekly hours
  insert into public.time_entries (
    technician_id, work_order_id, customer_id, entry_date,
    clock_in_at, clock_out_at, total_minutes, activity_type, billable_status,
    regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate, billing_rate,
    labor_cost, billable_amount, notes, is_manual, approval_status, created_by
  ) values
  (
    tech1, wo2, cust2, current_date - 1,
    (current_date - 1) + time '07:00', (current_date - 1) + time '17:00', 600, 'regular_work', 'billable',
    8, 2, 45, 67.5, 95, 495, 1045, '[SEED] Long repair day (incl OT split)', false, 'complete', tech1
  ),
  (
    tech2, wo2, cust2, current_date - 1,
    (current_date - 1) + time '09:00', (current_date - 1) + time '14:00', 300, 'regular_work', 'billable',
    5, 0, 42, 63, 90, 210, 450, '[SEED] Second tech same WO', false, 'complete', tech2
  );

  -- Nonbillable admin / training / shop
  insert into public.time_entries (
    technician_id, work_order_id, customer_id, entry_date,
    clock_in_at, clock_out_at, total_minutes, activity_type, billable_status,
    regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate, billing_rate,
    labor_cost, billable_amount, notes, is_manual, approval_status, created_by
  ) values
  (
    tech1, null, null, current_date - 3,
    (current_date - 3) + time '15:00', (current_date - 3) + time '16:30', 90, 'training', 'nonbillable',
    1.5, 0, 45, 67.5, 0, 67.5, 0, '[SEED] Safety training — warehouse classroom', false, 'approved', tech1
  ),
  (
    tech2, null, null, current_date - 3,
    (current_date - 3) + time '08:00', (current_date - 3) + time '10:00', 120, 'shop', 'nonbillable',
    2, 0, 42, 63, 0, 84, 0, '[SEED] Shop rebuild of spare motor', false, 'complete', tech2
  ),
  (
    tech3, null, null, current_date - 4,
    (current_date - 4) + time '13:00', (current_date - 4) + time '14:00', 60, 'admin_nonbillable', 'nonbillable',
    1, 0, 40, 60, 0, 40, 0, '[SEED] Parts ordering paperwork', false, 'complete', tech3
  );

  -- Manual entry pending approval
  insert into public.time_entries (
    technician_id, work_order_id, customer_id, entry_date,
    clock_in_at, clock_out_at, total_minutes, activity_type, billable_status,
    regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate, billing_rate,
    labor_cost, billable_amount, notes, manual_entry_reason, is_manual, approval_status, created_by
  ) values (
    tech1, wo3, cust1, current_date - 5,
    (current_date - 5) + time '10:00', (current_date - 5) + time '11:30', 90, 'regular_work', 'billable',
    1.5, 0, 45, 67.5, 95, 67.5, 142.5,
    '[SEED] Forgot to clock out after diagnosis',
    'Missed clock-out; entered from paper notes',
    true, 'pending_approval', tech1
  );

  -- Rejected entry (needs correction)
  insert into public.time_entries (
    technician_id, work_order_id, customer_id, entry_date,
    clock_in_at, clock_out_at, total_minutes, activity_type, billable_status,
    regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate, billing_rate,
    labor_cost, billable_amount, notes, manual_entry_reason, is_manual, approval_status,
    rejection_reason, approved_by, created_by, updated_by
  ) values (
    tech2, wo1, cust1, current_date - 6,
    (current_date - 6) + time '18:00', (current_date - 6) + time '22:00', 240, 'regular_work', 'billable',
    4, 0, 42, 63, 90, 168, 360,
    '[SEED] Unlikely after-hours claim',
    'Phone said I was on site',
    true, 'rejected',
    'Time does not match geofence / dispatch — correct or attach note',
    mgr, tech2, mgr
  );

  -- Missing clock-out (active-looking complete gap: open active for missing demo — use active with old start)
  -- Represented as complete with flag note; plus one genuinely active for tech3 if none
  insert into public.time_entries (
    technician_id, work_order_id, customer_id, entry_date,
    clock_in_at, clock_out_at, total_minutes, activity_type, billable_status,
    regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate, billing_rate,
    labor_cost, billable_amount, notes, is_manual, approval_status, created_by
  ) values (
    tech2, wo3, cust2, current_date,
    now() - interval '5 hours', null, 0, 'regular_work', 'billable',
    0, 0, 42, 63, 90, 0, 0,
    '[SEED] MISSING CLOCK-OUT — still open',
    false, 'active', tech2
  );

  -- Overlap pair for tech3 on same morning (warning demo)
  insert into public.time_entries (
    technician_id, work_order_id, customer_id, entry_date,
    clock_in_at, clock_out_at, total_minutes, activity_type, billable_status,
    regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate, billing_rate,
    labor_cost, billable_amount, notes, is_manual, approval_status, created_by
  ) values
  (
    tech3, wo1, cust1, current_date - 1,
    (current_date - 1) + time '08:00', (current_date - 1) + time '12:00', 240, 'regular_work', 'billable',
    4, 0, 40, 60, 90, 160, 360, '[SEED] Overlap A', false, 'complete', tech3
  ),
  (
    tech3, wo2, cust2, current_date - 1,
    (current_date - 1) + time '11:00', (current_date - 1) + time '15:00', 240, 'regular_work', 'billable',
    4, 0, 40, 60, 90, 160, 360, '[SEED] Overlap B (overlaps A)', false, 'pending_approval', tech3
  );

  -- Unprofitable job time: high cost tech, low billing (contract included free)
  insert into public.time_entries (
    technician_id, work_order_id, customer_id, entry_date,
    clock_in_at, clock_out_at, total_minutes, activity_type, billable_status,
    regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate, billing_rate,
    labor_cost, billable_amount, notes, is_manual, approval_status, approved_by, approved_at, created_by
  ) values (
    tech1, wo3, cust1, current_date - 7,
    (current_date - 7) + time '08:00', (current_date - 7) + time '16:00', 480, 'regular_work', 'contract_included',
    8, 0, 55, 82.5, 0, 440, 0,
    '[SEED] Contract-included marathon — unprofitable on cost',
    false, 'approved', mgr, now() - interval '2 days', tech1
  );

  raise notice 'time_entries seed inserted';
end $$;
