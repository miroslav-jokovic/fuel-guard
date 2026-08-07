# Loads & Dispatch — Decision Record (2026-08-07)

Decisions taken as PM on the findings in `LOADS-AUDIT-2026-08-07.md`. Each states the choice, the
reasoning, and the implementation consequence. Numbered `D-L*` to sit alongside the driver-app
`D-PM*` record without colliding. Locked unless Miki overrules.

---

## D-L1 · Proof-of-work photos become visible to dispatch — signed URLs, short TTL

**Decision.** Add photos to the dispatch load view: the API returns short-lived signed URLs per stop
photo (slot, captured-at, driver), and `LoadDetailPanel` renders them inline under each stop
alongside the required-slot pills it already shows.

**Why this shape.** The codebase already solved this exact problem for hazmat documents —
`hazmatLoads.ts:190` batch-signs with a **300-second TTL**. Reuse it rather than inventing: same
security posture (no public bucket, no long-lived links, nothing embedded in an email), same code
shape, one pattern for reviewers to learn. Photos are proof in a freight-claim dispute; they need to
be *inspectable*, not *downloadable-forever*.

**Consequence.** `dispatchLoads/queries.ts` joins `load_stop_photos`; a batch-sign step mirrors
hazmat's; the panel gets a thumbnail row with a lightbox. Driver-side upload path is unchanged.

## D-L2 · Exceptions becomes event-driven, not status-derived

**Decision.** Rebuild the Exceptions tab on `load_events` + duty state rather than on load columns.
Sources, all five per §14.9: declines, aging `pending_approval`, `equipment_mismatch` (D47),
`amended` (D48), and `auto_timeout` shifts (D44.5). Each row states what happened, when, and the one
action that resolves it (review diff / adopt equipment / acknowledge).

**Why.** The current `isException()` derives from `loads` columns, which is why it can only ever see
two of the five — the other three exist only as events. Deriving from the event log is also what
makes the tab *complete by construction*: a new event kind shows up rather than being silently
excluded.

**Consequence.** A new `GET /api/dispatch/exceptions` (events + duty joined, org-scoped, paginated)
rather than more client-side filtering of the loads list. The TMS amendment banner D48 promised comes
free from the same endpoint.

## D-L3 · All four behavioural matrices are repaired and wired into CI — before any Loads feature work

**Decision.** Phase L0, ahead of everything else: fix the stale filenames in
`load-lifecycle.test.mjs` and `duty-sessions.test.mjs`, extend `test:rls` to run **all four**
matrices, and record their true pass counts.

**Why this is first and not later.** Phase 9 established the rule the hard way: a suite that cannot
run is worse than no suite, because the ledger keeps quoting it and two real security leaks hid
behind exactly that. We are about to change the Loads lifecycle; doing so with its behavioural proof
dead would repeat the mistake deliberately. This is half a day and it makes every later phase
verifiable.

**Consequence.** `test:rls` runs four scripts. If a repaired matrix reveals failures — as the RLS one
did — those become findings, fixed on their merits, not silenced.

## D-L4 · One dispatch data layer, one assignments page — delete the duplicates

**Decision.** `features/dispatch/useDispatchLoads.ts` is the single loads data layer.
`features/dispatch/useAssignments.ts` is the single assignments data layer. Delete
`composables/useDispatchLoads.ts` and the unrouted `DispatchAssignmentsPage.vue`; fold anything the
survivors lack into them first.

**Why.** Two divergent copies of the same composable, one behind a page nothing routes to, is a bug
waiting for its first maintainer. The deletion is safe precisely because the dead page is
unreachable — but it must be a *deliberate* deletion with the diff checked, not a guess.

**Consequence.** Verify the two copies' divergences are all dead-side before removal (the audit
already lists them). `lint:boundaries` keeps feature isolation honest afterwards.

## D-L5 · D57 rate limits ship before `tab.loads` is switched on — per-`sub`, with business caps

