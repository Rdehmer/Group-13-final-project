-- Vendor preference matrix: score weights (admin), preferred flags, demo third-party techs.

-- ── Admin-customizable matrix settings ──────────────────────────────────────
alter table public.company_settings
  add column if not exists vendor_matrix_weight_cost numeric(5,2) not null default 30
    check (vendor_matrix_weight_cost >= 0 and vendor_matrix_weight_cost <= 100),
  add column if not exists vendor_matrix_weight_speed numeric(5,2) not null default 30
    check (vendor_matrix_weight_speed >= 0 and vendor_matrix_weight_speed <= 100),
  add column if not exists vendor_matrix_weight_rating numeric(5,2) not null default 40
    check (vendor_matrix_weight_rating >= 0 and vendor_matrix_weight_rating <= 100),
  add column if not exists vendor_matrix_min_star_rating numeric(3,1) not null default 3.0
    check (vendor_matrix_min_star_rating >= 0 and vendor_matrix_min_star_rating <= 5),
  add column if not exists vendor_matrix_max_avg_repair_cost numeric(12,2) null
    check (vendor_matrix_max_avg_repair_cost is null or vendor_matrix_max_avg_repair_cost > 0),
  add column if not exists vendor_matrix_max_response_hours numeric(8,2) null
    check (vendor_matrix_max_response_hours is null or vendor_matrix_max_response_hours > 0),
  add column if not exists vendor_matrix_hide_pruned boolean not null default false;

comment on column public.company_settings.vendor_matrix_weight_cost is
  'Relative weight for average repair cost (lower cost scores higher).';
comment on column public.company_settings.vendor_matrix_weight_speed is
  'Relative weight for response speed (faster scores higher).';
comment on column public.company_settings.vendor_matrix_weight_rating is
  'Relative weight for customer/staff star ratings.';
comment on column public.company_settings.vendor_matrix_min_star_rating is
  'Vendors below this average star rating are flagged to prune.';
comment on column public.company_settings.vendor_matrix_max_avg_repair_cost is
  'Optional: vendors above this avg repair cost are flagged to prune.';
comment on column public.company_settings.vendor_matrix_max_response_hours is
  'Optional: vendors slower than this avg response are flagged to prune.';

-- Default prune cost/speed for existing companies (demo-friendly)
update public.company_settings
set
  vendor_matrix_max_avg_repair_cost = coalesce(vendor_matrix_max_avg_repair_cost, 2500),
  vendor_matrix_max_response_hours = coalesce(vendor_matrix_max_response_hours, 48)
where vendor_matrix_max_avg_repair_cost is null
   or vendor_matrix_max_response_hours is null;

-- ── Service vendors (third-party technicians / materials providers) ─────
alter table public.service_vendors
  add column if not exists vendor_category text not null default 'technician'
    check (vendor_category in ('technician', 'materials', 'both')),
  add column if not exists is_preferred boolean not null default false,
  add column if not exists preferred_rank integer null
    check (preferred_rank is null or preferred_rank >= 1),
  add column if not exists avg_response_hours numeric(8,2) null
    check (avg_response_hours is null or avg_response_hours >= 0),
  add column if not exists avg_repair_cost numeric(12,2) null
    check (avg_repair_cost is null or avg_repair_cost >= 0);

comment on column public.service_vendors.vendor_category is
  'technician = field subcontractors; materials = supply-side; both = hybrid.';
comment on column public.service_vendors.is_preferred is
  'Admin/manager preferred shortlist for assignment.';
comment on column public.service_vendors.avg_response_hours is
  'Average hours to respond / arrive (manual or rolled up).';
comment on column public.service_vendors.avg_repair_cost is
  'Average repair/job cost (manual or rolled up from bills).';

create index if not exists service_vendors_preferred_idx
  on public.service_vendors (is_preferred, preferred_rank)
  where is_preferred = true;

-- ── AP suppliers: preferred materials vendors ───────────────────────────
alter table public.vendors
  add column if not exists is_preferred boolean not null default false,
  add column if not exists preferred_rank integer null
    check (preferred_rank is null or preferred_rank >= 1);

create index if not exists vendors_preferred_idx
  on public.vendors (is_preferred, preferred_rank)
  where is_preferred = true;

-- Mark Midwest as preferred materials supplier when present
update public.vendors
set is_preferred = true,
    preferred_rank = coalesce(preferred_rank, 1)
where name = 'Midwest Parts Supply';

