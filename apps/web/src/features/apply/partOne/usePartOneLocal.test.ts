import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { effectScope, ref } from "vue";
import type { ApplicationCaptureView, FcraSummary, PartOneStatus } from "@silvicom/shared";
import { usePartOne, type PartOneInputs } from "./usePartOne";
import { readHeld } from "./partOneLocal";

/**
 * Part 1's walk with its device copy (C3d1a, AW10). The defect: screens 3–6 are held in the page until
 * screen 7, so a reload lost them. Pinned: what the driver types there survives a new page on the same
 * link, the walk reopens on the screen they had reached, screen 7 then writes the restored answers in its
 * one order, and the copy is gone the moment it has; screen 7's own answers never reach the device; a link
 * already begun deletes any copy; a restore never overwrites typing; and no key keeps nothing.
 */

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const ok = () => ({ ok: true, json: async () => ({ ok: true, keptExisting: [] }) }) as Response;

const TOKEN = "t".repeat(43);
const KEY = "a".repeat(64);
const LOCAL = { key: KEY, linkExpiresAt: "2099-01-01T00:00:00Z" };
const cap = (slot: string) => ({ slot, capturedAt: "2026-09-27T10:00:00Z" }) as ApplicationCaptureView;
const BOTH = [cap("cdl_front"), cap("cdl_back")];
const status = (over: Partial<PartOneStatus> = {}): PartOneStatus => ({
  completedAt: null, contact: false, address: false, licences: false, screening: false,
  medicalCardPending: false, rights: false, ...over,
});

/** A new page on the link: a fresh walk, in its own scope, as a reload makes one. */
function page(over: Partial<PartOneInputs> = {}) {
  const inputs = ref<PartOneInputs>({
    status: status(), identityComplete: false, captures: BOTH, summary: { version: "v" } as FcraSummary, local: LOCAL, ...over,
  });
  const scope = effectScope();
  const flow = scope.run(() => usePartOne(ref(TOKEN), inputs, async () => inputs.value, () => {}))!;
  return { flow, inputs, close: () => scope.stop() };
}

/** Past the write's debounce; the store's queue then orders any read after the write. */
const settle = () => new Promise((r) => setTimeout(r, 400));

function typeScreens3to6(flow: ReturnType<typeof page>["flow"]): void {
  Object.assign(flow.answers, {
    phone: "7082365732", date_of_birth: "1985-03-07",
    address_line1: "1 Main St", city: "Joliet", state: "IL", postal_code: "60432", otherHeld: false,
  });
  Object.assign(flow.answers.cdl, { state_code: "IL", licence_number: "D123", cdl_class: "A", expires_on: "2029-01-01" });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(ok());
});

