# PSP UAT — what the test account is, and how to exercise it without touching production

**Date:** 2026-08-20 · Sources: PSP support email (2026-08-20), `PSP Test Data 3 2019.xlsx`,
the UAT OpenAPI, and live read-only probes. Everything below was **observed**, not assumed.

---

## 1. What arrived, and what turned out not to be new

| Item | Finding |
|---|---|
| "Most up to date Implementation guide" | **Byte-identical** to the v3.9 already analysed (`sha256` matches). Nothing to re-read. |
| `PSP Test Data 3 2019.xlsx` | **New and useful** — 14 test drivers and 107 scenario definitions. §4. |
| UAT API token | **Verified working** — `GET /DayMonitored45` returned `success: 1`, `errorCode: 0`. |
| UAT account | `Silvicom, Inc - UAT`, **motorCarrierId 31496** |

### Two errors in the email, neither of which we should follow

**1. `rest-api.uat.psp.typerapp.com` is a typo** — every other line says `tyler`app.com. Worth
telling them, because the failure mode is not a 404: an `api-key` header sent to a mistyped domain is
a **credential handed to whoever registered it**. Nothing here has ever resolved that hostname.

**2. The UAT OpenAPI's `servers` block is wrong.** It declares
`http://rest-api.uat.psp.tylerapp.com/PspRestService`. Probed:

```
https://rest-api.uat.psp.tylerapp.com/DayMonitored45                  → HTTP 200  success:1
https://rest-api.uat.psp.tylerapp.com/PspRestService/DayMonitored45   → HTTP 404
```

**UAT takes no path prefix; production does** (`/PspRestService`). Our `HOSTS` map already had both
right. The email's lowercase `/records` and `/record` are informal — the spec and the server use
`/Records` and `/Record`, which is what the client sends.

---

## 2. The bug this would have hit on the first request

`resolveCarrierIdentity` gave `organizations.dot_number` **absolute precedence** and returned
`motorCarrierId: null`. Silvicom's org row now holds **1864495** — their real USDOT number, which
identifies them to FMCSA **in production and nowhere else**.

So every UAT request would have sent `dotNumber: 1864495`, silently discarded
`PSP_MOTOR_CARRIER_ID=31496`, and come back as §8.5 **detail 18** — *"The Motor Carrier ID or DOT
Number provided is not correct"* — on every driver, with nothing in the error naming the cause.

**Fixed:** `resolveCarrierIdentity` now takes `environment`. In `uat` the org row is not consulted at
all, because that carrier does not exist there; in `production` it wins as before. The parameter is
**required**, so every call site had to say which account it is talking to — the compiler found all
three.

---

## 3. What now stands between us and a production charge

Four things, and the first two are new:

1. **`PSP_ORDERS_ENABLED`** — defaults `false`. A credential in the environment is not consent to
   spend with it.
2. **`PSP_PRODUCTION_ACKNOWLEDGED`** — defaults `false`. `PSP_ENVIRONMENT=production` is a one-word
   edit that turns every order into a real charge, so it is no longer allowed to be the only switch.
   A copied `.env` or a wrong deploy template cannot start spending on its own.
3. **The tokens fail closed across environments.** A production token against the UAT host answers
   `401 / errorCode 32`, and the reverse does too — observed, both directions.
4. **The four order gates** — authorization, step-up, budget, validation — all refuse before the
   ledger row exists.

**Current state of `apps/api/.env` (2026-08-20, after the first run):** `PSP_ENVIRONMENT=uat`,
`PSP_ORDERS_ENABLED=true`, `PSP_PRODUCTION_ACKNOWLEDGED=false`, `PSP_MOTOR_CARRIER_ID=31496`,
`PSP_DOT_NUMBER` absent, and the token now in `PSP_API_KEY_UAT` — a variable the production host
cannot read at all (§5.1). **Nothing can reach production today** — item 2 is the switch that says so.

---

## 4. The test drivers

DOBs arrive as Excel serials; converted, and all 14 pass our `≥18 / ≤120` rule (oldest: Carter, 1934).

