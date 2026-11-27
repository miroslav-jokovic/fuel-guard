import { describe, expect, it } from "vitest";
import { runDrafts } from "./drafts.js";
import { graphWrite } from "./graphWrite.js";
import { at, captureLog, fakeDoor, fakeGraph, fakeWrite } from "./fakes.test-support.js";

/** P4's draft step (D-BMR11): never step on a human, never write outside Drafts, never log a word. */
const ANN = { mailbox: "ann@carrier.com", owner_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const D1 = "d1111111-1111-4111-8111-111111111111";
const D2 = "d2222222-2222-4222-8222-222222222222";
const NOW = at("2026-11-24T16:00:00Z");
const job = (o: Partial<{ draft_id: string; text: string; internet_message_id: string }> = {}) => ({
  draft_id: D1, mailbox: "ann@carrier.com", text: "Hi, truck 412 is 86 miles out.", internet_message_id: "<m1@broker.com>", conversation_id: "conv-1", ...o,
});

async function run(o: { drafts: NonNullable<NonNullable<Parameters<typeof fakeDoor>[1]>["drafts"]>; graph?: Parameters<typeof fakeGraph>[0]; write?: Parameters<typeof fakeWrite>[0]; deadline?: number }) {
  const d = fakeDoor({ mailboxes: [ANN] }, { drafts: o.drafts });
  const g = fakeGraph(o.graph ?? { "ann@carrier.com": { byInternetId: { "<m1@broker.com>": { id: "AAMk1", conversationId: "AAQk1" } } } });
  const w = fakeWrite(o.write);
  const cap = captureLog();
  const counts = await runDrafts({ door: d.door, graph: g.graph, write: w.write, log: cap.log, cycle: "c", allowed: new Set([ANN.mailbox]), now: () => NOW, deadline: o.deadline ?? NOW.getTime() + 1 });
  return { d, g, w, cap, counts };
}

describe("runDrafts", () => {
  it("finds the broker's email by its stored id, makes a reply draft with our text, and records Graph's id", async () => {
    const r = await run({ drafts: { create: [job()], remove: [] } });
    expect(r.w.writes).toEqual([{ kind: "create", url: "https://graph.microsoft.com/v1.0/users/ann%40carrier.com/messages/AAMk1/createReply", comment: "Hi, truck 412 is 86 miles out." }]);
    expect(r.d.completed).toEqual([{ draft: D1, result: "in_outlook", id: "AAMkDraft-new" }]);
    expect(r.counts.drafts_created).toBe(1);
  });

  it("stands back when a person already has a draft in that conversation — no write at all", async () => {
    const r = await run({
      drafts: { create: [job()], remove: [] },
      graph: { "ann@carrier.com": { byInternetId: { "<m1@broker.com>": { id: "AAMk1", conversationId: "AAQk1" } }, draftsByConversation: { AAQk1: ["AAMkMine"] } } },
    });
    expect(r.w.writes).toEqual([]);
    expect(r.d.completed[0]!.result).toBe("person_draft_found");
    expect(r.counts.drafts_stood_back).toBe(1);
  });

  it("an email no longer in the mailbox ends not_found, with no write", async () => {
    const r = await run({ drafts: { create: [job({ internet_message_id: "<gone@broker.com>" })], remove: [] } });
    expect(r.w.writes).toEqual([]);
    expect(r.d.completed[0]!.result).toBe("not_found");
  });

  it("Microsoft refusing the write (no Mail.ReadWrite yet) ends refused; throttling leaves the draft claimed", async () => {
    expect((await run({ drafts: { create: [job()], remove: [] }, write: { createStatus: "refused" } })).d.completed[0]!.result).toBe("refused");
    const t = await run({ drafts: { create: [job()], remove: [] }, write: { createStatus: "throttled" } });
    expect(t.d.completed).toEqual([]);
  });

  it("removes 360's own draft under Drafts; one already sent is sent_or_gone", async () => {
    const remove = [{ draft_id: D2, mailbox: "ann@carrier.com", graph_draft_id: "AAMkOld" }];
    const r = await run({ drafts: { create: [], remove } });
    expect(r.w.writes).toEqual([{ kind: "delete", url: "https://graph.microsoft.com/v1.0/users/ann%40carrier.com/mailFolders/drafts/messages/AAMkOld" }]);
    expect(r.d.completed).toEqual([{ draft: D2, result: "removed", id: null }]);
    expect((await run({ drafts: { create: [], remove }, write: { deleteAnswer: "gone" } })).d.completed[0]!.result).toBe("sent_or_gone");
  });

  it("starts nothing after the deadline: the draft stays claimed for a later run", async () => {
    const r = await run({ drafts: { create: [job()], remove: [] }, deadline: NOW.getTime() - 1 });
    expect(r.g.requested).toEqual([]);
    expect(r.d.completed).toEqual([]);
  });

  it("logs no address, id or word of the text", async () => {
    const r = await run({ drafts: { create: [job()], remove: [] }, write: { createStatus: "refused" } });
    expect(JSON.stringify(r.cap.events)).not.toMatch(/ann@|AAMk|truck|broker\.com/);
  });
});

describe("graphWrite — the two writes, and nothing a GET URL could become", () => {
  const tokens = { get: async () => "t" };
  const reply = (status: number, json: unknown = {}) => async () => ({ status, headers: { get: () => null }, json: async () => json });

  it("POSTs only a createReply URL with { comment }, DELETEs only under Drafts", async () => {
    const seen: { url: string; method: string; body?: string }[] = [];
    const w = graphWrite(async (url, init) => { seen.push({ url, method: init.method, body: init.body }); return { status: init.method === "POST" ? 201 : 204, headers: { get: () => null }, json: async () => ({ id: "AAMkNew" }) }; }, tokens);
    expect(await w.createReply("https://graph.microsoft.com/v1.0/users/ann%40carrier.com/messages/AAMk/createReply", "Hi")).toBe("AAMkNew");
    expect(await w.deleteDraft("https://graph.microsoft.com/v1.0/users/ann%40carrier.com/mailFolders/drafts/messages/AAMkD")).toBe("deleted");
    expect(seen).toEqual([
      { url: "https://graph.microsoft.com/v1.0/users/ann%40carrier.com/messages/AAMk/createReply", method: "POST", body: '{"comment":"Hi"}' },
      { url: "https://graph.microsoft.com/v1.0/users/ann%40carrier.com/mailFolders/drafts/messages/AAMkD", method: "DELETE", body: undefined },
    ]);
    await expect(w.createReply("https://graph.microsoft.com/v1.0/users/ann%40carrier.com/messages/AAMk/send", "Hi")).rejects.toThrow(/refused write/);
    await expect(w.deleteDraft("https://graph.microsoft.com/v1.0/users/ann%40carrier.com/messages/AAMkInbox")).rejects.toThrow(/refused write/);
  });

  it("a 404 on delete is gone, not an error; a 403 on create is Microsoft's refusal", async () => {
    expect(await graphWrite(reply(404), tokens).deleteDraft("https://graph.microsoft.com/v1.0/users/a%40b.com/mailFolders/drafts/messages/X")).toBe("gone");
    await expect(graphWrite(reply(403), tokens).createReply("https://graph.microsoft.com/v1.0/users/a%40b.com/messages/X/createReply", "Hi")).rejects.toMatchObject({ name: "MailboxRefused" });
  });
});
