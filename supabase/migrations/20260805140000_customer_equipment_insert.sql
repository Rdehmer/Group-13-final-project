-- Allow customers to register their own equipment
CREATE POLICY equipment_customer_insert ON public.equipment
FOR INSERT
TO authenticated
WITH CHECK (
  app_user_role() = 'customer'::user_role
  AND customer_id = my_customer_id()
  AND my_customer_id() IS NOT NULL
);
