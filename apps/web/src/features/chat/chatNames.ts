import { computed, inject, provide, type InjectionKey, type Ref } from "vue";
import type { ChatDirectoryEntry } from "@silvicom/shared";

/**
 * Who a `<@id>` token is (D-CHAT22), for every row, preview and composer on /chat. The page provides it
 * once from the org's people list (`/api/chat/people`, the people picker's own query, cached five
 * minutes), because a mention may name anybody in the office and a conversation's members are a subset
 * of that list. A token whose person the list does not know — someone who has since left the office —
 * reads "@someone" (`chatBodyText`), never the raw id.
 */
export type ChatNameOf = (userId: string) => string | null;

const KEY: InjectionKey<ChatNameOf> = Symbol("chat-names");

export function provideChatNames(people: Ref<readonly ChatDirectoryEntry[] | undefined>): ChatNameOf {
  const byId = computed(() => new Map((people.value ?? []).map((p) => [p.user_id.toLowerCase(), p.name])));
  // Read inside a render, so a list that arrives after the first paint re-draws the names.
  const nameOf: ChatNameOf = (id) => byId.value.get(id.toLowerCase()) ?? null;
  provide(KEY, nameOf);
  return nameOf;
}

/** Outside the page (a component under test) nobody is named: every token reads "@someone". */
export function useChatNames(): ChatNameOf {
  return inject(KEY, () => null);
}

/**
 * Whom the composer's `@` may name in the open conversation, provided by the stage that knows (Q-CHAT20
 * (a)): the conversation's members; in a channel, also the team's other members, each offered as "Add
 * to # Loads" because a token must name a participant (CH013) and any channel member may add a team
 * member. Without a provider the composer offers nobody, and an `@` is just a character.
 */
export interface MentionCandidate {
  user_id: string;
  name: string;
  /** In the conversation now; false = picking them first adds them (`add`). */
  member: boolean;
}

export interface ChatMentionContext {
  candidates: Ref<readonly MentionCandidate[]>;
  /** "Add to # Loads" — the words on a candidate who is not in it yet. */
  addLabel: Ref<string | null>;
  /** Add a person before naming them; false when it was refused (the stage says why). */
  add(userId: string): Promise<boolean>;
}

const MENTIONS: InjectionKey<ChatMentionContext> = Symbol("chat-mentions");

export function provideChatMentions(ctx: ChatMentionContext): void {
  provide(MENTIONS, ctx);
}

export function useChatMentions(): ChatMentionContext | null {
  return inject(MENTIONS, null);
}
