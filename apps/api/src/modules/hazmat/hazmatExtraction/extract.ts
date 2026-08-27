import type { DatasetIndex } from "@hazmat/data";
import type { HazmatLine } from "@hazmat/engine";
import { classifyLineLoadState, lineDeclaresLq, type BolFields } from "./bolFields.js";
import { checkAgreement, checkArithmetic, reconcileDeclaredVsExtracted } from "./crossValidate.js";
import { mapBolLines, type DeclaredLineRef, type MapBolResult } from "./mapBolLines.js";
import { PROMPT_A, PROMPT_B, type ImageInput, type TokenUsage, type VisionExtractor } from "./vision.js";

/**
 * The extraction pipeline (plan H6 steps 1–5), wired but dependency-injected: the vision model and the
 * usability gate are passed in, so the WHOLE control flow is unit-testable with fakes and only the live
 * Claude call needs a real key. A wrong read cannot pass silently — the decisive checks are dual-pass
 * agreement (step 3) + deterministic cross-validation (step 4) over `resolveHmtLine` (step 4a). No model
 * output ever becomes a verdict (D1).
 */
export interface ExtractInput {
  /** Base64 page images already normalized (image.ts) — what the model reads. */
  images: ImageInput[];
  /** The same pages as buffers, for the pre-model usability gate. */
  gateBuffers: Buffer[];
  index: DatasetIndex;
  models: { A: string; B: string };
  vehicleKind: "cargo_tank" | "van_or_flatbed";
  /** Dispatcher-declared lines; absent/empty ⇒ driver self-created ⇒ never auto-clears. */
  declaredLines?: DeclaredLineRef[];
}
export interface UsabilityCheck {
  usable: boolean;
  reasons: string[];
}
export interface ExtractDeps {
  extractor: VisionExtractor;
  runUsability: (buf: Buffer) => Promise<UsabilityCheck>;
}

export interface ExtractResult {
  usable: boolean;
  usabilityReasons: string[];
  passA?: BolFields;
  passB?: BolFields;
  mapped?: MapBolResult;
  /** Engine lines from the (pass-A) resolved lines that mapped cleanly — the input to evaluateLoad. */
  engineLines: HazmatLine[];
  /** Every cross-validation / mapping / dormant-line flag, deduped. Non-empty ⇒ needs_review. */
  flags: string[];
  usage: TokenUsage;
  models: { A: string; B: string };
}

export async function runExtraction(input: ExtractInput, deps: ExtractDeps): Promise<ExtractResult> {
  const models = input.models;
  // 1. Usability gate — a bad page never reaches the model.
  const gates = await Promise.all(input.gateBuffers.map((b) => deps.runUsability(b)));
  const bad = gates.filter((g) => !g.usable);
  if (bad.length > 0) {
    return {
      usable: false,
      usabilityReasons: [...new Set(bad.flatMap((g) => g.reasons))],
      engineLines: [],
      flags: ["recapture_needed"],
      usage: { input: 0, output: 0 },
      models,
    };
  }

  // 2. Dual pass — independent model + prompt wording.
  const [a, b] = await Promise.all([
    deps.extractor.extract(input.images, { model: models.A, system: PROMPT_A }),
    deps.extractor.extract(input.images, { model: models.B, system: PROMPT_B }),
  ]);
  const usage: TokenUsage = { input: a.usage.input + b.usage.input, output: a.usage.output + b.usage.output };

  // 3 & 4. Cross-validation over pass A (agreement compares A vs B).
  const flags = new Set<string>();
  for (const f of checkAgreement(a.fields, b.fields)) flags.add(f);
  for (const f of checkArithmetic(a.fields)) flags.add(f);

  // Pre-printed catalog lines: dormant (no qty/count/weight) → excluded + one-tap confirm, not a hard flag;
  // a half-filled line → a real flag.
  a.fields.lines.forEach((l, i) => {
    const state = classifyLineLoadState(l);
    if (state === "preprinted_not_loaded") flags.add("has_preprinted_lines");
    else if (state === "partial") flags.add(`line_partial:line${i + 1}`);
  });

  // 4a & 5. Resolve + map pass A's loaded lines to engine lines.
  // H-LQ: the "Limited Quantity" notation is asserted only when BOTH passes read it on the SAME line
  // (original index alignment — the same alignment checkAgreement uses). One-pass reads already raised
  // pass_disagreement:lqNotation above and map to false: fully regulated, never under-placarded.
  const lqByIndex = a.fields.lines.map((l, i) => {
    const bLine = b.fields.lines[i];
    return lineDeclaresLq(l) && bLine != null && lineDeclaresLq(bLine);
  });
  const loadedMask = a.fields.lines.map((l) => classifyLineLoadState(l) !== "preprinted_not_loaded");
  const loaded: BolFields = { ...a.fields, lines: a.fields.lines.filter((_, i) => loadedMask[i]) };
  const lqConfirmed = lqByIndex.filter((_, i) => loadedMask[i]);
  const mapped = mapBolLines(input.index, loaded, { vehicleKind: input.vehicleKind, declaredLines: input.declaredLines, lqConfirmed });
  for (const f of mapped.flags) flags.add(f);
  const engineLines = mapped.lines.filter((l) => l.engineLine).map((l) => l.engineLine!);

  // 4d. Declared-vs-extracted reconciliation, or the driver-self-created fail-closed flag.
  if (input.declaredLines && input.declaredLines.length > 0) {
    const extracted = mapped.lines
      .map((l, i) => ({ line: l, i }))
      .filter(({ line: l }) => l.ok && l.engineLine)
      .map(({ line: l, i }) => ({
        hmtRef: l.engineLine!.hmtRef,
        quantityValue: loaded.lines[i]?.quantity.value ?? null,
        isLimitedQuantity: l.engineLine!.isLimitedQuantity,
      }));
    for (const f of reconcileDeclaredVsExtracted(input.declaredLines, extracted)) flags.add(f);
  } else {
    flags.add("lines_unconfirmed");
  }

  return {
    usable: true,
    usabilityReasons: [],
    passA: a.fields,
    passB: b.fields,
    mapped,
    engineLines,
    flags: [...flags],
    usage,
    models,
  };
}
