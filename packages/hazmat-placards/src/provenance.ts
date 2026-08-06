import type { PlacardName } from "@hazmat/engine";
import { PLACARD_ART } from "./registry.js";
import { PALETTE } from "./svg.js";

/**
 * §11.7 placard-art provenance — M10 infrastructure. PROVISIONAL / SME-attestation pending.
 *
 * M10 ships the provenance + regression + specimen-labeling scaffold that the traced artwork drops into.
 * What is REAL and verified here (build-from-rules): the DOT Chart 17 source of record, the §172.519
 * geometry spec, the §172.407(d)(5) PANTONE colors (eCFR-verified 2026-08), the per-placard design-section
 * citations, and a SHA-256 pin over every rendered SVG so the art cannot drift silently.
 *
 * What is NOT done (needs the source art + a human): the pictograms are still programmatic stylized
 * approximations, not traced from Chart 17 — `symbolProvisional` stays true for the placeholder set, every
 * `reviewer`/`attestedAt` is null, and `PLACARD_ART_ATTESTED` is false. Producing pixel-accurate official
 * pictograms cannot be derived from the CFR text; it requires the Chart 17 artwork + per-placard SME
 * sign-off. Until then every rendering surface must label the art a SPECIMEN, not a placard (§11.7).
 */

export const PLACARD_ART_SOURCE = {
  chart: "DOT Chart 17",
  edition: "2022-10-06",
  publisher: "PHMSA (U.S. DOT)",
} as const;

/** §172.519 general placard geometry (eCFR-verified 2026-08). The traced artwork must conform to these. */
export const PLACARD_GEOMETRY_SPEC = {
  citation: "49 CFR 172.519",
  minSideMm: 250,
  innerBorderInsetMm: 12.5,
  minClassNumberHeightMm: 41,
} as const;

/** §172.407(d)(5) PANTONE colors (eCFR-verified 2026-08). The renderer's sRGB hex is recorded as a
 *  PROVISIONAL conversion — PANTONE is a spot-color system, so exact sRGB is a documented approximation
 *  pending the attested traced-art release. */
export const PLACARD_PANTONE = {
  citation: "49 CFR 172.407(d)(5)",
  colors: {
    red: { pantone: "PANTONE 186 U", hexProvisional: PALETTE.red },
    orange: { pantone: "PANTONE 151 U", hexProvisional: PALETTE.orange },
    yellow: { pantone: "PANTONE 109 U", hexProvisional: PALETTE.yellow },
    green: { pantone: "PANTONE 335 U", hexProvisional: PALETTE.green },
    blue: { pantone: "PANTONE 285 U", hexProvisional: PALETTE.blue },
  },
} as const;

const PANTONE_BY_HEX: Record<string, string> = {
  [PALETTE.red]: "PANTONE 186 U",
  [PALETTE.orange]: "PANTONE 151 U",
  [PALETTE.yellow]: "PANTONE 109 U",
  [PALETTE.green]: "PANTONE 335 U",
  [PALETTE.blue]: "PANTONE 285 U",
};

export interface PlacardProvenance {
  name: PlacardName;
  /** Source of record for the pictogram trace (per §11.7). */
  source: string;
  sourceEdition: string;
  /** CFR design-section citation for this placard (e.g. "49 CFR 172.542"). */
  designRef: string;
  /** §172.407(d)(5) PANTONE codes for the regulated colors present in this placard. */
  pantone: string[];
  colorCitation: string;
  conversionMethod: string;
  /** true while the pictogram is a stylized placeholder pending the Chart 17 trace. */
  symbolProvisional: boolean;
  /** sha256 of the rendered SVG — the visual-regression pin (see provenance.test.ts). */
  svgSha256: string;
  /** null until an SME attests the traced art for this placard. */
  reviewer: string | null;
  attestedAt: string | null;
}

/**
 * The pinned SHA-256 of each placard's rendered SVG, computed from the deterministic renderer. Any change
 * to the artwork changes its SHA and fails the regression test (the M10 "pins every SVG" guard). When the
 * traced art lands, these are regenerated and re-attested in the same commit.
 */
