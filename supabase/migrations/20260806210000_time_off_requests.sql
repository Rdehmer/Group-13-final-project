-- Time-off requests: technicians submit; managers approve/deny; approved ranges block the schedule.
create table if not exists public.time_off_requests (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'Pending'
    check (status in ('Pending', 'Approved', 'Denied', 'Canceled')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_off_requests_dates check (end_date >= start_date)
);

create index if not exists time_off_requests_technician_idx on public.time_off_requests (technician_id);
create index if not exists time_off_requests_status_idx on public.time_off_requests (status);
create index if not exists time_off_requests_range_idx on public.time_off_requests (start_date, end_date);

alter table public.time_off_requests enable row level security;

-- Technicians: read own requests
drop policy if exists time_off_select_own on public.time_off_requests;
create policy time_off_select_own on public.time_off_requests
  for select to authenticated
  using (
    technician_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager')
    )
  );

-- Technicians: insert own pending requests
drop policy if exists time_off_insert_own on public.time_off_requests;
create policy time_off_insert_own on public.time_off_requests
  for insert to authenticated
  with check (
    technician_id = auth.uid()
    and status = 'Pending'
  );

-- Technicians: cancel own pending
drop policy if exists time_off_update_own_pending on public.time_off_requests;
create policy time_off_update_own_pending on public.time_off_requests
  for update to authenticated
  using (
    technician_id = auth.uid()
    and status = 'Pending'
  )
  with check (
    technician_id = auth.uid()
    and status in ('Pending', 'Canceled')
  );

-- Managers: update any (approve/deny)
drop policy if exists time_off_update_manager on public.time_off_requests;
create policy time_off_update_manager on public.time_off_requests
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

grant select, insert, update on public.time_off_requests to authenticated;
