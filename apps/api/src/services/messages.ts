import type { SupabaseClient } from "@supabase/supabase-js";
import {
  rolesThatManage,
  unreadFor,
  type CreateThreadRequest,
  type Message,
  type SendMessageRequest,
  type Thread,
} from "@fuelguard/shared";
import { notify } from "./notify.js";

/**
 * Messages (Phase 5M, D54). Office↔driver, optionally bound to a load.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: **the client never chooses participants.** A thread's
 * audience is resolved here — the driver plus the org's dispatch-capable users — because a client
 * that names participants is a client that can put someone in a conversation they should never have
 * seen. The migration backs this up: `thread_participants` has no INSERT policy for any role.
 */

const OFFICE_ROLES = rolesThatManage("dispatch");

/** Every office user who should see a driver's thread. Resolved server-side, always. */
async function officeAudience(admin: SupabaseClient, orgId: string): Promise<string[]> {
  const { data } = await admin
    .from("memberships")
    .select("user_id, role")
    .eq("org_id", orgId)
    .in("role", OFFICE_ROLES);
  return ((data ?? []) as { user_id: string }[]).map((m) => m.user_id);
}

async function loginForDriverId(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("drivers")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("id", driverId)
    .maybeSingle();
  return (data as { user_id: string | null } | null)?.user_id ?? null;
}

interface ParticipantRow {
  thread_id: string;
  user_id: string;
  role: "driver" | "office";
  last_read_at: string | null;
}

