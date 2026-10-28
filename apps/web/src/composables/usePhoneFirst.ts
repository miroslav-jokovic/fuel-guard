import { computed, type Ref } from "vue";
import { useRoute } from "vue-router";
import { useMediaQuery } from "@vueuse/core";
import { provideTouchTargets } from "@silvicom/ui";
import type { NavGroup } from "@/lib/nav";
import { isPhoneFirst, phoneTabFor, phoneTabs } from "@/lib/phoneFirst";

/**
 * What the shell does differently on a phone-first section's page (DESIGN-SYSTEM-CONTRACT.md §9).
 *
 * Two answers, both from `lib/phoneFirst.ts`. The touch floor (rule 1) holds while the page is
 * touched — a coarse pointer, which is a tablet at any width, or a window below `md` — so the office
 * at a desk with a mouse keeps its density on the very same page. The tab row (rule 7) is the
 * section's sidebar rows below `md`. Called from `AppShell`'s setup so `provideTouchTargets` reaches
 * every page it renders; `touch` is returned for the shell's own Back, which no provide reaches.
 */
export function usePhoneFirst(navGroups: Ref<NavGroup[]>) {
  const route = useRoute();
  /** The DECLARED path (`/shop/units/:kind/:id`), which is what the catalogue is keyed on. */
  const declared = computed(() => route.matched[0]?.path ?? route.path);
  const coarse = useMediaQuery("(pointer: coarse)");
  const narrow = useMediaQuery("(max-width: 767.98px)");
  const touch = computed(() => isPhoneFirst(declared.value) && (coarse.value || narrow.value));
  provideTouchTargets(touch);
  return {
    touch,
    tabs: computed(() => phoneTabs(declared.value, navGroups.value)),
    currentTab: computed(() => phoneTabFor(declared.value)),
  };
}
