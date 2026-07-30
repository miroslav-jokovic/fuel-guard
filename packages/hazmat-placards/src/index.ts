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
