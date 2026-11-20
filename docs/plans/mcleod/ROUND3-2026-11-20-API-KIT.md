# Round 3 review: McLeod API Kit plan (2026-11-20)

**What this is.** On 2026-11-20 the owner asked for one more layer of analysis: find every assumption, gap or blocker still left.
Four independent reviewers worked on it. Their full reports, with evidence and fix text, are in `api-kit-round3/`:

| Report | Lens | Result |
|---|---|---|
| `1-assumptions.md` | Every statement in COUNCIL §2–§5 and AUDIT §1–§2/§5, classified | 114 statements: 39 proven in code, 25 proven in docs, 35 assumed, 9 wrong, 6 imprecise |
| `2-sequence.md` | The whole build simulated as ordered PRs | About 50 steps and about 17 migrations. No dependency cycle. 2 blockers, 6 conflicts, 12 gaps |
| `3-external.md` | Every dependency on people outside the code | 43 dependencies; the merged Alex, McLeod and owner ask lists; 1 blocker, 17 gaps |
| `4-redteam.md` (+ `pg/`) | Red team on the round-2 council | 52 claims checked (46 confirmed); 24 findings, 8 of them contradictions inside COUNCIL |

## 0. Precedence (replaces COUNCIL's rule)

Read this file first, then COUNCIL, then AUDIT, then the specs.

**Every finding in every report under `api-kit-audit/`, `api-kit-council/` and `api-kit-round3/` is adopted, unless §5
of this file rejects it with a reason.** If two adopted findings disagree, the one in the later round wins. Within this
file, §2 replaces COUNCIL text item by item.

## 1. Answer to the owner's question: what is left?

**The design has no internal gap left that we cannot close ourselves.** §2 closes every contradiction and blocker found
in rounds 1–3.

**What remains are facts only other people can supply.** The plan cannot be free of assumptions until they answer,
because these facts live in McLeod, in Alex's systems or in the owner's decisions, not in our code. Each fact below has a
named owner, an exact question and a pre-decided build for each possible answer (§3, §4). Nothing proceeds on a guess:
- each MK0 probe sets a switch, or
- each written answer selects a build branch.

The full list of facts others must supply:

1. **Whether `/ws` is enabled on our LoadMaster 22.1, plus our URL and certificate.** Nobody else can answer this.
   McLeod answers. Blocks the whole API program.
2. **Whether a write-capable test company exists for us.** Nothing in the repo says one does. McLeod or Alex answers.
   Blocks every switch past `off`, except the C-19 live canary for stop clears.
3. **Alex Lockwood's written OK for API writes**, which changes his 09-24 terms. Blocks every write. If he refuses,
   that is a hard stop, because every alternative still writes into his McLeod.
4. **What `clearStop` triggers downstream, and the manual undo.** The triggers in question are EDI 214, ready-to-bill,
   driver pay, status and service failures. Alex answers. Blocks the stop-write canary.
5. **Where an image uploaded through `/ws` lands on our install.** Our documents are in DocumentPower on a separate
   imaging server, and McLeod's docs say uploads need a DocumentPower module. McLeod answers. Blocks MK4 going live.
6. **Our date mode, stored precision and time zone.** Answered by MK0 probes K6 and K13. Blocks every time write.
7. **Whether disabling the McLeod user also revokes a token already issued** (the "instant stop"). Answered by McLeod
   and a probe. Blocks going live.
8. **Whether the VM's public IP is fixed, and whether the VM already posts to `api.360`.** Measured from CloudWatch,
   then confirmed by Alex. Changes only how C-7 is enforced (§2.7).
9. **The store release.** The Apple account must be converted from Individual to Organization, and the store listings
   and forms filed. Owner. Blocks every driver benefit and the `driver_app` canary.
10. **Owner rulings Q-1 to Q-4 (COUNCIL §4) and Q-5 to Q-8 (§4 below).**

## 2. Corrections to COUNCIL (v2 uses these)

1. **Migration numbers** (SEQ-1). Origin/main already holds 0637–0639, and open PR #2589 holds 0640. The specs' numbers
   are stale. v2 gives an **order only**: B2 → S0a → M-A → pipeline → MK4 images. The number is the next free one at the
   time of merge.
