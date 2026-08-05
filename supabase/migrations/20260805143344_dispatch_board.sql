alter table public.work_orders
  add column dispatch_status text not null default 'Not Started'
    check (dispatch_status in (
      'Not Started',
      'En Route',
      'Working',
      'Parts Ordered',
      'Coming in Late',
      'Not Available',
      'Done'
    )),
  add column dispatch_note text;

create table public.technician_dispatch_shifts (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles(id) on delete cascade,
  shift_date date not null default current_date,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (technician_id, shift_date),
  check (clock_out_at is null or clock_in_at is not null),
  check (clock_out_at is null or clock_out_at >= clock_in_at)
);

alter table public.technician_dispatch_shifts enable row level security;

create policy "dispatch_shifts_manager"
on public.technician_dispatch_shifts
for all
to authenticated
using (is_manager())
with check (is_manager());

create policy "dispatch_shifts_technician_select"
on public.technician_dispatch_shifts
for select
to authenticated
using (
  app_user_role() = 'technician'::user_role
  and technician_id = auth.uid()
);

create policy "dispatch_shifts_technician_insert"
on public.technician_dispatch_shifts
for insert
to authenticated
with check (
  app_user_role() = 'technician'::user_role
  and technician_id = auth.uid()
);

create policy "dispatch_shifts_technician_update"
on public.technician_dispatch_shifts
for update
to authenticated
using (
  app_user_role() = 'technician'::user_role
  and technician_id = auth.uid()
)
with check (
  app_user_role() = 'technician'::user_role
  and technician_id = auth.uid()
);

grant select, insert, update on public.technician_dispatch_shifts to authenticated;
