-- Vendor must Accept/Reject a job offer before it is fully assigned.
-- Demo customer phones: include Austin TX area code (512).

alter table public.work_orders
  add column if not exists vendor_assignment_status text
    check (
      vendor_assignment_status is null
      or vendor_assignment_status in ('Pending', 'Accepted', 'Rejected')
    );

comment on column public.work_orders.vendor_assignment_status is
  'Pending = offered to portal vendor; Accepted = vendor took the job; Rejected = declined.';

create index if not exists work_orders_vendor_assignment_pending_idx
  on public.work_orders (assigned_vendor_id, vendor_assignment_status)
  where assigned_vendor_id is not null;

-- Existing vendor assignments treated as already accepted so work is not interrupted.
update public.work_orders
set vendor_assignment_status = 'Accepted'
where assigned_vendor_id is not null
  and vendor_assignment_status is null;

-- Austin, TX demo customers — full 10-digit numbers with area code
update public.customers
set phone = '512-555-0101',
    updated_at = now()
where id = '11111111-1111-1111-1111-111111111101'
  and (phone is null or phone in ('555-0101', '662-555-0101', '512-555-0101') or length(regexp_replace(phone, '\D', '', 'g')) < 10);

update public.customers
set phone = '512-555-0142',
    updated_at = now()
where id = '22222222-2222-2222-2222-222222222201'
  and (phone is null or phone in ('555-0142', '512-555-0142') or length(regexp_replace(phone, '\D', '', 'g')) < 10);

-- Ensure Midwest vendor contact phone has an area code for portal display
update public.vendors
set phone = coalesce(nullif(phone, ''), '512-555-0199'),
    updated_at = now()
where name = 'Midwest Parts Supply'
  and (phone is null or phone = '' or length(regexp_replace(phone, '\D', '', 'g')) < 10);
