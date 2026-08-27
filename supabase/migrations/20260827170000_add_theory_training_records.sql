alter table public.students
  add column if not exists classroom_hours numeric(6,2) not null default 0,
  add column if not exists flexible_hours numeric(6,2) not null default 0;

create table public.theory_training_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  delivery_type text not null check (delivery_type in ('digital','classroom','flexible')),
  module_title text not null check (btrim(module_title) <> ''),
  session_date date not null,
  started_at time not null,
  ended_at time not null,
  duration_minutes integer not null check (duration_minutes between 15 and 300),
  test_score integer check (test_score between 0 and 100),
  qa_verified boolean not null default false,
  student_signature_name text not null check (btrim(student_signature_name) <> ''),
  student_signed_at timestamptz not null default now(),
  instructor_id uuid not null references public.staff_profiles(user_id),
  instructor_signature_name text not null check (btrim(instructor_signature_name) <> ''),
  instructor_signed_at timestamptz not null default now(),
  notes text,
  status text not null default 'completed' check (status in ('completed','voided')),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at > started_at),
  check (duration_minutes = extract(epoch from (ended_at - started_at))::integer / 60)
);

create index theory_training_records_student_date_idx on public.theory_training_records(student_id,session_date desc);
create index theory_training_records_instructor_idx on public.theory_training_records(instructor_id);
alter table public.theory_training_records enable row level security;
revoke all on public.theory_training_records from anon, authenticated;
grant select, insert, update on public.theory_training_records to authenticated;

create policy owner_manager_read_theory_records on public.theory_training_records for select to authenticated
  using ((select private.is_owner()) or (select private.is_manager()));
create policy owner_manager_insert_theory_records on public.theory_training_records for insert to authenticated
  with check (((select private.is_owner()) or (select private.is_manager())) and created_by=(select auth.uid()) and instructor_id=(select auth.uid()));
create policy owner_manager_update_theory_records on public.theory_training_records for update to authenticated
  using ((select private.is_owner()) or (select private.is_manager()))
  with check ((select private.is_owner()) or (select private.is_manager()));

create or replace function private.validate_theory_training_record() returns trigger
language plpgsql security definer set search_path = '' as $$
declare daily_minutes integer;
begin
  if new.status='completed' and new.delivery_type='digital' and not new.qa_verified then
    raise exception 'Quality assurance verification is required for digital training.';
  end if;
  select coalesce(sum(duration_minutes),0) into daily_minutes
  from public.theory_training_records
  where student_id=new.student_id and session_date=new.session_date and status='completed' and id<>new.id;
  if new.status='completed' and daily_minutes+new.duration_minutes>300 then
    raise exception 'A student may record no more than five hours of theory training in one day.';
  end if;
  new.updated_at=now();
  return new;
end $$;
revoke all on function private.validate_theory_training_record() from public,anon,authenticated;
create trigger validate_theory_training_record before insert or update on public.theory_training_records
for each row execute function private.validate_theory_training_record();

create or replace function private.recalculate_theory_hours() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target_student uuid; classroom numeric; flexible numeric;
begin
  target_student=coalesce(new.student_id,old.student_id);
  select
    coalesce(sum(duration_minutes) filter(where delivery_type in ('digital','classroom') and status='completed'),0)/60.0,
    coalesce(sum(duration_minutes) filter(where delivery_type='flexible' and status='completed'),0)/60.0
  into classroom,flexible from public.theory_training_records where student_id=target_student;
  update public.students set classroom_hours=classroom,flexible_hours=flexible,online_hours=classroom+flexible,updated_at=now() where id=target_student;
  return coalesce(new,old);
end $$;
revoke all on function private.recalculate_theory_hours() from public,anon,authenticated;
create trigger recalculate_theory_hours after insert or update or delete on public.theory_training_records
for each row execute function private.recalculate_theory_hours();

