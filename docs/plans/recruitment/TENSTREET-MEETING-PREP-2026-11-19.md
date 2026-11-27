# Tenstreet meeting prep: API access for Silvicom 360 (2026-11-19)

**Who:** Rowdy Fraser (Tenstreet Account Management). Rachel Henning (Tenstreet) is on the thread, and
Silviya and Joanna are copied on our side. Email thread: *"[Tenstreet] Re: Silvicom 360 integration API access"*.
**Sources:** `TENSTREET-INTAKE-PLAN.md` (the build plan, D-TS1–10, Q-TS1–10), `RECRUITER-AUTOMATION-PLAN.md`
(Q-RA1 owner ruling 2026-10-26), `ADS-AGENT-PLAN.md` (Q-AD4), `ADS-LEAD-INTAKE-AUDIT-2026-11-09.md` (§3),
Tenstreet's guide `docs/tenstreet/Receiving_Application_Data_from_Tenstreet (50).pdf` (rev 11/2014) and its samples.

---

## 0. One-page version (read this if nothing else)

**What we want:** Tenstreet **pushes** each applicant's application (XML) to our HTTPS endpoint when the
applicant is created or updated. We answer each post with ACCEPTED or REJECTED. The feed is **one-way**, Tenstreet → Silvicom 360.
We are **not** asking for two-way sync, write-back, or document files at this stage.

