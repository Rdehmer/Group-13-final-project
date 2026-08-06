-- Vendor approval workflow: mgmt/admin create & approve; billing uses approved vendors for AP.

alter table public.vendors
  add column if not exists approval_status text not null default 'Approved'
    check (approval_status in ('Pending', 'Approved', 'Rejected'));

alter table public.vendors
  add column if not exists requested_by uuid references public.profiles (id) on delete set null;

alter table public.vendors
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null;

alter table public.vendors
  add column if not exists reviewed_at timestamptz;

update public.vendors
set approval_status = 'Approved'
where approval_status is null or approval_status = '';

create index if not exists vendors_approval_status_idx
  on public.vendors (approval_status);

-- Mgmt/admin may delete vendors (app enforces no bills)
drop policy if exists vendors_ap_delete on public.vendors;
create policy vendors_ap_delete
  on public.vendors
  for delete
  to authenticated
  using (
    app_user_role() in (
      'administrator'::user_role,
      'service_manager'::user_role
    )
  );

grant delete on public.vendors to authenticated;
