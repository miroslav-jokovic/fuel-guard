# Tenstreet intake — receiving application data (plan, 2026-11-03)

**Status: PLAN. Nothing built. The reply to Tenstreet (§2) is drafted and not sent.**

This is item **2.6 "Tenstreet push listener (T2)"** of `RECRUITER-AUTOMATION-PLAN.md`, which the owner
cleared on 2026-10-26 (Q-RA1: Tenstreet contract ACTIVE, one-way feed, no two-way sync, D-RA1). It
answers Rowdy Fraser's (Tenstreet) email of 2026-11-03 15:02 CT: *"To get started we'll need an HTTPS
endpoint for Tenstreet to post to, and I'm connecting with your advisor on any billing."*

Sources, all in the repo:
- `docs/tenstreet/Receiving_Application_Data_from_Tenstreet (50).pdf`: Tenstreet's API guide, rev 11/2014
  (the text is extracted to `docs/tenstreet/samples/receiving_application_data_guide_text.txt`).
- `docs/tenstreet/samples/receiving_application_data_sample_{1,2,3}_xml.txt` and
  `receiving_documents_from_tenstreet_response_sample_xml.txt`: the four files the PDF links to,
  downloaded from tenstreet.com on 2026-11-03.
- Patterns copied, not invented: Meta's leadgen receiver (`modules/ads/leads/leadgenWebhook.ts`,
  `modules/ads/routes/metaWebhook.ts`), the lead ledger (`recruiting_leads` 0553, `ingest_lead` 0554,
  `purge_lead` 0558, `modules/recruiting/leads/leadSink.ts`), the sealed per-org vendor credential
  (`modules/medstop/credentials.ts`, `fleetpal/credentials.ts`, `lib/secretBox.ts`), and the Settings
  connection cards (`MedstopOrderingCard.vue`, `useMedstopConnection.ts`).

---

## 1. What Tenstreet's documentation fixes (measured, not assumed)

| # | Fact | Source |
|---|---|---|
| F1 | Tenstreet POSTs to us. We never call them for this feed; *"an internal Tenstreet process, set up via your account manager"* triggers it. | PDF p.4 |
| F2 | HTTPS only. Body = XML, UTF-8, `Content-Type: text/xml`. | PDF p.1 |
| F3 | **No authentication is described for this direction.** The "Company ID + Password" check in the guide is for posts *into* Tenstreet. | PDF p.2 |
| F4 | Root `<TenstreetData>`: `Mode` (`TEST` in every sample, so presumably `PROD` live), `CompanyId`, `Source`, `DriverId`. `DriverId` is Tenstreet's id for the person, and McLeod stores the same value as `driver.tenstreet_id`. | samples |
| F5 | Sections: `PersonalData` (name, current and past addresses, **SSN** in `GovernmentID`, **DOB**, email, two phones, preferred contact method/time), `ApplicationData` (Tenstreet status, worklist, recruiter, `AppReferrer` (= where the applicant came from), licences + endorsements + restrictions, accidents, unemployment, employers, schools, trucking schools, military, MVR yes/no questions, criminal yes/no questions, violations, `CustomQuestions`, `CustomDataElements` (= dashboard Tags)), `ProviderVerifiedData` (Xchange/VOE), `FormsData`, `Notes`, `Documents`, `DqfData`, `DriverChangeLog`, **`EqualEmploymentOpportunityData`**, `JobRequisitionData`. | samples |
| F6 | The XML is a **superset**: any element may be missing; Tenstreet adds elements and never removes or changes them. Element order differs between samples (sample 1 has `CompanyId` before `DriverId`, samples 2–3 the reverse). Date formats are mixed: `MM/DD/YYYY`, `M/D/YYYY`, `YYYY-MM-DD HH:MM:SS`, `MM/DD/YYYY HH:MM:SS`. | samples |
| F7 | `Documents` / `DqfData` carry **metadata only** (`FileId`, `Filename`, `FileCode`, category, DQF status). The files themselves come from a separate Tenstreet service ("Receiving Documents from Tenstreet"). | samples |
| F8 | We must reply **synchronously, before the request ends**: `<TenstreetResponse><DriverId/><Status>ACCEPTED or REJECTED</Status><Description/></TenstreetResponse>`. Status and Description are required. Tenstreet shows the Description to its user when we answer REJECTED. Until we answer, *"our system will not consider operations complete"*. | PDF p.2, p.7 |
| F9 | **Both sides must keep post and response logs for at least one calendar year.** | PDF p.2 |
| F10 | Support: integrations@tenstreet.com. One complete request at a time, *"sending more requests will just put your need further behind in the queue"*. Include the XML response, IP addresses, URL, redacted XML, and a phone number with a time window. | PDF p.2–3 |
| F11 | Sample sizes are 15–34 KB. | samples |

