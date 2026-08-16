import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES_WITH_STEP_UP_GATE,
  CARD_CAPABILITY_CONTRACTS,
  CARD_MUTATION_INTENTS,
  CARD_MUTATION_STATUSES,
  cardWriteBucket,
} from "@fuelguard/shared";
import { loadEnv } from "../env.js";
import { cardLockBehaviour } from "./capabilities/cardLock.behaviour.js";
import { cardUnlockBehaviour } from "./capabilities/cardUnlock.behaviour.js";
import { overrideGrantBehaviour } from "./capabilities/overrideGrant.behaviour.js";
import { deleteOverrideBehaviour, overrideClearBehaviour } from "./capabilities/overrideClear.behaviour.js";
import { promptsSetBehaviour } from "./capabilities/promptsSet.behaviour.js";
import { ALL_CAPABILITIES, mountedCapabilities } from "./registry.js";

/**
 * The cross-registry fitness test (docs/27 §7.2).
 *
 * Three declarations describe one capability and they live in three packages, so nothing but a test
 * can hold them together. Each assertion below corresponds to a way they can disagree SILENTLY —
 * where the mismatch produces a working-looking system with one guarantee quietly removed.
 *
 * ── The non-empty-discovery guard is not ceremony ────────────────────────────────────────────────
 * Every loop here iterates a discovered set, and a discovery that finds NOTHING makes every
 * `for` body vacuous and every assertion pass. `routeAuth.test.ts` shipped exactly that failure: its
 * regex found 26 routers, silently missed `/api/fuel-cards`, and asserted 401s about routers it had
 * never seen (Phase 0 Step 0.7). A count assertion first is what makes the rest mean anything.
 */

const behaviours = { card_lock: cardLockBehaviour, card_unlock: cardUnlockBehaviour, override_grant: overrideGrantBehaviour,
  override_clear: overrideClearBehaviour, delete_override: deleteOverrideBehaviour,
  prompts_set: promptsSetBehaviour } as const;
const MOUNT_PREFIX = "/api/fuel-cards";

/** The keys this test knows about. Deliberately hardcoded: it is the thing being compared against. */
const EXPECTED_KEYS = ["card_lock", "card_unlock", "delete_override", "override_clear", "override_grant", "prompts_set"];
/** The two mechanisms of `override_clear`. Exactly one of these is ever mounted. */
const CLEAR_MECHANISMS = ["override_clear", "delete_override"];

const envWith = (deleteOverride: boolean) =>
  loadEnv({ NODE_ENV: "test", ...(deleteOverride ? { EFS_CARD_DELETE_OVERRIDE_ENABLED: "true" } : {}) } as NodeJS.ProcessEnv);

