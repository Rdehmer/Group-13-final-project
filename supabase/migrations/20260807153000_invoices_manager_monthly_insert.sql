-- Allow service managers to create monthly contract fee (standing) invoices.
-- Billing/admin already have full invoice access via invoices_billing; managers
-- only had SELECT (invoices_manager_read) which blocked "Generate monthly fees".

CREATE POLICY invoices_manager_insert_monthly ON public.invoices
  FOR INSERT
  TO authenticated
  WITH CHECK (
    is_manager()
    AND work_order_id IS NULL
    AND contract_id IS NOT NULL
    AND coalesce(recurring_service_charge, 0) > 0
  );

COMMENT ON POLICY invoices_manager_insert_monthly ON public.invoices IS
  'Service managers and admins may insert monthly recurring contract fee invoices (no work order).';
