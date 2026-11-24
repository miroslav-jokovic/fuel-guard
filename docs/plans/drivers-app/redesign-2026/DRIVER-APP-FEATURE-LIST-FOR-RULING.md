# Driver app: the feature list to rule on (2026-11-23)

**For the owner.** Mark each row **Yes**, **No** or **Later**. Design starts only after this page is ruled
(`DRIVER-APP-2026-ANALYSIS.md` §2: features before design). IDs: **DF-n** (feature) and **Q-DF-n**
(question), both unused in the repo on 2026-11-23.

**The rule behind the list: the app is simple.** There are 4 tabs and one big button that always says the
next step. Every action shows ✓ *sent* or ⏳ *waiting for signal*. Anything a driver uses less than once
a week goes under **Me**, never on a tab. J.B. Hunt's DRIVE app is the comparison: drivers like it for
"loads and pay in one app", and their main complaint is wrong or stale data.

**Key.** **Now** = can be built without the McLeod API. **API** = waits on the McLeod API Kit
(`/ws` on 22.1, test company, Alex Lockwood's written OK). The MK phase is from `MCLEOD-API-KIT-PLAN.md`.

## Tabs and the screens on each

| Tab | Screens |
|---|---|
| **Today** | Current load card + the one big button; Running late; Report a problem; HOS left |
| **Loads** | Upcoming / Delivered (14 days); Load detail; Stop |
| **Messages** | Dispatch chat; one-tap call: dispatch, safety, payroll |
| **Me** | Pay; Score; My documents; Home time; Truck check-in / end shift; Refer a driver; Settings |

## Must have: the core (recommend **Yes** to all)

| ID | Feature | When | Rule |
|---|---|---|---|
| DF-1 | **See my load as soon as dispatch assigns it** (today it stays hidden until the first stop departs); the co-driver sees it too | Now (N2) | ☐ |
| DF-2 | **"Got it" button** replaces Accept/Decline (which can never work on McLeod loads); the office sees "seen by driver" | Now (N3) | ☐ |
| DF-3 | **Load details:** pickup number, reference numbers, customer, weight, pieces, stop notes, appointment times | Now (N4) | ☐ |
| DF-4 | **One big button per step:** Got it → Arrived → Take BOL photo → Complete → next stop | Now; writes to McLeod at API (MK3) | ☐ |
| DF-5 | **Photos inside the step:** BOL at pickup, POD at delivery, one list for every load; the scanner opens from the step, not from a tab | Now (N5); files go to McLeod at API (MK4) | ☐ |
| DF-6 | **Sent / waiting shown on every action;** nothing is lost offline; "Not sent yet" after 60 minutes | Now (N7, D-MK21) | ☐ |
| DF-7 | **Delivered loads for 14 days;** late photos still accepted (this is also Q-8 in the McLeod decision register) | Now | ☐ |
| DF-8 | **Messages to dispatch** (exists) **+ one-tap call** to dispatch, safety and payroll | Now | ☐ |
| DF-9 | **Truck check-in:** McLeod's assigned truck and trailer listed first | Now (N8) | ☐ |
| DF-10 | **Running late:** send a new ETA and a reason | API (MK6) | ☐ |

## Should have (recommend **Yes**)

| ID | Feature | When | Rule |
|---|---|---|---|
| DF-11 | **Report a problem:** one button on the load for detention, lumper (receipt photo + amount), damage/shortage (photos), refused load, breakdown (to the roadside repair flow) | Now (saved in 360); lumper/detention to McLeod at API | ☐ |
| DF-12 | **HOS left** on Today and on the lock screen (V9 widget, PR #2611) | Now | ☐ |
| DF-13 | **Score with idle time** (the weekly score exists; idle data is already in Samsara) | Now | ☐ |
| DF-14 | **My documents:** what I uploaded and its status (exists), plus med card / CDL renewal photo to Safety | Now; McLeod update at API (MK5) | ☐ |
| DF-15 | **Hazmat placard calculator**, shown only on hazmat loads (exists; J.B. Hunt has nothing like it) | Now | ☐ |
| DF-16 | **Fuel receipt photo** (the uploaded file wins over the card feed, D-IP7) | Now | ☐ |

## Your call: each needs a ruling

| ID | Feature | Question | Recommend | Rule |
|---|---|---|---|---|
| DF-17 | ~~**My pay**~~ **RULED OUT 2026-11-23** (no finance in the driver app for now) | **Q-DF-1.** May drivers see pay in the app? J.B. Hunt drivers name it first. McLeod's `SettlementService` has the read endpoints; confirm on our 22.1. | — | **No** |
| DF-18 | **Home time:** see next and last home date; request home time | **Q-DF-2.** Is the read side enough to start? The request needs the Symphony question (B-MK8) answered. | Yes, read first | ☐ |
| DF-19 | **Refer a driver:** name + phone straight into recruiting leads | **Q-DF-3.** Is there a referral bonus to show? | Yes | ☐ |
| DF-20 | **Lock while driving** (J.B. Hunt locks the app above 5 mph) | **Q-DF-4.** Full lock, or only the big next-stop view while moving? | Next-stop view only | ☐ |
| DF-21 | **Navigation** to the next stop | **Q-DF-5.** Build in-app truck routing, or hand off to Google Maps or a truck GPS app? | Hand off first | ☐ |
| DF-22 | ~~**Cash advance request**~~ **RULED OUT 2026-11-23** | **Q-DF-6.** This is a money write. It needs D-MK5 ("no money writes") re-ruled and accounting's OK. | — | **No** |

## Not now (recommend **No**; can be reopened)

| ID | Feature | Why not |
|---|---|---|
| DF-23 | Training assignments | Used rarely; adds a menu |
| DF-24 | Company news feed | Messages can carry news |
| DF-25 | Surveys | Used rarely |
| DF-26 | Load board / booking loads | That's for outside carriers (J.B. Hunt's Carrier 360); our loads come from McLeod dispatch |
| DF-27 | Maintenance schedule | Belongs to the shop and maintenance pages; DF-11 covers breakdowns |

## Not features, but they decide when any of this reaches a driver

- **Q-5 (McLeod register):** convert the Apple account to Organization and file the store listings. Until
  then, no driver has the app on their phone.
- **Driver release workflows** need "Approve and run" on GitHub for each push.
- **McLeod writes:** the "API" rows wait on McLeod (`/ws` on 22.1), a test company and Lockwood's written OK. Every
  "Now" row can be built without them.

## Owner ruling 2026-11-23: first scope

"Leave drivers' payments and other finance things for now. We need **loads pages, the stop form,
the scanner, images, and in-app navigation**."

- DF-17 (pay) and DF-22 (advances) are **out**.
- **First build:** DF-1–DF-7 (loads pages, the stop form, photos), DF-5/DF-14 (scanner and images) and DF-21 (in-app navigation).
- Every other row keeps its default from this page until the owner rules on it.
- Navigation analysis: `IN-APP-NAVIGATION-ANALYSIS.md`, next to this file.

## Owner observation 2026-11-23: notification settings sit with messages

The owner noticed notification settings and messages appear on the same page.

**What the app does today** (`origin/main`, read 2026-11-23):
- `More › Work` lists **Messages** and **Notifications** as two rows next to each other.
- The **Notifications** screen holds the inbox ("Recent") **and** the on/off switches ("Preferences").
  One of those switches is labelled "Messages" (`message_received`).
- This was deliberate in Direction B: Q-DB4 kept the inbox and preferences on one screen and noted
  "split later".

**Proposal (Q-DF-7):**
- Split them.
- **Notifications** becomes an inbox only, reached from a bell on Today.
- Its switches move to **Me › Settings › Notifications**.
- **Messages** is its own tab (DF-8).
- Rename the "Messages" switch to "New message alerts", so it can't be confused with the Messages page.

Recommend **Yes**. **RULED YES 2026-11-23** ("lets split now"), built as PR #2618.
