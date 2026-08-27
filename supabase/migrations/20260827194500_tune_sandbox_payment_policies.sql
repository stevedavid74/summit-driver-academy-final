create index payment_settings_updated_by_idx
  on public.payment_settings(updated_by)
  where updated_by is not null;

create index student_payments_created_by_idx
  on public.student_payments(created_by);

drop policy if exists owner_manager_read_student_payments on public.student_payments;
drop policy if exists guardian_read_linked_student_payments on public.student_payments;

create policy authorized_read_student_payments
  on public.student_payments
  for select
  to authenticated
  using (
    (select private.is_owner())
    or (select private.is_manager())
    or exists (
      select 1
      from public.student_guardians sg
      where sg.student_id = student_payments.student_id
        and sg.guardian_id = (select auth.uid())
    )
  );
