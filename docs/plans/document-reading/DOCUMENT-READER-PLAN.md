# Document reader — one reusable module that reads BOLs (and later every paper we receive) and prefills the form a person would have typed · 2026-10-08

**Status:** PLAN PROPOSED — nothing here is built · **Supersedes:** the *phases* (§7) of
`docs/plans/drivers-app/BOL-READING-RELIABILITY-PLAN.md`. Its audit (F-EX1–13) and decisions
(D-EXR1–12) are kept and cited by ID here; nothing in them is re-litigated. · **Extends:**
`SCANNER-UPGRADE-PLAN.md` Step 6.2 (document profiles), `docs/17-HAZMAT-BOL-COMPLIANCE.md` (the rule
catalogue), `docs/18-HAZMATGUARD-PLAN.md` H6/H7/H11. · **Does not touch:** the placard computation in
`@hazmat/engine` (owner ruling 2026-09-08: precise).

**The owner's statement, 2026-10-08:**

> Build a reusable OCR module that reads uploaded images and PDF files of BOLs and prefills data in
> whichever feature is using it. Today, for the Hazmat Calculator, dispatch opens the BOL from Samsara
> Documents or a driver's message and types everything into the form. Driver photos are poor; dispatch
> must first check whether the BOL itself is correct; then type it all; and BOLs raise many questions —
> they are confusing but highly regulated, written a certain way. Fully automated, with a human
> checking only at the beginning, data prefilled. Precise, reliable, production-ready.

Three jobs are named in that statement, and the plan keeps them apart because each fails differently:

| Job | Failure it must not have | Where it lives |
|---|---|---|
| **Read** — turn pixels into fields | a wrong value presented as read | the module (`document-reading`) |
| **Audit** — is the paper itself written correctly | a defective BOL called compliant | pure rules, `@hazmat/engine` `bol/` (§5) |
| **Prefill** — put the fields into a feature's form | a guessed value in a regulated field | a per-feature adapter (§6) |

---

## 0. Ground truth — measured 2026-10-08, `main` at `4e84b7f`

Everything below was read or measured today. Citations are to `main`.

**F-DR1 — One AI document reader exists, it is hazmat-only, and it has never run.** The only place an
image reaches a model is `apps/api/src/modules/hazmat/hazmatExtraction/` (1,924 lines; `vision.ts:89`
is the only SDK call). CDL/medical capture, fuel statements, maintenance invoices and IFTA use no
model. Production holds **0** `hazmat_loads`, **0** `hazmat_documents`, **0** `hazmat_runs` (queried
today). So the pipeline the audit dissected is unexercised code — which makes now the cheapest moment
there will ever be to reshape it.

**F-DR2 — It cannot read a PDF.** `ImageInput.mediaType` is webp/jpeg/png only (`vision.ts:17`);
`normalizeImage` is sharp (`image.ts:50`); the API has sharp, pdf-lib and pdfkit and **no PDF
rasteriser**. No call site sends a `document` block. Shippers increasingly email born-digital BOL PDFs;
dispatch receives scans as PDFs. Today they are unreadable by construction.

**F-DR3 — The Hazmat Calculator has no upload and no prefill, and its form is not free text.** Route
`/hazmat/calculator` → `HazmatCalculatorPage.vue` → `HazmatCalculatorForm.vue`; model in
`features/hazmat/calcModel.ts` (`CalcForm` :78, `CalcLineForm` :38, `buildCalcRequest` :389). A line's
product is a `HazmatProduct` **picked from the Hazardous Materials Table** — picking it fixes id, PSN,
class, subsidiaries, PG and `hmtRef` together (`packages/shared/src/hazmatApi.ts:36`). Per line the form
also holds package type and count, per-package capacity, quantity + unit, gross weight + unit,
compartment, residue, Limited Quantity, reclassified combustible, marine-pollutant concentration and net
quantity. Load-level: equipment (fleet trailer or type), tank capacity and state, other freight, vessel
leg, earlier-today ids. **There is no RQ field and no free-text UN field.** `POST /api/hazmat/calc`
(`routes/index.ts:72` → `hazmatCalc.ts:14`) computes and persists nothing. Consequence: a prefill must
*resolve* a printed line to an HMT row exactly, and a printed line that does not resolve is the most
important thing the dispatcher sees, not a blank.

**F-DR4 — The BOL "audit" that exists audits the resolved load, not the paper.** `validateBol`
(`packages/hazmat-engine/src/bol/validate.ts:65`) checks §172.202(a) sequence, §172.203 additional
entries, PG rules and info-level presence of the ER phone, ER info and certification — **from the
resolved lines**. Its own header (`:9`) says comparing these against the printed text is still to come.
So "is this BOL written correctly" — the dispatcher's first question — has no implementation.

**F-DR5 — Samsara already holds the BOLs, and our token can read them.** Probed today (read-only
`GET`s): `GET /fleet/document-types` → 200, six types including **"BOL, SECURMENT, PLACARDS"** (one
field, *Add Photos*) and **"Proof of Delivery"** (*Photos*); `GET /fleet/documents` → 200 with photo
fields (`photoValue`). The code reads none of it (`samsara/lib/samsara.ts` calls vehicles, stats,
trailers, HOS, drivers and assignments only). This removes the blocker both earlier plans waited on:
*"zero labelled documents anywhere"* (F-EX13) and *"the device session is the only way forward"*
(scanner position) — real BOL photographs from this fleet are one read-only API call away. Volume:
§0.1.

**F-DR6 — Drivers cannot send a picture through our messaging.** `messages.attachment_path`
exists (0096:59) and nothing reads or writes it; `sendMessageRequestSchema` is text only
(`messagesContract.ts:88`). "A BOL in a driver's message" therefore means a Samsara message or a text
on a phone — neither reachable. The Samsara *document* is the reachable path (Q-DR3).

**F-DR7 — The call shape is incompatible with every current-generation model.** `vision.ts:95` forces
`tool_choice: {type: "tool"}`, `:92` sends `temperature: 0`, `:91` caps `max_tokens: 2048`. On Claude
Sonnet 5.5 and Opus 5.5 a forced `tool_choice` returns **400**; on Sonnet 5.5 and Haiku 5.5 a
non-default `temperature` returns **400**; and thinking cannot be switched off on Opus 5.5 (Sonnet 5.5
only via `between_tools`), so 2,048 tokens would truncate a multi-line BOL mid-JSON. The pinned pair
(`env.ts:50-51`, Sonnet 4.6 + Haiku 4.5) still works, so nothing is broken today — but the first model
upgrade, which §8's measurement will almost certainly recommend, breaks the call three ways at once. The
replacement is native structured outputs (`output_config.format` with a JSON schema), which also
removes the hand-mirrored schema at `vision.ts:52` ("mirrors bolFieldsSchema") — a copy where a
derivation exists.

**F-DR8 — `loads.hazmat` is false on all 303 loads in production.** Queried today. Either no hazmat
moved in the window, or McLeod's hazmat indicator is not reaching the mirror. Whichever it is, any rule
of the form "require the hazmat section when `loads.hazmat`" (old plan Step 2.0) would currently
require it nowhere. Q-DR4.

**F-DR9 — The McLeod order read is already wider than the old plan assumed.** Old Step 0.4 asked for
pieces, weight and reference numbers. Migration 0366 mirrors `weight_lbs`, `pieces`, `consignee_ref`
(`orders.consignee_refno`) and per-stop `po_number` (`stop.ponum`); `pickup_number` waits on a grant
(Q-LMR5). The order-reconciliation half of the BOL audit (§5.2) has its declaration today.

