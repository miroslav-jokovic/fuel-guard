**2026-11-10 · owner · agents and lead-relevance audit (docs only)**

- Owner asked for one more audit round, on the agents: are the ads high quality, well directed and composed, and
  are the leads relevant and reliable rather than random.
- Read from main `9d16b1c` by two parallel readers (creative agents; lead chain), each starting from the 11/09
  audits and checking their fixes against the code before looking further. The findings marked ✔ in the document
  were re-read at the cited lines.
- Ads: copy is well directed (CQ1, CQ2, CQ4 landed as claimed). The image is not: no still model is chosen so no
  real image exists (F-AG1); the art director never sees layout, formats or copy (F-AG2); one render is
  centre-cropped to every format and an unused crop can fail the ad (F-AG3); nothing judges the finished ad
  (F-AG4); a carrier starts with no presets (F-AG5); the top-ranked copy ships whatever its score with no
  fallback when the overlay refuses it (F-AG6).
- Leads: intake is solid (LQ1, LQ2b, LQ3b, LQ5, LQ6, LQ7 landed as claimed). Meta is asked for `LEAD_GENERATION`
  at lowest cost and the outcome feed cannot change the goal (F-LR1); the not-qualified alert gates on attempted
  calls, which LQ6 stopped anyone making (F-LR2); a returning person, a current driver and a held number ring as a
  new lead (F-LR6); close reasons other than not-qualified are counted nowhere per campaign (F-LR5); the
  no-contact count misses webhook leads (F-LR9). LQ8b, LQ9, LQ4 and the Indeed and Tenstreet listeners are
  unbuilt.
- Written: [`ADS-AGENTS-AUDIT-2026-11-10.md`](../ADS-AGENTS-AUDIT-2026-11-10.md) — findings F-AG1–14 and
  F-LR1–12, a ranked build list AG1–AG9 and LR1–LR8, opened Q-AD74–Q-AD77 (pointer in ADS-AGENT-PLAN §9).
- Not determined: any Higgsfield model's aspect behaviour, Meta's acceptance of the quality goal under EMPLOYMENT
  (Q-AD17), production settings. Nothing built. No ruling changed.
