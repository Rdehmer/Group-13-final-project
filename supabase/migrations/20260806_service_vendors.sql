-- Ecotrak-style service providers (companies we buy services from).

create table if not exists public.service_vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  primary_trade text not null default 'General',
  trades text[] not null default '{}',
  contact_name text,
  email text,
  phone text,
  address_line1 text,
  city text,
  state text,
  postal_code text,
  service_area text,
  notes text,
  is_active boolean not null default true,
  approval_status text not null default 'Approved'
    check (approval_status in ('Pending', 'Approved', 'Rejected')),
  requested_by uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists service_vendors_name_lower_uidx
  on public.service_vendors (lower(name));

create index if not exists service_vendors_trade_idx
  on public.service_vendors (primary_trade);

create index if not exists service_vendors_approval_status_idx
  on public.service_vendors (approval_status);

-- Link work orders to an external service provider
alter table public.work_orders
  add column if not exists service_vendor_id uuid
    references public.service_vendors (id) on delete set null;

create index if not exists work_orders_service_vendor_id_idx
  on public.work_orders (service_vendor_id);

create table if not exists public.service_vendor_bills (
  id uuid primary key default gen_random_uuid(),
  service_vendor_id uuid not null references public.service_vendors (id) on delete restrict,
  work_order_id uuid references public.work_orders (id) on delete set null,
  bill_number text not null,
  bill_date date not null default (current_date),
  due_date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  amount_paid numeric(12, 2) not null default 0 check (amount_paid >= 0),
  status text not null default 'Open'
    check (status in ('Open', 'Partial', 'Paid', 'Void')),
  memo text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_vendor_bills_paid_lte_amount check (amount_paid <= amount)
);

create index if not exists service_vendor_bills_vendor_idx
  on public.service_vendor_bills (service_vendor_id);

create index if not exists service_vendor_bills_wo_idx
  on public.service_vendor_bills (work_order_id);

create table if not exists public.service_vendor_ratings (
  id uuid primary key default gen_random_uuid(),
  service_vendor_id uuid not null references public.service_vendors (id) on delete cascade,
  work_order_id uuid references public.work_orders (id) on delete set null,
  rating integer not null check (rating >= 1 and rating <= 5),
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists service_vendor_ratings_vendor_idx
  on public.service_vendor_ratings (service_vendor_id);

alter table public.service_vendors enable row level security;
alter table public.service_vendor_bills enable row level security;
alter table public.service_vendor_ratings enable row level security;

create policy service_vendors_select on public.service_vendors
  for select to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

create policy service_vendors_insert on public.service_vendors
  for insert to authenticated
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role
    )
  );

create policy service_vendors_update on public.service_vendors
  for update to authenticated
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

create policy service_vendors_delete on public.service_vendors
  for delete to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role
    )
  );

create policy service_vendor_bills_select on public.service_vendor_bills
  for select to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

create policy service_vendor_bills_insert on public.service_vendor_bills
  for insert to authenticated
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

create policy service_vendor_bills_update on public.service_vendor_bills
  for update to authenticated
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

create policy service_vendor_ratings_select on public.service_vendor_ratings
  for select to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

create policy service_vendor_ratings_insert on public.service_vendor_ratings
  for insert to authenticated
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

grant select, insert, update, delete on public.service_vendors to authenticated;
grant select, insert, update on public.service_vendor_bills to authenticated;
grant select, insert on public.service_vendor_ratings to authenticated;
