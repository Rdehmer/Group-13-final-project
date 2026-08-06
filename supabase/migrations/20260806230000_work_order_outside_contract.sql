-- Allow customers to submit one-off calls outside contract coverage during the
-- 45-day post-contract-start waiting period.

alter table public.work_orders
  add column if not exists outside_contract boolean not null default false;

create or replace function check_customer_service_request_contract_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_user_role() <> 'customer'::user_role then
    return new;
  end if;

  if new.outside_contract then
    return new;
  end if;

  if exists (
    select 1
    from service_contracts sc
    where sc.customer_id = new.customer_id
      and sc.status in ('Active', 'Renewed')
      and (current_date - sc.start_date) < 45
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
    raise exception 'You cannot make a service request within 45 days of your contract start date.';
  end if;

  return new;
end;
$$;
