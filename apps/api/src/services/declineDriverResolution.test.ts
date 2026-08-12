import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../testing/supabaseRecorder.js";
import type { Env } from "../env.js";
import { cardRefHmac } from "./efsCardMirror.js";
import { resolveDeclineDrivers } from "./declineDriverResolution.js";

/**
 * The reject feed carries no driver (getTranRejects, verified against production 2026-08-12: ten
 * fields, no driverName/driverId), so this service DERIVES one from the card. What these tests
 * pin down is not that it fills rows — it is the four cases where it must REFUSE to, because a
 * wrong name on a fraud page is worse than a blank one.
 */

const ORG = "86d6b3ea-4361-4f71-877f-e8373615769b";
const env = { SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as unknown as Env;

const PAN_A = "7083050030485867142";
const PAN_B = "7083050013944594507";

/** The update statements this service issued, as {ids, payload} — its whole observable effect. */
const updatesTo = (rec: { forTable(t: string): RecordedQuery[] }, table: string) =>
  rec
    .forTable(table)
    .filter((q) => q.write?.method === "update")
    .map((q) => ({
      ids: (q.filters().find((f) => f.col === "id")?.val ?? []) as string[],
      payload: q.write?.payload as Record<string, unknown>,
    }));

/**
 * Wire a recorder for one scenario. `declines` are the blank rows the service will page in; a WRITE
 * to the same table has to answer with the ids it targeted, not with the fixture rows, or the
 * service's "rows actually changed" counters would count reads.
 */
function scenario(opts: {
  declines: { id: string; card_ref: string | null; driver_id: string | null }[];
  efsCards?: { card_ref_hmac: string; driver_name: string | null }[];
  efsTransactions?: { card_num: string | null; driver_name: string | null }[];
  drivers?: { id: string; full_name: string }[];
}) {
  return createSupabaseRecorder({
    tables: {
      declined_transactions: (q: RecordedQuery) => {
        if (q.write) {
          const ids = (q.filters().find((f) => f.col === "id")?.val ?? []) as string[];
          return ids.map((id) => ({ id }));
        }
        return opts.declines;
      },
      efs_cards: opts.efsCards ?? [],
      efs_transactions: opts.efsTransactions ?? [],
      drivers: opts.drivers ?? [],
    },
  });
}

describe("resolveDeclineDrivers", () => {
  it("fills the card's assigned driver from the mirror, tagged card_mirror, and links the record", async () => {
    const rec = scenario({
      declines: [{ id: "d1", card_ref: `${PAN_A}      `, driver_id: null }],
      efsCards: [{ card_ref_hmac: cardRefHmac(env, ORG, PAN_A), driver_name: "YOEL VALLADARES ALBARENG" }],
      drivers: [{ id: "drv-1", full_name: "Yoel Valladares Albareng" }],
    });

    const r = await resolveDeclineDrivers(rec.client, env, ORG);

    expect(r.fromCardMirror).toBe(1);
    expect(r.stillUnresolved).toBe(0);
    expect(r.linkedToDriver).toBe(1);

    const [named, linked] = updatesTo(rec, "declined_transactions");
    expect(named).toBeDefined();
    expect(named!.payload).toEqual({
      driver_name: "YOEL VALLADARES ALBARENG",
      driver_name_source: "card_mirror",
    });
    // The link is a SEPARATE statement so it can carry its own `driver_id is null` guard.
    expect(linked).toBeDefined();
    expect(linked!.payload).toEqual({ driver_id: "drv-1" });
    expectOrgScoped(rec, ORG);
  });

  it("matches a mirror row even though EFS space-pads the decline's card ref", async () => {
    // The mirror hashes the card number getCardSummaries returned; the decline's ref arrives padded.
    // Probing both spellings is the difference between a filled column and a silently empty one.
    const rec = scenario({
      declines: [{ id: "d1", card_ref: `  ${PAN_A}   `, driver_id: null }],
      efsCards: [{ card_ref_hmac: cardRefHmac(env, ORG, PAN_A), driver_name: "DONOVAN BOOTHE" }],
    });
    const r = await resolveDeclineDrivers(rec.client, env, ORG);
    expect(r.fromCardMirror).toBe(1);
  });

  it("falls back to approved-fill history when the mirror does not know the card", async () => {
    const rec = scenario({
      declines: [{ id: "d1", card_ref: PAN_B, driver_id: null }],
      efsCards: [],
      efsTransactions: [
        { card_num: `${PAN_B} `, driver_name: "DONOVAN BOOTHE" },
        { card_num: `${PAN_B}`, driver_name: "BOOTHE, DONOVAN" }, // same person, different spelling
      ],
    });

    const r = await resolveDeclineDrivers(rec.client, env, ORG);

    expect(r.fromPostedHistory).toBe(1);
    expect(r.fromCardMirror).toBe(0);
    expect(updatesTo(rec, "declined_transactions")[0]?.payload).toEqual({
      driver_name: "DONOVAN BOOTHE",
      driver_name_source: "posted_history",
    });
  });

  it("REFUSES a masked card ref — a last-4 names no single card", async () => {
    const rec = scenario({
      declines: [{ id: "d1", card_ref: "708305XXXXXX7142", driver_id: null }],
      efsCards: [{ card_ref_hmac: cardRefHmac(env, ORG, PAN_A), driver_name: "YOEL VALLADARES ALBARENG" }],
    });

    const r = await resolveDeclineDrivers(rec.client, env, ORG);

    expect(r.unidentifiableCard).toBe(1);
    expect(r.stillUnresolved).toBe(1);
    expect(r.fromCardMirror + r.fromPostedHistory).toBe(0);
    expect(updatesTo(rec, "declined_transactions")).toHaveLength(0);
  });

  it("REFUSES a card whose history shows two different drivers", async () => {
    const rec = scenario({
      declines: [{ id: "d1", card_ref: PAN_B, driver_id: null }],
      efsTransactions: [
        { card_num: PAN_B, driver_name: "DONOVAN BOOTHE" },
        { card_num: PAN_B, driver_name: "ANTHONY CASTILLO" }, // a shared card — do not pick one
      ],
    });

    const r = await resolveDeclineDrivers(rec.client, env, ORG);

    expect(r.stillUnresolved).toBe(1);
    expect(updatesTo(rec, "declined_transactions")).toHaveLength(0);
  });

  it("REFUSES to link a driver record when two people share a match key", async () => {
    const rec = scenario({
      declines: [{ id: "d1", card_ref: PAN_A, driver_id: null }],
      efsCards: [{ card_ref_hmac: cardRefHmac(env, ORG, PAN_A), driver_name: "John Smith" }],
      drivers: [
        { id: "drv-1", full_name: "John Smith" },
        { id: "drv-2", full_name: "SMITH, JOHN" }, // same key → ambiguous, so neither wins
      ],
    });

    const r = await resolveDeclineDrivers(rec.client, env, ORG);

    expect(r.fromCardMirror).toBe(1); // the NAME is still safe to show — it came from the card
    expect(r.linkedToDriver).toBe(0); // the LINK is not
    expect(updatesTo(rec, "declined_transactions")).toHaveLength(1);
  });

  it("does nothing when every decline already has a name", async () => {
    const rec = scenario({ declines: [] });
    const r = await resolveDeclineDrivers(rec.client, env, ORG);
    expect(r).toMatchObject({ candidates: 0, fromCardMirror: 0, fromPostedHistory: 0 });
    expect(rec.writes()).toHaveLength(0);
  });
});
