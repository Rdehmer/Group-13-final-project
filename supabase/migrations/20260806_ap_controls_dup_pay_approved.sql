-- AP controls:
-- 1) Duplicate bill numbers blocked per vendor (non-void)
-- 2) Payments: manager/admin only
-- 3) Bills only against Approved + Active vendors / service vendors

-- Unique bill # per supplier (ignore voids so numbers can be reused after void)
create unique index if not exists vendor_bills_vendor_bill_number_uidx
  on public.vendor_bills (vendor_id, lower(trim(bill_number)))
  where status is distinct from 'Void';

create unique index if not exists service_vendor_bills_vendor_bill_number_uidx
  on public.service_vendor_bills (service_vendor_id, lower(trim(bill_number)))
  where status is distinct from 'Void';

-- Bills: require Approved + Active vendor
drop policy if exists vendor_bills_ap_insert on public.vendor_bills;
create policy vendor_bills_ap_insert
  on public.vendor_bills
  for insert
  to authenticated
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
    and exists (
      select 1
      from public.vendors v
      where v.id = vendor_id
        and v.is_active = true
        and coalesce(v.approval_status, 'Approved') = 'Approved'
    )
  );

drop policy if exists service_vendor_bills_insert on public.service_vendor_bills;
create policy service_vendor_bills_insert
  on public.service_vendor_bills
  for insert
  to authenticated
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role,
      'billing'::user_role
    )
    and exists (
      select 1
      from public.service_vendors v
      where v.id = service_vendor_id
        and v.is_active = true
        and coalesce(v.approval_status, 'Approved') = 'Approved'
    )
  );

-- Payments: manager / admin only (billing enters bills; mgmt records payment)
drop policy if exists vendor_bill_payments_ap_insert on public.vendor_bill_payments;
create policy vendor_bill_payments_ap_insert
  on public.vendor_bill_payments
  for insert
  to authenticated
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role
    )
  );
