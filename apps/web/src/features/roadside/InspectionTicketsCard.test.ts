import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import type {
  RoadsideAttributionDto,
  RoadsideCitationDispositionDto,
  RoadsideCitationDto,
  RoadsideDataqsCaseDto,
  RoadsideInspectionCitationsDto,
} from "@silvicom/shared";

/**
 * The Tickets card (IC4). What it can get wrong: offer acts to a reader who cannot act, act over the wrong row,
 * default the follow-up to the browser's day, keep asking about a ticket the court has decided — or (second
 * merge) close a second ticket on the paper the first was read from, approve a DataQs request on Samsara's
 * reading or without the certification, or file one that was never approved.
 */

const data = ref<RoadsideInspectionCitationsDto | undefined>(undefined);
const sent: { path: string; input: unknown }[] = [];
const writer = (path: string) => () => ({ mutate: (input: unknown) => sent.push({ path, input }), reset: vi.fn(), isPending: ref(false), error: ref(null) });
vi.mock("./useRoadsideInspections", () => ({
  useInspectionCitationsQuery: () => ({ data, isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn() }),
  useActOnCitation: writer(""),
  useRecordDisposition: writer("/dispositions"),
  useApproveDataqs: writer("/dataqs"),
  useRecordDataqsFiled: writer("/dataqs/filed"),
  useInspectionDocumentsQuery: () => ({ data: ref([]) }),
  RepairDecisionError: class extends Error {},
}));
let canAct = true;
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => canAct }) }));
// The org is in Los Angeles; the test runs at 2026-10-20 04:00 UTC, which is still 10-19 there.
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Los_Angeles") }) }));

const Card = (await import("./InspectionTicketsCard.vue")).default;

const PAPER = { id: "doc-1", filedAt: "2026-10-02T12:00:00Z" };
const FILING = { carrierName: "Silvicom Freight", usdotNumber: "1234567", reportState: "IL", reportNumber: "IL1234000123", inspectionDate: "2026-06-01" };
const ticket = (o: Partial<RoadsideCitationDto> = {}): RoadsideCitationDto => ({
  violationId: "v-1", code: "392.2-SLLS1", description: "Speeding", citationNumber: "E061", courtResults: [], action: null, disposition: null, dataqsCase: null, ...o,
});
const disposition = (o: Partial<RoadsideCitationDispositionDto> = {}): RoadsideCitationDispositionDto => ({
  id: "d-1", outcomeCode: 3, amendedCharge: null, courtName: "Will County Circuit Court", decidedOn: "2026-09-01", documentId: "doc-1",
  note: null, recordedBy: "Jane", recordedAt: "2026-10-02T15:00:00Z", ...o,
});
const approved = (o: Partial<RoadsideDataqsCaseDto> = {}): RoadsideDataqsCaseDto => ({
  id: "q-1", state: "approved", dispositionId: "d-1", narrative: "As attested.", attestedBy: "Jane", attestedAt: "2026-10-03T15:00:00Z", rdrNumber: null, filedOn: null, ...o,
});
const DECIDED: RoadsideAttributionDto = {
  reading: null,
  decision: { id: "attr-1", kind: "corrected", driver: { id: "dr-1", name: "Sam Driver" }, decidedBy: "Jane", decidedAt: "2026-10-01T00:00:00Z", note: null, engineVersion: "e1" },
  // A newer Samsara reading than the decision: the request rests on the DECISION, not the newest row.
  basedOn: "eng-9",
  reports: [],
};
const UNDECIDED: RoadsideAttributionDto = { reading: null, decision: null, basedOn: null, reports: [] };
const stubs = {
  AppDateField: { props: ["modelValue"], emits: ["update:modelValue"], template: "<input :value='modelValue' @input=\"$emit('update:modelValue', $event.target.value)\" />" },
  DocumentPreview: true,
};
const card = async (attribution: RoadsideAttributionDto = DECIDED) => {
  const w = mount(Card, { props: { inspectionId: "insp-1", inspectionDate: "2026-06-01", attribution }, global: { stubs } });
  await flushPromises();
  return w;
};
const set = (tickets: RoadsideCitationDto[], courtPapers: { id: string; filedAt: string }[] = []) => (data.value = { tickets, courtPapers, filing: FILING });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T04:00:00Z"));
  sent.length = 0;
  canAct = true;
  set([ticket()]);
});

