-- Optional explicit complete-by time for Technician Schedule blocks.
alter table public.work_orders
  add column if not exists scheduled_end_time time without time zone;
