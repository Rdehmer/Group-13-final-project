-- Purchase orders, part lines, receipt files; customer PO # on invoices.
-- Run in Supabase SQL Editor if tables/columns are missing.
-- Optional: create a Storage bucket named "po-receipts" (public or authenticated read) for file uploads.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS po_number text;

COMMENT ON COLUMN public.invoices.po_number IS 'Customer or field purchase order number shown on the invoice';

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
CREATE INDEX IF NOT EXISTS purchase_orders_po_number_idx ON public.purchase_orders (po_number);

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
  -- Demo fallback when Storage bucket is not configured (small receipt images only)
  file_data text,
  uploaded_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchase_order_attachments_po_id_idx ON public.purchase_order_attachments (purchase_order_id);

-- Allow authenticated demo users (match other app tables if RLS is enabled elsewhere).
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
