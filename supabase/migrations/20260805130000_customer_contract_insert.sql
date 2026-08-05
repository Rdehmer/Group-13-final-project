-- Allow customers to submit contract requests (Pending Approval only)
CREATE POLICY contracts_customer_insert ON public.service_contracts
FOR INSERT
TO authenticated
WITH CHECK (
  app_user_role() = 'customer'::user_role
  AND customer_id = my_customer_id()
  AND my_customer_id() IS NOT NULL
  AND status = 'Pending Approval'
  AND contract_price = 0
);

CREATE POLICY ce_customer_insert ON public.contract_equipment
FOR INSERT
TO authenticated
WITH CHECK (
  app_user_role() = 'customer'::user_role
  AND EXISTS (
    SELECT 1 FROM public.service_contracts sc
    WHERE sc.id = contract_equipment.contract_id
      AND sc.customer_id = my_customer_id()
      AND sc.status = 'Pending Approval'
  )
  AND EXISTS (
    SELECT 1 FROM public.equipment e
    WHERE e.id = contract_equipment.equipment_id
      AND e.customer_id = my_customer_id()
  )
);
