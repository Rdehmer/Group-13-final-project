-- Assign work orders to portal vendors (profiles.vendor_id) and let vendors run field job flow.

alter table public.work_orders
  add column if not exists assigned_vendor_id uuid
    references public.vendors (id) on delete set null;

create index if not exists work_orders_assigned_vendor_id_idx
  on public.work_orders (assigned_vendor_id)
  where assigned_vendor_id is not null;

comment on column public.work_orders.assigned_vendor_id is
  'Portal vendor (vendors.id) assigned to perform this job instead of an in-house technician.';

-- Mutual exclusivity: tech XOR portal vendor
create or replace function public.work_orders_clear_conflicting_assignee()
returns trigger
language plpgsql
as $$
begin
  if new.assigned_vendor_id is not null and new.assigned_technician_id is not null then
    if tg_op = 'UPDATE' and new.assigned_vendor_id is distinct from old.assigned_vendor_id then
      new.assigned_technician_id := null;
    elsif tg_op = 'UPDATE' and new.assigned_technician_id is distinct from old.assigned_technician_id then
      new.assigned_vendor_id := null;
    elsif tg_op = 'INSERT' then
      -- Prefer vendor when both set on insert
      new.assigned_technician_id := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists work_orders_clear_conflicting_assignee on public.work_orders;
create trigger work_orders_clear_conflicting_assignee
  before insert or update of assigned_technician_id, assigned_vendor_id
  on public.work_orders
  for each row
  execute function public.work_orders_clear_conflicting_assignee();

-- Work orders: vendor select/update
drop policy if exists wo_vendor_select on public.work_orders;
create policy wo_vendor_select on public.work_orders
  for select to authenticated
  using (
    app_user_role() = 'vendor'::user_role
    and assigned_vendor_id is not null
    and assigned_vendor_id = app_user_vendor_id()
  );

drop policy if exists wo_vendor_update on public.work_orders;
create policy wo_vendor_update on public.work_orders
  for update to authenticated
  using (
    app_user_role() = 'vendor'::user_role
    and assigned_vendor_id is not null
    and assigned_vendor_id = app_user_vendor_id()
    and status <> all (array['Completed'::text, 'Closed'::text, 'Canceled'::text])
  )
  with check (
    app_user_role() = 'vendor'::user_role
    and assigned_vendor_id is not null
    and assigned_vendor_id = app_user_vendor_id()
  );

-- Customers / equipment readable for assigned vendor jobs
drop policy if exists customers_vendor_read on public.customers;
create policy customers_vendor_read on public.customers
  for select to authenticated
  using (
    app_user_role() = 'vendor'::user_role
    and exists (
      select 1 from public.work_orders wo
      where wo.customer_id = customers.id
        and wo.assigned_vendor_id = app_user_vendor_id()
    )
  );

drop policy if exists equipment_vendor_read on public.equipment;
create policy equipment_vendor_read on public.equipment
  for select to authenticated
  using (
    app_user_role() = 'vendor'::user_role
    and exists (
      select 1 from public.work_orders wo
      where wo.equipment_id = equipment.id
        and wo.assigned_vendor_id = app_user_vendor_id()
    )
  );

-- Parts catalog read for vendors on assigned jobs (same catalog techs use)
drop policy if exists parts_vendor_read on public.parts;
create policy parts_vendor_read on public.parts
  for select to authenticated
  using (app_user_role() = 'vendor'::user_role);

-- Work order parts for vendors
drop policy if exists wop_vendor on public.work_order_parts;
create policy wop_vendor on public.work_order_parts
  for all to authenticated
  using (
    app_user_role() = 'vendor'::user_role
    and exists (
      select 1 from public.work_orders wo
      where wo.id = work_order_parts.work_order_id
        and wo.assigned_vendor_id = app_user_vendor_id()
    )
  )
  with check (
    app_user_role() = 'vendor'::user_role
    and exists (
      select 1 from public.work_orders wo
      where wo.id = work_order_parts.work_order_id
        and wo.assigned_vendor_id = app_user_vendor_id()
        and wo.status <> all (array['Completed'::text, 'Closed'::text, 'Canceled'::text])
    )
  );

