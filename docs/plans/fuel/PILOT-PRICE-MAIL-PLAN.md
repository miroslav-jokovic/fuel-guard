# Pilot daily price email → prices, without a person (PILOT-PRICE-MAIL-PLAN)

Status: **built 2026-11-18** (branch `claude/pilot-price-mail`). Owner's ask the same day: "check whether the new
email is already pulled into the system … fuel prices on pages are old", then "build it … complete this task
properly and without assumptions, because yesterday I had the sense that we had already finished this".

## §0 What had actually happened (measured 2026-11-18)

| Fact | Measurement |
|---|---|
| Newest Pilot price in production | `fuel_prices` `source='pilot_email'`: observed **2026-11-10**, inserted 11/10 17:44 UTC, 683 rows |
| Emails waiting in `miki@` › `Pilot Flying J Pricing` | 8 quotes (11-12 … 11-19), all from `daily.pricing@pilottravelcenters.com`, no attachment |
| What the 11/17 merge did | Fixed the **reader** (`parsePilotPriceReport` accepts "Truck Diesel"). Nothing **fetched** the emails; loading still meant a person uploading a file. That is why it felt finished. |
| Link life | Two newest (11-18, 11-19) still downloaded; the other six had died |
| Expired link, measured | `docgenapex.apex.pilotcloud.net/…/validate` → **302 → `customerportal.pilotflyingj.com`** (live: 302 → `pfj-apex-docgen-documents-prod-us-east-1.s3.us-east-1.amazonaws.com`) |
| Real files through the fixed reader | 11-18 and 11-19: **677 rows each, 0 skipped** |

## §1 Why the EFS mailbox pattern could not be reused as is

The EFS source lists **unread** messages and marks each read. Every Pilot email was already read — the owner
reads them in Outlook — so an unread filter finds nothing. And the API must not change the owner's mailbox.
Decision **D-PPM1**: never mark read or move; keep our own record per email (`pilot_price_mails`, 0635), keyed
on the RFC 5322 Message-ID (Graph's `id` changes when a message moves between folders).

## §2 The link (pilotQuoteLink.ts, pilotQuoteDownload.ts)

Measured wrapping: Proofpoint URL Defense v2 → Amazon SES click tracking → Pilot's validate link. **D-PPM2**:
unwrap by string, never "click" the wrappers; only `https://*.pilotcloud.net` is a quote link. Redirects are
followed one hop at a time and each hop must be Pilot's document service or a `pfj-…` S3 bucket; a redirect to
the customer portal is recorded as **expired**; anything else is refused without connecting. 10 MB cap; the
body must be a zip (`PK`).

## §3 Same loader as a manual upload

**D-PPM3**: the downloaded `.xlsx` is decoded on the server (`lib/xlsxGrid.ts`, the browser decoder's cell rules,
holes as `null` exactly as the browser's JSON sends them) and loaded by `ingestPilotPrices` — the function the
upload route calls. An emailed quote and an uploaded one cannot load differently.

## §4 The record (0635 `pilot_price_mails`)

One row per email: `loaded` (Effective Date, prices, sites, sites still waiting for a map position), `expired`,
`failed` (with the reason), `no_link`. Retried only while the link can work (49 h) and at most 12 times: `failed`,
and `loaded` with sites still waiting for a map position. A loaded email never turns into failed/expired.
Layer `infra` (a work log); RLS on, no client policy.

## §5 Schedule and settings

Every 20 minutes in the scheduler lane `general` (one process fleet-wide). Pilot sends at ~20:20 UTC. **D-PPM4**:
no new settings — the mailbox is `EFS_GRAPH_*` and the org is `EFS_INGEST_ORG_ID` ("the org that reads the shared
mailbox"); both exist in Parameter Store for **production and staging** (names checked 2026-11-18). Without them
the feed logs `[pilot-price-mail] off — needs …` at boot. Staging loads the same quotes into its own database.

## §6 Where a person sees it

Truck Stops › Upload prices and locations › **From Pilot's email** (`PriceMailCard.vue`, `GET
/api/fueling/prices/mail`, `dispatch` gate like the upload): the newest loaded quote's day, and each recent
email's outcome. An expired one says to download it from Pilot's portal and upload it in the card below.

## §7 Verified before merge

- Dry run of the shipped code against the live mailbox and Pilot (no database writes): 7 emails listed,
  **11-18 and 11-19 loaded 677 each**, 11-13 … 11-17 recorded `expired`.
- 12 deliberate breaks of the rules above, each caught by a test.

## Open questions

- **Q-PPM1 — the 11/12 … 11/17 gap.** Those links are dead. Candidates: (a) download them from Pilot's customer
  portal and upload them in the drawer; (b) ask Pilot to resend; (c) leave the gap. Recommendation: (a) if the
  portal keeps past quotes — the series is what the contract-discount analysis reads.
- **Q-PPM2 — tell someone when a quote fails.** Today a failure shows in the drawer and the server log only.
  Candidate: a bell notification to `dispatch` managers when the day's quote is `failed`/`expired`.
  Recommendation: yes, once a week of real runs shows how often it happens.
- **Q-PPM3 — Pilot direct-bill PDFs** (`Pilot-Bills` folder) are the second feed in the same mailbox; the folder
  reader (`lib/graphFolder.ts`) is written for it too. Not built here.

## Progress log

- 2026-11-18 — built and verified as above; PR opened from `claude/pilot-price-mail`.
