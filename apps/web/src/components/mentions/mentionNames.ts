import { computed, inject, provide, type InjectionKey, type Ref } from "vue";

/**
 * Who a `<@id>` token is (D-CHAT22), for every row, preview and composer under one provider. The page
 * provides it once from the org's people list, because a mention may name anybody in the office. On
 * /chat that list is `/api/chat/people` (the people picker's own query, cached five minutes) and a
 * conversation's members are a subset of it; a unit's notes (UNIT-NOTES-PLAN D-UN8) name any office
 * member the same way. A token whose person the list does not know — someone who has since left the
 * office — reads "@someone" (`chatBodyText`), never the raw id.
 *
 * Promoted out of `features/chat/chatNames.ts` at UN4 (UNIT-NOTES-PLAN M10), so notes and chat read
 * names through one provider rather than two copies; `lint:boundaries` forbids a feature reaching into
 * a sibling, and the rule is to promote the shared thing.
 */
export type MentionNameOf = (userId: string) => string | null;

/** Anyone a mention can name: chat's `ChatDirectoryEntry` carries these two fields. No name reads "@someone". */
export interface MentionPerson {
  user_id: string;
  name: string | null;
}

const KEY: InjectionKey<MentionNameOf> = Symbol("mention-names");

export function provideMentionNames(people: Ref<readonly MentionPerson[] | undefined>): MentionNameOf {
  const byId = computed(() => new Map((people.value ?? []).map((p) => [p.user_id.toLowerCase(), p.name])));
  // Read inside a render, so a list that arrives after the first paint re-draws the names.
  const nameOf: MentionNameOf = (id) => byId.value.get(id.toLowerCase()) ?? null;
  provide(KEY, nameOf);
  return nameOf;
}

/** Outside a provider (a component under test) nobody is named: every token reads "@someone". */
export function useMentionNames(): MentionNameOf {
  return inject(KEY, () => null);
}

/**
 * Whom the composer's `@` may name, provided by the surface that knows. In chat (Q-CHAT20 (a)): the
 * conversation's members; in a channel, also the team's other members, each offered as "Add to # Loads"
 * because a token must name a participant (CH013) and any channel member may add a team member. Without
 * a provider the composer offers nobody, and an `@` is just a character.
 */
export interface MentionCandidate {
  user_id: string;
  name: string;
  /** Already able to read the line; false = picking them first adds them (`add`). */
  member: boolean;
  /**
   * What a pick sends, when it is not the person token `<@user_id>`: a unit note naming a truck, trailer
   * or driver sends `<#kind:id>` (UNIT-NOTES-PLAN D-UN17), and its `user_id` is then only the list's key.
   */
  token?: string;
  /** A word beside the name in the list — "Truck", "Trailer", "Driver" — so `@848` the truck and `@848` the trailer read apart. */
  detail?: string;
}

export interface MentionContext {
  candidates: Ref<readonly MentionCandidate[]>;
  /** "Add to # Loads" — the words on a candidate who is not in it yet. */
  addLabel: Ref<string | null>;
  /** Add a person before naming them; false when it was refused (the surface says why). */
  add(userId: string): Promise<boolean>;
}

const MENTIONS: InjectionKey<MentionContext> = Symbol("mention-candidates");

export function provideMentions(ctx: MentionContext): void {
  provide(MENTIONS, ctx);
}

export function useMentions(): MentionContext | null {
  return inject(MENTIONS, null);
}
