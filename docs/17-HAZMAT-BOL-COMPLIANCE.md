# FuelGuard — Hazmat BOL & Placarding Feature: Research Report and Design Recommendation

> How to build a near-bulletproof feature that ingests driver photos of the BOL + load
> securement, validates the BOL against 49 CFR, checks load eligibility against company
> settings, and outputs the exact required placards.
> Research date: 2026-07-23 · All rules verified against current eCFR + PHMSA interpretation letters.

---

## 1. The single most important design decision

**"100% reliable" is achievable for the compliance verdict — but only if the AI never makes the compliance decision.**

Modern vision LLMs read phone photos of BOLs at roughly mid-90s% field-level accuracy. That is
excellent for reading, and catastrophically insufficient for deciding placards. No amount of
prompting closes that gap. Every serious system in this domain (IATA DG AutoCheck, Hazcheck
Validate, Labelmaster DGIS) uses the same division of labor, and it maps exactly onto the
philosophy FuelGuard already uses (rules engine decides, Claude explains — `07-AI-VERIFICATION.md`):

```
AI (vision model)  →  READS the document into structured fields. Nothing else.
Deterministic code →  DECIDES compliance, eligibility, and placards — from a versioned
                      copy of the 49 CFR 172.101 table, with a CFR citation attached
                      to every verdict.
Human              →  CLEARS anything the system isn't sure about (fail-closed).
```

The reliability then comes from **redundant error-trapping around the reading step** (§4), not
from trusting the model. A misread digit becomes a hard "needs review" instead of a silent
wrong placard.

Three consequences worth internalizing up front:

1. **The rules engine is ~30% of the work; the extraction-verification harness is the other 70%.**
   The placard logic itself (172.504) fits in a few hundred lines of well-tested TypeScript.
2. **Some rules cannot be decided from the BOL photo alone** — they depend on facts the app must
   already know (carrier relationship, whether the tank was cleaned/purged, what was hauled
   earlier the same day). The feature needs those inputs modeled, or it will be confidently wrong.
3. **Legally, the output must be positioned as decision support for hazmat-trained employees**
   (49 CFR 172 Subpart H), never as an authoritative determination — §9. This is how every
   vendor in the space positions it, and it also happens to be the honest description.

---

## 2. What the feature actually checks (three verdicts, one pipeline)

| Verdict | Question | Decided by |
|---|---|---|
| **BOL compliance** | Does the shipping paper contain every element 49 CFR 172 Subpart C requires, correctly formatted? | Rules engine over extracted fields |
| **Load eligibility** | Is this product/class allowed under this company's settings, and is the product mix legal to co-load (§177.848 segregation)? | Rules engine over company config + extracted products |
| **Placards** | Exactly which placards and ID-number displays must be on the vehicle, where? | Rules engine over products + vehicle/trip context |

All three run off the same extracted, cross-validated product list — so one pipeline, three outputs.

---

## 3. Pipeline architecture

```
Driver app (future)
  1. CAPTURE  — guided photo capture: edge-detect framing, glare/blur detection,
                forced retake, multi-shot per page. (Transflo-style coaching.)
      │
      ▼  photos → API
  2. QUALITY GATE — image-usability classifier BEFORE extraction.
                Unusable → immediate re-capture prompt to driver. Never extract garbage.
      │
      ▼
  3. EXTRACTION (vision LLM, structured output, Zod-validated — same pattern as 07-AI-VERIFICATION)
                → strict JSON: per-line {UN/NA id, proper shipping name, class, PG,
                  quantity+unit, compartment}, ER phone + identifier, shipper cert
                  present/wording, page "1 of N", RQ/Residue/HOT notations,
                  per-field confidence + bounding boxes (pixel evidence).
      │
      ▼
  4. CROSS-VALIDATION LAYER (the precision engine — §4)
       a. HMT consistency: every line must jointly match a real 172.101 row
       b. Dual-pass agreement on safety-critical fields
       c. Arithmetic checks: line quantities vs totals; plausibility vs compartment plan
       d. Context checks: BOL products vs dispatch/order data if available
      │        └─ any failure → fail-closed → human review queue (with pixel evidence)
      ▼
  5. RULES ENGINE (deterministic, versioned, cited)
       - BOL compliance ruleset (172.200–.204, 172.604)  → pass / violations[] / warnings[]
       - Eligibility: company allow-list + 177.848 segregation → eligible / blocked (reason)
       - Placard computation (172.504/.505/.336 etc.)     → exact placard set + ID display
                                                            + placement + ERG guide #
      │
      ▼
  6. OUTPUT — verdicts with plain-language explanation + CFR citation per finding
       (Claude may WRITE the explanation text; it never alters the verdict)
      │
      ▼
  7. REVIEW & AUDIT — anything not green blocks dispatch until a hazmat-trained
       reviewer clears it; every run stores image, extraction JSON + confidences,
       HMT dataset version, rules fired, reviewer attestation.
```