**F-DR10 — The upload primitives exist; nothing to invent.** `FileDropzone.vue` is the mandated
primitive (`apps/web/CLAUDE.md`), already used with `.pdf,.jpg,.jpeg,.png,.webp,.heic`;
`DocumentPreview.vue` is the sanctioned viewer (images inline, PDFs in the browser's viewer); every
upload in the repo is a client PUT to a signed URL (no multipart endpoint anywhere), and
`evidence`'s `POST /documents` (`evidence/routes/compliance.ts:250`) is the precedent shape.

### 0.1 Samsara document volume (for the corpus and for sizing)

Measured 2026-10-08 by paging `GET /fleet/documents` (read-only) over the last 30 and 90 days:

| Samsara document type | Documents, 30 d | Photos, 30 d | Documents, 90 d | Photos, 90 d |
|---|---|---|---|---|
| BOL, SECURMENT, PLACARDS | 492 | 2,135 | 1,473 | 6,496 |
| Proof of Delivery | 160 | 311 | 482 | 1,066 |
| Empty / Loaded / Stop Call (forms, no photos) | 3,134 | — | 9,165 | — |

Photo objects are `{id, url}` with `url` on `s3.samsara.com` — a vendor link, hence D-DR9.

Three things follow. **(a) The corpus problem is solved by volume:** ~16 BOL-type submissions a day,
6,496 photos in 90 days — the 60-document corpus (Step 0.2) is a selection exercise, not a wait.
**(b) The BOL type is a bag, not a BOL:** 4.3 photos per submission, because the same type carries the
securement and placard photos. Every page must first be *classified* (`bol / placard / securement /
other`) and only `bol` pages are read for fields (D-DR11). **(c) This fleet moves placarded freight
every day** — ~16 submissions a day named for placards — while `loads.hazmat` is false on every load
(F-DR8). That makes Q-DR4 a data defect to chase, not a curiosity.

**Sizing.** If every BOL-type photo were classified and every BOL page read in full, the month is ~2,135
classifications (cheap model, one image each) plus the BOL pages' dual reads — at §8's per-page figure,
well under $100 a month for the whole fleet before any caching. The interactive prefill reads only what a
dispatcher opens.

---

## 1. Decisions

Each `D-DRn` names the finding that forced it. D-EXR1–12 stand and are not repeated.

**D-DR1 — One module, many profiles; the module knows no trucking vocabulary.** (F-DR1, scanner Step
6.2.) `apps/api/src/modules/document-reading/` owns intake, page normalisation, the model calls, the
evidence ledger, the cache, cost metering and the review record. *What* to read is a **profile** in
`packages/shared`: a Zod contract, a prompt, the field set that is safety- or money-critical (derived,
D-EXR4), and its acceptance-rule version. The first profile is `shipping_document` (a BOL at pickup, a
signed copy at delivery). Adding "fuel receipt" or "maintenance invoice" later is a profile, a corpus and
an adapter — never a second pipeline. It is a core-store module in `docs/ARCHITECTURE.md` terms
(D-ARC1): features call its exported interface; nothing reads its tables directly.

**D-DR2 — The module returns evidence, never a form.** Its output is `ShippingDocument` + one
`FieldEvidence` per field (D-EXR1) + page images. Mapping to a form is the consuming feature's
**adapter**, a pure function in that feature (`features/hazmat/bolPrefill.ts`), tested by table. This is
what keeps the module reusable and stops a calculator concept leaking into it.

**D-DR3 — Every input becomes page images; a PDF's text layer is an extra, independent reader.**
(F-DR2.) A PDF is rasterised server-side (300 DPI) into the same page pipeline a photo uses, so the
ledger, regions, crops and cache are one code path. If the PDF carries a text layer (a born-digital
BOL), the text with its coordinates is recorded as a **reader** in the ledger — it reads characters
exactly, so it is the strongest independent vote available (D-EXR3) and costs no tokens. A scanned PDF
has no text layer and gets none. We do **not** send the PDF itself as a `document` block: it would give
the model a second, different rendering of the page from the one the ledger crops, and the
evidence-to-pixels link is the point.

**D-DR4 — Prefill is a draft the dispatcher can see all of; nothing computes from it unseen.**
(Owner: "checking by human only at beginning, data prefilled".) Every prefilled field shows its state —
**Read** (independent evidence agrees), **Check** (readers disagree or one source only), **Not read**
(unreadable, with the page region) — and clicking it shows the crop it came from. The prefill never
presses Calculate. A printed line that does not resolve to exactly one HMT row is shown as the printed
text with the product picker open; suggestions may be ranked fuzzily, the value never is
(`resolveLine.ts:16-21` doctrine). Fields a BOL does not carry (equipment, tank capacity and state,
vessel leg) are never prefilled from it.

**D-DR5 — "Human only at the beginning" is a per-field graduation with a stated number, not a
date.** (D-EXR7, D-EXR9.) Every dispatcher edit of a prefilled value is a correction; every value left
unchanged at Calculate is a confirmation; both are stored append-only and become labels. A field
graduates from *Check* to *Read* only when the measured false-accept rate for that field, under the
current rule version, has a 95 % upper bound below its ceiling. With zero errors in *N* confirmations
the 95 % upper bound is ≈ 3/*N* (rule of three), so: **non-engine fields (shipper name, BOL number,
dates) need N ≥ 300 (≤ 1 %); engine inputs (id, PSN, class, PG, quantity, weight, packaging, LQ, RQ,
marine pollutant) need N ≥ 600 (≤ 0.5 %).** One correction resets that field's count under that rule
version. Graduated fields are still displayed — "Read" means no click is needed, not that the field is
hidden. The owner switches graduation on per org (Step 4.3); default off.

**D-DR6 — The paper audit is pure rules over the PRINTED lines and lives beside `validateBol`.**
(F-DR4.) A new `auditPrintedPaper(printed, resolved)` in `packages/hazmat-engine/src/bol/` checks what
the shipper actually wrote against what §172.202–.204/.604 require for the material it resolves to.
No model judges compliance — the model only reads. The placard computation is not touched.
Placement is Q-DR2 because it is inside the engine package the owner ruled precise.

**D-DR7 — Every audit finding speaks to a dispatcher, cites the rule, and says who fixes it.**
(Owner: "a lot of questions … confusing, but highly regulated".) Each finding carries one plain
sentence ("The BOL lists UN1203 but not the packing group. §172.202(a)(4) requires PG II here."), the
CFR cite, and the actor: *shipper must correct the paper* / *driver must not accept until corrected* /
*information only*. The sentences live in one catalogue keyed by rule id, so the review UI, the driver
app and any later assistant read the same words.

**D-DR8 — The model call is versioned, structured, and survives a model change.** (F-DR7.) One
adapter `readPages(profile, pages, model)` sends images + the profile prompt with
`output_config.format` = the JSON schema generated **from** the profile's Zod schema (never hand
mirrored), handles `stop_reason` `refusal` and `max_tokens` as typed failures (never parsed), sends no
sampling parameters, and records model id, prompt version, schema hash and usage on the read. Models
come from `DOC_READ_MODEL_A` / `DOC_READ_MODEL_B` (the hazmat env names become aliases until retired).
Which models: §8 decides on numbers (Q-DR1).

**D-DR9 — Intake copies bytes in; we never read through someone else's URL.** A Samsara photo, an
upload or a scan is copied into our private bucket, SHA-256 hashed, and its row is append-only before
any read. A Samsara photo URL is a vendor link with its own expiry; a read whose source can vanish is
not evidence. Shipping papers carry retention duties (§172.201(e) offeror 2 yr, §177.817(f) carrier
1 yr), so intake sources join `RETENTION_FORBIDDEN` like `hazmat_documents`.

**D-DR10 — The first consumer is the office, not the phone.** The dispatcher's typing is the cost
named today, Samsara already delivers the photos, and the office path needs no app release, no device
session and no McLeod write. Driver capture on stops (old D-EXR10) is a later consumer of the same
module (Phase 6).

**D-DR11 — Classify every page before reading it.** (§0.1(b).) The first pass on any page answers
only "what is this page" (`bol / delivery_copy / placard / securement / other`) with the cheap model;
field reading runs on `bol` and `delivery_copy` pages only. A dispatcher can override the class (that is a
label too). Placard and securement photos are kept with the source — a later profile may read them; none
does now.

**D-DR12 — Three intake channels, one source table, and the sender names a driver, never a load.**
(Owner ruling on Q-DR3, 2026-10-08: drivers send BOLs through Samsara, by SMS, and by email — all
three.) Each channel is a collector that copies bytes into `document_sources` (D-DR9) with its origin:

| Channel | What exists today | What is built |
|---|---|---|
| **Samsara** document | read-only token reads `/fleet/documents` (F-DR5) | the poller (Step 0.1) + photo copy (3.2) |
| **SMS / MMS** to the Telnyx toll-free number | signed webhook `/api/webhooks/sms`, inbound parse (`lib/sms.ts` `parseTelnyxInboundSms`) — text only; MMS media ignored | read `payload.media[]`, download each within the webhook's job, store (Step 3.5) |
| **Email** to a documents mailbox | Microsoft Graph mail connector built for EFS (`lib/graphMail.ts`: folder, unread, attachments, >4 MB `$value`, mark read) | the same connector pointed at a second folder, PDF + image attachments only (Step 3.6) |

The sender is matched to a driver by the phone or email on the roster (`roster`'s interface) and is
shown, never trusted: the dispatcher still picks what the document is for. An unknown sender's document
lands in an **Unmatched** list, not in the bin. A forwarded chain or an email with a logo and a
signature image yields only attachments that pass the page classifier (D-DR11). A document that arrives
on two channels (driver texts and uploads to Samsara) is deduplicated on page SHA-256 within the org.

**D-DR13 — One normalisation stage, before any reader sees a pixel.** (Owner ruling on Q-DR6,
2026-10-08: "normalise images before they even hit OCR".) Whatever arrives — HEIC from an iPhone,
an MMS JPEG a carrier already recompressed, a PNG screenshot, a WebP, a PDF page — becomes one
**canonical page** in the PAGES stage: decoded, EXIF-orientation applied and stripped, converted to
sRGB 8-bit, alpha flattened on white, stored losslessly as the page's ORIGINAL (PNG) beside the
source's untouched bytes, plus the working copy the readers use. Nothing downstream — classifier,
model, text-layer comparison, crops, review UI — knows what format came in. HEIC decoding uses
libheif (via `heic-decode`, LGPL-3.0 — permissible for a hosted service; sharp's prebuilt binaries do
not decode HEVC). An input the stage cannot decode is refused at intake with a sentence naming the
format, never passed through. The normaliser is versioned and its version is in the cache key (§4.6).

---

## 2. The module — shape and contracts

```
 INTAKE       upload (web) · Samsara document · SMS/MMS · email attachment · driver scan (later)
   │          → document_sources row (sha256, origin, mime, bytes in bucket `document-intake`)
   ▼
 PAGES        D-DR13 canonical page: decode (incl. HEIC) → orient → sRGB → original PNG + working copy
   │          PDF: rasterise 300 DPI per page + text layer
   │          → classify each page (D-DR11) → document_pages rows (page n, class, keys, text words?)
   ▼
 READ         usability gate (shared metrics) → pass A ‖ pass B (structured outputs)
   │          → text-layer / device-OCR votes → keyed cross-check → ledger → acceptance rule
   │          → [Phase 5: region re-read ladder for Check/Not-read fields]
   ▼
 RESULT       document_reads row: profile, versions, ShippingDocument, FieldEvidence[], cost
   ▼
 CONSUMERS    hazmat calculator prefill · hazmat load workspace · stop readiness (billing) · …
   │          each an adapter in its own feature; each writes confirmations/corrections back
   ▼
 LABELS       document_read_reviews (append-only) → per-field accuracy → graduation (D-DR5)
```

**Tables** (one migration, all new — exempt from the column-before-reader rule; RLS enabled, no client
policies: the API serves everything with org filters, `expectOrgScoped` in every service test):

| Table | Holds | Mutability |
|---|---|---|
| `document_sources` | org, origin (`upload`/`samsara`/`sms`/`email`/`driver_scan`), origin ref (Samsara document id / Telnyx message id / Graph message+attachment id), sender (phone or address, as received) + matched driver, sha256, mime, byte size, page count, uploaded_by, created_at | append-only; `RETENTION_FORBIDDEN` |
| `document_pages` | source, page number, page class + who set it, original key + sha256, working key, width/height, `text_layer` jsonb (words + boxes) or null, capture metrics | append-only |
| `document_reads` | source, profile + profile version, status (`queued/reading/done/failed`), failure code, models, prompt version, schema hash, acceptance-rule version, `result` jsonb, `evidence` jsonb, input/output tokens, cache key, started/finished | insert, then one status transition RPC |
| `document_read_reviews` | read, field path, action (`confirmed/corrected/unreadable`), old/new value, actor, consumer (`hazmat_calculator`…), created_at | append-only; `RETENTION_FORBIDDEN` |

`samsara_documents` (staging, owned by the `samsara` collector, D-ARC1) holds the Samsara document id,
type, driver, vehicle, time, the "Load #" field when present, and photo ids; intake into
`document_sources` happens through the module's interface.

**Contracts** (`packages/shared/src/`):

- `shippingDocumentContract.ts` — old Step 2.0, unchanged in substance: `identity` (BOL number, date,
  page n of m), `parties` (shipper, consignee, bill-to), `references` (PO, customer, consignee refs),
  `freight` (pieces, pallets, weight + unit, seal, trailer), `hazmat` (today's `BolFields.lines` +
  header items: ER phone, certification, offeror), `execution` (receiver signature present, printed name,
  delivery date/time, OS&D notations). `BolFields` becomes a projection, so the hazmat path's 69
  extraction tests run unchanged against it.
- `fieldEvidenceContract.ts` — `{path, value, status: read|check|not_read, sources[{reader:
  passA|passB|textLayer|deviceOcr|region|declaration|reviewer, page, bbox?, value}], ruleVersion}`.
- `documentReadingContract.ts` — the routes' request/response schemas and the profile registry.

**Routes** (permission per consumer, read from the `APP_SECTIONS` matrix in `auth.ts`, never a new
role list): `POST /api/documents/sources` (register upload → signed PUT URL) · `POST
/api/documents/sources/from-samsara` · `POST /api/documents/reads` (`{sourceId, profile}` → read id,
enqueues) · `GET /api/documents/reads/:id` (status, result, evidence, short-lived page URLs) ·
`POST /api/documents/reads/:id/reviews` (confirm/correct batch). The calculator needs `hazmat ≥
manage`, which today is admin, fleet_manager, dispatcher and safety_manager.

**Queue.** New job type `document_read` on the existing Postgres queue (no Redis — `P0-WORKER-QUEUE-PLAN`
Q1), concurrency 2 per worker like `hazmat_extract`, idempotent on read id, dedupe key
`document_read:{id}`. Unlike `executeExtraction` today, a *transient* model error (429, 5xx, timeout)
rethrows so the queue's backoff retries it; only a terminal outcome (refusal, schema failure, unusable
image, budget) records `failed` with its code. The dispatcher's page polls the read; target **p95 ≤ 30 s
for a two-page BOL** (measured in Step 3.4, not promised).

**Gates already in the house, reused:** `org_module_enabled` entitlement, a per-org kill switch, the
monthly token budget on `org_usage_month` (`withinBudget`), `[metrics]` log lines per read (pages,
tokens, latency, outcome).

---

## 3. Inputs — what is accepted, what is refused, and why

| Input | Handling | Refused when |
|---|---|---|
| JPEG / PNG / WebP | EXIF-rotate; original kept byte-exact; working copy ≤ 1568 px long edge | decode fails; long edge < 1200 px (the live resolution floor) |
| PDF, born-digital | rasterise each page at 300 DPI; text layer + word boxes recorded | encrypted; > 10 pages; > 25 MB |
| PDF, scanned | rasterise at 300 DPI; no text layer | same |
| HEIC / HEIF (iPhone) | decoded by libheif, then the D-DR13 canonical page like everything else | decode fails |
| MMS media (any of the above) | downloaded from Telnyx's media URL within the webhook's job, then as its format | URL expired or > 25 MB |
| Email attachment (PDF or image) | fetched via Graph, then as its format; inline logos/signatures fall to the classifier | not PDF/image |
| Mixed pages (BOL + placard/securement photos; BOL + invoice + rate con in one PDF) | every page classified first (D-DR11); non-BOL pages kept, not read for fields | — |

Rasteriser choice is Step 1.3's spike: **pdfjs-dist (already a web dependency, Apache-2.0) with
`@napi-rs/canvas` (MIT, prebuilt)** is the recommendation; MuPDF's WASM build is ruled out on licence
(AGPL, and this is a hosted service). Done-when for the spike is "renders the five fixture PDFs on the
Railway staging image", not on a laptop.

---

## 4. Reliability — what makes a wrong value fail to become a fact

The five layers of the old plan's §4 stand. What this plan adds or makes concrete:

1. **A born-digital PDF's text layer is ground truth for characters** (D-DR3). Where it covers a
   field's region, a model read that disagrees with it is *Check*, never *Read*.
2. **Readers are matched by key, every engine input is compared, the compared set is derived from the
   profile** (D-EXR4/5) — Phase 2 lands these in the module, not in hazmat.
3. **Identifiers are never corrected, only resolved or refused.** UN/NA ids resolve to an HMT row by
   exact digits; PSN by the dataset's own normalisation; a near-miss is a suggestion in the picker.
4. **Arithmetic is a reader.** Sum of line gross weights vs printed total; package count × per-package
   vs line quantity; page "n of m" completeness. Agreement counts as independent evidence (D-EXR3).
5. **The order is a reader.** Consignee ref, PO, pieces and weight from the McLeod mirror (F-DR9)
   corroborate or contradict the paper, and the contradiction is itself an audit finding (§5.2).
6. **The cache cannot replay a corrected read** (F-EX10): key = profile version ‖ models ‖ prompt
   version ‖ schema hash ‖ normaliser version ‖ rule version ‖ page hashes ‖ the source's review epoch.
7. **Failure is typed and visible.** `refusal`, `max_tokens`, schema-invalid output, unusable image,
   budget exhausted, integrity mismatch — each a code with a sentence, never a silently empty form.

---

## 5. The BOL audit — "is this BOL correct" answered before anyone types

### 5.1 Paper rules (pure, `auditPrintedPaper`, D-DR6)

Each rule reads the printed line and the HMT row it resolved to; each cites `docs/17` Appendix A.

| Rule id | Checks | Cite |
|---|---|---|
| `paper_sequence` | id, PSN, class, PG appear and in ISHP order | §172.202(a), (b) |
| `paper_psn_matches_hmt` | printed PSN equals the resolved row's PSN (allowed variations per §172.101(c)) | §172.202(a)(1) |
| `paper_class_pg_match` | printed class / subsidiary / PG equal the row's | §172.202(a)(2)-(4) |
| `paper_technical_name` | "G" entries show a technical name in parentheses | §172.203(k) |
| `paper_rq` | "RQ" printed when the package quantity meets the reportable quantity | §172.203(c) |
| `paper_lq` | "Limited Quantity" / "Ltd Qty" when LQ is claimed | §172.203(b) |
| `paper_marine_pollutant` | "Marine Pollutant" when applicable (bulk, or the vessel leg) | §172.203(l) |
| `paper_quantity_present` | total quantity with unit per line | §172.202(a)(5) |
| `paper_hm_column` | "X" (or "RQ") in the HM column when non-hazmat items share the paper | §172.201(a)(1) |
| `paper_er_phone` | 24-hour number present and well-formed; flags the "call shipper" pattern | §172.604 |
| `paper_certification` | shipper certification present (signature presence only — not identity) | §172.204 |
| `paper_page_complete` | page "n of m" — every page present | §172.201(c) |

Each rule's result is `pass / fail / cannot_tell`. If the field it needs is *Check* or *Not read*, the
answer is `cannot_tell`, never `pass`. Placard computation consumes nothing new.

### 5.2 Order rules (module-side, non-hazmat too)

Consignee ref and PO match the McLeod order (`consignee_ref`, `po_number`); pieces and weight within the
order's figure (tolerance: exact for pieces, weight to the unit stated — no invented tolerance; a
difference is a finding with both numbers); shipper and consignee names compared by the dataset's
normalisation, mismatch shown with both strings, never auto-matched. A document with no McLeod match is
"no order to compare" — not a pass (D-EXR11).

### 5.3 The words (D-DR7)

`packages/shared/src/bolFindingCatalogue.ts`: per rule id, `{sentence(ctx), cite, actor, howToFix}`.
`lint:comment-claims` style discipline: every catalogue entry has a test that renders it with a real
context.

---

## 6. The first consumer — Hazmat Calculator prefill

**What the dispatcher sees.** On `/hazmat/calculator`, a "Read a BOL" control: drop a PDF/photo
(`FileDropzone`), or **"From Samsara"** — a list of the last 72 hours of *BOL, SECURMENT, PLACARDS*
documents with driver, truck, time and Load # (Step 3.2). While reading: page thumbnails and a progress
state. When done, the page opens beside the form (`DocumentPreview`), the audit findings sit above the
form in plain sentences, and the form is filled.

**The adapter** `features/hazmat/bolPrefill.ts` — `shippingDocumentToCalcForm(doc, evidence, dataset)
→ {form, fieldStates, unresolved[]}`, pure, tested by table:

| BOL value | Form field | Rule |
|---|---|---|
| id + PSN + class + PG | `product` (HMT row) | exact resolve via `mapBolLines`/`resolveLine`; else line left with product empty, printed text shown, picker open |
| package count + type | package count, type | packaging kind via `mapBolLines` derivation; unknown wording → *Check* |
| quantity + unit | quantity, unit | unit normalisation from `bolFields.ts`; unknown unit → *Check* |
| gross weight | gross weight + unit | as printed; never converted silently |
| "LTD QTY" mark | Limited Quantity | only when both passes read it (today's rule) |
| "RQ" | — | **no form field** (F-DR3); shown as an audit fact, Q-DR7 |
| marine pollutant marks | concentration / net qty prompt | flag only; the numbers are never on a BOL, so never prefilled |
| — | equipment, tank capacity/state, vessel leg, earlier-today ids | **never** prefilled from a BOL (D-DR4) |

Calculate sends exactly what the form holds. On Calculate the page posts the review batch: untouched
prefilled fields → `confirmed`, edited → `corrected` with old/new. That batch is the label stream D-DR5
graduates on.

---

## 7. Phases

One step per branch and PR; each names its build, its verification and its done-when. Steps marked
**§8** ship the four-number table (accuracy, false-accept, yield, cost) before/after in the PR body.
Migrations follow `MIGRATION-DISCIPLINE.md`: tables first, readers in a later merge.

### PHASE 0 — Measurement first (no user-visible change)

**0.1 Samsara documents collector, read-only.** `samsara` module polls `/fleet/documents` by cursor
into `samsara_documents` (scheduler on the `api` service only, `docs/WORKER-DEPLOYMENT.md`); no photo
bytes yet. *Verify:* fixture pages + a recorded response; org-scoped. *Done-when:* staging shows the
last 7 days with counts matching the API.

**0.2 Corpus from Samsara + office.** A script (not a route) that copies *BOL…* and *Proof of Delivery*
photos for a chosen date range into `fixtures/real/private/` (gitignored, PII rule from scanner Step
0.1); office PDFs added by hand. Target: **60 documents** — 40 hazmat BOLs (≥ 10 poor: night, glare,
fax-of-copy), 10 non-hazmat BOLs, 10 signed delivery copies — and ≥ 5 born-digital PDFs.

**0.3 Labels.** `labels.json` = `ShippingDocument` + per-page quality band, **typed from the paper or
the clearest view by a person, double-keyed by a second person on the hazmat section** (Q-DR5). A
label disagreement between the two keyers is resolved and recorded, never averaged.

**0.4 `doc:score`.** `pnpm --filter @silvicom/api doc:score` — injectable reader, so a recorded run
re-scores for free; prints the four numbers per field path and per band, with the document count beside
every number. *Verify:* altering one label moves exactly one field's accuracy.

**0.5 Baseline on today's pipeline.** Run the existing hazmat extractor (Sonnet 4.6 + Haiku 4.5) over
the corpus through a thin shim. Record verbatim in §10. **No reading change merges before this.**

### PHASE 1 — The module skeleton (no reading change)

**1.1 Contracts.** `shippingDocumentContract`, `fieldEvidenceContract`, `documentReadingContract`;
`BolFields` as a projection. *Verify:* the 69 existing extraction tests pass unchanged.

**1.2 Tables + bucket + RLS + `RETENTION_FORBIDDEN` + ARCHITECTURE.md row.** One migration (new tables
only). *Verify:* `check-rls`, `lint:migrations`, a PGlite matrix that an update/delete on the
append-only tables raises.

**1.3 Pages: the normalisation stage (D-DR13).** Rasteriser spike → choice recorded (§3); libheif
for HEIC; one canonical page out of every format; text-layer extraction; caps. *Verify:* five fixture PDFs (born-digital, scanned, rotated, encrypted,
11 pages) and one image per format (HEIC, EXIF-rotated JPEG, PNG with alpha, WebP, CMYK JPEG) produce
byte-identical canonical pages across two runs, upright, sRGB, with text words at the generator's
coordinates, and the refusals.
*Done-when:* green on the Railway staging image.

**1.4 The model adapter (D-DR8).** Structured outputs from the Zod schema, no sampling params, typed
`refusal` / `max_tokens` / schema failures, usage recorded; `max_tokens` sized from the schema and
measured output, not 2,048. Default models unchanged (Sonnet 4.6 + Haiku 4.5). *Verify:* injected
fake client tests for every stop reason; one live call in the PR body.

**1.5 Page classifier (D-DR11).** Cheap-model, one image, closed label set; scored on the corpus'
pages (the 2,135 photos of §0.1 give the mix). *Done-when:* `doc:score` prints a confusion table, and
no `bol` page in the corpus is classed `other`.

**1.6 Read orchestration + queue job + routes.** Cache key per §4.6; budget; kill switch; transient vs
terminal failure split. *Verify:* `expectOrgScoped` on every query; a 429 is retried, a refusal is not.

### PHASE 2 — Close the known holes inside the module (each test-first)

Old Steps 1.1–1.6 applied to the module's code: **2.1** derived cross-check set (F-EX5) · **2.2** key
alignment (F-EX6) · **2.3** cache key + review epoch (F-EX10) · **2.4** `integrity_mismatch`
unclearable (F-EX11) · **2.5** no auto-accept, default off (F-EX8) · **2.6** provenance persisted
(F-EX7) · **2.7** text-layer reader in the ledger (D-DR3) · **2.8** arithmetic and page-completeness
as readers (§4.4). **§8** on 2.1, 2.2, 2.7, 2.8.

### PHASE 3 — Hazmat Calculator prefill (the owner's example, end to end)

**3.1 Model choice (§8, Q-DR1).** Score the corpus on three pairs: (a) Sonnet 4.6 + Haiku 4.5
(baseline), (b) Sonnet 5.5 + Haiku 5.5, (c) Opus 5.5 + Haiku 5.5. Owner picks on the table: lowest
false-accept on engine inputs first, yield second, cost third.

**3.2 Samsara photo intake.** "From Samsara" copies the chosen document's photos into
`document_sources` (D-DR9). *Done-when:* a staging dispatcher picks yesterday's BOL photo and a read
starts.

**3.3 The adapter** `bolPrefill.ts` with the §6 table as its test table, including an unresolved line,
LQ, RQ present, marine pollutant mark, two-line mixed load, and a non-hazmat line on the same paper.

**3.4 The calculator UI.** Read control, page beside form, field states with crop on click, unresolved
lines with the picker open, review batch on Calculate. `e2e-apply`-style stubbed Playwright spec in
`typecheck-build` (raw-JSON stub, never under `apps/web/e2e/`). *Measured:* p95 read time on staging
for the corpus' 2-page documents. *Done-when:* a dispatcher reads a Samsara BOL into the form and
calculates with every prefilled field visible and stated.

**3.5 SMS/MMS intake (D-DR12).** `parseTelnyxInboundSms` gains `media[]`; the webhook enqueues a
`document_intake_sms` job (never downloads inside the request); sender matched to a driver; documents
appear in "From the drivers" beside Samsara's. *Prerequisite, owner action:* Q-DR9.
*Verify:* fixture of Telnyx's published MMS payload; an unknown number lands in Unmatched; a STOP
message is never treated as a document.

**3.6 Email intake (D-DR12).** `graphMail.ts` generalised from "the EFS folder" to a named folder per
use; a `Documents` folder polled by the `api` service's scheduler; PDF + image attachments only.
*Prerequisite, owner action:* Q-DR10. *Verify:* a forwarded email with a logo, a signature image and a
two-page BOL PDF yields one source with two `bol` pages.

### PHASE 4 — The paper audit and the earned trust

**4.1 `auditPrintedPaper`** (§5.1) after Q-DR2, test-first, one test per rule per outcome including
`cannot_tell`. **4.2 Finding catalogue** (§5.3) and the audit panel above the form. **4.3 Graduation
(D-DR5):** per-field counters from `document_read_reviews`, the rule-of-three thresholds as contract
constants, an owner-only per-org switch; a small "Reading accuracy" card in hazmat settings showing
per-field N, corrections and state. *Verify by mutation:* one correction resets that field.

### PHASE 5 — Poor photos: the recovery ladder (each rung §8)

Old Phase 3 in the module: **5.1** read from the ORIGINAL (F-EX1) · **5.2** band-tiled region re-read for
*Check*/*Not read* fields (F-EX2) · **5.3** regions from text-layer / device word boxes · **5.4** contrast
view of the crop, counting only in agreement. A rung that raises false-accept on any engine input does
not merge. **5.5** "Ask the driver for a better photo": a *Not read* engine field offers the dispatcher a
one-tap SMS/push naming the page and region (paths exist).

### PHASE 6 — More consumers, same module

**6.1** Hazmat load workspace: `hazmatExtraction/orchestrate.ts` calls the module; the hazmat-only
pipeline is deleted (strangler, D-ARC4 — it has no production rows to migrate, F-DR1). **6.2** Stop
readiness for billing (old Layer 1): every Samsara *Proof of Delivery* read against its order — present,
signed, dated, pieces, OS&D — a queue for the billing clerk; no McLeod write (old Q6/Q9 stand).
**6.3** Driver scanner onto stops (old Step 0.0 / D-EXR10), device OCR word boxes as a reader (old
2.2–2.3). **6.4** Further profiles (fuel receipt, maintenance invoice, CDL/medical card) — each needs its
own 40-document corpus and baseline before it is switched on anywhere.

---

## 8. Measurement — the four numbers

Unchanged from the old plan §5 (field accuracy, false-accept rate, yield, cost per page), now computed by
`doc:score` per **profile**, and in production from `document_read_reviews`. Merge rule: a step that
raises yield and moves false-accept off zero on any engine input does not merge.

**Cost, order of magnitude, to be replaced by Step 0.5/3.1's measurement.** A page at the 1568 px
working size is ≈ 2,500 input tokens. At today's list prices (Sonnet 5.5 $2/$10 per MTok, Haiku 5.5
$0.10/$0.50, Opus 5.5 $4/$20) a dual read of one page with ~2,000 output+thinking tokens on pass A is
roughly **$0.03 (Sonnet 5.5 pair) to $0.05 (Opus 5.5 pair)**; a two-page BOL under a dime even after a
region rung. Corpus re-scoring and the Samsara backfill run through the Batch API at half price; the
interactive prefill does not (latency). Prompt caching of the profile prompt + schema is enabled where the
prefix exceeds the model's minimum cacheable length — measured, not assumed.

