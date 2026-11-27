# V7's open questions — research and proposed answers (2026-11-20)

The owner asked (2026-11-20): *"analyze for this open questions and research on web and propose best possible
solutions and answers."* Four areas wait on an answer before V7 is finished: Tenstreet (Q-APX27 and its plan's D-TS4,
D-TS5, D-TS8, Q-TS1–Q-TS10), the public apply page and texting consent (Q-APX28, Q-AD52), Indeed (Q-AD5), and Meta's
qualified-lead goal for job ads (Q-AD17). Each was researched on the vendors' and regulators' own pages where they
could be reached; what could not be verified is said so. Each proposal is entered in ADS-PLATFORM-V2-PLAN §5 as
Q-APX29–Q-APX33 for the owner to rule. **Counsel is the authority on the legal points; this is research, not advice.**

Our own facts read first:
- Tenstreet's sample posts (`docs/tenstreet/samples/`, owner's copy) carry a full SSN (`<GovernmentID … documentType="SSN">`)
  and, in sample 1, seven EEO self-identification answers (`EeoQuestion`/`EeoAnswer`). The guide asks both sides to keep
  post and response logs for "at least 1 calendar year".
- Our texting already honours every word the FCC's new order lists (`SMS_STOP_KEYWORDS`: stop, stopall, unsubscribe,
  revoke, opt out, optout, cancel, end, quit).
- An opening's pay may have no top (`opening.ts`, `max_cents` nullable) — which a posting would show as "$X and up".

---

## 1. Tenstreet

**What the sources say.**
- **Illinois allows an SSN to be collected, but holding one makes the row a breach item.** 815 ILCS 505/2RR restricts
  how SSNs are shown and sent, not their collection. PIPA (815 ILCS 530) makes a name plus an unencrypted SSN a
  notifiable breach, with the Attorney General told above 500 residents.
- **The FTC says not to keep what you do not need.** Its guide: *"If you don't have a legitimate business need for
  sensitive personally identifying information, don't keep it."* A lead needs no SSN: the MVR, PSP and background
  checks collect it later, under their own FCRA consent.
- **EEO answers must be kept apart.** The EEOC, quoting UGESP Q&A 88: self-identification forms *"should be kept
  separately from the application and should not be a basis for employment decisions."*
- **Retention.** 29 CFR 1602.14 requires an employer to keep *"application forms … and other records having to do
  with hiring"* for one year, and until final disposition once a charge is filed. Illinois (56 Ill. Adm. Code
  2520.110) also requires one year from the application. A 2026 proposal to extend this to three years stalled.
  Illinois's 2025 amendment extended the time to FILE a charge to two years, not the retention.
  Illinois has no general consumer-privacy law, so there is no statutory deletion right.
- **Tenstreet's push.** Its API blog: the client gives *"the URL for the listener for us to POST to"*; posts *"are
  repeated until all data has been transferred successfully"*; triggers are manual, nightly or *"on a subject update"*.
  - Nothing public covers authentication, IP addresses, retry timing, full record versus delta, or removing fields.
  - Tenstreet's own inbound API puts credentials inside the XML, not in HTTP Basic auth.
  - The guide PDF is no longer public; the URL redirects to tenstreet.com/integrations.
- **McLeod.** McLeod lists Tenstreet as a certified partner. Nothing public shows LoadMaster storing a Tenstreet
  driver id.

**Q-APX29 · Tenstreet's five rulings — proposed.**
- **D-TS4 SSN: never stored, not even sealed.**
  - The receiver removes `GovernmentID` from the XML BEFORE the post is sealed and logged, and records only that a
    field was removed.
  - Tenstreet keeps the original for its own calendar year, so the audit trail exists without us holding SSNs.
  - Ask Tenstreet to leave the field out of our export as well.
  - A test plants an SSN and proves it reaches no row, log or job.
  - *Changes the plan's recommendation, which kept the SSN inside the sealed log:* sealing protects a stored SSN; not
    storing it removes the breach duty.
