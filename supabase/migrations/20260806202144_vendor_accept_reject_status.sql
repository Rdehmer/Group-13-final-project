-- Vendor portal: work items and supply orders use Pending / Accepted / Rejected.

-- Work items
alter table public.vendor_work_items drop constraint if exists vendor_work_items_status_check;

update public.vendor_work_items
set status = case
  when status in ('In Progress', 'Completed', 'Accepted') then 'Accepted'
  when status = 'Rejected' then 'Rejected'
  else 'Pending'
end;

alter table public.vendor_work_items
  alter column status set default 'Pending';

alter table public.vendor_work_items
  add constraint vendor_work_items_status_check
  check (status in ('Pending', 'Accepted', 'Rejected'));

-- Supply orders
alter table public.vendor_supply_orders drop constraint if exists vendor_supply_orders_status_check;

update public.vendor_supply_orders
set status = case
  when status in ('Ordered', 'Received', 'Accepted') then 'Accepted'
  when status in ('Canceled', 'Rejected') then 'Rejected'
  else 'Pending'
end;

alter table public.vendor_supply_orders
  alter column status set default 'Pending';

alter table public.vendor_supply_orders
  add constraint vendor_supply_orders_status_check
  check (status in ('Pending', 'Accepted', 'Rejected'));
