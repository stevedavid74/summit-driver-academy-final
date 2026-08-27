alter table public.lesson_reports
  add column if not exists student_signature_witness_id uuid references public.staff_profiles(user_id),
  add column if not exists instructor_signature_user_id uuid references public.staff_profiles(user_id),
  add column if not exists student_signature_method text,
  add column if not exists instructor_signature_method text;

create table public.lesson_signature_attestations (
  id uuid primary key default gen_random_uuid(),
  lesson_report_id uuid not null references public.lesson_reports(id),
  student_id uuid not null references public.students(id),
  signer_kind text not null check (signer_kind in ('student', 'instructor')),
  signer_name text not null check (length(trim(signer_name)) >= 2),
  signer_user_id uuid references public.staff_profiles(user_id),
  witnessed_by_user_id uuid not null references public.staff_profiles(user_id),
  method text not null check (method in ('authenticated_staff', 'in_person_witnessed')),
  attestation_text text not null,
  report_snapshot jsonb not null,
  signed_at timestamptz not null default now()
);

create index lesson_signature_attestations_report_signed_idx
  on public.lesson_signature_attestations (lesson_report_id, signer_kind, signed_at desc);

alter table public.lesson_signature_attestations enable row level security;
revoke all on public.lesson_signature_attestations from anon, authenticated;
grant select, insert on public.lesson_signature_attestations to authenticated;

create policy staff_read_signature_attestations
  on public.lesson_signature_attestations for select to authenticated
  using (
    (select private.is_owner())
    or (select private.is_manager())
    or exists (
      select 1 from public.lesson_reports lr
      where lr.id = lesson_signature_attestations.lesson_report_id
        and lr.instructor_id = (select auth.uid())
        and (select private.is_active_staff())
    )
  );

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
          lr.instructor_id = (select auth.uid())
          or (select private.is_owner())
          or (select private.is_manager())
        )
    )
  );

create or replace function private.apply_lesson_signature_attestation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.signer_kind = 'student' then
    update public.lesson_reports
    set student_signature_name = new.signer_name,
        student_signed_at = new.signed_at,
        student_signature_witness_id = new.witnessed_by_user_id,
        student_signature_method = new.method
    where id = new.lesson_report_id;
  else
    update public.lesson_reports
    set instructor_signature_name = new.signer_name,
        instructor_signed_at = new.signed_at,
        instructor_signature_user_id = new.signer_user_id,
        instructor_signature_method = new.method
    where id = new.lesson_report_id;
  end if;
  return new;
end;
$$;

create trigger apply_lesson_signature_attestation
after insert on public.lesson_signature_attestations
for each row execute function private.apply_lesson_signature_attestation();

revoke update, delete on public.lesson_signature_attestations from anon, authenticated;
