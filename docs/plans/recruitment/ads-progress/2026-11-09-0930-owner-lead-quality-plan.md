**2026-11-09 · owner · lead-quality plan (docs only)**

- Owner asked for a review of the ads architecture against real-world practice, with the aim of leads that are
  real and reliable, and a fix plan with "no assumptions, gaps or blockers".
- Audit of main (cd9180b): the Instant Form `formParams` sends only name, locale, questions, privacy and
  `block_display_for_non_targeted_viewer`. So the form is Meta's default "more volume" type: no review step, no
  SMS verification, no intro and no thank-you page. `recruiting_leads.assigned_to` is never written. The monitor
  judges by cost per lead only.
- Facts checked against Meta's Page leadgen_forms reference and the official Business SDK at API v26.0 (our
  pinned version). `is_phone_sms_verify_enabled` can be created but NOT read back (Q-AD48). Ads Manager's
  "close form" logic has no documented API shape (Q-AD49).
- Written: [`ADS-LEAD-QUALITY-PLAN.md`](../ADS-LEAD-QUALITY-PLAN.md), steps LQ1–LQ4. Opened Q-AD47–Q-AD52
  (pointer in ADS-AGENT-PLAN §9). LQ1 should land before the sandbox L4 runs, so Publisher is certified once.
