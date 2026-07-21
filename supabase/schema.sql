-- Elan Piano Academy — core schema
-- Run this in the Supabase SQL editor (or `supabase db push` if you adopt the CLI later).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- students
-- ---------------------------------------------------------------------------
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  age integer,
  parent_phone text not null,
  parent_phone_last4 text generated always as (
    right(regexp_replace(parent_phone, '\D', '', 'g'), 4)
  ) stored,
  memo text,
  class_days text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Migration for pre-existing databases created before age/memo/class_days were added.
-- Must run before the `comment on column` statements below, since those
-- reference columns that only exist after this migration on an existing table.
alter table students add column if not exists age integer;
alter table students add column if not exists memo text;
alter table students add column if not exists class_days text[] not null default '{}';

comment on column students.parent_phone is '보호자 전화번호 (하이픈 포함 원문, 예: 010-1234-5678)';
comment on column students.parent_phone_last4 is '키오스크 조회용 뒤 4자리 — parent_phone에서 자동 계산됨';
comment on column students.memo is '관리자 메모 (특이사항 등)';
comment on column students.class_days is '수업 요일(월~토) — mon/tue/wed/thu/fri/sat 값의 배열';

create index if not exists students_parent_phone_last4_idx
  on students (parent_phone_last4)
  where is_active;

-- ---------------------------------------------------------------------------
-- attendance_records — one row per 등원(check-in)/하원(check-out) cycle
-- ---------------------------------------------------------------------------
create table if not exists attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students (id) on delete cascade,
  check_in_at timestamptz not null default now(),
  check_out_at timestamptz,
  created_at timestamptz not null default now(),

  constraint check_out_after_check_in check (
    check_out_at is null or check_out_at >= check_in_at
  )
);

-- A student can only have one open (not yet checked out) attendance record at a time.
-- This also lets the app rely on a unique-constraint violation to detect
-- "already checked in" instead of a separate read-then-write race.
create unique index if not exists attendance_one_open_record_per_student
  on attendance_records (student_id)
  where check_out_at is null;

create index if not exists attendance_student_id_idx on attendance_records (student_id);
create index if not exists attendance_check_in_at_idx on attendance_records (check_in_at desc);

-- ---------------------------------------------------------------------------
-- Auto check-out at 22:00 KST — students who checked in but were never
-- checked out get closed out automatically at the academy's closing time.
-- pg_cron runs in UTC, and KST has no DST (always UTC+9), so 22:00 KST is a
-- fixed '0 13 * * *' schedule.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'auto-checkout-2200-kst') then
    perform cron.unschedule('auto-checkout-2200-kst');
  end if;
end $$;

select cron.schedule(
  'auto-checkout-2200-kst',
  '0 13 * * *',
  $$
  update attendance_records
  set check_out_at = now()
  where check_out_at is null;
  $$
);

-- ---------------------------------------------------------------------------
-- app_settings — generic key/value store; currently holds the hashed admin
-- PIN (key = 'admin_pin_hash') so it can be changed from the dashboard
-- instead of being fixed to the ADMIN_PIN env var.
-- ---------------------------------------------------------------------------
create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- The Next.js server talks to Supabase using the service_role key (see
-- lib/supabase/server.ts), which bypasses RLS by design. RLS is enabled here
-- with no policies so that the anon/public key — if it were ever used
-- directly from the browser — cannot read or write these tables at all.
alter table students enable row level security;
alter table attendance_records enable row level security;
alter table app_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Sample data (optional) — mirrors the previous in-memory roster so the
-- kiosk keeps working end to end after the migration. Safe to delete.
-- ---------------------------------------------------------------------------
insert into students (name, parent_phone) values
  ('김민준', '010-0000-1234'),
  ('김서준', '010-0000-1234'),
  ('이서연', '010-0000-5678'),
  ('박지호', '010-0000-9012'),
  ('최하윤', '010-0000-3456')
on conflict do nothing;
