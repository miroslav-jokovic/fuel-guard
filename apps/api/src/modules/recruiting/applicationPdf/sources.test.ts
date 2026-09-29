import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture, type FixtureRow } from "../../../testing/postgrestFixture.js";
import type { MarkedDocument } from "../documentAdoption.js";
import { signatureMarkBytes } from "./sources.js";

/**
 * Which picture a document draws (D-AW15, C3s2a): the adoption ITS OWN marks name, never merely the
 * newest one — a driver who makes a new signature at the packet supersedes the one the permissions were
 * signed with, and the permissions go on printing theirs. A document whose marks name no adoption (every
 * mark before C3s1, or A8b's failed picture) reads the staged capture as it always did. Storage answers
 * with the PATH, so each assertion says which object was read.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const INVITE = "10000000-0000-4000-8000-000000000001";

const adoption = (org: string, id: string, over: FixtureRow = {}): FixtureRow => ({
  id, org_id: org, invitation_id: INVITE, kind: "signature", storage_path: `${org}/driver/d/${id}.png`, ...over,
});
const mark = (org: string, adoptionId: string | null, over: FixtureRow = {}): FixtureRow => ({
  org_id: org, invitation_id: INVITE, adoption_id: adoptionId, mark: "signature", party: "driver", revokes: null,
  signed_at: "2026-09-28T10:00:00Z", accepted_at: "2026-09-28T10:00:00Z", ...over,
});

const read = async (
  rows: { adoptions?: FixtureRow[]; permissions?: FixtureRow[]; packet?: FixtureRow[]; handbook?: FixtureRow[]; capture?: boolean },
  document: MarkedDocument,
  kind: "signature" | "initials" = "signature",
) => {
  const rec = createSupabaseRecorder({
    tables: {
      signature_adoptions: postgrestFixture(rows.adoptions ?? []),
      driver_authorizations: postgrestFixture(rows.permissions ?? []),
      application_packet_marks: postgrestFixture(rows.packet ?? []),
      handbook_marks: postgrestFixture(rows.handbook ?? []),
      application_captures: postgrestFixture(
        rows.capture ? [{ id: "cap", org_id: ORG, invitation_id: INVITE, slot: `${kind}_mark`, storage_path: "staged.png" }] : [],
      ),
      documents: postgrestFixture([]),
    },
    storage: { download: (path: string) => ({ data: new Blob([path]), error: null }) },
  });
  const bytes = await signatureMarkBytes(rec.client, ORG, INVITE, kind, document);
  expectOrgScoped(rec, ORG);
  return bytes?.toString() ?? null;
};

describe("signatureMarkBytes — the adoption the document's own marks name", () => {
  const TWO = [adoption(ORG, "a1", { superseded_by: "a2" }), adoption(ORG, "a2")];

  it("the permissions print the adoption they were signed with, after a newer one was made at the packet", async () => {
    const rows = { adoptions: TWO, permissions: [mark(ORG, "a1")], packet: [mark(ORG, "a2")] };
    expect(await read(rows, "permissions")).toBe(`${ORG}/driver/d/a1.png`);
    expect(await read(rows, "packet")).toBe(`${ORG}/driver/d/a2.png`);
  });

  it("the handbook prints its own marks' adoption", async () => {
    expect(await read({ adoptions: TWO, handbook: [mark(ORG, "a2")] }, "handbook")).toBe(`${ORG}/driver/d/a2.png`);
  });

  it("the initials read the packet's initials marks, never the signature's", async () => {
    const rows = {
      adoptions: [adoption(ORG, "sig"), adoption(ORG, "ini", { kind: "initials" })],
      packet: [mark(ORG, "sig"), mark(ORG, "ini", { mark: "initials" })],
    };
    expect(await read(rows, "packet", "initials")).toBe(`${ORG}/driver/d/ini.png`);
  });

  it("a document whose marks name no adoption draws the staged capture, as before C3s1", async () => {
    expect(await read({ adoptions: TWO, permissions: [mark(ORG, null)], capture: true }, "permissions")).toBe("staged.png");
  });

  it("a document with no marks yet draws no adoption — the newest one is not borrowed", async () => {
    expect(await read({ adoptions: TWO }, "packet")).toBeNull();
  });

  it("another org's marks on the same invitation id name nothing here", async () => {
    const rows = { adoptions: [adoption(OTHER, "theirs")], packet: [mark(OTHER, "theirs")] };
    expect(await read(rows, "packet")).toBeNull();
  });
});
