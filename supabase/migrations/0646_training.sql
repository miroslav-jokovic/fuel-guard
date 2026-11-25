-- 0646 — Driver safety training: the films, their chapters and questions, who was sent them, and every
-- quiz a driver took (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS-2026-11-24.md §8–§9, rulings D-TR1…D-TR12).
--
-- ── WHAT THIS IS FOR ────────────────────────────────────────────────────────────────────────────
-- The Silvicom360 safety films (five locked, more coming) reach a driver as a link that opens a light
-- web page: the film plays in chapters, a quiz follows, a miss sends the driver back to the chapters it
-- came from (D-TR7, D-TR8). The office adds films, marks chapters, writes questions and sends the link
-- from Safety → Training (D-TR3, D-TR5). Everything a page needs to add more is a row here, never code.
--
-- ── SIX TABLES, ONE CHAIN ──────────────────────────────────────────────────────────────────────
--   training_courses    a list of films in order ("Defensive driving · Act I")
--   training_lessons    one film's place in a course; its content lives in versions
--   training_versions   one uploaded cut of a film: the files, the chapters, the quiz rule. Published
--                       is FROZEN — a remaster is a new version, so a record always names the cut a
--                       driver watched (§8.3). One published version per lesson and language.
--   training_questions  the pool a quiz is drawn from, each tagged with its chapter. Editable only
--                       while its version is unpublished; a published quiz never changes under a record.
--   training_assignments a driver sent a course (or some of its films), with a due date and the link.
--                       The link is a hash only (the applicant links' rule, `applicationLink.ts`).
--   training_progress   how much of a version a driver has watched — merged ranges, and the ranges
--                       watched since their last failed quiz (D-TR8 reopens only the missed chapters).
--   training_attempts   one quiz: which questions were served in which order, the answers, the score.
--                       Append-only once submitted, and in RETENTION_FORBIDDEN: it is the record.
--
-- ── WHY THE RULES ARE IN THE DATABASE ──────────────────────────────────────────────────────────
-- The frozen published version and the frozen submitted attempt are what make a completion record
-- worth anything, and the API reads with the service role, which bypasses RLS. So they are triggers,
-- which bind the service role too. Which version is current, whether a quiz is unlocked, and grading
-- are `@silvicom/shared` (`training/*.ts`), pure and tested there.
--
-- ── NO CLIENT POLICIES ─────────────────────────────────────────────────────────────────────────
-- RLS is on and nothing is granted to a client: the office reads through the API gated on the
-- `safety` section and the `training` module; the driver reads through the link, which is not a login.
--
-- ── THE BUCKET ─────────────────────────────────────────────────────────────────────────────────
-- D-TR1: our Supabase Storage, the same storage as the driver documents, in its own private bucket so
-- it has its own size limit and stays out of the evidence buckets' retention. 100 MB per object: a
-- locked 1080p master is 10–18 MB (measured 2026-11-24), so this leaves room for a longer film and
-- refuses a raw camera file. Every read and write is signed by the API.
--
-- ── WHAT WAS REJECTED ──────────────────────────────────────────────────────────────────────────
--   · The July micro-LMS's eleven tables (DRIVER-TRAINING-PLAN.md §4, numbered 0079–0081): segments
--     with their own videos, course-attempt resets after three fails (R3) and an event table. D-TR8
--     replaced R2/R3 for these films, and the office's acts go to `audit_logs` like every other module.
--   · `driver_id` on attempts. An attempt belongs to an assignment, which names the driver once; one
--     fewer foreign key for `merge_driver_v2` to move (`DRIVER_REASSIGNMENTS`).
--   · HLS. A whole film at 360p is 2.1 MB (§8.2); three plain MP4s with `+faststart` play on every
--     phone and are one object each.

insert into storage.buckets (id, name, public, file_size_limit)
values ('training-media', 'training-media', false, 100 * 1024 * 1024)
on conflict (id) do nothing;

-- ── courses ───────────────────────────────────────────────────────────────────────────────────
create table if not exists public.training_courses (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  title       text not null,
  description text,
  position    integer not null default 0,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  retired_at  timestamptz,
  constraint training_courses_title_check check (length(btrim(title)) between 1 and 120),
  constraint training_courses_description_check check (description is null or length(description) <= 600),
  constraint training_courses_position_check check (position between 0 and 1000)
);
create index if not exists ix_training_courses_org on public.training_courses (org_id, position);
alter table public.training_courses enable row level security;

-- ── lessons ───────────────────────────────────────────────────────────────────────────────────
create table if not exists public.training_lessons (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  course_id   uuid not null references public.training_courses(id),
  title       text not null,
  position    integer not null default 0,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  retired_at  timestamptz,
  constraint training_lessons_title_check check (length(btrim(title)) between 1 and 120),
  constraint training_lessons_position_check check (position between 0 and 1000)
);
create index if not exists ix_training_lessons_course on public.training_lessons (course_id, position);
alter table public.training_lessons enable row level security;

-- ── versions ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.training_versions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  lesson_id      uuid not null references public.training_lessons(id),
  version_no     integer not null,
  -- v1 is English; a Spanish cut is another version, never a schema change (§9, Q-TR6 open).
  language       text not null default 'en' check (language in ('en', 'es')),
  -- draft → processing → ready → published → withdrawn; processing → failed → (re-upload) processing.
  state          text not null default 'draft'
                 check (state in ('draft', 'processing', 'failed', 'ready', 'published', 'withdrawn')),
  source_path    text,
  source_bytes   bigint,
  source_sha256  text,
  duration_ms    integer,
  -- [{"height":360,"path":"…","bytes":2148215,"kbps":84}, …] — written by the transcode, read by the page.
  renditions     jsonb not null default '[]'::jsonb,
  poster_path    text,
  captions_path  text,
  -- [{"title":"Why space","startMs":8000}, …] in time order, the first may start after 0 (the intro).
  chapters       jsonb not null default '[]'::jsonb,
  -- The quiz rule (D-TR7/D-TR8): serve_count drawn from the pool, pass_count to pass.
  serve_count    integer not null default 5,
  pass_count     integer not null default 4,
  process_error  text,
  created_by     uuid not null,
  created_at     timestamptz not null default now(),
  published_at   timestamptz,
  published_by   uuid,
  withdrawn_at   timestamptz,
  withdrawn_by   uuid,
  constraint training_versions_no_check check (version_no between 1 and 10000),
  constraint training_versions_quiz_check check (serve_count between 1 and 20 and pass_count between 1 and serve_count),
  constraint training_versions_sha_check check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint training_versions_bytes_check check (source_bytes is null or source_bytes between 1 and 100 * 1024 * 1024),
  constraint training_versions_duration_check check (duration_ms is null or duration_ms between 1000 and 4 * 3600 * 1000),
  constraint training_versions_arrays_check check (jsonb_typeof(renditions) = 'array' and jsonb_typeof(chapters) = 'array'),
  constraint training_versions_error_check check (process_error is null or length(process_error) <= 500),
  -- A published version has everything a driver's page needs; nothing else may be published.
  constraint training_versions_published_shape check (
    state not in ('published', 'withdrawn')
    or (published_at is not null and published_by is not null and duration_ms is not null
        and source_path is not null and poster_path is not null and jsonb_array_length(renditions) > 0)
  ),
  constraint training_versions_withdrawn_shape check (
    (state = 'withdrawn') = (withdrawn_at is not null and withdrawn_by is not null)
  )
);
create unique index if not exists ux_training_versions_no on public.training_versions (lesson_id, version_no);
-- One live cut per film and language: publishing the next one withdraws this one in the same transaction.
create unique index if not exists ux_training_versions_published on public.training_versions (lesson_id, language) where state = 'published';
create index if not exists ix_training_versions_org on public.training_versions (org_id, lesson_id);
alter table public.training_versions enable row level security;

