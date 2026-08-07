-- Allow customers to update their account contact fields via RPC.

create or replace function public.update_my_contact_info(
  p_primary_contact_name text,
  p_email text,
  p_phone text
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
    primary_contact_name = nullif(trim(p_primary_contact_name), ''),
    email = nullif(trim(p_email), ''),
    phone = nullif(trim(p_phone), ''),
    updated_at = now()
  where id = my_customer_id();
end;
$$;

grant execute on function public.update_my_contact_info(text, text, text) to authenticated;
