# Driver Qualification — redesign (2026-08-08) — **BUILT**

The surface shipped in DQ2 is correct and hard to use. This is why, and what replaces it.

## 1. What is actually wrong

**The gap and the fix are in different places.** The checklist knows "medical card, missing". The form
below it is a generic *add a certification* with a Type dropdown you must re-select. The system has
already answered the question and still asks it. That is structural, not cosmetic, and it is the
biggest single source of friction on the page.

**Eighteen flat rows flatten eighteen unequal facts.** An employment application from 2019 and a CDL
expiring Tuesday render identically. §391.51 genuinely has eighteen items and we cannot show fewer
without lying to an auditor — but we can rank and group them, so the screen answers *what do I do now*
before it answers *what does the regulation require*.

**The daily job has no screen.** A safety manager's actual morning question is "which qualification
items need attention across my fleet". The roster is alphabetical with a comma-list of issues, and
nothing in the product answers that question.

## 2. Decisions

**D-DQ6 · The entry point is a queue, not a roster.** Default tab **Needs attention**, one row per
(driver × requirement), sorted soonest-first. The queue supports independent inclusive ranges for
**Good until** and **Evidence date**; items with missing selected dates remain visible in a clearly marked
data-gap section. *All drivers* becomes the second tab rather than the default.

**D-DQ7 · The driver file is a page, not a drawer.** `/compliance/:driverId`. Eighteen requirements,
their documents, their history and eventually an export is a workspace, not a peek. This is the same
move Loads made with `DispatchLoadDetailPage`, and it is not a new nav section — it is the detail view
of a list that already exists.

**D-DQ8 · A complete group collapses to one line.** Five groups — Licence, Medical, Hiring file,
Recurring, Hazmat (only when the module is on) — each rendered as a summary card. Then **one** table,
defaulting to the items that need attention, with *Show all 18 requirements* revealing the rest. A
clean driver is a short page; a problem driver is a long one. Five stacked tables would be the same
density wearing a different hat.

**D-DQ9 · Every requirement fixes itself.** The action on a row opens a form already scoped to that
requirement: no Type dropdown, and only the fields that kind actually needs — a medical card asks for
an expiry, a road test asks when it happened. The generic CertManager stays for the carrier's own
records, where "add any certification" is genuinely the task.

**D-DQ10 · Upload-first.** A document can be dropped on the file before anyone records the
certification behind it, because that is the order the work happens in — the scan arrives, the data
entry follows. The requirement is chosen after the drop, not before. Deliberately building the
drop-then-classify shape now so that automatic classification later is a suggestion on an existing
flow rather than a rewrite.

**D-DQ11 · Copy McLeod's model, not its interface.** What it gets right: one place per driver,
organised by category, plus a fleet-wide expirations view. What is dated is the tabbed profile — and
tabs are actively wrong here, because they hide gaps, and not hiding gaps is this screen's entire job.
One scrolling page with a summary at the top.

**Deferred, deliberately:** the one-click audit binder (DQ4). It is what this module sells on, and it
is a document-assembly problem, not a screen. The grouping and ordering introduced here are §391.51
order precisely so that binder is later a renderer over an existing structure.

## 3. Shape

```
Driver Qualification                       ← existing nav item, existing route
├── Needs attention   (default)            ← queue: driver × requirement, soonest first, date ranges
└── All drivers                            ← the roster as it is today
        └── /compliance/:driverId          ← D-DQ7, the file
              ├── summary strip            ← state, counts, group cards
              ├── drop a document          ← D-DQ10
              └── requirements table       ← attention-first, "show all" toggle
                    └── SlideOver          ← D-DQ9, scoped to one requirement
```

## 4. Build order

1. **Shared** — `group` and `urgency` on the §391.51 catalogue; a `dqAttention` projection so the
   queue and the page rank identically.
2. **API** — `GET /api/compliance/overview`: run `buildDqFile` server-side for every driver, return
   per-driver state, counts and the items needing attention. One round trip, and the same function the
   driver page uses, so the queue and the file can never disagree.
3. **Web** — the queue tab, the driver page, the scoped requirement drawer, the dropzone.

Every screen against `docs/DESIGN-SYSTEM-CONTRACT.md`.


## 5. What shipped

- `dqCatalogue.ts` — the §391.51 vocabulary, split out of `dqFile.ts` when it crossed the 500-line
  budget. Split, not grandfathered: the catalogue is regulation and the builder is logic, so they
  change for different reasons. Every item now carries a `group`.
- `dqAttention` / `dqGroups` in `dqFile.ts` — one comparator for urgency, used by both surfaces.
  Expired ranks above missing above expiring, because a lapsed medical card grounds a driver today
  while a road-test certificate that was never filed has been absent for years and will keep.
- `GET /api/compliance/overview` — `buildDqFile` run server-side per driver. Four fleet-wide reads,
  not four per driver. Reports `truncated` rather than silently returning a partial picture.
- **Needs attention** is now the default tab; the roster is the second. The queue has independent
  Good until and Evidence date ranges. Dated matches appear first, while outstanding items missing a
  selected date remain visible in a clearly labeled data-gap section.
- `/compliance/:id` — the file as a page. Five group cards, then one table showing only what needs
  attention until you ask for all eighteen.
- `RequirementDrawer` — the form is scoped to the requirement. No Type dropdown, and only the fields
  that kind needs. The scan uploads BEFORE the record is written, so the record cites a document that
  exists rather than an id that may never arrive.
- `DqFilePanel.vue` deleted — superseded by the page, and leaving it would have left two answers to
  the same question in the tree.

## 6. Still open — **nothing; the binder shipped 2026-08-08**

The audit binder (DQ4) is built. The bet this plan made paid: because the grouping and ordering here
were §391.51 order, the binder's checklist and separators are a renderer over `buildDqFile` rather
than a second structure — the same function the queue and the driver page rank with. See
`DQ-BINDER-PLAN.md`.