| Driver | DOB | Licence | State | What it exercises |
|---|---|---|---|---|
| Gary **Thomas** | 1974-07-07 | G12345678 **+** P123456789 | GA **+ PA** | **two licences — the `Partial` (status 4) path** |
| Jose **Davis** | 1975-11-06 | T123456789 | VA | 4 inspections, no crash |
| Joel **Davidson** | 1963-07-21 | TX3372976 | TX | 8 inspections — the heaviest record |
| Luis **Reid** | 1974-08-06 | VA129314 | VA | crash **and** inspections |
| Edward **Knoll** | 1945-09-26 | NT2812982 | **NT** | **Canadian territory** |
| David **Marin** | 1958-07-05 | MN239648 | MN | crash + inspection |
| Randhawa **Cross** | 1974-06-24 | ON246810 | **ON** | **Canadian province** |
| Kelly **Buck** | 1969-12-26 | IL121416 | IL | single crash |
| Douglas **Mizer** | 1960-10-06 | IN182022 | IN | crash outside the 5-year window |
| Gary **Barger** | 1955-03-25 | KY135245 | KY | **`notPreventable` crash (§10.5)** |
| Burton **Litton** | 1958-08-21 | PA2336558 | PA | **4 crashes + 4 inspections, `notPreventable`** |
| Conilio **Hines** | 1962-12-06 | GU352385 | **GU** | **US territory (Guam)** |
| Franklin **Carter** | 1934-03-14 | VI2582166 | **VI** | **US territory (USVI)** |
| Richard **Fisher** | 1973-09-07 | OH88322 | OH | crash + 3 inspections |

**The jurisdictions are the quiet win.** `PSP_JURISDICTIONS` was enumerated rather than
length-checked precisely so `XX` could not pass — and the test set turns out to lean on **GU, VI, NT
and ON**, all four of which the list already carries. A two-character regex would have accepted them
too; it would also have accepted a typo, and we would not have known which we had.

Support says to **ignore the dates** — they predate the 3/5-year windows but the data still returns.

### Scenarios worth pulling deliberately (sheet 2, 107 of them)

- **Cases 88–91, "Carrier Information Unavailable"** — inspections with **no carrier**. The
  cross-match must skip these, not read a null USDOT as an unlisted employer. The types already
  allow null; this is the case that proves the behaviour.
- **Cases 15–35, additional DLs** — same licence with a *different last name*, same name with a
  different licence and state. These exercise the check that the returned licence matches the one we
  asked for, which is what stops one person's history landing on another person's file.
- **Cases 36–67** — fatality / injury / towaway / hazmat-release combinations, for the summary
  projection.

---

## 5. Running a UAT test

**One-time, on the operator's machine** (never committed):

```
PSP_API_KEY_UAT=<the UAT token>
PSP_ENVIRONMENT=uat
PSP_MOTOR_CARRIER_ID=31496
PSP_ORDERS_ENABLED=true
PSP_MONTHLY_LIMIT=5
```

The UAT token is the one in `apitoken-uat.txt`; the other file in that directory is production's.

**There is one variable per account, and `PSP_ENVIRONMENT` picks it.** `production` reads
`PSP_API_KEY_PRODUCTION` and can read nothing else, so a token cannot be paired with the other
account's host. The retired `PSP_API_KEY` is no longer read; a deploy still carrying it boots and
says so on startup rather than failing.

Then confirm the token is the one you think it is — a check no fingerprint can perform, because a
token is 32 hex characters either way and only the service knows which account issued it:

```
pnpm --filter @fuelguard/api psp:uat --verify-key
```

**Leave `PSP_DOT_NUMBER` unset for UAT.** Sending a DOT number *and* a motor carrier ID that do not
describe the same account is §8.5 detail 34. The UAT account is identified by its motor carrier ID.

Then, per driver: record their DOB and licence, record the **PSP** and **FCRA** authorizations, and
order. The gates refuse in that order and each refusal is free.

**Read the ledger row before anything else.** `psp_requests.response_raw` is stored whole, so if the
projection is wrong the evidence survives and the parser is fixed without re-buying anything.

### The harness

`pnpm --filter @fuelguard/api psp:uat` is the one place `POST /Records` may be called by hand. It
stops at the vendor edge and writes nothing to any database, and that is deliberate: `orderPspRecord`
needs a `drivers` row and signed `driver_authorizations`, and it appends to `documents` and
`qualification_records` — evidence tables, append-only, pinned in `RETENTION_FORBIDDEN`. The only
Supabase this repo is configured against is production. Seeding fourteen synthetic FMCSA test drivers
there to learn the shape of a vendor response would put undeletable rows into the carrier's real DQ
evidence. Proving the request shape, the parser and the round-trip does not require that; the full
order through the app does, and it needs a database somebody chose on purpose.

