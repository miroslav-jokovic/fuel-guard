# The driver handbook, signed on screen (D3's handbook half) — plan and queue

**Created 2026-09-25.** Execution-grade. Every "today" fact in §2 was read at the call site on `main`
`f073188`, or off the carrier's own file `docs/Kowlage-Base/DRIVER HANDBOOK.docx` (committed with this
plan, at the owner's instruction). This supersedes `ORIENTATION-PLAN.md` Q-OR1/Q-OR6 (the handbook
half only; orientation's page 24 stays there). `HIRING-MODULE-PLAN.md` §0's protocol applies: one step,
one PR, append to §8 of THIS file, prove a test can fail, a migration and its first reader in two
merges.

---

## 1. The owner's rulings (2026-09-25)

- **D-HB1 · Digitised and signed on screen like the application, as its own step BETWEEN
  `application_signed` and `hired`.** Asked *"why we dont digitalize this Handbook same way as
  Application and create signing flow … and add it as separate step between Application Signed and
  Hired?"* That reverses D-HM9's order (the handbook was step 15, before the packet) and supersedes
  ORIENTATION-PLAN Q-OR6's paper recommendation.
- **D-HB2 · The receipt page's SSN prints as `•••1234`.** The last four only, from
  `driver_applications.ssn_last4`. D-HIRE6 (the full number is sealed, never printed) stands.
- **D-HB3 · The carrier's countersignature comes from a managed list of Representatives**, *"we can
  manage add or delete, same way as we did for Inspectors in Maintenance"*. The pattern is
  `maintenance_inspectors` (`inspections/inspectors.ts`): add, and delete, with deletion refused by
  the database once a signed document names them.
- **D-HB4 · The text is the carrier's, exactly, and laid out properly.** *"pull this text exactly,
  also make sure formatted properly in document laid out."* D-PKT11 applies: typos print as written
  (`COMPNAY`, `THA`, `TEMINATION`, `FLASIFICATION`, `forgoing`). The text is EXTRACTED from the
  committed `.docx` and a test re-reads it, never retyped. Layout (headings, lists, the fines schedule
  as a real two-column table) follows the document's own structure.
- **D-HB5 · It BLOCKS the hire.** *"block, he needs sign it before hiring."*
- **D-HB6 · The handbook's typing errors are corrected** (owner, 2026-09-25: *"yes handbook was
  retyped too, fix it"*). Supersedes D-HB4's "typos print as written" half; the layout half stands.
  `handbookText.json` stays the faithful extraction the test checks against the Word file;
  `handbookSpelling.ts` (16 entries, spelling only) is applied on top in `handbookText.ts`, and the
  version hash moves with it (`hb-9b1b62dabbbab0b5` → `hb-f3a7b90d3622c2a3`; production held 0
  handbook marks, so nothing filed changes). Not corrected, because each needs wording supplied:
  *"Check on the all fluids"*, *"fuel, fax, truck accessories"* (`tax`?), *"deducted from its
  paycheck"*, *"indicating any adjustments that will be made"*, *"Failure to turn trailer
  inspections"* (missing `in`), *"at the same day"*, *"will be made in for damaging"*.

---

## 2. What exists today (verified 2026-09-25)

### 2.1 The carrier's handbook, as a Word document

258 paragraphs, no tables, no explicit page breaks. The fines schedule and the bonus list are laid out
with runs of spaces. Sections, in order: the title (`DRIVER HANDBOOK`, `SILVICOM INC`); **Passenger
Policy**; the memo **To: all drivers and owner operators** (OAI, truck upkeep, the nine fuel rules,
receipts, paperwork, cash advance) → **signature block 1** (`DRIVERS NAME` / `DRIVERS SIGNATURE` /
`DATE`); **Supplemental: Silvicom Inc Driver Policy and Driver Rules** (18 numbered rules); **Hours of
Service Policy** and **DISCIPLINARY PROGRAM FOR LOG VIOLATIONS**, personal conveyance; **Safety policy
and Fines** (a 27-row schedule), **Bonus**, the amendment clause → **block 2** (`Driver’s Name` /
`Driver’s signature` / `Date`); ELD charges, then *"By signing this, I agree to safety penalty
policy."* → **block 3** (`Driver/Owner operator` / `Date`); *"I, Driver, have read …"* → **block 4**
(`Date`, `Agreed:` **Driver** and **Silvicom Inc**); **SAFETY STANDARDS AND POLICIES RECEIPT** →
**block 5** (`Driver name`, `Driver signature`, `Date`, `SSN`).

