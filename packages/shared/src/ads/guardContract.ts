import { z } from "zod";
import { recordId } from "../recordId.js";
import { adsSettingsSchema, type AdsSettings } from "./settingsContract.js";

/**
 * The guard's wire contracts (ADS-AGENT-BUILD-WORKFLOW.md A5): what the settings page, the kill
 * switch and the approval screen send, and what the settings read returns. The web (E1/E3) and the
 * API parse the same schemas.
 */

const reason = z.string().trim().min(1).max(1000);

/** One save of Settings › Ads control. The kill switch is not here: it has its own two doors. */
export const adsSettingsSaveSchema = z.object({ settings: adsSettingsSchema });

/**
 * Pressing the kill switch (anyone on the ads page; the safe direction) and clearing it (`ads.spend`).
 * The reason is required both ways: 0537 requires it while the switch is on, and a clearing nobody
 * can explain is the one an audit asks about first.
 */
export const adsKillSwitchSchema = z.object({ reason: z.string().trim().min(1).max(500) });

/**
 * A person's yes to one spend act on one campaign. The amounts are what was approved: the guard
 * refuses an act above them, so approving $50/day cannot be turned into $80/day later.
 */
export const adsSpendApprovalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["launch", "raise_budget"]),
    daily_budget_cents: z.number().int().positive(),
    lifetime_cap_cents: z.number().int().positive(),
    reason: reason.optional(),
  }),
  z.object({ kind: z.literal("change_area"), reason }),
  z.object({ kind: z.literal("withdraw"), withdraws_id: recordId(), reason }),
]);
export type AdsSpendApproval = z.infer<typeof adsSpendApprovalSchema>;

export interface AdsSettingsView {
  settings: AdsSettings;
  /** Null until the first save: the page shows the UNSET defaults with "nothing in force". */
  version: number | null;
  kill_switch: boolean;
  kill_reason: string | null;
  saved_at: string | null;
  saved_by_name: string | null;
}
