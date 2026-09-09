import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanResult, TagKind } from "@silvicom/shared";

/**
 * Kind → resolver, for `SIL1:` tags (D-INV7; INVENTORY-PLAN.md step I6, the fabric half).
 *
 * ── ONE RESOLVE ENDPOINT, AND ADDING A KIND IS ONE IMPORT LINE ────────────────────────────────
 * `queue/registry.ts` is the model and the reasoning is the same: the alternative is a `switch` in
 * the route that every new kind has to be threaded through, which puts the dispatch in a file that
 * belongs to none of the modules being dispatched to. §2.10 lists the kinds the product will want —
 * `vehicle`/`trailer` for the digital truck file, `inspection` for the printed §396.17 report,
 * `document` for a DQ binder cover, `location` for a shelf, `invite` for a printed invitation — and
 * every one of them is a resolver in its owning module plus a line in `resolvers.ts`.
 *
 * ── A RESOLVER ANSWERS `null`, NOT AN ERROR, FOR A CODE IT DOES NOT HOLD ──────────────────────
 * A well-formed `AST` tag whose id belongs to no asset in this org is not a failure of the
 * resolver — it is a real answer the sheet has words for. Returning null lets the route report it
 * as `unknown_tag` alongside "no resolver for this kind", which are the same thing to the person
 * holding the phone: structure we understand, pointing at something we do not.
 */

/**
 * What a resolver is handed. The org comes from the caller's session and never from the code, which
 * is the whole boundary here: a tag id is a six-character string a stranger could type.
 */
export interface TagResolverContext {
  admin: SupabaseClient;
  orgId: string;
  /** The normalised id from `parseTag` — upper case, confusables folded. */
  id: string;
  /** The code exactly as scanned, so a result can carry it back to the screen. */
  code: string;
}

export type TagResolver = (ctx: TagResolverContext) => Promise<ScanResult | null>;

const resolvers = new Map<TagKind, TagResolver>();

export function registerTagResolver(kind: TagKind, resolver: TagResolver): void {
  resolvers.set(kind, resolver);
}

export function getTagResolver(kind: TagKind): TagResolver | undefined {
  return resolvers.get(kind);
}

export function registeredTagKinds(): TagKind[] {
  return [...resolvers.keys()];
}

/** Test/reset helper, on `clearHandlers`' model. */
export function clearTagResolvers(): void {
  resolvers.clear();
}
