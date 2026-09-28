import { beforeEach, describe, expect, it, vi } from "vitest";
import { applicationDraftSaveSchema } from "@silvicom/shared";
import { saveApplicationDraft } from "./useApplication";

/**
 * The autosave request's body (C3d1b), against the contract the route parses it with. A page served no
 * revision (an API from before C3d1b) must send NO key: the contract takes a whole number or nothing, so
 * `revision: null` would be a 400 on every save that page makes.
 */
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const sent = () => JSON.parse(String(fetchMock.mock.calls[0]![1].body)) as Record<string, unknown>;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, updatedAt: "x", revision: 1 }) });
});

describe("the autosave request", () => {
  it("sends no revision key when the page holds none, and the contract accepts it", async () => {
    await saveApplicationDraft("t", { first_name: "S" }, null, null);
    expect(sent()).not.toHaveProperty("revision");
    expect(applicationDraftSaveSchema.safeParse(sent()).success).toBe(true);
  });

  it("sends the revision it holds, 0 included, and the contract accepts it", async () => {
    await saveApplicationDraft("t", { first_name: "S" }, "identity", 0);
    expect(sent()).toEqual({ payload: { first_name: "S" }, section: "identity", revision: 0 });
    expect(applicationDraftSaveSchema.safeParse(sent()).success).toBe(true);
  });

  it("is a body the contract would refuse with a null revision — why the key is left out", () => {
    expect(applicationDraftSaveSchema.safeParse({ payload: {}, section: null, revision: null }).success).toBe(false);
  });
});
