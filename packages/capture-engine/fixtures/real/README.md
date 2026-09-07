# Real captures — the shot list, and the rule about what may be committed

**Step 0.1 of `docs/plans/drivers-app/SCANNER-UPGRADE-PLAN.md`.** This directory receives
photographs taken during the device session. Read the rule before taking any.

---

## The rule: this repository is PUBLIC

A photograph of a genuine bill of lading carries shipper and consignee names, addresses, load and
seal numbers, driver signatures, and sometimes UN numbers tied to a named customer's cargo. **It is
PII and it may never be committed here.** This is the same rule that gitignores `docs/psp-docs/` and
`docs/McLeod-Testing/`, and for the reason those entries record in full: between 2026-08-21 and
2026-08-24 a live credential sat readable on `origin/main`, and untracking it later did not remove it
from history. Rotation was the mitigation; the ignore entry only stopped it recurring.

So there are two kinds of photograph and they are handled differently:

| What you photographed | Where it goes | Why |
|---|---|---|
| A **printed target sheet** (`../targets/*.png`) | Committed, in `sheets/` | Our own artwork. No PII exists in it, so it can be a permanent, re-runnable benchmark. |
| A **real customer document** | `private/` — **gitignored, never committed** | PII. Only measurements derived from it may ever be committed, and only once measurement exists (Phase 2.1). |

`private/` is ignored by `.gitignore` before any photograph exists, deliberately: an ignore rule
added after the first accident is not a rule, it is a postmortem.

If you are unsure which kind you have, it is the second kind.

---

## Before the session

1. Print **both** sheets from `../targets/` on plain white A4, at **100% / actual size**. Not
   "fit to page" — any scaling changes every printed dimension the sheets are labelled with, and the
   labels are the entire point.
2. Check the print: the `002` line-pair block should show visible stripes, and the `014PX` ladder row
   should be readable with the naked eye at arm's length. If either failed, the printer is the
   limiting factor and every measurement afterwards is measuring the printer.
3. Record the printer make and the paper in the session note. A matte laser and a glossy inkjet do
   not reflect a cab light the same way.

---

## The shot list

Two sheets × the conditions below. **Shoot both sheets in each condition** — sheet A gives you the
optics and the tone, sheet B gives you the legibility limit, and a condition where they disagree is
the interesting one.

Take every shot **twice**: once through the app's scanner (More → Hazmat checks → Capture BOL) and
once with the phone's own camera app at full resolution. The app's copy is what the pipeline
actually sees; the camera app's copy is the control that tells you whether a problem is the pipeline
or the phone.

| # | Condition | How |
|---|---|---|
| 1 | Baseline | Flat on a desk, even indoor light, phone parallel to the sheet, filling the frame |
| 2 | Cab daylight | On the passenger seat, daylight through the windscreen |
| 3 | Cab at dusk | Same position, dome light only |
| 4 | Dashboard | On the dashboard, direct sun if available |
| 5 | Windscreen glare | Angled so a reflection lands on the sheet |
| 6 | Hand shadow | Your own hand or the phone shadowing part of the sheet |
| 7 | Angled 20° | Tilted about twenty degrees off parallel |
| 8 | Angled 40° | Tilted about forty degrees — past what perspective correction should accept |
| 9 | Handheld, moving | Walking pace, no attempt to steady |
| 10 | Low light | The darkest condition a driver would plausibly still try |
| 11 | Dark surface | On a black seat or a dark floor mat |
| 12 | Too close / too far | One filling only a third of the frame, one cropped at the edges |

That is 12 conditions × 2 sheets × 2 capture routes = **48 photographs**. It is more than it sounds:
budget an hour, and do it in one sitting so the print and the phone do not change underneath you.

---

## What to record for each shot

A photograph with no note attached is an anecdote. Alongside each file, record:

- the condition number above,
- which sheet (A or B),
- which capture route (app scanner / camera app),
- the phone model and OS version,
- anything the app said — especially a rejection and its exact wording.

**And the one thing the whole session exists to answer** (`SCANNER-UPGRADE-PLAN.md` §6 Q5): for the
app-scanner shots, which provider actually ran — `capture.native.system_scanner` or
`capture.js.expo_image_picker`. Nothing in the repository establishes that the native module has ever
run on a device, and Phase 1's starting point depends on the answer.

---

## Naming

```
sheets/<condition>-<sheet>-<route>-<device>.jpg      e.g. 05-glare-a-scanner-pixel6a.jpg
private/<anything>                                    never committed
```

---

## What happens to them next

Nothing automatic yet, and that is deliberate. Measuring a photograph needs the metric
implementation, which is **Phase 2.1** (`src/metrics.ts`) — it does not exist as this is written, and
a tool that measured these with some other arithmetic would produce numbers that do not correspond to
anything the scanner will ever compute.

So: take the photographs, keep them, record the notes. When Phase 2.1 lands, the same reference that
the server and both native implementations use will measure this set, and the results become the
device-class calibration input for Phase 5.2. Committing the photographs of the target sheets now
means that measurement can be re-run against an unchanged subject for as long as the sheets exist.
