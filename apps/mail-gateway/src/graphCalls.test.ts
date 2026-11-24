import { describe, expect, it } from "vitest";
import { acceptPagingLink, CALL_SHAPES, graphUrl, RefusedCall } from "./graphCalls.js";

const ALLOWED = new Set(["ann@carrier.com"]);

describe("the Graph allowlist (D-BMR4)", () => {
  it("has exactly four call shapes in P1 — a fifth is a decision, made here in a diff", () => {
    expect([...CALL_SHAPES]).toEqual(["folder_delta", "message_delta", "message_body", "inbox_probe"]);
  });

  it("every shape builds a GET on Graph v1.0 under the one user, and nothing else", () => {
    const urls = [
      graphUrl({ shape: "folder_delta", mailbox: "ann@carrier.com" }, ALLOWED),
      graphUrl({ shape: "message_delta", mailbox: "ann@carrier.com", folder: { kind: "inbox" }, receivedSince: "2026-11-17T00:00:00Z" }, ALLOWED),
      graphUrl({ shape: "message_delta", mailbox: "ann@carrier.com", folder: { kind: "sentitems" }, receivedSince: "2026-11-17T00:00:00Z" }, ALLOWED),
      graphUrl({ shape: "message_delta", mailbox: "ann@carrier.com", folder: { kind: "id", id: "AAMk=" }, receivedSince: "2026-11-17T00:00:00Z" }, ALLOWED),
      graphUrl({ shape: "message_body", mailbox: "ann@carrier.com", messageId: "AAMkAD" }, ALLOWED, { bodyReading: true }),
      graphUrl({ shape: "inbox_probe", mailbox: "ann@carrier.com" }, ALLOWED),
    ];
    for (const u of urls) expect(u.startsWith("https://graph.microsoft.com/v1.0/users/ann%40carrier.com/")).toBe(true);
    expect(urls[1]).toContain("changeType=created");
    expect(urls.join(" ")).not.toMatch(/send|move|copy|attachments|\$value|rules|delete/i);
  });

  it("a mailbox outside the cycle's list is refused before any URL exists", () => {
    expect(() => graphUrl({ shape: "inbox_probe", mailbox: "ceo@carrier.com" }, ALLOWED)).toThrow(RefusedCall);
    expect(() => graphUrl({ shape: "folder_delta", mailbox: "ANN@carrier.com/../ceo@carrier.com" }, ALLOWED)).toThrow(RefusedCall);
  });

  it("the body shape does not exist while body reading is off (Q-BMR9 days 1-3)", () => {
    expect(() => graphUrl({ shape: "message_body", mailbox: "ann@carrier.com", messageId: "AAMkAD" }, ALLOWED)).toThrow(/body reading is off/);
  });

  it("ids cannot smuggle a path", () => {
    expect(() => graphUrl({ shape: "message_body", mailbox: "ann@carrier.com", messageId: "x/../../send" }, ALLOWED, { bodyReading: true })).toThrow(RefusedCall);
    expect(() => graphUrl({ shape: "message_delta", mailbox: "ann@carrier.com", folder: { kind: "id", id: "a?b" }, receivedSince: "2026-11-17T00:00:00Z" }, ALLOWED)).toThrow(RefusedCall);
  });

  it("follows Graph's paging links only for the same kind of request and the same mailbox", () => {
    const ok = [
      "https://graph.microsoft.com/v1.0/users/ann%40carrier.com/mailFolders/inbox/messages/delta?$skiptoken=1",
      "https://graph.microsoft.com/v1.0/users('ann%40carrier.com')/mailFolders('AAMk')/messages/delta?$deltatoken=2",
    ];
    for (const l of ok) expect(acceptPagingLink(l, { mailbox: "ann@carrier.com", shape: "message_delta" }, ALLOWED)).toBe(new URL(l).toString());
    const bad = [
      "https://evil.example/v1.0/users/ann%40carrier.com/mailFolders/inbox/messages/delta",
      "http://graph.microsoft.com/v1.0/users/ann%40carrier.com/mailFolders/inbox/messages/delta",
      "https://graph.microsoft.com/v1.0/users/ceo%40carrier.com/mailFolders/inbox/messages/delta",
      "https://graph.microsoft.com/v1.0/users/ann%40carrier.com/messages/AAMk/send",
      "https://graph.microsoft.com/v1.0/users/ann%40carrier.com/mailFolders/delta",
      "https://graph.microsoft.com/beta/users/ann%40carrier.com/mailFolders/inbox/messages/delta",
    ];
    for (const l of bad) expect(() => acceptPagingLink(l, { mailbox: "ann@carrier.com", shape: "message_delta" }, ALLOWED)).toThrow(RefusedCall);
    expect(acceptPagingLink("https://graph.microsoft.com/v1.0/users/ann%40carrier.com/mailFolders/delta?$skiptoken=x", { mailbox: "ann@carrier.com", shape: "folder_delta" }, ALLOWED)).toContain("mailFolders/delta");
  });
});
