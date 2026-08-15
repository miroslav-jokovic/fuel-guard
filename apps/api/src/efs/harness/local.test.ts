import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { replayCapability, replayableCapabilities } from "./local.js";

/**
 * Step 4.3 — the offline half of the harness.
 *
 * Every case here answers "what does pressing this button put on the wire", against a recorded
 * document, with no server, no database and no vendor. The real `assertEchoFidelity` runs inside
 * `replayCapability`, so a serializer regression fails these tests rather than a live card.
 */

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../lib/__fixtures__/efs/${name}`, import.meta.url)), "utf8");

const FLAT = fixture("getCardV2.full.xml");
const NESTED = fixture("getCardV2.nestedHeader.xml");
const OVERRIDDEN = fixture("getCardV2.overridden.xml");

const REASON = "Local harness replay";

/** One body per echo capability, chosen so each produces a change rather than a no-op. */
const BODIES: Record<string, unknown> = {
  card_lock: { status: "Hold", reason: REASON },
  card_unlock: { reason: REASON },
  override_grant: { uses: 2, scope: { kind: "all" }, reason: REASON },
  override_clear: { reason: REASON },
  prompts_set: {
    reason: REASON, replaceAll: true, allowRemoveDriverId: false,
    prompts: [{ infoId: "UNIT", validationType: "REPORT_ONLY", matchValue: null, reportValue: "651", remove: false }],
  },
};

describe("the local harness covers every capability that echoes a document", () => {
  it("knows exactly which capabilities it can replay, derived from the registry", () => {
    // Derived, not listed: a hand-written list is one somebody forgets to extend, and the capability
    // it forgets is the one this harness silently stops covering.
    expect(replayableCapabilities()).toEqual([
      "card_lock", "card_unlock", "override_clear", "override_grant", "prompts_set",
    ]);
  });

  it("has a body for every replayable capability — so the loop below cannot be vacuous", () => {
    expect(Object.keys(BODIES).sort()).toEqual(replayableCapabilities());
  });

  for (const capability of ["card_lock", "card_unlock", "override_grant", "override_clear", "prompts_set"]) {
    it(`produces a faithful, non-empty request for ${capability}`, () => {
      const result = replayCapability({ capabilityKey: capability, documentXml: FLAT, body: BODIES[capability] });

      // `assertEchoFidelity` already ran inside — reaching this line means the bytes passed the same
      // guard `setCardV2` applies before dispatch.
      expect(result.edits.length).toBeGreaterThan(0);
      expect(result.requestXml).toContain("<card>");
      // The whole document is echoed, not a patch: a request missing a field DELETES it (guide p137).
      expect(result.requestXml).toContain("<policyNumber>");
    });
  }
});

describe("what the bytes actually say", () => {
  it("locks in the account's own casing, not the guide's", () => {
    // `getCardV2.full.xml` reports `Active`, so the write is spelled `Hold`. An account reporting
    // `ACTIVE` gets `HOLD` — the H1 incident, and `matchStatusCasing` is what makes it so.
    const result = replayCapability({ capabilityKey: "card_lock", documentXml: FLAT, body: BODIES.card_lock });

    expect(result.requestXml).toContain("<status>Hold</status>");
    expect(result.edits).toEqual([{ op: "setField", name: "status", value: "Hold" }]);
  });

  it("moves all three override fields on a grant, and clears a stale location", () => {
    // `getCardV2.overridden.xml` carries locationOverride 115732. An all-locations grant that left it
    // there would assert both scopes at once — the operator told "everywhere", the driver declined
    // outside Effingham.
    const result = replayCapability({
      capabilityKey: "override_grant", documentXml: OVERRIDDEN, body: BODIES.override_grant,
    });

    expect(result.edits.map((e) => e.name).sort()).toEqual(["locationOverride", "override", "overrideAllLocations"]);
    expect(result.requestXml).toContain("<locationOverride>0</locationOverride>");
  });

  it("addresses the nested header shape, and spells the status the way THAT account does", () => {
    // Two properties in one replay, and the second is the point.
    //
    // Production returns `<card><header>…`, not a flat card; a serializer handling only the flat
    // shape would put `<status>` in the wrong place and the echo guard would refuse the request.
    //
    // And this fixture reports `HOLD` where `getCardV2.full.xml` reports `Active`. The SAME body
    // therefore produces `<status>Hold</status>` against one document and `<status>HOLD</status>`
    // against the other — `matchStatusCasing`, and the H1 incident it exists to prevent, visible in
    // the bytes. A first draft of this test asserted `Hold` here and failed, which is the harness
    // demonstrating exactly what it was built to show.
    const result = replayCapability({ capabilityKey: "card_lock", documentXml: NESTED, body: BODIES.card_lock });

    expect(result.requestXml).toContain("<header>");
    expect(result.requestXml).toContain("<status>HOLD</status>");
    expect(result.requestXml).not.toContain("<status>Hold</status>");
  });

  it("redacts the card number in the copy meant for the ledger", () => {
    const result = replayCapability({ capabilityKey: "card_lock", documentXml: FLAT, body: BODIES.card_lock });

    expect(result.requestXml).toContain("70830000000000000");
    expect(result.redactedXml).not.toContain("70830000000000000");
  });
});

describe("what it refuses rather than guessing", () => {
  it("refuses a capability that names a vendor op instead of echoing a document", () => {
    // `delete_override` is `direct`. Returning empty bytes would read as "this sends nothing", which
    // is true of the request body and false of the operation.
    expect(() => replayCapability({ capabilityKey: "delete_override", documentXml: FLAT, body: { reason: REASON } }))
      .toThrow(/names a vendor operation/);
  });

  it("refuses a body the contract would refuse", () => {
    // The same schema the route runs, so a body this harness accepts is one the API would accept.
    expect(() => replayCapability({ capabilityKey: "card_lock", documentXml: FLAT, body: { status: "Deleted", reason: REASON } }))
      .toThrow(/refused the body/);
  });

  it("refuses an unknown capability", () => {
    expect(() => replayCapability({ capabilityKey: "card_incinerate", documentXml: FLAT, body: {} }))
      .toThrow(/no capability named/);
  });
});
