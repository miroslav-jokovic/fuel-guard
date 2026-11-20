# The public apply page (Q-APX31) — plan

Owner rulings: Q-APX31 (a) 2026-11-20, the page as designed in `V7-OPEN-QUESTIONS-RESEARCH-2026-11-20.md` §2;
Q-APX34 (a) 2026-11-20, it REPLACES the company website's WordPress form (below). Counsel confirms three points
(the texting wording, the 49 CFR 391.21 exception, whether an ad is a "job posting"); none of them blocks the build.

## 1. What exists today, measured 2026-11-20

**The company website already has a driver application.** `www.silvicominc.com` is WordPress + Elementor, built by
PS Web Consulting. Every "Apply Now" goes to `/join-silvicom/`, a chooser, and from there to `/for-drivers/` (solo or
team) or `/for-owners/`. `/for-drivers/` is a Gravity Forms form (`gform_1`, `POST /for-drivers/`, its honeypot on,
no CAPTCHA). It asks, measured from the page's HTML:

| Field | Required |
|---|---|
| Applying as: Solo / Team | yes |
| First, last name; phone; email; street, city, state, ZIP, country | yes |
| CDL number; state issued | yes |
| More than 2 years of OTR? Hazmat **and** tanker endorsement? (yes/no each) | yes |
| How did you hear about us? | no |
| The same block again for driver 2 (team) | yes |

It has no texting box, no pay, and no EEO, privacy or accommodation notice. **Its entries never reach Silvicom
360**: they stay in WordPress and its notification email, so those applicants are not scored, assigned, rung or
counted in cost per lead.

Two faults on that site are the owner's to pass to the web developer (§6, AP5):
- `/sms-terms/` promises "the text-message box on your application page… never ticked for you". The form has no
  such box.
