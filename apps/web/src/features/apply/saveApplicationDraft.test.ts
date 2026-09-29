import { beforeEach, describe, expect, it, vi } from "vitest";
import { applicationDraftSaveSchema } from "@silvicom/shared";
import { saveApplicationDraft } from "./useApplication";

/**
 * The autosave request's body (C3d1b), against the contract the route parses it with. Since M2a the
 * revision is required on both sides: every save names the revision it was typed on.
 */
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const sent = () => JSON.parse(String(fetchMock.mock.calls[0]![1].body)) as Record<string, unknown>;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, updatedAt: "x", revision: 1 }) });
});

describe("the autosave request", () => {
  it("sends the revision it holds, 0 included, and the contract accepts it", async () => {
    await saveApplicationDraft("t", { first_name: "S" }, "identity", 0);
    expect(sent()).toEqual({ payload: { first_name: "S" }, section: "identity", revision: 0 });
    expect(applicationDraftSaveSchema.safeParse(sent()).success).toBe(true);
  });

  it("is refused by the contract with no revision, or a null one (M2a)", () => {
    expect(applicationDraftSaveSchema.safeParse({ payload: {}, section: null }).success).toBe(false);
    expect(applicationDraftSaveSchema.safeParse({ payload: {}, section: null, revision: null }).success).toBe(false);
  });
});
