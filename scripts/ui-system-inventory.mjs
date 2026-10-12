#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const webSrc = join(root, "apps/web/src");
const adminSrc = join(root, "apps/admin/src");

function filesUnder(directory, extensions = new Set([".vue"])) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(path, extensions));
    else if (extensions.has(extname(entry.name))) result.push(path);
  }
  return result.sort();
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

/**
 * Comments are stripped before anything is counted.
 *
 * Every count below is a regex over raw text, so a comment that DESCRIBES markup was counted as
 * markup. That is not hypothetical: on 2026-08-30 a doc comment in `ProductPicker.vue` explaining
 * that the component used to render `<button role="option">` failed this gate, and the change had to
 * be reworded to appease it. A gate that punishes documenting a defect is teaching the wrong lesson,
 * and every count it produced was inflated by however many comments happened to quote a tag.
 */
function stripComments(source) {
  const blank = (comment) => comment.replace(/[^\n]/g, " ");
  return source
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (comment, prefix) =>
      prefix + " ".repeat(comment.length - prefix.length),
    );
}

/**
 * Read the SFC template as tags rather than trying to span nested components with one regex.
 *
 * This is deliberately a small scanner, not a second Vue compiler: it only needs tag ancestry and
 * quoted attributes. Respecting quotes matters because Vue expressions commonly contain `=>`, so
 * "read until the next >" would split a perfectly valid opening tag and make structural checks
 * depend on how a row-key accessor happened to be written.
 */
function templateTags(source) {
  const start = source.indexOf("<template");
  if (start === -1) return [];

  const tags = [];
  let cursor = start;
  let templateDepth = 0;
  while (cursor < source.length) {
    const open = source.indexOf("<", cursor);
    if (open === -1) break;
    const marker = source[open + 1];
    if (marker !== "/" && !/[A-Za-z]/.test(marker ?? "")) {
      cursor = open + 1;
      continue;
    }

    let quote = null;
    let close = open + 1;
    for (; close < source.length; close += 1) {
      const char = source[close];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    if (close >= source.length) break;

    const raw = source.slice(open, close + 1);
    const match = raw.match(/^<\/?\s*([A-Za-z][\w.-]*)/);
    if (!match) {
      cursor = close + 1;
      continue;
    }
    const tag = {
      name: match[1],
      raw,
      start: open,
      end: close + 1,
      closing: /^<\//.test(raw),
      selfClosing: /\/\s*>$/.test(raw),
    };
    tags.push(tag);

    if (tag.name === "template") {
      if (tag.closing) templateDepth -= 1;
      else if (!tag.selfClosing) templateDepth += 1;
      if (templateDepth === 0) break;
    }
    cursor = close + 1;
  }
  return tags;
}

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param",
  "source", "track", "wbr",
]);
const FILTER_BAR_SLOTS = new Set(["filters", "more", "actions"]);
const hasStaticBooleanAttribute = (tag, attribute) =>
  new RegExp(`\\s${attribute}(?=\\s|/?>)`).test(tag);

