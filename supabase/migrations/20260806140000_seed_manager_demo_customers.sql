-- Demo customers + Active industry-tier contracts for Manager/Admin CRM demos.
-- Tiers: 2 Silver, 1 Gold, 1 Bronze across four industry packs.
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING.

INSERT INTO public.customers (
  id, name, primary_contact_name, email, phone,
  billing_address, service_address, city, state, zip_code,
  status, payment_terms, notes
) VALUES
(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
  'Cedar Ridge Kitchen Co',
  'Maya Ortiz',
  'maya.ortiz@cedarridge-kitchen.demo',
  '503-555-0141',
  '410 Market St, Portland, OR 97201',
  '410 Market St, Portland, OR 97201',
  'Portland', 'OR', '97201',
  'Active', 'Net 30',
  'Demo customer — Foodservice Silver (manager/admin showcase).'
),
(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
  'Ironwood Assembly Works',
  'Derek Lang',
  'derek.lang@ironwood-assembly.demo',
  '208-555-0188',
  '900 Industrial Blvd, Boise, ID 83702',
  '900 Industrial Blvd, Boise, ID 83702',
  'Boise', 'ID', '83702',
  'Active', 'Net 30',
  'Demo customer — Manufacturing / Plant Silver (manager/admin showcase).'
),
(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03',
  'Lakeside Clinical Labs',
  'Dr. Priya Shah',
  'priya.shah@lakeside-labs.demo',
  '206-555-0162',
  '55 Harbor View Dr, Seattle, WA 98101',
  '55 Harbor View Dr, Seattle, WA 98101',
  'Seattle', 'WA', '98101',
  'Active', 'Net 30',
  'Demo customer — Healthcare / Labs Gold (manager/admin showcase).'
),
(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04',
  'Trailhead Mobile Services',
  'Chris Nguyen',
  'chris.nguyen@trailhead-mobile.demo',
  '406-555-0194',
  '220 Depot Rd, Missoula, MT 59801',
  '220 Depot Rd, Missoula, MT 59801',
  'Missoula', 'MT', '59801',
  'Active', 'Net 45',
  'Demo customer — Fleet / Mobile Bronze (manager/admin showcase).'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.service_contracts (
  id, customer_id, name, contract_type, start_date, end_date,
  renewal_option, billing_method, contract_price, payment_terms,
  included_service_visits, service_frequency, included_labor_hours,
  included_replacement_parts, emergency_response_commitment,
  warranty_terms, cancellation_terms, approval_requirements,
  status, notes, created_by
) VALUES
(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
  'Cedar Ridge Kitchen Co · Foodservice · Silver',
  'Preventive Maintenance',
  '2026-01-01', '2026-12-31',
  'Manual renewal', 'Monthly Recurring Charge', 4800, 'Net 30',
  4, 'Quarterly', 16, 700, '8 business hours',
  'Parts warranty 90 days', '30-day notice',
  'Manager approval for extras over $500',
  'Active',
  E'[Plan: Foodservice · Silver · Mid · asset $100,000]\n[Extras: travel_radius_miles=40; deductible=150; waiting_period_days=21]',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
),
(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
  'Ironwood Assembly Works · Manufacturing / Plant · Silver',
  'Preventive Maintenance',
  '2026-01-01', '2026-12-31',
  'Manual renewal', 'Monthly Recurring Charge', 7800, 'Net 30',
  4, 'Quarterly', 22, 1200, '8 business hours',
  'Parts warranty 90 days', '30-day notice',
  'Manager approval for extras over $750',
  'Active',
  E'[Plan: Manufacturing / Plant · Silver · Mid · asset $150,000]\n[Extras: travel_radius_miles=60; deductible=200; waiting_period_days=21]',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
),
(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb03',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03',
  'Lakeside Clinical Labs · Healthcare / Labs · Gold',
  'Full-Service Maintenance',
  '2026-01-01', '2026-12-31',
  'Auto-renew', 'Monthly Recurring Charge', 16500, 'Net 30',
  12, 'Monthly', 56, 3200, '4 business hours',
  'Priority calibrated parts support', '90-day notice',
  'Manager approval for extras beyond allowance',
  'Active',
  E'[Plan: Healthcare / Labs · Gold · Mid · asset $200,000]\n[Extras: travel_radius_miles=50; deductible=0; waiting_period_days=7]',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
),
(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb04',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04',
  'Trailhead Mobile Services · Fleet / Mobile · Bronze',
  'Preventive Maintenance',
  '2026-01-01', '2026-12-31',
  'Manual renewal', 'Per-Service Charge', 2000, 'Net 45',
  2, 'Semi-Annual', 6, 0, 'Next business day',
  'Labor not warranty', '30-day notice',
  'Customer approval required before non-PM dispatch',
  'Active',
  E'[Plan: Fleet / Mobile · Bronze · Mid · asset $75,000]\n[Extras: travel_radius_miles=75; deductible=300; waiting_period_days=30]',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
)
ON CONFLICT (id) DO NOTHING;
