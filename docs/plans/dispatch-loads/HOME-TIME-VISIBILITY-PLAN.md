# Home time you can see, find and undo: plan

Follows `HOME-TIME-PLAN.md` (HT1–HT7, shipped 2026-11-13). Owner, 2026-11-23: *"there is no button to
edit or cancel this status, also we don't see that status nowhere"*, then *"filters are not good, on
Drivers page search per vehicle is not really good, also statuses are not there … this has to be 100%
precise and reliable and visible."*

The record and the API are right. What fails is what the record reaches: home time can be seen and
undone only on the Dispatch board (`/assignments`), only one click deep, and the screens people actually
look for a driver on — the Drivers list, the driver's page, the Dashboard's Dispatch map — do not say it.
On top of that, the Drivers list's search cannot find a driver by his truck.

## 1. What is true today (measured 2026-11-23, production `f54ab99`, schema 0641)

**The data.** One home-time period exists: LEONARD BURRELL, marked 11/17, home 11/16 → due back
11/24 21:32 UTC, truck 676 with him. Real fleet org, driver `active`, truck 676 `active` with him as its
assigned driver, no co-driver, no in-progress load. One audit row (`home_time.marked`); nobody has
changed, ended or canceled it. `home_time_settings` has no row (the defaults apply). So the board's merge
(`withHomeTimes`) should hold truck 676 and say "Home time until 11/24". **Not yet seen with eyes** — an
ad-hoc read of the board code against production was refused by the session's permission guard, and there
is no production login in a browser. HV0 below is that look.

**F1 — The Drivers list cannot find a driver by truck.** `rosterRows.ts` `matchesExceptFile` searches
`full_name, employee_id, phone, samsara_username` by substring. The truck is not one of them, although the
table shows it (the Vehicles column, `assignedUnits`). Measured over the 178 active trucks with an
assigned driver: typing the unit number finds **its own driver for 2 trucks**, and returns **some other
driver for 138** — the digits occur inside somebody's phone number. A search that is silently wrong is
worse than one that finds nothing.

**F2 — No home-time status on the Drivers list.** The Status column is employment status only
(`StatusBadge row.status`). The Status filter's options are built from the data: 191 active, 28
terminated, 2 inactive, 1 applicant on the live roster. Home time is in neither, and there is no filter
for it. (Storing it in `drivers.status` stays rejected — D-HT4: status is McLeod's for linked drivers.)

**F3 — The driver's page has a button and no status.** `HomeTimeButton` says "Home time" whether he is
home, overdue, scheduled or working. It is hidden from anybody without `dispatch: view`.

**F4 — The Home time tab filters by nothing but text.** A search box and a two-way switch (On or
scheduled / Ended, last 60 days). No Overdue / Home / Scheduled filter and no counts per state; the
ended list mixes ended and canceled periods.

**F5 — The Dispatch board says it in one case only.** Available reads "Home time until …" only when the
truck is held (`homeTimeHold`: every seat home, truck with a driver, **no current load**). A seat home on
a truck that still carries a load gets a Warnings chip and nothing in the Driver cell. There is no queue or
filter for "on home time", and the board's search does not include the co-driver's name.

**F6 — Edit and cancel are two clicks deep.** Change, Back from home time, Truck is back at the yard,
Cancel and Reopen all exist (`HomeTimeDrawer.vue`), but only inside the home-time drawer, which opens from
(a) board row → truck drawer → Open, (b) the Home time tab → row, (c) the driver page button. Nothing on a
board row, a roster row or a badge opens it.

**F7 — Nowhere else.** The Dashboard's Dispatch tab (the one live map since D-DR24), the Loads list and
the Drivers list never read home time.

**F8 — The drawer's driver picker matches substrings of its label.** "Truck 676" is in the label, so
676 finds him, but "67" also lists every driver whose truck number or name contains 67. Usable; not
precise.

## 2. Design

- **D-HT21 — One answer to "is this driver on home time", derived, everywhere.** A driver's home-time
  state is the live period's `homeTimeState` (scheduled · active · overdue), never stored (D-HT4 holds).
  One shared function in `@silvicom/shared` turns a period into the badge — words, tone, the date — and
  every surface renders that one badge component (`HomeTimeBadge.vue`). The badge IS a button: it opens
  the home-time drawer on that driver (`?homeTime=<id>`). Same words as the board: **Scheduled from
  11/26**, **Home until 11/24**, **Overdue since 11/24** (red).

- **D-HT22 — Truck search is a token match, phone search is a digits match.** A shared
  `matchesDriverSearch(term, fields)`:
  - truck units (assigned truck(s), current HOS truck) match as a **whole token or prefix of a token**
    — `676` finds 676, not 1676 and not a phone;
  - name, driver ID, employee ID by substring, case-insensitive, as now;
  - phone only by **digits**, and only when the term has **4 or more digits and no letters**, compared
    with the phone's digits — so `676` never matches a phone, `555-0134` matches `(312) 555-0134`.
  The same function serves the Drivers list, the Home time tab, the drawer's driver picker (F8; the picker
  ranks an exact unit match first) and the board's search (which gains the co-driver). Read the truck from
  the vehicles the page already loads (`useVehiclesQuery`), the source the Vehicles column shows — the
  search finds exactly what the table shows.

