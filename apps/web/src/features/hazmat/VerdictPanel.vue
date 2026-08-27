<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import type { CalcResult } from "./useHazmatCalc";
import PlacardDiamond from "./PlacardDiamond.vue";
import CitationText from "./CitationText.vue";
import FindingRow from "./FindingRow.vue";

/**
 * The verdict panel (plan H5). Renders the deterministic engine output — each with its CFR citation
 * (G4). The full rule trace sits behind an expander for audit/explainability. Everything here is
 * display; the engine already decided.
 *
 * Reworked 2026-08 around one question: WHAT GOES ON THE TRUCK. The old panel opened with a bare grid
 * of worded diamonds and put the identification number in a separate card three sections down, which
 * described a Class 8 van as "a CORROSIVE placard, and also an orange panel" — two things, when the
 * display carriers actually run is one diamond with the number across it (§172.332(c)). The lead card
 * now shows the recommended display as a single object, with the other lawful formats named
 * underneath rather than omitted. A weight-and-packaging card shows the arithmetic the decision ran
 * on, because a verdict a dispatcher cannot check is a verdict they will not trust.
 */
const props = defineProps<{ result: CalcResult }>();

const v = computed(() => props.result.verdict);

function humanize(s: string): string {
  return s.replace(/_/g, " ");
}

const FORMAT_LABEL: Record<string, string> = {
  on_placard: "Across the placard",
  orange_panel: "Orange panel",
  white_square_on_point: "White square-on-point",
};

const ELIGIBILITY_TONE: Record<string, string> = {
  eligible: "success",
  blocked: "danger",
  not_checked: "neutral",
};
const ELIGIBILITY_LABEL: Record<string, string> = {
  eligible: "Eligible",
  blocked: "Blocked",
  not_checked: "Not checked",
};

const firedTrace = computed(() => v.value.trace.filter((t) => t.fired));

/**
 * The display, resolved: each required placard paired with the identification number it carries, when
 * the engine recommends `on_placard` and §172.334 leaves that placard eligible. Everything else stays
 * a plain diamond, and any number with no carrier is listed separately as a panel.
 */
const display = computed(() => {
  const onPlacard = v.value.placards.idDisplays.filter((d) => d.format === "on_placard");
  return v.value.placards.required.map((p) => ({
    ...p,
    idNumber: onPlacard.find((d) => d.onPlacards.includes(p.placard))?.idNumber ?? null,
  }));
});

/** Numbers that need their own panel — either the engine recommends a panel, or no placard may carry it. */
const panelOnlyIds = computed(() =>
  v.value.placards.idDisplays.filter((d) => d.format !== "on_placard" || d.onPlacards.length === 0),
);

const agg = computed(() => v.value.placards.aggregate ?? null);
const fmt = (n: number): string => n.toLocaleString("en-US");

/**
 * H-MX (engine 0.11.0): the load type, stated where a dispatcher looks first. The engine derives it
 * (bulk / non-bulk / mixed packaging over the resolved lines, plus the mixed-with-general-freight
 * fact from the form's tri-state) — this is pure display of `placards.loadProfile`.
 */
const loadProfile = computed(() => {
  const p = v.value.placards.loadProfile;
  if (!p) return null;
  const packaging =
    p.packaging === "bulk" ? "Bulk load" : p.packaging === "non_bulk" ? "Packaged (non-bulk) load" : "Mixed packaging — bulk + packages";
  const freight =
    p.otherFreightAboard === true ? "with general freight aboard" : p.otherFreightAboard === false ? "hazmat only" : null;
  const scope = `${p.hazmatLines} hazmat line${p.hazmatLines === 1 ? "" : "s"} · ${p.distinctPlacardCategories} placard categor${
    p.distinctPlacardCategories === 1 ? "y" : "ies"
  }`;
  return { packaging, freight, scope };
});
</script>

