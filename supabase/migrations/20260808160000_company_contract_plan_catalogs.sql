-- Multi-company contract plan catalogs (1A) with dynamic JSON structure (2B).
-- Seed content is cloned per company via app bootstrap (buildSeedCatalog).

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.companies (id, name, slug)
values ('00000000-0000-4000-8000-000000000001', 'Default Company', 'default')
on conflict (id) do nothing;

alter table public.profiles
  add column if not exists company_id uuid references public.companies (id) on delete set null;

alter table public.customers
  add column if not exists company_id uuid references public.companies (id) on delete set null;

update public.profiles
set company_id = '00000000-0000-4000-8000-000000000001'
where company_id is null;

update public.customers
set company_id = '00000000-0000-4000-8000-000000000001'
where company_id is null;

create table if not exists public.company_contract_plan_catalogs (
  company_id uuid primary key references public.companies (id) on delete cascade,
  catalog jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create index if not exists company_contract_plan_catalogs_updated_at_idx
  on public.company_contract_plan_catalogs (updated_at desc);

create or replace function public.current_profile_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select company_id from public.profiles where id = auth.uid()),
    (
      select c.company_id
      from public.profiles p
      join public.customers c on c.id = p.customer_id
      where p.id = auth.uid()
    )
  );
$$;

create or replace function public.is_staff_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in (
        'administrator'::user_role,
        'service_manager'::user_role,
        'billing'::user_role,
        'technician'::user_role
      )
  );
$$;

alter table public.companies enable row level security;
alter table public.company_contract_plan_catalogs enable row level security;

drop policy if exists companies_select_own on public.companies;
create policy companies_select_own
  on public.companies for select
  to authenticated
  using (
    id = public.current_profile_company_id()
    or public.is_staff_role()
  );

drop policy if exists companies_admin_update on public.companies;
create policy companies_admin_update
  on public.companies for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'administrator'::user_role
        and p.company_id = companies.id
    )
  );

drop policy if exists companies_admin_insert on public.companies;
create policy companies_admin_insert
  on public.companies for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'administrator'::user_role
    )
  );

drop policy if exists catalog_select_company on public.company_contract_plan_catalogs;
create policy catalog_select_company
  on public.company_contract_plan_catalogs for select
  to authenticated
  using (company_id = public.current_profile_company_id());

drop policy if exists catalog_upsert_admin on public.company_contract_plan_catalogs;
create policy catalog_upsert_admin
  on public.company_contract_plan_catalogs for insert
  to authenticated
  with check (
    company_id = public.current_profile_company_id()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator'::user_role, 'service_manager'::user_role)
    )
  );

drop policy if exists catalog_update_admin on public.company_contract_plan_catalogs;
create policy catalog_update_admin
  on public.company_contract_plan_catalogs for update
  to authenticated
  using (
    company_id = public.current_profile_company_id()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator'::user_role, 'service_manager'::user_role)
    )
  );

drop policy if exists catalog_delete_admin on public.company_contract_plan_catalogs;
create policy catalog_delete_admin
  on public.company_contract_plan_catalogs for delete
  to authenticated
  using (
    company_id = public.current_profile_company_id()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'administrator'::user_role
    )
  );

create or replace function public.ensure_company_contract_catalog(p_company_id uuid, p_catalog jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing jsonb;
begin
  if p_company_id is null then
    raise exception 'company_id required';
  end if;

  select catalog into existing
  from public.company_contract_plan_catalogs
  where company_id = p_company_id;

  if existing is not null then
    return existing;
  end if;

  insert into public.company_contract_plan_catalogs (company_id, catalog, version, updated_at)
  values (
    p_company_id,
    p_catalog,
    coalesce((p_catalog->>'version')::int, 1),
    now()
  )
  on conflict (company_id) do nothing;

  select catalog into existing
  from public.company_contract_plan_catalogs
  where company_id = p_company_id;

  return existing;
end;
$$;

grant execute on function public.ensure_company_contract_catalog(uuid, jsonb) to authenticated;
