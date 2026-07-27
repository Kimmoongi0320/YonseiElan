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
  payment_day integer check (payment_day between 1 and 31),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Migration for pre-existing databases created before age/memo/class_days were added.
-- Must run before the `comment on column` statements below, since those
-- reference columns that only exist after this migration on an existing table.
alter table students add column if not exists age integer;
alter table students add column if not exists memo text;
alter table students add column if not exists class_days text[] not null default '{}';
alter table students add column if not exists payment_day integer check (payment_day between 1 and 31);

comment on column students.parent_phone is '보호자 전화번호 (하이픈 포함 원문, 예: 010-1234-5678)';
comment on column students.parent_phone_last4 is '키오스크 조회용 뒤 4자리 — parent_phone에서 자동 계산됨';
comment on column students.memo is '관리자 메모 (특이사항 등)';
comment on column students.class_days is '수업 요일(월~토) — mon/tue/wed/thu/fri/sat 값의 배열';
comment on column students.payment_day is '매월 결제일 (1~31) — 출석 달력에 표시용, 선택 입력';

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
-- attendance_overrides — admin-set present/absent status for a specific
-- calendar date, shown on the admin dashboard's per-student calendar. Takes
-- precedence over the status derived from attendance_records, so an admin
-- can mark a student present without a kiosk check-in, or absent despite one.
-- ---------------------------------------------------------------------------
create table if not exists attendance_overrides (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students (id) on delete cascade,
  date date not null,
  status text not null check (status in ('present', 'absent')),
  makeup_date date,
  class_days_snapshot text[],
  created_at timestamptz not null default now(),

  unique (student_id, date)
);

-- Migration for pre-existing databases created before makeup_date was added.
alter table attendance_overrides add column if not exists makeup_date date;

-- Migration for pre-existing databases created before class_days_snapshot was added.
alter table attendance_overrides add column if not exists class_days_snapshot text[];

comment on column attendance_overrides.makeup_date is
  '결석(status=absent)에 대한 보강 예정 날짜. 그 날짜에 학생이 실제로 등원하면 보강완료로 표시됨.';

comment on column attendance_overrides.class_days_snapshot is
  '이 행이 마지막으로 생성/수정된 시점의 students.class_days 값. 등원 요일이 나중에 바뀌어도 "정규 수업일이었는지" 판정은 이 스냅샷을 기준으로 한다. 이 컬럼이 추가되기 전에 만들어진 뒤로 한 번도 다시 수정되지 않은 행은 null.';

create index if not exists attendance_overrides_student_id_idx
  on attendance_overrides (student_id);

-- ---------------------------------------------------------------------------
-- payment_cycle_start_date / get_student_session_counts — backs the "n회차"
-- badge on the admin dashboard's student list. Computed in SQL (one row per
-- student out) rather than pulling raw attendance rows into the app and
-- counting there, so the response size stays bounded by student count
-- instead of by attendance history length as the roster grows.
-- ---------------------------------------------------------------------------
create or replace function payment_cycle_start_date(payment_day integer, ref_date date)
returns date
language sql
immutable
as $$
  select case
    when extract(day from ref_date)::int >= least(
      payment_day,
      extract(day from (date_trunc('month', ref_date) + interval '1 month - 1 day'))::int
    )
    then date_trunc('month', ref_date)::date
      + (least(payment_day, extract(day from (date_trunc('month', ref_date) + interval '1 month - 1 day'))::int) - 1)
    else date_trunc('month', ref_date - interval '1 month')::date
      + (least(
          payment_day,
          extract(day from (date_trunc('month', ref_date - interval '1 month') + interval '1 month - 1 day'))::int
         ) - 1)
  end;
$$;

comment on function payment_cycle_start_date(integer, date) is
  '결제일(payment_day, 1~31)을 기준으로 ref_date가 속한 결제 주기의 시작일을 구한다. 그 달에 해당 일자가 없으면(예: 31일인데 2월) 그 달 마지막 날로 clamp.';

-- For each active student with a payment_day set: counts distinct dates,
-- since the most recent payment_day through today (both KST), where the
-- student is resolved "present" — a real check-in in attendance_records, or
-- a present override — with an attendance_overrides row always winning over
-- a check-in on the same date (matching the precedence used by the
-- per-student attendance calendar).
create or replace function get_student_session_counts()
returns table (student_id uuid, session_count integer)
language sql
stable
as $$
  with today as (
    select (now() at time zone 'Asia/Seoul')::date as d
  ),
  cycles as (
    select s.id as student_id, payment_cycle_start_date(s.payment_day, (select d from today)) as cycle_start
    from students s
    where s.is_active and s.payment_day is not null
  ),
  checkins as (
    select distinct ar.student_id, (ar.check_in_at at time zone 'Asia/Seoul')::date as d
    from attendance_records ar
    join cycles c on c.student_id = ar.student_id
    where (ar.check_in_at at time zone 'Asia/Seoul')::date >= c.cycle_start
  ),
  present_overrides as (
    select ao.student_id, ao.date as d
    from attendance_overrides ao
    join cycles c on c.student_id = ao.student_id
    where ao.status = 'present' and ao.date >= c.cycle_start and ao.date <= (select d from today)
  ),
  absent_overrides as (
    select ao.student_id, ao.date as d
    from attendance_overrides ao
    join cycles c on c.student_id = ao.student_id
    where ao.status = 'absent' and ao.date >= c.cycle_start and ao.date <= (select d from today)
  ),
  present_dates as (
    (select student_id, d from checkins union select student_id, d from present_overrides)
    except
    select student_id, d from absent_overrides
  )
  select c.student_id, count(pd.d)::int as session_count
  from cycles c
  left join present_dates pd on pd.student_id = c.student_id
  group by c.student_id;
$$;

comment on function get_student_session_counts() is
  '학생별 이번 결제 주기(가장 최근 결제일~오늘, KST) 출석일 수. 관리자 대시보드 "n회차" 배지용.';

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
-- Auto-absence at 22:05 KST — students whose today (KST) falls on one of
-- their class_days but who never checked in get marked absent automatically.
-- Runs a few minutes after the checkout job above so it never races it.
-- An existing override for today (whether admin-set present/absent, or one
-- this job already inserted) is left alone via on conflict do nothing, so an
-- admin's manual call always wins over the automatic one.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'auto-absence-2205-kst') then
    perform cron.unschedule('auto-absence-2205-kst');
  end if;
end $$;

select cron.schedule(
  'auto-absence-2205-kst',
  '5 13 * * *',
  $$
  insert into attendance_overrides (student_id, date, status, class_days_snapshot)
  select
    s.id,
    (now() + interval '9 hours')::date,
    'absent',
    s.class_days
  from students s
  where s.is_active
    and (
      case extract(dow from (now() + interval '9 hours')::date)
        when 1 then 'mon'
        when 2 then 'tue'
        when 3 then 'wed'
        when 4 then 'thu'
        when 5 then 'fri'
        when 6 then 'sat'
      end
    ) = any (s.class_days)
    and not exists (
      select 1 from attendance_records ar
      where ar.student_id = s.id
        and (ar.check_in_at + interval '9 hours')::date = (now() + interval '9 hours')::date
    )
    and not exists (
      select 1 from attendance_overrides ao
      where ao.student_id = s.id
        and ao.date = (now() + interval '9 hours')::date
    )
  on conflict (student_id, date) do nothing;
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
alter table attendance_overrides enable row level security;
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
