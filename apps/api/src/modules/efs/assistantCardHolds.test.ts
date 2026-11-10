import { beforeEach, describe, expect, it, vi } from "vitest";
import { stripNeverExposed, type EfsCardSummary } from "@silvicom/shared";

/** The tool's answer is `unknown` to its caller (it goes to the model as JSON); tests read named fields. */
type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Ask AI's `card_holds` (F21 R6b). Its header promises the page's own list read, the page's status
 * words and clock, the account's upper-case spellings matched, and a card EFS no longer lists kept
 * apart. So `listEfsCards` is a spy answering the account's real spellings (`HOLD`, `FRAUD`, `ACTIVE`),
 * an absent FRAUD card with an old sync (which must neither count as held nor drag the clock), and a
 * driver-id prompt that must not reach the answer.
 */
const listEfsCards = vi.fn();
vi.mock("./services/efsCardList.js", () => ({ listEfsCards: (...a: unknown[]) => listEfsCards(...a) }));
const { assistantCardHolds, CARD_HOLDS_SOURCE } = await import("./assistantCardHolds.js");

const ORG = "org-1";
const c = (last4: string, status: string, unit: string | null, extra: Partial<EfsCardSummary> = {}): EfsCardSummary =>
  ({
    id: `c${last4}`, last4, maskedRef: `•••• ${last4}`, status, policyNumber: 1, driverIdPrompt: "4417", unitPrompt: unit,
    driverName: unit ? `DRIVER ${unit}` : null, overrideUses: null, overrideAllLocations: null, locationOverrideId: null,
    lastUsedDate: "2026-11-09", fuelCardId: null, linkStatus: null, linkMethod: null, linkCandidates: 0,
    syncedAt: "2026-11-10T19:55:00Z", detailSyncedAt: null, absentSince: null, syncError: null, syncErrorSource: null, syncErrorAt: null,
    ...extra,
  }) as EfsCardSummary;

const CARDS = [
  c("7468", "HOLD", "819"),
  c("7145", "FRAUD", "751", { syncedAt: "2026-11-10T19:50:00Z" }),
  c("7979", "Hold", "62"),
  c("1111", "ACTIVE", "700"),
  c("2222", "ACTIVE", "701"),
  c("3333", "INACTIVE", null),
  c("7967", "FRAUD", null, { syncedAt: "2026-09-23T10:00:00Z", absentSince: "2026-09-24T00:00:00Z" }),
];

beforeEach(() => {
  listEfsCards.mockReset();
  listEfsCards.mockResolvedValue({ ok: true, cards: CARDS, total: CARDS.length });
});

describe("card_holds — the Fuel Cards page's statuses", () => {
  it("reads the page's own list for this org, unfiltered, and counts the account's spellings", async () => {
    const admin = {} as never;
    const out = (await assistantCardHolds(admin, ORG, {})) as Out;
    expect(listEfsCards).toHaveBeenCalledWith(admin, ORG);
    expect(out).toMatchObject({
      source: CARD_HOLDS_SOURCE,
      cards_on_the_account: 6,
      by_status: { "On hold": 2, "Fraud hold": 1, Active: 2, Inactive: 1 },
      on_hold_now: 2,
      fraud_hold_now: 1,
    });
  });

  it("lists fraud first, then holds by truck, named as the page names them", async () => {
    const out = (await assistantCardHolds({} as never, ORG, {})) as Out;
    expect(out.cards).toEqual([
      { card: "•••• 7145", truck: "751", driver: "DRIVER 751", status: "Fraud hold", last_used: "2026-11-09", checked_at: "2026-11-10T19:50:00Z" },
      { card: "•••• 7979", truck: "62", driver: "DRIVER 62", status: "On hold", last_used: "2026-11-09", checked_at: "2026-11-10T19:55:00Z" },
      { card: "•••• 7468", truck: "819", driver: "DRIVER 819", status: "On hold", last_used: "2026-11-09", checked_at: "2026-11-10T19:55:00Z" },
    ]);
  });

  it("keeps a card EFS no longer lists apart: not a current hold, and not dragging the page's clock", async () => {
    const out = (await assistantCardHolds({} as never, ORG, {})) as Out;
    expect(out.cards.map((x: Out) => x.card)).not.toContain("•••• 7967");
    expect(out.no_longer_listed_by_efs).toEqual([expect.objectContaining({ card: "•••• 7967", status: "Fraud hold", no_longer_listed_by_efs_since: "2026-09-24T00:00:00Z" })]);
    expect(out.cards_checked_at).toBe("2026-11-10T19:50:00Z");
  });

  it("status=Fraud lists only fraud holds", async () => {
    const out = (await assistantCardHolds({} as never, ORG, { status: "fraud" })) as Out;
    expect(out.cards.map((x: Out) => x.card)).toEqual(["•••• 7145"]);
  });

  it("never carries a full card number or the driver-id prompt, before or after the D-AI7 strip", async () => {
    const out = (await assistantCardHolds({} as never, ORG, {})) as Out;
    const text = JSON.stringify(out);
    expect(text).not.toContain("4417");
    expect(JSON.stringify(stripNeverExposed(out))).toBe(text);
  });

  it("a failed read is an error, never an empty fleet", async () => {
    listEfsCards.mockResolvedValue({ ok: false, error: { message: "db down" } });
    await expect(assistantCardHolds({} as never, ORG, {})).rejects.toThrow("db down");
  });
});
