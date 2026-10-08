import { diffCanonical } from "../lib/efsCardCanonical.js";
import { UNVERSIONED_FIELDS, canonicalize, parseCardDocument, type CardDocument } from "../lib/efsCardXml.js";
import type { CardMutationContext } from "./types.js";

/**
 * Which fields of the card moved between the document the screen was drawn from and the one EFS
 * just returned — the question a `card_state_changed` refusal could not answer (2026-10-08).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────────
 * A grant on ••••7962 was refused with "This card changed in EFS since the screen was drawn" while
 * nothing about the card had visibly changed: no fill, no status change, no override since the
 * nightly sweep. The refusal then overwrote the mirror with the fresh read, so the document the
 * stale version had been computed from was gone, and "somebody changed the card" could not be told
 * apart from "EFS answers the same card differently from one read to the next". Naming the paths
 * here, BEFORE `updateMirror` replaces the old document, is what makes the next occurrence an answer
 * instead of a reconstruction.
 *
 * ── Redacted on both sides, paths only ──────────────────────────────────────────────────────────
 * The mirror keeps only `last_response_xml_redacted`, so the live document is compared through its
 * own redaction too: `redactCardXml` is deterministic, so like is compared with like and a masked
 * driver name reads the same on both sides. Only PATHS leave this function (`/header/status`,
 * `/infos/reportValue`), never values — the result reaches an audit row and the browser.
 *
 * Best effort and never throws: it decorates a refusal, and must not turn one into a 500.
 */
export interface MovedFields {
  /** Canonical paths that differ, or null when there was no stored document to compare against. */
  paths: string[] | null;
  /** True when the mirror held the very version the operator's screen sent — so the paths ARE the move. */
  mirrorWasExpected: boolean;
}

export async function movedFieldsSinceMirror(ctx: CardMutationContext, live: CardDocument): Promise<MovedFields> {
  try {
    const { data } = await ctx.admin
      .from("efs_cards")
      .select("card_version, last_response_xml_redacted")
      .eq("id", ctx.efsCardId)
      .eq("org_id", ctx.orgId)
      .maybeSingle();
    const row = data as { card_version: string | null; last_response_xml_redacted: string | null } | null;
    const mirrorWasExpected = row?.card_version === ctx.expectedVersion;
    if (!row?.last_response_xml_redacted) return { paths: null, mirrorWasExpected };
    return { paths: movedPaths(row.last_response_xml_redacted, live.redactedXml), mirrorWasExpected };
  } catch {
    return { paths: null, mirrorWasExpected: false };
  }
}

/** Pure half, so the comparison can be tested on fixtures without a database. */
export function movedPaths(storedRedactedXml: string, liveRedactedXml: string): string[] {
  const stored = canonicalize(parseCardDocument(storedRedactedXml).root, UNVERSIONED_FIELDS);
  const live = canonicalize(parseCardDocument(liveRedactedXml).root, UNVERSIONED_FIELDS);
  return diffCanonical(stored, live).map((d) => d.path);
}