describe("the Tickets card", () => {
  it("asks for the court result and records a request, following up 30 days on the carrier's day", async () => {
    const w = await card();
    expect(w.get("[data-test='ticket-badge']").text()).toBe("Get the court result");
    await w.get("[data-test='ticket-requested']").trigger("click");
    expect((w.get("[data-test='ticket-follow-up']").element as HTMLInputElement).value).toBe("2026-11-18");
    await w.get("[data-test='ticket-form']").trigger("submit");
    expect(sent).toEqual([{ path: "", input: { action: "requested_from_court", violationId: "v-1", basedOn: null, followUpOn: "2026-11-18", note: undefined } }]);
  });

  it("records 'not contested' over the act the page showed, after saying what paying means", async () => {
    set([ticket({ action: { id: "c-7", kind: "requested_from_court", followUpOn: "2026-10-01", note: null, actedBy: "Jane", actedAt: "2026-09-01T00:00:00Z" } })]);
    const w = await card();
    expect(w.get("[data-test='ticket-badge']").text()).toBe("Follow up with the court");
    await w.get("[data-test='ticket-not-contested']").trigger("click");
    expect(w.get("[data-test='ticket-form']").text()).toContain("keeps its full CSA weight");
    await w.get("[data-test='ticket-form']").trigger("submit");
    expect(sent).toEqual([{ path: "", input: { action: "not_contested", violationId: "v-1", basedOn: "c-7", note: undefined } }]);
  });

  it("offers nothing once FMCSA shows the court's result", async () => {
    set([ticket({ courtResults: ["Not Guilty/Dismissed"] })], [PAPER]);
    const w = await card();
    expect(w.get("[data-test='ticket-badge']").text()).toBe("Not Guilty/Dismissed");
    expect(w.find("[data-test='ticket-actions']").exists()).toBe(false);
  });

  it("offers no act to a reader who only views safety, and sends 'upload' to the Documents card", async () => {
    let w = await card();
    await w.get("[data-test='ticket-result']").trigger("click");
    expect(w.emitted("fileResult")).toHaveLength(1);
    canAct = false;
    set([ticket({ disposition: disposition() })], [PAPER]);
    w = await card();
    expect(w.find("[data-test='ticket-actions']").exists()).toBe(false);
    expect(w.find("[data-test='dataqs-request']").exists()).toBe(false);
  });

  it("is not drawn for an inspection with no ticket", async () => {
    set([]);
    expect((await card()).find("[data-test='tickets-card']").exists()).toBe(false);
  });
});

describe("what the court decided, per ticket", () => {
  it("asks each ticket what a filed paper decided, and records it against that ticket from that paper", async () => {
    set([ticket(), ticket({ violationId: "v-2", citationNumber: "E062" })], [PAPER]);
    const w = await card();
    expect(w.findAll("[data-test='ticket-badge']").map((b) => b.text())).toEqual(["Record the court's result", "Record the court's result"]);
    await w.findAll("[data-test='ticket-dispose']")[1]!.trigger("click");
    const form = w.get("[data-test='disposition-form']");
    await form.findAll("input[type='radio']")[1]!.setValue(true); // 2: a different charge
    await w.get("[data-test='disposition-charge']").setValue("Improper lane use");
    await w.get("[data-test='disposition-court']").setValue(" Will County Circuit Court ");
    await form.get("[data-test='disposition-day']").setValue("2026-09-01");
    await form.trigger("submit");
    expect(sent).toEqual([{
      path: "/dispositions",
      input: { violationId: "v-2", basedOn: null, documentId: "doc-1", outcomeCode: 2, amendedCharge: "Improper lane use", courtName: "Will County Circuit Court", decidedOn: "2026-09-01", note: undefined },
    }]);
  });

  it("sends no new charge unless the court convicted of a different one", async () => {
    set([ticket()], [PAPER]);
    const w = await card();
    await w.get("[data-test='ticket-dispose']").trigger("click");
    const form = w.get("[data-test='disposition-form']");
    await form.findAll("input[type='radio']")[1]!.setValue(true);
    await w.get("[data-test='disposition-charge']").setValue("Improper lane use");
    await form.findAll("input[type='radio']")[0]!.setValue(true); // changed their mind: dismissed
    await w.get("[data-test='disposition-court']").setValue("Will County Circuit Court");
    await form.get("[data-test='disposition-day']").setValue("2026-09-01");
    await form.trigger("submit");
    expect(sent[0]).toMatchObject({ path: "/dispositions", input: { outcomeCode: 3, amendedCharge: undefined } });
  });

  it("does not close the second ticket on the paper the first was recorded from", async () => {
    set([ticket({ disposition: disposition({ outcomeCode: 1 }) }), ticket({ violationId: "v-2", citationNumber: "E062" })], [PAPER]);
    const w = await card();
    expect(w.findAll("[data-test='ticket-badge']").map((b) => b.text())).toEqual(["Convicted of the charge", "Record the court's result"]);
    expect(w.get("[data-test='ticket-disposition']").text()).toContain("Will County Circuit Court, 09/01/2026");
  });
});

