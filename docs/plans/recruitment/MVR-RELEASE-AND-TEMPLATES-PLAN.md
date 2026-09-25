# MVR release as a permission, and printable templates

Status: **MV0 + MV1 built.** MV2–MV3 queued. Opened 2026-09-25 from the owner's review of
the permissions after the handbook shipped (#1051, #1053).

## 1. What the owner saw

Two gaps, both confirmed against the code before anything was built:

1. **There is no MVR permission.** The applicant signs five: `fcra_disclosure`, `psp`,
   `previous_employer`, `drug_alcohol`, `clearinghouse` (`APPLICATION_RELEASE_ORDER`). The MVR step
   is gated on `SCREENING_PREREQUISITES.mvr_order = ["fcra_disclosure"]`. The carrier's own release —
   packet page 19, `AUTHORIZATION FOR DRIVING RECORD CHECK` — IS signed by the driver, but as two
   packet marks (`p19a`, `p19b`) inside the 31-page application, after the permissions, where the MVR
   step cannot see it. `WORDING-REVIEW-2026-09-13.md` §2 and `CHECKLIST-TO-LIVE.md` B2 had recorded
   it as "an MVR authorization with nowhere to go", waiting on a vendor. The release does not depend
   on a vendor: the office pulls records from state portals and uploads them, and that needs consent.
2. **There are no templates to preview and print.** A blank instrument exists only for the applicant,
   behind their token (`applicationPermissionInstrument.ts`). The office can print documents ABOUT an
   applicant — the draft application (F6), the signed permissions (B2), the road test, the handbook —
   and nothing blank. And the API has accepted a paper-signed permission since 0215
   (`POST /authorizations`, `method: "wet_signature"`, `evidence_document_id`), but no screen calls it
   (Q-HUI6).

## 2. Rulings (owner, 2026-09-25)

- **D-MVR1 — the MVR release is a sixth permission, moved out of the application.** Signed on the
  link the same way as the other five, with the carrier's page 19 wording. Page 19's two driver lines
  are withdrawn from packet signing (`PACKET_WITHDRAWALS`, the L-1 mechanism), so nobody signs the
  same release twice.
- **D-MVR2 — templates exist for when the electronic path fails.** Every document the office uses can
  be previewed and printed BLANK, for a driver to sign by hand, and the office records the paper
  signature back with its scan.

And one decision of ours, stated so it can be overruled:

- **D-MVR3 — the MVR step requires BOTH `fcra_disclosure` and `mvr`**, not `mvr` instead of FCRA.
  The owner's review said "instead"; both is stricter and costs nothing, because the ceremony always
  collects both. An MVR bought through a consumer reporting agency is a consumer report (FCRA
  §603(d)); one pulled from a state portal is not. We do not know, per pull, which route the office
  took, so the gate holds the release that covers both.

## 3. Steps

| Step | What | Merge |
| ---- | ---- | ----- |
| **MV0** | `0375`: `driver_authorizations.purpose` admits `mvr`. Nothing else in the schema — `record_driver_release` counts against `p_expected_count` from the API (0228). Matrix: `release-ceremony.test.mjs`. | 1 |
| **MV1** | `mvr` in `AUTHORIZATION_PURPOSES`, labels, catalogue; the carrier's page 19 text in `PACKET_INSTRUMENTS`; `defaultWording` serves it under `packet-2026-08-21`; `APPLICATION_RELEASE_ORDER` gains it after `psp`; `SCREENING_PREREQUISITES.mvr_order` becomes both (D-MVR3); `p19a`/`p19b` withdrawn with a notice on the line. | 2 |
| **MV2** | Recruitment → **Templates**: every document blank, Preview and Print — the six permissions, the application packet, the handbook, the road-test form. Drawn by the SAME renderers as the signed copies (A2's lesson, `instrumentPages.ts`), each page banded as a paper copy. | 3 |
| **MV3** | **Record a paper signature** on the Permissions drawer: pick the permission, type the name as signed, the date, upload the scan → `POST /authorizations` `wet_signature` with the document. Closes Q-HUI6. | 3 |

### Deploy note for MV1

Two open links finished their five releases before this ruling (production, 2026-09-25: 2 of 4 open
invitations have `releases_completed_at`, 1 has filed). `record_driver_release` refuses a signature
on a closed ceremony (DR022), and 0336/0365 build later phases on that stamp, so reopening it is not
free. Instead their MVR step reads **"MVR release missing"** until the office records a paper
signature (MV3). That is the fallback working as designed, on two people. Until MV3 ships, those two
cannot have an MVR recorded — which is correct, because nobody holds their consent.

## 4. Open questions

- **Q-MVR1 — page 19's sentence stops mid-clause.** *"I hereby release you from any liability which
  might be the result of providing this"* — the workbook and the carrier's PDF both end there. Left
  exactly as written (D-PKT11) and recorded in `WORDING_LEFT_ALONE`. For the counsel memorandum
  (`COUNSEL-REVIEW-PACKAGE.md`): the missing word is almost certainly `information`.
- **Q-MVR2 — page 19's identity block is not on the electronic release.** The paper asks for driver
  name, address, city/state/zip, CDL number, state and expiry. The permissions are signed BEFORE the
  application form (D-APP4), so none of it is known yet; the release carries the signed name only.
  Candidates: (a) leave it — the office holds the licence on the application; (b) print the block on
  the office's copy from the filed application, marked as such; (c) ask for licence details on the
  release screen. Recommendation: (a) until a state asks for more.
- **Q-MVR3 — state forms.** PA (DL-503), WA, NH and PR require their own signed release, and
  California is a program (Employer Pull Notice), not a form (`RECRUITING-SYSTEM-PLAN.md` R3).
  Unchanged by this plan.
- **Q-MVR4 — paper fallback for the packet, handbook and road test.** MV2 prints them blank; MV3
  records paper signatures for the PERMISSIONS only, because a permission is one row. Each of the
  others is a step with its own gate (the handbook's blocks the hire), and "a scan was uploaded" would
  have to satisfy it. Candidates: (a) upload a scanned signed copy as the filed document, marking the
  step done with `method = paper`; (b) keep the electronic path mandatory and treat the printout as a
  reading copy. Recommendation: (a), built as its own step once the owner confirms.

## 5. Progress log

- 2026-09-25 — MV0 built: `0375_mvr_release_purpose.sql`; `release-ceremony.test.mjs` +3 (an `mvr`
  row is accepted, filed under its own purpose, an unknown purpose still refused). Proven by running
  the matrix without 0375: the two MVR assertions fail with 23514.
- 2026-09-25 — MV1 built: `mvr` is the sixth permission (after `psp`), served from the carrier's page 19
  under `packet-2026-08-21`; the MVR step needs `mvr` + `fcra_disclosure` (D-MVR3); `p19a`/`p19b`
  withdrawn, so the packet walk is 19 stops (18 for a company driver). Page 19 rasterised: both lines
  carry *"Not signed here. Signed electronically as its own permission."*, no name, no date. Five
  mutants, five killed: FCRA-only gate, MVR-only gate, `mvr` dropped from the order, `mvr` dropped
  from the default wording, `p19b` un-withdrawn.
