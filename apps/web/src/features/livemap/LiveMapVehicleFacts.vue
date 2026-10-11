<script setup lang="ts">
import { computed } from "vue";
import { loadBoardState, type LiveMapBoard, type LiveMapLoadRoute, type LiveMapStop, type LiveMapVehicle, type LoadStatus } from "@silvicom/shared";
import { BADGE_BASE, toneClass, vehicleStateTone } from "@/lib/badges";
import { STATE_LABEL } from "./liveMapLayer";
import { engineWords, formatAge, fuelMetric, routeWords, stopAddress } from "./liveMapWords";
import GatedLink from "@/components/GatedLink.vue";
import { AppButton as BaseButton, AppIconButton } from "@silvicom/ui";
import { RouteIcon, UserIcon, VehicleIcon } from "@silvicom/ui/icons";
import { useOpens } from "@/composables/useOpens";

/**
 * What one truck is doing right now — the body of both readings of a selection (D-DR5).
 *
 * ── ONE SET OF FACTS, ONE CONTAINER — AND IT SAID TWO FOR A FORTNIGHT ────────────────────────────
 * This opened in two places once: a `SlideOver` for the DOCUMENT form of the board, and the
 * workspace's floating panel where comp (7) draws it. D-DR24 deleted the document form — `/live-map`
 * and `LiveMapPanel.vue` went with it — and `LiveMapVehicleDrawer.vue` survived the cut, imported by
 * nobody, while this comment went on calling it a live container. It is deleted with this change,
 * because the alternative was threading this card's new `board` prop through a component no route
 * mounts. The facts stay in one file for the original reason: two copies of "which speed source is
 * this" would drift apart.
 *
 * ── IT LINKS RATHER THAN RESTATES ────────────────────────────────────────────────────────────────
 * Everything a dispatcher might do next about a truck, a driver or a load already has a page that
 * does it properly. Reproducing any of that here would be a second, thinner copy of a surface that
 * exists, so this answers "what is this one doing right now" and hands off for the rest.
 *
 * ── NO MONEY, AND THAT IS THE LM-F RULING APPLIED ────────────────────────────────────────────────
 * No rate, no cost, no margin. `dispatch` and `accounting` are different sections and a dispatcher
 * holds one of them; a figure hidden behind a component's own `v-if` is a permission decision in the
 * wrong place, so the endpoint does not send them and this cannot leak them.
 *
 * ⚠ There is still no ETA row, which comp (7) draws and §4.2 of the design-refresh plan rules out: an
 * ETA field that is blank on most trucks reads as broken rather than as pending. The Pickup and
 * Delivery rows arrived 2026-10-09 (TRUCK-CARD-ROUTE-PLAN D-TC2), once the Board VM made McLeod's
 * stops real — 246 of 249 on-truck stops carry an address. The load block appears only when there IS
 * a load, and says what it is waiting for when there is not.
 */
const props = defineProps<{
  vehicle: LiveMapVehicle;
  /**
   * The board this truck came off, for its clock and its bounds (`Q-LM20`).
   *
   * ⚠ A `Pick` and not the whole board: this card describes ONE truck, and handing it every vehicle
   * on the fleet would let a later edit reach for a second one from in here. The two fields are what
   * `fuelMetric` needs to age a tank against the response's own clock rather than the browser's.
   */
  board: Pick<LiveMapBoard, "generatedAt" | "bounds">;
  /** `compact` drops the section rules and tightens the grid, for the floating panel. */
  density?: "comfortable" | "compact";
  /**
   * The load's route toggle (TRUCK-CARD-ROUTE-PLAN D-TC7), owned by the workspace: it draws on the
   * map and must clear when the selection changes, neither of which this card can see. Omitted, the
   * card has no route button — the rail's reading of the facts does not draw on a map.
   */
  route?: { shown: boolean; pending: boolean; error: string | null; data: LiveMapLoadRoute | null };
}>();

const emit = defineEmits<{ toggleRoute: [] }>();

const compact = computed(() => props.density === "compact");
const opens = useOpens();

