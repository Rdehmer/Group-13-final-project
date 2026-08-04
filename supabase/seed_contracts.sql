-- Seed contracts
INSERT INTO public.service_contracts (id, customer_id, name, contract_type, start_date, end_date, renewal_option, billing_method, contract_price, payment_terms, included_service_visits, service_frequency, included_labor_hours, included_replacement_parts, emergency_response_commitment, warranty_terms, cancellation_terms, approval_requirements, status, notes) VALUES
('33333333-3333-3333-3333-333333333301','11111111-1111-1111-1111-111111111101','Northwind PM Gold','Preventive Maintenance','2026-01-01','2026-12-31','Auto-renew','Monthly Recurring Charge',24000,'Net 30',12,'Monthly',48,1500,'4-hour emergency response','OEM parts warranty pass-through','30-day notice','Manager approval for extras','Active','Profitable baseline'),
('33333333-3333-3333-3333-333333333302','11111111-1111-1111-1111-111111111102','Cascade Full Service','Full-Service Maintenance','2026-01-01','2026-12-31','Manual renew','Annual Fixed Fee',18000,'Net 15',8,'Quarterly',40,2000,'Next business day','Includes wear parts','60-day notice','Customer approval >$500','Active',NULL),
('33333333-3333-3333-3333-333333333303','11111111-1111-1111-1111-111111111103','Pacific Emergency Plan','Emergency Repair Plan','2025-07-01','2026-06-30','Manual renew','Per-Service Charge',6000,'Net 30',0,'As needed',0,0,'2-hour response','Labor not warranty','30-day notice','Manager approval','Active','Unprofitable - high call volume'),
('33333333-3333-3333-3333-333333333304','11111111-1111-1111-1111-111111111105','Evergreen Cooler Care','Preventive Maintenance','2026-01-01','2026-12-31','Auto-renew','Monthly Recurring Charge',9600,'Net 30',12,'Monthly',24,800,'8-hour response','Parts warranty 90 days','30-day notice','Manager approval','Active',NULL),
('33333333-3333-3333-3333-333333333305','11111111-1111-1111-1111-111111111106','Summit Uptime SLA','Full-Service Maintenance','2026-01-01','2026-12-31','Auto-renew','Monthly Recurring Charge',48000,'Net 30',24,'Bi-weekly',120,5000,'1-hour critical response','Priority parts','90-day notice','Dual approval','Active','Critical customer'),
('33333333-3333-3333-3333-333333333306','11111111-1111-1111-1111-111111111107','Riverbend T&M','Time and Materials','2026-01-01','2026-12-31','None','Time and Materials',0,'Due on Receipt',0,'As needed',0,0,'Same-day if available','None','Immediate','Customer approval required','Active',NULL),
('33333333-3333-3333-3333-333333333307','11111111-1111-1111-1111-111111111109','Metro Fleet Care','Custom Service Agreement','2025-01-01','2025-12-31','Renewed as new contract','Annual Fixed Fee',22000,'Net 60',10,'Monthly',60,2500,'4-hour','Standard','30-day','Manager','Expired','Expired agreement edge case'),
('33333333-3333-3333-3333-333333333308','11111111-1111-1111-1111-111111111109','Metro Fleet Care 2026','Custom Service Agreement','2026-01-01','2026-12-31','Auto-renew','Annual Fixed Fee',24000,'Net 60',12,'Monthly',72,3000,'4-hour','Standard','30-day','Manager','Renewed','Renewed from expired'),
('33333333-3333-3333-3333-333333333309','11111111-1111-1111-1111-111111111110','Bluebird Warranty Assist','Custom Service Agreement','2026-01-01','2026-12-31','Manual','Cost Plus',12000,'Net 30',6,'Quarterly',30,0,'8-hour','OEM warranty coordination','30-day','Customer+Manager','Active','Warranty focused'),
('33333333-3333-3333-3333-333333333310','11111111-1111-1111-1111-111111111104','Harbor Draft Plan','Preventive Maintenance','2026-03-01','2027-02-28','Manual','Monthly Recurring Charge',8400,'Net 45',12,'Monthly',24,500,'Next day','Limited','30-day','Manager','Draft','Draft not active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.contract_equipment (contract_id, equipment_id) VALUES
('33333333-3333-3333-3333-333333333301','22222222-2222-2222-2222-222222222201'),
('33333333-3333-3333-3333-333333333301','22222222-2222-2222-2222-222222222202'),
('33333333-3333-3333-3333-333333333301','22222222-2222-2222-2222-222222222219'),
('33333333-3333-3333-3333-333333333302','22222222-2222-2222-2222-222222222203'),
('33333333-3333-3333-3333-333333333302','22222222-2222-2222-2222-222222222204'),
('33333333-3333-3333-3333-333333333303','22222222-2222-2222-2222-222222222205'),
('33333333-3333-3333-3333-333333333303','22222222-2222-2222-2222-222222222206'),
('33333333-3333-3333-3333-333333333304','22222222-2222-2222-2222-222222222208'),
('33333333-3333-3333-3333-333333333304','22222222-2222-2222-2222-222222222209'),
('33333333-3333-3333-3333-333333333305','22222222-2222-2222-2222-222222222210'),
('33333333-3333-3333-3333-333333333305','22222222-2222-2222-2222-222222222211'),
('33333333-3333-3333-3333-333333333306','22222222-2222-2222-2222-222222222212'),
('33333333-3333-3333-3333-333333333308','22222222-2222-2222-2222-222222222215'),
('33333333-3333-3333-3333-333333333309','22222222-2222-2222-2222-222222222217'),
('33333333-3333-3333-3333-333333333309','22222222-2222-2222-2222-222222222218')
ON CONFLICT DO NOTHING;
