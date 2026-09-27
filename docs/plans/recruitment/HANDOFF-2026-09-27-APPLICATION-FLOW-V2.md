# Handoff 2026-09-27: application flow v2, after C2c and C2d1

The queue is `APPLICATION-FLOW-V2-PLAN.md`. The real position is the **end of §12**, the dated log.
Also read §8.5 (the C2 row), §11 (open questions; each has a default to build) and the working rules
in `HANDOFF-2026-09-26-APPLICATION-FLOW-V2.md`. Every rule there still applies.

## Shipped today

| PR | Batch | What |
|---|---|---|
| #1074 (`048bead`) | **C2c** filing | **D-AW3/AW2:** a v2 invitation (it has an `application_intakes` row) files `composeFiledApplication()`: the draft with Part 1 laid over it (phone, current street, licence position 0, the unexpired others, §40.25(j)). **AW1:** `applicationV2FilingIssues()` is enforced on the composed document (409 `application_incomplete`). **A-5:** `packetTextVersion()` is a hash of the printed packet text. Every mark now stamps it through 0376's 13-argument `record_packet_mark`. Filing refuses marks under another text (`packet_text_changed`), and refuses **any unversioned mark** (`packet_signed_before_versioning`) until Q-AW2 is ruled. **A-10:** the handbook countersign claims `handbook_filing_claimed_at` first (released on failure; a stale claim is taken over after 10 min). The road test writes `detail.invitation_id` and refuses a second pass on that invitation. 23505 → `duplicate`. |
| C2d1 (this PR) | **SMS outbox** | `smsOutbox.ts`: `sendOrQueueSms` sends at once inside the recipient's window, otherwise queues. `runSmsOutboxOnce` drains every 5 min (`startSmsOutboxScheduler`, api service, listed in WORKER-DEPLOYMENT). A row is cancelled when its lifetime runs out, its consent is withdrawn or moved to another number, or its drug-test appointment is cancelled. Zones come from Part 1's state (`smsZonesFor`, strictest zone for split states; unknown = the all-US window). Moved onto the outbox: the opt-in confirmation, the approval notice, and the drug-test site ("Text it to the driver", `sent_to_driver_at`). `message.finalized` receipts mark rows delivered or failed. The terms page is corrected. `postgrestFixture` now applies range operators (they used to match nothing). |

## Next, in order

1. **C2d2: STOP/START and suppressions (A-11, G-2).** `sms_suppressions` is still waived in
   `check-table-producers.mjs`; remove the waiver in this merge.
   - STOP matches exact keywords (today `isStopMessage` matches a keyword anywhere, `smsConsentContract.ts:107`).
   - START lifts the suppression.
   - STOP revokes **every live consent of that link** and writes a suppression.
   - `sendOrQueueSms` and the drain both refuse a suppressed number.
   - The consent endpoint is US-only (`normalisePhone` still accepts any E.164) and allows ≤ 3 numbers per link.
   - `sms_suppressions` is already in `RETENTION_FORBIDDEN`; its `table-writers.json` entry lands with the writer.
2. **C2e: office link management.**
   - G-9's `driver_authorizations.signed_on` writer (paper methods only), on the paper form and on `POST /authorizations`.
   - **Q-AX5** re-send link: rotate the hash on the same invitation, audited with id + expiry only.
   - **Q-AX6** "invite them again" on an existing applicant.
   - None of these existed as of 2026-09-26 (grepped).
3. **C3** (screens, AW3/4/5/9/10/14). C3 **must create the `application_intakes` row when a v2 invitation
   is created**, or state a cutover date. "No row" is the whole legacy test (`intakeState`,
   `partOneForFiling`). Then **C3s** (signing model D-AW14–17, which removes C0b's workaround).

## Open decisions (recorded in plan §11 with a recommendation)

- **Q-AW2 blocks `f2b142e4` from filing.** Its 20 marks carry no version. The recommendation is (b):
  file under the old text. It needs **no migration**, only a per-version register in code plus
  `correctedPacketTemplate(version)`, about ½ day. ⚠ Before building, re-measure `signed_at` of every NULL
  mark. A NULL mark made between #1058 and C2c's deploy was made under the *corrected* text.
- **Q-AW28:** the road test's same-second double press can still file two form/certificate documents.
  The recommendation is a claim column in M2.
- **Q-AW29:** texts carrying the link (nudge, "application ready", sign link) are still send-now-or-never.
  The recommendation is (a): a text-only `sms_token_hash`. It needs a migration and the owner's yes
  (it adds a third bearer token).
- **#1059** (packet fines D-PKT21 + receipts D-HB7, branch `claude/packet-fines`) re-merges only after
  Q-AW2 and Q-AW17 are ruled. A-5 has now landed, so A-5 no longer blocks it.

## Traps found this session

- **An obsolete snapshot fails CI but not a local run.** A flaky local web run retried, vitest wrote a
  `… 2` snapshot, and `git add -A` committed it. Run web tests with `CI=true`, and check
  `git diff --stat origin/main -- apps/web` before committing a PR that has no web change.
- **`scan-secrets` passed on the staged tree and failed on the commit.** A uuid literal on the same line
  as `key:` reads as an API key to gitleaks. Put fixture uuids in named constants, and re-run
  `scan-secrets` after committing.
- **Don't chain `git checkout origin/main --` onto another command.** It detached a worktree. Check
  `git status -sb` if a command did more than intended.
- `postgrestFixture` now evaluates JSON-path filters (`detail->>source`) and range operators. Both used
  to match no row, silently.

## Owner actions still outstanding (re-measured 2026-09-27)

- **`d61557dc`'s link lapses 2026-09-28 18:00 UTC.** Press **Extend the driver's link** on its Handbook step.
- **Add a carrier Representative.** Production still has **0**, and the handbook countersign needs one.
- **Rule Q-AW2 and Q-AW17.** `f2b142e4`'s link lapses **2026-10-01 22:14 UTC**, and it cannot file until
  Q-AW2 is ruled, so extend it if the ruling won't land first.
- Say yes/no to **Q-AW29** (text-only token).