- **D-HT23 — Filters a dispatcher actually asks.**
  - *Drivers list:* a **Home time** filter — Any · On home time (home + overdue) · Overdue · Scheduled ·
    Not on home time — with a count on each option computed by the list's own predicate (the D-DQ18 rule:
    the number on the option is the rows it leaves). The toolbar already holds four controls, the
    `lint:ui-adoption` budget, so it goes under **More filters** with a chip when set (Q-HT10).
  - *Home time tab:* the live list gets a state choice with counts — **All (n) · Overdue (n) · Home (n) ·
    Scheduled (n)**; the ended list splits **Ended** and **Canceled**. Both in the URL (`ht.state`).
  - *Dispatch board:* a **Home time** option in the queue choice (not a third tab — BOARD_TABS stays two),
    and the search's new co-driver field.

- **D-HT24 — The status is said where the driver is looked at.**
  - **Drivers list:** the badge beside the employment badge in the Status column, sortable as part of it.
  - **Driver page header:** a status line under the name ("Home until Mon 11/24, 3:32 PM · truck 676 with
    him"), and the button reads what it does — **Mark home time** / **Change or end home time**.
  - **Dispatch board row:** the badge in the Driver cell for every seat on home time, **whether or not the
    truck is held** (closes F5's gap); a row action **Home time…** so end/cancel is one click from the row.
  - **Dashboard Dispatch map:** the badge on the truck card, and a home-time look for a held truck's pin.
  - **Loads list:** the badge beside the driver, for a load assigned to somebody on home time (that is a
    planning error worth seeing).

- **D-HT25 — Undo is never more than one click from the status.** Every badge opens the drawer; the
  drawer's actions are unchanged (Back from home time, Change, Truck back at the yard, Cancel, Reopen).
  The drawer already lives on the URL, so this adds entry points, not a second editor.

- **D-HT26 — One read, one clock.** The Drivers list, driver page, Home time tab and drawer read the
  existing `GET /api/roster/home-time` (one cache, polled every 60 s, invalidated by every write). The board
  and the map keep the server merge, which reads the same rows with the same query (`readLiveHomeTimes`).
  A test pins that both paths give the same state for the same period and `now`.

**Rejected:** a `drivers.status = 'home_time'` value (D-HT4); a second home-time list endpoint for the
roster (a copy of the same read); putting home time into the Status filter's options (mixes "is he
employed" with "is he working this week", and the employment count the owner asked for on 2026-10-21 would
change meaning).

## 3. Every case, and what each screen says

| Case | Drivers list | Driver page | Board row | Home time tab |
|---|---|---|---|---|
| Scheduled (leaves later) | Scheduled from … | Scheduled line, Change/Cancel | Driver-cell badge, row free until he leaves | Scheduled |
| Home, truck with him, no load | Home until … | Home line | Available "Home time until …", badge | Home |
| Home, truck at the yard | Home until … | Home line, "truck at the yard" | Badge; truck free | Home |
| Home, truck still on a load | Home until … | Home line | Badge (new — F5), load still shown | Home |
| Team, one seat home | Home on that driver only | that driver's page | Badge on that seat; truck runs | Home |
| Overdue | Overdue since … (red) | red line | red badge + Available red | Overdue, first |
| No truck | Home until … | "no truck" | — (no row) | Home |
| Ended / canceled | nothing | "Last home time …" + Reopen (ended) | nothing | Ended / Canceled lists |

## 4. Steps (one PR each, in order; none needs a migration)

- **HV0 — Look first.** On staging and on production (read-only), open Dispatch board → truck 676 and
  the Home time tab, and screenshot what LEONARD BURRELL's period shows today. If the board does NOT say
  Home time, that is a defect in the shipped merge and it is fixed before anything below.
- **HV1 — Search (F1, F8).** `matchesDriverSearch` in shared with its tests (the 2/178 and 138/178 cases
  as fixtures); the Drivers list, Home time tab, drawer picker and board search use it; the board search
  gains the co-driver. Placeholder words say "truck".
- **HV2 — The badge and the Drivers list (F2, F3, F6).** `homeTimeBadge` in shared, `HomeTimeBadge.vue`;
  the Status column badge, the Home time filter with counts under More filters; the driver page's status
  line and button words.
- **HV3 — Home time tab filters (F4).** State choice with counts, Ended/Canceled split, both in the URL.
- **HV4 — Board (F5, F6).** Driver-cell badge for every home seat, the row action, the Home time queue.
- **HV5 — Map and Loads (F7).** Truck card badge and pin look on the Dashboard's Dispatch tab; the Loads
  list's driver badge.
- **HV6 — Hand-back.** Browser pass at 1440 px and a phone width on staging with the §3 fixtures (solo,
  team one seat, scheduled, overdue, no truck, truck on a load); every row of §3 checked by eye; the same
  on production after the release, on Leonard's real period.

Each PR: mutation-proved tests per the repo's rule, every gate run, and its own browser pass for the
screens it touches.

## 5. Questions for the owner — ANSWERED 2026-11-23: "go with your recommendations"

Q-HT9 (a), Q-HT10 More filters, Q-HT11 no, Q-HT12 as read (Drivers list and Home time tab).

- **Q-HT9 — Who sees the home-time badge on the Drivers list and the driver page?** The home-time read
  is behind `dispatch: view`; a recruiter or safety manager does not hold it. *(a)* Only people who can
  view Dispatch — the rule the driver-page button already follows, no API change. *(b)* Everybody who can
  see the roster, which needs the roster's read to carry the live state (small API change, one more
  reader of the same rows). **Recommend (a)** now; (b) if safety asks for it.
