-- Company-configurable wait days before customers can request included contract service.
-- Default 45; 0 disables the lock. Trigger message uses the configured value.

alter table public.company_settings
  add column if not exists contract_service_request_wait_days integer
  not null default 45;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_settings_contract_service_request_wait_days_check'
  ) then
    alter table public.company_settings
      add constraint company_settings_contract_service_request_wait_days_check
      check (contract_service_request_wait_days >= 0);
  end if;
end $$;

comment on column public.company_settings.contract_service_request_wait_days is
  'Days after an Active/Renewed contract start_date before included customer service requests are allowed. 0 disables the lock.';

create or replace function check_customer_service_request_contract_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wait_days integer;
begin
  if app_user_role() <> 'customer'::user_role then
    return new;
  end if;

  if new.outside_contract then
    return new;
  end if;

  select coalesce(cs.contract_service_request_wait_days, 45)
  into wait_days
  from public.company_settings cs
  order by cs.created_at
  limit 1;

  wait_days := coalesce(wait_days, 45);

  if wait_days <= 0 then
    return new;
  end if;

  if exists (
    select 1
    from service_contracts sc
    where sc.customer_id = new.customer_id
      and sc.status in ('Active', 'Renewed')
      and (current_date - sc.start_date) < wait_days
      and (
        new.equipment_id is null
        or exists (
          select 1
          from contract_equipment ce
          where ce.contract_id = sc.id
            and ce.equipment_id = new.equipment_id
        )
      )
  ) then
    raise exception
      'You cannot make a service request within % days of your contract start date.',
      wait_days;
  end if;

  return new;
end;
$$;
