import { chatBodyText, chatTitle, type ChatActivityItem, type ChatConversation } from "@silvicom/shared";

/**
 * What a desktop alert says, and when one is owed (OFFICE-CHAT-PLAN CH6d; Q-CHAT18 ruled (a), Q-CHAT4 (a)).
 *
 * Pure: two snapshots in, alerts out. The composable (`useChatDesktopAlerts`) does the watching and the
 * browser calls; everything a person relies on — which lines ring, which never do, what the alert reads —
 * is decided here, where a test reads it without a browser.
 *
 * WHICH LINES RING (Q-CHAT18 (a), the bell's own rule D-CHAT23, so a mute means the same in both):
 *   · a new line in a DIRECT or GROUP conversation, from somebody else, unless it is muted;
 *   · in a CHANNEL, only a line that names you or replies to your post — an Activity item;
 *   · a conversation muted to `mentions` rings for a mention only (Activity again); muted `all`, never.
 *   · never a reaction: it is not a line (D-CHAT25 lists it in Activity; it does not interrupt).
 * WHEN (Q-CHAT18): never for the conversation that is open in a VISIBLE tab — the reader is looking at it.
 *
 * Two sources, one line each: the inbox (direct and group lines) and Activity (mentions and replies).
 * A direct-conversation mention appears in both, so an alert is keyed by its message id and rings once.
 */

/** The first characters of a line (Q-CHAT18 (a): 80), mentions as `@Name`, on one line. */
export const ALERT_TEXT_MAX = 80;

export interface DesktopAlert {
  /** The line it is about — the dedupe key. */
  messageId: string;
  /** A conversation's alerts replace each other (the Notification `tag`), so five lines are one alert. */
  threadId: string;
  title: string;
  body: string;
  /** Where it opens: the /chat query (`?c=`, `?ch=`, `?ch=&post=`). */
  query: Record<string, string>;
}

type NameOf = (userId: string) => string | null | undefined;

export function alertText(body: string | null, nameOf: NameOf): string {
  const flat = chatBodyText(body ?? "", nameOf).replace(/\s+/g, " ").trim();
  return flat.length > ALERT_TEXT_MAX ? `${flat.slice(0, ALERT_TEXT_MAX - 1).trimEnd()}…` : flat;
}

/** Who said it, and where: "Ana" for a direct line, "Ana in Night dispatch", "Ana in # Loads". */
function alertTitle(sender: string | null, place: string | null): string {
  const who = sender?.trim() || "Someone";
  return place ? `${who} in ${place}` : who;
}

/** The conversation on screen in a visible tab — the one that never rings. */
export interface OnScreen { visible: boolean; threadId: string | null }

const quiet = (threadId: string, screen: OnScreen) => screen.visible && screen.threadId === threadId;

/**
 * Direct and group lines that arrived between two inbox snapshots. `prev` null = the first snapshot
 * since the page loaded: it is the state of things, not news, so nothing rings for it.
 */
export function inboxAlerts(
  prev: readonly ChatConversation[] | null,
  next: readonly ChatConversation[],
  viewerId: string,
  screen: OnScreen,
  nameOf: NameOf,
): DesktopAlert[] {
  if (!prev) return [];
  const before = new Map(prev.map((c) => [c.thread_id, c.last_message?.seq ?? 0]));
  const out: DesktopAlert[] = [];
  for (const c of next) {
    const last = c.last_message;
    if (c.kind === "channel" || c.muted !== "none" || !last || last.deleted) continue;
    if (last.seq <= (before.get(c.thread_id) ?? Infinity)) continue; // not newer, or a conversation not seen before
    if (!last.sender_user_id || last.sender_user_id.toLowerCase() === viewerId.toLowerCase()) continue;
    if (c.unread === 0 || quiet(c.thread_id, screen)) continue; // already read here or elsewhere, or on screen
    out.push({
      messageId: last.id,
      threadId: c.thread_id,
      title: alertTitle(last.sender_name, c.kind === "direct" ? null : chatTitle(c)),
      body: alertText(last.body, nameOf),
      query: { c: c.thread_id },
    });
  }
  return out;
}

/**
 * Mentions and replies that are new since the last look (`seen`): every channel's, and a direct or
 * group conversation's only when it is muted to `mentions` — an unmuted one already rang from the inbox.
 * `mutedOf` reads a conversation's mute from the inbox; unknown = treated as unmuted.
 */
export function activityAlerts(
  items: readonly ChatActivityItem[],
  seen: ReadonlySet<string>,
  mutedOf: (threadId: string) => ChatConversation["muted"] | undefined,
  screen: OnScreen,
  nameOf: NameOf,
): DesktopAlert[] {
  const out: DesktopAlert[] = [];
  for (const i of items) {
    if (!i.unread || seen.has(i.message_id) || i.reason === "reaction") continue;
    const muted = mutedOf(i.thread_id) ?? "none";
    if (muted === "all") continue;
    if (i.kind !== "channel" && muted === "none") continue; // the inbox rang for it
    if (quiet(i.thread_id, screen)) continue;
    const place = i.kind === "channel" ? `# ${i.subject?.trim() || "a channel"}` : i.kind === "group" ? (i.subject?.trim() || "a group") : null;
    out.push({
      messageId: i.message_id,
      threadId: i.thread_id,
      title: alertTitle(i.sender_name, place),
      body: alertText(i.body, nameOf),
      query: i.kind !== "channel" ? { c: i.thread_id } : i.parent_id ? { ch: i.thread_id, post: i.parent_id } : { ch: i.thread_id },
    });
  }
  return out;
}
