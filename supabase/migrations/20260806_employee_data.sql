-- Employee HR-lite fields + ServiceTitan-style module permission overrides
-- Safe to re-run.

alter table public.profiles
  add column if not exists job_title text;

alter table public.profiles
  add column if not exists phone text;

alter table public.profiles
  add column if not exists employee_number text;

alter table public.profiles
  add column if not exists permission_overrides jsonb not null default '{}'::jsonb;

comment on column public.profiles.job_title is
  'Employee job title / position (settings → Employees).';
comment on column public.profiles.phone is
  'Employee phone for dispatch and HR contact.';
comment on column public.profiles.employee_number is
  'Optional company employee number / badge id.';
comment on column public.profiles.permission_overrides is
  'JSON map of module_key → boolean grant/deny on top of role template.';

create index if not exists profiles_employee_number_idx
  on public.profiles (employee_number)
  where employee_number is not null;
