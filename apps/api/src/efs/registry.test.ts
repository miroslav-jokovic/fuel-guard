import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CARD_CAPABILITY_CONTRACTS, CARD_MUTATION_INTENTS, cardWriteBucket } from "@fuelguard/shared";
import { cardLockBehaviour } from "./capabilities/cardLock.behaviour.js";
import { cardUnlockBehaviour } from "./capabilities/cardUnlock.behaviour.js";
import { MOUNTED_CAPABILITIES } from "./registry.js";

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

const behaviours = { card_lock: cardLockBehaviour, card_unlock: cardUnlockBehaviour } as const;
const MOUNT_PREFIX = "/api/fuel-cards";

/** The keys this test knows about. Deliberately hardcoded: it is the thing being compared against. */
const EXPECTED_KEYS = ["card_lock", "card_unlock"];

describe("the capability registries agree with each other", () => {
  it("discovered every capability — without this, every loop below is vacuous", () => {
    expect(Object.keys(CARD_CAPABILITY_CONTRACTS).sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(MOUNTED_CAPABILITIES).toHaveLength(EXPECTED_KEYS.length);
  });

  it("pairs every contract with exactly one behaviour, and mounts it", () => {
    // A contract with no behaviour is a route the router cannot serve; a behaviour with no contract
    // is code that can never run. Both are invisible until somebody presses the button.
    expect(Object.keys(behaviours).sort()).toEqual(Object.keys(CARD_CAPABILITY_CONTRACTS).sort());
    expect(MOUNTED_CAPABILITIES.map((m) => m.contract.key).sort())
      .toEqual(Object.keys(CARD_CAPABILITY_CONTRACTS).sort());
  });

  it("declares an intent the database will actually accept", () => {
    for (const contract of Object.values(CARD_CAPABILITY_CONTRACTS)) {
      // Many-to-one is legitimate — `override_clear` is one intent with two mechanisms — so this is
      // membership, not a bijection. A miss here fails at INSERT, after the gates have passed.
      expect(CARD_MUTATION_INTENTS, `${contract.key} intent`).toContain(contract.intent);
    }
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
    for (const capability of MOUNTED_CAPABILITIES) {
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

  it("declares a reason rule, so a capability cannot default into silence", () => {
    for (const contract of Object.values(CARD_CAPABILITY_CONTRACTS)) {
      expect(["optional", "required"], `${contract.key} reason`).toContain(contract.reason);
    }
  });
});

/**
 * The approver-scope CHECK, read from the WHOLE migration directory rather than from `0173`.
 *
 * Last-one-wins, because a constraint can be dropped and re-added by a later migration — reading
 * only the file that first declared it goes stale the first time anything is widened, and then this
 * test happily permits a scope the live database rejects (docs/27 §7.2).
 */
function approverScopesFromMigrations(): string[] {
  const dir = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
  let scopes: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(`${dir}${file}`, "utf8");
    for (const match of sql.matchAll(/check\s*\(\s*scopes\s*<@\s*array\[([^\]]*)\]/gi)) {
      scopes = [...(match[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    }
  }
  return scopes;
}