interface MessageRow {
  id: string;
  thread_id: string;
  sender_user_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

/** Display names for whoever appears in a thread, resolved in one pass rather than per row. */
async function nameMap(admin: SupabaseClient, orgId: string, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const { data } = await admin
    .from("drivers")
    .select("user_id, full_name")
    .eq("org_id", orgId)
    .in("user_id", userIds);
  const m = new Map<string, string>();
  for (const d of (data ?? []) as { user_id: string | null; full_name: string }[]) {
    if (d.user_id) m.set(d.user_id, d.full_name);
  }
  return m;
}

/** Every thread this user participates in, newest first, with their own unread count. */
export async function listThreads(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<{ threads: Thread[]; unread_total: number }> {
  const { data: mine } = await admin
    .from("thread_participants")
    .select("thread_id, last_read_at")
    .eq("org_id", orgId)
    .eq("user_id", userId);

  const rows = (mine ?? []) as { thread_id: string; last_read_at: string | null }[];
  if (rows.length === 0) return { threads: [], unread_total: 0 };
  const threadIds = rows.map((r) => r.thread_id);

  const [threadsRes, participantsRes, messagesRes] = await Promise.all([
    admin
      .from("message_threads")
      .select("id, subject, load_id, status, last_message_at, created_at, loads(ref)")
      .in("id", threadIds)
      .order("last_message_at", { ascending: false }),
    admin.from("thread_participants").select("thread_id, user_id, role, last_read_at").in("thread_id", threadIds),
    admin
      .from("messages")
      .select("id, thread_id, sender_user_id, body, created_at, edited_at, deleted_at")
      .in("thread_id", threadIds)
      .order("created_at", { ascending: true }),
  ]);

  const participants = (participantsRes.data ?? []) as unknown as ParticipantRow[];
  const messages = (messagesRes.data ?? []) as unknown as MessageRow[];
  const names = await nameMap(admin, orgId, [...new Set(participants.map((p) => p.user_id))]);

  const byThreadP = new Map<string, ParticipantRow[]>();
  for (const p of participants) byThreadP.set(p.thread_id, [...(byThreadP.get(p.thread_id) ?? []), p]);
  const byThreadM = new Map<string, MessageRow[]>();
  for (const m of messages) byThreadM.set(m.thread_id, [...(byThreadM.get(m.thread_id) ?? []), m]);

  type ThreadRow = {
    id: string; subject: string | null; load_id: string | null; status: "open" | "closed";
    last_message_at: string; created_at: string; loads: { ref: string } | { ref: string }[] | null;
  };

  let unreadTotal = 0;
  const threads: Thread[] = ((threadsRes.data ?? []) as unknown as ThreadRow[]).map((t) => {
    const mineRow = rows.find((r) => r.thread_id === t.id);
    const msgs = byThreadM.get(t.id) ?? [];
    const unread = unreadFor(msgs, userId, mineRow?.last_read_at ?? null);
    unreadTotal += unread;
    const last = msgs[msgs.length - 1] ?? null;
    const loadJoin = Array.isArray(t.loads) ? t.loads[0] : t.loads;
    return {
      id: t.id,
      subject: t.subject,
      load_id: t.load_id,
      load_ref: loadJoin?.ref ?? null,
      status: t.status,
      last_message_at: t.last_message_at,
      created_at: t.created_at,
      participants: (byThreadP.get(t.id) ?? []).map((p) => ({
        user_id: p.user_id,
        name: names.get(p.user_id) ?? null,
        role: p.role,
        last_read_at: p.last_read_at,
      })),
      last_message: last
        ? { ...last, sender_name: last.sender_user_id ? (names.get(last.sender_user_id) ?? null) : null }
        : null,
      unread,
    };
  });

  return { threads, unread_total: unreadTotal };
}

/** One thread with its full message list. Returns null when the caller is not a participant. */
export async function getThread(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  threadId: string,
): Promise<{ thread: Thread; messages: Message[] } | null> {
  const { threads } = await listThreads(admin, orgId, userId);
  const thread = threads.find((t) => t.id === threadId);
  if (!thread) return null;

  const { data } = await admin
    .from("messages")
    .select("id, thread_id, sender_user_id, body, created_at, edited_at, deleted_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as unknown as MessageRow[];
  const names = await nameMap(admin, orgId, [...new Set(rows.map((r) => r.sender_user_id).filter(Boolean) as string[])]);
  return {
    thread,
    messages: rows.map((m) => ({
      ...m,
      sender_name: m.sender_user_id ? (names.get(m.sender_user_id) ?? null) : null,
    })),
  };
}

export type MessageResult =
  | { ok: true; threadId: string }
  | { ok: false; status: 403 | 404; code: string; message: string };

/**
 * Start a thread. Idempotent on the client thread id, so a queued offline "start a conversation"
 * that drains twice does not create two threads.
 */
export async function createThread(
  admin: SupabaseClient,
  orgId: string,
  actorUserId: string,
  isDriver: boolean,
  input: CreateThreadRequest,
): Promise<MessageResult> {
  const { data: existing } = await admin
    .from("message_threads")
    .select("id")
    .eq("id", input.thread_id)
    .maybeSingle();
  if (existing) return { ok: true, threadId: input.thread_id };

  // The audience, resolved here and nowhere else.
  const office = await officeAudience(admin, orgId);
  let driverUserId: string | null = null;
  if (isDriver) {
    driverUserId = actorUserId;
  } else if (input.driver_id) {
    driverUserId = await loginForDriverId(admin, orgId, input.driver_id);
    if (!driverUserId) {
      return { ok: false, status: 404, code: "driver_no_login", message: "That driver has not activated their app account yet" };
    }
  }

  const audience = new Map<string, "driver" | "office">();
  for (const u of office) audience.set(u, "office");
  if (driverUserId) audience.set(driverUserId, "driver");
  audience.set(actorUserId, isDriver ? "driver" : "office");
  if (audience.size < 2) {
    return { ok: false, status: 404, code: "no_audience", message: "There is nobody to send this to yet" };
  }

  const { error: threadError } = await admin.from("message_threads").insert({
    id: input.thread_id,
    org_id: orgId,
    subject: input.subject ?? null,
    load_id: input.load_id ?? null,
    created_by: actorUserId,
  });
  if (threadError) throw new Error(threadError.message);

  await admin.from("thread_participants").insert(
    [...audience.entries()].map(([user_id, role]) => ({
      thread_id: input.thread_id,
      org_id: orgId,
      user_id,
      role,
      // The author has by definition read their own opening message.
      last_read_at: user_id === actorUserId ? new Date().toISOString() : null,
    })),
  );

  await sendMessage(admin, orgId, actorUserId, input.thread_id, {
    message_id: input.message_id,
    body: input.body,
  });
  return { ok: true, threadId: input.thread_id };
}

/** Post into an existing thread and tell everyone else (5N). Idempotent on the client message id. */
export async function sendMessage(
  admin: SupabaseClient,
  orgId: string,
  actorUserId: string,
  threadId: string,
  input: SendMessageRequest,
): Promise<MessageResult> {
  const { data: participant } = await admin
    .from("thread_participants")
    .select("user_id")
    .eq("thread_id", threadId)
    .eq("user_id", actorUserId)
    .maybeSingle();
  if (!participant) {
    return { ok: false, status: 403, code: "not_a_participant", message: "You are not part of that conversation" };
  }

  const { error } = await admin
    .from("messages")
    .insert({
      id: input.message_id,
      thread_id: threadId,
      org_id: orgId,
      sender_user_id: actorUserId,
      body: input.body,
      ...(input.occurred_at ? { created_at: input.occurred_at } : {}),
    })
    // A replayed outbox drain collides on the client UUID and no-ops rather than double-posting.
    .select("id")
    .maybeSingle();
  if (error && error.code !== "23505") throw new Error(error.message);
  if (error) return { ok: true, threadId }; // already delivered

  // Tell the others. A message nobody is told about is a message nobody reads.
  const { data: others } = await admin
    .from("thread_participants")
    .select("user_id")
    .eq("thread_id", threadId)
    .neq("user_id", actorUserId);
  const senderName = (await nameMap(admin, orgId, [actorUserId])).get(actorUserId) ?? "Dispatch";
  const preview = input.body.length > 120 ? `${input.body.slice(0, 119)}…` : input.body;

  for (const p of (others ?? []) as { user_id: string }[]) {
    await notify(admin, {
      orgId,
      userId: p.user_id,
      category: "message_received",
      title: senderName,
      body: preview,
      entityType: "thread",
      entityId: threadId,
      // Per message, not per thread — two messages are two facts worth knowing about.
      dedupeKey: `message_received:${input.message_id}`,
    });
  }

  return { ok: true, threadId };
}

/** Move this user's read boundary — the unread badge, and dispatch's "the driver has seen it". */
export async function markThreadRead(
  admin: SupabaseClient,
  threadId: string,
  userId: string,
): Promise<void> {
  await admin
    .from("thread_participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("thread_id", threadId)
    .eq("user_id", userId);
}
