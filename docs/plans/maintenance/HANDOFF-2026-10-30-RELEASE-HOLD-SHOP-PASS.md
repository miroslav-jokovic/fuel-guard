# Handoff — release on hold; the shop pass, its fixes, then one release (2026-10-30, evening)

**Where this starts:** every step of `HANDOFF-2026-10-30-EQUIPMENT-AFTER-EA.md` is built and merged.
The owner **held the release** to let one more round of fixes ride the same train. This chat
finishes that round, then hands the release back to the owner.

Read first:
1. This file.
2. `HANDOFF-2026-10-30-EQUIPMENT-AFTER-EA.md` §3 ("Facts and traps"). Every trap in it still holds.
3. Memory `driver-equipment-unit-tags-position.md`, from "2026-10-30 afternoon".
4. `HANDOFF-2026-10-29-MAINTENANCE-TABLETS.md` → "How to work", for setup, gates and browser-pass traps.

## 1. State at handoff

**Main is ahead of production by 13 merged PRs, plus this docs PR.** All of it is on staging, and nothing has been released.

| PR | What |
|---|---|
| #1847–#1850 | EA1–EA4: assign by scan, Equipment tabs by holder, checks by scan, Scan page card |
| #1852 | M10b: Invoices, the fourth Equipment tab; also adds the M5 checklist (§2 below) |
| #1853 | DE3: migration **0531** `unit_tags` (one code per truck/trailer, never changed) |
| #1854 | `AppTabs` scrolls the selected tab into view (Invoices was off-screen at 390 px) |
| #1855 | DE4: VEH/TRL labels printed (Labels → Trucks & trailers); scanning one opens the unit with `?assign=1` |
| #1856 | DE5: another unit's label switches the Assign list; in a check it offers that unit's check |
| #1841, #1843, #1844 | Hazmat calculator fixes (another session) |
| #1851 | The earlier handoff |

- **Release candidate #1846** was refreshed to `9f83eb7`. Because this docs PR merges after that, the candidate is stale: refresh it again before the owner approves (§3).
- **Production:** `6539c7a`, schema 0530.
- **Staging:** main, schema 0531.
- **Not in the release, and not ours:**
  - #1845 (placard calculator access) has a failing CI check.
  - #1698, #1699 and #1703 (finance) still number their migrations 0509/0510, which main already uses.
  - #1724 is a draft.

  Leave them to their sessions unless the owner says otherwise.

## 2. The work: the shop pass (M5) and its fixes

The checklist is the last entry in `MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md` §8 ("2026-10-30 (M5 prepared)"). It has nine lines, each saying what to do and what should happen.

The owner runs it on **staging**, with:
- the Android tablet and a phone;
- the Tera Pro scanner;
- the MUNBYN printer.

Add one line for the truck labels, which landed after the checklist was written:

> 10. Labels → **Trucks & trailers** → tick a truck and a trailer → print on the roll. Stick the truck's label
> inside the cab (driver door jamb) and the trailer's inside its front wall. On the Scan page, scan the truck's
> label: its page opens with *Assign equipment to Truck …* already up. Scan a strap, then the trailer's label:
> the list says *Now assigning to Trailer …* and the strap still says *Goes on Truck …*. Press *Assign 2*.

**How to work it:**
- Write the owner's findings as a dated entry under §8. For each: the screen, what happened, and what should have happened.
- Fix each finding in its own small PR, with a test, a mutation check and a browser pass at 390 and 834 px. Merge each yourself when CI is green.
- A finding that needs a decision (wording, a rule) goes to the owner with a recommendation. Don't guess: the glossary is the owner's (`MAINTENANCE-SECTION-REDESIGN-PROPOSAL` §4.4).
- If the owner can't run the pass today, say so and go straight to §3 with nothing more added.

**Known open items to offer the owner:**
- **Shorter tab labels.** At 390 px Equipment's fourth tab needs a swipe (the strip now shows the selected tab). "Trucks / Drivers / Shop / Invoices" would fit all four. The owner decides.
- **Dash on PDF labels.** The PDF prints the label's em dash as a hyphen ("Inside cab - driver door jamb"); that's `winAnsi`'s rule. The label printer's raster path is not checked. Look at a real printed label in the pass before changing anything.

## 3. Then: the release (the owner's)

1. Before refreshing, check that no migration number on an open PR collides with main's latest. Main's latest is 0531.
2. Refresh the candidate yourself: `gh workflow run release-candidate.yml --ref main`. Confirm #1846's head equals main's head, and list the PRs it now carries beyond the 13 above.
3. Tell the owner what ships, in office words, then hand over the two steps. Both are refused when you run them:
   - approve #1846 in the console → Settings (or `! gh pr review 1846 --approve`);
   - `! gh workflow run release.yml --ref main -f mode=nightly`.
4. **Hold every other merge** until it ships: the approval is pinned to one commit.
5. Watch the run (`gh run watch <id> --exit-status`), then check with `pnpm verify:live`: production on the candidate commit, schema 0531. "release: not reported" in the first five minutes is the tag cache, not a failure.
6. Record the release in memory `release-on-owner-go.md`.

## 4. Traps

- **Flaky local suites**, unrelated to this work: `apps/api members.test.ts` and `apps/admin-api releaseApproval.test.ts` (`fetch failed`). Both pass when rerun alone. CI was green each time.
- **`HolderEquipmentCard` reads the route** (`?assign=1`). Every test that mounts it needs a router; `sp5CrossSectionDoors.test.ts` uses `ROUTE_TABLE`.
- **Restrict violations:** `on delete restrict` raises **23001**, not 23503.
- **New tables with a multi-column CHECK** need a `handSeed` entry in `supabase/tests/rls.test.mjs`. `unit_tags` has one.
- **Ports:** read the preview port from the END of its log, because several chats run previews at once.

## 5. Paste this into the new chat

```
Read docs/plans/maintenance/HANDOFF-2026-10-30-RELEASE-HOLD-SHOP-PASS.md and the memory file
driver-equipment-unit-tags-position.md. The release is ON HOLD so this round rides the same train.
Do §2: run the owner's shop pass with me on staging (the M5 checklist in
MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §8 plus line 10 for truck labels), log my findings in §8,
and fix each one as its own small PR, merged yourself when CI is green. Bring decisions to me with a
recommendation. Then do §3: refresh release candidate #1846 on main's head, tell me what ships, and
give me the approve and dispatch commands. Do not approve or dispatch it yourself.
```
