# `@hazmat/data` maintenance scripts (Node-only, not part of the published surface)

These scripts build a new versioned dataset JSON from the primary source (the eCFR versioner API),
diff it against the independent human transcription of the in-scope rows (Source B, `fixtures/
handVerifiedRows.ts` — the D5 v5 official-only second source; no paid vendor), and require human
review before publish (D9). Excluded from the package `files` allow-list and from the package
`tsconfig` so nothing here can leak into a bundle. Local typecheck: `pnpm --filter @hazmat/data
typecheck:import` (uses `import/tsconfig.json`).

## Files

- **`ecfrClient.ts`** — the eCFR REST API client. Node-only, dependency-free (uses global `fetch`).
  Typed wrappers for every endpoint we use, with bounded retry (429/5xx/network, honors
  `Retry-After`), per-request timeout, and an injectable `fetchImpl`/`sleep` for offline tests:
  - versioner: `getTitles`, `getTitleSummary`, `getVersions`, `getStructure`, `getAncestry`,
    `getFullXml` (returns raw XML — never parsed here);
  - admin: `getCorrections`, `getCorrectionsForTitle`.
  Response interfaces are pinned field-by-field against the live API (verified 2026-07) by
  `ecfrClient.test.ts` — if the API drifts, the tests fail rather than a bad shape leaking downstream.
- **`ecfr.ts`** — orchestration over the client: `resolveImportContext` (which day's text to pin,
  from `up_to_date_as_of`), `checkTitleForUpdate` (RELEASING step-1 currency poll),
  `latestSectionAmendment` (precise section-level currency), `fetchHmtXml` / `fetchPlacardTablesXml`
  / `fetchSegregationXml` (raw §172.101 / §172.504 / §177.848 XML), and `importHmtEntries` (fetch →
  parse; fails loudly until the parser lands).
- **`parseHmt.ts`** — the §172.101 XML → `HmtEntry[]` parser. **The next H1 step.** Throws until it
  is built **against a captured real fixture** (see below) — never a guessed GPO-XML structure.
- **`captureFixtures.ts`** — run this **locally**, where ecfr.gov is reachable (CI/sandbox is
  network-restricted), to save real fixtures into `import/fixtures/`: `titles.json`, `versions-172
  .json`, `structure-title-49.json`, `corrections-49.json`, and the three section XML files. These
  frozen fixtures are what the parser and the offline tests build against.
- **`govinfoClient.ts`** — the GovInfo REST API client (api.govinfo.gov). Node-only, dependency-free,
  same retry/timeout shape as the eCFR client. Reads the key from `GOVINFO_API_KEY` (or `{ apiKey }`).
  Covers collections, published, package summary + content, granules list + summary + content (text
  and binary). **The api_key is never allowed into an error message or log** — every surfaced URL is
  passed through `redactKey()` first (asserted by a test). Shapes follow GPO's published docs and are
  confirmed by `govinfoSmoke.ts` against the live service.
- **`govinfo.ts`** — the helper. GovInfo publishes the CFR **annual legal edition** (the officially
  published version), so per D5 v5 it provides three things: the official legal **PDF** the human
  transcriber reads (`fetchLegalPdfBytes` — Source B input), a **provenance** record for audit
  (`toProvenance` → package/granule id, edition year, dateIssued, links), and an independent **XML**
  rendering for the optional cross-check tripwire (`fetchGranuleXml`). `resolveCfrSectionGranule`
  DISCOVERS the package/granule (probes vol 2 first, falls back to listing) rather than assuming the
  volume. It is NOT a fully-independent automated second source (it shares the OFR origin with eCFR);
  the human transcription stays the second source of record for the launch set.
- **`govinfoSmoke.ts`** — a **live** end-to-end test. Run with a real key
  (`GOVINFO_API_KEY=xxx npx tsx import/govinfoSmoke.ts`); it resolves §172.101, prints the provenance,
  downloads the legal PDF (magic-byte check), fetches the XML, and validates every field we depend on.
  This is the verification the network-restricted CI/sandbox cannot do — the smoke run confirms the
  documented shapes against the live service.
- **`fedRegisterClient.ts`** — the Federal Register API client (federalregister.gov/api/v1). Node-only,
  dependency-free, **no API key** (the FR API is fully open). Document search with a `conditions[...]`
  query builder, single/multi document fetch, agencies, facets, issues, public-inspection, and a
  `searchAllDocuments` that follows `next_page_url`. Shapes verified against the live API (incl. a real
  PHMSA HMR rule, 2026-10962) and pinned by tests.
- **`fedRegister.ts`** — the amendment monitor (D5 v5 currency tripwire). `listHmrAmendmentsSince`
  returns PHMSA HMR final (and optionally proposed) rules as decision-ready `HmrAmendment`s — which
  49 CFR parts each touches and, the load-bearing field, its **effective date**. `checkHmrCurrency`
  splits the relevant ones into *effective-pending* (re-cut the dataset before this date) vs
  *already-effective* (may already be stale) — the signal RELEASING.md step 1 consumes. PHMSA is
  agency id 408 / slug `pipeline-and-hazardous-materials-safety-administration` (verified); watched
  parts default to 171/172/173/177/178/180.