create or replace function public.training_version_guard() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.state in ('published', 'withdrawn') and exists (select 1 from organizations o where o.id = old.org_id) then
      raise exception 'a published training video is withdrawn, never deleted' using errcode = 'TR001';
    end if;
    return old;
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id or new.lesson_id is distinct from old.lesson_id
     or new.version_no is distinct from old.version_no then
    raise exception 'a training video version keeps its place' using errcode = 'TR002';
  end if;
  if old.state = 'withdrawn' then
    raise exception 'a withdrawn training video is never changed' using errcode = 'TR003';
  end if;
  if old.state = 'published' then
    -- The only change a published version accepts is being withdrawn.
    if new.state <> 'withdrawn'
       or new.language is distinct from old.language or new.source_path is distinct from old.source_path
       or new.source_bytes is distinct from old.source_bytes or new.source_sha256 is distinct from old.source_sha256
       or new.duration_ms is distinct from old.duration_ms or new.renditions is distinct from old.renditions
       or new.poster_path is distinct from old.poster_path or new.captions_path is distinct from old.captions_path
       or new.chapters is distinct from old.chapters or new.serve_count is distinct from old.serve_count
       or new.pass_count is distinct from old.pass_count or new.published_at is distinct from old.published_at
       or new.published_by is distinct from old.published_by or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'a published training video is never changed; upload a new version' using errcode = 'TR004';
    end if;
  end if;
  -- Publishing needs a quiz that can be served: at least serve_count live questions.
  if new.state = 'published' and old.state <> 'published' then
    if (select count(*) from training_questions q where q.version_id = new.id) < new.serve_count then
      raise exception 'this video needs at least % questions before it is published', new.serve_count using errcode = 'TR005';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_training_versions_guard on public.training_versions;
