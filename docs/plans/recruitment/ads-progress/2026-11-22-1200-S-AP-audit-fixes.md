**2026-11-22 · Track S · Apply page: the audit's three faults fixed (APPLY-PAGE-PLAN §5)**

- **F-AP1, a flagged lead quiet only on arrival.** The uncontacted alarm, the phone-lookup retry and the cost report's
  sources all read `raw.checks.flags` now, through `APPLY_FLAGS_SELECT` and the shared `isFlaggedLead`.
  - The alarm counts a flagged lead as `flagged` and never rings it.
  - The lookup retry skips a flagged lead while it is `new`; a number a clean lead shares is still looked up.
  - The cost report leaves a flagged lead out until a person has worked it.
  - Lead quality, the outcome feed and the brief read ad leads only, so they are unchanged.
- **F-AP2, the SMS terms.**
  - They named one way to agree; the code has three: the careers page box, the application page box, and the
    recruiter's attestation, which has been live since 10/20.
  - They also promised every applicant email copies and an application page.
  - The terms and the privacy section now name all three ways, and scope the promises to the page that has them.
    `LEGAL_VERSION` is 1.3.
- **F-AP3, the company name.** "Silvicom Inc." on the legal pages becomes "Silvicom Inc", the spelling FMCSA SAFER,
  production's `organizations.name` and the Telnyx record all use.
- **Q-AP5, new (owner, then Telnyx).** The live toll-free verification describes only the application page.
  Production has 6 consents, all `application`, so nothing has gone out unregistered yet. The PATCH is drafted, each
  field under 500 characters. The recommendation: ask Telnyx whether editing a Verified record re-opens review and
  pauses sending, then send it once the careers page is live in production and before any lead is texted.
