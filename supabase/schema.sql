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

-- Migration for pre-existing databases created before class_times was added.
alter table students add column if not exists class_times jsonb not null default '{}'::jsonb;

comment on column students.parent_phone is '보호자 전화번호 (하이픈 포함 원문, 예: 010-1234-5678)';
comment on column students.parent_phone_last4 is '키오스크 조회용 뒤 4자리 — parent_phone에서 자동 계산됨';
comment on column students.memo is '관리자 메모 (특이사항 등)';
comment on column students.class_days is '수업 요일(월~토) — mon/tue/wed/thu/fri/sat 값의 배열';
comment on column students.class_times is
  '요일별 등원 시간 — {"mon":"16:00","wed":"17:00"} 형태로 class_days에 포함된 요일만 키로 가짐. 관리자 일정 달력 표시용.';
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

-- Migration for pre-existing databases created before makeup_time was added.
alter table attendance_overrides add column if not exists makeup_time text;

comment on column attendance_overrides.makeup_date is
  '결석(status=absent)에 대한 보강 예정 날짜. 그 날짜에 학생이 실제로 등원하면 보강완료로 표시됨.';

comment on column attendance_overrides.makeup_time is
  'makeup_date에 예정된 보강 수업 시간 ("HH:MM"). makeup_date가 null이면 항상 null.';

comment on column attendance_overrides.class_days_snapshot is
  '이 행이 마지막으로 생성/수정된 시점의 students.class_days 값. 등원 요일이 나중에 바뀌어도 "정규 수업일이었는지" 판정은 이 스냅샷을 기준으로 한다. 이 컬럼이 추가되기 전에 만들어진 뒤로 한 번도 다시 수정되지 않은 행은 null.';

create index if not exists attendance_overrides_student_id_idx
  on attendance_overrides (student_id);

-- Backs the admin-wide schedule calendar (app/admin/dashboard/schedule), which
-- queries across ALL students by date/makeup_date range rather than by
-- student_id first, unlike every other query against this table.
create index if not exists attendance_overrides_date_idx
  on attendance_overrides (date);

-- ---------------------------------------------------------------------------
-- student_pauses — admin-registered "정지" (leave of absence) periods, always
-- entered with both boundary dates up front. Nothing is managed for a
-- student during a pause: no session counting, no auto-absence, no makeup
-- scheduling. paused_until can be edited later (extended or shortened) if
-- the student's actual return date differs from what was planned.
-- ---------------------------------------------------------------------------
create table if not exists student_pauses (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students (id) on delete cascade,
  paused_from date not null,
  paused_until date not null,
  created_at timestamptz not null default now(),
  check (paused_until >= paused_from)
);

create index if not exists student_pauses_student_id_idx on student_pauses (student_id);

comment on table student_pauses is
  '학생별 정지(휴원) 기간. 이 기간의 날짜는 결제 주기 계산, 회차 카운팅, 자동 결석 처리에서 완전히 제외된다.';

-- ---------------------------------------------------------------------------
-- student_payment_overrides — a student's confirmed payment dates, as a
-- flat chronological list (no calendar-month key). Some rows are entered
-- directly by an admin ahead of time ("the next payment is actually on the
-- 20th"); others are frozen in automatically by freeze_student_payment_history
-- once a past cycle resolves. Either way, student_cycle_boundaries treats
-- the nearest row after its current step as authoritative, so a payment date
-- that moves is free to land more or less than a month away from the
-- previous one — see student_cycle_boundaries for why a calendar-month key
-- doesn't work here (a long pause can push a boundary across months, or
-- skip a month with no boundary in it at all).
-- ---------------------------------------------------------------------------
create table if not exists student_payment_overrides (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students (id) on delete cascade,
  payment_date date not null,
  created_at timestamptz not null default now()
);

-- Migration for pre-existing databases created before this table dropped
-- cycle_month (one-row-per-calendar-month) in favor of the flat chronological
-- list described above.
alter table student_payment_overrides drop constraint if exists student_payment_overrides_student_id_cycle_month_key;
alter table student_payment_overrides drop column if exists cycle_month;

create index if not exists student_payment_overrides_student_id_idx
  on student_payment_overrides (student_id);

-- Unique index rather than a table constraint so it can be added
-- idempotently on pre-existing databases (see migration above) and so it
-- doubles as the on-conflict target for the inserts in
-- freeze_student_payment_history.
create unique index if not exists student_payment_overrides_student_id_payment_date_idx
  on student_payment_overrides (student_id, payment_date);

comment on table student_payment_overrides is
  '학생별 확정된 결제일들의 시간순 기록(달 단위 키 없음). 관리자가 특정 회차의 실제 결제일을 미리 지정해두거나, freeze_student_payment_history()가 이미 지난 회차의 실제 결제일을 조회 시점에 자동으로 기록한다. student_cycle_boundaries는 매 단계 직전 시작일 이후 가장 가까운 이 테이블의 날짜를 다음 결제일로 우선 사용하고, 없으면 payment_day + 정지 지연으로 계산한다.';

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

