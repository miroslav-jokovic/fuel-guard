# BOL reading reliability — audit and plan · 2026-09-08

**Status:** AUDIT COMPLETE, PLAN PROPOSED — nothing here is built · **Owner surface:**
`apps/api/src/modules/hazmat/hazmatExtraction` + `packages/capture-engine` + `apps/driver` capture +
`apps/web` hazmat review · **Extends:** `SCANNER-UPGRADE-PLAN.md` (the image) and
`docs/18-HAZMATGUARD-PLAN.md` H6/H7/H11 (the reading). Nothing here touches `@hazmat/engine`: the owner
tested the placard calculator on 2026-09-08 and ruled it precise; this document is about what the engine
is *fed*, not what it computes.

**The two questions this answers**, as the owner put them on 2026-09-08:

1. Can the system recover a usable reading from a bill of lading whose *original* is poor — a faded
   copy, a fax-of-a-copy, a shipper template photographed in a cab at dusk?
2. What stops a value that was read *wrongly* from a BOL from ever being handed downstream as fact?

An outside research note of the same day proposed a multi-engine OCR stack (OpenCV, PaddleOCR, Tesseract,
Python worker, Redis) to answer both. §6 records why that stack is not adopted and which three of its ideas
are. The rest of this document is built from this repository, line by line, not from the note.

**Method.** The scanner programme reached trustworthiness one way: measure the actual behaviour, pin it as a
test, derive every threshold from a recorded distribution, and never ship an invented number (D-SCAN1–13).
This plan applies the same discipline to *reading*. Every finding in §1 is cited to a file and line; every
decision in §2 names the finding that forced it; every threshold that does not yet exist says which step
derives it.

---

## 0. Ground truth — what a BOL goes through today

Read end to end on 2026-09-08. Two background audits (driver side, reviewer side) plus a direct read of the
server path; citations are to `main` at `4cf7d97`.

```
 phone   OS scanner (VisionKit / ML Kit)  → cropped, OS-enhanced page (black box)
         ├─ ORIGINAL: iOS re-encodes JPEG q1.0 full-res; Android copies ML Kit's JPEG      (D-SCAN6)
         ├─ ARCHIVE:  1568 px long edge, JPEG q80                                          (uploaded now)
         ├─ measure(): 5 metrics on the ORIGINAL; every floor null → recorded, not enforced (D-SCAN10)
         ├─ OCR (Vision .accurate / ML Kit Latin) on the ARCHIVE → counts + numberTokens[]  (no geometry)
         └─ gate: resolution ≥1200, chars ≥80, words ≥20, median LINE height ≥16 px       (the only live gates)
 upload  archive now; original when unmetered; register row with quality, ocr_evidence, metrics
 server  download ARCHIVE (never the original) → verify sha → normalise+median+resize+webp q80
         → usability gate on uploaded bytes (resolution only enforced)
         → pass A (Sonnet 4.6, prompt A) ‖ pass B (Haiku 4.5, prompt B), both on the SAME images
         → checkAgreement (9 fields by line INDEX) · checkArithmetic (pass A) · resolveHmtLine (pass A)
         → mapBolLines → engine lines (pass A) → declared-vs-extracted (quantity only)
         → evaluateLoad → flags → green (auto-clear) | flagged (needs_review)
 review  flags as sentences · page thumbnails · passA/passB as raw JSON · Attest & clear | Reject
```

### 0.1 The goal this serves — stated by the owner on 2026-09-08, after the audit above was written

> Every driver scans the BOL at **pickup** and at **delivery**, on every load. The system reads it and
> extracts all of its data. For **hazmat** loads the data feeds billing, the placard calculator and a BOL
> audit (shipping papers are sometimes written wrongly). For **non-hazmat** loads it feeds billing.
> **McLeod is the source of truth; this application is a middle man.**

That statement corrects the scope this document was first written under. Three consequences, each
measured against the code:

