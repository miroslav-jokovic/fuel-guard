import { computed, ref, type Ref } from "vue";
import {
  UNIT_NOTE_KIND_LABELS,
  chatMentionToken,
  unitNoteBodyParts,
  unitNoteUnitToken,
  unitNoteUnitText,
  type UnitNoteUnitRef,
} from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { useMentionTypeahead } from "@/components/mentions/useMentionTypeahead";
import { mentionLabel } from "@/components/mentions/mentionDraft";
import type { MentionCandidate } from "@/components/mentions/mentionNames";
import { useUnitNotePeople, useUnitNoteUnits } from "./useUnitNotes";

/**
 * The `@` list of a note's text box — the composer's and, since v3, the inline editor's (UNIT-NOTES-PLAN
 * §9) — on chat's own typeahead (`useMentionTypeahead`, D-CHAT22), so the keys, the list and the
 * label-to-token rule are one behaviour everywhere.
 *
 * Two kinds of name (D-UN8, D-UN17):
 * - **people** — the carrier's office members (`/api/notes/people`, exactly the set 0592's guard accepts,
 *   UN015), the writer left out (naming yourself rings nobody);
 * - **units** — trucks, trailers and drivers whose number or name starts with what follows the `@`
 *   (`/api/notes/units`), each picked as its `<#kind:id>` token. The field reads `@848`; what is sent is
 *   the token, so the chip lands on the right row whatever the truck is later renumbered to.
 *
 * A unit's list key is `kind:id`, never a person's id, so the list cannot confuse the two.
 */
export function useNoteTypeahead(field: Ref<{ $el: HTMLTextAreaElement } | null>, draft: Ref<string>, idPrefix: string) {
  const session = useSessionStore();
  const people = useUnitNotePeople(ref(true));
  const query = ref<string | null>(null);
  const units = useUnitNoteUnits(query);

  const typeahead = useMentionTypeahead({
    field,
    draft,
    idPrefix,
    mentions: {
      candidates: computed<MentionCandidate[]>(() => [
        ...(people.data.value ?? [])
          .filter((p) => p.id.toLowerCase() !== (session.userId ?? "").toLowerCase())
          .map((p) => ({ user_id: p.id, name: p.name, member: true })),
        ...(units.data.value ?? []).filter((u) => !!u.label).map(unitCandidate),
      ]),
      addLabel: computed(() => null),
      add: async () => true,
    },
  });
  // The server is asked for what is typed after the `@`; the people list is local and filters itself.
  const readCaret = () => {
    typeahead.readCaret();
    query.value = typeahead.query.value?.trim() || null;
  };

  /** Load a saved body into the box (an edit): people and units back to `@Name` / `@848`, each remembered. */
  function loadBody(body: string, unitsOfNote: readonly UnitNoteUnitRef[]) {
    const nameOf = (id: string) => (people.data.value ?? []).find((p) => p.id.toLowerCase() === id.toLowerCase())?.name ?? null;
    const labelOf = (kind: string, id: string) => unitsOfNote.find((u) => u.kind === kind && u.id === id)?.label ?? null;
    const picks = new Map<string, string>();
    const text = unitNoteBodyParts(body)
      .map((p) => {
        if ("text" in p) return p.text;
        if ("mention" in p) {
          const name = nameOf(p.mention)?.trim();
          if (!name) return chatMentionToken(p.mention);
          picks.set(mentionLabel(name), p.mention);
          return mentionLabel(name);
        }
        const label = labelOf(p.unit.kind, p.unit.id);
        const token = unitNoteUnitToken(p.unit.kind, p.unit.id);
        // A unit the carrier no longer has keeps its token, so saving the edit keeps the mention.
        if (!label) return token;
        picks.set(unitNoteUnitText(p.unit, label), token);
        return unitNoteUnitText(p.unit, label);
      })
      .join("");
    typeahead.load(text, picks);
  }

  return { ...typeahead, readCaret, loadBody };
}

function unitCandidate(u: UnitNoteUnitRef): MentionCandidate {
  return { user_id: `${u.kind}:${u.id}`, name: u.label!, member: true, token: unitNoteUnitToken(u.kind, u.id), detail: UNIT_NOTE_KIND_LABELS[u.kind] };
}