This slots into FuelGuard's existing shape: extraction + rules in `apps/api` services, schemas in
`packages/shared`, photos in Supabase Storage, review queue UX like the anomaly queue, and the
same kill-switch/budget/caching discipline as the AI verification layer.

---

## 4. How you actually get to "near-100%": layered error traps

Each layer catches a different failure mode. Together they make silent errors extremely rare —
errors become visible "needs review" events instead.

**4.1 HMT consistency check (highest-leverage trick in the whole design).**
The 172.101 table gives redundancy for free: UN number ↔ proper shipping name ↔ class ↔ PG must
all match one real row. If the model misreads "UN1203" as "UN1208", the shipping name "Gasoline"
no longer matches → hard flag. A misread almost never lands on a row where the other three
fields also agree. Every extracted line is validated as a *tuple* against the table, never as
independent fields.

**4.2 Dual-pass extraction agreement.** Run two independent reads (two different models, or
vision LLM + classical OCR — they fail in *different* ways: OCR errors look obviously wrong,
LLM errors look plausible). Safety-critical fields (ID number, shipping name, class, PG,
quantities) must agree exactly; disagreement → review. Known LLM failure mode to specifically
test: **row misassociation** in multi-line product tables (right value, wrong line) — dangerous
because it silently moves gallons between products.

**4.3 Arithmetic and physical plausibility.** Line quantities must sum to BOL totals; totals
must be plausible against the trailer's compartment plan (FuelGuard already knows tank
capacities); gross/net gallons sanity-checked.

**4.4 Context cross-check.** If dispatch/order data exists (product, terminal, quantities),
extracted BOL lines are compared against it. Mismatch → review.

**4.5 Fail-closed human-in-the-loop.** Per-field confidence thresholds; any low confidence,
HMT mismatch, dual-pass disagreement, allow-list violation, segregation conflict, or Table 1
material → blocked pending review by a trained employee. The review UI shows the cropped image
region for each field ("verify highlighted evidence"), never asks the reviewer to re-type the
document. Auto-approve exists only for the fully-green path.

**4.6 Versioned regulatory data (§6) + golden regression suite (§8)** close the loop on
"the rules themselves changed" and "we broke logic while changing code."

---

## 5. The rules engine — what it must encode (with the traps)

The full researched rule catalogs (with per-claim eCFR citations and PHMSA interpretation
letters) are in Appendices A and B. The design-shaping facts:

### 5.1 BOL compliance rules — calibration matters as much as coverage

A naive checker that fails every BOL missing a "nice-to-have" will drown users in false
violations and destroy trust. Key calibrations discovered in research:

- The basic description sequence **ID → Proper Shipping Name → Class → PG** is strict and
  uninterruptible (§172.202) — but total quantity may legally sit *before* the description, and
  "1 cargo tank" alone can satisfy quantity for bulk. Don't fail rack BOLs that print gallons first.
- The HM/"X" column and hazmat-first ordering apply **only** to mixed hazmat/non-hazmat papers —
  an all-hazmat fuel BOL needs neither.
- **Shipper certification is often legitimately absent** on fuel BOLs: §172.204(b) exempts
  carrier-supplied cargo tanks and private carriers hauling their own product. This check is
  *conditional on the carrier relationship* — a company setting, not a universal rule.
- ER phone rules are strict and heavily cited at roadside: 24/7 monitored number (no answering
  machines/pagers), and a CHEMTREC-style number needs the shipper's name/contract ID adjacent
  unless prominent elsewhere (§172.604). A bare "CHEMTREC 800-424-9300" is a violation.
