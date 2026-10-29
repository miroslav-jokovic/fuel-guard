# The two-click reader — precise, reliable, organised, production-ready (plan of 2026-10-29)

Owner, 2026-10-29: *"Too many misread things. When read it is asking to double-check everything (almost). Reading
taking 30 sec to 1 min. The page itself looks confusing and unorganized. When we use our reader we should get
precise data written on the page and the form part should be hidden. We have to make this a 2-click, easy-to-use
feature for dispatchers, reliable and precise."* Then: *"write a plan for making it 100 % precise, reliable, well
organized and designed, production-ready and complete."*

This plan is the whole feature — reader, table, engine, screen, driver path, release — in one register. It sits under
`READER-CORRECTNESS-PLAN.md` (its two promises P1/P2 and D-RC1–D-RC4 stand), absorbs the open steps of
`PLACARD-CALCULATOR-RELIABILITY-PLAN.md` (PC3–PC8, Q-PC2/3/6), and adds what two audits of 2026-10-29 found: an audit
of the placard engine against the CFR and the shipped dataset, and a measurement of the reader on every production
read. Both audits' measurements are restated in §2 so nothing here rests on a document outside the repo.

---

## 0. What "100 %" means here, said precisely

A vision model reading a texted photo will sometimes read a 4 as a 1. No reader on the market promises otherwise,
and this plan does not. What the feature CAN promise, and what "100 % precise and reliable" is defined as for every
step below:

- **P1 — never silently wrong.** No value reaches the placard engine, the shipping-paper audit or the record unless
  two independent witnesses agree on it or a person has looked at that one value. False-accept on a critical field
  (UN/NA number, class, PG, packing group, count, weight, LQ) = **0** over every census and every stored read, and
  that figure is a merge gate (`lint:reader-gate`). This is READER-CORRECTNESS-PLAN P1, unchanged.
- **P2 — no needless stop.** On a legible, correctly printed paper the dispatcher is asked **nothing**: the pending
  count is 0 and the audit shows 0 failures. A stop on an illegible or wrong paper is the feature working. Measured on
  the replayable production reads and the golden censuses; today's count on the nine reads is the baseline.
- **E — the engine is the regulation.** For every row of the Hazardous Materials Table, in every packaging, on every
  equipment, the placard set, the ID displays, the marks and the segregation verdict are what 49 CFR says — proven by
  the whole-table censuses, with the CFR paragraph cited correctly on every finding. Where the engine refuses a load
  (Table 1 scope), it says so; it never guesses.
- **Two clicks.** Drop the paper (one) → Calculate (two). Nothing else on a clean paper. A disputed value is a choice
  on the page, not a form to fill.
- **Fast.** p50 ≤ 15 s, p90 ≤ 30 s for a one- or two-page paper, measured on the read row itself.
- **Production-ready and complete** is the checklist in §5: nothing merged-but-unreleased, nothing measured-but-unbuilt,
  one reading pipeline, every stage timed, every known defect of §2 closed or ruled out by the owner in §6.

---

## 1. The short version

The reading was right on nearly every digit the owner checked; what the owner saw as misreads were the table refusing
correct papers (fixed in PC1/PC2, **not released**), weights in kilograms left blank (PC3), and one real digit misread
that both readers made because **both were handed the page shrunk to 1,568 px** — the page is sized for pass A's model
tier, and pass A is pinned to a standard-tier model. The double-checking is the same refusals plus a findings panel
above the lines (PC6) plus genuine two-reader disagreements with no third opinion. The time is six parallel model
requests, one of them thinking at high effort on a copying task, plus an OCR thread that starts cold on every read
because reads are days apart; none of it is timed, so the 88-second read of this afternoon cannot be explained from
its row. The page is a manual form with a reader bolted on top, so everything the form asked before a read is still
asked after one.

The engine, called "right on every verified load" on 2026-10-26, has four wrong answers of its own on the shipped
dataset — one of them a false *violation* that blocks every Class 3/4.1/5.1 + Class 6.1 load — and two
self-contradicting inputs. The tests did not catch them because they re-derived the engine's own simplification.

Everything here is deterministic code and data, provable over its whole input space (D-RC1), except the model pin
(a measurement the owner rules on) and the page (a browser pass on three fixtures).

---

## 2. Measured, 2026-10-29

### 2.1 Production reads (every `shipping_document` read since the first on 10/12)

| | |
|---|---|
| Finished reads | 18 (2 stuck `reading` from 10/12 predate the queue fix) |
| Duration | median ≈21 s · p90 ≈44 s · 1f251e08 today, 2 pages, **88 s** · 795bf4bc 13 pages 284 s before #1576, 27 s after |
| Tokens per 1–2-page read | 23k–40k input, 1.3k–6.5k output; models `claude-sonnet-4-6` + `claude-sonnet-5-5` on every read |
| Evidence fields stored | 1,601 — **0 `read`**, 1,290 `check`, 311 `not_read` |
| Review rows | 193 — 170 implicit confirmations (untouched at Calculate), 14 explicit confirmations, 7 page checks, **2 corrections** |
| Page sizes stored | 1500×2000 (15 of 31), 1536×2048 (2), 1200×1600 (3), 960×1280 (3), 810×1080 (4), 768×1024 (2) |
| Sources | 29 of 29 `origin = upload` (office uploads of texted or mailed photos); none from the driver app or Samsara |

### 2.2 The resolution cap (new)