So the driver signs **five** places, and the carrier countersigns **one** (block 4).

### 2.2 The machinery that exists

- The packet ceremony (C1/C2, AF5): the office opens signing (`open_packet_signing`, 0369), the driver
  adopts a signature and initials (`application_captures` `signature_mark`), and each place is a row in
  `application_packet_marks`. ⚠ `record_packet_mark` raises **DR033 `packet_already_filed`** once
  `submitted_at` is set, and that is right: the packet is closed. **The handbook cannot ride on it. It
  needs its own marks table.**
- Because the handbook comes AFTER the packet, **the driver's adopted signature already exists** when
  it is signed. No second adoption.
- `road_test_examiners` (0372) is the "a person the office adds, with a signature PNG" pattern.
  `maintenance_inspectors` (0280) is the "add or delete, delete refused once referenced" pattern.
- 0373 made `handbook` a `documents.kind` and a `qualification_records.kind`.

### 2.3 ⚠ Nothing refuses a hire today

`hireApplicant.ts`: *"HIRE IS A FACT, NOT A PERMISSION. Nothing here refuses to record a hire because
the file is incomplete."* `readyToHire` (`hiringChecklist.ts`) has **no caller** in the API or the web.
Q-HM5 ("`readyToHire` refuses the hire outright on all six", ruled 2026-09-17) was **never built**.

So D-HB5 cannot be built as "the handbook blocks" alone: that would make the handbook the one thing
that stops a hire while a missing drug test does not. **The honest build is Q-HM5's refusal, with the
handbook added to what `hired` requires.** Derived from the catalogue (`hiringSteps.ts`'s `hired`
step `requires`), never a second hand-written list. See HB5.

### 2.4 The packet's own countersignature lines are blank

`p18c`, `p19ac`, `p19bc`, `p22c` (`Silvicom Inc Representative:`, `Company reprsentative's signature`)
print blank: *"the applicant is not signing them"* (`packetSigningGeometry.ts`). D-HB3's
Representatives are exactly who signs those. Q-HB1.

---

## 3. The target

After the packet is filed, the office presses **Open handbook signing**. On the applicant's link the
driver reads the handbook, page by page as the carrier laid it out, and signs its five places with the
signature they already adopted. The office then chooses a Representative and countersigns block 4.
The product files the signed handbook as a PDF (`documents.kind = 'handbook'`) and one
`qualification_records` row of kind `handbook` citing it. The `handbook` step turns green, and only
then can the driver be hired.

---

## 4. Steps

### HB0 · Schema · migration 0374, alone
`carrier_representatives` (name, title, a signature PNG under `<org>/representatives/`, `created_by`;
never edited, deletable until a signed document names them). `handbook_marks` (one row per signed
place, driver or carrier, the version of the text signed, and for the carrier the Representative and
the office user; append-only). `application_invitations.handbook_signing_opened_at/_by` and
`handbook_filed_at`. A guard trigger refuses a mark unless the application is filed, handbook signing
is open, and the handbook is not yet filed. Matrix, mutants, `rls.test.mjs` seeds, and producer waivers
for one merge.

### HB1 · The text as data · shared
`handbookText.ts`, generated from the `.docx` by a script, with a test that re-extracts the file and
compares. It holds a structured document: headings, paragraphs, lists, the fines schedule as rows, and
the five signature blocks as placements (`h1`…`h5`, plus `h4c` for the carrier).
`HANDBOOK_VERSION` is a hash of the source text.

### HB2 · The renderer · api
`applicationPdf/handbook.ts`: the carrier's letterhead and layout, through `newDrawing` (names as
typed). The fines schedule is a ruled two-column table and the numbered rules are hanging-indented.
It draws the driver's adopted signature at each of h1–h5, the Representative's at h4c, `•••1234` for
the SSN, and on every page who applied the carrier's signature. Rasterised and looked at, with a long
non-ASCII name.

### HB3 · The API
- Office: `GET/POST/DELETE /api/recruitment/representatives` (delete answers 409 once the
  Representative has signed a handbook).
- Office: `POST /applicants/:driverId/handbook/open` and `…/handbook/countersign`, which files the
  PDF and the record once all six marks exist.