- "RQ" almost never applies to straight fuels (CERCLA petroleum exclusion) — don't demand it.
- "Placards: 1203"-type trailing notes are industry custom, **not** a federal requirement —
  never fail on absence.
- **E10 vs E15 is a real misdescription trap**: >10% ethanol must be UN3475, not UN1203 —
  citable, and it changes vehicle ID-number display.
- Diesel may correctly appear as `UN1202 / 3 / PG III` **or** as reclassed
  `NA1993 (or UN1202), Combustible liquid, PG III` (§173.150(f); PHMSA 15-0187R). Both are
  valid — the reclassification election belongs to the offeror, so the engine must accept both
  and carry the classification through to the placard answer.
- Propane (UN1075/2.1) has **no packing group** — a PG present is the error; also needs the
  Q&T-steel notation ("NONCORROSIVE"/"NOT FOR Q and T TANKS", §172.203(h)(2)) that's frequently
  missing on propane BOLs.

Every finding should therefore carry a **severity tier**: `violation` (citable, blocks),
`conditional` (depends on facts outside the photo — surfaced as a question, e.g. certification),
`warning` (unusual but legal), `info`. That tiering is what makes the tool feel expert instead
of pedantic.

### 5.2 Placard computation — deterministic decision tree

For a fuel-hauling cargo tank the logic compresses to a clean tree (full version, Appendix B §7):

1. **A cargo tank is a bulk packaging → the 1,001-lb Table 2 threshold NEVER applies and the
   DANGEROUS placard is NEVER valid.** Placard any quantity, each side + each end.
2. Residue rule: an "empty" uncleaned tank keeps full placards/IDs until **cleaned AND purged**
   (§172.514(b), §173.29) — and leaving placards on a cleaned tank is itself a violation
   (§172.502(a)). This requires a `tank state` input (loaded / residue / cleaned+purged) the
   driver app must ask for — it cannot be inferred from the BOL.
3. Any Class 3 aboard → FLAMMABLE governs; it legally covers combustible compartments
   (§172.504(f)(2)(i)). COMBUSTIBLE never covers gasoline — the classic split-load violation.
4. GASOLINE-worded placard: only when the load is gasoline (§172.542(c)); FUEL OIL wording only
   for non-flammable fuel-oil loads (§172.544(c)). For mixed loads the safe output is
   FLAMMABLE + ID.
5. ID-number display is its own sub-engine (§172.328/.332/.336): sides+ends for ≥1,000-gal
   tanks; multi-distillate loads may show **only the lowest-flash-point ID** (1203 covers
   gasoline+diesel, §172.336(c)(5)) — **except** any >10% ethanol blend aboard forces 3475 to
   also be displayed (PHMSA 18-0023/18-0096); and the same-business-day rule (§172.336(c)(6))
   depends on *what was hauled earlier today* — trip context FuelGuard must track.
6. Output includes ERG guide number (128 for most fuels, 127 for ethanol, 115 for propane) —
   cheap to add, high operational value.

For general (non-fuel) hazmat the engine additionally needs: Table 1 (any-quantity) vs Table 2
(1,001-lb **aggregate across all Table 2 materials, not per class** — the most misapplied rule
in the industry), subsidiary placards §172.505, the full §172.504(f) exception list, and the
DANGEROUS-placard constraints for non-bulk (§172.504(b), 2,205-lb single-category rule).

### 5.3 Load eligibility

Two layers, both deterministic:

- **Company policy**: allowed classes/divisions, allowed UN numbers/products, PG limits,
  per-vehicle restrictions (e.g., this trailer not rated for ethanol), endorsements on file.
  Straight config matching — but match on the **HMT-resolved product**, not raw text.
- **Federal segregation** (§177.848): which placarded classes may not ride together / must be
  separated. For a fuel fleet the practical hits: Class 3 is barred with explosives 1.1–1.3/1.5,
  2.3 Zone A, 6.1 PG I Zone A, and needs separation from oxidizers (5.1). Encode the full
  table cell-by-cell from eCFR with unit tests per cell.

---

## 6. Regulatory data foundation (this is what makes it trustworthy over time)