- **D-TS5 EEO: removed the same way, before sealing.** Tenstreet stays the system of record for EEO reporting.
- **D-TS8 Tenstreet's status: shown, never obeyed**, as the plan recommends. Nothing public defines Tenstreet's
  statuses, and a second source of truth for a hiring decision is what T3 rejected.
- **Q-TS9 deletion: hide at once, purge after the hold.** On a request, the lead is hidden at once. The sealed,
  SSN-free post is kept until one year after it was received, longer if a charge is pending, then purged.
  - *Changes the plan's fallback (purge at once).* Both the federal and the Illinois one-year holds apply to
    "application forms", and a Tenstreet post is one.
- **Q-TS10 linking hires: our own conversion.** A hire links through our own conversion: `external_ref` = Tenstreet's
  DriverId is already on the lead, and `convertLead` ties it to the driver. Whether our McLeod holds a Tenstreet id
  is a read of our own McLeod database, to be made before TS6, not assumed either way.

**Q-APX30 · Tenstreet's mechanics — one message to integrations@tenstreet.com, proposed.** Their guide asks for "one
really well-formed request at a time", so all of it goes in one message:
- Can the push send HTTP Basic auth, and from which IP addresses?
- Retry interval, give-up point and timeout, and whether a REJECTED is retried.
- Is every post the full record, or a delta?
- Can our export leave out `GovernmentID` and the EEO block?
- Which `CustomDataId`s carry the carrier's own questions?

Until they answer, the build defaults are the plan's: a secret URL plus the `CompanyId` check; every post treated as a
full snapshot merged onto the lead without deleting fields that are missing; idempotent by DriverId plus a content
hash; REJECTED only for a post that can never succeed. TS1–TS3 can be built on these and adjusted by the answer.

## 2. The public apply page and texting consent

**What the sources say.**
- **Recruiting texts are informational.** Courts have held recruiting texts *"do not constitute advertisements or
  telemarketing"* (*Gerrard v. Acara*, W.D.N.Y. 2020), so prior express consent is enough, oral or written.
  - An applicant who typed their number into an application consented to texts about that job (*Reardon v. Uber*).
  - A sales pitch inside the text (lease-purchase, training) turns it into telemarketing.
- **FCC rules.**
  - The one-to-one consent rule was vacated (*IMC v. FCC*, 11th Cir., 2025-01-24).
  - Revocation by any reasonable means must be honoured within 10 business days (47 CFR 64.1200(a)(10)).
  - **FCC 26-67, effective 2026-11-25**, lets a sender name reply-STOP-type words as the exclusive opt-out method.
    Our keyword list already covers all of them.
- **What carriers and Telnyx require for a web opt-in** (CTIA Messaging Principles §5.1.1; Telnyx 10DLC and toll-free
  verification, which now mirror each other):
  - a checkbox that is separate, **unchecked and optional** — the form must submit without it;
  - the brand, what the messages are about, "Message frequency may vary", "Msg & data rates may apply", "Reply STOP to
    opt out", "Reply HELP for help";
  - a no-sharing-with-third-parties line;
  - real links to the privacy policy and the SMS terms;
  - a confirmation text before any other message.
  - Telnyx rejects a campaign that misses these (code 861).
- **Illinois.**
  - The Equal Pay Act (since 2025-01-01, employers with 15+ staff) requires every job posting to show *"the wage or
    wage range, and a general description of the benefits"*. IDOL advises against "$X and up". Records are kept 5
    years; penalties run $500–$10,000.
  - The Job Opportunities for Qualified Applicants Act bars criminal-history questions on the application.
  - HB 3773 (2026-01-01) requires notice when AI is used in employment decisions. Its rules were withdrawn in
    2026-06; the statute stands. Our standing (V7b) is deterministic rules, not AI.
- **Bot defence.** Cloudflare Turnstile is free, usually invisible, and claims WCAG 2.2 AA. reCAPTCHA v3 brings
  Google's data flows; hCaptcha's free tier shows puzzles.

