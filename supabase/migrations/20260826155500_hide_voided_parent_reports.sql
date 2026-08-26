create or replace function public.get_parent_lesson_reports()
returns table (
  id uuid,
  student_id uuid,
  lesson_date date,
  duration_minutes integer,
  overall_score integer,
  observation_score integer,
  intersections_score integer,
  lane_control_score integer,
  parking_score integer,
  defensive_driving_score integer,
  lesson_notes text,
  parent_summary text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    lr.id,
    lr.student_id,
    lr.lesson_date,
    lr.duration_minutes,
    lr.overall_score,
    lr.observation_score,
    lr.intersections_score,
    lr.lane_control_score,
    lr.parking_score,
    lr.defensive_driving_score,
    lr.lesson_notes,
    lr.parent_summary,
    lr.created_at
  from public.lesson_reports lr
  join public.student_guardians sg on sg.student_id = lr.student_id
  join public.parent_profiles pp on pp.user_id = sg.guardian_id
  where lr.share_with_parent = true
    and lr.status = 'completed'
    and pp.user_id = (select auth.uid())
    and pp.is_active = true;
$$;