function templateStructureViolations(item) {
  const tags = templateTags(item.source);
  const stack = [];
  const nestedTables = [];
  const filterBarChildren = [];
  const paginationOutsideFooter = [];
  const filterBarsWithoutActiveCount = [];
  const localClearButtons = [];
  const handBuiltBulkBars = [];
  const handBuiltStatTiles = [];
  const crowdedFilterRows = [];
  const offPatternSearchCopy = [];
  const offScaleHeadings = [];
  const handBuiltLoading = [];
  const handBuiltNotices = [];
  // The applicant's flow renders in ApplyLayout with its own public typography (H5b).
  const applicantFlow = /\/features\/apply\//.test(item.relativePath);
  let previousEnd = tags[0]?.end ?? 0;
  const at = (offset) => `${item.relativePath}:${item.source.slice(0, offset).split("\n").length}`;

  for (const tag of tags.slice(1)) {
    const parent = stack.at(-1);
    // BulkActionBar owns the "N selected" strip: seven pages drew it six ways before 2026-10-12.
    if (/\}\}\s*selected\b/.test(item.source.slice(previousEnd, tag.start))) handBuiltBulkBars.push(at(previousEnd));
    // QueryState owns the loading line outside a table (D-US5): 65 were written by hand in six styles
    // on 2026-10-12. A button's own busy label ("Loading…" in place of its text) is not a page state.
    const text = item.source.slice(previousEnd, tag.start).trim();
    if (/^Loading\b[^]*(…|\.\.\.)$/.test(text) && !stack.some((entry) => /^(BaseButton|AppButton|button)$/.test(entry.name))) {
      handBuiltLoading.push(at(previousEnd));
    }
    if (parent?.name === "FilterBar" && item.source.slice(previousEnd, tag.start).trim()) {
      filterBarChildren.push(at(previousEnd));
    }

    if (tag.closing && tag.name === "template" && parent?.name === "template" && parent.primaryControls > 4) {
      crowdedFilterRows.push(at(parent.start));
    }
    if (tag.closing) {
      if (tag.name === "FilterBar") {
        const bar = stack.findLast((entry) => entry.name === "FilterBar");
        if (bar?.narrows && !/\s:?active-count\s*=/.test(bar.raw)) filterBarsWithoutActiveCount.push(at(bar.start));
      }
      const match = stack.findLastIndex((entry) => entry.name === tag.name);
      if (match !== -1) stack.splice(match);
      previousEnd = tag.end;
      continue;
    }

    if (parent?.name === "FilterBar") {
      const slot = tag.name === "template"
        ? tag.raw.match(/(?:#|v-slot:)([\w-]+)/)?.[1]
        : undefined;
      if (!slot || !FILTER_BAR_SLOTS.has(slot)) filterBarChildren.push(at(tag.start));
      if (slot === "filters" || slot === "more") parent.narrows = true;
      if (slot === "filters") tag.primaryControls = 0;
    }
    // The contract keeps 2–4 primary controls in the row (§5.5 rule 3); the rest go in #more.
    const filtersSlot = stack.findLast((entry) => entry.name === "template" && entry.primaryControls !== undefined);
    if (filtersSlot && stack.at(-1) === filtersSlot && !tag.closing) filtersSlot.primaryControls += 1;

    // Search copy names what it searches, as a sentence that trails off: "Search unit, driver…".
    const placeholder = tag.name === "FilterBar" ? tag.raw.match(/\ssearch-placeholder="([^"]*)"/)?.[1] : undefined;
    if (placeholder !== undefined && !/^Search \S.*…$/.test(placeholder)) offPatternSearchCopy.push(at(tag.start));

    // FilterBar owns "Clear filters" (one place, one look, one meaning: every filter and the search,
    // never the sort). A page drawing its own is the drift the 2026-10-12 audit counted nine times.
    if (!tag.selfClosing && /^(BaseButton|AppButton)$/.test(tag.name)) {
      const close = item.source.indexOf("<", tag.end);
      const text = item.source.slice(tag.end, close === -1 ? undefined : close).trim();
      if (/^(Clear (all )?filters|Reset filters|Clear all)$/i.test(text) && close !== -1 &&
          item.source.startsWith(`</${tag.name}`, close)) {
        localClearButtons.push(at(tag.start));
      }
    }

    // AppCallout owns the tinted notice (D-US3): `bg-<tone>-50` with a `ring-1` is its exact recipe,
    // and 36 of them were written by hand in at least five variants on 2026-10-12.
    if (/^(div|p|section|aside)$/.test(tag.name) &&
        /\sclass="[^"]*\bbg-(brand|info|caution|warning|danger|success)-50\b[^"]*"/.test(tag.raw) &&
        /\sclass="[^"]*\bring-1\b[^"]*"/.test(tag.raw)) {
      handBuiltNotices.push(at(tag.start));
    }

    // StatCard owns the KPI tile: a `<dd>` set at display size is a figure under a label, drawn by
    // hand. Thirty-three of them across seven files mixed bold and semibold, three label styles
    // and three ways to tint a verdict before 2026-10-12.
    if (tag.name === "dd" && /class="[^"]*\btext-(2|3)xl\b/.test(tag.raw)) handBuiltStatTiles.push(at(tag.start));

    // Two heading sizes (2026-10-12 owner ruling): `text-lg` for a section of the page, `text-sm` for
    // a title inside a card, drawer or panel — both `font-semibold`. An eyebrow (`text-xs uppercase`)
    // is a label rather than a heading and is left alone. The audit that day found seven variants.
    const headingClass = /^h[23]$/.test(tag.name) && !applicantFlow ? tag.raw.match(/\sclass="([^"]*)"/)?.[1] : undefined;
    if (headingClass !== undefined) {
      const eyebrow = /\btext-xs\b/.test(headingClass) && /\buppercase\b/.test(headingClass);
      const onScale = /\btext-(sm|lg)\b/.test(headingClass) && /\bfont-semibold\b/.test(headingClass);
      if (!eyebrow && !onScale) offScaleHeadings.push(at(tag.start));
    }

    if (tag.name === "DataTable" && stack.some((entry) => entry.name === "BaseCard") &&
        !hasStaticBooleanAttribute(tag.raw, "embedded")) {
      nestedTables.push(at(tag.start));
    }

    if (tag.name === "TablePagination") {
      const tableIndex = stack.findLastIndex((entry) => entry.name === "DataTable");
      const inFooter = tableIndex !== -1 && stack.slice(tableIndex + 1).some((entry) =>
        entry.name === "template" && /(?:#|v-slot:)footer\b/.test(entry.raw),
      );
      if (!inFooter) paginationOutsideFooter.push(at(tag.start));
    }

    if (!tag.selfClosing && !VOID_ELEMENTS.has(tag.name.toLowerCase())) stack.push(tag);
    previousEnd = tag.end;
  }

  return {
    nestedTables,
    filterBarChildren,
    paginationOutsideFooter,
    filterBarsWithoutActiveCount,
    localClearButtons,
    handBuiltBulkBars,
    handBuiltStatTiles,
    crowdedFilterRows,
    offPatternSearchCopy,
    offScaleHeadings,
    handBuiltLoading,
    handBuiltNotices,
  };
}

/**
 * Find `key: "actions"` only in arrays actually supplied to a DataTable's `columns` prop.
 * A plain text scan is too broad: command catalogues and router metadata may legitimately have an
 * object whose key happens to be `actions`, and neither one declares a table column.
 */
