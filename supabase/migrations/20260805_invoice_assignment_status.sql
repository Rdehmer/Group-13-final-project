-- Invoice assignment + ensure workflow statuses can be stored as free text (existing status column).
-- Run this in the Supabase SQL editor if assigned_to is missing.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invoices_assigned_to_idx ON public.invoices (assigned_to);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON public.invoices (status);

COMMENT ON COLUMN public.invoices.assigned_to IS 'Team member (profiles.id) responsible for working this invoice';
COMMENT ON COLUMN public.invoices.status IS 'Workflow / AR status: Draft, Needs Review, Reviewed, On Hold, Sent, Partially Paid, Paid, Disputed, Canceled';
