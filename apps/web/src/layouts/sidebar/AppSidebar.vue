<script setup lang="ts">
import { computed, toRef } from "vue";
import { RouterLink } from "vue-router";
import { AppIcon } from "@silvicom/ui";
import { MagnifyingGlassIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from "@silvicom/ui/icons";
import type { UserRole } from "@silvicom/shared";
import type { NavGroup } from "@/lib/nav";
import { currentItemKey } from "@/lib/sidebarShortcuts";
import { useSidebarSections } from "@/composables/useSidebarSections";
import { useSidebarShortcuts } from "@/composables/useSidebarShortcuts";
import AppLogo from "@/components/AppLogo.vue";
import AppWordmark from "@/components/AppWordmark.vue";
import SidebarFlyoutSection from "./SidebarFlyoutSection.vue";
import SidebarNavItem from "./SidebarNavItem.vue";
import SidebarNavSection from "./SidebarNavSection.vue";
import SidebarProfileMenu from "./SidebarProfileMenu.vue";

/**
 * The sidebar — ONE component for the phone drawer, the open desktop sidebar and the collapsed rail
 * (SIDEBAR-REDESIGN-PLAN.md D-SB6, which is DESIGN-SYSTEM-2026.md D-DS9's "the sidebar stops being
 * CSS" for the markup half).
 *
 * Until 2026-11-01 `AppShell.vue` drew the list three times, and the copies had already drifted: the
 * drawer's rows and the desktop's were the same markup typed twice, and every change this redesign
 * makes would have had to land three times or not at all. The shell now decides only WHERE the
 * sidebar is (a drawer, a fixed column, how wide); this file decides what is in it.
 *
 * Top to bottom, and why in this order:
 *   1. The mark, with the collapse control beside it (D-SB6) — it used to sit in the top bar, a
 *      control for the sidebar drawn on the other side of the page.
 *   2. "Search pages ⌘K" (D-SB1) — the fastest way anywhere, so it is first.
 *   3. Pinned, then Recent (D-SB2) — the few pages this person actually uses.
 *   4. Dashboard / Chat / Ask AI, then the sections, closed unless they hold this page (D-SB3).
 *   5. A fixed footer that never scrolls: Settings and Users (the `footer` group, D-SB4), then the
 *      account.
 */
const props = defineProps<{
  groups: NavGroup[];
  /** The desktop rail: icons only, sections open as flyouts. Never true in the drawer. */
  collapsed?: boolean;
  /** The phone drawer: no collapse control, and the nav id belongs to the desktop copy. */
  drawer?: boolean;
  isCurrent: (to: string) => boolean;
  touch?: boolean;
  email: string | null;
  name?: string | null;
  role: UserRole | null;
}>();

const emit = defineEmits<{ toggleCollapse: []; openSearch: []; signOut: []; navigate: [] }>();

const groupsRef = toRef(props, "groups");
const listGroups = computed(() => props.groups.filter((g) => !g.footer));
const topItems = computed(() => listGroups.value.filter((g) => !g.label).flatMap((g) => g.items));
const sections = computed(() => listGroups.value.filter((g) => g.label));
const footerGroups = computed(() => props.groups.filter((g) => g.footer));
const footerItems = computed(() => footerGroups.value.flatMap((g) => g.items));

const currentSection = () => sections.value.find((g) => g.items.some((i) => props.isCurrent(i.to)))?.key ?? null;
const { isOpen, toggle } = useSidebarSections(currentSection);

const currentKey = () => currentItemKey(props.groups, props.isCurrent);
const { pinned, recent, pinFull, isPinned, togglePin } = useSidebarShortcuts(groupsRef, currentKey);

/** The shortcut as this keyboard writes it. `navigator.platform` is deprecated but still the honest answer. */
const shortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";

const railLinkClass = (to: string) => [
  props.isCurrent(to) ? "sidebar-nav-active" : "sidebar-nav-inactive",
  "sidebar-nav-item flex min-h-9 items-center justify-center rounded-control p-2",
];
</script>

<template>
  <div class="sidebar-glass relative flex grow overflow-hidden border-r">
    <div class="sidebar-glass-material" aria-hidden="true" />
    <div class="sidebar-glass-content flex min-h-0 grow flex-col overflow-x-hidden">
      <!--
        h-16 is shared with the main sticky header in AppShell on purpose: the two form one horizontal
        rule across the top of the app. Move both or neither. The wordmark stays h-10 (a two-line
        lockup reads properly there — measured 2026-08-29); since D-SB6 it sits left with the
        collapse control on the right, instead of centred with the control in the top bar.
      -->
      <div
        class="sidebar-divider flex h-16 shrink-0 items-center border-b"
        :class="collapsed ? 'justify-center px-2' : 'justify-between gap-2 pl-3 pr-2'"
      >
        <button
          v-if="collapsed"
          type="button"
          class="sidebar-shell-toggle group flex size-10 items-center justify-center rounded-control"
          aria-label="Expand sidebar"
          title="Expand sidebar"
          :aria-expanded="false"
          aria-controls="desktop-sidebar-navigation"
          @click="emit('toggleCollapse')"
        >
          <!-- The mark until you reach for it, then what it does: the rail has no room for both. -->
          <AppLogo class="size-7 shrink-0 group-hover:hidden group-focus-visible:hidden" />
          <AppIcon :icon="PanelLeftOpenIcon" class="hidden size-5 text-ink-secondary group-hover:block group-focus-visible:block" aria-hidden="true" />
        </button>
        <template v-else>
          <AppWordmark class="h-10" />
          <button
            v-if="!drawer"
            type="button"
            class="sidebar-shell-toggle flex size-9 shrink-0 items-center justify-center rounded-control text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            :aria-expanded="true"
            aria-controls="desktop-sidebar-navigation"
            @click="emit('toggleCollapse')"
          >
            <AppIcon :icon="PanelLeftCloseIcon" class="size-5" aria-hidden="true" />
          </button>
        </template>
      </div>

      <div class="shrink-0 pt-3" :class="collapsed ? 'px-2' : 'px-3'">
        <button
          v-if="collapsed"
          type="button"
          class="sidebar-nav-item sidebar-nav-inactive flex min-h-9 w-full items-center justify-center rounded-control p-2"
          :aria-label="`Search pages (${shortcut})`"
          :title="`Search pages (${shortcut})`"
          @click="emit('openSearch')"
        >
          <AppIcon :icon="MagnifyingGlassIcon" class="size-5" aria-hidden="true" />
        </button>
        <button
          v-else
          type="button"
          class="sidebar-search flex w-full items-center gap-2 rounded-control px-2.5 text-left text-sm"
          :class="touch ? 'min-h-11' : 'min-h-9'"
          @click="emit('openSearch')"
        >
          <AppIcon :icon="MagnifyingGlassIcon" class="size-4 shrink-0" aria-hidden="true" />
          <span class="flex-1">Search pages</span>
          <kbd v-if="!drawer" class="sidebar-kbd rounded px-1.5 py-0.5 font-sans text-2xs font-medium">{{ shortcut }}</kbd>
        </button>
      </div>

      <nav
        :id="drawer ? undefined : 'desktop-sidebar-navigation'"
        aria-label="Primary navigation"
        class="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        :class="collapsed ? 'px-2' : 'px-3'"
      >
        <!-- ── The rail: icons, pins first, sections as flyouts ───────────────────────── -->
        <ul v-if="collapsed" class="flex flex-col gap-y-1">
          <template v-if="pinned.length">
            <li v-for="item in pinned" :key="`pin-${item.key}`">
              <RouterLink :to="item.to" :class="railLinkClass(item.to)" :title="`${item.name} (pinned)`" :aria-label="`${item.name} (pinned)`">
                <AppIcon :icon="item.icon" class="size-5 shrink-0" aria-hidden="true" />
              </RouterLink>
            </li>
            <li class="sidebar-divider mx-2 my-1 border-t" aria-hidden="true" />
          </template>
          <li v-for="item in topItems" :key="item.key">
            <RouterLink
              :to="item.to"
              :class="railLinkClass(item.to)"
              :title="item.name"
              :aria-label="item.name"
              :aria-current="isCurrent(item.to) ? 'page' : undefined"
            >
              <AppIcon :icon="item.icon" class="size-5 shrink-0" aria-hidden="true" />
            </RouterLink>
          </li>
          <li v-for="group in sections" :key="group.key">
            <SidebarFlyoutSection :group="group" :is-current="isCurrent" />
          </li>
        </ul>

        <!-- ── The open sidebar ───────────────────────────────────────────────────────── -->
        <template v-else>
          <template v-if="pinned.length">
            <p class="sidebar-section-label px-2.5 pb-1 pt-1 text-2xs font-semibold uppercase tracking-wide">Pinned</p>
            <ul class="flex flex-col gap-y-0.5" aria-label="Pinned pages">
              <SidebarNavItem
                v-for="item in pinned"
                :key="`pin-${item.key}`"
                :item="item"
                :current="isCurrent(item.to)"
                :touch="touch"
                :pinned="true"
                :pin-full="pinFull"
                @toggle-pin="togglePin(item.key)"
                @navigate="emit('navigate')"
              />
            </ul>
          </template>
          <template v-if="recent.length">
            <p class="sidebar-section-label px-2.5 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wide">Recent</p>
            <ul class="flex flex-col gap-y-0.5" aria-label="Recent pages">
              <SidebarNavItem
                v-for="item in recent"
                :key="`recent-${item.key}`"
                :item="item"
                :current="false"
                :touch="touch"
                :pinned="false"
                :pin-full="pinFull"
                @toggle-pin="togglePin(item.key)"
                @navigate="emit('navigate')"
              />
            </ul>
          </template>
          <div v-if="pinned.length || recent.length" class="sidebar-divider mx-2.5 my-2 border-t" aria-hidden="true" />

          <ul class="flex flex-col gap-y-0.5">
            <SidebarNavItem
              v-for="item in topItems"
              :key="item.key"
              :item="item"
              :current="isCurrent(item.to)"
              :touch="touch"
              :pinned="isPinned(item.key)"
              :pin-full="pinFull"
              @toggle-pin="togglePin(item.key)"
              @navigate="emit('navigate')"
            />
            <SidebarNavSection
              v-for="group in sections"
              :key="group.key"
              :group="group"
              :open="isOpen(group.key)"
              :is-current="isCurrent"
              :touch="touch"
              :is-pinned="isPinned"
              :pin-full="pinFull"
              @toggle="toggle(group.key)"
              @toggle-pin="togglePin"
              @navigate="emit('navigate')"
            />
          </ul>
        </template>
      </nav>

      <!-- The footer never scrolls: Settings and the account are always one click away (D-SB4). -->
      <div class="sidebar-divider shrink-0 border-t py-2" :class="collapsed ? 'px-2' : 'px-2.5'">
        <nav v-if="footerItems.length" aria-label="Administration" class="pb-1.5">
          <ul v-if="collapsed" class="flex flex-col gap-y-1">
            <li v-for="item in footerItems" :key="item.key">
              <RouterLink
                :to="item.to"
                :class="railLinkClass(item.to)"
                :title="item.name"
                :aria-label="item.name"
                :aria-current="isCurrent(item.to) ? 'page' : undefined"
              >
                <AppIcon :icon="item.icon" class="size-5 shrink-0" aria-hidden="true" />
              </RouterLink>
            </li>
          </ul>
          <ul v-else class="flex flex-col gap-y-0.5">
            <SidebarNavItem
              v-for="item in footerItems"
              :key="item.key"
              :item="item"
              :current="isCurrent(item.to)"
              :touch="touch"
              :pinned="isPinned(item.key)"
              :pin-full="pinFull"
              @toggle-pin="togglePin(item.key)"
              @navigate="emit('navigate')"
            />
          </ul>
        </nav>
        <SidebarProfileMenu :email="email" :name="name" :role="role" :collapsed="collapsed" @sign-out="emit('signOut')" />
      </div>
    </div>
  </div>
</template>
