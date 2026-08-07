-- Demo seed for vendor portal (idempotent).
-- Auth user: vendor1@equipmentiq-demo.test / DemoPass123!
-- Linked to Midwest Parts Supply vendor when present.

do $$
declare
  v_id uuid := 'a1111111-b222-c333-d444-e55555555555';
  vendor_uuid uuid;
begin
  select id into vendor_uuid from public.vendors where name = 'Midwest Parts Supply' limit 1;
  if vendor_uuid is null then
    insert into public.vendors (name, contact_name, email, specialty, approval_status, is_active)
    values ('Midwest Parts Supply', 'Sam Supplier', 'orders@midwestparts.example', 'Parts', 'Approved', true)
    returning id into vendor_uuid;
  end if;

  if not exists (select 1 from auth.users where email = 'vendor1@equipmentiq-demo.test') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_id,
      'authenticated',
      'authenticated',
      'vendor1@equipmentiq-demo.test',
      crypt('DemoPass123!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Midwest Vendor","role":"vendor"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    );

    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      v_id,
      v_id,
      format('{"sub":"%s","email":"vendor1@equipmentiq-demo.test"}', v_id)::jsonb,
      'email',
      v_id::text,
      now(),
      now(),
      now()
    );
  else
    select id into v_id from auth.users where email = 'vendor1@equipmentiq-demo.test';
  end if;

  update public.profiles
  set role = 'vendor'::user_role,
      full_name = coalesce(nullif(full_name, ''), 'Midwest Vendor'),
      vendor_id = vendor_uuid,
      updated_at = now()
  where id = v_id;

  update public.vendors
  set specialty = coalesce(specialty, 'Parts'),
      contact_name = coalesce(contact_name, 'Sam Supplier'),
      updated_at = now()
  where id = vendor_uuid;
end $$;
