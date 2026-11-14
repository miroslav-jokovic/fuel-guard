import { z } from "zod";
import { chatBodyText, chatTitle, type ChatConversation, type ChatMember } from "./chatContract.js";
import { recordId } from "./recordId.js";

/**
 * Office chat on the phone — Web Push (CHAT-WEB-PUSH-PLAN WP2; OFFICE-CHAT-PLAN CH10).
 *
 * Three things live here because two apps must agree on them and a copy would drift:
 *   · what a chat alert SAYS — the in-tab desktop alert (web, CH6d) and the push (api) word a line the
 *     same way, Q-CHAT18 (a): the sender, the conversation, the first 80 characters (D-WP4);
 *   · the subscription the browser hands the API, and which push services it may point at (D-WP7);
 *   · the push message, in the Declarative Web Push shape Safari shows by itself and the service worker
 *     (`apps/web/public/sw.js`) shows for every other browser.
 */

// ── What an alert says (Q-CHAT18 (a), moved here from the web's chatDesktopAlerts.ts) ─────────────

/** The first characters of a line (Q-CHAT18 (a): 80), mentions as `@Name`, on one line. */
export const CHAT_ALERT_TEXT_MAX = 80;

type NameOf = (userId: string) => string | null | undefined;

export function chatAlertText(body: string | null, nameOf: NameOf): string {
  const flat = chatBodyText(body ?? "", nameOf).replace(/\s+/g, " ").trim();
  return flat.length > CHAT_ALERT_TEXT_MAX ? `${flat.slice(0, CHAT_ALERT_TEXT_MAX - 1).trimEnd()}…` : flat;
}

/** Who said it, and where: "Ana" for a direct line, "Ana in Night dispatch", "Ana in # Loads". */
export function chatAlertTitle(sender: string | null, place: string | null): string {
  const who = sender?.trim() || "Someone";
  return place ? `${who} in ${place}` : who;
}

/**
 * Where a line was said, as ONE recipient's inbox names it — so the push reads exactly as that person's
 * desktop alert and inbox row do. A direct line has no place; a channel is "# Name"; a group is its
 * subject, or — unnamed — the other members as `chatTitle` lists them for that viewer (0546's
 * `title_members`: up to four others by joining order, the count including the viewer).
 */
export function chatAlertPlace(
  conversation: Pick<ChatConversation, "kind" | "subject">,
  members: readonly Pick<ChatMember, "user_id" | "name" | "joined_at">[],
  viewerId: string,
): string | null {
  if (conversation.kind === "direct") return null;
  if (conversation.kind === "channel") return `# ${conversation.subject?.trim() || "a channel"}`;
  const viewer = viewerId.toLowerCase();
  const others = members
    .filter((m) => m.user_id.toLowerCase() !== viewer)
    .sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.user_id.localeCompare(b.user_id));
  return chatTitle({
    kind: "group",
    subject: conversation.subject,
    title_members: others.slice(0, 4).map((m) => ({ user_id: m.user_id, name: m.name })),
    member_count: others.length + 1,
  });
}

// ── The subscription (D-WP1, D-WP7) ─────────────────────────────────────────────────────────────

/**
 * The push services a browser's endpoint may live on. The server POSTs to the endpoint, so any other
 * host would turn a subscription into a request the server makes wherever a client says.
 *   · fcm.googleapis.com — Chrome, Edge on Android, Samsung Internet, Opera
 *   · *.push.services.mozilla.com — Firefox
 *   · *.push.apple.com — Safari (iPhone Home Screen apps, macOS)
 *   · *.notify.windows.com — Edge on Windows
 */
export function isPushServiceEndpoint(endpoint: string): boolean {
  // Read by shape, not `new URL` (this package runs without the DOM or Node libraries): https, a host of
  // letters, digits, dots and hyphens — so no user-info `@`, no `:port`, no `\` tricks — then a path.
  const m = /^https:\/\/([A-Za-z0-9.-]+)(\/[^\s\\]*)?$/.exec(endpoint);
  if (!m) return false;
  const host = m[1]!.toLowerCase();
  return host === "fcm.googleapis.com"
    || host.endsWith(".push.services.mozilla.com")
    || host.endsWith(".push.apple.com")
    || host.endsWith(".notify.windows.com");
}

