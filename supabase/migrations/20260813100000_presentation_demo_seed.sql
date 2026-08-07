-- Presentation demo seed — canonical EquipmentIQ taxonomy only.
-- 8 Active regular contracts + 2× each edge case (loss jobs, AWR, warranty split,
-- deferred revenue, AR statuses, Expired/Canceled contracts).
-- Idempotent: scoped cleanup of PRES-* / presentation UUIDs, then upsert.

-- ---------------------------------------------------------------------------
-- 0) Scoped cleanup (presentation rows only)
-- ---------------------------------------------------------------------------
DELETE FROM public.payments WHERE invoice_id IN (
  SELECT id FROM public.invoices WHERE invoice_number LIKE 'PRES-%'
);
DELETE FROM public.invoice_line_items WHERE invoice_id IN (
  SELECT id FROM public.invoices WHERE invoice_number LIKE 'PRES-%'
);
DELETE FROM public.invoices WHERE invoice_number LIKE 'PRES-%';

DELETE FROM public.additional_work_requests WHERE work_order_id IN (
  SELECT id FROM public.work_orders WHERE work_order_number LIKE 'PRES-%'
);
DELETE FROM public.work_order_parts WHERE work_order_id IN (
  SELECT id FROM public.work_orders WHERE work_order_number LIKE 'PRES-%'
);
DELETE FROM public.technician_labor WHERE work_order_id IN (
  SELECT id FROM public.work_orders WHERE work_order_number LIKE 'PRES-%'
);
DELETE FROM public.work_orders WHERE work_order_number LIKE 'PRES-%';

DELETE FROM public.contract_equipment WHERE contract_id IN (
  'dddddddd-dddd-dddd-dddd-dddddddddd06',
  'dddddddd-dddd-dddd-dddd-dddddddddd07',
  'dddddddd-dddd-dddd-dddd-dddddddddd08',
  'dddddddd-dddd-dddd-dddd-dddddddddde1',
  'dddddddd-dddd-dddd-dddd-dddddddddde2',
  'dddddddd-dddd-dddd-dddd-dddddddddda1',
  'dddddddd-dddd-dddd-dddd-dddddddddda2',
  'dddddddd-dddd-dddd-dddd-ddddddddddc1',
  'dddddddd-dddd-dddd-dddd-ddddddddddc2'
);
DELETE FROM public.service_contracts WHERE id IN (
  'dddddddd-dddd-dddd-dddd-dddddddddd06',
  'dddddddd-dddd-dddd-dddd-dddddddddd07',
  'dddddddd-dddd-dddd-dddd-dddddddddd08',
  'dddddddd-dddd-dddd-dddd-dddddddddde1',
  'dddddddd-dddd-dddd-dddd-dddddddddde2',
  'dddddddd-dddd-dddd-dddd-dddddddddda1',
  'dddddddd-dddd-dddd-dddd-dddddddddda2',
  'dddddddd-dddd-dddd-dddd-ddddddddddc1',
  'dddddddd-dddd-dddd-dddd-ddddddddddc2'
);
DELETE FROM public.equipment WHERE id::text LIKE 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee%';
DELETE FROM public.customers WHERE id::text LIKE 'cccccccc-cccc-cccc-cccc-cccccccccc%';

-- ---------------------------------------------------------------------------
-- 1) Demo parts (COGS vs revenue math)
-- ---------------------------------------------------------------------------
INSERT INTO public.parts (
  id, part_number, name, category, description,
  quantity_on_hand, reorder_level, unit_cost, standard_customer_price,
  warranty_eligible, supplier, is_active
) VALUES
(
  'ffffffff-ffff-ffff-ffff-fffffffff001', 'FR-083', 'Filter Drier', 'Refrigeration',
  'Liquid line filter drier — demo COGS part', 40, 10, 185.00, 320.00, true, 'HVAC Supply Co', true
),
(
  'ffffffff-ffff-ffff-ffff-fffffffff002', 'TXV-220', 'TXV Valve', 'Refrigeration',
  'Thermal expansion valve', 25, 5, 420.00, 650.00, true, 'HVAC Supply Co', true
),
(
  'ffffffff-ffff-ffff-ffff-fffffffff003', 'DG-48', 'Door Gasket', 'Refrigeration',
  'Walk-in door gasket kit', 60, 15, 95.00, 180.00, false, 'ColdParts Inc', true
),
(
  'ffffffff-ffff-ffff-ffff-fffffffff004', 'CNT-40', 'Contactor', 'Electrical',
  '3-pole contactor 40A', 30, 8, 140.00, 265.00, true, 'HVAC Supply Co', true
)
ON CONFLICT (id) DO UPDATE SET
  unit_cost = EXCLUDED.unit_cost,
  standard_customer_price = EXCLUDED.standard_customer_price,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2) Manager demo + Northwind scaffold (upsert)
