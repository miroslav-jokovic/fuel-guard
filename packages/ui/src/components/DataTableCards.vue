<script setup lang="ts" generic="Row extends Record<string, any>">
import { computed, ref } from "vue";
import type { DataTableColumn } from "./DataTable.vue";
import type { SortState } from "../lists/sort";
import { isBlank } from "../lists/dataTable";
import { useTouchTargets } from "../touchTargets";
import AppCard from "./AppCard.vue";
import AppIcon from "./AppIcon.vue";
import { ChevronDownIcon } from "../icons";

/**
 * The narrow-screen half of `DataTable` — one card per row, no table.
 *
 * ── WHY CARDS AT ALL ─────────────────────────────────────────────────────────────────────────────
 * A seven-column table on a 375px phone is a horizontal scroll with two columns visible, which is not
 * a table any more — it is a puzzle. Below `md` each row becomes a card: the first column is the
 * heading, the rest are label/value pairs.
 *
 * ── WHY IT IS ITS OWN FILE (R3b, 2026-08-30) ─────────────────────────────────────────────────────
 * `DataTable.vue` stood at 454 lines against a 500-line budget (`lint:filesize`, warns at 450), and
 * R3 adds column management to it. This is the largest self-contained piece, and the one the table
 * path never touches. The parent still decides WHICH branch renders; this file only renders one.
 *
 * The parent forwards every slot verbatim, so a `#cell-<key>` written for the table reaches the card
 * too — that is what keeps the two branches showing the same thing. Pinned by
 * "renders the narrow card list unchanged" in `DataTable.test.ts`.
 *
 * ── ONE ANATOMY (SMALL-SCREENS-PLAN.md D-SM1, 2026-11-14; contract §9 rule 3) ───────────────────
 * Top line: the identifier, the row's one date or amount, its status, its controls, its menu. Then
 * the sentence. Then at most three FIGURES in a fixed three-column grid. Then the rest, behind a
 * disclosure. Until this there were two templates here — the three-fact card for a table whose page
 * had marked its columns, and a "full" card carrying every column for the hundred files that had
 * not — and the full one is what the owner's audit measured: twelve stacked fields a driver, six
 * figures in a wrapping row with the sixth alone on a line, a label column as wide as that card's
 * longest label. They had also drifted: the full card swallowed `row-click` until 2026-11-02.
 *
 * `shape` below is the one thing that differs. A marked table is drawn from its marks; an unmarked
 * one is derived from its column order (D-SM3). The shop's three-fact card is this anatomy with no
 * figures and no details, which is why its pages did not move.
 *
 * On a marked table the identifier's link is stretched over the card (`TITLE`), so the target is the
 * card and not a 20 px line of text; a link or button elsewhere on the card sits above the stretch
 * (`OVER`). A card with no link emits `row-click`, as a table row does. An unmarked table's first
 * column is not stretched: its slot was written for a table cell and may hold more than one control.
 */
const props = defineProps<{
  columns: DataTableColumn[];
  rows: Row[];
  /** Resolved by the parent, which owns the `rowKey` prop — never re-derived here. */
  keyOf: (row: Row) => string;
  selectable: boolean;
  selected?: Set<string>;
  sort?: SortState | null;
  expanded?: Set<string>;
  hasActions: boolean;
  /**
   * Each row is a card with its own edge, on the canvas (D-SM5). False for a table sitting in
   * somebody else's card — a drawer, a section of a detail page — where rows stay flat and divided,
   * because a card inside a card is the defect contract §5.2 already names. The parent decides: it
   * is the one that knows whether it drew a surface.
   */
  boxed: boolean;
}>();

const emit = defineEmits<{ sort: [key: string]; "toggle-row": [row: Row]; "row-click": [row: Row] }>();

/**
 * The stretch, as classes rather than a scoped style: a scoped block would stamp a `data-v` attribute
 * on every element here.
 */
const TITLE = "[&_a]:after:absolute [&_a]:after:inset-0 [&_button]:after:absolute [&_button]:after:inset-0";
const OVER = "[&_a]:relative [&_a]:z-raised [&_button]:relative [&_button]:z-raised [&_input]:relative [&_input]:z-raised";
/** 48 px for the sort control, the disclosure and the checkbox's label under the touch floor (§9 rule 1). */
const touch = useTouchTargets();

const cellValue = (row: Row, key: string) => row[key];
const isSelected = (row: Row) => props.selected?.has(props.keyOf(row)) ?? false;
const isExpanded = (row: Row) => props.expanded?.has(props.keyOf(row)) ?? false;