-- ── Seed demo third-party technicians for matrix ranking ────────────────
insert into public.service_vendors (
  id, name, primary_trade, trades, contact_name, email, phone,
  city, state, service_area, notes, is_active, approval_status,
  vendor_category, is_preferred, preferred_rank,
  avg_response_hours, avg_repair_cost
) values
(
  'a1000001-0001-4000-8000-000000000001',
  'Lone Star HVAC Pros',
  'HVAC',
  array['HVAC','Refrigeration'],
  'Maya Torres',
  'dispatch@lonestarhvac.example',
  '512-555-0201',
  'Austin', 'TX', 'Austin metro',
  'Fast response, strong cold-storage experience.',
  true, 'Approved', 'technician', true, 1,
  4.5, 980
),
(
  'a1000001-0001-4000-8000-000000000002',
  'Hill Country Electric Co',
  'Electrical',
  array['Electrical'],
  'Jordan Lee',
  'jobs@hillcountryelec.example',
  '512-555-0202',
  'Round Rock', 'TX', 'Central Texas',
  'Solid quality; mid-range cost.',
  true, 'Approved', 'technician', true, 2,
  8.0, 1250
),
(
  'a1000001-0001-4000-8000-000000000003',
  'Rapid Response Mechanical',
  'HVAC',
  array['HVAC','Plumbing'],
  'Chris Nguyen',
  'ops@rapidmech.example',
  '512-555-0203',
  'Austin', 'TX', 'Austin / San Antonio',
  'Very fast but higher average job cost.',
  true, 'Approved', 'technician', false, null,
  2.5, 2100
),
(
  'a1000001-0001-4000-8000-000000000004',
  'Budget Fix Field Services',
  'General',
  array['General','HVAC'],
  'Sam Ortiz',
  'desk@budgetfix.example',
  '512-555-0204',
  'Bastrop', 'TX', 'East Austin',
  'Low cost but slow and poor ratings — prune candidate.',
  true, 'Approved', 'technician', false, null,
  36.0, 620
),
(
  'a1000001-0001-4000-8000-000000000005',
  'Capitol Parts & Materials',
  'Other',
  array['Other'],
  'Riley Chen',
  'orders@capitolparts.example',
  '512-555-0205',
  'Austin', 'TX', 'Statewide ship',
  'Preferred materials partner for specialty parts.',
  true, 'Approved', 'materials', true, 1,
  12.0, 450
)
on conflict (id) do update set
  name = excluded.name,
  primary_trade = excluded.primary_trade,
  trades = excluded.trades,
  contact_name = excluded.contact_name,
  email = excluded.email,
  phone = excluded.phone,
  city = excluded.city,
  state = excluded.state,
  service_area = excluded.service_area,
  notes = excluded.notes,
  is_active = excluded.is_active,
  approval_status = excluded.approval_status,
  vendor_category = excluded.vendor_category,
  is_preferred = excluded.is_preferred,
  preferred_rank = excluded.preferred_rank,
  avg_response_hours = excluded.avg_response_hours,
  avg_repair_cost = excluded.avg_repair_cost,
  updated_at = now();

-- Star ratings (staff/customer proxies)
insert into public.service_vendor_ratings (service_vendor_id, rating, notes)
select v.id, r.rating, r.notes
from (values
  ('a1000001-0001-4000-8000-000000000001'::uuid, 5, 'Excellent compressor swap'),
  ('a1000001-0001-4000-8000-000000000001'::uuid, 5, 'On-time arrival'),
  ('a1000001-0001-4000-8000-000000000001'::uuid, 4, 'Clean work'),
  ('a1000001-0001-4000-8000-000000000002'::uuid, 4, 'Good panel upgrade'),
  ('a1000001-0001-4000-8000-000000000002'::uuid, 4, 'Professional crew'),
  ('a1000001-0001-4000-8000-000000000003'::uuid, 4, 'Fast but pricey'),
  ('a1000001-0001-4000-8000-000000000003'::uuid, 3, 'Rush fee surprise'),
  ('a1000001-0001-4000-8000-000000000004'::uuid, 2, 'Late to site'),
  ('a1000001-0001-4000-8000-000000000004'::uuid, 1, 'Had to rework'),
  ('a1000001-0001-4000-8000-000000000004'::uuid, 2, 'Poor communication'),
  ('a1000001-0001-4000-8000-000000000005'::uuid, 5, 'Parts arrived next day'),
  ('a1000001-0001-4000-8000-000000000005'::uuid, 4, 'Accurate packing slips')
) as r(id, rating, notes)
join public.service_vendors v on v.id = r.id
where not exists (
  select 1 from public.service_vendor_ratings existing
  where existing.service_vendor_id = r.id
    and existing.notes is not distinct from r.notes
);

-- Sample bills to back avg repair cost rollups
insert into public.service_vendor_bills (
  service_vendor_id, bill_number, bill_date, due_date, amount, amount_paid, status, memo
)
select v.id, b.bill_number, current_date - (b.days_ago || ' days')::interval,
       current_date + 30, b.amount, 0, 'Open', b.memo
from (values
  ('a1000001-0001-4000-8000-000000000001'::uuid, 'SV-LS-1001', 40, 950::numeric, 'Evaporator repair'),
  ('a1000001-0001-4000-8000-000000000001'::uuid, 'SV-LS-1002', 20, 1010::numeric, 'Condenser service'),
  ('a1000001-0001-4000-8000-000000000002'::uuid, 'SV-HC-2001', 35, 1200::numeric, 'Panel replacement'),
  ('a1000001-0001-4000-8000-000000000002'::uuid, 'SV-HC-2002', 12, 1300::numeric, 'Motor circuit'),
  ('a1000001-0001-4000-8000-000000000003'::uuid, 'SV-RR-3001', 25, 2050::numeric, 'Emergency callout'),
  ('a1000001-0001-4000-8000-000000000003'::uuid, 'SV-RR-3002', 8, 2150::numeric, 'After-hours HVAC'),
  ('a1000001-0001-4000-8000-000000000004'::uuid, 'SV-BF-4001', 50, 580::numeric, 'General repair'),
  ('a1000001-0001-4000-8000-000000000004'::uuid, 'SV-BF-4002', 15, 660::numeric, 'Follow-up visit'),
  ('a1000001-0001-4000-8000-000000000005'::uuid, 'SV-CP-5001', 18, 430::numeric, 'Specialty parts kit'),
  ('a1000001-0001-4000-8000-000000000005'::uuid, 'SV-CP-5002', 5, 470::numeric, 'Filter pack')
) as b(id, bill_number, days_ago, amount, memo)
join public.service_vendors v on v.id = b.id
where not exists (
  select 1 from public.service_vendor_bills existing
  where existing.bill_number = b.bill_number
);