---

## 9. Open questions — each with the default the code takes until answered

**Q-DR1 — Which model pair?** *Default:* the pinned pair until Step 3.1's table; then the owner picks.
*Recommendation:* the pair with zero engine-input false-accepts on the corpus, cheapest of those.

**Q-DR2 — ANSWERED 2026-10-08: yes, in `packages/hazmat-engine/src/bol/`.** The owner adds that the
rules should draw on the regulatory sources the engine already carries (the versioned HMT, appendix B,
the govinfo cross-check in `packages/hazmat-data`), so every `auditPrintedPaper` rule reads its
requirement from the dataset version on the run rather than restating it. *Original question:* May the printed-paper audit live in `packages/hazmat-engine/src/bol/`? It adds rules beside
`validateBol` and does not touch placard computation. *Recommendation:* yes — it is the only home the
gates allow (pure, versioned, no `@silvicom/*` imports), and putting it in the API would create a second
rules location. *Until answered:* Phase 4 waits; Phases 0–3 do not.

**Q-DR3 — ANSWERED 2026-10-08: drivers send through Samsara, SMS and email — all three are intake
(D-DR12).** *Original question:* Will drivers send every hazmat BOL as a Samsara *BOL, SECURMENT, PLACARDS* document? Owner
action, no code: it is the only path into which we can read today (F-DR6). *Recommendation:* yes, and
one document per load with "Load #" filled — Samsara's own form for the type has no Load # field, so
either add it there or the picker shows driver + truck + time only.

