-- Operational controls: active contracts for dispatch, invoice duplicate + AWR gates.

-- ---------------------------------------------------------------------------
-- 1) One active invoice per work order (exclude void/canceled/credit)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS invoices_work_order_active_uidx
  ON public.invoices (work_order_id)
  WHERE work_order_id IS NOT NULL
    AND lower(trim(coalesce(status, ''))) NOT IN (
      'canceled', 'cancelled', 'void', 'credit memo', 'credit'
    );

COMMENT ON INDEX public.invoices_work_order_active_uidx IS
  'Prevents duplicate billing for the same service order.';

-- ---------------------------------------------------------------------------
-- 2) Block work orders linked to expired / canceled / inactive contracts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_work_order_contract_dispatchable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_name text;
BEGIN
  IF NEW.contract_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sc.status, sc.name
  INTO v_status, v_name
  FROM public.service_contracts sc
  WHERE sc.id = NEW.contract_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTRACT_DISPATCH_BLOCKED: Contract not found for work order.';
  END IF;

  IF lower(trim(coalesce(v_status, ''))) NOT IN ('active', 'renewed') THEN
    RAISE EXCEPTION
      'CONTRACT_DISPATCH_BLOCKED: Contract "%" is % — dispatch and new work under this agreement are blocked.',
      coalesce(v_name, NEW.contract_id::text),
      coalesce(v_status, 'inactive');
  END IF;

  NEW.under_expired_contract := false;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_work_orders_contract_dispatch ON public.work_orders;

CREATE TRIGGER trg_work_orders_contract_dispatch
  BEFORE INSERT OR UPDATE OF contract_id
  ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.check_work_order_contract_dispatchable();

-- ---------------------------------------------------------------------------
-- 3) Block invoices when pending scope-change (AWR) or job already billed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_invoice_work_order_controls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending_awr integer;
  v_billing_status text;
BEGIN
  IF NEW.work_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT billing_status
  INTO v_billing_status
  FROM public.work_orders
  WHERE id = NEW.work_order_id;

  IF v_billing_status = 'Billed' THEN
    RAISE EXCEPTION 'INVOICE_BLOCKED: Work order is already billed — duplicate invoices are not allowed.';
  END IF;

  SELECT count(*)::integer
  INTO v_pending_awr
  FROM public.additional_work_requests awr
  WHERE awr.work_order_id = NEW.work_order_id
    AND (
      lower(trim(coalesce(awr.approval_status, ''))) IN ('pending', 'pending manager approval')
      OR (
        awr.approval_status ~* '^pending'
        AND awr.approval_status !~* 'approved|rejected'
      )
    );

  IF v_pending_awr > 0 THEN
    RAISE EXCEPTION
      'INVOICE_BLOCKED: % pending scope-change request(s) must be approved or rejected before invoicing.',
      v_pending_awr;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_work_order_controls ON public.invoices;

CREATE TRIGGER trg_invoices_work_order_controls
  BEFORE INSERT
  ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.check_invoice_work_order_controls();

-- Cleanup ad-hoc test row if present
DELETE FROM public.work_orders WHERE work_order_number = 'TEST-EXP-BLOCK';