**Q-APX31 · The apply page, designed — proposed** (replaces Q-AD52's "counsel writes the wording": counsel confirms a
draft instead of starting from nothing):
1. **The page.** One public page per open opening (`/jobs/<opening>`). It shows the opening's pay range, benefits and
   requirements from the opening's own facts.
   - **An opening with no top of the pay range cannot be published** until one is set (Illinois Equal Pay Act).
   - The same rule should hold for our Meta ads — see Q-APX33.
2. **The questions.** The Instant Form's own (name, mobile, email, Class A, years of Class A, hazmat), so `factsFor`
   reads the page unchanged.
   - No criminal-history, DUI, age or ZIP-scoring question; those come later on the DOT application.
   - Whether 49 CFR 391.21's violations list sits under the Illinois Act's federal-law exception is a point for counsel.
3. **The texting box.** Separate, unchecked, optional, worded:
   > ☐ **Text me about my application (optional).** I agree to receive text messages from [carrier legal name] at the
   > mobile number above about my job application, such as application links, interview and orientation scheduling,
   > and hiring updates. Consent is not a condition of applying or of employment. Message frequency varies. Msg & data
   > rates may apply. Reply STOP to opt out, HELP for help. We will not share your mobile number or opt-in with third
   > parties for marketing. [Privacy Policy] · [SMS Terms]
4. **The proof.** Stored on the lead: time, IP, page, opening, wording version, number.
   - A confirmation text goes first.
   - Recruiting texts stay informational: no lease-purchase or training pitch.
5. **Bot defence.** Turnstile checked on the server, a honeypot field, a minimum fill time, per-IP and per-number
   limits behind the existing `/api` limiter. A failed check FLAGS the lead for review rather than refusing it, so a
   real driver is never locked out.
6. **The footer.** EEO statement, a link to the EEOC "Know Your Rights" page, a short privacy notice, and an
   accommodation contact. Built and tested to WCAG 2.2 AA on a phone.
7. **The same page is the careers page Indeed's Job Sync requires** (§3), so it is built once for both.

Still owed to counsel, as a short confirm list rather than an open brief:
- the wording;
- the 391.21 exception;
- whether our ads are "job postings" under the Equal Pay Act.

## 3. Indeed

**What the sources say.**
- **Direct employers may integrate**, after a Developer Agreement and Indeed's review. Indeed: *"Integrations usually
  take about six weeks."*
- **Indeed Apply** posts a JSON application to our HTTPS URL, signed (`X-Indeed-Signature`, HMAC-SHA1 of the raw body,
  Base64).
  - It needs a screener-question file Indeed will not approve without.
  - It retries failures and keeps undelivered applications 60 days.
- **The Job Sync API** opened to direct employers on 2026-07-31. It needs an OAuth client and **a public page per
  job**.
- **Disposition Sync.**
  - It needs HIRED, NEW and NOT_SELECTED at least, sent daily, with an opt-out offered to the person.
  - No fixed deadline is published.
- **Without approval, the only official path** is the "Export Candidates" CSV. It requires USD 10,000 of Indeed spend
  in the past 12 months, Verified or Sponsored-only, and two-factor authentication.
- **Indeed's terms** let applications go only to the employer's own hiring system, and *"You shall not filter or alter
  applications."* Our standing orders leads and never hides one, so it fits.
- **Tenstreet** lists Indeed among its job boards. Whether that carries Indeed Apply for our account is unverified,
  and 2026-11-06 found Indeed applicants do NOT reach our Tenstreet today.

**Q-APX32 · Indeed's path — proposed.**
1. **The Indeed account admin (Jeni), about an hour.**
   - Look in the account's Integrations Hub for any existing connection.
   - Check whether the CSV export is offered.
   - Ask Indeed Client Success for the Developer Agreement as a direct employer, for Indeed Apply, Job Sync and
     Disposition Sync, citing the 2026-07-31 note.
   - The carrier signs, because the key belongs to whoever builds the integration — here, ourselves.
2. **Us, about 2–3 weeks, before approval.**
   - The careers pages (shared with Q-APX31).
   - The Indeed Apply receiver: signature check, the review's status codes (400, 401, 404, 409, 410), idempotent
     through the `LeadSink` with channel `indeed`.
   - The screener file from the same catalogue as the Instant Form.
   - Job Sync posting.