`executeRead.ts` sizes every page ONCE, for `models[0]` — pass A — and sends that copy to both readers. Pass A is
Sonnet 4.6 (D-DR20), a *standard-tier* vision model: 1,568 px on the long edge and 1,568 visual tokens. Pass B, Sonnet
5.5, is a *high-resolution-tier* model (2,576 px / 4,784 tokens; Anthropic's vision docs, "Claude 4.7 and later") and
never receives the page at that size. Run with the repo's own `visionTier.ts`:

| Stored page | Sent today (standard tier) | What the high tier would take |
|---|---|---|
| 1500×2000 (15 of 31 pages) | 952×1270 — 1.2 of 3.0 MP | 1500×2000, unchanged |
| 1536×2048 | 952×1270 | 1536×2048 |
| 2550×3300 (300-dpi letter scan) | 952×1232 | 1688×2184 |

At 952×1270 a letter page's 7-pt type is about 6 px tall. The 2026-10-20 measurement ("21 of 43 stops pixel-limited,
16 from the one digit UN3264→3254") attributed this to the uploads; the uploads carry 2.6× the pixels the readers are
allowed to see. D-DR20 was ruled on Haiku 5.5 vs Sonnet 4.6 (0 vs 5 wrong UN ids on corpus 7B.2); Sonnet 5.5 made no
error on the same corpus; Opus 5.5 was never measured. The lock predates the knowledge that it is also the cap.

### 2.3 Why every field is "check" and what actually asks for a click

`shippingEvidence.ts` writes `status: nothing ? "not_read" : "check"`; `read` is unreachable until graduation (D-DR5,
off; D-DR17: a model's confidence never makes a field Read). That is policy, and it is not the complaint. The screen
asks for a click (`fieldNeedsAct`) only where the readers disagree, the OCR row contradicts, the totals do not fit, or
the table refused the product. On the nine replayed reads (PLACARD-CALCULATOR-RELIABILITY-PLAN §2): the refusals were
the table's (PC1/PC2), the blank weights the KG column's (PC3), the description splits one punctuation character (PC4).
What remains after those is genuine disagreement, and today there is **no third witness** that could settle it before a
person — a crop of the one disputed cell at full resolution is never asked for.

### 2.4 Where the time goes, and why nobody can say

- 3 sections (identity, load, lines) × 2 readers = 6 structured-output requests in parallel; + 1 Haiku 5.5 classifier
  call per never-seen page (8 at once); + the OCR witness on its own thread; all awaited before `done`.
- Pass B (Sonnet 5.5) is sent **no `output_config.effort`** (`readPages.ts`: "no sampling parameters and no thinking
  parameter") and so runs adaptive thinking at its default effort `high` on a transcription task, with 8,000 of the
  16,000 `max_tokens` reserved for it.
- The OCR engine thread (`pageOcr.ts`) **stops after 120 s idle**; model files live in `DOC_OCR_CACHE_DIR` or
  `os.tmpdir()` (ephemeral per container). Reads are days apart, so every production read starts the thread cold and
  waits for it (`await ocrRun`). The 2026-10-15 note measured ≈30 s on first use.
- **No stage timing is recorded** anywhere — the row holds created/started/finished and tokens. The 88 s of
  1f251e08 is not attributable to any stage from what is stored.
- Production runs `JOB_EXECUTION_MODE=inprocess`: the job runs at once in the API process. The queue is not the wait.

### 2.5 The page

`HazmatCalculatorPage.vue` = `PageHeader` → `BolReadPanel` (drop zone, page thumbnails, Read button, outcome line) →
`HazmatCalculatorForm` (findings panel → product lines → "Rest of the load" → "Trip context" → Calculate) with the
verdict in a right column. After a read: the read card stays, up to 37 findings sit above the lines (PureTech), each
line carries per-field notes, and every manual section is still open. There is no view of *the paper as read*.

### 2.6 Two reading pipelines

The driver app's hazmat capture (`/api/me/hazmat`) runs the older `hazmatExtraction` path: `HAZMAT_MODEL_A`
Sonnet 4.6 + `HAZMAT_MODEL_B` **Haiku 4.5**, its own normaliser, prompt and cache, separate from the document-reading
module the office uses. Two code paths to keep right; the better photos (the driver's camera) go through the weaker one.

### 2.7 The engine on the shipped dataset (audit of 2026-10-29, reproduced on main 67a1052, engine 0.22.0)

Seven constructed loads run through `evaluateLoad` with dataset 2026.07.1; CFR text verified at law.cornell.edu.

| # | Load | Engine says | 49 CFR says |
|---|---|---|---|
| E1 | UN1263 paint (3, PG II) 800 lb + UN1710 trichloroethylene (6.1, PG III) 800 lb, van | **violation** `segregation_prohibited`, eligibility **blocked** | no restriction: §177.848(d)'s only 6.1 row is "6.1 liquids PG I Zone A". `segregation/check.ts` matches the grid by class NUMBER and takes the most severe of every qualified label. Same shape: Class 8 *solid* + 5.1 → "Away From" from the "8 liquids only" row. 534 entries are 6.1. The census test collapses labels with its own `baseOf()` — it proves the engine agrees with a copy of itself |
| E2 | UN3082 (9, PG III) 2,000 lb non-bulk, van | `CLASS_9` **required** (§172.504(a)) | §172.504(f)(9): "a CLASS 9 placard is not required for domestic transportation"; bulk Class 9 still displays the ID number. No §172.504(f) handling exists in the engine |
| E3 | NA1993 combustible liquid 2,000 lb non-bulk, van | `COMBUSTIBLE` required, counted toward 1,001 lb | §173.150(f)(2): non-bulk combustible liquid is not subject to the HMR by motor vehicle (unless hazardous substance / waste / marine pollutant, and even then (f)(3)(iv) keeps placarding for bulk only) |
| E4 | any 4.3-subsidiary entry | DANGEROUS WHEN WET cited **§172.505(b)** | it is **(c)**; (b) is uranium hexafluoride. In the engine, the trace, the census title and the 10/26 plan; shown on the verdict chip and in the defense packet |
| E5 | residue line | excluded from the aggregate (info) AND `not_evaluated:lines[0].isResidueLine` (conditional) | one verdict says "used it" and "ignored it" |
| E6 | the form's vessel question answered "No" | `not_evaluated:portContext.vesselConnected` (conditional) on every calculation, while `marinePollutant.ts:288` reads it | the eligibility probe list is stale; nothing tests it against the rules |
| E7 | UN1263 PG II, `isLimitedQuantity` | `lq_claim_refused … use dataset 2026.08.0 or later` | LATEST is 2026.07.1 (no column 8A); 2026.08.0 is dead; 2026.10.0 waits on a named attester. Every LQ claim is refused with an internal version string on screen |

Also found: a load with no trailer type resolves to `cargo_tank` and every line to bulk with only an `info` advisory
(`resolveVehicleKind` fallback); `referenceText.json` is `0.0.0, provisional, 0 sections` so `/reference/:section`
404s on everything; the dataset is zod-parsed on every `/calc` and `/products` request (10–30 ms warm). What is right
and measured so: §172.504(c)'s "except for bulk packagings and materials subject to §172.505" clause, the §172.504(b)
DANGEROUS bar, the §172.332(c)/§172.334(d) ID carriers, LQ fail-closed, the §172.322 band, PC1/PC2.

### 2.8 What is NOT wrong (so it is not re-litigated)

The acceptance rule (two witnesses or a person), D-DR24 (a) (untouched = confirmed, disputed = a click), the paper
audit's rules, the pairing (RC3), the UN-number settle (Q-RC7), the arithmetic witness, the prepared OCR view, the
sections split (Q-DR11), the cache key, the queue. Each was measured on the stored reads this month and holds.

---

## 3. Decisions

**D-TC1 — Each reader sees the page at its own tier; the pin is re-ruled on a measurement, not an assumption.**
`loadImages` sizes per model (or one high-tier copy for both when pass A is high-tier). Then pass A ∈ {Sonnet 4.6,
Sonnet 5.5, Opus 5.5} × effort {default, `low`} is scored on corpus 7B.2 and the nine replayable production reads by
the figure D-DR20 used (wrong UN ids) plus RC5's defect classes, with cost per read beside each. The owner re-rules
D-DR20 on that table (Q-TC1). Until the ruling, Sonnet 4.6 stays and pass B alone gains the pixels. A prompt change is
never the lever: readers copy to the letter, which agreement rests on, and a prompt cannot be tested offline.

**D-TC2 — A third witness before a person.** When the two readers disagree on one field and the OCR row does not
settle it, the module crops that cell (the OCR's box, mapped through `pageGeometry.ts`) from the stored original at
full resolution and asks one model for that one field under a one-field schema. The crop's answer is ACCEPTED only
when it agrees with one reader's value AND the row/table witnesses fit that value (the Q-RC7 shape); otherwise the field
stays a person's. A few hundred tokens per disputed field. P1 holds: nothing is accepted on one reader's word.

**D-TC3 — Transcription runs without reasoning, once measured.** `output_config.effort: "low"` on every 5.x reader
pass, adopted only when D-TC1's table shows no loss against default effort. Effort is a request parameter, so it is in
the cache key's send rule.

**D-TC4 — Every stage is timed, on the row and in the log.** `document_reads` gains `stage_timings` (jsonb: classify,
fetch+size, passA, passB, ocr, evidence, with ms each) written by the same `document_read_transition`; one `[metrics]`
line per read. The screen's stage text reads the real stage. No speed decision after this is made without the number.

**D-TC5 — The OCR engine is warm.** Started at process boot in the API/worker that drains `document_read`, never
idle-stopped (or idle 24 h), with `DOC_OCR_CACHE_DIR` on a persistent path so a deploy does not re-download. The cold
start the 10/15 note measured is paid once per deploy, never per read.

**D-TC6 — The page is read-first; the form is a fallback.** One card: the drop zone. The read starts when the files
land (click one). The result is **the paper as read**: a lines table (UN/NA, name, class, PG, count, weight, LQ) with
page thumbnails beside it, a state mark per field (agreed · settled by the page · needs you), a disputed value shown as
an inline choice of the readings, and the equipment confirmed from the linked trailer or asked once at the top.
**Calculate** is click two. The manual form collapses to "Enter by hand" and opens only when asked. Below the lines, the
paper check as one folded card (D-PC5). The verdict replaces the read view in the same column; no second column.
Standard page root, `PageHeader`, `BaseCard`, `AppTabs`, badges from `badges.ts` (DESIGN-SYSTEM-CONTRACT §3.3–3.4,
§4.3). Nothing is defaulted that changes the answer: the equipment is asked when it is not on file (there is no safe
default — a van and a tank get different placards), and a disputed field is never shown as a fact.

**D-TC7 — The Calculate press stays; auto-Calculate is a ruling (Q-TC2).** The press is the act the review record is
keyed to (D-DR24) and the moment the dispatcher commits. Auto-read on drop is certain; auto-Calculate when nothing is
pending is offered, not assumed.

**D-TC8 — The segregation grid is matched by its own row, never by class number alone.** For each line the engine
picks the grid label its facts name: Zone A for a 6.1 or 2.3 entry whose special provisions assert it (SP 1 =
Zone A, SP 2 = Zone B, the `PIH_ASSERTING_PROVISIONS` table `tableSelect.ts` already owns), PG I from the `hmtRef`,
liquid/solid from the proper shipping name's phase word or the row; the most-severe-of-all rule applies only where a
qualifier is genuinely unknowable, and then as `conditional`, never `violation`. A violation is a CFR fact about this
load, not a worst case over a qualifier the engine could have resolved. The census builds its oracle from the grid's
own labels, never from a copy of the engine's collapse (the two-helpers trap).

**D-TC9 — §172.504(f) and §173.150(f)(2) are in the ladder.** Non-bulk Class 9 → `permitted`, not `required`, citing
(f)(9); bulk Class 9 → the ID display stays required (the line stays `resolved`; the bucket changes, not the
resolution — `bulkLines` derives from `resolved`). Non-bulk combustible liquid (NA1993, or a Class 3 line the offeror
reclassed under (f)(1)) → no placard, out of the aggregate, with an `info` finding citing (f)(2); bulk combustible
unchanged. The hazardous-substance / marine-pollutant carve-out is decidable from the dataset (`hazSubstances`,
`marinePollutants`) and changes nothing for placards ((f)(3)(iv) is bulk-only).

**D-TC10 — Citations are data, tested.** Every `cfr` string the engine emits must appear in a pinned list of verified
paragraph references (`hazmat-golden/citations.json`, one line per paragraph with the date read and the source URL);
a census asserts it. §172.505(b) → (c) is the first correction. The reference-text store (`referenceText.json`) is
either populated from the same list or the `/reference/:section` endpoint and the D12 promise are removed — a
documented capability that answers 404 on every input is worse than none (Q-TC6).

**D-TC11 — The coverage statement is tested against the rules.** For every probe in `UNEVALUATED_INPUTS` and
`LINE_PROBES`, a test mutates that input and asserts the verdict (minus the input audit) is unchanged; a probe whose
input moves the verdict is stale and fails the build. `isResidueLine` and `portContext.vesselConnected` leave the lists.

**D-TC12 — One reading pipeline.** The driver app's capture reads through the document-reading module (profile
`shipping_document`, the same witnesses, the same evidence), and `hazmatExtraction`'s model pins, prompt and cache
retire. The driver app sends the camera original (Q-RC6 (a)). The migration keeps `hazmat_runs` as the record of the
engine's verdict and links it to the `document_reads` row that fed it.

**D-TC13 — Engine findings go through a catalogue, like BOL findings.** A rule id or a field path never reaches a
screen verbatim (`not_evaluated:portContext.vesselConnected` does today, on the public calculator too). The catalogue
PC2 introduced for the paper audit (`actorFor`, per-reason sentences) gains the engine's rule ids.

**D-TC14 — Nothing stays merged-but-unreleased past the next release train.** PC1/PC2 and every step below ride the
next approved release; the plan's progress log records the release tag beside each merge.

---

## 4. Build order

Each step ships with the whole-space test that would have found it on every BOL or every table row (D-RC1), the
replay of the stored production reads where the reader is touched (D-RC2), false-accept 0 on the gate (D-RC3), and a
line in §7. Steps with no owner column need no ruling.

### Phase TC0 — Stop guessing (one PR each; no answer changes)

| Step | What | Done when | Owner |
|---|---|---|---|
| TC0.1 | Release PC1/PC2 (merged 10/26) | Henkel 4/4 lines, 0 refused, on production | **release approval** |
| TC0.2 | D-TC4 stage timings (migration: `document_reads.stage_timings`), `[metrics]` line, real stage text on screen | the next production read's row names each stage's ms | — |
| TC0.3 | D-TC5 warm OCR engine; persistent cache dir | first read after a quiet day shows `ocr` ms ≈ a warm read's | — (Railway var for the cache path) |
| TC0.4 | D-TC11 probe-vs-rules test; drop the two stale probes | residue line and vessel "No" raise no `not_evaluated` | — |
| TC0.5 | D-TC10 citation list + census; §172.505(c); census title + plan text corrected | every emitted `cfr` is in the list | — |

### Phase TC1 — The engine says what the CFR says

| Step | What | Done when | Owner |
|---|---|---|---|
| TC1.1 | D-TC8 segregation by qualified row; census oracle from grid labels; `check.test.ts` gains 6.1 PG III + 3, 8 solid + 5.1, 2.3 Zone B + 3 | E1 → `segregation_none`; every 6.1 PG I Zone A entry + 3 still `X`; whole-table census over every pair | — (release) |
| TC1.2 | D-TC9 §172.504(f)(9) and §173.150(f)(2) | E2 → `permitted` + bulk ID display; E3 → no placard, aggregate 0; censuses over every Class 9 and combustible row × packaging | — |
| TC1.3 | Q-PC6 (a): §172.402 label requirement derived; `subsidiary_omitted` only where the label is required | property test over every subsidiary entry × packaging × PG | — |
| TC1.4 | Equipment fallback: a load with no trailer type is `withheld` with the reason, not computed as a tank | the orchestrator's `vehicle_kind_assumed` becomes a blocking conditional naming the Trailers page | **Q-TC4** |
| TC1.5 | D-TC13 engine finding catalogue; `evaluatedAt` server-set after the spread; `/calc` behind the section view gate; dataset parse cached per version | no rule id on any screen; `/calc` 10 ms warm | — |

### Phase TC2 — The reader sees the page

| Step | What | Done when | Owner |
|---|---|---|---|
| TC2.1 | D-TC1 per-reader sizing (`loadImages` per model; send rule 2 in the cache key) | pass B receives 1500×2000 for a 1500×2000 page; replay unchanged in every status | — |
| TC2.2 | D-TC1 measurement: `doc:bench` runs pass A candidates × effort over 7B.2 + the nine replayable reads; table of wrong UN ids, RC5 defects, ms, $ per read | the table in §7 | **Q-TC1 ruling** |
| TC2.3 | PC3 weight as printed (`grossWeightText` → `parsePrintedWeight`, census over units × separators) | PureTech 1,814 kg → 3,999 lb on 5 lines | — |
| TC2.4 | PC4 PG and description as printed; one-character punctuation tolerance in `readingExtent.ts` | PureTech descriptions agree 5/5; "PG 3" a format finding | — |
| TC2.5 | D-TC2 crop re-read as third witness, under the false-accept census (RC5 single-defect mutants + a crop that disagrees with both readers must NOT settle) | pending on the nine reads → the paper's own silences only; false-accept 0 | — (spend: cents) |
| TC2.6 | D-TC3 effort `low` where TC2.2 shows no loss | p50 ≤ 15 s on the row | — |
| TC2.7 | PC5 one paper per document (Q-PC2 (a): OCR paper number + marker, two-witness grouping, regroup on screen) | Maintex → two papers, two certifications | **Q-PC2 confirm** |

### Phase TC3 — The page (D-TC6)

| Step | What | Done when | Owner |
|---|---|---|---|
| TC3.1 | `HazmatCalculatorPage.vue` read-first: drop → auto-read → the paper-as-read table (`BolPaperView.vue`) with per-field state marks and inline reading choices; equipment from trailer or one picker; Calculate; "Enter by hand" collapses `HazmatCalculatorForm` | PureTech/Henkel fixtures: drop → Calculate, two clicks, nothing above the lines | **Q-TC2** (auto-Calculate) |
| TC3.2 | PC6 the fold (D-PC5): findings below, failures first, identical sentences folded "on N lines", shipper-only items collapsed, `[object Object]` page markers fixed | the three-fixture browser pass (fail / empty / staging) at 1280 and 390 | **Q-PC3 confirm** |
| TC3.3 | Verdict replaces the read view; one column; `VerdictPanel` unchanged inside | no second column at any width; `VerdictPanel.census.test.ts` green | — |
| TC3.4 | PC7 review labels (D-PC7) and relabel of the 10/21 rows | Henkel rows read *confirmed* | — |
| TC3.5 | `HazmatCalculatorForm.sequence.test.ts` extended to the new acts (drop, auto-read, choice, enter-by-hand, Calculate) | ≥320 seeded sequences, mutants caught | — |

### Phase TC4 — One pipeline, the best photos

| Step | What | Done when | Owner |
|---|---|---|---|
| TC4.1 | D-TC12 driver capture → document-reading module; `hazmatExtraction` retired; `hazmat_runs.read_id` | a driver's capture appears as a `document_reads` row with evidence; Haiku 4.5 gone from env | **Q-TC3** |
| TC4.2 | Driver app sends the camera original (Q-RC6 (a)); upload path warns below 1.5 MP (Q-PC5 (i)) | a driver photo is stored at ≥3 MP | driver release lane |
| TC4.3 | Model-view rectification (prepared view for the readers, measured on the 196-photo corpus with paid re-reads) | ids found ≥ OCR view's gain; 0 pages losing a UN number | — (spend ≤ $50) |

### Phase TC5 — Datasets and scope

| Step | What | Done when | Owner |
|---|---|---|---|
| TC5.1 | Attest 2026.10.0; LATEST → 2026.10.0; 2026.12.0 on 12-02 (HAZMAT dataset plan) | E7 → LQ verified, not refused | **owner names the attester** |
| TC5.2 | Table 1 scope: 4.3 and Class 7 Yellow-III placard at any quantity (the simple half of Table 1); 2.3 / PIH 6.1 / explosives stay refused | every 4.3 row → DANGEROUS WHEN WET required; census | **Q-TC5** |

### Gates added (each in `ci.yml`'s `gates` job or chained, per CLAUDE.md)

`lint:reader-gate` pins: the segregation-row census, the §172.504(f) censuses, the citation census, the probe-vs-rules
test, the crop-witness false-accept census, the page sequence test, the stage-timing test. A gate that is in
`package.json` and in neither CI list is not a gate.

---

## 5. Production-ready: the checklist

The feature is complete when every line is true and §7 records the release tag that made it so.

- [ ] Every step in §4 merged **and released**, or struck by an owner ruling in §6.
- [ ] P1: false-accept 0 on every census (RC1, RC5, RC6 synthetic, crop witness) and on every stored read's replay.
- [ ] P2: pending fields 0 and audit failures 0 on Henkel, PureTech, Mayo, Sonny's, Maintex replays (the paper's own
      silences allowed, folded).
- [ ] E: E1–E7 of §2.7 closed; whole-table censuses for segregation, §172.504(f), §172.505, citations; 0 `not_evaluated`
      on any input a rule reads.
- [ ] Two clicks on the three fixtures in the browser at 1280 and 390; no manual field visible after a clean read.
- [ ] p50 ≤ 15 s, p90 ≤ 30 s over the last 20 production reads, from `stage_timings`.
- [ ] One pipeline: `hazmatExtraction` deleted; the driver app's reads are `document_reads` rows.
- [ ] LATEST dataset carries column 8A; `dataset_provisional` never fires on production.
- [ ] No engine rule id or field path visible on any screen (catalogue complete).
- [ ] Every `cfr` string in the pinned list; `/reference/:section` either answers or is gone.
- [ ] Nothing in `UNEVALUATED_INPUTS` is read by a rule.
- [ ] `docs/ARCHITECTURE.md` module map names the one reader and the retired path.

---

## 6. Open questions

**Q-TC1 — May pass A leave Sonnet 4.6 (D-DR20)?** *Evidence:* §2.2; D-DR20's own corpus had Sonnet 5.5 at 0 errors;
Opus 5.5 unmeasured. *Candidates:* (a) rule on TC2.2's table — move if wrong UN ids ≤ Sonnet 4.6's and RC5 defects do not
rise; (b) keep the lock and let only pass B gain the pixels. *Recommendation:* (a). The lock was right on what it
measured; it could not measure the cap. Cost: a 2-page read ≈ $0.08 today → ≈ $0.10–0.15 with both readers high-tier.

**Ruled 2026-10-29 (owner, as recommended): (a).** Pass A moves on TC2.2's table where wrong UN ids ≤ Sonnet 4.6's and RC5 defects do not rise; D-DR20 is superseded by that measurement.

**Q-TC2 — One click or two?** Auto-read on drop is certain. *Candidates:* (a) Calculate auto-runs when nothing is
pending and the equipment is known — one click; (b) the Calculate press stays — two. *Recommendation:* (b) now, (a)
behind a per-user setting later: the press is the act the review record is keyed to and the moment the dispatcher
commits; a calculation nobody asked for is a verdict nobody owns.

**Ruled 2026-10-29 (owner, as recommended): (b).** Auto-read on drop; the Calculate press stays; auto-Calculate is not built.

**Q-TC3 — Unify the driver capture this quarter (D-TC12)?** *Evidence:* §2.6 — Haiku 4.5 as a reader, two caches, two
prompts. *Recommendation:* yes, TC4.1, after TC3; the driver path is where the best photos are and today the weakest reader.

**Ruled 2026-10-29 (owner, as recommended): yes.** TC4.1 after TC3; `hazmatExtraction` retires.

**Q-TC4 — A load with no trailer type: refuse, ask, or assume a tank?** *Evidence:* §2.7, `resolveVehicleKind` fallback.
*Candidates:* (a) withhold with the reason (TC1.4); (b) ask in the load form before submit; (c) keep the assumption.
*Recommendation:* (a) in the engine path and (b) in the load form — the web calculator already refuses to default it.

**Ruled 2026-10-29 (owner, as recommended): (a) and (b).** TC1.4 withholds; the load form asks before submit.

**Q-TC5 — Table 1 scope for a general carrier.** *Evidence:* 147 entries of 2.3, 89 of 4.3, 20 of 7 refused wholesale.
*Candidates:* (a) 4.3 and Class 7 Yellow-III (placard at any quantity, no zones) this quarter; (b) all of Table 1 with
zones; (c) leave D4-revised. *Recommendation:* (a) — the simple half; zones and explosives stay a later pack.

**Ruled 2026-10-29 (owner, as recommended): (a).** TC5.2 builds 4.3 and Class 7 Yellow-III; 2.3, PIH 6.1 and explosives stay refused.

**Q-TC6 — The reference-text store.** *Evidence:* `0.0.0, provisional, 0 sections`; endpoint 404s. *Candidates:*
(a) populate from the citation list's paragraphs (Cornell LII text, dated); (b) remove the endpoint and the D12 claim.
*Recommendation:* (a), small: ≈40 paragraphs the engine actually cites.

**Ruled 2026-10-29 (owner, as recommended): (a).** The store is populated from the citation list; the endpoint stays.

**Q-TC7 — Keep the OCR engine resident (D-TC5's "never idle-stopped")?** *Evidence, measured 2026-10-29 building
TC0.3 on this code (Apple silicon, the pinned PP-OCRv6 models):* starting the engine with no models on disk took
**29 s** (the download — the 10/15 note's ≈30 s); with them on disk **0.56 s**; a loaded engine holds **~0.5 GB**
resident, **~1.2 GB** once it has read a page. The download is what reads were paying, and TC0.3 moves it to boot
without holding anything. What a resident engine would still save is the restart from disk plus first inference,
**≈1.6 s a read** (≈8 % of the 21 s median), for ~1.2 GB held in every process that runs reads — production's host is
one t4g.large (8 GB) shared by api, web and the console, and api averages ~1.2 GB today. *Candidates:* (a) keep the
two-minute idle stop (what TC0.3 ships); (b) never stop, as D-TC5 proposed; (c) a long idle (24 h), which holds the
memory most of the day for the same saving. *Recommendation:* (a) — re-ask if `stage_timings` shows `ocr` beyond the
slower reader on warm-booted reads, which is the measurement that would make the 1.6 s worth the memory.

---

## 7. Progress log

- **2026-10-29 — plan written.** Two audits of the day consolidated: the engine against the CFR and dataset 2026.07.1
  (E1–E7 reproduced with a tsx script on main 67a1052, CFR text read at law.cornell.edu for §172.504, §172.505,
  §173.150), and the reader on all 18 finished production reads (durations, tokens, evidence statuses, review rows,
  page sizes; resolution arithmetic run with `visionTier.ts`). Found and named for the first time: the page is sized
  for pass A's tier and both readers get that copy (§2.2); pass B thinks at high effort on a copying task; the OCR
  thread is cold on every sporadic read; no stage is timed; the driver capture is a second pipeline on Haiku 4.5; the
  segregation grid is matched by class number (false violation on 6.1 loads); Class 9 and non-bulk combustible are
  over-required; §172.505(b) should read (c); two eligibility probes contradict the rules that read them. Nothing
  built. Next: TC0.1 (release), TC0.2–TC0.5 (no owner input).
- **2026-10-29 (later) — owner ruled Q-TC1–Q-TC6, each as recommended** ("record these rulings as recommended and proceed with
  implementation as proposed"). Every step in §4 is now unblocked except TC0.1 (the release approval the owner gives on the
  release PR) and TC5.1 (the owner names the attester). Implementation starts at TC0.2.
- **2026-10-29 — TC0.2 merge 1 of 2: migration 0529 `document_reads.stage_timings`.** A jsonb object of stage → ms
  (CHECK: an object of non-negative numbers; the stage names are the worker's, not the schema's), written only by
  `document_read_transition`, which gains `p_stage_timings` merged with `||`. reading → reading WITH timings now writes
  them, so a stage is recorded as it finishes and the screen can name the real one; without timings it is still the
  retry's no-op, and `started_at` is stamped only on queued → reading so a mid-read write cannot restart the clock
  (`document-reader-tables` matrix, mutation-checked: dropping that guard fails "a mid-read stage write keeps the read
  reading and does not restart its clock (0529)"). 0528 was left to the maintenance plan's M10, which named it first.
  Next: merge 2 — the writer in `executeRead.ts`, the `[metrics]` line, the read response and the screen's stage text.
- **2026-10-29 — TC0.2 merge 1 MERGED as #1832** (0529 on staging with the merge; production with the next approved
  release, migrations first).
- **2026-10-29 — TC0.2 merge 2 of 2: the writer, the `[metrics]` line and the stage on screen.** `executeRead` times
  `classify`, `fetch`, `passA`, `passB`, `ocr` (the witness's own run, from the readers' start — `ocr` beyond the slower
  reader is the wait it cost) and `evidence`; writes them with the outcome (done and failed alike) and marks the row twice
  while reading — pages fetched, then both readers answered — off the critical path and best effort (a refused mark
  changes nothing: "finishes the read exactly as it would when the database refuses every stage mark"). A cache hit
  carries `fetch` only. The vocabulary is one list in the contract (`READ_STAGE_TIMINGS`); `readStageOf` turns the
  finished stages into `preparing` / `reading` / `checking`, which `GET /api/documents/reads/:id` returns as `stage` and
  the panel words ("Getting the pages ready…", "Reading the bill of lading…", "Checking the reading against the page…")
  instead of one sentence for the whole read. One `[metrics] {"documentRead": …, "stagesMs": …}` line per finished
  read. Mutation-checked: dropping the timings from the done write, or the second mark, fails two tests each. TC0.2's
  done-when (the next production read's row names each stage) waits on the release.
- **2026-10-29 — TC0.2 merge 2 MERGED as #1833.** TC0.2 is built; its done-when (the next production read's row names
  each stage) waits on the release.
- **2026-10-29 — TC0.3: the OCR models load at boot; the idle stop stays, and its removal is Q-TC7.** Measured first,
  on this code: an engine started with no models on disk took 29 s (the download), with them on disk 0.56 s; a loaded
  engine holds ~0.5 GB resident, ~1.2 GB after its first page. So the cold read was paying the DOWNLOAD, once per
  container — and a release ships a new container most nights. `ocrEngine` gains `warm()` (the thread answers `ready`
  once its models are loaded; `ocrWorker.ts` handles the message), and `warmDocumentReadOcr` calls it at boot in the
  process that runs `document_read` — the API in `inprocess` mode (`index.ts`, production today), the queue consumer
  otherwise (`worker.ts`). It is not a scheduler: one start, no tick, nothing written. D-TC5 also proposed never
  idle-stopping; at ~1.2 GB per process on an 8 GB shared host for ≈1.6 s a read, that is put to the owner as Q-TC7
  (recommendation: keep the stop) rather than shipped. Owner action still open: `DOC_OCR_CACHE_DIR` on a persistent
  path, which saves the 139 MB download each deploy (on Railway: a volume; after the AWS cutover: a Docker volume).
  Tests: the engine against a protocol fixture worker (warm → same thread reads the next page; failed load → not
  warm and no OCR; idle stop still restarts), `warmDocumentReadOcr` (off → nothing; one engine; failures logged, never
  thrown). Mutation: ignoring the thread's `ready` fails "answers warm once the thread has its models…".
- **2026-10-29 — TC0.3 MERGED as #1835.** Waits on the release and, for the download saving, on the owner's
  `DOC_OCR_CACHE_DIR`; Q-TC7 open.
- **2026-10-29 — TC0.4: the coverage statement is tested against the rules; the two stale probes are gone (engine
  0.23.0).** New census `packages/hazmat-golden/src/probeCensus.test.ts`: every entry of the shipped table (alone, bulk
  on a cargo tank and 1,500 lb non-bulk in a van) is evaluated without and then with each value every probe of
  `UNEVALUATED_INPUTS` / `UNEVALUATED_LINE_INPUTS` (now exported) would report, and the verdict minus the input audit
  must not move; its value map must name exactly the lists' probes, and every value must raise its own finding (no
  vacuous pass). Run on main's engine it failed on exactly `portContext.vesselConnected` (E6) and `isResidueLine` (E5)
  and nothing else; both left the lists and stay in the census as positive controls (it must see their verdicts move).
  Done-when as tests: "a vessel question answered either way is evaluated, never reported as ignored", "a residue line
  is evaluated by the aggregate, never reported as ignored". Pinned in `lint:reader-gate`. ≈15 s.
- **2026-10-29 — TC0.4 MERGED as #1836** (a follow-up commit gave the census's sweeps the census timeout: CI's runner
  took 13 s on the two-sweep control where vitest allows 5).
- **2026-10-29 — TC0.5: every `cfr` the engine emits is checked against eCFR; two were wrong (engine 0.24.0).** New
  `packages/hazmat-data/datasets/citations.json`: 65 CFR paragraphs + 4 `internal:` plan references, each paragraph
  with `mustSay` — the words it must contain for the engine's use to be right, written by a person — and the excerpt,
  section, paragraph and eCFR URL that `import/citationsBuild.ts` writes after checking them against eCFR 2026-10-27
  (paragraph located by `import/citationParagraph.ts`, which handles eCFR's headed inline children and roman-vs-letter
  numbering). Existence is not the check: §172.505(b) and §172.302(c) both exist. Given the two old strings back, the
  builder refused both, naming the phrase each lacks. Corrected: DANGEROUS WHEN WET → **§172.505(c)** (E4); a bulk
  line's ID number → **§172.302(a)** (it cited (c), special-permit packagings — found by this step, not in §2.7); and
  `§177.848(d)` lost its stray `§`. New census `hazmat-golden/src/citationCensus.test.ts`: every `cfr` reached over the
  whole table (each row at five loads, LQ, residue, vessel leg, 4,000 seeded pairs, both early exits) and every
  literal in the engine's source is in the list; the list holds nothing stale; every entry's stored excerpt says its
  phrase. Mutation: §172.505(b) back in the engine fails four of its six tests. Pinned in `lint:reader-gate` (13 files).
  The census title and the PLACARD plan's body text now say (c). Not in this step: populating `referenceText.json`
  from the list (Q-TC6 (a)) — the list now names exactly the ≈40 sections to fetch; it is TC0.5's follow-up.
- **2026-10-29 — TC0.5 MERGED as #1837.**
- **2026-10-29 — Q-TC6 (a): the reference-text store is populated from the citation list.** `referenceText.json` was the
  H1 skeleton (0.0.0, provisional, no sections) because `import/referenceTextBuild.ts` was never run, and its hand-kept
  list of 16 sections missed 24 of the 39 the engine cites and held one it does not (§172.519). The builder now derives
  its sections from `citations.json` and reads them at the list's eCFR date (2026-10-27): 39 sections, not provisional.
  `paragraphAt` moved from `import/` to `src/` (exported) so the store can be held to the list: new
  `hazmat-data/src/referenceText.census.test.ts` — every cited section is in the store and nothing else is, and the
  paragraph each citation names says, in the store's own text, every `mustSay` phrase; every citation resolves through
  `referenceForCitation`. Mutation: the old skeleton back fails 4 of 4. `/api/hazmat/reference/:section` now answers for
  every section the engine cites (it is a direct store lookup; no route test exists for it). Next: TC1.1.
- **2026-10-29 — Q-TC6 (a) MERGED as #1838** (39 sections at eCFR 2026-10-27; `/reference/:section` answers).
- **2026-10-29 — TC1.1: segregation by the grid row a material is on (engine 0.25.0; E1 closed).** New
  `segregation/qualifiers.ts`: each grid label's qualifiers read from its own words ("6.1 liquids PG I zone A" → liquid,
  PG I, zone A); each material's from its HMT row — PG from the row; zone from §172.102(c)(1) provisions 1–4 (the PIH
  constants `tableSelect.ts` owns, now exported), unknown under provision 5 or an inhalation name, always unknown for
  an unzoned 2.3; phase a fact of the MATERIAL (Class 2 primary → gas, so a gas's subsidiary 8 is never "8 liquids
  only"), else the shipping name's word, else column 9's L/kg (decides 367 of 386 Class 8 rows), else a zone ⇒ liquid
  (§173.116(a)/§173.133(a)). A cell restricts only rows two DIFFERENT materials are on — found by the census: acrolein
  (6.1 PG I zone A with subsidiary 3) was a 3 × 6.1 violation against itself, on the old code too. Where a qualifier is
  unknown and the worst row it might be on is worse than the rows it is surely on, the finding is
  `segregation_unresolved`, a conditional naming both rows — never a violation. E1 (UN1263 PG II + UN1710 PG III) →
  `segregation_none`; 6.1 PG I zone A + 3 still X; 8 solid + 5.1 → none; 2.3 zone B + 3 → O. New census
  `hazmat-golden/src/segregationCensus.test.ts`: every non-explosive row × a plain partner on each grid row (and a 6.1
  and an 8 on no row), against an oracle that reads zones from §172.102's own text in the reference store, phase from
  the shipping name (column 9 only where the name is silent, and column 9 is itself held to the names on the 300+
  non-gas rows where both speak), and the labels' qualifiers from §177.848(d)'s printed row titles by hand; no
  violation it cannot prove (4,195 proven), none missed, none beyond the worst row. Mutations: main's engine fails 3
  of its 6 tests, dropping the different-materials rule fails 2. The old placard-census test that collapsed labels with
  its own `baseOf()` is removed (it demanded E1's false violations). `check.test.ts` gains the plan's cases (6.1 PG III
  + 3, 8 solid + 5.1, 2.3 zone B + 3, unknown phase/zone, a gas's subsidiary 8, a material's own subsidiary). Pinned in
  `lint:reader-gate` (14 files). Explosives (class 1) stay out of scope, as before.
- **2026-10-29 — TC1.1 MERGED as #1840.**
- **2026-10-29 — TC1.2: §172.504(f)(9) and §173.150(f)(2) in the ladder (engine 0.26.0; E2, E3 closed).** New
  `placards/domesticExceptions.ts` (compute.ts gains only the call sites — it sits at 490 of 500 lines). **One reading
  differs from D-TC9, on the CFR's words:** (f)(9) waives the CLASS 9 placard for domestic transportation in every
  packaging, not only non-bulk ("However, a bulk packaging must be marked with the appropriate identification number on
  a CLASS 9 placard, an orange panel, or a white square-on-point"). So CLASS 9 moves from required to permitted on any
  load, with an `info` finding; the line stays resolved, so a bulk line's ID number is still required and, its placard
  not being required, is carried on an orange panel / white square (existing `assignIdCarriers` path); CLASS 9 is not a
  §172.504(b) DANGEROUS category. Its non-bulk weight STAYS in the §172.504(c) aggregate — the waiver is of the placard,
  not of Table 2 membership — so 1,500 lb of it beside 500 lb of paint still requires FLAMMABLE (the reading that never
  under-placards; recorded so a PHMSA letter saying otherwise would be a one-line change). (f)(2): a line placarded
  COMBUSTIBLE in non-bulk (NA1993 "Comb liq", or a Class 3 reclassed under (f)(1)) leaves `resolved` before the ladder —
  no placard, no aggregate weight, no §172.301(a)(3) count — with an `info` finding; bulk combustible unchanged, and the
  marine-pollutant mark still reads every recognised line. Both new citations verified against eCFR into
  `citations.json` by the builder (the citation census refused the engine until they were — the gate working). New
  census `hazmat-golden/src/domesticExceptionsCensus.test.ts`: every Class 9 row and every combustible row (NA1993 + each
  Class 3 row reclassed) × bulk tank / bulk van / non-bulk 500, 1,500, 9,000 lb, alone and beside 500 lb of paint.
  Placard census invariant 1 now knows both exceptions and gains invariant 7 (CLASS 9 never required); its `own()`
  reads a Class 9 row's permitted placard — without that every load holding one would have been skipped as "withheld".
  Mutations: removing either exception fails its census test. Pinned in `lint:reader-gate` (15 files).