// The load's status in the Loads board's words (`loadBoardState`), never the raw enum: until
// 2026-09-28 this printed `in_transit`, and a McLeod load McLeod has planned but not started would
// have printed `approved`, a word left over from the approval chain LR6 removed. McLeod's own code
// rides in the tooltip, as on the board, so the map can be matched to McLeod's screen.
const loadState = computed(() => {
  const load = props.vehicle.load;
  if (!load) return null;
  return loadBoardState({ status: load.status as LoadStatus, source: load.source ?? "", external_status: load.externalStatus ?? null });
});

const speed = computed(() => {
  const mph = props.vehicle.position.speedMph;
  if (mph == null) return "—";
  // The vendor's own flag, said out loud: an ECU speed comes off the engine and a GPS-derived one is
  // inferred from successive fixes. A dispatcher querying a speeding conversation needs to know which.
  const source = props.vehicle.position.isEcuSpeed === true ? "engine" : "GPS";
  return `${Math.round(mph)} mph (${source})`;
});

const heading = computed(() => {
  const deg = props.vehicle.position.headingDegrees;
  // Null is not north. A bearing-less ping draws a dot rather than an arrow for the same reason.
  return deg == null ? "Not reported" : `${Math.round(deg)}°`;
});

/**
 * The tank (`Q-LM20`, the owner's item 8). `—` when this truck has never reported one, because an
 * unknown tank and an empty tank are opposite facts and 0% would send somebody to a full truck.
 *
 * The staleness is `fuelMetric`'s decision, not this component's — the rule reads the bound off the
 * response, so a component holding its own idea of "recent" is exactly the second copy LM6's
 * `bounds` exists to prevent.
 */
const fuel = computed(() => fuelMetric(props.vehicle, props.board));

const routeText = computed(() => (props.route?.shown && props.route.data ? routeWords(props.route.data) : null));

/** Pickup then delivery, each only when the api sent it (D-TC2; an older api sends neither). */
const ends = computed(() => {
  const load = props.vehicle.load;
  const out: { label: string; stop: LiveMapStop }[] = [];
  if (load?.pickup) out.push({ label: "Pickup", stop: load.pickup });
  if (load?.delivery) out.push({ label: "Delivery", stop: load.delivery });
  return out;
});
</script>

