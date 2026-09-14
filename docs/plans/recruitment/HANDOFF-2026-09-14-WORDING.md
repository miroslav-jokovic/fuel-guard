# Handoff — the wording ships, the gates are open, nobody has walked the flow yet

**Read this before touching the apply flow, the packet, or the PSP work.** It supersedes
`HANDOFF-2026-09-13-QUEUE.md`, which is still correct about P12 and the cross-match but wrong about
the top of the queue: publishing wording is no longer a thing anybody does.

Plans: `APPLY-EXPERIENCE-PLAN.md` (§6 is the running log — read it, not the step headings),
`APPLICATION-PACKET-PLAN.md`, `docs/plans/safety-dqf/PSP-PLAN.md`.
Research: **`WORDING-REVIEW-2026-09-13.md`** is the sheet counsel reads.

---

## 0. Everything is merged. `main` is `2936c92`.

Eight PRs, all green, all merged, nothing open, no migration:

| PR | What |
| --- | --- |
| #762 | The §390.32(d) consent gate was a **no-op on three write paths** — one wrote a signature |
| #763 | The carrier's own packet wording (pages 19/14/21) |
| #764 | PSP served from **FMCSA's mandatory form**, and any other PSP wording refused |
| #765 | Pinned what the applicant is actually SERVED; corrected the runbook |
| #766 | Clamped the long previews so the wording page stayed readable |
| #767 | **D-WORD1** — the product ships the wording; the settings page is deleted |
| #768/#769 | graphify: the graph, git-hook freshness, and a staleness rule I had to correct |

⚠ Production serves `9e557f8`. The only difference to `main` is `CLAUDE.md`, which ships nothing —
Railway skips doc-only commits. **Functionally, production is current.** `pnpm verify:live` will
report drift for exactly that reason; check what actually differs before believing it.

---

## 1. What changed, in one paragraph

Every instrument used to be `v0-draft` placeholder text an engineer wrote, and `/settings/application-wording`
existed so a carrier could publish something before an applicant could do anything. That page is
gone. `defaultWording(carrierName)` now resolves all six from a real source — FMCSA's mandated PSP
form, FMCSA's Clearinghouse sample plus the scope §382.701(b) forces, 15 U.S.C. 7001(c)'s six
clauses, and the carrier's own counsel off packet pages 19/14/21 — at versions that are **not**
drafts. **Every gate opens on deploy and there is nothing to publish.** `org_disclosures` survives
as an override with no UI; `POST /api/recruitment/wording` is its only safe writer.

⚠ **Versions are provenance, not counters**: `fmcsa-2016-02-11`, `fmcsa-sample-2026-09-13`,
`packet-2026-08-21`, `15usc7001c-2026-08-21`. A separate namespace from the `v1, v2…` that
`publishWording` assigns to overrides, so an audit can never confuse the two.

---

## 2. ⚠ THE TOP ITEM: nobody has walked the flow end to end

Everything above is proved by tests and by reading production rows. **No human has opened a live
link since the gates opened.** Eight PRs of behaviour change are riding on that, and the one thing
none of it proves is that a driver can finish.

Measured 2026-09-14:

| | Silvicom Inc | FuelGuard EFS QA |
| --- | --- | --- |
| `org_disclosures` | **0** (correct — nothing needs publishing) | 0 |
| usable links | **2** | 0 |
| drafts | 3 | 1 (revoked) |
| **applications filed** | **0** | 0 |
| `driver_authorizations` | 0 | 6 |

The three Silvicom drafts, newest first:

| Applicant mailbox | Furthest screen | Link expires | Usable |
| --- | --- | --- | --- |
| `safety@silvicominc.com` (Marija) | **`certify`** — the last screen | 2026-09-27 | **yes** |
| `vince@silvicominc.com` | `licence` | 2026-09-12 | no — expired |
| `safety1@silvicominc.com` | `addresses` | 2026-09-09 | no — expired |

⚠ **All three have `consented_at` NULL**, and that is now load-bearing. The 7001(c) gate is armed,
so on their next visit the link opens on the consent screen before anything else. Their typed
answers are safe (`application_drafts` is a separate row); they consent, then carry on.

⚠ **Marija's token was rotated by the abandonment sweep on 2026-09-13 19:28 UTC.** The link she was
originally sent is dead. Only the one in that nudge email works. Anybody telling her to "reopen the
link we sent you" sends her to a 404.

**So: ask her to open the nudge link and finish.** That single walk-through validates the consent
gate, the signing ceremony against FMCSA's text, the certification, and the filing — and would
produce the first `driver_applications` row this product has ever had.

⚠ The two expired links need reissuing, and **a replacement invitation resumes an EMPTY form** —
`application_drafts` is keyed on the invitation, so Vince's and Tanja's typing does not travel.
Deliberate decision, not a side effect to discover.

---

## 3. Owner actions, oldest first