describe("the capability registries agree with each other", () => {
  it("discovered every capability — without this, every loop below is vacuous", () => {
    expect(Object.keys(CARD_CAPABILITY_CONTRACTS).sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(ALL_CAPABILITIES).toHaveLength(EXPECTED_KEYS.length);
    // One fewer mounted than declared, and exactly one: the two clear mechanisms are alternatives.
    expect(mountedCapabilities(envWith(false))).toHaveLength(EXPECTED_KEYS.length - 1);
  });

  /**
   * Step 4.5. `ProofPlan.revert` names the undoing capability as a STRING, because it is usually a
   * DIFFERENT capability — unlock is undone by lock, grant by clear, clear by grant — and importing
   * one behaviour into another to get a typed reference would be a cycle.
   *
   * A string the compiler cannot check is precisely the shape `docs/30` §7 warns about: a vocabulary
   * that moves on one side only. Rename a capability key and every proof plan pointing at it becomes
   * a prover that dispatches nothing and leaves a QA card changed. This is the check that notices.
   */
  it("every proof plan reverts through a capability that actually exists", () => {
    const emptySnapshot = { doc: null } as Parameters<NonNullable<typeof cardLockBehaviour.proof>["revert"]>[0];
    const planned = Object.entries(behaviours).filter(([, b]) => b.proof !== undefined);

    // Guards the loop against being vacuous — the failure mode this whole file exists to prevent.
    expect(planned.length).toBe(Object.keys(CARD_CAPABILITY_CONTRACTS).length);

    for (const [key, behaviour] of planned) {
      const target = behaviour.proof!.revert(emptySnapshot).capability;
      expect(
        Object.keys(CARD_CAPABILITY_CONTRACTS),
        `${key}'s proof reverts through "${target}", which is not a capability`,
      ).toContain(target);
    }
  });

  it("pairs every contract with exactly one behaviour, and mounts it", () => {
    // A contract with no behaviour is a route the router cannot serve; a behaviour with no contract
    // is code that can never run. Both are invisible until somebody presses the button.
    expect(Object.keys(behaviours).sort()).toEqual(Object.keys(CARD_CAPABILITY_CONTRACTS).sort());
    expect(ALL_CAPABILITIES.map((m) => m.contract.key).sort())
      .toEqual(Object.keys(CARD_CAPABILITY_CONTRACTS).sort());
  });

  it("declares an intent the database will actually accept", () => {
    for (const contract of Object.values(CARD_CAPABILITY_CONTRACTS)) {
      // Many-to-one is legitimate — `override_clear` is one intent with two mechanisms — so this is
      // membership, not a bijection. A miss here fails at INSERT, after the gates have passed.
      expect(CARD_MUTATION_INTENTS, `${contract.key} intent`).toContain(contract.intent);
    }
  });

  it("covers every intent the ledger's CHECK constraint permits", () => {
    const permitted = checkValuesFromMigrations(/check\s*\(\s*intent\s+in\s*\(([^)]*)\)/gi);
    expect(permitted.length, "intent CHECK not found in the migration directory").toBeGreaterThan(0);
    const declared = new Set(Object.values(CARD_CAPABILITY_CONTRACTS).map((c) => c.intent));
    for (const intent of permitted) {
      // Both directions. An intent the DB permits with no capability behind it is a value nothing
      // can ever write — dead vocabulary that reads like a feature. The reverse is caught below.
      expect(declared, `intent '${intent}' has no capability`).toContain(intent);
    }
    // …and the shared constant must agree with the constraint, or a row the database happily stores
    // is one the history view refuses to parse.
    expect([...CARD_MUTATION_INTENTS].sort()).toEqual([...permitted].sort());
  });

  it("keeps the status vocabulary in step with the ledger's CHECK constraint", () => {
    const permitted = checkValuesFromMigrations(/check\s*\(\s*status\s+in\s*\(([^)]*)\)/gi);
    expect(permitted.length, "status CHECK not found in the migration directory").toBeGreaterThan(0);
    // `cardMutationSchema.status` is `z.enum(CARD_MUTATION_STATUSES)`, and the drawer's history view
    // parses through it. A status the database accepts and this list omits is a row that renders as
    // a parse error on the one screen an operator opens to find out what happened.
    expect([...CARD_MUTATION_STATUSES].sort()).toEqual([...permitted].sort());
  });

  it("declares a scope the approver CHECK constraint permits", () => {
    const permitted = approverScopesFromMigrations();
    expect(permitted.length, "scopes CHECK not found in the migration directory").toBeGreaterThan(0);
    for (const contract of Object.values(CARD_CAPABILITY_CONTRACTS)) {
      // A scope outside the constraint can be REQUIRED by the gate and never GRANTED to anybody: the
      // capability promotes, the approver row refuses to store the scope, and the operation is
      // unreachable with no error that says why (plan Step 0.12).
      expect(permitted, `${contract.key} scope`).toContain(contract.scope);
    }
  });

  it("declares the bucket its MOUNTED path actually resolves to — equality, not existence", () => {
    for (const capability of ALL_CAPABILITIES) {
      const { method, path } = capability.contract.route;
      const mounted = `${MOUNT_PREFIX}${path.replace(":id", "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e")}`;
      // `cardWriteBucket` returns null on a miss and the limiter treats null as ALLOW, so a
      // capability whose path the pattern table does not recognise is an UNMETERED write route, not
      // a broken one. `toBe` rather than `toBeTruthy`: a bucket that exists but is the wrong one
      // meters card locks against the override budget.
      expect(cardWriteBucket(method, mounted), `${capability.contract.key} bucket`)
        .toBe(capability.contract.writeBucket);
    }
  });

  it("overrides redactResponse whenever the contract says the body carries a secret", () => {
    for (const [key, behaviour] of Object.entries(behaviours)) {
      const contract = CARD_CAPABILITY_CONTRACTS[key]!;
      if (!contract.carriesSecret) continue;
      // The default redaction masks PANs. A PIN or a password is not a PAN, and the capability that
      // sends one has to say how its own response is scrubbed before it reaches the ledger.
      expect(behaviour.redactResponse, `${key} redactResponse`).toBeTypeOf("function");
    }
  });

  it("gives every step of a sequence its own verify", () => {
    for (const [key, behaviour] of Object.entries(behaviours)) {
      if (behaviour.mutation.kind !== "sequence") continue;
      expect(behaviour.mutation.steps.length, `${key} empty sequence`).toBeGreaterThan(0);
      // A step without its own verify cannot be judged independently, and `partial` — the whole
      // reason sequences settle differently — becomes unreachable.
      for (const step of behaviour.mutation.steps) {
        expect(step.verify, `${key} step ${step.label}`).toBeTypeOf("object");
      }
    }
  });

  it("declares vendorMovesFields whenever it dispatches a direct op", () => {
    for (const [key, behaviour] of Object.entries(behaviours)) {
      const kinds = behaviour.mutation.kind === "sequence"
        ? behaviour.mutation.steps.map((s) => s.mutation.kind)
        : [behaviour.mutation.kind];
      if (!kinds.includes("direct")) continue;
      // A direct op produces no edits, so nothing tells the drift classifier which fields it owns —
      // and the capability reports its own successful write as unexplained drift on every run.
      // Step 3.4 found this by running a two-step sequence; orchestrator.test.ts keeps the case.
      expect(behaviour.vendorMovesFields?.length ?? 0, `${key} vendorMovesFields`).toBeGreaterThan(0);
    }
  });

  it("keeps expectedVersion out of any capability that is not card-targeted", () => {
    for (const [key, behaviour] of Object.entries(behaviours)) {
      if (behaviour.target.kind === "card") continue;
      // A non-card target has no document and no version (docs/27 §3.1). A behaviour reaching for
      // one is a capability being contorted into the card ledger.
      const source = readFileSync(
        fileURLToPath(new URL(`./capabilities/${key.replace(/_(.)/g, (_, c: string) => c.toUpperCase())}.behaviour.ts`, import.meta.url)),
        "utf8",
      );
      expect(source, `${key} references expectedVersion`).not.toContain("expectedVersion");
    }
  });

  it("serves exactly one override-clear mechanism, whichever way the flag is set", () => {
    for (const flag of [false, true]) {
      const keys = mountedCapabilities(envWith(flag)).map((c) => c.contract.key);
      const clears = keys.filter((key) => CLEAR_MECHANISMS.includes(key));
      // Two capabilities on `DELETE /:id/override` is a coin toss decided by registration order, and
      // the loser is silently unreachable. Zero is worse: the route 404s and an operator is told the
      // card does not exist.
      expect(clears, `flag=${flag}`).toHaveLength(1);
      expect(clears[0]).toBe(flag ? "delete_override" : "override_clear");
    }
  });

  it("keeps both clear mechanisms on one intent, so the audit key spans them", () => {
    const intents = CLEAR_MECHANISMS.map((key) => CARD_CAPABILITY_CONTRACTS[key]!.intent);
    // `capability_key` records WHICH mechanism ran; `intent` has to stay the coarse question — "who
    // cleared this card's override" — or half the history disappears when the flag flips.
    expect(new Set(intents)).toEqual(new Set(["override_clear"]));
    const routes = CLEAR_MECHANISMS.map((key) => {
      const { method, path } = CARD_CAPABILITY_CONTRACTS[key]!.route;
      return `${method} ${path}`;
    });
    // They must also be genuinely interchangeable: same verb, same path, same bucket, or flipping
    // the flag moves the endpoint under the drawer.
    expect(new Set(routes).size).toBe(1);
    expect(new Set(CLEAR_MECHANISMS.map((key) => CARD_CAPABILITY_CONTRACTS[key]!.writeBucket)).size).toBe(1);
  });

  it("can be reconciled in the background, so no capability strands its own unverified rows", () => {
    for (const capability of ALL_CAPABILITIES) {
      // A `sent` row is terminal-unknown and sits on an operator's "Unverified" list until the
      // background sweep answers it. A capability with no after-only predicate has no answer, and
      // its rows stay there forever — which is what every `direct` op did until Step 3.9.
      expect(capability.reconcile, `${capability.contract.key} reconcile`).not.toBeNull();
    }
  });

  it("declares a reason rule, so a capability cannot default into silence", () => {
    for (const contract of Object.values(CARD_CAPABILITY_CONTRACTS)) {
      expect(["optional", "required"], `${contract.key} reason`).toContain(contract.reason);
    }
  });

  /**
   * Step 6.1, invariant 5 — the API half of the pin.
   *
   * `lint:boundaries` keeps `apps/api` from importing `apps/web`, so no single test can pair a
   * behaviour's gate with the drawer's warning. Instead each side derives its own set and compares
   * it to `CAPABILITIES_WITH_STEP_UP_GATE` in `@fuelguard/shared`; the web's
   * `capabilities/registry.test.ts` holds the other half. Adding a gate here without teaching the
   * view to warn turns THAT test red, and the operator never meets a password prompt the drawer
   * promised would not come.
   *
   * `precondition` counts as a gate. It is not only a step-up hook — `prompts_set` uses it to raise
   * `invalid_request` for the missing DRID opt-in as well — but it is also the only hook that can
   * raise `step_up_required` from state computed after the fresh read, so a capability declaring one
   * is a capability that may ask for a password.
   */
  it("gates step-up on exactly the capabilities the shared pin names", () => {
    const gated = Object.entries(behaviours)
      .filter(([, behaviour]) =>
        behaviour.preflightStepUp !== undefined
        || behaviour.planStepUp !== undefined
        || behaviour.precondition !== undefined)
      .map(([key]) => key);
    expect(gated.sort()).toEqual([...CAPABILITIES_WITH_STEP_UP_GATE].sort());
  });
});

/**
 * A CHECK constraint's permitted values, read from the WHOLE migration directory.
 *
 * LAST ONE WINS, because a constraint can be dropped and re-added by a later migration — reading
 * only the file that first declared it goes stale the first time anything is widened, and then this
 * test happily permits a value the live database rejects, or misses one it now accepts. Migration
 * 0190 widened the status CHECK four migrations after 0177 declared it; a single-file reader would
 * still be asserting the old five (docs/27 §7.2).
 */
function checkValuesFromMigrations(pattern: RegExp): string[] {
  const dir = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
  let values: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(`${dir}${file}`, "utf8");
    for (const match of sql.matchAll(new RegExp(pattern.source, pattern.flags))) {
      values = [...(match[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    }
  }
  return values;
}

const approverScopesFromMigrations = (): string[] =>
  checkValuesFromMigrations(/check\s*\(\s*scopes\s*<@\s*array\[([^\]]*)\]/gi);
