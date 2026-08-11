#!/usr/bin/env node

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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

function inspectFiles(files) {
  return files.map((path) => ({
    path,
    relativePath: relative(root, path),
    source: readFileSync(path, "utf8"),
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

const pageAdoption = webPages.map((item) => ({
  page: item.relativePath.replace("apps/web/src/pages/", ""),
  pageHeader: /<PageHeader\b/.test(item.source),
  baseCardCount: countMatches(item.source, /<BaseCard\b/g),
  rawButtonCount: countMatches(item.source, /<button\b/g),
  rawInputCount: countMatches(item.source, /<input\b/g),
  rawSelectCount: countMatches(item.source, /<select\b/g),
  rawTableCount: countMatches(item.source, /<table\b/g),
}));

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
    "DispatchLoadFormPage.vue", // embedded drawer form, not a routed page
    "PlaceholderPage.vue", // unrouted scaffold
    "PublicPlacardCalculatorPage.vue", // public tool with its own public layout
    "auth/AcceptInvitePage.vue",
    "auth/DriverAppRedirectPage.vue",
    "auth/LoginPage.vue",
    "auth/PendingPage.vue",
  ]);
  const failures = [];
  const missingHeaders = pageAdoption
    .filter((page) => !page.pageHeader && !allowedHeaderExceptions.has(page.page))
    .map((page) => page.page);
  if (missingHeaders.length)
    failures.push(`routed pages without PageHeader: ${missingHeaders.join(", ")}`);
  if (inventory.summary.rawButtonsInPagesAndFeatures)
    failures.push(`${inventory.summary.rawButtonsInPagesAndFeatures} raw page/feature buttons`);
  if (inventory.summary.rawInputsInPagesAndFeatures)
    failures.push(`${inventory.summary.rawInputsInPagesAndFeatures} raw page/feature inputs`);
  if (inventory.summary.rawSelectsInPagesAndFeatures)
    failures.push(`${inventory.summary.rawSelectsInPagesAndFeatures} raw page/feature selects`);
  if (inventory.summary.visibleRawWebTables)
    failures.push(`${inventory.summary.visibleRawWebTables} visible raw web tables`);
  if (inventory.summary.rawAdminTables)
    failures.push(`${inventory.summary.rawAdminTables} raw admin tables`);
  if (inventory.summary.inkSubtleUtilities)
    failures.push(`${inventory.summary.inkSubtleUtilities} deprecated text-ink-subtle utilities`);

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
