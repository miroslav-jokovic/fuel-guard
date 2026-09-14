# Handoff — what is left of the application feature, 2026-09-13

> # ⚠ SUPERSEDED by `HANDOFF-2026-09-14-WORDING.md`. Read that first.
>
> §3.1 below — "get one carrier's wording published" — **is no longer a thing anybody does.**
> D-WORD1 (#767) made the product ship the wording from FMCSA's forms, the statute and the
> carrier's own packet, and deleted `/settings/application-wording`. Every gate opens on deploy.
>
> §2's count is also wrong in the direction that matters: **one** of those four drafts sits on a
> usable link, not four. §3.2–§3.4 (P12 → cross-match → P5/P6) are still correct and are carried
> forward.


**Read this before picking up the apply flow, the packet, or the PSP cross-match.**

It continues `HANDOFF-2026-09-11-REVIEW.md`, which is still true about everything it describes. Two
things happened after it: Q-AX4 was built (§1), and **production was measured** (§2). The measurement
is the important part, because it reorders the queue that handoff recommended — not because anything
in it was wrong, but because nobody had yet asked what the database contains.

The plan is `APPLY-EXPERIENCE-PLAN.md` (§6 is the running progress log, §4 the open questions).
`APPLICATION-PACKET-PLAN.md` owns the packet. `docs/plans/safety-dqf/PSP-PLAN.md` owns P12/P13.

---

## 0. PR #760 is MERGED — main `8576d9c`, 2026-09-13

Q-AX4 and this handoff are both on `main`. No migration rode with them, so there is no deploy window
to wait out beyond Railway's usual ~3 minutes; `pnpm verify:live` answers "why don't I see my
changes?" if anything looks stale.

⚠ **Nothing else in this document is waiting on a merge.** Everything in §3 is either a decision for
the owner (§3.1) or unstarted work (§3.2–§3.4).

---

## 1. What Q-AX4 shipped (PR #760)

Approval now tells the applicant. `approveApplication` sends an email — and a text where a live SMS
consent exists — the moment `approved_at` is stamped. Before this, the only thing carrying the news
that an application had been approved was the driver reopening their own link on the off-chance,
while the recruiter's drawer said *"the applicant has been asked to sign it"* and nothing had asked
them anything.

⚠ **The notice deliberately carries no link, and that is the decision rather than an omission.**
`application_invitations` stores a SHA-256 and nothing else (0220); the plaintext token is returned
once, at mint. The abandonment sweep's answer is to ROTATE the token and email the new one (0232),
and that answer is refused here: `APPLY_FLOW_COPY.handoff` has already told this applicant *"keep
this link — it is where you will sign, and it still works"*, and approval is the exact moment they
act on it. Rotating would break the product's one promise at the one moment it is load-bearing, and
would open a lockout this flow cannot afford — a nudge that fails to send costs a driver an
unfinished form; an approval that fails to send after a rotation would cost them a COMPLETED
application they can no longer reach, and a replacement invitation resumes an EMPTY one. So the email
names the earlier email's subject line, read from one `applicationInviteSubject` so the two cannot
drift.

**The declined third option is the upgrade path**, costed and written down rather than forgotten: a
second `sign_token_hash` column so the original link AND a fresh clickable one both work. A migration
plus a change to token lookup at intake, in two merges. Take it if the inbox search proves a real
drop-off.

Other properties worth not re-deriving: the notice goes **after** the stamp and the audit and cannot
change either (`approved_at` is what the certification route reads); **exactly-once fell out of the
existing idempotence** with no new column, because `approveApplication` already returned early on
`approved_at`; and every failure is a sentence in the drawer naming the chase — `no_address`,
`mail_disabled`, `send_failed` — never a failed approval.

| Thing | Path |
| --- | --- |
| The notice | `apps/api/src/modules/recruiting/applicationApprovalNotice.ts` |
| The template | `packages/shared/src/email.ts` — `renderApplicationApprovedEmail`, `applicationInviteSubject` |
| The recruiter's outcomes | `apps/web/src/features/apply/ApplicationReviewDrawer.vue` — `noticeToast` |
| The applicant's promise | `apps/web/src/features/apply/strings.flow.ts` — `handoff.waitingNote` |

---

## 2. ⚠ Production, measured 2026-09-13 — and it changes the queue

Everything below is a real count from the linked production database, not an estimate.

### 2.1 Four people have filled in applications they cannot send

| | |
| --- | --- |
| `application_invitations` | **5** (1 revoked) |
| `application_drafts` | **4** |
| sent for review | **0** |
| approved | **0** |
| certified / `driver_applications` filed | **0** |
| **`org_disclosures`** | **0 rows** |

How far the four got, by `furthest_section`:

| Last screen reached | Last touched |
| --- | --- |
| **`certify`** — the end of the form | 2026-09-11 |
| `documents` | 2026-08-22 |
| `licence` | 2026-08-27 |
| `addresses` | 2026-08-24 |

⚠ **Re-measured 2026-09-14 00:34 UTC and the reading above is too optimistic: only ONE of these
four links is still usable.** Two expired (2026-09-09, 2026-09-12) and the fourth is the QA org's
revoked one. The survivor is the `certify` draft — and the abandonment sweep **rotated its token on
2026-09-13 19:28 UTC**, so the link that driver was originally sent is dead and only the one in the
nudge email works. That is §2.2's own warning, arriving the next day. See
`WORDING-PUBLISH-RUNBOOK.md` §1.

**Somebody reached the last screen and could not press the button.** `org_disclosures` being empty
means no carrier has published any instrument, so every one is still the `v0-draft` code placeholder
and `submitApplication` answers `WORDING_NOT_FINAL`. That has been the stated blocker since the plan
was written; what is new is that it is no longer hypothetical — it is four real drafts, one of them
finished, sitting against a refusal.

⚠ **The blocker has two halves and only one of them is counsel.** P1 in `APPLICATION-PACKET-PLAN.md`
is counsel settling eight instruments and eighteen packet pages — genuinely not an engineering step,
and `COUNSEL-REVIEW-PACKAGE.md` has been packaged and waiting since 2026-08-23. But **publishing is
now self-service**: #751 shipped `/settings/application-wording`, which leads with the count of
unpublished instruments precisely because until it is zero nothing an applicant does works. A carrier
willing to adopt the text can publish this afternoon without an engineer. Zero rows says neither has
happened.

### 2.2 The cross-match has almost nothing to run against

| | |
| --- | --- |
| `psp_requests` | **1**, status `succeeded`, with `response_raw` |
| inspections in it | **4** |
| crashes in it | **4** |
| distinct inspection DOT numbers | **2** |
| `driver_employment_history` rows for that driver | **0** |
| application invitations for that driver | **0** |

`crossMatchEmployment` compares **declared** employment against PSP's carrier-date pairs. On the only
PSP report that exists, there is nothing declared. So the panel would, today, render for exactly one
driver and report both DOT numbers as unlisted carriers — two proposed §391.23(a)(2) inquiries
against somebody who never filled in an application. That is not a defect in the function; it is the
function being asked a question nobody has supplied the inputs for.

⚠ **A trap for whoever builds P12: `response_raw` is not the shape §5b.1's table implies.** The live
production row is a **one-element ARRAY**, and the records sit at:

```
response_raw[0].driverInformationResponse.driverRecord.{inspectionRecords, crashRecords}
```

not at the top level. `driverInformationResponse` also carries `status`, `driverLicenseNumber` and
`driverLicenseState` — the fields P12's Done-when needs for its "does not match the requested licence
writes nothing and raises" rule. Write the deriver's fixture from **this row**, not from the OpenAPI
document: the 2026-09-11 defects were both a fixture that did not resemble production, and this is
the same shape of trap sitting in wait.

---

## 3. The queue, reordered by the measurement

The 2026-09-11 handoff recommended P12 → the cross-match panel → P5/P6. That order is still right
*among the engineering steps*. What the measurement adds is that **both of them are gated, in
different ways, and the thing that ungates the product is not engineering at all.**

### 3.1 First, and it is not a build: get one carrier's wording published

Nothing else in this feature produces value until this happens. It unblocks four stuck drafts, makes
the two-visit flow reachable end to end for the first time, turns Q-AX4's approval email into
something that can actually fire, and is the explicit precondition on P5 (*"building 21 placements
against `v0-draft` wording would mean building them twice, and `isDraftDisclosure()` refuses the
signature anyway"*).

Two candidate paths, and they are not exclusive:

- **(a) Counsel returns `COUNSEL-REVIEW-PACKAGE.md`.** The correct path, packaged since 2026-08-23,
  and outside our control. ⚠ If it comes back staged, **A6 — the ESIGN consent — first**: it gates
  every other write path including the other seven instruments.
- **(b) The carrier publishes adopted text at `/settings/application-wording` now.** Available today,
  no engineer. This is a business decision about legal exposure, not a technical one, and it is the
  owner's to make — which is why it is written here rather than acted on.

**Recommendation: ask the owner which, and say that four drafts are waiting on the answer.** Do not
start (b) on the owner's behalf.

> ⚠ **RULED (b), 2026-09-13.** The owner chose to adopt and publish rather than wait for counsel.
> `WORDING-PUBLISH-RUNBOOK.md` is the five-minute procedure, what it frees, and the **three defects
> that publishing arms** — all fixed before the runbook was written, because the §390.32(d) consent
> gate turned out to be a no-op on three write paths and one of them **wrote a signature** (measured:
> `POST /:token/release` answered 201 with no consent behind it). Counsel's eventual text lands as
> `v2`; that is what the version numbering is for.
>
> ⚠ **And §2.1's count below is wrong in the direction that matters: publishing frees ONE
> application, not four.** Two of the four links expired (2026-09-09 and 2026-09-12) and the fourth
> is revoked in the QA org. The runbook §1 has the table. A replacement invitation resumes an EMPTY
> form, so the expired drafts do not travel.

### 3.2 Then P12 — but know what you are building it for

`psp_inspections` / `psp_violations` / `psp_crashes`, derived by P7's ingest inside the same
transaction as the `qualification_records` row and re-derivable from `response_raw` alone. Its
Done-when is already written in `PSP-PLAN.md` §P12 and is good: ingesting a fixture twice produces one
set of rows; a record whose `driverLicenseNumber` does not match the requested licence writes nothing
and raises; deleting every derived row and re-running the deriver reproduces them exactly; a
`dispatcher` sees none of it.

Worth building **despite §2.2**, because it is the derived index the record itself deserves — the
violation history is a compliance artifact in its own right, not only cross-match fuel — and because
one real report with 4 inspections and 4 crashes is a genuine fixture. ⚠ But **do not describe the
cross-match panel on top of it as cheap or as imminent value**; that error has already been made once
on record (plan §6, 2026-09-11) and §2.2 is why.

Next migration number is **0339** (0338 is the last).

### 3.3 Then the cross-match panel — and only after applications exist

`crossMatchEmployment` (`packages/shared/src/psp/employment.ts:114`) is written and tested; its only
callers are two tests. ⚠ **Twice deliberate.** D-PSP5: it corroborates and discovers, it can NEVER
refute — *"do not wire the cross-match into a UI that says 'unverified' about a driver"*. A driver can
work two years for a carrier and never be inspected once; a design that reads silence as doubt
manufactures accusations against exactly the drivers who drive cleanly.

### 3.4 Then P5/P6 — the packet, and it is explicitly blocked on §3.1

The largest piece and the one that makes the owner's *"complete, ready to print"* step true. Less
from-zero than it reads: the text is transcribed, `packages/shared/src/packetPlacements.ts` is the
measured inventory (27 placements — 21 driver, 4 carrier, 2 witness, each pinned by a test that
re-reads the workbook), and 5 of 31 pages render. What is missing is the signing interaction and the
other 26 pages. **`driverPlacements()` IS the queue** — P5 has no arithmetic left, only interaction.

---

## 4. Still not on the queue, and both procurement rather than build

- **An MVR vendor.** No vendor, no pull, no purpose: `AUTHORIZATION_PURPOSES` has no MVR entry,
  SambaSafety was deprecated on cost before a line was written, `SCREENING_PREREQUISITES.mvr_order`
  exists and nothing calls it. Packet page 19 IS the driving-record authorization and is one of the
  18 sign pages.
- **A Clearinghouse query surface.** §382.701(a) consent is given inside the FMCSA portal, which is
  why `clearinghouse` is deliberately absent from `APPLICATION_RELEASE_ORDER`.

---

## 5. Traps that are still live

Everything in `HANDOFF-2026-09-11-REVIEW.md` §6 still applies. Added by this session:

- **Ask the database before ordering a queue.** Both remaining items were ranked by size on
  2026-09-11 and neither ranking survived one afternoon of counting rows. Four stuck drafts and one
  PSP report are facts nobody had looked up, and they outrank both estimates.
- **`response_raw` is an array, and the records are three levels down** (§2.2). The OpenAPI document
  and §5b.1's table both describe the flat shape.
- **The web suite flakes under parallel load.** `src/router/sectionGuard.test.ts` timed out at 5s
  during a full `pnpm test` and passed alone and in CI. Re-run before investigating — the same advice
  the api flake note gives, now with a web instance.
- **A `.strict()` Zod object and `.omit()` do not mix**, a comment between `TransitionChild` and
  `DialogPanel` takes every drawer down, and `break-words` does not reduce min-content width. All
  three are written up in the previous handoff; they were each found the expensive way.
