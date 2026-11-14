import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chatAlertPlace,
  chatAlertText,
  chatAlertTitle,
  chatMemberSchema,
  chatPushMessage,
  chatPushPath,
  isUnusedPushDevice,
  type ChatMember,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { trackJob } from "../../lib/shutdown.js";
import { conversationRow, rpc } from "./chat.js";
import { filesForBell } from "./chatFiles.js";
import { sendPush, vapidKeysFrom, type PushOutcome, type VapidKeys } from "./webPush.js";

/**
 * Office chat on the phone (CHAT-WEB-PUSH-PLAN WP2; OFFICE-CHAT-PLAN CH10): after a line is written, push it to
 * the devices of whoever should hear of it.
 *
 * WHO is not decided here. 0599's `chat_push_targets` answers it in SQL with Q-CHAT18 (a)'s rule (D-WP2), so a
 * mute means the same on the PC, the bell and the phone. This file words the push, finds each person's devices
 * and records what each push service said.
 *
 * WHEN (D-WP3): HELD 15 SECONDS, then sent only to whoever has still not read past the line. A person reading
 * the conversation in a visible tab has marked it read by then (realtime signal → refetch → `POST /read`; the
 * slowest measured path, a burst of 40 `/sync` calls, took 6.2 s — Q-CHAT14), and so has one who read it on
 * another device. The hold lives in the process that wrote the line, registered with `trackJob`: a deploy's
 * drain (35 s) lets it finish, and a crash loses at most 15 s of pushes — never a line, which the inbox and the
 * bell still hold. Nothing here may fail the send that caused it: every error is logged and swallowed.
 */

export const PUSH_HOLD_MS = 15_000;
/** A chat line an hour old is the inbox's job, not a buzz (RFC 8030 TTL). */
const PUSH_TTL_SECONDS = 3600;

interface Target { user_id: string; reason: "line" | "mention" | "reply" }

interface DeviceRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  origin: string;
  last_seen_at: string;
}

/** The columns every reader of a device to push to selects — `liveDevices` needs `last_seen_at`. */
export const PUSH_DEVICE_COLUMNS = "id, user_id, endpoint, p256dh, auth, origin, last_seen_at";

export interface ChatPushResult { targets: number; devices: number; sent: number; gone: number; failed: number; unused: number }
const NOTHING: ChatPushResult = { targets: 0, devices: 0, sent: 0, gone: 0, failed: 0, unused: 0 };

/**
 * The live rows a push may go to, after retiring those not seen for `WEB_PUSH_UNUSED_DAYS` (0602, D-WP9).
 * Retired HERE, at the moment one would have been pushed, rather than by a sweep: no scheduler to place
 * (WORKER-DEPLOYMENT.md's one-process rule), and a device nobody is pushed to harms nobody while it waits.
 * Revoked, never deleted — the row's history stays. Every reader of devices to push to goes through this, so
 * the delivery, the test and the device list cannot disagree about which devices are live.
 */
export async function liveDevices<T extends { id: string; last_seen_at: string }>(
  admin: SupabaseClient,
  orgId: string,
  rows: readonly T[],
  now: Date = new Date(),
): Promise<{ live: T[]; unused: number }> {
  const stale = rows.filter((r) => isUnusedPushDevice(r.last_seen_at, now));
  if (stale.length > 0) {
    const { error } = await admin
      .from("web_push_subscriptions")
      .update({ revoked_at: now.toISOString(), revoked_reason: "unused" })
      .in("id", stale.map((r) => r.id))
      .eq("org_id", orgId)
      .is("revoked_at", null);
    if (error) console.error(`[chat-push] could not retire ${stale.length} unused device(s): ${error.message}`);
  }
  const gone = new Set(stale.map((r) => r.id));
  return { live: rows.filter((r) => !gone.has(r.id)), unused: stale.length };
}

type Fetcher = typeof fetch;

/** Each device's answer onto its row: when it last worked, what last failed, or that it is gone. */
export async function recordPushOutcome(admin: SupabaseClient, orgId: string, device: { id: string }, outcome: PushOutcome): Promise<void> {
  const now = new Date().toISOString();
  const patch =
    outcome.kind === "sent"
      ? { last_success_at: now, last_failure: null, last_failure_at: null }
      : outcome.kind === "gone"
        ? { revoked_at: now, revoked_reason: "gone", last_failure: `push service answered ${outcome.status}`, last_failure_at: now }
        : { last_failure: `${outcome.status ?? "no answer"}: ${outcome.detail}`.slice(0, 500), last_failure_at: now };
  const { error } = await admin.from("web_push_subscriptions").update(patch).eq("id", device.id).eq("org_id", orgId);
  if (error) console.error(`[chat-push] could not record ${outcome.kind} for device ${device.id}: ${error.message}`);
}

/**
 * One of the caller's own devices stops: removed from another device's "Your devices" list (D-WP10). The row
 * must be the caller's, in this organisation, and still live; the answer is how many rows that was (0 or 1).
 */
export async function removeOwnPushDevice(admin: SupabaseClient, orgId: string, userId: string, id: string): Promise<number> {
  const { data, error } = await admin
    .from("web_push_subscriptions")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: "removed" })
    .eq("id", id)
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

/** The words of a line as the push gives them: its body, or for a line that is only files, what the bell says. */
async function lineText(admin: SupabaseClient, orgId: string, messageId: string, body: string | null): Promise<string> {
  if (body?.trim()) return body;
  const { data } = await admin.from("chat_attachments").select("file_name").eq("message_id", messageId).eq("org_id", orgId);
  return filesForBell("", (data ?? []) as { file_name: string }[]);
}

