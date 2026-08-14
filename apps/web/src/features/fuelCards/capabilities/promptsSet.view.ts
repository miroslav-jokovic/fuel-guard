import { type PromptsSetBody, promptsSetContract } from "@fuelguard/shared";
import { defineView, row } from "./types.js";

/**
 * Changing what the pump asks for, said two ways because one of them is not reversible in effect.
 *
 * Prose lifted word for word from `promptsConfirmation` in `cardControlModel.ts`. What changed is
 * where `removesDriverId` comes from: the model took it as an argument, and the view derives it from
 * the request. A caller that computed it wrongly would have shown the mild copy for the destructive
 * case, which is the one screen where that matters most.
 */
export const promptsSetView = defineView(promptsSetContract, {
  confirmation: (body: PromptsSetBody) =>
    (removesDriverId(body)
      ? {
          tone: "danger" as const,
          title: "Stop asking who is fueling?",
          body:
            "The pump will stop checking a Driver ID on this card. Anyone holding it can fuel, and FuelGuard loses its strongest signal for attributing a fill to a driver. " +
            "Confirm your password to continue.",
          confirmLabel: "Remove Driver ID prompt",
          busyLabel: "Saving…",
          doneLabel: "Prompts updated",
        }
      : {
          tone: "warning" as const,
          title: "Change what the pump asks for?",
          body: "Drivers will be prompted for exactly these values at the pump the next time they fuel with this card.",
          confirmLabel: "Save prompts",
          busyLabel: "Saving…",
          doneLabel: "Prompts updated",
        }),

  /**
   * One row per prompt the request MENTIONS, not per prompt the card has.
   *
   * A prompt the request does not name is untouched — removal has to be authored with
   * `remove: true`, never inferred from omission — so listing the card's other prompts here would
   * show rows that are not part of this decision. The removals are the ones that need to be
   * unmissable, and they say so in words rather than by an empty cell.
   */
  diff: (before, body: PromptsSetBody) =>
    body.prompts.map((prompt) => {
      const existing = (before.infos ?? []).find((info) => info.infoId === prompt.infoId);
      return row(
        prompt.infoId,
        promptLabel(existing?.matchValue ?? null, existing?.reportValue ?? null),
        prompt.remove ? "Removed — the pump stops asking" : promptLabel(prompt.matchValue, prompt.reportValue),
      );
    }),
});

/** A prompt carries its value in one of TWO fields, and reading only one left a header stale twice. */
const promptLabel = (matchValue: string | null, reportValue: string | null): string => {
  const value = matchValue?.trim() || reportValue?.trim() || "";
  return value === "" ? "Any value" : value;
};

const removesDriverId = (body: PromptsSetBody): boolean =>
  body.prompts.some((prompt) => prompt.infoId === "DRID" && prompt.remove);