-- Walks the student's cycle boundaries forward, month by month from a seed
-- date safely before any of their pauses, delaying each naive monthly
-- boundary by however many paused days fall inside that cycle — so a pause
-- doesn't just get excluded from the count, it also pushes back the point
-- where the NEXT cycle (and the "n회차" reset that comes with it) begins.
-- Stops as soon as a boundary lands after ref_date, so cycle_start is always
-- the start of whichever (possibly delayed) cycle ref_date currently falls
-- in — critically, this does NOT jump past pre-pause days still inside the
-- current cycle, unlike a naive "shift start by total pause overlap" would;
-- shifting the start itself would silently drop pre-pause attendance from
-- the count instead of just skipping the paused days (already handled by
-- the not-exists pause checks in get_student_session_counts below).
drop function if exists payment_cycle_start_date_for_student(uuid, date);

create or replace function student_cycle_boundaries(p_student_id uuid, ref_date date)
returns table (cycle_start date, next_cycle_start date)
language plpgsql
stable
as $$
declare
  v_payment_day integer;
  v_seed date;
  v_start date;
  v_override_date date;
  v_next_month date;
  v_naive_next date;
  v_candidate_next date;
  v_overlap integer;
begin
  select payment_day into v_payment_day from students where id = p_student_id;
  if v_payment_day is null then
    return;
  end if;

  -- Bounded by ref_date as well as the earliest pause: a pause registered
  -- entirely in the future (the normal case — pauses are always registered
  -- with both dates up front, often before they start) must not push the
  -- seed past today, or the walk below starts from a cycle that's already
  -- ahead of ref_date and never finds today's real cycle_start.
  select least(ref_date, coalesce(min(sp.paused_from), ref_date)) - 40 into v_seed
    from student_pauses sp
    where sp.student_id = p_student_id;

  v_start := payment_cycle_start_date(v_payment_day, v_seed);

  loop
    -- The nearest confirmed payment date after the current start is
    -- authoritative — whether an admin entered it ahead of time or
    -- freeze_student_payment_history recorded it once a past cycle
    -- resolved — used as-is regardless of which calendar month it falls
    -- in, so it's never missed by a pause or a prior override that already
    -- pushed the walk across a month boundary.
    select min(payment_date) into v_override_date
      from student_payment_overrides
      where student_id = p_student_id and payment_date > v_start;

    if v_override_date is not null then
      v_candidate_next := v_override_date;
    else
      v_next_month := (date_trunc('month', v_start) + interval '1 month')::date;
      v_naive_next := v_next_month
        + (least(
            v_payment_day,
            extract(day from (v_next_month + interval '1 month - 1 day'))::int
           ) - 1);

      select coalesce(sum(
        greatest(0, least(sp.paused_until, v_naive_next - 1) - greatest(sp.paused_from, v_start) + 1)
      ), 0)
        into v_overlap
        from student_pauses sp
        where sp.student_id = p_student_id
          and sp.paused_until >= v_start
          and sp.paused_from < v_naive_next;

      v_candidate_next := v_naive_next + v_overlap;
    end if;

    exit when v_candidate_next > ref_date;
    v_start := v_candidate_next;
  end loop;

  cycle_start := v_start;
  next_cycle_start := v_candidate_next;
  return next;
end;
$$;

comment on function student_cycle_boundaries(uuid, date) is
  '학생의 결제일(payment_day) 규칙에 정지 기간 지연을 반영해서, ref_date가 속한 결제 주기의 시작일과 다음 결제일을 함께 구한다. 정지가 있었던 기간만큼 다음 결제일이 뒤로 밀리며, 그 지연은 이후 주기에도 누적 반영된다. 매 단계마다 직전 시작일 이후 가장 가까운 student_payment_overrides 행이 있으면 그 날짜를 그대로 다음 결제일로 쓰고, 없으면 payment_day/정지 지연 계산을 쓴다. 읽기 전용이며, payment_day 갱신과 과거 회차 고정은 freeze_student_payment_history()가 담당한다.';

-- Write-through counterpart to student_cycle_boundaries above: walks the
-- exact same sequence of boundaries, but for every step definitively in the
-- past relative to p_ref_date (capped at yesterday KST, so today's still-open
-- cycle is never touched), persists it into student_payment_overrides — a
-- no-op via on-conflict if already frozen — and updates students.payment_day
-- to that step's day-of-month. That last part is what makes a payment date
-- that moved (pause delay or an admin override) become the new ongoing
-- default for future, still-unresolved cycles instead of snapping back to
-- whatever payment_day used to be. Called lazily from the app whenever a
-- student's attendance calendar is opened, not on a schedule — most calls
-- just re-confirm already-frozen steps via the override lookup and do
-- nothing further, so this is cheap after the first catch-up run.
create or replace function freeze_student_payment_history(p_student_id uuid, p_ref_date date)
returns void
language plpgsql
as $$
declare
  v_payment_day integer;
  v_seed date;
  v_start date;
  v_override_date date;
  v_next_month date;
  v_naive_next date;
  v_candidate_next date;
  v_overlap integer;
  v_disturbed boolean;
  v_ref date;
