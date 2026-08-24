<script setup lang="ts">
import { computed, ref } from "vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { AppButton } from "@fuelguard/ui";
import { FuelCardIcon, TruckIcon, UserGroupIcon, ShieldCheckIcon } from "@fuelguard/ui/icons";
import SidebarNavSection from "@/layouts/SidebarNavSection.vue";
import { useSidebarSections } from "@/composables/useSidebarSections";
import type { NavGroup } from "@/lib/nav";
import { BADGE_BASE, toneClass } from "@/lib/badges";

type ActionMode = "graphite" | "gold";
type SidebarMode = "dark" | "light";

const actionMode = ref<ActionMode>("graphite");
const sidebarMode = ref<SidebarMode>("light");
const actionDescription = computed(() =>
  actionMode.value === "graphite"
    ? "Gold is identity; graphite is the primary action."
    : "Gold is both identity and the primary action.",
);

/**
 * Shipped primitives, rendered with the REAL components and the REAL tokens — deliberately not the
 * `--prototype-*` vocabulary the A/B lab above uses. This section exists because /__design-system
 * is the only route that renders production components without a login, which makes it the only
 * place a layout change can be checked in a browser (D-DS13). Keep the columns representative of a
 * real page: text, quantities, a sortable quantity and a control column.
 */
const shippedColumns: DataTableColumn[] = [
  { key: "unit", label: "Unit", width: "sm" },
  { key: "driver", label: "Driver", width: "lg" },
  { key: "gallons", label: "Gallons", numeric: true, sortable: true, width: "md" },
  { key: "amount", label: "Amount", numeric: true, width: "md" },
  { key: "mpg", label: "MPG", numeric: true, width: "xs" },
  { key: "status", label: "Status", width: "sm" },
];

/** Every tone the badge vocabulary defines, so a re-theme can be read rather than inferred. */
const shippedTones = ["danger", "caution", "warning", "success", "info", "brand", "neutral"] as const;

/**
 * The sidebar's accordion, on the one route that renders without a login.
 *
 * `AppShell` itself cannot come here — it needs the router, the session store and three live
 * queries — but `SidebarNavSection` is the piece the change is actually in, and it takes plain
 * props. This is the difference between shipping the sidebar verified and shipping it blind, which
 * is the one thing this work has avoided throughout.
 */
/** Every lab section is labelled, so narrow the nullable label away rather than assert past it. */
const labNavGroups: (NavGroup & { label: string })[] = [
  { label: "Fuel", items: [
    { show: true, name: "Fuel log", to: "/lab-fuel-log", icon: FuelCardIcon },
    { show: true, name: "Transactions", to: "/lab-transactions", icon: FuelCardIcon, badge: 24 },
  ]},
  { label: "Safety", items: [
    { show: true, name: "Driver files", to: "/lab-driver-files", icon: ShieldCheckIcon },
    { show: true, name: "Hazmat", to: "/lab-hazmat", icon: ShieldCheckIcon, badge: 7 },
  ]},
  { label: "Fleet", items: [
    { show: true, name: "Vehicles", to: "/lab-vehicles", icon: TruckIcon },
    { show: true, name: "Drivers", to: "/lab-drivers", icon: UserGroupIcon },
  ]},
];
/** The lab pretends you are standing on Fuel log, so the always-open rule is visible too. */
const labCurrent = "/lab-fuel-log";
const { isOpen: labSectionOpen, toggle: labToggleSection } = useSidebarSections(() => "Fuel");
const labIsCurrent = (to: string) => to === labCurrent;
const labNavLinkClass = (to: string) => [
  labIsCurrent(to) ? "sidebar-nav-active" : "sidebar-nav-inactive",
  "sidebar-nav-item group flex min-h-10 items-center gap-x-2.5 rounded-control px-2.5 py-2 text-sm font-medium leading-5",
];

const shippedRows = [
  { unit: "Unit 204", driver: "Maya Chen", gallons: "118.4", amount: "$412.86", mpg: "7.4", status: "Clear" },
  { unit: "Unit 118", driver: "Darnell Ross", gallons: "96.2", amount: "$338.71", mpg: "6.1", status: "Review" },
  { unit: "Unit 337", driver: "Priya Nandi", gallons: "141.9", amount: "$497.02", mpg: "7.9", status: "Clear" },
  { unit: "Unit 052", driver: "Tom Bergeron", gallons: "88.0", amount: "$310.44", mpg: "5.2", status: "Alert" },
];

