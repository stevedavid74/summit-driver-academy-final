drop policy if exists staff_create_signature_attestations on public.lesson_signature_attestations;

create policy staff_create_signature_attestations
  on public.lesson_signature_attestations for insert to authenticated
  with check (
    witnessed_by_user_id = (select auth.uid())
    and (select private.is_active_staff())
    and (
      (signer_kind = 'student' and signer_user_id is null and method = 'in_person_witnessed')
      or (
        signer_kind = 'instructor'
        and signer_user_id = (select auth.uid())
        and method = 'authenticated_staff'
      )
    )
    and exists (
      select 1 from public.lesson_reports lr
      where lr.id = lesson_signature_attestations.lesson_report_id
        and lr.student_id = lesson_signature_attestations.student_id
        and lr.status = 'completed'
        and lr.started_at is not null
        and lr.ended_at is not null
        and (
          (
            signer_kind = 'student'
            and (
              lr.instructor_id = (select auth.uid())
              or (select private.is_owner())
              or (select private.is_manager())
            )
          )
          or (
            signer_kind = 'instructor'
            and lr.instructor_id = (select auth.uid())
          )
        )
    )
  );
