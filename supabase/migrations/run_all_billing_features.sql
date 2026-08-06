-- Combined one-shot for billing/tech features (safe to re-run).
-- Paste in Supabase → SQL Editor for project ACCY628-Final-Project-G13.

-- Invoice assignment
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS invoices_assigned_to_idx ON public.invoices (assigned_to);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON public.invoices (status);

-- Invoice equipment + customer PO #
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS equipment_id uuid REFERENCES public.equipment (id) ON DELETE SET NULL;
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS po_number text;
CREATE INDEX IF NOT EXISTS invoices_equipment_id_idx ON public.invoices (equipment_id);

-- Purchase orders
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text NOT NULL,
  invoice_id uuid REFERENCES public.invoices (id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES public.work_orders (id) ON DELETE SET NULL,
  vendor_name text,
  notes text,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_orders_invoice_id_idx ON public.purchase_orders (invoice_id);
CREATE INDEX IF NOT EXISTS purchase_orders_work_order_id_idx ON public.purchase_orders (work_order_id);

CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders (id) ON DELETE CASCADE,
  part_id uuid REFERENCES public.parts (id) ON DELETE SET NULL,
  part_number text,
  part_name text,
  description text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_order_lines_po_id_idx ON public.purchase_order_lines (purchase_order_id);

CREATE TABLE IF NOT EXISTS public.purchase_order_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders (id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text,
  mime_type text,
  file_size integer,
  file_data text,
  uploaded_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_order_attachments_po_id_idx ON public.purchase_order_attachments (purchase_order_id);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_orders_all_auth ON public.purchase_orders;
CREATE POLICY purchase_orders_all_auth ON public.purchase_orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS purchase_order_lines_all_auth ON public.purchase_order_lines;
CREATE POLICY purchase_order_lines_all_auth ON public.purchase_order_lines
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS purchase_order_attachments_all_auth ON public.purchase_order_attachments;
CREATE POLICY purchase_order_attachments_all_auth ON public.purchase_order_attachments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Optional storage for receipt PDFs/images (also works via file_data fallback for small files):
-- Storage → New bucket → name: po-receipts → allow authenticated uploads if desired.
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
