-- Only administrators and service managers may create vendors / service vendors.
-- Billing retains select/update (AP bills, inactive) but cannot insert master records.

drop policy if exists vendors_ap_insert on public.vendors;
create policy vendors_ap_insert
  on public.vendors
  for insert
  to authenticated
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role
    )
  );

drop policy if exists service_vendors_insert on public.service_vendors;
create policy service_vendors_insert
  on public.service_vendors
  for insert
  to authenticated
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role
    )
  );