**Q-DR4 — Why is `loads.hazmat` false on all 303 loads?** (F-DR8.) *Until answered:* nothing keys on it;
the calculator prefill does not need a load.

**Q-DR5 — ANSWERED 2026-10-08: one dispatcher + the safety manager, as recommended.** *Original question:* Who labels the corpus? ~60 documents, ~5 minutes each, the hazmat section double-keyed:
roughly 6–8 person-hours. *Recommendation:* one dispatcher + the safety manager. Without labels there is
no number and §8 cannot run; no reading change merges before it.

**Q-DR6 — ANSWERED 2026-10-08: normalise every image before any reader (D-DR13); HEIC is decoded,
not refused.** *Original question:* HEIC. *Default:* refused with "export as JPEG". *Alternative:* convert in the browser
before upload. Decided by Step 1.3's spike on how often it occurs in the corpus.

**Q-DR7 — Should the calculator gain an RQ input?** The paper says "RQ"; the engine derives RQ from
quantity. *Default:* no — the audit compares what is printed with what the engine derives, which is the
more useful check.

**Q-DR8 — Graduation thresholds.** D-DR5's 300 / 600 are the owner's to change; they are contract
constants. *Default:* as written.

---

**Q-DR9 — Today drivers text BOLs to whose number?** If to dispatchers' own phones, those pictures can
never reach the system; the published number would be the Telnyx toll-free **+1 833 352 1766**. Its
toll-free verification (2026-09-30) was filed under use case *HR / Staffing* — inbound driver MMS is
probably covered (drivers message us), but before we text *replies* to drivers on it ("photo received",
"page 2 unreadable") the use case may need amending with Telnyx. *Default:* intake is receive-only; no
reply is sent until answered.

