alter table public.work_orders
add column completion_proof_requirement text not null default 'photo_or_signature';

alter table public.work_orders
add constraint work_orders_completion_proof_requirement_check
check (completion_proof_requirement in ('photo_or_signature', 'photo', 'signature', 'both'));

create table public.work_order_completion_proofs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.work_orders(id) on delete cascade,
  type text not null check (type in ('photo', 'signature')),
  file_url text,
  base64_data text,
  captured_at timestamptz not null default now(),
  technician_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint work_order_completion_proofs_payload_check check (
    (type = 'photo' and nullif(btrim(file_url), '') is not null and base64_data is null)
    or
    (type = 'signature' and nullif(btrim(base64_data), '') is not null and file_url is null)
  )
);

create index work_order_completion_proofs_job_id_idx
on public.work_order_completion_proofs(job_id);

alter table public.work_order_completion_proofs enable row level security;

create policy completion_proofs_select
on public.work_order_completion_proofs
for select
to authenticated
using (
  public.is_manager()
  or exists (
    select 1
    from public.work_orders
    where work_orders.id = work_order_completion_proofs.job_id
      and work_orders.assigned_technician_id = auth.uid()
  )
);

create policy completion_proofs_insert
on public.work_order_completion_proofs
for insert
to authenticated
with check (
  technician_id = auth.uid()
  and type in ('photo', 'signature')
  and exists (
    select 1
    from public.work_orders
    where work_orders.id = work_order_completion_proofs.job_id
      and work_orders.assigned_technician_id = auth.uid()
      and work_orders.status not in ('Completed', 'Closed', 'Canceled')
  )
);

create policy completion_proofs_delete
on public.work_order_completion_proofs
for delete
to authenticated
using (
  technician_id = auth.uid()
  and exists (
    select 1
    from public.work_orders
    where work_orders.id = work_order_completion_proofs.job_id
      and work_orders.assigned_technician_id = auth.uid()
      and work_orders.status not in ('Completed', 'Closed', 'Canceled')
  )
);

grant select, insert, delete on public.work_order_completion_proofs to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-completion-proofs',
  'job-completion-proofs',
  false,
  1048576,
  array['image/jpeg', 'image/png']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy completion_proof_files_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'job-completion-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1
    from public.work_orders
    where work_orders.id::text = (storage.foldername(name))[2]
      and work_orders.assigned_technician_id = auth.uid()
      and work_orders.status not in ('Completed', 'Closed', 'Canceled')
  )
);

create policy completion_proof_files_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'job-completion-proofs'
  and (
    public.is_manager()
    or (
      (storage.foldername(name))[1] = auth.uid()::text
      and exists (
        select 1
        from public.work_orders
        where work_orders.id::text = (storage.foldername(name))[2]
          and work_orders.assigned_technician_id = auth.uid()
      )
    )
  )
);

create policy completion_proof_files_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'job-completion-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1
    from public.work_orders
    where work_orders.id::text = (storage.foldername(name))[2]
      and work_orders.assigned_technician_id = auth.uid()
      and work_orders.status not in ('Completed', 'Closed', 'Canceled')
  )
);

create or replace function private.completion_proof_satisfied(
  p_job_id uuid,
  p_requirement text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_requirement
    when 'photo' then exists (
      select 1
      from public.work_order_completion_proofs
      where job_id = p_job_id
        and type = 'photo'
        and nullif(btrim(file_url), '') is not null
    )
    when 'signature' then exists (
      select 1
      from public.work_order_completion_proofs
      where job_id = p_job_id
        and type = 'signature'
        and base64_data like 'data:image/png;base64,%'
        and length(base64_data) > 1000
    )
    when 'both' then
      exists (
        select 1
        from public.work_order_completion_proofs
        where job_id = p_job_id
          and type = 'photo'
          and nullif(btrim(file_url), '') is not null
      )
      and exists (
        select 1
        from public.work_order_completion_proofs
        where job_id = p_job_id
          and type = 'signature'
          and base64_data like 'data:image/png;base64,%'
          and length(base64_data) > 1000
      )
    else
      exists (
        select 1
        from public.work_order_completion_proofs
        where job_id = p_job_id
          and (
            (type = 'photo' and nullif(btrim(file_url), '') is not null)
            or
            (
              type = 'signature'
              and base64_data like 'data:image/png;base64,%'
              and length(base64_data) > 1000
            )
          )
      )
  end;
$$;

revoke all on function private.completion_proof_satisfied(uuid, text)
from public, anon, authenticated;

create or replace function private.enforce_work_order_completion_proof()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'Completed'
    and old.status is distinct from 'Completed'
    and not private.completion_proof_satisfied(new.id, new.completion_proof_requirement)
  then
    raise exception 'Photo or signature required to complete this job.';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_work_order_completion_proof()
from public, anon, authenticated;

create trigger enforce_work_order_completion_proof
before update of status on public.work_orders
for each row
execute function private.enforce_work_order_completion_proof();

create or replace function private.complete_technician_work_order(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_work_order public.work_orders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_work_order
  from public.work_orders
  where id = p_job_id
    and assigned_technician_id = auth.uid()
    and status not in ('Completed', 'Closed', 'Canceled')
  for update;

  if not found then
    raise exception 'Work order is not available for completion';
  end if;

  if not private.completion_proof_satisfied(
    v_work_order.id,
    v_work_order.completion_proof_requirement
  ) then
    raise exception 'Photo or signature required to complete this job.';
  end if;

  update public.work_orders
  set
    status = 'Completed',
    dispatch_status = 'Done',
    dispatch_updated_at = now(),
    completion_date = current_date,
    updated_at = now()
  where id = p_job_id;
end;
$$;

revoke all on function private.complete_technician_work_order(uuid)
from public, anon, authenticated;
grant execute on function private.complete_technician_work_order(uuid)
to authenticated;

create or replace function public.complete_technician_work_order(p_job_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.complete_technician_work_order(p_job_id);
$$;

revoke all on function public.complete_technician_work_order(uuid)
from public, anon;
grant execute on function public.complete_technician_work_order(uuid)
to authenticated;