**Decision.** Implement D57 as specified: per-JWT-`sub` buckets on driver writes
(`/me/shift/*` 10/min·60/day, `/me/loads/:id/{accept,decline,start}` 20/min·200/day,
`/me/loads/:id/stops/:stopId` 30/min·500/day), distinct error codes for "slow down" vs "daily
maximum", `429 + Retry-After` on both. Not negotiable before enabling Loads for real drivers.

**Why.** The plan already reasoned this out and called it a pre-3C blocker; nothing has changed
except that we now know it was never built. IP keying is actively wrong here — a depot behind one
NAT throttles its whole yard, which reads to drivers as "the app is broken".

**Consequence.** A `subKeyed` limiter factory in the API; the blanket `apiLimiter` stays as the
outer bound. Needs a small counter store for the daily caps (the jobs/queue table or a
`driver_write_counters` row — decide at build time, prefer reusing what exists).

## D-L6 · Assignments History is built; equipment reassign is deferred

**Decision.** Build the **History** tab (segments by driver / vehicle / trailer over a date range).
**Defer** equipment reassign-from-the-board and take-over conflict resolution.

**Why the split.** History is not a dispatch convenience — §14.9 designates it the attribution audit
trail that the detection engine's evidence panels cite, so anomaly investigations depend on it.
Equipment reassign duplicates something drivers already do correctly through check-in/swap, and its
absence has no downstream consumer. Also fixes the `driverId` vs `sessionId` param drift while in
there.

## D-L7 · Service-level tests for the dispatch engine are part of the work, not a follow-up

**Decision.** Every phase that touches `dispatchLoads` or `driverLoads` lands its own service tests
in the same change. Minimum bar before Loads goes on: the transition matrix through the service
(not just the shared contract), bulk partial-success, the audit + `load_events` write on every
mutation, and the D46 decline semantics for both driver populations.

**Why.** F7 and F3 compound: the most safety-critical code has both the least unit coverage and a
dead behavioural matrix. Tests written alongside are cheap; tests promised afterwards are the ones
this audit keeps finding missing.

## D-L8 · `load_changed` gets a producer, scoped to what actually affects the driver

**Decision.** Emit `load_changed` when a **released** load's driver-visible facts change — stops,
appointment windows, addresses, equipment, or an applied TMS amendment. Do **not** emit for
dispatch-internal edits (notes, billing refs) or for pre-release drafts.

**Why.** A load edited after it reached a phone is silently divergent, which is the failure D53
exists to prevent. Emitting on every field would train drivers to ignore the category.

**Consequence.** A field-diff check in the patch/amend path (the TMS ingest already computes a
field-level diff — reuse it), dedupe-keyed per load + change so a retry does not re-buzz.

## D-L9 · The bar for switching `tab.loads` ON

**Decision.** Loads goes on for a real org when, and only when: L0 (matrices green, all four in CI),
L1 (photos visible), L4 (rate limits live) are done, the migrations are applied, and the Loads rows
of the device matrix in `RELEASE-GATE.md` pass on hardware. F2/F8 (exceptions, `load_changed`) are
required before **wide** rollout but not before a **pilot** with one or two drivers, because a pilot
has a human watching who substitutes for the alerting.

**Why state it now.** D-PM1 made Loads a dashboard toggle; a toggle with no written bar gets flipped
on a good mood. This is the bar.

---

## Summary

| # | Decision |
|---|---|
| D-L1 | Dispatch sees stop photos via short-TTL signed URLs (reuse the hazmat pattern) |
| D-L2 | Exceptions rebuilt event-driven; all five sources incl. the D48 amendment banner |
| D-L3 | Repair + wire all four behavioural matrices FIRST |
| D-L4 | One loads composable, one assignments composable; delete the dead page + copy |
| D-L5 | D57 per-`sub` rate limits before Loads is enabled |
| D-L6 | Build Assignments History; defer equipment reassign |
| D-L7 | Service tests land with the code, not after |
| D-L8 | `load_changed` emitted for driver-visible changes on released loads only |
| D-L9 | Written exit bar for flipping `tab.loads` on (pilot vs wide) |
