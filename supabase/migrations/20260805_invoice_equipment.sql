-- Link invoices to the equipment unit serviced (model / serial tracked on equipment).
-- Run in Supabase SQL editor if equipment_id is missing on invoices.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS equipment_id uuid REFERENCES public.equipment (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invoices_equipment_id_idx ON public.invoices (equipment_id);

COMMENT ON COLUMN public.invoices.equipment_id IS 'Equipment unit worked on for this invoice (model, serial, install date on equipment row)';