- The same page also shows notes meant for the developer ("Requirements the carriers check:… Please don't change
  any of the wording…").

**What Silvicom 360 has that the page reuses** (read in the code, 2026-11-20):
- `LeadSink` (`recruiting/leads/leadSink.ts`, `acceptLeadProjection`): store once per (org, channel, ref), verdicts,
  owner, bell, phone lookup. `recruiting_leads.channel` is checked by shape, so `apply_page` needs no migration.
- `openingBrief` decides the Instant Form's questions from the hiring profile: Class A always; years when the
  profile has a floor; hazmat only when required. `metaFacts` reads those catalogue keys (`META_FORM_CATALOGUE`).
- `recruiting_openings` / `_versions`: pay `{per, min_cents, max_cents|null}`, `benefits` (`PROMISE_TERMS` keys),
  `bonus`, `home_time`, `equipment`, `schedule`, `lanes`; status `open|paused|filled|closed`.
- `sms_consents` (0233, evidence, guard trigger): **`driver_id` is NOT NULL and there is no `lead_id`.** 0233's
  header expected R1 to add it "when there is something for it to reference"; `recruiting_leads` now exists.
  Source `lead_form` is already allowed (0504).
- **No send path texts a lead.** Every consent read before a send is keyed by `driver_id`
  (`applicationSms.ts`, `smsOutbox.ts`), and the outbox carries a driver. Only STOP handling reads by phone, so a
  STOP revokes a lead's consent too.
- `/api/public` sits under a 60-a-minute-per-address limiter (`calcLimiter`, app.ts) plus the general `/api`
  ceiling: those refuse floods, and stay the only refusals (D-AP5).
- No careers or company slug exists anywhere (`organizations` has no handle).
- CSP (`appHttp.ts`) allows scripts and frames from `'self'` only; Turnstile needs `https://challenges.cloudflare.com`
  on `script-src` and `frame-src` (Cloudflare's CSP page, read 2026-11-20).

## 2. Decisions

- **D-AP1 · The address.** `/careers/<handle>` lists the carrier's published openings;
  `/careers/<handle>/jobs/<opening id>` is one opening's page and form. The handle comes from a new
  `recruiting_careers_pages` row (one per carrier, `enabled` off until the office turns it on). Looking a carrier up
  by its handle is the one public query not scoped to an org, as `key_hash` is for Tenstreet; every query after it
  is scoped to the org it found. An opening id from another carrier answers 404, the same as an id that does not
  exist. *Why:* the website needs ONE link that stays right as openings come and go, and Indeed's Job Sync needs one
  public page per job (Q-APX32).
- **D-AP2 · What is published.** An opening is on the page when the carrier's careers page is on, the opening is
  `open`, it has a current version, and its pay has a top (`max_cents` not null). Anything else answers 404 and is
  left out of the list. *Why:* the Illinois Equal Pay Act's pay-range rule (Q-APX31 point 1). The Openings editor
  says which open openings are not published and why (AP3).
- **D-AP3 · The questions.** Name, mobile, email, and `openingBrief`'s own `form_questions`, derived (not copied),
  so `factsFor("apply_page")` is `metaFacts` and a lead is judged exactly as an ad lead is. Mobile or email is
  required (the manual-lead rule, D-LS10: a lead nobody can reach or match is no lead). No criminal-history, DUI,
  age, address, ZIP, licence-number or EEO question; none of these is stored. Nothing asks for an SSN.
- **D-AP4 · The texting box.** It is separate, unchecked and optional. Its words are the drafted wording (Q-APX31
  point 3) as a new `SmsConsentDocument` (`apply-page-2026-11-20`), composed on the server with the carrier's name.
  The Privacy Policy and SMS Terms links sit beside the text, not inside it (`SMS_CONSENT`'s rule). When ticked on
  a submission that passed every check, one `sms_consents` row is written with `source = 'lead_form'` and
  `lead_id`, plus the number, text, version, IP, user agent and time. The page and opening are on the lead's
  `raw`.
- **D-AP5 · Bot checks flag, never refuse.** The checks are:
  - Turnstile, verified on the server: `success`, then `hostname` must be ours and `action` must be `apply`;
  - the honeypot field is empty;
  - at least 4 seconds from the form being served to it being sent, measured from a server-sealed token, never the
    browser's clock;
  - at most 5 submissions from the address in an hour, and 3 for the number in a day.

  A failed check is written on the lead (`raw.checks`) and shown on it. A flagged lead:
  - is stored, listed and judged like any other;
  - **rings nobody, gets no phone lookup, and has no consent recorded.** A bot can type a stranger's number, so
    ringing it, paying for its lookup or treating it as consent would each act on a number nobody vouched for;
  - shows that the box was ticked and was not recorded, so the recruiter asks on the call.

  The only refusals are the existing `/api/public` limiter (60 a minute an address) and a body that does not parse.
  The limits above are starting values: with no traffic to measure, each one is set so that one person applying
  normally never trips it.
- **D-AP6 · Turnstile not configured.** Without `TURNSTILE_SECRET_KEY`:
  - the API says so at boot;
  - the check is recorded as `not_configured`, not as a failure, so leads still ring;
  - the Settings card says the robot check is not set up.

  *Why:* flagging every lead because a key is missing would silence the bell for real drivers. The Cloudflare
  account and its keys are the owner's (AP5).
- **D-AP7 · The footer.** It holds:
  - the EEO statement;
  - a link to the EEOC's "Know Your Rights" page;
  - a short privacy notice naming what the form keeps, including the IP address and Cloudflare's check, with links
    to the Privacy Policy and SMS Terms;
  - the accommodation contact from the careers page row (an email or a phone, at least one required to turn the
    page on).

  The page is built to WCAG 2.2 AA:
  - labels on every field;
  - errors named in words and tied to their field;
  - targets of at least 24 px;
  - a visible focus;
  - no time limit;
  - Turnstile in Managed mode (WCAG 2.2 AA, Cloudflare's overview).

  An axe scan runs in `e2e:apply` on a phone viewport.
- **D-AP8 · English first.** The page is in English. The Spanish copy and its texting wording are Q-AP2.

## 3. Steps

- **AP1 · The schema and the Settings card.**
  - Migration: `recruiting_careers_pages` (new table) and `sms_consents.lead_id`. `driver_id` becomes nullable,
    exactly one of the two must be set, and the guard trigger covers `lead_id`.
  - The PGlite matrix for both.
  - Settings › Recruiting "Careers page": handle, on/off, accommodation contact, and the public link. Its API is
    `GET/PUT /recruitment/careers-page` (manage, with a fresh sign-in to turn it on).
  - `purge_lead` is redefined to delete the lead's `sms_consents` rows, which hold the phone number, and to report
    how many. This follows the applicant purge (0380 onwards), which deletes the applicant's consents.
  - Nothing writes `lead_id` in this merge (`lint:migration-ordering`).
  - **Built 2026-11-20** (`ads-progress/2026-11-20-2330-S-AP1-careers-page-schema.md`):
    - 0641 as above.
    - The card at Settings › Recruiting › Careers page, with the openings each listed as published or not, and why.
    - `TURNSTILE_SECRET_KEY` is declared; it drives only the card's notice so far.
    - 31 matrix checks, 11 API and 11 web tests, every planted fault caught.
- **AP2 · The public API.**
  - `GET /api/public/careers/:handle` and `GET …/jobs/:openingId` return the page's facts and a sealed form token.
  - `POST …/jobs/:openingId/apply` runs the checks (D-AP5) and sends the lead through the LeadSink with channel
    `apply_page`, `external_ref` = the form token's id (idempotent per form served) and `source` = `careers_page`.
    It also writes the consent (D-AP4), and the bell and lookup follow D-AP5.
  - `factsFor("apply_page")`, the channel label, and the CSP.
  - **STOP must reach a lead's consent, in the same merge as the first writer.** `honourStop`
    (`applicationSms.ts`) reads each consent's `driver_id` and withdraws per driver, so a row with only a `lead_id`
    would stay live after a STOP. It changes to revoke every live consent on the number (0233's
    `revoke_sms_consent`), with a test that plants a lead consent and texts STOP.
  - **Built 2026-11-21** (`ads-progress/2026-11-21-0030-S-AP2-public-api.md`):
    - all of the above;
    - Turnstile's site key is served by the API, so one deploy sets both keys (`TURNSTILE_SITE_KEY` +
      `TURNSTILE_SECRET_KEY`), and one alone counts as off;
    - a flagged lead keeps its owner (`acceptLeadProjection`'s `quiet`).
- **AP3 · The public pages.**
  - `/careers/:handle` and the job page: pay, benefits, requirements, the form, the box, Turnstile and the footer.
  - The privacy policy paragraph.
  - The Openings editor's "not published: no top of pay range".
  - An `e2e:apply` spec with an axe scan at 390 × 844 and 1280 × 800.
- **AP4 · The lead drawer.** A "From the apply page" section shows each check's result in words, the opening, and
  the texting box: recorded, not ticked, or ticked but not recorded because the submission was flagged.
- **AP5 · Hand-off (owner).** The handoff has two parts:
  - **The Cloudflare account.** One Turnstile widget, Managed mode, hostnames `360.silvicominc.com` and the
    staging host. It gives `TURNSTILE_SECRET_KEY` for the API and the site key for the web build.
  - **One complete message to PS Web Consulting.** Point every Apply link at `/careers/<handle>`, retire the
    Gravity Form, and fix `/sms-terms/`. Drafted when AP3 is on staging, so it carries a link that works.

## 4. Open questions

- **Q-AP1 · Texting a lead does not exist.** The ruling says "a confirmation text goes first". No send path can text
  a lead: consent reads and the outbox are keyed by driver. So AP2 records the consent and sends nothing. Our SMS
  Terms also promise things a lead does not have yet ("every message is also sent by email", "turn texts off on
  your application page").
  - (a) **recommended:** build lead texting as its own step, after AP4. It covers consent read by lead, the
    outbox carrying a lead, quiet hours from the opening's area, the confirmation text first, and the SMS Terms
    updated in the same merge.
  - (b) Leave the box out until then. The ruling asked for the box, and recording consent now costs nothing.
  - (c) Text through the driver road by creating a driver row per lead. That is a workaround: every lead would
    become a roster applicant.
- **Q-AP2 · Spanish.** The Instant Form's questions exist in Spanish (`META_FORM_CATALOGUE`); the page's other copy
  and the texting wording do not.
  - (a) **recommended:** English now; the Spanish wording goes to counsel with the three points, and both
    languages ship together.
  - (b) Machine-translate now. That puts unreviewed consent wording in front of applicants.
- **Q-AP3 · Solo or team, and owner-operators.** The WordPress form asks solo or team, and has a separate
  owner-operator form. Neither is in the catalogue counsel is asked to approve.
  - (a) **recommended:** add "Applying as: solo / team" to the catalogue with counsel's three points, since a team
    is two drivers and changes the call. Owner-operators become their own opening (an opening already is "the one
    thing an ad may advertise").
  - (b) Leave both out. That is a step back from the website's form on the one question a team recruiter asks
    first.
- **Q-AP4 · CDL number and address.** The WordPress form requires both.
  - (a) **recommended:** do not ask. Meta forbids both on its form. The DOT application asks them under its own
    consent (`application-11.pdf`), and a careers form holding licence numbers is a breach surface for no
    decision it makes.
