alter table public.work_orders
  drop constraint if exists work_orders_dispatch_status_check;

alter table public.work_orders
  add constraint work_orders_dispatch_status_check
  check (dispatch_status in (
    'Not Started',
    'En Route',
    'Arrived',
    'Working',
    'Paused',
    'Parts Ordered',
    'Coming in Late',
    'Not Available',
    'Ready for Review',
    'Done'
  )),
  add column dispatch_updated_at timestamptz;
