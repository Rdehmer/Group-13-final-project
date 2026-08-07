-- 1) Vendor master updates: manager/admin only (billing remains AP on bills/payments).
-- 2) Parts link to suppliers via vendor_id; keep supplier text synced for display/filters.

drop policy if exists vendors_ap_update on public.vendors;
create policy vendors_ap_update
  on public.vendors
  for update
  to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role
    )
  )
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role
    )
  );

drop policy if exists service_vendors_update on public.service_vendors;
create policy service_vendors_update
  on public.service_vendors
  for update
  to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role
    )
  )
  with check (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role
    )
  );

alter table public.parts
  add column if not exists vendor_id uuid references public.vendors (id) on delete set null;

create index if not exists parts_vendor_id_idx on public.parts (vendor_id);

-- Backfill from free-text supplier matching approved vendor names (case-insensitive).
update public.parts p
set vendor_id = v.id
from public.vendors v
where p.vendor_id is null
  and p.supplier is not null
  and length(trim(p.supplier)) > 0
  and lower(trim(p.supplier)) = lower(trim(v.name));

-- Prefer canonical vendor name when linked.
update public.parts p
set supplier = v.name
from public.vendors v
where p.vendor_id = v.id
  and (p.supplier is distinct from v.name);