- Link: `GET /:token/handbook.pdf` (unsigned, on the ceremony bucket) and `POST /:token/handbook/mark`.
- The signed copy is offered to the driver on the link, in RT4's way.
- Every act is audited.

### HB4 · The screens
- Office: the `handbook` step drawer. If no Representative exists it asks for one, then offers Open
  signing, then Countersign.
- Driver: the handbook ceremony on the link after the filed card, reusing `PermissionDocumentView`
  and the packet's stop walk.

### HB5 · The step and the hire gate
- `hiringSteps.ts`: `handbook` moves between `application_signed` and `hired` (D-HB1), with evidence
  `qualification_records.handbook`, and `hired.requires` gains it.
- `hireApplicant.ts` refuses with `not_ready_to_hire`, naming the steps, while any step in
  `hired.requires` is not done (Q-HM5 + D-HB5). The web's Hire button says why.

HB1–HB5 ship in ONE merge after 0374 is visible in production, as RT1–RT3 did.

---

## 5. Deliberately not in this plan
- Orientation's page 24 (`ORIENTATION-PLAN.md`, Q-OR8).
- Re-signing when the carrier amends the handbook: a new version is a new `HANDBOOK_VERSION`, and
  drivers already hired are not asked again (Q-HB2).
- The drug-and-alcohol policy (ORIENTATION-PLAN Q-OR7), and counsel's review (Q-OR9).

---

## 6. Q-HB1 — the Representative signs the packet's four carrier lines (DESIGN, 2026-09-29)

**Status: APPROVED (owner, 2026-09-29: Q-HB3 (a), Q-HB4 yes).** Q-HB1 was ruled yes on 2026-09-29, and the
owner asked for the design before any build. D-HB7..D-HB10 below are ruled as written. Every "today" fact below was read at the call site on `main` `bc0ca4e`
or measured on production the same day. Nothing is built.

### 6.1 What was measured

- **Production:** 0 filed applications, 0 filed packet documents, 1 Representative, 0 handbook marks
  (read-only, 2026-09-29). So nothing is frozen yet and nothing is in flight.
- **The carrier lines were NOT measured before today.** The handoff said their geometry was already
  in `packetSigningGeometry.ts`, but it isn't. That file only *names* them, as what stays blank.
  `packetMarkGeometry.ts` holds only the driver's lines. Measured today from the template's own rules,
  then drawn in magenta with cyan span ticks, rasterised at 110 dpi and looked at:

  | Place | Page | Signature rule (x1–x2, y) | Date rule | Notes |
  |---|---|---|---|---|
  | `p18c` | 18 | 205.7–553.2, y 110.3 | none | ~23 pt above the carrier's footer |
  | `p19ac` | 19 | 205.7–412.2, y 492.7 | 463.7–553.2, y 492.7 | `Date:` label at x 414 |
  | `p19bc` | 19 | 205.7–553.2, y 157.4 | none | |
  | `p22c` | 22 | 50.9–309.0, y 157.4 | **412.1–553.2, y 141.2** | caption *under* the rule |

  ⚠ **Looking caught one thing reading could not.** `p22c`'s `Date` rule is not level with its
  signature rule, as on the other pages. It sits beside the `Date` caption, 16 pt lower. A date
  placed level with the signature floated in blank space. Every coordinate above is still a
  candidate: the build draws them again on a real filed packet (with its withdrawal notices) and
  looks at them again, with a long non-ASCII name.
- **Three of the four lines sit beside a driver line that reads "Not signed here."** Page 19's
  `p19a`/`p19b` (D-MVR1) and page 22's `p22` (D-PKT19) are withdrawn, and the filed packet prints
  *"Not signed here. Signed electronically as its own permission."* on them. Only `p18c` sits beside a
  real packet signature, the single-licence certification. See Q-HB3.
- **The packet is filed once, at certification** (`file.ts` `ensureApplicationPdf`). Its three
  readers all go through that one function: the submit path, the office's
  `GET /drivers/:id/application` (`applicationInvites.ts`) and the driver's own copy
  (`applicationCopy.ts`). The §391.51(b)(1) `qualification_records` row cites the document, and
  `attach_application_document` writes the citation only where it is null.
