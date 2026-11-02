import { describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
import { applicantOwes } from "./applicantOwes.js";

/**
 * §13 SP1: the facts behind the link's "for you to do" — on THIS invitation only, cancelled rows left out,
 * and a failed read served as nothing owed rather than a failed page (D-SP4).
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const INV = { id: "inv-1", org_id: ORG, driver_id: "d-1" };
const NOW = new Date("2026-11-03T15:00:00Z");
const V1 = "90000000-0000-4000-8000-000000000001";

const seed = (over: { tests?: unknown[]; trips?: unknown[]; sent?: string | null; attested?: string[]; failTests?: boolean } = {}) =>
  createSupabaseRecorder({
    tables: {
      drug_test_appointments: over.failTests ? { error: { message: "boom" } } : postgrestFixture((over.tests ?? []) as Record<string, unknown>[]),
      applicant_travel: postgrestFixture((over.trips ?? []) as Record<string, unknown>[]),
      orientation_videos: postgrestFixture([{ id: V1, org_id: ORG, title: "Pre-trip", url: "https://v/1", minutes: 5, required: true, position: 0, created_at: "2026-10-01T00:00:00Z", retired_at: null }]),
      orientation_video_attestations: postgrestFixture([{ id: "a-1", org_id: ORG, driver_id: "d-1", video_ids: over.attested ?? [] }]),
      application_invitations: postgrestFixture([{ id: "inv-1", org_id: ORG, orientation_videos_sent_at: over.sent ?? null }]),
    },
  });

describe("applicantOwes", () => {
  it("reads the live drug test, the unwatched videos and the upcoming trip of this invitation, org-scoped", async () => {
    const rec = seed({
      tests: [
        { org_id: ORG, invitation_id: "inv-1", window_start: "2026-11-04T14:00:00Z", window_end: null, cancelled_at: null },
        { org_id: ORG, invitation_id: "inv-other", window_start: "2026-11-04T14:00:00Z", window_end: null, cancelled_at: null },
      ],
      trips: [{ org_id: ORG, invitation_id: "inv-1", depart_at: "2026-11-05T14:00:00Z", cancelled_at: null }],
      sent: "2026-11-02T10:00:00Z",
    });
    expect(await applicantOwes(rec.client, INV, NOW)).toEqual(["drug_test", "videos", "trip"]);
    expectOrgScoped(rec, ORG);
  });

  it("leaves out a cancelled appointment and a cancelled trip, another invitation's, and watched videos", async () => {
    const rec = seed({
      tests: [{ org_id: ORG, invitation_id: "inv-1", window_start: "2026-11-04T14:00:00Z", window_end: null, cancelled_at: "2026-11-02T00:00:00Z" }],
      trips: [
        { org_id: ORG, invitation_id: "inv-1", depart_at: "2026-11-05T14:00:00Z", cancelled_at: "2026-11-02T00:00:00Z" },
        { org_id: ORG, invitation_id: "inv-other", depart_at: "2026-11-05T14:00:00Z", cancelled_at: null },
      ],
      sent: "2026-11-02T10:00:00Z",
      attested: [V1],
    });
    expect(await applicantOwes(rec.client, INV, NOW)).toEqual([]);
  });

  it("reads a drug test by the END of its window, so one under way still shows", async () => {
    const rec = seed({ tests: [{ org_id: ORG, invitation_id: "inv-1", window_start: "2026-11-03T13:00:00Z", window_end: "2026-11-03T22:00:00Z", cancelled_at: null }] });
    expect(await applicantOwes(rec.client, INV, NOW)).toEqual(["drug_test"]);
  });

  it("serves nothing owed when a read fails, and says so in the log", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await applicantOwes(seed({ failTests: true }).client, INV, NOW)).toEqual([]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
