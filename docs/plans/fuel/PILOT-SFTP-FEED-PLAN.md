# Pilot SFTP feed — plan and decision log

Status 2026-11-26: **S1 built** (this PR): the pull, the kept copy, Price Quotes loaded. **S2–S4 wait for the
first files**, because nobody has seen Pilot's layouts yet.

Related: `PILOT-PRICE-MAIL-PLAN.md` (the emailed quote, 0635), `PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24.md`
(the emailed weekly bill, 0644).

## 1. Why

Pilot sends us two things today by email: the daily "Better Of" Price Quote (as a 48-hour link since 11/11) and
the weekly invoice (a Word/DocuSign layout since 11/16, which the owner called **temporary** on 2026-11-24). On
2026-11-25 Pilot (Ally) set up **SFTP delivery** for account 139445: a daily **Price Quote** and a daily
**Transaction file**. An SFTP drop has no link to expire, no forward chain and no Outlook rule to break, and a
daily transaction file is a finer grain than the weekly bill the invoice check reads today.

## 2. What is measured (no guesses)

| Fact | Measurement |
|---|---|
| Login | Password auth (Serv-U 15.5; `none` refused, `password` offered). ~0.5 s with the `ssh2` library, 2026-11-26 |
| Host key | RSA, `SHA256:HOyHBY3TuWHYJmcsalMzXsCpFMsHvbf0gjbjDX+Y5D0` (office 11/25; staging 11/25; office again 11/26) |
| Network | Pilot filters port 22 by IP. Production and staging AWS addresses allowed 2026-11-25; both answer in ~0.15 s |
| Settings | `PILOT_SFTP_HOST/PORT/USER/PASSWORD/HOST_KEY` in Parameter Store `/silvicom/{staging,production}/api`, saved by the owner 11/25 |
| Contents | **Root empty**: 11/25 09:40 (office), 11/25 later (staging), **11/26 02:30 CT (office, 0 entries)**. First quote was promised 11/25 afternoon, first transaction file "maybe 11/26" |

## 3. The connection (built, S1)

`apps/api/src/lib/sftpClient.ts`. Read-only: list and read, never delete, rename or write. The host key is
**pinned**, so a server showing any other key never gets the password, and a key rotation by Pilot stops the feed
with "host key does not match" instead of trusting the new key. A file over 25 MB is refused before download.

## 4. The pull (built, S1)

`apps/api/src/modules/posted-prices/pilotSftpFeed.ts`, table `pilot_sftp_files` (0652), private bucket
`pilot-sftp`.

- Every run lists the folder (two levels deep). A file is new if `(path, size, modified time)` has no row, so a
  run with nothing new downloads nothing.
- Each new file is **copied into `pilot-sftp` before anything reads it**. Identical bytes under a second name
  become `duplicate`.
- Each file kind has a reader version (`READER_VERSION`):
  - **Price Quote → `ingestPilotPrices`**, the same function the manual upload and the email feed use. A quote that
    arrives by both SFTP and email loads once: prices are keyed on the quote's Effective Date.
  - **Transaction file → `held`** (version 0: no reader). The file is kept, the row says why, and the card shows it.
  - When a reader is added, its version goes up, and the next run re-reads every `held`/`refused` file of that
    kind **from the kept copy**. Nothing has to be fetched from Pilot again, and nothing depends on how long Pilot
    keeps files.
- States: `loaded`, `held`, `refused` (the reader doesn't recognise the file), `duplicate`, `failed` (SFTP,
  storage or the database failed; retried up to 12 times).
- At most 25 files a run, oldest first.

## 5. Schedule (built, S1)

Scheduler `pilot-sftp`, every 30 minutes, lane `general` (one process fleet-wide). Org: `EFS_INGEST_ORG_ID`. The
SFTP account is the same Pilot/TCH account 139445 whose EFS reports and emails already load into that org, so a
second setting for it would only be a copy. Off without the four settings, and it says so at boot. The nightly
storage backup includes `pilot-sftp` without any change, because its bucket list comes from `listBuckets`. The
orphan sweep does not touch it, because it only sweeps buckets it names.

## 6. What the office sees (built, S1)

Truck Stops › Upload prices drawer: a **"From Pilot's SFTP"** card under "From Pilot's email". It lists each
recent file with its kind and outcome: loaded (prices and day), kept (waiting for a reader), not read, duplicate,
or failed with the reason. Endpoint `GET /api/fueling/prices/sftp`, gated on `dispatch` (same as the email card).

## 7. Next steps (after the first files land)

- **S2 — read the first files.** Download them from the kept copy and measure their layout: columns, product
  names, card/unit/driver fields, totals, and whether the quote is byte-identical to the emailed xlsx.
- **S3 — Transaction reader.** Write it against the real file, bump `READER_VERSION.transactions`, and the held
  files load themselves. Where the rows go is Q-PSF1.
- **S4 — retire or keep the email feeds**, once SFTP has delivered reliably for a stretch (Q-PSF2).
- **Report email** to the owner, Vasko and Silvija in the old weekly statement layout. Daily or weekly is Q-PSF3;
  the owner asked to look at the SFTP data first.

## 7a. Decisions

- **D-PSF1 — an SFTP quote is stored under the same price source as an emailed one (`pilot_email`).** The
  2026-11-27 audit flagged this label as misleading. It stays, for a reason measured in the schema: `fuel_prices`
  is unique on `(org_id, source, station_id, product, observed_at)` (0245). A second label would store the same
  Pilot quote twice per station per day whenever it arrives by both routes (Q-PSF2 keeps both for two weeks), and
  every reader (the planner, Pilot quotes, the contract scan, the weekly bill's quote check) would then see two
  rows. The label means "Pilot's daily contract quote", not the delivery route. Which route delivered a quote is
  answered per item by `pilot_price_mails` and `pilot_sftp_files`. Renaming the label to say that is a four-step
  rename and not worth it while nothing reads the label.

## 8. Open questions

- **Q-PSF1 — where do Pilot transaction rows go?** They describe the same fills the EFS feed already writes to
  `fuel_transactions`, so writing them there would **count every fill twice**. Candidates: (a) as
  `fuel_statement_lines` of a daily statement, so the invoice check runs daily instead of weekly; (b) their own
  raw table, matched to EFS fills by card + time + gallons; (c) only enrich the EFS fills (Pilot's Vehicle ID,
  Driver ID, retail vs. billed price). **Recommendation: (a)**, if the file carries what the check needs. It reuses
  the check that already exists and gives a finding the day after the fill, not the week after. Decide after S2.
- **Q-PSF2 — when do the email feeds stop?** Recommendation: keep both until SFTP has delivered every day for two
  weeks. Loading is idempotent, so running both costs nothing. Then turn the email feeds off by setting, not by
  deleting code.
- **Q-PSF3 — daily or weekly report email?** The owner's own rule (2026-11-25): decide after seeing the data.

## Progress log


- 2026-11-26 — S1 built: migration 0652, `sftpClient.ts`, `pilotSftpFeed.ts`, scheduler `pilot-sftp`, card. Pilot's
  root still had 0 files at 02:30 CT.
- 2026-11-27 — Audit: production is on 1eaa647 (0652) and the feed is live with 0 files. Pilot's root still had 0
  entries at 09:09 CT, and the Transaction file due 11/26 has not arrived. Asked the owner to check with Pilot.
  D-PSF1 recorded.
