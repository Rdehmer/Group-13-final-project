-- Monthly fee + deductible on contracts; unique monthly standing invoices per contract/period.

ALTER TABLE public.service_contracts
  ADD COLUMN IF NOT EXISTS monthly_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deductible numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.service_contracts.monthly_amount IS
  'Monthly recurring fee (typically annual contract_price / 12 for MRC).';
COMMENT ON COLUMN public.service_contracts.deductible IS
  'Customer deductible before covered work; visible before work orders.';

-- Backfill monthly amount for existing monthly recurring contracts.
UPDATE public.service_contracts
SET monthly_amount = ROUND(contract_price / 12.0, 2)
WHERE monthly_amount = 0
  AND contract_price > 0
  AND billing_method ILIKE '%monthly%';

-- One active monthly standing invoice per contract + billing period.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_contract_monthly_period_uidx
  ON public.invoices (contract_id, billing_period)
  WHERE contract_id IS NOT NULL
    AND work_order_id IS NULL
    AND billing_period IS NOT NULL
    AND recurring_service_charge > 0
    AND COALESCE(status, '') <> 'Canceled';
