import { describe, expect, it } from "vitest";
import { seal, secretAad } from "../../../lib/secretBox.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { linkFuelCards } from "./efsCardLinking.js";
import { testEnv } from "../../../testing/testEnv.js";

const ORG = "org-1";
const env = testEnv({
  // 32 bytes, base64 — a test key, never a deploy key.
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
});

describe("linkFuelCards — identity, not compatibility (Step 7.7)", () => {
  /**
   * The defect: this function decided identity with `cardRefsMatch`, whose own doc comment says it
   * is "a COMPATIBILITY test, not an identity test" and that anything deciding two rows are the same
   * card must not use it. On production that meant 40 last-4 groups holding more than one live card,
   * 143 cards unlinked, and fuel attribution running on a quarter of the fleet.
   *
   * `sealed()` builds the same ciphertext the mirror writes, so these fixtures exercise the real
   * unseal path rather than a stubbed PAN.
   */
  const sealed = (pan: string) => seal(env, pan, secretAad(ORG, "efs_card_pan"));
  const PAN_1 = "7083000000000007521";
  const PAN_2 = "7083999999999997521"; // different card, SAME last four

  it("links on the full card number, and records how", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [{ id: "efs-1", card_last4: "7521", unit_prompt: null, card_number_sealed: sealed(PAN_1) }],
        fuel_cards: [{ id: "fc-1", card_ref: PAN_1, card_last4: "7521", vehicle_id: null }],
        vehicles: [],
      },
    });
    expect(await linkFuelCards(rec.client, env, ORG)).toBe(1);
    expect(rec.writtenRows("efs_cards")[0]).toMatchObject({
      fuel_card_id: "fc-1",
      fuel_card_link: expect.objectContaining({ status: "linked", method: "pan_exact" }),
    });
  });

  it("THE CASE THIS STEP EXISTS FOR: two cards sharing a last-4 each link to the RIGHT fuel card", async () => {
    // Step 7.7's Verify, verbatim: "a fixture with two cards sharing a last-4 links each to the right
    // fuel card, or links neither and says why — never the wrong one." The old code linked neither.
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [
          { id: "efs-1", card_last4: "7521", unit_prompt: null, card_number_sealed: sealed(PAN_1) },
          { id: "efs-2", card_last4: "7521", unit_prompt: null, card_number_sealed: sealed(PAN_2) },
        ],
        fuel_cards: [
          { id: "fc-1", card_ref: PAN_1, card_last4: "7521", vehicle_id: null },
          { id: "fc-2", card_ref: PAN_2, card_last4: "7521", vehicle_id: null },
        ],
        vehicles: [],
      },
    });
    expect(await linkFuelCards(rec.client, env, ORG)).toBe(2);
    const written = rec.writtenRows("efs_cards");
    // Each to ITS OWN card. A pair assertion, because a linker that pointed both at fc-1 would still
    // report "2 linked" and would be silently mis-attributing one truck's fuel.
    expect(written[0]).toMatchObject({ fuel_card_id: "fc-1" });
    expect(written[1]).toMatchObject({ fuel_card_id: "fc-2" });
  });

  it("falls back to last-4 + unit when there is no readable card number", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [{ id: "efs-1", card_last4: "7521", unit_prompt: "716", card_number_sealed: null }],
        fuel_cards: [
          { id: "fc-1", card_ref: PAN_1, card_last4: "7521", vehicle_id: "veh-1" },
          { id: "fc-2", card_ref: PAN_2, card_last4: "7521", vehicle_id: "veh-2" },
        ],
        vehicles: [{ id: "veh-1", unit_number: "716" }, { id: "veh-2", unit_number: "802" }],
      },
    });
    expect(await linkFuelCards(rec.client, env, ORG)).toBe(1);
    expect(rec.writtenRows("efs_cards")[0]).toMatchObject({
      fuel_card_id: "fc-1",
      fuel_card_link: expect.objectContaining({ method: "last4_unit" }),
    });
  });

  it("normalises unit numbers, so \"716\" and \"716 - SOLD\" are one unit", async () => {
    // Both sides are free text and the fleet really does write "183 - SOLD" and "204/spare".
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [{ id: "efs-1", card_last4: "7521", unit_prompt: " 716 ", card_number_sealed: null }],
        fuel_cards: [{ id: "fc-1", card_ref: PAN_1, card_last4: "7521", vehicle_id: "veh-1" }],
        vehicles: [{ id: "veh-1", unit_number: "716 - SOLD" }],
      },
    });
    expect(await linkFuelCards(rec.client, env, ORG)).toBe(1);
  });

  it("refuses, and NAMES what it could not tell apart", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [{ id: "efs-1", card_last4: "7521", unit_prompt: null, card_number_sealed: null }],
        fuel_cards: [
          { id: "fc-1", card_ref: PAN_1, card_last4: "7521", vehicle_id: null },
          { id: "fc-2", card_ref: PAN_2, card_last4: "7521", vehicle_id: null },
        ],
        vehicles: [],
      },
    });
    expect(await linkFuelCards(rec.client, env, ORG)).toBe(0);
    const row = rec.writtenRows("efs_cards")[0]!;
    expect(row).not.toHaveProperty("fuel_card_id");
    // The candidate list IS the finding — Step 7.7 asks a stuck row to name the cards it could not
    // choose between, so somebody can resolve it instead of wondering.
    expect(row.fuel_card_link).toMatchObject({ status: "ambiguous", method: null });
    expect((row.fuel_card_link as { candidates: string[] }).candidates.sort()).toEqual(["fc-1", "fc-2"]);
  });

  it("never writes sync_error — that column is the REFRESH outcome, not the linking one", async () => {
    // The overload this repository already named (Step 7.5): `linkFuelCards` runs last in the sweep
    // and used to overwrite what the earlier passes set, so a SUCCESSFUL refresh displayed as
    // "Last refresh reported: ambiguous_fuel_card_link".
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [{ id: "efs-1", card_last4: "7521", unit_prompt: null, card_number_sealed: null }],
        fuel_cards: [
          { id: "fc-1", card_ref: PAN_1, card_last4: "7521", vehicle_id: null },
          { id: "fc-2", card_ref: PAN_2, card_last4: "7521", vehicle_id: null },
        ],
        vehicles: [],
      },
    });
    await linkFuelCards(rec.client, env, ORG);
    for (const row of rec.writtenRows("efs_cards")) expect(row).not.toHaveProperty("sync_error");
  });

  it("distinguishes the three ways a card can fail to link", async () => {
    // Each status sends somebody to a DIFFERENT place, which is the only reason to have three:
    //   no_candidate → import the missing fuel_cards row
    //   unconfirmed  → one likely partner, but a last-4 is not identity, so a person confirms it
    //   ambiguous    → give the card a unit prompt; the next sweep resolves it
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [
          { id: "efs-none", card_last4: "0000", unit_prompt: null, card_number_sealed: null },
          { id: "efs-one", card_last4: "9999", unit_prompt: null, card_number_sealed: null },
          { id: "efs-many", card_last4: "7521", unit_prompt: null, card_number_sealed: null },
        ],
        fuel_cards: [
          { id: "fc-solo", card_ref: "7083000000000009999", card_last4: "9999", vehicle_id: null },
          { id: "fc-1", card_ref: PAN_1, card_last4: "7521", vehicle_id: null },
          { id: "fc-2", card_ref: PAN_2, card_last4: "7521", vehicle_id: null },
        ],
        vehicles: [],
      },
    });
    expect(await linkFuelCards(rec.client, env, ORG)).toBe(0);
    const [none, one, many] = rec.writtenRows("efs_cards");
    expect(none!.fuel_card_link).toMatchObject({ status: "no_candidate" });
    // The near-miss. It is NOT linked — a single last-4 match is still not an identity, and this is
    // exactly the guess the old code made 54 times.
    expect(one!.fuel_card_link).toMatchObject({ status: "unconfirmed", candidates: ["fc-solo"] });
    expect(many!.fuel_card_link).toMatchObject({ status: "ambiguous" });
  });

  it("says `unidentifiable` only when there is not even a last-4 to reason about", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [{ id: "efs-1", card_last4: null, unit_prompt: null, card_number_sealed: null }],
        fuel_cards: [{ id: "fc-1", card_ref: PAN_1, card_last4: "7521", vehicle_id: null }],
        vehicles: [],
      },
    });
    expect(await linkFuelCards(rec.client, env, ORG)).toBe(0);
    // The mirror row itself is the thing to fix here, not the fuel_cards side.
    expect(rec.writtenRows("efs_cards")[0]!.fuel_card_link).toMatchObject({ status: "unidentifiable" });
  });

  it("degrades to the weaker tiers when a PAN cannot be unsealed, rather than aborting the sweep", async () => {
    // The config scanner's `parseXml` threw where its caller expected null and would have aborted a
    // whole scan on one bad row. Same shape of mistake, pre-empted here.
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [{ id: "efs-1", card_last4: "7521", unit_prompt: "716", card_number_sealed: "not-a-ciphertext" }],
        fuel_cards: [{ id: "fc-1", card_ref: PAN_1, card_last4: "7521", vehicle_id: "veh-1" }],
        vehicles: [{ id: "veh-1", unit_number: "716" }],
      },
    });
    expect(await linkFuelCards(rec.client, env, ORG)).toBe(1);
    expect(rec.writtenRows("efs_cards")[0]).toMatchObject({
      fuel_card_link: expect.objectContaining({ method: "last4_unit" }),
    });
  });

  it("skips tombstoned cards — a de-listed card has no counterpart to find", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [{ id: "efs-1", card_last4: "7521", unit_prompt: null, card_number_sealed: sealed(PAN_1) }],
        fuel_cards: [{ id: "fc-1", card_ref: PAN_1, card_last4: "7521", vehicle_id: null }],
        vehicles: [],
      },
    });
    await linkFuelCards(rec.client, env, ORG);
    // Asserted on the QUERY, because the recorder returns its fixture regardless of the filter — the
    // whole reason expectOrgScoped exists. Two production cards are tombstoned today.
    const filters = rec.forTable("efs_cards")[0]!.ops.map((o) => `${o.method}(${JSON.stringify(o.args)})`);
    expect(filters.some((f) => f.includes("absent_since"))).toBe(true);
  });

  it("scopes its reads and its writes to the org", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [{ id: "efs-1", card_last4: "7521", unit_prompt: null, card_number_sealed: sealed(PAN_1) }],
        fuel_cards: [{ id: "fc-1", card_ref: PAN_1, card_last4: "7521", vehicle_id: null }],
        vehicles: [],
      },
    });
    await linkFuelCards(rec.client, env, ORG);
    expectOrgScoped(rec, ORG);
  });
});
