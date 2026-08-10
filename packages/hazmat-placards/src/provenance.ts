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
 * What is NOT done (needs the source art + a human): the pictograms are programmatic constructions, not
 * traced from Chart 17 — every `reviewer`/`attestedAt` is null and `PLACARD_ART_ATTESTED` is false.
 * Producing pixel-accurate official pictograms cannot be derived from the CFR text; it requires the
 * Chart 17 artwork + per-placard SME sign-off. Until then every rendering surface must label the art a
 * SPECIMEN, not a placard (§11.7).
 *
 * 2026-08: the symbol set was rebuilt (skull-and-crossbones, ISO trefoil, the corrosive tubes/plate/hand,
 * flame-on-circle, exploding bomb) and the geometry brought onto the §172.519 figures, so the drawings are
 * recognisable at placard scale and provably inside the diamond. `symbolProvisional` drops to false for the
 * rebuilt set — it tracks "is this still a sketch", not "has a human signed this off". The second question
 * is what `PLACARD_ART_ATTESTED` is for, and it is still false. Every SHA below was regenerated in the same
 * change; a regression pin is only meaningful if it moves with the art.
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
  FLAMMABLE: "96594567229aa7cce61cc04788e93201442c5f6d7bf561beaf117dcc127dca4b",
  GASOLINE: "47182d8db2fc97381b915ac442ab253a8a6558748424893fade6035bcc585949",
  COMBUSTIBLE: "cf732b43eecf71096720b055edfaa96f72235ffb73f9875ddc23142b2ad5c7ac",
  FUEL_OIL: "bea1e1f6ef9fa21fe8677d2cf15a00b9d27e78d1e7450350fdf8f9519cc50c35",
  FLAMMABLE_GAS: "8f65a434e9a095516ec3aef09f74319bc15a6ca2734153fb203c1cdf79126691",
  NON_FLAMMABLE_GAS: "0b66c7739f703b3e5e13e6c2ac35756ddd7b5deb9a4f8356dd825b02d2ad96ee",
  OXYGEN: "5646e9441792a26ebb49640b36dd75a24370eecceec1b1a9ef2d3bc07dcb62be",
  POISON_GAS: "f448296fb0884854e5bd890cde512297711638f4af228fa4d6b438d6d3e23371",
  FLAMMABLE_SOLID: "0d9b2926ad3a8913e64225c2b8d04f1f0dbd167daa93b85d495deef2350e4a9a",
  SPONTANEOUSLY_COMBUSTIBLE: "ad9d0830e6435502426d6bdea9af8a9b7c17e714f2b33f554526f5a4f884ae6a",
  DANGEROUS_WHEN_WET: "f37531180fdda4b15ccb06a1917128e07d6ef058315b1dbf94b91bf9af40c55d",
  OXIDIZER: "18d96f49fbcbf96754319af12ac41393fb28c76a814f1c282fc6e45fcc80d993",
  ORGANIC_PEROXIDE: "656038763e9f07207a3ccee72d630495033d93d7f839630edc5f118c3b916746",
  POISON: "13c20d8654884dbb9aca51cf151d05abdf1d6e6a814bed08a572774aaf5183b5",
  POISON_INHALATION_HAZARD: "26e9f0815bb2ac7ab84db7719fbf817318425312c33f559eec44768979897379",
  CORROSIVE: "3f497732a570d0287955d233fcbffc883a1483fb230a84b5125ca2b864276a36",
  RADIOACTIVE: "94fe2bac53311c856d3db968f2d0d14be06d6a0477abdd22ee835826a7cad5a2",
  CLASS_9: "bc120ab4fcc3122b9e6bb1762afc15619063ed4b983b6cabf263e0e39ca270d7",
  DANGEROUS: "f77fc1850ddcad8d85ad93119caada538b043adacca282caa09776c7d34b2d02",
  EXPLOSIVES_1_1: "713086f5a3622702dea6d979d9f096c6c3be4397def991bd154f30814181aa65",
  EXPLOSIVES_1_2: "c385b9e348a97e17ab23227ae4555d7da2331e71fcf0a528b3aa403bea4f1d37",
  EXPLOSIVES_1_3: "b92608b7e4011efdbbf95f916ac2b6e81845bbfe4280de4dfa94049e281c97f2",
  EXPLOSIVES_1_4: "b755e1a499341c576d04b212b1e38347bcd0613d6b1f8123abf67aac2b394a7d",
  EXPLOSIVES_1_5: "4362f305a2f0d64a01565839a6e2092896e60983867a956dd606e82de7c42e07",
  EXPLOSIVES_1_6: "3c53670691dade5ae8559cba1c9839c82b776bfd5b21c8b16239eab7fcab88dc",
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
