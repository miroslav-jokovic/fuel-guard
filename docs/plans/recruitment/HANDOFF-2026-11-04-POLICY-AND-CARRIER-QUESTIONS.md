# Handoff — 2026-11-04: drug-and-alcohol policy (DAP2) and carrier-written questions (CQ1/CQ2)

Paste this into a fresh chat. Plan of record: `docs/plans/recruitment/HIRING-WORKFLOW-AUDIT-2026-10-31.md`
**§15** (read §15.2 and §15.3 first) and its **§7 progress log** (append at the END).

## Where things stand

The owner ruled on 2026-11-04: Q-WF4b, Q-MT1, Q-OR7, Q-CE1/CE2, Q-RS2. Recorded in the plan.

| Item | State |
|---|---|
| Plan §15 (rulings + designs) | **#2008 MERGED** |
| IDP1 — `org_role_permissions` (migration **0564**, not 0563: leads chat took 0563) | **#2009 MERGED**, on staging |
| IDP2 — Settings → Permissions "Sensitive papers" card: who sees SSN-card/passport pictures (default admin + safety manager + recruiter; failed read = closed) | **#2016 MERGED** |
| Q-MT1 (no Spanish messages), Q-CE1/CE2 (as proposed) | recorded, nothing to build |
| **DAP1 — #2018 OPEN**, branch `claude/dap1-drug-alcohol-policy`, head `9329335`, worktree `../FuelGuard-dap` | CI was running at handoff; **merge it when green** (check migration 0565 by NAME against origin/main first) |
| DAP2 — the policy's reader | **next** |
| CQ1/CQ2 — carrier-written questions | after DAP2 |

## DAP1 (#2018) — what is in it

- The owner's 18-page **DRUG AND ALCOHOL ABUSE POLICY** scan (no text layer, sha256 96d8b63f…5a16a) transcribed verbatim to
  `apps/api/src/modules/recruiting/applicationPdf/drugAlcoholPolicy/drugAlcoholPolicyText.json`.
- `drugAlcoholPolicyCorrections.ts` — ~128 corrections applied on top via the handbook's `correctHandbook` (owner: *"yes correct
  this, we have to make sure all documents are really professional and precise"*, D-DAP6). Spelling, punctuation, CFR
  citation form, ~20 drafting fixes with reasons. No rule/number/cost changed. Throws at import if an entry stops fitting.
- `drugAlcoholPolicyText.ts` — `DRUG_ALCOHOL_POLICY_BLOCKS`, `DRUG_ALCOHOL_POLICY_VERSION` (`dap-` + 16 hex of the printed
  text), `DRUG_ALCOHOL_POLICY_DOCUMENT`. The last block is `{k:"sign", id:"p28"}` — DRIVER SIGNATURE / DATE.
- Handbook renderer generalised: `flowedDocumentPdf(document, input)` in `handbook/handbookPdf.ts` (`handbookPdf` unchanged
  output), new block kinds `item`, `grid`, and `p` flags `subheading`/`indent`/`tight`.
- **Migration 0565** `drug_alcohol_policy.sql`: `documents.kind` + `drug_alcohol_policy`; `application_packet_marks.policy_version`
  (CHECK `^dap-[0-9a-f]{16}$`); **14-argument `record_packet_mark`** (last arg `p_policy_version text`, no default):
  p28 without version → **DR039**, version on any other mark → **DR041**. The 13-arg overload is untouched (deploy window).
- TS mirror `CARRIER_POLICY_DOCUMENT_KINDS` in `packages/shared/src/complianceContract.ts`.
- Matrix `supabase/tests/drug-alcohol-policy.test.mjs` 11/11 (6/6 mutants killed); `signature-adoption.test.mjs` now expects
  two `record_packet_mark` overloads; `drugAlcoholPolicyText.test.ts` (8).

## DAP2 — build this next (plan §15.2 D-DAP2..D-DAP5)

A reader PR (no migration) on a new branch off `origin/main` after #2018 merges:

1. **Token route** `GET /api/public/application/:token/drug-alcohol-policy.pdf` — model it on
   `routes/publicApplicationHandbook.ts` (`/:token/handbook.pdf`): rendered on demand with the p28 mark if made, `no-store`.
   Mount beside it; same per-link rate bucket (`applicationLimits.ts`).
2. **p28 stamp**: `recordPacketMark` (`applicationPacketMarks.ts:226`, RPC call ~`:300`) switches to the 14-arg function and
   passes `DRUG_ALCOHOL_POLICY_VERSION` for `p28`, `null` otherwise. Update its tests (`applicationPacketMarks.test.ts`).
