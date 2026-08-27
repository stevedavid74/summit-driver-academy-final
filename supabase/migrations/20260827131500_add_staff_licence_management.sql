alter table public.staff_profiles
  add column if not exists provides_instruction boolean not null default false;

grant update (
  provides_instruction,
  driver_licence_number,
  driver_licence_expiry,
  instructor_licence_number,
  instructor_licence_expiry,
  updated_at
) on public.staff_profiles to authenticated;

drop policy if exists owner_manager_update_staff_licences on public.staff_profiles;
create policy owner_manager_update_staff_licences
  on public.staff_profiles for update to authenticated
  using ((select private.is_owner()) or (select private.is_manager()))
  with check ((select private.is_owner()) or (select private.is_manager()));

create table public.staff_licence_audit (
  id bigint generated always as identity primary key,
  staff_user_id uuid not null references public.staff_profiles(user_id),
  changed_by uuid,
  changed_at timestamptz not null default now(),
  old_record jsonb,
  new_record jsonb
);

create index staff_licence_audit_staff_changed_idx
  on public.staff_licence_audit (staff_user_id, changed_at desc);

alter table public.staff_licence_audit enable row level security;
revoke all on public.staff_licence_audit from anon, authenticated;
grant select on public.staff_licence_audit to authenticated;

create policy owner_manager_read_staff_licence_audit
  on public.staff_licence_audit for select to authenticated
  using ((select private.is_owner()) or (select private.is_manager()));

create or replace function private.audit_staff_licence_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if row(
    old.provides_instruction,
    old.driver_licence_number,
    old.driver_licence_expiry,
    old.instructor_licence_number,
    old.instructor_licence_expiry
  ) is distinct from row(
    new.provides_instruction,
    new.driver_licence_number,
    new.driver_licence_expiry,
    new.instructor_licence_number,
    new.instructor_licence_expiry
  ) then
    insert into public.staff_licence_audit (
      staff_user_id, changed_by, old_record, new_record
    ) values (
      new.user_id,
      (select auth.uid()),
      jsonb_build_object(
        'provides_instruction', old.provides_instruction,
        'driver_licence_number', old.driver_licence_number,
        'driver_licence_expiry', old.driver_licence_expiry,
        'instructor_licence_number', old.instructor_licence_number,
        'instructor_licence_expiry', old.instructor_licence_expiry
      ),
      jsonb_build_object(
        'provides_instruction', new.provides_instruction,
        'driver_licence_number', new.driver_licence_number,
        'driver_licence_expiry', new.driver_licence_expiry,
        'instructor_licence_number', new.instructor_licence_number,
        'instructor_licence_expiry', new.instructor_licence_expiry
      )
    );
  end if;
  return new;
end;
$$;

create trigger audit_staff_licence_changes
after update on public.staff_profiles
for each row execute function private.audit_staff_licence_change();