- **`fedRegisterSmoke.ts`** — a **live** end-to-end test that needs **no key**, so it runs anywhere
  with network (`npx tsx import/fedRegisterSmoke.ts`): resolves PHMSA, lists recent HMR amendments with
  effective dates, runs a currency check, and re-fetches the known rule 2026-10962 to confirm shapes.
- **`diff.ts`** — the second-source diff (parser output vs the human transcription), **implemented**.
  `diffAgainstTranscription()` pairs Source A (`parseHmtSection` over the captured §172.101 XML — the
  full file if present, else the committed `hmt-fuel-slice.xml`) against Source B
  (`fixtures/handVerifiedRows.ts`) on `prefix+number+name`, reports every field-level disagreement,
  and gates release via `report.clean` (all in-scope rows `done` + audited + zero unexplained diffs).
  Run: `npx tsx import/diff.ts` (prints the report, exits non-zero until clean) → save to
  `datasets/vX/diff-report.md`. Bounded to the 13 in-scope fuel entries (`IN_SCOPE_ENTRIES`).

## Data sources (D5 v5 — all official, all free)

- **eCFR** (`ecfr*.ts`) — Source A, the authoritative machine-readable current text (parser input).
- **GovInfo** (`govinfo*.ts`) — the official legal PDF the human transcribes from (Source B input) +
  provenance + cross-check XML. Needs `GOVINFO_API_KEY`.
- **Federal Register** (`fedRegister*.ts`) — the amendment monitor: when will A and B change, and by
  how much. No key.
- **ERG 2024** (`erg*.ts` + `datasets/erg2024.json`) — the Emergency Response Guidebook UN→guide
  mapping. NOT an API: a quadrennial PDF, extracted once and frozen until ERG 2028.

## ERG 2024 (the one that isn't an API)

The ERG is a static PDF (2020 → 2024 → 2028), so instead of a fetch client it has a one-time,
reproducible extraction:

- **`erg.ts`** — `parseErgIdIndex(text)` parses the yellow "ID Number Index" (`pdftotext -layout`
  output) into `ErgEntry { idNumber, guideNumber }` rows. Two-column-safe; keeps the `P`
  polymerization suffix faithfully (`guidePage()` strips it); skips `— —` no-ID rows; collapses
  alternate names; keeps genuine multi-guide IDs (e.g. 3171 → 138/147/154). `verifyErg()` is the
  acceptance gate (every fuel ID present). Built against a **verbatim frozen fixture** from the real
  PDF, not a guessed layout.
- **`ergExtract.ts`** — regenerates `datasets/erg2024.json` from the committed PDF (physical pages
  30–89) with the PDF SHA-256 for provenance. Needs poppler (`pdftotext`). Run only at ERG 2028.
- **`datasets/erg2024.json`** — the frozen artifact: 1,988 entries / 1,983 unique IDs, extracted from
  `ERG2024-Eng-Web-a.pdf`. The dataset build merges its `entries` into `Dataset.erg`. All 12 fuel IDs
  verified; the 4 multi-guide IDs (1057/3166/3171/3536) confirmed genuine.

## Workflow (Phase H1)

1. `npx tsx import/captureFixtures.ts` on a networked machine → real fixtures land in `fixtures/`.
2. Inspect `fixtures/section-172-101.xml`; implement `parseHmtSection` against its real shape; freeze
   a slice + hand-typed expected `HmtEntry[]` in `parseHmt.test.ts`.
3. Hand-transcribe the in-scope rows into `fixtures/handVerifiedRows.ts` (Source B) from the official
   GovInfo legal PDF ONLY (do not read the eCFR XML or parser output while transcribing). Each row's
   discipline + a filled example are documented at the top of that file; set `status: "done"` and fill
   `source`/`transcriber` per row.
4. `npx tsx import/diff.ts` compares parser output vs transcription — zero unexplained disagreements
   (and every in-scope row `done` + audited) to ship.
5. Follow `RELEASING.md` to cut the versioned dataset.

Populated across Phase H1. The API client (step 0), the parser (step 2), and the diff engine (step 4)
are done and tested; the human transcription (step 3) is the remaining launch blocker.

## Reference text (D12 — display + audit only, never the engine)

The citation-keyed plain text of the CFR sections we cite — so a human can read the rule behind a
verdict and the audit chain records what text a verdict relied on. It is a SEPARATE store from the
engine `Dataset` (structurally: `evaluateLoad()` only receives a `Dataset`, so it cannot read it).

- **`../src/referenceText.ts`** — published types + `loadReferenceText()` + `referenceForCitation()`
  (resolves a rule's citation, e.g. `49 CFR 172.504(f)`, to its section + paragraph).
- **`referenceText.ts`** — `extractSectionText(xml)`: a *tolerant* XML→paragraphs extractor. Works on
  the eCFR `full` XML (DIV8/HEAD/P) OR the GovInfo content XML (SECTION/SECTNO/SUBJECT/P), because it
  reads paragraph boundaries, not a fixed schema. Tolerance is safe here precisely because this text
  is display-only — a formatting imperfection is cosmetic, never a wrong verdict (unlike the HMT parser).
- **`referenceTextBuild.ts`** — fetches each cited section via the eCFR client and writes
  `../datasets/referenceText.json`. Run where eCFR is reachable: `npx tsx import/referenceTextBuild.ts`.
  Grow `REFERENCE_SECTIONS` as the H2/H3 rule catalogs cite more sections.
