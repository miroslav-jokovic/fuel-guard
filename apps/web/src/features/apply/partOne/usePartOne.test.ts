import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { ApplicationCaptureView, FcraSummary, PartOneStatus } from "@silvicom/shared";
import { usePartOne, type PartOneInputs } from "./usePartOne";

/**
 * Part 1's walk against a mocked network (C3a). Pinned: screens 3–6 write nothing on a link that has
 * not begun and screen 7 writes all of it in the one order 0376 accepts; a photograph screen does not
 * move on without its photograph; the rights screen records the version it showed and only then ends
 * Part 1; and a returning applicant's licence list — on the server, not in the page — is never
 * overwritten by a page that cannot see it.
 */

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const ok = (body: unknown = { ok: true, keptExisting: [] }) => ({ ok: true, json: async () => body }) as Response;
const refused = (code: string, message = "refused") =>
  ({ ok: false, json: async () => ({ error: { code, message } }) }) as Response;

const TOKEN = "t".repeat(43);
const SUMMARY = { version: "cfpb-appendix-k-2023-09-25" } as FcraSummary;
const cap = (slot: string) => ({ slot, capturedAt: "2026-09-27T10:00:00Z" }) as ApplicationCaptureView;

const status = (over: Partial<PartOneStatus> = {}): PartOneStatus => ({
  completedAt: null, contact: false, address: false, licences: false, screening: false,
  medicalCardPending: false, rights: false, ...over,
});

function walk(over: Partial<PartOneInputs> = {}, captures: ApplicationCaptureView[] = []) {
  const inputs = ref<PartOneInputs>({ status: status(), identityComplete: false, captures: [], summary: SUMMARY, ...over });
  const refresh = vi.fn(async () => ({ ...inputs.value, captures }));
  const done = vi.fn();
  const flow = usePartOne(ref(TOKEN), inputs, refresh, done);
  return { flow, refresh, done };
}

const paths = () => fetchMock.mock.calls.map(([url]) => String(url).replace(`/api/public/application/${TOKEN}`, ""));
const bodies = () => fetchMock.mock.calls.map(([, init]) => (init?.body ? JSON.parse(String(init.body)) : null));

function fill(flow: ReturnType<typeof walk>["flow"]): void {
  Object.assign(flow.answers, {
    phone: "7082365732", date_of_birth: "1985-03-07",
    address_line1: "1 Main St", city: "Joliet", state: "IL", postal_code: "60432",
    otherHeld: false, prior_positive_2y: false, dot_program_30d: false,
  });
  Object.assign(flow.answers.cdl, { state_code: "IL", licence_number: "D123", cdl_class: "A", expires_on: "2029-01-01" });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(ok());
});

