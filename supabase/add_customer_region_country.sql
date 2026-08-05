-- Run in Supabase SQL editor if region/country inserts fail.
alter table public.customers
  add column if not exists region text,
  add column if not exists country text;