-- ---------------------------------------------------------------------------
INSERT INTO public.customers (
  id, name, primary_contact_name, email, phone,
  billing_address, service_address, city, state, zip_code,
  status, payment_terms, notes, company_id
) VALUES
(
  '11111111-1111-1111-1111-111111111101', 'Northwind Cold Storage', 'Pat North',
  'customer1@equipmentiq-demo.test', '512-555-0101',
  '100 Cold Storage Way, Austin, TX 78701', '100 Cold Storage Way, Austin, TX 78701',
  'Austin', 'TX', '78701', 'Active', 'Net 30',
  'Contract customer for C2C walkthrough (customer1).',
  '00000000-0000-4000-8000-000000000001'
),
(
  '22222222-2222-2222-2222-222222222201', 'Summit Cold Express', 'Pat Prospect',
  'customer2@equipmentiq-demo.test', '512-555-0142',
  '220 Express Lane, Austin, TX 78702', '220 Express Lane, Austin, TX 78702',
  'Austin', 'TX', '78702', 'Active', 'Due on receipt',
  'Hot (non-contract) demo customer — break/fix prospect (customer2).',
  '00000000-0000-4000-8000-000000000001'
),
(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'Cedar Ridge Kitchen Co', 'Maya Ortiz',
  'maya.ortiz@cedarridge-kitchen.demo', '503-555-0141',
  '410 Market St, Portland, OR 97201', '410 Market St, Portland, OR 97201',
  'Portland', 'OR', '97201', 'Active', 'Net 30',
  'Demo customer — Foodservice Silver (manager/admin showcase).',
  '00000000-0000-4000-8000-000000000001'
),
(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'Ironwood Assembly Works', 'Derek Lang',
  'derek.lang@ironwood-assembly.demo', '208-555-0188',
  '900 Industrial Blvd, Boise, ID 83702', '900 Industrial Blvd, Boise, ID 83702',
  'Boise', 'ID', '83702', 'Active', 'Net 30',
  'Demo customer — Manufacturing / Plant Silver (manager/admin showcase).',
  '00000000-0000-4000-8000-000000000001'
),
(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'Lakeside Clinical Labs', 'Dr. Priya Shah',
  'priya.shah@lakeside-labs.demo', '206-555-0162',
  '55 Harbor View Dr, Seattle, WA 98101', '55 Harbor View Dr, Seattle, WA 98101',
  'Seattle', 'WA', '98101', 'Active', 'Net 30',
  'Demo customer — Healthcare / Labs Gold (manager/admin showcase).',
  '00000000-0000-4000-8000-000000000001'
),
(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04', 'Trailhead Mobile Services', 'Chris Nguyen',
  'chris.nguyen@trailhead-mobile.demo', '406-555-0194',
  '220 Depot Rd, Missoula, MT 59801', '220 Depot Rd, Missoula, MT 59801',
  'Missoula', 'MT', '59801', 'Active', 'Net 30',
  'Demo customer — Fleet / Mobile Bronze (manager/admin showcase).',
  '00000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, status = EXCLUDED.status, updated_at = now();

-- Presentation-only customers
INSERT INTO public.customers (
  id, name, primary_contact_name, email, phone,
  billing_address, service_address, city, state, zip_code,
  status, payment_terms, notes, company_id
) VALUES
(
  'cccccccc-cccc-cccc-cccc-cccccccccc06', 'Harbor Foods Co-op', 'Elena Ruiz',
  'elena.ruiz@harborfoods.demo', '503-555-0206',
  '88 Harbor Rd, Portland, OR 97209', '88 Harbor Rd, Portland, OR 97209',
  'Portland', 'OR', '97209', 'Active', 'Net 30',
  'Presentation — Full-Service regular contract.',
  '00000000-0000-4000-8000-000000000001'
),
(
  'cccccccc-cccc-cccc-cccc-cccccccccc07', 'Alpine Cold Storage', 'Marcus Lee',
  'marcus.lee@alpinecold.demo', '208-555-0207',
  '1200 Alpine Way, Boise, ID 83703', '1200 Alpine Way, Boise, ID 83703',
  'Boise', 'ID', '83703', 'Active', 'Net 30',
  'Presentation — Emergency Repair Plan regular contract.',
  '00000000-0000-4000-8000-000000000001'
),
(
  'cccccccc-cccc-cccc-cccc-cccccccccc08', 'Beacon Restaurant Group', 'Sofia Kim',
  'sofia.kim@beaconrest.demo', '206-555-0208',
  '500 Beacon Ave, Seattle, WA 98104', '500 Beacon Ave, Seattle, WA 98104',
  'Seattle', 'WA', '98104', 'Active', 'Net 15',
  'Presentation — Preventive Maintenance regular contract.',
  '00000000-0000-4000-8000-000000000001'
),
(
  'cccccccc-cccc-cccc-cccc-cccccccccc09', 'Ridgeview Prepaid Cold', 'Tom Ridge',
  'tom.ridge@ridgeview.demo', '512-555-0209',
  '400 Ridgeview Dr, Austin, TX 78703', '400 Ridgeview Dr, Austin, TX 78703',
  'Austin', 'TX', '78703', 'Active', 'Net 30',
  'Presentation — ASC 606 deferred revenue contract A.',
  '00000000-0000-4000-8000-000000000001'
),
(
  'cccccccc-cccc-cccc-cccc-cccccccccc10', 'Valley Prepaid Kitchen', 'Nina Valley',
  'nina.valley@valleyprep.demo', '512-555-0210',
  '900 Valley Ln, Austin, TX 78704', '900 Valley Ln, Austin, TX 78704',
  'Austin', 'TX', '78704', 'Active', 'Net 30',
  'Presentation — ASC 606 deferred revenue contract B.',
  '00000000-0000-4000-8000-000000000001'
),
(
  'cccccccc-cccc-cccc-cccc-cccccccccc11', 'Old Harbor Cold Storage', 'Frank Olden',
  'frank.olden@oldharbor.demo', '503-555-0211',
  '12 Pier St, Portland, OR 97210', '12 Pier St, Portland, OR 97210',
  'Portland', 'OR', '97210', 'Active', 'Net 30',
  'Presentation — expired contract customer.',
  '00000000-0000-4000-8000-000000000001'
),
(
  'cccccccc-cccc-cccc-cccc-cccccccccc12', 'Legacy Fleet Refrigeration', 'Gina Legacy',
  'gina.legacy@legacyfleet.demo', '406-555-0212',
  '300 Legacy Rd, Missoula, MT 59802', '300 Legacy Rd, Missoula, MT 59802',
  'Missoula', 'MT', '59802', 'Active', 'Net 30',
  'Presentation — expired contract customer.',
  '00000000-0000-4000-8000-000000000001'
),
(
  'cccccccc-cccc-cccc-cccc-cccccccccc13', 'Withdrawn Draft Foods', 'Hal Draft',
  'hal.draft@withdrawn.demo', '208-555-0213',
  '44 Draft Ave, Boise, ID 83704', '44 Draft Ave, Boise, ID 83704',
  'Boise', 'ID', '83704', 'Active', 'Net 30',
  'Presentation — canceled contract customer.',
  '00000000-0000-4000-8000-000000000001'
),
(
  'cccccccc-cccc-cccc-cccc-cccccccccc14', 'Canceled Labs Partner', 'Ivy Cancel',
  'ivy.cancel@canceledlabs.demo', '206-555-0214',
  '77 Lab Ct, Seattle, WA 98105', '77 Lab Ct, Seattle, WA 98105',
  'Seattle', 'WA', '98105', 'Active', 'Net 30',
  'Presentation — canceled contract customer.',
  '00000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = now();

-- ---------------------------------------------------------------------------
-- 3) Equipment
-- ---------------------------------------------------------------------------
INSERT INTO public.equipment (
  id, customer_id, name, category, manufacturer, model, serial_number,
  location, operating_status, warranty_status, installation_date
) VALUES
-- Northwind + Summit (minimal C2C)
(
  '22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111101',
  'Blast Freezer A', 'Refrigeration', 'FrostKing', 'BF-900', 'SN-BF-001',
  'Dock Cold Room', 'Operational', 'Under Warranty', '2024-06-15'
),
(
  '22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111101',
  'Compressor Rack 1', 'Refrigeration', 'FrostKing', 'CR-400', 'SN-CR-001',
  'Mech Room', 'Needs Service', 'Warranty Expired', '2023-03-01'
),
(
  '1d80e39d-a693-4004-9f0b-fa6cba6fdbad', '22222222-2222-2222-2222-222222222201',
  'Walk-In Freezer 1', 'Refrigeration', 'Heatcraft', 'WX-220', 'SUM-WF-001',
  'Loading dock', 'Operational', 'Under Warranty', '2025-01-10'
),
(
  '4c37fc7e-25d9-4edb-a034-2fbe15f6c229', '22222222-2222-2222-2222-222222222201',
  'Condensing Unit A', 'Refrigeration', 'Copeland', 'ZR61KCE', 'SUM-CU-001',
  'Roof', 'Needs Service', 'Warranty Expired', '2022-11-01'
),
-- Manager demo equipment
(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
  'Line Cooler 1', 'Refrigeration', 'True', 'TUC-48', 'CR-LC-001',
  'Kitchen line', 'Operational', 'Under Warranty', '2025-03-01'
),
(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
  'Process Chiller', 'Refrigeration', 'Trane', 'CGAM-020', 'IW-PC-001',
  'Plant floor', 'Operational', 'Under Warranty', '2024-08-01'
),
(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03',
  'Lab Freezer Bank', 'Refrigeration', 'Thermo', 'TSX400', 'LK-LF-001',
  'Specimen lab', 'Operational', 'Under Warranty', '2025-01-15'
),
(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04',
  'Mobile Reefer Unit', 'Refrigeration', 'Carrier', 'X4 7500', 'TH-MR-001',
  'Depot yard', 'Operational', 'Not Covered', '2023-06-01'
),
-- Presentation customers
(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee06', 'cccccccc-cccc-cccc-cccc-cccccccccc06',
  'Walk-In Cooler', 'Refrigeration', 'Heatcraft', 'LC-100', 'HF-WI-001',
  'Prep area', 'Operational', 'Under Warranty', '2024-11-01'
),
(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee07', 'cccccccc-cccc-cccc-cccc-cccccccccc07',
  'Blast Freezer', 'Refrigeration', 'FrostKing', 'BF-600', 'AC-BF-001',
  'Cold dock', 'Needs Service', 'Warranty Expired', '2022-05-01'
),
(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee08', 'cccccccc-cccc-cccc-cccc-cccccccccc08',
  'Display Case Row', 'Refrigeration', 'Hussmann', 'DC-12', 'BR-DC-001',
  'Front of house', 'Operational', 'Under Warranty', '2025-02-01'
),
(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee09', 'cccccccc-cccc-cccc-cccc-cccccccccc09',
  'Rooftop Package Unit', 'Refrigeration', 'Carrier', '48HC', 'RV-RT-001',
  'Roof', 'Operational', 'Under Warranty', '2024-01-01'
),
(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee10', 'cccccccc-cccc-cccc-cccc-cccccccccc10',
  'Kitchen Make-Up Air', 'Refrigeration', 'Greenheck', 'CUE-121', 'VP-KMA-001',
  'Roof', 'Operational', 'Under Warranty', '2024-03-01'
),
(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee11', 'cccccccc-cccc-cccc-cccc-cccccccccc11',
  'Legacy Cooler', 'Refrigeration', 'Bohn', 'BH-200', 'OH-LC-001',
  'Warehouse', 'Out of Service', 'Warranty Expired', '2019-04-01'
),
(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee12', 'cccccccc-cccc-cccc-cccc-cccccccccc12',
  'Fleet Reefer 12', 'Refrigeration', 'Thermo King', 'SB-310', 'LF-RF-012',
  'Yard', 'Retired', 'Not Covered', '2018-09-01'
),
(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee13', 'cccccccc-cccc-cccc-cccc-cccccccccc13',
  'Draft Reach-In', 'Refrigeration', 'True', 'T-49', 'WD-RI-001',
  'Stockroom', 'Operational', 'Unknown', '2020-01-01'
),
(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee14', 'cccccccc-cccc-cccc-cccc-cccccccccc14',
  'Lab Ultra-Low', 'Refrigeration', 'Thermo', 'ULT-86', 'CL-UL-001',
  'Cold storage', 'Operational', 'Under Warranty', '2021-07-01'
)
ON CONFLICT (id) DO UPDATE SET
  customer_id = EXCLUDED.customer_id,
  name = EXCLUDED.name,
  warranty_status = EXCLUDED.warranty_status,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 4) Contracts (8 Active regular + edge cases)
