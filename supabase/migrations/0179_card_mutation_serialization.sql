-- 0179 — one in-flight mutation per card, enforced by Postgres; a staleness clock for the mirror's
-- detail pass.
--
-- WHY THE UNIQUE INDEX (audit P0-5). `assertNoMutationInFlight` is a SELECT followed — seconds
-- later, after a paced vendor read — by the INSERT in `planCardMutation`. Two operators with
-- different Idempotency-Keys both pass the SELECT, both read the same card version (so the
-- expectedVersion 409 does not fire either), and dispatch two full-document writes where the second
-- silently reverts the first. setCardV2 is a full-document write: this is not two conflicting rows,
-- it is a card in a state nobody chose. The only guard that cannot race is the database's own:
-- at most one `pending` row per card, enforced here, with the service treating a 23505 on this
-- index as `mutation_in_flight`.
--
-- Scoped to `pending` only, NOT `sent`: `sent` is terminal-unknown and may stand for days; blocking
-- a card forever on an unverified outcome would trade a race for a lockout. The service's recency
-- window still covers `sent` rows, and the Phase-2 reconciler resolves them.
--
-- PRE-CLEAN. The index cannot build over historical duplicates, and an abandoned `pending` row
-- (process died between insert and dispatch) must not hold the card's slot forever. Rows older than
-- ten minutes have provably left their orchestration window (EFS_CARD_WRITE_TIMEOUT_MS caps at
-- 120s); they are settled as failed/abandoned rather than deleted — the ledger is evidence, and a
-- crashed attempt is exactly the kind of evidence worth keeping.

update efs_card_mutations
set status = 'failed',
    efs_fault_code = 'abandoned',
    efs_fault_message = 'Marked abandoned by migration 0179: the row was still pending long after '
      || 'any orchestration window, meaning the process died before recording an outcome.',
    completed_at = now()
where status = 'pending'
  and created_at < now() - interval '10 minutes';

-- Belt to the braces above: if two FRESH pending rows exist for one card (the exact race this
-- migration exists to close), keep the newest and settle the rest, so the index build cannot fail.
update efs_card_mutations m
set status = 'failed',
    efs_fault_code = 'abandoned',
    efs_fault_message = 'Superseded by a newer pending mutation on the same card (migration 0179).',
    completed_at = now()
where m.status = 'pending'
  and exists (
    select 1 from efs_card_mutations newer
    where newer.efs_card_id = m.efs_card_id
      and newer.status = 'pending'
      and newer.created_at > m.created_at
  );

create unique index if not exists uq_efs_card_mutations_one_pending
  on efs_card_mutations (efs_card_id)
  where status = 'pending';

-- WHY detail_synced_at (audit P0-7, second half). The roster pass stamps `synced_at` on EVERY card
-- every sweep, so it cannot tell the detail pass which documents are stale — and the detail pass
-- was taking the first EFS_CARD_SYNC_MAX_DETAIL cards in vendor order every night, leaving any card
-- past the budget with an empty document forever. This column is written ONLY by the detail pass
-- (refreshCardDetail / the post-mutation mirror update), so ordering by it nulls-first, oldest-next
-- makes the budget rotate: every card's document catches up across sweeps, as the sweep's own
-- header comment always claimed.

alter table efs_cards add column if not exists detail_synced_at timestamptz;

comment on column efs_cards.detail_synced_at is
  'When the DETAIL pass (getCardv2) last refreshed this row''s document. Distinct from synced_at, '
  'which the roster pass stamps on every card every sweep. Orders the detail budget stalest-first.';

create index if not exists idx_efs_cards_detail_staleness
  on efs_cards (org_id, detail_synced_at asc nulls first);