-- Labor rows logged by the vendor user against their assigned jobs
drop policy if exists labor_vendor on public.technician_labor;
create policy labor_vendor on public.technician_labor
  for all to authenticated
  using (
    app_user_role() = 'vendor'::user_role
    and technician_id = auth.uid()
    and exists (
      select 1 from public.work_orders wo
      where wo.id = technician_labor.work_order_id
        and wo.assigned_vendor_id = app_user_vendor_id()
    )
  )
  with check (
    app_user_role() = 'vendor'::user_role
    and technician_id = auth.uid()
    and exists (
      select 1 from public.work_orders wo
      where wo.id = technician_labor.work_order_id
        and wo.assigned_vendor_id = app_user_vendor_id()
        and wo.status <> all (array['Completed'::text, 'Closed'::text, 'Canceled'::text])
    )
  );

-- Time entries: allow vendor self-entries (manual billable hours; no day clock)
drop policy if exists time_entries_insert on public.time_entries;
create policy time_entries_insert on public.time_entries
  for insert to authenticated
  with check (
    (
      technician_id = auth.uid()
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role in ('technician', 'administrator', 'service_manager', 'vendor')
      )
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('administrator', 'service_manager')
    )
  );

-- Completion proofs: assignee is tech OR portal vendor on the job
drop policy if exists completion_proofs_select on public.work_order_completion_proofs;
create policy completion_proofs_select
on public.work_order_completion_proofs
for select to authenticated
using (
  (select is_manager())
  or exists (
    select 1 from public.work_orders
    where work_orders.id = work_order_completion_proofs.job_id
      and (
        work_orders.assigned_technician_id = (select auth.uid())
        or (
          app_user_role() = 'vendor'::user_role
          and work_orders.assigned_vendor_id = app_user_vendor_id()
        )
      )
  )
);

drop policy if exists completion_proofs_insert on public.work_order_completion_proofs;
create policy completion_proofs_insert
on public.work_order_completion_proofs
for insert to authenticated
with check (
  technician_id = (select auth.uid())
  and type = any (array['photo'::text, 'signature'::text])
  and exists (
    select 1 from public.work_orders
    where work_orders.id = work_order_completion_proofs.job_id
      and work_orders.status <> all (array['Completed'::text, 'Closed'::text, 'Canceled'::text])
      and (
        work_orders.assigned_technician_id = (select auth.uid())
        or (
          app_user_role() = 'vendor'::user_role
          and work_orders.assigned_vendor_id = app_user_vendor_id()
        )
      )
  )
);

drop policy if exists completion_proofs_delete on public.work_order_completion_proofs;
create policy completion_proofs_delete
on public.work_order_completion_proofs
for delete to authenticated
using (
  technician_id = (select auth.uid())
  and exists (
    select 1 from public.work_orders
    where work_orders.id = work_order_completion_proofs.job_id
      and work_orders.status <> all (array['Completed'::text, 'Closed'::text, 'Canceled'::text])
      and (
        work_orders.assigned_technician_id = (select auth.uid())
        or (
          app_user_role() = 'vendor'::user_role
          and work_orders.assigned_vendor_id = app_user_vendor_id()
        )
      )
  )
);

-- Storage proofs: allow vendor folder uploads when assigned to the job
drop policy if exists completion_proof_files_insert on storage.objects;
create policy completion_proof_files_insert
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'job-completion-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.work_orders
    where work_orders.id::text = (storage.foldername(name))[2]
      and work_orders.status <> all (array['Completed'::text, 'Closed'::text, 'Canceled'::text])
      and (
        work_orders.assigned_technician_id = (select auth.uid())
        or (
          app_user_role() = 'vendor'::user_role
          and work_orders.assigned_vendor_id = app_user_vendor_id()
        )
      )
  )
);

drop policy if exists completion_proof_files_select on storage.objects;
create policy completion_proof_files_select
on storage.objects
for select to authenticated
using (
  bucket_id = 'job-completion-proofs'
  and (
    (select is_manager())
    or (storage.foldername(name))[1] = (select auth.uid())::text
  )
);
