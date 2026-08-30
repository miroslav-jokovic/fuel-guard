<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard, AppCallout } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import type { CalcResult } from "./useHazmatCalc";
import PlacardDiamond from "./PlacardDiamond.vue";
import CitationText from "./CitationText.vue";
import FindingRow from "./FindingRow.vue";
import VerdictDetails from "./VerdictDetails.vue";

/**
 * The verdict panel (plan H5). Renders the deterministic engine output — each with its CFR citation
 * (G4). The full rule trace sits behind an expander for audit/explainability. Everything here is
 * display; the engine already decided.
 *
 * Recomposed 2026-08-30 (H-U6). It had become TEN stacked `BaseCard`s — what goes on the truck,
 * identification numbers, weight & packaging, permitted-not-required, substitutions, prohibited,
 * marks, ERG, eligibility, segregation, rule trace — every one at the same heading weight and the
 * same elevation, in the narrower half of a two-column grid. A panel whose entire job is to say
 * WHICH DIAMONDS GO ON THE TRUCK gave that answer exactly as much authority as its rule trace.
 *
 * Now it reads in three moves, which is the order the work happens in:
 *   1. THE ANSWER — eligibility, the load's shape, and the display itself.
 *   2. THE CHECK — the §172.504(c) arithmetic and the lawful ID formats. Deliberately NOT hidden:
 *      "a verdict a dispatcher cannot check is a verdict they will not trust" is why the weight card
 *      was built, and putting it behind a click would undo that.
 *   3. WHAT ELSE IS TRUE — blocking findings and segregation when there are any, then the long tail
 *      in `VerdictDetails`, closed.
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

/**
 * The engine's non-blocking findings (engine 0.13.0), split by what they are about.
 *
 * These are new to the panel because they are new to the VERDICT: `info` findings used to be dropped
 * inside `evaluateLoad`, so the reasoning behind a quiet answer — why nothing is required below
 * 1,001 lb, why a residue line left the aggregate, why a marine pollutant needs no mark on an
 * already-placarded vehicle — was computed and thrown away. The BOL half had never reached this panel
 * by any route at all: `verdict.bol` exists and nothing rendered it.
 *
 * Split rather than listed, because the two answer different questions: one is what the PAPER must
 * say, the other is why the TRUCK carries what it carries.
 */
const paperNotices = computed(() => (v.value.notices ?? []).filter((f) => f.ruleId.startsWith("bol_")));
const reasoningNotices = computed(() => (v.value.notices ?? []).filter((f) => !f.ruleId.startsWith("bol_")));

/** Everything past the answer and its arithmetic — only rendered when there is something in it. */
const hasDetails = computed(
  () =>
    v.value.placards.permitted.length > 0 ||
    v.value.placards.optionalSubstitutions.length > 0 ||
    v.value.placards.prohibited.length > 0 ||
    v.value.placards.marks.length > 0 ||
    v.value.placards.ergGuides.length > 0 ||
    v.value.trace.length > 0,
);

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
 * The three §172.504/§172.301 weight gates, derived rather than written out three times. They were
 * three near-identical `<li>`s whose state expressions had already drifted apart — the 1,001 lb row
 * read the engine's own `thresholdMet` while the other two recomputed the comparison inline, so a
 * change to how "met" is decided would have been applied to one of the three.
 */
