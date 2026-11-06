import { z } from "zod";
import { AD_VISUAL_CHECKS } from "./brandKitContract.js";
import { AD_NAME_LANGUAGES } from "./naming.js";

/**
 * D-AD12's three checks on one creative — copy, render, visual — as the review screen (E3) shows them: one verdict
 * per format × language, with the reasons a person needs before approving what they have seen.
 *
 * ── WHAT IS READ ───────────────────────────────────────────────────────────────────────────────────
 * `ads_creatives.checks`, as compose writes it (`apps/api/src/modules/ads/compose/composeCreative.ts`):
 *   copy    `{ ok, findings? }`, a finding naming the `language` it was found in;
 *   render  `{ ok, format?, language?, findings? }`, compose stopping at the first format × language refused;
 *   visual  `{ ok, attempt?, results? }`, `results` per format (the still is shared by both languages), each a
 *           checklist answer `{ check, verdict, reason }` in the checker's own words;
 *   visual_attempts, every attempt's results, of which the last is the one that decided.
 * The schema below is that shape, read leniently (`looseObject`, optional fields) so a key compose adds later
 * does not blank the screen. A body it cannot read at all is `unreadable`, never "passed".
 *
 * ── WHAT A VERDICT MEANS ───────────────────────────────────────────────────────────────────────────
 * `passed` and `failed` are what a check said. `not_run` is a check compose never reached, because an earlier
 * one stopped it or the creative is still being made. Copy and render failures name their findings in the
 * creative's `last_error` (compose's own summary), so the screen shows that line beside the grid; visual
 * failures carry the checker's sentence per item, shown in the cell.
 */

const visualResultSchema = z.looseObject({
  check: z.enum(AD_VISUAL_CHECKS),
  verdict: z.enum(["pass", "fail", "not_applicable"]),
  reason: z.string(),
});
const visualResults = z.record(z.string(), z.array(visualResultSchema));

export const adCreativeChecksSchema = z.looseObject({
  copy: z.looseObject({ ok: z.boolean(), findings: z.array(z.looseObject({ language: z.string().optional() })).optional() }).optional(),
  render: z.looseObject({ ok: z.boolean(), format: z.string().optional(), language: z.string().optional() }).optional(),
  visual: z.looseObject({ ok: z.boolean(), results: visualResults.optional() }).optional(),
  visual_attempts: z.array(z.looseObject({ attempt: z.number(), visual: visualResults })).optional(),
});
export type AdCreativeChecks = z.infer<typeof adCreativeChecksSchema>;

export const AD_CREATIVE_CHECKS = ["copy", "render", "visual"] as const;
export type AdCreativeCheck = (typeof AD_CREATIVE_CHECKS)[number];
export type AdCheckVerdict = "passed" | "failed" | "not_run";

export interface AdCheckCell {
  check: AdCreativeCheck;
  verdict: AdCheckVerdict;
  /** The checker's own sentences for a failed visual item; empty otherwise (copy and render: see `last_error`). */
  reasons: string[];
}
export interface AdCheckRow { format: string; language: string; cells: AdCheckCell[] }
export type AdCheckGrid = { readable: true; rows: AdCheckRow[] } | { readable: false; rows: [] };

/**
 * One row per format × language. Formats are every one the creative names anywhere (its images, the visual
 * results, the render refusal), so a creative stopped before it had an image still shows where it stopped.
 */
export function creativeCheckGrid(raw: unknown, assetFormats: readonly string[]): AdCheckGrid {
  if (raw === null || raw === undefined) return { readable: true, rows: rowsFor(assetFormats, {}) };
  const parsed = adCreativeChecksSchema.safeParse(raw);
  if (!parsed.success) return { readable: false, rows: [] };
  const c = parsed.data;
  const visual = c.visual?.results ?? c.visual_attempts?.at(-1)?.visual ?? null;
  const formats = [...new Set([...assetFormats, ...Object.keys(visual ?? {}), ...(c.render?.format ? [c.render.format] : [])])];
  return { readable: true, rows: rowsFor(formats, c, visual) };
}

function rowsFor(formats: readonly string[], c: AdCreativeChecks, visual: z.infer<typeof visualResults> | null = null): AdCheckRow[] {
  const copyFailedIn = new Set((c.copy?.findings ?? []).map((f) => f.language).filter((l): l is string => Boolean(l)));
  return formats.flatMap((format) => AD_NAME_LANGUAGES.map((language): AdCheckRow => {
    const copy: AdCheckVerdict = !c.copy ? "not_run" : c.copy.ok ? "passed" : copyFailedIn.size === 0 || copyFailedIn.has(language) ? "failed" : "passed";
    const render: AdCheckVerdict = !c.render ? "not_run"
      : c.render.ok ? "passed"
      : c.render.format === format && c.render.language === language ? "failed" : "not_run";
    const items = visual?.[format];
    const fails = (items ?? []).filter((i) => i.verdict === "fail");
    const seen: AdCheckVerdict = !items ? "not_run" : fails.length > 0 ? "failed" : "passed";
    return {
      format, language,
      cells: [
        { check: "copy", verdict: copy, reasons: [] },
        { check: "render", verdict: render, reasons: [] },
        { check: "visual", verdict: seen, reasons: fails.map((f) => f.reason) },
      ],
    };
  }));
}
