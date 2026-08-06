-- Internal controls for field timesheets: SOD, audit, billing, weekly certification, validation.
-- Safe to re-run (IF NOT EXISTS / DROP IF EXISTS patterns).

-- Extend approval statuses via check constraint replace
alter table if exists public.time_entries drop constraint if exists time_entries_approval_status_check;
alter table if exists public.time_entries
  add constraint time_entries_approval_status_check
  check (approval_status in (
    'active',
    'missing_clock_out',
    'pending_correction',
    'complete',
    'pending_approval',
    'submitted',
    'approved',
    'rejected',
    'locked'
  ));

-- Additional control columns
alter table if exists public.time_entries
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by uuid references public.profiles (id) on delete set null,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid references public.profiles (id) on delete set null,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by uuid references public.profiles (id) on delete set null,
  add column if not exists reopen_reason text,
  add column if not exists correction_reason text,
  add column if not exists edit_reason text,
  add column if not exists original_clock_in_at timestamptz,
  add column if not exists original_clock_out_at timestamptz,
  add column if not exists original_regular_hours numeric(10,2),
  add column if not exists original_overtime_hours numeric(10,2),
  add column if not exists original_activity_type text,
  add column if not exists original_notes text,
  add column if not exists original_values jsonb,
  add column if not exists revised_values jsonb,
  add column if not exists requires_manager_assignment_override boolean not null default false,
  add column if not exists unassigned_work_order boolean not null default false,
  add column if not exists exception_flags text[] not null default '{}',
  add column if not exists exception_severity text
    check (exception_severity is null or exception_severity in ('critical', 'warning', 'review', 'resolved')),
  add column if not exists billing_status text not null default 'not_ready'
    check (billing_status in (
      'not_ready',
      'ready_to_bill',
      'included_on_draft',
      'billed',
      'nonbillable',
      'disputed'
    )),
  add column if not exists invoice_id uuid,
  add column if not exists billed_at timestamptz,
  add column if not exists billed_by uuid references public.profiles (id) on delete set null,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles (id) on delete set null,
  add column if not exists void_reason text,
  add column if not exists is_void boolean not null default false,
  add column if not exists weekly_timesheet_id uuid,
  add column if not exists cert_week_start date;

-- Billing flag on labor mirror
alter table if exists public.technician_labor
  add column if not exists from_time_entry_id uuid,
  add column if not exists approval_gated boolean not null default false;

-- Weekly certification sheet
create table if not exists public.weekly_timesheets (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  week_end date not null,
  status text not null default 'open'
    check (status in ('open', 'submitted', 'manager_approved', 'locked', 'returned')),
  certification_text text,
  certified_at timestamptz,
  certified_name text,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles (id) on delete set null,
  manager_id uuid references public.profiles (id) on delete set null,
  manager_approved_at timestamptz,
  locked_at timestamptz,
  locked_by uuid references public.profiles (id) on delete set null,
  return_reason text,
  returned_at timestamptz,
  returned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (technician_id, week_start)
);

create index if not exists weekly_timesheets_week_idx on public.weekly_timesheets (week_start, status);

-- Enhanced immutable-style audit (keep existing time_entry_audit; add richer columns)
alter table if exists public.time_entry_audit
  add column if not exists actor_role text,
  add column if not exists work_order_id uuid,
  add column if not exists original_values jsonb,
  add column if not exists revised_values jsonb,
  add column if not exists reason text,
  add column if not exists status_before text,
  add column if not exists status_after text;

-- Rate change log (admin/manager only writes via app service role/or manager)
create table if not exists public.time_rate_change_log (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles (id) on delete cascade,
  field_name text not null,
  old_value numeric(12,2),
  new_value numeric(12,2),
  reason text not null,
  changed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.weekly_timesheets enable row level security;
alter table public.time_rate_change_log enable row level security;

drop policy if exists weekly_timesheets_select on public.weekly_timesheets;
create policy weekly_timesheets_select on public.weekly_timesheets
  for select to authenticated
  using (
    technician_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('administrator', 'service_manager', 'billing')
    )
  );

drop policy if exists weekly_timesheets_insert on public.weekly_timesheets;
create policy weekly_timesheets_insert on public.weekly_timesheets
  for insert to authenticated
  with check (
    technician_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('administrator', 'service_manager')
    )
  );

drop policy if exists weekly_timesheets_update on public.weekly_timesheets;
create policy weekly_timesheets_update on public.weekly_timesheets
  for update to authenticated
  using (
    (
      technician_id = auth.uid()
      and status in ('open', 'returned')
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('administrator', 'service_manager')
    )
  );