3. **Web, p28 screen**: `apps/web/src/features/apply/PacketCeremony.vue` (PlaceWalk ~`:216-243`) — for placement `p28` show
   "Read the drug and alcohol policy (13 pages)" opening the token PDF; **Sign disabled until opened** (client state). Spanish
   string in `es/strings.es.packet.ts` for the button/label only (the policy text stays English, Q-MT1).
4. **Filing**: when the packet files (`applicationPdf/file.ts` `ensureDriverFiledApplication` ~`:182-250`), render the policy
   with the p28 mark + adopted signature and file it on the driver as `documents.kind = 'drug_alcohol_policy'`, sha256 recorded,
   through the same evidence writer the filed packet uses. Idempotent on retry.
5. **Office**: the driver file / applicant Documents list must label the new kind ("Drug and alcohol policy (signed)"); find the
   kind-label map(s) in web. Optional: office preview of the blank policy in Settings → Recruiting (handbook preview precedent:
   `handbookPreview.ts`).
6. After DAP2 is the only caller of the 13-arg overload, a later migration drops it (note in the plan log).
7. Tests: route (bytes, 404/409), the stamp (p28 version, others null — mutate to prove), the web gate, the filing.

## CQ1/CQ2 — carrier-written questions (plan §15.3, D-CQ1..D-CQ5)

Explore report (done 2026-11-04) — the traps a design must cover:
- API checks are built once at start-up from `SILVICOM_DRIVER_V3` (answers schema `applicationContract.ts:326`, rules
  `applicationRules.ts:109`, requirable ids `applicationFormSettings.ts:45`); the answers schema is `.partial()` and not
  strict, so a DB-only question's answer would pass unchecked → carrier answers need their own field (`carrier_answers`)
  validated against the **stamp**.
- Filed PDF skips an unknown questionnaire ref (`questionnairePage.ts:83`); office drawer reads the served definition, not
  the application's (`ApplicationReviewDrawer.vue:83`); packet page 16 hard-codes Silvicom ids
  (`packet/packetFieldQuestionnaire.ts`).
- Precedent to copy: §10's `hiring_carrier_steps` (0545, retired-never-deleted, frozen columns, `carrierStepsContract.ts`,
  `routes/carrierSteps.ts`, `CarrierStepsEditor.vue`) and §11's stamp-at-first-Send (0550, `send_application_invitation`
  `p_required_questions`, `applicationSend.ts:100-107`, `applicationSubmit.ts:311`).
- **CQ1** migration: `recruiting_carrier_questions` (wording/kind/choices frozen, retired never deleted, ≤20 live),
  `application_invitations.carrier_questions jsonb` stamp, `send_application_invitation` widened with a defaulted
  `p_carrier_questions`. **CQ2** reader: contract, Settings → Recruiting "Your own questions", stamp at Send, wizard
  (English on the Spanish page too), validation at submit from the stamp, review, office drawer, filed PDF.

## Owner's open items (ask, don't assume)

- **Q-DAP2** — proofread the rendered policy against the paper (proof: render with `flowedDocumentPdf(DRUG_ALCOHOL_POLICY_DOCUMENT, …)`).
- **Q-DAP3** — the DER's name: policy says "Marija **Vermeda**", product applicant records say "Marija **Varmeda**". One is wrong;
  if Varmeda is right, add a correction entry.
- Cover clip-art and per-page INITIALS boxes were omitted (signature on the last page is the §382.601(d) receipt) — owner
  has not objected.
- Carried from before: PSP go-live settings (token expires ~12/12), first real Med-Stop order, HW6a QCMobile key.

## Working rules that bit this session

- **Migration numbers race** with parallel chats (0563 was taken mid-CI). Re-check by NAME right before merge.
- Work in a worktree off `origin/main`; never the main checkout (`claude/fleet-overview-v3` with untracked files lives there).
- **Never push while a rebase is stopped**; resolve, `rebase --continue`, re-run gates, then push.
- A soft reset across main moves stages reverse diffs of others' merges — use a patch from the branch's own base instead.
- Gates: `pnpm ci:local --job gates`, `--job matrices`, `node scripts/scan-secrets.mjs` after commit; full `pnpm ci:local` on a
  loaded machine times out a few unrelated suites — rerun those in isolation before calling them failures.
- A new table writer/route trips `routeGateLedger.test.ts`, the producer waiver list, `table-modules.json`, and the RLS seed.
- Mutate to prove every new test (memory: `prove-tests-fail-by-mutating`).
