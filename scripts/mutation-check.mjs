#!/usr/bin/env node
/**
 * Mutation harness: does the safety net still bite? (audit 2026-08-09, Stage 2.6)
 *
 * WHY THIS EXISTS. A test suite reports on itself. It says "290 passed" whether or not those 290
 * assertions would notice a real defect, and the failure is invisible from the inside — a matrix
 * that has quietly stopped testing anything looks exactly like a matrix that passes. That is not
 * hypothetical here. Before Stage 2, seeding `using (true)` into three of the most sensitive SELECT
 * policies in the schema — every org's fuel data, driver PII and anomalies world-readable — changed
 * the RLS matrix's output not at all: 209 passed, 0 failed, byte-identical to a clean run. Four of
 * six seeded regressions survived.
 *
 * The fix for that was better assertions. THIS file is what stops those assertions from rotting: it
 * breaks the code on purpose, in ways that mirror defects this codebase has actually shipped, and
 * requires the suite to go red. A mutation that SURVIVES is a hole in the net, reported as a failure.
 *
 * Two rules that make the harness honest:
 *   1. A mutation whose pattern no longer matches is a FAILURE, not a skip. Code moves; a stale
 *      mutation silently tests nothing, which is the exact disease being treated.
 *   2. A detection command that fails to START is a FAILURE, not a skip. "The runner was missing so
 *      we passed" is how the driver app went 24 tests without executing any of them.
 *
 * The two `api-*` mutations shell out to pnpm, so they only run where the workspace is installed —
 * in CI, and on a machine that has run `pnpm install`. Where pnpm is absent they report ERROR, not
 * "skipped": a check that cannot run has not passed, and saying otherwise is how this repository lost
 * 24 driver tests for months.
 *
 * Usage:
 *   node scripts/mutation-check.mjs                # everything (CI)
 *   node scripts/mutation-check.mjs --only=rls-    # substring filter, for local iteration
 *   node scripts/mutation-check.mjs --list
 *
 * Mutations are applied IN PLACE and restored in a `finally`, with the restore verified by content
 * hash. The harness refuses to run when a target file already differs from git HEAD, so it can never
 * clobber uncommitted work — pass --allow-dirty only if you know why.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const sha = (s) => createHash("sha256").update(s).digest("hex");

/** Detection commands. Each must EXIT NON-ZERO when the mutation is present. */
const RLS_MATRIX = ["node", ["supabase/tests/rls.test.mjs"]];
const HAZMAT_MATRIX = ["node", ["supabase/tests/hazmat_rls.test.mjs"]];
const TRIGGERS_MATRIX = ["node", ["supabase/tests/efs-card-control-triggers.test.mjs"]];
const apiTest = (f) => ["pnpm", ["--filter", "@silvicom/api", "exec", "vitest", "run", f]];
const sharedTest = (f) => ["pnpm", ["--filter", "@silvicom/shared", "exec", "vitest", "run", f]];
const webTest = (f) => ["pnpm", ["--filter", "@silvicom/web", "exec", "vitest", "run", f]];