**What the guide does not say** (asked in §2): how Tenstreet authenticates its posts, what triggers a
post, how retries work, whether each post is the whole record or only the changes, whether fields can be
left out of the export, and Tenstreet's source IP addresses.

---

## 1a. What public sources add (researched 2026-11-03)

Tenstreet publishes no developer portal. `resources.tenstreet.com/api/docs/*` (the path older guides
were linked from) now answers every URL with the "Integrations with Tenstreet" sales page. The public
help center (`support.tenstreet.com`) has no API articles; the client knowledge base needs a login. So
the PDF Rowdy sent is the official specification, and the sources below only fill gaps. Each one is
labelled with how far it can be trusted.

| # | Source | What it says | What it settles |
|---|---|---|---|
| R1 | **Tenstreet's own blog**, "What You Need to Know About Tenstreet's API" (official) | Data sent out = *"All application data, Documents, Subject updates, Xchange data"*. Timing: *"a manual process that you can run from your side at your leisure, or … an automatic scheduler so it runs at the same time every night … we can trigger a POST on a subject update."* Setup: request + use description → approval → *"the client then provides the URL for the listener for us to POST to"* → *"The client provides either an accepted or rejected response"* → *"Steps 2-4 are repeated until all data has been transferred successfully."* Nothing on authentication. | **Triggers (old Q-TS2) answered**: we choose among on-update, nightly or manual. **Retries partly answered**: they repeat until accepted, but interval, timeout and whether a REJECTED is retried are not stated. |
| R2 | Same blog post, older copy (pricing section, ~5 years old) | *Standard API*: receive lead information or send subject data and/or documents, **$100/month for up to 3 client-specific interfaces**. *Advanced API*: adds setting tags and routing on application data, $200/month. Report-to-XML delivery: priced by client size. | A price to compare against what Rowdy quotes. It may be outdated. |
| R3 | **Cyclr** Tenstreet connector guide (an integration platform that receives Tenstreet posts) | *"No authentication is necessary to use the Tenstreet Connector"*. You *"contact Tenstreet customer support to request setup of sending data to a webhook"* and give them a generated unique URL. | **The strongest real-world evidence on authentication**: a production integrator receives Tenstreet posts on a **unique secret URL with no credentials**. Expect Tenstreet's outbound posts to support no auth headers at all. |
| R4 | Tenstreet "Sending Xchange Data to Tenstreet" guide rev 10/2017 (official, the reverse direction) | Posts **into** Tenstreet carry `<Authentication><ClientId/><Password/><Service/></Authentication>`. *"The ClientId is your internal client id in the Tenstreet API system, not your Company ID."* `Mode` is *"TEST or PROD"*. | **Mode value answered: `PROD`** (old Q-TS5 closed). The credentials are for *our* posts to them, which we do not make (D-RA1). Not needed for this feed. |
| R5 | LeadsBridge Tenstreet docs (posts leads into Tenstreet) | Client ID + Password + Company ID *"provided by Tenstreet support directly"*; API access *"you will need to pay them $500"*; custom question ids must be requested from support. | The reverse direction again. Confirms custom-question ids exist and must be requested. |
| R6 | GitHub: `sakoat/TechData-Event` (PHP), `brianclogan/tenstreet-api` (Laravel), cloned 2026-11-03 | Both **post leads into** Tenstreet (`dashboard.tenstreet.com/post/`; dev `dev.dashboard.tenstreet.com/post/tenstreet_standard_post_receive.php`; test company id 15 vs the samples' 14). Neither receives. The Laravel package advises *"not storing any Social Security Numbers."* | **No public open-source receiver for this feed exists.** We build from the PDF and samples. |
| R7 | **McLeod** certified-partner page for Tenstreet; Tenstreet integrations page | McLeod lists Tenstreet as a certified partner: *"Connect driver applications directly to LoadMaster onboarding workflows."* Tenstreet lists McLeod among its TMS integrations. | **Matters to us:** the carrier's McLeod already holds `driver.tenstreet_id`, so a Tenstreet → McLeod interface probably exists today. If the Standard API counts interfaces ("up to 3"), ours may be the second. Ask Rowdy (email question 6). |
| R8 | Supergood "TenStreet Hiring API" page, ProvenROI and IntegrateIQ HubSpot guides, Zapier | Supergood's page is *"a design sketch, not documentation of anything that exists today"*. The HubSpot guides are generic marketing. Zapier: *"Tenstreet has not yet built an integration on Zapier."* | **Disregarded.** Do not cite them. |

### What this changes in the plan
- **Authentication (D-TS7 rewritten below):** the secret URL becomes the **primary** design, since that is
  what R3 shows Tenstreet doing in production. HTTP Basic auth is asked for as an upgrade, not assumed.
  A secret URL ends up in Tenstreet's configuration and in our access logs, so: 256-bit token, our
  logging redacts the path segment, the card can rotate it, and the CompanyId check stays as a second
  factor.
- **Triggers:** no longer a question. We ask for *"POST on subject update"* plus a nightly safety run, if
  Tenstreet allows both.
- **Mode:** `PROD` is the live value.
- **Retries:** narrowed to three precise questions: interval, give-up point, and whether a REJECTED is
  retried. The guide implies a REJECTED is shown to a Tenstreet user to fix (PDF p.7), not retried.
- **Tags/custom questions:** the guide already offers `CustomDataId` / `CustomDataCustomerCode`
  (*"we can put it here"*). We request it instead of asking whether it is possible.

---

## 2. The reply to Rowdy (send after the owner confirms §3 D-TS4/D-TS5)

> **Subject:** Re: Receiving application data from Tenstreet: endpoint and setup
>
> Hi Rowdy,
>
> Thank you for the documentation. Here is our side.
>
> **Listener endpoints.** HTTPS (TLS 1.2+). They accept your XML as `text/xml`, UTF-8, and answer every
> post synchronously with a `TenstreetResponse` (ACCEPTED or REJECTED) as described in your guide:
> - Test: `https://staging-api.360.silvicominc.com/api/webhooks/tenstreet/<key>`
> - Production: `https://api.360.silvicominc.com/api/webhooks/tenstreet/<key>`
>
> `<key>` is a private value we will give your integrations team by phone, a different one for test and
> production. If your poster can send HTTP Basic authentication, we would prefer that instead, and the
> URL would end at `/tenstreet`.
>
> **What we would like set up:**
> 1. Start with `Mode=TEST` posts to the test endpoint. We will tell you when it is live, and switch to
>    production with `Mode=PROD` once your test posts are accepted.
> 2. Trigger: a post on every subject update (new application and status/worklist changes), plus a
>    nightly run if that is available.
> 3. Please leave the Social Security number (`GovernmentID`) and the EEO section
>    (`EqualEmploymentOpportunityData`) out of our export, if the export can exclude them. We don't use
>    them for screening.
> 4. Please fill `CustomDataId` (and `CustomDataCustomerCode` for drop-downs) on our Tags and custom
>    questions, as your guide offers, and send us the current list with those ids.
>
> **A few questions:**
> 5. **Retries:** if our listener times out or returns an HTTP error, how often do you retry and for how
>    long? Is a REJECTED post retried, or only shown to your user? How many seconds do you wait for our
>    response?
> 6. **Existing interfaces:** do we already have an interface sending data out of Tenstreet (for example
>    to McLeod LoadMaster)? Does this one count against our plan's interface limit, and what will it
>    cost? I understand you are coordinating that with [advisor's name].
> 7. **Source IPs:** do your posts come from fixed IP addresses we can allowlist?
> 8. **Volume and history:** expected posts per day, and can you re-send existing applicants once we are live?
> 9. **Full record or changes:** is every post the applicant's complete record, or only what changed since
>    the last post?
> 10. Please confirm our **Company ID**.
>
> **Technical contact:** [name], [email], [phone], Central Time, [best hours].
>
> Thank you,
> Miki
> [title] · Silvicom Inc · [phone]

Before sending: fill the brackets. Item 3 stands: SSN and EEO are ruled out (D-TS4, D-TS5, 2026-11-20). Item 9 added
2026-11-20 (Q-TS4; ADS-PLATFORM-V2-PLAN Q-APX30).
The `<key>` stays literal in the email, and the real keys go by phone (TS6). Never send credentials, a
real applicant's XML, or an unredacted SSN in this thread (F10 asks for redacted XML).

---

## 3. Decisions

Proposed here. **D-TS4, D-TS5 and D-TS8 need the owner**, and the rest follow from rulings already made.

- **D-TS1 · The feed creates and refreshes a LEAD, never an applicant.** It writes through `ingest_lead`
  (0554, recruiting's one door, `LeadSink`) with `channel = 'tenstreet'` and `external_ref = DriverId`, so
  the existing unique index `(org_id, channel, external_ref)` is the dedupe. A person becomes an
  applicant only when a recruiter converts the lead (`convertLead`, 0561). This is D-RA1: Silvicom stays
  the one record of applicants and Tenstreet is a feed. It also respects the 2026-10-26 posture that our
  ATS is legally inert until counsel clears it, because a lead holds no application.
- **D-TS2 · Every post is kept whole and sealed, and that is our one-year log (F9).** A new append-only
  table `tenstreet_posts` keeps one row per POST: the XML sealed with `secretBox` (AAD = org +
  `tenstreet.post`), its SHA-256 hash, our reply, and the outcome. Rows are pruned at **400 days** (one
  calendar year plus margin). The lead's own `raw` (frozen by RL013) gets the first post's **redacted
  projection, never the XML**. `recruiting_leads.raw` is plain jsonb that every recruiting reader can
  see, so an SSN must never reach it.
- **D-TS3 · Answer ACCEPTED once the post is durably stored, and do the work in the queue.** This is
  Meta's posture (`metaWebhook.ts` "WHY THE QUEUE DRIVER"). The request checks authentication, parses the
  envelope, refuses what can never succeed (wrong company, wrong mode, not XML, no DriverId) with a
  readable REJECTED, inserts the sealed `tenstreet_posts` row, enqueues `tenstreet_post_process` (dedup
  key = post id), answers ACCEPTED, and then kicks the drain. A lead write that fails after ACCEPTED is
  retried from the durable row and is never lost. A failure *before* the insert answers HTTP 503 so
  Tenstreet retries (Q-TS3 confirms that they do).
- **D-TS4 · SSN: never stored — RULED 2026-11-20 (ADS-PLATFORM-V2-PLAN Q-APX29 (a)).** The receiver removes
  `GovernmentID` from the XML before anything is sealed, logged or queued, and records only that a field was removed.
  A lead has no use for it (the MVR, PSP and background checks collect it under their own consent); a stored SSN,
  even sealed, makes the row a PIPA breach item (815 ILCS 530). Tenstreet keeps the original for its own calendar
  year, so the audit trail exists without our copy. Tenstreet is asked to leave it out of our export too (§2 item 3).
  *Supersedes the earlier recommendation, which kept it inside the sealed log.*
- **D-TS5 · EEO answers: removed the same way — RULED 2026-11-20 (Q-APX29 (a)).** The `EqualEmploymentOpportunityData`
  block (EeoQuestion/EeoAnswer) is removed before sealing. The EEOC: self-identification "should be kept separately
  from the application and should not be a basis for employment decisions". Tenstreet stays its system of record.
- **D-TS6 · DOB becomes an answer, not a stored date.** The projection stores `age_23_plus: yes/no/unknown`,
  computed on the post's received date. Hiring Profile v1 needs age ≥ 23 (§3a), and the date itself
  stays in the sealed log. A DOB in a lead's plain raw would be the second-worst field to leak.
- **D-TS7 · Authentication: a per-carrier secret URL first, Basic auth if Tenstreet can send it; fails
  closed either way.** A production integrator receives Tenstreet's posts on a unique URL *"No
  authentication is necessary"* (§1a R3), so the route is `/api/webhooks/tenstreet/:key`. `key` is 32
  random bytes, base64url, generated by us. It is stored as a **SHA-256 hash** (we only ever compare, so
  nothing needs unsealing) and shown once. A new table `tenstreet_connections` (one row per org) holds
  `company_id`, `mode` (`test`|`prod`), `enabled`, `key_hash`, `key_hint` (last 4), optional
  `basic_user` + `basic_secret_hash` (used only if Tenstreet confirms Basic auth, Q-TS1), and
  `rotated_at`. The request finds the connection by `key_hash`, which is the one lookup that is not
  org-scoped (the same exception as Meta's `ownersOfForms`). The body's `CompanyId` must then equal that
  connection's `company_id`, a second check that a leaked key alone cannot pass for another carrier.
  Wrong or unknown key, connection off, or CompanyId mismatch → HTTP 401 with no detail, counted and
  logged by reason, never by body. **The key is a credential in a URL**, so: Caddy's access log and our
  `[metrics]` line write the path as `/api/webhooks/tenstreet/***`; the card rotates the key (old key
  dies at once, and the new one goes to Tenstreet by phone); and Tenstreet source IPs, if published, are
  an extra Caddy filter, never the only one.
- **D-TS8 · Tenstreet's status is shown, never obeyed — RULED 2026-11-20 (Q-APX29 (a)).** *Recommended:* a later post refreshes the
  lead's contact details (name, phone, email: the fields 0553 lets change) **only when no recruiter has
  edited them**, and records Tenstreet's status/worklist/recruiter in a read-only "Tenstreet says" line.
  It does not move our lead status. Moving it would make Tenstreet a second source of truth, which T3
  rejected. The alternative, a "hired in Tenstreet" status closing the lead, is the owner's call.
- **D-TS9 · Tags and custom questions map by `CustomDataId`, never by prompt text.** The mapping lives in
  one shared catalogue (`TENSTREET_FIELD_MAP`). A prompt we do not know is kept in the projection's
  `unmapped` list for a person to see, never guessed (`catalogueAnswer`'s rule).
- **D-TS10 · The XML parser is hostile-input safe.** It refuses any `<!DOCTYPE` (no entity expansion, no
  XXE), limits the body to 2 MB at the parser, and uses `@xmldom/xmldom` (already an api dependency for
  EFS SOAP). The parse and the projection are pure functions in `packages/shared` and hold no clock.

---

## 4. What we build: TS0–TS6

Each step is one PR to `main` and goes to staging on merge (release train). Migration numbers are taken
at merge time by NAME. The next free number today is **0562**.

### TS0 · Send the email, record the answers (no code)
Owner confirms D-TS4, D-TS5 and D-TS8, then sends §2. Each answer goes into §6 as it arrives. **Done
when** Tenstreet has answered Q-TS1 (authentication) and Q-TS4 (repeat posts). TS1–TS3 can start before
then; TS4 cannot finish without Q-TS1.

### TS1 · Schema: migration `05xx_tenstreet_intake.sql` (new tables, so exempt from the two-merge rule)
- `tenstreet_connections`: `org_id` (unique), `company_id text not null` (unique, digits only),
  `mode text check in ('test','prod')`, `enabled bool default false`, `key_hash text unique`,
  `key_hint`, `basic_user`, `basic_secret_hash` (D-TS7), `rotated_at`, `last_post_at`, `last_error`, `created_by`, timestamps. RLS on, no client
  policy.
- `tenstreet_posts`: `id`, `org_id` (nullable: a post refused before an org was found is still logged,
  F9), `received_at`, `driver_id_ext text`, `mode`, `body_sha256`, `body_sealed text`, `bytes int`,
  `reply_status ('ACCEPTED'|'REJECTED'|'HTTP_401'|'HTTP_503')`, `reply_description`, `processed_at`,
  `process_error`, `lead_id` (composite FK `(org_id, lead_id)` → `recruiting_leads`). Append-only
  except `processed_at`/`process_error`/`lead_id` (guard trigger, new SQLSTATEs `TS0xx`). RLS on, no
  client policy.
- Retention: a `tenstreet_posts` rule at 400 days in the retention job. **Not** in
  `RETENTION_FORBIDDEN`: this is a log, not evidence.
- `purge_lead` (0558) redefined to also empty `body_sealed` on that lead's posts (a CCPA request beats
  the vendor log; keep hash and dates). Open question Q-TS9.
- `recruiting_leads` gets nothing new. Tenstreet-specific fields live in the projection (`answers`) or
  in `tenstreet_posts`.
- Gates: `lint:migrations`, `check-rls.mjs`, `lint:migration-ordering`, PGlite matrix
  `supabase/tests/tenstreet_intake.test.mjs` (append-only guard, composite FK refuses another carrier's
  lead, retention prunes at 400 not 399, purge empties the body). It must print `RESULT`.
- Docs: `docs/ARCHITECTURE.md` recruiting row gets both tables.

### TS2 · Shared, pure: parse + project (`packages/shared/src/recruiting/tenstreet/`)
- `tenstreetXml.ts`: `parseTenstreetPost(xml) → { envelope: {mode, companyId, driverId, source}, record }`
  or a typed refusal (`not_xml`, `doctype`, `no_driver_id`, `no_company`, `too_large`). Order-independent,
  every element optional (F6), a date parser for the four formats (returns `null`, never a guess).
- `tenstreetProjection.ts`: `leadFromTenstreet(record, receivedAt) → LeadProjection`, `channel
  'tenstreet'`, `external_ref` = DriverId, `source` = `AppReferrer` normalised to the `source` regex
  (else `null`), `platform_created_at` = `LastApplicationDate`, `full_name`, `phone_e164` via
  `normalisePhone` (primary, else secondary), `email_lower` via `normaliseEmail`, and `answers` in
  **the same keys `leadMatch` already reads** (`class_a_held`, `class_a_years`, `hazmat_endorsement`,
  plus `age_23_plus` and the disqualifier answers from `MotorVehicleRecords`/`Accidents`). Experience
  years are derived from licence `OriginalIssueDate` and employers. `raw` = the redacted record (no
  `GovernmentID`, no DOB, no EEO, no full address history; city/state kept).
- `tenstreetResponse.ts`: `tenstreetReply(status, description, driverId)` builds the XML with escaping.
  The Description is ≤ 255 characters and contains no PII.
- `TENSTREET_FIELD_MAP` (D-TS9).
- Tests: all three samples parse; sample 1 projects to a named lead with E.164 phone and the
  `class_a_*` answers; the SSN and DOB strings appear **nowhere** in the projection's JSON
  (`expect(JSON.stringify(p)).not.toContain("447-92")`); a `<!DOCTYPE` refuses; shuffled element order
  gives the same projection; an unknown element is ignored. Mutation-check the redaction test (it must
  fail when `GovernmentID` is let through).

### TS3 · API receiver (`apps/api/src/modules/recruiting/tenstreet/`)
- `appHttp.ts`: `app.use("/api/webhooks/tenstreet", express.text({ type: ["text/xml",
  "application/xml"], limit: "2mb" }))`, mounted **before** the global JSON parser. A JSON or
  form-encoded body is a 415 with REJECTED.
- `receive.ts`: `receiveTenstreetPost(deps, headers, body) → { status, xml }`, the D-TS3 order exactly.
  The boot warning `tenstreetBootWarning(env)` fires when `SECRETS_ENCRYPTION_KEY` is absent, because
  then nothing can be sealed and every post answers 503 (Meta/Samsara precedent: a fail-closed receiver
  nobody calls looks the same as a broken one, so say it at boot). Counters `tenstreetWebhookCounts` by
  reason.
- Route `routes/tenstreetWebhook.ts` is mounted in `app.ts` beside `/api/webhooks/meta`, with no user
  auth. Its rate limit is generous (60/min per IP) and must never be the reason a real post fails.
- Job `tenstreet_post_process` (registered in the worker, `KIND_CAPS` = 1, which the plan already lists
  for vendor kinds): open the sealed body → parse → `ingestLead` (new or duplicate) → on duplicate, apply
  D-TS8 → set `processed_at`, `lead_id`. A parse error after ACCEPTED sets `process_error` and raises a
  notification to recruiting admins ("A Tenstreet application could not be read: [DriverId]"). The
  sealed body stays for a person to replay.
- Tests (`supabaseRecorder` + `expectOrgScoped` on everything after the company lookup): wrong
  key → 401 and nothing stored; right key but another CompanyId → 401; the access-log line shows `***` not the key; `TEST` on a `prod` connection → REJECTED
  with a readable description; body stored sealed (the stored column does not contain `John`); ACCEPTED
  only after the insert (insert throws → 503); same post twice → one lead, two log rows; the reply is
  well-formed XML that matches the sample's shape.

### TS4 · Settings: the Tenstreet card (web)
- `apps/web/src/features/settings/TenstreetConnectionCard.vue` + `useTenstreetConnection.ts`, built
  like `MedstopOrderingCard` and gated on `recruitment: manage` (the section × role matrix, not
  `canManage`).
- It shows the endpoint URL for this environment (derived from `API_URL`, not typed), Company ID, mode,
  on/off, and **"Generate key"**: the full endpoint URL with its key shown once with a copy button, stored hashed
  on save, with rotation as the same button. It also shows the last post received, the last error, and
  posts in the last 7 days (accepted / rejected / failed).
- API: `GET/PUT /api/recruitment/tenstreet/connection`, `POST …/rotate-key`. All are audited; the
  key is returned only in the rotate response.
- Browser pass with the three fixtures (fail/empty/staging).

**Built 2026-11-20 (TS4)** (progress `ads-progress/2026-11-20-2130-S-TS4-settings-card.md`). Settings › Recruiting ›
Tenstreet: Company ID, Test/Production, the address, the switch, and the last seven days from the post log. API
`recruiting/routes/tenstreet.ts` over `recruiting/tenstreet/connection.ts`; contract `tenstreetConnectionContract.ts`.
All three doors are `recruitment` manage. A new address always asks for a fresh sign-in; switching on asks too
(Med-Stop's rule), switching off never does. The key is 32 random bytes, base64url, stored as the receiver's own
`hashTenstreetKey` plus its last four characters, answered once with `Cache-Control: no-store`, and in no audit row.
The address is derived from `PUBLIC_API_URL` (the variable FleetPal's receiver address already reads); unset, the
card shows the key and where it goes rather than a guessed URL. Departures, said: **"last error" is read from the
post log**, the newest refusal (with the very sentence Tenstreet was answered) or the newest post that could not
become a lead, because nothing writes 0640's `last_error`; the browser pass waits with the rest of TS6, on staging.

### TS5 · Lead page: what Tenstreet sent
- The lead drawer gets a **"From Tenstreet"** section: Tenstreet status/worklist/recruiter (read-only,
  "as of" date), licences and endorsements, employers (name, dates), accidents and violations counts,
  MVR/criminal answers, Tags, document **names** (F7: no files), and unmapped custom questions.
  Everything is read from the redacted projection of the **latest** processed post, not the frozen
  first `raw`.
- The lead queue shows the `tenstreet` channel in its channel filter (the counts come from the existing
  FilterSelect `count`).
- No conversion changes. Prefill of our application from Tenstreet's employers/addresses is item 5.3 of
  the recruiter plan, later.

**Built 2026-11-20 (TS5a)** (progress `ads-progress/2026-11-20-2230-S-TS5-from-tenstreet.md`). The lead drawer's
"From Tenstreet" section, read from the newest processed post (`GET /api/recruitment/leads/:leadId/tenstreet`,
`recruitment` view; `tenstreet/leadPost.ts`; the shared `tenstreetDrawerView`): Tenstreet's status, worklist and
recruiter, licences (never the number), employers, accident and violation counts, the driving-record answers in the
guide's own words, Tags, custom questions and document names. **Not shown:** the criminal-history answers and
`ConvictedDrugs` (Q-TS11 (a)). Two fixes came with it: a Tenstreet lead's `answers.projection` JSON no longer shows
under "What they answered", and deleting a lead's details now empties its Tenstreet posts too. A post that arrives
for an already-purged lead is emptied as it is processed. **Not built:** the channel filter (Q-TS12).

### TS6 · Go live (staging → production)
1. Owner, on **staging**: Settings → Tenstreet → Company ID, mode **test**, Generate key, switch on.
2. Credentials go to Tenstreet **by phone** (D-TS7). Their TEST posts arrive and the card shows them
   accepted. Check one lead by eye against Tenstreet's dashboard.
3. Send the redacted request and response pair to Rowdy as proof (F10 format), and agree the production
   start date.
4. Release to production (the 01:07 CT train, owner approves).
5. Owner, on **production**: a new key (never reuse staging's), mode **prod**, switch on, phone it
   to Tenstreet. Tell Tenstreet "the listener is ready". *"Final completion steps"* are theirs (PDF p.1).
6. Watch for 7 days: every post is ACCEPTED or REJECTED with a reason, the number of leads matches the
   number of applications in Tenstreet's dashboard for the same days, and there are zero `process_error`
   rows.
7. Optional backfill (Q-TS9-ish, from email question 9): if Tenstreet can re-send existing applicants,
   that goes through the same door, and `ingest_lead` dedupes.

---

## 5. What we set on our side (checklist)

| Where | What | Who |
|---|---|---|
| Caddy (prod + staging) | Routing: nothing new, `api.360…/api/*` and `staging-api.360…/api/*` already reach the api replicas (D-AWS17, AWS11 log 2026-10-27). **One change: the access log must not record the key**, so the Tenstreet path is logged as `/api/webhooks/tenstreet/***` (Caddyfile log filter, ships with TS3). Add an IP allowlist matcher for `/api/webhooks/tenstreet` only if Tenstreet publishes IPs (Q-TS1). | us |
| Environment variables | **None new.** Credentials are per carrier in the database, sealed with the existing `SECRETS_ENCRYPTION_KEY` (Med-Stop's reason: a variable is one key for every org and is readable by anyone with server access). | — |
| DNS / TLS | Already live: both names resolve to AWS with certificates (AWS11 log). `staging.360` NXDOMAIN does not matter here. | — |
| Database | TS1 migration via `migrate-staging` on merge, and to production with the release. | CI |
| Worker | `tenstreet_post_process` registered. Production runs `JOB_EXECUTION_MODE=inprocess`, so the receiver's kick drains it; in queue mode the consumer does. No new scheduler (`docs/WORKER-DEPLOYMENT.md` unaffected). | us |
| Retention | `tenstreet_posts` 400-day rule (F9). | us (TS1) |
| Settings, staging then prod | Company ID, mode, key, switch on (TS6). | owner |
| Tenstreet | Endpoint URL, credentials by phone, technical contact, the export field choices (D-TS4/5), triggers. | owner + Rowdy |
| Monitoring | The card's "last post" check. A notification when no post arrives for 3 business days while the connection is on (Med-Stop `connectionAlert.ts` pattern), and on any `process_error`. `[metrics]` log line per reason. | us (TS3/TS4) |
| Legal | The feed brings in criminal-history yes/no answers and accidents. Who may see them is the same question as our own application's (counsel package, `counsel-review-package`). Add a line to the counsel package: "Tenstreet feed: same fields as our application, held as a lead". | owner |
| Billing | Rowdy and the advisor. Record the cost and renewal date as Q-RA1b in the recruiter plan. | owner |

---

## 6. Open questions

Each one carries a recommendation and the fallback the code takes if it is never answered.

- **Q-TS1 · Authentication (Tenstreet).** Can the poster send HTTP Basic auth, and from which IPs?
  *Recommend* Basic auth on top of the key if they can. *Fallback (the evidence's default, §1a R3):*
  secret URL alone (D-TS7). TS3 builds the key path; Basic auth is a small addition.
- ~~Q-TS2 · Triggers~~ **Answered by Tenstreet's blog (§1a R1):** on subject update, nightly, or manual.
  We request on-update + nightly.
- **Q-TS3 · Retries (Tenstreet). Partly answered (§1a R1: "repeated until … transferred successfully").** Still owed: interval, give-up point, timeout, whether a REJECTED is retried. If Tenstreet does **not** retry a 503, a post that fails before the
  insert is lost. *Fallback:* none in code. Ask Tenstreet for a re-send and use the card's 7-day count to
  notice the gap.
- **Q-TS4 · Full record or delta (Tenstreet).** The plan assumes full record (all three samples are full).
  If posts are deltas, D-TS8's refresh must merge rather than replace. That would be found in TS6
  step 2, before production.
- ~~Q-TS5 · Mode value~~ **Answered (§1a R4):** `TEST` or `PROD`.
- ~~Q-TS6 · SSN, EEO~~ **Ruled 2026-11-20:** removed before sealing (D-TS4, D-TS5).
- ~~Q-TS7 · Status~~ **Ruled 2026-11-20:** shown, never obeyed (D-TS8).
- **Q-TS8 · Documents feed (owner).** *Recommend* not now. *Fallback:* names only (TS5).
- **Q-TS9 · Deletion vs the one-year log — RULED 2026-11-20 (Q-APX29 (a)).** A request hides the lead at once; the
  sealed, SSN-free post is purged one year after receipt, longer while a charge is pending (29 CFR 1602.14; 56 Ill.
  Adm. Code 2520.110 — both hold "application forms" a year).
- **Q-TS10 · Linking hires (later).** McLeod's `driver.tenstreet_id` is not imported by the collector
  today (no `tenstreet_id` anywhere in `supabase/` or `apps/api`). Importing it would link a hired
  driver back to their lead without phone/email matching. *Recommend* after TS6, as a one-column change
  to the roster sweep.
- **Q-TS11 · Tenstreet's criminal-history answers in the lead drawer (open, counsel; raised 2026-11-20 by TS5).**
  Every sample post carries `ApplicationData/CriminalRecords` (ConvictedCrime, DeferredProsecutions, ChargesPending,
  Felony, CanadianMinistersPermit, Misdemeanors — yes/no with free text, e.g. sample 1's "back in 05, i stole a
  truck"), and the driving-record block carries `ConvictedDrugs`, whose question (guide p.4) is possessing or selling a
  drug — a criminal conviction, not a driving one. The Illinois Job Opportunities for Qualified Applicants Act bars an
  employer from asking about criminal history on its application. Whether the 49 CFR 391.21 exception reaches these is
  already one of counsel's points (`V7-OPEN-QUESTIONS-RESEARCH-2026-11-20.md`, Q-APX31: "the 391.21 exception");
  the owner's own Tenstreet form asks them.
  - (a) **Withhold until counsel rules.** The drawer shows none of them and says Tenstreet sent some. The sealed post
    keeps them for the year the guide asks (Q-TS9), unread. *Built this way (TS5).*
  - (b) Show them to `recruitment` viewers, as the rest of the drawer.
  - (c) Show them only to the roles counsel names (a new named permission in the matrix).
  *Recommend* (a) until counsel answers, then (c) if they may be seen at all — a named permission, never a
  hand-written role list.
- **Q-TS12 · The channel filter (TS5b) needs the queue to filter by channel.** `recruiting_lead_queue` (0561) takes
  no channel, and the leads page has no channel filter at all (TS5's "the existing FilterSelect" was not there). Not a
  ruling, a sequencing note: a migration adds `p_channels text[] default null` (old callers keep working), and the
  page's filter ships in the NEXT merge (`lint:migration-ordering`). *Recommend* building it with the apply page and
  Indeed, when there are four channels worth filtering.

---

## 7. Progress log
- **2026-11-03** — Plan written from Tenstreet's guide (rev 11/2014) and its four samples, read in full,
  and from the Meta receiver, lead ledger and Med-Stop credential code on main `origin/main` (0561).
  Reply to Rowdy drafted (§2), not sent. Waiting on: owner D-TS4/5/8 + sending §2.
- **2026-11-03, later** — Researched official and public sources (§1a). No developer portal, no
  public receiver code. Tenstreet's blog answers triggers and (partly) retries; the reverse-direction
  guide answers Mode. Cyclr shows Tenstreet posting to a credential-less unique URL, so D-TS7 now uses a
  hashed secret URL key with CompanyId as a second check, and Basic auth only if offered. Found that
  McLeod is a certified Tenstreet partner (the carrier likely has a Tenstreet → McLeod interface
  already), which may affect the interface count and price. Email §2 rewritten: shorter, requests
  instead of questions where the docs already answer.
