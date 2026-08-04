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

-- Migration for pre-existing databases created before start_date was added.
-- Backfilled from created_at for existing rows, then locked to NOT NULL —
-- every student must have a start date going forward.
alter table students add column if not exists start_date date;
update students set start_date = created_at::date where start_date is null;
alter table students alter column start_date set not null;

comment on column students.parent_phone is '보호자 전화번호 (하이픈 포함 원문, 예: 010-1234-5678)';
comment on column students.parent_phone_last4 is '키오스크 조회용 뒤 4자리 — parent_phone에서 자동 계산됨';
comment on column students.memo is '관리자 메모 (특이사항 등)';
comment on column students.class_days is '수업 요일(월~토) — mon/tue/wed/thu/fri/sat 값의 배열';
comment on column students.class_times is
  '요일별 등원 시간 — {"mon":"16:00","wed":"17:00"} 형태로 class_days에 포함된 요일만 키로 가짐. 관리자 일정 달력 표시용.';
comment on column students.payment_day is '매월 결제일 (1~31) — 출석 달력에 표시용, 선택 입력';
comment on column students.start_date is
  '학생 등록 시작일 — 결제 주기/회차 카운트가 시작되는 기준일. 이 날짜가 지나면(오늘 >= start_date) 관리자 화면에서 더 이상 수정할 수 없다(app 레이어에서 강제).';

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
-- student_cycle_boundaries / get_student_session_counts — backs the "n회차"
-- badge on the admin dashboard's student list. Computed in SQL (one row per
-- student out) rather than pulling raw attendance rows into the app and
-- counting there, so the response size stays bounded by student count
-- instead of by attendance history length as the roster grows.
-- ---------------------------------------------------------------------------
-- Superseded by students.start_date anchoring the first cycle boundary
-- directly (see student_cycle_boundaries below) — no longer called anywhere.
drop function if exists payment_cycle_start_date(integer, date);

-- Walks the student's cycle boundaries forward starting from the student's
-- start_date, delaying each naive monthly boundary by however many paused
-- days fall inside that cycle — so a pause doesn't just get excluded from
-- the count, it also pushes back the point where the NEXT cycle (and the
-- "n회차" reset that comes with it) begins. Stops as soon as a boundary
-- lands after ref_date, so cycle_start is always the start of whichever
-- (possibly delayed) cycle ref_date currently falls in — critically, this
-- does NOT jump past pre-pause days still inside the current cycle, unlike
-- a naive "shift start by total pause overlap" would; shifting the start
-- itself would silently drop pre-pause attendance from the count instead of
-- just skipping the paused days (already handled by the not-exists pause
-- checks in get_student_session_counts below). The very first boundary
-- computed from start_date checks whether payment_day still hasn't happened
-- yet in start_date's own month and uses that if so — e.g. starting the 2nd
-- with payment_day the 15th makes the first cycle end on that same month's
-- 15th, not skip ahead to next month's — while every later boundary (always
-- computed from an already payment_day-aligned v_start) falls through to
-- the next-month case exactly as before.
drop function if exists payment_cycle_start_date_for_student(uuid, date);

create or replace function student_cycle_boundaries(p_student_id uuid, ref_date date)
returns table (cycle_start date, next_cycle_start date)
language plpgsql
stable
as $$
declare
  v_payment_day integer;
  v_start_date date;
  v_start date;
  v_override_date date;
  v_this_month date;
  v_this_month_candidate date;
  v_next_month date;
  v_naive_next date;
  v_candidate_next date;
  v_next_candidate date;
  v_overlap integer;
begin
  select payment_day, start_date into v_payment_day, v_start_date from students where id = p_student_id;
  if v_payment_day is null or v_start_date > ref_date then
    return;
  end if;

  v_start := v_start_date;

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
      -- Try this month's payment_day occurrence first — only relevant on
      -- the very first cycle, where v_start is start_date and may fall
      -- before payment_day in its own month (e.g. start_date the 2nd,
      -- payment_day the 15th). On every later cycle v_start is already
      -- payment_day-aligned, so "this month's occurrence" equals v_start
      -- itself (not strictly after it) and this always falls through to
      -- the next-month branch below, same as before.
      v_this_month := date_trunc('month', v_start)::date;
      v_this_month_candidate := v_this_month
        + (least(
            v_payment_day,
            extract(day from (v_this_month + interval '1 month - 1 day'))::int
           ) - 1);

      if v_this_month_candidate > v_start then
        v_naive_next := v_this_month_candidate;
      else
        v_next_month := (v_this_month + interval '1 month')::date;
        v_naive_next := v_next_month
          + (least(
              v_payment_day,
              extract(day from (v_next_month + interval '1 month - 1 day'))::int
             ) - 1);
      end if;

      -- A single addition of "paused days inside [v_start, naive_next)" can
      -- undershoot when a pause is long enough to still cover the pushed-out
      -- date — the extra days added to escape the pause are themselves inside
      -- it, or inside a later pause the extension now reaches. Re-derive the
      -- overlap against the growing candidate and keep pushing until adding
      -- more paused days no longer moves it, i.e. a fixed point where the
      -- candidate finally lands clear of every pause it swept over.
      v_candidate_next := v_naive_next;
      loop
        select coalesce(sum(
          greatest(0, least(sp.paused_until, v_candidate_next - 1) - greatest(sp.paused_from, v_start) + 1)
        ), 0)
          into v_overlap
          from student_pauses sp
          where sp.student_id = p_student_id
            and sp.paused_until >= v_start
            and sp.paused_from < v_candidate_next;

        v_next_candidate := v_naive_next + v_overlap;
        exit when v_next_candidate = v_candidate_next;
        v_candidate_next := v_next_candidate;
      end loop;
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
  '학생의 등록 시작일(start_date)을 첫 사이클의 시작점으로 고정하고, 결제일(payment_day) 규칙과 정지 기간 지연을 반영해서 ref_date가 속한 결제 주기의 시작일과 다음 결제일을 함께 구한다. start_date가 ref_date보다 미래면 아직 시작된 사이클이 없으므로 빈 결과를 반환한다. 첫 사이클의 다음 결제일은 start_date가 속한 달의 payment_day가 아직 안 지났으면 그 날짜를, 이미 지났으면 다음 달의 payment_day를 쓴다(예: 2일에 등록, payment_day=15면 이번 달 15일이 다음 결제일). 정지가 있었던 기간만큼 다음 결제일이 뒤로 밀리며, 그 지연은 이후 주기에도 누적 반영된다. 밀린 날짜가 다시 (같거나 다른) 정지 기간과 겹치면 겹치지 않을 때까지 반복해서 더 밀어낸다. 매 단계마다 직전 시작일 이후 가장 가까운 student_payment_overrides 행이 있으면 그 날짜를 그대로 다음 결제일로 쓰고, 없으면 payment_day/정지 지연 계산을 쓴다. 읽기 전용이며, payment_day 갱신과 과거 회차 고정은 freeze_student_payment_history()가 담당한다.';

