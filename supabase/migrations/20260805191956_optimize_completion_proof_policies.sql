create index work_order_completion_proofs_technician_id_idx
on public.work_order_completion_proofs(technician_id);

drop policy completion_proofs_select on public.work_order_completion_proofs;
create policy completion_proofs_select
on public.work_order_completion_proofs
for select
to authenticated
using (
  (select public.is_manager())
  or exists (
    select 1
    from public.work_orders
    where work_orders.id = work_order_completion_proofs.job_id
      and work_orders.assigned_technician_id = (select auth.uid())
  )
);

drop policy completion_proofs_insert on public.work_order_completion_proofs;
create policy completion_proofs_insert
on public.work_order_completion_proofs
for insert
to authenticated
with check (
  technician_id = (select auth.uid())
  and type in ('photo', 'signature')
  and exists (
    select 1
    from public.work_orders
    where work_orders.id = work_order_completion_proofs.job_id
      and work_orders.assigned_technician_id = (select auth.uid())
      and work_orders.status not in ('Completed', 'Closed', 'Canceled')
  )
);

drop policy completion_proofs_delete on public.work_order_completion_proofs;
create policy completion_proofs_delete
on public.work_order_completion_proofs
for delete
to authenticated
using (
  technician_id = (select auth.uid())
  and exists (
    select 1
    from public.work_orders
    where work_orders.id = work_order_completion_proofs.job_id
      and work_orders.assigned_technician_id = (select auth.uid())
      and work_orders.status not in ('Completed', 'Closed', 'Canceled')
  )
);

drop policy completion_proof_files_insert on storage.objects;
create policy completion_proof_files_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'job-completion-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.work_orders
    where work_orders.id::text = (storage.foldername(name))[2]
      and work_orders.assigned_technician_id = (select auth.uid())
      and work_orders.status not in ('Completed', 'Closed', 'Canceled')
  )
);

drop policy completion_proof_files_select on storage.objects;
create policy completion_proof_files_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'job-completion-proofs'
  and (
    (select public.is_manager())
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and exists (
        select 1
        from public.work_orders
        where work_orders.id::text = (storage.foldername(name))[2]
          and work_orders.assigned_technician_id = (select auth.uid())
      )
    )
  )
);

drop policy completion_proof_files_delete on storage.objects;
create policy completion_proof_files_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'job-completion-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.work_orders
    where work_orders.id::text = (storage.foldername(name))[2]
      and work_orders.assigned_technician_id = (select auth.uid())
      and work_orders.status not in ('Completed', 'Closed', 'Canceled')
  )
);
