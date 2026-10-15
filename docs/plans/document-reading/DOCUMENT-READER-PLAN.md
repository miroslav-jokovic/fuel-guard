# Document reader — one reusable module that reads BOLs (and later every paper we receive) and prefills the form a person would have typed · 2026-10-08

**Status:** IN EXECUTION — Phase 1 built (§10); the order from 2026-10-10 is §7A · **Supersedes:** the *phases* (§7) of
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
| JPEG / PNG / WebP | EXIF-rotate; original kept byte-exact; working copy ≤ 1568 px long edge | decode fails; long edge < 800 px (the live resolution floor — measured 2026-10-13, progress log) |
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

## 7A. Two layers, and a BOL is the photos a driver sent — the execution order from 2026-10-10

**The owner's flow, 2026-10-10 (four statements in one conversation, condensed):**

> On the Placard calculator: upload the BOL — single or multi-page — by drag and drop, from the device,
> the gallery or files. Our reader reads it, verifies the shipper wrote it correctly and with everything
> the rules require, explains what is missing, and prefills the form; we press Calculate Placard and get
> the placards. Drivers send BOLs as photos to Samsara or by SMS to a dispatcher, so there is no
> multi-page PDF — there are several images of one BOL. So: a first layer that organises and optimises
> the images so they are readable, then a second layer that reads, to lower any chance of a mistake.

That flow is §6 unchanged in its last three steps (audit → prefill → Calculate). It changes what comes
before them, and it reorders §7. What it changes, each forced by a measured fact:

- **The unit of reading is not a file.** §0.1 measured 4.3 photos per Samsara *BOL…* submission, mixed
  with cargo, placard and securement photos (F-DR11: every one a 2000×1500 JPEG). An upload of three
  phone photos of a two-page BOL plus a retake is the same shape. `document_sources` today is one file
  (`unique (org_id, sha256)`, NOT NULL `page_count`), and a read names one source — so page 2 of a
  photographed BOL would be read as its own document and fail the audit for what is on page 1.
- **Preparing the image is a layer of its own, with its own measurements**, not the normaliser's side
  effect. §7A.1's research says which preparations lower the error rate and which raise it.

### 7A.1 What the research says (sources current to 2026-10-10)

| # | Finding | Source | What it does to this plan |
|---|---|---|---|
| R1 | Claude's vision input has two resolution tiers: **standard** (≤ 1,568 px long edge AND ≤ 1,568 visual tokens, one token per 28×28 patch) and **high-resolution** for Claude 4.7 and later (≤ 2,576 px AND ≤ 4,784 tokens). Above either limit the API downsizes the image itself. | Anthropic, *Vision* and *Coordinates* docs | **Measured on our sizes with Anthropic's reference resize:** our working copy (long edge capped at 1,568, no token check) of a letter page is 1212×1568 = 2,464 tokens, so the pinned Sonnet 4.6 *re-resizes it to 952×1232* — 7-pt type at about 6 px, after a second resample we do not control. A high-resolution-tier model would take the 300 DPI page at 1688×2184, and a Samsara photo untouched at 2000×1500 (3,888 tokens; we currently shrink it to 1568×1176). The single cheapest accuracy lever in this plan → D-DR16, Q-DR20. |
| R2 | Put images before the text; introduce each image with a short label (`Image 1:` …) when sending several. Oversized images can be made an error instead of a silent resize (`transformations.oversized_image: "error"`). | Anthropic, *Vision* / *Coordinates* | `buildReadRequest` sends images first (good) but without per-image labels. Add `Page n of m:` before each image; mark every page `oversized_image: "error"` so a tier change can never silently shrink pages again. |
| R3 | Lossy compression, especially repeated passes, damages text for the model. | Anthropic, *Vision* | Already held (lossless WebP working copy, D-DR13). A Samsara JPEG is already one lossy generation; we must never add a second. |
| R4 | The largest VLM accuracy losses come from **resampling and geometric distortion** (up to 34 pp, upsampling among the worst); low-severity spatial changes hurt more than visually severe photometric ones. | VLM-RobustBench, ICML 2026 (arXiv 2603.06148) | Never upscale. Each prepared page is made with **one** resample from the original (rotation + crop + perspective + size composed into a single warp), not a chain. Brightness/contrast fixes are the lowest priority. |
| R5 | Perspective warp is the degradation that most reduces LVLM OCR; mild blur and noise are tolerated. | *Quantifying the Effects of Image Degradation on LVLM Benchmark*, SciTePress 2025 | Rectification (find the paper, flatten the angle) is the highest-value preparation for phone photos. |
| R6 | Under visual corruption, tables and structured content keep less accuracy than plain text (worst-case retention 0.826 → 0.676); pixelation, glass blur, elastic and motion blur do the most damage. | OCR-Robust, June 2026 (arXiv 2606.26041) | A BOL is a table, so it is on the weak side. The quality gate must catch motion blur specifically. |
| R7 | On 20 controlled document degradations, extraction lost most to dithering (21 %) and fax/letterpress (14 %); a rotated scan cost 8 %, heavy JPEG 2 %. Text + image together is the strongest input for accuracy *and* confidence. Model self-confidence: Opus 4.6 near-calibrated, Sonnet 4.5 / Haiku 4.5 progressively overconfident; "treating high confidence as a replacement for review will silently pass through the errors the model is most certain about". | ConfBench, Aug 2026 (arXiv 2608.01792) | Rotation must be fixed (8 % is not noise). The office scans are fax-class (the ten CCITT G4 PDFs), so expect them to be our hardest case. A text layer (D-DR3) or device word boxes beside the image are a second input, not decoration. **The model's own confidence never decides Read vs Check** → D-DR17. |
| R8 | Binarisation and hard thresholding were built for classic OCR engines; neural readers were trained on anti-aliased text and can get worse on binary images, while reporting high confidence. | Practitioner guidance (TheNeuralBase); classical-OCR studies (MDPI 2023) show the opposite for Tesseract | No binarisation or sharpening in the view the model reads. A contrast view may exist only as a second, independently read view whose value counts only when it agrees (already §7 Phase 5.4). |
| R9 | Generic image-quality scores do not predict OCR outcome; quality has to be scored against reading success. A learned blur gate (MobileNetV3 + a Laplacian-magnitude channel) reaches F1 0.98 at ~7 ms on one CPU core and answers sharp / blurred / **uncertain**. | Frontiers in Signal Processing 2026; arXiv 2606.25838 | The gate is three-way and its thresholds come from our corpus' reading outcomes, not from a generic sharpness number → D-DR18. Our `@silvicom/capture-engine` metrics (focus, glare, text coverage) are the start; a learned gate is a later, measured option. |
| R10 | Neural dewarping (UVDoc, DocTr++, DocRes, DvD 2025 — up to 151 M parameters) leads the curled-page benchmarks, but numbers differ by benchmark and paper. Classical quad detection + homography (OpenCV `findContours` → 4-point polygon → `warpPerspective`) runs in Node via WASM (opencv.js; `scanic` is Rust-WASM, Node-capable). The classical method's known failure is picking the wrong quad. | DvD (SIGGRAPH Asia 2025), D2Dewarp (arXiv 2507.08492), DocRes (CVPR 2024); OpenCV / scanic docs | A BOL is flat paper on a clipboard or dash: classical rectification first, neural dewarping only as a measured later rung. **No confident quad → no crop** (Anthropic: avoid cropping out context). |
| R11 | Restoration models cut classical-OCR character error 64–70 % on historical pages — but generative restoration and upscaling *invent* strokes. | PreP-OCR (arXiv 2505.20429) | Generative restoration, AI upscaling and denoising never feed a field value. |

### 7A.2 Decisions

**D-DR14 — A document is an ordered ASSEMBLY of pages; a file stays a source.** Intake keeps one
file = one `document_sources` row (per-file dedupe stays exact; a Samsara submission's photos become
one source each, `origin_ref` = `<document id>/<photo id>`). A new append-only pair,
`document_assemblies` + `document_assembly_pages (assembly_id, position, page_id)`, records "these
pages, in this order, are one BOL". Layer 1 proposes the assembly; the dispatcher may untick, reorder
or add a page from another submission, and every edit is a **new** assembly naming the one it replaces
(nothing is updated). A read names an assembly. *Rejected:* (a) a multi-file source — it breaks
per-file dedupe and the append-only `page_count`, and one photo could not belong to two submissions;
(b) grouping by arrival time alone — retakes and two loads sent minutes apart make it guess.
Resolves D-DR9's open "one source per document or per photo": **per photo**, grouped by assembly.

**D-DR15 — Layer 1 (PREPARE) changes geometry, not meaning.** In the view the model reads: orientation,
crop to the paper, perspective flattening, size — composed into one warp from the original (R4).
Never: binarisation, sharpening, generative restoration, upscaling (R8, R11). A photometric view
(contrast, shadow removal) is allowed only as a second view whose reading counts when it agrees with
the first. Every step records what it did (`prepare` block on the page: rotation, quad, warp, scale)
so a reviewer can see it and the original is always one click away.

**D-DR16 — The working copy is sized to the model's resolution tier, and the API never resizes it.**
`workingSizeOf` becomes Anthropic's reference `resizedSize(width, height, maxEdge, maxTokens)` for the
tier of the model on the read (1568/1568 or 2576/4784); every image block carries
`oversized_image: "error"`; the tier is part of the cache key (it changes what the model saw).
Supersedes the 1,568 px constant (`WORKING_LONG_EDGE_PX`).

**D-DR17 — The model's own confidence never makes a field Read.** *Read* needs independent agreement
(second read, text layer, arithmetic, an exact HMT resolve) and every applicable rule passing; model
self-reports may only push a field *down* to *Check* (R7).

**D-DR18 — The quality gate answers pass / retake / uncertain, from reading outcomes.** *Retake* names
the page and what is wrong ("page 2 is blurred — ask the driver to retake it"); *uncertain* reads and
shows the page as *Check*; the thresholds are fitted on the labelled corpus against field accuracy and
stated with their counts, never borrowed from a generic sharpness scale (R9).

### 7A.3 Layer 1 — PREPARE, stage by stage

| Stage | Does | How (first version) | Done when (on the labelled corpus) |
|---|---|---|---|
| P1 Normalise | any format → canonical page, original kept | built (D-DR13, normaliser 1.1.0) | — |
| P2 Classify + orient | `bol / delivery_copy / placard / securement / other` and rotation 0/90/180/270, one cheap-model call per page (Q-DR19 (a)) | Step 1.5 widened | no corpus `bol` page classed `other`; every page upright after P2 |
| P3 Rectify | find the paper's four corners, flatten perspective, crop | classical quad + homography in WASM (spike: opencv.js vs scanic); no confident quad → no crop | field accuracy on photographed pages ≥ unrectified, false-accept not raised |
| P4 Size | one resample to the tier's exact size (D-DR16) | composed with P3's warp | no request ever resized server-side (`oversized_image: "error"` never fires in a week of staging) |
| P5 Quality gate | pass / retake / uncertain per page (D-DR18) | capture-engine focus, glare, text coverage on the prepared page | thresholds fitted and stated with counts |
| P6 Duplicates | ~~retakes of the same page: keep the sharpest, keep the others attached~~ **WITHDRAWN 2026-10-13 (D-DR23)** | ~~perceptual hash + P5 score~~ measured unsafe: every close pair in the corpus is a different page | — |
| P7 Assemble | order `bol` pages by printed "Page n of m", then capture order; missing page → `paper_page_complete` finding (**the finding is built** — N6 part 3 plus the marker comparison of D-DR23; the ordering waits, D-DR23) | reads `identity.printedPageNumbers` from a first pass, or the classifier | dispatcher reorders in < 5 % of assemblies |