function manualActionColumnViolations(item) {
  const columnBindings = new Set();
  for (const tag of templateTags(item.source)) {
    if (tag.name !== "DataTable" || tag.closing) continue;
    const value = tag.raw.match(/\s:columns\s*=\s*["']([^"']+)["']/)?.[1];
    if (value) {
      const expression = ts.createSourceFile(
        "columns.ts",
        `const __columns = (${value});`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const collect = (node) => {
        if (ts.isIdentifier(node)) columnBindings.add(node.text);
        ts.forEachChild(node, collect);
      };
      const declaration = expression.statements[0]?.declarationList?.declarations?.[0];
      if (declaration?.initializer) collect(declaration.initializer);
    } else if (/\s:columns(?=\s|\/?>)/.test(tag.raw)) columnBindings.add("columns");
  }
  if (!columnBindings.size) return [];

  const scriptOpen = item.source.match(/<script\b[^>]*>/);
  if (!scriptOpen || scriptOpen.index == null) return [];
  const scriptStart = scriptOpen.index + scriptOpen[0].length;
  const scriptEnd = item.source.indexOf("</script>", scriptStart);
  if (scriptEnd === -1) return [];
  const script = item.source.slice(scriptStart, scriptEnd);
  const sourceFile = ts.createSourceFile(
    item.relativePath,
    script,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations = [];
  const at = (offset) => `${item.relativePath}:${item.source.slice(0, offset).split("\n").length}`;

  const actionKeyInColumnArray = (initializer) => {
    let actionKey = null;
    const visit = (node) => {
      if (actionKey) return;
      if (ts.isObjectLiteralExpression(node) && ts.isArrayLiteralExpression(node.parent)) {
        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const propertyName = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
            ? property.name.text
            : property.name?.getText(sourceFile);
          if (propertyName !== "key") continue;
          if (ts.isStringLiteralLike(property.initializer) && property.initializer.text === "actions") {
            actionKey = property.initializer;
            return;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(initializer);
    return actionKey;
  };

  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        columnBindings.has(node.name.text) && node.initializer) {
      const actionKey = actionKeyInColumnArray(node.initializer);
      if (actionKey) violations.push(at(scriptStart + actionKey.getStart(sourceFile)));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function structureCheckerSelfTest() {
  const item = {
    relativePath: "self-test.vue",
    source: stripComments(`<script setup lang="ts">
      const columns = [{ key: "name", label: "Name" }, { key: "actions", label: "" }];
      const unrelated = { key: "actions", command: "archive" };
    </script>
    <!-- This multiline comment must not shift the diagnostic lines below.
         It deliberately occupies two lines. -->
    <template>
      <div>
        <BaseCard><DataTable :row-key="(row) => row.id" /></BaseCard>
        <BaseCard><DataTable :embedded="false" /></BaseCard>
        <BaseCard><DataTable :embedded="isCompact" /></BaseCard>
        <BaseCard><DataTable not-embedded /></BaseCard>
        <BaseCard><DataTable embedded /></BaseCard>
        <FilterBar><AppSegmentedControl /></FilterBar>
        <DataTable :columns="columns"><template #footer><TablePagination /></template></DataTable>
        <TablePagination />
        <FilterBar><template #filters><FilterSelect /></template></FilterBar>
        <FilterBar :active-count="n"><template #more><FilterSelect /></template></FilterBar>
        <FilterBar v-model:search="q" />
        <BaseButton variant="ghost">Clear filters</BaseButton>
        <BaseButton>Clear</BaseButton>
        <div class="bg-brand-50"><span>{{ picked.size }} selected</span></div>
        <BulkActionBar :count="picked.size" />
        <dl><dt>Fills</dt><dd class="mt-1 text-2xl font-bold">12</dd><dd class="text-xs">caption</dd></dl>
        <FilterBar :active-count="n" search-placeholder="Search"><template #filters><A /><B /><C /><D /><E /></template></FilterBar>
        <FilterBar :active-count="n" search-placeholder="Search unit, driver…"><template #filters><A /><B /><C /><D /></template></FilterBar>
        <h3 class="text-base font-semibold text-ink">Card</h3><h3 class="text-sm font-semibold">Ok</h3><h2 class="text-xs font-semibold uppercase">Eyebrow</h2>
        <p v-if="isLoading" class="text-sm text-ink-muted">Loading the part…</p><BaseButton>Loading…</BaseButton>
        <p class="rounded-surface bg-danger-50 px-4 py-3 ring-1 ring-danger-100">Could not load.</p><tr class="bg-brand-50"></tr>
      </div>
    </template>`),
  };
  const result = templateStructureViolations(item);
  const actionColumns = manualActionColumnViolations(item);
  const legitimateItem = {
    relativePath: "legitimate-self-test.vue",
    source: `<script setup lang="ts">
      const columns = [{ key: "name", label: "Name" }];
      const unrelated = { key: "actions", command: "archive" };
    </script>
    <template><DataTable :columns="columns" /></template>`,
  };
  const passed = JSON.stringify(result.nestedTables) === JSON.stringify([
    "self-test.vue:9",
    "self-test.vue:10",
    "self-test.vue:11",
    "self-test.vue:12",
  ]) &&
    result.filterBarChildren[0] === "self-test.vue:14" &&
    result.paginationOutsideFooter[0] === "self-test.vue:16" &&
    JSON.stringify(result.filterBarsWithoutActiveCount) === JSON.stringify(["self-test.vue:17"]) &&
    JSON.stringify(result.localClearButtons) === JSON.stringify(["self-test.vue:20"]) &&
    JSON.stringify(result.handBuiltBulkBars) === JSON.stringify(["self-test.vue:22"]) &&
    JSON.stringify(result.handBuiltStatTiles) === JSON.stringify(["self-test.vue:24"]) &&
    JSON.stringify(result.crowdedFilterRows) === JSON.stringify(["self-test.vue:25"]) &&
    JSON.stringify(result.offPatternSearchCopy) === JSON.stringify(["self-test.vue:25"]) &&
    JSON.stringify(result.offScaleHeadings) === JSON.stringify(["self-test.vue:27"]) &&
    JSON.stringify(result.handBuiltLoading) === JSON.stringify(["self-test.vue:28"]) &&
    JSON.stringify(result.handBuiltNotices) === JSON.stringify(["self-test.vue:29"]) &&
    actionColumns.length === 1 && actionColumns[0] === "self-test.vue:2" &&
    manualActionColumnViolations(legitimateItem).length === 0;
  if (!passed) {
    console.error("UI structure checker regression fixture details:", {
      ...result,
      actionColumns,
      legitimateActionColumns: manualActionColumnViolations(legitimateItem),
    });
  }
  return passed;
}

function inspectFiles(files) {
  return files.map((path) => ({
    path,
    relativePath: relative(root, path),
    source: stripComments(readFileSync(path, "utf8")),
  }));
}

function total(items, pattern) {
  return items.reduce((sum, item) => sum + countMatches(item.source, pattern), 0);
}

const webVue = inspectFiles(filesUnder(webSrc));
const webUiSource = inspectFiles(filesUnder(webSrc, new Set([".vue", ".ts", ".css"])));
const adminVue = inspectFiles(filesUnder(adminSrc));
const webPages = webVue.filter((item) => item.relativePath.startsWith("apps/web/src/pages/"));
const adminPages = adminVue.filter((item) => item.relativePath.startsWith("apps/admin/src/pages/"));
const pagesAndFeatures = webVue.filter(
  (item) =>
    item.relativePath.startsWith("apps/web/src/pages/") ||
    item.relativePath.startsWith("apps/web/src/features/"),
);
const structureViolations = pagesAndFeatures.map(templateStructureViolations);
const nestedTables = structureViolations.flatMap((item) => item.nestedTables);
const filterBarChildren = structureViolations.flatMap((item) => item.filterBarChildren);
const paginationOutsideFooter = structureViolations.flatMap((item) => item.paginationOutsideFooter);
const filterBarsWithoutActiveCount = structureViolations.flatMap((item) => item.filterBarsWithoutActiveCount);
const localClearButtons = structureViolations.flatMap((item) => item.localClearButtons);
const handBuiltBulkBars = structureViolations.flatMap((item) => item.handBuiltBulkBars);
const handBuiltStatTiles = structureViolations.flatMap((item) => item.handBuiltStatTiles);
const crowdedFilterRows = structureViolations.flatMap((item) => item.crowdedFilterRows);
const offPatternSearchCopy = structureViolations.flatMap((item) => item.offPatternSearchCopy);
const offScaleHeadings = structureViolations.flatMap((item) => item.offScaleHeadings);
/**
 * A site that matches a rule's recipe without being what the rule is about says so where it stands:
 * a comment ending on the line above it (or on its own line) reading `ui-adoption: not-a-notice — <why>`
 * or `ui-adoption: not-a-page-state — <why>`. Read from the raw file, since every check here strips
 * comments; a marker with no reason exempts nothing. On 2026-10-12 three sites earned it: a decline's
 * record panel (structured content on a tint, not a sentence about the page), and an upload's progress
 * line and per-file failure list (feedback on a file drop, not a fetch and not a page notice).
 */
const siteMarked = (location, kind, rawOf = (path) => readFileSync(join(root, path), "utf8")) => {
  const [path, line] = [location.slice(0, location.lastIndexOf(":")), Number(location.slice(location.lastIndexOf(":") + 1))];
  const lines = rawOf(path).split("\n");
  const near = lines.slice(Math.max(0, line - 3), line).join("\n");
  return new RegExp(`ui-adoption: ${kind}\\s+—\\s+\\S`).test(near);
};
const handBuiltLoading = structureViolations.flatMap((item) => item.handBuiltLoading).filter((at) => !siteMarked(at, "not-a-page-state"));
const handBuiltNotices = structureViolations.flatMap((item) => item.handBuiltNotices).filter((at) => !siteMarked(at, "not-a-notice"));
function siteMarkerSelfTest() {
  const raw = ["<div>", "  <!-- ui-adoption: not-a-notice — a record panel -->", "  <div class=\"bg-danger-50 ring-1\">", "  <!-- ui-adoption: not-a-notice -->", "  <p class=\"bg-info-50 ring-1\">x</p>"].join("\n");
  const rawOf = () => raw;
  return siteMarked("f.vue:3", "not-a-notice", rawOf) && !siteMarked("f.vue:5", "not-a-notice", rawOf) &&
    !siteMarked("f.vue:3", "not-a-page-state", rawOf);
}
const manualActionColumns = pagesAndFeatures.flatMap(manualActionColumnViolations);

/**
 * A filtered list keeps its filters and its sort in the URL (2026-10-12 owner ruling, UI-STANDARDIZATION
 * D-US2).
 *
 * ── WHY THE URL AND NOT A ref ───────────────────────────────────────────────────────────────────
 * The audit that day found 30 of 44 filtered lists holding their filters in component state, so a
 * reload, a link pasted into a ticket and Back from a row's detail page all opened the list unfiltered,
 * page 1, default sort — while the other 14 kept all three. Which list remembers is not something a
 * reader can predict, so the rule is the same for all of them: `useQueryState` (directly, or through a
 * composable the file imports), and `useUrlSort` rather than a `ref<SortState>`.
 *
 * A list with a real reason to forget — a list inside a drawer that closing should reset — says so
 * with the marker `ui-adoption: list-state-local — <why>` in a comment, which is read from the raw
 * file because every other check here strips comments first.
 */
const LIST_STATE_LOCAL = /ui-adoption: list-state-local\s+—\s+\S/;
const resolvedImports = (path, source) =>
  [...source.matchAll(/from\s+["']((?:@\/|\.{1,2}\/)[^"']+)["']/g)]
    .map(([, spec]) => (spec.startsWith("@/") ? join(webSrc, spec.slice(2)) : resolve(dirname(path), spec)))
    .flatMap((base) => [base, `${base}.ts`, `${base}/index.ts`])
    .filter((candidate) => /\.(ts|vue)$/.test(candidate) && existsSync(candidate));
function readsQueryState(path, source, depth = 2) {
  if (/\buseQueryState\(/.test(source)) return true;
  if (depth === 0) return false;
  return resolvedImports(path, source).some((dep) =>
    !/\/components\/ui\/|\/composables\/useQueryState\.ts$/.test(dep) &&
    readsQueryState(dep, stripComments(readFileSync(dep, "utf8")), depth - 1),
  );
}
function listStateViolations(item) {
  if (!/<FilterBar\b/.test(item.source)) return { filters: [], sorts: [] };
  if (LIST_STATE_LOCAL.test(item.raw ?? readFileSync(item.path, "utf8"))) return { filters: [], sorts: [] };
  return {
    filters: readsQueryState(item.path, item.source) ? [] : [item.relativePath],
    sorts: /\bref<SortState>\(/.test(item.source) ? [item.relativePath] : [],
  };
}
function listStateSelfTest() {
  const fixture = (source) => ({ path: join(webSrc, "self-test.vue"), relativePath: "self-test.vue", source, raw: source });
  const local = listStateViolations(fixture(`<script setup>const sort = ref<SortState>({ key: null });</script><template><FilterBar /></template>`));
  const url = listStateViolations(fixture(`<script setup>const qs = useQueryState();</script><template><FilterBar /></template>`));
  const noBar = listStateViolations(fixture(`<template><DataTable /></template>`));
  const marked = listStateViolations(fixture(`<!-- ui-adoption: list-state-local — a drawer's list --><template><FilterBar /></template>`));
  const bareMark = listStateViolations(fixture(`<!-- ui-adoption: list-state-local --><template><FilterBar /></template>`));
  return local.filters.length === 1 && local.sorts.length === 1 && url.filters.length === 0 &&
    noBar.filters.length === 0 && marked.filters.length === 0 && bareMark.filters.length === 1;
}
const listState = pagesAndFeatures.map(listStateViolations);
const localListFilters = listState.flatMap((item) => item.filters);
const localListSorts = listState.flatMap((item) => item.sorts);

/**
 * Pages whose ROUTE asks for the full-bleed outlet (D-DR5, DESIGN-REFRESH-2026-09.md §4).
 *
 * They are exempt from the `PageHeader` rule below, and the exemption is DERIVED rather than typed
 * into the hand-written list beside it. `meta.fullBleed` already decides that `AppShell` gives the
 * page the whole content area with no gutters and a height; a page with no gutters has nowhere to
 * put a header, and naming the file in two places would let the route and the gate disagree the
 * first time a second page went full bleed.
 *
 * ⚠ The window trick is exact rather than approximate: every route record in `router/routes/*.ts`
 * writes `component:` before `meta:` (checked across all 78 of them, 2026-09-16), so the text from
 * one `component:` to the next is one route and nothing else. If that ever stops being true this
 * reads a neighbour's meta, so the shape is asserted here rather than assumed — a record whose meta
 * precedes its component is a parse failure, not a silent exemption.
 */
function fullBleedPages() {
  const pages = new Set();
  for (const path of filesUnder(join(webSrc, "router/routes"), new Set([".ts"]))) {
    const source = stripComments(readFileSync(path, "utf8"));
    const records = source.split(/component:/).slice(1);
    for (const record of records) {
      const component = record.match(/import\("@\/pages\/([^"]+)"\)/);
      if (!component) continue;
      const meta = record.match(/meta:\s*\{([\s\S]*?)\}/);
      if (meta && /\bfullBleed:\s*true\b/.test(meta[1])) pages.add(component[1]);
    }
  }
  return pages;
}

const fullBleed = fullBleedPages();

const pageAdoption = webPages.map((item) => ({
  page: item.relativePath.replace("apps/web/src/pages/", ""),
  pageHeader: /<PageHeader\b/.test(item.source),
  /** D-DR5: the shell gives this page the whole outlet, so there is no band for a header. */
  fullBleed: fullBleed.has(item.relativePath.replace("apps/web/src/pages/", "")),
  baseCardCount: countMatches(item.source, /<BaseCard\b/g),
  rawButtonCount: countMatches(item.source, /<button\b/g),
  rawInputCount: countMatches(item.source, /<input\b/g),
  rawSelectCount: countMatches(item.source, /<select\b/g),
  rawTableCount: countMatches(item.source, /<table\b/g),
}));

/**
 * `AppTable` in the web app is a raw table with a different name (D-US4, UI-STANDARDIZATION.md).
 *
 * It is `@silvicom/ui`'s bare `<table>` wrapper — the admin console's table — and in the web app it was
 * how a table got past the raw-table count above: on 2026-10-12 six web files used it, each with its
 * own hand-written header (five recipes). The web's table is `DataTable`, and a small table inside a
 * drawer or panel is `DataTable embedded dense`. The one exception is a published legal document,
 * which renders in `PublicLayout` with document typography rather than data-table chrome.
 */
const APP_TABLE_ALLOWED = new Set(["apps/web/src/pages/legal/PrivacyPolicyPage.vue"]);
const webAppTables = pagesAndFeatures
  .filter((item) => /<AppTable\b/.test(item.source) && !APP_TABLE_ALLOWED.has(item.relativePath))
  .map((item) => item.relativePath);

const rawTableFiles = pagesAndFeatures
  .map((item) => ({
    file: item.relativePath,
    total: countMatches(item.source, /<table\b/g),
    screenReaderOnly: countMatches(item.source, /<table\s+class=["'][^"']*\bsr-only\b[^"']*["']/g),
  }))
  .filter((item) => item.total > 0)
  .map((item) => ({ ...item, visible: item.total - item.screenReaderOnly }));

const inventory = {
  generatedFrom: ["apps/web/src/**/*.vue", "apps/admin/src/**/*.vue"],
  summary: {
    webPages: webPages.length,
    adminPages: adminPages.length,
    pagesUsingPageHeader: pageAdoption.filter((item) => item.pageHeader).length,
    pagesWithoutPageHeader: pageAdoption.filter((item) => !item.pageHeader).length,
    baseCardInstances: total(webVue, /<BaseCard\b/g),
    radiusUtilities: total(webVue, /\brounded(?:-[a-z0-9.[\]-]+)?\b/g),
    textSmUtilities: total(webVue, /\btext-sm\b/g),
    textXsUtilities: total(webVue, /\btext-xs\b/g),
    inkSubtleUtilities: total(webUiSource, /\btext-ink-subtle\b/g),
    smallInkSubtleLines: webUiSource.reduce(
      (sum, item) =>
        sum +
        item.source
          .split("\n")
          .filter((line) =>
            /(?:text-(?:xs|\[1[12]px\]).*text-ink-subtle|text-ink-subtle.*text-(?:xs|\[1[12]px\]))/.test(
              line,
            ),
          ).length,
      0,
    ),
    rawButtonsInPagesAndFeatures: total(pagesAndFeatures, /<button\b/g),
    rawInputsInPagesAndFeatures: total(pagesAndFeatures, /<input\b/g),
    rawSelectsInPagesAndFeatures: total(pagesAndFeatures, /<select\b/g),
    rawWebTables: rawTableFiles.reduce((sum, item) => sum + item.total, 0),
    visibleRawWebTables: rawTableFiles.reduce((sum, item) => sum + item.visible, 0),
    screenReaderTableFallbacks: rawTableFiles.reduce((sum, item) => sum + item.screenReaderOnly, 0),
    rawAdminTables: total(adminVue, /<table\b/g),
  },
  pageAdoption,
  rawTableFiles,
};

function verifyAdoption() {
  const allowedHeaderExceptions = new Set([
    "PlaceholderPage.vue", // unrouted scaffold
    "PublicPlacardCalculatorPage.vue", // public tool with its own public layout
    // H5b: the applicant's own §391.21 form. `PageHeader` carries the app's breadcrumb and
    // route-title chrome, and this page is rendered in ApplyLayout for somebody with no session and
    // no app around them — there is no workspace for a header to sit in.
    // (The breadcrumb half of that sentence was aspirational until G2 shipped it on 2026-08-25;
    // `PageHeader` now walks `meta.parent` via `lib/breadcrumbs.ts`. It is true as written.)
    "ApplyPage.vue",
    "auth/AcceptInvitePage.vue",
    "auth/DriverAppRedirectPage.vue",
    // 0363: both render in AuthLayout beside LoginPage, for somebody who cannot sign in — the same
    // no-workspace reason as the four auth pages around them.
    "auth/ForgotPasswordPage.vue",
    "auth/LoginPage.vue",
    "auth/PendingPage.vue",
    "auth/ResetPasswordPage.vue",
    // P3's three published documents. Same reason as the placard calculator directly above: they
    // render in `PublicLayout` for a driver or a store reviewer with no session, so there is no
    // workspace for a header to sit in and no breadcrumb trail to walk. `LegalDocument.vue` gives
    // them their own heading, version and effective date — the chrome a document needs rather than
    // the chrome a data page needs.
    // I5 PR 2b's count and I9's check. The route component renders NO header of its own by design:
    // it reads the session's kind and hands off to `ShelfWalk.vue` or `UnitCheck.vue`, and each of
    // those renders the `PageHeader` — because only the body knows the title (the shelf, or "Truck
    // 654") and the progress line that is its description. Since 2026-09-10 (D-INV17 as amended)
    // the page renders in `AppShell` like every other desk page; the exemption is about WHICH file
    // carries the header, not whether one is there.
    "CountSessionPage.vue",
    // I6's scan surface — the one `ShopLayout` page since the count left the shell, exempt because
    // that shell has no workspace for a header and for one more reason of its own. `PageHeader`'s actions row is
    // where a page puts what it can do, and on this screen what can be done is decided by what was
    // just scanned: the verbs live on the result and change with every trigger pull. A fixed header
    // of actions would either be empty or be wrong.
    "ScanPage.vue",
    "legal/PrivacyPolicyPage.vue",
    "legal/SupportPage.vue",
    "legal/TermsPage.vue",
    // SMS-OPT-IN-PLAN D-SMS4 — the fourth published document, for P3's reason above: `PublicLayout`,
    // no session, and `LegalDocument.vue` as its chrome. A carrier-network reviewer opens it from the
    // opt-in screenshot.
    "legal/SmsTermsPage.vue",
  ]);
  const failures = [];
  if (!structureCheckerSelfTest()) failures.push("UI structure checker failed its regression fixture");
  if (!listStateSelfTest()) failures.push("list-state checker failed its regression fixture");
  if (!siteMarkerSelfTest()) failures.push("site-marker checker failed its regression fixture");
  if (localListFilters.length)
    failures.push(`filtered list holding its filters outside the URL (useQueryState, or mark ui-adoption: list-state-local — <why>): ${localListFilters.join(", ")}`);
  if (localListSorts.length)
    failures.push(`filtered list holding its sort in a ref (useUrlSort): ${localListSorts.join(", ")}`);
  const missingHeaders = pageAdoption
    .filter((page) => !page.pageHeader && !page.fullBleed && !allowedHeaderExceptions.has(page.page))
    .map((page) => page.page);
  if (missingHeaders.length)
    failures.push(`routed pages without PageHeader: ${missingHeaders.join(", ")}`);
  if (inventory.summary.rawButtonsInPagesAndFeatures)
    failures.push(`${inventory.summary.rawButtonsInPagesAndFeatures} raw page/feature buttons`);
  if (inventory.summary.rawInputsInPagesAndFeatures)
    failures.push(`${inventory.summary.rawInputsInPagesAndFeatures} raw page/feature inputs`);
  if (inventory.summary.rawSelectsInPagesAndFeatures)
    failures.push(`${inventory.summary.rawSelectsInPagesAndFeatures} raw page/feature selects`);
  if (webAppTables.length)
    failures.push(`AppTable in the web app (use DataTable; embedded dense inside a drawer or panel): ${webAppTables.join(", ")}`);
  if (inventory.summary.visibleRawWebTables)
    failures.push(`${inventory.summary.visibleRawWebTables} visible raw web tables`);
  if (inventory.summary.rawAdminTables)
    failures.push(`${inventory.summary.rawAdminTables} raw admin tables`);
  if (inventory.summary.inkSubtleUtilities)
    failures.push(`${inventory.summary.inkSubtleUtilities} deprecated text-ink-subtle utilities`);
  if (nestedTables.length)
    failures.push(`non-embedded DataTable nested in BaseCard: ${nestedTables.join(", ")}`);
  if (filterBarChildren.length)
    failures.push(`FilterBar content outside #filters/#more/#actions: ${filterBarChildren.join(", ")}`);
  if (paginationOutsideFooter.length)
    failures.push(`TablePagination outside DataTable #footer: ${paginationOutsideFooter.join(", ")}`);
  if (filterBarsWithoutActiveCount.length)
    failures.push(`FilterBar with #filters/#more but no :active-count (it owns Clear filters): ${filterBarsWithoutActiveCount.join(", ")}`);
  if (localClearButtons.length)
    failures.push(`hand-built Clear filters button (pass :active-count to FilterBar instead): ${localClearButtons.join(", ")}`);
  if (crowdedFilterRows.length)
    failures.push(`FilterBar #filters with more than 4 controls (move the rest to #more): ${crowdedFilterRows.join(", ")}`);
  if (offPatternSearchCopy.length)
    failures.push(`FilterBar search-placeholder not "Search <what>…": ${offPatternSearchCopy.join(", ")}`);
  if (offScaleHeadings.length)
    failures.push(`h2/h3 off the two-size scale (text-lg page section, text-sm in a card or drawer; font-semibold): ${offScaleHeadings.join(", ")}`);
  if (handBuiltLoading.length)
    failures.push(`hand-written loading line (use QueryState): ${handBuiltLoading.join(", ")}`);
  if (handBuiltNotices.length)
    failures.push(`hand-tinted notice, bg-<tone>-50 with ring-1 (use AppCallout): ${handBuiltNotices.join(", ")}`);
  if (handBuiltStatTiles.length)
    failures.push(`hand-built KPI tile, a <dd> at text-2xl/3xl (use StatCard): ${handBuiltStatTiles.join(", ")}`);
  if (handBuiltBulkBars.length)
    failures.push(`hand-built "N selected" strip (use BulkActionBar): ${handBuiltBulkBars.join(", ")}`);
  if (manualActionColumns.length)
    failures.push(`manual DataTable actions columns (use #actions): ${manualActionColumns.join(", ")}`);

  const cloneNames = [
    "BaseButton.vue",
    "BaseCard.vue",
    "BaseInput.vue",
    "BaseCheckbox.vue",
    "BaseSwitch.vue",
    "ComboSelect.vue",
    "FormField.vue",
  ];
  const clones = webVue.filter((file) =>
    cloneNames.some((name) => file.relativePath.endsWith(`/ui/${name}`)),
  );
  const rootClones = webVue.filter((file) =>
    file.relativePath.endsWith("/components/SearchInput.vue"),
  );
  clones.push(...rootClones);
  if (clones.length)
    failures.push(`local primitive clones: ${clones.map((file) => file.relativePath).join(", ")}`);

  /**
   * Every barrel export must have a caller (D-DS8).
   *
   * ── Why this is a build failure and not a tidy-up ───────────────────────────────────────────────
   * A barrel is a promise: it says these are the pieces the system is made of. Four of them were not
   * — AppNumberField and AppInputGroup were whole components nothing rendered, AppSurface and
   * AppTextField were aliases for AppCard and AppInput that nobody ever used the second name for.
   * Dead exports are worse than dead files, because they read as choices: the next author picks one,
   * finds no precedent for how it is meant to be used, and invents one.
   *
   * A component used only INSIDE packages/ui counts as alive — AppIconButton has no app call site
   * but three internal ones, and it is a real primitive, not a leftover.
   */
  const barrel = readFileSync(join(root, "packages/ui/src/index.ts"), "utf8");
  const exported = [...barrel.matchAll(/export \{ default as (App[A-Za-z]+) \}/g)].map((m) => m[1]);
  const consumers = [
    ...inspectFiles(filesUnder(webSrc, new Set([".vue", ".ts"]))),
    ...inspectFiles(filesUnder(adminSrc, new Set([".vue", ".ts"]))),
    ...inspectFiles(filesUnder(join(root, "packages/ui/src/components"), new Set([".vue", ".ts"]))),
  ];
  const dead = exported.filter((name) => {
    const used = new RegExp(`\\b${name}\\b`);
    return !consumers.some((file) => used.test(file.source));
  });
  if (dead.length)
    failures.push(`exports with no caller anywhere: ${dead.join(", ")}`);

  if (failures.length) {
    console.error("✗ UI adoption contract failed:");
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log(
    `✓ UI adoption contract ok — shared controls only; 0 visible raw tables; ${inventory.summary.screenReaderTableFallbacks} documented chart fallbacks`,
  );
}

function renderMarkdown() {
  const summaryRows = Object.entries(inventory.summary)
    .map(([measure, value]) => `| \`${measure}\` | ${value} |`)
    .join("\n");
  const pageRows = inventory.pageAdoption
    .map(
      (page) =>
        `| \`${page.page}\` | ${page.pageHeader ? "Yes" : "No"} | ${page.baseCardCount} | ${page.rawButtonCount} | ${page.rawInputCount} | ${page.rawSelectCount} | ${page.rawTableCount} |`,
    )
    .join("\n");
  const tableRows = inventory.rawTableFiles
    .map(
      (item) => `| \`${item.file}\` | ${item.total} | ${item.visible} | ${item.screenReaderOnly} |`,
    )
    .join("\n");
  return `# FuelGuard UI component adoption baseline

Generated from the current Vue source with \`pnpm audit:ui -- --markdown\`. Re-run the command after each migration slice; this file is a review baseline, while the command output is the live inventory.

## Summary

| Measure | Count |
|---|---:|
${summaryRows}

## Web page adoption

Raw-element counts are evidence for review, not automatic defects. Auth/public pages and screen-reader fallbacks may be documented exceptions.

| Page | PageHeader | BaseCard | Raw button | Raw input | Raw select | Raw table |
|---|---:|---:|---:|---:|---:|---:|
${pageRows}

## Raw table classification

| File | Total | Visible | Screen-reader fallback |
|---|---:|---:|---:|
${tableRows}
`;
}

if (process.argv.includes("--write-markdown")) {
  const output = join(root, "docs/UI-COMPONENT-ADOPTION.md");
  writeFileSync(output, renderMarkdown());
  console.log(`✓ wrote ${relative(root, output)}`);
} else if (process.argv.includes("--check")) verifyAdoption();
else if (process.argv.includes("--markdown")) console.log(renderMarkdown());
else if (process.argv.includes("--summary"))
  console.log(JSON.stringify(inventory.summary, null, 2));
else console.log(JSON.stringify(inventory, null, 2));
