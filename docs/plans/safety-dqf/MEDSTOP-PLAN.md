# Med-Stop integration — drug & alcohol testing, pre-employment and random

Status: **MS0 DONE (2026-10-13), MS1 in build.** Q-MS7 fixed by Med-Stop 2026-10-13. Answers Q-REC2 (`RECRUITING-SYSTEM-PLAN.md` R6):
the C/TPA, collection network and MRO channel is **Med-Stop**.

Every fact below is marked **[V]** (verified in the spec or in this repo, with its reference) or
**[?]** (not knowable until MS0 reads the live account). Nothing is marked from memory.

---

## 1. Owner answers (2026-09-29)

| # | Question | Answer |
|---|---|---|
| O-1 | Send the SSN to Med-Stop? | **Yes** — all necessary information, SSN included. "We can pull it from McLeod" (see §4.3: it cannot come from there today). |
| O-2 | Who runs the random pools? | **Med-Stop.** We are a member of their pools; we do not draw. |
| O-3 | Who is the DER? | **Marija Varmeda.** |
| O-4 | Create the applicant in Med-Stop automatically when we create them in Silvicom 360? | Asked for — §4 shows why it cannot be at *creation*, and when it can. |
| O-5 | (2026-09-29, second round) SSN | **Superseded O-1: we send no SSN.** Med-Stop confirmed the CDL number identifies the donor instead. Q-MS4 and Q-MS5 close with it. |
| O-6 | Gender | **Q-MS3 (a)**: a required Part 1 field. |
| O-7 | Probe access | The owner adds this workstation's egress IP to the key's filter so MS0 can run from here. |

## 2. The source

- `docs/Med-Stop/openapi.json` — OpenAPI 3.1.1, "Med-Stop API" **4.9.31**, 99 operations **[V]**.
- `docs/Med-Stop/API-Key-access.md` — Med-Stop's developer guide (authorization, conventions,
  pagination, errors, go-live checklist) **[V]**.
  Gitignored locally via `.git/info/exclude` (it sits next to the API key); never commit that folder.
- Auth: header `Authorization: ApiKey <key>` **[V]** (`components.securitySchemes.ApiKey`).
- The key is IP-filtered to `@fleetguard/api`'s three static egress IPs, so **every call — including
  every probe — must come from that service** **[V]** (`docs/22-EFS-CARD-CONTROL.md:298`).
- **Base URL `https://api.med-stop.com`**, HTTPS only (API-Key-access.md) **[V]**. Keys are managed at
  `https://apiadmin.med-stop.com`.
- **Keys expire after at most 180 days** [V] — an expired or revoked key answers 401. Rotation is a
  twice-yearly chore, so MS1 carries an expiry reminder.
- A key's **security groups** decide which operations it may call; 403 = valid key, operation not
  permitted [V]. MS0 records which of §3's operations the current key can reach.
- **100 requests/minute per key**, then 429 with no `Retry-After`; back off ~60 s [V].
- Envelope [V]: success is any 2xx, no success flag. Lists return paging in `data`
  (`page, pagesize 5–500, pagemax, records`) and the records in **`rows[0]`**. **A list that matches
  nothing answers 404** — "no results", not an error. Writes return the new id in `msg.recordid`.
  Errors: an `errors` map + `msg` with `type` S (401/403/429/451) or E (400/404/5xx).
- Create/update is `POST /{resource}` with `id: ""` to create; multi-step creates use the
  `/new` entry form (GET the prefilled form, POST it back) [V].
- 4.8.9 → 4.9.x moved record-scoped routes to `/{resource}/{id}/{action}`; the old forms 404, and
  `GET /test/{id}/documents` was **removed with no replacement** [V] — confirms §2.1.5.
- An unapproved IP gets **403 with an HTML "Access Denied" page**, not the JSON envelope — measured
  2026-09-29 from the workstation before its IP was added. The client must not assume a JSON body.

### 2.1 What the spec does NOT say — and what that costs

1. **No server URL** in the spec (`servers` absent) — answered by API-Key-access.md: `https://api.med-stop.com`.
2. **No response schemas.** Only request bodies are typed (`Dto.Wiz*`); every `200` is a bare
   description **[V]**. The shape of an employee, a request, a test, a selection is unknown until a
   live read. → MS0 exists for this.
3. **No enumerations.** Request fields are typed as list codes (`REASONTEST`, `CATEGORYSERVICE`,
   `STATUSEMPLOYEE`, `CATEGORYEMPLOYEE`, `DRIVINGTYPE`, `IDCLASSWIZ`, `STATUSREQUEST`,
   `STATUSSELECTION`, `CATEGORYPAYMENTTEST`, `EMPLOYERDOTAGENCY`, …) whose values come from
   `GET /List/{listcode}/{id}`, and some lists are "generated dynamically to reflect the caller's own
   records" **[V]**. We map to the codes the live account returns, never to guessed strings.
4. **No webhooks or callbacks** (zero occurrences) **[V]**. Status arrives by polling.
5. **No documents.** No PDF/CCF/MRO-letter endpoint (zero occurrences of pdf/download/attachment)
   **[V]**. The CCF copy and the MRO's verified letter stay a portal download + our upload.
6. **Staging exists, its address does not.** The guide's go-live checklist says "dry-run on staging
   before production" but names no staging host [V]. Without it, every `POST /Request/new` is a real,
   billed order (`payment`, employer credit). → Q-MS2

## 3. What the API does — the parts we use

| Need | Operation | Required inputs [V] |
|---|---|---|
| Put a person on the roster | `POST /Employee/new` (form: `GET /Employee/new`) | `dotagency, branchid, birthdate, lname, fname, gender, status, dotstatus, applicationdate, startdate, annualreview, category, address, city, state, zip, phone1, drivingtype, idclass, license, licensestate, licenseclass, licenseexpiration, idnumber`. `ssn` optional, "must be valid and unique". A matching person is reused; an ACTIVE match is refused. |
| Applicant → employee | `POST /Employee/{id}/hire` | start date not in the future, not before application date; DOT hires need the agency |
| End employment | `POST /Employee/{id}/terminate` | end date ≥ start date + reason |
| Update identity (e.g. add SSN later) | `POST /Employee` | first, last, DOB required; SSN valid + unique |
| List applicants | `GET /Employee/applicants` | — |
| Find a collection site | `GET /Request/location` | `service` TD/TA/TM, `dotstatus` Y/N, `observed` Y/F/M/N, date/time, and ZIP **or** city+state **or** lat/lng. Ranked Med-Stop sites first; provider MEDSTOP / QUEST / FORMFOX |
| Order a test | `POST /Request/new` (context: `GET /Request/new/{seed}`) | `eeid, category, reason, dotstatus, requestdate, requesttime, locationid, tosms, toemail`. Validated end to end: employee active **and** associated, site open at that time, active lab account for drug tests, duplicates in a short window refused. Seed may be a **random selection id** — the request links to it |
| Follow it | `GET /Request/{id}`, `/Request/list`, `/Request/{id}/messages` | — |
| The result | `GET /Test/{id}`, `/Test/{id}/details`, `/Test/{id}/status`, `/Test/list`, `/Test/for/{eeid}` | details = lab, specimen id, temperature, tampering, split, observed, MRO, **reviewed result + substances**, DER/MRO remarks |
| Close out a request | `POST /Request/{id}/status` | STATUSREQUESTCLOSE: REFUSAL / NO SHOW / CANCELED; comment ≥ 30 chars; refusal needs notification text |
| Random pools | `GET /Random/pools`, `/Random/pool/{id}/{statdate}`, `/Random/pool/{poolid}/members` | read-only: rates, members over a window |
| Random selections | `GET /Random/selections`, `/Random/pool/{id}/selections`, `/Random/selection/{id}` | who, when, linked request/test |
| Close a selection | `POST /Random/selection/{id}/status` | COMPLETED (with the qualifying test) / REFUSAL / CANCELED; cancel refused once expired or with an open request |
| DER | `GET /Contact/list`, `POST /Contact/primary` | a contact holds the DER role for the org or a branch |
| Alerts / compliance | `/Alert/*`, `/Compliance/*` | — |

⚠ Operations we must **not** call as a matter of design: `POST /Test/{id}/result` (records a
reviewed result and **queues a Clearinghouse report** **[V]**) — that is the MRO/C-TPA's act, not the
carrier's. `DELETE /Request/{id}`, `/Employee/{id}/remove` — evidence stays.

## 4. Auto-create in Med-Stop — when, not whether (O-4)

### 4.1 What we hold, and when [V]

