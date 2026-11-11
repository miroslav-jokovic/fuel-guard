import { computed } from "vue";
import { canReachSurface, surfaceAllowed, SURFACES, type Surface } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { useModulesQuery } from "@/composables/useModules";

/**
 * The "Open in …" links under an answer (F21 R4a): the surfaces the API named for it, kept only when
 * THIS person can open them — the same two questions the sidebar and `useAssistantAccess` ask
 * (`canReachSurface`, then `surfaceAllowed`). A tool may answer from a route a page's own gate is
 * stricter than (Fuel costs is `manage("fuel")` and its route `view`, PLAN Q-AI12), so a link is
 * never assumed from the answer alone. An unknown key (an API newer than this web) is skipped.
 */
export function useAnswerPages() {
  const session = useSessionStore();
  const modules = useModulesQuery();
  return computed(() => (keys: readonly string[] | undefined): Surface[] =>
    (keys ?? []).flatMap((key) => {
      const s = SURFACES.find((x) => x.key === key);
      if (!s) return [];
      const open =
        canReachSurface(s, session.role, modules.data.value ?? null, session.sections) &&
        surfaceAllowed(s, session.role, session.sections, session.surfaces);
      return open ? [s] : [];
    }),
  );
}
