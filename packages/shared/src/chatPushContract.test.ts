import { describe, expect, it } from "vitest";
import {
  chatAlertPlace,
  chatAlertTitle,
  chatPushMessage,
  chatPushPath,
  isPushServiceEndpoint,
  webPushSubscribeRequestSchema,
} from "./chatPushContract.js";

/**
 * CH10's shared half (CHAT-WEB-PUSH-PLAN D-WP4, D-WP7): which endpoints the server will ever POST to, what a
 * push says for each recipient, and the message both Safari and the service worker read.
 */
const T = "33333333-3333-4333-8333-333333333333";
const POST = "44444444-4444-4444-8444-444444444444";
const ANA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const CLEO = "55555555-5555-4555-8555-555555555555";

describe("isPushServiceEndpoint", () => {
  it("accepts the four push services' endpoints as browsers hand them out", () => {
    for (const e of [
      "https://fcm.googleapis.com/fcm/send/dXy:APA91bH",
      "https://fcm.googleapis.com/wp/dXy",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://web.push.apple.com/QGd3Yx",
      "https://wns2-bn3p.notify.windows.com/w/?token=BQYAAA",
    ]) expect(isPushServiceEndpoint(e), e).toBe(true);
  });

  it("refuses anything that would let a client choose where the server sends a request", () => {
    for (const e of [
      "http://fcm.googleapis.com/fcm/send/x", // not https
      "https://fcm.googleapis.com:8443/fcm/send/x", // a port
      "https://user@fcm.googleapis.com/x", // user-info: the host would be what follows the @
      "https://fcm.googleapis.com@evil.example/x",
      "https://fcm.googleapis.com.evil.example/x", // a lookalike suffix
      "https://evilpush.apple.com/x", // not a subdomain of push.apple.com
      "https://push.apple.com.evil.example/x",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/x",
      "https://fcm.googleapis.com\\@evil.example/x",
      "not a url",
    ]) expect(isPushServiceEndpoint(e), e).toBe(false);
  });

  it("is what the subscribe request checks", () => {
    const keys = { p256dh: "B" + "a".repeat(86), auth: "c".repeat(22) };
    const ok = webPushSubscribeRequestSchema.safeParse({ endpoint: "https://web.push.apple.com/x", keys, origin: "https://360.silvicominc.com" });
    expect(ok.success).toBe(true);
    const bad = webPushSubscribeRequestSchema.safeParse({ endpoint: "https://evil.example/x", keys, origin: "https://360.silvicominc.com" });
    expect(bad.success).toBe(false);
    const badOrigin = webPushSubscribeRequestSchema.safeParse({ endpoint: "https://web.push.apple.com/x", keys, origin: "https://360.silvicominc.com/chat" });
    expect(badOrigin.success).toBe(false);
  });
});

describe("what a push says (Q-CHAT18 (a), D-WP4)", () => {
  const members = [
    { user_id: ANA, name: "Ana Petrović", joined_at: "2026-11-01T09:00:00Z" },
    { user_id: BEN, name: "Ben Admin", joined_at: "2026-11-01T09:00:01Z" },
    { user_id: CLEO, name: "Cleo Safety", joined_at: "2026-11-01T09:00:02Z" },
  ];

  it("names no place for a direct line, the channel with its #, a named group by its name", () => {
    expect(chatAlertPlace({ kind: "direct", subject: null }, members, BEN)).toBeNull();
    expect(chatAlertPlace({ kind: "channel", subject: "Loads" }, members, BEN)).toBe("# Loads");
    expect(chatAlertPlace({ kind: "group", subject: " Night desk " }, members, BEN)).toBe("Night desk");
  });

  it("names an unnamed group by its OTHER members, as the recipient's own inbox does", () => {
    expect(chatAlertPlace({ kind: "group", subject: null }, members, BEN)).toBe("Ana Petrović, Cleo Safety");
    expect(chatAlertPlace({ kind: "group", subject: null }, members, CLEO.toUpperCase())).toBe("Ana Petrović, Ben Admin");
  });

  it("titles a line by who said it and where", () => {
    expect(chatAlertTitle("Ana Petrović", null)).toBe("Ana Petrović");
    expect(chatAlertTitle("Ana Petrović", "# Loads")).toBe("Ana Petrović in # Loads");
    expect(chatAlertTitle("  ", "Night desk")).toBe("Someone in Night desk");
  });
});

describe("the push message", () => {
  it("is a declarative message Safari can show without a script, opening the conversation on the device's origin", () => {
    const m = chatPushMessage({
      origin: "https://360.silvicominc.com", title: "Ana Petrović", body: "can you take 4417?",
      path: chatPushPath("direct", T, null), threadId: T, messageId: POST, at: new Date("2026-11-13T15:00:00Z"),
    });
    expect(m.web_push).toBe(8030);
    expect(m.notification).toMatchObject({
      title: "Ana Petrović",
      body: "can you take 4417?",
      navigate: `https://360.silvicominc.com/chat?c=${T}`,
      tag: `chat:${T}`,
      renotify: true,
      icon: "https://360.silvicominc.com/icons/icon-192.png",
      data: { thread_id: T, message_id: POST },
    });
    // Under the ~4 KB a push service carries, with room for the longest title and 80 characters.
    // Characters, not bytes (this package has no TextEncoder): ASCII here, so the two are the same.
    expect(JSON.stringify(m).length).toBeLessThan(1024);
  });

  it("opens a channel line in its channel, and a reply at its post", () => {
    expect(chatPushPath("group", T, null)).toBe(`/chat?c=${T}`);
    expect(chatPushPath("channel", T, null)).toBe(`/chat?ch=${T}`);
    expect(chatPushPath("channel", T, POST)).toBe(`/chat?ch=${T}&post=${POST}`);
  });
});
