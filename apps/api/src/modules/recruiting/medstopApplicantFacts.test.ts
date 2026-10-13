import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { partOneFactsForMedstop } from "./medstopApplicantFacts.js";

/**
 * Who Med-Stop is told about (UX5c, D-MS1): a finished Part 1, for somebody we may still hire. The
 * recorder applies no filters, so the rules that matter are proved on the rows the code keeps.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const driver = (id: string, over: object = {}) => ({
  id, first_name: "Ann", middle_name: null, last_name: "Driver", date_of_birth: "1985-03-07", cdl_class: "A",
  status: "applicant", archived_at: null, ...over,
});
const intake = (invitation_id: string, over: object = {}) => ({
  invitation_id, donor_gender: "female", phone: "+13125550142", address_line1: "12 Depot Rd", address_line2: null,
  city: "Joliet", state: "IL", postal_code: "60432", ...over,
});

function db() {
  return createSupabaseRecorder({
    tables: {
      application_invitations: ["ok", "hired", "archived", "ended", "noIntake"].map((k) => ({ id: `inv-${k}`, driver_id: `d-${k}` })),
      application_intakes: ["ok", "hired", "archived", "ended"].map((k) => intake(`inv-${k}`)),
      application_intake_licences: [{ invitation_id: "inv-ok", state_code: "IL", licence_number: "D1", expires_on: "2029-01-31" }],
      drivers: [
        driver("d-ok"), driver("d-hired", { status: "active" }), driver("d-archived", { archived_at: "2026-10-01T00:00:00Z" }),
        driver("d-ended"), driver("d-noIntake"),
      ],
      applicant_dispositions: [{ driver_id: "d-ended" }],
    },
  });
}

describe("partOneFactsForMedstop", () => {
  it("offers only a live applicant with a finished Part 1 — not a hire, an archived person, or an ended application", async () => {
    const facts = await partOneFactsForMedstop(db().client as unknown as SupabaseClient, ORG);
    expect(facts.map((f) => f.driverId)).toEqual(["d-ok"]);
    expect(facts[0]).toMatchObject({
      invitationId: "inv-ok", gender: "female", licenceNumber: "D1", licenceState: "IL", licenceExpiresOn: "2029-01-31",
      cdlClass: "A", phone: "+13125550142", birthDate: "1985-03-07",
    });
  });

  it("asks only for finished, unrevoked invitations, and the current licence (position 0)", async () => {
    const rec = db();
    await partOneFactsForMedstop(rec.client as unknown as SupabaseClient, ORG);
    const inv = rec.forTable("application_invitations")[0]!;
    expect(inv.ops.map((o) => `${o.method}:${String(o.args[0])}`)).toEqual(
      expect.arrayContaining(["not:intake_completed_at", "is:revoked_at"]),
    );
    expect(rec.forTable("application_intake_licences")[0]!.filters()).toContainEqual({ col: "position", val: 0 });
    expectOrgScoped(rec, ORG);
  });

  it("reads an unknown gender value as never asked", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        application_invitations: [{ id: "inv-ok", driver_id: "d-ok" }],
        application_intakes: [intake("inv-ok", { donor_gender: null })],
        application_intake_licences: [],
        drivers: [driver("d-ok")],
        applicant_dispositions: [],
      },
    });
    expect((await partOneFactsForMedstop(rec.client as unknown as SupabaseClient, ORG))[0]?.gender).toBeNull();
  });
});
