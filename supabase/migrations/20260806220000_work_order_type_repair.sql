-- Customer portal submits one-off repairs as work_order_type = 'Repair'.
-- Extend the CHECK constraint to allow that value.

alter table public.work_orders
  drop constraint if exists work_orders_work_order_type_check;

alter table public.work_orders
  add constraint work_orders_work_order_type_check
  check (
    work_order_type = any (
      array[
        'Preventive Maintenance'::text,
        'Emergency Repair'::text,
        'Repair'::text,
        'Inspection'::text,
        'Warranty Repair'::text,
        'Installation'::text,
        'Follow-Up Service'::text
      ]
    )
  );