const SVG_SHA256: Record<PlacardName, string> = {
  FLAMMABLE: "9bc744d1ac3908ed685f0ce4abeeba69cbe866487deafd392085e3ec3d1438f0",
  GASOLINE: "789de9ea17527b881a2aeb980fe63b6cc32669bab8f0ee11a1f7e161be557960",
  COMBUSTIBLE: "c99ef06f612897f0dd8db2a1829eeeea14ee0b56149a90f4feeadc0428d3259a",
  FUEL_OIL: "44fc09bec907b7ac3631e7b4d7baeaf26cf4fdecc369df8f6e94d39c9bd05ad8",
  FLAMMABLE_GAS: "077640874cf326e3750ebc399cfece231b0d5928a0c5af25d0774acc9e0ba3dd",
  NON_FLAMMABLE_GAS: "d657865d28679dd93fc7f17befdefa9b4c58235b1657a0a8591047608e7b60d7",
  OXYGEN: "d42853ae0beb89a4f7a665a4e0b488424645b293a076e8df080dd981cd970e69",
  POISON_GAS: "5cb0c22e7f1f22315aa7a4398d887fbb6b627ea1397798d04898e2bbcda18693",
  FLAMMABLE_SOLID: "216772a98898b2a767fb10d735654e805c2f2b045789307e66723e7c61821564",
  SPONTANEOUSLY_COMBUSTIBLE: "b08930cba86f46c4bfe0602f8a72f1741c46fad1c5a6f6219d2011dcdf0f134a",
  DANGEROUS_WHEN_WET: "1737433922a66b1d150d0d8f30102227ded45d96db7a08dc5553e87fbc89caa7",
  OXIDIZER: "14db1a6cb5ba1e9b287013ea354ed3befd0a3b83ee31455e39f4468ef4b47f4d",
  ORGANIC_PEROXIDE: "5416598d970103b1f7d737a0af895589a55b84a20d7a35f9a209fa5135aa6220",
  POISON: "1818540f7ebe13a46da9b0bb25c5608e86998b51747f79b39454e83a66a8abfb",
  POISON_INHALATION_HAZARD: "1557b26e34b8b19f8d7352a6acd50bc0ce2f1a26ca1b735b63efe872ccecb8e5",
  CORROSIVE: "0b366d96b899a0943ef8cd1a13f133172d3cc45bd8047ff3afb099c27513f99c",
  RADIOACTIVE: "6007b0ef75eb8b638284ba7ede4542bd88d7bc7625bad493b0a21a839c8dd582",
  CLASS_9: "430fe3af4b6f31c59ef0e0591791d5872265c17bb7f895dfb40cd68f8df39f0e",
  DANGEROUS: "1fdd71a9518dfc3727af315a5033d0f5c7485e7cf3b27812e574a018b11a0edd",
  EXPLOSIVES_1_1: "5d50df5ce76913b2588ecdc29a39bfe7b3365140edeba0e1774a478a3f5e3740",
  EXPLOSIVES_1_2: "eca2bcd752796ab5bffcd192730b7483b0c535e0b134fe1fa9dbc1fa97a80776",
  EXPLOSIVES_1_3: "06cf46fcd10036e9b6dff3828f02d09b21682ff5449cf6a4befc45952b576413",
  EXPLOSIVES_1_4: "6d0f51a091eae6dedb65e1b6fa9367111d54f7a3df36daf29db8f6b0692c02b6",
  EXPLOSIVES_1_5: "40cf707f3b40c40220ad800c2fff0823eaae32471e8dc5e8d7e312e56be0a9b7",
  EXPLOSIVES_1_6: "8aa879ef36613a5e5bb031d234e861e26a258a2d37865eb663dbb52a83cb1029",
};

function pantoneFor(svg: string): string[] {
  const out: string[] = [];
  for (const [hex, code] of Object.entries(PANTONE_BY_HEX)) if (svg.includes(hex)) out.push(code);
  return out;
}

/** Per-placard provenance, keyed by engine `PlacardName`. Derived from the shipped art + the verified specs. */
export const PLACARD_ART_PROVENANCE: Record<PlacardName, PlacardProvenance> = (() => {
  const out = {} as Record<PlacardName, PlacardProvenance>;
  for (const [key, art] of Object.entries(PLACARD_ART) as [PlacardName, (typeof PLACARD_ART)[PlacardName]][]) {
    out[key] = {
      name: key,
      source: PLACARD_ART_SOURCE.chart,
      sourceEdition: PLACARD_ART_SOURCE.edition,
      designRef: art.designRef,
      pantone: pantoneFor(art.svg),
      colorCitation: PLACARD_PANTONE.citation,
      conversionMethod:
        "Programmatic SVG render from a cited §172.5xx design descriptor; sRGB is a provisional approximation of the §172.407(d)(5) PANTONE spot colors. Not traced from Chart 17.",
      symbolProvisional: art.symbolProvisional,
      svgSha256: SVG_SHA256[key],
      reviewer: null,
      attestedAt: null,
    };
  }
  return out;
})();

/**
 * M10 attestation gate: false until every pictogram is traced from DOT Chart 17, colors confirmed to the
 * §172.407(d)(5) PANTONE, geometry confirmed to §172.519, and an SME signs off per placard. Every rendering
 * surface MUST label the art a SPECIMEN (not a placard) while this is false (§11.2/§11.7 launch blocker).
 */
export const PLACARD_ART_ATTESTED = false as const;
