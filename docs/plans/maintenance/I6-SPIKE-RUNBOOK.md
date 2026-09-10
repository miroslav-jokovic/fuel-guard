# The I6 spike, and the two sentences still owed — a runbook

**Written 2026-09-09, as part of the I0–I9 close-out.** Everything buildable in I0–I9 is merged.
What is left needs a person with a phone, and this page exists so that person spends twenty minutes
rather than an afternoon working out what to do.

Three things are owed. **A1 and part of A2 gate I6's scanner**; the third closes I9. They are
listed in the order they can be done, not in plan order — A1 needs a printer and a phone, and
nothing else.

> **⚠ AMENDED 2026-09-10, AFTER PR #711 — READ THIS BEFORE THE SECTIONS BELOW.**
>
> The sentence above — "A1 and part of A2 gate I6's scanner" — was true when it was written and is
> now only half true, and the half that changed is the important one. **The shop can scan today.**
> `/shop/scan` shipped in #711 on a **Bluetooth HID scanner**, which is a keyboard: it pairs in iOS
> Settings, types the barcode and an Enter, and needs no camera permission, no WebAssembly and no
> A1. The owner ordered handheld imagers on 2026-09-10.
>
> So **A1 now gates the CAMERA half of I6 and nothing else.** §1 below is unchanged and still
> correct — it is still the twenty minutes that decide whether the camera is built on the free
> decoder or on a paid web SDK (D-INV28's revisit clause). What changed is its urgency: nothing the
> shop does day to day is waiting on it any more.
>
> **§0 is new and comes first**, because the hardware is arriving and its checks take fifteen
> minutes. It is numbered zero rather than renumbering §1–§3, because this document's §1 is cited by
> name from `INVENTORY-PLAN.md` §8 and a citation that silently moves is worse than an odd number.

---

## 0. The handheld scanners, the day they arrive (15 minutes, at the receiving desk)

**⚠ These checks do not GATE anything — the path is live.** They close the one assumption its
implementation wrote down rather than assumed, and they confirm this particular model behaves the
way its class is documented to. Do them the day the boxes are opened, not later: every answer below
is cheap now and expensive to reconstruct from a complaint in three weeks.

### Before you start

Pair the scanner: **iOS Settings → Bluetooth**. It should appear and connect as a **keyboard** — if
it offers itself as anything else, it is not in HID mode and its manual has a configuration barcode
to put it there. Then open **Shop → Scan** on the phone.

Have to hand: a printed `SIL1:BIN:…` label if §1's sheet exists yet, and **any supplier carton with a
UPC on it**. Either one exercises the whole path; the carton is the more interesting.

### The one that actually matters

- [ ] **Does a scan reach the page when nothing on it is focused?** Open Scan, **touch nothing**,
      and pull the trigger. Does the item appear?

  **Why this is the question.** The capture is a `document` keydown listener rather than a
  permanently focused hidden input — the hidden input was rejected because it fights every other
  control for focus, raises the soft keyboard on a phone with no scanner paired, and makes "scan
  while a result is on screen" depend on focus surviving whatever was last touched. **But iOS is
  documented as inconsistent about delivering hardware-keyboard events to a page with no focused
  element**, and that is the single thing in `useScanInput.ts` that a desk cannot verify. It was
  written down rather than assumed, and this line is where it gets answered.

  **If it fails, say so and stop worrying about it** — the fix is one line (focus the typed-entry
  field on mount) and nothing else in the file changes, because the timing rule does the work
  either way.

- [ ] **Repeat it installed to the home screen** (Share → Add to Home Screen, open from the icon).
      Standalone mode is a different WebKit path and has its own history of surprises.

### The rest, in the order you will hit them

- [ ] **Does the on-screen keyboard come back?** With the scanner paired, tap the **"Type a code"**
      field at the bottom. A paired HID keyboard makes iOS hide the soft keyboard, so it probably
      will not appear. **Double-press the scanner trigger.** Does it appear then? That is the
      documented toggle and the screen's hint says so; confirm it is true of this model.
- [ ] **Does the Enter suffix arrive?** If the item appears the instant you scan, it does. If there
      is a beat of about a fifth of a second first, the suffix is switched off on this unit and the
      idle flush caught it — **not a fault**, but worth knowing, because it is otherwise
      indistinguishable from a slow network.
- [ ] **One label, one sheet.** Hold the trigger down, or leave the scanner in its cradle pointed at
      a label. Does the item open **once**, or over and over? Once is the 800 ms same-symbol window
      doing its job.
- [ ] **A greasy supplier UPC.** Smear a thumbprint on the carton's barcode and scan it. **This is
      A1's hard half, answered by hardware instead of by WebAssembly** — a dedicated imager is
      exactly what the free decoder's measured 10.2 % on out-of-focus 1D is bad at. If it reads
      reliably here, the camera's UPC risk stops being a workflow risk and becomes a convenience one.
- [ ] **Sleep and come back.** Lock the phone, wait five minutes, wake it, scan. Does it reconnect
      on its own? This is the flakiest area in this price bracket and the difference between a tool
      and a nuisance.
- [ ] **Issue something.** Scan a bin, tap **Issue**, fill it in, save. Then — with the form still
      open on a different scan — confirm a stray trigger pull does **not** change the item under it.

### What to send back

The seven answers, and one sentence with your name — the same shape §3 asks for. For example:

> *Paired as a keyboard first try. Scans land with nothing focused, in Safari and installed.
> Double-press brings the keyboard back. Greasy UPC read every time. Reconnected after ten minutes
> asleep. — Miki, 2026-09-11*

---

## 1. A1 — does the free decoder read our labels? (20 minutes, at a desk)

**Why it gates anything.** D-INV23 already RULED the decoder: `vue-qrcode-reader` on
`barcode-detector`/`zxing-wasm`, self-hosted. So this is not a choice — it is a verification, and
its one real outcome is whether D-INV28's revisit clause fires (a paid web SDK, Scandit first).
Building the camera screen before it would mean building to a result nobody has.

### What to print

A single sheet, from the `/shop/labels` screen once I10 ships — **or, today**, from any label
generator that can produce a QR at **ECC-H** on a **1-inch** square, encoding exactly:

```
SIL1:BIN:7K3M9P
```

Print it at 1 inch and again at 0.75 inch. `@silvicom/qr` measured both real payloads as a
**version-2 (25×25) symbol at ECC-H — about 0.77 mm per module at 1 inch**, against a phone camera
floor of roughly 0.4 mm, so the 1-inch label should have margin and the 0.75-inch one is the
interesting case.

Also grab **any supplier carton with a UPC on it** — a filter box, a case of oil. Smear a thumbprint
of grease on one corner of it. That is not a joke: §2.10's whole worry is 1D codes on cartons that
have been handled.

### What to do, on each of three devices

| # | Device | How |
|---|---|---|
| 1 | An iPhone | Safari, straight to the URL |
| 2 | **The same iPhone** | Installed to the home screen ("Add to Home Screen") |
| 3 | An Android | Chrome |

> **⚠ Added 2026-09-10: "the scan surface" below does not mean `/shop/scan`.** That screen exists now
> and has **no camera on it** — #711 shipped the hardware-scanner path only. So this section still
> needs something to point a camera through, and the two honest ways to get one are worth naming
> rather than leaving to whoever picks the page up:
>
> - **The device facts** — permission prompts across a route change, torch, what happens after
>   backgrounding — are properties of iOS and not of our code, and can be measured on **any** public
>   WASM barcode-scanner demo opened on the same phone. That is most of the checklist and it costs
>   nothing to set up.
> - **The decode-rate facts** — 1 inch, 0.75 inch, the greasy UPC — are only meaningful against
>   **our** decoder at **our** settings, which means the camera layer has to exist first, behind a
>   flag. Build it with a diagnostics panel (decode latency, capability dump, prompt counter, the
>   last twenty reads) so this session produces numbers rather than impressions.
>
> The greasy-UPC answer is also obtainable a third way, and sooner: **§0 asks a hardware imager the
> same question.** A confident "the handheld reads it every time" does not tell you what the WASM
> decoder will do, but it does tell you the shop is not blocked either way.

On each, open the scan surface and record:

- [ ] **Does the printed 1-inch QR decode?** Yes / no. How many seconds.
- [ ] **Does the 0.75-inch one?** Yes / no.
- [ ] **Does the greasy supplier UPC decode?** Yes / no. This is the one most likely to fail.
- [ ] **How many camera permission prompts** across a route change — open the scanner, navigate
      away, come back. WebKit bug 215884 says an installed app re-asks every time, which is the
      whole reason D-INV17 keeps the scan flow on one route. **Confirm or refute it.**
- [ ] **Is there a torch?** (`getCapabilities().torch`) Yes / no.
- [ ] **What happens after backgrounding** — switch apps, come back. Does the camera resume?

### What "pass" means

All three devices decode the 1-inch label and the greasy UPC. **If the UPC fails on any device,
D-INV28's revisit clause fires** and I6 is re-planned around a paid web SDK before the screen is
built — which is exactly what this twenty minutes is buying.

---

## 2. A2's remaining half — the bay wifi (10 minutes, in the shop)

The shelving half is answered and closed: **there are no shelf numbers** (§1.4), and the owner ruled
on 2026-09-09 that a shelf count is optional for this shop for the same reason.

What is left is one question, and it decides how hard the offline queue has to work:

- [ ] **Stand where the shelves are.** Bars of signal? Wifi or cellular?
- [ ] **Walk to the far end of the bay** — behind a container, beside a trailer. Does it drop?
- [ ] **Roughly how long does it stay dropped?**

`countQueue` already writes to the phone before the network is touched, so a bad answer is not a
blocker — it is the difference between a queue that is theatre and a queue that is the feature.

---

## 3. I9's usability sentence — an eight-item trailer check (15 minutes, in the yard)

**This is the last thing standing between I9 and closed.** The done-when is:

> an eight-item trailer check completes on a phone with one thumb — named person, §8

### Before you walk out

1. Open **Assets → the gear ("Kinds of thing")** and press **Set it up**. That creates the twelve
   kinds and the kit each unit carries — the lists approved on 2026-09-09.
2. Add a few real assets against a trailer (Assets → New asset, place it on the unit), enough that
   the trailer has something to find. Eight items is what the sentence asks for.

### The walk

Open **Units → the trailer → Check this unit**, put the phone in one hand, and walk it.

- [ ] Did every item fit under one thumb? No pinching, no two hands.
- [ ] Did "It's here" / "Not here" land where you expected without looking twice?
- [ ] Did the "One turned up" list find a thing recorded somewhere else?
- [ ] At review — were Missing and Short the rows you would act on?
- [ ] Did closing say clearly that it cannot be undone?

### What to send back

One sentence, and your name. For example:

> *Walked eight items on T-4102 on a phone in one hand, blind, 4 minutes, buckets right at review.
> — Miki, 2026-09-10*

That line goes into the plan's §8 verbatim and **I9 closes**.

---

## What is NOT on this list, and why

- **I5's 20-bin shelf count** — retired by the owner's ruling of 2026-09-09: the shop's shelves are
  not marked, so a bin-by-bin walk is not this shop's workflow. §1.4 had already measured it. The
  count session itself still works; it walks the parts at a location. **I5 is closed.**
- **A5** (the label printer and stock) and **A6** (FleetPal work orders) — both real, both owned by
  the owner, and both retired by **I10** and **I14** rather than by anything in I0–I9.
- **Anything that would let the shop start scanning** — that is done, as of #711, and §0 is a
  confirmation rather than a gate. The distinction matters for whoever reads this page cold: if the
  scanners are paired and Shop → Scan resolves a label, **nothing on this list is standing between
  the shop and its inventory**. What is left decides how the CAMERA gets built (§1), how hard the
  offline queue has to work (§2), and whether I9 can be marked closed (§3).
