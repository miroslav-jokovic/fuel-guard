import { computed } from "vue";
import { canReachSurface, surfaceAllowed, SURFACES, type AssistantAnswerLink, type Surface } from "@silvicom/shared";

/** A page under an answer, and where its link goes: the page alone, or the page with the answer's filters. */
export type AnswerPage = Surface & { to: string | { path: string; query: Record<string, string> } };
import { useSessionStore } from "@/stores/session";
import { useModulesQuery } from "@/composables/useModules";

/**
 * The "Open in …" links under an answer (F21 R4a): the surfaces the API named for it, kept only when
 * THIS person can open them — the same two questions the sidebar and `useAssistantAccess` ask
 * (`canReachSurface`, then `surfaceAllowed`). A page's gate equals its tool's since Q-AI12 (Fuel costs
 * moved from `manage("fuel")` to `view`, 2026-11-11), but a per-user surface override or an unbought
 * module can still close a page the section matrix opens, so a link is never assumed from the answer
 * alone. An unknown key (an API newer than this web) is skipped.
 */
export function useAnswerPages() {
  const session = useSessionStore();
  const modules = useModulesQuery();
  /**
   * R4b: a page's link carries the answer's filters when its tool returned one (`links`), and is the
   * bare page otherwise (an older API, or a tool with no link yet). Two calls to one tool in an answer
   * give two links to one page; the LAST is kept, because the model's final call is the one its answer
   * reports (a follow-up call narrows or corrects the first).
   */
  return computed(() => (keys: readonly string[] | undefined, links?: readonly AssistantAnswerLink[]): AnswerPage[] =>
    (keys ?? []).flatMap((key) => {
      const s = SURFACES.find((x) => x.key === key);
      if (!s) return [];
      const open =
        canReachSurface(s, session.role, modules.data.value ?? null, session.sections) &&
        surfaceAllowed(s, session.role, session.sections, session.surfaces);
      if (!open) return [];
      const query = [...(links ?? [])].reverse().find((l) => l.surfaceKey === key)?.query;
      return [{ ...s, to: query ? { path: s.path, query } : s.path }];
    }),
  );
}