/**
 * A column with no label is a CONTROL — an expand chevron, a "View" link — not a field (F25, US6b).
 * A table header can hold it in a narrow unlabelled cell; a card cannot, because a card names every
 * value it shows. When the qualification table's chevron came first it became the card's heading, and
 * every phone card opened with an empty row holding only the chevron. So controls sit on the card's
 * top line, beside the status, and the heading is the first column that has a name.
 */
const isControl = (col: DataTableColumn) => !col.label;
/**
 * A column counts as status when its key says so, on a table that has marked nothing. That is a
 * convention rather than a flag: a hundred column arrays exist unmarked, and the status badge is the
 * one field a person scanning a list of fills or loads is looking for.
 */
const STATUS_KEYS = /^(status|state|result|outcome|severity|disposition)$/;
/** Three, because three label-over-value cells are what 390 px holds without one wrapping (D-SM1). */
const FIGURES = 3;

/** Where every column stands on the card. See the header: marked tables are read, unmarked derived. */
const shape = computed(() => {
  const cols = props.columns;
  if (cols.some((col) => col.card !== undefined)) {
    const of = (kind: DataTableColumn["card"]) => cols.filter((col) => col.card === kind);
    const figures = of("figure");
    return {
      marked: true,
      title: of("title"),
      meta: of("meta"),
      status: of("status"),
      controls: [] as DataTableColumn[],
      sentences: of("sentence"),
      figures: figures.slice(0, FIGURES),
      details: [...figures.slice(FIGURES), ...of("detail")],
    };
  }
  const heading = cols.find((col) => !isControl(col)) ?? cols[0];
  const status = cols.find((col) => STATUS_KEYS.test(col.key) && col.key !== heading?.key);
  const body = cols.filter((col) => col.key !== heading?.key && col.key !== status?.key && !isControl(col));
  return {
    marked: false,
    title: heading ? [heading] : [],
    meta: [] as DataTableColumn[],
    status: status ? [status] : [],
    controls: cols.filter((col) => isControl(col) && col.key !== heading?.key && col.key !== status?.key),
    sentences: [] as DataTableColumn[],
    figures: body.slice(0, FIGURES),
    details: body.slice(FIGURES),
  };
});

/**
 * Which cards have their details open. Local, not in the URL and not the page's `expanded` Set: that
 * one belongs to the page's own `#expanded` row, and "I looked at this driver's phone number" is not
 * list state anybody wants restored.
 */
const openDetails = ref(new Set<string>());
const detailsOpen = (row: Row) => openDetails.value.has(props.keyOf(row));
function toggleDetails(row: Row) {
  const next = new Set(openDetails.value);
  const key = props.keyOf(row);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  openDetails.value = next;
}
/** What the closed disclosure says is behind it — the labels themselves, cut to one line. */
const detailsLabel = computed(() => shape.value.details.map((col) => col.label).join(", "));

/**
 * Sorting is a header affordance, and cards have no headers — so without this it would simply
 * disappear below 768px. Losing the ability to order a list is a functional regression, not a
 * responsive trade-off, so the sortable columns come back as an explicit control.
 */
const sortableColumns = computed(() => props.columns.filter((col) => col.sortable));

/**
 * The column ordering the cards, or null for the page's own default order. A page may name a default
 * that is no column (Fuel Cards' `assignment`): bound straight to `sort.key`, the select matched no
 * option and opened blank on a phone (2026-10-15), beside an arrow for an order no header shows.
 */
const sortedColumn = computed(() => {
  const col = sortableColumns.value.find((c) => c.key === props.sort?.key);
  return col ? { key: col.key, dir: props.sort!.dir } : null;
});

/*
 * Every card opens its row, as the table row does at a desk; the checkbox, the disclosure and the
 * actions stop their own clicks, as the table's checkbox and actions cells do. Pinned by
 * "opens the row from a tap on the full card too, but not from its menu or its checkbox".
 */

/** A stable id so the card view's controls can label themselves without colliding across tables. */
const listId = `dt-${Math.random().toString(36).slice(2, 8)}`;

/** The select picks the COLUMN; the arrow beside it flips direction, matching the header's toggle. */
function onCardSort(key: string) {
  if (!key) return;
  emit("sort", key);
}
</script>