```
pnpm --filter @fuelguard/api psp:uat --list                    # the roster, no network
pnpm --filter @fuelguard/api psp:uat --driver thomas           # dry run: what would be sent
pnpm --filter @fuelguard/api psp:uat --driver thomas --order   # the live call
```

Three guards must agree before anything is sent: `PSP_ENVIRONMENT=uat`, `PSP_PRODUCTION_ACKNOWLEDGED`
not true, and the resolved host compared against the UAT literal. The third is not redundant — the
first two both read the same host map, so a bad edit to that map would take them together.

## 5.1 What the first run found (2026-08-20)

**Two things were wrong, and only one of them is ours.**

**`apps/api/.env` held the PRODUCTION token while `PSP_ENVIRONMENT=uat`** — byte-identical to
`docs/psp-docs/apitoken.txt`, not to `apitoken-uat.txt`. Nothing could have worked, and §3's
fail-closed property is what would have answered: `401 / errorCode 32`. Swapped for the UAT token,
and the swap had to come first, because the mixed-up credential and the blocker below produce
*the same error number* and the wrong one would have been blamed.

It happened a second time the same afternoon, from the opposite direction: another session compared
sha256 fingerprints, found the local key did not match `apitoken.txt`, and "corrected" it — to the
production token, on Railway as well as locally. **A fingerprint can prove two files differ and can
never say which account a token belongs to.** Only the service can, which is why `--verify-key`
exists and why the key is now selected by environment instead of set by hand.

**The UAT token authenticates on one endpoint and not the other.** Same token, same host, minutes
apart, and verified again *after* the failures so nothing had been invalidated in between:

| | |
|---|---|
| `GET /DayMonitored45` | **200** — `success:1`, `errorCode:0` |
| `POST /Records` | **400** — `statusDetail 32`, *"Your token is invalid"* |

Reproduced on Thomas (two licences) and Davis (one), so it is neither driver- nor licence-count
specific. This is not our client: the rejection body echoes `originalRequest` **verbatim**, which
means PSP parsed the payload and got as far as the auth check before refusing.

### What the refusal proved for free

An `Error` status does not bill (§8), so the blocker paid for four answers on the way past:

- **The request shape is accepted.** Field names, the `M/D/YYYY` date of birth, the array-of-one
  wrapper, and `monitor` reflected in `originalRequest` exactly as §5.4.2 says it should be.
- **`internalRefId` survives the round trip** — through `originalRequest`, at least. A success
  response has still never been seen, so the driver-resolution design is not yet proven end to end.
- **The validation response is a bare object, not an array.** §5.4.2's example shows one shape and
  §5's shows the other; the client already read both (`Array.isArray(parsed) ? parsed[0] : parsed`),
  and now one of them is observed rather than hedged against.
- **Our own preflight refused detail 10 before dispatch** — clearing `PSP_MOTOR_CARRIER_ID` never
  reached the network, which is the asymmetry in `status.ts` doing its job.

## 5.2 It works — and the first response found a bug the suite could not (2026-08-20)

**The blocker was account provisioning, not the token.** After `miki@silvicominc.com` was added as an
admin and logged into the UAT portal, the **same token** — unrotated, `apitoken-uat.txt` untouched
since 12:26 — returned `status: 0` on `POST /Records`. Nothing in the request changed. Detail 32 had
been the account's entitlement all along, which is why re-minting would have been the wrong move.

Gary Thomas: **status 0, 7 inspections, 0 crashes, `internalRefId` round-tripped, PDF 41,604 bytes
with a real `%PDF` header.** Burton Litton: **status 0, 4 inspections, 4 crashes.**

### What the responses settled

- **The array is one entry, not one per licence.** Thomas has two licences and got **one**
  `driverInformationResponse`; both `G12345678/GA` and `P123456789/PA` appear across its seven
  inspection records, each carrying its own licence. `parsed[0]` drops nothing.
- **The record is nested under `driverInformationResponse`**, and `monitor` sits on the array element
  beside it — not inside. §5.4.1 reflects it exactly as documented; the earlier note that it was
  missing was looking in the wrong object.
- **`driverInfoSummary` carries no crash counts.** The crash figures come from
  `driverReportSummaryResponse`, and they reconcile: Litton's four crashes, two with injuries, two
  towaways.
