<script setup lang="ts">
import { computed, ref } from "vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";

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
  { key: "unit", label: "Unit" },
  { key: "driver", label: "Driver" },
  { key: "gallons", label: "Gallons", numeric: true, sortable: true },
  { key: "amount", label: "Amount", numeric: true },
  { key: "mpg", label: "MPG", numeric: true },
  { key: "status", label: "Status" },
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
      <DataTable :columns="shippedColumns" :rows="shippedRows" row-key="unit" />
    </section>
  </div>
</template>

<style scoped src="./design-system-lab.css"></style>