<template>
  <div class="space-y-4">
    <!-- provenance / provisional -->
    <div class="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
      <span>Engine {{ result.engineVersion }}</span>
      <span aria-hidden="true">·</span>
      <span>Dataset {{ result.datasetVersion }}</span>
      <span v-if="result.datasetProvisional" :class="[BADGE_BASE, toneClass('warning')]">
        Provisional dataset — decision support only, cannot clear a load
      </span>
    </div>

    <!-- ── what kind of load this is (H-MX) ──────────────────────────────────────────────────── -->
    <div v-if="loadProfile" class="flex flex-wrap items-center gap-2">
      <span :class="[BADGE_BASE, toneClass('brand'), 'capitalize']">{{ loadProfile.packaging }}</span>
      <span v-if="loadProfile.freight" :class="[BADGE_BASE, toneClass('neutral'), 'capitalize']">{{ loadProfile.freight }}</span>
      <span class="text-xs text-ink-muted">{{ loadProfile.scope }}</span>
    </div>

    <!-- ── what goes on the truck ─────────────────────────────────────────────────────────────── -->
    <BaseCard>
      <h3 class="text-sm font-semibold text-ink">What goes on the truck</h3>
      <p v-if="display.length === 0" class="mt-2 text-sm text-ink-muted">
        No placards required for this load.
      </p>

      <ul v-else class="mt-4 space-y-5">
        <li v-for="(p, i) in display" :key="i" class="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
          <PlacardDiamond :name="p.placard" :id-number="p.idNumber" :size="104" class="self-start" />
          <div class="min-w-0 flex-1 space-y-1">
            <p class="text-sm font-semibold text-ink">
              {{ humanize(p.placard) }}<span v-if="p.idNumber" class="text-ink-secondary"> · {{ p.idNumber }}</span>
            </p>
            <p class="text-sm text-ink-secondary">{{ humanize(p.positions) }}</p>
            <p v-if="p.idNumber" class="text-xs text-ink-muted">
              The identification number is displayed across the center of this placard — one display, not a
              placard plus a separate panel.
            </p>
            <CitationText :citations="p.because" />
          </div>
        </li>
      </ul>

      <p v-if="display.length" class="mt-4 border-t border-edge pt-3 text-xs text-ink-tertiary">
        Placard images are <strong>specimens</strong> for identification, not regulation-ready artwork
        (49&nbsp;CFR&nbsp;§172.519).
      </p>
    </BaseCard>

    <!-- ── identification numbers: the formats, all of them ───────────────────────────────────── -->
    <BaseCard v-if="v.placards.idDisplays.length">
      <h3 class="text-sm font-semibold text-ink">Identification numbers</h3>
      <p class="mt-1 text-xs text-ink-muted">
        One requirement, several lawful displays. The first is what this load is best served by; the rest
        are equally legal if you'd rather run them.
      </p>
      <ul class="mt-3 space-y-4">
        <li v-for="(d, i) in v.placards.idDisplays" :key="i">
          <div class="flex flex-wrap items-baseline gap-2">
            <span class="font-mono text-sm font-semibold text-ink">{{ d.idNumber }}</span>
            <span class="text-sm text-ink-secondary">{{ humanize(d.positions) }}</span>
          </div>
          <ul class="mt-2 space-y-1.5">
            <li
              v-for="(f, j) in d.alternateFormats"
              :key="j"
              class="rounded-control px-3 py-2 text-xs ring-1 ring-inset"
              :class="f.format === d.format ? 'bg-brand-50 text-ink ring-brand-200' : 'bg-surface text-ink-secondary ring-edge'"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-semibold">{{ FORMAT_LABEL[f.format] ?? humanize(f.format) }}</span>
                <span v-if="f.format === d.format" :class="[BADGE_BASE, toneClass('brand')]">Recommended</span>
              </div>
              <p v-if="f.note" class="mt-0.5 text-ink-muted">{{ f.note }}</p>
              <div class="mt-1"><CitationText :citations="f.because" /></div>
            </li>
          </ul>
          <p v-if="d.onPlacards.length === 0" class="mt-2 text-xs text-warning-800">
            No placard on this load may carry an identification number (§172.334), so this number needs its
            own panel.
          </p>
          <div class="mt-1"><CitationText :citations="d.because" /></div>
        </li>
      </ul>
      <p v-if="panelOnlyIds.length && display.length" class="mt-3 text-xs text-ink-muted">
        A white square-on-point display is <strong>not</strong> a placard (§172.336(b)) — it satisfies the
        marking requirement, never a placarding one.
      </p>
    </BaseCard>

    <!-- ── weight & packaging: the arithmetic behind the verdict ──────────────────────────────── -->
    <BaseCard v-if="agg">
      <h3 class="text-sm font-semibold text-ink">Weight &amp; packaging</h3>
      <p class="mt-1 text-xs text-ink-muted">What the §172.504(c) decision actually ran on.</p>
      <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt class="text-xs text-ink-muted">Counted gross weight</dt>
          <dd class="font-semibold text-ink">
            {{ agg.countedGrossWeightLb != null ? `${fmt(agg.countedGrossWeightLb)} lb` : "Not stated" }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-ink-muted">Packages counted</dt>
          <dd class="font-semibold text-ink">
            {{ agg.countedPackages != null ? fmt(agg.countedPackages) : "Not stated" }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-ink-muted">Lines in the aggregate</dt>
          <dd class="font-semibold text-ink">{{ agg.countedLines }}</dd>
        </div>
      </dl>

      <ul class="mt-4 space-y-1.5 text-xs">
        <li class="flex items-center justify-between gap-3 rounded-control bg-surface-subtle px-3 py-1.5 ring-1 ring-inset ring-edge">
          <span class="text-ink-secondary">1,001 lb — non-bulk Table 2 placarding (§172.504(c))</span>
          <span :class="[BADGE_BASE, toneClass(agg.thresholdMet ? 'brand' : 'neutral')]">
            {{ agg.thresholdMet ? "Met" : "Not met" }}
          </span>
        </li>
        <li class="flex items-center justify-between gap-3 rounded-control bg-surface-subtle px-3 py-1.5 ring-1 ring-inset ring-edge">
          <span class="text-ink-secondary">2,205 lb — single category keeps its own placard (§172.504(b))</span>
          <span :class="[BADGE_BASE, toneClass(agg.countedGrossWeightLb != null && agg.countedGrossWeightLb >= agg.thresholds.dangerousCategoryLb ? 'brand' : 'neutral')]">
            {{ agg.countedGrossWeightLb == null ? "Unknown" : agg.countedGrossWeightLb >= agg.thresholds.dangerousCategoryLb ? "Over" : "Under" }}
          </span>
        </li>
        <li class="flex items-center justify-between gap-3 rounded-control bg-surface-subtle px-3 py-1.5 ring-1 ring-inset ring-edge">
          <span class="text-ink-secondary">8,820 lb — single-material non-bulk ID display (§172.301(a)(3))</span>
          <span :class="[BADGE_BASE, toneClass(agg.countedGrossWeightLb != null && agg.countedGrossWeightLb >= agg.thresholds.nonBulkIdDisplayLb ? 'brand' : 'neutral')]">
            {{ agg.countedGrossWeightLb == null ? "Unknown" : agg.countedGrossWeightLb >= agg.thresholds.nonBulkIdDisplayLb ? "Over" : "Under" }}
          </span>
        </li>
      </ul>

      <p v-if="agg.alwaysPlacardLines || agg.residueExcludedLines" class="mt-3 text-xs text-ink-muted">
        <span v-if="agg.alwaysPlacardLines">
          {{ agg.alwaysPlacardLines }} line(s) placard regardless of the aggregate (bulk packaging or a
          §172.505 subsidiary hazard).
        </span>
        <span v-if="agg.residueExcludedLines">
          {{ agg.residueExcludedLines }} residue-only line(s) excluded (§172.504(d), §173.29(c)).
        </span>
      </p>
      <p
        v-if="agg.countedPackages != null && agg.countedGrossWeightLb != null && agg.countedPackages > 0"
        class="mt-2 text-xs text-ink-muted"
      >
        That is {{ Math.round(agg.countedGrossWeightLb / agg.countedPackages) }} lb per package — check it
        against the BOL. Count DOT packages, not pallets (§172.202(a)(7)).
      </p>
    </BaseCard>

    <!-- permitted but not required (§172.502(c)) -->
    <BaseCard v-if="v.placards.permitted.length">
      <h3 class="text-sm font-semibold text-ink">Permitted, not required</h3>
      <p class="mt-1 text-xs text-ink-muted">
        Below the 1,001&nbsp;lb Table&nbsp;2 aggregate. You may display these if you choose to — many
        carriers do as a matter of policy.
      </p>
      <div class="mt-3 flex flex-wrap gap-5">
        <div v-for="(p, i) in v.placards.permitted" :key="i" class="flex w-24 flex-col items-center gap-1.5">
          <PlacardDiamond :name="p.placard" :size="80" />
          <CitationText :citations="p.because" />
        </div>
      </div>
    </BaseCard>

    <!-- optional substitutions -->
    <BaseCard v-if="v.placards.optionalSubstitutions.length">
      <h3 class="text-sm font-semibold text-ink">Optional wording substitutions</h3>
      <ul class="mt-2 space-y-2">
        <li v-for="(s, i) in v.placards.optionalSubstitutions" :key="i" class="text-sm text-ink-secondary">
          May use <span class="font-semibold text-ink">{{ humanize(s.use) }}</span> instead of
          <span class="font-semibold text-ink">{{ humanize(s.instead) }}</span>
          <div class="mt-0.5"><CitationText :citations="s.because" /></div>
        </li>
      </ul>
    </BaseCard>

    <!-- prohibited -->
    <BaseCard v-if="v.placards.prohibited.length">
      <h3 class="text-sm font-semibold text-ink">Prohibited placards</h3>
      <ul class="mt-2 space-y-2">
        <li v-for="(p, i) in v.placards.prohibited" :key="i" class="text-sm text-ink-secondary">
          <span :class="[BADGE_BASE, toneClass('danger'), 'capitalize']">{{ humanize(p.placard) }}</span>
          <div class="mt-0.5"><CitationText :citations="p.because" /></div>
        </li>
      </ul>
    </BaseCard>

    <!-- marks -->
    <BaseCard v-if="v.placards.marks.length">
      <h3 class="text-sm font-semibold text-ink">Marks (not placards)</h3>
      <ul class="mt-2 space-y-2">
        <li v-for="(m, i) in v.placards.marks" :key="i" class="text-sm text-ink-secondary">
          <span class="font-semibold text-ink">{{ humanize(m.mark) }}</span> — {{ humanize(m.positions) }}
          <div class="mt-0.5"><CitationText :citations="m.because" /></div>
        </li>
      </ul>
    </BaseCard>

    <!-- ERG guides -->
    <BaseCard v-if="v.placards.ergGuides.length">
      <h3 class="text-sm font-semibold text-ink">Emergency Response Guide</h3>
      <ul class="mt-2 flex flex-wrap gap-2 text-sm">
        <li v-for="(g, i) in v.placards.ergGuides" :key="i" class="rounded-control bg-surface-muted px-2 py-1 ring-1 ring-inset ring-edge">
          <span class="font-mono">{{ g.idNumber }}</span> → Guide <span class="font-semibold">{{ g.guide }}</span>
        </li>
      </ul>
    </BaseCard>

    <!-- eligibility -->
    <BaseCard>
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-sm font-semibold text-ink">Eligibility</h3>
        <span :class="[BADGE_BASE, toneClass(ELIGIBILITY_TONE[v.eligibility.status] ?? 'neutral')]">
          {{ ELIGIBILITY_LABEL[v.eligibility.status] ?? v.eligibility.status }}
        </span>
      </div>
      <p v-if="v.eligibility.status === 'eligible'" class="mt-2 text-sm text-success-700">
        The rules find this eligible — no blocking findings, a verified segregation grid, and a
        non-provisional dataset. This is the auto-clear path.
      </p>
      <p v-else-if="v.eligibility.status === 'not_checked'" class="mt-2 text-sm text-ink-muted">
        Eligibility is not decided here. The calculator answers what the load must display; clearing a load
        to run is an org-policy decision made against a real load, not a calculation. The items below are
        what a reviewer would still confirm.
      </p>
      <div v-if="v.eligibility.blocks.length" class="mt-2">
        <FindingRow v-for="(f, i) in v.eligibility.blocks" :key="i" :finding="f" />
      </div>
    </BaseCard>

    <!-- segregation -->
    <BaseCard>
      <h3 class="text-sm font-semibold text-ink">Load compatibility (segregation)</h3>
      <p v-if="v.segregation.length === 0" class="mt-2 text-sm text-ink-muted">
        No segregation conflicts for this product mix.
      </p>
      <div v-else class="mt-1">
        <FindingRow v-for="(f, i) in v.segregation" :key="i" :finding="f" />
      </div>
    </BaseCard>

    <!-- trace -->
    <BaseCard>
      <details>
        <summary class="cursor-pointer text-sm font-semibold text-ink">
          Rule trace ({{ firedTrace.length }} of {{ v.trace.length }} rules fired)
        </summary>
        <ul class="mt-3 space-y-2">
          <li v-for="(t, i) in v.trace" :key="i" class="border-b border-edge pb-2 text-sm last:border-0">
            <div class="flex items-center gap-2">
              <span :class="[BADGE_BASE, toneClass(t.fired ? 'brand' : 'neutral')]">{{ t.fired ? "Fired" : "—" }}</span>
              <span class="font-mono text-xs text-ink-secondary">{{ t.ruleId }}</span>
            </div>
            <p v-if="t.note" class="mt-1 text-ink-muted">{{ t.note }}</p>
            <div class="mt-1"><CitationText :citations="t.citations" label="Cites" /></div>
          </li>
        </ul>
      </details>
    </BaseCard>
  </div>
</template>