**Q-DR10 — Which mailbox?** *Recommendation:* a dedicated address (e.g. `documents@silvicominc.com`)
with a folder rule, read by the existing Entra app registration given access to that mailbox
(`Mail.ReadWrite`, same as EFS). Owner action in Microsoft 365, ~10 minutes; no code waits on it until
Step 3.6.

**Q-DR11 — ANSWERED 2026-10-09: read in sections, one strict request per section, in parallel.**
*Measured* (live, 2026-10-09, synthetic BOLs; API docs "Schema complexity limits": per request, combined
across every strict schema, 16 parameters with union types and 24 optional parameters, plus internal
grammar-size limits; "Changing the `output_config.format` parameter will invalidate any prompt cache"):

| Candidate | Live result |
|---|---|
| whole profile, every field nullable | 400 — "too many parameters with union types (37 … limit: 16)", on Sonnet 4.6, Sonnet 5.5, Haiku 5.5 |
| whole profile, every field optional | 400 — "too many optional parameters (37 … limit: 24)" |
| whole profile, 16 nullable + 21 optional | 400 — "The compiled grammar is too large" |
| whole profile, no nulls (`""` / `0` as "not printed") | compiles; the model wrote `pieces: 0`, `perPackageWeightLb: 0`, an empty bill-to — a printed zero and "not printed" become one value |
| **three sections in parallel** | accepted and schema-valid on Sonnet 4.6 (7.9 s wall, 8,840 input tokens) and Sonnet 5.5 (12.0 s, 11,677) |
| whole profile, no strict format, Zod on receipt | 10/10 schema-valid (5 per model); 1× input tokens (4,808 on Sonnet 5.5) |

