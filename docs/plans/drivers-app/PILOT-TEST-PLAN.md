# Driver app — pilot test plan (10–15 drivers)

**Written 2026-09-08.** For the first real-driver test of the Silvicom 360 driver app, and for the
demo that presents it.

**This document does not restate the test cases.** `RELEASE-GATE.md` **Gate B** is the device matrix
— seven sections, each with steps and a pass criterion — and it is the canonical list. Duplicating it
here would produce two lists that disagree within a month. What this document adds is the part Gate B
cannot know: who the testers are, what state the system is actually in on the day, which failures are
expected and must not be reported as bugs, and how a finding gets from a driver's cab into the repo.

---

## 1. What is true on 2026-09-08, measured

Every line here was queried against production or read from the repo on that date. A pilot that
starts from an inaccurate picture generates findings that are really just surprises.

| Fact | Value | Consequence for the pilot |
|---|---|---|
| Loads in production | **0** | Every tester sees an empty Loads tab until the demo seed is run. This is the single most likely cause of "the app is broken" feedback. |
| Drivers in `Silvicom Inc` | **286** | |
| …with an app login | **1** (`aaron`) | **Logins must be issued before the pilot can start.** Web → Roster → the driver → App access. |
| McLeod connection | **Sandbox, stale copy** | Real loads arrive when the live connection lands. Until then, loads are seeded. |
| Hazmat capture ever completed | **0**, in the whole history of the table | The Documents tab will be a first integration during this pilot, not a confirmation. Budget for it failing. |
| `hazmatguard` entitlement | **Granted** to Silvicom Inc | The Documents tab will appear. |
| Driver-app feature rows | **None**, so every released feature falls back to its catalogue default (`on`) | Loads, Score, Messages, Notifications and Documents are all visible. |
| Store builds ever produced | **0** | Distribution is the open work; see §5. |
| Gate C (on-device no-egress, OCR latency) | **Unrun** | Do not claim the scanner keeps bills of lading on the device until this runs. |

---

## 2. Before the first tester opens the app

Four steps, in order. Steps 1 and 2 are the fleet's; 3 and 4 need a terminal.

1. **Choose the testers** and confirm each is a real driver on the roster.
2. **Issue each an app login.** Web → Roster → open the driver → **App access** → create. The password
   is shown **once** — read it to them directly. There is no self-service reset, by design; a
   forgotten password is a fleet action, and testers must be told that up front or they will file it
   as a defect.
3. **Seed the demo loads**, once per tester, until McLeod is live:
   ```bash
   pnpm --filter @silvicom/api demo:loads --org <org-uuid> --driver <driver-uuid>          # dry run first
   pnpm --filter @silvicom/api demo:loads --org <org-uuid> --driver <driver-uuid> --apply
   ```
   Every row is marked `DEMO-` and `--remove --apply` takes them back out. The script **refuses** a
   driver who already has a real load, which is how it stops being used the day McLeod connects.
4. **Get the app onto the phone.** Blocked on §5 — this is the step that is not yet possible.

---

## 3. What to test, and in what order

Run **Gate B** from `RELEASE-GATE.md`. It is the list. Its seven sections, and what each is worth in
a pilot:

| Gate B section | Why it matters most here |
|---|---|
| **B1 · Cold start and the offline spine** | The single most important thing the app claims. A driver in a dock with no bars must not lose work. Test it *deliberately*: airplane mode on, do real work, force-quit, relaunch, then reconnect. |
| **B2 · Check-in wizard** | Regression-critical — it carries a defect that was reported and fixed once. |
| **B3 · Dashboard control plane** | Proves a fleet can turn features on and off for its drivers. Good demo material. |
| **B4 · Hazmat** | **Expect this to fail somewhere.** No capture has ever completed. Treat every finding here as new information rather than a regression. |
| **B5 · Notifications** | Needs push tokens; see §5's note on the EAS project. |
| **B6 · Messages** | Two-sided — needs somebody at a dashboard replying. |
| **B7 · Presentation and accessibility** | Sunlight legibility and gloves-on targets are the ones a cab tests and an office cannot. |