**(a) There are two capture paths today and neither is the one the goal needs.** The scanner audited
above — native OS scanner, quality gate, integrity hash, dual-pass extraction — is attached to
`hazmat_loads`, a table that is *not* `loads`. The load a driver actually works (`loads`, `load_stops`
with `kind: pickup | dropoff`, ingested from McLeod by `tmsLoadIngest.ts`) has its own photo flow:
`load_stop_photos` with a `bol` slot, taken with `expo-image-picker`, resized, **no** gate, **no** hash,
**no** extraction, and read by nothing but the photo grid (`stopCapture.ts:35`, `driverLoads.ts:108-112`,
0085:213-225). So the BOL a driver photographs at a stop today is never read, and the BOL the system can
read is never attached to a stop. The goal needs one path: the scanner's engine, attached to a stop, at
both stop kinds. Scanner plan Step 6.2 (document profiles; "the capture screen takes a profile and a
destination rather than hardcoding hazmat") is exactly that seam and is no longer optional.

**(b) The strongest wrong-data check available is the McLeod order, and it is free.** For hazmat, the
dispatcher's `declared_lines` is what makes auto-clear defensible (F-EX8). For every load, the McLeod
order is the same kind of thing: `loads.ref`, `commodity`, `hazmat`, `equipment`, and each stop's name,
address, city and state are already ingested. A BOL whose consignee, reference number and pieces match the
order is corroborated by a source that did not look at the photo — the independence D-EXR3 asks for. What
the app holds today is thin: no BOL number, no PO or customer reference numbers, no pieces, no weight, no
consignee reference. Those columns exist in McLeod (`orders`, `stop`, `reference_number`) and widening the
read is a field-gap item of the kind `MCLEOD-FIELD-GAP-PLAN.md` already tracks. Reconciliation strength
is bounded by that read; it is a Phase 0 dependency below.

**(c) "Middle man" fixes what the output is.** The app never becomes the billing truth. Its product per
stop is: the document images (original + archive), the extracted fields with their evidence ledger, a
**discrepancy list against the order** (the BOL audit: wrong consignee, missing BOL number, pieces or
weight off, unsigned or undated delivery copy, OS&D notations), and a **readiness state** the billing
clerk reads. For hazmat the audit additionally runs `validateBol` (§172.202/.203, engine H3, exists) and
the placard engine. Whether any of this is written *into* McLeod is an owner question (§8 Q6); the
integration is read-only SQL over the carrier VPN today and McLeod imaging has no API in this repository.

**What this does to the audit and the plan.** Nothing in F-EX1–13 changes; every defect is in the reading
and review machinery the goal reuses. What changes is the *shape* of three things: the contract (one
shipping-document contract with a hazmat section, not a hazmat contract), the declaration (McLeod order
plus `declared_lines`, not `declared_lines` alone), and the capture's home (`load_stops`, not
`hazmat_loads`). D-EXR10–12 and Steps 0.0, 0.4, 2.0 carry those changes. The word "safety-critical" in
D-EXR4 becomes "safety- or money-critical": a field is cross-checked iff it feeds the engine, the order
reconciliation, or billing readiness.

