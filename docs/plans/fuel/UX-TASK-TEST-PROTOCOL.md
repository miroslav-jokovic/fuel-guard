# Fuel screens: ordinary-user task test (protocol)

Source: the 2026-10-03 design verdict (`DESIGN-IS-2026-10-03/03-verdict.md`, "Release acceptance"). This is the protocol the
verdict asks for. It is a protocol, not a result: **no session has been run**, and nothing below is evidence about users.

## What it decides
Whether fleet-office staff who know trucks, fuel invoices and dispatch, but not this product's algorithms, can use Fuel Costs,
Buy discipline, Idling and the findings inbox unaided. It does not replace the engine gate (IE5b); do not use it to relax that.

## Participants and setup
- **Five** representative office users (the verdict's number: a first round, not statistical proof). Prefer people who have
  not used the redesigned screens; record role and years in the job, nothing identifying beyond that.
- A production-equivalent signed-in session with real September data (the verdict's September figures: spending +14.1%,
  gallons nearly flat, average price +14.4%), on a desktop browser at 1366x768, and the same tasks repeated on a phone.
- The facilitator does **not** teach the interface first, does not explain any label, and does not answer "what does X mean".
  Allowed: "what are you thinking?", "what would you do next?". Screen and audio recorded with consent.

## Tasks (read aloud; one at a time; stop a task at 3 minutes)
| # | Task | Done when the participant has... |
|---|---|---|
| T1 | "Find how much was spent on fuel in September." | named the spend figure for Sep 1-30 |
| T2 | "Tell me in your own words why it went up." | said spend rose, gallons were about flat, price per gallon rose (not a cause claim) |
| T3 | "Find one thing here you would look into first, and open it." | reached an item in the open-findings strip or Buy discipline and opened evidence |
| T4 | "Is the dollar figure you just opened measured, or an estimate? How can you tell?" | answered correctly from what the screen says (coverage, 'at least', 'not added up') |
| T5 | "Narrow this to truck 701, then give me a PDF of exactly that." | scope visibly narrowed AND the exported file's letterhead shows the same days and truck |
| T6 | "Someone asks whether idling is costing you money. Where would you look, and what would you say?" | found Idling and said avoidable vs total correctly, without calling all of it savings |

## Recorded per task (one row each)
completed unaided / completed with a hint / failed; time; **every wrong interpretation, quoted**; the label they hesitated on;
any assistance given and exactly what was said; any place they looked for something that was not there.

## Also checked in the same sessions (the verdict's list)
date-preset length (Last 7 days is 7 dates), filter-change and pagination reset, an auxiliary feed failing (page says
"couldn't load", never "none"), loading and stale-period states, keyboard-only completion of T3 and T5, narrow-screen cost
visibility, and the export while a state/location/network filter is on.

## Pass criteria
**Proposed defaults, for the owner to set after round one** (the verdict: "set explicit comprehension and completion criteria
with the owner after the first round"): at least 4 of 5 complete T1, T2, T5 unaided; at least 4 of 5 answer T4 correctly;
no participant reads an unadded estimate as money saved (T3/T4/T6); no task needs a hint from more than one participant.
Any wrong interpretation seen twice is a copy or layout defect to fix and re-test with new participants, not a participant error.

## Output
A one-page summary per round: criteria and result, the quoted wrong interpretations ranked by how many participants made them,
what changed as a result, and what the next round must re-check. Append to the plan's progress log, dated.
