-- Combined one-shot for billing/tech features (safe to re-run).
-- Paste in Supabase → SQL Editor for project ACCY628-Final-Project-G13.

-- Invoice assignment
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS invoices_assigned_to_idx ON public.invoices (assigned_to);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON public.invoices (status);

-- Invoice equipment + customer PO #
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS equipment_id uuid REFERENCES public.equipment (id) ON DELETE SET NULL;
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS po_number text;
CREATE INDEX IF NOT EXISTS invoices_equipment_id_idx ON public.invoices (equipment_id);

-- Purchase orders
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text NOT NULL,
  invoice_id uuid REFERENCES public.invoices (id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES public.work_orders (id) ON DELETE SET NULL,
  vendor_name text,
  notes text,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_orders_invoice_id_idx ON public.purchase_orders (invoice_id);
CREATE INDEX IF NOT EXISTS purchase_orders_work_order_id_idx ON public.purchase_orders (work_order_id);

CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders (id) ON DELETE CASCADE,
  part_id uuid REFERENCES public.parts (id) ON DELETE SET NULL,
  part_number text,
  part_name text,
  description text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_order_lines_po_id_idx ON public.purchase_order_lines (purchase_order_id);

CREATE TABLE IF NOT EXISTS public.purchase_order_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders (id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text,
  mime_type text,
  file_size integer,
  file_data text,
  uploaded_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_order_attachments_po_id_idx ON public.purchase_order_attachments (purchase_order_id);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_orders_all_auth ON public.purchase_orders;
CREATE POLICY purchase_orders_all_auth ON public.purchase_orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS purchase_order_lines_all_auth ON public.purchase_order_lines;
CREATE POLICY purchase_order_lines_all_auth ON public.purchase_order_lines
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS purchase_order_attachments_all_auth ON public.purchase_order_attachments;
CREATE POLICY purchase_order_attachments_all_auth ON public.purchase_order_attachments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Optional storage for receipt PDFs/images (also works via file_data fallback for small files):
-- Storage → New bucket → name: po-receipts → allow authenticated uploads if desired.