- **Primary source: the eCFR versioner REST API** — point-in-time XML of Title 49, with a
  `latest_amended_on` field that acts as a built-in change-detection signal. Parse the 172.101
  HMT into a normalized internal dataset; **version every release** (effective dates matter —
  HM-215 harmonization rules have delayed compliance dates), and record which dataset version
  produced every verdict, so any historical verdict is reproducible.
- **Cross-license a second source** if budget allows — NCB/Exis Hazcheck DGL Data (172.101 as
  maintained CSV/Excel, annual license) or 3E's regulatory API — and require the two sources to
  agree before a data release ships. Disagreement = human regulatory review. This "two
  independent sources must agree" rule is the data-layer version of dual-pass extraction.
- **Every data update is a human-reviewed release**, not an automated sync: HM-215 rules get
  corrections/errata (even PHMSA publishes corrections), and a bad auto-ingested row would
  poison every downstream verdict. Monitor the Federal Register API (agency=PHMSA) + eCFR
  polling; treat industry digests (Labelmaster DG Digest, J.J. Keller) as tripwires.
- **ERG 2024**: extract the UN→guide-number mapping once per edition (revised every 4 years).
  Don't build on unofficial GitHub scrapes — use them only as diff-checks.
- **PHMSA interpretation letters** are part of the rulebook in practice (e.g., 15-0187R on
  diesel descriptions, 18-0023 on 1203+3475 display). Keep a curated, cited list attached to
  the rules they modify.

An important market note: **no vendor sells "photo in → 49 CFR highway placards out."** Placard
logic exists only inside shipping-execution suites that assume typed input. Building this well is
a differentiator, and Labelmaster DGIS Web Services can optionally run as a *shadow validator*
in year one — free QA on your engine wherever the two disagree.

---

## 7. Load-securement photos — scope this honestly

For **cargo tanks**, "securement" in the 393 Subpart I sense barely applies (the tank is the
vehicle); what a photo *can* verify is operationally valuable and tractable: hoses stowed,
valves closed/capped, dome lids secured, placards present/correct/legible/right position — and
that last item closes the loop beautifully: **the vision check compares the placards actually on
the truck against what the rules engine says they must be.** That's a unique, defensible feature.

For packaged/flatbed hazmat: vision AI can count visible tiedowns vs. the §393.110 minimum,
spot knotted/damaged straps (§393.104) and obviously unsecured items — but it cannot verify
working-load-limit math, tension, or internal blocking. Peer-reviewed work on exactly this
problem (arXiv 2306.03795) found the dominant failure was drivers photographing too little of
the load — so mandatory-angle guided capture is again the decisive control, with a two-stage
design (usability gate → classify) and human escalation. Position as **checklist verifier +
gross-defect detector + evidence archive**, never "automated 393 certification."

---

## 8. Testing: how you prove it's bulletproof

- **Golden scenario suite** for the rules engine: every placard table row, every §172.504(f)
  exception, the 1,001-lb aggregate edge, residue/cleaned states, gasoline+diesel and
  gasoline+E15 splits, the same-day ID rule, segregation pairs, each BOL trap in Appendix A §9.
  Target: hundreds of scenarios, each asserting the exact placard set + citations. The full
  suite gates every code change **and every regulatory-data release**.