| Med-Stop field | Ours | Collected at |
|---|---|---|
| fname, lname | `drivers` | office step 1, Create (`InviteApplicantDrawer.vue`) |
| phone1, email | invitation / draft | step 1 (email optional) / Part 2 |
| birthdate, license, licensestate | `record_applicant_identity` (0365) | **Part 1**, applicant screen 3 |
| address, city, state, zip | `addresses[]` (`applicationContract.ts`) | **Part 2** wizard (after the office's Send) |
| licenseclass, licenseexpiration | `cdl_class` (nullish), `cdl_expires_at` | **Part 2** |
| ssn | — **not sent** (O-5) | — |
| idnumber | the CDL number (O-5) | Part 1 |
| **gender** | **nowhere** — no column, no field | never |
| drivingtype, idclass, category, dotagency, branchid, status, dotstatus | carrier constants | map once from `/List` — [?] |
| applicationdate / startdate / annualreview | invitation date / — / — | [?] what Med-Stop accepts for an *applicant* |

### 4.2 Consequence

At **Create** we hold a name. Med-Stop requires ~24 fields. Auto-create at creation is impossible
without inventing data, and inventing a DOB or a licence on a DOT drug-test donor record is not an
option.

The drug test is office step **5–6** (`APPLICATION-FLOW-V2-PLAN.md` §2.2 [V]) — before Part 2. So
today, at the moment we need Med-Stop, we also do not hold address, CDL class/expiry, SSN or gender.

**D-MS1 (owner, 2026-09-29):** the applicant's Part 1 identity screen grows the fields the drug test
needs — **home address, CDL class, CDL expiry, gender** — and the Med-Stop record is created
**automatically the moment Part 1 is complete** (the same event that already promotes Part 1's
photos, D-AW4). No office click. No SSN, ever (O-5): the CDL number is the identifier. Our hire
(`hire_applicant`) calls `/Employee/{id}/hire`; our termination calls `/terminate`.

⚠ Part 1's address becomes a second writer of a fact Part 2's `addresses[]` also asks for. Part 2
must open **prefilled** with it, not ask again — one fact, one entry (the "deriving beats restating"
rule). Whether the Part 1 address is `addresses[0]` of the filed application is MS2's design item.

### 4.3 "Pull it from McLeod" — why not, as things stand [V]

- An **applicant is not in McLeod.** McLeod gets a driver at hire (`MCLEOD-ROSTER-SYNC-PLAN.md:406`:
  new hires appear in McLeod first, then here). The drug test happens before hire.
- Our McLeod access **excludes SSNs by agreement**: grants are column-level on purpose "not
  `db_datareader`, which exposes 1,461 SSNs" (`MCLEOD-ROSTER-SYNC-PLAN.md:384`), "the roster agent
  must never select them" (`MCLEOD-READ-ONLY-INTEGRATION-HANDOFF.md:219`).

**Moot since O-5** — no SSN is sent, so nothing needs McLeod's SSN column. Kept for the record.

## 5. The existing roster — match before create

We already use Med-Stop's random pools (O-2), so **today's drivers are presumably already on
Med-Stop's roster** [?]. Creating them would, per the spec, reuse the person or be refused as an
active duplicate [V]. MS0 therefore **reads `GET /Employee/list` and matches** (licence number +
state, then name + DOB), storing Med-Stop's employee id on our driver. Only unmatched drivers are
proposed for creation, and the list goes to the owner first. If Med-Stop already holds their SSN, we
never need McLeod's.

## 5A. What the live account says — MS0, 2026-10-13 [V]

Read from the workstation with the production key once Med-Stop fixed Q-MS7. GET only; the probe
printed shapes and counts, never a name, licence or result against a person.

**Shapes.** Lists: `rows[0]` is the array, `data.{page,pagesize,pagemax,records}`, pagesize 5–100
(4 → 400 "pagesize must be at least 5"). Employee row: `id, branchid, fname/lname/mname, address…,
state, zip, phone1, email, category, dotstatus, dotagency, licensetype, license, licenseclass,
licensestate, applicationdate, hiredate, terminationdate, annualreview, lastalcohol, lastdrug,
lastmedical, medexpiration, status` (`FULL TIME` / `APPLICANT` / `TERMINATED`). Request row: `id,
eeid, service TD|TA|TM, category, reason, observed, dotstatus, requestdate, payment, location,
authcode, testid, testdate, status`. Test row: `id, eeid, service, reason, collectiondate, result,
derfname/derlname, location, status`. Selection row: `id, poolid, service, eeid, selectiondate,
requestid, requestdate, testid, testdate, status`. Pool row: `service, category, dotstatus,
targetpercent, currentpercent, members, completedtests, scheduledtests, poolyear, frequency`.
A test's status trail (`/Test/{id}/status`): OPEN → COMPLETED → AT LAB → RESULTS → REVIEWED → CLOSED.
`/Request/location` takes `zip` or `lat`+`lng` and answers ranked sites (`pref`, `rating`,
`requests` = how often we used it). `/List/A_B_C/` answers `{code,value,label}` — 51 lists, e.g.
REASONTEST = PRE-EMPLOYMENT · RANDOM · POST-ACCIDENT · RETURN TO DUTY · REASONABLE SUSPICION ·
FOLLOW-UP · EXAMINATION · RECERTIFICATION · OTHER; STATUSREQUEST = PROCESSING · OPEN · ACTIVE ·
PREPARE · TESTING · COMPLETED · NO SHOW · CANCELED · TEST CANCELED · REFUSAL · EXPIRED.
One branch (HEADQUARTERS); the DER on every test is Marija Varmeda (O-3 confirmed).
The key holds 6 of 8 groups: `/Alert/*` and `/Branch/list` answer 403 — nothing below needs them.

**What it measures — and what each number is a feature for:**

| Measured | Number | So the product must… |
|---|---|---|
| Our active drivers matched to a Med-Stop active employee (licence + state) | 152 of 153 with a CDL | link them once and keep the link (F-1) |
| Our active driver **absent from Med-Stop** — not in the random pool | **1** | say so on the day it happens: an active DOT driver outside the pool is a §382.305 violation (F-1) |
| Med-Stop active employees we hold as archived/terminated | 1 (+3 selections in 2026 went to people we had already terminated) | flag them so the pool stops selecting people who left (F-1, F-6) |
| Med-Stop active employees whose licence we lack (our row has no `cdl_number`) | 13 | offer Med-Stop's licence to the roster — a DQF gap closed from data we already pay for (F-1) |
| Medical-card expiry differs between us and Med-Stop | 23 of 152 | show both, newest wins the question, not silently (F-1) |
| 2026 random pace (quarterly) | drug 42.58 % of 53 %, alcohol 11.61 % of 15 % — in October | a pace line: tests still owed this year per pool (F-2) |
| Selections OPEN with no request yet | 23, one dated 10/06, one 10/08 — already past | a due list with days since selection; where the driver's truck is now and the nearest site to it (F-2) |
| Pre-employment orders, 12 months | 505 for 370 people; 183 cancelled; all employer-paid | the recruiter orders from the hiring page and sees an existing open order before placing a second (F-3) |
| Collection → result closed (pre-employment, n=25) | median 61 h, p90 93 h | the hiring step shows "result expected by …" and the result files itself (F-4) |
| People with a completed pre-employment test who are active now | 105 of 301 | — (a hiring-funnel fact for the owner, not a feature) |
| Non-negative results, 12 months | 5 positive, 9 negative-dilute, 5 "not refusal" | the DER hears at once; a positive or refusal stops dispatch until return-to-duty is filed (F-5) |

## 6. Where it sits in the product — six features, each answering a measured gap

The test of each: would the DER or a recruiter otherwise have to open the Med-Stop portal and work
it out themselves? If not, it is not built.

- **F-1 Roster ↔ pool reconciliation (Safety).** Every sync matches Med-Stop's employees to our
  drivers (licence+state, then name+DOB) and answers four lists: *active here, not in the pool*;
  *in the pool, gone here*; *licence Med-Stop has, we lack*; *medical expiry disagrees*. The first
  list is the one that matters — the roster is McLeod's (D-ROS), so the gap opens the day a hire lands
  in McLeod without a Med-Stop record, and today nobody would notice until an audit.
- **F-2 Random program pace + due selections (Safety).** Per pool: target, current, tests still
  owed to reach the target by 12/31, and the quarter's open selections with days since selection.
  For each due driver: the truck they hold now (`vehicles.assigned_driver_id` → `vehicle_positions`)
  and the nearest collection sites to THAT position, not to their home — a random test is ordered
  while the driver is on the road.
- **F-3 Order the pre-employment test from the hiring page (Recruiting).** Replaces the typed
  appointment (D-AW6): site search from the applicant's ZIP (Part 1 already holds it), Med-Stop
  ranks and texts/emails the donor itself (`tosms`/`toemail` are required), the request id is
  stored; the appointment row is written from the order so the existing SMS and drawer keep working.
  Refuses a second order while one is open. Every POST shows its payload to the person first
  (Med-Stop's own rule, §9 2026-09-29).
- **F-4 Live status, result files itself (Recruiting + Safety).** The poller follows each order
  through the status trail. Recruiters see the stage and "expected by" (from F-0's measured p50/p90),
  never the result (`canReadTestingRecords`). A verified NEGATIVE files `qualification_records`
  `drug_test` with Med-Stop's test id as `reference` — the step ticks without anyone typing.
- **F-5 Non-negative result = immediate DER alert + dispatch stop (Safety).** POSITIVE or REFUSAL →
  bell to admin + safety_manager (the roles that may read testing records) and the driver is held
  out of dispatch by the existing `returnToDutyBlocked` door until a `return_to_duty` record is filed
  (§382.501). NEGATIVE-DILUTE → alert only (the MRO decides on a recollection).
- **F-6 Hire and termination mirrored (both).** Our hire calls `/Employee/{id}/hire`; a termination
  (ours or McLeod's retire) calls `/terminate` after the person confirms — which closes F-1's second
  list at its source.

Placement: **Safety › Drug & Alcohol** (new surface, gate `section("safety")`; result values inside
it filtered by `canReadTestingRecords`) holds F-1, F-2, F-5's list. The hiring drawer's drug-test
step holds F-3 and F-4. **Settings › Med-Stop** (admin) holds the key, sealed per org exactly as
FleetPal's (D-MS2), its expiry and the last sync. The poller runs in `@fleetguard/api` only (IP
allowlist + the one-scheduler rule, `docs/WORKER-DEPLOYMENT.md`).

## 7. Batches

| Batch | What | Writes to Med-Stop? |
|---|---|---|
| **MS0** | Live read — DONE 2026-10-13, §5A | no |
| **MS1** | `modules/medstop`: client, sealed per-org key + Settings page, staging mirror (employees, requests, tests, selections, pools) behind an hourly poller, the match, F-1 and F-2 on Safety › Drug & Alcohol | no |
| **MS2** | F-4 + F-5: status trail, auto-filed negatives, DER alert, dispatch stop | no |
| **MS3** | F-3: site search + order from the hiring page; Part 1 gains gender + CDL expiry (columns in their own merge, `lint:migration-ordering`); auto-create in Med-Stop on Part 1 complete (D-MS1) | yes — each with a payload preview |
| **MS4** | F-6 + F-2's "order for this selection near the truck" | yes |

## 7A. MS-UX — the page rebuilt around the four jobs (owner review, 2026-10-13)

**The owner's review of the shipped page (v2026.10.13.2):** some of what it shows is confusing and
gives no benefit. What is needed: (1) the random-selection list, (2) every drug test in progress,
(3) creating test requests, (4) expiring medicals; tabs like the other pages; data that is precise
and reliable; a sidebar icon that is not a duplicate; part of the hiring process.

### 7A.1 What was measured before planning (GET only, counts only, 2026-10-13 ~12:30 CDT) [V]

| Fact | Number | Consequence |
|---|---|---|
| 2026 random selections | 148: COMPLETED 85 · OPEN 22 · RESERVE 7 · EXPIRED RESERVE 21 · CANCELED 13 | the list is mostly OPEN, plus alternates that only matter if a primary cannot test |
| OPEN selections with no order yet | 22 (none has a request) | the DER's to-do list is "order a test for each" — the page cannot do that today |
| Selections dated in the future | 30 (Med-Stop draws the quarter ahead) | a future draw is NOT shown to anyone until its day: §382.305(l) wants it unannounced |
| COMPLETED with a test but no request | 31 of 85 | a selection can be satisfied by a test ordered for another reason; "ordered" ≠ the only path |
| Tests in progress now (not final) | 5 (pre-employment 4, random 1), 1–7 days old | small, so one flat list, oldest first |
| Open orders not yet collected | 1 | lives in the same list as "ordered, not collected" |
| Med-Stop active roster medical expiry | ≤30 d: 3 · 31–60 d: 11 · 61–90 d: 10 · later: 146 (of 170) | the numbers are Med-Stop's; ours disagree for 37 people (MS1 dry run) |
| Medical-card alerts that ALREADY exist | `dqAlertScheduler` at 90/60/30/14/0 days from `certifications`, on by default (`DQ_ALERTS_ENABLED`) | a second medical alert would be the restated fact the no-workarounds rule names |
| Sidebar icon | `TestTube01Icon` — the same glyph as the whole **Fuel** group (`navIcons.ts:84` and `:133`) | replace |
| Production sweep | `MEDSTOP_SYNC_ENABLED` is **not set** on `@fleetguard/api` | the hourly mirror is not running in production; what the page showed is not "live" |
| Request form | `GET /Request/new/{eeid}` answers the prefilled form (21 fields); `POST /Request/new` requires `eeid, category, reason, dotstatus, requestdate, requesttime, locationid, tosms, toemail`; every order is billed to the employer; date window today-14 … today+106 | ordering is a real, billed, irreversible act — preview + confirm, never one click |
| Site search | `GET /Request/location?service&dotstatus&observed&zip` → 30 ranked sites `{id, name, address, city, state, zip, pref, rating, requests}` | a picker sorted by Med-Stop's own ranking, not ours |

### 7A.2 What the page stops showing, and why

- **"Licence Med-Stop has, our file lacks"** — a roster-data chore, not a drug-and-alcohol decision.
  Moves to the driver file's data check (or is dropped); never on this page.
- **"Medical card dates disagree"** as a list — replaced by the Medical tab, which shows OUR date
  (the one the alerts use) and Med-Stop's only beside it when they differ.
- **Matched-count footer** and the generic intro — noise to a regular user.
- **Pool rate as two big cards on top** — kept, but as a compact strip inside the Random tab, where
  the question "are we on pace?" is asked.

### 7A.3 Proposed shape — one page, five tabs (`AppTabs`, counts, tab + filters in the URL)

The house queue-list pattern (DESIGN-SYSTEM-CONTRACT §5.1 #2: `AssignmentsPage` / `DispatchLoadsPage`).
A primary **"Order a test"** button in the page header opens one SlideOver from every tab.

| Tab | Who sees it | Rows | Row action |
|---|---|---|---|
| **Random selections** (default) | admin, safety_manager only (§382.305(l)) | The pool year's draws, all of them, by default (D-MSUX18): due now (longest-waiting first), then upcoming (soonest first), then tested / cancelled / expired / alternates (newest first), each with its status · a **Show** filter (All, Due now, Upcoming, Tested, Not tested, Alternates) · pool pace strip on top (rate, tests still needed, draws ahead) | **Order test** on a due draw only (prefilled: random, the selection id as Med-Stop's seed) |
| **In progress** | safety (stage + expected by); the result column only for testing-record roles | every order not collected + every test not final, any reason (pre-employment, random, post-accident…): person, reason, stage, collected, expected by, days | open the person; "call the site" info |
| **Results** | admin, safety_manager | last 12 months, filter by outcome; violations and dilutes first; MS2c's "found on first read" as a filter, not a second table | file return-to-duty (existing door) |
| **Medical cards** | safety | drivers whose card (from `certifications`, the alerting source) expires ≤ 60 d or has expired; Med-Stop's date only where it differs | open the qualification file |
| **Roster check** | safety | only the two lists that are violations: *driving here, not in the pool* · *in the pool, gone here* | "Add in Med-Stop" / "Terminate in Med-Stop" (MS4 writes) — until then a link to the portal |

Empty states say what is fine ("No one is waiting on a random test."). No KPI cards above tabs.

### 7A.4 Ordering a test (F-3 widened) — one SlideOver, three entry points

Entry: page header (any reason) · a random selection row (reason fixed, seed = selection) · the
hiring drawer's drug-test step (reason fixed: pre-employment).

Steps: person (must be on Med-Stop's roster — matched by licence or name+DOB) → test (drug / alcohol)
and reason → collection site (ZIP of the person's address; for a driver on the road, the truck's last
position, `vehicle_positions` via `vehicles.assigned_driver_id`) → date and time → who is notified
(the driver's phone and e-mail; Med-Stop requires both fields) → **preview of exactly what will be
sent, with "This order is billed to Silvicom"** → Confirm. Refuses a second open order for the same
person and test. The returned request id is stored; the hourly sweep then follows it like any order.

### 7A.5 Hiring

The drug-test step already shows Med-Stop's order, stage and "expected by" (MS2c) and files the
negative by itself (MS2b). It gains **Order pre-employment test** — the same SlideOver.
⚠ It works only for an applicant **Med-Stop already holds** (27 applicants there on 2026-10-13, created
by hand in the portal). Creating the Med-Stop record from our applicant needs gender, home address
and CDL class/expiry in Part 1 (D-MS1) — its own merge first (`lint:migration-ordering`). Until then
the step says "Add this applicant in Med-Stop first" with the portal link.

### 7A.6 Precision and reliability — what must be true before anyone relies on it

- **R1 Switch the sweep on in production** (key in Settings + `MEDSTOP_SYNC_ENABLED=true` on `api`),
  then show "Read from Med-Stop 12 minutes ago" on every tab, and a caution when the last read is
  older than 2 hours or failed.
- **R2 One medical source.** `certifications` (what alerts and the DQ file use) is authoritative;
  Med-Stop's date is evidence beside it. The 37 disagreements must be explained before the tab ships
  — sample 10 against the cards on file (needs a production read the session could not make).
- **R3 Only certain matches act or name a person's result** (already true for the stop and the
  hiring card); name-only matches are shown as "Unconfirmed — check the licence".
- **R4 A future draw is never shown as due**; reserves are shown as reserves, never as due. (Until
  2026-10-14 a future draw was not shown at all — superseded by D-MSUX18, §7A.17.)
- **R5 Every count on a tab is the length of the list under it** — no separately computed numbers.

### 7A.7 Sidebar

Replace `TestTube01Icon` (Fuel's) with **`MicroscopeIcon`** — a lab test, a silhouette nothing else
in the sidebar uses. Alternatives: `MedicineBottle02Icon` (specimen cup), `FlaskConicalIcon`.

### 7A.8 Batches

| Batch | What | Writes to Med-Stop |
|---|---|---|
| UX1 | Five tabs on today's data, remove the noise, icon, freshness line, R3–R5 | no |
| UX2 | Medical tab on `certifications` + Med-Stop beside it (after R2's sample) | no |
| UX3 | Order-a-test SlideOver from Random and header (drivers already in Med-Stop) | **yes**, preview + confirm |
| UX4 | Same SlideOver in the hiring step for applicants Med-Stop holds | **yes** |
| UX5 | Part 1 fields → auto-create the Med-Stop applicant (D-MS1), then UX4 for everyone | **yes** |

### 7A.9 Questions for the owner (Q-MSUX)

1. **Who may order?** Recommend: admin + safety_manager for every reason; recruiter only for
   pre-employment from the hiring step.
2. **Billing.** Every order is charged. There is no Med-Stop test host (Q-MS2) — the first order from
   the product is real. Recommend: first order made together, on a real applicant who needs one.
3. **Observed collections** (return-to-duty and follow-up must be observed, §40.67) need the donor's
   gender, which we do not hold. Recommend: UX3 orders unobserved reasons only; observed waits for UX5.
4. **Medical authority** (R2): confirm `certifications` wins and Med-Stop's date is only shown.
5. **Who is notified** of an order: the driver by SMS + e-mail (Med-Stop sends it)? And a copy to the
   DER?

### 7A.10 Owner answers (2026-10-13) and what they decide

1. **Who orders: safety_manager, admin and recruiter** — for every reason. D-MSUX1: the order action is
   gated on those three roles (derived from the role list in shared, never typed twice). The recruiter
   still never sees a RESULT (`canReadTestingRecords` unchanged); ordering is not reading.
2. **First order: after everything is built, on a real person who needs one** (no test host, Q-MS2).
   D-MSUX2: the order flow ships behind the per-org switch it already has (the credential's
   `enabled`) and is exercised for the first time by the owner, watched.
3. **Gender joins the 360 flow.** D-MSUX3: Part 1 asks it (with home address, CDL class, CDL expiry —
   D-MS1), as new columns in their own merge first (`lint:migration-ordering`), wording reviewed beside
   the EEO questions. Unblocks observed collections and auto-creating the Med-Stop applicant.
4. **Medical-card expiry comes from Samba and Med-Stop, and the DQF pulls it from there, cross-checked.**
   What exists today [V]: the DQF's medical card (`certifications.medical_card`) is filed by McLeod's
   nightly roster sweep through `recordSyncedCredentials` and by office uploads; **Samba is not
   connected to the product at all** (deferred on cost 2026-08-26; 2026-09-17 note: the carrier has a
   live account, "do not build an integration"). So:
   - D-MSUX4a: Med-Stop's `medexpiration` becomes a FILER of the medical card through the same
     `recordSyncedCredentials` door (source `medstop`, write-only-on-change), for certain matches only.
   - D-MSUX4b: the cross-check compares every source we hold per driver (McLeod, Med-Stop, the card on
     file; Samba once connected) and lists only the disagreements, with each source's date beside it.
   - **Q-MSUX6 (new, blocks Samba):** connecting Samba reopens the 2026-08-26 cost decision. What we
     would need: Samba API credentials and which product carries the medical (the CDLIS MVR carries the
     self-certification + medical expiry for CDL holders; a monitoring subscription pushes changes).
     Recommend: Med-Stop now (we already pay for it, 170/170 active employees carry a date), Samba as a
     second source once its access and per-pull cost are known.
   - ~~Q-MSUX7~~ — **answered 2026-10-13: the recommendation.** When sources disagree, the card on file
     backed by a scan (`certifications.document_id`) wins; without one, the EARLIEST date any source
     gives (the safe side), and the driver is flagged for review. D-MSUX7: one pure rule
     (`resolveMedicalExpiry`, shared) over the scanned card and each source's latest claim
     (`credential_source_dates`, 0467), called by BOTH sweeps — so McLeod and Med-Stop reach the same
     answer and can never take turns superseding each other. ⚠ This changes McLeod alone too: its date
     no longer supersedes a scanned card, either direction.
5. **Never text or e-mail drivers.** Read from Med-Stop, GET only [V]: the order form carries
   `sendsms` and `sendemail` (BOOLEAN Y/N, empty by default); the spec says only "requested SMS/email
   notifications are sent"; the 20 newest orders show no notify fields set and the newest has zero
   messages (`/Request/{id}/messages`). `tosms` and `toemail` are still REQUIRED fields.
   D-MSUX5: every order is sent with `sendsms=N`, `sendemail=N`, `tosms`/`toemail` = the ORDERING
   OFFICE's contact (the org's DER phone/e-mail), never the driver's — so even a Med-Stop default we
   cannot see lands in the office. `POST /Request/{id}/notify` is never called (allow-list). After the
   first real order, `/Request/{id}/messages` must read zero driver messages; that check is part of
   the first-order runbook. The preview shows "Med-Stop will not text or e-mail the driver."
   `notification` (CATEGORYNOTIFY: DIRECT COMMUNICATION · SIGNED TEST NOTIFICATION FORM · PHONE CALL ·
   OTHER) is how the EMPLOYER told the donor — the order form asks the office which.
6. **Sync on.** The Settings switch was on; the second switch, `MEDSTOP_SYNC_ENABLED`, was NOT set on
   `@fleetguard/api`. Set 2026-10-13 ~13:10 CDT (api only — no other service has it); first sweep ~7
   min after the restart.

### 7A.11 UX3 as built, and the first-order runbook (2026-10-13)

**Built** (UX3a #1509: 0468; UX3b): Safety › Drug & Alcohol has **Order a test** in the header (the
three order roles, `MEDSTOP_ORDER_ROLES` in shared — D-MSUX1) and **Order test** on every unordered
random selection (seed = the selection). The drawer: driver (Med-Stop active roster, licence or
name+DOB match only, R3) → drug/alcohol → reason (post-accident, reasonable suspicion; random only from
a selection) → day (today … +30) and time → site (ZIP, or the assigned truck's last fix) → how the
driver was told → **Review order** (the api's own payload) → **Place order**.
- D-MSUX6: ordering has its OWN switch, `medstop_credentials.orders_enabled`, off by default (0468) —
  `enabled` already gates the read and is on. Settings › Med-Stop › Ordering tests; switching ON needs a
  fresh sign-in and the office contact; OFF needs nothing.
- D-MSUX8: the client allow-lists ONE write, `POST /Request/new` (`MEDSTOP_WRITES`), sent once and never
  retried; a timeout is reported as "may have been placed — check Med-Stop" and audited
  (`medstop.order.unknown`). Placed orders are audited `medstop.order.placed`.
- The api refuses: ordering off · no office contact · a person not certainly matched · a selection not
  open, not this person's, already ordered, or for the other test · **any unfinished Med-Stop order for
  the same person and test, asked live** (`/Request/for/{eeid}`) · a day outside today … +30.
- Measured (GET only) and acted on: the prefilled form carries the DRIVER's phone in `tosms` — the order
  overwrites it with the office's; a selection-seeded form fills `eeid` but not the reason/test.
- NOT measurable without a real order [?]: the exact `requesttime` format Med-Stop accepts (sent as
  `HH:MM`), whether the POST answer carries the request id (we send the form's id and fall back to it),
  and how Med-Stop links a random order to its selection.

**First-order runbook** (answer 2 — owner watching, a real person who needs one):
1. Settings › Med-Stop: enter the office e-mail and 10-digit phone, **Switch ordering on** (password).
2. Order the test from the drawer; read the review aloud before **Place order**.
3. In Med-Stop's portal, open the new request: person, test, reason, site, date/time as reviewed;
   payment = company credit.
4. `GET /Request/{id}/messages` (probe script, GET only) must show **zero** messages to the driver.
5. For a random order: the selection shows the new request id in Med-Stop.
6. Within the hour, the order appears under In progress. Record the measured answers to the three [?]
   above in §9; leave ordering on only if all six held.

### 7A.12 UX4 as built — the pre-employment order from the hiring step (2026-10-13)

**Built:** the hiring drawer's drug-test step (`MedstopTestCard`) shows **Order pre-employment test** to
the three order roles (D-MSUX1, recruiter included) when Med-Stop holds the person on its **APPLICANT**
roster with a licence or name+DOB match. The card emits the Med-Stop id and `ApplicantRecordPage` swaps
the step drawer for the order drawer — the same one-drawer-at-a-time rule as the application review
(a SlideOver inside a SlideOver is a focus trap inside a focus trap). The order drawer moved out of
`features/drugAlcohol` to `components/medstop/` (and its composable to `composables/`), because two
features now open it and `lint:boundaries` forbids either reaching into the other.
- D-MSUX9: **a reason belongs to one Med-Stop roster** — `MEDSTOP_ORDER_ROSTER` in shared:
  PRE-EMPLOYMENT → applicant, every other reason → active. The api looks the person up on THAT roster
  only, and requires OUR record to agree (an applicant for the applicant roster, an active driver for
  the active one). So a working driver cannot be ordered a pre-employment test, an applicant cannot be
  ordered a post-accident one, and a person hired here but still an applicant in Med-Stop is refused
  both until the two agree. Safety's header offers only `MEDSTOP_HEADER_ORDER_REASONS` (post-accident,
  reasonable suspicion), derived from the same map.
- Unchanged from UX3 and re-proved for the applicant: the live open-order refusal (`/Request/for/{eeid}`),
  the allow-list (`MEDSTOP_WRITES` = `POST /Request/new` only), `sendsms`/`sendemail` = N with the office
  contact, the ordering switch. The review says "Med-Stop will not text or e-mail the applicant". The
  recruiter still receives no result (`readMedstopTestsForDriver` filters it; ordering is not reading).
- When Med-Stop does not hold the applicant: the step says "Add this applicant in Med-Stop first" with a
  link to Med-Stop. Creating them from our record is UX5 (D-MS1).
- **Q-MSUX8 (open):** the employer portal's exact address. The vendor documents name only
  `https://med-stop.com` (and `apiadmin.med-stop.com`, the API-key console), so the link goes to the
  site, `MEDSTOP_PORTAL_URL` in shared. Recommend: the owner pastes the address they log in at, and it
  replaces that one constant.

### 7A.13 UX5 — what Part 1 already holds, and the one fact it lacks (2026-10-13)

**Inventory [V], before building anything.** D-MS1 (2026-09-29) said Part 1 must grow home address, CDL
class, CDL expiry and gender. Application Flow v2 has since built three of the four. Part 1's screens
are `about · address · licence · otherLicences · screening`, and its writer `record_applicant_intake`
(0376) files them as follows:

| Med-Stop applicant field | Ours, today | Since |
|---|---|---|
| fname, lname | `drivers` (office's Create) | — |
| birthdate | `drivers.date_of_birth` via `record_applicant_identity` | 0365 |
| address, city, state, zip | `application_intakes` + `drivers` (fill-only) | 0376 |
| licenseclass | `drivers.cdl_class` | 0376 |
| license, licensestate, licenseexpiration | `application_intake_licences` position 0, `drivers.cdl_*` | 0376 |
| phone1 | `application_intakes.phone` | 0376 |
| **gender** | **nowhere** | → 0469 |

So UX5's "Part 1 fields" merge is ONE column: the donor's gender. Med-Stop's `/List/GENDER` (GET,
2026-10-13) holds only MALE and FEMALE.

- **D-MSUX10 — where it is kept, and that it may be declined.**
  - `application_intakes.donor_gender` (`male | female | declined`; NULL = never asked), NOT `drivers`.
    The person deciding a hire must never see an applicant's sex. This is the rule the questionnaire's
    reserved `eeo` key already keeps (APPLICATION-SYSTEM-PLAN §6).
  - The recruiter decides the hire. The office browser reads `drivers` (`ApplicantRecordPage` selects
    `*`), while `application_intakes` has no client policy at all. So the value reaches only the
    server-side readers that name it: the Med-Stop applicant create and an observed order. The step
    never shows it.
  - **Declining is an answer and never a gate.** The office then adds the applicant in Med-Stop by
    hand, as it does for every applicant today.
- **Proposed screen wording** (for the owner, and for counsel beside the EEO material; it ships in
  UX5b):
  - Label: *"Gender, for your drug test"*.
  - Choices: *Male · Female · I'd rather not say*.
  - Help text: *"The drug-testing company needs this to set up your test, and some tests are watched by
    a person of the same gender. It is not part of your application — the people reviewing it do not
    see your answer. If you'd rather not say, the office sets up your test with you directly."*
- ~~Q-MSUX9~~ (answered 2026-10-13, ships as written): confirm the help text, or send it to counsel with the package
  (COUNSEL-REVIEW-PACKAGE.md). Recommend: ship it with the text above. The value is never shown to the
  person deciding, and declining has no consequence beyond a phone call.

**Owner, 2026-10-13: "proceed as recommended — and double check our form for creating the applicant
matches Med-Stop's form exactly."** So:
- Q-MSUX9 is answered: the wording above ships.
- Q-MSUX10 is answered: an existing driver's gender is read from Med-Stop's own record at order time
  and never stored here.
- Driving type NON-EXCEPTED INTERSTATE, ID class CDL, category DRIVER, and Med-Stop's own date
  defaults. The start date is the one exception — see below.

**Med-Stop's applicant form, checked three ways (GET only, 2026-10-13) [V]:**
1. **The live form against the spec.** `GET /Employee/new` returns 46 keys, exactly `Dto.WizEmployee`'s
   46: none missing, none extra. 24 are required: dotagency, branchid, birthdate, lname, fname, gender,
   status, dotstatus, applicationdate, startdate, annualreview, category, address, city, state, zip,
   phone1, drivingtype, idclass, license, licensestate, licenseclass, licenseexpiration, idnumber.
2. **The form's own defaults.** dotagency `FMCSA`; dotstatus `Y`; branchid = the carrier's one branch;
   country `US`; applicationdate = today, startdate = today, annualreview = today + 1 year, each as
   `YYYY-MM-DDT00:00:00Z`. The GET creates nothing: the message reads "Please make sure all
   information is correct" and `recordid` is empty.
3. **What the office's hand-entered applicants actually hold** (the newest of 28, shapes only, never
   values):
   - Employment: status `APPLICANT`, category `DRIVER`, drivingtype `NON-EXCEPTED INTERSTATE`,
     dotstatus `Y`, dotagency `FMCSA`, branch `N`, annualreview set, **startdate EMPTY on every one**.
   - ID: type `CDL`, numbered with the licence number, class `A`, status `ACTIVE`.
   - Person: phone1 `(999) 999-9999`, zip 5 digits, country `US`, state 2 letters, gender in capitals.

The `/List` values used: DRIVINGTYPE (NON-)EXCEPTED INTER/INTRASTATE · IDCLASSWIZ CDL|DL|CLP|… ·
CATEGORYEMPLOYEE DRIVER|… · LICENSECLASS A|B|C|D|OTHER · GENDER MALE|FEMALE ·
STATUSDOT Y|N|B. STATUSEMPLOYEE answers "not found" as a list; `APPLICANT` is read off the records.

**So the create (UX5c) does this:**
- It sends Med-Stop's own form back, as GET returned it, with every key kept and only ours filled in.
  Med-Stop's names, defaults and branch can therefore not drift from what we send.
- Ours: names, birthdate, gender (upper-case), address/city/state/zip, phone1 in `(999) 999-9999`,
  licence number/state/class/expiry, idnumber = the CDL number (O-5, no SSN), idclass `CDL`,
  drivingtype `NON-EXCEPTED INTERSTATE`, category `DRIVER`, status `APPLICANT`, all dates in the form's
  own shape.
- **startdate: cleared, to match every hand-entered applicant** — although the spec marks it required
  and the form defaults it to today. An applicant has not started. If Med-Stop refuses the empty
  value, the create fails loudly and nothing is created. ⚠ First-create runbook: confirm the record
  in the portal looks like a hand-entered applicant (status APPLICANT, no start date).
- A pure, shared builder (`fillMedstopApplicantForm`) fills the form and REFUSES to send while any of
  the 24 required keys (startdate excepted) is empty. Its test pins the 24 keys and the measured
  46-key form. It cannot read the spec in CI, because `docs/Med-Stop/` is local only.
- STATE / COUNTRY lists could not be read: the workstation's address changed mid-session and Med-Stop's
  IP filter refuses it. So a licence from outside the US is not sent; the step says so.

**Batches:**
- **UX5a (0469, merged #1518):** the column, and `record_applicant_intake` accepting the key (same
  signature, absent key kept). Matrix: `application-intake-v2.test.mjs` §8.
- **UX5b (this merge):** Part 1's screen 7 ("Questions about drug and alcohol testing") asks it with
  the approved wording, and posts it in screen 7's write.
  - One of the three choices is required; "I'd rather not say" is one of them.
  - It is never kept on the device (screen 7's rule, `partOneLocal.ts`), and the office's Part 1
    correction cannot set it: the office never sees it.
  - An applicant who passed screen 7 before this merge is not asked again; their NULL reads as
    "never asked".
- **UX5c (built, 0471):** the create, run by the hourly Med-Stop job right after the sweep, so the
  roster mirror is fresh. In order:
  - D-MSUX11: ordering must be on (`orders_enabled`). There is no test host, so a staging applicant
    would be a fake person in the carrier's real Med-Stop.
  - Recruiting supplies the applicants (`partOneFactsForMedstop`): Part 1 complete, invitation not
    revoked, still an applicant, not archived, no disposition. Medstop decides and writes; the queue
    job joins the two, so neither module reads the other's tables.
  - Skip when the application was already tried (`medstop_applicant_creates`, unique per invitation),
    when Med-Stop holds the person on ANY roster by ANY match (a name-only match too), when the gender
    was declined or never asked, or when the licence is not from a US state.
  - Fetch Med-Stop's blank form, fill it, CLAIM the attempt (a row, `unknown`), POST once, then record
    `created` / `refused` (Med-Stop's sentence) / `unknown` (no answer). Audit
    `medstop.applicant.*` carries ids only.
  - At most 10 a sweep.
  - `MEDSTOP_WRITES` = `POST /Request/new` + `POST /Employee/new`, and a test pins exactly those two.
  - The hiring step shows the attempt until Med-Stop's roster shows the person. A refusal says "add
    them in Med-Stop yourself".
  - **First-create runbook** (with the first order, owner watching): ordering on → an applicant
    finishes Part 1 → within the hour, open the new person in Med-Stop's portal. Check status
    APPLICANT, no start date, CDL id = licence, gender, address, phone `(999) 999-9999`, class and
    expiry. If Med-Stop refused the empty start date, the step shows its sentence: record it in §9 and
    decide then.
- **UX5d:** RETURN TO DUTY and FOLLOW-UP from Safety's drawer, observed, with the donor's gender
  read from Med-Stop's own employee record at order time (Q-MSUX10). Built as §7A.14 says — the
  gender is NOT sent in the order (Med-Stop's order form has no gender key).

### 7A.14 UX5d — return-to-duty and follow-up, observed (2026-10-14)

**Read from the spec first (`docs/Med-Stop/openapi.json`, local) [V]** — and it changed the plan:
- The order form, `POST /Request/new`'s body, is `Dto.WizRequest`: `observed` (BOOLEAN Y/N) and
  `observedreason` (text, ≤ 1000), and **no gender key**. `employeegender` is on `Dto.Request`, the
  READ shape of a request. So the order does not carry the gender. Med-Stop checks the site against
  its own record of the donor: "observed collections require a site able to perform them".
- The site search, `GET /Request/location` (`Dto.RequestLocation`), takes `observed` from list
  OBSERVED: **Y · F = female observer only · M = male observer only · N**, and an `eeid`. "Observed
  collections only return sites able to perform a gender-matched observed collection."
- The reason codes are MS0's measured REASONTEST values: `RETURN TO DUTY`, `FOLLOW-UP`.

**Built:**
- D-MSUX12 — **what is observed.** `medstopOrderIsObserved` (shared): a return-to-duty or follow-up
  **drug** test (§40.67(b)). Observation is a urine-collection rule (Part 40 Subpart E), so the same
  reasons' alcohol test is a breath test, sent `observed: "N"`, and reads nobody's gender.
- Both reasons join `MEDSTOP_ORDER_REASONS` on the ACTIVE roster (D-MSUX9). `MEDSTOP_HEADER_ORDER_REASONS`
  derives them unchanged: Safety's header now offers post-accident, reasonable suspicion, return to
  duty, follow-up.
- The order: `observed: "Y"` and `observedreason` = "Return to duty drug test: directly observed
  collection required by 49 CFR 40.67(b)." (or "Follow-up …"), for the collector.
- D-MSUX13 — **the gender's two uses, and nothing else.** `GET /Employee/{id}` (the path measured
  2026-10-13; `gender` in capitals) is read live:
  1. by the site search, which then asks for `observed=M` or `F` with the `eeid` — a site that can
     observe THIS donor, rather than Y and hoping;
  2. by preview and place, which refuse with "Med-Stop has no gender for this driver — order it in
     Med-Stop." (`medstop_gender_missing`, 409) before anything is billed.
  Anything but MALE / FEMALE counts as no gender. The value is never written, logged, audited, put in
  the payload, or sent to the browser; a test asserts the POST body and the api's answer carry no
  gender.
- The person comes first: the site search for an observed test needs the driver, who must be
  orderable (active roster, licence or name+DOB match, R3) before their record is read — the drawer's
  Search waits for the driver. Changing the test, reason or driver drops the sites found.
- The review shows **"DOT, observed (same-gender observer)"** and never the gender (recommended in the
  handoff; adopted).
- Re-proved for observed orders: R3 (a name-only match is refused before any read), the live
  open-order refusal, single-shot POST, `sendsms`/`sendemail` = N with the office contact, the off
  switch (`orderClient`, unchanged), and the allow-list (still exactly two writes).

**Not built — return to duty from the dispatch hold.** MS2b's `returnToDutyHold` stops dispatch until
an RTD record dated on or after the violation. Offering "Order return-to-duty test" from that hold
would be the shortest path, but no Safety surface shows the hold yet (MS2's open item: the driver
file, compliance overview and DQ binder), so there is nowhere in Safety to put the button; and
§40.305 puts the SAP's evaluation and prescribed treatment before any return-to-duty test, a step the
product does not hold. **Recommend:** leave it out until the hold is shown on the driver file (the MS2 open
item), then offer the order there to the order roles only, with "SAP evaluation done?" as an
explicit confirmation.

**What only the first real orders answer [?]** — step 6 of §7A.11's runbook records these:
1. The exact `requesttime` format Med-Stop accepts (sent as `HH:MM`).
2. Whether the POST's answer carries the request id.
3. How Med-Stop links a random order to its selection.
4. Whether `/Request/{id}/messages` reads zero messages to the driver.
5. Whether Med-Stop accepts `observed: "Y"` with `observedreason` as sent, and shows the observed
   requirement on the request (and its eCCF) in the portal.
6. Whether `GET /Employee/{id}` is the record that carries `gender` for every active driver (measured
   on one), and whether a site from an `observed=M|F` search is accepted at place time.

### 7A.15 The Med-Stop hold on the driver file, the fleet queue and the binder (2026-10-14)

**The gap (MS2's open item) [V]:** a Med-Stop positive or refusal stops dispatch (`returnToDutyHold`,
MS2b), but the four surfaces that show return-to-duty paperwork — the driver page's notice, its
qualification file, the fleet queue (`/api/compliance/overview`) and the DQ binder — read only the
application's admission flag (`drivers.return_to_duty_required`). A held driver's file read clean,
and the office could not see why a load was refused or where to file the paperwork that lifts it.

**Who may know [V]:** the fleet queue is `roster` view — admin, fleet manager, auditor, dispatcher,
safety manager, recruiter. A Med-Stop result is a §382.401(a) record: admin and safety manager only
(`canReadTestingRecords`), and `return_to_duty` is itself a testing-record kind. So a violation cannot
simply join everyone's file: for a dispatcher, a new "Return-to-duty documentation — missing" would
state the result.

**Built:**
- D-MSUX14 — **one rule, the door's.** `buildDqFile` takes `returnToDutyViolationOn`. The item
  applies on the admission OR a violation, and its state is decided by `returnToDutyCause` itself, so
  a return-to-duty record dated BEFORE the violation documents an earlier process: the item stays
  missing exactly while dispatch stays stopped (a test walks every combination against the door).
- D-MSUX15 — **who sees what.**
  - Admin, safety manager: the driver page names the result and its day ("Med-Stop reported a
    positive or refused test collected MM/DD/YYYY …"); the file, the fleet queue and a RESTRICTED
    binder ask for return-to-duty documentation.
  - Everyone else: the driver page says only that the driver cannot be dispatched until a safety
    review is closed (`RETURN_TO_DUTY_BLOCK.dispatch`, the dispatcher's existing words). Their file,
    their queue and a default binder are unchanged — Med-Stop is not even read for them.
  - The admission notice is unchanged and still reads the same to every reader.
- `GET /api/compliance/drivers/:id/dispatch-hold` (roster view) returns `dispatchHoldForReader` of the
  dispatch door's own read (`returnToDutyStanding`), so the page cannot say "clear" about a driver
  the door refuses.
- The queue and the binder read the org at once (`medstopViolationsByDriver`: two org-scoped reads,
  certain matches only, D-MS5's baseline excluded), through the same `newestViolation` the door uses.
- The binder judges as at its date: a violation after it was not yet owed.
- The 91-day alert scheduler and the weekly digest pass no violations: they do not know their reader.
  The DER already has MS2b's alert.

**Still open:** a request-level REFUSAL (MS2's other open item) is not acted on — §7A.16.

### 7A.16 A request Med-Stop closes as REFUSAL (2026-10-14)

**The gap [V]:** a donor who refuses before a specimen exists leaves no test row. The refusal lives on
the REQUEST (`STATUSREQUEST` REFUSAL), which the sweep mirrors into `medstop_requests` — and nothing
read it: no DER alert, no dispatch stop. §40.191 makes it the same violation as a refused specimen.
None in 2,152 requests (MS2a, 2026-10-13), so this is built for the first one, not for a backlog.

**Built (no migration):**
- D-MSUX16 — **one meaning, in shared.** `medstopRefusalDay`: a REFUSAL request's violation day — the
  visit's (`tested_local`), else the appointment's (`requested_local`), else the earliest day there
  is (as a test with no stamp, so only a return-to-duty record discharges it).
- D-MSUX17 — **D-MS5 without a column.** A request has no `baseline`, but it carries when it was made
  and when our sweep first saw it. One made more than `MEDSTOP_HISTORY_DAYS` (14, now shared with the
  test sweep's baseline) before we first saw it was decided before the product watched: history,
  never alerted or held on.
- **The hold:** both violation reads (`medstopViolationOn` for the dispatch door, `medstopViolationsByDriver`
  for the queue and the binder, §7A.15) take the newest of a person's violating tests AND refused
  requests. Certain matches only, as before.
- **The DER alert:** after every sweep, each refused, non-history request is sent to the roles
  `canReadTestingRecords` admits, in a refused test's own words (`medstopResultNotice`, "refusal to
  test … Dispatch is stopped" or "… was NOT stopped — confirm who this is"). `medstop_requests` is
  Med-Stop's mirror and has no "acted on" column, so "once" is the notification ledger's (0432,
  durable past inbox pruning): dedupe key `medstop-request-refusal:<request id>`.
- The sweep line counts them ("N refused orders").

**Listed under Results to review** (built 2026-10-14, after the hold and the alert). The tab is where
the DER's notification sends them, so a refusal it does not list is a notice pointing at nothing.
`readResultReview` reads refused orders beside tests: `MedstopResultRow` now carries `source`
("test" | "order") and `medstopId`, and the table is keyed by both, because Med-Stop numbers tests and
orders separately. The split follows the alert: `medstopRefusalDay` non-null (alerted) goes in the
recent list, null (history) goes in "Found on the first read". The year is counted on the visit's day,
else the appointment's. An undated refusal is shown, because it stops dispatch. The row reads "Refused
before a specimen was collected". No real refusal has been seen yet (§7A.16); if the first one carries
a field this row needs, that is a follow-up, not a reason to hide it until then.

### 7A.17 The Random tab lists the whole year (D-MSUX18, 2026-10-14)

The owner's second review: the Random tab showed only draws due now and not tested (3 of 148 in
2026, counted in production 10/14: 3 due, 83 tested, 33 cancelled or expired, 29 scheduled ahead from
10/25 to 12/31), not the complete list of who is scheduled for a random test.

- D-MSUX18 — **The list is every draw of the pool year, shown by default**, each with its state
  (`randomDrawsThisYear`, shared): Due now, Upcoming, Tested, Alternate, Alternate (not used),
  Cancelled, Expired (not tested), or Med-Stop's own word for a status nobody mapped. An earlier
  year's draw still OPEN and untested is listed too, because it is still due. The **Show** filter
  narrows the list; "Due now" is the DER's to-do and the tab's badge (R5: the badge is the length of
  the list that filter shows).
- This reverses MS1-review's R4 ("a future draw never shows early"). §382.305(l) requires that the
  DRIVER is not told in advance. It does not stop the DER from knowing the schedule. So the list is
  still held to `canReadTestingRecords` (null for every other role), it reaches no driver-facing
  surface, and **Order test** is offered only on a draw that is due. An upcoming draw cannot be
  ordered ahead of its date from here.
- `DueSelection` and the separate Alternates card are gone. The contract is
  `selections: { draws: RandomDraw[] }`.

### 7A.18 The Random tab opens on the current quarter's draw (D-MSUX19, 2026-10-15)

The owner checked the staging Random tab against the office's paper list ("HM TESTING 2026") and
called it wrong. Measured against Med-Stop's API the same day (GET only, counts only):

- **The data was complete.** `/Random/selections` gave 866 rows, the same as the 18 pools' own
  `/Random/pool/{id}/selections` summed, with no duplicates. Our 2026 OPEN and COMPLETED counts
  equal each pool's `scheduledtests` and `completedtests` (drug 16/67, alcohol 6/18). The 7 future
  RESERVE rows are alternates, not scheduled tests.
- **The paper list is the Q4 draw.** All 21 legible names are Q4 2026 selections, dated 10/06–12/21
  (one person drawn for both drug and alcohol). The only other Q4 rows are 7 alternates, two tests
  already done, one cancelled draw and one open draw. The two crossed-out lines are likely among
  those.
- **The cause was the date rule.** Med-Stop draws a quarter's names when the quarter opens and
  spreads their dates across it. D-MSUX18 called an OPEN draw dated after today "upcoming", with no
  order button, which split the office's one list into 3 due and 19 not yet.

Owner's ruling:

- D-MSUX19 — **The tab opens on the current quarter's draw**: every draw of the pool period today
  falls in, alternates aside (they are under Show). The period is derived from the pool's own
  `starts_on` and `frequency` (`drawPeriodOf`), not assumed from the calendar. An unknown frequency
  word makes the whole pool the period. **Every OPEN untested draw of the current or an earlier
  period is `due` and has Order test**, whatever day Med-Stop dated it. Only a draw in a later
  period is `upcoming`. "Due now" is renamed "To test", and the badge still counts it. "Whole year"
  is D-MSUX18's list, and the default when no pool covers today. Still held to
  `canReadTestingRecords`; nothing reaches a driver.
- Not done here: 70 selections (29 people, 7 in 2026) point at Med-Stop employees on none of the
  three roster lists we copy (`/Employee/{id}` still answers for each). They show "Unknown to
  Med-Stop's roster". `/Random/selections` carries `fname`/`lname` itself; storing them is a
  migration and then a reader, in two merges.

### 7A.19 The dispatcher beside each draw (2026-10-15)

The owner asked for the name of the dispatcher in charge of each driver on the Random tab: the person
the DER calls to take a drawn driver off the road for the collection.

**Measured in production first (2026-10-15, counts only) [V]:** 202 trucks carry a McLeod fleet code
and McLeod has sent 14 fleets and 17 dispatcher logins. **None of the 14 fleets is linked to a
dispatcher yet.** That link is an office act in Settings › McLeod fleets (D-LM4), and the feed never
writes it. 161 trucks have an assigned driver.

**Built (no migration):**
- D-MSUX20 — **the board's answer, not a second one.** `readDriverDispatch` (livemap) reads the dispatch
  board's own rows: the roster's driver-to-truck pairing, the truck's fleet, the load on it now. So the
  Random tab and the board can never name different people. It reaches the medstop module through
  the index only (arrow `medstop -> livemap`). The scope-free half of `readDispatchLinks` became
  `readFleetDispatchers`, and `dispatcherName` moved to shared, so the server and the board name a
  login the same way.
- Two axes, never merged (D-DB1): the fleet's dispatcher, and the dispatcher of the load the truck
  carries now. The column shows the fleet's dispatcher, with "load dispatched by …" when a colleague is
  covering. Until the fleet is linked, it shows the load's dispatcher and says that is who it is
  ("dispatching its load"). With no load either, it shows the fleet code and says the fleet is not
  linked. A drawn driver with no truck on the board reads "No truck".
- Held to the testing-record roles with the rest of `selections`: a dispatcher's name beside a draw
  still names the draw (§382.305(l)).

**Owed by the office:** link the 14 fleets in Settings › McLeod fleets. Until then the column names
the dispatcher from the current load, and a truck with no load shows only its fleet code.
### 7A.20 Telling an admin before the connection stops (2026-10-15)

**The gap [V]:** everything the product does with Med-Stop reads the hourly sweep's mirror: the DER's
result alert, the dispatch stop, the Random and Results tabs. Two things end the sweep without anyone
being told.
- **The key expires.** Keys live at most 180 days, and an expired key answers the same 401 as a wrong
  one. Production's key expires **2026-12-28** (read 2026-10-15). The warning is a line on Settings ›
  Med-Stop, 30 days ahead, and nobody opens that page while things work.
- **The sweep fails or stops.** The Drug & Alcohol page shows a caution after two hours, to whoever
  opens it.

Either way a positive result goes unalerted and a violation does not stop dispatch, while every
screen shows the last good read. Production on 2026-10-15 was healthy: 13 sweeps in 24 h, no error.

**Shape (two merges, 0465's and 0470's order):**
- **0477:** the `medstop_connection` category, its label and its link (Settings › Med-Stop). Nothing
  sends it yet.
- **The sender:**
  - The api's Med-Stop scheduler judges every org with a connection on each hourly tick, whether a
    sweep is due or not, so a sweep that never runs is judged as well as one that failed.
  - Sent to the admins (`isAdmin`, the role Settings › Med-Stop admits), never typed as a list.
  - D-MSUX21 — **the key:** a notice at 30, 14, 7, 3 and 1 days, and on the day it expires. Each
    threshold is sent once per key (the dedupe key carries the expiry date and the threshold), so a new
    key starts over, and a missed tick still sends the threshold it fell into.
  - D-MSUX22 — **the sweep:** a notice when the last sweep failed, or when no sweep has succeeded for
    3 hours (three missed hourly runs, past the page's 2-hour caution). Once a day while it lasts, the
    same daily reminder `roadside_feed_stale` gives. It names Med-Stop's error when there is one.

## 8. Open questions

- ~~Q-MS1~~ — base URL: `https://api.med-stop.com` (API-Key-access.md).
- **Q-MS2** — The staging host's address, and whether our account exists there (the guide names
  staging but gives no URL). If not, the first real order is a real
  applicant's, and MS3 ships behind a per-org switch. *Recommend asking; plan for "no".*
- ~~Q-MS3~~ — ruled (a), O-6. Was: **Gender** is required by Med-Stop and we do not collect it. It decides observed
  collections (F/M observer). Candidates: (a) a required Part 1 field with an explanation that it is
  for the drug-test collection only; (b) the office enters it at order time. *Recommend (a); the
  wording needs a look under the same eye that reviewed the application's EEO questions.*
- ~~Q-MS4~~ — moot, O-5. Was: SSN timing: (a) create without SSN at Part 1, add it at step 13 (keeps D-HIRE6);
  (b) ask it in Part 1. *Recommend (a).*
- **Q-MS5** — Existing drivers missing from Med-Stop, if MS0 finds any: created by us through the
  API from roster data (no SSN needed since O-5), or entered by the office. *Decide on MS0's report.*
- **Q-MS6** — `annualreview` and `startdate` are required on create; what Med-Stop expects for an
  applicant is [?]. *MS0's `GET /Employee/new` form answers it.*

## 9. Progress log

- 2026-09-29 — Spec analysed; owner answered O-1..O-4; plan written. Nothing built.
- 2026-09-29 — API-Key-access.md read: base URL, 180-day keys, 100/min, envelope. Owner: no SSN (O-5), gender in Part 1 (O-6). First call from the workstation (209.37.91.162) → 403 HTML "Access Denied": IP not yet on the key.
- 2026-09-29 — Workstation IP added by the owner: the firewall now passes (JSON, not the HTML page),
  but every call answers **401 `S_NOTAUTHENTICATED`** (`AUTH_AUTHORIZATION`), before and after the
  owner widened the key's security groups — so it is not permissions (that would be 403). Egress is
  IPv4-only 209.37.91.162. Remaining causes per the guide: key value not the active key, key never
  saved/activated, expired, revoked. The admin portal sits behind Cloudflare Turnstile, so it
  cannot be checked by script; the owner checks it.
- 2026-09-29 — **Secret handling (D-MS2):** the Med-Stop key follows FleetPal's pattern
  (`modules/fleetpal/credentials.ts`): a per-org `medstop_credentials` table, the key `secretBox`-sealed
  with AAD (org + `medstop.api_key`), refused when the sealing key is absent, never returned to a
  client (`hasKey` only), plus `expires_at` for the 180-day reminder. **Not a Railway env var.** The
  portal username/password are never stored by us — the API does not use them.
- 2026-09-29 — API-Key-access.md read in full, including its **AI-assisted integration** chapter [V]:
  - Med-Stop publishes **`AGENTS.md`** (the contract: base URL, auth, envelope, errors, paging, URL
    conventions, resource map, **coded values**) and **`Docs/skills/`** (`authenticate-and-call`,
    `schedule-test-request`, `manage-employees`, `search-and-export`) for AI tools, plus an
    **Integrator Overview** (security group per route), Quick Start and Access Setup. None are in
    `docs/Med-Stop/` yet. AGENTS.md's coded values would close §2.1.3 without a live `/List` read.
  - **Employer security groups** (4.9.1): Company Management, Financial Information, Employee
    Information, Applicant Information, Employee Read-Only, Employee Tests, Employee Compliance,
    Random Selection — eight, which is the portal's "Selected: 8".
  - **One key per integration and per environment**, least privilege, IP-bound, short expiry; a key
    must **never reach AI prompts, model output, source control or logs**. → D-MS3: two keys —
    a *probe* key (workstation IP, read-only groups) and the *production* key (the api service's
    three IPs, the groups MS1–MS6 need). The first key's value reached model output in this session,
    so by Med-Stop's own rule it is retired either way.
  - Writes: allow-list + **human approval before any `POST /new`, `/status`, `DELETE`, showing the
    exact payload**; read-before-write (GET the `/new` form first); no idempotency keys — track
    returned ids; duplicates come back as 400. Staging dry run before production.
  - Every call is in the portal's **API Access Log** — the place to see why ours are refused.
  - 4.9.2 (2026-09-11): "Requests are rejected if the API cannot confirm the API key's current
    access" — a candidate cause of our 401 after the owner edited the key's groups.
  - The guide's contract is 4.9.2 with **135 operations**; our `openapi.json` says 4.9.31 with **99**.
    Likely an employer-scoped download (recruiter/consortium routes absent) — to confirm.
- 2026-09-29 — Retried each minute after the group change: still 401 `S_NOTAUTHENTICATED`.
- 2026-09-29 — Base URL confirmed: `https://api.med-stop.com/` serves "API | Med-Stop" linking to
  apiadmin. ⚠ **Cloudflare blocks curl's default User-Agent** (403 HTML "Access Denied"; any browser-like
  UA gets 200) — the client must send its own User-Agent. The TEST key answers exactly as **no header**
  and as a **made-up key** (401 `S_NOTAUTHENTICATED`), under five header forms: the server does not
  recognise the value at all, which is also why the owner sees no attempts in the access log.
  Leading hypothesis: the stored value is not the key's one-time secret (a key id / list value).
- 2026-09-29 — `docs/Med-Stop/developer-quick-start.md` read: four steps (grant the contact the
  "Med-Stop API Access" role in the Employer app → sign in to API Admin → create a key → send
  `Authorization: ApiKey`). Our requests follow step 4 to the letter; steps 1–3 are done (the owner
  signs in to API Admin, keys exist, rotated and saved, IP set). Still 401 at 12:4x — **escalated to
  Med-Stop support**. Also noted for them: their own quick-start `curl` is blocked by Cloudflare
  (403 HTML) unless a User-Agent is set.
- 2026-09-29 12:57 CDT — **Root cause of the 401, isolated.** Same key, same request
  (`GET /employee/list`, from 209.37.91.162): IP filter = 209.37.91.162 → **401 S_NOTAUTHENTICATED**;
  filter removed → **403** "not authorized to access this resource" (authenticated; the key's one
  security group does not cover the call). Med-Stop's source-IP check evaluates the Cloudflare edge
  address, not the client. **Med-Stop support confirmed it and escalated to their API team**
  (Q-MS7). Their guidance: do not allowlist Cloudflare ranges; removing the filter is diagnostic
  only, not a production posture.
- **Q-MS7 (blocks production, not the build)** — Med-Stop fixes trusted-proxy IP evaluation. Until
  then the production key cannot be IP-bound, and **D-MS3 holds: Silvicom 360 goes live on Med-Stop
  only with an IP-bound key.** MS1's client and storage do not wait for it; MS0's live read either
  waits or runs briefly unfiltered on the rotated test key by owner decision.
- 2026-10-12 — Owner removed the key's IP filter for one minute: 200 from the workstation and the
  api service. Q-MS7 proven to be Med-Stop's filter alone. Filter restored, 401 again.
- 2026-10-13 — **Q-MS7 FIXED by Med-Stop.** With the filter ON: real key 200, TEST key 403
  (authenticated, no rights), made-up key 401 — from 209.37.91.162 and from the api service
  (152.55.176.240). D-MS3 holds with an IP-bound key. MS0 run the same morning: §5A.
  §6/§7 rewritten around what MS0 measured (F-1..F-6); the old MS1–MS6 list is superseded.
- 2026-10-13 — **MS1 merged** (#1490, migration 0463). Owner approved MS2 as three merges: MS2a schema
  + mirror, MS2b actions, MS2c screens — and the rule that a Med-Stop positive or refusal stops
  dispatch automatically.
- 2026-10-13 — **MS2a: requests and tests mirrored** (0464 tables, 0465 the `drug_alcohol_result`
  notification category). Second GET-only probe, counts only: a DRUG result exists only once the
  test is CLOSED (12 months: 400 NEGATIVE, 10 DILUTE, 5 POSITIVE, 3 CANCELED, 3 NOT REFUSAL, all at
  CLOSED; 4 COMPLETED + 1 OPEN without one); an ALCOHOL result exists at COMPLETED (23/23); medical
  exams carry "MEETS STANDARDS…". `/List/RESULTDER` names REFUSAL TO TEST · TEST CANCELED · NOT
  REFUSAL; no request in 2,152 was closed as REFUSAL. All-time: 1,666 tests, 2,152 requests.
  - **D-MS4 — merged, not snapshotted.** Tests are never deleted at Med-Stop; the sweep reads a
    400-day window and merges by id, so our own columns (`first_seen_at`, `baseline`,
    `outcome_handled*`) survive. The trail (`/Test/{id}/status`, newest first, `{status, created}`)
    is fetched only for a test whose status moved, capped at 40 per sweep.
  - **D-MS5 — history is not news.** The org's first test sweep stores tests collected more than 14
    days earlier as `baseline`: listed for the DER's review, never filed, alerted or blocked on. The
    12 months hold 5 positives handled outside the product; auto-blocking them would stop drivers
    who may have completed return-to-duty with nothing on file here.
  - `medstopTestOutcome` (shared) is the one reader of a result string: TD final only at
    REVIEWED/CLOSED (§40.129), TA final at collection, unknown wording → `unrecognised` (alerted,
    never a negative). "Expected by" = collection + p90 93 h, as a wall-clock day.
- **Found while designing MS2b:** today's dispatch door (`returnToDutyBlocked`) is satisfied by ANY
  `return_to_duty` record ever filed. Right for §40.25(j)'s one-time admission; wrong for a Med-Stop
  violation, where a driver with an old record and a NEW positive would pass. MS2b's door asks for a
  record whose `occurred_on` is on or after the violation's collection day.
- 2026-10-13 — **MS2b: results act.** After every sweep, `actOnMedstopResults` takes the tests whose
  result nobody has acted on (`outcome_handled` null, not `baseline`):
  - verified NEGATIVE pre-employment drug test on a licence or name+DOB match → `drug_test`
    qualification record, `reference` = Med-Stop's test id, `created_by` null, `detail.source =
    'medstop'` — the hiring step ticks itself. Once per test by the code AND by 0466. An applicant not
    matched yet waits 30 days for the match, then is let go unfiled.
  - POSITIVE, REFUSAL, NEGATIVE-DILUTE, or a wording nobody classified → `drug_alcohol_result` to every
    member whose role `canReadTestingRecords` admits (derived, `usersInRoles`), naming the result:
    they are the DER and must act on it. Dedupe per test AND outcome, so an MRO correction is news.
  - **D-MS6 — the stop is a READ, not a write.** Nothing is set on the driver. `returnToDutyHold`
    (recruiting, the door dispatch and the hire already use) asks `medstopViolationOn`: the newest
    collection day of a non-baseline POSITIVE/REFUSAL on a CERTAIN match (licence, name+DOB; a
    name-only match alerts and says it did NOT stop dispatch). A return-to-duty record dated on or
    after that day discharges it; an older one does not (`returnToDutyCause` in shared). The hold
    therefore ends the hour an MRO correction lands, and no flag can outlive the fact.
  - The recruiter's hire warning for a Med-Stop hold names no result (`RETURN_TO_DUTY_BLOCK.hireViolation`).
- **Open (MS2c or later):** the driver file, compliance overview and DQ binder still read only the
  application flag (`return_to_duty_required`) for "return-to-duty outstanding"; they do not yet show
  a Med-Stop hold. Dispatch and the hire do. A request Med-Stop closes as REFUSAL with no test (none
  in 2,152) is not acted on yet — `medstopRequestRefused` exists for when it is.
- 2026-10-13 — **MS2c: the screens.**
  - Hiring drawer › Drug test result step: a **Med-Stop** block under the appointment — an order not
    yet collected, then each test's stage in words (`medstopStageLabel`: Collected → At the lab → With
    the medical review officer → Result reported; OPEN after the lab is the MRO's review) and "result
    expected by" (collection + 93 h). `GET /api/recruitment/applicants/:id/medstop-tests` (recruitment
    view); the outcome is null in the RESPONSE for a reader `canReadTestingRecords` refuses, so a
    recruiter's browser never holds one. Certain matches only. Renders nothing until Med-Stop is
    connected.
  - Safety › Drug & Alcohol: **Results to review** (the DER-alert outcomes of the last year, not
    history) above everything else, and **Found on the first read from Med-Stop** (D-MS5's
    baseline positives and refusals, for a person to clear). `results` is null for every other role.
  - MS2 COMPLETE in code. Still open from MS2b: the driver file / compliance overview / DQ binder do
    not show a Med-Stop hold; request-level REFUSAL not acted on. Next: MS3 (writes — order from the
    hiring page; Part 1 gains gender + CDL expiry in their own merge first).
- 2026-10-13 — **Owner review of the shipped page → §7A (MS-UX plan).** Measured before planning
  (GET only): 22 OPEN selections and none ordered, 30 pre-dated future draws, 5 tests in progress,
  1 open order, Med-Stop medical expiry ≤60 d for 14 of 170; the request form and site search read;
  the sidebar icon is Fuel's; the production sweep is not switched on. Five tabs, an order SlideOver
  with preview, hiring entry point, precision rules R1–R5, questions Q-MSUX 1–5. Nothing built.
- 2026-10-13 — Owner answered Q-MSUX 1–5 + sync (§7A.10). Orders: safety, admin, recruiter. Gender
  into Part 1. Medical from Samba + Med-Stop into the DQF, cross-checked (Samba not connected — Q-MSUX6).
  No driver texts/e-mails: `sendsms=N`, `sendemail=N`, office contact in `tosms`/`toemail` (D-MSUX5).
  `MEDSTOP_SYNC_ENABLED=true` set on `@fleetguard/api`.
- 2026-10-13 — **MS-UX1 built** (§7A on PR #1501). Safety › Drug & Alcohol is five tabs (`AppTabs`,
  `?tab=` in the URL, counts = the list lengths, an empty list shows none): **Random selections**
  (DER only; pace strip; OPEN draws dated today or earlier, longest-waiting first; reserves apart;
  nothing dated after today — R4, MS1's seven-days-ahead list removed), **In progress** (open orders +
  unfinished tests, any reason; RANDOM rows only for testing-record roles, §382.305(l)), **Results**
  (DER only; one list, "found on the first read" a choice), **Medical cards** (working drivers ≤ 60 d
  or expired by the card on file OR Med-Stop's certain-match date; the earlier wins; both shown),
  **Roster check** (the two violation lists only). Removed: licence-we-lack, the medical-disagreement
  list, the matched footer. Freshness line; caution when the last read is older than 2 h. Sidebar
  icon: `MicroscopeIcon` (was Fuel's test tube). No writes to Med-Stop.
- 2026-10-13 — **UX2 built** (branch `claude/medstop-ux2`). Q-MSUX7 answered (recommendation).
  Finding that shaped it: McLeod's sweep already files `medical_card` through
  `recordSyncedCredentials`, write-on-change in EITHER direction, so Med-Stop filing through the same
  door would have ping-ponged A/B rows (~24 a day per disagreeing driver, 37 drivers) in an append-only
  table. Built: 0467 `credential_source_dates` (evidence-owned; one row per driver × kind × source;
  `record_credential_source_date` writes only on change; McLeod's claim backfilled from current rows
  carrying SYNC_NOTE) · `resolveMedicalExpiry` + `medicalCards` in shared · evidence `syncedMedical.ts`
  (`fileMedicalClaim`, `recordMedicalSourceDates`, `readMedicalStates`) · McLeod's medical path and
  the Med-Stop sweep (step 6, active + certain matches only, R3) both report claims there · Medical
  tab: the due list by the rule's date, plus "Sources disagree" with one column per source.
  Samba still waits on Q-MSUX6. R2's sample was not made (production read); the risk is stated in the
  PR: on first sweep, a driver whose Med-Stop date is earlier than McLeod's gets the earlier date filed.

- 2026-10-13 — **UX3 built.** UX3a #1509 merged (0468: `orders_enabled` off by default, office contact).
  UX3b: order drawer (header + random rows), live duplicate check, allow-listed single-shot POST,
  Settings › Ordering tests, audit rows; §7A.11 has the shape and the first-order runbook. Ordering stays
  OFF in every database until the owner's first watched order. Next: UX4 (the same drawer in the hiring
  step, for applicants Med-Stop holds).
- 2026-10-13 — **UX3b #1512 merged. UX4 built** (branch `claude/medstop-ux4`): "Order pre-employment
  test" in the hiring drug-test step for applicants Med-Stop holds; reason → roster rule (D-MSUX9);
  drawer promoted to `components/medstop/`; "Add this applicant in Med-Stop first" + link (Q-MSUX8
  open: the portal's address). §7A.12. Ordering still OFF everywhere. Next: UX5 (Part 1 fields as their
  own migration merge, then `/Employee/new`, then observed reasons).
- 2026-10-13 — **UX5a built** (branch `claude/medstop-ux5a`, 0469). Inventory first: Part 1 v2 already
  files home address, CDL class and CDL expiry (0376), so the one missing fact was gender. 0469 adds
  `application_intakes.donor_gender` (male/female/declined, NULL = never asked). It is not on `drivers`,
  so the person deciding the hire never sees it (D-MSUX10). `record_applicant_intake` accepts the key
  with the same signature. Med-Stop's GENDER list was read (GET): MALE, FEMALE. Open: Q-MSUX9 (wording),
  Q-MSUX10 (an existing driver's gender for observed orders). Next: UX5b.
- 2026-10-13 — Owner: proceed as recommended (Q-MSUX9 wording, Q-MSUX10 read from Med-Stop at order
  time, constants + Med-Stop's own date defaults) and check our create form against Med-Stop's exactly.
  Checked three ways, GET only (§7A.13): the live form has the spec's 46 keys exactly; its defaults;
  and the office's own applicants. One difference was found and ruled: the start date is left empty,
  as on every hand-entered applicant. **UX5b built** (branch `claude/medstop-ux5b`): screen 7 asks the
  gender. Next: UX5c (the create).
- 2026-10-13 — UX5b #1522 merged. **UX5c built** (branch `claude/medstop-ux5c`, 0471
  `medstop_applicant_creates`): the hourly job creates Part 1-complete applicants in Med-Stop from
  Med-Stop's own form. Ordering off = nobody created. Claim before the POST, sent once. The step shows
  the outcome. The client's refusal text is now Med-Stop's bare sentence; each caller says what was
  refused.
- 2026-10-14 — **UX5d built** (branch `claude/medstop-ux5d`, no migration): return-to-duty and
  follow-up from Safety's drawer. The spec showed the order form has no gender key, so the donor's
  gender (read live from Med-Stop's employee record, never kept) picks an `observed=M|F` site search
  and refuses a donor without one; the order goes `observed: "Y"` with the rule as its reason. Alcohol
  tests for those reasons stay unobserved. RTD from the dispatch hold deferred (§7A.14). Workstation
  IP still refused by Med-Stop (new address 173.9.238.30 not on the key), so nothing was read live
  this session. Ordering still OFF everywhere.
- 2026-10-14 — **The Med-Stop hold reaches the file** (branch `claude/medstop-hold`, no migration;
  §7A.15). The driver page, its qualification file, the fleet queue and a restricted binder show a
  Med-Stop violation to admin and safety manager; every other reader is told only that a safety review
  holds the driver. One rule (`returnToDutyCause`) decides the file item and the dispatch door. Next:
  the request-level REFUSAL.
- 2026-10-14 — **#1531 merged. A refused request acts** (branch `claude/medstop-refusal`, no
  migration; §7A.16): a request Med-Stop closes as REFUSAL holds the driver (both violation reads) and
  reaches the DER once (the notification ledger's dedupe). History by its own dates (D-MS5's 14 days,
  now one shared constant). Not yet listed under Results to review.
- 2026-10-14 — **#1533 merged; refused orders listed under Results to review** (branch
  `claude/medstop-refused-results`, no migration; §7A.16): `MedstopResultRow` gains `source` and
  `medstopId` (was `testId`); refused orders are split recent/history the way the alert splits them.
- 2026-10-14 — **Random tab lists the whole year** (branch `claude/medstop-random-full-list`, no
  migration; §7A.17, D-MSUX18, owner's ruling): every draw of the pool year by default, with a Show
  filter; R4 narrowed to "never shown as due".
- 2026-10-15 — **Dispatcher beside each draw** (branch `claude/medstop-draw-dispatcher`, no migration;
  §7A.19, D-MSUX20): the Random tab names the fleet's dispatcher and the load's, read off the dispatch
  board's own rows. Production has 0 of 14 fleets linked, so today the column mostly shows the load's
  dispatcher.
- 2026-10-15 — **0477, the `medstop_connection` category** (branch `claude/medstop-sync-alerts`; §7A.20):
  the first of two merges. The sender — key expiry at 30/14/7/3/1/0 days, and a failed or stopped
  sweep, to the admins — follows.