const metrics = [
  { label: "Fuel spend", value: "$48,720", change: "2.8% below plan" },
  { label: "Active alerts", value: "7", change: "2 require action", attention: true },
  { label: "Idle cost", value: "$1,284", change: "$196 avoidable" },
  { label: "Fleet MPG", value: "7.4", change: "+0.3 this period" },
];

const rows = [
  {
    vehicle: "Unit 204",
    driver: "Maya Chen",
    station: "Pilot No. 118",
    amount: "$642.18",
    status: "Verified",
  },
  {
    vehicle: "Unit 318",
    driver: "Andre Silva",
    station: "Love's No. 728",
    amount: "$511.44",
    status: "Review",
  },
  {
    vehicle: "Unit 112",
    driver: "Nora Patel",
    station: "TA Dallas",
    amount: "$476.09",
    status: "Verified",
  },
  {
    vehicle: "Unit 425",
    driver: "Eli Brooks",
    station: "Flying J No. 614",
    amount: "$704.31",
    status: "Alert",
  },
];
</script>

<template>
  <div class="lab-page">
    <header class="lab-controls" aria-label="Prototype controls">
      <div>
        <p class="lab-eyebrow">Development-only prototype</p>
        <h1>FuelGuard visual direction</h1>
        <p>{{ actionDescription }}</p>
      </div>

      <div class="lab-control-groups">
        <fieldset>
          <legend>Primary action</legend>
          <div class="lab-segmented">
            <button :aria-pressed="actionMode === 'graphite'" @click="actionMode = 'graphite'">
              Graphite
            </button>
            <button :aria-pressed="actionMode === 'gold'" @click="actionMode = 'gold'">Gold</button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Sidebar</legend>
          <div class="lab-segmented">
            <button :aria-pressed="sidebarMode === 'light'" @click="sidebarMode = 'light'">
              Light
            </button>
            <button :aria-pressed="sidebarMode === 'dark'" @click="sidebarMode = 'dark'">
              Graphite
            </button>
          </div>
        </fieldset>
      </div>
    </header>

    <div class="prototype" :data-action="actionMode" :data-sidebar="sidebarMode">
      <aside class="prototype-sidebar">
        <div class="prototype-brand">
          <span class="prototype-brand-mark">F</span>
          <span>FuelGuard</span>
        </div>
        <nav aria-label="Prototype navigation">
          <p>Workspace</p>
          <a href="#overview" class="is-active"><span>Overview</span><span>4</span></a>
          <a href="#transactions"><span>Transactions</span></a>
          <a href="#drivers"><span>Drivers</span></a>
          <p>Operations</p>
          <a href="#alerts"><span>Alerts</span><span>7</span></a>
          <a href="#compliance"><span>Compliance</span></a>
          <a href="#settings"><span>Settings</span></a>
        </nav>
        <div class="prototype-account">
          <span class="prototype-avatar">MJ</span>
          <span><strong>Miroslav</strong><small>Administrator</small></span>
        </div>
      </aside>

      <main class="prototype-main">
        <header class="prototype-topbar">
          <span>Dashboard</span>
          <div>
            <button class="prototype-icon-button" aria-label="Open notifications">3</button>
          </div>
        </header>

        <div class="prototype-content">
          <section id="overview" class="prototype-page-header">
            <div>
              <p class="lab-eyebrow">Tuesday, August 11</p>
              <h2>Fleet overview</h2>
              <p>Monitor fuel performance, exceptions, and data confidence.</p>
            </div>
            <div class="prototype-actions">
              <button class="prototype-secondary">Export</button>
              <button class="prototype-primary">Review alerts</button>
            </div>
          </section>

          <section class="prototype-metrics" aria-label="Priority metrics">
            <article
              v-for="metric in metrics"
              :key="metric.label"
              :class="{ attention: metric.attention }"
            >
              <div class="prototype-metric-heading">
                <span>{{ metric.label }}</span>
                <i aria-hidden="true" />
              </div>
              <strong>{{ metric.value }}</strong>
              <small>{{ metric.change }}</small>
            </article>
          </section>

          <section id="transactions" class="prototype-workspace">
            <div class="prototype-workspace-toolbar">
              <div>
                <h3>Recent transactions</h3>
                <p>1,204 transactions · updated 4 minutes ago</p>
              </div>
              <div class="prototype-filters">
                <label>
                  <span>Search transactions</span>
                  <input type="search" placeholder="Vehicle, driver, station…" />
                </label>
                <label>
                  <span>Status</span>
                  <select>
                    <option>All statuses</option>
                    <option>Verified</option>
                    <option>Review</option>
                    <option>Alert</option>
                  </select>
                </label>
                <button class="prototype-secondary">More filters</button>
              </div>
            </div>
            <div class="prototype-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th>Driver</th>
                    <th>Station</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in rows" :key="row.vehicle">
                    <td>
                      <strong>{{ row.vehicle }}</strong>
                    </td>
                    <td>{{ row.driver }}</td>
                    <td>{{ row.station }}</td>
                    <td class="numeric">{{ row.amount }}</td>
                    <td>
                      <span class="prototype-status" :data-status="row.status.toLowerCase()">{{
                        row.status
                      }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="settings" class="prototype-settings">
            <div>
              <h3>Driver performance</h3>
              <p>Example of the unified field and settings-section treatment.</p>
            </div>
            <form @submit.prevent>
              <label>
                <span>Normalization method</span>
                <select>
                  <option>Per 100 miles</option>
                  <option>Per driving hour</option>
                </select>
                <small>Used when comparing drivers with different workloads.</small>
              </label>
              <label>
                <span>Week starts on</span>
                <select>
                  <option>Monday</option>
                  <option>Sunday</option>
                </select>
              </label>
              <label>
                <span>Review period</span>
                <input type="text" value="Last 30 days" />
              </label>
              <div class="prototype-form-actions">
                <button class="prototype-secondary" type="button">Cancel</button>
                <button class="prototype-primary" type="submit">Save settings</button>
              </div>
            </form>
          </section>
        </div>
      </main>
    </div>

    <section class="lab-shipped">
      <h2>Shipped primitives</h2>
      <p>
        The real <code>DataTable</code> with the real design tokens — not the prototype vocabulary
        above. Words left, quantities right, headers following their column (D-DS1).
      </p>
      <DataTable :columns="shippedColumns" :rows="shippedRows" row-key="unit">
        <template #cell-status="{ value }">
          <span :class="[BADGE_BASE, toneClass(String(value) === 'Alert' ? 'danger' : String(value) === 'Review' ? 'warning' : 'success')]">
            {{ value }}
          </span>
        </template>
      </DataTable>

      <h3>Sidebar sections</h3>
      <p class="lab-shipped-note">
        Collapsible sections, with the one holding the current page pinned open. A collapsed section
        keeps reporting its badge total, because otherwise closing it hides the fact that something
        inside needs attention.
      </p>
      <div class="lab-sidebar">
        <nav aria-label="Lab navigation">
          <ul class="flex flex-col gap-y-0.5">
            <SidebarNavSection
              v-for="group in labNavGroups"
              :key="group.label"
              :group="group"
              :open="labSectionOpen(group.label)"
              :is-current="labIsCurrent"
              :nav-link-class="labNavLinkClass"
              @toggle="labToggleSection(group.label)"
            />
          </ul>
        </nav>
      </div>

      <h3>Identity</h3>
      <div class="lab-shipped-row">
        <AppButton variant="primary">Add transaction</AppButton>
        <AppButton variant="secondary">Export</AppButton>
        <AppButton variant="soft">Filters</AppButton>
        <AppButton variant="ghost">Cancel</AppButton>
        <AppButton variant="danger">Archive</AppButton>
        <a class="text-link hover:text-link-hover text-sm font-medium" href="#">A link</a>
      </div>
      <div class="lab-shipped-row">
        <span v-for="tone in shippedTones" :key="tone" :class="[BADGE_BASE, toneClass(tone)]">{{ tone }}</span>
      </div>
      <div class="lab-shipped-row">
        <span class="rounded-control bg-brand-accent px-3 py-1.5 text-xs font-medium text-ink">brand-accent</span>
        <span class="rounded-control bg-brand-accent-soft px-3 py-1.5 text-xs font-medium text-ink">accent-soft</span>
        <span class="rounded-control bg-brand-accent-strong px-3 py-1.5 text-xs font-medium text-ink-inverse">accent-strong</span>
        <span class="rounded-control bg-action-primary px-3 py-1.5 text-xs font-medium text-action-primary-foreground">action</span>
        <span class="rounded-control bg-selected-surface px-3 py-1.5 text-xs font-medium text-ink">selected</span>
      </div>
    </section>
  </div>
</template>

<style scoped src="./design-system-lab.css"></style>
