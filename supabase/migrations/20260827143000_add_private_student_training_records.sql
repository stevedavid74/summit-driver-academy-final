create table if not exists public.student_training_records (
  student_id uuid primary key references public.students(id) on delete cascade,
  date_of_birth date,
  gender text,
  address text,
  driver_licence_number text,
  emergency_contact_name text,
  emergency_contact_relationship text,
  emergency_contact_phone text,
  course_start_date date,
  course_completion_date date,
  ministry_certificate_number text,
  ministry_acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.student_training_records (
  student_id, date_of_birth, gender, address, driver_licence_number,
  course_start_date, course_completion_date, ministry_certificate_number,
  ministry_acknowledged_at
)
select id, date_of_birth, gender, address, driver_licence_number,
  course_start_date, course_completion_date, ministry_certificate_number,
  ministry_acknowledged_at
from public.students
on conflict (student_id) do nothing;

alter table public.student_training_records enable row level security;
revoke all on public.student_training_records from anon, authenticated;
grant select, insert, update on public.student_training_records to authenticated;

create policy owner_manager_read_student_training_records
  on public.student_training_records for select to authenticated
  using ((select private.is_owner()) or (select private.is_manager()));
create policy owner_manager_insert_student_training_records
  on public.student_training_records for insert to authenticated
  with check ((select private.is_owner()) or (select private.is_manager()));
create policy owner_manager_update_student_training_records
  on public.student_training_records for update to authenticated
  using ((select private.is_owner()) or (select private.is_manager()))
  with check ((select private.is_owner()) or (select private.is_manager()));

create table if not exists public.student_training_record_audit (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  old_record jsonb,
  new_record jsonb
);
create index if not exists student_training_record_audit_student_changed_idx
  on public.student_training_record_audit (student_id, changed_at desc);
alter table public.student_training_record_audit enable row level security;
revoke all on public.student_training_record_audit from anon, authenticated;
grant select on public.student_training_record_audit to authenticated;
create policy owner_manager_read_student_training_record_audit
  on public.student_training_record_audit for select to authenticated
  using ((select private.is_owner()) or (select private.is_manager()));

create or replace function private.audit_student_training_record_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.student_training_record_audit
    (student_id, changed_by, old_record, new_record)
  values (new.student_id, (select auth.uid()), to_jsonb(old), to_jsonb(new));
  return new;
end;
$$;
revoke all on function private.audit_student_training_record_change() from public, anon, authenticated;
drop trigger if exists audit_student_training_record_changes on public.student_training_records;
create trigger audit_student_training_record_changes
after update on public.student_training_records
for each row execute function private.audit_student_training_record_change();

-- Keep confidential MTO fields out of the parent-facing students API.
revoke select on public.students from authenticated;
grant select (
  id, instructor_id, full_name, email, phone, preferred_language, status,
  online_hours, in_car_hours, summit_score, road_test_readiness,
  current_focus, next_lesson_at, created_by, created_at, updated_at,
  registration_id, assigned_instructor_code, training_week_start,
  scheduled_duration_minutes
) on public.students to authenticated;
