create table public.payment_settings (
  singleton boolean primary key default true check (singleton),
  stripe_mode text not null default 'test' check (stripe_mode in ('test','live')),
  live_payments_enabled boolean not null default false,
  tax_calculation_enabled boolean not null default false,
  founding_price_cents integer not null default 90000 check (founding_price_cents = 90000),
  regular_price_cents integer not null default 120000 check (regular_price_cents = 120000),
  currency text not null default 'cad' check (currency = 'cad'),
  updated_by uuid references public.staff_profiles(user_id),
  updated_at timestamptz not null default now(),
  check (not live_payments_enabled or stripe_mode = 'live')
);

insert into public.payment_settings(singleton) values(true) on conflict(singleton) do nothing;

alter table public.payment_settings enable row level security;
revoke all on public.payment_settings from anon,authenticated;
grant select on public.payment_settings to authenticated;
create policy owner_manager_read_payment_settings on public.payment_settings for select to authenticated
  using ((select private.is_owner()) or (select private.is_manager()));

create table public.student_payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  registration_id uuid references public.registrations(id),
  environment text not null default 'test' check (environment in ('test','live')),
  tuition_tier text not null check (tuition_tier in ('founding','regular')),
  amount_cents integer not null check (
    (tuition_tier = 'founding' and amount_cents = 90000) or
    (tuition_tier = 'regular' and amount_cents = 120000)
  ),
  tax_cents integer not null default 0 check (tax_cents = 0),
  currency text not null default 'cad' check (currency = 'cad'),
  status text not null default 'draft' check (status in ('draft','checkout_created','paid','failed','cancelled','refunded','partially_refunded')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_customer_id text,
  stripe_refund_id text,
  checkout_url text,
  receipt_url text,
  created_by uuid not null references public.staff_profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  refunded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index student_payments_student_created_idx on public.student_payments(student_id,created_at desc);
create index student_payments_registration_idx on public.student_payments(registration_id) where registration_id is not null;
create index student_payments_status_idx on public.student_payments(status,created_at desc);

alter table public.student_payments enable row level security;
revoke all on public.student_payments from anon,authenticated;
grant select on public.student_payments to authenticated;
create policy owner_manager_read_student_payments on public.student_payments for select to authenticated
  using ((select private.is_owner()) or (select private.is_manager()));
create policy guardian_read_linked_student_payments on public.student_payments for select to authenticated
  using (exists (
    select 1 from public.student_guardians sg
    where sg.student_id = student_payments.student_id and sg.guardian_id = (select auth.uid())
  ));

create table public.student_payment_audit (
  id bigint generated always as identity primary key,
  payment_id uuid not null,
  student_id uuid not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  changed_by uuid,
  changed_at timestamptz not null default now(),
  old_record jsonb,
  new_record jsonb
);

create index student_payment_audit_payment_idx on public.student_payment_audit(payment_id,changed_at desc);
create index student_payment_audit_student_idx on public.student_payment_audit(student_id,changed_at desc);
alter table public.student_payment_audit enable row level security;
revoke all on public.student_payment_audit from anon,authenticated;
grant select on public.student_payment_audit to authenticated;
create policy owner_manager_read_student_payment_audit on public.student_payment_audit for select to authenticated
  using ((select private.is_owner()) or (select private.is_manager()));

create or replace function private.audit_student_payment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.student_payment_audit(payment_id,student_id,action,changed_by,old_record,new_record)
  values(
    coalesce(new.id,old.id),coalesce(new.student_id,old.student_id),tg_op,(select auth.uid()),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new,old);
end $$;

create trigger audit_student_payment_change after insert or update or delete on public.student_payments
for each row execute function private.audit_student_payment();

create or replace function private.guard_payment_environment()
returns trigger language plpgsql security definer set search_path='' as $$
declare settings public.payment_settings%rowtype;
begin
  select * into settings from public.payment_settings where singleton=true;
  if new.environment = 'live' and not coalesce(settings.live_payments_enabled,false) then
    raise exception 'Live payments are disabled.';
  end if;
  if new.environment <> settings.stripe_mode then
    raise exception 'Payment environment does not match the configured Stripe mode.';
  end if;
  if new.tax_cents <> 0 or settings.tax_calculation_enabled then
    raise exception 'Tax calculation has not been approved.';
  end if;
  return new;
end $$;

create trigger guard_payment_environment before insert or update on public.student_payments
for each row execute function private.guard_payment_environment();

grant usage on schema public to authenticated;
grant usage,select on sequence public.student_payment_audit_id_seq to authenticated;