**Additionally, and not in Gate B because it shipped after it:** More → **Close my account**. Confirm
the login stops working immediately, the confirm sheet's wording is understood by the driver reading
it, and the request appears in Web → Settings → Driver App → Account closure requests. Use a tester
you can re-issue a login to afterwards — closing is not reversible from the app.

---

## 4. Known-limited: report these as findings, not as bugs

Telling a tester what is expected to be missing is the difference between fifteen useful reports and
fifty duplicates of the same three things.

- **Loads are demo data** unless McLeod is live. Refs beginning `DEMO-` are seeded.
- **Documents/hazmat may fail outright.** Nothing has ever been captured through it end to end.
- **Maps are pictures, not navigation.** No routing, no ETA, and deliberately no location permission
  — the app requests none, on either platform.
- **No self-service password reset**, ever. That is a design decision, not an omission.
- **Score data depends on the fleet's telematics**, not on the phone.

---

## 5. What still blocks distribution

The app cannot reach a tester's phone yet. This is the critical path, and none of it is code:

- **No build has ever been produced.** The EAS project exists (`@miroslavjokovic/fuelguard-driver`)
  and its `production` environment holds **no variables**, so a build today would compile with no
  Supabase URL, no anon key and no API URL, and would install and do nothing.
- **`eas.json` still carries two placeholders** — `ascAppId` and `appleTeamId`.
- **All three driver GitHub workflows are inert.** Every run of `driver-android`, `driver-ota` and
  `driver-store` completes as `action_required` in **0 seconds**, on every trigger. CI cannot build;
  builds must be run from a developer machine until this is diagnosed.
- **Apple and Google account details are partly outstanding.** Read off the owner's Mac on
  2026-09-08: Apple team **`FADWJ952AY`**, paid and active. Still needed: the App Store Connect API
  key (Issuer ID + Key ID + `.p8` — it can only be minted in the web UI and the file downloads once),
  the Play service account JSON, and the tester emails. §6 P2.3 is the list.

⚠ **iOS testing cannot use internal TestFlight, and this changed on 2026-09-08.** The Apple
membership is an **Individual** one (`teamType = Individual`), which admits exactly one App Store
Connect user — the Account Holder. An internal TestFlight tester must be a user on the account, so
the only possible internal tester is the owner. The 2026-09-08 ruling in favour of internal TestFlight
was made before the account type was checked and cannot be executed as written; **Q-PR7** in
`DRIVER-APP-DIRECTION-B-PLAN.md` carries the three candidates and the recommendation (external
TestFlight for the pilot, and start the Organization conversion in parallel).

**Android is unaffected** and can pilot first.

---

## 6. How a finding gets recorded

Into `FIELD-REPORTS.md`, in that file's existing table shape — `FR<n>`, the report in the driver's own
words where possible, the first read, and a status. That file already holds the 2026-08-07 device
findings and their resolutions, and it is where a report survives the conversation it was mentioned in.

**What makes a report usable:** which screen, what the driver did, what happened, and whether they had
a signal. The Build panel under More → System settings gives the version and the API commit — a report
without it cannot be tied to a build.

---

## 7. Demonstrating it

For an audience rather than a test: five screens, in this order, on a phone with the demo loads seeded.

1. **Home** — the active load, the shift, the week's score.
2. **Loads** — the offer deck: accept one, and watch it move into Current.
3. **A stop** — the map hero, the checklist, a photograph taken and queued.
4. **Airplane mode** — do the same thing again offline, then reconnect and watch the queue drain to
   zero. This is the part that lands, because it is the part every other fleet app gets wrong.
5. **Web → Settings → Driver App** — turn a feature off, pull to refresh the phone, watch it disappear.

Say plainly that the loads are seeded and McLeod is next. A demo that implies live data and is then
found out costs more than the one it bought.