- **Q-HT10 — Where does the Drivers list's Home time filter go?** The toolbar is at its four-control
  budget (Status, Show, File, Due). **Recommend under More filters**, with a chip when set; the alternative
  is moving Due there instead.
- **Q-HT11 — Should trucks on home time leave the board's "All trucks"?** **Recommend no**: they already
  sort low (rank 3.8), say Home time in Available, and the new Home time queue lists them on their own.
- **Q-HT12 — Which filters did "filters are not good" mean?** This plan reads it as the Drivers list and
  the Home time tab. If it was another screen (the board's Available/State filter, Loads), name it and it
  joins HV1–HV4.

## 6. Progress log

- 2026-11-23 — **HV1 built** (branch `claude/home-time-visibility-plan`). `driverSearch.ts` in shared:
  `driverSearchRank`, `matchesDriverSearch`, `unitsByDriver`. The Drivers list searches the trucks its
  Vehicles column shows plus Samsara's signed-in truck; the column now lists a co-driver's truck too
  (it read "—" for the second seat). The Home time tab and the drawer's driver picker use the same rule;
  the picker ranks an exact unit first. The board's search gains the co-driver. Tests: shared 10, web 4;
  mutation run: 5 deliberate breakages (the old substring search among them), 5 caught.
- 2026-11-23 — **HV2 built** (branch `claude/home-time-badge`, stacked on HV1). `HomeTimeBadge.vue` — "Home
  time from 11/26", "Home until 11/24", "Overdue since 11/24" in red — opens the driver's home-time drawer
  on a click. Drivers list: the badge beside the employment badge in Status, and a **Home time** filter
  under More filters (Home now · Overdue · Scheduled · Not home now, each with its count, `?home=`), with
  its chip; the page mounts the drawer. Driver page: the badge, then a button that says what it does
  (Mark home time / Change or end home time). Shown only to readers of Dispatch (Q-HT9 (a),
  `useHomeTimeVisible`). Tests: shared 6, web 8, two roster snapshots updated for the Status cell's new
  wrapper; mutation run: 6 deliberate breakages, 6 caught. `DriversPage.vue` is at 476 lines (the
  file-size warning it already had at 459; the logic went to `useRosterHomeTime.ts`).
- 2026-11-23 — **HV3 built** (branch `claude/home-time-tab-filters`, stacked on HV2). The Home time tab
  gains a **Status** filter: the live list Overdue · Home · Scheduled, the closed list Ended · Canceled
  (which it used to mix), each option with the rows it leaves under the search as typed (`ht.state`);
  a state the list does not hold is no filter. `homeTimeTabView.ts`, tests 4; mutation run 3 of 3 caught.
- 2026-11-23 — **HV4 built** (branch `claude/home-time-board`, stacked on HV3). The board's Driver cell
  shows the second seat ("and Ben Cole") and a home-time badge for every seat on home time, held truck
  or not — the case F5 found silent (a seat home on a truck still carrying a load, or a team truck
  still running). The badge opens that driver's drawer in one click (D-HT25).
  - **Not built, and why — two parts of D-HT23/24 the board already answers:**
    - *A "Home time…" row action.* The board has no actions column, and adding one widens every row at
      1440 px (HT3's rule: nothing is added as a column). The badge IS the one-click way to change, end
      or cancel; marking a driver who is not home stays in the truck's drawer (two clicks, as HT3
      designed).
    - *A "Home time" board queue.* The board shows only two queues as tabs (`BOARD_TABS`, the
      dispatchers' 2026-10 ruling); a third, hidden queue is reachable by URL only and nobody finds it.
      The **Home time tab** next to History is that view, and since HV3 it filters by state.
  - Tests: one board test (the Driver cell's badges on a held truck and on a running team truck, the
    co-driver's name, the badge opening the drawer without the truck's). Mutation run: 2 of 3 caught;
    the third — the badge's `.stop` removed — is not observable in jsdom (the row's `truck` write and the
    badge's `homeTime` push race, and the push wins), so `.stop` stays as a guard the browser pass checks.
- 2026-11-23 — **HV5 built** (branch `claude/home-time-map-loads`, stacked on HV4). The Dashboard's
  Dispatch map: the badge beside the truck's state on the truck card, and beside the driver's name on his
  rail row — read once by `LiveMapWorkspace` (the map's feed carries only the driver's id and name) and
  handed down, with the drawer mounted there. The Loads list: each seat on home time under the driver's
  name, in `LoadDriverCell.vue` (moved out of `DispatchLoadsPage.vue`, which stood at 499 of 500 lines; now
  495), with the drawer mounted on the page. Both only for readers of Dispatch (Q-HT9 (a)).
  - **Not built: a home-time look for the truck's pin.** The pin's glyph is the truck's MOTION state
    (`liveMapLayer.ts`, D-LM20), and a second meaning on one glyph needs its own design pass; the card
    and the rail say it, one click from the pin. Open as Q-HT13 below.
  - Tests: map workspace 1, map card 2, Loads cell 3. Mutation run: 5 of 5 caught.

- **Q-HT13 — Should a truck at its driver's house look different on the map?** *(a)* Leave the pin as
  motion only — the card and rail say home time (built). *(b)* A small house mark on the pin for a held
  truck. **Recommend (a)** until a dispatcher asks: a parked truck is already grey, and a second mark on
  two hundred pins is noise.
- 2026-11-23 — **HV6, staging pass (part 1)** as the staging dispatcher, on `968f521`: marked AARON ACKISS
  (truck 733) home until 11/26 through the tab's form — the picker answered "733" with that one driver.
  Seen: the Home time tab row and its Status filter; the Drivers list's badge and `?home=on` (one row);
  the Dashboard map's badge; the board's row for 733 ("Home time until 11/26" in Available, "Home time" in
  Status, the badge in Driver); the driver page's badge and **Change or end home time**; the badge
  opening the drawer with Back from home time · Change · Truck is back at the yard · Cancel home time.
  The Drivers list search "733" returned that one driver.
  - **Fixed from the pass:** the Drivers list's badge sat in Status, the LAST of fifteen columns, off the
    screen at 1440 px — present in the DOM and seen by nobody. It moves under the driver's name, the
    column that never scrolls (branch `claude/home-time-name-column`).
  - **Seen, not changed:** the board names truck 733's driver "Unnamed driver" on staging. The board
    builds the name from `first_name`/`last_name` (`fleetIdentityReads.ts` `displayName`) and staging's
    drivers carry only `full_name`. Production has 0 of 181 seated drivers without them (measured
    2026-11-23), so it is staging data, not a production defect.
