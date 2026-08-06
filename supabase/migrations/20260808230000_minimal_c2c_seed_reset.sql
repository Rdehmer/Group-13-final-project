-- Minimal contract-to-cash scaffold for EquipmentIQ demos.
-- Clears transactional noise; keeps demo auth users / profiles / parts / vendors.
-- Leaves: Northwind (contract customer) + Summit (hot / non-contract) + 1 Active contract.

-- ---------------------------------------------------------------------------
-- 1) Wipe transactional / demo history (child → parent)
-- ---------------------------------------------------------------------------
DELETE FROM public.time_entry_audit;
DELETE FROM public.payments;
DELETE FROM public.invoice_line_items;
DELETE FROM public.invoices;

DELETE FROM public.work_order_parts;
DELETE FROM public.technician_labor;
DELETE FROM public.additional_work_requests;
DELETE FROM public.work_order_completion_proofs;
DELETE FROM public.work_order_service_ratings;
DELETE FROM public.emergency_purchases;
DELETE FROM public.service_vendor_bills;
DELETE FROM public.service_vendor_ratings;

DELETE FROM public.customer_inbox_messages;
DELETE FROM public.customer_inbox_threads;
DELETE FROM public.vendor_inbox_messages;
DELETE FROM public.vendor_inbox_threads;

DELETE FROM public.time_entries;
DELETE FROM public.timesheet_entries;
DELETE FROM public.timesheet_submissions;
DELETE FROM public.technician_day_clocks;
DELETE FROM public.technician_dispatch_shifts;
DELETE FROM public.time_off_requests;

DELETE FROM public.purchase_orders;
DELETE FROM public.activity_logs;
DELETE FROM public.truck_inventory;

DELETE FROM public.vendor_bill_payments;
DELETE FROM public.vendor_bills;
DELETE FROM public.vendor_supply_orders;
DELETE FROM public.vendor_work_items;
DELETE FROM public.service_vendors;

DELETE FROM public.work_orders;

DELETE FROM public.contract_equipment;
DELETE FROM public.service_contracts;

-- Drop showcase CRM customers + junk equipment (keep demo-linked customers)
DELETE FROM public.equipment
WHERE customer_id NOT IN (
  '11111111-1111-1111-1111-111111111101', -- Northwind
  '22222222-2222-2222-2222-222222222201'  -- Summit
);

DELETE FROM public.customers
WHERE id NOT IN (
  '11111111-1111-1111-1111-111111111101',
  '22222222-2222-2222-2222-222222222201'
)
AND id NOT IN (
  SELECT customer_id FROM public.profiles WHERE customer_id IS NOT NULL
);

-- Trim Northwind / Summit to the two core assets each
DELETE FROM public.equipment
WHERE customer_id = '11111111-1111-1111-1111-111111111101'
  AND id NOT IN (
    '22222222-2222-2222-2222-222222222201', -- Blast Freezer A
    '22222222-2222-2222-2222-222222222202'  -- Compressor Rack 1
  );

DELETE FROM public.equipment
WHERE customer_id = '22222222-2222-2222-2222-222222222201'
  AND id NOT IN (
    '1d80e39d-a693-4004-9f0b-fa6cba6fdbad', -- Walk-In Freezer 1
    '4c37fc7e-25d9-4edb-a034-2fbe15f6c229'  -- Condensing Unit A
  );

