/**
 * The placard-art registry (Phase H2 support). One entry per engine `PlacardName`, so the placard the
 * engine's `computePlacards` emits can be rendered as its exact DOT diamond. Backgrounds/colors/wording
 * follow the §172.521–172.560 design sections (cited per entry). `symbolProvisional` marks the entries
 * whose pictogram is a stylized approximation pending official artwork — the FUEL-relevant placards
 * (flame family, gas cylinder, Class 9 stripes, DANGEROUS) are exact; the skull/corrosive/trefoil/
 * explosion/oxidizer pictograms are recognizable placeholders flagged for a visual pass.
 *
 * Zero runtime dependencies (only the `PlacardName` type is imported, and types are erased at build),
 * so this package is framework-agnostic and extractable as a copy, not a rename.
 */

import type { PlacardName } from "@hazmat/engine";
import { renderPlacardSvg, PALETTE, type Design } from "./svg.js";

export interface PlacardArt {
  name: PlacardName;
  /** Placard wording as printed (e.g. "FLAMMABLE", "NON-FLAMMABLE GAS", "" for Class 9). */
  label: string;
  /** Hazard class/division shown on the placard, e.g. "3", "2", "9", "1.1"; null = none. */
  classNumber: string | null;
  /** CFR design-spec citation, e.g. "49 CFR 172.542". */
  designRef: string;
  /** Complete, standalone SVG string (viewBox 0 0 200 200). */
  svg: string;
  /** true when the pictogram is a stylized placeholder pending official artwork. */
  symbolProvisional: boolean;
}

const R = PALETTE;

interface Entry {
  label: string;
  designRef: string;
  provisional: boolean;
  d: Design;
}

