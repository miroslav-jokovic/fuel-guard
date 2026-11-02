# OCR judge (MiniCPM-OCR + Jev) — a parallel check on the BOL reader, behind a Settings switch

Started 2026-11-02 at the owner's request: "research Jev AI … implement it as a parallel system, add a switch
in Settings, and we will test it." Companion to `READER-CORRECTNESS-PLAN.md` (whose Promise 1 — *never
silently wrong* — this plan may not weaken) and `DOCUMENT-READER-PLAN.md` §7B (the witnesses).

## 1. What "Jev" is, measured against what we need

Two unrelated products share the name. Neither reads a document by itself.

| | **MiniCPM-OCR Jev** (OpenBMB, 2026-10-27, Apache-2.0) | **TypeSafe Jev** (hosted API) |
|---|---|---|
| What it does | Scores a candidate OCR transcript of one page REGION against the region's image: 0–1, "is this transcript correct" | Answers typed questions (choice / score / probability) about text it is given |
| Input | region crop + candidate text + `category` (text / table / formula); renders the text with Chromium and compares | text; images are beta ("not recommended for production"), refused over 1,568 px a side |
| Companion | MiniCPM-OCR 1.0, a 1.3B page parser (text, tables) that leads the vendor's "phone photos at an angle" benchmark | DocJev (LlamaIndex) — classify and split documents |
| Accuracy (vendor's) | AUROC 93.6 on JevOCRBench; 91.9–93.4 judging other engines' output, PaddleOCR-VL among them | 20/20 page types on one trade-document test |
| Runs | self-hosted: vLLM/SGLang on a ≥12 GB GPU (their Docker image), or llama.cpp GGUF (Q8 2.0 GB, Q4 1.2 GB) | api.typesafe.ai / OpenRouter, $0.042 per M input tokens |
| Languages | English, Chinese; handwriting not reported | — |

**TypeSafe Jev is out of scope (D-OJ1).** Its only candidate job here is the page classifier (P2, Haiku 5.5
today), and its 1,568 px cap is the exact downscale D-DR16 removed from the reader.

**MiniCPM-OCR Jev is a fit — as a witness, never as a reader.** It does what our OCR witness lacks: it says
*how far to trust a transcript of this row*. It cannot say what the paper prints when no engine read it
("quality is bounded by the candidates' coverage", model card), and every number above is the vendor's.

### Where it would help — the measured gap

The row witness (`evidence/rowWitness.ts`, A5) backs a hazmat line's count, weight and quantity only when
PaddleOCR PP-OCRv6 prints that value as a token on the line's own row. It reads 45 of 49 true values on the
office BOLs; where it misreads or loses a row, the field stays *Check* and a person confirms it. On the five
production reads replayed 2026-10-21, 29 "confirm it first" remain. A second OCR engine on the same row, with
a judge saying which transcript to trust, can only turn some of those into backed values — it cannot accept a
value no reader read, because the judged transcript goes through the same `rowBacks` rule.

Production volume today: 20 reads, 31 pages, 193 explicit field reviews on 10 reads (queried 2026-11-02). So
the cost of this plan is the host, not the per-read compute, and the test set is the 196-photo corpus plus
the office BOLs plus those 10 reviewed reads.

## 2. Decisions (proposed — the owner's answers in §6 may change them)

**D-OJ1 — MiniCPM-OCR + Jev only; TypeSafe Jev is not used.** (§1.)

**D-OJ2 — The judge is a row witness, never a reader.** For each hazmat line whose printed row `rowOf` finds
unambiguously, the same crop is transcribed by PaddleOCR (already done) and MiniCPM-OCR 1.0; Jev scores both;
the best transcript with `verdict: "scored"` and a score at or above the threshold is put through
**unchanged** `rowBacks` / `rowCanJudge` rules (the class-token exclusion included). The judge therefore
chooses between transcripts, and the transcript can only back one of the readers' values — Promise 1 holds
by construction, not by tuning. Identifying fields (UN/NA id, name, class, PG) are not judged in v1.

**D-OJ3 — Parallel (shadow) first: it changes nothing a user sees or the read decides.**
- It runs as its own queue job, `document_read_judge`, enqueued after a read reaches `done`. The read's time,
  outcome, evidence, audit, prefill and calculator are untouched; the job's failure is invisible to users.
- It writes only to a new table, `document_read_judgements` (one row per run, append-only, RLS on with no client
  policies). Nothing on the live path reads that table.
- A property test runs a read with the judge on and off and requires the `document_reads` row to be identical.

**D-OJ4 — Two switches, both must be on.**
- **Settings (per org, admin only):** a new *Settings → Document reading* page with **"Parallel OCR check
  (test)" — Off / On**. Stored in a new `document_reading_settings` row (org, mode, who, when) and audited. A
  third state, "Use in checks", is NOT added until §5 step J6 builds the code it would switch: a setting with no
  consuming code is a lie waiting to be believed (`orgHazmatPolicySchema`'s rule).
- **Environment (per deployment):** `DOC_JUDGE_URL` (unset = the service is not there; the Settings page says
  "Not connected" and the switch is disabled) and `DOC_JUDGE=off` as the global kill switch.
- The reader stays consumer-free (D-DR1): the setting is the reader's, not the hazmat policy's
  (`orgHazmatPolicySchema` is locked to the hazmat extractor's two knobs).

**D-OJ5 — Jev's failure is absence, never a low score.** Only `verdict: "scored"` counts; the fixed `0.0` and
`-1.0` it returns when rendering or scoring failed are recorded as `unavailable`. A timeout, a 5xx or an
unreachable service ends the judgement `unavailable` after at most 2 attempts, and a per-process circuit
breaker stops calling a service that failed 5 times in 10 minutes. Same rule as the OCR witness (`pageOcr.ts`).

**D-OJ6 — Everything that can move a score is pinned and recorded.** Model repository revisions and sha256 of
every file (the `ocrModels.ts` pattern), quantisation, container image digest, renderer version, crop rule
version and threshold — together the `judge_version` on every row. A change is a new version; scores from two
versions are never pooled. CPU/GGUF scores are accepted only after they match the reference (BF16) scores
within 0.02 on the vendor's bundled examples and on 50 of our rows (the vendor's own install check).

**D-OJ7 — The thresholds are ours, from our pages.** No vendor default exists. The threshold is chosen per
field kind (count, weight, quantity) from the corpus so that **false-backs = 0** (D-RC3), then reported
with the yield it buys. Handwritten values are scored as their own band — Jev reports nothing on handwriting.

**D-OJ8 — Isolation.** The engine runs as its own container on its own host — never on the production
t4g.large (2 vCPU burstable, 8 GB, already carrying the API and PaddleOCR's ~1.2 GB). The host has a private
address only. Requests are authenticated with a shared secret from Parameter Store. Images are processed in
memory and never written, and logs carry ids and numbers only — never page words (the `[metrics]` rule).
Model files are fetched once at a pinned revision, and the host needs no other outbound access.

**D-OJ9 — It counts only on the owner's word, given numbers.** Moving from parallel to "use in checks" is a
separate step (J6): the judge becomes a witness in `shippingEvidence`, the acceptance rule version is bumped,
and its tests join `lint:reader-gate`. That happens only after §4's report shows 0 false-backs on the corpus,
the office BOLs, every reviewed production read and the parallel weeks, plus a gain worth the host.

## 3. How a judgement is made (data flow)

```
document_reads row → done
   └─ enqueue document_read_judge {readId}        (only if org mode = on AND DOC_JUDGE != off AND DOC_JUDGE_URL set)
        1. load the read's replay_inputs (passB, ocr pages, text layer) + evidence + the page originals (sha256-verified)
        2. for each hazmat line: rowOf(ocr, id, nth, linesWithId) → row bbox, or abstain (as the live witness)
        3. crop the row from the SAME view the live OCR used (prepared view via toPage, else upright original)
        4. POST /judge {crops: [{id, png, candidates: [{engine:"ppocr", text}], transcribe:"minicpm"}]}
              sidecar: MiniCPM-OCR 1.0 transcribes the crop → Jev scores both transcripts (category "text")
        5. best scored transcript ≥ threshold → rowBacks(readers' values) → per-field word
        6. INSERT document_read_judgements {org, read, judge_version, status, rows[], fields[], timings}
```

Each `fields[]` entry carries `{path, live: <the live OCR witness's word>, judged: <this lane's word>,
scores, chosen engine}`, so "where would the parallel check have changed the verdict" is a column read, not a
recomputation. The comparison against people's reviews (`document_read_reviews`) is computed at report time,
so a later review still counts.

## 4. How we test it (the owner's "we will test it")

**Phase 0 — offline spike on the Mac, no product code, no host bought (≈1 day).**
`apps/api/src/scripts/judgeSpike.ts` runs llama.cpp/Metal locally over the 196-photo corpus, the ten office
BOLs and the ten reviewed production reads (their `replay_inputs` carry the OCR boxes). It reports:

1. Jev's AUROC on OUR rows (truth = labels and explicit reviews). The vendor's 93.6 is not assumed.
2. **False-backs: values the judged lane backs that the truth says are wrong. Must be 0.**
3. Clears: fields the live witness left *Check* that the judged lane backs correctly, per field kind and band
   (photo / scan / fax / handwritten).
4. Seconds per row on the Mac, and on a rented Graviton c8g.xlarge for one hour (≈$0.20) — this decides Q-OJ1.
5. GGUF vs BF16 score drift (D-OJ6).

**Gate:** 0 false-backs AND enough clears to be worth a host (owner's call, Q-OJ5). If it fails, the result is
written here and the plan stops — a recorded "no" is work.

**Phase 1–2 — the parallel lane on staging, then production with the switch on for Silvicom (≥ 4 weeks).**
`pnpm --filter @silvicom/api doc:judge-report` (and the same table on the Settings page) shows each week:
reads judged, unavailable rate, p50/p90 seconds, fields where live and judged differ, and each against the
person's review where one exists. Every staging build first replays all stored reads (`doc:replay`) with the
judge, so a change shows its diff before it merges (D-RC2).

## 5. Build order

Each step is its own merge. The migration ships before its first reader (`lint:migration-ordering`), and new
tables are exempt from the two-release rule.

| Step | What | Waits on |
|---|---|---|
| **J0** | Phase 0 spike + report in §7 | owner go on this plan |
| **J1** | Migration: `document_read_judgements` + `document_reading_settings` (RLS on, no client policies, org FK, append-only judgements) | J0 gate |
| **J2** | Shared contract (`documentJudgeContract.ts`); API: settings GET/PUT (admin, audited), the `document_read_judge` job + enqueue after `done`, the sidecar client with D-OJ5's failure rules, `expectOrgScoped` tests, the on/off identity property test | J1 |
| **J3** | The sidecar container (`tools/ocr-judge/`): llama.cpp or vLLM server + the vendor SDK's renderer, pinned (D-OJ6), `/healthz`, shared-secret auth; staging host per Q-OJ1 | J0 latency, Q-OJ1 |
| **J4** | Web: *Settings → Document reading* — the switch, connection status, and the weekly comparison table; added to `NAV_SURFACES`/settings surfaces | J2 |
| **J5** | `doc:judge-report` + the replay hook; ≥ 4 weeks parallel on production for Silvicom | J3, J4 |
| **J6** | (Only on D-OJ9) the judge as a live witness: `shippingEvidence` gains `judge`, acceptance rule bump, "Use in checks" state added to the switch, tests into `lint:reader-gate` | owner, with §4's numbers |
| J7 (later) | Missed-line sweep: MiniCPM's full-page parse flags a UN/NA id printed in a high-scoring region that no reader read — the "silently missed line" failure. Parallel first, like J1–J5 | J6 or owner |

## 6. Open questions

**Q-OJ1 — Where does the engine run?**
*(a)* **Recommended:** Phase 0 on the Mac (free). Then a separate CPU instance (c8g.xlarge, 4 vCPU / 8 GB,
≈ $115 a month on demand, stoppable when we are not testing) on staging, and on production for the parallel
weeks — but only if Phase 0 measures it fast enough. A parallel lane has no user waiting, so minutes per BOL
are acceptable; "use in checks" (J6) is not.
*(b)* A GPU instance (g6.xlarge, L4 24 GB, ≈ $590 a month always on; less if started only when jobs wait) —
the vendor's Docker path, seconds per page. Worth it only at J6, and only if CPU is too slow.
*(c)* A serverless GPU vendor (Modal, RunPod) — cheapest at 20 reads a month, but BOL images leave our AWS
and Anthropic. Not recommended for v1.
*(d)* The production t4g.large — rejected (D-OJ8).

**Q-OJ2 — Is the switch per org (recommended), or one switch in the platform console?** Per org matches
`extractionEnabled` and lets Silvicom test while any other tenant stays off.

**Q-OJ3 — Who sees the parallel results?** *(a)* **Recommended:** admins only, on the Settings page. *(b)*
Also a "Parallel check" line in the BOL panel for dispatchers — more eyes, but a second opinion on screen
that does not decide anything invites people to act on it, which is J6 by the back door.

**Q-OJ4 — v1 scope.** *(a)* **Recommended:** row numbers (count, weight, quantity) only, then J7's missed-line
sweep. *(b)* Also the UN/NA id on split readings (today `idWitness.ts`, Q-RC7) — adds a third source to a
three-source rule that already holds; later.

**Q-OJ5 — What gain pays for a host?** Recommended: proceed past Phase 0 only if the judged lane clears at
least a quarter of the remaining count/weight/quantity "confirm it first" stops with 0 false-backs;
otherwise record the result and stop.

## 7. Progress log

- **2026-11-02** — Research and plan (this file). Sources: MiniCPM-OCR-Jev model card and tutorial
  (huggingface.co/openbmb/MiniCPM-OCR-Jev; github.com/OpenBMB/MiniCPM-OCR `docs/minicpm_ocr_jev_tutorial_en.md`),
  GGUF card (huggingface.co/openbmb/MiniCPM-OCR-Jev-gguf), Flowtivity's review (2026-10-28), TypeSafe Jev on
  OpenRouter / Cloudflare / LiteLLM docs. The reader's state read off `main`: Sonnet 4.6 + Sonnet 5.5
  readers, Haiku 5.5 classifier, PP-OCRv6 row witness on the prepared view. Production counts queried read-only.
- **2026-11-02 — J0 run on the Mac (owner: "test it on Mac").** Rig: llama.cpp b12047 (Jev Q8_0, Metal) and b11901
  (MiniCPM-OCR 1.0 Q8_0, Metal) — Homebrew's llama.cpp 0.8.0 fails to compile its Metal shaders on this macOS and b11901
  does not know Jev's model type; the vendor's renderer (MiniCPM-OCR `c0881ac`, Ubuntu 24.04, pinned Chromium and fonts)
  in Docker. Install check: the vendor's three reference cases within 0.011 of theirs (they allow 0.02). Truth labelled
  by eye: 9 office BOLs with a UN line (19 lines) and 21 production BOL photos (35 lines, 71 values), downloaded
  read-only. Scripts: `apps/api/src/scripts/judgeSpike.ts`, `judgeSpikeScore.ts`, `judgeMutantProbe.ts`.
  **(1) Jev as a tie-breaker is excellent.** Each printed number box, scored against its own text and up to four
  one-digit misreads of the value (the 9-for-6 kind): office 38/38 boxes ranked the truth first, 0 of 152 misreads
  scored ≥ 0.5; photos 64/65 first (the 65th a 0–0 tie on a garbage box), 0 of 260 misreads ≥ 0.5; pairwise AUROC
  1.000 and 0.992.
  **(2) Jev's absolute score is NOT a usable "trust it" gate on our paper.** Correct transcripts scored low: office
  median 0.13 on boxes where both engines agree, 14/38 true numbers ≥ 0.5; photos 49/65. A threshold gate (D-OJ7 as
  written) would discard most true values. D-OJ2 should be restated as: Jev chooses between two transcripts of the same
  box, and its choice counts only when the chosen one scores above the other by a margin; the threshold is not used.
  Scoring a whole row strip at once gave ~0 even for correct transcripts — boxes, not rows.
  **(3) On the row rule, the second engine adds little where today's witness already finds the row.** Office: live
  backs 36/36. Photos: live 45/48, with MiniCPM per box + Jev 46/48 — it read `2,70O.0` as 2,700.0 (Jev 0.973 vs 0.000)
  and `,102.00 5` as 1,102.00 (0.947 vs 0.000); on 7 boxes where the engines disagreed about a true value Jev picked
  the true one 5 times, and both scored ~0 on the other 2. No lane backed a misread where live did not.
  **(4) The real gap is the rows today's witness never finds: 11 of 35 photo lines** (abstained — the UN number not
  read, or not printed as often as the lines carrying it, e.g. Sonny's supplement prints "1760" without "UN" twice).
  MiniCPM-OCR on the WHOLE page (≈7 s a page on the Mac GPU) read the UN number on 13 of those 15 line-readings and
  every one of their 26 true values somewhere on the page. That is page-level, not row-bound (the 0132900 "9" trap), so
  it is not yet a witness — but it says the next experiment is MiniCPM's own layout + reading order as a row source
  (J7's direction), not Jev on Paddle's rows.
  **(5) A finding about TODAY's witness, independent of Jev:** on Mayo 14182 the UN1824 row's window reaches the next
  line and prints its "2"; the true 8 totes is a class-8 token and unprovable, so if the readers split 8 vs 2 the row
  would back the 2. Worth a row-window test in the reader-correctness census (RC-style), whatever happens to this plan.
  Speed: ~2–5 s per box for MiniCPM + Jev on the Mac GPU (~20 boxes on the hazmat rows of a page); 24 of 215 office
  boxes failed to render (vendor renderer timeout) and were counted as no opinion, 0 of 447 on photos. No CPU numbers
  yet (Q-OJ1). **Gate (§4): 0 false-backs — met. Gain on today's rows — 1 value of 48, below Q-OJ5's bar.**
  Recommendation to the owner in §6 Q-OJ6.

**Q-OJ6 (2026-11-02, after J0) — What next?** *(a)* **Recommended:** stop building J1–J5 as written (Jev on today's
rows clears ~2 % and its threshold gate does not work), and run J0b instead: MiniCPM-OCR's full parse (its layout model
gives regions and reading order) as a SECOND row source for the lines today's witness cannot find, judged by the same
`rowBacks` rule, with Jev only breaking ties between the two engines' text of one box. Same offline harness, ~1 day, no
spend. *(b)* Build the parallel lane now as planned, to collect weeks of production data. *(c)* Stop here.
