-- Schedule queue visit kind: routine check, one-time repair, or emergency.
alter table public.work_orders
  add column if not exists visit_kind text
  check (
    visit_kind is null
    or visit_kind in ('routine_check', 'one_time_repair', 'emergency')
  );

comment on column public.work_orders.visit_kind is
  'Manager schedule queue label: routine_check | one_time_repair | emergency';

update public.work_orders
set visit_kind = 'routine_check'
where visit_kind is null
  and work_order_type = 'Preventive Maintenance';

update public.work_orders
set visit_kind = 'emergency'
where visit_kind is null
  and (
    work_order_type = 'Emergency Repair'
    or priority = 'Critical'
  );

update public.work_orders
set visit_kind = 'one_time_repair'
where visit_kind is null;