create trigger trg_training_versions_guard before update or delete on public.training_versions
  for each row execute function public.training_version_guard();

-- ── questions ─────────────────────────────────────────────────────────────────────────────────
create table if not exists public.training_questions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  version_id  uuid not null references public.training_versions(id) on delete cascade,
  -- Index into the version's `chapters`: a miss reopens this chapter (D-TR8).
  chapter     integer not null default 0,
  prompt      text not null,
  -- [{"id":"a","text":"About 419 feet"}, …] — 2 to 5 choices, ids a–e, shuffled per attempt.
  choices     jsonb not null,
  answer      text not null,
  why         text not null,
  position    integer not null default 0,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  constraint training_questions_chapter_check check (chapter between 0 and 50),
  constraint training_questions_prompt_check check (length(btrim(prompt)) between 3 and 400),
  constraint training_questions_why_check check (length(btrim(why)) between 3 and 400),
  constraint training_questions_choices_check check (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) between 2 and 5),
  constraint training_questions_answer_check check (answer in ('a', 'b', 'c', 'd', 'e')),
  constraint training_questions_position_check check (position between 0 and 1000)
);
create index if not exists ix_training_questions_version on public.training_questions (version_id, position);
alter table public.training_questions enable row level security;

-- A published (or withdrawn) version's quiz is what its records were graded against: frozen. A
-- version deleted while still a draft takes its questions with it (the cascade above).
create or replace function public.training_question_guard() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_state text;
  v_version uuid := case when tg_op = 'DELETE' then old.version_id else new.version_id end;
