import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "vue/compiler-sfc";

/**
 * U7's gate (APPLICATION-FIX-PLAN §4, F4 PR 1): no words typed straight into a template the driver
 * reads. Every sentence on the applicant's page goes through `APPLY_COPY`, because the page's language
 * is a read of that object — a literal in a template is English on the Spanish page for ever, and
 * nothing else would notice (the signing rail's "0 of 22 done" was, until this gate).
 *
 * It reads each template the way Vue does (`vue/compiler-sfc`) and fails on:
 * - a text node with a letter in it;
 * - a static `label`, `legend`, `hint`, `placeholder`, `title`, `alt`, `heading` or `aria-label`;
 * - a bound one of those whose expression is itself a quoted sentence (`` :aria-label="`The ${n} places`" ``).
 *
 * ⚠ The office's own screens in this folder are left out, by name and with the reason: they are the
 * carrier's staff's, in English by design (Q-AM6's ruling leaves them unchanged), and they live here
 * only because they correct the same answers. A file joins `OFFICE` only for that reason.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

const OFFICE: Readonly<Record<string, string>> = {
  "ApplicantFactsCard.vue": "the office's Applicant facts card (F3)",
  "ApplicantSsnRow.vue": "the office's SSN row on that card (Q-AM17)",
  "ApplicationReviewDrawer.vue": "the office's review drawer",
  "FactEditor.vue": "the office card's one-answer editor",
  "FactRowAdder.vue": "the office card's add-a-row control",
  "OfficeJobsSection.vue": "the office card's employment section",
  "TableRowEditor.vue": "the office card's table-row editor",
};

/** A picker whose empty box says nothing of its own shows `AppCombobox`'s default — English. */
const PICKERS = new Set(["AppCombobox", "ComboSelect"]);
const WORDED = new Set(["label", "legend", "hint", "placeholder", "title", "alt", "heading", "aria-label"]);
const QUOTED_SENTENCE = /(["'`])[^"'`]*[A-Za-z]{2,}\s[^"'`]*\1/;

type Node = {
  type: number;
  content?: string;
  props?: Array<{ type: number; name: string; value?: { content: string }; arg?: { content?: string }; exp?: { content?: string } }>;
  children?: Node[];
  branches?: Node[];
};

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return vueFiles(p);
    return p.endsWith(".vue") ? [p] : [];
  });
}

export function literalsIn(source: string): string[] {
  const { descriptor } = parse(source);
  const found: string[] = [];
  const visit = (n: Node): void => {
    if (n.type === 2 && /[A-Za-z]/.test(n.content ?? "")) found.push(`text "${n.content!.trim()}"`);
    if (n.type === 1 && PICKERS.has((n as { tag?: string }).tag ?? "")
      && !(n.props ?? []).some((p) => p.name === "placeholder" || p.arg?.content === "placeholder")) {
      found.push(`<${(n as { tag?: string }).tag}> with the picker's own English placeholder`);
    }
    for (const p of n.props ?? []) {
      if (p.type === 6 && WORDED.has(p.name) && /[A-Za-z]/.test(p.value?.content ?? "")) found.push(`${p.name}="${p.value!.content}"`);
      if (p.type === 7 && p.name === "bind" && WORDED.has(p.arg?.content ?? "") && QUOTED_SENTENCE.test(p.exp?.content ?? "")) {
        found.push(`:${p.arg!.content}="${p.exp!.content}"`);
      }
    }
    for (const c of [...(n.children ?? []), ...(n.branches ?? [])]) visit(c);
  };
  if (descriptor.template?.ast) visit(descriptor.template.ast as unknown as Node);
  return found;
}

describe("the applicant's templates (U7)", () => {
  const files = vueFiles(HERE);

  it("finds a literal of every kind it looks for, so a clean result means something", () => {
    const sample = `<template><p>Not final</p><x label="Optional" /><y :aria-label="\`The \${n} places\`" />`
      + `<z :class="'bg-surface ring-1'" /><w :label="copy.name" /><v v-if="a"><b>Take me back</b></v>`
      + `<AppCombobox :options="o" /><ComboSelect :placeholder="copy.choose" /></template>`;
    expect(literalsIn(sample)).toEqual([
      'text "Not final"', 'label="Optional"', ':aria-label="`The ${n} places`"', 'text "Take me back"',
      "<AppCombobox> with the picker's own English placeholder",
    ]);
    expect(files.length).toBeGreaterThan(60);
  });

  it("type no words a driver reads — every one comes from APPLY_COPY", () => {
    const offenders = files
      .filter((f) => !(relative(HERE, f) in OFFICE))
      .flatMap((f) => literalsIn(readFileSync(f, "utf8")).map((l) => `${relative(HERE, f)}: ${l}`));
    expect(offenders).toEqual([]);
  });

  it("leaves out only office screens that exist", () => {
    for (const name of Object.keys(OFFICE)) expect(files.map((f) => relative(HERE, f)), name).toContain(name);
  });
});