/**
 * Push one line now. `mentioned` null = a new line or reply; a list = an edit, pushed only to the people it
 * newly names. Exported for its tests and for `scheduleChatPush`; routes call the latter.
 */
export async function deliverChatPush(
  admin: SupabaseClient,
  keys: VapidKeys,
  orgId: string,
  senderId: string,
  messageId: string,
  mentioned: readonly string[] | null,
  fetcher?: Fetcher,
): Promise<ChatPushResult> {
  const targets = await rpc<Target[]>(admin, "chat_push_targets", { p_org: orgId, p_message: messageId, p_mentioned: mentioned });
  if (!targets.ok) throw new Error(targets.message);
  const people = targets.value ?? [];
  if (people.length === 0) return NOTHING;

  const { data: devicesData, error: devicesError } = await admin
    .from("web_push_subscriptions")
    .select(PUSH_DEVICE_COLUMNS)
    .eq("org_id", orgId)
    .in("user_id", people.map((p) => p.user_id))
    .is("revoked_at", null);
  if (devicesError) throw new Error(devicesError.message);
  const { live: devices, unused } = await liveDevices(admin, orgId, (devicesData ?? []) as DeviceRow[]);
  if (devices.length === 0) return { ...NOTHING, targets: people.length, unused };

  // The line as it stands NOW — an edit in the hold is what the person should read.
  const { data: lineData } = await admin
    .from("messages").select("thread_id, parent_id, body, created_at").eq("id", messageId).eq("org_id", orgId).maybeSingle();
  const line = lineData as { thread_id: string; parent_id: string | null; body: string | null; created_at: string } | null;
  if (!line) return { ...NOTHING, targets: people.length };

  // As the sender sees it: the sender is in it, so both answer (the same reading as chatNotify.ts).
  const [conversation, membersRes] = await Promise.all([
    conversationRow(admin, orgId, senderId, line.thread_id),
    rpc<unknown[]>(admin, "chat_members", { p_org: orgId, p_user: senderId, p_thread: line.thread_id }),
  ]);
  if (!conversation || !membersRes.ok) return { ...NOTHING, targets: people.length };
  const members: ChatMember[] = (membersRes.value ?? []).map((r) => chatMemberSchema.parse(r));
  const names = new Map(members.map((m) => [m.user_id.toLowerCase(), m.name]));
  const sender = names.get(senderId.toLowerCase()) ?? null;
  const body = chatAlertText(await lineText(admin, orgId, messageId, line.body), (id) => names.get(id.toLowerCase()));
  const path = chatPushPath(conversation.kind, line.thread_id, line.parent_id);
  // RFC 8030 Topic: a phone that was offline gets this conversation's newest push, not a pile. A uuid without
  // its hyphens is 32 hex characters, inside the topic's 32 base64url characters.
  const topic = line.thread_id.replace(/-/g, "");

  const result: ChatPushResult = { targets: people.length, devices: devices.length, sent: 0, gone: 0, failed: 0, unused };
  await Promise.all(devices.map(async (device) => {
    const title = chatAlertTitle(sender, chatAlertPlace(conversation, members, device.user_id));
    const message = chatPushMessage({
      origin: device.origin, title, body, path, threadId: line.thread_id, messageId, at: new Date(line.created_at),
    });
    const outcome = await sendPush(device, JSON.stringify(message), keys, { ttl: PUSH_TTL_SECONDS, urgency: "high", topic }, fetcher);
    if (outcome.kind === "sent") result.sent += 1;
    else if (outcome.kind === "gone") result.gone += 1;
    else {
      result.failed += 1;
      console.error(`[chat-push] device ${device.id}: ${outcome.status ?? "no answer"} ${outcome.detail}`);
    }
    await recordPushOutcome(admin, orgId, device, outcome);
  }));
  return result;
}

let misconfiguredLogged = false;

/** The server's key pair, or null when push is off here. A pair that does not match is logged once and is off. */
export function chatPushKeys(env: Env): VapidKeys | null {
  try {
    return vapidKeysFrom(env);
  } catch (e) {
    if (!misconfiguredLogged) console.error(`[chat-push] push is OFF: ${e instanceof Error ? e.message : String(e)}`);
    misconfiguredLogged = true;
    return null;
  }
}

/**
 * After a send, a post, a reply or an edit that names somebody new: hold, then push. Returns at once — the
 * caller's answer never waits for a phone. A deploy's drain waits for the hold; a drain too short to wait
 * sends it at once instead (`release`).
 */
export function scheduleChatPush(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  senderId: string,
  messageId: string,
  mentioned: readonly string[] | null = null,
  holdMs: number = PUSH_HOLD_MS,
): void {
  const keys = chatPushKeys(env);
  if (!keys) return;
  if (mentioned && mentioned.length === 0) return;
  const id = `chat-push:${messageId}:${mentioned ? "edit" : "line"}:${Date.now()}`;
  let ran = false;
  let timer: NodeJS.Timeout | undefined;
  let untrack: () => void = () => {};
  const run = async (): Promise<void> => {
    if (ran) return;
    ran = true;
    clearTimeout(timer);
    try {
      const r = await deliverChatPush(admin, keys, orgId, senderId, messageId, mentioned);
      if (r.devices > 0 || r.unused > 0) {
        console.log(`[chat-push] ${messageId}: ${r.sent} sent, ${r.gone} gone, ${r.failed} failed of ${r.devices} device(s); ${r.unused} retired unused`);
      }
    } catch (e) {
      console.error(`[chat-push] ${messageId}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      untrack();
    }
  };
  const settled = new Promise<void>((resolve) => {
    timer = setTimeout(() => void run().then(resolve), holdMs);
  });
  untrack = trackJob(id, { kind: "chat_push", settled, release: run });
}