**Two facts frame everything below.** (a) *No capture has ever completed on a phone* — production holds
zero hazmat loads, documents and runs (scanner plan §6 Q5, measured 2026-09-07). (b) *No reading has ever
been scored against a labelled document.* H11 ("shadow pilot: extraction accuracy vs human-verified truth,
silent errors target 0") was designed for exactly this and never ran. Every statement anyone can make today
about reading accuracy is a statement about code, not about paper.

---

## 1. Findings

Each is `F-EXn`, with the evidence, and with which of the owner's two questions it bears on: **[R]**
recovery from poor originals, **[W]** wrong-data prevention.

### The image the model reads

**F-EX1 [R] — Extraction reads a third-generation image and never the original.** The orchestrator
downloads `storage_path` — the ARCHIVE (`orchestrate.ts:97,111`), which the phone produced as a 1568 px JPEG
q80 (`CaptureNativeModule.swift:307-313`, `.kt:228`) from an image the OS had already enhanced. The server
then contrast-stretches, median-filters and re-encodes it as WebP q80 (`image.ts:50-62`). The full-resolution
ORIGINAL that Phase 4 built and stores forever (`original_storage_path`, 0326/0327) has no reader. On a clean
page this costs little. On a faded copy each lossy generation removes exactly the low-contrast strokes the
reader needs.

**F-EX2 [R] — One page, one image, 1568 px.** Every page is sent whole (`orchestrate.ts:145`). A letter page
at 1568 px on its long edge is ~143 px/inch; 8-point print — the size of most hazmat table rows — is
~16 px tall, which is also the device gate's own legibility floor (`config.ts:203`). Sending the original
whole would not help: the API downsizes large images to about this working size (H6 §12.3, and the reason
`NORMALIZED_LONG_EDGE_PX` is 1568). The only way to give the reader more pixels *per character* is to send
it *less page per image* — a region. Nothing does.

**F-EX3 [R][W] — The one independent reader is discarded.** The phone runs a different OCR engine (Vision or
ML Kit) on every page and ships `numberTokens` in `ocr_evidence` (`hazmatCaptureModel.ts:275`,
`hazmatLoads.ts:237`). Repo-wide, nothing reads that column. The tokens carry no page geometry — both native
modules compute bounding boxes and throw them away (`swift:425-439`, `kt:310-329`) — and are derived
differently per platform (iOS: any run of `isNumber` ≥3; Android: `\d{3,}`; `swift:432`, `kt:317`). It
also runs on the 1568 px derivative, not the original (`swift:318`, `kt:229`).

### Independence of the readers

**F-EX4 [W] — Two readers, one image, one model family.** Passes A and B differ in prompt wording and model
size but read identical bytes (`extract.ts:82-85`). Agreement between them is real evidence against a
*model* slip and weak evidence against an *image* failure: a faded `8` that looks like `B` to one
transformer at 1568 px tends to look like `B` to the other. The design says "two independent reads"; the
independence is partial and unmeasured.

**F-EX5 [W] — Engine inputs that only pass A ever reads.** `checkAgreement` compares nine fields
(`crossValidate.ts:17-28`). It does *not* compare `grossWeightLb`, `perPackageWeightLb`, `packaging`,
`marks` other than the LQ notation, `technicalName`, `pageInfo` or `totalGrossWeightLb`. Yet
`mapBolLines` feeds pass A's `grossWeightLb` and a `packagingKind` derived from pass A's `packaging`
phrase straight into `HazmatLine` (`mapBolLines.ts:129,134`), and the engine's §172.504(c) aggregate is a
sum of exactly those weights against the 1,001 lb line (`compute.aggregate.test.ts`). Declared-vs-extracted
reconciliation checks *quantity* only (`crossValidate.ts:100-108`). So a pass-A-only misread of a gross
weight — `1,200` read as `120` — or of "4 TOTES" as "4 DRUMS" (bulk → non-bulk, `mapBolLines.ts:56-57`)
changes the placard answer with no second reader and no declaration to catch it. The list of compared
fields was written by hand; the list of fields that matter is defined by `HazmatLine`. Root `CLAUDE.md`
names this shape: a copy where a derivation was available.

**F-EX6 [W] — Lines are aligned by index.** `lineDisagreements(a.lines[i], b.lines[i])`
(`crossValidate.ts:39-40`). If pass B drops line 2 of five, lines 2–5 all disagree. Safe — the run is
flagged — but it tells the reviewer four lines are uncertain when one is, and it means a single dropped
line costs the whole page its yield. The digit string of the id is a key both passes almost always agree
on; nothing uses it to align.

**F-EX7 [W] — No field carries its evidence.** The run persists `passA`, `passB`, `flags`, `engineLines`
(`orchestrate.ts:199-212`). It does not persist *why any value was accepted*. `mapBolLines` computes a
per-field `provenance` map (`mapBolLines.ts:63,80,106,137-141`) and the orchestrator drops it
(`extractionRecord` never includes `mapped`). The schema comment on `hazmat_runs.extraction` promises
"per-field confidence + bboxes" (0092:93) and `hazmatLoads.ts:135-137` says the run carries "pass-A
regions"; nothing produces either. H7's field-level correction and pixel crops have waited since July on
"the H6 live bbox run" (`18-HAZMATGUARD-PLAN.md:480`) — but the extraction tool schema has no bbox field
(`vision.ts:55-81`), and a vision model is not a reliable source of pixel coordinates in any case. The
dependency was pointed at the wrong producer; the producer that *does* have geometry is the phone (F-EX3).

### What reaches a human, and what does not

**F-EX8 [W] — There is an auto-clear path, and the comment saying there is not is stale.** `outcome.ts:9-12`
states "nothing auto-clears until H8". `checkEligibility` returns `eligible` when the dataset is attested,
the segregation grid is present and no conditional finding remains (`eligibility.ts:111-122`), and
`hazmatAnalysis.test.ts:40` pins "zero flags (green — auto-clear-eligible)". A clean load with declared
lines whose two passes agree therefore transitions `analysis_green → cleared` with no human
(`orchestrate.ts:222`, `packages/shared/src/hazmatLifecycle.ts:47`). With declared lines that path is well defended — every
extracted line must equal a declared one — *except* for the F-EX5 fields, which the declaration does not
cover. Separately, extracted values reach consumers before any review regardless of outcome: the driver app
renders the verdict and raw flags of a flagged run (`app/hazmat/[loadId].tsx:127-130`) and the Defense
Packet PDF renders for any run under `canView` (`routes/index.ts:288-297`).

**F-EX9 [W] — The reviewer has two verbs and no field.** `ReviewPanel.vue` offers "Attest & clear" and
"Reject" (its only two mutations). `field_confirmed` / `field_corrected` / `cant_read` exist in the contract and the
table (`hazmatApi.ts:365`, 0092:114-116) and are sent by nothing. Evidence shown is a raw JSON dump of both
passes beside untethered page thumbnails (`ReviewPanel.vue:109-143`). Even if the UI sent `field_corrected`,
`recordReview` writes the row and stops (`hazmatLoads.ts:328-338`): no new run, no engine call, no
transition. `packages/shared/src/hazmatLifecycle.ts:49` documents the intended "reviewer resolves flags → re-run green +
attestation"; no code implements it. A reviewer who spots a wrong value today can only reject the whole
load or attest to a verdict computed from the wrong value.

**F-EX10 [W] — The cache can replay a wrong read forever, across loads.** Key =
models ‖ prompt ‖ normaliser ‖ engine ‖ dataset ‖ qualification digest ‖ normalised page bytes
(`orchestrate.ts:109-123`). Hit → copy verdict, outcome and flags into a new run (`:151-160`). Not in the
key: `declared_lines`, `tank_state`, `carrier_relationship`, `claimed_no_placards`,
`special_permit_numbers` — all of which the *manual* path hashes (`hazmatAnalysis.ts:43-52`). So two loads
with the same photo and different declarations share one verdict *including the reconciliation flags
computed for the other load*; and a `rejected` review or a correction never invalidates anything, because
reviews are not a key term. The first green misread of a photo is the permanent verdict for that photo.

**F-EX11 [W] — `integrity_mismatch` is clearable on the plain checkbox.** Raised with a null verdict when
the downloaded bytes are not the gated bytes (`orchestrate.ts:131`); absent from `UNCLEARABLE_CODES`
(`packages/shared/src/hazmatReview.ts:22-25`) and from `FLAG_LABELS` (`reviewModel.ts:51-70`). The one flag that says "we do
not know what image this was" needs no override reason.

### The driver's side

**F-EX12 [R] — Rejection is all-or-nothing, mostly unreachable, and names no region.** `decideCapture`
refuses the whole scan if any page fails (`hazmatCaptureModel.ts:88-128`) and deletes every file
(`capture.tsx:66`); there is no preview, no per-page retake, no thumbnail. Because every image floor is
`null`, the only reachable native rejections are resolution, text count/line height, page count and
scan-level errors; the blur/glare/shadow copy ("hold steady", "tilt away from the light") is dead text.
`pageRejections` is computed and ignored by the screen (`capture.tsx:144`). A driver with a ten-page BOL
and one soft page re-shoots ten pages and is told nothing about which one or why.

**F-EX13 [R][W] — Nothing is measured.** No labelled corpus, no per-field accuracy, no false-accept rate,
no yield, no cost-per-page reading. The `fixtures/real/private/` folder, the PII rule and the 48-shot
target list exist (scanner plan Step 0.1) and hold zero photographs. H11's deliverable 4 — "external OCR
pass C decision *from corpus metrics*" — is the research note's central question, and the repository
already scheduled it to be answered by a number.

---

## 2. Decisions

**D-EXR1 — A field is a claim with evidence, not a value.** (Forced by F-EX5, F-EX7.) Every field the
pipeline emits carries a ledger: each source that read it (pass A, pass B, device OCR, a region re-read, a
declaration, an arithmetic identity), what each read, and from which image. Acceptance is a *function of the
ledger*, the function is versioned and recorded on the run, and — exactly as D-SCAN10 does for image
metrics — it runs in shadow on the corpus before it is allowed to accept anything on its own.

**D-EXR2 — Recovery never invents pixels.** (Forced by F-EX1, F-EX2, and the H6 rule "a 3 must never become
an 8".) The ladder in §3 is: the original's bytes → a region of the original at native resolution → a
deterministic contrast view of that region → stop. No super-resolution, no binarisation of a model-facing
image, no fuzzy "correction" of an identifier. A field a human cannot read from the original's pixels is
`unreadable`; the answer to `unreadable` is a recapture of a *named page and region* or a value typed from
the paper, never a guess. The research note agrees with this rule and then proposes Real-ESRGAN as "one
extra candidate version"; it is not one here.

**D-EXR3 — Independence is a property of the reader and of the image.** (Forced by F-EX3, F-EX4.) Two
readers of one image share the image's failures. A vote counts as independent when it comes from a
different engine (the device OCR) *or* a different view of the original (a region crop). Agreement between
pass A and pass B on a whole-page image is one vote of a kind, not two.

**D-EXR4 — The cross-checked set is derived, never listed.** (Forced by F-EX5; widened by §0.1.) A field
is safety- or money-critical iff it maps into an engine input (`HazmatLine`), into the order
reconciliation, or into billing readiness. `checkAgreement` compares that set by construction, and a test
that walks the three consumers' input types proves no such field is read from one pass alone.

**D-EXR5 — Lines align by key.** (Forced by F-EX6.) Readers are matched line-to-line on the id's digit
string, then the normalised name; a line one reader lacks is *that* line's flag.

**D-EXR6 — Nothing leaves review unrecorded, and nothing is replayed past a review.** (Forced by F-EX9,
F-EX10.) A correction is a new run through the engine with the corrected field's source recorded as
`reviewer`, never an edit to a run. The extraction cache key carries everything the manual path hashes,
plus a per-load review epoch, so a rejected or corrected read cannot be served again.

**D-EXR7 — Auto-clear is a policy with a measured false-accept rate, and its default is off.** (Forced by
F-EX8, F-EX13.) Until the §5 corpus produces the number, `analysis_green` requires attestation like every
other outcome. This restores the invariant `outcome.ts` already claims; it does not remove a capability
anyone has used, because no run has ever existed.

**D-EXR8 — The driver is told the page and the region, and re-shoots only that.** (Forced by F-EX12.) The
per-page verdict the model already computes reaches the screen; a page's rejection names its reason and,
once §3 L2 exists, its region.

**D-EXR9 — Measurement before machinery.** (Forced by F-EX13.) The labelled corpus and the four numbers —
per-field accuracy, false-accept rate, yield, cost per page — come first, and every later step ships with
its number on that corpus. The research note's engine choices (Tesseract, PaddleOCR, Surya) are decided by
H11 deliverable 4, on those numbers, or not at all.

**D-EXR10 — One capture path, attached to the stop.** (Forced by §0.1(a).) A document is captured by the
scanner engine against a `load_stops` row and its kind (`pickup` → the shipper's BOL; `dropoff` → the
signed delivery copy). `hazmat_loads` links to the same document rows when `loads.hazmat` is true rather
than owning a second capture. The `load_stop_photos` `bol` slot is retired into this path; the other slots
(trailer, seal, damage) stay photos — they are not read.

**D-EXR11 — The declaration is the McLeod order, plus `declared_lines` for hazmat.** (Forced by §0.1(b).)
Every load has a declaration to reconcile against; a load without one (no McLeod match) is treated like a
driver-self-created hazmat load today — it never auto-accepts. The reconciled field set is whatever the
McLeod read supplies, and the plan's yield number is measured per field so a thin read shows up as low
yield, not as false confidence.

**D-EXR12 — The output is verification, never truth.** (Forced by §0.1(c).) Per stop the app emits the
images, the ledger, the discrepancy list against the declaration, and a readiness state
(`unread | reading | needs_confirmation | verified | discrepant`). No field the app read is presented to
billing as the value of record without either matching the order or carrying a reviewer's confirmation.
Writing into McLeod is not assumed (§8 Q6).

---

## 3. The recovery ladder — a poor original, read as far as it honestly can be

Each rung is deterministic, versioned on the run, and adds pixels or contrast *from the original*. A rung
is entered only when the ledger marks a field uncertain after the previous rung; a clean page pays for L1
alone.

| Rung | What | Why it is allowed | Where the pixels come from |
|---|---|---|---|
| **L0** | Gate on the original's metrics (exists: D-SCAN4, shadow) | measurement, not alteration | ORIGINAL |
| **L1** | Whole-page read from the **ORIGINAL**, conservatively normalised, bounded to 1568 px | one fewer lossy generation than today; same pipeline otherwise | ORIGINAL |
| **L2** | **Region re-read.** For each uncertain field, crop the region from the original at native resolution (bounded to 1568 px per crop → 2–3× the pixels per character of L1) and read the crop with a narrow prompt ("transcribe this table row") in both passes | cropping discards nothing and invents nothing; it is what a human does with the paper | ORIGINAL |
| **L3** | **Contrast view of the crop** — grayscale + local contrast (the MACHINE profile of D-SCAN11, applied to a region, never binarised) as a *second view* of the same crop; counts as evidence only in agreement with L2's plain crop | a monotone local-contrast transform cannot merge or split strokes the way sharpening or thresholding can; and it never stands alone | ORIGINAL |
| **L4** | Stop. Field → `unreadable`, with page and region. Driver recapture (D-EXR8) or reviewer manual entry with the crop beside the input | the original's pixels are exhausted | — |

**Where L2's regions come from — two sources, one deterministic fallback.** (a) The phone's OCR already
computes word boxes on every page and discards them (F-EX3); returned to JS and uploaded as
`ocr_evidence.words[{text,bbox}]`, they locate every digit string on the page at zero server cost.
(b) Where no device geometry exists (manager uploads, `expo_camera` fallback), a fixed **band tiling** —
the page cut into overlapping horizontal bands at 2× the L1 scale — is the fallback: no detection, no
model in the loop, the hazmat rows are in whichever band the id digits land in. Tiling is the floor; device
geometry is the refinement.

**What the ladder does not contain, and why.** Deskew (the OS scanner did it; on a fax-of-a-copy the skew
is in the *paper* and the OS corrected the *photo*). Adaptive threshold or binarisation of a model image
(H6's rule; a broken stroke thresholded is a different character). Super-resolution (invents strokes).
Multiple whole-page "enhanced versions" — the research's eight variants are a strategy for engines that are
fragile to preprocessing; a region at real resolution is worth more than any filter over the whole page,
and M4/M5 already showed that our own resampling manufactures artefacts.

**Cost.** A page image at the working size is on the order of 1,500–2,500 input tokens per pass
(replace with the measured figure from `org_usage_month` after the first real run). Dual pass on Sonnet 4.6
+ Haiku 4.5 is on the order of a cent per page; each L2 region adds a fraction of that. A three-page BOL
with four uncertain rows stays under a dime against a $2.00 verdict price (GTM doc). The per-org monthly
budget already gates it (`orchestrate.ts:163-166`).

---

## 4. The prevention system — how a wrong read fails to become a fact

Five layers, each catching what the previous cannot. Today the pipeline has parts of layers 2 and 3 and
none of 1, 4 or 5 in usable form.

1. **Evidence ledger (D-EXR1).** `fieldEvidence[]` on the run: `{path, value, sources[{reader, image,
   value}], agreement, status}` for every field of every line. It is *the* review record and *the*
   auto-accept input. It lives in `hazmat_runs.extraction` (jsonb, exists) — no migration.
2. **Complete, keyed cross-check (D-EXR4, D-EXR5).** Every engine input compared across every reader; lines
   matched by id.
3. **Independent corroboration (D-EXR3).** Device OCR digits support or contradict every digit field (id,
   phone, weights, counts, quantities); a region re-read is a second *view*. A field's status is
   `accepted` only when the ledger shows agreement across two independent kinds of evidence — reader ×
   reader is one kind; reader × device, reader × declaration, reader × arithmetic identity, view × view are
   the others. The exact rule is derived in §5, not written here.
4. **Review that can act on a field (D-EXR6).** The reviewer sees each field's status, its sources, and
   the crop it came from; confirms or corrects it; a correction produces a new run. `integrity_mismatch`
   is unclearable. The queue shows a risk signal (count of `confirm`/`unreadable` fields).
5. **Acceptance policy with a number (D-EXR7, D-EXR9).** `accepted` / `confirm` / `unreadable` per field;
   run outcome from field states; auto-clear only on a measured false-accept rate, default off.

What this does *not* promise: that a bad BOL is read correctly. It promises that a bad read is *visible* —
as `confirm` or `unreadable`, with the pixels beside it — and that the thing a human corrects is the thing
the engine then computes from.

---

## 5. Measurement — the four numbers, and what produces them

**Corpus.** Real BOL photographs into `packages/capture-engine/fixtures/real/private/` (gitignored, PII
rule already written), each with a `labels.json` transcribed by a human from the paper: every `BolFields`
value plus a per-page quality band (`clean` / `soft` / `copy` / `damaged`, assigned by eye, recorded with
the assigner). Target: 40 documents across at least five shippers, at least ten in `copy` or `damaged` —
poor originals are the point — and, per §0.1, at least half **non-hazmat** and at least ten **signed
delivery copies**, because the fields billing reads (BOL number, consignee, pieces, weight, signature,
receiver, delivery date, OS&D notations) are absent from a hazmat-only corpus. Photographs come from the device session (scanner handoff §5) and from the
office scanner; both routes are labelled the same.

**Runner.** `pnpm --filter @silvicom/api bol:score` — runs `runExtraction` against the corpus with the real
extractor (spends tokens; prints the spend), then reports:

| Number | Definition |
|---|---|
| **Field accuracy** | per field path, per quality band: fraction of fields whose `accepted` value equals the label |
| **False-accept rate** | fraction of `accepted` fields whose value ≠ label — *the* safety number; the target is zero on engine inputs |
| **Yield** | fraction of fields `accepted` without a human — the number the product sells |
| **Cost** | input+output tokens per page, per rung |

Every step in §7 that changes reading, checking or acceptance ships with this table before and after, in
its PR description and in §9. A step that improves yield and moves false-accept off zero on an engine
input does not merge.

**Shadow weeks.** Once real loads flow, H11's four-week shadow applies unchanged: every reviewer
correction becomes a corpus label; the false-accept rate is re-measured weekly against those; the
acceptance rule is re-derived from the corpus, never hand-tuned.

---

## 6. The research note — what is taken, what is not, and why

**Taken.** (1) *An independent engine as a third vote* — but the engine is the device OCR that already runs,
returned with geometry (§3, §4 layer 3), and a server-side Tesseract pass is decided by §5's numbers per
H11 deliverable 4, not adopted on the note's table. (2) *Fuzzy matching against known data* — only where
the repository's own doctrine allows it: `resolveLine.ts:16-21` already forbids similarity scores in the
accept path ("Heptanes UN1206 / Hexanes UN1208"), and the note's example — OCR reads `C0STC0`, correct to
`COSTCO` — is exactly the move that doctrine exists to stop on an identifier. Fuzzy ranking orders
*suggestions to a reviewer*, as it does today. (3) *A correction log that becomes ground truth* — it exists
(`hazmat_reviews.field_corrected` with old/new value); what is missing is a producer (F-EX9) and a
consumer (§5).

**Not taken.** A Python worker, OpenCV, PaddleOCR, Redis/BullMQ and MinIO. The stack is Node on Railway via
Nixpacks with Postgres-as-queue locked by decision Q1 of `P0-WORKER-QUEUE-PLAN.md` ("no Redis / BullMQ /
SQS") and Supabase storage; every metric already has three parity-gated implementations and a fourth in a
fourth language would need a fourth harness. PaddleOCR on a CPU-only host is slow and gains nothing the
region ladder does not, because the reader's limit here is *pixels per character*, not engine choice. Eight
whole-page enhancement variants (see §3). Regex-per-shipper field extraction — the model reads layout; a
regex layer is a template per customer, which root `CLAUDE.md` names as the workaround shape. Signature
detection and document classification — not hazmat-BOL problems; the day another document type exists,
`shipperCertification` shows the model already answers presence questions and Step 6.2 of the scanner
plan supplies the profile seam.

The note's strongest sentence is one this repository already lives by: *chase 100% wrong-data prevention,
not 100% OCR.* Its weakness is that it was written without the pipeline in front of it: it proposes
building the deterministic placard engine, the dual read, the review queue and the correction log, all of
which exist, and does not see the six defects (F-EX5–F-EX10) in what exists.

---

## 7. Phases

One step per branch and PR, merged when green; each step names its build, its verification and its
done-when; every step from Phase 2 on ships with the §5 table. Order is chosen so that the wrong-data holes
that need no corpus close first, the measurement harness exists before any reading change, and the
recovery ladder is built rung by rung against numbers.

### PHASE 0 — Measurement, and the two dependencies §0.1 exposed (nothing about reading changes)

**Step 0.0 — The scanner captures against a stop (D-EXR10).** Scanner plan Step 6.2 built as specified —
a `DocumentProfile` and a destination threaded through `scan()` — plus a `stop_id`/`kind` on the document
row and a registration route under `/api/me/loads/:loadId/stops/:stopId/documents` that reuses
`registerDocument`'s contract (integrity hash, metrics, ocr_evidence). The stop screen's `bol` slot opens
the scanner; the other slots are untouched. `hazmat_loads` gains a nullable `load_id` so a hazmat load
links to the operational load rather than duplicating it. *Migration:* additive columns, no reader in the
same merge. *Done-when:* a pickup and a dropoff on one load each hold a scanned, hashed, extracted
document, and the hazmat panel shows the pickup one when `loads.hazmat` is true.

**Step 0.4 — Widen the McLeod order read (D-EXR11).** The fields the reconciliation needs and the app
does not hold: BOL number, customer/PO/consignee reference numbers, pieces, weight (with its `_um`,
D-FG2), commodity description per stop. Read per `MCLEOD-FIELD-GAP-PLAN.md`'s method — verify the column
on the linked sandbox first, never assume — into additive `loads`/`load_stops` columns. *Done-when:* the
scorer's declaration for a non-hazmat corpus document is populated from the ingested order, and the table
prints per-field yield against it.

**Step 0.1 — Corpus format and labeller.** `fixtures/real/private/<doc>/{pages/*.jpg, labels.json}`;
`labels.json` is `BolFields` + `{pages:[{band, assignedBy}]}` validated by the existing Zod schema. A
`README` paragraph on how to transcribe from the paper, not from the photo. *Done-when:* a labelled
document round-trips through the schema.

**Step 0.2 — The scorer.** `bol:score` as in §5, injectable extractor so the same runner scores a
recorded run without spending. Reports the four numbers per band and per field path; writes a JSON
beside the corpus for diffing. *Verify:* a label deliberately altered on one field moves exactly one
field's accuracy. *Done-when:* the table prints for a corpus of one.

**Step 0.3 — First measurement.** The device session (scanner handoff §5, unchanged) plus the office-scanner
route fill the corpus to the §5 target; `bol:score` runs on `main` as it stands. **The output is the
baseline every later step is compared to, and it is recorded in §9 verbatim.** Until this step, no reading
change merges.

### PHASE 1 — Close the holes that need no corpus (pure correctness; each is a test-first PR)

**Step 1.1 — The cross-checked set is derived (D-EXR4).** `checkAgreement` compares every field that
`mapBolLines` reads into `HazmatLine` (adds `grossWeightLb`, `perPackageWeightLb`, `packaging`, all
`marks`, `technicalName`, `pageInfo`, `totalGrossWeightLb`). *Verify by mutation:* remove one field from
the comparison; a test that walks `HazmatLine`'s keys fails. *Done-when:* F-EX5's `1,200`/`120` example is
a `pass_disagreement:grossWeightLb:lineN` flag.

**Step 1.2 — Key alignment (D-EXR5).** Match lines on id digits, then normalised name; unmatched lines flag
individually; `line_count` disagreement survives. *Verify:* a five-line fixture with pass B missing line 2
raises one flag, not four.

**Step 1.3 — Cache key completeness and the review epoch (D-EXR6).** Key gains the manual path's context
terms and `hazmat_loads.review_epoch` (int, bumped by `rejected` and by every correction). A cache hit is
also refused when the source run's load has a `rejected` review. *Migration:* one column with a default,
no reader in the same merge (`lint:migration-ordering`). *Verify:* the same photo on two loads with
different `declared_lines` produces two runs.

**Step 1.4 — `integrity_mismatch` joins `UNCLEARABLE_CODES` and `FLAG_LABELS`.** *Verify:* the existing
`checkHazmatClear` test table gains the row.

**Step 1.5 — Auto-clear behind policy, default off (D-EXR7).** `hazmat_policies.policy.autoClearEnabled`
(jsonb, no migration); `analysis_green` with it off lands in `needs_review` with zero flags and the label
"Read clean — attest to clear". `outcome.ts`'s comment is rewritten to say what is true. *Verify:* the
"zero flags (green — auto-clear-eligible)" test asserts `needs_review` under the default policy.

**Step 1.6 — Provenance persists.** `extractionRecord` carries `mapped.lines[].provenance` and
`resolution`. No reader yet; the ledger in 2.x is built on it.

### PHASE 2 — The ledger and the third vote

**Step 2.0 — One shipping-document contract (§0.1).** `shippingDocumentContract.ts` in
`packages/shared`: sections `identity` (BOL number, date, page-of), `parties` (shipper, consignee, bill-to),
`references` (PO, customer, consignee refs), `freight` (pieces, pallets, weight + unit, seal, trailer),
`hazmat` (today's `BolFields.lines` and its header items, unchanged), `execution` (shipper certification,
receiver signature present, receiver printed name, delivery date/time, stamps, OS&D notations). Both
passes read the whole contract; the hazmat section is required only when `loads.hazmat`; the `execution`
section is expected only at a `dropoff`. `BolFields` becomes a projection of it, so nothing in the hazmat
path is rewritten. *Verify:* the existing 69 extraction tests pass unchanged against the projection.

**Step 2.1 — `FieldEvidence` contract** in `packages/shared` (`hazmatEvidenceContract.ts`): the §4 shape,
statuses `accepted | confirm | unreadable`, `ACCEPTANCE_RULE_VERSION`. The rule in this step is the *most
conservative* one — `accepted` only when every source agrees and at least one source is not a whole-page
model read — and it is recorded on the run.

**Step 2.2 — Device OCR unified and returned with geometry.** Both natives derive tokens as ASCII `\d{3,}`
on the ORIGINAL (not the derivative), return `words[{text, bbox}]` in page coordinates alongside the
aggregates; `ocr_evidence` gains `words` (jsonb already). iOS build and parity harness per scanner plan
§3.4. *Verify:* the fixture corpus's rendered digits are found at the coordinates the generator wrote them.

**Step 2.3 — The server reads `ocr_evidence`.** For every digit field, the ledger records `deviceOcr:
supports | contradicts | absent`. *Verify by mutation:* a pass-A/pass-B-agreed id that the device tokens
contradict is `confirm`, never `accepted`.

**Step 2.4 — The ledger replaces the JSON dump.** `ReviewPanel` shows a per-field table: value, status,
sources; `HazmatReviewPage` shows the `confirm`+`unreadable` count. No crops yet. *Done-when:* a reviewer
can say which field is uncertain without reading JSON.

### PHASE 3 — The recovery ladder

**Step 3.1 — L1: read from the ORIGINAL.** Orchestrator prefers `original_storage_path` when present and
verified against `integrity_hash`, falls back to the archive with the fallback recorded on the run.
`IMAGE_NORMALIZER_VERSION` bumps (cache hashes change by design). *§5 table before/after.*

**Step 3.2 — L2 with band tiling.** For every `confirm`/`unreadable` field after L1, crop its band from
the original at 2× L1 scale and re-read in both passes with the row prompt; ledger gains `region` sources.
*Verify:* on the `copy` band of the corpus, accuracy on engine inputs rises and false-accept stays zero, or
the step does not merge.

**Step 3.3 — L2 refined by device geometry.** Where `ocr_evidence.words` exists, the region is the word
box's row, padded; tiling remains the fallback. *Verify:* the region sent contains the labelled value's
text for ≥95% of corpus fields that have device geometry.

**Step 3.4 — L3: the contrast view.** MACHINE profile (D-SCAN11) implemented in `sharp` on the crop, sent
as a second image in the same region read; counts only in agreement. *Verify:* the scanner plan's own
6.1 test — improves the `soft` band, does not "improve" the `damaged` band.

### PHASE 4 — Review that acts on a field

**Step 4.1 — Crops in the panel.** The ledger's `region` renders as an image beside each field (signed URL,
server crop from the original). **Step 4.2 — Confirm / correct per field.** `field_confirmed` and
`field_corrected` are sent; a correction enqueues a new run with `reviewer` as that field's source, epoch
bumped (1.3), engine re-evaluated. `clearLoad` refuses while any engine-input field is `unreadable` and
uncorrected. **Step 4.3 — Clear is atomic** (attestation row and transition in one RPC; the note at
`hazmatLoads.ts:344-345` closes).

### PHASE 5 — The driver re-shoots one page

**Step 5.1 — Per-page verdicts reach the screen.** `pageRejections` renders as a page list with reason;
accepted pages are kept and only rejected pages are re-shot (the OS scanner session is re-entered for a
single page; result spliced by page number). **Step 5.2 — Region guidance.** When a server run marks a
page's field `unreadable` with a region, the driver's load screen shows the crop and "re-shoot page N,
the hazmat rows" — the notification path exists (`hazmatNotify.ts:31-49`).

### PHASE 6 — The acceptance policy earns its number

**Step 6.1 — Derive the rule.** From the corpus and the first shadow weeks: which evidence combinations had
zero false-accepts on engine inputs; the rule becomes `ACCEPTANCE_RULE_VERSION` n+1 with the derivation in
§9. **Step 6.2 — The auto-clear decision.** With the number in hand, the owner decides
`autoClearEnabled` per org. **Step 6.3 — H11 deliverable 4.** With per-field accuracy per band known, decide
whether a server-side Tesseract digit pass adds an independent vote the device OCR does not; record the
decision and its number here, either way.

---

## 8. Open questions — each with the decision the code takes until answered

**Q1 — Should any run auto-clear before Phase 6?** *Recommendation and default:* no (D-EXR7). The
capability has never been exercised; switching it off changes nothing observable.

**Q2 — Corpus size and source.** §5 says 40 documents, ten poor. *Until answered:* the scorer runs on
whatever exists and prints the count beside every number, so a table from five documents cannot be
mistaken for one from fifty.

**Q3 — Does word geometry from the phone raise a privacy question?** Boxes are coordinates, not content;
the words themselves are the same text the model reads. *Until answered:* `words` uploads only for
`kind: bol` under the existing hazmat RLS.

**Q4 — Which model is pass A?** The pinned defaults are Sonnet 4.6 and Haiku 4.5. A newer generation may
read poor copies better; a model change also invalidates every cached verdict by design. *Until answered:*
no change — Step 0.3's baseline is taken on the pinned pair, and a model swap is a Phase 3 step scored like
any other.

**Q5 — Band count for tiling.** *Until answered:* three overlapping horizontal bands at 2× (each ≤1568 px
long edge for a letter page), chosen so a table row is never split; Step 3.2 records the number that
maximised accuracy on the corpus.

**Q6 — Does anything get written into McLeod?** The integration is read-only SQL over the VPN; McLeod
imaging has no API here. Candidates: (a) nothing — the billing clerk works from the app's readiness
queue and packet; (b) an export (PDF + fields) named per McLeod order for the clerk to attach; (c) a
McLeod write path, which is a separate integration programme. *Recommendation and default:* (a) now,
(b) as a Phase 4 step once readiness exists; (c) only on an owner ruling with the McLeod side's
agreement.

**Q7 — Which fields does billing require to call a load billable?** The `execution` and `freight`
sections in Step 2.0 are a guess at what the clerk checks today. *Until answered:* the readiness state
requires BOL number, consignee match, pieces, signature present and delivery date on the dropoff copy;
the list is a contract constant so the owner's answer is one edit.

**Q8 — Pickup scan, delivery scan, or both, for non-hazmat loads?** The owner said both. *Default:* both
required; the stop's `required_photos` already models "required at this stop", so per-customer relaxation
is dispatch configuration, not code.

---

## 9. Progress log

Append dated lines at the end; never edit a row above. (`plan-progress-log-not-table-rows`.)

- **2026-09-08** — Audit complete: F-EX1–F-EX13 from a full read of the phone-to-verdict path plus two
  background audits (driver, reviewer). Decisions D-EXR1–9 and Phases 0–6 proposed. Nothing built.
- **2026-09-08 (later)** — Owner stated the goal (§0.1): every load, pickup and delivery, hazmat and
  non-hazmat, billing as a consumer, McLeod the source of truth, the app a middle man. Scope corrected:
  D-EXR10–12 added; D-EXR4 widened to money-critical fields; Steps 0.0 (capture on stops), 0.4 (McLeod
  order read), 2.0 (one shipping-document contract) added; corpus target widened; Q6–Q8 opened. The
  audit's findings are unchanged — the goal reuses the same reading and review machinery.