*Why sections:* the no-null design loses "not printed", which D-DR4's *Not read* and §4.7 depend on;
10/10 well-formed answers without the grammar bounds the shape-failure rate only below ≈ 30 % (rule
of three), and each failure costs the dispatcher a retry. Sections remove that failure class; the price
is the page image sent once per section (the cache cannot be shared across different output schemas):
≈ 6,900 extra input tokens per page per pass A, ≈ $0.014 at §8's Sonnet 5.5 price — at most ≈ $29 a
month even if all 2,135 BOL-type photos of §0.1 were read. *Rule:* a profile declares its sections as
field groups (a section may split a top-level key); each section's schema is derived from the profile,
never restated; a CI test holds every section strictly under 16 unions (whether exactly 16 is accepted
is unverified). *Correction to the earlier text:* the hazmat group was already 15 (12 per line + 3
header), not "4 to spare". Revisitable in Step 3.1 on the labelled corpus — the adapter serves both.

**Q-DR12 — ANSWERED 2026-10-09: one append-only `document_page_classes` table for classifier verdicts
and overrides; newest row per page wins.** Stronger than the question first put it: D-DR9 makes the page
row exist before any read and the classifier (D-DR11) is itself a model read, so migration 0448's
`page_class` on the append-only `document_pages` could never receive the classifier's verdict either.
A review cannot hold it (`document_read_reviews.read_id` is NOT NULL; classification precedes any
read). The table follows the `asset_movements` / `part_movements` ledger pattern; the two unused
columns leave `document_pages` before 0448 reaches production.

