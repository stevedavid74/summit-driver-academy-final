create index lesson_reports_student_signature_witness_idx
  on public.lesson_reports (student_signature_witness_id)
  where student_signature_witness_id is not null;

create index lesson_reports_instructor_signature_user_idx
  on public.lesson_reports (instructor_signature_user_id)
  where instructor_signature_user_id is not null;

create index lesson_signature_attestations_student_idx
  on public.lesson_signature_attestations (student_id);

create index lesson_signature_attestations_signer_user_idx
  on public.lesson_signature_attestations (signer_user_id)
  where signer_user_id is not null;

create index lesson_signature_attestations_witness_idx
  on public.lesson_signature_attestations (witnessed_by_user_id);