const MUTATIONS = [
  // ── tenant isolation in the database ────────────────────────────────────────
  {
    id: "rls-ftxn-select-open",
    why: "Every org's fuel transactions become world-readable. Survived the pre-Stage-2 matrix.",
    file: "supabase/migrations/0004_rls.sql",
    find: "create policy ftxn_select on fuel_transactions\n  for select using (org_id = auth_org_id());",
    replace: "create policy ftxn_select on fuel_transactions\n  for select using (true);",
    detect: RLS_MATRIX,
  },
  {
    id: "rls-drivers-select-open",
    why: "Every org's driver PII becomes world-readable. Survived the pre-Stage-2 matrix.",
    file: "supabase/migrations/0004_rls.sql",
    find: "create policy drivers_select on drivers\n  for select using (org_id = auth_org_id());",
    replace: "create policy drivers_select on drivers\n  for select using (true);",
    detect: RLS_MATRIX,
  },
  {
    id: "rls-anomalies-select-open",
    why: "Every org's theft alerts become world-readable. Survived the pre-Stage-2 matrix.",
    file: "supabase/migrations/0004_rls.sql",
    find: "create policy anomalies_select on anomalies\n  for select using (org_id = auth_org_id());",
    replace: "create policy anomalies_select on anomalies\n  for select using (true);",
    detect: RLS_MATRIX,
  },
  {
    id: "anon-lockout-imports-open",
    why:
      "Opens a table that has no restrictive policy behind it, so the leak reaches an " +
      "UNAUTHENTICATED caller holding only the publishable anon key. Positive control for the anon " +
      "sweep — the cross-tenant mutations above are all on tables where 0083's restrictive driver " +
      "policies still block anon, so they do not exercise it.",
    file: "supabase/migrations/0007_imports.sql",
    find: "create policy imports_select on imports for select using (org_id = auth_org_id());",
    replace: "create policy imports_select on imports for select using (true);",
    detect: RLS_MATRIX,
  },
  // ── the Stage 1 fixes ───────────────────────────────────────────────────────
  {
    id: "definer-revoke-removed",
    why: "Restores the state 0162 fixed: SECURITY DEFINER RPCs taking (p_org, p_user) callable by anon.",
    file: "supabase/migrations/0162_definer_exposure_closure.sql",
    find: "execute format('revoke all on function %s from public, anon, authenticated', sig);",
    replace: "-- mutation: revoke removed",
    detect: RLS_MATRIX,
  },
  {
    id: "hazmat-draft-withcheck-weakened",
    why: "Restores the 0092 defect: a driver could self-clear a hazmat load, bypassing hazmat_reviews.",
    file: "supabase/migrations/0161_hazmat_draft_and_org_immutability.sql",
    find:
      "  with check (\n    org_id = auth_org_id()\n    and auth_role() = 'driver'\n" +
      "    and created_by = auth_user_id()\n    and status = 'draft'\n  );",
    replace: "  with check (auth_role() = 'driver' and created_by = auth_user_id());",
    detect: HAZMAT_MATRIX,
  },
  {
    id: "org-id-made-mutable",
    why: "Removes the org_id immutability trigger, so a row can be moved between tenants.",
    file: "supabase/migrations/0161_hazmat_draft_and_org_immutability.sql",
    find:
      "      'create trigger %I before update on public.%I for each row execute function public.forbid_org_change()',",
    replace: "      'select 1 /* %I %I mutation: trigger removed */',",
    detect: HAZMAT_MATRIX,
  },
  // ── tenant scoping in application code (needs node_modules; CI) ─────────────
  {
    id: "api-anomalyFlagReconcile-unscoped",
    why: "Drops the tenant filter from a service. The API uses the service role, so RLS will not catch it.",
    file: "apps/api/src/modules/anomalies/anomalyFlagReconcile.ts",
    find: '      .select("id")\n      .eq("org_id", orgId)\n      .eq("has_anomaly", true)',
    replace: '      .select("id")\n      .eq("has_anomaly", true)',
    detect: apiTest("src/modules/anomalies/anomalyFlagReconcile.test.ts"),
  },
  {
    id: "api-idleRollup-unscoped",
    why: "Same class, different service — proves the recorder assertion is applied, not just available.",
    file: "apps/api/src/modules/idle/idleRollupInputs.ts",
    find: '      .eq("org_id", orgId)\n      .gte("day", w.fromDate)',
    replace: '      .gte("day", w.fromDate)',
    detect: apiTest("src/modules/idle/idleRollup.test.ts"),
  },
  // ── the EFS capability registry (plan Step 3.10) ────────────────────────────
  // Every one of these mirrors a defect THIS workstream actually produced or nearly produced, and
  // each was verified by hand at the time it was fixed. Writing them down is what stops the check
  // from being a thing somebody once did: the registry's whole promise is that a capability cannot
  // ship half-wired, and a promise with no failing case behind it is a comment.
  {
    id: "efs-vendorMovesFields-dropped",
    why: "A direct op stops declaring the fields it owns, so every successful clear reports itself as unexplained drift. Found by running a two-step sequence in Step 3.4; the first green run came back drift_detected.",
    file: "apps/api/src/modules/efs/capabilities/overrideClear.behaviour.ts",
    find: "  vendorMovesFields: OVERRIDE_FIELDS,\n",
    replace: "",
    detect: apiTest("src/modules/efs/registry.test.ts"),
  },
  {
    id: "efs-reconcile-dropped",
    why: "A capability stops declaring how its unverified rows are judged later, and they sit on the operator's Unverified list forever. That was the state of every direct op until Step 3.9.",
    file: "apps/api/src/modules/efs/capabilities/overrideClear.behaviour.ts",
    find: "  reconcile: (after) => {\n    if (!after.doc) return \"indeterminate\";\n    return overrideClearedLanded(after.doc) ? \"landed\" : \"not_landed\";\n  },\n",
    replace: "",
    detect: apiTest("src/modules/efs/registry.test.ts"),
  },
  {
    id: "efs-fraud-stepup-exact-match",
    why: "The fraud gate compares statuses with === instead of efsStatusEquals. This account reports FRAUD upper-cased, so the unlock walks straight past the step-up — the 2026-08-12 casing incident, applied to the field that decides whether a password is demanded.\n\nMoved to packages/shared in Step 6.1, where the API gate and the drawer's warning read ONE predicate. Mutating it there is strictly stronger than mutating the old call site: it is now the only place the rule exists, so a survivor means neither half notices.",
    file: "packages/shared/src/efs/stepUp.ts",
    find: "export const cardUnlockNeedsStepUp = (status: string | null): boolean =>\n  efsStatusEquals(status, \"Fraud\");",
    replace: "export const cardUnlockNeedsStepUp = (status: string | null): boolean =>\n  status === \"Fraud\";",
    detect: sharedTest("src/modules/efs/stepUp.test.ts"),
  },
  {
    id: "efs-override-freeze-lock-unguarded",
    why: "H16: an armed override makes EFS silently ignore a status change, with NO signal at the response layer. Without the precondition a lock on such a card dispatches, is swallowed, and tells the operator 'the card is unchanged' — at 2am, on a stolen card.",
    file: "apps/api/src/modules/efs/capabilities/cardLock.behaviour.ts",
    find: "    if (overrideBlocksWrite(snap.doc?.card.overrideUses)) {",
    replace: "    if (false) {",
    detect: apiTest("src/modules/efs/capabilities/cardLock.behaviour.test.ts"),
  },
  {
    id: "efs-override-freeze-clear-inferred",
    why: "The exception is cleared whether or not the operator asked, so a lock silently destroys a fuel exception nobody mentioned. The `allowRemoveDriverId` rule exists because being the only way forward does not make a destruction consented to.",
    file: "apps/api/src/modules/efs/capabilities/cardLock.behaviour.ts",
    find: "      ...(body.clearException && overrideBlocksWrite(doc.card.overrideUses) ? overrideClearEdits() : []),",
    replace: "      ...(overrideBlocksWrite(doc.card.overrideUses) ? overrideClearEdits() : []),",
    detect: apiTest("src/modules/efs/capabilities/cardLock.behaviour.test.ts"),
  },
  {
    id: "efs-override-freeze-guard-fails-open",
    why: "A capability nobody mapped is waved through instead of refused. H16's whole point is that being wrong here is SILENT — the write is accepted, applied to nothing, and reported as an unexplained no-change.",
    file: "apps/api/src/modules/efs/capabilities/overrideFreezeGuard.ts",
    find: "    overrideBlockedMessage(uses ?? 0, what ?? \"this change\"),",
    replace: "    overrideBlockedMessage(uses ?? 0, what ?? \"\"),",
    detect: apiTest("src/modules/efs/capabilities/cardLock.behaviour.test.ts"),
  },
  {
    id: "efs-override-grant-on-armed-card",
    why: "Miki's 2026-08-18 ruling: no grant on a card already in override. Without the precondition a re-grant dispatches — the count REPLACES (an operator granting 'one more' gets 1, not 2) and the non-trio fields (limits, handEnter) risk H16's silent swallow, with EFS reporting success either way.",
    file: "apps/api/src/modules/efs/capabilities/overrideGrant.behaviour.ts",
    find: "    if (snap.doc !== null && overrideBlocksWrite(uses)) {",
    replace: "    if (false) {",
    detect: apiTest("src/modules/efs/capabilities/overrideGrant.behaviour.test.ts"),
  },
  {
    id: "efs-override-grant-on-held-card",
    why: "Miki's 2026-08-18 ruling: exceptions only on Active cards. EFS accepts a grant on a HOLD card (watched live, twice) and the pump declines the card anyway — without the gate the ledger says a driver is covered when they are not.",
    file: "apps/api/src/modules/efs/capabilities/overrideGrant.behaviour.ts",
    find: "    if (status !== null && status !== undefined && !efsStatusEquals(status, \"Active\")) {",
    replace: "    if (false) {",
    detect: apiTest("src/modules/efs/capabilities/overrideGrant.behaviour.test.ts"),
  },
  {
    id: "efs-proof-blocked-by-own-row",
    why: "The 2026-08-18 production incident: a proof's revert was refused by the in-flight guard tripping over the proof's OWN terminal-sent apply row, leaving ••••6536 armed and the proof denied. Un-scoping the exemption re-strands every future vendor-blind proof at OEG-5.",
    file: "apps/api/src/modules/efs/orchestrator/ledger.ts",
    find: "  const blocking = rows.filter((row) => !(ctx.proofRunId && row.proof_run_id === ctx.proofRunId));",
    replace: "  const blocking = rows;",
    detect: apiTest("src/modules/efs/harness/prove.test.ts"),
  },
  {
    id: "efs-override-grant-sent-not-accepted",
    why: "Step 3.11's answer undone: without sentAccepted, override_grant's proof can never settle proven — the vendor never echoes the scope or limits, so OEG-3 reads every working grant as unlanded and 10.5's promotion becomes unreachable. The declaration must be load-bearing, not decorative.",
    file: "apps/api/src/modules/efs/capabilities/overrideGrant.behaviour.ts",
    find: "    sentAccepted: {\n      reason: \"this vendor never echoes an override's scope or limits through getCardv2 (H2; \"\n        + \"docs/40 §1.3) — the count landed, and the count is the only observable field\",\n    },",
    replace: "",
    detect: apiTest("src/modules/efs/harness/prove.test.ts"),
  },
  {
    id: "efs-override-limits-four-field-wire",
    why: "The four-field limit record is p194's example — and setCardv2 REJECTS it (production, 2026-08-18: 'ERROR running command', card untouched; the six-field record landed). Reverting to four fields ships a product override that faults on every real grant, and the local echo guard cannot catch it because removals names every pre-existing record.",
    file: "apps/api/src/modules/efs/services/efsCardEdits.ts",
    find: "      autoRollMap: String(limit.autoRollMap ?? 0),\n      autoRollMax: String(limit.autoRollMax ?? 0),",
    replace: "      ...(limit.autoRollMap !== undefined ? { autoRollMap: String(limit.autoRollMap) } : {}),\n      ...(limit.autoRollMax !== undefined ? { autoRollMax: String(limit.autoRollMax) } : {}),",
    detect: apiTest("src/modules/efs/services/efsCardEdits.test.ts"),
  },
  {
    id: "efs-override-limits-removals-empty",
    why: "The Step 10.1 plan error, as a mutation. `removals: []` is what the plan specified; it passes on a card whose <limits> is already empty — the one card Step 10.4 proves on — and assertCollectionsPreserved refuses it on every card that has limits. So the bug would have gone live green and failed on the first real override.",
    file: "apps/api/src/modules/efs/services/efsCardEdits.ts",
    find: "    removals,\n  };\n}",
    replace: "    removals: [],\n  };\n}",
    detect: apiTest("src/modules/efs/services/efsCardEdits.test.ts"),
  },
  {
    id: "efs-override-limits-scope-only",
    why: "The products the operator chose are dropped on the way to the edit list, so the write grants a scope-only exception while the ledger and the confirmation both say a product limit was overridden. Silent, and in the expensive direction: the driver is still capped at the card's own amount.",
    file: "apps/api/src/modules/efs/capabilities/overrideGrant.behaviour.ts",
    /**
     * Re-anchored 2026-08-18: `allowHandEnter` became a fifth argument and the old one-line pattern
     * stopped matching, so this entry had gone STALE — reporting nothing while reading as a pass,
     * the same failure `efs-mileage-unit-ownership-dropped` had. Anchored on `body.limits` ALONE
     * now, which is the only token this mutation is actually about; a sixth argument cannot silence
     * it again.
     */
    find: "body.scope, body.limits, body.allowHandEnter",
    replace: "body.scope, [], body.allowHandEnter",
    detect: apiTest("src/modules/efs/capabilities/overrideGrant.behaviour.test.ts"),
  },
  {
    id: "efs-override-limits-stepup-bypassed",
    why: "A product-limit override stops demanding a password, so one click deletes the card's product limits (p194) with no re-authentication. The uses threshold still fires, which is what makes this quiet — the gate looks alive.",
    file: "packages/shared/src/efs/stepUp.ts",
    find: "export const overrideLimitsNeedStepUp = (limitCount: number): boolean => limitCount > 0;",
    replace: "export const overrideLimitsNeedStepUp = (limitCount: number): boolean => limitCount > 99;",
    detect: sharedTest("src/modules/efs/stepUp.test.ts"),
  },
  {
    id: "efs-prompts-optin-bypassed",
    why: "The DRID removal opt-in is ignored, so clearing a text box can stop the pump asking who is fuelling (guide p137). The refusal had no test at all until Step 3.6.",
    file: "apps/api/src/modules/efs/capabilities/promptsSet.behaviour.ts",
    find: "assertPromptRemovalAllowed(plan.removedInfoIds, body.allowRemoveDriverId, ctx.stepUp);",
    replace: "assertPromptRemovalAllowed(plan.removedInfoIds, true, ctx.stepUp);",
    detect: apiTest("src/modules/efs/capabilities/promptsSet.behaviour.test.ts"),
  },
  {
    id: "efs-writebucket-mismatched",
    why: "A contract declares a bucket its mounted path does not resolve to. cardWriteBucket returns null on a miss and the limiter treats null as ALLOW, so the failure mode is an UNMETERED write route rather than a broken one.",
    file: "packages/shared/src/efs/capabilities/cardLock.contract.ts",
    find: "  writeBucket: \"card_status\",",
    replace: "  writeBucket: \"card_override\",",
    detect: apiTest("src/modules/efs/registry.test.ts"),
  },
  {
    id: "efs-preflight-after-limiter",
    why: "The body-only step-up runs AFTER the write limiter, so a refusal spends a slot against a daily cap for an action the caller was always allowed to take once they re-authenticate. Step 3.5b exists to prevent exactly this.",
    file: "apps/api/src/modules/efs/router.ts",
    find: "  if (accepted.stepUpMessage && !hasFreshAuth(req)) {\n    stepUpRequired(res, DEFAULT_STEP_UP_MAX_AGE_SEC, accepted.stepUpMessage);\n    return;\n  }\n\n  const prepared = await prepare(req, res, contract.scope as CardScope, contract.key);\n  if (!prepared) return;",
    replace: "  const prepared = await prepare(req, res, contract.scope as CardScope, contract.key);\n  if (!prepared) return;\n\n  if (accepted.stepUpMessage && !hasFreshAuth(req)) {\n    stepUpRequired(res, DEFAULT_STEP_UP_MAX_AGE_SEC, accepted.stepUpMessage);\n    return;\n  }",
    detect: apiTest("src/modules/efs/router.test.ts"),
  },
  {
    id: "efs-partial-collapsed-into-failed",
    why: "A half-applied sequence settles `failed` instead of `partial`, sending an operator to re-run steps that already landed. `partial` is terminal but ACTIONABLE (docs/27 §5.1, migration 0190).",
    file: "apps/api/src/modules/efs/orchestrator/dispatch.ts",
    find: "      if (landedSteps > 0) return await finalizePartial(ctx, ledger, facts, verified.after.doc, sent);\n",
    replace: "",
    detect: apiTest("src/modules/efs/orchestrator/orchestrator.test.ts"),
  },
  {
    id: "efs-cred-updated-at-always-bumps",
    why:
      "Restores the Step 5.7 defect: every poll bumps `updated_at`, so the column can no longer " +
      "answer \"when was this credential last CHANGED\" — the question asked after a security " +
      "incident — because a poller overwrites the answer within the hour.",
    file: "supabase/migrations/0196_efs_soap_credentials_updated_at_is_config_only.sql",
    find:
      "  if (to_jsonb(new) - feed_columns) is distinct from (to_jsonb(old) - feed_columns) then\n" +
      "    new.updated_at = now();\n  else\n    new.updated_at = old.updated_at;\n  end if;",
    replace: "  new.updated_at = now();",
    detect: TRIGGERS_MATRIX,
  },
  {
    id: "efs-cred-updated-at-frozen",
    why:
      "The opposite-direction defect the matrix names but nothing enforced: the column never moves " +
      "at all, so a rotation or an endpoint repoint leaves no trace and the incident question is " +
      "answered with a stale date rather than a missing one.",
    file: "supabase/migrations/0196_efs_soap_credentials_updated_at_is_config_only.sql",
    find: "    new.updated_at = now();\n  else",
    replace: "    new.updated_at = old.updated_at;\n  else",
    detect: TRIGGERS_MATRIX,
  },
  {
    id: "efs-prompt-types-empty-allowed",
    why:
      "Reintroduces H15 verbatim: `array_length('{}', 1)` is NULL, `NULL >= 1` is NULL, and a CHECK " +
      "rejects only on FALSE — so the non-empty rule accepts every empty array. That exact mistake " +
      "shipped in 0173's scopes constraint and held for weeks. This is the one mutation whose real " +
      "counterpart is already in this repository's history.",
    file: "supabase/migrations/0200_efs_account_prompt_types.sql",
    find: "cardinality(prompt_types) >= 1",
    replace: "array_length(prompt_types, 1) >= 1",
    detect: TRIGGERS_MATRIX,
  },
  // ── the fitness functions themselves ────────────────────────────────────────
  {
    id: "waiver-growth-unchecked",
    why:
      "Restores the unconditional waiver Set the file-size gate used to have. Its comment said the " +
      "list 'may only SHRINK' and nothing enforced it, so the four waived files grew 282 lines in " +
      "three weeks — the gate's own exemptions became the only unbounded files in the repo.",
    file: "scripts/check-file-size.mjs",
    find: "      if (lines > pin) grown.push({ rel, lines, pin });",
    replace: "      if (false) grown.push({ rel, lines, pin });",
    detect: ["node", ["scripts/check-waiver-growth.mjs"]],
  },

  {
    id: "efs-editable-ids-not-shipped",
    why: "Step 9.1's client half is undone — the browser falls back to the hardcoded DRID/UNIT pair while the API validates against the account's twenty-four. The drawer then offers two ids and says nothing about the rest, which is the exact gap promptDrafts.ts carried until 2026-08-17.",
    file: "apps/api/src/modules/efs/services/efsCardControlAccess.ts",
    find: "  editableInfoIds = resolveEditableInfoIds(row?.prompt_types ?? null);",
    replace: "  editableInfoIds = resolveEditableInfoIds(null);",
    detect: apiTest("src/modules/efs/services/efsCardControlAccess.test.ts"),
  },
  {
    id: "efs-prompts-policy-source-writable",
    why: "Step 9.4's guard is removed, so a card-level prompt write on a POLICY-source card is dispatched again. EFS accepts it and ignores it, and the echo verifier CANNOT catch that — it re-reads the card and finds the records it just wrote, because the card still stores them. They just never reach a pump. The operator sees a clean landing for a change that will never take effect.",
    file: "apps/api/src/modules/efs/capabilities/promptsSet.behaviour.ts",
    find: "    assertCardPromptsAreWritable(snap);\n",
    replace: "",
    detect: apiTest("src/modules/efs/capabilities/promptsSet.behaviour.test.ts"),
  },
  {
    id: "efs-clear-and-lock-flag-dropped",
    why: "H16's Option B is broken exactly the way it shipped broken. The checkbox still renders and `cardLock.view.ts` still promises the exception will leave in the same write, but the request carries the schema's `false` — so the lock precondition refuses it and the operator is shown the dead-end sentence the checkbox exists to avoid, after ticking a box that said it would be handled. Nothing on the API side moves, which is why no API test can see it: the whole defect is one dropped field on the browser's last hop.",
    file: "apps/web/src/features/fuelCards/useOperationDispatch.ts",
    /**
     * Anchored on the ASSIGNMENT alone, not the surrounding object. The comment above it will be
     * reworded eventually and the `status` line beside it belongs to a different guard (P0-3's
     * capability routing); either one in the pattern would let this entry go stale silently, which
     * `efs-mileage-unit-ownership-dropped` has already cost this project once.
     */
    find: "              clearException: body.clearException === true,\n",
    replace: "              clearException: false,\n",
    detect: webTest("src/features/fuelCards/CardOperationDrawer.test.ts"),
  },
  // ── the mileage override: a write the capability ledger does not cover ──────
  // Not a capability (docs/37 §4 chose a plain audited write over a unit-keyed LedgerAdapter), so
  // it gets none of the orchestrator's guarantees — no ledger row, no reconciler, no `pnpm efs:prove`.
  // These three are what stands in for that, and each mirrors a defect this integration could ship.
  {
    id: "efs-mileage-already-current-dispatched",
    why: "The skip is removed, so a request for the value EFS already holds is dispatched and then 'verified' by a re-read that shows that value whether or not the vendor did anything. Reporting `landed` there is unfounded — the H1 shape, and the exact case the short-circuit exists for.",
    file: "apps/api/src/modules/efs/services/efsMileageOverride.ts",
    find: "  if (before === mileage) {",
    replace: "  if (false) {",
    detect: apiTest("src/modules/efs/services/efsMileageOverride.test.ts"),
  },
  {
    id: "efs-mileage-indeterminate-as-landed",
    why: "A reading that is neither the old value nor the one we asked for is reported as success. The ELD feed writes this value too, so that third number means something else wrote after us — calling it `landed` claims a write landed when nothing checked it.",
    file: "apps/api/src/modules/efs/services/efsMileageOverride.ts",
    find: "  if (after === requested) return \"landed\";\n  if (after === before) return \"not_landed\";\n  return \"indeterminate\";",
    replace: "  if (after === before) return \"not_landed\";\n  return \"landed\";",
    detect: apiTest("src/modules/efs/services/efsMileageOverride.test.ts"),
  },
  {
    id: "efs-mileage-unit-ownership-dropped",
    why: "The typo boundary. `overrideLastMileage` returns nothing, so a write onto a unit belonging to nobody — 868 for 688 — lands silently and reports success. The org-scoped EFS session does not catch it: both units are on the same account.",
    file: "apps/api/src/modules/efs/routes/unitMileage.ts",
    /**
     * Re-anchored 2026-08-17 after this check went STALE — a stale mutation is worse than a survived
     * one, because it reads as a pass while testing nothing. Commit ceabbf5 split `findVehicle`'s
     * answer into `{ vehicle, lookupFailed }` and expanded the 404's wording, so the old pattern
     * stopped matching and this entry had been asserting nothing since.
     *
     * Anchored on the `!vehicle` refusal ALONE rather than on the surrounding lines, so a future
     * rewording of the sentence cannot silence it again. The `lookupFailed` branch above is a
     * different guard with a different failure (a 503, not a silent landing) and is left in place:
     * removing only the ownership refusal is what makes this mutation about ownership.
     */
    find: "      if (!vehicle) {\n        res.status(404).json(apiError(\n          \"unknown_unit\",",
    replace: "      if (false) {\n        res.status(404).json(apiError(\n          \"unknown_unit\",",
    detect: apiTest("src/modules/efs/routes/unitMileageRoute.test.ts"),
  },
  {
    id: "driver-tests-uncollected",
    why: "Re-narrows the driver include glob — the bug that hid 24 tests for months, three times over.",
    file: "apps/driver/vitest.config.ts",
    find: "include: ['tests/**/*.test.ts?(x)', 'src/**/*.test.ts?(x)'],",
    replace: "include: ['tests/**/*.test.ts'],",
    detect: ["node", ["scripts/check-test-collection.mjs"]],
  },
];