begin
  -- The organisation going away takes everything, frozen or not (0627's exemption).
  if tg_op = 'DELETE' and not exists (select 1 from organizations o where o.id = old.org_id) then
    return old;
  end if;
  select state into v_state from training_versions where id = v_version;
  if v_state in ('published', 'withdrawn') then
    raise exception 'the questions of a published training video are never changed; upload a new version' using errcode = 'TR010';
  end if;
  if tg_op = 'UPDATE' and old.version_id is distinct from new.version_id then
    raise exception 'a question stays with its video' using errcode = 'TR011';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists trg_training_questions_guard on public.training_questions;
create trigger trg_training_questions_guard before insert or update or delete on public.training_questions
  for each row execute function public.training_question_guard();

-- ── assignments ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.training_assignments (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  -- No cascade: a merge that forgot DRIVER_REASSIGNMENTS stops at the driver delete instead of losing the
  -- record. NO ACTION rather than RESTRICT, so an organisation's own cascade (checked at statement end)
  -- can still take its rows.
  driver_id        uuid not null references public.drivers(id),
  course_id        uuid not null references public.training_courses(id),
  -- Null = the whole course; otherwise the films sent for retraining after an event.
  lesson_ids       uuid[],
  due_on           date,
  -- sha256 hex of the link's token; the token itself exists only in what was sent.
  token_hash       text not null,
  link_expires_at  timestamptz not null,
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  last_sent_at     timestamptz,
  last_sent_via    text check (last_sent_via in ('sms', 'email', 'copy')),
  first_opened_at  timestamptz,
  completed_at     timestamptz,
  revoked_at       timestamptz,
  revoked_by       uuid,
  constraint training_assignments_token_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint training_assignments_lessons_check check (lesson_ids is null or cardinality(lesson_ids) between 1 and 100),
  constraint training_assignments_revoked_together check ((revoked_at is null) = (revoked_by is null))
);
create unique index if not exists ux_training_assignments_token on public.training_assignments (token_hash);
create index if not exists ix_training_assignments_org on public.training_assignments (org_id, created_at desc);
create index if not exists ix_training_assignments_driver on public.training_assignments (driver_id);
alter table public.training_assignments enable row level security;

-- The driver and the course a record is about are fixed — except a roster merge moving the driver to
-- the surviving record of the same carrier (`DRIVER_REASSIGNMENTS`, 0264's model).
create or replace function public.training_assignment_guard() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from organizations o where o.id = old.org_id) then
      raise exception 'a training assignment is revoked, never deleted' using errcode = 'TR020';
    end if;
    return old;
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id or new.course_id is distinct from old.course_id
     or new.lesson_ids is distinct from old.lesson_ids or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'a training assignment keeps what was sent; send a new one' using errcode = 'TR021';
  end if;
  if new.driver_id is distinct from old.driver_id
     and not exists (select 1 from drivers d where d.id = new.driver_id and d.org_id = old.org_id) then
    raise exception 'a training assignment moves only to a driver of the same carrier' using errcode = 'TR022';
  end if;
  if old.revoked_at is not null and (new.revoked_at is distinct from old.revoked_at or new.token_hash is distinct from old.token_hash) then
    raise exception 'a revoked training link stays revoked' using errcode = 'TR023';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_training_assignments_guard on public.training_assignments;
create trigger trg_training_assignments_guard before update or delete on public.training_assignments
  for each row execute function public.training_assignment_guard();

-- ── progress ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.training_progress (
  assignment_id  uuid not null references public.training_assignments(id) on delete cascade,
  version_id     uuid not null references public.training_versions(id),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  -- Merged [[startMs, endMs], …] ever watched, and since the last failed quiz (D-TR8).
  watched        jsonb not null default '[]'::jsonb,
  watched_since  jsonb not null default '[]'::jsonb,
  position_ms    integer not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (assignment_id, version_id),
  constraint training_progress_arrays_check check (jsonb_typeof(watched) = 'array' and jsonb_typeof(watched_since) = 'array'),
  constraint training_progress_position_check check (position_ms between 0 and 4 * 3600 * 1000)
);
create index if not exists ix_training_progress_org on public.training_progress (org_id);
alter table public.training_progress enable row level security;

-- ── attempts ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.training_attempts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  assignment_id    uuid not null references public.training_assignments(id),
  version_id       uuid not null references public.training_versions(id),
  -- [{"questionId":"…","order":["c","a","b"]}, …] — exactly what was shown, so the record can be rebuilt.
  served           jsonb not null,
  started_at       timestamptz not null default now(),
  -- {"<questionId>":"a", …}, filled one answer at a time (the page shows why after each); frozen at submit.
  answers          jsonb,
  correct          integer,
  passed           boolean,
  missed_chapters  integer[],
  submitted_at     timestamptz,
  constraint training_attempts_answers_check check (answers is null or jsonb_typeof(answers) = 'object'),
  constraint training_attempts_served_check check (jsonb_typeof(served) = 'array' and jsonb_array_length(served) between 1 and 20),
  constraint training_attempts_submitted_shape check (
    (submitted_at is null and correct is null and passed is null and missed_chapters is null)
    or (submitted_at is not null and answers is not null and correct is not null and passed is not null and missed_chapters is not null
        and correct between 0 and jsonb_array_length(served))
  )
);
-- One open quiz per driver and film: a second "start" returns the open one (the API's job; the index holds it).
create unique index if not exists ux_training_attempts_open on public.training_attempts (assignment_id, version_id) where submitted_at is null;
create index if not exists ix_training_attempts_assignment on public.training_attempts (assignment_id, started_at);
create index if not exists ix_training_attempts_org on public.training_attempts (org_id, started_at desc);
alter table public.training_attempts enable row level security;

create or replace function public.training_attempt_guard() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from organizations o where o.id = old.org_id) then
      raise exception 'a training quiz is a record and is never deleted' using errcode = 'TR030';
    end if;
    return old;
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id or new.assignment_id is distinct from old.assignment_id
     or new.version_id is distinct from old.version_id or new.served is distinct from old.served
     or new.started_at is distinct from old.started_at then
    raise exception 'a training quiz keeps what it served' using errcode = 'TR031';
  end if;
  if old.submitted_at is not null then
    raise exception 'a submitted training quiz is never changed' using errcode = 'TR032';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_training_attempts_guard on public.training_attempts;