**Q-DR13 — ANSWERED 2026-10-09: four additions to the `shipping_document` profile (version 1.1.0).**
Each is required by the current eCFR text (fetched 2026-10-09) for a paper rule to be checkable:

| Field | Requirement it makes checkable |
|---|---|
| `descriptionText` per hazmat line | §172.202(b): "must be shown in sequence with no additional information interspersed" |
| non-hazmat lines as a list (`otherLines`) | §172.201(a)(1) applies "When a hazardous material and a material not subject to the requirements of this subchapter are described on the same shipping paper"; measured: with no home for them, Sonnet 4.6 put a "Paper products" line into `hazmat.lines` |
| `hazmat.emergencyContactText` | §172.604(b): the registrant's name or contract number "immediately before, after, above, or below the emergency response telephone number" |
| `identity.printedPageNumbers` per image | §172.201(c): "each page is consecutively numbered and the first page bears a notation specifying the total number of pages" |

*Correction to the earlier recommendation* (three nullable fields): it would have put the hazmat group
at 18 unions. Lists are not unions, so the four fit three sections — identity + parties ≈ 14; freight +
references + execution + other lines + hazmat header ≈ 12; hazmat lines ≈ 13 (computed; the CI test of
Q-DR11 is the check).

**Q-DR14 — ANSWERED 2026-10-09: release the dataset carrying HMT column 8A, through `RELEASING.md`.**
*Measured:* 2026.08.0 is registered, triangulation "ALL CLEAN", provisional only because it is not
attested; versus the released 2026.07.1 only the 3,001 `pgRows` changed (columns 8A `exceptionsRef`,
8B `nonBulkPackagingRef`); every count and other table is identical. On release an authorised Limited
Quantity line leaves placarding and gets the LQ mark (`resolve.ts`), where today it is refused and stays
placarded; saved `hazmat_runs` keep their `dataset_version`. *Order:* (1) step 0's currency check — the
sources are eCFR 2026-07-28 and Title 49 was amended since; if Parts 172/173 data changed, a fresh cut;
(2) pin golden `_pkg-lq-refused-pre-8a.yaml` to 2026.07.1 (unpinned today, it fails on promotion);
(3) a named person attests — the owner's act, never automated. `paper_lq` answers
`requirement_not_in_dataset` until then. The §172.102 special-provisions parser stays its own item.

**Q-DR15 — ANSWERED 2026-10-09: paper-format rules are code rules, and each matches the regulation's
text.** Verified: the dataset carries no §172.604 / §172.204 / §172.201 data, and `referenceText.json` is
empty and display-only by D12 (it never feeds the engine). The first build of the rules diverged from
the text — the phone rule passed "CALL SHIPPER 800 555 1212" (digit count checked before letters), used a
10-digit proxy for "numeric … including the area code", ignored §172.604(d)'s exceptions and said
"24-hour" for "monitored at all times"; an unnumbered multi-page paper passed; PSN, class and PG were
cited one paragraph off; bulk quantity accepted only cargo tanks; §172.203(k)(2)'s exceptions and the
two-component rule were missing. Each is fixed test-first with the paragraph quoted before Step 4.1
merges.

**Q-DR16 — ANSWERED 2026-10-09: the audit's context comes from the caller, mapped as follows.**
Certification exemption (§172.204(b)(1): "(i) In a cargo tank supplied by the carrier, or (ii) By the
shipper as a private carrier except for a hazardous material that is to be reshipped or transferred",
"Except for a hazardous waste") from `hazmat_loads.carrier_relationship`: `carrier_supplied_cargo_tank`
→ exempt; `private_carrier` → cannot tell until "not reshipped, not waste" is confirmed (nothing records
either today); `shipper_supplied_common_carrier` → not exempt; `unknown` → cannot tell. The calculator
sends `unknown` today (`calcModel.ts`). Vessel leg from the calculator's `vesselLeg` (the saved-load
path sends none → cannot tell). Mixed paper from Q-DR13's non-hazmat lines; pages present from Q-DR13's
per-image page numbers (an image count alone supports only the weaker "count ≥ total").

---

## 10. Progress log

Append dated lines at the end; never edit a row above.

- **2026-10-08** — Owner asked for one reusable reading module, first consumer the Hazmat Calculator.
  Measured: one hazmat-only reader, never run (0 rows in production); no PDF path; no calculator prefill;
  the BOL audit reads resolved lines only; Samsara documents readable with the existing token; the call
  shape 400s on current models; Samsara holds 492 BOL-type submissions (2,135 photos) in the last 30
  days, mixed with placard and securement photos. Plan written: D-DR1–11, Phases 0–6, Q-DR1–10. Nothing built.
- **2026-10-08 (later)** — Owner ruled Q-DR2 (audit in `hazmat-engine/src/bol/`, reading its
  requirements from the regulatory dataset), Q-DR3 (Samsara, SMS and email are all intake → D-DR12,
  Steps 3.5–3.6), Q-DR5 (dispatcher + safety manager label), Q-DR6 (normalise everything before any
  reader → D-DR13). Q-DR9 (which number drivers text; Telnyx use case) and Q-DR10 (documents mailbox)
  opened as owner actions. Execution starts at Step 0.1.
- **2026-10-08 (Step 0.1 built)** — `samsara_documents` (0445) and its collector
  (`modules/samsara/samsaraDocumentsSync.ts`, tier every 15 min, job kind `sync_documents`, env in
  `apps/api/src/envDocumentReading.ts`). Watermark = newest stored `samsara_updated_at` less one hour,
  walked oldest day first; photo ids kept, vendor urls never stored; `Load #` read by exact label.
  Live read-only run over the last two days: 373 documents fetched, 0 refused, 164 photos, 328
  carrying a load number (35 BOL-type, 10 delivery copies, 328 call forms). Not yet wired into
  `samsaraFeedHealth` (its alarm would mail on a new feed before anyone has ruled its freshness bound).
