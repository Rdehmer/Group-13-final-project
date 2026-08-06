-- Customer inbox: threads and messages between customers and Ridley staff.

create table if not exists public.customer_inbox_threads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  subject text not null,
  category text not null check (category in ('general', 'service', 'billing', 'contract')),
  work_order_id uuid null references public.work_orders (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists customer_inbox_threads_customer_id_idx
  on public.customer_inbox_threads (customer_id);

create index if not exists customer_inbox_threads_last_message_at_idx
  on public.customer_inbox_threads (last_message_at desc);

create table if not exists public.customer_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.customer_inbox_threads (id) on delete cascade,
  sender_role text not null check (sender_role in ('customer', 'staff')),
  sender_profile_id uuid null references public.profiles (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists customer_inbox_messages_thread_id_idx
  on public.customer_inbox_messages (thread_id, created_at asc);

create or replace function public.touch_inbox_thread_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.customer_inbox_threads
  set last_message_at = new.created_at
  where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists trg_customer_inbox_messages_touch_thread on public.customer_inbox_messages;

create trigger trg_customer_inbox_messages_touch_thread
after insert on public.customer_inbox_messages
for each row
execute function public.touch_inbox_thread_last_message();

alter table public.customer_inbox_threads enable row level security;
alter table public.customer_inbox_messages enable row level security;

-- Customers: read own threads
create policy customer_inbox_threads_customer_select
  on public.customer_inbox_threads
  for select
  to authenticated
  using (
    app_user_role() = 'customer'::user_role
    and customer_id = my_customer_id()
    and my_customer_id() is not null
  );

-- Customers: start threads for their account
create policy customer_inbox_threads_customer_insert
  on public.customer_inbox_threads
  for insert
  to authenticated
  with check (
    app_user_role() = 'customer'::user_role
    and customer_id = my_customer_id()
    and my_customer_id() is not null
  );

-- Staff: read all threads (manager inbox later)
create policy customer_inbox_threads_staff_select
  on public.customer_inbox_threads
  for select
  to authenticated
  using (
    app_user_role() in ('service_manager'::user_role, 'administrator'::user_role)
  );

-- Customers: read messages on own threads
create policy customer_inbox_messages_customer_select
  on public.customer_inbox_messages
  for select
  to authenticated
  using (
    app_user_role() = 'customer'::user_role
    and exists (
      select 1
      from public.customer_inbox_threads t
      where t.id = customer_inbox_messages.thread_id
        and t.customer_id = my_customer_id()
    )
  );

-- Customers: reply on own threads
create policy customer_inbox_messages_customer_insert
  on public.customer_inbox_messages
  for insert
  to authenticated
  with check (
    app_user_role() = 'customer'::user_role
    and sender_role = 'customer'
    and exists (
      select 1
      from public.customer_inbox_threads t
      where t.id = customer_inbox_messages.thread_id
        and t.customer_id = my_customer_id()
    )
  );

-- Staff: read all messages
create policy customer_inbox_messages_staff_select
  on public.customer_inbox_messages
  for select
  to authenticated
  using (
    app_user_role() in ('service_manager'::user_role, 'administrator'::user_role)
  );

-- Staff: reply on any thread
create policy customer_inbox_messages_staff_insert
  on public.customer_inbox_messages
  for insert
  to authenticated
  with check (
    app_user_role() in ('service_manager'::user_role, 'administrator'::user_role)
    and sender_role = 'staff'
    and exists (
      select 1
      from public.customer_inbox_threads t
      where t.id = customer_inbox_messages.thread_id
    )
  );

-- Demo seed: one service thread for Northwind demo customer (customer1@ridley-demo.test)
insert into public.customer_inbox_threads (customer_id, subject, category, work_order_id, status, last_message_at)
select
  p.customer_id,
  'Update on WO-77715073',
  'service',
  wo.id,
  'open',
  now()
from public.profiles p
left join public.work_orders wo
  on wo.customer_id = p.customer_id
  and wo.work_order_number = 'WO-77715073'
where p.email = 'customer1@ridley-demo.test'
  and p.customer_id is not null
  and not exists (
    select 1
    from public.customer_inbox_threads existing
    where existing.customer_id = p.customer_id
      and existing.subject = 'Update on WO-77715073'
  );

insert into public.customer_inbox_messages (thread_id, sender_role, sender_profile_id, body)
select
  t.id,
  'staff',
  null,
  'Hi Chris — we received your emergency repair request for the forklift (WO-77715073). A coordinator is reviewing scheduling and will confirm your visit window here. Reply if you have dock access notes or preferred contact times.'
from public.customer_inbox_threads t
join public.profiles p on p.customer_id = t.customer_id
where p.email = 'customer1@ridley-demo.test'
  and t.subject = 'Update on WO-77715073'
  and not exists (
    select 1
    from public.customer_inbox_messages m
    where m.thread_id = t.id
  );
