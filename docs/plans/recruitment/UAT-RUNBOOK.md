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
`PSP_DOT_NUMBER` absent, and `PSP_API_KEY` now the **UAT** token rather than the production one it
held (§5.1). **Nothing can reach production today** — item 2 is the switch that says so.

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
PSP_API_KEY=<the UAT token>
PSP_ENVIRONMENT=uat
PSP_MOTOR_CARRIER_ID=31496
PSP_ORDERS_ENABLED=true
PSP_MONTHLY_LIMIT=5
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

### Moving to production, when the time comes

Support asked to be told, and to **issue a fresh token** for production. Note `GET /Token` **mints** —
it is never called by anything automatic here, and a "connectivity check" must not be the thing that
invalidates a live credential.

Production additionally needs `PSP_PRODUCTION_ACKNOWLEDGED=true`, `PSP_DOT_NUMBER` **unset** (the org
row supplies 1864495), and `organizations.dot_number` left as it is.

---

## 6. Their questions

- **Miki's last name** — owner's to give. `git config` on this machine reads *Miroslav Jokovic*.
- **"How did you get the Implementation Guide?"** — worth answering plainly; the copy in
  `docs/psp-docs/` predates this account setup (dated 2026-08-19) and is the same v3.9 they attached.
- **Developers needing UAT access** — `miki@silvicominc.com` is already added.