**Why (Rowdy asked on 11/03 what 360 can do that Tenstreet can't):** we are not replacing Tenstreet,
and we are not reporting a gap in it. Recruiters work leads from Meta (Facebook/Instagram), Indeed and Tenstreet. Silvicom 360
puts them in **one queue**, checks each one against the same hiring profile, and gives each one to a recruiter.
That way nobody has to re-type a Tenstreet applicant and no applicant is missed. Applicants keep applying through Tenstreet.

**Where it stands**

| Date | What happened |
|---|---|
| 11/03 09:32 | We asked about API access. |
| 11/03 12:45 | Rowdy replied that the data is "already synced" in the dashboard and asked what we are missing. |
| 11/03 13:13 / 14:23 | We explained 360's role (one queue, no second data entry). |
| 11/03 14:54 → 14:58 | Rowdy asked whether we host the endpoint. We said yes, on our AWS environment. |
| 11/03 15:02 | Rowdy sent the receive-data guide. He is talking to our advisor about billing. |
| 11/03 15:47 | We sent the endpoint URLs (staging and production, key in the URL) and the TEST→PROD plan. We asked them to leave out SSN and EEO and to fill `CustomDataId`, and sent 5 questions. **The technical contact block was missing.** |
| **11/04 10:21** | **Rowdy said Tenstreet can use Basic auth (username/password) on our endpoint and asked if we want it. My records show no reply. Answer it today (§2, item 1).** |

**Be honest about our side:** the **receiver (the endpoint) is not built yet** (plan steps TS1–TS6).
The part that judges a Tenstreet applicant against Hiring Profile v1 is already on main
(`packages/shared/src/recruiting/leads/facts/tenstreet.ts`, LQ7). It is waiting for the parser to feed it. Don't
give a go-live date in the meeting. Say we will email when the TEST endpoint is accepting posts, and that we then
switch to PROD with their sign-off.

**The 5 things to leave the meeting with**
1. **Authentication agreed:** Basic auth is a yes. Agree how the credentials are exchanged (by phone, never by email), and get their source IPs if they have fixed ones.
2. **What the export contains:** whether SSN (`GovernmentID`) and EEO data can be left out of our export.
3. **How posts are sent:** whether each post is the full record or only the changes, how retries work, their timeout, and whether we can get both triggers (on update and nightly).
4. **Price and terms:** activation/setup fee, monthly fee, whether this counts against an interface limit, contract/renewal date. This is Q-RA1b, owed since 10/26.
5. **Next steps:** who at Tenstreet configures the push, a test window, our Company ID, and the support path.

---

## 1. Before the meeting: owner decisions (2 minutes)

The 11/03 email already sent our recommended position on 1–2, so the meeting only needs to confirm it.

| # | Decision | Recommended | Why |
|---|---|---|---|
| D-TS4 | Receive the SSN? | **No.** Ask Tenstreet to leave it out. If they can't, our parser drops it, and it exists only inside the sealed one-year log. | Hiring Profile v1 doesn't use it. Med-Stop and PSP collect identity inside our own packet. Holding SSNs is a liability we don't need. |
| D-TS5 | Receive EEO answers (race, sex, veteran status)? | **No.** | Self-identification must never sit next to a hiring decision. |
| D-TS8 | Should Tenstreet's status (hired, rejected, worklist) move our lead? | **Show it, don't act on it.** A read-only "Tenstreet says…" line. | Otherwise Tenstreet becomes a second source of truth. |
| Q-TS8 | Pull documents (licence and medical card scans) too? | **Not now.** We take names only. Ask the price for later. | It is a separate Tenstreet service with its own setup. |
| — | Two-way sync / write-back? | **Don't ask for it.** | Owner ruling Q-RA1 / D-RA1: one-way feed. |
| — | Basic auth? | **Yes**, with the secret URL key kept as well (two factors). | Q-TS1. Fallback if they can only do one: Basic auth plus the CompanyId check. |

Also fill in now what the 11/03 email left blank: **technical contact** (name, email, phone, Central Time hours).
Per `IT-EMAIL-ACCOUNTS-REQUEST-2026-11-09.md` this is meant to be a shared Silvicom 360 vendor address, not a personal inbox. If
that address doesn't exist yet, give miki@ for now and say a shared address will replace it.

---

## 2. Questions to ask (in priority order)

Tick each one off and write the answer next to it. Every answer goes into `TENSTREET-INTAKE-PLAN.md` §6.

**A. Security and connection**
1. **Basic auth:** yes, please. How do you want to exchange the username and password? (By phone or a secure share, never in this thread.) Can your poster also keep the unique key in the URL path? *(Q-TS1)*
2. Do your posts come from **fixed IP addresses** we can allowlist? *(Q-TS1)*
3. Please confirm our **Company ID**. Is there a separate test Company ID, or do TEST posts use the live company with `Mode=TEST`?
4. Which **TLS versions and certificates** does your poster require? (Ours: TLS 1.2+, public certificate on `api.360.silvicominc.com`.)

**B. How posts behave (decides our design)**
5. Is each post the **full record** or **only what changed**? *(Q-TS4. The plan assumes full record. If posts are deltas, we merge instead of replacing.)*
6. **Retries:** if we time out or return an HTTP error (5xx), how often do you retry, and when do you give up? How many seconds do you wait for our reply? *(Q-TS3)*
7. When we answer **REJECTED**, is the post retried, or only shown to a Tenstreet user? Who sees the Description we return? *(Guide p.7)*
8. **Triggers:** can we have **both** "post on subject update" (new application and status/worklist changes) **and** a nightly run? What counts as a "subject update"?
9. **Volume:** roughly how many posts per day for our account? Any batching?
10. **Backfill:** once we are live, can you re-send current applicants, for example the last 90 days? Is there a cost?
11. **Schema changes:** the guide says elements are added, never removed. How do you tell integrators about new elements?

**C. What the export contains**
12. Can our export **leave out `GovernmentID` (SSN) and `EqualEmploymentOpportunityData`**? If not, we discard them on receipt. *(D-TS4/5)*
13. Can you fill **`CustomDataId`** (and `CustomDataCustomerCode` for drop-downs) on our custom questions and Tags, and send us **the current list of our custom questions and Tags with their ids**? *(D-TS9. Our rules match by id, never by question wording. Example: our "willing to stay out 21 days" question.)*
14. Does `AppReferrer` reliably say **where the applicant came from** (Facebook, Indeed, Job Store, referral…)? What values can it take?
15. Does `JobRequisitionData` identify **which job posting** the applicant applied to? We use it to route the applicant to the right recruiter.
16. Is the **DQF status** (for example, licence document received) included? It lets us mark a licence as *documented* rather than *self-reported*.

**D. Commercial (Q-RA1b, open since 10/26)**
17. **Activation or setup fee?** (One integrator reports $500.) **Monthly fee?** (An older Tenstreet post: Standard API $100/mo for up to 3 interfaces, Advanced $200/mo.)
18. Do we **already have an interface sending data out** (for example to **McLeod LoadMaster**: McLeod is a certified Tenstreet partner, and our McLeod holds `driver.tenstreet_id`)? Does this new one count against an interface limit?
19. **Contract term and renewal date** of our Tenstreet subscription, and who our account manager is going forward.
20. Price of the separate **"Receiving Documents from Tenstreet"** service, for later only. *(Q-TS8)*

**E. Support and process**
21. Who sets up the push on your side, and how long does it take once we say the test endpoint is ready?
22. Support path: is integrations@tenstreet.com right? The guide asks for **one complete request at a time**, with the XML response, IP addresses, URL, redacted XML, and a phone number with a time window.
23. Do you notify integrators about outages or maintenance?

**F. Job boards (blocks our Indeed reply, so ask this even if time is short)**
24. **Do Job Store or your concierge post our OTR job to Indeed** (or other boards)? If yes, which boards, and
    can Indeed be switched off once we post to Indeed directly? *(Our Indeed reply, item 11, waits on this. A job
    on Indeed from both Tenstreet and our own feed would be a duplicate.)*
25. Confirm that **Indeed applicants do not flow into Tenstreet** for our account (Joanna says they don't).
26. *(If time allows)* Do Job Store's Facebook/Instagram leads arrive in the same XML feed with a clear
    `AppReferrer`? That way we don't count them twice against our own Meta ads.

---

## 3. What we tell them about our side

- **Endpoints** (already sent 11/03):
  - Test: `https://staging-api.360.silvicominc.com/api/webhooks/tenstreet/<key>`
  - Production: `https://api.360.silvicominc.com/api/webhooks/tenstreet/<key>`
  - A different key for test and production, given by phone. A TEST post sent to production is refused, and so is a PROD post sent to test.
- **We follow your guide exactly:** HTTPS, `text/xml` UTF-8, a synchronous `TenstreetResponse` (ACCEPTED/REJECTED + Description) on every post.
  We store each post durably *before* answering ACCEPTED. If the store fails, we return HTTP 503 so you retry.
- **One-year log:** we keep every post and our reply for at least a year (encrypted, 400 days), as the guide requires (F9).
- **Rollout:** your TEST posts go to staging → we check them against your dashboard → you approve → PROD. We
  then watch for 7 days: the lead count must equal the application count in your dashboard.
- **Hostile-input safe:** we refuse DOCTYPE/entities and anything over 2 MB. Mention this only if they ask about security.

## 4. Don'ts

- **No credentials, real applicant XML, or unredacted SSNs** in the meeting chat or the email thread (guide F10).
- **Don't commit to a go-live date**, because the receiver is not built yet. Commit to "we'll notify you when TEST is ready".
- **Don't ask for two-way sync or status write-back** (D-RA1). If they offer it, say "later" and note the price.
- **Don't say we will move off Tenstreet.** Our position is one queue across sources, and Tenstreet stays where applicants apply.
- Don't agree to receive SSN/EEO "just in case".
- Don't agree to pay anything in the call. Take the numbers to the owner and the advisor.

---

## 5. Background facts (in case they come up)

- **Their spec in one line:** root `<TenstreetData>` with `Mode` (TEST/PROD), `CompanyId`, `Source`, `DriverId`. Sections:
  PersonalData, ApplicationData (licences, accidents, employers, MVR and criminal yes/no, CustomQuestions, Tags),
  Documents/DqfData (**metadata only**), DriverChangeLog, EEO, JobRequisitionData. Posts are 15–34 KB, elements come in any
  order, and dates come in four formats.
- **`DriverId`** is the key we deduplicate on. One Tenstreet person is one lead, however many posts arrive.
- **What we do with a post:** it creates a **lead**, never a hire. A recruiter converts the lead to an applicant in 360.
  Rules check age ≥ 23, Class A CDL, ≥ 2 years of Class A experience, hazmat (preferred), and the four hard disqualifiers.
- **Retention duty:** both sides keep post and response logs for **one calendar year** (guide p.2).
- **Why speed matters (their own numbers):** Tenstreet's data on 1.5 M drivers shows a 6.2 % hire rate when the carrier answers
  within 5 minutes, against a 3.7 % average. Pushes on update (not nightly only) are how we get those 5 minutes.

---

## 6. After the meeting (same day)

1. Reply on the thread with a written summary of what was agreed. Send credentials by phone only.
2. Put the answers into `TENSTREET-INTAKE-PLAN.md` §6 (Q-TS1, Q-TS3, Q-TS4, Q-TS8) and §7 progress log, and record the price and renewal date as
   Q-RA1b in `RECRUITER-AUTOMATION-PLAN.md` and Q-AD4 in `ADS-AGENT-PLAN.md`.
3. If D-TS4/5/8 were confirmed, start building TS1 (schema) → TS2 (parser) → TS3 (receiver) → TS4 (Settings card). Get the
   custom-question id list (Q13) before TS2 finishes.
4. **Housekeeping:** `TENSTREET-INTAKE-PLAN.md` and `docs/tenstreet/` (guide + samples) are **not on main yet**, only in
   this working tree. Commit them with this file, so the build chat can find them.