<template>
  <div :class="compact ? 'space-y-3' : 'space-y-6'">
    <div class="flex items-center gap-2">
      <span :class="[BADGE_BASE, vehicleStateTone(vehicle.state)]">{{ STATE_LABEL[vehicle.state] }}</span>
      <span v-if="vehicle.inShop" :class="[BADGE_BASE, toneClass('neutral')]">In shop</span>
      <span class="text-xs text-ink-muted">Fix {{ formatAge(vehicle.ageSeconds) }}</span>
    </div>

    <dl class="grid grid-cols-2 gap-x-4 text-sm" :class="compact ? 'gap-y-2' : 'gap-y-3'">
      <div>
        <dt class="text-xs text-ink-muted">Speed</dt>
        <dd class="text-ink">{{ speed }}</dd>
      </div>
      <div>
        <!--
          ⚠ Fuel sits beside SPEED, not after Heading, and that is the owner's item 8 read literally:
          "fuel level, speed, current location" are the three facts asked for, and a bearing in
          degrees is the one a dispatcher reads least. The two numbers a person scans together are
          therefore the two on the first row.
        -->
        <dt class="text-xs text-ink-muted">Fuel</dt>
        <dd :class="fuel?.stale ? 'text-ink-secondary' : 'text-ink'">{{ fuel?.text ?? "—" }}</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Heading</dt>
        <dd class="text-ink">{{ heading }}</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Engine</dt>
        <dd class="text-ink">{{ engineWords(vehicle.engineState) ?? "—" }}</dd>
      </div>
      <div class="col-span-2">
        <dt class="text-xs text-ink-muted">Location</dt>
        <!-- The vendor's own reverse-geocoded place name, verbatim. No second geocoder is in the path. -->
        <dd class="text-ink">{{ vehicle.position.formattedLocation ?? "—" }}</dd>
      </div>
    </dl>

    <div class="space-y-2 border-t border-edge" :class="compact ? 'pt-3' : 'pt-4'">
      <p class="text-xs font-semibold text-ink-secondary">Load</p>
      <p v-if="!vehicle.load" class="text-sm text-ink-muted">
        No load on this truck. Loads arrive with the dispatch feed.
      </p>
      <!-- SP5 (plan §4b): each door here opens only where its page does. The map is `dispatch` view; a
           truck is `equipment`, a driver `roster`, and Loads can be switched off per person. -->
      <GatedLink v-else :to="`/loads/${vehicle.load.id}`" class="block text-sm text-link hover:text-link-hover" plain-class="block text-sm text-ink">
        {{ vehicle.load.ref ?? "Load" }} · <span :title="loadState?.mcleodWords ?? undefined">{{ loadState?.label }}</span>
      </GatedLink>
      <!-- D-TC2: the load's two ends, by the board's rule (`boardStops`, chosen by the api). The place
           name is McLeod's, the address one line under it. -->
      <dl v-if="ends.length" class="space-y-2 text-sm">
        <div v-for="end in ends" :key="end.label">
          <dt class="text-xs text-ink-muted">{{ end.label }}</dt>
          <dd class="text-ink">{{ end.stop.name ?? "—" }}</dd>
          <dd v-if="stopAddress(end.stop)" class="text-xs text-ink-secondary">{{ stopAddress(end.stop) }}</dd>
        </div>
      </dl>
      <p v-if="vehicle.load?.extraStops" class="text-xs text-ink-muted">
        +{{ vehicle.load.extraStops }} more {{ vehicle.load.extraStops === 1 ? "stop" : "stops" }}
      </p>
      <!-- The next stop earns its line only when the two ends do not already say it: an api from
           before the ends existed, or a load with stops between them. -->
      <p v-if="vehicle.load?.nextStop && (!ends.length || vehicle.load.extraStops)" class="text-xs text-ink-muted">
        Next stop: {{ vehicle.load.nextStop.name ?? vehicle.load.nextStop.kind }}
        <template v-if="vehicle.load.nextStop.city">
          — {{ vehicle.load.nextStop.city
          }}<template v-if="vehicle.load.nextStop.state">, {{ vehicle.load.nextStop.state }}</template>
        </template>
      </p>
    </div>

    <!-- D-TC1: the two doors as icons, from the barrel. The words they replaced are each icon's
         accessible name and tooltip, and each still appears only where its page opens (SP5). -->
    <div class="flex gap-1" :class="compact ? 'border-t border-edge pt-2' : 'hidden'">
      <AppIconButton
        v-if="opens(`/vehicles/${vehicle.vehicleId}`)"
        :to="`/vehicles/${vehicle.vehicleId}`"
        :icon="VehicleIcon"
        label="Open truck"
        variant="secondary"
        size="sm"
      />
      <AppIconButton
        v-if="vehicle.driver && opens(`/drivers/${vehicle.driver.id}`)"
        :to="`/drivers/${vehicle.driver.id}`"
        :icon="UserIcon"
        label="Open driver"
        variant="secondary"
        size="sm"
      />
      <!-- D-TC7: a toggle, drawn by the workspace. Only for a truck with a load: there is no route
           without stops. -->
      <AppIconButton
        v-if="route && vehicle.load"
        :icon="RouteIcon"
        :label="route.shown ? 'Hide route' : 'Show route'"
        :pressed="route.shown"
        variant="secondary"
        size="sm"
        @click="emit('toggleRoute')"
      />
    </div>
    <div v-if="route?.shown" class="space-y-1 text-xs" aria-live="polite">
      <p v-if="route.pending" class="text-ink-muted">Planning the route…</p>
      <p v-else-if="route.error" class="text-danger-700">{{ route.error }}</p>
      <template v-else-if="routeText">
        <p class="text-ink">{{ routeText.summary }}</p>
        <p v-for="note in routeText.notes" :key="note" class="text-ink-muted">{{ note }}</p>
      </template>
      <!-- The words as well as the pressed icon (owner, 2026-10-09: "I don't see a closing button"):
           a tinted icon reads as state to some and as nothing to others. Same toggle, same emit. -->
      <BaseButton variant="link" size="sm" @click="emit('toggleRoute')">Hide route</BaseButton>
    </div>
  </div>
</template>