const DEFS: Record<PlacardName, Entry> = {
  FLAMMABLE: { label: "FLAMMABLE", designRef: "49 CFR 172.542", provisional: false,
    d: { text: "FLAMMABLE", classNumber: "3", background: { kind: "solid", color: R.red }, symbol: "flame", ink: R.white } },
  GASOLINE: { label: "GASOLINE", designRef: "49 CFR 172.542(c)", provisional: false,
    d: { text: "GASOLINE", classNumber: "3", background: { kind: "solid", color: R.red }, symbol: "flame", ink: R.white } },
  COMBUSTIBLE: { label: "COMBUSTIBLE", designRef: "49 CFR 172.544", provisional: false,
    d: { text: "COMBUSTIBLE", classNumber: "3", background: { kind: "solid", color: R.red }, symbol: "flame", ink: R.white } },
  FUEL_OIL: { label: "FUEL OIL", designRef: "49 CFR 172.544(c)", provisional: false,
    d: { text: "FUEL OIL", classNumber: "3", background: { kind: "solid", color: R.red }, symbol: "flame", ink: R.white } },
  FLAMMABLE_GAS: { label: "FLAMMABLE GAS", designRef: "49 CFR 172.532", provisional: false,
    d: { text: "FLAMMABLE GAS", classNumber: "2", background: { kind: "solid", color: R.red }, symbol: "flame", ink: R.white } },
  NON_FLAMMABLE_GAS: { label: "NON-FLAMMABLE GAS", designRef: "49 CFR 172.528", provisional: false,
    d: { text: "NON-FLAMMABLE GAS", classNumber: "2", background: { kind: "solid", color: R.green }, symbol: "cylinder", ink: R.white } },
  OXYGEN: { label: "OXYGEN", designRef: "49 CFR 172.530", provisional: true,
    d: { text: "OXYGEN", classNumber: "2", background: { kind: "solid", color: R.yellow }, symbol: "oxidizer", ink: R.black } },
  POISON_GAS: { label: "POISON GAS", designRef: "49 CFR 172.540", provisional: true,
    d: { text: "POISON GAS", classNumber: "2", background: { kind: "solid", color: R.white }, symbol: "skull", ink: R.black } },
  FLAMMABLE_SOLID: { label: "FLAMMABLE SOLID", designRef: "49 CFR 172.546", provisional: false,
    d: { text: "FLAMMABLE SOLID", classNumber: "4", background: { kind: "stripes", base: R.white, stripe: R.red, region: "full" }, symbol: "flame", ink: R.black } },
  SPONTANEOUSLY_COMBUSTIBLE: { label: "SPONTANEOUSLY COMBUSTIBLE", designRef: "49 CFR 172.547", provisional: false,
    d: { text: "SPONTANEOUSLY COMBUSTIBLE", classNumber: "4", background: { kind: "split", top: R.white, bottom: R.red }, symbol: "flame", ink: R.black, symbolInk: R.black, textInk: R.white } },
  DANGEROUS_WHEN_WET: { label: "DANGEROUS WHEN WET", designRef: "49 CFR 172.548", provisional: false,
    d: { text: "DANGEROUS WHEN WET", classNumber: "4", background: { kind: "solid", color: R.blue }, symbol: "flame", ink: R.white } },
  OXIDIZER: { label: "OXIDIZER", designRef: "49 CFR 172.550", provisional: true,
    d: { text: "OXIDIZER", classNumber: "5.1", background: { kind: "solid", color: R.yellow }, symbol: "oxidizer", ink: R.black } },
  ORGANIC_PEROXIDE: { label: "ORGANIC PEROXIDE", designRef: "49 CFR 172.552", provisional: true,
    d: { text: "ORGANIC PEROXIDE", classNumber: "5.2", background: { kind: "split", top: R.red, bottom: R.yellow }, symbol: "flame", ink: R.black, symbolInk: R.white, textInk: R.black } },
  POISON: { label: "POISON", designRef: "49 CFR 172.554", provisional: true,
    d: { text: "POISON", classNumber: "6", background: { kind: "solid", color: R.white }, symbol: "skull", ink: R.black } },
  POISON_INHALATION_HAZARD: { label: "INHALATION HAZARD", designRef: "49 CFR 172.555", provisional: true,
    d: { text: "INHALATION HAZARD", classNumber: "6", background: { kind: "solid", color: R.white }, symbol: "skull", ink: R.black } },
  CORROSIVE: { label: "CORROSIVE", designRef: "49 CFR 172.558", provisional: true,
    d: { text: "CORROSIVE", classNumber: "8", background: { kind: "split", top: R.white, bottom: R.black }, symbol: "corrosive", ink: R.black, symbolInk: R.black, textInk: R.white } },
  RADIOACTIVE: { label: "RADIOACTIVE", designRef: "49 CFR 172.556", provisional: true,
    d: { text: "RADIOACTIVE", classNumber: "7", background: { kind: "split", top: R.yellow, bottom: R.white }, symbol: "trefoil", ink: R.black, symbolInk: R.black, textInk: R.black } },
  CLASS_9: { label: "", designRef: "49 CFR 172.560", provisional: false,
    d: { text: "", classNumber: "9", background: { kind: "stripes", base: R.white, stripe: R.black, region: "top" }, symbol: "none", ink: R.black, underlineNumber: true } },
  DANGEROUS: { label: "DANGEROUS", designRef: "49 CFR 172.504(f) / 172.522", provisional: true,
    d: { text: "DANGEROUS", classNumber: null, background: { kind: "solid", color: R.red }, symbol: "none", ink: R.white } },
  EXPLOSIVES_1_1: { label: "EXPLOSIVES", designRef: "49 CFR 172.522", provisional: true,
    d: { text: "EXPLOSIVES", classNumber: "1.1", background: { kind: "solid", color: R.orange }, symbol: "explosion", ink: R.black } },
  EXPLOSIVES_1_2: { label: "EXPLOSIVES", designRef: "49 CFR 172.522", provisional: true,
    d: { text: "EXPLOSIVES", classNumber: "1.2", background: { kind: "solid", color: R.orange }, symbol: "explosion", ink: R.black } },
  EXPLOSIVES_1_3: { label: "EXPLOSIVES", designRef: "49 CFR 172.522", provisional: true,
    d: { text: "EXPLOSIVES", classNumber: "1.3", background: { kind: "solid", color: R.orange }, symbol: "explosion", ink: R.black } },
  EXPLOSIVES_1_4: { label: "EXPLOSIVES 1.4", designRef: "49 CFR 172.523", provisional: false,
    d: { text: "EXPLOSIVES", classNumber: "1.4", background: { kind: "solid", color: R.orange }, symbol: "none", ink: R.black } },
  EXPLOSIVES_1_5: { label: "EXPLOSIVES 1.5", designRef: "49 CFR 172.524", provisional: false,
    d: { text: "EXPLOSIVES", classNumber: "1.5", background: { kind: "solid", color: R.orange }, symbol: "none", ink: R.black } },
  EXPLOSIVES_1_6: { label: "EXPLOSIVES 1.6", designRef: "49 CFR 172.525", provisional: false,
    d: { text: "EXPLOSIVES", classNumber: "1.6", background: { kind: "solid", color: R.orange }, symbol: "none", ink: R.black } },
};

function build(): Record<PlacardName, PlacardArt> {
  const out = {} as Record<PlacardName, PlacardArt>;
  for (const [key, e] of Object.entries(DEFS) as [PlacardName, Entry][]) {
    out[key] = {
      name: key,
      label: e.label,
      classNumber: e.d.classNumber,
      designRef: e.designRef,
      svg: renderPlacardSvg(e.d),
      symbolProvisional: e.provisional,
    };
  }
  return out;
}

/** Complete art for every engine `PlacardName`. */
export const PLACARD_ART: Record<PlacardName, PlacardArt> = build();
