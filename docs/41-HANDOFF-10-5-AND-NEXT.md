# Handoff — 10.5 half-done, and what comes after Phase 10

**Written 2026-08-18, end of day.** Successor to `docs/40` (read its §1.3 for the day's three
discoveries; read `docs/38` for the standing rules and method — both still hold). This one is SHORT
on purpose: Miki ruled the Phase 11 plan outdated, so there is no phase plan here — only the state,
tomorrow's runbook, and the next chat's first task.

---

## 1. ⚠ TWO RAILWAY FLAGS ARE ON OVERNIGHT — teardown owed after tomorrow's steps

`EFS_CARD_CONTROL_PROBE_ENABLED=true` and `EFS_ALLOW_PRODUCTION_PROBE=true` are both SET on the
`@fleetguard/api` service, deliberately, so tomorrow's promote sequence does not need another flag
dance. Standing rule 15 still applies — they come DOWN when §2 finishes, via
`railway variable delete` twice + `railway redeploy --service "@fleetguard/api" --from-source --yes`
+ poll `/api/version` until `deploymentId` changes (docs/40 §2.2's skipped-deployment trap).

## 2. The 10.5 runbook — exactly where it stopped

**Done today:** `override_grant` is **PROVEN on production** — proof
`31d68467-d649-4e8f-847d-89e42557fcb1`, card ••••7971 (truck 671, ACTIVE), outcome `proven`, every
gate green, card left untouched. The proof's detail carries the `sent ACCEPTED` caveat (the vendor
never echoes a grant's scope or limits — docs/40 §1.3). Three same-day fixes made it possible:
`sentAccepted` on OEG-3 (PR #110), the Active-only grant rule + the proof-own-row exemption
(PR #111, after proof `86897357` stranded ••••6536 — since cleared in the WEX portal by Miki).

**Remaining, in order (Miki runs 1,2,3,5; a SECOND admin runs the promotes — production's
separation-of-duties rule refuses the proof runner as promoter; the org has four admins):**

1. **Second admin** (their token, their password at the prompts):
   `pnpm efs:promote override_grant --proof 31d68467-d649-4e8f-847d-89e42557fcb1 --reason "..."`
2. **Miki**: grant a 1-use, all-locations, no-product exception on ••••7971 from the dashboard —
   the first live end-to-end of the shipped drawer path. It rests at "Sent, but not confirmed";
   that is the honest vendor-blind state, not a failure.
3. **Miki**: `pnpm efs:prove override_clear` against ••••7971. Its precondition NEEDS the armed
   override from step 2; its revert re-arms the same count, so the card comes out as it went in.
   Copy the new proof id.
4. **Second admin**: `pnpm efs:promote override_clear --proof <that id> --reason "..."`
5. **Miki**: Remove the exception from the dashboard (the button that was muted this morning — it
   was `override_clear` not being promoted, now it is), then the §1 flag teardown.

⚠ Promoting grant WITHOUT finishing clear ships a one-way door — the exact corner Miki was in this
morning on ••••6536. Do not stop after step 1.

## 3. The next chat's first task: REVIEW, then the settings work

Miki, 2026-08-18: *"plan is outdated. We will only need part with settings to be implemented, but
this needs review."* So: no Phase 11 as `docs/28` wrote it. The review should settle what "the
settings part" covers before anything is built. Candidates, from what exists and what was ruled:

- **Hand-enter as a card SETTING** — the OFF direction deliberately does not exist in the override
  drawer (`grantOverrideSchema`: unticked writes nothing); docs/38 §1.3 records Miki's earlier call
  that it belongs in settings. Old Step 12.1's shape: ALLOW/DISALLOW/POLICY, danger-confirm toward
  ALLOW, OEG-4 critical (vendor string field, H1 class).
- **Card product limits as a SETTING** (old 11.1's editor) — now on solid ground: setCardv2 needs
  the six-field record (proven live), `limitSource` decides whether card-level limits do anything
  (guard exists), and EFS provably does not disturb card limits across override cycles.
- **The existing settings surface** (`useCardControlSettings`: enablement, approvers, entitlement)
  — whatever polish the review finds.

Verify against the vendor docs before implementing any of it — the method that found every real
defect this phase (docs/38 §4, and docs/40 §1.3 for what it caught today).

## 4. Refresh follow-up (partly done today)

- ✅ The frozen "Checked 5 days ago" banner: two ABSENT cards (EFS stopped listing them 08-14) held
  their last `syncedAt` forever and dragged 199 live rows. Fixed — `reachableSyncFloor` (PR #112).
- Open, one work item: raise the sweep cadence for statuses (24h → every few hours), and refresh a
  card's live detail when its page/drawer opens. ⚠ Push back on "real-time always": EFS has no
  webhooks; FuelGuard-made changes already update immediately via the post-write verified re-read —
  only EXTERNAL changes (WEX portal) age until a sweep or refresh.

## 5. Odds and ends carried forward

- `card_lock` sits **suspended** on production (2026-08-15, no proof cited) — unreviewed today.
- docs/40 §5's other carried items stand: 9.4/9.6 live halves, `card_unlock` unproven since 8.2.
- The QA org's `override_grant`/`override_clear` are `enabled` with `proof_id: null` — grandfathered
  before the proof machinery. Worth regularising someday, not urgent.
