import { describe, expect, it } from "vitest";
import { answerFrom, askKindsIn, classifyInbox, isInternal, tokensIn } from "./classify.js";

const ctx = { mailbox: "ann@carrier.com", mailDomains: ["carrier.com"], knownSenderDomains: new Set(["known.com"]) };
const m = (o: Record<string, unknown>) => ({
  id: "g1", internetMessageId: "<1@x>", conversationId: "c", receivedDateTime: "2026-11-24T15:00:00Z",
  from: { emailAddress: { address: "Ops@Broker.com" } }, toRecipients: [{ emailAddress: { address: "ANN@carrier.com" } }], ccRecipients: [], subject: "hi", ...o,
});

describe("classify", () => {
  it("internal means our own mail domains, case-insensitive", () => {
    expect(isInternal("teo@CARRIER.com", ["carrier.com"])).toBe(true);
    expect(isInternal("x@carrier.com.evil.net", ["carrier.com"])).toBe(false);
    expect(isInternal(null, ["carrier.com"])).toBe(false);
  });

  it("tokens are reference-shaped: four or more, with a digit; words are not", () => {
    expect(tokensIn("Re: Load L-55501 / PO# 4411 please, ETA tomorrow?")).toEqual(["L55501", "4411", "PO4411"]);
    expect(tokensIn("Please send the update")).toEqual([]);
    expect(tokensIn(null)).toEqual([]);
  });

  it("an external message is a candidate by a subject token or a sender domain that matched before", () => {
    expect(classifyInbox(m({ subject: "L-55501" }), ctx)?.candidate).toBe(true);
    expect(classifyInbox(m({ from: { emailAddress: { address: "a@known.com" } } }), ctx)?.candidate).toBe(true);
    expect(classifyInbox(m({}), ctx)?.candidate).toBe(false);
  });

  it("an internal message is never a candidate and never an envelope", () => {
    const v = classifyInbox(m({ from: { emailAddress: { address: "teo@carrier.com" } }, subject: "L-55501" }), ctx);
    expect(v).toMatchObject({ external: false, candidate: false });
  });

  it("addressed directly = the mailbox in To or Cc; through a list otherwise (Q-BMR4)", () => {
    expect(classifyInbox(m({}), ctx)?.envelope.addressed_directly).toBe(true);
    expect(classifyInbox(m({ toRecipients: [{ emailAddress: { address: "dispatch@carrier.com" } }] }), ctx)?.envelope.addressed_directly).toBe(false);
  });

  it("an item with no message id or no time is skipped", () => {
    expect(classifyInbox(m({ internetMessageId: undefined }), ctx)).toBeNull();
    expect(classifyInbox(m({ receivedDateTime: undefined }), ctx)).toBeNull();
  });

  it("answers: Sent is the owner's, an internal arrival is a colleague's unless the owner wrote it", () => {
    const sent = answerFrom(m({ sentDateTime: "2026-11-24T15:10:00Z", toRecipients: [{ emailAddress: { address: "ops@broker.com" } }] }), { mailbox: "ann@carrier.com", folder: "sent" });
    expect(sent).toMatchObject({ by: "owner", answered_at: "2026-11-24T15:10:00Z", recipients: ["ops@broker.com"] });
    const coll = answerFrom(m({ from: { emailAddress: { address: "teo@carrier.com" } } }), { mailbox: "ann@carrier.com", folder: "inbox" });
    expect(coll?.by).toBe("colleague");
    const self = answerFrom(m({ from: { emailAddress: { address: "ann@carrier.com" } } }), { mailbox: "ann@carrier.com", folder: "inbox" });
    expect(self?.by).toBe("owner");
    expect(answerFrom(m({ toRecipients: [], ccRecipients: [] }), { mailbox: "ann@carrier.com", folder: "sent" })).toBeNull();
  });
});

describe("askKindsIn — what a broker asks, by word rules (0656)", () => {
  it("names each kind, several at once, and `other` when no rule fits", () => {
    expect(askKindsIn("RE: 48213 ETA?")).toEqual(["eta"]);
    expect(askKindsIn("Update on CY-55120 please")).toEqual(["eta"]);
    expect(askKindsIn("MacroPoint tracking request — TQL# 7781204")).toEqual(["tracking_link"]);
    expect(askKindsIn("Where is the truck? Receiver says it's late")).toEqual(["delay_reason", "location"]);
    expect(askKindsIn("Need POD for 48190")).toEqual(["pod"]);
    expect(askKindsIn("Delivery appt moved", null)).toEqual(["appointment"]);
    expect(askKindsIn("Invoice 48213 attached")).toEqual(["other"]);
  });
  it("reads the body when it is there", () => {
    expect(askKindsIn("RE: 48213", "Can you send the signed BOL?")).toEqual(["pod"]);
  });
});
