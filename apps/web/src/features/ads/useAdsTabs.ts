import { computed } from "vue";
import { canReachSurface, surfaceAllowed, SURFACES } from "@silvicom/shared";
import { useModulesQuery } from "@/composables/useModules";
import { useSessionStore } from "@/stores/session";
import { ADS_SETTINGS_KEY, adsWorkspaceTabs } from "./adsWorkspace";

/**
 * The workspace tabs THIS person may open: the catalogue's tabs (`adsWorkspaceTabs`) through `canReachSurface` then
 * `surfaceAllowed`, the two checks every "Open in …" link passes, so a tab never opens onto a refusal. Settings is its
 * own grant (`admin.recruiting.ads`), and a real fleet has turned it on for recruiters while others have not.
 * One composable, so the tab strip and a page's "Open settings" link cannot disagree.
 */
export function useAdsTabs() {
  const session = useSessionStore();
  const modules = useModulesQuery();
  const tabs = computed(() => adsWorkspaceTabs(SURFACES)
    .filter((t) => canReachSurface(t.surface, session.role, modules.data.value ?? null, session.sections)
      && surfaceAllowed(t.surface, session.role, session.sections, session.surfaces)));
  const canOpenSettings = computed(() => tabs.value.some((t) => t.surface.key === ADS_SETTINGS_KEY));
  return { tabs, canOpenSettings };
}
