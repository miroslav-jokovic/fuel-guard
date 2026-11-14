import { APPLICATION_STAGES, type ApplicationStage } from "@silvicom/shared";

/**
 * Which of the three stages a link is in (U1, SCREEN-MAP §2–§4), from the phases the link already serves.
 *
 * Read from the link, never remembered: `applicationSent` is the office having sent the application
 * (AF4), which opens "Your history"; `approved` is the office having read it (F4), after which all that
 * is left is the signing. A filed application has every stage behind it.
 */
export interface StageFacts {
  /** The office has sent the application: Part 2 is open, or already sent back for review. */
  applicationSent: boolean;
  /** The office has read it: the driver waits for, or has, the link to sign. */
  approved: boolean;
  /** Signed and filed. */
  submitted: boolean;
}

export type StageState = "done" | "current" | "ahead";

export function currentStage(facts: StageFacts): ApplicationStage {
  if (facts.submitted || facts.approved) return "signing";
  return facts.applicationSent ? "history" : "today";
}

/** Each stage as the bar draws it. */
export function stageStates(facts: StageFacts): Record<ApplicationStage, StageState> {
  const at = APPLICATION_STAGES.indexOf(currentStage(facts));
  return Object.fromEntries(
    APPLICATION_STAGES.map((stage, i) => [stage, facts.submitted || i < at ? "done" : i === at ? "current" : "ahead"]),
  ) as Record<ApplicationStage, StageState>;
}
