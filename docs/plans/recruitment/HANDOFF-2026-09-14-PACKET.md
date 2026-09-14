# Handoff — A2 is green, and the packet is the work now

**Supersedes `HANDOFF-2026-09-14-WORDING.md`** for the top of the queue. That document is still right
about P12 and the cross-match; it is wrong that nobody has walked the flow. Somebody has.

`main` `04c9dc6`. Seven PRs merged this session, nothing open, no migration.

---

## 1. ⚠ A2 IS GREEN — the first application was filed 2026-09-14

```
18:06:11  consented_at            15 U.S.C. 7001(c) gate, first human ever through it
18:06:35  releases_completed_at   four signatures
18:10:17  review_requested_at     handed to the office
18:10:54  approved_at             office approved
18:12:51  submitted_at            certified and filed
```

`driver_applications` = **1**. Four `driver_authorizations`, **`psp` on `fmcsa-2016-02-11`** — FMCSA's
mandated text, not a placeholder. Every one of those five stamps was a code path that had never run
for a real person. **B, C and D are unblocked.**

⚠ The evidence lives on driver `16045e32-25bc-4b11-8740-a080cbb5ccbf`, invitation
`d61557dc-de51-4071-aa20-352fe2cb9dc4`. `driver_applications` refuses DELETE (0220). Do not try.

---

## 2. What the owner actually wants, in his words

> *"When driver fills out the application link and sends it back we review it as this PDF form, and
> resend it to the driver for signing — the driver needs to be navigated precisely from place to
> place and sign all places. Similar to DocuSign."*

> *"The only critical part is previous companies he has worked and they usually don't remember
> companies or dates, so we can go together and update this."*

Sequence: send link before the office visit → driver fills it remotely → **go through it together in
the office, fixing employment** → approve → driver signs → packet joins the DQF.

**Steps 1, 2, 5 and 6 already work** (proved above). Step 3–4's blocker was fixed this session.

---

## 3. ⚠ THE ARCHITECTURE DECISION THAT CHANGED EVERYTHING

The previous approach REDREW the carrier's 31 pages in PDFKit. That is why the owner got a 12-page
§391.21 summary that "looks nothing like our application".

**The carrier's own PDF is the template.** `pdf-lib` (already a dependency) loads
`Application 11.pdf` and draws values on top. The form is not a reproduction that drifts — it IS
theirs, letterhead, tables, `reisdency` and all.

Coordinates are **measured, not guessed**: rasterise at 72dpi (1px = 1pt), find ruled lines as
contiguous dark runs, pair each with the label to its left, draw the value 3pt above its rule.
**274 fillable segments located across all 31 pages.** Page 1 is mapped and rendered with Marija's
real data; it is right.

⚠ `renderPacket.ts` was **never wired in** — its only importer is its own test. `file.ts` calls
`render.ts`. That is the whole reason the packet work never reached a PDF anybody opened.

### The two source files
`Application 11.pdf` (31pp, Excel print) is the **TEXT AUTHORITY** — lossless.
`APPLICATION.pdf` (93pp, Numbers) is **content only** — it drops `fi`/`ti`/`ffi` ligatures
(`quali ed`, `no ca on`, ~65 fragments) and spills wide tables onto pages 32–93. Verified same
document: every apparent difference resolved to ligature loss, repeated footers, or reflow.

---

## 4. Decisions taken this session

| | |
| --- | --- |
| **D-PKT11** | The carrier's text prints **exactly as written, typos included** — reverses D-PKT9. All 14 repairs reverted; `CORRECTIONS`/`correct()` deleted. ⚠ Carve-out: Numbers' dropped ligatures are NOT reproduced — they are export damage, not the lawyers' words. |
| **D-PKT12** | **Page 17 is a SPLIT page.** Its top half is the applicant's certification + history-inquiry authorization; its bottom half (`INTERVIEW NOTES`, `APPLICATION RESULTS`) is the carrier's. §2.4 had excluded the whole page from a reading of the bottom half. **Driver marks 21 → 22, across 19 pages.** Second page classified by one of its halves, after p24. |

