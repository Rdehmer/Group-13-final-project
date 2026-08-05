-- Block customer service requests within 45 days of an active contract start date.

CREATE OR REPLACE FUNCTION check_customer_service_request_contract_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF app_user_role() <> 'customer'::user_role THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM service_contracts sc
    WHERE sc.customer_id = NEW.customer_id
      AND sc.status IN ('Active', 'Renewed')
      AND (CURRENT_DATE - sc.start_date) < 45
      AND (
        NEW.equipment_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM contract_equipment ce
          WHERE ce.contract_id = sc.id
            AND ce.equipment_id = NEW.equipment_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'You cannot make a service request within 45 days of your contract start date.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_orders_customer_contract_window ON public.work_orders;

CREATE TRIGGER work_orders_customer_contract_window
  BEFORE INSERT ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION check_customer_service_request_contract_window();