describe("the first visit", () => {
  it("holds screens 3–6, then writes all of it at screen 7 — answers, licences, date of birth, in that order", async () => {
    const { flow } = walk();
    fill(flow);
    for (const expected of ["about", "address", "licence", "otherLicences"]) {
      expect(flow.screen.value).toBe(expected);
      await flow.next();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(flow.screen.value).toBe("screening");

    await flow.next();
    expect(paths()).toEqual(["/intake", "/intake/licences", "/intake"]);
    expect(bodies()[0]).toMatchObject({ prior_positive_2y: false, phone: "7082365732", postal_code: "60432", cdl_class: "A" });
    expect(bodies()[1]).toEqual({ licences: [{ state_code: "IL", licence_number: "D123", expires_on: "2029-01-01" }] });
    expect(bodies()[2]).toEqual({ date_of_birth: "1985-03-07" });
    expect(flow.screen.value).toBe("cdl_front");
  });

  it("stays on a screen that fails its check, and says why", async () => {
    const { flow } = walk();
    await flow.next();
    expect(flow.screen.value).toBe("about");
    expect(flow.errors.value).toHaveProperty("phone");
  });

  it("stays on screen 7 when the write fails, and writes it all again on the next press", async () => {
    const { flow } = walk();
    fill(flow);
    for (let i = 0; i < 4; i++) await flow.next();
    fetchMock.mockResolvedValueOnce(ok()).mockRejectedValueOnce(new Error("offline"));
    await flow.next();
    expect(flow.screen.value).toBe("screening");
    expect(flow.failure.value).toMatch(/did not save/);
    fetchMock.mockClear();
    await flow.next();
    expect(paths()).toEqual(["/intake", "/intake/licences", "/intake"]);
  });
});

describe("the photographs", () => {
  const begun = { status: status({ screening: true, contact: true, address: true, licences: true }), identityComplete: true };

  it("will not move on without the photograph, and moves on once it is on file", async () => {
    const without = walk(begun, []);
    expect(without.flow.screen.value).toBe("cdl_front");
    await without.flow.next();
    expect(without.flow.errors.value).toEqual({ photo: "Take the photo to continue." });
    expect(without.flow.screen.value).toBe("cdl_front");

    const withIt = walk(begun, [cap("cdl_front")]);
    await withIt.flow.next();
    expect(withIt.flow.screen.value).toBe("cdl_back");
  });

  it("lets the medical card screen pass on \"I don't have one yet\", and records the answer", async () => {
    const { flow } = walk({ ...begun, captures: [cap("cdl_front"), cap("cdl_back")] }, [cap("cdl_front"), cap("cdl_back")]);
    expect(flow.screen.value).toBe("medical_card");
    flow.answers.medical_card_pending = true;
    await flow.next();
    expect(paths()).toEqual(["/intake"]);
    expect(bodies()[0]).toEqual({ medical_card_pending: true });
    expect(flow.screen.value).toBe("rights");
  });
});

describe("the rights summary", () => {
  const atRights = {
    status: status({ screening: true, contact: true, address: true, licences: true, medicalCardPending: true }),
    identityComplete: true,
    captures: [cap("cdl_front"), cap("cdl_back")],
  };

  it("records the version it showed, then ends Part 1 — in that order, because 0376 refuses the reverse", async () => {
    const { flow, done } = walk(atRights);
    expect(flow.screen.value).toBe("rights");
    await flow.next();
    expect(paths()).toEqual(["/intake", "/intake/complete"]);
    expect(bodies()[0]).toEqual({ fcra_summary_version: "cfpb-appendix-k-2023-09-25" });
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("asks for a reload when the server holds a newer summary, and does not end Part 1", async () => {
    fetchMock.mockResolvedValueOnce(refused("fcra_summary_changed"));
    const { flow, done } = walk(atRights);
    await flow.next();
    expect(flow.failure.value).toMatch(/Reload the page/);
    expect(paths()).toEqual(["/intake"]);
    expect(done).not.toHaveBeenCalled();
  });

  it("shows the server's own words when Part 1 is refused as incomplete", async () => {
    fetchMock.mockResolvedValueOnce(ok()).mockResolvedValueOnce(refused("intake_incomplete", "Photograph both sides of your licence."));
    const { flow, done } = walk(atRights);
    await flow.next();
    expect(flow.failure.value).toBe("Photograph both sides of your licence.");
    expect(done).not.toHaveBeenCalled();
  });
});

describe("a returning applicant", () => {
  const returning = { status: status({ screening: true, contact: true, address: true, licences: true }), identityComplete: true };

  /**
   * The list is replaced whole, and it is on the server, not in this page. Posting what the page holds
   * — nothing — would delete it, so the two licence screens are read-only in a session that did not type them.
   */
  it("never re-posts a licence list it cannot see", async () => {
    const { flow } = walk(returning, [cap("cdl_front")]);
    flow.back();
    flow.back();
    expect(flow.screen.value).toBe("otherLicences");
    expect(flow.locked.value).toBe(true);
    await flow.next();
    flow.back();
    flow.back();
    expect(flow.screen.value).toBe("licence");
    await flow.next();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the screening questions it already answered without asking them again", async () => {
    const { flow } = walk(returning, []);
    flow.back();
    expect(flow.screen.value).toBe("screening");
    await flow.next();
    expect(flow.screen.value).toBe("cdl_front");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps answers on file when their screen is left blank, and posts them when retyped", async () => {
    const { flow } = walk({ ...returning }, []);
    while (flow.screen.value !== "address") flow.back();
    expect(flow.onFile.value).toBe(true);
    await flow.next();
    expect(fetchMock).not.toHaveBeenCalled();
    flow.back();
    Object.assign(flow.answers, { address_line1: "2 Oak Ave", city: "Joliet", state: "IL", postal_code: "60433" });
    await flow.next();
    expect(paths()).toEqual(["/intake"]);
    expect(bodies()[0]).toMatchObject({ address_line1: "2 Oak Ave", postal_code: "60433" });
  });
});
