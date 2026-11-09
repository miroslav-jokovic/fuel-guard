import type { LeadFacts } from "../leadMatch.js";
import { metaFacts } from "./meta.js";
import { indeedFacts } from "./indeed.js";
import { tenstreetFacts, tenstreetProjectionSchema } from "./tenstreet.js";

export * from "./meta.js";
export * from "./indeed.js";
export * from "./tenstreet.js";

/**
 * The one seam between a channel and the rules (LQ7, audit F-LA4): `channel` picks the reader, the reader turns
 * the lead's stored `answers` into `LeadFacts`, and `leadMatch` judges — the same rule for every channel, with
 * different inputs. Before LQ7 the rules read Meta's three catalogue keys for every channel, so an Indeed or
 * Tenstreet lead judged as all-unknown.
 *
 * What each channel stores in `recruiting_leads.answers`:
 *   meta / simulator  Meta's field names → values (`platformLeadFromMeta`)
 *   indeed            screener question id → answer (the Indeed Apply listener)
 *   tenstreet         ONE key, `projection`: the SSN-free `TenstreetProjection` as JSON (TS2's parser); the raw
 *                     XML is sealed elsewhere (D-TS2) and never in `answers`
 *   manual channels   nothing a reader can judge; the recruiter already spoke with them
 * A channel this file does not know yields no facts — every requirement `unknown` — never a guess.
 *
 * `asOf` is the calendar day (YYYY-MM-DD) the judgement is made on: ages and "years ago" are relative to it.
 */
export function factsFor(channel: string, answers: Record<string, string>, asOf: string): LeadFacts {
  switch (channel) {
    case "meta":
    case "simulator":
      return metaFacts(answers);
    case "indeed":
      return indeedFacts(answers).facts;
    case "tenstreet": {
      if (!answers.projection) return {};
      let parsed: unknown;
      try {
        parsed = JSON.parse(answers.projection);
      } catch {
        return {};
      }
      const p = tenstreetProjectionSchema.safeParse(parsed);
      return p.success ? tenstreetFacts(p.data, asOf).facts : {};
    }
    default:
      // Manual channels and anything unknown alike: nothing to read.
      return {};
  }
}
