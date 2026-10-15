import { describe, expect, it } from "vitest";
import { isRecordId, recordId } from "./recordId.js";
import { certificationListQuerySchema } from "./complianceContract.js";

/** Staging's org, seeded by supabase/seed.sql and prescribed by docs/11-DEPLOYMENT.md Stage 2. */
const STAGING_ORG = "00000000-0000-0000-0000-0000000000a1";
const V4 = "3f2b8c1e-9a4d-4e7b-8c2f-1d5e6a7b8c9d";

describe("recordId (D-US13)", () => {
  it("accepts an id Postgres stores that is not an RFC 9562 uuid (version nibble 0)", () => {
    expect(recordId().safeParse(STAGING_ORG).success).toBe(true);
    expect(isRecordId(STAGING_ORG)).toBe(true);
  });

  it("accepts a v4 id in either case, as Postgres does", () => {
    expect(isRecordId(V4)).toBe(true);
    expect(isRecordId(V4.toUpperCase())).toBe(true);
  });

  it("refuses what is not an id, so a malformed id is a 400 and never reaches the database", () => {
    for (const bad of ["", "x", "as-01", "card_lock", `${V4},${V4}`, `${V4})`, V4.slice(1), null, undefined, 42]) {
      expect(isRecordId(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(recordId().safeParse("card_lock").success).toBe(false);
  });

  it("carries a form's own sentence when the field is not an id", () => {
    const r = recordId("Select a vehicle").safeParse("");
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Select a vehicle");
  });

  it("lets Driver Qualification read the carrier's own records on staging (US6b F31)", () => {
    const q = certificationListQuerySchema.safeParse({ subjectType: "organization", subjectId: STAGING_ORG });
    expect(q.success).toBe(true);
  });
});
