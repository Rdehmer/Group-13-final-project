-- Accounting batches (ServiceTitan-style invoice & payment batching)
-- Run in Supabase SQL Editor for project bpiqnmjntlmruswzazlj

-- Header: groups invoices and/or payments for review → post → export
create table if not exists public.accounting_batches (
  id uuid primary key default gen_random_uuid(),
  batch_number text not null unique,
  batch_type text not null default 'invoice'
    check (batch_type in ('invoice', 'payment', 'mixed')),
  name text,
  status text not null default 'Open'
    check (status in ('Open', 'Posted', 'Exported')),
  batch_date date not null default (current_date),
  payment_method text,
  notes text,
  invoice_total numeric(12, 2) not null default 0,
  payment_total numeric(12, 2) not null default 0,
  invoice_count integer not null default 0,
  payment_count integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  posted_by uuid references public.profiles (id) on delete set null,
  posted_at timestamptz,
  exported_by uuid references public.profiles (id) on delete set null,
  exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists accounting_batches_status_idx on public.accounting_batches (status);
create index if not exists accounting_batches_date_idx on public.accounting_batches (batch_date desc);
create index if not exists accounting_batches_type_idx on public.accounting_batches (batch_type);

-- Invoices in a batch (one invoice can only be in one batch)
create table if not exists public.accounting_batch_invoices (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.accounting_batches (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  amount numeric(12, 2) not null default 0,
  added_at timestamptz not null default now(),
  unique (invoice_id)
);

create index if not exists accounting_batch_invoices_batch_idx
  on public.accounting_batch_invoices (batch_id);

-- Payments in a batch (one payment can only be in one batch)
create table if not exists public.accounting_batch_payments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.accounting_batches (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete restrict,
  amount numeric(12, 2) not null default 0,
  added_at timestamptz not null default now(),
  unique (payment_id)
);

create index if not exists accounting_batch_payments_batch_idx
  on public.accounting_batch_payments (batch_id);

alter table public.accounting_batches enable row level security;
alter table public.accounting_batch_invoices enable row level security;
alter table public.accounting_batch_payments enable row level security;

drop policy if exists "auth all accounting_batches" on public.accounting_batches;
create policy "auth all accounting_batches"
  on public.accounting_batches for all to authenticated
  using (true) with check (true);

drop policy if exists "auth all accounting_batch_invoices" on public.accounting_batch_invoices;
create policy "auth all accounting_batch_invoices"
  on public.accounting_batch_invoices for all to authenticated
  using (true) with check (true);

drop policy if exists "auth all accounting_batch_payments" on public.accounting_batch_payments;
create policy "auth all accounting_batch_payments"
  on public.accounting_batch_payments for all to authenticated
  using (true) with check (true);

comment on table public.accounting_batches is
  'Accounting batches for invoice/payment grouping (Open → Posted → Exported), ServiceTitan-style.';
