-- Vendor inbox: threads and messages between vendors and EquipmentIQ staff.

create table if not exists public.vendor_inbox_threads (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  subject text not null,
  category text not null check (category in ('general', 'work', 'supply', 'billing')),
  vendor_work_item_id uuid null references public.vendor_work_items (id) on delete set null,
  vendor_supply_order_id uuid null references public.vendor_supply_orders (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  vendor_last_read_at timestamptz null,
  staff_last_read_at timestamptz null,
  last_sender_role text null check (last_sender_role is null or last_sender_role in ('vendor', 'staff'))
);

create index if not exists vendor_inbox_threads_vendor_id_idx
  on public.vendor_inbox_threads (vendor_id);

create index if not exists vendor_inbox_threads_last_message_at_idx
  on public.vendor_inbox_threads (last_message_at desc);

create table if not exists public.vendor_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.vendor_inbox_threads (id) on delete cascade,
  sender_role text not null check (sender_role in ('vendor', 'staff')),
  sender_profile_id uuid null references public.profiles (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists vendor_inbox_messages_thread_id_idx
  on public.vendor_inbox_messages (thread_id, created_at asc);

create or replace function public.touch_vendor_inbox_thread_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.vendor_inbox_threads
  set
    last_message_at = new.created_at,
    last_sender_role = new.sender_role
  where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists trg_vendor_inbox_messages_touch_thread on public.vendor_inbox_messages;

create trigger trg_vendor_inbox_messages_touch_thread
after insert on public.vendor_inbox_messages
for each row
execute function public.touch_vendor_inbox_thread_last_message();

alter table public.vendor_inbox_threads enable row level security;
alter table public.vendor_inbox_messages enable row level security;

-- Vendors: read own threads
create policy vendor_inbox_threads_vendor_select
  on public.vendor_inbox_threads
  for select
  to authenticated
  using (
    app_user_role() = 'vendor'::user_role
    and vendor_id = app_user_vendor_id()
    and app_user_vendor_id() is not null
  );

-- Vendors: start threads for their account
create policy vendor_inbox_threads_vendor_insert
  on public.vendor_inbox_threads
  for insert
  to authenticated
  with check (
    app_user_role() = 'vendor'::user_role
    and vendor_id = app_user_vendor_id()
    and app_user_vendor_id() is not null
  );

-- Vendors: mark own threads as read
create policy vendor_inbox_threads_vendor_update_read
  on public.vendor_inbox_threads
  for update
  to authenticated
  using (
    app_user_role() = 'vendor'::user_role
    and vendor_id = app_user_vendor_id()
    and app_user_vendor_id() is not null
  )
  with check (
    app_user_role() = 'vendor'::user_role
    and vendor_id = app_user_vendor_id()
    and app_user_vendor_id() is not null
  );

-- Staff: read all vendor threads
create policy vendor_inbox_threads_staff_select
  on public.vendor_inbox_threads
  for select
  to authenticated
  using (
    app_user_role() in (
      'service_manager'::user_role,
      'administrator'::user_role,
      'billing'::user_role
    )
  );

-- Staff: update vendor threads (mark read)
create policy vendor_inbox_threads_staff_update
  on public.vendor_inbox_threads
  for update
  to authenticated
  using (
    app_user_role() in (
      'service_manager'::user_role,
      'administrator'::user_role,
      'billing'::user_role
    )
  )
  with check (
    app_user_role() in (
      'service_manager'::user_role,
      'administrator'::user_role,
      'billing'::user_role
    )
  );

-- Vendors: read messages on own threads
create policy vendor_inbox_messages_vendor_select
  on public.vendor_inbox_messages
  for select
  to authenticated
  using (
    app_user_role() = 'vendor'::user_role
    and exists (
      select 1
      from public.vendor_inbox_threads t
      where t.id = vendor_inbox_messages.thread_id
        and t.vendor_id = app_user_vendor_id()
    )
  );

-- Vendors: reply on own threads
create policy vendor_inbox_messages_vendor_insert
  on public.vendor_inbox_messages
  for insert
  to authenticated
  with check (
    app_user_role() = 'vendor'::user_role
    and sender_role = 'vendor'
    and exists (
      select 1
      from public.vendor_inbox_threads t
      where t.id = vendor_inbox_messages.thread_id
        and t.vendor_id = app_user_vendor_id()
    )
  );

-- Staff: read all vendor messages
create policy vendor_inbox_messages_staff_select
  on public.vendor_inbox_messages
  for select
  to authenticated
  using (
    app_user_role() in (
      'service_manager'::user_role,
      'administrator'::user_role,
      'billing'::user_role
    )
  );

-- Staff: reply on any vendor thread
create policy vendor_inbox_messages_staff_insert
  on public.vendor_inbox_messages
  for insert
  to authenticated
  with check (
    app_user_role() in (
      'service_manager'::user_role,
      'administrator'::user_role,
      'billing'::user_role
    )
    and sender_role = 'staff'
    and exists (
      select 1
      from public.vendor_inbox_threads t
      where t.id = vendor_inbox_messages.thread_id
    )
  );

grant select, insert, update on public.vendor_inbox_threads to authenticated;
grant select, insert on public.vendor_inbox_messages to authenticated;

-- Demo seed: welcome thread for vendor1@equipmentiq-demo.test
insert into public.vendor_inbox_threads (vendor_id, subject, category, status, last_message_at)
select
  p.vendor_id,
  'Welcome to the EquipmentIQ vendor portal',
  'general',
  'open',
  now()
from public.profiles p
where p.email = 'vendor1@equipmentiq-demo.test'
  and p.vendor_id is not null
  and not exists (
    select 1
    from public.vendor_inbox_threads existing
    where existing.vendor_id = p.vendor_id
      and existing.subject = 'Welcome to the EquipmentIQ vendor portal'
  );

insert into public.vendor_inbox_messages (thread_id, sender_role, sender_profile_id, body)
select
  t.id,
  'staff',
  null,
  'Hi — welcome to the EquipmentIQ vendor portal inbox. Use this thread for questions about work assignments, supply orders, or billing. Our team will reply here.'
from public.vendor_inbox_threads t
join public.profiles p on p.vendor_id = t.vendor_id
where p.email = 'vendor1@equipmentiq-demo.test'
  and t.subject = 'Welcome to the EquipmentIQ vendor portal'
  and not exists (
    select 1
    from public.vendor_inbox_messages m
    where m.thread_id = t.id
  );
