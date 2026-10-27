import type { SupabaseClient } from "@supabase/supabase-js";
import { chatBodyText, chatMemberSchema, chatMentionIds, type ChatConversation } from "@silvicom/shared";
import { conversationRow, rpc } from "./chat.js";
import { notify } from "./notify.js";

/**
 * Office chat's bell (OFFICE-CHAT-PLAN CH6b-2, D-CHAT23): a line that names you, or a reply to a channel
 * post you wrote or answered, becomes one bell item per conversation per unread stretch.
 *
 * WHO IS TOLD is not decided here. 0521's `chat_notify_targets` answers it in SQL — never the author,
 * never somebody who left, never a conversation muted `all`, and in one muted `mentions` only a mention —
 * and hands back the dedupe key `category:thread:read_seq`, so five mentions before you look fold into
 * one item and the first after you read is a new one. This file only words the item and passes each row
 * to `notify()`, which still applies the org's categories, the person's muted categories and quiet hours.
 * A second copy of the mute rule in JavaScript would be the copy that drifts (chat.ts, THE RULE).
 *
 * A bell is never worth failing the line that caused it: the message is already written when this runs,
 * so every failure here is logged and swallowed (the same stance as `notify()` itself).
 */

interface NotifyTarget {
  user_id: string;
  category: "chat_mention" | "chat_reply";
  read_seq: number;
  dedupe_key: string;
}

/** Q-CHAT18 (a): the sender, the conversation, and the first 80 characters of what was said. */
const PREVIEW_MAX = 80;

async function targetsOf(admin: SupabaseClient, orgId: string, messageId: string): Promise<NotifyTarget[]> {
  const res = await rpc<NotifyTarget[]>(admin, "chat_notify_targets", { p_org: orgId, p_message: messageId });
  if (!res.ok) throw new Error(res.message);
  return res.value ?? [];
}

/** Where it was said, as the bell's title words it: "# Loads", a group's name, or nothing for a direct line. */
function placeOf(c: ChatConversation): string | null {
  if (c.kind === "direct") return null;
  const name = c.subject?.trim();
  if (c.kind === "channel") return name ? `# ${name}` : "a channel";
  return name || "a group";
}

async function tell(
  admin: SupabaseClient, orgId: string, senderId: string, threadId: string, body: string, targets: NotifyTarget[],
): Promise<number> {
  if (targets.length === 0) return 0;
  // Both as the sender sees them: the sender is in the conversation, so both answer, and the members
  // name every token the line carries (a token must name a participant — CH013, Q-CHAT20).
  const [conversation, members] = await Promise.all([
    conversationRow(admin, orgId, senderId, threadId),
    rpc<unknown[]>(admin, "chat_members", { p_org: orgId, p_user: senderId, p_thread: threadId }),
  ]);
  if (!conversation || !members.ok) return 0; // the sender left between the line and now: nothing to word
  const names = new Map((members.value ?? []).map((r) => chatMemberSchema.parse(r)).map((m) => [m.user_id, m.name]));
  const sender = names.get(senderId)?.trim() || "Someone";
  const place = placeOf(conversation);
  const text = chatBodyText(body, (id) => names.get(id)).replace(/\s+/g, " ").trim();
  const preview = text.length <= PREVIEW_MAX ? text : `${text.slice(0, PREVIEW_MAX - 1)}…`;

  let told = 0;
  for (const t of targets) {
    const verb = t.category === "chat_mention" ? "mentioned you" : "replied";
    const id = await notify(admin, {
      orgId,
      userId: t.user_id,
      category: t.category,
      title: place ? `${sender} ${verb} in ${place}` : `${sender} ${verb}`,
      body: preview,
      // The conversation, not the line: the item stands for a stretch of lines (D-CHAT23), and the web
      // opens a channel and a conversation at different addresses (`?ch=` / `?c=`).
      entityType: conversation.kind === "channel" ? "chat_channel" : "chat_conversation",
      entityId: threadId,
      dedupeKey: t.dedupe_key,
    });
    if (id) told += 1;
  }
  return told;
}

/** After a new line, a post or a reply. A retried send the database recognised tells nobody again. */
export async function chatNotifySent(
  admin: SupabaseClient, orgId: string, senderId: string, threadId: string, messageId: string, body: string,
): Promise<number> {
  try {
    return await tell(admin, orgId, senderId, threadId, body, await targetsOf(admin, orgId, messageId));
  } catch (e) {
    console.error(`[chat-notify] send ${messageId}: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}

/** The line as it stood before an edit: where it is, and whom it named. */
export interface ChatLineBefore { thread_id: string; mentioned: string[] }

/**
 * Read BEFORE `chat_edit`, and only when the new words name somebody: an edit tells only the people it
 * newly names (D-CHAT22 judges an edit on the tokens it adds), so the bell needs what the line named
 * before. A plain table read, org-filtered here because the service role bypasses RLS; the edit itself
 * still decides whether the line is the caller's to change, so a line read here and then refused is
 * never used.
 */
export async function chatLineBeforeEdit(
  admin: SupabaseClient, orgId: string, messageId: string, newBody: string,
): Promise<ChatLineBefore | null> {
  if (chatMentionIds(newBody).length === 0) return null;
  try {
    const { data, error } = await admin
      .from("messages").select("thread_id, body").eq("id", messageId).eq("org_id", orgId).maybeSingle();
    if (error || !data) return null;
    const row = data as { thread_id: string; body: string | null };
    return { thread_id: row.thread_id, mentioned: chatMentionIds(row.body) };
  } catch {
    return null;
  }
}

/** After an edit: a mention item for each person the edit newly names, and nobody else. */
export async function chatNotifyEdited(
  admin: SupabaseClient, orgId: string, senderId: string, messageId: string, body: string, before: ChatLineBefore | null,
): Promise<number> {
  if (!before) return 0;
  const added = new Set(chatMentionIds(body).filter((id) => !before.mentioned.includes(id)));
  if (added.size === 0) return 0;
  try {
    // A person the line names is always a `chat_mention` row (0521 prefers it over a reply), so the
    // newly named are exactly the rows to keep.
    const targets = (await targetsOf(admin, orgId, messageId)).filter((t) => added.has(t.user_id));
    return await tell(admin, orgId, senderId, before.thread_id, body, targets);
  } catch (e) {
    console.error(`[chat-notify] edit ${messageId}: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}
