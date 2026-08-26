alter table public.students
  add column if not exists date_of_birth date,
  add column if not exists gender text,
  add column if not exists address text,
  add column if not exists driver_licence_number text,
  add column if not exists course_start_date date,
  add column if not exists course_completion_date date,
  add column if not exists ministry_certificate_number text,
  add column if not exists ministry_acknowledged_at timestamptz;

alter table public.staff_profiles
  add column if not exists driver_licence_number text,
  add column if not exists driver_licence_expiry date,
  add column if not exists instructor_licence_number text,
  add column if not exists instructor_licence_expiry date;

alter table public.lesson_reports
  add column if not exists started_at time,
  add column if not exists ended_at time,
  add column if not exists student_signature_name text,
  add column if not exists student_signed_at timestamptz,
  add column if not exists instructor_signature_name text,
  add column if not exists instructor_signed_at timestamptz;

alter table public.lesson_reports drop constraint if exists lesson_reports_status_check;
alter table public.lesson_reports
  add constraint lesson_reports_status_check check (status = any (array['draft'::text, 'completed'::text, 'voided'::text]));

create table if not exists public.lesson_report_audit (
  id bigint generated always as identity primary key,
  lesson_report_id uuid not null,
  student_id uuid not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  changed_by uuid,
  changed_at timestamptz not null default now(),
  old_record jsonb,
  new_record jsonb
);

create index if not exists lesson_report_audit_student_changed_idx
  on public.lesson_report_audit (student_id, changed_at desc);

alter table public.lesson_report_audit enable row level security;
revoke all on public.lesson_report_audit from anon, authenticated;
grant select on public.lesson_report_audit to authenticated;

drop policy if exists owner_manager_read_lesson_report_audit on public.lesson_report_audit;
create policy owner_manager_read_lesson_report_audit
  on public.lesson_report_audit for select to authenticated
  using ((select private.is_owner()) or (select private.is_manager()));

create or replace function private.audit_lesson_report_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lesson_report_audit (
    lesson_report_id, student_id, action, changed_by, old_record, new_record
  ) values (
    coalesce(new.id, old.id),
    coalesce(new.student_id, old.student_id),
    tg_op,
    (select auth.uid()),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_lesson_report_changes on public.lesson_reports;
create trigger audit_lesson_report_changes
after insert or update or delete on public.lesson_reports
for each row execute function private.audit_lesson_report_change();

drop policy if exists staff_update_lesson_reports on public.lesson_reports;
create policy staff_update_lesson_reports
  on public.lesson_reports for update to authenticated
  using (
    (select private.is_owner())
    or (select private.is_manager())
    or (
      (select private.is_active_staff())
      and instructor_id = (select auth.uid())
      and exists (
        select 1 from public.students s
        where s.id = lesson_reports.student_id
          and s.instructor_id = (select auth.uid())
      )
    )
  )
  with check (
    (select private.is_owner())
    or (select private.is_manager())
    or (
      (select private.is_active_staff())
      and instructor_id = (select auth.uid())
      and exists (
        select 1 from public.students s
        where s.id = lesson_reports.student_id
          and s.instructor_id = (select auth.uid())
      )
    )
  );
