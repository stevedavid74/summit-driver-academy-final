alter table public.registrations
  add column if not exists onboarding_status text not null default 'not_started'
    check (onboarding_status in ('not_started','completed')),
  add column if not exists enrolled_at timestamptz;
grant update(onboarding_status,enrolled_at) on public.registrations to authenticated;
create policy owner_manager_update_registration_onboarding on public.registrations for update to authenticated
  using ((select private.is_owner()) or (select private.is_manager()))
  with check ((select private.is_owner()) or (select private.is_manager()));

create table public.student_enrollment_consents (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  registration_id uuid references public.registrations(id),
  signer_name text not null check (length(btrim(signer_name)) >= 2),
  signer_relationship text not null check (signer_relationship in ('student','parent_guardian')),
  enrollment_consent boolean not null check (enrollment_consent),
  privacy_consent boolean not null check (privacy_consent),
  electronic_records_consent boolean not null check (electronic_records_consent),
  signer_attested boolean not null check (signer_attested),
  signed_at timestamptz not null default now(),
  recorded_by uuid not null references public.staff_profiles(user_id),
  enrollment_snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index student_enrollment_consents_student_signed_idx on public.student_enrollment_consents(student_id,signed_at desc);
alter table public.student_enrollment_consents enable row level security;
revoke all on public.student_enrollment_consents from anon,authenticated;
grant select,insert on public.student_enrollment_consents to authenticated;
create policy owner_manager_read_enrollment_consents on public.student_enrollment_consents for select to authenticated
  using ((select private.is_owner()) or (select private.is_manager()));
create policy owner_manager_insert_enrollment_consents on public.student_enrollment_consents for insert to authenticated
  with check (((select private.is_owner()) or (select private.is_manager())) and recorded_by=(select auth.uid()));

create or replace function public.complete_registration_onboarding(p_registration_id uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare reg public.registrations%rowtype; sid uuid; staff_id uuid; lang text; parent_requested boolean;
begin
  if not ((select private.is_owner()) or (select private.is_manager())) then raise exception 'Owner or manager access is required.'; end if;
  select * into reg from public.registrations where id=p_registration_id for update;
  if not found then raise exception 'Registration not found.'; end if;
  if reg.scheduling_status<>'confirmed' or reg.confirmed_student_id is null then raise exception 'Confirm the instructor and training week before enrollment.'; end if;
  sid:=reg.confirmed_student_id;
  select instructor_id into staff_id from public.students where id=sid for update;
  if staff_id is null then raise exception 'Assign an instructor before enrollment.'; end if;
  lang:=case when lower(coalesce(p_payload->>'preferred_language',reg.language)) like 'fr%' then 'fr' else 'en' end;
  if nullif(btrim(p_payload->>'legal_name'),'') is null or nullif(btrim(p_payload->>'student_email'),'') is null or nullif(btrim(p_payload->>'student_phone'),'') is null then raise exception 'Student name, email, and phone are required.'; end if;
  if nullif(p_payload->>'date_of_birth','') is null or nullif(btrim(p_payload->>'address'),'') is null or nullif(btrim(p_payload->>'driver_licence_number'),'') is null then raise exception 'Birth date, address, and driver licence are required.'; end if;
  if nullif(btrim(p_payload->>'emergency_contact_name'),'') is null or nullif(btrim(p_payload->>'emergency_contact_phone'),'') is null or nullif(p_payload->>'course_start_date','') is null then raise exception 'Emergency contact and course start date are required.'; end if;
  if coalesce((p_payload->>'enrollment_consent')::boolean,false) is not true or coalesce((p_payload->>'privacy_consent')::boolean,false) is not true or coalesce((p_payload->>'electronic_records_consent')::boolean,false) is not true or coalesce((p_payload->>'signer_attested')::boolean,false) is not true then raise exception 'All enrollment consents and the signature attestation are required.'; end if;
  update public.students set full_name=btrim(p_payload->>'legal_name'),email=lower(btrim(p_payload->>'student_email')),phone=btrim(p_payload->>'student_phone'),preferred_language=lang,status='active',updated_at=now() where id=sid;
  insert into public.student_training_records(student_id,date_of_birth,gender,address,driver_licence_number,emergency_contact_name,emergency_contact_relationship,emergency_contact_phone,course_start_date,updated_at)
  values(sid,(p_payload->>'date_of_birth')::date,nullif(btrim(p_payload->>'gender'),''),btrim(p_payload->>'address'),btrim(p_payload->>'driver_licence_number'),btrim(p_payload->>'emergency_contact_name'),nullif(btrim(p_payload->>'emergency_contact_relationship'),''),btrim(p_payload->>'emergency_contact_phone'),(p_payload->>'course_start_date')::date,now())
  on conflict(student_id) do update set date_of_birth=excluded.date_of_birth,gender=excluded.gender,address=excluded.address,driver_licence_number=excluded.driver_licence_number,emergency_contact_name=excluded.emergency_contact_name,emergency_contact_relationship=excluded.emergency_contact_relationship,emergency_contact_phone=excluded.emergency_contact_phone,course_start_date=excluded.course_start_date,updated_at=now();
  insert into public.student_enrollment_consents(student_id,registration_id,signer_name,signer_relationship,enrollment_consent,privacy_consent,electronic_records_consent,signer_attested,recorded_by,enrollment_snapshot)
  values(sid,reg.id,btrim(p_payload->>'signer_name'),p_payload->>'signer_relationship',true,true,true,true,(select auth.uid()),jsonb_build_object('registration',to_jsonb(reg),'student_payload',p_payload,'student_id',sid,'recorded_at',now()));
  update public.registrations set onboarding_status='completed',enrolled_at=now() where id=reg.id;
  parent_requested:=coalesce((p_payload->>'invite_parent')::boolean,false);
  return jsonb_build_object('student_id',sid,'parent_invitation_requested',parent_requested,'parent_name',nullif(btrim(p_payload->>'parent_name'),''),'parent_email',nullif(lower(btrim(p_payload->>'parent_email')),''),'preferred_language',lang);
end $$;
revoke all on function public.complete_registration_onboarding(uuid,jsonb) from public,anon;
grant execute on function public.complete_registration_onboarding(uuid,jsonb) to authenticated;
