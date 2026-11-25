-- 0650 — Driver safety training asks 3 questions after each SEGMENT of a film, not one quiz after the
-- film (SEGMENT-QUIZ-2026-11-25.md, D-TR13/D-TR14, the owner's "proceed as suggested", 2026-11-25).
--
-- Two columns and two defaults. Neither column has a reader yet: the code that reads them ships in the
-- next merge (lint:migration-ordering; MIGRATION-DISCIPLINE §the-deploy-window). Old code ignores both.
--
--   training_questions.point
--     Which of its segment's points a question tests. A segment asks 3 points; each point has two
--     versions (Q-TR12), so a driver who misses a point is asked the OTHER version after watching the
--     segment again — not the same question whose answer they could remember. 0 for every existing
--     row: before this, a question tested its chapter and nothing finer, and a chapter whose questions
--     all share point 0 behaves as one point (the API's draw treats it so until the office sets points).
--
--   training_attempts.answered_at
--     {"<questionId>": "<ISO time>"} — when each answer reached the server, beside `answers`. Progress
--     flags an answer that came under two seconds after the one before it (§3.1): a tap-through rather
--     than a read. Recorded, never refusing — a fast reader is not a cheat. Frozen with the rest of the
--     row at submit (TR032 already covers every column).
--
--   serve_count / pass_count default 3 / 3
--     Each segment asks 3 and moves on only with all 3 right (D-TR14). The columns now mean PER
--     SEGMENT. Existing versions keep what they have; a new upload gets the rule. No published version
--     exists anywhere yet (the module is off for every carrier), so nothing already graded changes meaning.

alter table public.training_questions
  add column if not exists point smallint not null default 0;

alter table public.training_questions
  drop constraint if exists training_questions_point_check;
alter table public.training_questions
  add constraint training_questions_point_check check (point between 0 and 9);

create index if not exists ix_training_questions_point on public.training_questions (version_id, chapter, point);

alter table public.training_attempts
  add column if not exists answered_at jsonb;

alter table public.training_attempts
  drop constraint if exists training_attempts_answered_at_check;
alter table public.training_attempts
  add constraint training_attempts_answered_at_check check (answered_at is null or jsonb_typeof(answered_at) = 'object');

alter table public.training_versions alter column serve_count set default 3;
alter table public.training_versions alter column pass_count set default 3;