describe("a reload before screen 7", () => {
  it("brings back screens 3–6 and reopens where the driver was, having sent nothing", async () => {
    const first = page();
    await first.flow.restored;
    typeScreens3to6(first.flow);
    await first.flow.next();
    await first.flow.next();
    expect(first.flow.screen.value).toBe("licence");
    await settle();
    first.close();

    const second = page();
    expect(await second.flow.restored).toBe(true);
    expect(second.flow.screen.value).toBe("licence");
    expect(second.flow.answers.date_of_birth).toBe("1985-03-07");
    expect(second.flow.answers.cdl.licence_number).toBe("D123");
    expect(second.flow.answers.city).toBe("Joliet");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still knows the screens passed before the first reload after a second one", async () => {
    const first = page();
    await first.flow.restored;
    typeScreens3to6(first.flow);
    await first.flow.next();
    await first.flow.next();
    await settle();
    first.close();

    const second = page();
    await second.flow.restored;
    second.flow.answers.cdl.endorsements.push("N");
    await settle();
    second.close();

    const third = page();
    await third.flow.restored;
    expect(third.flow.screen.value).toBe("licence");
    expect(third.flow.answers.cdl.endorsements).toEqual(["N"]);
  });

  it("keeps a box typed mid-screen, before any Continue", async () => {
    const first = page();
    await first.flow.restored;
    first.flow.answers.phone = "7082365732";
    await settle();
    first.close();

    const second = page();
    await second.flow.restored;
    expect(second.flow.screen.value).toBe("about");
    expect(second.flow.answers.phone).toBe("7082365732");
  });

  it("writes the restored answers through screen 7's one order, then deletes the copy", async () => {
    const first = page();
    await first.flow.restored;
    typeScreens3to6(first.flow);
    for (let i = 0; i < 4; i++) await first.flow.next();
    await settle();
    first.close();

    const second = page();
    await second.flow.restored;
    expect(second.flow.screen.value).toBe("screening");
    Object.assign(second.flow.answers, { prior_positive_2y: false, dot_program_30d: false });
    await second.flow.next();
    const paths = fetchMock.mock.calls.map(([url]) => String(url).replace(`/api/public/application/${TOKEN}`, ""));
    expect(paths).toEqual(["/intake", "/intake/licences", "/intake"]);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
    expect(bodies[1]).toEqual({ licences: [{ state_code: "IL", licence_number: "D123", expires_on: "2029-01-01" }] });
    expect(bodies[2]).toEqual({ date_of_birth: "1985-03-07" });
    await settle();
    expect(await readHeld(KEY)).toBeNull();
  });

  it("keeps the copy when screen 7's write fails, so the next press still has it", async () => {
    const { flow } = page();
    await flow.restored;
    typeScreens3to6(flow);
    for (let i = 0; i < 4; i++) await flow.next();
    Object.assign(flow.answers, { prior_positive_2y: false, dot_program_30d: false });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await flow.next();
    expect(flow.screen.value).toBe("screening");
    await settle();
    expect((await readHeld(KEY))?.answers.cdl.licence_number).toBe("D123");
  });

  it("dies with the link when the link lapses before the 72 hours do", async () => {
    const soon = { key: KEY, linkExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
    const { flow } = page({ local: soon });
    await flow.restored;
    typeScreens3to6(flow);
    await settle();
    expect(await readHeld(KEY)).not.toBeNull();
    expect(await readHeld(KEY, new Date(Date.now() + 2 * 60 * 60 * 1000))).toBeNull();
  });

  it("never puts screen 7's answers on the device", async () => {
    const { flow } = page();
    await flow.restored;
    typeScreens3to6(flow);
    Object.assign(flow.answers, { prior_positive_2y: true, dot_program_30d: true, dot_tested_6m: true });
    await settle();
    const stored = await readHeld(KEY);
    expect(stored?.answers.phone).toBe("7082365732");
    expect(JSON.stringify(stored)).not.toMatch(/prior_positive|dot_program|dot_tested|dot_random|medical_card/);
  });

  it("keeps what the barcode filled marked as filled, so the screen still asks the driver to check it", async () => {
    const inputs = ref<PartOneInputs>({ status: status(), identityComplete: false, captures: [cap("cdl_front")], summary: null, local: LOCAL });
    const scope = effectScope();
    const flow = scope.run(() =>
      usePartOne(ref(TOKEN), inputs, async () => inputs.value, () => {}, async () => ({
        aamvaVersion: 10, iin: "636035", issuingState: "IL", licenceNumber: "J1", familyName: "K", firstName: "A",
        middleName: null, dateOfBirth: "1979-11-30", expiresOn: "2027-11-30",
        address: { line1: "1 N ST", line2: null, city: "CHICAGO", state: "IL", postalCode: "60601" },
      })))!;
    await flow.restored;
    expect(flow.screen.value).toBe("cdl_back");
    await flow.licencePhotoStaged(new Blob(["back"]));
    await settle();
    scope.stop();

    const after = page();
    await after.flow.restored;
    expect(after.flow.screen.value).toBe("about");
    expect(after.flow.answers.date_of_birth).toBe("1979-11-30");
    expect(after.flow.prefilledHere.value).toBe(true);
  });
});

describe("when the copy is not applied", () => {
  it("deletes it on a link already begun — the server holds screens 3–6 by then", async () => {
    const first = page();
    await first.flow.restored;
    typeScreens3to6(first.flow);
    await settle();
    first.close();
    expect(await readHeld(KEY)).not.toBeNull();

    const begun = page({ status: status({ screening: true, contact: true, address: true, licences: true }), identityComplete: true });
    expect(await begun.flow.restored).toBe(false);
    expect(begun.flow.answers.phone).toBe("");
    expect(await readHeld(KEY)).toBeNull();
  });

  it("never overwrites typing that came first", async () => {
    const first = page();
    await first.flow.restored;
    typeScreens3to6(first.flow);
    await settle();
    first.close();

    const second = page();
    second.flow.answers.phone = "3125550100";
    expect(await second.flow.restored).toBe(false);
    expect(second.flow.answers.phone).toBe("3125550100");
    expect(second.flow.answers.city).toBe("");
  });

  it("restores the answers but stays on a photograph still owed", async () => {
    const first = page();
    await first.flow.restored;
    typeScreens3to6(first.flow);
    await first.flow.next();
    await settle();
    first.close();

    const second = page({ captures: [cap("cdl_front")] });
    expect(await second.flow.restored).toBe(true);
    expect(second.flow.screen.value).toBe("cdl_back");
    expect(second.flow.answers.phone).toBe("7082365732");
  });

  it("keeps nothing for a link served without a key", async () => {
    const { flow } = page({ local: null });
    expect(await flow.restored).toBe(false);
    typeScreens3to6(flow);
    await settle();
    expect(await readHeld(KEY)).toBeNull();
  });

  it("keeps another link's copy apart", async () => {
    const first = page();
    await first.flow.restored;
    typeScreens3to6(first.flow);
    await settle();
    first.close();

    const other = page({ local: { key: "b".repeat(64), linkExpiresAt: LOCAL.linkExpiresAt } });
    expect(await other.flow.restored).toBe(false);
    expect(other.flow.answers.phone).toBe("");
  });
});
