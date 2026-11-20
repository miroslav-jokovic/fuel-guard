**2026-11-20 · Track S · Apply page AP1: the careers page's schema and Settings card (APPLY-PAGE-PLAN; Q-APX31, Q-APX34)**

- **Found first, measured from the page's HTML**: silvicominc.com's `/for-drivers/` is a WordPress Gravity Form whose
  entries never reach Silvicom 360, with no texting box, pay or notices. Its `/sms-terms/` promises a box the form
  lacks, and shows the developer's instructions. The owner ruled Q-APX34 (a): our page replaces it.
- **Migration 0641**:
  - `recruiting_careers_pages` (handle, on/off, accommodation contact; one per carrier).
  - `sms_consents.lead_id`: exactly one of driver or lead, the subject immutable.
  - `purge_lead` also deletes the lead's consents.
- **Card**: Settings › Recruiting › Careers page (`recruitment` manage; a fresh sign-in to switch on). It shows the
  link and the robot check's state, and lists the openings, each not-published one with its reason. The one rule
  is `openingUnpublishedReason`: open, a saved version, and the top of the pay range (Illinois Equal Pay Act).
- **Found on the way, for AP2**: `honourStop` withdraws consents per driver, so a lead's consent would outlive a STOP.
  It is fixed in the same merge as the first lead-consent writer (plan, AP2). There is also no road that texts a
  lead, so the ruling's "confirmation text first" cannot be sent; that is Q-AP1, with a recommendation.
- **Proved** by mutation:
  - Database: 15 planted faults. One survived (the guard's driver half), so a test was added; now caught.
  - API and shared: 23 faults, all caught.
  - Web: 11 faults. Two survived (a blank contact sent as "", and the password prompt asserted only by its
    sentence); tests were added and both are caught. One changed nothing, because the schema already lower-cases,
    so the card's redundant lower-casing was removed.
  - None was caught by a timeout. Next: AP2, the public API.
