-- Drop [Request] prefix from portal submissions that are already active.

UPDATE public.service_contracts
SET name = trim(regexp_replace(name, '^\[Request\]\s*', ''))
WHERE name ~ '^\[Request\]'
  AND status IN ('Active', 'Renewed');