begin
  v_ref := least(p_ref_date, (now() at time zone 'Asia/Seoul')::date - 1);

  select payment_day into v_payment_day from students where id = p_student_id;
  if v_payment_day is null then
    return;
  end if;

  select least(v_ref, coalesce(min(sp.paused_from), v_ref)) - 40 into v_seed
    from student_pauses sp
    where sp.student_id = p_student_id;

  v_start := payment_cycle_start_date(v_payment_day, v_seed);

  loop
    select min(payment_date) into v_override_date
      from student_payment_overrides
      where student_id = p_student_id and payment_date > v_start;

    if v_override_date is not null then
      v_candidate_next := v_override_date;
      v_disturbed := true;
    else
      v_next_month := (date_trunc('month', v_start) + interval '1 month')::date;
      v_naive_next := v_next_month
        + (least(
            v_payment_day,
            extract(day from (v_next_month + interval '1 month - 1 day'))::int
           ) - 1);

      select coalesce(sum(
        greatest(0, least(sp.paused_until, v_naive_next - 1) - greatest(sp.paused_from, v_start) + 1)
      ), 0)
        into v_overlap
        from student_pauses sp
        where sp.student_id = p_student_id
          and sp.paused_until >= v_start
          and sp.paused_from < v_naive_next;

      v_candidate_next := v_naive_next + v_overlap;
      -- A plain month-length clamp (e.g. payment_day=31 landing on Feb 28)
      -- is NOT a disturbance — payment_day must stay 31 so March goes back
      -- to the 31st, not get permanently narrowed to 28.
      v_disturbed := v_overlap > 0;
    end if;

    exit when v_candidate_next > v_ref;

    insert into student_payment_overrides (student_id, payment_date)
    values (p_student_id, v_candidate_next)
    on conflict (student_id, payment_date) do nothing;

    if v_disturbed then
      v_payment_day := extract(day from v_candidate_next)::int;
      update students
        set payment_day = v_payment_day
        where id = p_student_id and payment_day is distinct from v_payment_day;
    end if;

    v_start := v_candidate_next;
  end loop;
end;
$$;

comment on function freeze_student_payment_history(uuid, date) is
  'p_ref_date(오늘 KST 이전으로 clamp됨)까지, 아직 기록이 없는 과거 결제 주기 경계들을 순서대로 student_payment_overrides에 고정 저장한다. override가 있었거나 정지 overlap이 실제로 있었던(진짜로 밀린) 회차만 students.payment_day도 그 실제 결제일의 일(day)로 갱신하고, 그냥 짧은 달이라 clamp만 된 경우는 payment_day를 건드리지 않는다(예: 31일 결제 학생이 2월을 지나도 28로 영구히 줄어들지 않음). 이미 고정된 단계는 조회만 하고 넘어가므로 재호출은 비용이 거의 없다.';

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
    select s.id as student_id, b.cycle_start
    from students s
    cross join lateral student_cycle_boundaries(s.id, (select d from today)) b
    where s.is_active and s.payment_day is not null
  ),
  checkins as (
    select distinct ar.student_id, (ar.check_in_at at time zone 'Asia/Seoul')::date as d
    from attendance_records ar
    join cycles c on c.student_id = ar.student_id
    where (ar.check_in_at at time zone 'Asia/Seoul')::date >= c.cycle_start
      and not exists (
        select 1 from student_pauses sp
        where sp.student_id = ar.student_id
          and (ar.check_in_at at time zone 'Asia/Seoul')::date between sp.paused_from and sp.paused_until
      )
  ),
  present_overrides as (
    select ao.student_id, ao.date as d
    from attendance_overrides ao
    join cycles c on c.student_id = ao.student_id
    where ao.status = 'present' and ao.date >= c.cycle_start and ao.date <= (select d from today)
      and not exists (
        select 1 from student_pauses sp
        where sp.student_id = ao.student_id and ao.date between sp.paused_from and sp.paused_until
      )
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
  '학생별 이번 결제 주기(정지 기간의 지연이 반영된 시작일~오늘, KST) 출석일 수. 관리자 대시보드 "n회차" 배지용.';

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
-- admin's manual call always wins over the automatic one. Students currently
-- inside a student_pauses range are skipped entirely — a pause means nothing
-- is managed for that student, including auto-absence.
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
    and not exists (
      select 1 from student_pauses sp
      where sp.student_id = s.id
        and (now() + interval '9 hours')::date between sp.paused_from and sp.paused_until
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
alter table student_pauses enable row level security;
alter table student_payment_overrides enable row level security;
alter table app_settings enable row level security;