drop policy if exists rate_change_select on public.time_rate_change_log;
create policy rate_change_select on public.time_rate_change_log
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('administrator', 'service_manager', 'billing')
    )
  );

drop policy if exists rate_change_insert on public.time_rate_change_log;
create policy rate_change_insert on public.time_rate_change_log
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('administrator', 'service_manager')
    )
  );

-- Tighten time_entries policies: billing cannot change clock times (enforced also in trigger)
drop policy if exists time_entries_update on public.time_entries;
create policy time_entries_update on public.time_entries
  for update to authenticated
  using (
    deleted_at is null
    and is_void = false
    and (
      (
        technician_id = auth.uid()
        and approval_status in ('active', 'missing_clock_out', 'pending_correction', 'complete', 'pending_approval', 'rejected')
        and locked_at is null
        and billing_status not in ('billed', 'included_on_draft')
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
      -- Billing: status / billing fields only (trigger blocks clock column changes)
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'billing'
      )
    )
  )
  with check (
    deleted_at is null
    and (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role in ('administrator', 'service_manager', 'billing')
      )
      or (
        technician_id = auth.uid()
        and approval_status in ('active', 'missing_clock_out', 'pending_correction', 'complete', 'pending_approval', 'rejected', 'submitted')
        and locked_at is null
      )
    )
  );

-- Customer select: only approved/locked service hours, no cost (app still strips rates)
drop policy if exists time_entries_select on public.time_entries;
create policy time_entries_select on public.time_entries
  for select to authenticated
  using (
    (deleted_at is null or deleted_at is not null) -- allow voided rows for managers via role below
    and (
      (
        deleted_at is null
        and is_void = false
        and technician_id = auth.uid()
      )
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role in ('administrator', 'service_manager', 'billing')
      )
      or (
        deleted_at is null
        and is_void = false
        and exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and p.role = 'customer'
            and p.customer_id is not null
            and p.customer_id = time_entries.customer_id
            and time_entries.approval_status in ('approved', 'locked')
            and time_entries.billable_status in ('billable', 'contract_included')
            and time_entries.billing_status <> 'disputed'
        )
      )
    )
  );

-- Prevent customers/technicians reading rate change log: already restricted

-- Trigger helpers
create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role::text from public.profiles where id = auth.uid()
$$;

create or replace function public.time_entries_enforce_controls()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r text;
  active_count int;
  overlap_count int;
  mins int;
  wo_status text;
  wo_assignee uuid;