create trigger trg_training_attempts_guard before update or delete on public.training_attempts
  for each row execute function public.training_attempt_guard();

-- Trigger functions only; nothing here is a client's to call (0412's default, stated).
revoke all on function public.training_version_guard() from public, anon, authenticated;
revoke all on function public.training_question_guard() from public, anon, authenticated;
revoke all on function public.training_assignment_guard() from public, anon, authenticated;
revoke all on function public.training_attempt_guard() from public, anon, authenticated;

-- ── publishing, in one transaction ─────────────────────────────────────────────────────────────
-- A remaster replaces the live cut: the old one is withdrawn and the new one published together, or
-- neither (the unique index allows one published cut per film and language, so two statements from the
-- API would leave a gap with no live cut, or fail half-way). Called by the API with the service role.
-- Returns the withdrawn version's id, or null when there was none. Refusals keep the triggers' codes.
create or replace function public.training_publish_version(p_org uuid, p_version uuid, p_actor uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_lesson uuid;
  v_language text;
  v_state text;
  v_old uuid;
begin
  select lesson_id, language, state into v_lesson, v_language, v_state
    from training_versions where id = p_version and org_id = p_org for update;
  if v_lesson is null then
    raise exception 'no such training video' using errcode = 'TR040';
  end if;
  if v_state <> 'ready' then
    raise exception 'only a video that finished processing can be published (it is %)', v_state using errcode = 'TR041';
  end if;
  select id into v_old from training_versions
    where org_id = p_org and lesson_id = v_lesson and language = v_language and state = 'published' for update;
  if v_old is not null then
    update training_versions set state = 'withdrawn', withdrawn_at = now(), withdrawn_by = p_actor where id = v_old;
  end if;
  update training_versions set state = 'published', published_at = now(), published_by = p_actor where id = p_version;
  return v_old;
end;
$$;
revoke all on function public.training_publish_version(uuid, uuid, uuid) from public, anon, authenticated;
