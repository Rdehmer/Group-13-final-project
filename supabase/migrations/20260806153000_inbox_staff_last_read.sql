-- Manager unread: staff_last_read_at on customer inbox threads.

alter table public.customer_inbox_threads
  add column if not exists staff_last_read_at timestamptz null;

drop policy if exists customer_inbox_threads_staff_update on public.customer_inbox_threads;

create policy customer_inbox_threads_staff_update
  on public.customer_inbox_threads
  for update
  to authenticated
  using (
    app_user_role() in ('service_manager'::user_role, 'administrator'::user_role)
  )
  with check (
    app_user_role() in ('service_manager'::user_role, 'administrator'::user_role)
  );
