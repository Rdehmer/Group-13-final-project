-- Truck parts burn: debit truck_inventory and write work_order_parts atomically.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.use_truck_part_on_work_order(
  p_work_order_id uuid,
  p_part_id uuid,
  p_quantity integer,
  p_scope_acknowledged boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wo public.work_orders%rowtype;
  v_part public.parts%rowtype;
  v_truck_qty integer;
  v_usage_id uuid;
  v_out_of_scope boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_quantity < 1 then
    raise exception 'Quantity must be at least 1';
  end if;

  select *
  into v_wo
  from public.work_orders
  where id = p_work_order_id
    and assigned_technician_id = auth.uid()
    and status not in ('Completed', 'Closed', 'Canceled')
  for update;

  if not found then
    raise exception 'Work order is not available for parts burn';
  end if;

  v_out_of_scope :=
    coalesce(v_wo.under_expired_contract, false)
    or v_wo.contract_id is null
    or coalesce(v_wo.warranty_coverage, '') in ('Not Covered', 'Labor Covered');

  if v_out_of_scope and not coalesce(p_scope_acknowledged, false) then
    raise exception 'OUT_OF_SCOPE: Customer acknowledgment required before installing this part';
  end if;

  select quantity_on_hand
  into v_truck_qty
  from public.truck_inventory
  where technician_id = auth.uid()
    and part_id = p_part_id
  for update;

  if not found or v_truck_qty < p_quantity then
    raise exception 'Not enough quantity on your truck for that part';
  end if;

  select *
  into v_part
  from public.parts
  where id = p_part_id
    and is_active = true
  for update;

  if not found then
    raise exception 'Selected part is not available';
  end if;

  update public.truck_inventory
  set
    quantity_on_hand = quantity_on_hand - p_quantity,
    updated_at = now()
  where technician_id = auth.uid()
    and part_id = p_part_id
    and quantity_on_hand >= p_quantity;

  if not found then
    raise exception 'Not enough quantity on your truck for that part';
  end if;

  update public.parts
  set
    quantity_on_hand = greatest(0, quantity_on_hand - p_quantity),
    updated_at = now()
  where id = p_part_id;

  insert into public.work_order_parts (
    work_order_id,
    part_id,
    quantity_used,
    unit_cost,
    customer_price,
    warranty_covered_amount,
    billable_amount,
    date_used
  )
  values (
    p_work_order_id,
    p_part_id,
    p_quantity,
    v_part.unit_cost,
    v_part.standard_customer_price,
    case when v_out_of_scope then 0 else v_part.standard_customer_price * p_quantity end,
    case when v_out_of_scope then v_part.standard_customer_price * p_quantity else 0 end,
    current_date
  )
  returning id into v_usage_id;

  return v_usage_id;
end;
$$;

revoke all on function private.use_truck_part_on_work_order(uuid, uuid, integer, boolean) from public;
grant execute on function private.use_truck_part_on_work_order(uuid, uuid, integer, boolean) to authenticated;

create or replace function public.use_truck_part_on_work_order(
  p_work_order_id uuid,
  p_part_id uuid,
  p_quantity integer,
  p_scope_acknowledged boolean default false
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.use_truck_part_on_work_order(
    p_work_order_id,
    p_part_id,
    p_quantity,
    p_scope_acknowledged
  );
$$;

revoke all on function public.use_truck_part_on_work_order(uuid, uuid, integer, boolean) from public;
grant execute on function public.use_truck_part_on_work_order(uuid, uuid, integer, boolean) to authenticated;
