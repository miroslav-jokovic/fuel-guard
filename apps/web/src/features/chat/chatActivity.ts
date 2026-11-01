import { CHAT_REACTION_EMOJI, type ChatActivityItem } from "@silvicom/shared";

/**
 * What an Activity line says and where it leads (D-CHAT25). A pure pair of answers, so the stage only
 * draws them and a test reads them without mounting anything.
 */

/**
 * "Ben mentioned you in # Loads", "Ben replied in # Loads", "Ben mentioned you" (a direct line), and
 * (CH6c-2) "Ben reacted 👍 in # Loads" — a reaction's who is the reactor, not the line's sender, who is you.
 */
export function activityLine(item: ChatActivityItem, titleOf: (threadId: string) => string | null): string {
  const reacted = item.reason === "reaction";
  const who = (reacted ? item.reactor_name : item.sender_name)?.trim() || "Someone";
  const verb = reacted
    ? `reacted${item.reaction ? ` ${CHAT_REACTION_EMOJI[item.reaction]}` : ""}`
    : item.reason === "mention" ? "mentioned you" : "replied";
  const place = item.kind === "direct"
    ? null
    : item.kind === "channel"
      ? `# ${item.subject?.trim() || "a channel"}`
      // A group with no name is called by its people, as the rail calls it; the rail's title is the one to reuse.
      : item.subject?.trim() || titleOf(item.thread_id) || "a group";
  return place ? `${who} ${verb} in ${place}` : `${who} ${verb}`;
}

/**
 * Where it opens: a direct or group line in its conversation (`?c=`); a channel post in its channel
 * (`?ch=`); a reply — or a mention inside one — in its post's thread beside the channel (`?ch=&post=`).
 * A saved line (CH6c-2) opens by the same rule, so it takes only the three facts the rule reads.
 */
export function activityTarget(item: Pick<ChatActivityItem, "kind" | "thread_id" | "parent_id">): Record<string, string> {
  if (item.kind !== "channel") return { c: item.thread_id };
  return item.parent_id ? { ch: item.thread_id, post: item.parent_id } : { ch: item.thread_id };
}
