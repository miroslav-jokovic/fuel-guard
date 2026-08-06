/**
 * @hazmat/placards — DOT placard artwork keyed to the engine's `PlacardName`. Given a placard the
 * engine says is required, this returns its exact §172.5xx diamond as an SVG string for display in the
 * web dashboard (Vue) or the driver app (react-native-svg). Framework-agnostic, zero runtime deps.
 */

import type { PlacardName } from "@hazmat/engine";
import { PLACARD_ART, type PlacardArt } from "./registry.js";

export type { PlacardArt } from "./registry.js";
export { PLACARD_ART } from "./registry.js";
export { renderPlacardSvg, PALETTE, type Design, type SymbolId, type Background } from "./svg.js";
export {
  PLACARD_ART_PROVENANCE,
  PLACARD_ART_ATTESTED,
  PLACARD_ART_SOURCE,
  PLACARD_GEOMETRY_SPEC,
  PLACARD_PANTONE,
  type PlacardProvenance,
} from "./provenance.js";

/** Artwork release version (PLAN §11.7). PROVISIONAL until M10 lands the Chart-17-traced,
 *  SME-attested release with per-placard provenance — every rendering surface that shows this
 *  version must also label the art as a SPECIMEN, never a placard. Recorded on every run and in
 *  the M12 defense packet so a verdict is traceable to the exact art a reviewer saw. */
export const PLACARD_ART_VERSION = "0.1.0-provisional";

/** The art for a placard name (throws on an unknown name — the registry is exhaustive over PlacardName). */
export function placardArt(name: PlacardName): PlacardArt {
  const art = PLACARD_ART[name];
  if (!art) throw new Error(`@hazmat/placards: no art registered for placard "${name}".`);
  return art;
}

/** Just the SVG string for a placard name. */
export function placardSvg(name: PlacardName): string {
  return placardArt(name).svg;
}
