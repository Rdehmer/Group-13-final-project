-- Vendor portal: specialty on vendors, vendor login role, work items + supply orders.
-- NOTE: `alter type ... add value 'vendor'` must be committed in a prior statement
-- (Postgres cannot use a new enum value in the same transaction). Apply that first if needed:
--   alter type public.user_role add value if not exists 'vendor';

-- 1) Vendor specialty (trade type)
alter table public.vendors
  add column if not exists specialty text;

comment on column public.vendors.specialty is
  'Trade / specialty for vendor portal (HVAC, Plumbing, Electrical, Parts, Other).';

-- 2) Link profiles → vendors (like customer_id)
alter table public.profiles
  add column if not exists vendor_id uuid references public.vendors (id) on delete set null;

create index if not exists profiles_vendor_id_idx
  on public.profiles (vendor_id)
  where vendor_id is not null;

comment on column public.profiles.vendor_id is
  'When role = vendor, scopes the login to this AP vendor record.';

-- Helper: current user's vendor_id
create or replace function public.app_user_vendor_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select vendor_id from public.profiles where id = auth.uid();
$$;

grant execute on function public.app_user_vendor_id() to authenticated;

-- Vendors may read their own vendor row
drop policy if exists vendors_portal_select_own on public.vendors;
create policy vendors_portal_select_own
  on public.vendors
  for select
  to authenticated
  using (
    app_user_role() = 'vendor'::user_role
    and id = app_user_vendor_id()
  );

-- 3) Work needed
create table if not exists public.vendor_work_items (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'Pending'
    check (status in ('Pending', 'Accepted', 'Rejected')),
  due_date date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vendor_work_items_vendor_id_idx
  on public.vendor_work_items (vendor_id);

create index if not exists vendor_work_items_status_idx
  on public.vendor_work_items (status);

-- 4) Orders needed (parts / supplies)
create table if not exists public.vendor_supply_orders (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  item_name text not null,
  quantity numeric(12, 2) not null default 1 check (quantity > 0),
  status text not null default 'Pending'
    check (status in ('Pending', 'Accepted', 'Rejected')),
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vendor_supply_orders_vendor_id_idx
  on public.vendor_supply_orders (vendor_id);

create index if not exists vendor_supply_orders_status_idx
  on public.vendor_supply_orders (status);

alter table public.vendor_work_items enable row level security;
alter table public.vendor_supply_orders enable row level security;

-- Management full access
drop policy if exists vendor_work_items_mgmt_all on public.vendor_work_items;
create policy vendor_work_items_mgmt_all
  on public.vendor_work_items
  for all
  to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role
    )
  )
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role
    )
  );

drop policy if exists vendor_supply_orders_mgmt_all on public.vendor_supply_orders;
create policy vendor_supply_orders_mgmt_all
  on public.vendor_supply_orders
  for all
  to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role
    )
  )
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role
    )
  );

-- Vendor: read own rows
drop policy if exists vendor_work_items_vendor_select on public.vendor_work_items;
create policy vendor_work_items_vendor_select
  on public.vendor_work_items
  for select
  to authenticated
  using (
    app_user_role() = 'vendor'::user_role
    and vendor_id = app_user_vendor_id()
  );

drop policy if exists vendor_supply_orders_vendor_select on public.vendor_supply_orders;
create policy vendor_supply_orders_vendor_select
  on public.vendor_supply_orders
  for select
  to authenticated
  using (
    app_user_role() = 'vendor'::user_role
    and vendor_id = app_user_vendor_id()
  );

-- Vendor: update own rows (app restricts to status-only)
drop policy if exists vendor_work_items_vendor_update on public.vendor_work_items;
create policy vendor_work_items_vendor_update
  on public.vendor_work_items
  for update
  to authenticated
  using (
    app_user_role() = 'vendor'::user_role
    and vendor_id = app_user_vendor_id()
  )
  with check (
    app_user_role() = 'vendor'::user_role
    and vendor_id = app_user_vendor_id()
  );

drop policy if exists vendor_supply_orders_vendor_update on public.vendor_supply_orders;
create policy vendor_supply_orders_vendor_update
  on public.vendor_supply_orders
  for update
  to authenticated
  using (
    app_user_role() = 'vendor'::user_role
    and vendor_id = app_user_vendor_id()
  )
  with check (
    app_user_role() = 'vendor'::user_role
    and vendor_id = app_user_vendor_id()
  );

grant select, insert, update, delete on public.vendor_work_items to authenticated;
grant select, insert, update, delete on public.vendor_supply_orders to authenticated;

comment on table public.vendor_work_items is
  'Work assignments for vendor portal (management creates; vendor accepts or rejects).';
comment on table public.vendor_supply_orders is
  'Parts/supplies orders for vendor portal (management creates; vendor accepts or rejects).';