describe("the DataQs request (R-ADJ2, D-IC7)", () => {
  it("drafts it, and approves it only once the certification is accepted, over the disposition and driver decision shown", async () => {
    set([ticket({ disposition: disposition() })], [PAPER]);
    const w = await card();
    expect(w.get("[data-test='ticket-badge']").text()).toBe("Ready for DataQs");
    expect(w.get("[data-test='dataqs-driver']").text()).toContain("Sam Driver");
    expect((w.get("[data-test='dataqs-narrative']").element as HTMLTextAreaElement).value).toContain("found the driver not guilty or dismissed the citation");
    expect(w.get("[data-test='dataqs-attestation']").text()).toContain("18 USC 1001");
    expect(w.get("[data-test='dataqs-approve']").attributes("disabled")).toBeDefined();
    await w.get("[data-test='dataqs-attest']").setValue(true);
    expect(w.get("[data-test='dataqs-approve']").attributes("disabled")).toBeUndefined();
    await w.get("[data-test='dataqs-approve']").trigger("click");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ path: "/dataqs", input: { violationId: "v-1", dispositionId: "d-1", attributionId: "attr-1", attested: true } });
  });

  it("will not approve on Samsara's reading: it sends the person to the driver card", async () => {
    set([ticket({ disposition: disposition() })], [PAPER]);
    const w = await card(UNDECIDED);
    await w.get("[data-test='dataqs-attest']").setValue(true);
    expect(w.get("[data-test='dataqs-approve']").attributes("disabled")).toBeDefined();
    await w.get("[data-test='dataqs-confirm-driver']").trigger("click");
    expect(w.emitted("confirmDriver")).toHaveLength(1);
  });

  it("hands an approved request over, and records the RDR number DataQs gave it", async () => {
    set([ticket({ disposition: disposition(), dataqsCase: approved() })], [PAPER]);
    const w = await card();
    expect(w.get("[data-test='ticket-badge']").text()).toBe("Approved · file in DataQs");
    expect(w.get("[data-test='dataqs-open']").attributes("href")).toBe("https://dataqs.fmcsa.dot.gov/");
    expect(w.get("[data-test='dataqs-request']").text()).toContain("Inspection—Citation with Associated Violation");
    await w.get("[data-test='dataqs-rdr']").setValue(" 1234567 ");
    await w.get("[data-test='dataqs-filed-form']").trigger("submit");
    expect(sent).toEqual([{ path: "/dataqs/filed", input: { violationId: "v-1", caseId: "q-1", rdrNumber: "1234567", filedOn: "2026-10-19" } }]);
  });

  it("says a filed request's RDR number and offers nothing more", async () => {
    set([ticket({ disposition: disposition(), dataqsCase: approved({ state: "filed", rdrNumber: "1234567", filedOn: "2026-10-04" }) })], [PAPER]);
    const w = await card();
    expect(w.get("[data-test='ticket-badge']").text()).toBe("Filed in DataQs · RDR 1234567");
    expect(w.find("[data-test='dataqs-request']").exists()).toBe(false);
    expect(w.find("[data-test='ticket-actions']").exists()).toBe(false);
  });
});
