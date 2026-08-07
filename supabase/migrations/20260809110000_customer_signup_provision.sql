-- Auto-provision customers rows for self-serve customer sign-ups and link profiles.customer_id.
-- Hot Customer (no contract) → contract customer when service_contracts become Active/Renewed (app UI).

-- Default company from company_contract_plan_catalogs migration.
-- provision_customer_for_profile: create or link customer for customer-role profiles.
create or replace function public.provision_customer_for_profile(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile record;
  v_meta jsonb;
  v_business_name text;
  v_full_name text;
  v_customer_name text;
  v_customer_id uuid;
  v_company_id uuid := '00000000-0000-4000-8000-000000000001';
begin
  select p.id, p.email, p.full_name, p.role, p.customer_id
  into v_profile
  from public.profiles p
  where p.id = p_profile_id;

  if not found
    or v_profile.customer_id is not null
    or v_profile.role is distinct from 'customer'::user_role
  then
    return;
  end if;

  select u.raw_user_meta_data
  into v_meta
  from auth.users u
  where u.id = p_profile_id;

  v_business_name := nullif(trim(coalesce(v_meta->>'business_name', '')), '');
  v_full_name := nullif(
    trim(coalesce(v_meta->>'full_name', v_profile.full_name, '')),
    ''
  );
  v_customer_name := coalesce(
    v_business_name,
    v_full_name,
    nullif(split_part(v_profile.email, '@', 1), ''),
    'New Customer'
  );

  select c.id
  into v_customer_id
  from public.customers c
  where c.company_id = v_company_id
    and v_profile.email is not null
    and lower(c.email) = lower(v_profile.email)
  limit 1;

  if v_customer_id is null then
    insert into public.customers (
      name,
      primary_contact_name,
      email,
      status,
      payment_terms,
      notes,
      company_id
    )
    values (
      v_customer_name,
      v_full_name,
      v_profile.email,
      'Active',
      'Due on Receipt',
      'Self-registered via customer portal',
      v_company_id
    )
    returning id into v_customer_id;
  end if;

  update public.profiles
  set customer_id = v_customer_id,
      updated_at = now()
  where id = p_profile_id
    and customer_id is null;
end;
$$;

comment on function public.provision_customer_for_profile(uuid) is
  'Creates or links a customers row for a customer-role profile without customer_id (sign-up provisioning).';

-- Profile trigger: provision when role is customer and not yet linked.
create or replace function public.trg_profiles_provision_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'customer'::user_role and new.customer_id is null then
    perform public.provision_customer_for_profile(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_provision_customer on public.profiles;
create trigger profiles_provision_customer
  after insert or update of role, customer_id
  on public.profiles
  for each row
  execute function public.trg_profiles_provision_customer();

-- Auth sign-up: ensure profile exists, then provision customer.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, company_id, is_active)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    'customer'::user_role,
    '00000000-0000-4000-8000-000000000001',
    true
  )
  on conflict (id) do nothing;

  perform public.provision_customer_for_profile(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Backfill any existing customer-role profiles missing a CRM link.
do $$
declare
  r record;
begin
  for r in
    select p.id
    from public.profiles p
    where p.role = 'customer'::user_role
      and p.customer_id is null
  loop
    perform public.provision_customer_for_profile(r.id);
  end loop;
end;
$$;