- **Nothing in Part 391 or 383 makes the carrier's countersignature a condition of the application.**
  §391.21(a) asks the APPLICANT to complete and sign it. The counsel memorandum mentions the carrier
  lines once (its page table: *"The applicant is not asked to sign those"*) and asks nothing about
  them. So the regulation does not set the timing. The design is free to choose it, and the choice
  should not delay the applicant's filing.

### 6.2 The frozen-file problem: the three options, measured

| | (a) Hold the filing until the office countersigns | (b) File a second copy, countersigned | (c) Countersign only in the handbook's filing |
|---|---|---|---|
| The four packet lines | Signed | Signed | **Blank forever.** The ruling isn't met |
| Driver's copy right after filing | Must refuse, or render and freeze it blank. `applicationCopy.ts` renders on demand | Unchanged | Unchanged |
| D-APP9 "heals on the next read" | Broken: every read before the countersign would file it | Unchanged | Unchanged |
| A rejected applicant | §391.51(b)(1) record without a document, possibly forever | Keeps the driver's filing | Same |
| `qualification_records` / `RETENTION_FORBIDDEN` | Citation delayed, not changed | Untouched. The second copy is cited by a new evidence row (§6.4) | Untouched |
| Changes D-AW16 | Yes: certification no longer files the packet | No | No |

**Recommendation: (b), with one refinement that matters: STAMP, don't re-render.** The countersigned
copy is made by loading the **filed bytes** of the driver's packet and drawing the four carrier marks
onto them with `pdf-lib`. It is not rendered again from the evidence. Rendering again would use
*that day's* renderer. Any change between filing and countersign (a spelling patch like D-PKT20, an
overlay fix) would then make the second copy differ from the first in more than the four lines. Two
"copies" of a federal record that disagree is F6's objection (`preview.pdf` refuses for exactly that
reason). Stamping makes the difference provable: the countersignature row stores the SHA-256 of the
bytes it stamped, and a test proves that every page's text other than the four lines is unchanged.

A side effect: **the frozen-file deadline stops applying to Q-HB1.** The driver's filing never carries
the carrier lines, so it doesn't matter whether this ships before or after the first real applicant
files. Their packet can be countersigned whenever the office acts.

### 6.3 When: one act with the handbook countersign (proposed D-HB7)

The handbook drawer's **Countersign** press becomes *"Countersign for Silvicom Inc"*. With ONE chosen
Representative it signs `h4c` **and** the four packet lines, in that order inside the existing
filing claim (`handbook_filing_claimed_at`, A-10):

1. record the packet countersignature row (§6.4). A retry keeps the Representative already recorded,
   as `h4c`'s retry does;
2. stamp and file the countersigned packet, and write its document id onto the row;
3. only then, record `h4c`, file the handbook and stamp `handbook_filed_at`, as today.

Why together rather than a second press:
- It is the same act by the same person, and D-HB3's Representatives are exactly who signs these
  lines. Two presses would mean two Representative choices that can disagree.
- D-AW16's envelope already puts the driver's packet and handbook in one session, so the packet
  countersign waits hours at most, not days.
- **It answers the hire gate without a new gate** (§6.6).

The cost is that a packet can't be countersigned for an applicant who never signs the handbook. That's
correct: the carrier never took them on. Their filed packet keeps its blank lines, the true record.

### 6.4 Where the mark is stored: a new table, not either existing one (proposed D-HB8)

- **Not `application_packet_marks`.** Its guard raises DR033 once `submitted_at` is set, and that is
  the packet's closing seal. Loosening it for `party = 'carrier'` would weaken the one guard that
  says a filed packet takes no more marks from anyone.
- **Not `handbook_marks`.** Its placement CHECK is `^h[0-9]+[a-z]?$`, and its guard's order (HB022–
  HB024) is the handbook's. Packet ids in it would need both changed, and the table's name would lie.
