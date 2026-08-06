-- QuickBooks-style vendor AP subledger: vendors, bills, payments.

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  email text,
  phone text,
  address_line1 text,
  city text,
  state text,
  postal_code text,
  payment_terms text not null default 'Net 30',
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vendors_name_lower_uidx
  on public.vendors (lower(name));

create index if not exists vendors_is_active_idx
  on public.vendors (is_active);

create table if not exists public.vendor_bills (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete restrict,
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
  constraint vendor_bills_amount_paid_lte_amount check (amount_paid <= amount)
);

create index if not exists vendor_bills_vendor_id_idx
  on public.vendor_bills (vendor_id);

create index if not exists vendor_bills_status_idx
  on public.vendor_bills (status);

create index if not exists vendor_bills_due_date_idx
  on public.vendor_bills (due_date);

create table if not exists public.vendor_bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.vendor_bills (id) on delete restrict,
  payment_date date not null default (current_date),
  amount numeric(12, 2) not null check (amount > 0),
  method text not null default 'Check'
    check (method in ('Check', 'ACH', 'Cash', 'Card', 'Other')),
  memo text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists vendor_bill_payments_bill_id_idx
  on public.vendor_bill_payments (bill_id);

alter table public.vendors enable row level security;
alter table public.vendor_bills enable row level security;
alter table public.vendor_bill_payments enable row level security;

-- Manager / admin / billing AP access
create policy vendors_ap_select
  on public.vendors
  for select
  to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

create policy vendors_ap_insert
  on public.vendors
  for insert
  to authenticated
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role
    )
  );

create policy vendors_ap_update
  on public.vendors
  for update
  to authenticated
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

create policy vendor_bills_ap_select
  on public.vendor_bills
  for select
  to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

create policy vendor_bills_ap_insert
  on public.vendor_bills
  for insert
  to authenticated
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

create policy vendor_bills_ap_update
  on public.vendor_bills
  for update
  to authenticated
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

create policy vendor_bill_payments_ap_select
  on public.vendor_bill_payments
  for select
  to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

create policy vendor_bill_payments_ap_insert
  on public.vendor_bill_payments
  for insert
  to authenticated
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
  );

grant select, insert, update on public.vendors to authenticated;
grant select, insert, update on public.vendor_bills to authenticated;
grant select, insert on public.vendor_bill_payments to authenticated;
