-- Demo seed: service history work orders + invoices for Northwind (customer1@ridley-demo.test).
-- Idempotent — skips rows that already exist by work_order_number / invoice_number.

DO $$
DECLARE
  v_customer uuid := '11111111-1111-1111-1111-111111111101';
  v_contract uuid := 'dc2eb89b-b281-4e7e-8321-0140865ddd23';
  v_billing uuid := 'c6c79bc3-6d7d-43d5-9d91-cc22ce24fe7f';
  v_tech uuid := '4de161ef-0146-4ddf-b10e-92b421a8e269';
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.invoices
    WHERE invoice_number = 'INV-DEMO-SH-001'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE public.work_orders DISABLE TRIGGER work_orders_customer_contract_window;

  INSERT INTO public.work_orders (
    id, work_order_number, customer_id, equipment_id, contract_id,
    work_order_type, priority, assigned_technician_id,
    scheduled_date, problem_description, work_performed,
    customer_approval_required, billing_status, status, dispatch_status,
    completion_date, created_at, updated_at
  ) VALUES
  (
    'a1111111-1111-1111-1111-111111111001', 'WO-DEMO-SH-001', v_customer,
    '22222222-2222-2222-2222-222222222201', v_contract,
    'Preventive Maintenance', 'Normal', v_tech,
    '2026-01-10', 'Quarterly PM on blast freezer — check refrigerant levels and defrost cycle.',
    'Replaced worn door gasket, cleaned condenser coils, verified superheat/subcool targets.',
    false, 'Billed', 'Completed', 'Done',
    '2026-01-12', '2026-01-08 09:00:00+00', '2026-01-12 16:30:00+00'
  ),
  (
    'a1111111-1111-1111-1111-111111111002', 'WO-DEMO-SH-002', v_customer,
    '22222222-2222-2222-2222-222222222202', v_contract,
    'Emergency Repair', 'High', v_tech,
    '2026-02-18', 'Compressor rack high-head pressure alarm — walk-in cooler temp rising.',
    'Found restricted liquid line filter drier. Replaced drier, pulled vacuum, recharged R-404A.',
    false, 'Billed', 'Completed', 'Done',
    '2026-02-19', '2026-02-17 14:00:00+00', '2026-02-19 11:00:00+00'
  ),
  (
    'a1111111-1111-1111-1111-111111111003', 'WO-DEMO-SH-003', v_customer,
    '2a7919e6-aebe-4c75-9c97-76d9f86b9558', NULL,
    'Repair', 'Normal', v_tech,
    '2026-03-05', 'Forklift mast drift and hydraulic leak at lift cylinder.',
    'Replaced lift cylinder seal kit, adjusted mast chains, load-tested to 4,500 lb.',
    false, 'Billed', 'Closed', 'Done',
    '2026-03-06', '2026-03-04 08:30:00+00', '2026-03-06 15:45:00+00'
  ),
  (
    'a1111111-1111-1111-1111-111111111004', 'WO-DEMO-SH-004', v_customer,
    '22222222-2222-2222-2222-222222222219', v_contract,
    'Follow-Up Service', 'Normal', v_tech,
    '2026-04-22', 'Re-check evaporator coil 4 after prior ice buildup service.',
    'Confirmed even frost pattern, adjusted TXV superheat, cleaned drain pan.',
    false, 'Billed', 'Completed', 'Done',
    '2026-04-23', '2026-04-21 10:00:00+00', '2026-04-23 13:20:00+00'
  ),
  (
    'a1111111-1111-1111-1111-111111111005', 'WO-DEMO-SH-005', v_customer,
    '22222222-2222-2222-2222-222222222201', v_contract,
    'Inspection', 'Low', v_tech,
    '2026-05-14', 'Annual safety and compliance inspection — blast freezer A.',
    'Completed visual inspection, leak check, and electrical safety test. No deficiencies noted.',
    false, 'Unbilled', 'Completed', 'Done',
    '2026-05-15', '2026-05-13 07:00:00+00', '2026-05-15 12:00:00+00'
  )
  ON CONFLICT (work_order_number) DO NOTHING;

  INSERT INTO public.invoices (
    id, invoice_number, customer_id, contract_id, work_order_id, equipment_id,
    invoice_date, due_date, billing_period,
    labor_charges, parts_charges, recurring_service_charge, additional_charges,
    warranty_deductions, discounts, tax, invoice_total, amount_paid, remaining_balance,
    status, notes, created_by, assigned_to, created_at, updated_at
  ) VALUES
  (
    'b1111111-1111-1111-1111-111111111001', 'INV-DEMO-SH-001', v_customer, v_contract,
    'a1111111-1111-1111-1111-111111111001', '22222222-2222-2222-2222-222222222201',
    '2026-01-12', '2026-02-11', 'Jan 2026',
    320.00, 185.00, 0, 0, 0, 0, 42.08, 547.08, 547.08, 0,
    'Paid', 'Paid in full via ACH — thank you.', v_billing, v_billing,
    '2026-01-12 17:00:00+00', '2026-01-20 10:00:00+00'
  ),
  (
    'b1111111-1111-1111-1111-111111111002', 'INV-DEMO-SH-002', v_customer, v_contract,
    'a1111111-1111-1111-1111-111111111002', '22222222-2222-2222-2222-222222222202',
    '2026-02-19', '2026-03-21', 'Feb 2026',
    890.00, 312.50, 0, 0, 0, 0, 96.03, 1298.53, 0, 1298.53,
    'Sent', 'Emergency repair — compressor rack 1.', v_billing, v_billing,
    '2026-02-19 12:00:00+00', '2026-02-19 12:00:00+00'
  ),
  (
    'b1111111-1111-1111-1111-111111111003', 'INV-DEMO-SH-003', v_customer, NULL,
    'a1111111-1111-1111-1111-111111111003', '2a7919e6-aebe-4c75-9c97-76d9f86b9558',
    '2026-03-06', '2026-04-05', 'Mar 2026',
    450.00, 220.00, 0, 0, 0, 0, 53.55, 723.55, 300.00, 423.55,
    'Partially Paid', 'One-off repair — forklift hydraulic service.', v_billing, v_billing,
    '2026-03-06 16:00:00+00', '2026-03-15 09:00:00+00'
  ),
  (
    'b1111111-1111-1111-1111-111111111004', 'INV-DEMO-SH-004', v_customer, v_contract,
    'a1111111-1111-1111-1111-111111111004', '22222222-2222-2222-2222-222222222219',
    '2026-04-23', '2026-05-23', 'Apr 2026',
    275.00, 98.00, 0, 0, 0, 0, 29.82, 402.82, 0, 402.82,
    'Past Due', 'Follow-up visit — evaporator coil 4.', v_billing, v_billing,
    '2026-04-23 14:00:00+00', '2026-04-23 14:00:00+00'
  )
  ON CONFLICT (invoice_number) DO NOTHING;

  ALTER TABLE public.work_orders ENABLE TRIGGER work_orders_customer_contract_window;
END $$;