3. **Indeed's review, about 6 weeks.** Then Disposition Sync, mapped from our recorded stages.
- **Meanwhile:** if the export is offered, a CSV import into the lead queue (1–2 days); if not, Indeed stays manual.

## 4. Meta's qualified-lead goal for a job ad (Q-AD17)

**What the sources say.**
- **The goal's API value is `QUALITY_LEAD`.** The ad set reference describes it as *"Optimize for people who are
  likely to have a deeper conversation with advertisers after lead submission."*
- **Ad set fields.** The lead-ads guide pairs it with `destination_type=ON_AD` and a `promoted_object` naming the Page
  and, with a CRM source, the dataset (`pixel_id`). **`promoted_object` is fixed when the ad set is created**, so the
  goal cannot be switched on a running campaign; it is chosen at launch.
- **No Meta page restricts optimisation goals under a special ad category.** Their restrictions are audience rules,
  enforced *"with a hard error"*. No practitioner report of QUALITY_LEAD under EMPLOYMENT, run or refused, was found.
- **Third parties quote Meta:** from April 2026 the qualified-lead goal needs the Conversions API integration for new
  campaigns. Meta's own page could not be opened to confirm it.
- **Best answer: probably yes (about 70 %), unproven.**

**Q-APX33 · Settle Q-AD17 on the sandbox, automatically, and hold our ads to the pay rule — proposed.**
- **Add the test to the readings now.** Add the exact test to `platforms/meta/contract/readings.ts`:
  - an EMPLOYMENT campaign;
  - an ad set with `optimization_goal=QUALITY_LEAD`, `destination_type=ON_AD`,
    `promoted_object={page_id, pixel_id: <dataset>}`, plain US targeting, `execution_options=["validate_only"]`;
  - the same with `special_ad_categories=["NONE"]` and without `pixel_id` as controls.
  - The fake answers as Meta's pages read. The first `pnpm ads:certify` on the sandbox records Meta's real answer, and
    Q-AD17 is answered by a recording, not a guess.
  - If yes, the switch is built as a launch-time choice (V7e's card already shows readiness). If no, the card's fifth
    line says "Meta refuses this goal for job ads" and the plain lead goal stays.
- **Separately:** hold every ad to the Illinois pay rule as the apply page is. An ad whose opening has no top of its
  pay range is not launched, if counsel confirms an ad is a "job posting".

## Sources (all read or quoted 2026-11-20)
- **Illinois statutes.** ilga.gov 815 ILCS 505/2RR; law.justia.com 815 ILCS 530.
- **Federal regulators.**
  - ftc.gov "Protecting Personal Information".
  - eeoc.gov informal discussion letter 100.
  - ecfr.gov 29 CFR 1602.14 and 49 CFR 391.51/391.53.
  - FCC-26-67A1.pdf.
- **Illinois agencies.** IDHR 56 Ill. Adm. Code 2520.110 (with the ktslaw.com 2026-06 alert); labor.illinois.gov
  Equal Pay Act and Job Opportunities for Qualified Applicants Act pages.
- **Tenstreet and McLeod.** tenstreet.com/blog "Tenstreet's API guide — everyone else"; tenstreet.com/integrations;
  mcleodsoftware.com certified partners (from a search snippet).
- **Texting.** goodwinlaw.com 2025-01 (*IMC v. FCC*); nixonpeabody.com 2025-04-11; rosenberger.law (recruiting texts);
  CTIA Messaging Principles 2023-05; support.telnyx.com 10DLC opt-in form, campaign compliance, toll-free verification.
- **Bot defence.** developers.cloudflare.com/turnstile.
- **Indeed.** docs.indeed.com: direct-employer, message-signature-generation, release-notes/2026, job-sync-api,
  disposition-sync-api, legal-terms; indeed.com/help "Export candidates" and the single-source feed policy.
- **Meta.** developers.facebook.com: ad set reference, lead-ads create guide, special ad categories, Conversion Leads
  integration. Third-party: jonloomer.com, meta-ads.si.
