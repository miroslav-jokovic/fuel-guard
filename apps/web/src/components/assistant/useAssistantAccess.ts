import { computed } from "vue";
import { canReachSurface, surfaceAllowed, SURFACES } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { useModulesQuery } from "@/composables/useModules";

/**
 * May this person open the assistant? The `ask-ai` surface's own answer, asked the way the sidebar
 * asks it (`lib/nav.ts`): the role gate and the org's modules (`canReachSurface`), then the org's
 * and the person's screen grants (`surfaceAllowed`).
 *
 * ⚠ Derived, never restated. The floating launcher is a second door onto the same screen, so it has
 * to open for exactly the people the `/ask` link and `POST /api/ai/ask` (`requireSurface("ask-ai")`)
 * open for — today the admin, plus anyone an admin granted it (Q-SET15, Q-PR2). A launcher with its
 * own role list would drift from that the first time a grant changed.
 */
const ASK_AI = SURFACES.find((s) => s.key === "ask-ai")!;

export function useAssistantAccess() {
  const session = useSessionStore();
  const modules = useModulesQuery();
  return computed(
    () =>
      session.isAuthenticated &&
      canReachSurface(ASK_AI, session.role, modules.data.value ?? null, session.sections) &&
      surfaceAllowed(ASK_AI, session.role, session.sections, session.surfaces),
  );
}
