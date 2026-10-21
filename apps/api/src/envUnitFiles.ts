import { z } from "zod";

/**
 * The unit files programme's environment (`docs/plans/roster/UNIT-FILES-PLAN.md`), split out of `env.ts`
 * on the `envInspections.ts` precedent: one plan, one group of variables, and `env.ts` sits near its
 * 500-line budget. Spread into the one schema, so a deployment still gets one parse.
 */
export const unitFilesEnvFields = {
  // Reading uploaded papers with the document reader (UF7b2, the `compliance_paper` profile) — model
  // spend, so a switch of its own, as the roadside report has. On by default: a read is queued only when
  // somebody who manages a file uploads papers to it (UF7b3), and every result waits for a person (D-UF8).
  FILE_PAPER_READING: z.enum(["on", "off"]).default("on"),
};