create table public.theory_training_audit (
  id bigint generated always as identity primary key,
  theory_record_id uuid not null,
  student_id uuid not null,
  action text not null,
  old_record jsonb,
  new_record jsonb,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
create index theory_training_audit_student_idx on public.theory_training_audit(student_id,changed_at desc);
alter table public.theory_training_audit enable row level security;
revoke all on public.theory_training_audit from anon,authenticated;
grant select on public.theory_training_audit to authenticated;
create policy owner_manager_read_theory_audit on public.theory_training_audit for select to authenticated
  using ((select private.is_owner()) or (select private.is_manager()));
create or replace function private.audit_theory_training_record() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.theory_training_audit(theory_record_id,student_id,action,old_record,new_record)
  values(coalesce(new.id,old.id),coalesce(new.student_id,old.student_id),tg_op,to_jsonb(old),to_jsonb(new));
  return coalesce(new,old);
end $$;
revoke all on function private.audit_theory_training_record() from public,anon,authenticated;
create trigger audit_theory_training_record after insert or update or delete on public.theory_training_records
for each row execute function private.audit_theory_training_record();

revoke select on public.students from authenticated;
grant select (id,instructor_id,full_name,email,phone,preferred_language,status,online_hours,classroom_hours,flexible_hours,in_car_hours,summit_score,road_test_readiness,current_focus,next_lesson_at,created_by,created_at,updated_at,registration_id,assigned_instructor_code,training_week_start,scheduled_duration_minutes) on public.students to authenticated;
revoke update on public.students from authenticated;
grant update (instructor_id,full_name,email,phone,preferred_language,status,online_hours,classroom_hours,flexible_hours,in_car_hours,summit_score,road_test_readiness,current_focus,next_lesson_at,updated_at,registration_id,assigned_instructor_code,training_week_start,scheduled_duration_minutes) on public.students to authenticated;

create or replace function public.complete_student_program(p_student_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare s record; r record; missing text[]:=array[]::text[]; lesson_minutes integer; incomplete_lessons integer; theory_minutes integer; incomplete_theory integer; completion_id uuid; completed_time timestamptz:=now();
begin
  if not ((select private.is_owner()) or (select private.is_manager())) then raise exception 'Owner or manager access is required.'; end if;
  select id,full_name,email,phone,status,online_hours,classroom_hours,flexible_hours,in_car_hours,summit_score,road_test_readiness into s from public.students where id=p_student_id for update;
  if not found then raise exception 'Student not found.'; end if;
  select * into r from public.student_training_records where student_id=p_student_id for update;
  if not found then raise exception 'Complete the student information record first.'; end if;
  if s.full_name is null or btrim(s.full_name)='' then missing:=array_append(missing,'Legal name'); end if;
  if s.email is null or btrim(s.email)='' then missing:=array_append(missing,'Student email'); end if;
  if s.phone is null or btrim(s.phone)='' then missing:=array_append(missing,'Student phone'); end if;
  if r.date_of_birth is null then missing:=array_append(missing,'Date of birth'); end if;
  if r.gender is null or btrim(r.gender)='' then missing:=array_append(missing,'Gender'); end if;
  if r.address is null or btrim(r.address)='' then missing:=array_append(missing,'Address'); end if;
  if r.driver_licence_number is null or btrim(r.driver_licence_number)='' then missing:=array_append(missing,'Driver licence number'); end if;
  if r.emergency_contact_name is null or btrim(r.emergency_contact_name)='' then missing:=array_append(missing,'Emergency contact'); end if;
  if r.emergency_contact_phone is null or btrim(r.emergency_contact_phone)='' then missing:=array_append(missing,'Emergency contact phone'); end if;
  if r.course_start_date is null then missing:=array_append(missing,'Course start date'); end if;
  if r.ministry_certificate_number is null or btrim(r.ministry_certificate_number)='' then missing:=array_append(missing,'MTO reference'); end if;
  if coalesce(s.classroom_hours,0)<20 then missing:=array_append(missing,'20 classroom/digital hours'); end if;
  if coalesce(s.flexible_hours,0)<10 then missing:=array_append(missing,'10 flexible instruction hours'); end if;
  if coalesce(s.in_car_hours,0)<10 then missing:=array_append(missing,'10 in-car hours'); end if;
  select coalesce(sum(duration_minutes),0),count(*) filter(where started_at is null or ended_at is null or duration_minutes is null or student_signature_name is null or instructor_signature_name is null or (delivery_type='digital' and not qa_verified)) into theory_minutes,incomplete_theory from public.theory_training_records where student_id=p_student_id and status='completed';
  if theory_minutes<1800 then missing:=array_append(missing,'1800 recorded theory/flexible minutes'); end if;
  if incomplete_theory>0 then missing:=array_append(missing,'Complete theory times, signatures, and QA checks'); end if;
  select coalesce(sum(duration_minutes),0),count(*) filter(where started_at is null or ended_at is null or duration_minutes is null or student_signature_name is null or student_signature_method is null or instructor_signature_name is null or instructor_signature_method is null) into lesson_minutes,incomplete_lessons from public.lesson_reports where student_id=p_student_id and status<>'voided';
  if lesson_minutes<600 then missing:=array_append(missing,'600 recorded in-car minutes'); end if;
  if incomplete_lessons>0 then missing:=array_append(missing,'Complete lesson times and signatures'); end if;
  if cardinality(missing)>0 then raise exception 'Completion blocked: %',array_to_string(missing,', '); end if;
  update public.students set status='completed',updated_at=completed_time where id=p_student_id;
  update public.student_training_records set course_completion_date=completed_time::date,updated_at=completed_time where student_id=p_student_id;
  insert into public.student_program_completions(student_id,completed_by,completed_at,retention_until,record_snapshot) values(p_student_id,(select auth.uid()),completed_time,(completed_time::date+interval '3 years')::date,jsonb_build_object('student',to_jsonb(s),'training_record',to_jsonb(r),'recorded_theory_minutes',theory_minutes,'recorded_lesson_minutes',lesson_minutes)) on conflict(student_id) do nothing returning id into completion_id;
  if completion_id is null then raise exception 'This student program is already completed.'; end if;
  return jsonb_build_object('completion_id',completion_id,'completed_at',completed_time,'retention_until',(completed_time::date+interval '3 years')::date);
end $$;
revoke all on function public.complete_student_program(uuid) from public,anon;
grant execute on function public.complete_student_program(uuid) to authenticated;