- **New `application_packet_countersignatures`**: ONE row per invitation (unique), because the four
  lines are one act with one signature:
  `org_id`, `invitation_id`, `application_id`, `representative_id` (FK **on delete restrict**, so
  deleting a Representative who signed is refused with 23001, which `representatives.ts` already maps
  to 409 `has_signed`), `recorded_by`, `signed_at`, `placements text[]` (the carrier ids signed,
  derived from `PACKET_PLACEMENTS` `party = 'carrier'`, so a future ruling that withdraws one is
  recorded, not assumed), `source_sha256` (the driver's filing it stamped), `document_id` (null until
  step 2; written once, by a guarded `null → value` update only), `signed_ip`, `signed_user_agent`.
  RLS on, no client policies. Append-only apart from that one write, including against a cascade
  (HB011's pattern). Pinned in `RETENTION_FORBIDDEN`. A guard refuses a row unless the invitation is
  filed, handbook signing is open and the handbook is not yet filed (h4c's own order).
  ⚠ Check `merge_driver`'s list (memory `merge-driver-cascade-trap`).
- **Readers:** `ensureApplicationPdf` answers with the countersigned copy once the row has a
  `document_id`, and the driver's filing before that. That one change covers all three readers: the
  office download, the driver's copy and the submit path. The §391.51(b)(1) record keeps citing the
  driver's filing, because that is the applicant's instrument and the citation is never rewritten.
  ⚠ The DQ-file export resolves documents through that record, so the build must measure whether it
  prints the driver's copy and route it through the same resolution. Otherwise the auditor's copy
  is the one with blank lines.

**Migrations (deploy window):** the table + guard ship ALONE (as 0374 did). The writer and readers
follow in one merge after it is visible in production. The invariant *"`handbook_filed_at` set ⇒ a
countersignature with a document"* is a THIRD, small migration after the writer is live. Shipped
with the table, it would refuse every handbook countersign the old code attempts in the window.
Production holds 0 handbook marks, so no real handbook would be affected, but the rule is the rule.

### 6.5 What prints (proposed D-HB9)

Stamped onto each of the four lines, with the Representative stored on the row:
- **the Representative's signature PNG** (D-HB3's upload) on the rule, scaled to the rule's height
  as the driver's drawn mark is;
- **a 7 pt caption**: *"<Name>, <Title> · applied by <office user> · MM/DD/YYYY"*. The handbook
  prints who applied the signature on every page, and the packet has no certificate page, so the
  caption is how the same fact reaches the paper. It goes below the rule where there is room
  (`p18c`, `p19ac`, `p19bc`) and to the right of the signature inside the rule's span on `p22c`, whose
  own caption sits under the rule. Where each goes is measured by rendering, not decided here;
- **the date** on the carrier's own `Date` rule where the page has one (`p19ac`, `p22c`). It's the
  countersign's calendar day in the carrier's zone, MM/DD/YYYY from the one definition (memory
  `dates-are-mmddyyyy-from-one-definition`).
- Names go through the overlay's embedded Unicode font (the standard fonts can't encode `ć`; today's
  probe proved it by crashing). The witness line `p22w` stays blank. It is neither party's.

### 6.6 The hire gate (proposed D-HB10)

**No new gate, and no new step.** `handbook` is already in `HIRE_REFUSES_WITHOUT`. Under §6.3 a filed
handbook implies a countersigned packet, and the third migration makes that true in the database,
not just in the code order. The checklist's handbook step reads *"Countersigned for the carrier"*
only when both exist. The one exception is an application filed as the §391.21 **summary** (no packet
marks, no carrier lines). Its countersign stamps nothing, and the row records `placements = '{}'`,
so the invariant still holds and says why.

### 6.7 D-HB11 · The auditor's binder gets the countersigned copy through a SECOND record (built in QH1)