- **Real-photo ground-truth corpus**: collect actual driver BOL photos (start with your own
  fleet's), human-verify extraction, and run every model/prompt change against it. Track
  field-level accuracy and — the metric that matters — **silent-error rate** (wrong value that
  passed all traps). The design goal is silent-error ≈ 0 with a tolerable review rate.
- **Shadow mode first**: run the feature on live loads for weeks without enforcement; measure
  review-queue volume and false-flag rate; calibrate severities before it can block a dispatch.
- **Cell-level unit tests** on transcribed regulatory tables (the §177.848 grid, Table 1/Table 2)
  against the live eCFR text — transcription errors in tables are the likeliest bug class.

---

## 9. Liability & positioning

The 49 CFR duties are non-delegable: the offeror and carrier own classification, papers, and
placards (§171.2, §172.504(a)), and no reliance-on-software defense exists. Every vendor in the
space therefore ships "decision support," keeps a trained human in the acceptance decision
(IATA DG AutoCheck model), and leans on Subpart H training requirements. Concretely for FuelGuard:

- Label outputs "automated pre-check for review by hazmat-trained personnel."
- Require a named reviewer attestation click to clear flags or override; log it.
- Store the full evidence chain per run (image, extraction + confidences, dataset version,
  rules fired with citations, reviewer) — this is also your defensibility story.
- Contract language: shipper's §172.204 certification and carrier §172.504 duties remain with
  the parties. Done right, the tool *reduces* customer liability versus manual-only checks —
  that's the sales pitch, and it's true.
- Penalty context that justifies the feature: currently up to **$102,348 per violation per day**
  (~$238k when death/serious injury results), and misplacarded vehicles go out-of-service at
  roadside under CVSA criteria.

---

## 10. Suggested build phases (FuelGuard-shaped)

1. **Regulatory data layer** — HMT parser/importer from eCFR API, versioned dataset in Postgres,
   ERG mapping, release process. (No AI yet; immediately useful for product lookups.)
2. **Rules engine in `packages/shared` + `apps/api`** — placard computation + eligibility +
   segregation, pure functions, golden suite. Ship as a manual "placard calculator" screen
   first: dispatcher picks products/quantities, gets placards + citations. Real value before
   any photo exists, and it hardens the engine.
3. **BOL extraction service** — vision model with structured output (the 07-AI-VERIFICATION
   patterns: Zod-validated, cached by content hash, budgeted, kill-switched), HMT
   cross-validation, dual-pass, quality gate.
4. **BOL compliance ruleset + review queue UX** (anomaly-queue pattern: severity tiers,
   evidence crops, attestation workflow).
5. **Company settings** — allowed classes/products, carrier-relationship flags (drives the
   certification rule), per-vehicle constraints, trip context (tank state, same-day products).
6. **Securement photo module** — guided capture + usability gate + placard-verification vision
   check (compare truck photo against computed placard set) + checklist detection.
7. **Driver app integration** when the app exists; until then, the web upload flow exercises
   the entire pipeline.

---

## Appendix A — BOL/shipping-paper rule catalog (research findings, full citations)

*(Verbatim findings from eCFR Part 172 Subpart C/G research — every claim cited.)*

### A.1 Applicability & format
- §172.200(a): any document qualifies (BOL, manifest, delivery ticket) if elements present.
- §172.201(a)(1): hazmat-first / contrasting color / "X" in HM column — **only on mixed papers**.
- §172.201(a)(2): legible, printed, English. §172.201(a)(3): no unauthorized codes/abbreviations
  in the required description ("PG", "RQ", "Ltd Qty", unit abbreviations are authorized).
- §172.201(a)(4)/§172.202(b): extra info (prices, product codes, terminal data) allowed if not
  inconsistent and not interspersed within the basic description.
- §172.201(c): multi-page → consecutive numbering, first page shows total ("Page 1 of 4").
- §172.201(d): ER phone per §172.604 required on the paper.

### A.2 Basic description — §172.202 (strict "ISHP" order)
1. ID number (UN1203/NA1993) → 2. Proper shipping name (Table Col. 2 only; italicized words not
part of PSN) → 3. Hazard class (subsidiary in parentheses after primary; class may be omitted
only for "Combustible liquid, n.o.s." PSN) → 4. PG in Roman numerals (optional "PG" prefix).
**No PG for Class 2 (propane).** Quantity with unit before or after description (§172.202(c));
bulk may use "1 cargo tank" (§172.202(a)(5)(i)); not required for residue. Number/type of
packages ("1 cargo tank", "12 drums") §172.202(a)(6).

### A.3 Additional entries — §172.203 (petroleum-relevant)
DOT-SP numbers (a); "Limited Quantity"/"Ltd Qty" (b); RQ before/after description for hazardous
substances (c); "RESIDUE: Last Contained ***" — **optional for highway**, required rail-only
(§174.25) (e); marine pollutant (l) — standard fuels aren't Appendix B pollutants; "HOT" prefix
for elevated-temperature (n) — hot No. 6 oil/asphalt; technical names for n.o.s. entries (k);
**LPG requires "NONCORROSIVE"/"NONCOR" or "NOT FOR Q and T TANKS"** (h)(2).

### A.4 Shipper certification — §172.204
Two authorized wordings; signature may be mechanical/typed (d). **Exceptions (b): cargo tank
supplied by the carrier; private motor carrier own-vehicle (unless reshipped)** — most rack fuel
BOLs qualify → conditional check, not hard fail. Hazwaste always requires manifest/certification.

### A.5 ER phone — §172.604 (+§172.602 ER info)
Numeric with area code; monitored 24/7 during transportation incl. storage incidental; person
knowledgeable or immediate access; **no answering machines/services/pagers**. Placement: after
each description, or once if prominent + identified + covers all materials. Offeror's own number
→ name adjacent unless prominent elsewhere; ER-provider number → registrant name/contract
number/customer ID adjacent (e.g., "CHEMTREC CCN####"). No §172.604(d) exception applies to bulk
fuel — reclassed combustible bulk still needs it (§173.150(f)(3)). ER *information* (§172.602)
may be satisfied by ERG in cab — not verifiable from the BOL photo alone.

### A.6 Retention & accessibility
Offeror 2 yr (§172.201(e)); carrier 1 yr (§177.817(f)); hazwaste 3 yr. Driver accessibility
§177.817(e): distinguished from other papers; within reach belted / visible entering cab, or
driver's door pouch; on seat/pouch when out of vehicle. §§177.817(a)+(e) are the two most-cited
paper violations at roadside.

### A.7 Correct fuel descriptions (172.101 Table + interp letters)
| Product | Description |
|---|---|
| Gasoline / E≤10 | `UN1203, Gasoline, 3, PG II` (or NA1203 Gasohol, domestic) |
| E>10% blends (E15–E98) | `UN3475, Ethanol and gasoline mixture, 3, PG II` |
| Ethanol / denatured | `UN1170, Ethanol, 3, PG II` / `UN1987, Alcohols, n.o.s., 3, PG II` |
| Diesel (Class 3) | `UN1202, Diesel fuel, 3, PG III` |
| Diesel reclassed | `NA1993 or UN1202, Diesel fuel, Combustible liquid, PG III` (interp 15-0187R) |
| Fuel/heating oil | `NA1993, Fuel oil (No. 1–6), 3 or Combustible liquid, PG III` |
| Kerosene | `UN1223, Kerosene, 3, PG III` |
| Jet fuel | `UN1863, Fuel, aviation, turbine engine, 3, PG I–III` (reclass allowed, interp 25-0024) |
| Petroleum distillates | `UN1268, Petroleum distillates, n.o.s., 3, PG I–III` |
| Propane | `UN1075 Petroleum gases, liquefied / UN1978 Propane, 2.1 — no PG` |

Biodiesel: ≤B5 = "Diesel fuel"; B20 needs solution/n.o.s. treatment (interp 07-0100). Dye/additives
don't change the description. Multi-compartment: each **different** product = own description line
with its total; same product needs no per-compartment breakout.

### A.8 Trap list (calibrate the analyzer)
Quantity-before-description is legal; "1 cargo tank" satisfies quantity; HM column mixed-papers
only; certification conditionally absent; "Combustible liquid" class entry valid; NA numbers
domestic-only; E10/E15 UN split; no PG on propane; RESIDUE optional highway; RQ ≈ never on
straight fuels; ER-number quality rules (identifier adjacency); "Placards required" note not
federal; no subsidiary parentheses on fuels; page count only if multi-page; product codes legal
as extra info but never as the description; HOT prefix; LPG Q&T notation; ERG-in-cab satisfies
§172.602; retention windows differ by role.

---

## Appendix B — Placarding & segregation rule catalog (research findings, full citations)

### B.1 Core logic — §172.504
Placard each side + each end. **Table 1** (any quantity): 1.1–1.3, 2.3, 4.3, 5.2 Type B
temp-controlled, 6.1 PIH Zone A/B, 7 (Yellow-III). **Table 2** (1,001-lb threshold): everything
else incl. Class 3 FLAMMABLE, Combustible liquid COMBUSTIBLE, 2.1 FLAMMABLE GAS.
**§172.504(c): the 454 kg/1,001 lb exception is aggregate across ALL Table 2 materials combined
(not per class), never applies to bulk packagings or §172.505 materials; residue-only packages
excluded from the aggregate.** §172.502(c): permissive placarding legal when conforming.

**DANGEROUS placard — §172.504(b):** non-bulk only; 2+ Table 2 categories; forbidden for any
category ≥1,000 kg (2,205 lb) loaded at one facility (that category gets its specific placard);
never for Table 1; never carries an ID number (§172.334(a)). **Hard-block on cargo tanks.**

**§172.504(f) exceptions (full list):** (f)(1) lowest explosive division governs; **(f)(2)
COMBUSTIBLE not required on cargo/portable tank — FLAMMABLE may substitute (one-way!)**; (f)(3)
NON-FLAMMABLE GAS unneeded with FLAMMABLE GAS/OXYGEN; (f)(4)–(5) OXIDIZER/explosives interplay;
(f)(6) 1.4S; (f)(7) OXYGEN substitute; (f)(8) PIH covered by POISON GAS; **(f)(9) Class 9
placard not required domestically — but bulk Class 9 still displays ID (square-on-point/orange
panel)**; (f)(10) PG III note on POISON; (f)(11) POISON covered by PIH/POISON GAS.

**Subsidiary — §172.505:** PIH and DANGEROUS WHEN WET subsidiaries placard at any quantity;
others permissive. Fuels: none.

### B.2 Fuel placard/ID selection
Gasoline → FLAMMABLE or **GASOLINE-worded placard (gasoline cargo tanks only, §172.542(c))** + 1203.
Diesel/fuel-oil reclassed → COMBUSTIBLE or **FUEL OIL wording (§172.544(c), non-flammable loads
only)** or FLAMMABLE + ID. E-blends → FLAMMABLE + 3475 (GASOLINE wording NOT authorized). Jet →
FLAMMABLE (or COMBUSTIBLE if reclassed) + 1863. Propane → FLAMMABLE GAS + 1075, any quantity (bulk).

**ID display (§§172.328/.332/.334/.336):** every bulk packaging displays ID even when no placard
required; ≥1,000-gal cargo tanks: each side + each end (4 displays); formats: on placard /
orange panel / white square-on-point; never on DANGEROUS/subsidiary placards; ID on placard must
be correct for all same-class materials aboard (§172.334(d)).
**§172.336(c) fuel-hauler rules:** (c)(1) compartment-sequence side display; (c)(2) all-gasoline
tank may mark "GASOLINE"; (c)(3) all-fuel-oil "FUEL OIL"; **(c)(5) multi-distillate load may
display only lowest-flash-point ID (1203 covers gasoline+diesel) — EXCEPT >10% ethanol blends
force 3475/1987 also displayed** (interps 18-0023, 18-0096, 14-0178); (c)(6) same-business-day
retention of the day's lowest-FP ID.

### B.3 Edge cases
- **Combustible reclassification §173.150(f):** non-bulk reclassed combustible = fully
  unregulated (no papers/placards, doesn't count toward 1,001 lb); **bulk stays regulated**
  (papers, ER info, ID display, placard, training, registration). Offeror's election — take as
  input, never infer.
- **Residue §172.514(b)/§173.29:** placards/IDs/papers persist until cleaned AND purged;
  placarding a clean tank violates §172.502(a).
- **Mixed gasoline+diesel:** FLAMMABLE governs; COMBUSTIBLE alone = violation; GASOLINE wording
  questionable → recommend FLAMMABLE + 1203.
- **Materials of trade §173.6:** support-vehicle carve-out (≤440 lb aggregate; diesel special
  119-gal allowance) — no papers/placards. Not for delivery cargo.
- **Limited quantity §173.150(b):** excepted from placarding/counting.
- **Placement §172.516:** visible from direction faced; secure; clear of equipment/dirt; ≥3 in
  from other markings; horizontal; maintained legible — right placard badly placed still fails.

### B.4 Segregation — §177.848 (eligibility layer)
Applies to label/placard-required materials incl. compartmented tanks. Fuel-fleet hits:
Class 3 and 2.1 are X (forbidden) with 1.1–1.3/1.5, 2.3 Zone A; Class 3 X with 6.1 PG I Zone A,
O (separation) with 1.4, 2.3 Zone B, 5.1. Class 3 + combustible + 2.1 mutually unrestricted.
Absolute bans §177.848(c): cyanides+acids; 4.2+Class 8 liquids; 6.1 PG I Zone A list.
Transcribe the full (d) grid cell-by-cell with unit tests.

### B.5 Consequences
49 U.S.C. 5123 / 49 CFR 107.329: up to $102,348/violation/day; up to $238,809 with death/serious
injury (2025-adjusted, current as of research date). §177.823: carrier may not move unplacarded
vehicle. CVSA OOS criteria: misplacarded = out of service. Wrong placard also misleads ERG
response — Guides 128 (1203/1202/1863/1268/3475), 127 (1170/1987), 115 (1075).

### B.6 Trickiest rules ranked by misapplication frequency
1. 1,001-lb rule treated per-class (it's aggregate) or applied to cargo tanks (never).
2. COMBUSTIBLE left governing with gasoline aboard.
3. Placards removed from uncleaned "empty" tanks / left on cleaned ones.
4. Missing 3475 display with E>10% blends aboard.
5. DANGEROUS placard on bulk / over-2,205-lb category / with ID number.
6. GASOLINE/FUEL OIL wording used out of scope (E-blends, jet, mixed loads).
7. Diesel Class 3 vs reclassed ambiguity silently assumed.
8. Class 9 bulk "no placard" misread as "no ID display."
9. Wrong ID on placard with mixed same-class products.
10. Subsidiary PIH/DWW given the 1,001-lb break.
11. Materials-of-trade overreach.
12. Placement/visibility failures (§172.516(c)).

---

## Appendix C — Data sources & ecosystem (research findings)

- **eCFR REST API** (ecfr.gov/developers): versioner service, point-in-time Title 49 XML,
  `latest_amended_on` change signal. HMT is an XML table you parse (no official CSV/JSON).
  GovInfo bulk data = same XML, current snapshot only. Official legal version = GovInfo PDF
  (store source + date for audit).
- **PHMSA oCFR tool** (web/iOS/Android): human cross-check target; no API. ERG 2024: free
  PDF/app; extract UN→guide mapping per edition; avoid unofficial scrapes except as diff-checks.
- **Licensable curated data:** NCB/Exis Hazcheck DGL Data (172.101 incl. special provisions +
  RQ values, CSV/Excel, annually maintained); 3E Regulatory Intelligence API (49 CFR + UN/IMDG/
  IATA/ADR).
- **Compliance engines:** Labelmaster DGIS (Web Services API — closest to a US-ground hazmat
  validation API); BDG ShipHazmat (49 CFR BOL wizard); Hazcheck Validate (REST API screening,
  maritime-centric — includes OCR front-end Hazcheck Extract: the closest existing analog to
  this whole pipeline); DGOffice; IATA DG AutoCheck (the human-acceptance UX precedent);
  Placard Wizard (mobile calculator — proof of mechanizability). **No one sells photo-in →
  highway-placards-out. This is white space.**
- **BOL OCR landscape:** Vector, Transflo (driver capture, incl. published capture-guidance
  worth replicating); Klippa/Mindee/Nanonets/Veryfi (BOL extraction APIs — fields only, no
  regulatory validation); Raft, KlearNow (freight doc IDP).
- **Extraction accuracy literature:** vision LLMs beat classical OCR on phone photos/variable
  layouts (mid-90s% field-level realistic); classical OCR wins on clean fixed forms; failure
  modes: skew, glare, carbon/NCR copies, thermal fade, handwriting, stamps, **row
  misassociation in product tables**, plausible hallucination of unreadable values. Mitigations:
  capture coaching, usability gate, multi-shot, dual-pass, per-field confidence + grounding.
- **Load securement:** 49 CFR 393 Subpart I (393.102/.104/.106/.108/.110); FMCSA Driver's
  Handbook on Cargo Securement; arXiv 2306.03795 (two-stage CNN load-safety assessment —
  usability gate is the decisive control). Commercial fleet vision does damage detection; no one
  certifies 393 compliance from photos.

---

*Prepared for FuelGuard (Silvicom Inc.). Decision-support research; not legal advice. All CFR
citations verified against eCFR as of 2026-07-23; penalty figures are the 2025 inflation
adjustment (current as of research date). Re-verify §177.848 grid and Table 1/2 transcriptions
cell-by-cell against live eCFR before shipping the engine.*
