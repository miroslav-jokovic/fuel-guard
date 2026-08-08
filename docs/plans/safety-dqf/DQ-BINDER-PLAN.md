# Audit binder + document lifecycle — plan (2026-08-08) — **BUILT**

Four things, agreed with the owner, planned together because they share a mechanism.

1. **The audit binder** — an auditor names a sample of drivers; one action produces their qualification
   files in §391.51 order, ready to print or attach.
2. **Single-document export** — one requirement, on its own, stamped, for the outward case (a broker
   asking for a driver's credentials before releasing a load).
3. **History made visible** — the supersede chain already exists and no screen has ever shown it.
4. **Compliance records pinned as un-prunable** — the guard that stops a future retention rule from
   quietly deleting the history in (3).

---

## 1. The blocker found while planning, and the decision it forces

**`pdfkit` cannot merge an existing PDF.** It draws pages; it cannot copy them in. `defensePacket.ts`
gets away with this because hazmat evidence is photographs — it rasterises them with `sharp` and draws
them. A driver qualification file does not have that shape: a medical examiner's certificate, an MVR
printout and a Clearinghouse query result all arrive as **PDFs**, and `sharp` cannot read a PDF either.

So with what is installed today, a binder containing a PDF scan cannot be assembled at all. This is
the one thing that had to be checked before promising a date, and it is why it is the first line of
this plan rather than a footnote.

**D-BD1 · Add `pdf-lib`.** Pure JavaScript, no native dependency, and it is the standard answer for
page copying. `pdfkit` stays for the pages we _draw_ — cover, checklist, separators — because its text
layout is far better; `pdf-lib` merges the drawn pages with the scans. Two libraries, each doing the
thing it is good at.

Coverage of every content type `documents` accepts:

| Source                     | How it enters the binder       |
| -------------------------- | ------------------------------ |
| `application/pdf`          | pages copied with `pdf-lib`    |
| `image/jpeg`, `image/png`  | embedded directly by `pdf-lib` |
| `image/webp`, `image/heic` | `sharp` → PNG → embedded       |

**Consequence for the handoff:** the lockfile changes, so CI's `pnpm install --frozen-lockfile` needs
the committed lockfile. That is a step in Devin's prompt, not an afterthought.

---

## 2. Decisions

**D-BD2 · One combined PDF for a batch, not one file per driver.** Master cover listing the sample and
who requested it, then each driver's binder in sequence with continuous page numbers. It prints in one
action and attaches to one email — the two things the owner named. Fifteen separate files would mean
fifteen print jobs, and a zip cannot be printed at all.

**D-BD3 · It is a background job.** Fifteen drivers is roughly 270 documents pulled from storage and
merged. That is a minute or two, not a click, and a synchronous request would time out on Railway and
read to the user as broken. Kind `dq_binder`, on the existing queue, `dedup_key` per request.

**D-BD4 · The output has its own bucket and its own clock.** `compliance-exports`, private, no client
read at all — the job writes it and the API hands out a short signed URL. A finished binder is a
PII _aggregate_: one file containing fifteen drivers' licences, medical certificates and addresses.
Source scans are retained for years because the regulation says so; an export exists to be sent, and
then it is a liability. **Swept after 7 days.** Regenerating is one click.

**D-BD5 · Gaps are printed, never omitted.** The cover states "14 of 18 on file, 2 expired, 2 never
recorded", and the checklist lists the missing items by name. A binder that quietly drops what it
lacks is worse than useless — the auditor finds the gap anyway and now distrusts the rest of it.

**D-BD6 · Drug and alcohol tests are named, not detailed.** §40.333 keeps the DOT testing file separate
and confidential from the DQ file. The binder records that a test occurred and when; it does not carry
the result. Including results would produce one document that cannot be handed over freely.

**D-BD7 · Generated "as at" a date.** `buildDqFile` already takes the evaluation date as a parameter,
so producing the file as it stood on the day of the audit costs almost nothing now and cannot be
retrofitted cheaply later. Defaults to today.

**D-BD8 · No outbound email.** The user attaches the download to their own reply, from the inbox where
the rest of that audit correspondence already lives. Building a document-mail path would add a
delivery channel we do not have, for a step they would take anyway.

**D-BD9 · Every export is audited.** Binder or single document, the row records who exported which
driver's records and when. A record of who pulled a medical card out of the system costs one row and
is exactly what you want to have six months later.

**D-BD10 · Internal sharing is access, not attachment.** Dispatch already has read access to the
qualification file, so "dispatch needs the CDL" is answered by opening it, not by emailing a licence
around. The single-document export exists for the OUTWARD case — a broker or shipper — and is stamped
with driver, requirement, validity and who exported it, so a page that turns up in somebody's inbox
six months later can still be traced.

**D-BD11 · No re-compression of archived scans.** The instinct is reasonable and the lever is wrong:
the bytes are stored once in a private bucket, a scanned PDF is already compressed, and re-encoding an
archived medical card degrades evidence to save an amount of storage that does not matter at these
volumes. The actual risk to history is **deletion**, which D-BD12 addresses.

**D-BD12 · Compliance records are pinned un-prunable.** `certifications`, `qualification_records` and
`documents` join `RETENTION_FORBIDDEN` in `dataRetention.ts`, which is covered by an existing guard
test. Today nothing stops someone adding them to a retention rule in six months and quietly pruning a
driver's history.

---

## 3. What a binder contains, per driver

In §391.51 order, which is the order the checklist and the groups already use — that ordering was
built for this.

1. **Cover** — carrier name and DOT number, driver name, employee ID, hire date, generated by/at, the
   "as at" date, and the completeness line (D-BD5).
2. **The checklist** — every requirement with its citation, status, dates, and whether a scan is
   attached. The index the auditor works from.
3. **The documents**, each behind a separator page naming the requirement and its citation.
4. **Certification history** — the supersede chain, so "what did the medical card say on 3 March" is
   answerable.
5. **The DQF event log** — dates, references and who performed each §391.51 event (D-BD6 applies).
6. **A footer on every page** — driver, page X of Y, generated timestamp, export id. §390.32 requires
   an electronic record be accurately reproducible, and a loose page that cannot be tied back to its
   export is not.

## 4. History on the driver file page

`includeHistory` has been supported by the API since 0127 and no screen has ever requested it. A
superseded certification collapses under its replacement, showing what it said and the dates it
covered — and its scan is still there, because `documents` is append-only by RLS and the superseded
row still points at it. Nothing new is stored; something already stored becomes visible.

## 5. Build order

1. **Migration** — `compliance-exports` bucket (private, no client policy), `dq_exports` ledger table,
   `RETENTION_FORBIDDEN` additions.
2. **Assembly** — `dqBinder.ts`: draw with pdfkit, merge with pdf-lib, one driver and many.
3. **Job** — kind `dq_binder`, handler, and the API to request one and fetch the result.
4. **UI** — selection on the queue and the roster, an Export action per requirement, history rows.

Every screen against `docs/DESIGN-SYSTEM-CONTRACT.md`.

---

## 6. What shipped

All four things in the opening list are built. Every screen against `docs/DESIGN-SYSTEM-CONTRACT.md`;
`vue-tsc`, every `lint:*` and all four behavioural matrices green — `rls.test.mjs` at **204 passed**,
eighteen of those assertions added here.

- **0152** — `dq_exports` and the `compliance-exports` bucket, plus `organizations.dot_number`.
- **`services/dqBinder/`** — `gather` (four reads for a whole sample, not four per driver), `pdfDraw`
  and `render` (pdfkit authors the cover, checklist, separators and history), `merge` (pdf-lib copies
  the scans in and stamps the footers), `footer` (the placement arithmetic, with its own test).
- **`dq_binder`** on the existing queue, deduped per export, capped at two in flight; `dqExports.ts`
  owns the ledger; `dqExportSweeper.ts` runs the seven-day sweep.
- **The screens** — batch selection on the roster, an Exports tab, a per-requirement release, and the
  supersede chain finally visible on the driver file.

### Where it left this plan, and why

**`job_id` is not a foreign key.** Drafted as one; the RLS matrix rejected it, and the reason it gave
was better than the reason it was written. `jobs` is pruned at 90 days by `RETENTION_RULES`, so a real
reference would either block that delete or quietly blank the column — the second being exactly the
corruption-by-somebody-else's-delete that D-BD9 keeps `driver_ids` unreferential to avoid. A plain
uuid.

**PDF text is folded to WinAnsi.** Not anticipated at all. Both pdfkit's built-in Helvetica and
pdf-lib's `StandardFonts` THROW on a character outside WinAnsi rather than degrade — one driver named
Nikolić would have failed an entire binder. Diacritics are dropped, in a helper every drawing path
goes through. It is a compromise, and the alternatives were worse: a Unicode TTF adds a font binary
and a licence for a handful of glyphs, and silent dropping would print "Nikoli".

**The footer is rotation-aware.** §3.6 asked for a footer on every page and did not say what happens
on a page carrying `/Rotate 90`, which scans frequently do. Stamping at such a page's own bottom-left
runs the export id up the side of the printed sheet — a defect that throws nothing, logs nothing and
first appears on paper in front of an auditor. The arithmetic sits in its own module with a test that
re-derives the viewer transform independently rather than restating the four cases.

**`organizations.dot_number` had to be added.** §3.1 asked the cover for "carrier name and DOT
number". The product had never stored a USDOT number. Nullable, with a settings field, and the cover
reads "not recorded" rather than printing a blank line.

**The sample is capped at 25 and the sweep runs hourly.** Neither number was in the plan. The cap is
in the check constraint so it cannot be forgotten in a caller; hourly rather than daily because a
seven-day promise swept once a day means "up to eight".

**`dq_exports` joined `RETENTION_FORBIDDEN` too.** D-BD12 named three tables. A ledger whose whole
purpose is outliving the bytes belongs on that list beside them.

### What this plan did NOT cover, and is still open

Per-class retention (D-DQ3) and the purgeable report (D-DQ5), both from `DQF-PLAN.md`'s DQ4. D-BD11
settled that archived scans are not re-compressed and D-BD12 stopped them being pruned; neither
touches the question of when a document BECOMES purgeable. They are one piece of work — the report is
the only consumer per-class retention would have.
