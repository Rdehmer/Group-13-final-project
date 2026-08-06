-- Soft accounting / ops fields for manager equipment register
ALTER TABLE public.equipment
  ADD COLUMN IF NOT EXISTS replacement_cost numeric(12, 2),
  ADD COLUMN IF NOT EXISTS estimated_residual numeric(12, 2),
  ADD COLUMN IF NOT EXISTS retirement_note text,
  ADD COLUMN IF NOT EXISTS nameplate_path text;

COMMENT ON COLUMN public.equipment.replacement_cost IS 'Soft estimate for replacement discussions (not GAAP fixed asset).';
COMMENT ON COLUMN public.equipment.estimated_residual IS 'Soft residual value estimate for accounting discussions.';
COMMENT ON COLUMN public.equipment.retirement_note IS 'Why unit was retired / out of service for write-off discussions.';
COMMENT ON COLUMN public.equipment.nameplate_path IS 'Storage path for nameplate / serial photo.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'equipment-nameplates',
  'equipment-nameplates',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
