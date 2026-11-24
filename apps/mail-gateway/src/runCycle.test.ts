import { describe, expect, it } from "vitest";
import { runCycle } from "./runCycle.js";
import { at, captureLog, fakeDoor, fakeGraph, msg } from "./fakes.test-support.js";

const ANN = { mailbox: "ann@carrier.com", owner_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const BOB = { mailbox: "bob@carrier.com", owner_user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
const NOW = at("2026-11-24T16:00:00Z");
const base = { log: captureLog().log, now: () => NOW, commit: "abc1234", canaryMailbox: "mail-canary@carrier.com" };

describe("runCycle", () => {
  it("records external Inbox mail, never internal mail, and saves each cursor after its page", async () => {
    const d = fakeDoor({ mailboxes: [ANN] });
    const { graph } = fakeGraph({ "ann@carrier.com": { pages: { inbox: [[
      msg({ id: "m1", subject: "Load L-55501 ETA?" }),
      msg({ id: "m2", from: { emailAddress: { address: "teo@carrier.com" } }, subject: "fyi" }),
    ]] } } });
    expect(await runCycle({ ...base, door: d.door, graph })).toBe("done");
    expect(d.envelopes.map((e) => e.internet_message_id)).toEqual(["<m1@x>"]);
    expect(d.envelopes[0]).toMatchObject({ mailbox: "ann@carrier.com", tokens: ["L55501"], was_candidate: true, addressed_directly: true, body_was_read: false });
    const order = d.calls.map((c) => c.fn);
    expect(order.indexOf("recordMessages")).toBeLessThan(order.indexOf("saveCursor"));
    expect(d.ended?.counts).toMatchObject({ mailboxes_read: 1, messages_in: 2, external: 1, candidates: 1 });
  });

  it("first read asks for the last 7 days only, and resumes page by page on later runs", async () => {
    const d = fakeDoor({ mailboxes: [ANN] });
    const { graph, requested } = fakeGraph({ "ann@carrier.com": { pages: { inbox: [[msg({ id: "a" })], [msg({ id: "b" })], [msg({ id: "c" })]] } } });
    await runCycle({ ...base, door: d.door, graph });
    expect(decodeURIComponent(requested.find((u) => u.includes("inbox/messages/delta"))!)).toContain("receivedDateTime ge 2026-11-17T16:00:00.000Z");
    expect(d.cursors.filter((c) => c.folder === "inbox").map((c) => c.link?.replace(/.*\?/, ""))).toEqual(["page=1", "page=2", "$deltatoken=inbox-done"]);
    const d2 = fakeDoor({ mailboxes: [ANN], cursors: [{ mailbox: "ann@carrier.com", folder_id: "inbox", folder_role: "inbox", delta_link: "https://graph.microsoft.com/v1.0/users/ann@carrier.com/mailFolders/inbox/messages/delta?page=2" }] });
    const g2 = fakeGraph({ "ann@carrier.com": { pages: { inbox: [[msg({ id: "a" })], [msg({ id: "b" })], [msg({ id: "c" })]] } } });
    await runCycle({ ...base, door: d2.door, graph: g2.graph });
    expect(d2.envelopes.map((e) => e.internet_message_id)).toEqual(["<c@x>"]);
  });

  it("stops starting pages at the deadline, and does not earn the 'checked' stamp", async () => {
    const d = fakeDoor({ mailboxes: [ANN] });
    let t = NOW.getTime();
    const { graph } = fakeGraph({ "ann@carrier.com": { pages: { inbox: [[msg({ id: "a" })], [msg({ id: "b" })]] } } });
    await runCycle({ ...base, now: () => new Date((t += 30_000)), budgetMs: 40_000, door: d.door, graph });
    expect(d.checked).toEqual([]);
    expect(d.ended?.counts).toMatchObject({ mailboxes_read: 0, mailboxes_skipped: 1 });
  });

  it("reads Inbox subfolders and Sent Items; a Sent reply and a colleague's reply-all are answers, not rows", async () => {
    const d = fakeDoor({ mailboxes: [ANN] });
    const { graph, requested } = fakeGraph({ "ann@carrier.com": {
      inboxId: "INBOX",
      folders: [{ id: "INBOX", parentFolderId: "ROOT" }, { id: "BROKERS", parentFolderId: "INBOX" }, { id: "DEEP", parentFolderId: "BROKERS" }, { id: "JUNK", parentFolderId: "ROOT" }],
      pages: {
        inbox: [[msg({ id: "m1" }), msg({ id: "c1", from: { emailAddress: { address: "teo@carrier.com" } }, toRecipients: [{ emailAddress: { address: "ops@broker.com" } }], receivedDateTime: "2026-11-24T15:30:00Z" })]],
        BROKERS: [[msg({ id: "m2", conversationId: "conv-2" })]],
        DEEP: [[]],
        sentitems: [[{ id: "s1", conversationId: "conv-2", sentDateTime: "2026-11-24T15:45:00Z", from: { emailAddress: { address: "ann@carrier.com" } }, toRecipients: [{ emailAddress: { address: "ops@broker.com" } }] }]],
      },
    } });
    await runCycle({ ...base, door: d.door, graph });
    expect(requested.some((u) => u.includes("/JUNK/"))).toBe(false);
    expect(requested.some((u) => u.includes("/DEEP/messages/delta"))).toBe(true);
    expect(d.envelopes.map((e) => e.internet_message_id).sort()).toEqual(["<m1@x>", "<m2@x>"]);
    expect(d.answers.map((a) => [a.by, a.conversation_id])).toContainEqual(["colleague", "conv-1"]);
    expect(d.answers.map((a) => [a.by, a.conversation_id])).toContainEqual(["owner", "conv-2"]);
    expect(d.checked).toEqual(["ann@carrier.com"]);
  });

  it("opens a body only when body reading is on AND the message is a candidate", async () => {
    const script = { "ann@carrier.com": { pages: { inbox: [[msg({ id: "m1", subject: "status?" }), msg({ id: "m2", subject: "PO 4411 update" })]] }, bodies: { m1: "about L-55501", m2: "ref PU7788" } } };
    const off = fakeDoor({ mailboxes: [ANN] });
    const g1 = fakeGraph(script);
    await runCycle({ ...base, door: off.door, graph: g1.graph });
    expect(g1.requested.some((u) => u.includes("$select=body"))).toBe(false);
    const on = fakeDoor({ mailboxes: [ANN], body_reading: true });
    const g2 = fakeGraph(script);
    await runCycle({ ...base, door: on.door, graph: g2.graph });
    expect(g2.requested.filter((u) => u.includes("$select=body")).length).toBe(1);
    const m2 = on.envelopes.find((e) => e.internet_message_id === "<m2@x>");
    expect(m2).toMatchObject({ body_was_read: true });
    expect(m2?.tokens).toEqual(expect.arrayContaining(["4411", "PO4411", "PU7788"]));
    expect(on.envelopes.find((e) => e.internet_message_id === "<m1@x>")).toMatchObject({ body_was_read: false });
  });

  it("a refused or full mailbox is a state; throttling skips it; another mailbox still runs", async () => {
    const d = fakeDoor({ mailboxes: [ANN, BOB, { mailbox: "cat@carrier.com", owner_user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, { mailbox: "dan@carrier.com", owner_user_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }] });
    const { graph } = fakeGraph({
      "ann@carrier.com": { fail: "refused" }, "bob@carrier.com": { fail: "over_quota" }, "cat@carrier.com": { fail: "throttled" },
      "dan@carrier.com": { pages: { inbox: [[msg({ id: "d1" })]] } },
    });
    await runCycle({ ...base, door: d.door, graph });
    expect(d.ended?.states).toEqual(expect.arrayContaining([{ mailbox: "ann@carrier.com", state: "not_connected" }, { mailbox: "bob@carrier.com", state: "over_quota" }]));
    expect(d.ended?.counts).toMatchObject({ mailboxes_read: 1, mailboxes_skipped: 3, graph_throttled: 1, errors: 0 });
    expect(d.envelopes.map((e) => e.mailbox)).toEqual(["dan@carrier.com"]);
  });

  it("a reset cursor is forgotten, not retried in a loop", async () => {
    const d = fakeDoor({ mailboxes: [ANN] });
    const { graph } = fakeGraph({ "ann@carrier.com": { resetFolder: "inbox" } });
    await runCycle({ ...base, door: d.door, graph });
    expect(d.cursors).toContainEqual({ mailbox: "ann@carrier.com", folder: "inbox", link: null });
    expect(d.checked).toEqual([]);
  });

  it("an OPENED canary stops the run before any mailbox is read; a refused one does not", async () => {
    const d = fakeDoor({ mailboxes: [ANN], canary_due: true });
    const g = fakeGraph({ "ann@carrier.com": { pages: { inbox: [[msg({ id: "m1" })]] } } }, { "mail-canary@carrier.com": 200 });
    const cap = captureLog();
    expect(await runCycle({ ...base, log: cap.log, door: d.door, graph: g.graph })).toBe("stopped_by_canary");
    expect(g.requested.filter((u) => u.includes("ann@carrier.com"))).toEqual([]);
    expect(cap.events).toContainEqual({ event: "canary", result: "opened" });
    expect(d.calls.at(-1)?.fn).toBe("end");
    const ok = fakeDoor({ mailboxes: [ANN], canary_due: true });
    const g2 = fakeGraph({ "ann@carrier.com": { pages: { inbox: [[msg({ id: "m1" })]] } } }, { "mail-canary@carrier.com": 403 });
    expect(await runCycle({ ...base, door: ok.door, graph: g2.graph })).toBe("done");
    expect(ok.calls.find((c) => c.fn === "recordProbe")?.args).toEqual(["canary", "canary", "refused"]);
  });

  it("unlinked mailboxes get the probe call only — no message is read", async () => {
    const d = fakeDoor({ mailboxes: [], probe_unlinked: ["old@carrier.com"] });
    const g = fakeGraph({}, { "old@carrier.com": 200 });
    await runCycle({ ...base, door: d.door, graph: g.graph });
    expect(g.requested).toEqual(["https://graph.microsoft.com/v1.0/users/old%40carrier.com/mailFolders/inbox?$select=id"]);
    expect(d.calls.find((c) => c.fn === "recordProbe")?.args).toEqual(["unlinked", "old@carrier.com", "opened"]);
  });

  it("a database without the door yet ends the run quietly (function-not-ready)", async () => {
    const d = fakeDoor({ mailboxes: [] }, { notReady: true });
    const cap = captureLog();
    expect(await runCycle({ ...base, log: cap.log, door: d.door, graph: fakeGraph({}).graph })).toBe("skipped");
    expect(cap.events).toEqual([{ event: "cycle_skipped", reason: "not_ready" }]);
  });

  it("no cycle id (switched off or lease held) touches nothing", async () => {
    for (const enabled of [true, false]) {
      const d = fakeDoor({ mailboxes: [ANN], cycle_id: null, enabled });
      const g = fakeGraph({});
      const cap = captureLog();
      expect(await runCycle({ ...base, log: cap.log, door: d.door, graph: g.graph })).toBe("skipped");
      expect(g.requested).toEqual([]);
      expect(cap.events[0]).toEqual({ event: "cycle_skipped", reason: enabled ? "lease_held" : "disabled" });
    }
  });

  it("a mailbox removed from the list mid-cycle cannot be read: a paging link to it is refused", async () => {
    const d = fakeDoor({ mailboxes: [ANN] });
    const { graph } = fakeGraph({ "ann@carrier.com": { pages: { inbox: [[msg({ id: "a" })], [msg({ id: "b" })]] } } });
    const evil = { ...graph, page: async (url: string) => {
      const p = await graph.page(url);
      return p.nextLink ? { ...p, nextLink: p.nextLink.replace("ann@carrier.com", "ceo@carrier.com") } : p;
    } };
    const cap = captureLog();
    await runCycle({ ...base, log: cap.log, door: d.door, graph: evil });
    expect(cap.events).toContainEqual({ event: "mailbox_error", class: "RefusedCall" });
    expect(d.envelopes.map((e) => e.internet_message_id)).toEqual(["<a@x>"]);
  });
});
