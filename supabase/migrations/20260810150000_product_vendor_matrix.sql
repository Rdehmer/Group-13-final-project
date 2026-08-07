-- Product (AP) vendor matrix metrics + ratings, parallel to service vendors.

alter table public.vendors
  add column if not exists avg_response_hours numeric(8,2) null
    check (avg_response_hours is null or avg_response_hours >= 0),
  add column if not exists avg_order_cost numeric(12,2) null
    check (avg_order_cost is null or avg_order_cost >= 0);

comment on column public.vendors.avg_response_hours is
  'Average lead / response hours for product suppliers (matrix KPI).';
comment on column public.vendors.avg_order_cost is
  'Average order/bill cost fallback when bill history is thin (matrix KPI).';

create table if not exists public.vendor_ratings (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  rating integer not null check (rating >= 1 and rating <= 5),
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists vendor_ratings_vendor_idx
  on public.vendor_ratings (vendor_id);

alter table public.vendor_ratings enable row level security;

drop policy if exists vendor_ratings_staff on public.vendor_ratings;
create policy vendor_ratings_staff on public.vendor_ratings
  for all to authenticated
  using (app_user_role() = any (array['administrator'::user_role, 'service_manager'::user_role, 'billing'::user_role]))
  with check (app_user_role() = any (array['administrator'::user_role, 'service_manager'::user_role, 'billing'::user_role]));

-- Seed a few product suppliers so the product matrix is useful in demo
insert into public.vendors (
  id, name, contact_name, email, phone, city, state, payment_terms,
  notes, is_active, approval_status, is_preferred, preferred_rank,
  avg_response_hours, avg_order_cost
) values
(
  'b2000001-0001-4000-8000-000000000001',
  'Texas Industrial Supply',
  'Alex Rivera',
  'orders@txindustrial.example',
  '512-555-0301',
  'Austin', 'TX', 'Net 30',
  'Reliable OEM parts; strong fill rate.',
  true, 'Approved', true, 2,
  18.0, 720
),
(
  'b2000001-0001-4000-8000-000000000002',
  'Gulf Coast Fasteners',
  'Jamie Brooks',
  'sales@gulffasteners.example',
  '512-555-0302',
  'Houston', 'TX', 'Net 15',
  'Fast shipping; mid pricing.',
  true, 'Approved', false, null,
  10.0, 540
),
(
  'b2000001-0001-4000-8000-000000000003',
  'Bargain Bin Components',
  'Casey Wu',
  'desk@bargainbin.example',
  '512-555-0303',
  'San Antonio', 'TX', 'Due on Receipt',
  'Cheap but slow and inconsistent quality — prune candidate.',
  true, 'Approved', false, null,
  72.0, 310
)
on conflict (id) do update set
  name = excluded.name,
  contact_name = excluded.contact_name,
  email = excluded.email,
  phone = excluded.phone,
  city = excluded.city,
  state = excluded.state,
  payment_terms = excluded.payment_terms,
  notes = excluded.notes,
  is_active = excluded.is_active,
  approval_status = excluded.approval_status,
  is_preferred = excluded.is_preferred,
  preferred_rank = excluded.preferred_rank,
  avg_response_hours = excluded.avg_response_hours,
  avg_order_cost = excluded.avg_order_cost,
  updated_at = now();

-- Ensure Midwest has matrix KPIs
update public.vendors
set
  avg_response_hours = coalesce(avg_response_hours, 24),
  avg_order_cost = coalesce(avg_order_cost, 880),
  is_preferred = true,
  preferred_rank = coalesce(preferred_rank, 1),
  updated_at = now()
where name = 'Midwest Parts Supply';

insert into public.vendor_ratings (vendor_id, rating, notes)
select r.vendor_id, r.rating, r.notes
from (values
  ('f58caf13-752b-481b-a75d-255985b12458'::uuid, 5, 'Accurate packing'),
  ('f58caf13-752b-481b-a75d-255985b12458'::uuid, 4, 'Good lead times'),
  ('b2000001-0001-4000-8000-000000000001'::uuid, 5, 'OEM match perfect'),
  ('b2000001-0001-4000-8000-000000000001'::uuid, 4, 'Solid support'),
  ('b2000001-0001-4000-8000-000000000002'::uuid, 4, 'Shipped same week'),
  ('b2000001-0001-4000-8000-000000000002'::uuid, 3, 'One backorder'),
  ('b2000001-0001-4000-8000-000000000003'::uuid, 2, 'Wrong parts once'),
  ('b2000001-0001-4000-8000-000000000003'::uuid, 1, 'Very late delivery'),
  ('b2000001-0001-4000-8000-000000000003'::uuid, 2, 'Poor communication')
) as r(vendor_id, rating, notes)
where exists (select 1 from public.vendors v where v.id = r.vendor_id)
  and not exists (
    select 1 from public.vendor_ratings existing
    where existing.vendor_id = r.vendor_id
      and existing.notes is not distinct from r.notes
  );

insert into public.vendor_bills (
  vendor_id, bill_number, bill_date, due_date, amount, amount_paid, status, memo
)
select b.vendor_id, b.bill_number, (current_date - (b.days_ago || ' days')::interval)::date,
       (current_date + 30)::date, b.amount, 0, 'Open', b.memo
from (values
  ('f58caf13-752b-481b-a75d-255985b12458'::uuid, 'AP-MW-9001', 30, 860::numeric, 'Filter kit'),
  ('f58caf13-752b-481b-a75d-255985b12458'::uuid, 'AP-MW-9002', 12, 900::numeric, 'Compressor parts'),
  ('b2000001-0001-4000-8000-000000000001'::uuid, 'AP-TI-9101', 28, 700::numeric, 'OEM motors'),
  ('b2000001-0001-4000-8000-000000000001'::uuid, 'AP-TI-9102', 9, 740::numeric, 'Control boards'),
  ('b2000001-0001-4000-8000-000000000002'::uuid, 'AP-GC-9201', 22, 520::numeric, 'Fastener pack'),
  ('b2000001-0001-4000-8000-000000000002'::uuid, 'AP-GC-9202', 7, 560::numeric, 'Hardware assortment'),
  ('b2000001-0001-4000-8000-000000000003'::uuid, 'AP-BB-9301', 40, 290::numeric, 'Misc components'),
  ('b2000001-0001-4000-8000-000000000003'::uuid, 'AP-BB-9302', 14, 330::numeric, 'Budget fittings')
) as b(vendor_id, bill_number, days_ago, amount, memo)
where exists (select 1 from public.vendors v where v.id = b.vendor_id)
  and not exists (
    select 1 from public.vendor_bills existing where existing.bill_number = b.bill_number
  );