§6.4 left one thing for the build to measure: the DQ binder. Measured on 2026-09-29, `dqBinder/gather.ts`
embeds whatever document a `qualification_records` row cites, and `dqFile.ts`'s `matchRecord` takes the
NEWEST record of a kind. Pointing it at the countersignature table would need `evidence -> recruiting`,
an edge `lint:boundaries` does not allow (recruiting already depends on evidence, so it would be a
cycle). So the countersign adds a new `employment_application` record citing the countersigned copy:
`result = 'Countersigned'`, `reference` = the countersignature id (NOT the application id, which is
how `ensureDriverFiledApplication` finds the driver's own record), `detail.source = 'packet_countersign'`
with the driver's filing's document id. The first record, citing the driver's filing, is never
touched. This is the evidence module's own correction model (a new row, never an edit). The §391.21
summary gets no second record, because its stamp draws nothing.

---

### 6.8 D-HB12 · One signing walk for the packet and the handbook (owner, 2026-09-29)

Owner: *"this has to be standardized, we need this to be same on Application and Handbook"*. Ruled as
recommended: **A** the page on screen shows what is signed; **B** places in order, reading ahead
allowed; **C** the rail is dots on a phone and a column on a desktop.

**Measured first (2026-09-29).** The packet walk showed ONE page with a rail and "Take me back" but no
tag; the handbook walk showed all 11 pages stacked, no rail, no jump, no mark sentence, and re-read the
document after every place. The handbook's comment said flowed text "has no page to jump to"; that is
true of the text and false of the PDF, which the renderer lays out itself.

**Built:**
- **Every place is named inside the PDF**, `sign:<placementId>`, as a `FitR` box (the permissions'
  mechanism, with the size carried in the destination because the lines differ in width). The handbook
  writes it as it draws each signature line; the packet's READING copy gets it from
  `packetMarkGeometry.ts` after rendering. The filed packet is not touched.
- **One walk, `PlaceWalk.vue`**, used by both: the place's page opened, the **Sign here** tag on its box
  (the tag IS the sign button; a plain button appears only when the document does not name the place or
  does not load), the rail (`SigningPlaceRail`, was `PacketPageRail`), reading another page and "Take me
  back". The viewer is `SigningPageView` (was `PacketPageView`). What differs stays with the caller: the
  packet's two adopted marks and initials, the handbook's server-applied signature.
- **Decision A, as measured.** The packet's reading copy is **635 KB** (the carrier's embedded fonts;
  the handbook is 61 KB), so re-reading it after every one of ~15 places would move ~10 MB on a phone.
  The rule for both documents is: **fetch again when the page ON SCREEN holds a place signed since the
  copy was fetched** (two places on one sheet, or looking back). The packet's reading copy moves to the
  ceremony's per-link bucket (60/min) from the intake's 20/min per address, the handbook's reason.
- Looked at in Chromium on the real documents: the tag sits on page 3's `Signature` rule and on the
  handbook's second place (page 9 of 11).

**Kept separate on purpose:** the six permissions. Each is its own instrument shown whole (FCRA
§604(b)(2)); they already carry the same tag over their one box.

## 7. Open questions

- **Q-HB1 · Should the Representatives also sign the packet's four blank carrier lines (`p18c`,
  `p19ac`, `p19bc`, `p22c`)?** They are the same act by the same people, and they print blank on every
  filed packet today. *Recommendation:* yes, as its own step after HB5 (it touches the filed packet's
  renderer, which is frozen per filing, so it needs its own design).
  **RULED yes by the owner 2026-09-29**, as its own step (APPLICATION-FLOW-V2-PLAN §12). Design in
  §6, awaiting approval before any build.
- **Q-HB3 · Should the carrier countersign the three lines beside a withdrawn driver line (`p19ac`,
  `p19bc`, `p22c`)?** The driver's line on those pages reads *"Not signed here. Signed electronically
  as its own permission."* (a) Sign all four, as ruled. The carrier's line acknowledges the
  authorization it relies on, and the notice beside it already says where the driver signed. (b) Sign
  `p18c` only and print a notice on the other three. *Recommendation:* (a). It is what was ruled, and
  a carrier signature under a release the carrier did receive asserts nothing false.
  **RULED (a) by the owner 2026-09-29.**
- **Q-HB4 · Approve §6: (b)-by-stamping, one act with the handbook countersign, the new table, the
  caption, no new gate?** *Recommendation:* yes, as written. **RULED yes by the owner 2026-09-29.**
- **Q-HB2 · When the handbook is amended, must hired drivers re-sign?** Its own text says amendments
  *"shall become effective 5 calendar days after delivery"*. *Recommendation:* not in this build. A
  later step can offer the new version to the driver app.

---

## 8. Progress log

- **2026-09-25** — Plan written from the owner's four answers (D-HB1..D-HB5). The handbook `.docx` is
  committed as the source of the text. §2.3: Q-HM5's hire refusal was ruled and never built, so HB5
  builds it with the handbook in it rather than making the handbook the only gate.
