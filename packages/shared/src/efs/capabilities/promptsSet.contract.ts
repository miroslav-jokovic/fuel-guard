import type { z } from "zod";
import { EFS_EDITABLE_INFO_IDS } from "../../efsCardCatalog.js";
import { setPromptsSchema } from "../../cardControlContract.js";
import { defineContract } from "../types.js";

/**
 * What the pump asks a driver for — and the highest blast radius on this surface.
 *
 * `replaceAll` means the array in the request IS the card's prompts afterwards (guide p137), so a
 * record that does not come back is a DELETED prompt, and a deleted DRID prompt stops the pump
 * checking who is fuelling. That is why the characterisation suite asserts this route's whole
 * request body and not a substring, and why removal has to be authored rather than inferred.
 */
export const promptsSetContract = defineContract({
  key: "prompts_set",
  intent: "prompts_set",
  scope: "prompts",
  route: { method: "POST", path: "/:id/prompts" },
  writeBucket: "card_prompts",
  auditAction: "card.prompts_changed",
  schema: setPromptsSchema,
  carriesSecret: false,
  /**
   * `validationType` is the field whose spelling decides whether the pump CHECKS a value or merely
   * records it, and reading the wrong one is how a REPORT_ONLY prompt was left stale twice
   * (Phase 1's reportValue bug, and the mirror's infoValue in #23).
   */
  vocabularyFields: ["validationType", "infoId"],
  emittableValues: {
    validationType: ["EXACT_MATCH", "REPORT_ONLY"],
    infoId: EFS_EDITABLE_INFO_IDS,
  },
  ui: {
    title: "Change what the pump asks for",
    verb: "Save prompts",
    tone: "warning",
    inputs: [{ name: "prompts", control: "promptEditor", label: "Prompts" }],
    diffRows: ["infos"],
  },
});

export type PromptsSetBody = z.infer<typeof setPromptsSchema>;