// ── runner ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? "";
const allowDirty = args.includes("--allow-dirty");

if (args.includes("--list")) {
  for (const m of MUTATIONS) console.log(`${m.id.padEnd(36)} ${m.file}`);
  process.exit(0);
}

const selected = MUTATIONS.filter((m) => m.id.includes(only));
if (selected.length === 0) {
  console.error(`No mutations match --only=${only}`);
  process.exit(1);
}

// Never clobber uncommitted work.
if (!allowDirty) {
  const files = [...new Set(selected.map((m) => m.file))];
  const dirty = spawnSync("git", ["diff", "--name-only", "HEAD", "--", ...files], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const changed = (dirty.stdout ?? "").trim();
  if (changed) {
    console.error(
      "Refusing to run: these target files differ from git HEAD, and this harness edits files in " +
        "place.\n" + changed + "\nCommit or stash first, or pass --allow-dirty.",
    );
    process.exit(1);
  }
}

/**
 * CRASH SAFETY.
 *
 * This harness edits real source files and restores them in a `finally`. That is not enough: a
 * `finally` does not run when the process is killed, and this one was — twice — by a command timeout
 * mid-sweep. The first kill left two stray lines in efsSoap.ts (which then failed the very gate the
 * mutation was testing); the second left `imports_select` open to `using (true)` in a migration,
 * which is a tenant-isolation hole sitting in the working tree looking like a real regression.
 *
 * So every mutation's original content is written to a vault on disk first, signal handlers restore
 * on the way out, and a vault left over from a killed run is replayed BEFORE anything else happens.
 * A rig that can damage the tree it is testing is worse than no rig, because the damage looks like a
 * finding.
 */
const VAULT = join(tmpdir(), "fuelguard-mutation-vault");
const vaultPath = (rel) => join(VAULT, rel.replace(/[\\/]/g, "__"));

function recoverStaleVault() {
  if (!existsSync(VAULT)) return;
  const left = readdirSync(VAULT);
  if (left.length === 0) return;
  console.warn(`⚠ restoring ${left.length} file(s) left mutated by an interrupted run:`);
  for (const name of left) {
    const { rel, content } = JSON.parse(readFileSync(join(VAULT, name), "utf8"));
    writeFileSync(join(ROOT, rel), content);
    console.warn(`  - ${rel}`);
    rmSync(join(VAULT, name), { force: true });
  }
}
recoverStaleVault();
mkdirSync(VAULT, { recursive: true });

/** Files currently mutated, so a signal can put them back. */
const inFlight = new Map();
let unwound = false;
function unwind() {
  if (unwound) return;
  unwound = true;
  for (const [rel, content] of inFlight) {
    try {
      writeFileSync(join(ROOT, rel), content);
      rmSync(vaultPath(rel), { force: true });
    } catch (err) {
      console.error(`FATAL: could not restore ${rel}: ${String(err)}`);
    }
  }
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { unwind(); process.exit(130); });
process.on("uncaughtException", (err) => { unwind(); console.error(err); process.exit(1); });
process.on("exit", unwind);

/**
 * Self-heal a leftover mutation, even under --allow-dirty.
 *
 * The vault above handles SIGINT/SIGTERM. It cannot handle SIGKILL, and the dirty-tree refusal is
 * bypassed exactly when you need it most — during development, when the tree is legitimately dirty
 * and everyone passes --allow-dirty out of habit. That combination left a tenant-isolation hole
 * (`imports_select ... using (true)`) sitting in a migration looking like a real regression.
 *
 * This check is precise rather than general: a file that is MISSING the mutation's `find` text and
 * CONTAINS its `replace` text is not ambiguous — it is this harness's own damage. Restore it from
 * HEAD and say so. Anything else is left alone; the dirty guard still owns that case.
 */
for (const m of selected) {
  const path = join(ROOT, m.file);
  let current;
  try { current = readFileSync(path, "utf8"); } catch { continue; }
  if (current.includes(m.find) || !current.includes(m.replace)) continue;
  const head = spawnSync("git", ["show", `HEAD:${m.file}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (head.status !== 0) {
    console.error(`Leftover mutation "${m.id}" in ${m.file}, and it could not be read from HEAD. Restore it by hand.`);
    process.exit(2);
  }
  if (!head.stdout.includes(m.find)) continue; // HEAD does not have the clean text either — not ours to fix
  writeFileSync(path, head.stdout);
  console.warn(`⚠ restored ${m.file} — it was left mutated by "${m.id}" in an interrupted run.`);
}

const results = [];
for (const m of selected) {
  const path = join(ROOT, m.file);
  const original = readFileSync(path, "utf8");
  const before = sha(original);

  if (!original.includes(m.find)) {
    results.push({ id: m.id, status: "STALE", note: `pattern not found in ${m.file}` });
    continue;
  }

  let status, note;
  try {
    writeFileSync(vaultPath(m.file), JSON.stringify({ rel: m.file, content: original }));
    inFlight.set(m.file, original);
    writeFileSync(path, original.replace(m.find, m.replace));
    const [cmd, cmdArgs] = m.detect;
    const run = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8" });
    if (run.error) {
      status = "ERROR";
      note = `could not run ${cmd}: ${run.error.message}`;
    } else if (run.status === 0) {
      status = "SURVIVED";
      note = `${cmd} ${cmdArgs.join(" ")} still passed`;
    } else {
      status = "CAUGHT";
      const hit = (run.stdout ?? "").split("\n").find((l) => /FAIL|not scoped|NEVER COLLECTED/.test(l));
      note = (hit ?? "").trim().slice(0, 100);
    }
  } finally {
    writeFileSync(path, original);
    inFlight.delete(m.file);
    rmSync(vaultPath(m.file), { force: true });
    if (sha(readFileSync(path, "utf8")) !== before) {
      console.error(`\nFATAL: ${m.file} was NOT restored. Restore it from git before doing anything else.`);
      process.exit(2);
    }
  }
  results.push({ id: m.id, status, note });
}

const width = Math.max(...results.map((r) => r.id.length));
console.log("");
for (const r of results) {
  const mark = r.status === "CAUGHT" ? "ok  " : "FAIL";
  console.log(`${mark} ${r.status.padEnd(9)} ${r.id.padEnd(width)}  ${r.note}`);
}

const bad = results.filter((r) => r.status !== "CAUGHT");
console.log(`\n${results.length - bad.length}/${results.length} mutations caught.`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results
    .map((r) => `| ${r.status === "CAUGHT" ? "✅" : "❌"} ${r.status} | \`${r.id}\` | ${r.note || ""} |`)
    .join("\n");
  const md = [
    "### Mutation check — does the test suite still bite?",
    "",
    `**${results.length - bad.length}/${results.length} caught.**`,
    "",
    "| Result | Mutation | Detail |",
    "| --- | --- | --- |",
    rows,
    "",
    bad.length
      ? "> A **SURVIVED** mutation means the defect was introduced and nothing went red. " +
        "A **STALE** one means the code moved and that check has been testing nothing since."
      : "> Every deliberately introduced defect was detected.",
    "",
  ].join("\n");
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  } catch (err) {
    console.error(`(could not write step summary: ${err.message})`);
  }
}
if (bad.length) {
  console.error(
    "\nA SURVIVED mutation is a hole in the test suite: the defect was introduced and nothing went red.\n" +
      "A STALE mutation is worse — the code moved and this check has been testing nothing since.\n" +
      "Fix the assertions (or the mutation), never delete the entry.",
  );
  process.exit(1);
}
