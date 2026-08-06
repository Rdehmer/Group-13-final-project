-- Allow billing (and admin via is_billing) to mark work orders billed after invoicing.
-- Previously only managers could UPDATE work_orders, so createInvoice silently left billing_status = Unbilled.
create policy wo_billing_update_status
on public.work_orders
for update
to authenticated
using (public.is_billing())
with check (public.is_billing());