-- Read-only projection of the payment date for a given calendar month,
-- backing the attendance calendar's "이 달 결제일" display. Reuses
-- student_cycle_boundaries with ref_date pinned to the target month's last
-- day, so a pause's delay shows up on screen the moment it's registered —
-- not just after freeze_student_payment_history has a chance to commit it
-- in hindsight once the cycle is actually over. Returns null when the
-- resulting cycle_start doesn't land inside the requested month at all
-- (an edge case only reachable with pauses long enough to skip a month
-- entirely), leaving the caller to fall back to the naive payment_day clamp.
create or replace function projected_payment_date_for_month(p_student_id uuid, p_year int, p_month int)
returns date
language sql
stable
as $$
  select cycle_start
  from student_cycle_boundaries(p_student_id, (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date)
  where cycle_start >= make_date(p_year, p_month, 1)
    and cycle_start < (make_date(p_year, p_month, 1) + interval '1 month')::date
$$;

comment on function projected_payment_date_for_month(uuid, int, int) is
  '주어진 연/월에 대한 결제일을 정지 지연까지 반영해서 미리 계산한다(확정 여부와 무관). student_cycle_boundaries를 그대로 재사용하므로 이미 확정된 override가 있으면 그 값을, 없으면 payment_day + 정지 지연 계산 값을 돌려준다.';

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
  v_start_date date;
  v_start date;
  v_override_date date;
  v_this_month date;
  v_this_month_candidate date;
  v_next_month date;
  v_naive_next date;
  v_candidate_next date;
  v_next_candidate date;
  v_overlap integer;
  v_disturbed boolean;
  v_ref date;
begin
  v_ref := least(p_ref_date, (now() at time zone 'Asia/Seoul')::date - 1);

  select payment_day, start_date into v_payment_day, v_start_date from students where id = p_student_id;
  if v_payment_day is null or v_start_date > v_ref then
    return;
  end if;

  v_start := v_start_date;

  loop
    select min(payment_date) into v_override_date
      from student_payment_overrides
      where student_id = p_student_id and payment_date > v_start;

    if v_override_date is not null then
      v_candidate_next := v_override_date;
      v_disturbed := true;
    else
      -- See student_cycle_boundaries above for why this checks this month's
      -- payment_day occurrence before falling back to next month's.
      v_this_month := date_trunc('month', v_start)::date;
      v_this_month_candidate := v_this_month
        + (least(
            v_payment_day,
            extract(day from (v_this_month + interval '1 month - 1 day'))::int
           ) - 1);

      if v_this_month_candidate > v_start then
        v_naive_next := v_this_month_candidate;
      else
        v_next_month := (v_this_month + interval '1 month')::date;
        v_naive_next := v_next_month
          + (least(
              v_payment_day,
              extract(day from (v_next_month + interval '1 month - 1 day'))::int
             ) - 1);
      end if;

      -- See student_cycle_boundaries above for why this has to be a
      -- fixed-point loop rather than a single addition: a pause long enough
      -- to still cover the pushed-out candidate would otherwise get frozen
      -- into student_payment_overrides as a "confirmed" payment date that's
      -- still inside the pause.
      v_candidate_next := v_naive_next;
      loop
        select coalesce(sum(
          greatest(0, least(sp.paused_until, v_candidate_next - 1) - greatest(sp.paused_from, v_start) + 1)
        ), 0)
          into v_overlap
          from student_pauses sp
          where sp.student_id = p_student_id
            and sp.paused_until >= v_start
            and sp.paused_from < v_candidate_next;

        v_next_candidate := v_naive_next + v_overlap;
        exit when v_next_candidate = v_candidate_next;
        v_candidate_next := v_next_candidate;
      end loop;
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


