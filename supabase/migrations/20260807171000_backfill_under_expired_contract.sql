-- Flag existing work orders tied to expired/canceled/inactive contracts for billing coverage rules.

UPDATE public.work_orders wo
SET
  under_expired_contract = true,
  updated_at = now()
FROM public.service_contracts sc
WHERE wo.contract_id = sc.id
  AND coalesce(wo.under_expired_contract, false) = false
  AND lower(trim(coalesce(sc.status, ''))) NOT IN ('active', 'renewed');