-- ---------------------------------------------------------------------------
-- 2) Upsert minimal scaffold customers + equipment
-- ---------------------------------------------------------------------------
INSERT INTO public.customers (
  id, name, primary_contact_name, email, phone,
  billing_address, service_address, city, state, zip_code,
  status, payment_terms, notes, company_id
) VALUES
(
  '11111111-1111-1111-1111-111111111101',
  'Northwind Cold Storage',
  'Pat North',
  'customer1@equipmentiq-demo.test',
  '555-0101',
  '100 Cold Storage Way, Austin, TX 78701',
  '100 Cold Storage Way, Austin, TX 78701',
  'Austin', 'TX', '78701',
  'Active', 'Net 30',
  'Contract customer for C2C walkthrough (customer1).',
  '00000000-0000-4000-8000-000000000001'
),
(
  '22222222-2222-2222-2222-222222222201',
  'Summit Cold Express',
  'Pat Prospect',
  'customer2@equipmentiq-demo.test',
  '555-0142',
  '220 Express Lane, Austin, TX 78702',
  '220 Express Lane, Austin, TX 78702',
  'Austin', 'TX', '78702',
  'Active', 'Due on Receipt',
  'Hot (non-contract) demo customer — break/fix prospect (customer2).',
  '00000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  primary_contact_name = EXCLUDED.primary_contact_name,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  billing_address = EXCLUDED.billing_address,
  service_address = EXCLUDED.service_address,
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  zip_code = EXCLUDED.zip_code,
  status = EXCLUDED.status,
  payment_terms = EXCLUDED.payment_terms,
  notes = EXCLUDED.notes,
  company_id = EXCLUDED.company_id,
  updated_at = now();

INSERT INTO public.equipment (
  id, customer_id, name, category, manufacturer, model, serial_number,
  location, operating_status, warranty_status, installation_date
) VALUES
(
  '22222222-2222-2222-2222-222222222201',
  '11111111-1111-1111-1111-111111111101',
  'Blast Freezer A', 'Refrigeration', 'FrostKing', 'BF-900', 'SN-BF-001',
  'Dock Cold Room', 'Operational', 'Under Warranty', '2024-06-15'
),
(
  '22222222-2222-2222-2222-222222222202',
  '11111111-1111-1111-1111-111111111101',
  'Compressor Rack 1', 'Refrigeration', 'FrostKing', 'CR-400', 'SN-CR-001',
  'Mech Room', 'Needs Service', 'Warranty Expired', '2023-03-01'
),
(
  '1d80e39d-a693-4004-9f0b-fa6cba6fdbad',
  '22222222-2222-2222-2222-222222222201',
  'Walk-In Freezer 1', 'Refrigeration', 'Heatcraft', 'WX-220', 'SUM-WF-001',
  'Loading dock', 'Operational', 'Under Warranty', '2025-01-10'
),
(
  '4c37fc7e-25d9-4edb-a034-2fbe15f6c229',
  '22222222-2222-2222-2222-222222222201',
  'Condensing Unit A', 'Refrigeration', 'Copeland', 'ZR61KCE', 'SUM-CU-001',
  'Roof', 'Needs Service', 'Warranty Expired', '2022-11-01'
)
ON CONFLICT (id) DO UPDATE SET
  customer_id = EXCLUDED.customer_id,
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  manufacturer = EXCLUDED.manufacturer,
  model = EXCLUDED.model,
  serial_number = EXCLUDED.serial_number,
  location = EXCLUDED.location,
  operating_status = EXCLUDED.operating_status,
  warranty_status = EXCLUDED.warranty_status,
  installation_date = EXCLUDED.installation_date,
  updated_at = now();

-- One Active Northwind contract (start ≥45 days ago so customer service requests work)
INSERT INTO public.service_contracts (
  id, customer_id, name, contract_type,
  start_date, end_date, renewal_option, billing_method,
  contract_price, monthly_amount, deductible, payment_terms,
  included_service_visits, service_frequency,
  included_labor_hours, included_replacement_parts,
  emergency_response_commitment, warranty_terms, cancellation_terms,
  approval_requirements, status, notes, created_by
) VALUES (
  '33333333-3333-3333-3333-333333333301',
  '11111111-1111-1111-1111-111111111101',
  'Northwind PM Gold',
  'Preventive Maintenance',
  '2026-01-01',
  '2026-12-31',
  'Auto-renew',
  'Monthly Recurring Charge',
  24000,
  2000,
  0,
  'Net 30',
  12,
  'Monthly',
  48,
  1500,
  '4-hour emergency response',
  'OEM parts warranty pass-through',
  '30-day notice',
  'Manager approval for extras',
  'Active',
  'Minimal C2C scaffold — sole active contract for Northwind.',
  '23bb1551-410c-4eb6-b38c-82a7e44645ba'
)
ON CONFLICT (id) DO UPDATE SET
  customer_id = EXCLUDED.customer_id,
  name = EXCLUDED.name,
  contract_type = EXCLUDED.contract_type,
  start_date = EXCLUDED.start_date,
  end_date = EXCLUDED.end_date,
  renewal_option = EXCLUDED.renewal_option,
  billing_method = EXCLUDED.billing_method,
  contract_price = EXCLUDED.contract_price,
  monthly_amount = EXCLUDED.monthly_amount,
  deductible = EXCLUDED.deductible,
  payment_terms = EXCLUDED.payment_terms,
  included_service_visits = EXCLUDED.included_service_visits,
  service_frequency = EXCLUDED.service_frequency,
  included_labor_hours = EXCLUDED.included_labor_hours,
  included_replacement_parts = EXCLUDED.included_replacement_parts,
  emergency_response_commitment = EXCLUDED.emergency_response_commitment,
  warranty_terms = EXCLUDED.warranty_terms,
  cancellation_terms = EXCLUDED.cancellation_terms,
  approval_requirements = EXCLUDED.approval_requirements,
  status = EXCLUDED.status,
  notes = EXCLUDED.notes,
  updated_at = now();

INSERT INTO public.contract_equipment (contract_id, equipment_id) VALUES
  ('33333333-3333-3333-3333-333333333301', '22222222-2222-2222-2222-222222222201'),
  ('33333333-3333-3333-3333-333333333301', '22222222-2222-2222-2222-222222222202')
ON CONFLICT DO NOTHING;

-- Keep profile ↔ customer / vendor links correct
UPDATE public.profiles
SET customer_id = '11111111-1111-1111-1111-111111111101'
WHERE email = 'customer1@equipmentiq-demo.test';

UPDATE public.profiles
SET customer_id = '22222222-2222-2222-2222-222222222201'
WHERE email = 'customer2@equipmentiq-demo.test';
