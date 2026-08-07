-- Block new work orders / service requests when a customer's monthly recurring
-- contract fee invoice is past due (after configurable grace days).
-- Managers configure grace days and can disable the lock under Admin Settings.

alter table public.company_settings
  add column if not exists delinquency_service_request_grace_days integer
  not null default 0;

alter table public.company_settings
  add column if not exists delinquency_service_request_lock_enabled boolean
  not null default true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_settings_delinquency_grace_days_check'
  ) then
    alter table public.company_settings
      add constraint company_settings_delinquency_grace_days_check
      check (delinquency_service_request_grace_days >= 0);
  end if;
end $$;

comment on column public.company_settings.delinquency_service_request_grace_days is
  'Days after a monthly recurring contract invoice due_date before service requests are blocked. 0 = lock as soon as past due.';

comment on column public.company_settings.delinquency_service_request_lock_enabled is
  'When true, past-due monthly contract fees block new work orders / service requests for that customer.';

-- Shared detection helper (security definer for trigger + optional RPC use).
create or replace function public.customer_has_delinquent_monthly_contract(
  p_customer_id uuid,
  p_grace_days integer default 0,
  p_as_of date default current_date
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.invoices i
    join public.service_contracts sc on sc.id = i.contract_id
    where sc.customer_id = p_customer_id
      and sc.status in ('Active', 'Renewed')
      and sc.billing_method ilike '%monthly%recurring%'
      and i.work_order_id is null
      and coalesce(i.recurring_service_charge, 0) > 0
      and coalesce(i.remaining_balance, 0) > 0.005
      and i.due_date is not null
      and (p_as_of - i.due_date) > greatest(coalesce(p_grace_days, 0), 0)
      and lower(coalesce(i.status, '')) not like '%canceled%'
      and lower(coalesce(i.status, '')) not like '%void%'
      and lower(coalesce(i.status, '')) not like '%credit%'
      and lower(coalesce(i.status, '')) not like '%draft%'
      and lower(coalesce(i.status, '')) not like '%needs review%'
      and lower(coalesce(i.status, '')) not like '%on hold%'
      and lower(coalesce(i.status, '')) <> 'reviewed'
  );
$$;

comment on function public.customer_has_delinquent_monthly_contract(uuid, integer, date) is
  'True when the customer has an unpaid monthly standing invoice past due_date + grace days on an Active/Renewed MRC contract.';

revoke all on function public.customer_has_delinquent_monthly_contract(uuid, integer, date) from public;
grant execute on function public.customer_has_delinquent_monthly_contract(uuid, integer, date) to authenticated;

create or replace function public.check_customer_service_request_delinquency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lock_enabled boolean;
  grace_days integer;
begin
  if new.customer_id is null then
    return new;
  end if;

  select
    coalesce(cs.delinquency_service_request_lock_enabled, true),
    coalesce(cs.delinquency_service_request_grace_days, 0)
  into lock_enabled, grace_days
  from public.company_settings cs
  order by cs.created_at
  limit 1;

  lock_enabled := coalesce(lock_enabled, true);
  grace_days := coalesce(grace_days, 0);

  if not lock_enabled then
    return new;
  end if;

  if public.customer_has_delinquent_monthly_contract(new.customer_id, grace_days, current_date) then
    raise exception
      'Service requests are locked because this customer has a past-due monthly contract payment. Collect payment or adjust delinquency settings before filing a new request.';
  end if;

  return new;
end;
$$;

drop trigger if exists work_orders_customer_delinquency_lock on public.work_orders;

create trigger work_orders_customer_delinquency_lock
  before insert on public.work_orders
  for each row
  execute function public.check_customer_service_request_delinquency();