<template>
  <!-- Narrow: one card per row. Same slots, same data, no table. -->
  <!-- The sort is one compact control at the list's edge, not a bar across it (D-SM7): the bar read
       as a second toolbar under the first, and its select stretched to the screen for a five-word
       option. -->
  <div
    v-if="sortableColumns.length"
    class="flex items-center justify-end gap-2"
    :class="boxed ? 'pb-2' : 'border-b border-edge-subtle px-4 py-2.5'"
  >
    <label class="text-xs font-medium text-ink-muted" :for="`${listId}-sort`">Sort</label>
    <select
      :id="`${listId}-sort`"
      class="max-w-[60%] rounded-control bg-surface py-1.5 pr-7 pl-2 text-sm text-ink-secondary ring-1 ring-inset ring-edge-control"
      :class="touch && 'h-12'"
      :value="sortedColumn?.key ?? ''"
      @change="onCardSort(($event.target as HTMLSelectElement).value)"
    >
      <option value="">Default order</option>
      <option v-for="col in sortableColumns" :key="col.key" :value="col.key">{{ col.label }}</option>
    </select>
    <button
      v-if="sortedColumn"
      type="button"
      class="rounded-control bg-surface px-2 py-1.5 text-sm font-medium text-ink-secondary ring-1 ring-inset ring-edge-control"
      :class="touch && 'size-12'"
      :aria-label="sortedColumn.dir === 'asc' ? 'Sorted ascending, switch to descending' : 'Sorted descending, switch to ascending'"
      @click="emit('sort', sortedColumn.key)"
    >
      {{ sortedColumn.dir === "asc" ? "↑" : "↓" }}
    </button>
  </div>

  <!-- Two-up once the LIST has 40rem, whatever the window is (D-SM6): phone landscape and the bay's
       tablet get two columns, a 390 px phone and a narrow drawer get one. Only boxed cards pair up —
       two columns of flat rows share their hairlines and read as a broken table. -->
  <div :class="boxed ? '@container' : ''">
    <ul :class="boxed ? 'grid grid-cols-1 items-start gap-2 @[40rem]:grid-cols-2' : 'divide-y divide-edge-subtle'">
      <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -- the table row's own click, which has no key handler either; a link in a cell is the keyboard's way in -->
      <component
        :is="boxed ? AppCard : 'li'"
        v-for="row in rows"
        :key="keyOf(row)"
        v-bind="boxed ? { as: 'li', padding: 'sm' } : {}"
        class="relative"
        :class="boxed ? '' : 'px-4 py-3.5'"
        data-card
        @click="emit('row-click', row)"
      >
        <div class="flex items-start gap-3">
          <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -- stops the card's click; the checkbox inside is the control -->
          <label
            v-if="selectable"
            class="-my-3 -ml-3 flex shrink-0 items-center justify-center"
            :class="[OVER, touch ? 'size-12' : 'size-10']"
            @click.stop
          >
            <input
              type="checkbox"
              class="size-4 rounded-control border-edge-control accent-brand-600"
              :checked="isSelected(row)"
              :aria-label="`Select ${String(cellValue(row, shape.title[0]?.key ?? '') ?? 'row')}`"
              @change="emit('toggle-row', row)"
            />
          </label>
          <div class="min-w-0 flex-1">
            <!-- Identifier, its one date or amount, and the status share the top line: the things a
                 scan is looking for. The identifier gives way (truncates); the others never wrap. -->
            <div class="flex items-center gap-2">
              <div
                v-for="col in shape.title"
                :key="col.key"
                :class="shape.marked ? TITLE : ''"
                class="min-w-0 flex-1 truncate text-base font-semibold text-ink"
              >
                <slot :name="`cell-${col.key}`" :row="row" :value="cellValue(row, col.key)">
                  {{ isBlank(cellValue(row, col.key)) ? "—" : cellValue(row, col.key) }}
                </slot>
              </div>
              <div v-for="col in shape.meta" :key="col.key" :class="OVER" class="shrink-0 text-sm tabular-nums text-ink-secondary">
                <slot :name="`cell-${col.key}`" :row="row" :value="cellValue(row, col.key)">
                  {{ isBlank(cellValue(row, col.key)) ? "—" : cellValue(row, col.key) }}
                </slot>
              </div>
              <div v-for="col in shape.status" :key="col.key" :class="OVER" class="shrink-0">
                <slot :name="`cell-${col.key}`" :row="row" :value="cellValue(row, col.key)">
                  {{ isBlank(cellValue(row, col.key)) ? "—" : cellValue(row, col.key) }}
                </slot>
              </div>
              <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -- a control column is its own button; this only keeps its click off the card -->
              <div v-for="col in shape.controls" :key="col.key" :class="OVER" class="shrink-0">
                <slot :name="`cell-${col.key}`" :row="row" :value="cellValue(row, col.key)" />
              </div>
            </div>

            <!-- One line of context, its parts joined by a dot: "Driving · 733 · Indianapolis, IN". A
                 line each is what made a card a form; the shop's single sentence is the same markup
                 with nothing to join. -->
            <div v-if="shape.sentences.length" :class="OVER" class="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-ink-secondary">
              <template v-for="(col, i) in shape.sentences" :key="col.key">
                <span v-if="i" class="text-ink-tertiary" aria-hidden="true">·</span>
                <div class="min-w-0">
                  <slot :name="`cell-${col.key}`" :row="row" :value="cellValue(row, col.key)">
                    {{ isBlank(cellValue(row, col.key)) ? "—" : cellValue(row, col.key) }}
                  </slot>
                </div>
              </template>
            </div>

          </div>
          <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -- stops the card's click; the menu inside is its own button -->
          <div v-if="hasActions" :class="OVER" class="relative z-raised -my-1 shrink-0" @click.stop>
            <slot name="actions" :row="row" />
          </div>
        </div>
        <!-- Under the top row and the card's FULL width — beside a checkbox and a menu the grid lost a
             quarter of the card and clipped a badge (browser pass, 2026-11-14). A fixed three-column
             grid, never a wrapping row: the wrapping row is what left the sixth figure alone on a
             line. Labels fill one grid row and values the next, so a label that takes two lines
             ("Medical expires" at 390 px) cannot push its own value below its neighbours'. -->
        <dl
          v-if="shape.figures.length"
          class="mt-3 grid auto-cols-fr grid-flow-col grid-rows-[auto_auto] gap-x-3 border-t border-edge-subtle pt-3"
          :class="OVER"
          data-card-figures
        >
          <template v-for="col in shape.figures" :key="col.key">
            <dt class="min-w-0 self-end text-2xs uppercase tracking-wide text-ink-muted [overflow-wrap:anywhere]">{{ col.label }}</dt>
            <dd class="mt-0.5 min-w-0 text-sm font-medium text-ink [overflow-wrap:anywhere]" :class="col.numeric ? 'tabular-nums' : ''">
              <slot :name="`cell-${col.key}`" :row="row" :value="cellValue(row, col.key)">
                {{ isBlank(cellValue(row, col.key)) ? "—" : cellValue(row, col.key) }}
              </slot>
            </dd>
          </template>
        </dl>

        <div v-if="isExpanded(row)" :class="OVER" class="mt-2.5">
          <slot name="expanded" :row="row" />
        </div>

        <!-- The rest (D-SM4). Hidden, not absent: find-in-page, a screen reader's cursor and the
             page tests all read it here. The label column is FIXED, so values start at one x on
             every card of every list. -->
        <template v-if="shape.details.length">
          <button
            type="button"
            class="relative z-raised mt-3 flex w-full items-center justify-between gap-3 border-t border-edge-subtle pt-2 text-left text-sm text-ink-secondary"
            :class="touch ? 'min-h-12' : 'min-h-10'"
            :aria-expanded="detailsOpen(row)"
            :aria-controls="`${listId}-details-${keyOf(row)}`"
            data-card-details-toggle
            @click.stop="toggleDetails(row)"
          >
            <span class="min-w-0 truncate">{{ detailsOpen(row) ? "Hide details" : detailsLabel }}</span>
            <AppIcon
              :icon="ChevronDownIcon"
              class="size-4 shrink-0 text-ink-tertiary"
              :class="detailsOpen(row) ? 'rotate-180' : ''"
              aria-hidden="true"
            />
          </button>
          <dl
            :id="`${listId}-details-${keyOf(row)}`"
            :hidden="!detailsOpen(row)"
            class="grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 pt-1"
            :class="[OVER, detailsOpen(row) ? 'grid' : '']"
            data-card-details
          >
            <template v-for="col in shape.details" :key="col.key">
              <dt class="truncate pt-0.5 text-2xs uppercase tracking-wide text-ink-muted">{{ col.label }}</dt>
              <dd class="min-w-0 text-sm text-ink-secondary [overflow-wrap:anywhere]" :class="col.numeric ? 'tabular-nums' : ''">
                <slot :name="`cell-${col.key}`" :row="row" :value="cellValue(row, col.key)">
                  {{ isBlank(cellValue(row, col.key)) ? "—" : cellValue(row, col.key) }}
                </slot>
              </dd>
            </template>
          </dl>
        </template>
      </component>
    </ul>
  </div>
  <!-- The pager is a row of the table's card at a desk; on the canvas it needs a surface of its own. -->
  <AppCard v-if="boxed && $slots.footer" padding="none" class="mt-2">
    <slot name="footer" />
  </AppCard>
  <slot v-else name="footer" />
</template>