Layer 2 (READ) is §7's reader with D-DR16's sizing, R2's page labels and Phase 2's second read.

### 7A.4 The execution order from here (replaces §7's order; step ids kept for history)

1. **N1 — Assemblies (D-DR14).** Migration: `document_assemblies`, `document_assembly_pages`, RLS,
   append-only triggers, `RETENTION_FORBIDDEN`; matrix. Then (a later merge, column before reader)
   `document_reads.assembly_id`, and the routes: several files → several sources → one assembly.
2. **N2 — The upload on the calculator.** Multi-file drag-and-drop / device / gallery / files on
   `/hazmat/calculator`, thumbnails to untick and reorder (Step 3.4's first half).
3. **N3 — Layer 1 P2 + P4 + R2** (classify + orient, tier sizing, page labels) — no new dependency.
4. **N4 — Layer 1 P3 + P5 + P6 + P7** (rectify after its spike, gate, duplicates, assembly order). **2026-10-13: P6 withdrawn and P7 reduced to the missing-page finding (D-DR23); P3 and P5 wait on A6's labels — each one's "done when" is a field-accuracy number on the labelled corpus — and P3 also on Q-DR21's library install.**
5. **N5 — Second read + cross-check (Phase 2.1, 2.2)** — the minimum before *Read* means anything.
6. **N6 — Audit wiring + `bolPrefill.ts` (Step 3.3) + Calculate** — the flow end to end.
7. **N7 — Samsara intake (3.2)**: a submission's photos → sources → a proposed assembly. ⚠ Measured 2026-10-13 (D-DR23): ONE submission can carry SEVERAL BOLs — 54289776 holds four different BOLs (six pages) plus a cargo photo, 55837258 three single-page BOLs — so "one submission = one assembly" is wrong; see Q-DR25. Then SMS (3.5)
   once Q-DR9 is answered.
8. **N8 — Labels + model choice (0.3, 0.5, 3.1)** — runs alongside from N3; every Layer 1 stage ships
   its before/after on the corpus (§8), and a stage that does not lower the error rate is removed.

### 7A.5 Open questions this adds

**Q-DR20 — Move reading to a high-resolution-tier model?** (R1.) The pinned pair (Sonnet 4.6 +
Haiku 4.5) is standard tier, so every page is read at ≤ 1,568 tokens (952×1232 for a letter page). A
4.7-or-later pair sees 1688×2184 — about 3× the pixels — at about 3× the image tokens per page.
*Default until answered:* the pinned pair, with D-DR16 sizing pages exactly to its tier so the API no
longer resizes them. *Recommendation:* add a high-resolution pair to Step 3.1's scoring and decide on
the four numbers; R1 is the strongest single reason to expect it to win on poor photos.

**Q-DR21 — Which rectification library?** opencv.js (WASM, large, the reference algorithm), `scanic`
(Rust-WASM, small, young), or our own quad search over sharp. *Recommendation:* a one-day spike on the
corpus' photographed pages, choosing on the wrong-quad rate first and size second.

---

## 7B. Precision by agreement — the system checks the model (owner, 2026-10-11)

The owner's instruction: *"we should not rely on the model to do all the work … make this as close to 100 %
precision as we can"*. This section is how. It does not replace §4 or Phase 2; it orders them, names the
independent witnesses, and states what each one has been measured to catch.

### 7B.1 What the research says (sources current to 2026-10-11)

| # | Finding | Source | What we take from it |
|---|---|---|---|
| P1 | On **real regulated documents scored per field** (RealDocBench, 581 docs incl. bills of lading), open-source OCR models score far below a frontier VLM: Chandra-2 86.2 %, olmOCR-2 79.5 %, Docling 71.2 %, dots.ocr 70.6 %, PaddleOCR-VL 59.6 %; Claude Opus 4.8 93.0 %. The best system overall reached 96 % — nothing reaches 100 % alone. | RealDocBench, arXiv 2606.07401 (Jun 2026) | Swapping the model for an open-source OCR model would LOWER field precision. No single reader is the answer. |
| P2 | The leaderboards that put small OCR models first (OmniDocBench v1.6: TeleOCR 96.9, PaddleOCR-VL-1.6 96.3, MinerU2.5-Pro 95.8, GLM-OCR 95.2) score academic pages by text similarity, and say so; PaddleOCR-VL needs a GPU (vLLM unsupported on CPU). | Docsumo / Roboflow summaries (Sep–Oct 2026); PaddleOCR-VL-1.6 docs | A high OmniDocBench score is not a BOL field score; a GPU service is a new host we do not run. |
| P3 | A **confidence engine that fuses cross-call disagreement + OCR value-region confidence + image quality + layout** reaches 99.1 % accuracy on the 80 % of fields it accepts (DocILE invoices); OCR value-region confidence is its single most important feature, and two different calls disagreeing is the largest single gain — 18 pp above self-consistency. | ExtractConf, arXiv 2606.24420 (2026) | The route to ~100 % on what is ACCEPTED is independent witnesses + routing the rest to a person — exactly D-DR17. |
| P4 | In OCR→LLM pipelines the OCR step, not the LLM, is the accuracy ceiling (84–85 % across LLMs); errors are 0/O-type character confusions on identifiers. | arXiv 2509.04469 | OCR is a WITNESS for identifiers, never the only reader. |
| P5 | PP-OCRv5 (Apache-2.0) runs on CPU through ONNX Runtime in Node (`@gutenye/ocr-node`, `ppu-paddle-ocr`); text lines + boxes + per-line confidence; server models ~85 MB, `onnxruntime-node` ~258 MB native. | gutenye/ocr, ppu-paddle-ocr (2026) | A character-level witness can run inside our worker with no GPU and no new service — at an image-size cost (Q-DR22). |

### 7B.2 Measured on our own papers (2026-10-11, the ten office BOLs, 17 hazmat lines, three readers)

Not yet against labels (Step 0.3); judged against the paper by eye where readers disagreed.

| Check | Catches | Measured |
|---|---|---|
| **HMT consistency** — the line's UN/NA id must be `UN|NA` + 4 digits, exist in the HMT (`@silvicom/hazmat-data`, 2,479 entries), and carry the read class and PG on the same row | an id that is not an id; a class/PG that does not belong to the id | Haiku 5.5 wrote the shipper's product codes (5607540…) as the UN number on all 5 lines of 0135071 → **5 of 5 flagged**; Sonnet 4.6 and 5.5: 0 flagged, 0 wrong |
| **Two readers must agree** | a plausible wrong value the table cannot see | Sonnet 4.6 read **9 drums where the paper says 6** (0132900) and **3,808 lb where it says 3,806** (0135071); Haiku 5.5 and Sonnet 5.5 read 6 and 3,806 → both caught as disagreements. BOL number disagreed on 4 of 10 papers (several numbers printed) → all four would be *Check*. |

So with today's readers, every wrong value we saw would have been stopped by one of the two checks, and no
check flagged a correct value. Ten papers prove the mechanism, not the rate; the rate is §8's, on labels.

### 7B.3 Decisions

**D-DR19 — A field is *Read* only when independent witnesses agree; the model is one witness.** The
witnesses, in the order they are built: (1) the HMT and the profile's format rules (deterministic);
(2) a second model read by a different model (Phase 2.1/2.2); (3) the born-digital text layer where it
exists (D-DR3, 2.7); (4) a character-level OCR witness over the field's region (Q-DR22); (5) the order
(McLeod) and arithmetic readers (§4.4–4.5). Any disagreement, or a critical field with fewer than two
agreeing witnesses, is *Check* — shown, never silently accepted. Critical fields are the ones the
placard depends on: UN/NA id, hazard class, PG, gross weight, package count, RQ/marine-pollutant marks.

**D-DR20 — The reading model is locked to Sonnet 4.6 (owner, 2026-10-11: "if Sonnet 4.6 is more precise
we will lock it").** Against Haiku 5.5 on 7B.2 it is: 0 vs 5 wrong UN ids. `DOC_READ_MODEL_A` gets its own
default `claude-sonnet-4-6`, no longer falling through `HAZMAT_MODEL_A`, so a hazmat-pin change cannot move
the reader. Haiku 5.5 stays the page classifier (P2, 24/24). Sonnet 5.5 made no error on 7B.2 and is the
recommended second reader (Q-DR23), not a replacement for the lock.

**D-DR21 — No open-source OCR model replaces the reader** (P1, P2). Open-source OCR enters only as a witness
(P3–P5), and only after it is measured to add agreement the second model read does not.

**D-DR22 — The paper audit judges a field when two independent witnesses agree on it (2026-10-12, N6 part 3).**
The audit (§5.1) answers `cannot_tell` on any field that is not *Read*, and under the acceptance rule no field
is *Read* until graduation (D-DR5, off) — so fed the evidence's statuses, every finding would be "can't check
yet" and the audit could say nothing until a person retyped the paper. D-DR19 already names the bar for
trusting a value: independent witnesses agree. So FOR THE AUDIT ONLY, a field counts as confirmed when both
model readers read the same value (both reading nothing included — that is how a missing packing group or
phone number is ever found) and the OCR, where it judged the field, did not find another; anything else keeps
its status and the rule says what to confirm. The form's field states are unchanged, and every finding quotes
the printed value it rests on. *Rejected:* auditing on pass A alone (one model's word, D-DR17); waiting for
graduation (no audit at all for months).

**D-DR23 — A retake is not removed before the read; a page's identity is its printed marker, never its picture
(2026-10-13, N4).** Measured on the 196 real Samsara photos (61 submissions) and the office BOLs:

- **A perceptual hash cannot tell a retake from the next page.** dHash at 8×8, 16×16 and 32×32: the closest pairs in
  the whole corpus (16×16 distance 7.8–11.3 of 256) are 54289776's photos 2–7 — six DIFFERENT pages, four
  consignees, "page 1 of 2" / "2 of 2", different hazmat lines — and then 55837258's three different BOLs on one
  form and 59826918's pages 1, 2 and 3 of one BOL. Not one close pair of BOL pages was a retake; the corpus holds
  no true retake at all. Dropping "the less sharp of two look-alikes" would have dropped real pages with real
  hazmat lines — an under-placarding error, the one direction this module must never err in.
- **The BOL number is not a safe key either.** The page classifier (Haiku 5.5), asked per page for the BOL number
  and "page n of m": the marker was right on all 18 pages (including 59826918, photographed 3, 2, 1), but the
  number dropped a digit twice (0357744003883236 for 03577744003883236), carried a stray space once, and is
  absent on forms with no labelled box (55837258's "Shipper No.").
- **The readers already cope with a retake.** Three office BOLs read alone and read with a simulated retake (the
  page turned 3°, 85 % scale, darker, JPEG q70) by both readers: the hazmat lines were identical — **0 duplicated
  lines in 6 reads** — and each reader recorded the retake's own marker (["Page 1/2", "Page 1/2"]), which is what
  `paper_page_complete` needs to say "page 2 is missing".

So: no stage removes or reorders pages on its own. A retake costs one page of tokens and nothing else; a missing
page is named by the paper audit from the readers' per-image markers. One gap was found and closed here: the
audit compared those markers as TEXT, so "1/2" (Sonnet 4.6) against "Page 1/2" (Sonnet 5.5) was a disagreement —
on 0135071, the one two-page office BOL, the page rule answered "confirm it first". The audit now compares each
image's parsed page and total (`parsePageMarker`, the rule's own parse). *Rejected:* perceptual-hash dedupe
(above); dedupe by the classifier's BOL number (digit errors); a "possible retake" note on screen (no retake in
the corpus to fit it on, and a wrong note trains people to ignore notes). Ordering by printed page waits until a
labelled assembly shows the readers do worse on out-of-order pages — 59826918's reverse order is the case to try.

**D-DR24 — A review is recorded on every Calculate; a disputed field needs an explicit act first; graduation
counts only explicit reviews (owner, 2026-10-14, option (a)).** Found by an external audit (Codex/Sol 5.6, 2026-10-14)
and confirmed in code: step 3.4's "review batch on Calculate" was never built — `calculate()` posted the form, and
nothing in `apps/web` called `POST /reads/:id/reviews`, so no review had ever been recorded (0 rows in production),
and a count or weight the two readers disputed went to the calculator as pass A's value behind a warning sentence.
Now: (1) **Calculate is disabled while a safety-critical field is disputed** — the readers disagree, only one
reader read it, the row witness looked and did not find it, or the adapter gave a reason — until the dispatcher
says it matches the page, picks one reading (a count or weight), or changes it. A filled line with no product stops
it too, because `buildEngineLines` drops such a line from the calculation unseen. (2) **Every Calculate posts one
review batch** of the printed fields the form carries as printed — product id, name, class and packing group, the
count, the gross weight in pounds — `confirmed` when the value sent is what pass A wrote, `corrected` otherwise. The
package type and Limited Quantity are gated but not recorded: the form holds the calculator's reading of the
printed phrase ("drum", a tick), and writing it against the path holding "20 STEEL DRUMS" would record a correction
the reader never needed. A deleted line is not recorded either; A6 measures invented lines. (3) **Each row says
whether it was explicit** (0472 `explicit`): a tick, a pick or a change is explicit; a prefilled value left
untouched is not. An "unreadable" button was left out: an illegible field still needs a value to calculate,
which the dispatcher types, and that is a correction. D-DR5's graduation counts explicit rows only, so a click-through cannot
graduate a field. *Rejected:* (b) a tick on every field before Calculate — cleaner labels, but 10–20 clicks on a
plain BOL and the same rubber stamp one level down; (c) plan §6 as written, untouched = confirmed — graduation
would learn from click-throughs. The audit's arithmetic stands and is recorded for Q-DR8: zero errors in N
confirmations bounds the false-accept rate at ≈ 3/N (95 %), so 600 → 0.5 %; a 99.9 % claim needs ≈ 3,000 per field
and risk segment, and repeats of one shipper's form are not independent.

**Q-DR25 — How does a Samsara submission become documents, when one submission can carry several BOLs?** (Found
2026-10-13, D-DR23.) *Candidates:* (a) every `bol` page of a submission in one assembly — for placarding the whole
load aboard is what counts, so the sum is the right input, but the paper audit then judges four BOLs as one paper
(its page-count rule would see "1 of 2", "2 of 2", "1 of 2", "1 of 1"); (b) split by the classifier's marker and
a digits-only BOL number within an edit distance of 2, a person confirming each split; (c) one assembly per
submission for the calculator, and per-BOL assemblies only for the audit. *Default until answered:* N7 is not
built. *Recommendation:* (c) — the calculator's question is "what is aboard", the audit's is "is this paper
right", and each gets the grouping its question needs; decide when N7 starts.

**Q-DR26 — What may the freight-total arithmetic compare, when a paper's printed total includes the pallets?** (Found 2026-10-15, measuring the external audit's third item before building it.) Live reads of the ten office BOLs (Sonnet 4.6 + Sonnet 5.5, profile 1.2.0): **`perPackageWeightLb` was null on all 26 lines in all 20 reads**, so count × per-package weight would never run on this set. The sum of line weights matches `freight.weight` exactly on 5 of the 6 papers with no non-hazmat line. The sixth, 0134831, is correct on paper and would be flagged: it prints WEIGHT 36,446.7 (the two lines) and PALLET WEIGHT 760.00 for 20 pallets, and TOTAL WEIGHT 37,206.7 is their sum. Both readers rightly read the total, and the profile has no field for pallet or dunnage weight. 0136043 prints NET, TARE and GROSS the same way. Mixed papers (0132900, 0135071, 0134527 under one reader) cannot be summed at all: `otherLines` holds descriptions, not weights. So 0135071's 3,808-vs-3,806 lb, the one true misread on the set, is out of the sum check's reach either way. *Candidates:* (a) add `freight.tareWeight` (pallet/dunnage/tare as printed) and `freight.goodsWeight` (the goods subtotal where printed) to the profile (a version bump, re-measured on the ten), then compare the line sum with the goods subtotal, or with the total minus tare, and only when both readers agree on every input and no non-hazmat line exists; (b) flag only when the line sum EXCEEDS the printed total, which tare can never explain (no false flag on this set, but catches only over-reads); (c) do not build the freight check, and leave arithmetic to count × per-package, which no office paper prints. *Default until answered:* neither check is built, because one would flag correct papers and the other would never run. *Recommendation:* (b) now, as it is sound on every paper measured and needs no profile change, then (a) with A6's labelled set, which can measure whether the readers fill a tare field reliably.

### 7B.4 Build order (inserted before N4; N4 continues after)

| Step | What | New dependency | Done when |
|---|---|---|---|
| A1 | Lock `DOC_READ_MODEL_A` = Sonnet 4.6 (D-DR20) | — | a hazmat-pin change leaves the reader's model unchanged (test) |
| A2 | `hazmatLineChecks` — HMT + format consistency per line, a pure function over `@silvicom/hazmat-data`; result into each line's FieldEvidence | — | the 7B.2 five are flagged; no correct line of the ten is |
| A3 | Second read (Phase 2.1/2.2): pass B by a different model, aligned by key; disagreement → *Check* | — | 7B.2's two count/weight errors are *Check* |
| A4 | Text-layer witness for born-digital PDFs (2.7) | — | — — **built 2026-10-13** as a second row-bound witness beside the OCR, see progress log |
| A5 | OCR witness spike: PP-OCRv5 in the worker over the 184 corpus photos + 12 office pages; keep only if it turns *Check*s into correct *Read*s or catches what A2+A3 miss | onnxruntime-node + PP-OCRv5 (Q-DR22) | measured either way, written here — **built 2026-10-11** as a row-bound witness (PP-OCRv6 medium), see the progress log |
| A6 | Score all of it on the labelled corpus (§8): false-accept on critical fields = the number that must be ~0 | — | the table, with counts |

### 7B.5 Open questions

**Q-DR22 — ANSWERED 2026-10-11 (owner: install it and test) — spike run, see the progress log: keep it, as a
ROW-BOUND witness on counts and weights.** *Original question:* May the worker carry an OCR engine? PP-OCRv5 via `onnxruntime-node`: Apache-2.0/MIT, CPU-only,
~258 MB native runtime + ~85 MB models in the worker image. *Default:* not installed; A5's spike runs in a
scratch folder outside the repo first. *Recommendation:* approve the spike; decide the image cost on its
numbers. (The 2026-10-11 attempt to install spike libraries was refused by the permission system — the owner
must allow it.)

**Q-DR23 — ANSWERED 2026-10-11 (owner): Sonnet 5.5, built in A3.** *Original question:* Which model is the second reader? *Default:* `HAZMAT_MODEL_B` (Haiku 4.5). *Recommendation:*
Sonnet 5.5 — on 7B.2 it agreed with the paper everywhere we could check, and a second reader as strong as the
first is what makes agreement meaningful (P3); Haiku 4.5 failed P2's orientation test outright. Cost: a
second Sonnet-class read per BOL.

**Q-DR24 — Where does a weight-only line's §172.202(a)(5) quantity come from?** Since profile 1.2.0 a line's
weight column is read into `grossWeightLb` ONLY, and `quantity` holds a volume or mass printed in the
description (one printed number, one field — the readers split 6 papers in 10 when told to copy it). Both
readers already left `quantity` null on weight-only lines before 1.2.0, so nothing moves today, but two
consumers read `quantity` alone: `paperQuantityPresent` (`hazmat-engine/src/bol`) answered *missing* for a line
that prints only its weight, and the calculator's prefill (N6). **Settled by N6 (2026-10-12), not as first
recommended:** §172.202(a)(5) asks for the total quantity "by mass or volume" and never says whether a gross
weight counts — "gross" appears only in (a)(6), for aircraft (eCFR checked 2026-10-12; this question's first
draft quoted "net or gross", which the text does not contain). So the audit answers `cannot_tell` /
`weight_only`, naming the weight, for a person to judge (#1470); and the prefill fills no quantity at all,
because the calculator does not show that field (#1468). Nothing derives a quantity from the weight.

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

**Q-DR14a — The currency check is not clean: attest 2026.08.0 as cut, or wait for a clean re-cut?**
(Found 2026-10-09 running `RELEASING.md` step 0; both rules checked against the Federal Register API.)
91 FR 51098 ("Allowing Fireworks Certification Agencies…", effective 2026-09-08) adds special provision
200 to three HMT rows — UN0431, UN0335, UN0101. The engine branches on special provisions 1–5 only
(`tableSelect.ts`, poison by inhalation) and the paper audit on 441; code 200 is read nowhere, so no
computed result changes. But step 0 calls for a fresh cut, and a fresh cut is NOT CLEAN today: the
GovInfo CFR-2025 edition predates the rule and `crossCheckAll()` has no path for a difference explained
by a cited rule. Released 2026.07.1 was cut from the same 2026-07-28 text, so attesting 2026.08.0 makes
production no less current than it is. *Candidates:* (a) attest 2026.08.0 as cut, the three stale rows
and 91 FR 51098 named in the attestation; (b) build a cited-reconciliation path into the triangulation
gate, then cut 2026.10.0; (c) wait for GovInfo's CFR-2026 Title 49. *Recommendation:* (a) — it turns on
correct Limited Quantity handling now with a disclosed, measured gap that changes no output. The command
and checklist are `packages/hazmat-data/datasets/2026.08.0/PROMOTION-CHECKLIST.md`. Owner action: name
who attests.
*Ruled 2026-10-14: (b).* Built in `import/reconciliations.ts`: a difference passes only on an exact
match to a listed row under a rule in force after the edition and by the capture's eCFR date; a listed
row with no difference behind it fails the gate. Title 49 recaptured at 2026-10-09: a cut from it is
ALL CLEAN with 91 FR 51098's four field differences explained. 2026.08.0 is not attested and cannot be
re-cut from the new capture. Still the owner's: who attests the new cuts.

**Deadline 2026-12-02 — §172.101 Appendix A leaves 49 CFR.** 91 FR 49305 ("Remove Redundant List of
U.S. EPA CERCLA Hazardous Substances", effective 2026-12-02) replaces Appendix A with a pointer to
40 CFR 302.4. The dataset's `hazSubstances` (1,351 rows — the RQ source read by `validateBol` and
`paper_rq`) then has no 49 CFR source. Before that date the importer needs a 40 CFR 302.4 source and its
own two-source check, cut as a new version, whichever of Q-DR14a's options is taken.
*Status 2026-10-14:* the importer and its check are built (#1414); with Q-DR14a's (b) a cut effective
2026-12-02 is ALL CLEAN today and waits only on attestation. `LATEST_DATASET_VERSION` is a constant,
so moving to the 302.4 cut is a merge on 2026-12-01 released by the 01:07 CT run on 2026-12-02, not
earlier: before that day Appendix A is the law, and Table 302.4 already lists PFOA, PFOS (RQ 1 lb) and
1-bromopropane that Appendix A does not.

**Q-DR17 — Should the dataset mark whether an n.o.s. entry names a chemical group?** (Found fixing Step
4.1 against §172.203(k)(2).) (k)(2)(iii)/(iv) exempt a shipping name that already "contains the name of
the chemical element or group"; no HMT row says so. Until it does, a labelled `HAZARD_HEADS` list keeps
"Flammable liquids, n.o.s." without a technical name failing, and every other G entry answers
`cannot_tell`. Also recorded here: §171.4(c)(2)'s 5 L / 5 kg exception is about the INNER packaging,
which a shipping paper does not show, so a combination package of small inners over 5 L in total is
treated as a single packaging. *Recommendation:* a per-entry `namesChemicalGroup` flag derived in the
importer from the HMT entry text, with its own diff in the triangulation, retiring the list.

**Q-DR18 — Whose gate does a shipping-document read pass once it has two consumers?** (Found building
Step 1.6.) Today the profile has one consumer, the Hazmat Calculator, so a `shipping_document` read
passes HazmatGuard's entitlement, its `extractionEnabled` switch and its `extractionMonthlyTokenBudget`
(`documentReadGate.ts`), with the tokens counted on the org-wide `org_usage_month`. Stop readiness
(Phase 6) reads the same profile for billing, where an org may not hold HazmatGuard. Candidates: (a) the
gate of the consumer that requested the read, recorded on the read (`document_reads` gains a
`consumer`); (b) one document-reading entitlement and policy of its own, beside the modules. *Default
until answered:* (a)'s first case — every read is a calculator read. *Recommendation:* (a) — the
consumer is already on every review (`document_read_reviews.consumer`), a read requested from a
screen belongs to that screen's module, and a separate policy would be a second switch for the same
spend. Decide before Phase 6's first consumer ships.

**Q-DR19 — Who turns a page whose content is sideways inside the scan?** (Found 2026-10-10 on the
office samples.) One of the ten office PDFs is a landscape form scanned into a portrait page with no
`/Rotate`: the normaliser renders it exactly as stored (correctly — `/Rotate` and EXIF are the only
orientation a file declares), so the model gets text running top to bottom. The stage cannot know
better without looking at the content. Candidates: (a) the page classifier (Step 1.5) also answers
`rotation ∈ {0, 90, 180, 270}` — it already looks at every page once, so the answer costs no extra
call — and the working copy the reader gets is turned by it (a derived copy, the original untouched,
the rotation recorded beside the class in `document_page_classes` so a reviewer can override it);
(b) send the page as is and let the reader cope; (c) an OCR orientation detector (Tesseract OSD) in
the pages stage — a new native dependency. *Default until answered:* (b). *Recommendation:* (a) — one
call, one ledger, and an override path that already exists for the class; measure (b) against it on
the labelled corpus first, since a reader that copes would make (a) unnecessary.
**ANSWERED 2026-10-11: (a), built** — measured live on the office samples (24/24 with Haiku 5.5 at its
own tier; Haiku 4.5, pass B's default, 13/24, so the classifier has its own pin). Progress log, same date.

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
- **2026-10-09 (Q-DR12 built)** — Migration 0449 (#1405): `document_page_classes` is one append-only
  ledger for the classifier's verdicts (model + prompt version required, no actor) and each reviewer's
  or labeller's override (actor required, no model), held by one provenance CHECK; newest row per page
  wins, read through the service-role-only `document_page_current_class(p_org, p_pages)`. "Newest" is an
  identity `seq` — `now()` ties within a transaction and `clock_timestamp()` was measured tying in
  PGlite. `document_pages` lost the never-used class columns (0448 was staging-only, no reader) and
  gained `(id, org_id)` for the composite FK. Matrix 78 checks; ten mutants killed.
- **2026-10-09 (`doc:score` v2)** — #1406: a run file may record a typed failure;
  `READ_FAILURE_KIND` sorts each code. A reader failure scores every labelled field not read (yield
  falls, no false accept); budget and integrity failures are excluded and listed apart. Beside accuracy,
  every field and band reports printed-value accuracy and the invented-value rate with its `read`
  subset. On a synthetic run a "good" band read 98.6 % accuracy with 58 of 70 instances blank labels;
  printed-value accuracy (12/12) is the number that shows the reading. Thirteen mutants killed.
- **2026-10-09 (Q-DR14 prepared)** — #1407: golden `_pkg-lq-refused-pre-8a.yaml` pinned to 2026.07.1
  (unpinned it fails three ways on a promoted dataset); `RELEASING.md` no longer calls `crossCheckAll()`
  a remaining step; `PROMOTION-CHECKLIST.md` written. A simulated non-provisional 2026.08.0 (in memory,
  nothing saved) passes all 13 golden scenarios with the pin. Nothing attested, LATEST unmoved. Step 0
  found Q-DR14a and the 2026-12-02 deadline above.
- **2026-10-09 (contract v1.1, Railway, Q-DR17)** — #1409: printed descriptions, `otherLines`, the
  emergency-contact text and per-image page markers in profile 1.1.0, read in three sections (a CI test
  holds each under 16 union parameters). #1396: the paper rules match eCFR's text. #1414: the 40 CFR
  302.4 importer for the 2026-12-02 change and the `namesChemicalGroup` flag (carried from 2026.09.0).
  Step 1.3's done-when met on the Railway staging image (linux-x64 glibc): a two-page pdfkit PDF rendered
  to 2550×3300 pages with 17 and 7 text-layer words in 1.9 s.
- **2026-10-10 (Step 1.6, orchestration)** — #1424: `executeRead` runs a queued read on the worker
  (`document_read`, cap 2): the consumer's gate (for `shipping_document`, HazmatGuard's entitlement,
  `extractionEnabled` and `extractionMonthlyTokenBudget`), then pages of the profile's classes (pages
  not yet classed are read until Step 1.5), each original verified against its sha256 with the model
  reading a copy re-derived from it, then the §4.6 cache key (the review epoch included), cache before
  budget (D17), and one terminal transition. Migration 0451: the terminal move adds the read's tokens
  to `org_usage_month` in its own transaction (`runs` untouched), and two operational codes —
  `model_unavailable` (the queue's last retry ended transient) and `reading_disabled`. Matrix 83
  checks; five mutants killed. Not yet: pass B and the ledger (Phase 2), the usability gate, the
  routes and intake (next).
- **2026-10-10 (office samples, normaliser 1.1.0)** — The owner supplied the ten office BOL PDFs Step 0.1
  asked for (8 one-page, 2 two-page; held only in the gitignored corpus). All ten are scans: one 1-bit
  CCITT G4 image per page, no text layer, four at 300 dpi and six at ≈196 dpi. **Under normaliser
  1.0.0 every page rendered as blank white paper** (mean 255, 0 % ink), with no refusal: pdf.js 6
  decodes CCITT, JBIG2 and JPEG 2000 through WASM it finds only through `wasmUrl`, and
  `verbosity: 0` silenced its warning. Step 1.3's fixtures had no CCITT page (its "scanned" fixture is
  a JPEG), so the Railway check could not see it. Fixed by passing `wasmUrl` and `iccUrl`
  (`NORMALISER_VERSION` 1.1.0) and pinned by a synthetic G4 fixture (`faxScanPdf`, banded strips as
  scanners write them); removing `wasmUrl` fails it. After the fix: 12 pages, 4–14 % ink, byte-identical
  across two runs, 0.25–0.64 s per document. Upright: 11 of 12 pages; one is a landscape form scanned
  sideways with no `/Rotate` → Q-DR19. `pnpm --filter @silvicom/api doc:corpus:files -- <dir>` (new)
  files such documents into the corpus as their canonical pages + an empty label skeleton, folder named
  by content hash; the ten are there, unlabelled. **Live read** (Sonnet 4.6, three sections, first-time
  calls): one page 9,613 input + 459 output tokens, ≈ 5.8 s wall, ≈ $0.036 at $3/$15 per MTok; two
  pages 14,110 + 627, 7.1 s, ≈ $0.052. A 1212×1568 page costs the same ≈ 2,500 image tokens whatever is
  on it, so each section's input is ≈ 3,200 per page. Two of three first attempts returned a 502 from a
  local caching proxy on the measuring machine (`ANTHROPIC_BASE_URL`), and it replayed repeat requests
  in ≈ 45 ms — latency above is from un-cached calls only. **Open for Step 1.6b:** `executeRead`
  records `usage.input` (the API's `input_tokens`) against the budget, which excludes
  `cache_read_input_tokens` and `cache_creation_input_tokens`; nothing in the module asks for caching
  today, but the day §8's prompt caching is turned on, the budget would count almost none of the
  input. Count all three.
- **2026-10-10 (Step 1.6b, the routes)** — `/api/documents`, gated `hazmatguard` + the `hazmat` section
  (`manage` to send or review, `view` to look), which is Q-DR18's default and says so in the router. An
  upload is **three calls, not one**, because `document_sources` is append-only with a NOT NULL
  `page_count`: the row cannot exist until the file has been rendered, and rendering runs on the worker.
  (1) `POST /sources` writes no row: a new id and a signed PUT URL for `<org>/<id>/source-<sha256>`, or —
  when the org already holds those bytes — that source, `uploadUrl: null, duplicate: true` (D-DR12).
  (2) The browser PUTs the bytes to Storage. (3) `POST /sources/:id/complete` queues `document_intake`
  (dedupe `document_intake:{id}`, worker cap 2) → 202 + jobId; `runIntake` downloads the key, checks the
  bytes against the sha in it, normalises, upserts each page's PNG original and WebP working copy,
  inserts the source (sniffed mime, `origin: upload`) and the missing pages (original's width/height,
  `capture_metrics.renderDpi`), and, when a profile was named, queues the read (reusing a done one, so a
  retried job never reads twice). The in-request render was avoided deliberately: pdf.js renders on the
  event loop, 0.25–0.64 s per document on the office scans, on a process that also serves every other
  request. `GET /sources/:id` answers `uploading | normalising | ready | refused | failed`; **`failed` is
  new** — an intake job that died for a reason not the file's (Storage down, retries spent), so a dead
  job no longer polls as `normalising` for ever, and the sender's move is to press complete again. Two
  new refusals, both the sender's: **`upload_missing`** (the key is not in Storage; any other Storage
  error throws and is retried) and **`hash_mismatch`**. Every refusal is RETURNED as the job's stats,
  never thrown, so a file that cannot be read is not re-read five times. `POST /reads` reuses a queued or
  reading read; `GET /reads/:id` returns every page of the source with its class, one batch of 300 s
  signed URLs, and the working copy's size from `workingSizeOf` (a page that cannot be signed refuses the
  whole read — a review screen missing a page is a review of another document). `POST /reads/:id/reviews`
  takes a done read only; each entry's `oldValue` must be what the read gave (missing = null), a path to a
  group of fields is refused, and the batch is all or nothing. Audit: `document.intake_started`,
  `document.read_requested` (not for a reused read), `document.read_reviewed` (a count per action).
  `document_sources` left the table-producers waiver. 34 tests across `intake.test.ts`,
  `requests.test.ts`, `routes/documents.test.ts`, every service test under `expectOrgScoped`; twelve
  mutants killed. **Still open from 1.6b:** `executeRead` counts only `usage.input` against the budget,
  not `cache_read_input_tokens` or `cache_creation_input_tokens` — count all three before §8's prompt
  caching is turned on. Next: Step 3.2 (`from-samsara`, which needs D-DR9's one-source-per-document vs
  per-photo answer first) and 3.3 (`bolPrefill.ts`).
- **2026-10-10 (the owner's flow, §7A)** — The owner restated the product: upload a BOL's pages on the
  calculator, read, audit with explanations, prefill, Calculate — and drivers send *photos*, several
  per BOL, to Samsara or by SMS, so the unit of reading is a set of images, not a file, and a
  preparation layer comes before the reader. Researched (sources in §7A.1) and recorded D-DR14–D-DR18,
  Layer 1's seven stages and the new order N1–N8; Q-DR20 (high-resolution-tier model) and Q-DR21
  (rectification library) opened. **Measured with Anthropic's reference resize:** the pinned Sonnet 4.6
  re-resizes our 1212×1568 working copy of a letter page to 952×1232 on the API's side; a
  high-resolution-tier model would read the 300 DPI page at 1688×2184 and a Samsara photo untouched at
  2000×1500. Next: N1, the assembly tables.
- **2026-10-10 (N1, the assemblies)** — Migration 0454 (renumbered from 0453 at merge: the dispatch board took 0453 first): `document_assemblies` (who made it — `prepare`,
  `sender` or `reviewer`, `ASSEMBLY_MAKERS` — under one provenance CHECK, and the assembly it supersedes,
  `unique` so an edit history is a line and a second concurrent edit conflicts) and
  `document_assembly_pages` (positions 1..n, a page once per assembly, composite FKs to the org's pages).
  Both append-only by trigger and in `RETENTION_FORBIDDEN`; a file stays a source (D-DR14). One door,
  `document_assembly_create`, writes an assembly and its pages together in the array's order and refuses
  an empty or repeating list (DO016), another carrier's page (DO017) or superseded assembly (DO018),
  leaving nothing behind. Matrix `document-assemblies` 32 checks; ten mutants killed; the eleventh
  (dropping the explicit revoke) is equivalent, because 0412 already closes new functions to clients.
  Next in N1: `document_reads.assembly_id` (its own merge, before its reader), then the routes.
- **2026-10-10 (N3 first part: tier sizing + page labels, D-DR16 / R2)** — `model/visionTier.ts`
  transcribes Anthropic's reference resize; a read now sends each page as `sentCopyOf` — ONE resize from
  the verified original to the model's tier (standard 1568 px / 1568 tokens; 4.7-and-later 2576 / 4784;
  either side ≤ 2000 px above 20 images) — and introduces each image with `Page n of m:`. The stored
  1,568-px working copy is unchanged (it is what the reviewer sees). `SEND_RULE_VERSION` "1" joins the
  cache key. **Measured LIVE** (an `oversized_image: "error"` block is refused with the target size
  before any model runs): Sonnet 4.6 would downsize a 2000×1500 photo to **1270×952** — the Vision docs'
  table says 1269×952, their reference code and the API say 1270 — and a 300 DPI letter page to
  952×1232; Sonnet 5.5 takes 2000×1500 and 1920×1080 as sent and downsizes the letter page to 1688×2184.
  So the pinned pair reads a letter page at ≈ 0.37 of its 300 DPI pixels per side and a 4.7+ model at
  ≈ 0.66 (Q-DR20). `oversized_image: "error"` on the request itself waits for an SDK that types it
  (0.107.0 does not). Eight mutants killed (half-even rounding, the 28-px padding at the 2000-px limit,
  the 4.7 cut, the many-image cap, the resize itself, the model the size follows, the labels, the cache
  term).
- **2026-10-10 (N1, a read names its assembly)** — Migration 0455: `document_reads.assembly_id`, same-org
  by composite FK and fixed at insert by `document_reads_guard` like `source_id`; `source_id` loses its
  NOT NULL and a read names EXACTLY ONE of the two (`document_reads_names_one`) — an assembly of three
  photos has no one source, and the first page's source beside it would be a second answer to "what was
  read". Past reads keep their source; nothing is backfilled. The source path stays for old code in the
  deploy window and is retired by its own migration once every request goes through an assembly (a single
  upload becomes a one-file `sender` assembly). Matrix `document-assemblies` 39 checks (seven new);
  four mutants killed (no names-one check, both allowed, single-column FK, guard ignoring the assembly);
  `rls` gained seeders for `document_reads` and `document_read_reviews`, which the generic seeder can no
  longer fill. Next in N1: the routes — files → sources → one assembly, and a read requested of it.
- **2026-10-10 (N1, the routes)** — `POST /api/documents/assemblies`: `{ sourceIds }` is the sender's
  assembly — the files in the order given, each file's pages in page order — and `{ supersedes, pageIds }`
  a reviewer's edit (untick, reorder, add), 409 `edited_elsewhere` when that version was already replaced
  (0454's `unique (supersedes_id)`). At most `ASSEMBLY_MAX_PAGES` = 20 pages, the vision API's many-image
  threshold, so a long document is never read at the 2,000-px cap (a test holds the two together).
  `POST /reads` takes `{ assemblyId }` as well as `{ sourceId }`; `GET /reads/:id` answers `assemblyId`
  beside a now-nullable `sourceId` and numbers pages by their position in the document. One module,
  `read/readTarget.ts`, turns either target into its pages, so the read, the review screen and the cache
  key share one order. The review epoch now counts every read given any of the pages — by their source
  or by any assembly holding one — because a reviewer's edit is a new assembly and would otherwise start
  at epoch 0 and replay the unreviewed read of the same photos (F-EX10). The intake's own read
  (`complete` with a profile) still reads the source; it moves to a one-file `sender` assembly with N2,
  and the source path is then retired by its own migration. Twelve mutants killed.
  Next: N2, the calculator's multi-photo upload.
- **2026-10-10 (N2, the calculator's upload)** — "Read from a bill of lading" above the Placard
  calculator's form (`features/hazmat/bolRead/`), shown to exactly the roles that manage `hazmat` (the
  routes' gate, read from the matrix). Drop or pick the photos / PDF of ONE BOL — on a phone the picker
  offers camera, gallery and files — and they show as pages: a thumbnail (a file tile for PDF and HEIC,
  which a browser cannot draw), "Page n", a tick to leave a placard or a retake out, and earlier / later /
  remove. Read sends the ticked files in the order shown: each is hashed, registered and PUT to Storage
  (bytes the org already holds are not sent again; the same bytes under two names are sent once), the
  sources are polled until ready — a REFUSED file stops everything before a read is spent, named with
  the intake's sentence — then one `sender` assembly in that order, one read of it, polled to `done` or
  its READ_FAILURES sentence. A file's type falls back to its extension, because desktop Chrome reports
  an iPhone HEIC as "". The read is emitted, not yet applied: filling the form and saying what the
  shipper left out is N6. Fifteen mutants killed; seen in a browser at desktop and 390-px widths.
  Next: N3's remainder (P2 classify + orient).
- **2026-10-11 (P2 part 1, the rotation column)** — Migration 0456: `document_page_classes.rotation`
  (`PAGE_ROTATIONS` 0/90/180/270, degrees clockwise to read upright; null = not answered), so the P2
  classifier's turn is a verdict in the same ledger as its class and a person overrides both the same
  way (Q-DR19 (a)). Nullable with no default — a verdict that did not look must not claim 0. Matrix
  `document-reader-tables` 88 checks (five new); three mutants killed. Next: the classifier itself,
  writing and reading the column, in its own merge.
- **2026-10-11 (P2 part 2, classify + orient — Q-DR19 (a) built)** — Every page a read is given now has
  a verdict before anything is read: pages with none go to the classifier (`model/classifyPage.ts`), one
  call per page, closed `PAGE_CLASSES` + clockwise `PAGE_ROTATIONS`, written to `document_page_classes`
  as the classifier's row (model, `page-class-1.0.0`, rotation). Once ever per page: a later read, and the
  review screen, use the stored verdict, and a dispatcher's override is a newer row. Only pages of the
  profile's classes are read (a placard photo is left out without anyone unticking it); a page the
  classifier cannot answer is still read. Each read page is sent turned by its verdict — a lossless
  right-angle turn of the original, then the one resample (D-DR15/16) — and the turn joins the cache
  key's page term. Classification is model spend, so the budget is asked first, and its tokens are the
  read's (no second usage path). It runs inside the read, not at intake, until P7 proposes assemblies.
  **Measured live, 2026-10-11**, the ten office BOLs (12 pages), each page as stored and turned a quarter
  counter-clockwise (24 answers; the one page scanned sideways, 0132900, needs 270): Haiku 4.5 — 13/24
  on rotation (2 of the 12 turned pages; the sideways page missed); Haiku 5.5, Sonnet 4.6, Sonnet 5.5 —
  24/24; Haiku 5.5 at the STANDARD tier instead of its own high tier — 23/24, and its miss would have
  turned a page upside down. Classes: no page classed `other` by any model. So the classifier has its own
  pin, `DOC_CLASSIFY_MODEL`, default `claude-haiku-5-5`, sized to the model's own tier (≈ 5.4 k input
  tokens a page). Q-DR19 is answered (a), by this measurement; (b) "let the reader cope" was not run.
  Fourteen mutants killed. Next: N4 (P3 rectify after its spike, P5 quality gate, P6 duplicates, P7 order).
- **2026-10-11 (§7B, precision by agreement)** — Owner: don't rely on the model alone; get as close to 100 %
  as possible; lock Sonnet 4.6 if it is the more precise. Researched current open-source OCR (RealDocBench,
  OmniDocBench v1.6, ExtractConf, PP-OCRv5-in-Node): open-source OCR models alone score 59–86 % per field on
  real regulated documents against a frontier VLM's 93 %, so they become witnesses, not the reader (D-DR21).
  Measured on the ten office BOLs: the HMT check flags all 5 of Haiku 5.5's wrong UN ids and nothing correct;
  two-reader disagreement catches Sonnet 4.6's two count/weight misreads. Recorded D-DR19 (Read = witnesses
  agree), D-DR20 (reader locked to Sonnet 4.6), D-DR21, build order A1–A6, Q-DR22 (OCR engine in the worker),
  Q-DR23 (second reader; recommend Sonnet 5.5). Next: A1 + A2.
- **2026-10-11 (§7B A1 + A2)** — A1 merged (#1450): `DOC_READ_MODEL_A` defaults to Sonnet 4.6 on its own.
  A2: a finished read now records evidence — `evidence/hmtWitness.ts` runs the hazmat extractor's LOCKED
  `resolveHmtLine` over every read hazmat line and records, for its id, PSN, class and PG, pass A's value and
  the table's verdict (new evidence reader `table`). Every judged field is *Check*: a single model is never
  enough (D-DR17), and the table can stop a value but never be the second witness that makes one *Read*. The
  verdict waits for A3 (second reader) to make agreement possible. `ACCEPTANCE_RULE_VERSION` "none" → "1"
  (cache key: reads made without evidence are not replayed). The test is §7B.2's measurement kept: all five
  product-code lines refused, all seven correctly read office lines consistent, a class contradiction refused.
  Six mutants killed. Next: A3, the second reader (Q-DR23).
- **2026-10-11 (§7B A3 — the second reader, and A5's OCR spike)** — Owner: second reader Sonnet 5.5;
  install the OCR engine and test it.
  **A3 built.** `DOC_READ_MODEL_B` defaults to `claude-sonnet-5-5` on its own (Q-DR23). A read runs pass A
  (the document) then pass B on the same pages — B only when A succeeded, so a refusal is not paid twice; B
  failing leaves one reader's evidence, never a failed read. B's hazmat lines are matched to A's by the id's
  digits, nth to nth (`evidence/alignLines.ts`, D-EXR5 — never by index); a line only B saw is shown after A's.
  Every field records passA, passB and, on id/PSN/class/PG, the table (`evidence/shippingEvidence.ts`);
  `readersAgree`/`valuesAgree` in the shared contract are the one comparison (case, spacing, a thousands comma;
  nothing fuzzy). Status: `not_read` where both read nothing, otherwise `check` — agreement is recorded, and a
  field reaches *Read* only by graduation (D-DR5, owner switch, off). A cache hit replays its own evidence.
  Rule "2"; both models in the cache key; tokens of both passes counted. Eleven mutants killed.
  **Measured live on the ten office BOLs (Sonnet 4.6 + Sonnet 5.5):** engine fields 135 agreed (20 of them the
  table refused), 30 disagreed; standard fields 198 agreed, 74 disagreed. Of the 30 engine disagreements only
  two are the same printed value read two ways — 9 vs 6 drums (0132900) and 3,808 vs 3,806 lb (0135071), both
  §7B.2's known errors, both now shown — plus one packaging code ("331HA1" vs "31HA1"). The rest are the two
  models FILING the same text differently: a drum count in `quantity` vs `packageCount`, product codes, ERG and
  SDS numbers in `marks` or not. That is the next precision lever: tighten the profile's field descriptions so
  the models have one place for each printed thing (§7B's "make the model think less"). The table's refusals
  were the SHIPPER's: "Hydrochloric acid solution" and "Environmentally Hazardous Substances" are not
  §172.101 proper shipping names — exactly what the paper audit (§5) must report, so the verdict's reason
  feeds §5, not only the field's status.
  **A5 OCR spike (scratch folder, nothing in the repo).** `@gutenye/ocr-node` 1.4.9 crashes inside its bundled
  opencv.js on Node 26. `ppu-paddle-ocr` 6.6.1 + `onnxruntime-node` runs on CPU. On the 12 office pages
  (fax-quality CCITT scans): PP-OCRv5 server ~5.6 s/page and its text held 35 of 49 true values; **PP-OCRv6
  medium ~3.8 s/page, 45 of 49**. Both return nothing on the sideways page until P2 turns it (then 0.83
  confidence). As a whole-page "is the value printed anywhere" witness it would wrongly CONFIRM the wrong 9
  drums (a "9" is printed elsewhere — class 9) and the product codes (printed, just not ids). As a ROW-BOUND
  witness — the value must be on the printed row of the line's UN id — it confirmed 27 of 32 true counts and
  weights and REJECTED both wrong values (9 drums, 3,808 lb). Size: `onnxruntime-node` 287 MB (all platforms;
  Linux alone is smaller) plus the model files. Verdict: keep, as a row-bound witness for counts and weights;
  the identifying fields stay the table's and the readers'.
  Next: A5 build (row-bound OCR witness in the worker), then the field-description tightening, then A6 scoring
  on labels.
- **2026-10-11 (§7B A5 — the OCR witness, built)** — The spike's verdict made real, in the read.
  `ppu-paddle-ocr` 6.6.1 + `onnxruntime-node` 1.30.0 are `apps/api` dependencies. Every read page is OCR'd
  from its verified ORIGINAL turned upright by P2's verdict (`ocr/pageOcr.ts`), on its own worker thread
  (`ocr/ocrWorker.ts`) — reads run inside the API process today (`JOB_EXECUTION_MODE` is unset on both Railway
  environments, so `inprocess`), so the engine must not run on the thread that answers requests. Inference is
  capped at 2 threads; the thread starts on first use and stops after two idle minutes. OCR runs while the two
  models read, costs no tokens, and its failure is its absence, never the read's. The model files (PP-OCRv6
  medium, ~139 MB) are downloaded on first use per container into `DOC_OCR_CACHE_DIR` (default the OS temp
  dir), from a PINNED Hugging Face revision with every file's sha256 checked (`ocr/ocrModels.ts`) — the
  library's own loader fetches from a moving branch with no check. `DOC_OCR_WITNESS=off` switches it off.
  **The rule** (`evidence/rowWitness.ts`, new evidence reader `ocr`): on `packageCount`, `grossWeightLb` and
  `quantity.value` only, the witness records which of the two readers' values is printed as a whole token on
  the printed row of the line's own UN id (1.5 anchor heights above to 2.5 below). It reads no value of its
  own (D-DR21). Two additions to the spike, both found building it: a value that is also a token of the line's
  hazard class is UNPROVABLE (the row's description prints "…, 8, PG II", so 8 drums on a class 8 line would be
  backed by the class), and number tokens compare as numbers (0134527 prints "20,030.00"). It ABSTAINS when
  the printed anchors do not number exactly the read lines with that id — 0134831 prints both its UN1263 lines
  on each of its two pages, four anchors for two lines. Statuses are unchanged (Read only by graduation, D-DR5);
  rule "2" → "3".
  **Measured with the built engine** (real thread, pinned download, the spike's 17 lines / 32 true counts and
  weights): 28 backed, 4 abstained (all 0134831), 0 shown-but-missed, **0 wrong values backed**; with both
  readers' values offered, it backs 6 over Sonnet 4.6's 9 drums (0132900) and 3,806 over 3,808 lb (0135071),
  and backs neither wrong value alone. ~9.5 s a page at 2 threads on this Mac (the spike's 3.8 s used every
  core); first use adds the download and ~25 s of start-up. Image: `onnxruntime-node` is 287 MB installed (all
  platforms' binaries ship in the one package; its postinstall, CUDA-only, is not run under pnpm's build-script
  policy), `ppu-paddle-ocr` + `ppu-ocv` (opencv.js) under 30 MB; `@napi-rs/canvas` and `sharp` were already there.
  Twenty-five mutants killed (rowWitness 10, shippingEvidence 5, ocrModels 3, pageOcr 3, executeRead 4).
  Next: the field-description tightening (count vs quantity, what belongs in marks), then A6 on labels.
- **2026-10-11 (§7B — field descriptions, profile 1.2.0; final wording measured 2026-10-13, see below)** — The profile's
  line fields now say what belongs in each, so each printed thing has one field: `psn` (without its trailing
  separator), `quantity` (a volume or mass in the description, never the weight column, never a count),
  `grossWeightLb` (the weight column, in pounds), `packageCount` (the number with the package type),
  `packaging` (type with count), `marks` (regulatory notations only — not product, item, SDS, ERG, ERS,
  reference or customer numbers). Profile 1.1.0 → 1.2.0 (the wire schema changed; the schema hash is in the
  cache key already). The hazmat extractor is unaffected: it sends its own hand-written schema (vision.ts).
  **Measured live, ten office BOLs, Sonnet 4.6 + Sonnet 5.5, same counting both runs** (a field counts when
  both readers gave evidence and not both null): baseline (1.1.0) engine fields 145 agree / 18 disagree — 13
  of the 18 `marks` (product codes 5607540…, ERS/ERG numbers, KC-568, "SDS Attached"), one sack count in
  `quantity`, one trailing comma in `psn`, one count read by one reader only, and the known 3,808 vs 3,806 lb.
  First wording ("a weight column counts" in `quantity`): marks disagreements 13 → 1, but the readers then
  split on copying the weight into `quantity` (6 papers) — 161 agree / 20 disagree. The wording was changed
  to make the weight column `grossWeightLb`'s alone (Q-DR24). **Its re-run could not be made: the API
  account's credit balance ran out mid-session (400 "credit balance is too low").** Not merged until measured.


- **2026-10-12 — N6 part 1: the read becomes calculator lines (`bolPrefill.ts`).** The consumer adapter
  `fieldEvidenceContract.ts` always named: a finished read → one calculator line per printed hazmat line, each
  field with the evidence's state (D-DR4), whether the two readers agree, whether the OCR found the value on the
  line's row, the reason it is blank or needs a person, and the evidence paths a Calculate press will confirm.
  **The product is the table's own row**: the line's `hmtRef` from the A2 witness, fetched by that exact ref
  through `GET /hazmat/products?refs=` (new; never a search, a ref the calculator's dataset lacks leaves the
  line unresolved). Limited Quantity only when BOTH readers read the notation (the extractor's rule: a wrong LQ
  is the one error that could under-placard); the §173.150(f) election never set, the line says the paper
  printed it; an unrecognised unit leaves the quantity blank; template lines with no count, weight or quantity
  are left out and listed; a line only pass B saw comes in with a note; non-hazmat lines printed → other
  freight "yes", otherwise "not sure", never "no". Nothing becomes *Read* the evidence did not say.
  **One reading, not two:** the printed-unit table, the packaging-phrase reader (`packageTypeFromPrinted`, new)
  and the template-line rule (`classifyLineLoadState`) move to `@silvicom/shared`; the hazmat extractor
  re-exports them and takes its bulk/non-bulk answer from the same phrase reader, so the two paths cannot
  classify one paper differently.
  **A defect in A2, found building this:** the table witness resolved a line printed "Combustible liquid"
  without the election the extractor's mapper passes, so NA1993 "Diesel fuel, Combustible liquid, PG III" —
  how most fuel BOLs print diesel — was a class mismatch, and its product could never have prefilled. It now
  passes the election exactly as `mapBolLines.ts` does; the resolver still refuses the word on gasoline or an
  acid. Rule "3" → "4". Thirty mutants killed (bolPrefill 22, packaging and units 4, products-by-ref 2, witness 1,
  extractor fallback 1); the survivors on the way removed a redundant filter and fixed an order test that had
  passed on the dataset's own order. Not yet on screen: the panel still emits the read; part 2 applies it to
  the form with each field's state, part 3 adds the paper audit's findings.

- **2026-10-12 — N6 part 2: the read fills the calculator on screen.** The panel's finished read goes to the form
  (`HazmatCalculatorPage` → `HazmatCalculatorForm`'s `bolRead`), which fetches each line's product by the table's
  exact ref and replaces the empty line with one filled line per printed product. Every filled line shows the
  description as printed and its notes (combustible election, a line only one reader saw); under each filled
  field, one sentence from `fieldNote`: where the value came from, whether the two readers agree — naming both
  readings when they do not ("6 or 9") — whether the OCR found it on the line's row, or why it is blank; once a
  person edits the field it says "Changed by you." A summary callout counts the lines, the ones the table did not
  match, and the template lines left out. A paper listing non-hazmat freight answers "rest of the load" yes.
  **Re-reading never doubles a weight:** a new read replaces the lines an earlier read filled and keeps every line
  a person typed. A failed product lookup changes nothing and says so.
  **Two corrections to part 1, found putting it on screen:** (1) the prefill no longer fills a line's QUANTITY —
  the calculator does not show that field (its header: the ladder runs on gross pounds), so a read quantity would
  have reached the engine unseen and uncorrectable; the printed-unit table goes back to the extractor, its only
  user. (2) A tank line gets no package count: the form hides the field and the engine takes none, and the
  browser check showed "59,500 lb per package" under a cargo tank.
  **Seen in a browser** (built bundle, dev-bypass session, API stubbed with a rule-4 read and the real dataset's
  products) at 1440 and 390 px: no horizontal overflow at 390. Twenty-nine mutants killed (wording and change
  detection 14, form 7, product lines 3, page 2, note 1, tank count 2), two survivors fixed with tests on the way.
  Next: part 3, the paper audit's findings ("what the shipper left out") beside the lines.

- **2026-10-12 — N6 part 3: "Is this BOL written correctly?" above the calculator form.** `GET /reads/:id` now
  carries `paperAudit` for a finished shipping-document read: `auditPrintedPaper` over pass A's document, each
  line resolved by the table witness's own resolver and dataset (`hmtResolution`, one parsed dataset per
  process), field states per **D-DR22** (above). Worked out on every fetch, never stored — it follows the
  dataset and the rules in force, and a stored copy would be a second answer. The form shows it as a card:
  *Wrong or missing* (each with who acts — "Do not accept the BOL until it is corrected" before "The shipper
  must correct it" — how to fix it, and the CFR cite), *Check by eye*, and the passed checks folded behind
  their count; "Every check passed." only when nothing is wrong or open.
  **Found running it on a realistic read, fixed:** (1) every weight-only line was "shows no total quantity"
  though the paper prints its weight. §172.202(a)(5) asks for the total "by mass or volume" and never says
  "gross" (only (a)(6), aircraft, does — eCFR checked 2026-10-12; the draft Q-DR24 on #1456 says "net or
  gross", which the text does not contain — correct it there before that merges). Whether a printed weight is
  the material's total is a judgement the paper cannot settle, so the rule now answers `cannot_tell` /
  `weight_only` naming the weight, not `fail`. (2) An unconfirmed field was worded as its path
  ("isn't sure of hazmat.lines[0].quantity.value"); the catalogue now says "the quantity". (3) A stale audit
  from the previous read stayed up when the next read's product lookup failed — cleared at the start of each read.
  (4) Seen in a browser, the first build was unreadable: template lines were audited (the prefill leaves them
  out — the audit now does too, keeping the read's line numbers), and one unmatched line repeated "doesn't match
  a table entry" once per rule. A line's checks stopped by one cause are now ONE sentence naming every check it
  stopped (`bolBlockedSentence`; each rule's subject is a catalogue property, not restated). On the stub BOL the
  card went from 18 "check by eye" items to 6, beside 3 real failures (no PG twice, "CALL SHIPPER").
  Twenty-nine mutants killed (audit states and inputs 10, route 1, weight-only rule 2, wording 5, grouping and
  sorting 6, panel 2, form 3); three equivalent mutants removed dead code instead.
- **2026-10-12 — Intake reads any picture or PDF a driver sends, and a one-photo BOL no longer fails "at least one page".** The owner's first production tries were refused at grouping: "A document needs at least one page, each listed once." Production's rows show why. The 18:48 upload's source row was written at 18:48:12.76 and its page a moment later, but `sourceStatus` answered `ready` from the row alone, so the browser called `POST /assemblies` in that gap. It found no pages, and `document_assembly_create` refused an empty list (DO016). The 15:35 try won the race. **Fixed three ways:** (1) a source is `ready` only once every page is stored, a short one is `normalising`, and one whose intake gave up halfway is `failed`, so pressing Read again finishes it; (2) `createAssembly` answers 409 `not_ready` ("A file is still being prepared") instead of ever sending a short list; (3) the browser groups the source each intake RESOLVED to, not the id it registered under (the same bytes registered twice become one source). **Formats:** Google Voice saves photos as `.jfif`. That is a JPEG the server already decoded, but the picker listed only `.jpg/.jpeg` and the dropzone threw away any dropped file whose name was not on that list. Now the sniff lives in `@silvicom/shared` (`documentFormats.ts`), and the browser reads each file's first 4 KB and decides by the bytes, the same as intake. Name and declared type decide nothing. The picker offers `image/*` plus every format's extensions, and the dropzone matches `accept` the way the browser does (name OR type). TIFF (every page of a multi-page scanner or fax TIFF, under the same 10-page limit as a PDF), GIF (first frame) and AVIF are read too. `INTAKE_MIMES` and the unsupported-format sentence are derived from the one format list, and `NORMALISER_VERSION` is now 1.2.0. **Still refused, by design:** Word, Excel, email files, videos. None of them is a picture of a BOL, and each is refused with the sentence listing what can be read. **Known limit:** a "normal"-mode fax TIFF (204×98 dpi) is stored with its non-square pixels, so the page looks squashed vertically. It is still read; stretching it by the TIFF's resolution tags is not built. Twenty-two mutants killed (race 4, TIFF pages 4, sniff 5, contract 2, dropzone 2, picker 5).
- **2026-10-12 — A read whose job dies now ends `failed` instead of "reading" for ever.** The owner's two production reads that got past grouping (15:35 and 17:52) never finished: in both jobs the Anthropic API refused with "Your credit balance is too low" (400), and each job failed within three seconds. The handler only ended a read on the LAST attempt of a TRANSIENT error; it rethrew a configuration error (bad key, retired model, empty balance) without touching the read, reasoning that it was not a reading failure. Both reads therefore stayed `reading`. The screen gave up after three minutes with "It will keep going", which was false. **Fixed:** (1) every throw that ends the job for good now ends the read `model_unavailable` first and still rethrows, so the job's error keeps the cause. That code is OPERATIONAL in READ_FAILURE_KIND, so it never counts against the reader's accuracy. A failure while ending the read cannot replace the job's error. (2) `getRead` and `requestRead` settle a read still `queued`/`reading` whose latest job has `failed`. This repairs the two reads already stuck, the next time anyone opens them, and stops `requestRead` handing such a read back as "in flight". A `queued` read goes through `reading`, the only road 0448's state machine allows to `failed`. (3) The `model_unavailable` sentence no longer claims "after several tries": in-process mode makes one try, and a billing refusal is not a connection problem. **Still open (owner):** the production Anthropic key's credit balance. No read can finish until it is topped up. Fourteen mutants killed.
- **2026-10-13 — A fax TIFF is read at its real shape.** A "normal"-mode fax stores pixels at 204 dpi across and 98 dpi down (ITU-T T.4). Drawn one pixel per pixel, every page came out squashed to about half its height, the "known limit" left open on 10/12. libvips reports only the horizontal density, so `tiffResolution.ts` reads each page's own XResolution/YResolution tags from its IFD. It handles both byte orders, guards against an IFD loop, and answers null for anything malformed, in which case the page is decoded as stored and never refused for it. The low-resolution axis is stretched up to the high one, never down, in a separate pass over the stored pixels: sharp rotates before it resizes in one pipeline, and the tags describe the stored axes. Fine mode (204 × 196) gets its 4% too, and a scanner's equal pair is unchanged. A fax mixing fine and normal pages gets each page's own correction. `NORMALISER_VERSION` is now 1.3.0. Ten mutants killed. The survivor (every page read with page 0's resolution) needed a mixed-resolution fixture that sharp cannot write, so `withPageResolution` rewrites one page's two rationals.
- **2026-10-13 — The photo floor is 800 px, measured; it was 1200, inherited.** The owner's first real upload after the release was refused: a Google Voice photo of a BOL, 1080 × 810 and 119 KB, "too small — at least 1200 pixels". The 1200 came from the hazmat capture plan, where the driver app owns the camera. Intake does not own the camera, and a texted photo arrives as the carrier shrank it. **Measured:** for each of the nine readable office BOL samples (0132900's page is sideways and gives no text unturned), the 300-DPI page was shrunk to each long edge, re-encoded as JPEG q70, OCR'd with the A5 engine, and compared with the same page's full-resolution OCR (token recall, digits separately):

  | long edge | all tokens (median) | digit tokens (median) | digit tokens (worst page) |
  |---|---|---|---|
  | 1600 | 84% | 92% | 52% |
  | 1200 | 75% | 77% | 52% |
  | 1080 | 77% | 76% | 58% |
  | 960 | 73% | 74% | 54% |
  | 800 | 69% | 77% | 60% |
  | 640 | 43% | 43% | 24% |
  | 480 | 14% | 13% | 0% |

  The curve is flat from 1200 to 800 and falls off a cliff below it, so `INTAKE_LIMITS.minLongEdgePx` is now 800. Above 800, an unsure value is for the two readers and the OCR witness to flag (§7B), not for intake to refuse. The refusal sentence now names 800 and the fix: text messages shrink photos, so ask the driver for the original. The OCR engine stands in for the readers here: Claude reads a small page at least as well as the OCR does, so the floor is conservative for them. A photo also carries margins the scans do not, so its page text sits a little smaller than these numbers. A6's labelled set should re-check both. The driver app's in-app capture keeps its own 1200 (`hazmatExtraction/image.ts`), since there it owns the camera. Four mutants killed (floor 1200 / 640 / 1081, sentence).
- **2026-10-13 — §7B A4: a born-digital PDF's own text is a witness on each hazmat line's count, weight and quantity.** The normaliser has stored every PDF page's text layer since Step 1.3 (`document_pages.text_layer`, 0448), but no read looked at it. Now `textLayerWitness.ts` turns the read pages' stored words into the same row-bound form the OCR engine reports, and `shippingEvidence` judges them with the OCR's own rules (`rowOf`/`rowBacks`). It is recorded as a separate `textLayer` source after the `ocr` one. It is row-bound for the same measured reason the OCR is: exact characters do not stop a whole-page check backing 0132900's wrong "9 drums" with the class 9 printed elsewhere; only the row does. Three rules, each pinned by a mutant: (1) **all read pages or none**. A photo among PDF pages silences it, because the anchor count must see every page (the rule `ocrPages` applies to a failed page). (2) **Words are joined into lines** before the row is found. pdf.js boxes each word, and an id printed "UN 2735" with a space would otherwise never anchor. (3) **Boxes turn with P2's verdict**, so a sideways form inside a portrait page is searched in reading order. The paper audit (D-DR22) and the calculator's field note now read one list of row witnesses, `ROW_WITNESS_READERS` in the shared contract. Every row witness that judged a field must back it, so the OCR finding 6 does not outvote a text layer finding nothing. The field `ocrBacked` became `rowBacked`. Acceptance rule 5 (`cacheKey.ts`); statuses unchanged. **Not measured on real paper:** all ten office samples are scans with no text layer (`pdftotext` gives 0 words on each), and the Samsara corpus is photos. The tests run a pdfkit-drawn BOL through intake's own pdf.js normaliser instead. Born-digital BOLs arrive by email (Q-DR10), so A6's labelled set should include any it gets. 13 mutants killed; one equivalent (field-level `every`→`some`: no form field combines two row-judged paths today).
- **2026-10-13 — the field descriptions' final wording, measured live: engine-field disagreements 18 → 5.** With the Anthropic credit restored, the same comparison was re-run with the same counting, the same ten office BOLs and the same pair (Sonnet 4.6 + Sonnet 5.5), on profile 1.2.0 (the weight column is `grossWeightLb`'s alone). Engine fields: **151 agree / 5 disagree** (baseline 145 / 18; first wording 161 / 20). The five: 0135071's **3,808 vs 3,806 lb**, the known true misread, still caught; two `packaging` on 0134527 where one reader wrote the paper's "5.00 EA" and the other the tote's description; one `packaging` "12" against null on 0133459; and one `marks` "RQ (sodium and potassium hydroxide)" against "RQ" on 0134527. So the copying-the-weight-into-quantity split is gone, `marks` holds notations only, and what remains is one real misread plus how the package column is written. 0132900, re-read alone to check the values and not just agreement: both readers read **6 drums, 11,400 lb** (the paper's), where Sonnet 4.6 read 9 on 10/11. That is one run of a nondeterministic reader, not a fix of that misread; the second reader stays for it. Standard (non-engine) fields: 199 / 68, mostly address formatting (line breaks against commas), which `valuesAgree` deliberately does not normalise. #1456 merged on this.
- **2026-10-13 — N4 measured: retakes are left to the readers, pages are identified by their printed marker, and the audit now reads "1/2" and "Page 1/2" as the same marker (D-DR23).** Three spikes, numbers in D-DR23. The perceptual-hash dedupe the plan named for P6 would have removed real pages: the closest look-alikes in the 196-photo corpus are all different pages on one shipper's form. The classifier reads "page n of m" reliably but the BOL number with digit errors. Both readers, given a page and its simulated retake, read the same lines (0 duplicated in 6 reads) and record both markers. The one change shipped: `auditFieldStates` compares `identity.printedPageNumbers` by each image's parsed page and total (`parsePageMarker`, now exported from `@hazmat/engine`), so the missing-page finding is reachable when the readers word the marker differently, as they did on 0135071. Four mutants killed; one equivalent (dropping the one-reader guard: a missing reader already compares unequal). P3 (rectify) and P5 (quality gate) wait on A6's labels, P3 also on Q-DR21; a Samsara submission can carry several BOLs, so N7 waits on Q-DR25.
- **2026-10-13 — The first real production read: a produce BOL, read correctly, and a screen that did not say so.** Read 5614b556 (Google Voice photo, 1 page) finished in 21 s, 20,386 input / 1,140 output tokens, both readers. They agreed: Little Leaf Farms TN → Walmart DC 3010, BOL IF61469, 252 pieces, 730.8 lb, two lettuce lines, no hazmat line. The classifier answered `delivery_copy`, turned 90°. The screen then showed the paper audit's "Every check passed" (its hazmat shipping-paper rules passing over zero lines, a vacuous pass), filled no product and gave no calculation. The owner read that as a failed prefill. Now, when neither reader reads a hazmat line, the form says "No hazardous materials on this BOL", lists the lines the readers did find, and says nothing on this BOL needs a placard. It hides the audit, and drops an earlier read's lines while keeping typed ones. When the second reader produced nothing, it says only one reader looked and asks for a check of the page instead. Seen in Chromium against a stubbed read of this result; six mutants killed.
- **2026-10-14 — Q-DR14a ruled (b): the triangulation accepts a difference a cited Federal Register rule explains, and a 302.4 cut for 2026-12-02 is ALL CLEAN.** Measured first, on the committed fixtures: Appendix A against Table 302.4 pairs 1,316 substances with no RQ difference; 35 names are only in Appendix A and 24 only in 302.4, mostly the same substance spelled differently, but 302.4 adds PFOA, PFOS (RQ 1 lb) and 1-bromopropane. Title 49 recaptured at eCFR 2026-10-09: HMT 2,479 rows, exactly three disagree with GovInfo CFR-2025, UN0431, UN0335 and UN0101, which 91 FR 51098 (FR doc 2026-16111, effective 2026-09-08, checked against the Federal Register API) republished with special provision 200; its own row prints "75kg", so the cargo-aircraft cell's spacing differs too. Placards, segregation and 302.4 are unchanged and clean. `import/reconciliations.ts` lists those four field differences under the rule; `reconcile` accepts a difference only on an exact match (row, field, both values), from a rule effective after the edition's date and by the capture's date, one listed row for one difference, and fails on a listed row with nothing behind it so the list cannot outlive the next edition. The fuel rows' gate is never reconciled. `captureFixtures.ts` now records the pinned date in `fixtures/ecfr-provenance.json`, and a cut refuses a `sourceEcfrDate` that differs from it, which is what stops 2026.08.0's old promotion command from attesting text nobody reviewed. A dry-run `2026.12.0` cut (2026-10-09, effective 2026-12-02): ALL CLEAN, unattested, nothing saved. Seven mutants killed. Next: cut the two datasets for attestation (one now, one for 2026-12-02); the owner names the attester.
- **2026-10-14 — Datasets 2026.10.0 and 2026.12.0 cut for attestation, both ALL CLEAN and provisional.** Both come from eCFR 2026-10-09 and re-cut byte-for-byte. 2026.10.0 (Appendix A) differs from 2026.08.0 in exactly the three fireworks rows 91 FR 51098 amended, plus `namesChemicalGroup` on 470 entries (125 true); 2026.12.0 differs from 2026.10.0 only in `hazSubstances` (Table 302.4, 1,340 rows). Registered in `src/index.ts`; LATEST stays 2026.07.1. Promotion simulated in memory for each (non-provisional, LATEST): engine 300, golden 4, data 240, API hazmat + document-reading 405, web hazmat 109, all pass. Production read dffc6330 prints its technical name, so the new flag does not change its audit. Checklist and commands: `packages/hazmat-data/datasets/2026.10.0/PROMOTION-CHECKLIST.md`. Owner action: name who attests. The move to 2026.12.0 is a separate merge on 2026-12-01 for the 12-02 release run.
- **2026-10-14 — External audit (Codex/Sol 5.6) checked against the code; D-DR24 ruled (a); migration 0472.** Confirmed: step 3.4's review batch was never built (0 review rows in production) and Calculate took disputed fields as pass A's value; "No hazardous materials" rested on the two readers alone; the 300/600 graduation bars mean ≈ 99 %/99.5 %, not 99.9 %. Already recorded and unchanged: no labelled baseline (A6), correlated readers, Q-DR25, P3/P5. Order taken: (1) D-DR24 — 0472 adds `document_read_reviews.explicit` (default false, not null; three matrix cases, two mutants killed), then the API and the form write and enforce it in the next merge; (2) a stronger negative before "no hazmat"; (3) the arithmetic cross-checks, flagging only.
- **2026-10-14 — D-DR24 built: a disputed BOL field stops Calculate, and every Calculate records its review.** `bolRead/bolReview.ts` derives "disputed" from the evidence the form already held (`agree`, `rowBacked`, `reason`) and adds the line with no product, which `buildEngineLines` had been dropping unseen — an under-placarding path the audit did not name. The field's note offers "Matches the page" and, for a disputed count or weight, "Use 9" / "Use 6"; changing the value settles it too; the calculate handler refuses on its own, not only through the disabled button. Each press posts one batch (`useBolReviews.ts`), not again for an unchanged form; a failed post is a toast and never holds up the placards. The contract's `explicit` is required, the API writes it to 0472's column. 15 rule tests and 5 form tests; 17 mutants killed (one guard removed as dead code: a field neither reader read always "agrees" on nothing). Not seen in a browser: the calculator's BOL path needs the read pipeline stubbed end to end.
- **2026-10-15 — "No hazardous materials on this BOL" needs three witnesses, not two readers (the external audit's second item).** Until now the sentence rested on both model readers returning no hazmat line, and two readers skipping the same small line agree perfectly. Now it is said only when (1) both readers read the paper and read no line; (2) the OCR engine scanned every read page and neither it nor a born-digital page's text layer found a hazmat mark — a UN/NA id, RQ anywhere, or an X standing alone under the HM header (`evidence/hazmatMarkWitness.ts`, recorded as `ocr`/`textLayer` sources on the empty `hazmat.lines` leaf); and (3) the paper audit's §172.201(c) page rule passed, read from the audit rather than redone (`bolRead/bolNoHazmat.ts`). Otherwise the callout turns to a warning, "check the page", with each missing reason in words (`BolNoHazmatNote.vue`). No OCR — engine off, failed, a read replayed from before — is no evidence, never "nothing found". Acceptance rule 6 (`cacheKey.ts`); statuses unchanged. **Measured** with the production engine (PP-OCRv6 medium) on the ten office BOLs: marks found on all nine hazmat papers (UN ids on 9, HM-column X on 6, RQ on 2); none on 0136043, which prints "Shipping Description for non-regulated materials" — the one true negative in the set, so 10/10. 0135071's page 2 alone has no mark; the scan is per document, so page 1's ids count. The HM-column X joins the header item's width when the OCR merges the header with its neighbours (0134322's "H.M. (X) Commodities…"), which can only add marks, i.e. more "check the page". No real non-hazmat photo was scanned (production storage download is denied; the produce read 5614b556 has no stored OCR). Thirteen mutants killed (scan 5, evidence 2, doubts 5, note 1).
- **2026-10-15 — The OCR witness has never run in production; fixed. The audit's "models download at cold start", measured: they download on the first read in each container, ≈30 s.** Checking the audit's claim found a bigger fault: production's log (deploy c20b2d99, 2026-10-13) shows `[document-ocr] engine stopped: Cannot find module '…/ocr/ocrModels.js' imported from …/ocr/ocrWorker.ts` for both real reads, and neither read's evidence has an `ocr` source. Production runs `node --import tsx` on Node **24.10.0** (nixpacks `nodejs_24`, checked in the container), and on that release tsx's loader does not reach a worker thread: Node's own type stripping loads ocrWorker.ts, then cannot map its `.js` import to the `.ts` beside it. Reproduced locally on 24.10.0; 24.22.0 and 26 carry the loader over, which is why every local run and the A5 measurement worked. So every production read so far had no row witness from the OCR, and since #1553 every no-hazmat read would have said "the page was not scanned". **Fix:** the thread starts from a two-line bootstrap that registers tsx (resolved from pageOcr.ts, as the main thread resolved it) and then imports the worker; verified on 24.10.0 and 26 from both working directories. The test starts a fixture worker with `execArgv: []`, so it fails without the bootstrap on any Node release (the mutant fails with production's exact error). **Cold start, measured** on this Mac with an empty cache: first page 38.5 s against 8.5 s warm, i.e. ≈30 s to fetch and verify 132 MB from Hugging Face. It is paid by the first read after each deploy, not at boot (the engine thread starts on a read's first page), and runs beside the two model passes (≈17–21 s in production), so that one read takes ≈20 s longer. Not changed: baking the models into the image (+139 MB, every deploy) or a Railway volume for `DOC_OCR_CACHE_DIR` would remove it — worth it only if the wait is seen to matter.
- **2026-10-15 — The arithmetic cross-checks, measured before building: not built, Q-DR26 opened.** Twenty live reads of the ten office BOLs: no reader filled a per-package weight (0 of 26 lines), and summing line weights against the printed total would flag 0134831, a correct paper whose total includes 760 lb of pallets the profile cannot hold. Numbers and candidates in Q-DR26.
- **2026-10-15 — Q-DR26 re-opened as a reading problem, and its first layer built: the readers are compared by what they mean, not how they type it (L1).** The owner ruled on the analysis of production read d0f2831a (15:11Z, four hazmat lines, eleven other lines): L1 now, then L2–L4, and a person's click stays on every disputed field. Both readers read every count and weight on that paper alike (48/10/3/2 packages, 2,784/2,940/933/1,102 lb); all four package fields were disputed anyway, because one reader copied the shipper's "48.0000 Non-Removable Head Plastic Jerrican" and the other wrote "48 …", so Calculate stopped four times on agreement. Two changes: (1) `normalisedForAgreement` reads a decimal without its trailing zeros ("48.0000" = "48", "5.00 EA" = "5 EA"), never touching the integer part or a dotted run, so a date or a version that differs in one zero still disagrees; (2) the calculator's package-type field agrees when both phrases read as the same type through `packageTypeFromPrinted` ("2 DRUM" and "6 Steel Drums" style wording), leaving the count to `packageCount`'s own evidence, and stays disputed when the types differ or either phrase names none. No acceptance-rule bump: agreement is computed when a read is served, never stored, so the change reaches every read already made. Eight mutants killed. Found while doing it, for L2: `packageTypeFromPrinted` reads "Jerrican" as a pail and does not know "DR", the abbreviation the profile's own field description uses. Next (L2–L4): every row of the paper's freight table as one record with its count and weight, the hazmat mark choosing the list; `freight.tareWeight`/`netWeight`; then the paper's own totals as a witness that can pick between two readings.
