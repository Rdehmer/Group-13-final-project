create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.update_technician_work_order_part(
  p_usage_id uuid,
  p_part_id uuid,
  p_quantity integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage public.work_order_parts%rowtype;
  v_new_part public.parts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_quantity < 1 then
    raise exception 'Quantity must be at least 1';
  end if;

  select usage.*
  into v_usage
  from public.work_order_parts as usage
  join public.work_orders as work_order on work_order.id = usage.work_order_id
  where usage.id = p_usage_id
    and work_order.assigned_technician_id = auth.uid()
    and work_order.status not in ('Completed', 'Closed', 'Canceled')
  for update of usage;

  if not found then
    raise exception 'Part usage is not editable';
  end if;

  select *
  into v_new_part
  from public.parts
  where id = p_part_id
    and is_active = true
  for update;

  if not found then
    raise exception 'Selected part is not available';
  end if;

  if v_usage.part_id = p_part_id then
    update public.parts
    set
      quantity_on_hand = quantity_on_hand + v_usage.quantity_used - p_quantity,
      updated_at = now()
    where id = p_part_id
      and quantity_on_hand + v_usage.quantity_used >= p_quantity;

    if not found then
      raise exception 'Not enough inventory for that quantity';
    end if;
  else
    update public.parts
    set
      quantity_on_hand = quantity_on_hand + v_usage.quantity_used,
      updated_at = now()
    where id = v_usage.part_id;

    update public.parts
    set
      quantity_on_hand = quantity_on_hand - p_quantity,
      updated_at = now()
    where id = p_part_id
      and quantity_on_hand >= p_quantity;

    if not found then
      raise exception 'Not enough inventory for that quantity';
    end if;
  end if;

  update public.work_order_parts
  set
    part_id = p_part_id,
    quantity_used = p_quantity,
    unit_cost = v_new_part.unit_cost,
    customer_price = v_new_part.standard_customer_price,
    billable_amount = v_new_part.standard_customer_price * p_quantity
  where id = p_usage_id;
end;
$$;

revoke all on function private.update_technician_work_order_part(uuid, uuid, integer)
from public, anon, authenticated;
grant execute on function private.update_technician_work_order_part(uuid, uuid, integer)
to authenticated;

create or replace function public.update_technician_work_order_part(
  p_usage_id uuid,
  p_part_id uuid,
  p_quantity integer
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.update_technician_work_order_part(p_usage_id, p_part_id, p_quantity);
$$;

revoke all on function public.update_technician_work_order_part(uuid, uuid, integer)
from public, anon;
grant execute on function public.update_technician_work_order_part(uuid, uuid, integer)
to authenticated;