2. **C-9 is replaced** (R3-2). The tested scratch band freezes a load permanently: a removed worked stop parked at seq+100
   collides on the next sweep. The new rule:
   - Inside the RPC, renumber every stop McLeod no longer lists to the **tail** (after McLeod's highest seq).
   - Leave the band empty at commit.
   - A deferrable index is not an option while old code uses `ON CONFLICT (load_id,seq)`. R3 tested this.
3. **C-10 is replaced** (R3-18). There is no soft-remove column, which would touch 14 readers. A stop McLeod removed is
   deleted as today, but only after its evidence is copied into a `load_events` row (`stop_removed_in_mcleod`, carrying the
   stop's id, address and times). A queued action for that stop lands on the load as a flagged event, and the office sees it.
4. **The proof chain is redesigned** (R3-3, R3-23, SEQ-8). This drops §2.13's "test org in production" and its second
   ingest token.
   - **The test company is read into the real org**, keyed by its McLeod `company_id`. The org's
     `org_integrations.config.mcleod.test_companies` lists it, and every report, census and count excludes those companies
     through one shared predicate.
   - **Modes:**
     - `test` writes only to listed test companies.
     - `canary` writes to the live company, but only inside a **scope**: `canary_scope jsonb` holding customer ids and stop
       types (pickup, delivery). This replaces the driver/target list and expresses "pickups first, then non-EDI
       deliveries, then EDI" (C-19).
     - `live` needs at least one confirmed request under `canary` on the same company. `canary` needs a confirmed `test`
       request, **or**, when the org has no test company, the owner's recorded sign-off (the second of the two sign-offs
       ruled on 2026-11-19).
5. **Request identity** (R3-9, R3-10).
   - One partial unique index: `(stop_id, operation) where origin='driver_app' and supersedes is null`.
   - Retries and "Send again" get random ids and point to the original through `supersedes`.
   - Dropped: the bytes-unique image key, the `(stop, kind)` index and uuidv5 ids. Duplicates are still prevented by
     `mcleod_image_sends`, which records the sha256 and the McLeod image id per order and category; a resend first checks
     that table and the order's image list.
   - `origin` includes `driver_app`, `office`, `office_retry`, `sweep`, `job` and `prove`.
6. **Driver outbox** (R3-5, R3-16).
   - Dropped: the per-load phone FIFO. Complete carries its own Arrive time and action id, and the **agent** clears a
     movement's stops in order.
   - Stop actions never dead-letter. They retry with backoff, capped at 15 min. After 60 min of failure, the phone shows
     "Not sent yet, keep the app open on signal" and the office gets one alert per load.
   - A server refusal (4xx with a DL code) still goes to Needs attention as today.
7. **Lease timing** (R3-4, R3-17, assumption 5–7).
   - The claim size is **1**.
   - `begin_send` is called **once**, with no built-in retry. A lost answer means "do not send"; the request is picked up
     again after the lease ends.
   - Settle is idempotent and may retry. The 90 s rule is dropped. The guard is the 300 s quiet period after any
     `send_started` (P-9). It holds only while `quiet ≥ write deadline + worst-case settle POST + margin`, which is
     30 + 247 = 277 s < 300 today, a 23 s margin (R3-4). The agent asserts that inequality at startup, and a matrix test
     title pins it.
   - Every timing number is a named **tunable** in one config object, with its first value and the MK0 measurement that
     sets it:
     | Tunable | First value | Set by |
     |---|---|---|
     | lease | 300 s | K-probe: `clearStop` latency at p99 |
     | write deadline | 30 s | K-probe |
     | sends | 3 | — |
     | re-read | 60 s | — |
     | quiet period | 300 s | — |
8. **C-5 corrected** (R3-6). The enqueue sub-transaction catches **every** error except 40001 and 40P01, which are
   re-raised so the whole call retries. It records `enqueue_failed` and raises P-17's critical alert.
9. **C-6 corrected** (assumption 12). `occurred_at` may be at most **5 min** in the future (OPS-7). The real skew is
   measured from `load_events` (`created_at - occurred_at`, p99), and the tunable is set from that measurement.
10. **"Hire again" and the D-RL5 sweep** (R3-11). A reopened row (`status='applicant'` with a former `termination_date`
    and a McLeod id) is **skipped** by `rosterApplicantHire`. It becomes active only through the 360 close. C-16's link
    runs only for rows with no McLeod id.
11. **C-11 corrected** (R3-8). `driver-store.yml` checks out with `fetch-depth: 0`, fetches `production`, and runs the
    `is-ancestor` step on every trigger, `workflow_dispatch` included.
12. **C-8 corrected** (R3-14). The secrets gate allowlists the four items already public, by exact string, and refuses
    anything new.
13. **C-7 corrected** (R3-13, assumption 2).
    - Writes need the separate write token in every case.
    - The VM's egress IP is **recorded on every claim**, and a change raises an alert.
    - The IP becomes a refusal rule only if Alex confirms in writing that it is static.
14. **C-21 corrected** (R3-15). `update-connector.ps1` is not changed. Every API Kit setting lives in `mcleod-ws.env`;
    its success check learns the `/ws` failure lines.
15. **Lease events** (R3-19). Lease and attempt facts go to `mcleod_write_attempts`, which is not retention-forbidden
    (kept 90 days). Business facts (confirmed, refused, conflict, applied_unverified, already_in_mcleod, enqueue_failed)
    stay in the append-only `mcleod_write_events`.
16. **C-A3 dropped** (R3-21, DR-19). No driver build exists yet, so `action_id` is **required from the first store build**,
    and the API refuses stop actions without one.
17. **C-17 relaxed** (R3-22). Filing BOL/POD through 360 goes **beside** McLeod's capture app, not instead of it, so it
    cannot make billing worse. The 98% trial is dropped. The rule: if the capture app ever stops being used, the scanner
    must be on stops first.
18. **C-14 is a product choice, not the cap fix** (R3-12, assumption 10). Reads use the existing `fetchAllPagedIn`. The
    list shows current loads plus loads delivered in the last **14 days** (owner may change; Q-8). Late evidence is
    always accepted.
19. **ETA re-key** (SEQ-9). S0c renumbers so `seq` stays unique per load, and 0453's predictions follow the stable stop id.
    The PR is named in v2.
20. **One `driver_complete_stop` rewrite** (SEQ-3). M-A carries every new parameter and the sha256 from M-D2. The
    pipeline migration rewrites from M-A's body, with a `cross-module-waiver`.
21. **S0 ordering** (SEQ-7). B2 → S0a; B1 → S0b. Production cannot roll back past S0b once S0c is released, and v2 states
    this in S0c's rollback line.
22. **Shared connector update with load rates** (SEQ-5). R4 (load rates) + B4 + the `/ws` client with every line off
    become **one** connector commit, **one** SQL review by Alex, **one** VM visit and **one** required-key flip. The load
    rates plan's "no request to Alex" is corrected by this.
23. **Driver visual plan** (SEQ-6). C-A2 merges before the visual plan's V5/V6.
24. **One exception name**: `late_evidence`.
25. **File budgets**: `me.ts` is split in C-A1. Whichever of B4 or load-rates R3 lands first extracts the cell from
    `DispatchLoadsPage.vue`.
26. **PGlite checks** (R3-1) move into `supabase/tests/mcleod-writes.test.mjs` and run against the **adopted** DDL, with the
    proof trigger, settle and the test-company rule, so CI runs them.
27. **Rolled-up evidence**:
    - Dropped from COUNCIL but adopted: RT-8 (ETA cadence), RT-17 (outbound PDF bucket: orphan sweep + backup), RT-21,
      RT-25, OPS-12, P-20, DR-14 ("Not in {name}'s app"), DR-19.
    - Fixed: the probe count is 13 read-only, 7 test-company write, 3 write + written answer, 1 read + written answer.
      `driver-store.yml` "ran once (2026-09-07) and failed". The surface doc's "73" is corrected to 75.

## 3. Asks, consolidated (final lists in `api-kit-round3/3-external.md`)

- **Alex:** one message to **Alex Tzakov**, Cc **Alex Lockwood**, as the 11-13 email did. 17 items, including:
  - the posture OK;
  - `clearStop` effects and the undo rehearsal;
  - the call-in effect on customers;
  - the uncoded service-failure question (Q-2);
  - creating the integration user and its security profile;
  - the fixed IP;
  - whether `/ws` on its own timer fits "one program, one connection";
  - one SQL review covering reference numbers, finance F3/F7 and test-company reads;
  - the remaining 13 Part 4 tables plus `drs_check` and `gl_summary` (Part 5 and two Part 4 tables already ran on 11-17);
  - whether Part 6 has run;
  - withdrawing the 11-13 Part 2 re-run and copy refresh.
- **McLeod via Ron:** 15 items, including:
  - `/ws` on 22.1;
  - URL and certificate;
  - test company;
  - where `/ws` images land (DocumentPower module);
  - token lifetime and revocation;
  - licence seats;
  - whether user security applies to `/ws` (deny billing and delete);
  - the API Kit terms and price in writing, with named contacts;
  - stability across upgrades;
  - call-in triggers.
- **Silence rule** (EXT-1): 10 business days without an answer means escalate through the owner. Work that does not
  depend on that answer never waits.
- **Ask order:** owner today (the Apple conversion starts first, because it is slowest), then Alex the same day, then
  McLeod a few hours later.

## 4. Owner decisions (COUNCIL Q-1 to Q-4, plus these)

| # | Question | Recommendation |
|---|---|---|
| Q-5 | **Store track**: start the Apple Individual → Organization conversion and the store filings now (owner's Apple and Google accounts). | Start today. Android goes first; iOS goes through external TestFlight until review passes. |
| Q-6 | A standing OK for hotfix releases during MK0, so that each VM-facing fix does not wait for a nightly release (RT-10, SEQ-4). | Yes, limited to `tools/mcleod-agent` and the `/api/tms` routes. |
| Q-7 | If McLeod says user security does **not** apply to `/ws` (OPS-11), the integration user could reach billing and delete. Proceed? | Proceed only with that user's password and token held on the VM alone, with every call logged and reviewed weekly. Otherwise stop. |
| Q-8 | The driver's delivered-loads window. | 14 days. |
| — | The 11-11 meeting notes and the Ron emails (the PDFs' notes sections are blank). | Send them if they exist. |

## 5. Rejected findings (with reason)

- **SEQ-8's "drop the test-company lane from the first release":** replaced by §2.4. The test company is read into the
  real org, so no second org or token is needed.
- **DR-15's 30-day window:** superseded by Q-8, a product choice.
- **C-A3 (action id made required later):** superseded by §2.16.
- **COUNCIL C-9 / C-10 / C-13 / C-17 as written:** replaced by §2.2, §2.3, §2.6 and §2.17.
