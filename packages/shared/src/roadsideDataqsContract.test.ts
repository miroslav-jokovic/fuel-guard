import { describe, expect, it } from "vitest";
import type { RoadsideCitationDispositionDto } from "./roadsideCitationContract.js";
import {
  DATAQS_ATTESTATION,
  dataqsFields,
  dataqsNarrative,
  roadsideDataqsApproveSchema,
  roadsideDataqsFiledSchema,
  type DataqsFilingFacts,
} from "./roadsideDataqsContract.js";

const FACTS: DataqsFilingFacts = { carrierName: "Silvicom Freight", usdotNumber: "1234567", reportState: "IL", reportNumber: "IL1234000123", inspectionDate: "2026-06-01" };
const TICKET = { citationNumber: "E061", code: "392.2-SLLS1", description: "Speeding 1-5 miles per hour over the speed limit" };
const disposition = (o: Partial<RoadsideCitationDispositionDto> = {}): RoadsideCitationDispositionDto => ({
  id: "d-1", outcomeCode: 3, amendedCharge: null, courtName: "Will County Circuit Court", decidedOn: "2026-09-01", documentId: "doc-1",
  note: null, recordedBy: "Jane", recordedAt: "2026-10-02T15:00:00Z", ...o,
});

describe("the DataQs request's draft (R-ADJ2)", () => {
  it("says the report, the ticket, the court and what it decided, in MM/DD/YYYY", () => {
    expect(dataqsNarrative(FACTS, TICKET, disposition())).toBe(
      "Silvicom Freight (USDOT 1234567) asks for a correction to inspection report IL1234000123, conducted in IL on 06/01/2026. " +
        "The driver was issued citation E061 for the violation 392.2-SLLS1, Speeding 1-5 miles per hour over the speed limit. " +
        "On 09/01/2026 the Will County Circuit Court found the driver not guilty or dismissed the citation. " +
        "The court's disposition is attached. " +
        "We ask that the inspection record the citation as not guilty or dismissed, so the associated violation is removed as FMCSA's policy on adjudicated citations provides.",
    );
  });

  it("names the different charge and asks for severity 1, not removal", () => {
    const text = dataqsNarrative(FACTS, TICKET, disposition({ outcomeCode: 2, amendedCharge: "Improper lane use" }));
    expect(text).toContain("convicted the driver of a different charge, Improper lane use, not the charge cited.");
    expect(text).toContain("severity weight of 1");
    expect(text).not.toContain("removed");
  });

  it("says nothing it does not hold rather than inventing it", () => {
    const text = dataqsNarrative({ carrierName: "Silvicom Freight", usdotNumber: null, reportState: null, reportNumber: null, inspectionDate: null }, TICKET, disposition());
    expect(text.startsWith("Silvicom Freight asks for a correction to this inspection.")).toBe(true);
    expect(text).not.toMatch(/null|undefined/);
  });

  it("lists the job aid's fields, and says which we do not hold", () => {
    const f = dataqsFields({ ...FACTS, reportNumber: null }, TICKET, disposition({ outcomeCode: 2, amendedCharge: "Improper lane use" }));
    expect(f.map((x) => x.label)).toEqual([
      "Request type", "Report state", "Report number", "Inspection date", "Citation (ticket) number", "Citation state", "Carrier", "Court", "Court outcome", "Federal violation",
    ]);
    expect(f.find((x) => x.label === "Request type")!.value).toBe("Inspection—Citation with Associated Violation");
    expect(f.find((x) => x.label === "Report number")!.value).toMatch(/^Not on our record/);
    expect(f.find((x) => x.label === "Court outcome")!.value).toBe("Convicted of a different charge (Improper lane use), decided 09/01/2026");
  });
});

describe("approving and filing", () => {
  const v = "11111111-1111-4111-8111-111111111111";
  it("approves only with the certification accepted and an explanation", () => {
    const base = { violationId: v, dispositionId: v, attributionId: v, narrative: "x" };
    expect(roadsideDataqsApproveSchema.safeParse({ ...base, attested: true }).success).toBe(true);
    expect(roadsideDataqsApproveSchema.safeParse({ ...base, attested: false }).success).toBe(false);
    expect(roadsideDataqsApproveSchema.safeParse(base).success).toBe(false);
    expect(roadsideDataqsApproveSchema.safeParse({ ...base, narrative: "  ", attested: true }).success).toBe(false);
  });

  it("files only with an RDR number and a real day", () => {
    const base = { violationId: v, caseId: v, filedOn: "2026-10-04" };
    expect(roadsideDataqsFiledSchema.safeParse({ ...base, rdrNumber: " 1234567 " }).data?.rdrNumber).toBe("1234567");
    expect(roadsideDataqsFiledSchema.safeParse({ ...base, rdrNumber: "" }).success).toBe(false);
    expect(roadsideDataqsFiledSchema.safeParse({ ...base, rdrNumber: "1", filedOn: "2026-13-01" }).success).toBe(false);
  });

  it("shows DataQs's 18 USC 1001 certification word for word", () => {
    expect(DATAQS_ATTESTATION).toContain("not more than $10,000.00 or imprisonment of not more than 5 years, or both (18 USC 1001)");
    expect(DATAQS_ATTESTATION.endsWith("true, accurate, and complete.")).toBe(true);
  });
});
