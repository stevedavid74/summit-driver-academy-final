revoke update on public.students from authenticated;
grant update (
  instructor_id, full_name, email, phone, preferred_language, status,
  online_hours, in_car_hours, summit_score, road_test_readiness,
  current_focus, next_lesson_at, updated_at, registration_id,
  assigned_instructor_code, training_week_start, scheduled_duration_minutes
) on public.students to authenticated;

create or replace function private.enforce_student_update_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if (select private.is_owner()) or (select private.is_manager()) then
    return new;
  end if;

  if not (select private.is_active_staff()) or old.instructor_id <> (select auth.uid()) then
    raise exception 'Student update access is not permitted.';
  end if;

  if (to_jsonb(new) - array['in_car_hours','summit_score','road_test_readiness','current_focus','updated_at'])
     is distinct from
     (to_jsonb(old) - array['in_car_hours','summit_score','road_test_readiness','current_focus','updated_at']) then
    raise exception 'Instructors may update driving progress only.';
  end if;

  return new;
end;
$$;
revoke all on function private.enforce_student_update_scope() from public, anon, authenticated;
drop trigger if exists enforce_student_update_scope on public.students;
create trigger enforce_student_update_scope
before update on public.students
for each row execute function private.enforce_student_update_scope();
