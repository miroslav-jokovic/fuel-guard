import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture, type FixtureRow } from "../../../testing/postgrestFixture.js";
import { signatureMarkBytes } from "./sources.js";

/**
 * Which picture a document draws once there are two places a mark can live (D-AW15, C3s1): the staged
 * capture the packet makes, and the adoption screen 13 makes. The newest made at or before the
 * document's instant — so the permissions print the adoption they were signed with, and a packet the
 * driver drew afresh prints its own drawing. Storage answers with the PATH, so each assertion says which
 * object was read.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const INVITE = "10000000-0000-4000-8000-000000000001";

const capture = (org: string, at: string, over: FixtureRow = {}): FixtureRow => ({
  id: `cap-${org}`, org_id: org, invitation_id: INVITE, slot: "signature_mark",
  storage_path: `${org}/${INVITE}/capture.png`, captured_at: at, ...over,
});
const adoption = (org: string, id: string, at: string, over: FixtureRow = {}): FixtureRow => ({
  id, org_id: org, invitation_id: INVITE, kind: "signature",
  storage_path: `${org}/driver/d/${id}.png`, adopted_at: at, superseded_by: null, ...over,
});

const read = async (
  rows: { captures?: FixtureRow[]; adoptions?: FixtureRow[]; missing?: string[] },
  before: string | null = null,
  kind: "signature" | "initials" = "signature",
) => {
  const rec = createSupabaseRecorder({
    tables: {
      application_captures: postgrestFixture(rows.captures ?? []),
      documents: postgrestFixture([]),
      signature_adoptions: postgrestFixture(rows.adoptions ?? []),
    },
    storage: {
      download: (path: string) =>
        rows.missing?.includes(path)
          ? { data: null, error: { message: "not found" } }
          : { data: new Blob([path]), error: null },
    },
  });
  const bytes = await signatureMarkBytes(rec.client, ORG, INVITE, kind, before);
  expectOrgScoped(rec, ORG);
  return { drawn: bytes?.toString() ?? null, rec };
};

describe("signatureMarkBytes — the newest picture before the document's instant", () => {
  it("draws the adoption when there is no capture (a v2 link's permissions)", async () => {
    const { drawn, rec } = await read({ adoptions: [adoption(ORG, "a1", "2026-09-28T10:00:00Z")] });
    expect(drawn).toBe(`${ORG}/driver/d/a1.png`);
    expect(rec.storageCalls()[0]!.bucket).toBe("compliance-docs");
  });

  it("draws a capture made AFTER the adoption — a packet drawn afresh prints its own drawing", async () => {
    const { drawn } = await read({
      adoptions: [adoption(ORG, "a1", "2026-09-28T10:00:00Z")],
      captures: [capture(ORG, "2026-09-30T15:00:00Z")],
    });
    expect(drawn).toBe(`${ORG}/${INVITE}/capture.png`);
  });

  it("but not on a document whose instant came before that drawing — the permissions keep the adoption", async () => {
    const { drawn } = await read(
      {
        adoptions: [adoption(ORG, "a1", "2026-09-28T10:00:00Z")],
        captures: [capture(ORG, "2026-09-30T15:00:00Z")],
      },
      "2026-09-29T09:00:00Z",
    );
    expect(drawn).toBe(`${ORG}/driver/d/a1.png`);
  });

  it("draws a legacy link's capture exactly as before, when it has no adoption", async () => {
    const { drawn } = await read({ captures: [capture(ORG, "2026-09-20T15:00:00Z")] });
    expect(drawn).toBe(`${ORG}/${INVITE}/capture.png`);
  });

  it("the adoption live at the instant, not a later one", async () => {
    const { drawn } = await read(
      {
        adoptions: [
          adoption(ORG, "a1", "2026-09-28T10:00:00Z", { superseded_by: "a2" }),
          adoption(ORG, "a2", "2026-10-02T10:00:00Z"),
        ],
      },
      "2026-09-29T09:00:00Z",
    );
    expect(drawn).toBe(`${ORG}/driver/d/a1.png`);
  });

  it("falls back to the older picture when the newer one's bytes are gone", async () => {
    const { drawn } = await read({
      adoptions: [adoption(ORG, "a1", "2026-09-28T10:00:00Z")],
      captures: [capture(ORG, "2026-09-30T15:00:00Z")],
      missing: [`${ORG}/${INVITE}/capture.png`],
    });
    expect(drawn).toBe(`${ORG}/driver/d/a1.png`);
  });

  it("never draws another org's adoption on the same invitation id", async () => {
    const { drawn } = await read({ adoptions: [adoption(OTHER, "theirs", "2026-09-28T10:00:00Z")] });
    expect(drawn).toBeNull();
  });

  it("reads the initials' own adoption for the initials", async () => {
    const { drawn } = await read(
      {
        adoptions: [
          adoption(ORG, "sig", "2026-09-28T10:00:00Z"),
          adoption(ORG, "ini", "2026-09-28T10:00:01Z", { kind: "initials" }),
        ],
      },
      null,
      "initials",
    );
    expect(drawn).toBe(`${ORG}/driver/d/ini.png`);
  });
});