begin
  r := public.current_profile_role();

  -- Soft void rows: no tech edits
  if TG_OP = 'UPDATE' and OLD.is_void and r not in ('administrator', 'service_manager') then
    raise exception 'VOIDED_ENTRY: cannot modify a voided time entry';
  end if;

  -- Billing cannot rewrite clocks / rates
  if TG_OP = 'UPDATE' and r = 'billing' then
    if NEW.clock_in_at is distinct from OLD.clock_in_at
      or NEW.clock_out_at is distinct from OLD.clock_out_at
      or NEW.regular_hours is distinct from OLD.regular_hours
      or NEW.overtime_hours is distinct from OLD.overtime_hours
      or NEW.hourly_cost_rate is distinct from OLD.hourly_cost_rate
      or NEW.overtime_cost_rate is distinct from OLD.overtime_cost_rate
      or NEW.billing_rate is distinct from OLD.billing_rate
      or NEW.labor_cost is distinct from OLD.labor_cost
    then
      raise exception 'SOD_BILLING: billing personnel cannot change clock times, hours, or rates';
    end if;
  end if;

  -- Technicians cannot set approval to approved/locked or approve self
  if r = 'technician' then
    if NEW.technician_id is distinct from auth.uid() and TG_OP = 'INSERT' then
      raise exception 'SOD: technicians may only enter their own time';
    end if;
    if NEW.approval_status in ('approved', 'locked') and (
      TG_OP = 'INSERT' or NEW.approval_status is distinct from OLD.approval_status
    ) then
      raise exception 'SOD: technicians cannot approve or lock time entries';
    end if;
    if NEW.hourly_cost_rate is distinct from coalesce(OLD.hourly_cost_rate, NEW.hourly_cost_rate)
      and TG_OP = 'UPDATE' then
      -- allow initial rates from profile on insert only
      if NEW.hourly_cost_rate is distinct from OLD.hourly_cost_rate
        or NEW.billing_rate is distinct from OLD.billing_rate
        or NEW.overtime_cost_rate is distinct from OLD.overtime_cost_rate then
        raise exception 'RATE_CONTROL: technicians cannot change pay or billing rates';
      end if;
    end if;
  end if;

  -- Self-approval block for managers acting on own manual? still allow admin; block approved_by = technician self on manual
  if TG_OP = 'UPDATE'
    and NEW.approval_status in ('approved', 'locked')
    and NEW.approved_by is not null
    and NEW.approved_by = NEW.technician_id
    and NEW.is_manual = true then
    raise exception 'SOD: cannot approve your own manual time entry';
  end if;

  -- Duration / clock order
  if NEW.clock_in_at is not null and NEW.clock_out_at is not null then
    if NEW.clock_out_at < NEW.clock_in_at then
      raise exception 'DURATION: clock-out cannot be before clock-in';
    end if;
    mins := greatest(0, floor(extract(epoch from (NEW.clock_out_at - NEW.clock_in_at)) / 60)::int);
    if mins = 0 and NEW.approval_status not in ('active', 'missing_clock_out') then
      raise exception 'DURATION: zero-duration entries are not allowed';
    end if;
    if mins > 24 * 60 then
      raise exception 'DURATION: entries longer than 24 hours are not allowed';
    end if;
    NEW.total_minutes := mins;
  end if;

  -- Future clock-in more than 5 minutes ahead blocked
  if NEW.clock_in_at is not null and NEW.clock_in_at > (now() + interval '5 minutes') then
    raise exception 'DURATION: future clock-in is not allowed';
  end if;

  -- One active clock-in per technician
  if NEW.approval_status = 'active' and coalesce(NEW.is_void, false) = false then
    select count(*) into active_count
    from public.time_entries t
    where t.technician_id = NEW.technician_id
      and t.approval_status = 'active'
      and t.deleted_at is null
      and coalesce(t.is_void, false) = false
      and (TG_OP = 'INSERT' or t.id is distinct from NEW.id);
    if active_count > 0 then
      raise exception 'ACTIVE_CLOCK: technician already has an active clock-in';
    end if;
  end if;

  -- Overlap prevention for closed ranges
  if NEW.clock_in_at is not null and NEW.clock_out_at is not null
     and NEW.approval_status not in ('rejected')
     and coalesce(NEW.is_void, false) = false then
    select count(*) into overlap_count
    from public.time_entries t
    where t.technician_id = NEW.technician_id
      and t.deleted_at is null
      and coalesce(t.is_void, false) = false
      and t.approval_status not in ('rejected')
      and t.clock_in_at is not null
      and coalesce(t.clock_out_at, now()) > NEW.clock_in_at
      and t.clock_in_at < NEW.clock_out_at
      and (TG_OP = 'INSERT' or t.id is distinct from NEW.id);
    if overlap_count > 0 then
      raise exception 'OVERLAP: time range overlaps an existing entry for this technician';
    end if;
  end if;

  -- Exact duplicate block
  if NEW.clock_in_at is not null and NEW.clock_out_at is not null and coalesce(NEW.is_void, false) = false then
    if exists (
      select 1 from public.time_entries t
      where t.technician_id = NEW.technician_id
        and t.entry_date = NEW.entry_date
        and t.clock_in_at = NEW.clock_in_at
        and t.clock_out_at = NEW.clock_out_at
        and t.work_order_id is not distinct from NEW.work_order_id
        and t.activity_type = NEW.activity_type
        and t.deleted_at is null
        and coalesce(t.is_void, false) = false
        and t.approval_status not in ('rejected')
        and (TG_OP = 'INSERT' or t.id is distinct from NEW.id)
    ) then
      raise exception 'DUPLICATE: exact duplicate time entry blocked';
    end if;
  end if;

  -- Work order authorization for job-related activity
  if NEW.work_order_id is not null and NEW.activity_type in ('regular_work', 'overtime', 'travel') then
    select status, assigned_technician_id into wo_status, wo_assignee
    from public.work_orders where id = NEW.work_order_id;
    if wo_status is null then
      raise exception 'WO_AUTH: work order not found';
    end if;
    if wo_status in ('Canceled', 'Closed') then
      raise exception 'WO_AUTH: cannot record job time against canceled or closed work orders';
    end if;
    if wo_assignee is distinct from NEW.technician_id then
      NEW.unassigned_work_order := true;
      NEW.requires_manager_assignment_override := true;
      if NEW.approval_status in ('complete', 'active') then
        NEW.approval_status := 'pending_approval';
      end if;
    end if;
  end if;

  -- Long shift flags
  if NEW.total_minutes > 16 * 60 then
    NEW.exception_severity := 'critical';
    if not ('long_shift_16h' = any (NEW.exception_flags)) then
      NEW.exception_flags := array_append(NEW.exception_flags, 'long_shift_16h');
    end if;
  elsif NEW.total_minutes > 12 * 60 then
    if NEW.exception_severity is null or NEW.exception_severity = 'resolved' then
      NEW.exception_severity := 'warning';
    end if;
    if not ('long_shift_12h' = any (NEW.exception_flags)) then
      NEW.exception_flags := array_append(NEW.exception_flags, 'long_shift_12h');
    end if;
  end if;

  -- Preserve originals on first edit from complete/active toward pending_approval
  if TG_OP = 'UPDATE'
    and OLD.approval_status in ('complete', 'approved', 'submitted')
    and (
      NEW.clock_in_at is distinct from OLD.clock_in_at
      or NEW.clock_out_at is distinct from OLD.clock_out_at
      or NEW.regular_hours is distinct from OLD.regular_hours
      or NEW.overtime_hours is distinct from OLD.overtime_hours
      or NEW.activity_type is distinct from OLD.activity_type
      or NEW.notes is distinct from OLD.notes
    ) then
    if OLD.original_clock_in_at is null then
      NEW.original_clock_in_at := OLD.clock_in_at;
      NEW.original_clock_out_at := OLD.clock_out_at;
      NEW.original_regular_hours := OLD.regular_hours;
      NEW.original_overtime_hours := OLD.overtime_hours;
      NEW.original_activity_type := OLD.activity_type;
      NEW.original_notes := OLD.notes;
      NEW.original_values := to_jsonb(OLD);
    end if;
    NEW.revised_values := to_jsonb(NEW);
    if r = 'technician' and NEW.approval_status not in ('rejected', 'pending_correction') then
      NEW.approval_status := 'pending_approval';
    end if;
  end if;

  -- Locked / billed immutability for techs
  if TG_OP = 'UPDATE' and r = 'technician' then
    if OLD.locked_at is not null or OLD.approval_status = 'locked' or OLD.billing_status in ('billed', 'included_on_draft') then
      raise exception 'LOCKED: approved, locked, or billed entries cannot be edited by technicians';
    end if;
  end if;

  -- Missing clock-out promotion
  if NEW.approval_status = 'active'
    and NEW.clock_in_at is not null
    and NEW.clock_out_at is null
    and NEW.clock_in_at < (now() - interval '16 hours') then
    NEW.approval_status := 'missing_clock_out';
    NEW.exception_severity := 'critical';
    if not ('missing_clock_out' = any (NEW.exception_flags)) then
      NEW.exception_flags := array_append(NEW.exception_flags, 'missing_clock_out');
    end if;
  end if;

  -- Billing readiness when approved/locked and billable
  if NEW.approval_status in ('approved', 'locked')
    and NEW.billable_status = 'billable'
    and NEW.billing_status = 'not_ready'
    and NEW.work_order_id is not null
    and NEW.customer_id is not null then
    NEW.billing_status := 'ready_to_bill';
  end if;

  if NEW.billable_status in ('nonbillable', 'contract_included') and NEW.billing_status = 'not_ready' then
    NEW.billing_status := 'nonbillable';
  end if;

  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists trg_time_entries_controls on public.time_entries;
