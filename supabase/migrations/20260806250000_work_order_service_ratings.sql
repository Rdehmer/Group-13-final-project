-- Customer service ratings for completed work orders.

create table if not exists public.work_order_service_ratings (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  submitted_by uuid null references public.profiles (id) on delete set null,
  overall_rating smallint not null,
  technician_rating smallint null,
  timeliness_rating smallint null,
  quality_rating smallint null,
  comments text null,
  created_at timestamptz not null default now(),
  constraint work_order_service_ratings_work_order_id_key unique (work_order_id),
  constraint work_order_service_ratings_overall_rating_check check (overall_rating between 1 and 5),
  constraint work_order_service_ratings_technician_rating_check check (
    technician_rating is null or technician_rating between 1 and 5
  ),
  constraint work_order_service_ratings_timeliness_rating_check check (
    timeliness_rating is null or timeliness_rating between 1 and 5
  ),
  constraint work_order_service_ratings_quality_rating_check check (
    quality_rating is null or quality_rating between 1 and 5
  )
);

create index if not exists work_order_service_ratings_customer_id_idx
  on public.work_order_service_ratings (customer_id);

create index if not exists work_order_service_ratings_work_order_id_idx
  on public.work_order_service_ratings (work_order_id);

alter table public.work_order_service_ratings enable row level security;

create policy work_order_service_ratings_customer_select
  on public.work_order_service_ratings
  for select
  to authenticated
  using (
    app_user_role() = 'customer'::user_role
    and customer_id = my_customer_id()
    and my_customer_id() is not null
  );

create policy work_order_service_ratings_staff_select
  on public.work_order_service_ratings
  for select
  to authenticated
  using (
    app_user_role() in (
      'service_manager'::user_role,
      'administrator'::user_role,
      'billing'::user_role
    )
  );

create policy work_order_service_ratings_customer_insert
  on public.work_order_service_ratings
  for insert
  to authenticated
  with check (
    app_user_role() = 'customer'::user_role
    and customer_id = my_customer_id()
    and my_customer_id() is not null
    and submitted_by = auth.uid()
    and exists (
      select 1
      from public.work_orders wo
      where wo.id = work_order_id
        and wo.customer_id = my_customer_id()
        and wo.status in ('Completed', 'Closed')
    )
  );

grant select, insert on public.work_order_service_ratings to authenticated;