-- ---------------------------------------------------------------------------
INSERT INTO public.service_contracts (
  id, customer_id, name, contract_type, start_date, end_date,
  renewal_option, billing_method, contract_price, monthly_amount, deductible,
  payment_terms, included_service_visits, service_frequency,
  included_labor_hours, included_replacement_parts,
  emergency_response_commitment, warranty_terms, cancellation_terms,
  approval_requirements, status, notes, created_by
) VALUES
-- Manager demo (1–4)
(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
  'Cedar Ridge Kitchen Co · Foodservice · Silver', 'Preventive Maintenance',
  '2026-01-01', '2026-12-31', 'Manual renewal', 'Monthly Recurring Charge',
  4800, 400, 150, 'Net 30', 4, 'Quarterly', 16, 700, '8 business hours',
  'Parts warranty 90 days', '30-day notice', 'Manager approval for extras over $500',
  'Active',
  E'[Plan: Foodservice · Silver · Mid · asset $100,000]\n[Extras: travel_radius_miles=40; deductible=150; waiting_period_days=21]',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
),
(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
  'Ironwood Assembly Works · Manufacturing / Plant · Silver', 'Preventive Maintenance',
  '2026-01-01', '2026-12-31', 'Manual renewal', 'Monthly Recurring Charge',
  7800, 650, 200, 'Net 30', 4, 'Quarterly', 22, 1200, '8 business hours',
  'Parts warranty 90 days', '30-day notice', 'Manager approval for extras over $750',
  'Active',
  E'[Plan: Manufacturing / Plant · Silver · Mid · asset $150,000]\n[Extras: travel_radius_miles=60; deductible=200; waiting_period_days=21]',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
),
(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb03', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03',
  'Lakeside Clinical Labs · Healthcare / Labs · Gold', 'Full-Service Maintenance',
  '2026-01-01', '2026-12-31', 'Auto-renew', 'Monthly Recurring Charge',
  16500, 1375, 0, 'Net 30', 12, 'Monthly', 56, 3200, '4 business hours',
  'Priority calibrated parts support', '90-day notice', 'Manager approval for extras beyond allowance',
  'Active',
  E'[Plan: Healthcare / Labs · Gold · Mid · asset $200,000]\n[Extras: travel_radius_miles=50; deductible=0; waiting_period_days=7]',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
),
(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb04', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04',
  'Trailhead Mobile Services · Fleet / Mobile · Bronze', 'Preventive Maintenance',
  '2026-01-01', '2026-12-31', 'Manual renewal', 'Per-Service Charge',
  2000, 167, 300, 'Net 30', 2, 'Semi-Annual', 6, 0, 'Next business day',
  'Labor not warranty', '30-day notice', 'Customer approval required before non-PM dispatch',
  'Active',
  E'[Plan: Fleet / Mobile · Bronze · Mid · asset $75,000]\n[Extras: travel_radius_miles=75; deductible=300; waiting_period_days=30]',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
),
-- Northwind (5)
(
  '33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111101',
  'Northwind PM Gold', 'Preventive Maintenance', '2026-01-01', '2026-12-31',
  'Auto-renew', 'Monthly Recurring Charge', 24000, 2000, 0, 'Net 30',
  12, 'Monthly', 48, 1500, '4-hour emergency response',
  'OEM parts warranty pass-through', '30-day notice', 'Manager approval for extras',
  'Active', 'Minimal C2C scaffold — Northwind PM Gold.',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
),
-- Regular 6–8
(
  'dddddddd-dddd-dddd-dddd-dddddddddd06', 'cccccccc-cccc-cccc-cccc-cccccccccc06',
  'Harbor Foods Co-op · Foodservice · Gold', 'Full-Service Maintenance',
  '2026-01-01', '2026-12-31', 'Auto-renew', 'Monthly Recurring Charge',
  12000, 1000, 0, 'Net 30', 12, 'Monthly', 36, 2000, '4 business hours',
  'Wear parts included', '60-day notice', 'Manager approval for extras',
  'Active',
  E'[Plan: Foodservice · Gold · Mid · asset $120,000]\nPresentation regular contract 6.',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
),
(
  'dddddddd-dddd-dddd-dddd-dddddddddd07', 'cccccccc-cccc-cccc-cccc-cccccccccc07',
  'Alpine Cold Storage · Manufacturing / Plant · Silver', 'Emergency Repair Plan',
  '2026-01-01', '2026-12-31', 'Manual renewal', 'Per-Service Charge',
  6000, 500, 250, 'Net 30', 0, 'As Needed', 0, 0, '4 business hours',
  'Labor not warranty', '30-day notice', 'Manager approval',
  'Active',
  E'[Plan: Manufacturing / Plant · Silver · Mid · asset $90,000]\nPresentation regular contract 7.',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
),
(
  'dddddddd-dddd-dddd-dddd-dddddddddd08', 'cccccccc-cccc-cccc-cccc-cccccccccc08',
  'Beacon Restaurant Group · Foodservice · Silver', 'Preventive Maintenance',
  '2026-01-01', '2026-12-31', 'Manual renewal', 'Monthly Recurring Charge',
  9600, 800, 150, 'Net 15', 4, 'Quarterly', 24, 800, 'Next business day',
  'Parts warranty 90 days', '30-day notice', 'Manager approval for extras',
  'Active',
  E'[Plan: Foodservice · Silver · Mid · asset $80,000]\nPresentation regular contract 8.',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
),
-- Deferred revenue (ASC 606)
(
  'dddddddd-dddd-dddd-dddd-dddddddddde1', 'cccccccc-cccc-cccc-cccc-cccccccccc09',
  'Ridgeview Prepaid PM · Foodservice · Gold', 'Preventive Maintenance',
  '2026-01-01', '2026-12-31', 'Auto-renew', 'Annual Fixed Fee',
  24000, 2000, 0, 'Net 30', 12, 'Monthly', 48, 1500, '4 business hours',
  'OEM parts warranty pass-through', '30-day notice', 'Manager approval for extras',
  'Active',
  E'[Plan: Foodservice · Gold · Mid · asset $110,000]\nPresentation ASC 606 prepaid contract A.',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
),
(
  'dddddddd-dddd-dddd-dddd-dddddddddde2', 'cccccccc-cccc-cccc-cccc-cccccccccc10',
  'Valley Prepaid PM · Healthcare / Labs · Silver', 'Preventive Maintenance',
  '2026-01-01', '2026-12-31', 'Auto-renew', 'Annual Fixed Fee',
  24000, 2000, 0, 'Net 30', 12, 'Monthly', 48, 1500, '4 business hours',
  'OEM parts warranty pass-through', '30-day notice', 'Manager approval for extras',
  'Active',
  E'[Plan: Healthcare / Labs · Silver · Mid · asset $130,000]\nPresentation ASC 606 prepaid contract B.',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
),
-- Expired
(
  'dddddddd-dddd-dddd-dddd-dddddddddda1', 'cccccccc-cccc-cccc-cccc-cccccccccc11',
  'Old Harbor Cold Storage · Fleet / Mobile · Bronze', 'Preventive Maintenance',
  '2025-01-01', '2025-12-31', 'Manual renewal', 'Monthly Recurring Charge',
  8400, 700, 300, 'Net 30', 4, 'Quarterly', 16, 500, 'Next business day',
  'Limited parts', '30-day notice', 'Manager approval',
  'Expired', 'Presentation — expired agreement; dispatch blocked without renewal.',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
),
(
  'dddddddd-dddd-dddd-dddd-dddddddddda2', 'cccccccc-cccc-cccc-cccc-cccccccccc12',
  'Legacy Fleet Refrigeration · Fleet / Mobile · Bronze', 'Custom Service Agreement',
  '2024-06-01', '2025-05-31', 'No renewal', 'Annual Fixed Fee',
  18000, 1500, 500, 'Net 30', 6, 'Semi-Annual', 30, 1000, '8 business hours',
  'Standard', '30-day notice', 'Manager approval',
  'Expired', 'Presentation — expired annual agreement.',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
),
-- Canceled
(
  'dddddddd-dddd-dddd-dddd-ddddddddddc1', 'cccccccc-cccc-cccc-cccc-cccccccccc13',
  'Withdrawn Draft Foods · Foodservice · Bronze', 'Preventive Maintenance',
  '2026-03-01', '2027-02-28', 'Manual renewal', 'Monthly Recurring Charge',
  7200, 600, 200, 'Net 30', 4, 'Quarterly', 12, 400, 'Next business day',
  'Limited', '30-day notice', 'Manager approval',
  'Canceled', 'Presentation — customer withdrew during onboarding.',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
),
(
  'dddddddd-dddd-dddd-dddd-ddddddddddc2', 'cccccccc-cccc-cccc-cccc-cccccccccc14',
  'Canceled Labs Partner · Healthcare / Labs · Silver', 'Full-Service Maintenance',
  '2026-02-01', '2027-01-31', 'Manual renewal', 'Monthly Recurring Charge',
  14400, 1200, 0, 'Net 30', 12, 'Monthly', 40, 2500, '4 business hours',
  'Priority parts', '90-day notice', 'Dual approval',
  'Canceled', 'Presentation — contract canceled before go-live.',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  billing_method = EXCLUDED.billing_method,
  contract_price = EXCLUDED.contract_price,
  notes = EXCLUDED.notes,
  updated_at = now();

INSERT INTO public.contract_equipment (contract_id, equipment_id) VALUES
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02'),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb03', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03'),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb04', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04'),
('33333333-3333-3333-3333-333333333301', '22222222-2222-2222-2222-222222222201'),
('33333333-3333-3333-3333-333333333301', '22222222-2222-2222-2222-222222222202'),
('dddddddd-dddd-dddd-dddd-dddddddddd06', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee06'),
('dddddddd-dddd-dddd-dddd-dddddddddd07', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee07'),
('dddddddd-dddd-dddd-dddd-dddddddddd08', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee08'),
('dddddddd-dddd-dddd-dddd-dddddddddde1', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee09'),
('dddddddd-dddd-dddd-dddd-dddddddddde2', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee10'),
('dddddddd-dddd-dddd-dddd-dddddddddda1', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee11'),
('dddddddd-dddd-dddd-dddd-dddddddddda2', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee12')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5) Work orders, labor, parts, AWR, invoices, payments
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_tech uuid := '4de161ef-0146-4ddf-b10e-92b421a8e269';
  v_billing uuid := 'c6c79bc3-6d7d-43d5-9d91-cc22ce24fe7f';
  v_manager uuid := '23bb1551-410c-4eb6-b38c-82a7e44645ba';
BEGIN
  SELECT id INTO v_tech FROM public.profiles WHERE email = 'tech1@equipmentiq-demo.test' LIMIT 1;
  SELECT id INTO v_billing FROM public.profiles WHERE email = 'billing@equipmentiq-demo.test' LIMIT 1;
  SELECT id INTO v_manager FROM public.profiles WHERE email = 'manager@equipmentiq-demo.test' LIMIT 1;
  IF v_tech IS NULL THEN v_tech := '4de161ef-0146-4ddf-b10e-92b421a8e269'; END IF;
  IF v_billing IS NULL THEN v_billing := 'c6c79bc3-6d7d-43d5-9d91-cc22ce24fe7f'; END IF;

  ALTER TABLE public.work_orders DISABLE TRIGGER work_orders_customer_contract_window;

  -- Regular completed jobs (one per Active contract 1–8)
  INSERT INTO public.work_orders (
    id, work_order_number, customer_id, equipment_id, contract_id,
    work_order_type, priority, assigned_technician_id, scheduled_date,
    problem_description, work_performed, warranty_coverage,
    billing_status, status, dispatch_status, completion_date
  ) VALUES
  (
    'a1111111-1111-1111-1111-111111111001', 'PRES-WO-REG-01',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01', 'Preventive Maintenance', 'Normal', v_tech,
    '2026-02-10', 'Quarterly PM — line cooler temps and door seals.',
    'Cleaned condenser, verified charge, replaced worn gasket.', 'Fully Covered',
    'Billed', 'Completed', 'Done', '2026-02-11'
  ),
  (
    'a1111111-1111-1111-1111-111111111002', 'PRES-WO-REG-02',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02', 'Inspection', 'Normal', v_tech,
    '2026-03-05', 'Quarterly plant chiller inspection.',
    'Checked oil, vibration, and refrigerant levels — all within spec.', 'Fully Covered',
    'Billed', 'Completed', 'Done', '2026-03-06'
  ),
  (
    'a1111111-1111-1111-1111-111111111003', 'PRES-WO-REG-03',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb03', 'Preventive Maintenance', 'Normal', v_tech,
    '2026-04-08', 'Monthly PM — lab freezer bank.',
    'Calibrated probes, cleaned coils, updated maintenance log.', 'Fully Covered',
    'Billed', 'Completed', 'Done', '2026-04-09'
  ),
  (
    'a1111111-1111-1111-1111-111111111004', 'PRES-WO-REG-04',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb04', 'Follow-Up Service', 'Normal', v_tech,
    '2026-05-12', 'Semi-annual mobile reefer check.',
    'Verified setpoint and defrost cycle.', 'Fully Covered',
    'Unbilled', 'Completed', 'Done', '2026-05-13'
  ),
  (
    'a1111111-1111-1111-1111-111111111005', 'PRES-WO-REG-05',
    '11111111-1111-1111-1111-111111111101', '22222222-2222-2222-2222-222222222201',
    '33333333-3333-3333-3333-333333333301', 'Preventive Maintenance', 'Normal', v_tech,
    '2026-06-14', '[PM-SCHED 2026-06] Monthly PM — blast freezer A.',
    'Cleaned evaporator, checked superheat, replaced air filters.', 'Fully Covered',
    'Unbilled', 'Completed', 'Done', '2026-06-15'
  ),
  (
    'a1111111-1111-1111-1111-111111111006', 'PRES-WO-REG-06',
    'cccccccc-cccc-cccc-cccc-cccccccccc06', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee06',
    'dddddddd-dddd-dddd-dddd-dddddddddd06', 'Repair', 'Normal', v_tech,
    '2026-05-20', 'Walk-in cooler temperature drift.',
    'Replaced TXV and verified box temp.', 'Fully Covered',
    'Billed', 'Closed', 'Done', '2026-05-21'
  ),
  (
    'a1111111-1111-1111-1111-111111111007', 'PRES-WO-REG-07',
    'cccccccc-cccc-cccc-cccc-cccccccccc07', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee07',
    'dddddddd-dddd-dddd-dddd-dddddddddd07', 'Emergency Repair', 'High', v_tech,
    '2026-04-02', 'Blast freezer high temp alarm.',
    'Replaced failed contactor and restored cooling.', 'Not Covered',
    'Billed', 'Completed', 'Done', '2026-04-03'
  ),
  (
    'a1111111-1111-1111-1111-111111111008', 'PRES-WO-REG-08',
    'cccccccc-cccc-cccc-cccc-cccccccccc08', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee08',
    'dddddddd-dddd-dddd-dddd-dddddddddd08', 'Preventive Maintenance', 'Normal', v_tech,
    '2026-07-01', 'Quarterly PM — display case row.',
    'Cleaned drains, checked refrigerant, adjusted TXV.', 'Fully Covered',
    'Unbilled', 'Completed', 'Done', '2026-07-02'
  )
  ON CONFLICT (work_order_number) DO NOTHING;

  -- Unprofitable jobs (2) — Summit hot customer, no contract
  INSERT INTO public.work_orders (
    id, work_order_number, customer_id, equipment_id, contract_id,
    work_order_type, priority, assigned_technician_id, scheduled_date,
    problem_description, work_performed, warranty_coverage, outside_contract,
    billing_status, status, dispatch_status, completion_date
  ) VALUES
  (
    'a2222222-2222-2222-2222-222222222201', 'PRES-WO-LOSS-01',
    '22222222-2222-2222-2222-222222222201', '1d80e39d-a693-4004-9f0b-fa6cba6fdbad', NULL,
    'Emergency Repair', 'High', v_tech, '2026-05-18',
    'Walk-in freezer not holding temp — compressor short-cycling.',
    'Replaced filter drier and TXV; extended vacuum and recharge.', 'Not Covered', true,
    'Billed', 'Completed', 'Done', '2026-05-19'
  ),
  (
    'a2222222-2222-2222-2222-222222222202', 'PRES-WO-LOSS-02',
    '22222222-2222-2222-2222-222222222201', '4c37fc7e-25d9-4edb-a034-2fbe15f6c229', NULL,
    'Repair', 'Normal', v_tech, '2026-06-22',
    'Roof condensing unit high head pressure.',
    'Replaced contactor and cleaned condenser — required second trip.', 'Not Covered', true,
    'Billed', 'Completed', 'Done', '2026-06-23'
  )
  ON CONFLICT (work_order_number) DO NOTHING;

  INSERT INTO public.technician_labor (
    id, work_order_id, technician_id, work_date, regular_hours, overtime_hours,
    hourly_cost_rate, overtime_cost_rate, customer_billing_rate, billable_status, invoiced
  ) VALUES
  ('b1111111-1111-1111-1111-111111111001', 'a2222222-2222-2222-2222-222222222201', v_tech, '2026-05-19', 10, 2, 85, 127.5, 28, 'Billable', true),
  ('b1111111-1111-1111-1111-111111111002', 'a2222222-2222-2222-2222-222222222202', v_tech, '2026-06-23', 8, 0, 92, 138, 32, 'Billable', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.work_order_parts (
    id, work_order_id, part_id, quantity_used, unit_cost, customer_price,
    warranty_covered_amount, billable_amount, date_used, manager_override, invoiced
  ) VALUES
  ('c1111111-1111-1111-1111-111111111001', 'a2222222-2222-2222-2222-222222222201', 'ffffffff-ffff-ffff-ffff-fffffffff001', 1, 185, 95, 0, 95, '2026-05-19', false, true),
  ('c1111111-1111-1111-1111-111111111002', 'a2222222-2222-2222-2222-222222222201', 'ffffffff-ffff-ffff-ffff-fffffffff002', 1, 420, 180, 0, 180, '2026-05-19', false, true),
  ('c1111111-1111-1111-1111-111111111003', 'a2222222-2222-2222-2222-222222222202', 'ffffffff-ffff-ffff-ffff-fffffffff004', 2, 140, 65, 0, 130, '2026-06-23', false, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.invoices (
    id, invoice_number, customer_id, work_order_id, equipment_id,
    invoice_date, due_date, billing_period,
    labor_charges, parts_charges, recurring_service_charge, additional_charges,
    warranty_deductions, discounts, tax, invoice_total, amount_paid, remaining_balance,
    status, notes, created_by, assigned_to
  ) VALUES
  (
    'd2222222-2222-2222-2222-222222222201', 'PRES-INV-LOSS-01',
    '22222222-2222-2222-2222-222222222201', 'a2222222-2222-2222-2222-222222222201',
    '1d80e39d-a693-4004-9f0b-fa6cba6fdbad',
    '2026-05-20', '2026-06-19', 'May 2026',
    336, 275, 0, 0, 0, 0, 49.07, 660.07, 660.07, 0,
    'Paid', 'Presentation — unprofitable job (high COGS vs billed).', v_billing, v_billing
  ),
  (
    'd2222222-2222-2222-2222-222222222202', 'PRES-INV-LOSS-02',
    '22222222-2222-2222-2222-222222222201', 'a2222222-2222-2222-2222-222222222202',
    '4c37fc7e-25d9-4edb-a034-2fbe15f6c229',
    '2026-06-24', '2026-07-24', 'Jun 2026',
    256, 130, 0, 0, 0, 0, 37.58, 423.58, 0, 423.58,
    'Sent', 'Presentation — unprofitable job; open AR.', v_billing, v_billing
  )
  ON CONFLICT (invoice_number) DO NOTHING;

  -- AWR pending (2)
  INSERT INTO public.work_orders (
    id, work_order_number, customer_id, equipment_id, contract_id,
    work_order_type, priority, assigned_technician_id, scheduled_date,
    problem_description, warranty_coverage, outside_contract,
    billing_status, status, dispatch_status
  ) VALUES
  (
    'a3333333-3333-3333-3333-333333333301', 'PRES-WO-AWR-01',
    '22222222-2222-2222-2222-222222222201', '1d80e39d-a693-4004-9f0b-fa6cba6fdbad', NULL,
    'Repair', 'Normal', v_tech, '2026-07-28',
    'Evaporator icing — initial diagnosis complete.',
    'Not Covered', true, 'Unbilled', 'In Progress', 'Working'
  ),
  (
    'a3333333-3333-3333-3333-333333333302', 'PRES-WO-AWR-02',
    'cccccccc-cccc-cccc-cccc-cccccccccc07', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee07', NULL,
    'Repair', 'High', v_tech, '2026-07-30',
    'Found additional leak on suction line during scheduled repair.',
    'Not Covered', true, 'Unbilled', 'Ready for Review', 'Working'
  )
  ON CONFLICT (work_order_number) DO NOTHING;

  INSERT INTO public.additional_work_requests (
    id, work_order_id, description, recommended_repair,
    estimated_labor_hours, estimated_parts, estimated_additional_charge,
    supporting_notes, approval_status, requested_by
  ) VALUES
  (
    'e3333333-3333-3333-3333-333333333301', 'a3333333-3333-3333-3333-333333333301',
    'Replace evaporator fan motor and wiring harness.',
    'Install new ECM fan motor — not in original scope.',
    3, 420, 890,
    'Motor drawing high amps; customer wants same-day fix if approved.', 'Pending Manager Approval', v_tech
  ),
  (
    'e3333333-3333-3333-3333-333333333302', 'a3333333-3333-3333-3333-333333333302',
    'Braze suction line leak and pressure test.',
    'Add silver solder repair and 24hr hold test.',
    4, 185, 1120,
    'Leak found after initial quote — cannot bill until manager approves.', 'Pending Manager Approval', v_tech
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.work_order_parts (
    id, work_order_id, part_id, quantity_used, unit_cost, customer_price,
    warranty_covered_amount, billable_amount, date_used, manager_override, invoiced
  ) VALUES
  ('c3333333-3333-3333-3333-333333333301', 'a3333333-3333-3333-3333-333333333301', 'ffffffff-ffff-ffff-ffff-fffffffff004', 1, 140, 265, 0, 265, '2026-07-28', false, false)
  ON CONFLICT (id) DO NOTHING;

  -- Warranty split (2) — Parts Covered + Warranty Repair
  INSERT INTO public.work_orders (
    id, work_order_number, customer_id, equipment_id, contract_id,
    work_order_type, priority, assigned_technician_id, scheduled_date,
    problem_description, work_performed, warranty_coverage,
    billing_status, status, dispatch_status, completion_date
  ) VALUES
  (
    'a4444444-4444-4444-4444-444444444401', 'PRES-WO-WTY-01',
    '11111111-1111-1111-1111-111111111101', '22222222-2222-2222-2222-222222222201',
    '33333333-3333-3333-3333-333333333301', 'Warranty Repair', 'Normal', v_tech,
    '2026-06-10', 'OEM warranty — failed TXV under parts coverage.',
    'Replaced TXV; labor billable per warranty terms.', 'Parts Covered',
    'Billed', 'Completed', 'Done', '2026-06-11'
  ),
  (
    'a4444444-4444-4444-4444-444444444402', 'PRES-WO-WTY-02',
    'cccccccc-cccc-cccc-cccc-cccccccccc08', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee08',
    'dddddddd-dddd-dddd-dddd-dddddddddd08', 'Warranty Repair', 'Normal', v_tech,
    '2026-07-08', 'Display case — OEM covered gasket failure.',
    'Replaced door gaskets; customer pays labor only.', 'Parts Covered',
    'Billed', 'Completed', 'Done', '2026-07-09'
  )
  ON CONFLICT (work_order_number) DO NOTHING;

  INSERT INTO public.technician_labor (
    id, work_order_id, technician_id, work_date, regular_hours, overtime_hours,
    hourly_cost_rate, overtime_cost_rate, customer_billing_rate, billable_status, invoiced
  ) VALUES
  ('b4444444-4444-4444-4444-444444444401', 'a4444444-4444-4444-4444-444444444401', v_tech, '2026-06-11', 4, 0, 78, 117, 95, 'Billable', true),
  ('b4444444-4444-4444-4444-444444444402', 'a4444444-4444-4444-4444-444444444402', v_tech, '2026-07-09', 3.5, 0, 78, 117, 95, 'Billable', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.work_order_parts (
    id, work_order_id, part_id, quantity_used, unit_cost, customer_price,
    warranty_covered_amount, billable_amount, date_used, manager_override, invoiced
  ) VALUES
  ('c4444444-4444-4444-4444-444444444401', 'a4444444-4444-4444-4444-444444444401', 'ffffffff-ffff-ffff-ffff-fffffffff002', 1, 420, 650, 650, 0, '2026-06-11', false, true),
  ('c4444444-4444-4444-4444-444444444402', 'a4444444-4444-4444-4444-444444444402', 'ffffffff-ffff-ffff-ffff-fffffffff003', 2, 95, 180, 360, 0, '2026-07-09', false, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.invoices (
    id, invoice_number, customer_id, contract_id, work_order_id, equipment_id,
    invoice_date, due_date, billing_period,
    labor_charges, parts_charges, recurring_service_charge, additional_charges,
    warranty_deductions, discounts, tax, invoice_total, amount_paid, remaining_balance,
    status, notes, created_by, assigned_to
  ) VALUES
  (
    'd4444444-4444-4444-4444-444444444401', 'PRES-INV-WTY-01',
    '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333301',
    'a4444444-4444-4444-4444-444444444401', '22222222-2222-2222-2222-222222222201',
    '2026-06-12', '2026-07-12', 'Jun 2026',
    380, 650, 0, 0, 650, 0, 41.80, 421.80, 421.80, 0,
    'Paid', 'Presentation — parts covered under warranty; labor billable.', v_billing, v_billing
  ),
  (
    'd4444444-4444-4444-4444-444444444402', 'PRES-INV-WTY-02',
    'cccccccc-cccc-cccc-cccc-cccccccccc08', 'dddddddd-dddd-dddd-dddd-dddddddddd08',
    'a4444444-4444-4444-4444-444444444402', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee08',
    '2026-07-10', '2026-08-09', 'Jul 2026',
    332.5, 360, 0, 0, 360, 0, 36.56, 369.06, 0, 369.06,
    'Sent', 'Presentation — warranty parts $0 to customer; labor billed.', v_billing, v_billing
  )
  ON CONFLICT (invoice_number) DO NOTHING;

  -- Deferred revenue PM visits — contract e1 (Jan–Jul completed)
  INSERT INTO public.work_orders (
    id, work_order_number, customer_id, equipment_id, contract_id,
    work_order_type, priority, assigned_technician_id, scheduled_date,
    problem_description, work_performed, warranty_coverage,
    billing_status, status, dispatch_status, completion_date
  ) VALUES
  ('a5555555-5555-5555-5555-555555555501', 'PRES-WO-DEF-E1-01', 'cccccccc-cccc-cccc-cccc-cccccccccc09', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee09', 'dddddddd-dddd-dddd-dddd-dddddddddde1', 'Preventive Maintenance', 'Normal', v_tech, '2026-01-15', '[PM-SCHED 2026-01] Monthly PM visit.', 'Completed January PM.', 'Fully Covered', 'Unbilled', 'Completed', 'Done', '2026-01-16'),
  ('a5555555-5555-5555-5555-555555555502', 'PRES-WO-DEF-E1-02', 'cccccccc-cccc-cccc-cccc-cccccccccc09', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee09', 'dddddddd-dddd-dddd-dddd-dddddddddde1', 'Preventive Maintenance', 'Normal', v_tech, '2026-02-12', '[PM-SCHED 2026-02] Monthly PM visit.', 'Completed February PM.', 'Fully Covered', 'Unbilled', 'Completed', 'Done', '2026-02-13'),
  ('a5555555-5555-5555-5555-555555555503', 'PRES-WO-DEF-E1-03', 'cccccccc-cccc-cccc-cccc-cccccccccc09', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee09', 'dddddddd-dddd-dddd-dddd-dddddddddde1', 'Preventive Maintenance', 'Normal', v_tech, '2026-03-14', '[PM-SCHED 2026-03] Monthly PM visit.', 'Completed March PM.', 'Fully Covered', 'Unbilled', 'Completed', 'Done', '2026-03-15'),
  ('a5555555-5555-5555-5555-555555555504', 'PRES-WO-DEF-E1-04', 'cccccccc-cccc-cccc-cccc-cccccccccc09', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee09', 'dddddddd-dddd-dddd-dddd-dddddddddde1', 'Preventive Maintenance', 'Normal', v_tech, '2026-04-11', '[PM-SCHED 2026-04] Monthly PM visit.', 'Completed April PM.', 'Fully Covered', 'Unbilled', 'Completed', 'Done', '2026-04-12'),
  ('a5555555-5555-5555-5555-555555555505', 'PRES-WO-DEF-E1-05', 'cccccccc-cccc-cccc-cccc-cccccccccc09', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee09', 'dddddddd-dddd-dddd-dddd-dddddddddde1', 'Preventive Maintenance', 'Normal', v_tech, '2026-05-16', '[PM-SCHED 2026-05] Monthly PM visit.', 'Completed May PM.', 'Fully Covered', 'Unbilled', 'Completed', 'Done', '2026-05-17'),
  ('a5555555-5555-5555-5555-555555555506', 'PRES-WO-DEF-E1-06', 'cccccccc-cccc-cccc-cccc-cccccccccc09', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee09', 'dddddddd-dddd-dddd-dddd-dddddddddde1', 'Preventive Maintenance', 'Normal', v_tech, '2026-06-13', '[PM-SCHED 2026-06] Monthly PM visit.', 'Completed June PM.', 'Fully Covered', 'Unbilled', 'Completed', 'Done', '2026-06-14'),
  ('a5555555-5555-5555-5555-555555555507', 'PRES-WO-DEF-E1-07', 'cccccccc-cccc-cccc-cccc-cccccccccc09', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee09', 'dddddddd-dddd-dddd-dddd-dddddddddde1', 'Preventive Maintenance', 'Normal', v_tech, '2026-07-11', '[PM-SCHED 2026-07] Monthly PM visit.', 'Completed July PM.', 'Fully Covered', 'Unbilled', 'Completed', 'Done', '2026-07-12')
  ON CONFLICT (work_order_number) DO NOTHING;

  -- Contract e2 — Jan–May completed, Jun–Jul open
  INSERT INTO public.work_orders (
    id, work_order_number, customer_id, equipment_id, contract_id,
    work_order_type, priority, assigned_technician_id, scheduled_date,
    problem_description, warranty_coverage,
    billing_status, status, dispatch_status, completion_date
  ) VALUES
  ('a5555555-5555-5555-5555-555555555601', 'PRES-WO-DEF-E2-01', 'cccccccc-cccc-cccc-cccc-cccccccccc10', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee10', 'dddddddd-dddd-dddd-dddd-dddddddddde2', 'Preventive Maintenance', 'Normal', v_tech, '2026-01-20', '[PM-SCHED 2026-01] Monthly PM visit.', 'Fully Covered', 'Unbilled', 'Completed', 'Done', '2026-01-21'),
  ('a5555555-5555-5555-5555-555555555602', 'PRES-WO-DEF-E2-02', 'cccccccc-cccc-cccc-cccc-cccccccccc10', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee10', 'dddddddd-dddd-dddd-dddd-dddddddddde2', 'Preventive Maintenance', 'Normal', v_tech, '2026-02-18', '[PM-SCHED 2026-02] Monthly PM visit.', 'Fully Covered', 'Unbilled', 'Completed', 'Done', '2026-02-19'),
  ('a5555555-5555-5555-5555-555555555603', 'PRES-WO-DEF-E2-03', 'cccccccc-cccc-cccc-cccc-cccccccccc10', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee10', 'dddddddd-dddd-dddd-dddd-dddddddddde2', 'Preventive Maintenance', 'Normal', v_tech, '2026-03-17', '[PM-SCHED 2026-03] Monthly PM visit.', 'Fully Covered', 'Unbilled', 'Completed', 'Done', '2026-03-18'),
  ('a5555555-5555-5555-5555-555555555604', 'PRES-WO-DEF-E2-04', 'cccccccc-cccc-cccc-cccc-cccccccccc10', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee10', 'dddddddd-dddd-dddd-dddd-dddddddddde2', 'Preventive Maintenance', 'Normal', v_tech, '2026-04-14', '[PM-SCHED 2026-04] Monthly PM visit.', 'Fully Covered', 'Unbilled', 'Completed', 'Done', '2026-04-15'),
  ('a5555555-5555-5555-5555-555555555605', 'PRES-WO-DEF-E2-05', 'cccccccc-cccc-cccc-cccc-cccccccccc10', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee10', 'dddddddd-dddd-dddd-dddd-dddddddddde2', 'Preventive Maintenance', 'Normal', v_tech, '2026-05-15', '[PM-SCHED 2026-05] Monthly PM visit.', 'Fully Covered', 'Unbilled', 'Completed', 'Done', '2026-05-16'),
  ('a5555555-5555-5555-5555-555555555606', 'PRES-WO-DEF-E2-06', 'cccccccc-cccc-cccc-cccc-cccccccccc10', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee10', 'dddddddd-dddd-dddd-dddd-dddddddddde2', 'Preventive Maintenance', 'Normal', v_tech, '2026-06-12', '[PM-SCHED 2026-06] Monthly PM visit.', 'Fully Covered', 'Unbilled', 'Scheduled', 'Not Started', NULL),
  ('a5555555-5555-5555-5555-555555555607', 'PRES-WO-DEF-E2-07', 'cccccccc-cccc-cccc-cccc-cccccccccc10', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee10', 'dddddddd-dddd-dddd-dddd-dddddddddde2', 'Preventive Maintenance', 'Normal', v_tech, '2026-07-10', '[PM-SCHED 2026-07] Monthly PM visit.', 'Fully Covered', 'Unbilled', 'In Progress', 'Working', NULL)
  ON CONFLICT (work_order_number) DO NOTHING;

  -- Prepaid annual invoices (deferred revenue)
  INSERT INTO public.invoices (
    id, invoice_number, customer_id, contract_id, equipment_id,
    invoice_date, due_date, billing_period,
    labor_charges, parts_charges, recurring_service_charge, additional_charges,
    warranty_deductions, discounts, tax, invoice_total, amount_paid, remaining_balance,
    status, notes, created_by, assigned_to
  ) VALUES
  (
    'd5555555-5555-5555-5555-555555555501', 'PRES-INV-DEF-E1',
    'cccccccc-cccc-cccc-cccc-cccccccccc09', 'dddddddd-dddd-dddd-dddd-dddddddddde1', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee09',
    '2026-01-02', '2026-02-01', 'FY 2026 prepay',
    0, 0, 24000, 0, 0, 0, 0, 24000, 24000, 0,
    'Paid', 'Presentation — annual prepayment; deferred revenue contract A.', v_billing, v_billing
  ),
  (
    'd5555555-5555-5555-5555-555555555502', 'PRES-INV-DEF-E2',
    'cccccccc-cccc-cccc-cccc-cccccccccc10', 'dddddddd-dddd-dddd-dddd-dddddddddde2', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee10',
    '2026-01-02', '2026-02-01', 'FY 2026 prepay',
    0, 0, 24000, 0, 0, 0, 0, 24000, 24000, 0,
    'Paid', 'Presentation — annual prepayment; deferred revenue contract B.', v_billing, v_billing
  )
  ON CONFLICT (invoice_number) DO NOTHING;

  -- Expired contract demo WO
  INSERT INTO public.work_orders (
    id, work_order_number, customer_id, equipment_id, contract_id,
    work_order_type, priority, assigned_technician_id, scheduled_date,
    problem_description, warranty_coverage, under_expired_contract,
    billing_status, status, dispatch_status
  ) VALUES
  (
    'a6666666-6666-6666-6666-666666666601', 'PRES-WO-EXP-01',
    'cccccccc-cccc-cccc-cccc-cccccccccc11', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee11',
    'dddddddd-dddd-dddd-dddd-dddddddddda1', 'Repair', 'Normal', v_tech, '2026-07-15',
    'Service request on expired contract equipment.',
    'Not Covered', true, 'Unbilled', 'Requested', 'Not Started'
  )
  ON CONFLICT (work_order_number) DO NOTHING;

  -- AR complication invoices (6) — attach to regular completed jobs
  INSERT INTO public.invoices (
    id, invoice_number, customer_id, contract_id, work_order_id, equipment_id,
    invoice_date, due_date, billing_period,
    labor_charges, parts_charges, recurring_service_charge, additional_charges,
    warranty_deductions, discounts, tax, invoice_total, amount_paid, remaining_balance,
    status, notes, created_by, assigned_to
  ) VALUES
  (
    'd7777777-7777-7777-7777-777777777701', 'PRES-INV-AR-01',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01',
    'a1111111-1111-1111-1111-111111111001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
    '2026-05-01', '2026-05-31', 'Apr 2026',
    420, 185, 0, 0, 0, 0, 48.58, 653.58, 0, 653.58,
    'Sent', 'Presentation — open AR; invoice sent, not yet paid.', v_billing, v_billing
  ),
  (
    'd7777777-7777-7777-7777-777777777702', 'PRES-INV-AR-02',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02',
    'a1111111-1111-1111-1111-111111111002', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    '2026-04-10', '2026-05-10', 'Q1 2026',
    380, 120, 0, 0, 0, 0, 41.80, 541.80, 0, 541.80,
    'Past Due', 'Presentation — past due; customer payment delayed.', v_billing, v_billing
  ),
  (
    'd7777777-7777-7777-7777-777777777703', 'PRES-INV-AR-03',
    'cccccccc-cccc-cccc-cccc-cccccccccc06', 'dddddddd-dddd-dddd-dddd-dddddddddd06',
    'a1111111-1111-1111-1111-111111111006', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee06',
    '2026-05-25', '2026-06-24', 'May 2026',
    520, 310, 0, 0, 0, 0, 54.90, 884.90, 400.00, 484.90,
    'Partially Paid', 'Presentation — partial payment received; balance remains.', v_billing, v_billing
  ),
  (
    'd7777777-7777-7777-7777-777777777704', 'PRES-INV-AR-04',
    'cccccccc-cccc-cccc-cccc-cccccccccc07', 'dddddddd-dddd-dddd-dddd-dddddddddd07',
    'a1111111-1111-1111-1111-111111111007', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee07',
    '2026-04-05', '2026-05-05', 'Apr 2026',
    890, 265, 0, 0, 0, 0, 76.08, 1231.08, 600.00, 631.08,
    'Partially Paid', 'Presentation — emergency repair partial payment.', v_billing, v_billing
  ),
  (
    'd7777777-7777-7777-7777-777777777705', 'PRES-INV-AR-05',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb03',
    'a1111111-1111-1111-1111-111111111003', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03',
    '2026-04-15', '2026-05-15', 'Apr 2026',
    610, 240, 0, 0, 0, 0, 55.90, 905.90, 0, 905.90,
    'Disputed', 'Presentation — customer disputes calibrated probe labor charge.', v_billing, v_billing
  ),
  (
    'd7777777-7777-7777-7777-777777777706', 'PRES-INV-AR-06',
    '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333301',
    'a1111111-1111-1111-1111-111111111005', '22222222-2222-2222-2222-222222222201',
    '2026-06-20', '2026-07-20', 'Jun 2026',
    450, 198, 0, 0, 0, 0, 42.42, 690.42, 0, 690.42,
    'Disputed', 'Presentation — customer disputes parts markup on PM visit.', v_billing, v_billing
  )
  ON CONFLICT (invoice_number) DO NOTHING;

  INSERT INTO public.payments (
    id, payment_number, customer_id, invoice_id, payment_date,
    payment_method, payment_amount, reference_number, notes, created_by
  ) VALUES
  (
    'f0077777-7777-7777-7777-777777777703', 'PRES-PAY-AR-03',
    'cccccccc-cccc-cccc-cccc-cccccccccc06', 'd7777777-7777-7777-7777-777777777703',
    '2026-06-01', 'ACH', 400.00, 'ACH-88490-1', 'Partial payment — Harbor Foods.', v_billing
  ),
  (
    'f0077777-7777-7777-7777-777777777704', 'PRES-PAY-AR-04',
    'cccccccc-cccc-cccc-cccc-cccccccccc07', 'd7777777-7777-7777-7777-777777777704',
    '2026-04-20', 'Check', 600.00, 'CHK-4421', 'Partial payment — Alpine Cold.', v_billing
  )
  ON CONFLICT (id) DO NOTHING;

  ALTER TABLE public.work_orders ENABLE TRIGGER work_orders_customer_contract_window;
END $$;