create trigger trg_time_entries_controls
  before insert or update on public.time_entries
  for each row execute function public.time_entries_enforce_controls();

-- Audit trigger for important field changes
create or replace function public.time_entries_write_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  act text;
  r text;
begin
  r := public.current_profile_role();
  if TG_OP = 'INSERT' then
    act := case when NEW.approval_status = 'active' then 'clock_in'
      when NEW.is_manual then 'manual_entry' else 'create' end;
    insert into public.time_entry_audit (
      time_entry_id, action, actor_id, actor_role, work_order_id,
      revised_values, status_after, reason, detail
    ) values (
      NEW.id, act, auth.uid(), r, NEW.work_order_id,
      to_jsonb(NEW), NEW.approval_status, NEW.manual_entry_reason, NEW.notes
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    act := 'update';
    if NEW.approval_status is distinct from OLD.approval_status then
      act := case NEW.approval_status
        when 'complete' then 'clock_out'
        when 'pending_approval' then 'submit_for_approval'
        when 'submitted' then 'submit_week'
        when 'approved' then 'approve'
        when 'rejected' then 'reject'
        when 'locked' then 'lock'
        when 'pending_correction' then 'request_correction'
        when 'missing_clock_out' then 'missing_clock_out'
        else 'status_change' end;
    elsif NEW.is_void and not OLD.is_void then
      act := 'void';
    elsif NEW.billing_status is distinct from OLD.billing_status then
      act := 'billing_status_change';
    elsif NEW.reopened_at is distinct from OLD.reopened_at then
      act := 'reopen';
    end if;

    insert into public.time_entry_audit (
      time_entry_id, action, actor_id, actor_role, work_order_id,
      original_values, revised_values, status_before, status_after, reason, detail
    ) values (
      NEW.id, act, auth.uid(), r, NEW.work_order_id,
      to_jsonb(OLD), to_jsonb(NEW), OLD.approval_status, NEW.approval_status,
      coalesce(NEW.rejection_reason, NEW.reopen_reason, NEW.edit_reason, NEW.void_reason),
      NEW.notes
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_time_entries_audit on public.time_entries;
create trigger trg_time_entries_audit
  after insert or update on public.time_entries
  for each row execute function public.time_entries_write_audit();

-- No update/delete on audit for normal roles
drop policy if exists time_entry_audit_no_update on public.time_entry_audit;
-- Revoke update/delete
revoke update, delete on public.time_entry_audit from authenticated;

grant select, insert, update on public.weekly_timesheets to authenticated;
grant select, insert on public.time_rate_change_log to authenticated;

-- Seed control demo rows (idempotent via notes tag)
do $$
declare
  tech1 uuid;
  tech2 uuid;
  mgr uuid;
  wo1 uuid;
  wo2 uuid;
  cust1 uuid;
  cnt int;
begin
  select id into tech1 from public.profiles where email = 'tech1@ridley-demo.test' limit 1;
  select id into tech2 from public.profiles where email ilike 'tech2@%' limit 1;
  select id into mgr from public.profiles where email = 'manager@ridley-demo.test' limit 1;
  if tech1 is null then return; end if;
  if tech2 is null then tech2 := tech1; end if;
  if mgr is null then mgr := tech1; end if;

  select count(*) into cnt from public.time_entries where notes like '[CTRL-SEED]%';
  if cnt > 0 then return; end if;

  select id, customer_id into wo1, cust1 from public.work_orders order by created_at desc limit 1;
  select id into wo2 from public.work_orders where id is distinct from wo1 order by created_at desc limit 1;
  if wo1 is null then return; end if;
  if wo2 is null then wo2 := wo1; end if;

  -- Normal approved
  insert into public.time_entries (
    technician_id, work_order_id, customer_id, entry_date, clock_in_at, clock_out_at, total_minutes,
    activity_type, billable_status, regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate,
    billing_rate, labor_cost, billable_amount, notes, is_manual, approval_status, approved_by, approved_at,
    billing_status, created_by
  ) values (
    tech1, wo1, cust1, current_date - 3,
    (current_date - 3) + time '08:00', (current_date - 3) + time '12:00', 240,
    'regular_work', 'billable', 4, 0, 45, 67.5, 95, 180, 380,
    '[CTRL-SEED] Normal approved entry', false, 'approved', mgr, now() - interval '2 days',
    'ready_to_bill', tech1
  );

  -- Manual pending
  insert into public.time_entries (
    technician_id, work_order_id, customer_id, entry_date, clock_in_at, clock_out_at, total_minutes,
    activity_type, billable_status, regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate,
    billing_rate, labor_cost, billable_amount, notes, is_manual, manual_entry_reason, approval_status, created_by
  ) values (
    tech1, wo1, cust1, current_date - 2,
    (current_date - 2) + time '13:00', (current_date - 2) + time '14:30', 90,
    'regular_work', 'billable', 1.5, 0, 45, 67.5, 95, 67.5, 142.5,
    '[CTRL-SEED] Manual pending approval', true, 'Missed punch after site Wi-Fi outage', 'pending_approval', tech1
  );

  -- Missing clock-out
  insert into public.time_entries (
    technician_id, work_order_id, customer_id, entry_date, clock_in_at, clock_out_at, total_minutes,
    activity_type, billable_status, regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate,
    billing_rate, labor_cost, billable_amount, notes, is_manual, approval_status, exception_flags, exception_severity, created_by
  ) values (
    tech2, wo2, cust1, current_date - 1,
    now() - interval '18 hours', null, 0,
    'regular_work', 'billable', 0, 0, 42, 63, 90, 0, 0,
    '[CTRL-SEED] Missing clock-out', false, 'missing_clock_out', array['missing_clock_out'], 'critical', tech2
  );

  -- Long shift warning sample (approved past)
  insert into public.time_entries (
    technician_id, work_order_id, customer_id, entry_date, clock_in_at, clock_out_at, total_minutes,
    activity_type, billable_status, regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate,
    billing_rate, labor_cost, billable_amount, notes, is_manual, approval_status, exception_flags, exception_severity,
    approved_by, approved_at, billing_status, created_by
  ) values (
    tech1, wo2, cust1, current_date - 4,
    (current_date - 4) + time '06:00', (current_date - 4) + time '20:00', 840,
    'regular_work', 'billable', 8, 6, 45, 67.5, 95, 765, 1520,
    '[CTRL-SEED] Long 14h shift', false, 'approved', array['long_shift_12h'], 'warning',
    mgr, now() - interval '3 days', 'ready_to_bill', tech1
  );

  -- Rejected
  insert into public.time_entries (
    technician_id, work_order_id, customer_id, entry_date, clock_in_at, clock_out_at, total_minutes,
    activity_type, billable_status, regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate,
    billing_rate, labor_cost, billable_amount, notes, is_manual, manual_entry_reason, approval_status,
    rejection_reason, rejected_at, rejected_by, approved_by, created_by
  ) values (
    tech2, wo1, cust1, current_date - 5,
    (current_date - 5) + time '22:00', (current_date - 5) + time '23:30', 90,
    'regular_work', 'billable', 1.5, 0, 42, 63, 90, 63, 135,
    '[CTRL-SEED] Rejected after-hours claim', true, 'Phone log', 'rejected',
    'No dispatch match — correct times or attach evidence', now() - interval '1 day', mgr, mgr, tech2
  );

  -- Billed entry
  insert into public.time_entries (
    technician_id, work_order_id, customer_id, entry_date, clock_in_at, clock_out_at, total_minutes,
    activity_type, billable_status, regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate,
    billing_rate, labor_cost, billable_amount, notes, is_manual, approval_status, approved_by, approved_at,
    billing_status, billed_at, billed_by, locked_at, locked_by, created_by
  ) values (
    tech1, wo1, cust1, current_date - 10,
    (current_date - 10) + time '09:00', (current_date - 10) + time '11:00', 120,
    'regular_work', 'billable', 2, 0, 45, 67.5, 95, 90, 190,
    '[CTRL-SEED] Already billed', false, 'locked', mgr, now() - interval '8 days',
    'billed', now() - interval '7 days', mgr, now() - interval '7 days', mgr, tech1
  );

  -- Voided with reason
  insert into public.time_entries (
    technician_id, work_order_id, customer_id, entry_date, clock_in_at, clock_out_at, total_minutes,
    activity_type, billable_status, regular_hours, overtime_hours, hourly_cost_rate, overtime_cost_rate,
    billing_rate, labor_cost, billable_amount, notes, is_manual, approval_status,
    is_void, voided_at, voided_by, void_reason, deleted_at, created_by
  ) values (
    tech1, wo2, cust1, current_date - 6,
    (current_date - 6) + time '10:00', (current_date - 6) + time '10:30', 30,
    'travel', 'billable', 0.5, 0, 45, 67.5, 95, 22.5, 47.5,
    '[CTRL-SEED] Voided duplicate travel', false, 'complete',
    true, now() - interval '12 hours', mgr, 'Duplicate of existing travel leg', now() - interval '12 hours', tech1
  );

  -- Weekly submitted sheet sample
  insert into public.weekly_timesheets (
    technician_id, week_start, week_end, status, certification_text, certified_at, certified_name,
    submitted_at, submitted_by
  ) values (
    tech1,
    date_trunc('week', current_date::timestamp)::date - 7,
    date_trunc('week', current_date::timestamp)::date - 1,
    'submitted',
    'I confirm that these time entries are complete and accurately represent the time and activities I worked during this period.',
    now() - interval '2 days',
    'Taylor Tech',
    now() - interval '2 days',
    tech1
  ) on conflict do nothing;
end $$;
