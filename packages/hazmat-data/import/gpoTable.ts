/**
 * Minimal GPO-DTD table helpers (D5 v7) — the GovInfo counterpart to `xmlTable.ts`.
 *
 * The official GovInfo CFR edition uses the GPO DTD: tables are `<GPOTABLE>`, header cells live in a
 * `<BOXHD>` as `<CHED>`, body rows are `<ROW>` with `<ENT>` cells (self-closing `<ENT/>` for empties),
 * footnotes are `<TNOTE>` (NOT rows, so they never appear as data), and footnote superscripts are `<SU>`.
 * Same tolerant, dependency-free regex approach as xmlTable.ts. Text extraction reuses xmlTable's
 * `stripTags`/`decodeEntities` so entity + whitespace handling is identical across both source formats.
 */

import { stripTags } from "./xmlTable.js";

export interface GpoCell {
  text: string;
  inner: string;
}

/** Every `<GPOTABLE>…</GPOTABLE>` block, outer tags included. */
export function extractGpoTables(xml: string): string[] {
  return xml.match(/<GPOTABLE\b[^>]*>[\s\S]*?<\/GPOTABLE>/gi) ?? [];
}

/** Inner content of every `<ROW>` in a GPOTABLE. `<TNOTE>` footnotes are not rows and are excluded. */
export function gpoRows(tableXml: string): string[] {
  return [...tableXml.matchAll(/<ROW\b[^>]*>([\s\S]*?)<\/ROW>/gi)].map((m) => m[1] ?? "");
}

/** `<ENT>` cells of one row, handling `<ENT/>` self-closing and `<ENT ...>text</ENT>`. */
export function entCells(rowInner: string): GpoCell[] {
  const out: GpoCell[] = [];
  for (const m of rowInner.matchAll(/<ENT\b[^>]*?(?:\/>|>([\s\S]*?)<\/ENT>)/gi)) {
    const inner = m[1] ?? "";
    out.push({ text: stripTags(inner), inner });
  }
  return out;
}

/** `<CHED>` header cells from the `<BOXHD>` of a GPOTABLE (column labels). */
export function boxheadCells(tableXml: string): GpoCell[] {
  const box = /<BOXHD\b[^>]*>([\s\S]*?)<\/BOXHD>/i.exec(tableXml);
  if (!box) return [];
  const out: GpoCell[] = [];
  for (const m of (box[1] ?? "").matchAll(/<CHED\b[^>]*>([\s\S]*?)<\/CHED>/gi)) {
    const inner = m[1] ?? "";
    out.push({ text: stripTags(inner), inner });
  }
  return out;
}

/** Strip GPO/HTML footnote superscripts (`<SU>…</SU>`, `<sup>…</sup>`) BEFORE text extraction. */
export function stripTagsNoSup(fragment: string): string {
  return stripTags(fragment.replace(/<(SU|sup)\b[^>]*>[\s\S]*?<\/\1>/gi, " "));
}