- **2026-09-25** — **HB0 DONE (in PR): migration `0374_handbook_signing.sql`**, schema only.
  `carrier_representatives` (never edited, HB010; deletable until a mark names them, which Postgres
  refuses with **23001** `restrict_violation`, not 23503, so the API must map 23001 to 409).
  `handbook_marks` (append-only, HB011, including against a cascade from the invitation, so a
  `merge_driver` or invitation delete cannot take signatures in silence. `merge_driver` already refuses
  a driver with a filed application via MD010, and a mark cannot exist without one). The insert guard
  enforces the order: HB020 wrong org, HB021 dead link, HB022 application not filed, HB023 signing not
  opened, HB024 handbook already filed. The invitation gains `handbook_signing_opened_at/_by` and
  `handbook_filed_at`, with a CHECK keeping them in order. Matrix `handbook-signing.test.mjs`: 39
  assertions, 21 of 21 migration mutants killed (one survived the first run, the carrier check with no
  Representative, and the matrix gained the two cases that kill it). `rls.test.mjs` seeds both tables
  (556 pass). Producer waivers for this one merge. **Next: HB1–HB5 in one merge**, after 0374 shows in
  production.
- **2026-09-25** — **0374 merged** (#1051, `2c41541`) and **checked in production** before its reader
  was committed: `information_schema` shows both tables and the three invitation columns, and
  `pg_trigger` shows all three guards.
- **2026-09-25** — **HB1–HB5 DONE in one merge** (in PR). No migration.
  · **HB1, the text.** `applicationPdf/handbook/handbookText.json` (155 blocks), extracted run by run
    from the committed `.docx`. `handbookText.test.ts` re-reads that file and proves two things: the
    words are the same multiset (every word, typos included, the same number of times), and the
    flowing text is in the carrier's order (signature captions excepted, since the layout regroups
    them; a caption counts only near a rule). `HANDBOOK_VERSION` is a hash of the text itself. JSON
    beside its renderer, not a shared literal: only the API draws it. The signing places are in shared
    (`handbookContract.ts`: `h1`–`h5` for the driver, `h4c` for the carrier; `maskedSsn`;
    `handbookStatus`).
  · **HB2, the renderer.** `handbookPdf.ts` draws 11 sheets: a cover; the sections the carrier started
    on a new page start on one; its bold and underline are kept; the fuel rules have a hanging head;
    the fines schedule and the bonus are ruled two-column tables. The SSN prints `•••1234` (D-HB2).
    Every page says `text <version> · page x of y`, and the countersignature says who applied it.
    **Rasterised and looked at, with a long Serbian-Polish name. Three defects were found only that
    way:** (1) pdfkit's `continued` chain overprinted centred lines of mixed weight (the log-violation
    ladder), so they are now placed by hand; (2) the header's bold leaked into the first fines row
    after a page break; (3) columns split at 2+ spaces moved `-for level  3` into the fine column, so
    the split is now at 4+ spaces or tabs. Two more came out of the same pass: footers stamped below
    the margin made pdfkit add a page each (11 pages became 22), and block 4's `Date:` printed twice.
  · **HB3, the API.** `representatives.ts`: add with a PNG in `<org>/representatives/`; delete, where
    23001 becomes 409 `has_signed`; the picture goes with the row. `handbookSigning.ts`: open (after
    filing, idempotent) and countersign. Countersign refuses until all five driver places are signed,
    records `h4c` with the Representative AND the office user, files the PDF and a `handbook`
    record, and stamps `handbook_filed_at`. A retry after a failed filing keeps the Representative
    already recorded. `handbookCeremony.ts`: the driver's mark, signed with the ADOPTED packet
    signature and never a new one. On the link, `/:token/handbook.pdf` and `/:token/handbook/mark` are
    on the ceremony's per-link bucket, and `GET /:token` carries `handbook`. Office routes:
    `/representatives` and `/applicants/:id/handbook{,/open,/countersign}`, each act audited.
  · **HB4, the screens.** `HandbookPanel.vue` (the step's drawer): one move at a time, plus the
    Representatives list. `HandbookSigning.vue` on the filed card of the applicant's link: nothing
    before filing; before opening, "Check again" and deliberately NO poll (several drivers share one
    office address); while open, the handbook through the permissions' viewer and five Sign buttons;
    once filed, their signed copy.
  · **HB5, the step and the gate.** `handbook` is step 16, between `application_signed` and `hired`,
    with evidence `qualification_records.handbook`, and the checklist and the board feed it the same
    input. ⚠ **The gate is NOT `hired.requires`.** That would have contradicted Q-HM5, which makes
    `employment_investigation` and `application_signed` warn-only. `HIRE_REFUSES_WITHOUT` is the six
    `federalGate` steps plus `handbook`, and `hireApplicant` refuses `not_ready_to_hire` (409, with
    `missing`) through the checklist's own fold. The preview names the blockers before the press.
    Production had hired nobody through this door (zero `compliance.applicant_hired`, 8 applicants
    waiting), so the refusal stalls no hire in flight.
  · **49 of 49 mutants killed** across shared, API, renderer, text, limiter, board and both screens.
    Two survived the first run, and both were test gaps: the resume test asked for the Representative
    already recorded, so it could not tell "keep" from "replace"; and no reading-copy fixture held an
    `h4c` mark. Both tests were strengthened and both mutants re-run killed. All CI gates, web
    `lint:tokens`, `pnpm lint`, the three typechecks, and the shared (3199), API (4666+) and web
    (2219) suites pass.
  · **Owed by the office before the first real handbook:** add at least one Representative with a
    signature PNG from the Handbook step's drawer. Then walk one applicant: open handbook signing,
    sign the five places on the link, and countersign.
- **2026-09-29** — **Q-HB1 design written (§6), nothing built.** Production checked first: both
  services at `bc0ca4e`, schema 0386 applied, 0 filed packets. The carrier lines' geometry was
  measured today for the first time (the handoff believed it existed), and drawing it found `p22c`'s
  date rule 16 pt below its signature rule. Recommended: a second, countersigned copy made by
  stamping the filed bytes, one act with the handbook countersign, a new one-row-per-invitation table,
  no new hire gate. Q-HB3 and Q-HB4 await the owner.
- **2026-09-29** — **Q-HB3 ruled (a), Q-HB4 yes** (owner): D-HB7..D-HB10 stand as written in §6. Build
  order: the table alone (QH0), then the writer and readers (QH1), then the invariant (QH2).
- **2026-09-29** — **QH0 merged** (#1132, `19b33ab`), migration 0387 **verified in production**:
  13 columns, both guard triggers, and `purge_applicant` deletes the table. 23 of 23 migration mutants
  killed (one first-run survivor was a fixture gap: another org's document naming THIS driver).
- **2026-09-29** — **QH1 built** (in PR). `packetCountersignGeometry.ts` (the four lines, measured and
  looked at; the applied-by caption runs to 553.2, because the first render cut it on the two short
  rules), `packetCountersignStamp.ts` (the filed bytes, stamped; metadata kept), `packetCountersign.ts`
  (row → stamped copy filed under the ROW's id → `document_id` once → D-HB11's record; every step safe
  to retry), `handbookSigning.ts` (the packet first, and `h4c` signed by the packet row's
  Representative), `file.ts` (`ensureApplicationPdf` hands out the countersigned copy once cited;
  `ensureDriverFiledApplication` is the driver's filing, always). The drawer says one press signs both.
  Rasterised with a long non-ASCII name and a drawn and a typed signature on pages 18, 19 and 22.
  **25 of 26 mutants killed.** Two first-run survivors were test gaps: the `document_id` write's
  null-condition was never asserted, and the metadata test's source was pdf-lib's own output from the
  same second. Both were fixed and re-run killed. The 26th was a no-op mutant. **Next: QH2**, the
  invariant (a filed handbook ⇒ a countersignature with a document) and a unique index on D-HB11's
  record, once QH1 is live on both services.
- **2026-09-29** — **QH2 built** (migration 0388; in PR once QH1 is live on both services). A BEFORE
  trigger refuses `handbook_filed_at` null → value unless the invitation's countersignature exists and
  cites a document (PC030); the summary's `placements = '{}'` row, citing the driver's own filing,
  satisfies it (D-HB10). A partial unique index makes D-HB11's record one per countersignature.
  Production held 0 filed handbooks, 0 marks and 0 countersignatures, so nothing filed contradicts it.
  `handbook-signing.test.mjs`'s CHECK case now switches the new trigger off, rolled back, so 0385's
  CHECK is still proven on its own. **5 of 5 migration mutants killed.** One first-run survivor was a
  fixture gap: NULL keys never collide, so a correction naming the same countersignature from another
  source was added.
- **2026-09-29** — **D-HB12 built** (§6.8, in PR): one signing walk for the packet and the handbook.
  Places named in the PDFs (`sign:<id>`, FitR), `PlaceWalk` shared by both, the tag on the line, the
  refetch rule measured against the packet's 635 KB. Looked at on the real documents.