const thresholds = computed(() => {
  const a = agg.value;
  if (!a) return [];
  const weight = a.countedGrossWeightLb;
  const over = (limit: number) => (weight == null ? null : weight >= limit);
  const row = (label: string, met: boolean | null, yes: string, no: string) => ({
    label,
    state: met == null ? "Unknown" : met ? yes : no,
    tone: met ? "brand" : "neutral",
  });
  return [
    row("1,001 lb — non-bulk Table 2 placarding (§172.504(c))", a.thresholdMet, "Met", "Not met"),
    row("2,205 lb — single category keeps its own placard (§172.504(b))", over(a.thresholds.dangerousCategoryLb), "Over", "Under"),
    row("8,820 lb — single-material non-bulk ID display (§172.301(a)(3))", over(a.thresholds.nonBulkIdDisplayLb), "Over", "Under"),
  ];
});

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
    <!-- ══ 1 · THE ANSWER ═══════════════════════════════════════════════════════════════════════ -->
    <BaseCard>
      <!-- Eligibility leads, because it is the one line that decides whether the load can move. -->
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 class="text-sm font-semibold text-ink">What goes on the truck</h3>
        <span :class="[BADGE_BASE, toneClass(ELIGIBILITY_TONE[v.eligibility.status] ?? 'neutral')]">
          {{ ELIGIBILITY_LABEL[v.eligibility.status] ?? v.eligibility.status }}
        </span>
      </div>

      <div v-if="loadProfile" class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
        <span class="font-medium text-ink-secondary">{{ loadProfile.packaging }}</span>
        <span v-if="loadProfile.freight" aria-hidden="true">·</span>
        <span v-if="loadProfile.freight">{{ loadProfile.freight }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ loadProfile.scope }}</span>
      </div>

      <p v-if="display.length === 0" class="mt-4 text-sm text-ink-muted">
        No placards required for this load.
      </p>

      <ul v-else class="mt-4 space-y-5">
        <li v-for="(p, i) in display" :key="i" class="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
          <PlacardDiamond :name="p.placard" :id-number="p.idNumber" :size="112" class="self-start" />
          <div class="min-w-0 flex-1 space-y-1">
            <p class="text-base font-semibold text-ink">
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

      <p v-if="panelOnlyIds.length" class="mt-4 rounded-control bg-surface-subtle px-3 py-2 text-xs text-ink-secondary ring-1 ring-inset ring-edge">
        {{ panelOnlyIds.length }} identification
        {{ panelOnlyIds.length === 1 ? "number needs" : "numbers need" }} a separate panel —
        {{ panelOnlyIds.map((d) => d.idNumber).join(", ") }}. The formats are below.
      </p>

      <p v-if="display.length" class="mt-4 border-t border-edge pt-3 text-xs text-ink-tertiary">
        Placard images are <strong>specimens</strong> for identification, not regulation-ready artwork
        (49&nbsp;CFR&nbsp;§172.519).
      </p>

      <p class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ink-tertiary">
        <span>Engine {{ result.engineVersion }}</span>
        <span aria-hidden="true">·</span>
        <span>Dataset {{ result.datasetVersion }}</span>
      </p>
      <AppCallout v-if="result.datasetProvisional" tone="warning" class="mt-2">
        Provisional dataset — decision support only, this cannot clear a load.
      </AppCallout>
    </BaseCard>

    <!-- ══ 2 · THE CHECK — the arithmetic and the lawful formats, never behind a click ═════════ -->
    <BaseCard v-if="agg || v.placards.idDisplays.length || reasoningNotices.length">
      <h3 class="text-sm font-semibold text-ink">How this was decided</h3>

      <template v-if="agg">
        <p class="mt-1 text-xs text-ink-muted">What the §172.504(c) decision actually ran on.</p>
        <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt class="text-xs text-ink-muted">Counted gross weight</dt>
            <dd class="font-semibold text-ink tabular-nums">
              {{ agg.countedGrossWeightLb != null ? `${fmt(agg.countedGrossWeightLb)} lb` : "Not stated" }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-ink-muted">Packages counted</dt>
            <dd class="font-semibold text-ink tabular-nums">
              {{ agg.countedPackages != null ? fmt(agg.countedPackages) : "Not stated" }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-ink-muted">Lines in the aggregate</dt>
            <dd class="font-semibold text-ink tabular-nums">{{ agg.countedLines }}</dd>
          </div>
        </dl>

        <ul class="mt-4 space-y-1.5 text-xs">
          <li v-for="t in thresholds" :key="t.label" class="flex items-center justify-between gap-3 rounded-control bg-surface-subtle px-3 py-1.5 ring-1 ring-inset ring-edge">
            <span class="text-ink-secondary">{{ t.label }}</span>
            <span :class="[BADGE_BASE, toneClass(t.tone)]">{{ t.state }}</span>
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
      </template>

      <div v-if="v.placards.idDisplays.length" :class="agg ? 'mt-5 border-t border-edge pt-4' : 'mt-3'">
        <h4 class="text-sm font-medium text-ink">Identification numbers</h4>
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
      </div>

      <div v-if="reasoningNotices.length" :class="agg || v.placards.idDisplays.length ? 'mt-5 border-t border-edge pt-4' : 'mt-3'">
        <h4 class="text-sm font-medium text-ink">Why this answer</h4>
        <ul class="mt-2 space-y-2">
          <li v-for="(f, i) in reasoningNotices" :key="i" class="text-sm text-ink-secondary">
            {{ f.message }}
            <div class="mt-0.5"><CitationText :citations="f.citations" /></div>
          </li>
        </ul>
      </div>
    </BaseCard>

    <!-- ══ 2b · WHAT THE SHIPPING PAPER MUST SAY ════════════════════════════════════════════════ -->
    <BaseCard v-if="paperNotices.length">
      <h3 class="text-sm font-semibold text-ink">What the shipping paper must say</h3>
      <p class="mt-1 text-xs text-ink-muted">
        Derived from the declaration. Whether the printed paper actually says it is checked against the
        scanned document, or by the reviewer.
      </p>
      <ul class="mt-3 space-y-2">
        <li v-for="(f, i) in paperNotices" :key="i" class="text-sm text-ink-secondary">
          {{ f.message }}
          <div class="mt-0.5"><CitationText :citations="f.citations" /></div>
        </li>
      </ul>
    </BaseCard>

    <!-- ══ 3 · WHAT ELSE IS TRUE ════════════════════════════════════════════════════════════════ -->
    <BaseCard v-if="v.eligibility.blocks.length || v.segregation.length">
      <h3 class="text-sm font-semibold text-ink">
        {{ v.eligibility.blocks.length && v.segregation.length ? "Findings and load compatibility" : v.eligibility.blocks.length ? "Findings" : "Load compatibility" }}
      </h3>
      <p v-if="v.eligibility.status === 'not_checked' && v.eligibility.blocks.length" class="mt-1 text-xs text-ink-muted">
        Eligibility is not decided here. The calculator answers what the load must display; clearing a load
        to run is an org-policy decision made against a real load. These are what a reviewer would confirm.
      </p>
      <div v-if="v.eligibility.blocks.length" class="mt-2">
        <FindingRow v-for="(f, i) in v.eligibility.blocks" :key="i" :finding="f" />
      </div>
      <div v-if="v.segregation.length" :class="v.eligibility.blocks.length ? 'mt-4 border-t border-edge pt-3' : 'mt-2'">
        <p v-if="v.eligibility.blocks.length" class="mb-1 text-xs font-medium text-ink-secondary">Segregation</p>
        <FindingRow v-for="(f, i) in v.segregation" :key="i" :finding="f" />
      </div>
    </BaseCard>
    <AppCallout v-else-if="v.eligibility.status === 'eligible'" tone="success">
      No blocking findings, a verified segregation grid and a non-provisional dataset — this is the
      auto-clear path.
    </AppCallout>

    <BaseCard v-if="hasDetails">
      <VerdictDetails :verdict="v" />
    </BaseCard>
  </div>
</template>