- **2026-10-08 (Step 0.2 tool)** — `pnpm --filter @silvicom/api doc:corpus -- --since … --until …
  [--types …] [--max N]` copies Samsara documents into the gitignored
  `packages/capture-engine/fixtures/real/private/documents/<id>/` (`pages/`, `meta.json` with each
  page's SHA-256, an all-null `labels.json` for the two labellers). Read-only; writes no database.
  First live pull, 3 documents (2 BOL-type, 1 delivery copy), measured three things the plan must
  carry. **F-DR11 — Samsara serves every page as a 2000×1500 JPEG of 150–810 KB**: for a
  Samsara-sourced document "the original" (D-DR13, recovery rung L1) is already Samsara's recompressed
  derivative, so the ladder's headroom on these is 2000 px, not a phone's 4000+. **D-DR11 confirmed on
  the first document:** 9 photos, page 1 a cargo photo of the trailer, the BOL on a later page.
  **The first BOL read by eye is the paper audit's case:** the HM column is marked "X" on two lines of
  lead-acid batteries (corrosive placards visible in the cargo photo) and the description is the
  shipper's model text only — no UN number, proper shipping name, class or emergency phone. Under
  §5.1 that is `paper_sequence` and `paper_er_phone` failing, and under §6 an unresolved line the
  dispatcher must pick with the printed text beside the picker: both paths are needed from day one,
  not as edge cases.

- **2026-10-09 (Step 1.1)** — The three contracts are in `packages/shared/src/`:
  `shippingDocumentContract.ts` (the profile document; every field null by default, so `parse({})` is
  the empty document and the corpus skeleton derives from it; `ENGINE_INPUT_LINE_KEYS`,
  `shippingFieldCriticality` and `GRADUATION_MIN_CONFIRMATIONS` hold D-DR5's two bars, which are the
  owner's under Q-DR8), `fieldEvidenceContract.ts` (one path grammar, `hazmat.lines[2].quantity.value`,
  shared by evidence, reviews, labels and counters; `leafFieldPaths` derives the set to score), and
  `documentReadingContract.ts` (route schemas, the profile registry, closed vocabularies with the
  migration's CHECKs to mirror, typed read failures and intake refusals each with their sentence, and
  the labels schema). `BolFields` is now a projection (`bolFieldsFromShippingDocument`); its line schema
  is the shared one, and the hazmat path's tests are unchanged and green. Two choices the plan did not
  fix: page quality bands are `good / fair / poor` (definitions on `PAGE_QUALITY_BANDS`), and
  `freight.seal` became `seals[]` because a trailer often carries more than one. The 51 unlabelled corpus
  skeletons were rewritten to the contract (none had labelling work yet) and all 51 validate.
- **2026-10-09 (Step 0.4)** — `pnpm --filter @silvicom/api doc:score -- --run <name>` scores a recorded
  run (`<id>/runs/<name>.json`: document, evidence, cost) against every labelled corpus document. The
  arithmetic is pure in `packages/shared/src/documentScoring.ts`: accuracy, false-accept (status `read`
  and wrong, over `read`), yield and cost per page, per field (line indexes collapsed) and per band (a
  document's worst `bol`/`delivery_copy` page), with counts beside every number and D-DR5's 3/N bar per
  field. Equality is defined once in `documentFieldMatch.ts` — whitespace-collapsed, case-sensitive,
  numbers exact, lists as multisets, no fuzzy matching. Hazmat lines align by id digits with a PSN
  tie-break (F-EX6), never by index; a missed line is wrong, a `read` field on an extra line is a false
  accept. Unlabelled documents are skipped and counted; invalid labels or run files are reported by id.
  The reader is injected (`DocumentReader`); only the recorded reader exists until Step 0.5. Open before
  the baseline: whether a typed read failure scores as all-not-read (recommended yes, once Step 1.4's
  failures are written to the run file), and an accuracy column over labelled values only, since
  agreement on blanks inflates today's (`labelPresent` shows how much).
- **2026-10-09 (Step 1.4)** — `apps/api/src/modules/document-reading/model/readPages.ts` sends the page
  images with `output_config.format` = a JSON schema generated from the profile's Zod schema; a pure
  transform (`wireSchema.ts`) drops only `$schema` and Zod's safe-integer bounds and refuses any other
  unsupported keyword. No sampling or thinking parameters. Refusal, `max_tokens` and schema failures are
  typed results carrying usage; 429, 5xx, 529 and timeouts rethrow as `TransientModelError` for the
  queue; 400/401/404 pass through. `max_tokens` 16,000: a 12-line worst case, 8,509 chars ÷ 2.5 per
  token × 2 headroom + 8,000 thinking allowance, under the SDK's non-streaming ceiling. Models from
  `DOC_READ_MODEL_A/_B`, falling back to the hazmat pins (defaults unchanged). SDK 0.107.0, no upgrade.
  42 tests, 15 mutants killed. **The live call found Q-DR11**: the full profile schema is refused (37
  unions, limit 16); per-section reads of a synthetic BOL all succeeded.
- **2026-10-09 (Step 1.2)** — Migration 0448 adds `document_sources`, `document_pages`,
  `document_reads`, `document_read_reviews` and the private `document-intake` bucket (25 MB =
  `INTAKE_LIMITS.maxBytes`). RLS on, no client policies. Sources, pages and reviews are append-only by
  trigger, for the service role too; only a source's `matched_driver_id` may move (roster merge and its
  set-null, listed in `DRIVER_REASSIGNMENTS`). A read is inserted `queued` and moved only by
  `document_read_transition` (queued→reading→done|failed; failed carries a `READ_FAILURES` code;
  terminal is terminal; reading→reading is a no-op so a queue retry can re-claim). Dedupe is
  `unique (org_id, sha256)`. `document_pages.normaliser_version` added beyond §2's table because the
  §4.6 cache key needs it. The `document-reader-tables` matrix (59 checks) reads every CHECK back from
  the catalog and holds it equal to its contract array; five mutants killed. Sources and reviews are in
  `RETENTION_FORBIDDEN`; ARCHITECTURE.md has the `document-reading` row. Opened Q-DR12 (page-class
  override).
- **2026-10-09 (rulings)** — Owner asked for recommendations from research, not assumption; measured
  and ruled Q-DR11–Q-DR16 and the two `doc:score` choices. Evidence: live API calls (six schema
  designs), the API's documented limits, the eCFR as of 2026-10-07 (§§171.4, 172.201–.204, 172.604), the
  dataset files and `RELEASING.md`, and the code. Three earlier recommendations changed: Q-DR12 (the
  classifier's verdict needs the same home as an override), Q-DR13 (four fields, lists where possible,
  after the union arithmetic showed the first proposal broke Q-DR11), and `doc:score`'s blank fields.
  `doc:score`: a reader-caused failure scores every field not read (the old plan's yield is "fraction of
  fields accepted without a human"); budget and integrity failures are excluded and counted apart;
  beside today's accuracy, printed-value accuracy and an invented-value rate (measured once already:
  Sonnet 4.6 invented `freight.pieces` = 31). Step 4.1 is held until its rules match the regulation.
- **2026-10-09 (Step 1.3)** — `modules/document-reading/pages/normaliseSource` sniffs magic bytes (the
  declared mime is recorded, never trusted) and emits D-DR13 canonical pages: EXIF orientation applied
  and stripped, 8-bit sRGB, alpha flattened on white, a lossless PNG original with its sha256, and a
  lossless-WebP working copy ≤ 1568 px, never enlarged — lossless because at 1568 px a BOL's 7-pt type
  is 8–10 px tall and lossy compression damages exactly those strokes. Rasteriser as §3 recommended:
  pdf.js 6.2.108 (Apache-2.0) on @napi-rs/canvas 1.0.8 (MIT), 300 DPI (capped at a 6,000 px long edge,
  DPI recorded), pdf.js standard fonts, no system fonts; an owner-password-only PDF renders, a
  user-password one is `encrypted_pdf`. Text layer: words boxed as page fractions, apportioned along
  pdf.js runs by the fonts' glyph widths (≤ 0.1 em on fixtures). HEIC via heic-decode/libheif; the
  iPhone's own colour profile is ignored (a slight colour shift, characters unaffected).
  `NORMALISER_VERSION` 1.0.0. 12 synthetic fixtures, 42 tests (byte-identical over two runs, upright,
  sRGB, words at pdfkit's coordinates, every refusal code at both boundaries); 12 of 13 mutants killed —
  the survivor, removing `toColourspace("srgb")`, is a no-op on sharp 0.35, kept to pin intent.
  **Done-when not yet met:** "green on the Railway staging image" is unverified; the new native binary
  is `@napi-rs/canvas-linux-x64-gnu` (Nixpacks, glibc), and pdf.js reads `standard_fonts/` from
  `node_modules` at run time. Nothing imports the stage at startup, so the check is a one-off import and
  render on the staging service after merge.
