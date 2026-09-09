# The I6 spike, and the two sentences still owed — a runbook

**Written 2026-09-09, as part of the I0–I9 close-out.** Everything buildable in I0–I9 is merged.
What is left needs a person with a phone, and this page exists so that person spends twenty minutes
rather than an afternoon working out what to do.

Three things are owed. **A1 and part of A2 gate I6's scanner**; the third closes I9. They are
listed in the order they can be done, not in plan order — A1 needs a printer and a phone, and
nothing else.

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