/** base64url without padding, the encoding `PushSubscription.toJSON()` gives the two keys in. */
const base64url = (min: number, max: number) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${min},${max}}$`));

export const webPushSubscribeRequestSchema = z.object({
  endpoint: z.string().max(2048).refine(isPushServiceEndpoint, "not a push service endpoint"),
  /** P-256 public key (65 bytes → 87 characters) and auth secret (16 bytes → 22), as the database checks. */
  keys: z.object({ p256dh: base64url(86, 88), auth: base64url(22, 24) }),
  /** The page's own origin: where a tapped notification opens. Must be one of the API's allowed origins. */
  origin: z.string().regex(/^https?:\/\/[^/]+$/),
  /** "Chrome on Android" — shown to the person, never used to decide anything. */
  device_label: z.string().trim().max(120).optional(),
  /**
   * A page load re-registering a device the person turned on earlier, not a press of Turn on (D-WP10). The
   * one difference: a device the person REMOVED from another device's list is not revived by a refresh —
   * the API answers 409 `device_removed` and the browser lets go of it.
   */
  refresh: z.boolean().optional(),
});
export type WebPushSubscribeRequest = z.infer<typeof webPushSubscribeRequestSchema>;

export const webPushUnsubscribeRequestSchema = z.object({
  endpoint: z.string().max(2048),
  /** Turning it off here, or signing out of this browser. */
  reason: z.enum(["turned_off", "signed_out"]),
});
export type WebPushUnsubscribeRequest = z.infer<typeof webPushUnsubscribeRequestSchema>;

/** `GET /api/chat/push`: whether this server can push at all, and the key a browser subscribes with. */
export const webPushStateResponseSchema = z.object({
  available: z.boolean(),
  public_key: z.string().nullable(),
});
export type WebPushStateResponse = z.infer<typeof webPushStateResponseSchema>;

/** `POST /api/chat/push/test`: how many of the caller's devices the push services accepted it for. */
export const webPushTestResponseSchema = z.object({ devices: z.number().int().nonnegative(), sent: z.number().int().nonnegative() });
export type WebPushTestResponse = z.infer<typeof webPushTestResponseSchema>;

// ── The person's devices (WP4; D-WP9, D-WP10) ──────────────────────────────────────────────────

/**
 * A device not seen for this long stops receiving (revoked `unused`, 0602). Every signed-in page load refreshes
 * `last_seen_at`, so 90 days without one is a phone in a drawer or a browser profile nobody opens — and a lost
 * phone on which a lock screen keeps showing the office's chat. A device opened again after that comes back by
 * itself: the person's choice is still stored in that browser and its next page load re-registers it.
 */
export const WEB_PUSH_UNUSED_DAYS = 90;
export function isUnusedPushDevice(lastSeenAt: string, now: Date): boolean {
  const seen = Date.parse(lastSeenAt);
  return Number.isFinite(seen) && now.getTime() - seen > WEB_PUSH_UNUSED_DAYS * 86_400_000;
}

/** One live device of the caller's, as `GET /api/chat/push/devices` lists it. Never the endpoint or keys. */
export const webPushDeviceSchema = z.object({
  id: recordId(),
  device_label: z.string().nullable(),
  created_at: z.string(),
  last_seen_at: z.string(),
  last_success_at: z.string().nullable(),
  last_failure_at: z.string().nullable(),
});
export type WebPushDevice = z.infer<typeof webPushDeviceSchema>;
export const webPushDevicesResponseSchema = z.object({ devices: z.array(webPushDeviceSchema) });
export type WebPushDevicesResponse = z.infer<typeof webPushDevicesResponseSchema>;

// ── The message (Declarative Web Push, W3C Push API; D-WP4) ─────────────────────────────────────

/**
 * `web_push: 8030` opts a message into the declarative format: Safari 18.4+ shows `notification` with no
 * script. Chrome and Firefox do not read the format; they fire the service worker's `push` event, which
 * shows the same fields. `navigate` is required and absolute; `tag` + `renotify` make a conversation one
 * notification that buzzes again; `data` carries what a tap needs.
 */
export interface ChatPushMessage {
  web_push: 8030;
  notification: {
    title: string;
    body: string;
    navigate: string;
    tag: string;
    renotify: true;
    silent: false;
    lang: "en-US";
    dir: "auto";
    icon: string;
    badge: string;
    timestamp: number;
    data: { thread_id: string | null; message_id: string | null };
  };
}

export interface ChatPushInput {
  /** The device's origin, e.g. https://360.silvicominc.com — `navigate` and the icons live there. */
  origin: string;
  title: string;
  body: string;
  /** Path and query inside the app, e.g. `/chat?c=<id>`. */
  path: string;
  threadId: string | null;
  messageId: string | null;
  at: Date;
}

export function chatPushMessage(i: ChatPushInput): ChatPushMessage {
  return {
    web_push: 8030,
    notification: {
      title: i.title,
      body: i.body,
      navigate: `${i.origin}${i.path}`,
      tag: i.threadId ? chatPushTag(i.threadId) : "chat",
      renotify: true,
      silent: false,
      lang: "en-US",
      dir: "auto",
      icon: `${i.origin}/icons/icon-192.png`,
      badge: `${i.origin}/icons/badge-96.png`,
      timestamp: i.at.getTime(),
      data: { thread_id: i.threadId, message_id: i.messageId },
    },
  };
}

/**
 * A conversation's notification on a device: one per conversation, replaced by each new line (`renotify`), and
 * what the web closes when that conversation is read on the same device (D-WP11). One definition, so the two
 * can never name different notifications.
 */
export function chatPushTag(threadId: string): string {
  return `chat:${threadId}`;
}

/** Where a tap opens a line: the conversation; a channel reply, its post (the /chat query CH6d uses). */
export function chatPushPath(kind: ChatConversation["kind"], threadId: string, parentId: string | null): string {
  if (kind !== "channel") return `/chat?c=${threadId}`;
  return parentId ? `/chat?ch=${threadId}&post=${parentId}` : `/chat?ch=${threadId}`;
}
