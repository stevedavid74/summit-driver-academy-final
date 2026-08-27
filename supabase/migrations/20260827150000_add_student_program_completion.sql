create table public.student_program_completions (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references public.students(id),
  completed_by uuid not null, completed_at timestamptz not null default now(),
  retention_until date not null, record_snapshot jsonb not null
);
create unique index student_program_completions_student_idx on public.student_program_completions (student_id);
alter table public.student_program_completions enable row level security;
revoke all on public.student_program_completions from anon, authenticated;
grant select, insert on public.student_program_completions to authenticated;
create policy owner_manager_read_program_completions on public.student_program_completions for select to authenticated using ((select private.is_owner()) or (select private.is_manager()));
create policy owner_manager_insert_program_completions on public.student_program_completions for insert to authenticated with check (((select private.is_owner()) or (select private.is_manager())) and completed_by = (select auth.uid()));

create or replace function public.complete_student_program(p_student_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare s record; r record; missing text[]:=array[]::text[]; lesson_minutes integer; incomplete_lessons integer; completion_id uuid; completed_time timestamptz:=now();
begin
  if not ((select private.is_owner()) or (select private.is_manager())) then raise exception 'Owner or manager access is required.'; end if;
  select id,full_name,email,phone,status,online_hours,in_car_hours,summit_score,road_test_readiness into s from public.students where id=p_student_id for update;
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
  if coalesce(s.online_hours,0)<30 then missing:=array_append(missing,'30 online hours'); end if;
  if coalesce(s.in_car_hours,0)<10 then missing:=array_append(missing,'10 in-car hours'); end if;
  select coalesce(sum(duration_minutes),0),count(*) filter(where started_at is null or ended_at is null or duration_minutes is null or student_signature_name is null or student_signature_method is null or instructor_signature_name is null or instructor_signature_method is null) into lesson_minutes,incomplete_lessons from public.lesson_reports where student_id=p_student_id and status<>'voided';
  if lesson_minutes<600 then missing:=array_append(missing,'600 recorded in-car minutes'); end if;
  if incomplete_lessons>0 then missing:=array_append(missing,'Complete lesson times and signatures'); end if;
  if cardinality(missing)>0 then raise exception 'Completion blocked: %',array_to_string(missing,', '); end if;
  update public.students set status='completed',updated_at=completed_time where id=p_student_id;
  update public.student_training_records set course_completion_date=completed_time::date,updated_at=completed_time where student_id=p_student_id;
  insert into public.student_program_completions(student_id,completed_by,completed_at,retention_until,record_snapshot) values(p_student_id,(select auth.uid()),completed_time,(completed_time::date+interval '3 years')::date,jsonb_build_object('student',to_jsonb(s),'training_record',to_jsonb(r),'recorded_lesson_minutes',lesson_minutes)) on conflict(student_id) do nothing returning id into completion_id;
  if completion_id is null then raise exception 'This student program is already completed.'; end if;
  return jsonb_build_object('completion_id',completion_id,'completed_at',completed_time,'retention_until',(completed_time::date+interval '3 years')::date);
end; $$;
revoke all on function public.complete_student_program(uuid) from public, anon;
grant execute on function public.complete_student_program(uuid) to authenticated;
