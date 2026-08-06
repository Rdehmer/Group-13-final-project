-- Allow customers to update only their business address fields via RPC.

create or replace function public.update_my_business_address(
  p_service_address text,
  p_billing_address text,
  p_city text,
  p_state text,
  p_zip_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_user_role() <> 'customer'::user_role or my_customer_id() is null then
    raise exception 'Not authorized';
  end if;

  update public.customers
  set
    service_address = nullif(trim(p_service_address), ''),
    billing_address = nullif(trim(p_billing_address), ''),
    city = nullif(trim(p_city), ''),
    state = nullif(trim(p_state), ''),
    zip_code = nullif(trim(p_zip_code), ''),
    updated_at = now()
  where id = my_customer_id();
end;
$$;

grant execute on function public.update_my_business_address(text, text, text, text, text) to authenticated;
