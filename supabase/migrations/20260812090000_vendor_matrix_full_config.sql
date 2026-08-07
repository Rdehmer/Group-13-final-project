-- Full admin customization for vendor preference matrix (labels, toggles, prune rules).
alter table public.company_settings
  add column if not exists vendor_matrix_config jsonb not null default '{}'::jsonb;

comment on column public.company_settings.vendor_matrix_config is
  'Admin-customizable vendor matrix scorecard: metric labels, enable flags, prune rules, copy.';
