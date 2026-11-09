**2026-11-09 · owner · lead-intake audit (docs only)**

- Owner asked for an audit of the automated ads focused on the leads we receive, with Indeed and Tenstreet
  onboarding in view: no random, unreliable or imprecise leads; enterprise grade.
- Read from main `1c26ac7` (LQ1, LQ2a, LQ2b merged): the whole chain from ad set targeting to the outcome feed,
  file by file. Stages 1–6 (targeting, claims, form, delivery, store-once, person match) and the verdict design are
  sound and left alone.
- Found: `qualified`, `not_qualified` and `lost` have NO writer (`leadContacts.ts` moves only `new → contacted`;
  `purge_lead` sets `lost`), so the recruiter's verdict is never recorded, LQ3 can count only wrong numbers and
  self-reported does-not-meet, and the outcome feed sends Meta no negative stage (F-LA1). A self-reported hard
  `does_not_meet` rings `lead_new` and the SLA alarm like any lead (F-LA2). `leadFactsFromAnswers` reads only the
  three Meta catalogue keys, so an Indeed or Tenstreet lead would judge as all-unknown (F-LA4). Verdicts are never
  re-judged when the profile changes (F-LA5). Phone validity is shape-only (F-LA3).
- Written: [`ADS-LEAD-INTAKE-AUDIT-2026-11-09.md`](../ADS-LEAD-INTAKE-AUDIT-2026-11-09.md), findings F-LA1–F-LA8,
  proposed LQ5–LQ9, opened Q-AD62–Q-AD66 (pointer in ADS-AGENT-PLAN §9). Nothing built; LQ3 in flight is unchanged.