- **Thomas is not a Partial case.** Both licences matched, so status 0. Reaching status 4 needs one
  good licence and one bad one — the roster alone will not produce it.
- **`notPreventable` is null on all four of Litton's crashes** in the current UAT data, so §10.5 is
  still unexercised despite the workbook listing him for it.

### The bug

`inspectionDate` and `reportDate` arrive as **`MMDDYYYY`** (`03072024`, `07252024`) and were passed
through verbatim. `crossMatchEmployment` compares them as strings against ISO dates:
`within("03072024", "2023-01-01", "2025-12-31")` is **false**, because every vendor date begins `0`
or `1` and every ISO date begins `1` or `2`.

So **every §391.23 cross-match would have reported `no_psp_activity` for every declared employer** —
silently, because a cross-match that finds nothing looks exactly like a driver with nothing to find.
Thomas's seven inspections would have corroborated no one.

`employment.test.ts` could not catch it: its fixtures build `PspInspectionRecord` by hand with ISO
dates, a shape the vendor never sends. `parse.ts` now converts at the boundary (`fromPspDate`, the
mirror of `client.ts`'s `toPspDate`), and the case that pins it starts from a vendor-shaped response
and runs the whole way through.

**This is the argument for `response_raw` in one paragraph.** The projection was wrong, the evidence
was not, and the fix cost a re-parse rather than a re-purchase.

## 5.3 All fourteen, replayed as a suite (2026-08-20)

Every driver in the workbook was ordered. **All fourteen returned `status: 0`.** UAT does not bill —
confirmed by the account owner — which is what made running the whole set the right move rather than
a sampled one.

The responses are committed verbatim to `apps/api/src/psp/__fixtures__/uat/` (only `authCode` and
`authCodeURL` redacted) and replayed by `apps/api/src/psp/uatResponses.test.ts`. They are kept
**whole**, at roughly 88% unread fields, because a fixture trimmed to what the parser reads today
could never have caught the date defect — and cannot catch the next one either. The suite asserts
invariants rather than snapshots: a snapshot pins the projection including whatever it gets wrong.

### What the fourteen settled

| Shape | Result |
|---|---|
| **Cases 88–91, carrier information unavailable** | **Real — 9 records.** Null USDOT (Davis, an inspection), null carrier name (six crashes), or **both** (Hines). `crossMatchEmployment` skips them on `!a.usdot`; now proven against the data instead of the types. |
| **Jurisdictions NT / ON / GU / VI** | All four round-tripped `status: 0` — Knoll, Cross, Hines, Carter. The enumeration earns its length. |
| **Crash carrier field** | A crash record has **no `usdotNumber` key at all** across all 14. It is `censusNumber`, falling back to `uploadDOTNumber` — which `parseCrash` already read correctly. |
| **Dates** | All **47** are `MMDDYYYY`. The §5.2 fix is validated across the whole set, not one response. |
| **Cases 15–35, additional DLs** | **Not reachable this way.** No response returned a licence we did not ask for. These need requests with deliberately mismatched names; ordering the roster as-is will never produce them. |
| **§10.5 `notPreventable`** | **Null on all 14 crashes**, Barger and Litton included, despite the workbook listing both. `flag()` reads null as false, which leaves the crash counted — the cautious direction — but the true branch is unexercised. A test fails when UAT gains the data, rather than the gap sitting silent. |

Two of the six are gaps rather than passes, and they are written down as gaps: the additional-DL
check that stops one person's history landing on another's file has still never run against real
data, and neither has the non-preventable crash rule.

## 5.4 The dashboard path, in the QA org (2026-08-20)

`psp:uat` proves the vendor edge. It cannot exercise the half the operator sees: the four gates, the
step-up, the confirmation screen, the `psp_requests` ledger row, and the PDF landing in `documents`
with a `qualification_records` row citing it. That needs a real driver and real authorizations.

**They live in `FuelGuard EFS QA`** (`07fe4058-cc72-4a69-b3e9-29b4cf1c6a44`), seeded by
`pnpm --filter @fuelguard/api seed:psp-qa` — dry run by default, `--apply` to write.

| Driver | Licence | What the screens get |
|---|---|---|
| Burton Litton | `PA2336558`/PA | 4 crashes + 4 inspections — the richest record |
| Joel Davidson | `TX3372976`/TX | 8 inspections, no crashes |
| Jose Davis | `T123456789`/VA | 4 inspections, no crash |

### Why that org and no other

The only Supabase configured here is **production**. The QA org holds no real drivers and has a
**null `dot_number`**, so tenant isolation keeps this out of Silvicom Inc's real DQ evidence and even
a mistaken production run could not borrow their USDOT number. `documents` and
`qualification_records` are append-only: seeding a real carrier would have no undo. The org id is a
literal in the script, it verifies the org's **name and null DOT** before writing, and it refuses to
run at all unless `PSP_ENVIRONMENT=uat` — fabricated consent has no business existing in an
environment pointed at the account that bills and pulls real people's records.

**The signatures are fabricated and they say so.** A `driver_authorizations` row records a person
consenting to a background check; these record nobody. The instrument is composed from `DISCLOSURES`
exactly as `routes/recruitment/authorizations.ts` composes it — a hand-written disclosure would drift
and prove nothing about the real path — but `signed_name` carries a `(QA SEED)` marker, and
`recorded_by` is null because no person recorded it.

### Verified, up to the point a human has to click

```
PREFLIGHT   enabled true · uat · budget 0/5 · billsOn success, failure, partial · refusal none
GATES  no step-up  → step_up_required          (authorization and config passed; stopped at authority)
GATES  step-up     → PASSED — draft built
       motorCarrierId 31496 · dotNumber (null) · PA2336558/PA · internalRefId = driver id
```

The budget reads 0 despite sixteen UAT orders that afternoon: the harness writes no ledger rows, so
`billedThisMonth` correctly sees none. The first dashboard order will be the first row in
`psp_requests`.

**To finish it:** log in as `uncchicago85+efsqa@gmail.com` (the QA org's only member, an admin), open
one of the three drivers, and order from the screening panel. The step-up is a real password prompt,
which is why the last step is a person's and not a script's.

### What to ask them

Detail 32's own message is *"Please login and request a new token or contact customer support."* Both
halves are the operator's, and the first one is not automatic: `GET /Token` **mints**, the guide never
says whether minting invalidates the current token, and nothing here may call it on a schedule or as a
retry. So either mint deliberately from `https://uat.psp.tylerapp.com/home` (Login.gov + MFA) and
store the result before the process ends, or ask support the sharper question first:

> Our UAT token (account *Silvicom, Inc - UAT*, motorCarrierId 31496) returns `success: 1` on
> `GET /DayMonitored45` but `statusDetail 32 — "Your token is invalid"` on `POST /Records`, same host
> and same `api-key` header. Is the UAT account entitled to record requests yet?

Asking before minting is worth the delay: if the account is not provisioned for `/Records`, a fresh
token changes nothing and we would have spent the one credential we have to learn it.

### What Railway holds (2026-08-20)

`@fleetguard/api` is the only service with PSP variables. Set with `--skip-deploys`, so they take
effect on the next deploy rather than triggering one:

| Variable | Value |
|---|---|
| `PSP_API_KEY_UAT` | the UAT token |
| `PSP_API_KEY_PRODUCTION` | the production token — inert until all three switches below flip |
| `PSP_ENVIRONMENT` | `uat` |
| `PSP_ORDERS_ENABLED` | `false` |
| `PSP_PRODUCTION_ACKNOWLEDGED` | `false` |
| `PSP_MOTOR_CARRIER_ID` | `31496` |
| `PSP_API_KEY` | **retired.** Still present, still holding the production token, read by nothing. |

The last four are set explicitly rather than left to their schema defaults: a deploy whose safety
depends on knowing what a variable defaults to is a deploy nobody can audit by looking at it.

`PSP_MOTOR_CARRIER_ID` is safe to leave set even in production. `resolveCarrierIdentity` gives the
org row absolute precedence there, and Silvicom's holds 1864495, so it returns `motorCarrierId: null`
and the UAT carrier ID is discarded — the detail-34 mismatch cannot form.

**One Railway environment exists, named `production`.** So the two tokens are separated as
*variables* and cannot be mispaired with a host, but the deployed API is a single process with a
single `PSP_ENVIRONMENT`: it is UAT **or** production, never both at once. Genuinely separate testing
and production deployments would be a second Railway environment, which is an infrastructure decision
rather than a configuration one.

## 5.5 A deployed UAT environment (2026-08-20)

Railway project `serene-elegance` now has a second environment, **`uat`**, duplicated from
`production`. It exists so the dashboard path can be exercised on a real deploy rather than only on a
laptop.

| | |
|---|---|
| Web | `https://fleetguardweb-uat.up.railway.app` |
| API | `https://fleetguardapi-uat.up.railway.app` |

### What is switched off there, and why each one matters

Duplicating an environment copies **everything**, including the credentials and the switches that
make a process do real work. Every one of these was set **in the same command that created the
environment**, so there was never a boot with the inherited value:

- **`RUN_SCHEDULERS_IN_PROCESS=false`.** The load-bearing one. `docs/WORKER-DEPLOYMENT.md` states the
  invariant: schedulers run in exactly ONE process fleet-wide. A duplicate with the inherited `true`
  would have been a second scheduler owner against the **same production database**, and
  rebuild-on-boot is named there as the one scheduler with no job-ledger guard.
- **`BREVO_API_KEY` and `RESEND_API_KEY` blanked.** Setting `MAIL_PROVIDER=none` does **not** disable
  mail: `loadEnv` treats `none` as "nobody chose" and auto-selects a provider whenever a key is
  present, so an explicit `none` is indistinguishable from the default. Blanking the keys is the only
  thing that actually stops a second environment sending real customer email — the weekly digest
  scheduler being the obvious way that happens by itself.
- **`EFS_SOAP_ENABLED`, `EFS_CARD_CONTROL_ENABLED`, `EFS_CARD_CONTROL_PROBE_ENABLED`,
  `EFS_ALLOW_PRODUCTION_PROBE` all false.** `EFS_SOAP_ENDPOINT_URL` points at `ws.efsllc.com`, the
  real one.
- **`PSP_API_KEY_PRODUCTION` blanked.** Production is not merely gated in this environment, it is
  absent: flipping all three switches would find no token to spend with.

### What is switched ON

`PSP_ENVIRONMENT=uat`, `PSP_API_KEY_UAT` set, `PSP_ORDERS_ENABLED=true`, `PSP_MONTHLY_LIMIT=5`.
Ordering is the point of the environment, and UAT does not bill.

### The one thing this environment is NOT

**It shares the production Supabase.** `SUPABASE_URL` is the same project. This is app-level
isolation — a separate API, a separate web build, separate PSP credentials — and **not** data
isolation. Anything ordered here writes to the real database.

That is workable because `FuelGuard EFS QA` (§5.4) is the sandbox org and tenant isolation scopes
rows to it. It is only workable **if you log in there as the QA org's member**. Signing into UAT as a
Silvicom user and ordering would append to Silvicom's real DQ evidence, and `documents` and
`qualification_records` are append-only.

Real data isolation would need a second Supabase project with its own migration pipeline —
`migrate.yml` auto-applies to production Supabase on merge to main and knows about one database.
That is a project, not a configuration change.

### Deploy wiring worth knowing

The duplicate inherited `VITE_API_URL` pointing at the **production** API, so the UAT web app would
have called production while believing it was UAT. `VITE_*` is baked at build time, so correcting it
requires a rebuild rather than a restart. `ALLOWED_ORIGINS` and `WEB_APP_URL` were likewise still
production URLs and now name the UAT web origin.

### Moving to production, when the time comes

Support asked to be told, and to **issue a fresh token** for production. Note `GET /Token` **mints** —
it is never called by anything automatic here, and a "connectivity check" must not be the thing that
invalidates a live credential.

Production additionally needs `PSP_API_KEY_PRODUCTION` set to the fresh token support issues,
`PSP_PRODUCTION_ACKNOWLEDGED=true`, `PSP_DOT_NUMBER` **unset** (the org row supplies 1864495), and
`organizations.dot_number` left as it is. Run `--verify-key` with `PSP_ENVIRONMENT=production` before
trusting it: the probe neither mints nor bills, so it is safe in production too.

---

## 6. Their questions

- **Miki's last name** — owner's to give. `git config` on this machine reads *Miroslav Jokovic*.
- **"How did you get the Implementation Guide?"** — worth answering plainly; the copy in
  `docs/psp-docs/` predates this account setup (dated 2026-08-19) and is the same v3.9 they attached.
- **Developers needing UAT access** — `miki@silvicominc.com` is already added.
