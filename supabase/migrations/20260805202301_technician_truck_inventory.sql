create table public.truck_inventory (
  technician_id uuid not null references public.profiles(id) on delete cascade,
  part_id uuid not null references public.parts(id),
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  typical_job_quantity integer not null default 2 check (typical_job_quantity > 0),
  last_restocked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (technician_id, part_id)
);

create index truck_inventory_part_id_idx on public.truck_inventory(part_id);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles(id),
  part_id uuid not null references public.parts(id),
  quantity_requested integer not null check (quantity_requested > 0),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'fulfilled')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index purchase_orders_technician_id_idx on public.purchase_orders(technician_id);
create index purchase_orders_part_id_idx on public.purchase_orders(part_id);

create table public.emergency_purchases (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles(id),
  job_id uuid not null references public.work_orders(id),
  part_id uuid not null references public.parts(id),
  part_name text not null,
  quantity integer not null check (quantity > 0),
  amount_paid numeric(12, 2) not null check (amount_paid >= 0),
  store_name text not null check (nullif(btrim(store_name), '') is not null),
  receipt_url text not null check (nullif(btrim(receipt_url), '') is not null),
  purchased_at timestamptz not null default now(),
  status text not null default 'submitted'
    check (status in ('submitted', 'reimbursed')),
  reimbursed_at timestamptz,
  created_at timestamptz not null default now()
);

create index emergency_purchases_technician_id_idx
on public.emergency_purchases(technician_id);
create index emergency_purchases_job_id_idx
on public.emergency_purchases(job_id);
create index emergency_purchases_part_id_idx
on public.emergency_purchases(part_id);

alter table public.truck_inventory enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.emergency_purchases enable row level security;

create policy truck_inventory_select
on public.truck_inventory
for select
to authenticated
using (
  technician_id = (select auth.uid())
  or (select public.is_manager())
);

create policy truck_inventory_manager_insert
on public.truck_inventory
for insert
to authenticated
with check ((select public.is_manager()));

create policy truck_inventory_manager_update
on public.truck_inventory
for update
to authenticated
using ((select public.is_manager()))
with check ((select public.is_manager()));

create policy truck_inventory_manager_delete
on public.truck_inventory
for delete
to authenticated
using ((select public.is_manager()));

create policy purchase_orders_select
on public.purchase_orders
for select
to authenticated
using (
  technician_id = (select auth.uid())
  or (select public.is_manager())
  or (select public.is_billing())
);

create policy purchase_orders_insert
on public.purchase_orders
for insert
to authenticated
with check (
  (select public.is_manager())
  or (
    technician_id = (select auth.uid())
    and status = 'pending'
    and exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = 'technician'
        and profiles.is_active = true
    )
  )
);

create policy purchase_orders_manager_update
on public.purchase_orders
for update
to authenticated
using ((select public.is_manager()))
with check ((select public.is_manager()));

create policy purchase_orders_manager_delete
on public.purchase_orders
for delete
to authenticated
using ((select public.is_manager()));

create policy emergency_purchases_select
on public.emergency_purchases
for select
to authenticated
using (
  technician_id = (select auth.uid())
  or (select public.is_manager())
  or (select public.is_billing())
);

create policy emergency_purchases_manager_update
on public.emergency_purchases
for update
to authenticated
using ((select public.is_manager()))
with check ((select public.is_manager()));

grant select, insert, update, delete on public.truck_inventory to authenticated;
grant select, insert, update, delete on public.purchase_orders to authenticated;
grant select, insert, update on public.emergency_purchases to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'emergency-purchase-receipts',
  'emergency-purchase-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy emergency_receipts_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'emergency-purchase-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.work_orders
    where work_orders.id::text = (storage.foldername(name))[2]
      and work_orders.assigned_technician_id = (select auth.uid())
      and work_orders.status <> 'Canceled'
  )
);

create policy emergency_receipts_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'emergency-purchase-receipts'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select public.is_manager())
    or (select public.is_billing())
  )
);

create policy emergency_receipts_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'emergency-purchase-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create or replace function private.log_emergency_purchase(
  p_job_id uuid,
  p_part_id uuid,
  p_quantity integer,
  p_amount_paid numeric,
  p_store_name text,
  p_receipt_url text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_part public.parts%rowtype;
  v_purchase_id uuid;
  v_expected_prefix text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'technician'
      and is_active = true
  ) then
    raise exception 'Only active technicians can log emergency purchases';
  end if;

  if p_quantity < 1 then
    raise exception 'Quantity must be at least 1';
  end if;

  if p_amount_paid < 0 then
    raise exception 'Amount paid must be zero or greater';
  end if;

  if nullif(btrim(p_store_name), '') is null then
    raise exception 'Store name is required';
  end if;

  if not exists (
    select 1
    from public.work_orders
    where id = p_job_id
      and assigned_technician_id = auth.uid()
      and status <> 'Canceled'
  ) then
    raise exception 'Select one of your assigned jobs';
  end if;

  select *
  into v_part
  from public.parts
  where id = p_part_id
    and is_active = true;

  if not found then
    raise exception 'Selected part is unavailable';
  end if;

  v_expected_prefix := auth.uid()::text || '/' || p_job_id::text || '/';
  if p_receipt_url not like v_expected_prefix || '%' then
    raise exception 'Receipt path does not match this technician and job';
  end if;

  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'emergency-purchase-receipts'
      and name = p_receipt_url
  ) then
    raise exception 'Receipt required to log an emergency purchase';
  end if;

  insert into public.truck_inventory (
    technician_id,
    part_id,
    quantity_on_hand,
    last_restocked_at,
    updated_at
  )
  values (
    auth.uid(),
    p_part_id,
    p_quantity,
    now(),
    now()
  )
  on conflict (technician_id, part_id)
  do update set
    quantity_on_hand = public.truck_inventory.quantity_on_hand + excluded.quantity_on_hand,
    last_restocked_at = excluded.last_restocked_at,
    updated_at = excluded.updated_at;

  insert into public.emergency_purchases (
    technician_id,
    job_id,
    part_id,
    part_name,
    quantity,
    amount_paid,
    store_name,
    receipt_url
  )
  values (
    auth.uid(),
    p_job_id,
    p_part_id,
    v_part.name,
    p_quantity,
    p_amount_paid,
    btrim(p_store_name),
    p_receipt_url
  )
  returning id into v_purchase_id;

  return v_purchase_id;
end;
$$;

revoke all on function private.log_emergency_purchase(
  uuid,
  uuid,
  integer,
  numeric,
  text,
  text
) from public, anon, authenticated;
grant execute on function private.log_emergency_purchase(
  uuid,
  uuid,
  integer,
  numeric,
  text,
  text
) to authenticated;

create or replace function public.log_emergency_purchase(
  p_job_id uuid,
  p_part_id uuid,
  p_quantity integer,
  p_amount_paid numeric,
  p_store_name text,
  p_receipt_url text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.log_emergency_purchase(
    p_job_id,
    p_part_id,
    p_quantity,
    p_amount_paid,
    p_store_name,
    p_receipt_url
  );
$$;

revoke all on function public.log_emergency_purchase(
  uuid,
  uuid,
  integer,
  numeric,
  text,
  text
) from public, anon;
grant execute on function public.log_emergency_purchase(
  uuid,
  uuid,
  integer,
  numeric,
  text,
  text
) to authenticated;