⚠ **§2.5 is new and is the general lesson:** `packetPlacements.test.ts` already asserted *"leaves no
mark line on a rendered page unclaimed"* and could not see p17, **because an excluded page is not a
rendered page**. A guard scoped to the output cannot catch an error in deciding what the output
contains. The scan that does catch it runs against the CARRIER'S paper.

---

## 5. The queue, in the owner's order

1. ~~**Add an employer the applicant left out**~~ — **DONE** (#778). No endpoint, no migration:
   `applicationPathSchema` already took `["employers", N]` and `withValueAt` already extends an array.
   ⚠ **Appends only** — `application_edits` stores an index-addressed path, so a splice re-points every
   recorded correction. Removal is **Q-AX7**.
2. **The signing ceremony over the 22 driver marks** — stop to stop, one instrument per screen,
   signatures and initials, progress visible. Coordinates exist for every mark.
   ⚠ **Open question for the owner: typed name applied to all 22 stops, or a drawn signature at each?**
   Recommendation: type once, apply to all, each stop showing what is being agreed.
3. **Send-for-signing with chosen timing** — generalised so the **seven-day statement** uses the same
   machinery. Today `SevenDayStatementSection.vue` is a TRANSCRIPTION surface ("Record one from the
   paper the driver signed") on the driver's page, deliberately — it refuses to let an office user
   sign for a driver. Making it a real signing flow is (2) pointed at one instrument.
4. **Fill pages 2–31.** Only **2, 12, 15 and 16** carry data; every other page is signature-only.

---

## 6. Traps this session found

- ⚠ **No wizard gap after all.** I twice claimed education and three references were not collected.
  `questionnaireContract.ts` defines all nine carrier questions including both, and
  `QuestionnaireTable.vue` renders tables. They are **optional** — there is deliberately no `required`
  flag — so Marija left them blank and page 16 would print empty. **Owner decision needed.**
- ⚠ **Brevo keeps every emailed invitation link in its click-tracking log.** A live token was read out
  of `GET /v3/smtp/statistics/events` and its SHA-256 matched `token_hash` exactly. Cannot be disabled
  below Enterprise. `env.ts` now prefers Resend and warns on every boot that lands on Brevo (#774).
  **A1: verify `silvicominc.com` at Resend, not Brevo.**
- ⚠ **`opened` never fires for any `@silvicominc.com` address** — their gateway strips the pixel — and
  every link is machine-clicked within ~15s of delivery. **"delivered" is evidence, "clicked" is not.**
- ⚠ **Four duplicate `Marija Varmeda` rows**, one per invitation. The board's only invite action always
  creates a driver; the correct re-invite path is on the driver's own page. **Q-AX6.**
- ⚠ **Every applicant in the org is archived**, so the applicants board is legitimately empty. The
  endpoint supports `?archived=true`; whether the page exposes a toggle is unchecked. Archiving may be
  a one-way trip from the only screen that lists applicants.
- ⚠ **Run all 29 gates before pushing.** `lint:tokens` failed CI on invented class names
  (`rounded-lg`, `border-line`, `text-danger`). Real ones: `rounded-surface border border-edge`; put
  field errors on `FormField`'s `error` prop rather than colouring a paragraph.
- ⚠ `AppDateField` wraps `DatePickerBase`, not a native `<input type="date">` — `setValue` on an input
  silently does nothing, and the test fails as "no request was made".

---

## 7. Owner actions

1. **A1 at Resend** (domain added to Brevo 2026-09-14 17:03, still `authenticated: false`).
2. **Decide:** typed vs drawn signatures for the ceremony (§5.2).
3. **Decide:** should page 16's education/references be required (§6)?
4. **A3 is still unexercised** — Marija filed with **zero** document captures, so phone capture has
   never run.
