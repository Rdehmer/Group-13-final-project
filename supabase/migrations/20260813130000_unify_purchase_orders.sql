-- Unify technician restock requests and field job POs on purchase_orders.
-- Also add line/attachment tables for field PO receipts.

alter table public.purchase_orders
  add column if not exists order_type text not null default 'restock',
  add column if not exists po_number text,
  add column if not exists invoice_id uuid references public.invoices (id) on delete set null,
  add column if not exists work_order_id uuid references public.work_orders (id) on delete set null,
  add column if not exists vendor_name text,
  add column if not exists created_by uuid references public.profiles (id) on delete set null,
  add column if not exists vendor_supply_order_id uuid references public.vendor_supply_orders (id) on delete set null;

alter table public.vendor_supply_orders
  add column if not exists purchase_order_id uuid references public.purchase_orders (id) on delete set null;

update public.purchase_orders
set order_type = 'restock'
where order_type is null or order_type = '';

alter table public.purchase_orders
  alter column technician_id drop not null,
  alter column part_id drop not null;

alter table public.purchase_orders
  drop constraint if exists purchase_orders_quantity_requested_check;
alter table public.purchase_orders
  add constraint purchase_orders_quantity_requested_check
  check (quantity_requested is null or quantity_requested > 0);

alter table public.purchase_orders
  drop constraint if exists purchase_orders_status_check;
alter table public.purchase_orders
  add constraint purchase_orders_status_check
  check (status in ('pending', 'approved', 'fulfilled', 'open', 'closed'));

alter table public.purchase_orders
  drop constraint if exists purchase_orders_order_type_check;
alter table public.purchase_orders
  add constraint purchase_orders_order_type_check
  check (order_type in ('restock', 'field'));

alter table public.purchase_orders
  drop constraint if exists purchase_orders_shape_check;
alter table public.purchase_orders
  add constraint purchase_orders_shape_check
  check (
    (
      order_type = 'restock'
      and technician_id is not null
      and part_id is not null
      and quantity_requested is not null
    )
    or (
      order_type = 'field'
      and po_number is not null
    )
  );

create index if not exists purchase_orders_order_type_idx on public.purchase_orders (order_type);
create index if not exists purchase_orders_po_number_idx on public.purchase_orders (po_number);
create index if not exists purchase_orders_invoice_id_idx on public.purchase_orders (invoice_id);
create index if not exists purchase_orders_work_order_id_idx on public.purchase_orders (work_order_id);
create index if not exists vendor_supply_orders_purchase_order_id_idx
  on public.vendor_supply_orders (purchase_order_id);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  part_id uuid references public.parts (id) on delete set null,
  part_number text,
  part_name text,
  description text,
  quantity numeric not null default 1,
  unit_cost numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists purchase_order_lines_po_id_idx on public.purchase_order_lines (purchase_order_id);

create table if not exists public.purchase_order_attachments (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  file_name text not null,
  file_path text,
  mime_type text,
  file_size integer,
  file_data text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists purchase_order_attachments_po_id_idx
  on public.purchase_order_attachments (purchase_order_id);

alter table public.purchase_order_lines enable row level security;
alter table public.purchase_order_attachments enable row level security;

drop policy if exists purchase_order_lines_all_auth on public.purchase_order_lines;
create policy purchase_order_lines_all_auth on public.purchase_order_lines
  for all to authenticated using (true) with check (true);

drop policy if exists purchase_order_attachments_all_auth on public.purchase_order_attachments;
create policy purchase_order_attachments_all_auth on public.purchase_order_attachments
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.purchase_order_lines to authenticated;
grant select, insert, update, delete on public.purchase_order_attachments to authenticated;

-- Field PO inserts from jobs/invoices (managers, techs, billing, vendors on assigned jobs).
drop policy if exists purchase_orders_field_insert on public.purchase_orders;
create policy purchase_orders_field_insert on public.purchase_orders
  for insert to authenticated
  with check (
    order_type = 'field'
    and (
      (select public.is_manager())
      or (select public.is_billing())
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role in ('technician', 'vendor')
          and p.is_active = true
      )
    )
  );

drop policy if exists purchase_orders_field_select on public.purchase_orders;
create policy purchase_orders_field_select on public.purchase_orders
  for select to authenticated
  using (
    order_type = 'field'
    or technician_id = auth.uid()
    or (select public.is_manager())
    or (select public.is_billing())
  );

drop policy if exists purchase_orders_field_update on public.purchase_orders;
create policy purchase_orders_field_update on public.purchase_orders
  for update to authenticated
  using (
    order_type = 'field'
    and ((select public.is_manager()) or (select public.is_billing()))
  )
  with check (
    order_type = 'field'
    and ((select public.is_manager()) or (select public.is_billing()))
  );
