import { registerTagResolver } from "./registry.js";
import { resolveBinTag, resolveAssetTag } from "../modules/maintenance/inventory/tagResolvers.js";

/**
 * Every kind this deployment can resolve (D-INV7; plan I6).
 *
 * ── THE ONE FILE THAT KNOWS WHICH MODULES EXIST ───────────────────────────────────────────────
 * The registry knows how to dispatch and the modules know how to answer; this is the only place
 * that knows both, which is what keeps `registry.ts` free of maintenance imports and the
 * maintenance module free of the tag route. Adding a kind is one import and one line here.
 *
 * Called once at startup, beside the queue's own handler registration.
 */
export function registerTagResolvers(): void {
  // A stock line: one part at one location, which is where a count happens.
  registerTagResolver("BIN", resolveBinTag);
  // An asset: a thing with an identity, which I7 gave `tag_code` and I10 will start printing.
  registerTagResolver("AST", resolveAssetTag);
}
