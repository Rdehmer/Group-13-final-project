-- Customer Pay portal: apply Stripe/demo payments via SECURITY DEFINER RPC.
-- Customers can read invoices/payments but cannot INSERT/UPDATE under RLS.

create or replace function public.apply_my_portal_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_user_id uuid;
  v_inv record;
  v_existing record;
  v_payment_number text;
  v_new_paid numeric;
  v_new_balance numeric;
  v_status text;
  v_method text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Sign in required.');
  end if;

  if app_user_role() <> 'customer'::user_role then
    return jsonb_build_object('ok', false, 'error', 'Customer portal only.');
  end if;

  v_customer_id := my_customer_id();
  if v_customer_id is null then
    return jsonb_build_object('ok', false, 'error', 'No customer account linked.');
  end if;

  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Enter a valid payment amount.');
  end if;

  select
    id,
    invoice_number,
    invoice_total,
    amount_paid,
    remaining_balance,
    status
  into v_inv
  from public.invoices
  where id = p_invoice_id
    and customer_id = v_customer_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invoice not found.');
  end if;

  if lower(coalesce(v_inv.status, '')) like '%cancel%' then
    return jsonb_build_object('ok', false, 'error', 'Invoice is canceled.');
  end if;

  if p_reference_number is not null and trim(p_reference_number) <> '' then
    select payment_number
    into v_existing
    from public.payments
    where invoice_id = p_invoice_id
      and reference_number = trim(p_reference_number)
    limit 1;

    if found then
      return jsonb_build_object(
        'ok', true,
        'payment_number', v_existing.payment_number,
        'new_balance', v_inv.remaining_balance,
        'status', v_inv.status
      );
    end if;
  end if;

  if p_amount > v_inv.remaining_balance + 0.001 then
    return jsonb_build_object('ok', false, 'error', 'Amount cannot exceed the remaining balance.');
  end if;

  v_method := case
    when p_payment_method in ('Check', 'Credit Card', 'ACH', 'Bank Transfer', 'Other') then p_payment_method
    when lower(coalesce(p_payment_method, '')) like '%card%' then 'Credit Card'
    when lower(coalesce(p_payment_method, '')) like '%ach%' then 'ACH'
    when lower(coalesce(p_payment_method, '')) like '%bank%' then 'Bank Transfer'
    when lower(coalesce(p_payment_method, '')) like '%check%' then 'Check'
    else 'Other'
  end;

  v_payment_number :=
    'PAY-'
    || lpad((floor(extract(epoch from clock_timestamp()))::bigint % 100000000)::text, 8, '0')
    || '-'
    || upper(substr(md5(random()::text), 1, 3));

  insert into public.payments (
    payment_number,
    customer_id,
    invoice_id,
    payment_date,
    payment_method,
    payment_amount,
    reference_number,
    notes,
    created_by
  ) values (
    v_payment_number,
    v_customer_id,
    p_invoice_id,
    current_date,
    v_method,
    p_amount,
    nullif(trim(p_reference_number), ''),
    nullif(trim(p_notes), ''),
    v_user_id
  );

  v_new_paid := coalesce(v_inv.amount_paid, 0) + p_amount;
  v_new_balance := greatest(0, coalesce(v_inv.invoice_total, 0) - v_new_paid);

  if v_new_balance <= 0.005 then
    v_status := 'Paid';
  elsif v_new_paid > 0.005 then
    if lower(coalesce(v_inv.status, '')) like '%disputed%' then
      v_status := v_inv.status;
    else
      v_status := 'Partially Paid';
    end if;
  else
    v_status := v_inv.status;
  end if;

  update public.invoices
  set
    amount_paid = v_new_paid,
    remaining_balance = v_new_balance,
    status = v_status,
    updated_at = now()
  where id = p_invoice_id;

  return jsonb_build_object(
    'ok', true,
    'payment_number', v_payment_number,
    'new_balance', v_new_balance,
    'status', v_status
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

grant execute on function public.apply_my_portal_payment(uuid, numeric, text, text, text) to authenticated;
