import type { PlanConcept } from "@silvicom/shared";

/**
 * A carrier's ad presets as the two tables hold them, one enabled preset per concept, for tests of code that
 * reads what kinds of ad a carrier can make (`modules/ads/plan/concepts.ts`). The recipe is one the preset
 * contract parses — `listPresets` throws on a stored body that does not — and names its hook and scene.
 */
const RECIPE = {
  name: "Test preset", hook_formula: "Lead with the pay figure.", copy_slots: [{ name: "hook", max_chars: 60 }, { name: "pay", max_chars: 40 }, { name: "cta", max_chars: 30 }, { name: "title", max_chars: 40 }],
  image_prompt_template: "An empty highway at {time_of_day}, no text, no logos, no lettering", image_slots: ["time_of_day"],
  overlay_slots: { headline: "hook", cta: "cta" }, platform_slots: { primary_text: "pay", headline: "title" },
  starts_from: "text_only", shows_equipment: false, shows_people: false, motion_template: null, formats: ["4:5"],
};

export function presetRows(orgId: string, concepts: readonly PlanConcept[], opts: { disabled?: readonly number[] } = {}) {
  const at = "2026-11-01T12:00:00.000Z";
  const id = (i: number) => `7a000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
  return {
    ad_concept_presets: concepts.map((_c, i) => ({ id: id(i), org_id: orgId, key: `P${i + 1}`, enabled: !opts.disabled?.includes(i), archived_at: null, created_at: at })),
    ad_concept_preset_versions: concepts.map((c, i) => ({ id: id(i + 100), org_id: orgId, preset_id: id(i), version: 1, enabled: !opts.disabled?.includes(i), recipe: { ...RECIPE, name: `Test preset ${i + 1}`, ...c }, created_at: at, created_by: "u-admin", created_by_name: "Admin" })),
  };
}