1. ⚠ **`MAIL_FROM` is still `uncchicago85@gmail.com`** — raised at the start of 2026-09-13 and
   untouched since. Every email this product sends comes from a personal Gmail address, including
   the approval notice that tells an applicant their application is ready to sign. That reads as
   phishing on the one message least able to survive reading that way, and risks Brevo's
   `422 Invalid from field` unless the address is a validated sender. Needs a verified domain
   (`Silvicom Inc <noreply@silvicominc.com>`); it is a Railway variable, not a code change.
2. **The walk-through in §2.**
3. **Counsel**, on three things `WORDING-REVIEW-2026-09-13.md` sets out: the adverse-action promise
   in §4 below, packet page 3's §604(b)(2) problem (§4.1 — *ruled 2026-09-13 to stay as it is on the
   paper packet, exposure accepted not withdrawn*), and the two closing NOTICEs on the FMCSA form
   (§5.4 — *ruled to display*).

---

## 4. ⚠ One obligation the product now makes and does not yet meet

FMCSA's PSP disclosure — which every applicant will read from now on — **promises** them a copy of
the report and a written FCRA rights summary *before* final adverse action, and within three
business days after it for applications taken by mail, telephone or computer.

`R10` is deliberately unbuilt because §604(b)(3)(B) carves out trucking. ⚠ **That carve-out governs
the TIMING, not this form's own undertaking.** Publishing the text made it a promise the carrier is
making in writing. Worth counsel's eye before the first PSP pull, and it is the one item on this
page that could become a real liability rather than a missing feature.

---

## 5. The engineering queue, unchanged in order

### 5.1 P12 — the derived PSP tables
`psp_inspections` / `psp_violations` / `psp_crashes`, derived by P7's ingest inside the same
transaction as the `qualification_records` row and re-derivable from `response_raw` alone.
Done-when is written in `PSP-PLAN.md` §P12 and is good. **Next migration number is 0339.**

⚠ **`response_raw` is a one-element ARRAY.** The records sit at
`response_raw[0].driverInformationResponse.driverRecord.{inspectionRecords, crashRecords}`, not at
the top level as §5b.1's table and the OpenAPI document both imply. Build the fixture from the
production row, not from the spec.

### 5.2 The cross-match panel — only after applications exist
`crossMatchEmployment` is written and its only callers are two tests. ⚠ **D-PSP5, twice
deliberate:** it corroborates and discovers, it can NEVER refute. A driver can work two years for a
carrier and never be inspected once, so a UI that reads silence as doubt manufactures accusations
against exactly the drivers who drive cleanly. And there is still **one** `psp_requests` row in all
of production, for a driver with zero declared employers and zero invitations.

### 5.3 P5/P6 — the packet
The largest piece. `packages/shared/src/packetPlacements.ts` is the measured inventory — 27
placements, 21 the driver's — each pinned by a test that re-reads the workbook. 5 of 31 pages
render. **`driverPlacements()` IS the queue**; P5 has no arithmetic left, only interaction.

⚠ P5's old blocker ("would be built twice against `v0-draft`") is **gone** — the wording is final.

---

## 6. Traps this session added

- ⚠ **A default's polarity has to be argued per function.** `requireEsignConsent` defaulted to the
  placeholders under a comment claiming that failed CLOSED. True of every other reader of a version
  string; backwards for that one, which refuses only while the consent CAN be given. Three write
  paths took the default and the release path **wrote a signature** (measured: 201).
- ⚠ **Publishing by mocking a constant is a route production cannot take.** Since 0338 a carrier
  publishes a ROW while `ESIGN_CONSENT.version` stays `v0-draft` for ever, so every test that
  "published" by spying on the constant was questioning nothing. **Seed `org_disclosures`.**
- ⚠ **`tree_sitter_sql` is optional, and without it graphify drops all 351 migrations** — 1,144
  nodes — from a repo whose schema source of truth is `supabase/migrations/`. Always
  `pnpm graph:update`, never a bare `graphify update .`; the wrapper exits non-zero rather than let
  a schemaless build pass. `built_at_commit` is **not** a staleness check (it only advances on a
  topology change).
- ⚠ **A generated page can be unreadable in a way no unit test sees.** FMCSA's PSP disclosure is
  6,018 characters where the placeholder was 409; rendering all six bodies took the wording page to
  5.2 screens. Found by `vite build` + `vite preview` with the real payload and measuring
  `scrollHeight` — never by a test.
- The **web suite flakes under parallel load** (`sectionGuard.test.ts`) and the **api suite** too
  (`inventoryAssets`, `sectionAccess`). Both pass alone and in CI. Re-run before investigating.

## 7. Still not on the queue, and both procurement rather than build

- **An MVR vendor.** No vendor, no pull, no purpose — and ⚠ the carrier's packet page 18 IS a
  driving-record authorization their lawyers wrote that this product has nowhere to put.
- **A Clearinghouse query surface.** The §382.701(a) full-query consent is given inside the FMCSA
  portal. ⚠ But the **limited**-query consent (§382.701(b), at least annually) is now a real
  instrument in the catalogue, and nothing collects it yet — it belongs to a `safety_manager`
  workflow, D-REC4/R5.
