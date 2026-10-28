# Printers and scanners on any device, chosen once in Settings (2026-10-28)

**Status: PLAN — waiting on the owner's answers to Q-PS1 and Q-PS2 (§5).** No code yet.

**What the owner asked for (2026-10-28).** Printers and scanners are *set up in Settings*. Once a
printer is set, **it is the default and printing never asks which one** unless Settings changes.
There can be **more than one** printer and scanner. **It must not matter which operating system or
device** a person uses. Everything happens **in the browser, in our system** — no third-party app on
anyone's phone, tablet or computer. The hardware is **already bought and stays**: a MUNBYN RW403B
label printer and a Tera Pro scanner (`DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md` §1.1).

This plan replaces the print half of `I6-SPIKE-RUNBOOK.md` §0a ("Print one label (office PC)"),
which is the model the owner rejected: a browser print dialog on a computer the printer is plugged
into. The scan half of §0a stands (§3).

---

## 1. Why what is built cannot meet it

Today the Labels screen builds a PDF and opens the **browser's print dialog**
(`apps/web/src/pages/LabelsPage.vue`, `apps/api/src/modules/maintenance/inventory/labelPdf.ts`).
That has two properties no amount of polish removes:

1. **A web page can never choose a printer or print without the dialog.** No browser offers it, on
   any operating system — it is a security boundary, not a missing feature. So "set once in Settings,
   never asked again" is impossible on the dialog path, by construction.
2. **Only a computer with the printer's driver can print.** An iPhone or an Android tablet has no
   MUNBYN driver and no way to reach a USB printer; a Bluetooth printer pairs with one device.

So the honest fix is not a better dialog. It is **our server sending the job to the printer**: the
person presses Print on any device, the server knows which printer is the default, and the label
comes out. The device in the person's hand stops mattering, which is exactly the requirement.

## 2. Measured facts about the hardware (2026-10-28)

| Fact | Source | What it means |
|---|---|---|
| The RW403B connects by **USB and Bluetooth only** — no Wi-Fi, no Ethernet. | munbyn.com product page; RW403B manual | Our server cannot reach it on its own. **Something always on must sit next to it** (§4, the print station). |
| It speaks **TSPL**: its USB device id reports `CMD:TSPL`; it is a plain USB printer-class device (bulk OUT 0x03). | `m0n01d/munbyn-print` (tested on the hardware) | We can send it **raw bytes**. No driver, on any box. |
| Its firmware honours only a **subset** of TSPL: `SIZE`, `GAP`, `REFERENCE`, `OFFSET`, `DENSITY`, `SPEED`, `DIRECTION`, `CLS`, **`BITMAP` (mode 1)**, `PRINT`. `TEXT`, `BAR`, `QRCODE` and `GAPDETECT` are **silently dropped** — a job using them prints nothing. | same | **The server draws the whole label as one bitmap** — QR modules from `@silvicom/qr`'s matrix, and the unit/asset number and code in a bitmap font — and sends `BITMAP`. Never the printer's own text or QR commands. Calibration is the feed button, once per roll. |
| Raw printing needs no CUPS driver; official MUNBYN drivers exist for Windows and Mac only. | MUNBYN support; TSPL CUPS projects | The print station needs **no MUNBYN software at all**. |
| The Tera Pro is a **keyboard (HID)** on every connection — dongle, Bluetooth, cable. It has no network mode. | §1.1 of the equipment plan | See §3: nothing to "find on the network"; it already works in every browser. |
| Browser access to devices: WebHID / WebUSB / Web Bluetooth exist **only in Chromium** (desktop; Android partly) — **never Safari or iOS**. | caniuse | A design that talks to devices *from the browser* would make the device matter. Ruled out (D-PS1). |

## 3. Scanners — already device-independent; what Settings adds

A handheld scanner is a keyboard for whichever device it is paired with. That is why `/shop/scan`
(#711, `useScanInput.ts`) already works **in the browser on Mac, Windows, iPhone and Android with no
app**, and why **any number of scanners** work — each one pairs with its own device. Warehouse
systems work the same way; no web system "selects" a handheld scanner, because a browser cannot list
keyboards on any platform.

What Settings honestly adds, so the owner's "set it up once" holds for scanners too:

- **Settings → Devices → Scanners → "Test this device".** Scan a printed test label; the screen
  says *Works*, or names the exact fault — chiefly a **non-US keyboard layout**, which turns the
  colon in `SIL1:AST:…` into another character (the one setting that silently breaks scanning,
  runbook §0a). Per-OS instructions for pairing sit beside it.
- **A record of the scanners the shop owns** (name, where it lives, which device it is paired to) —
  an ordinary truck-inventory asset with a tag, not a new kind of thing.
- **Later, not now:** the phone's camera as a scanner when no handheld is near (A1 of the runbook).

## 4. Printers — the design

```
 any device, any browser                our API (AWS)                       the shop
 ──────────────────────                 ─────────────                       ────────
 Print ─────────────► POST /print-jobs ─► print_jobs (queued) ◄── outbound ── print station ── USB ── MUNBYN
                      (printer = default)  │                     connection   (small always-on box)
 "Printed ✓" ◄──────── job status ◄────────┘ ◄──── done / failed ───────────┘
```

- **Print station** — a small always-on box beside the printer, running **our** program (one
  program, ~a few hundred lines: claim a job, write its bytes to the USB printer, report the
  result). It connects **out** to our API, so nothing is opened on the shop's firewall and it works
  behind any router. It is installed once by us, not by the people who print.
- **Printers in Settings** — each printer belongs to a station, has a name ("Shop label printer"),
  a model (which decides the language: TSPL for the RW403B; ZPL later for a Zebra) and its label
  stock (2" × 2"). Online/offline is shown from the station's last check-in.
- **The default** — one per **location**, and a person may override it for themselves. Print
  buttons send to the default **without asking**. The dialog appears only when no printer is set up
  at all, and then says so.
- **Every job is a row** — queued → printing → printed / failed, with the reason. A failed label is
  never silent: the person sees "Shop label printer is offline — Retry". A retried tap never prints
  twice (a client-generated job id, the D-INV27 rule).

## 5. Decisions

| # | Decision | Why |
|---|---|---|
| **D-PS1** | **The server prints; the browser never talks to a device.** | Only this is the same on every OS and device (§1, §2's last row). |
| **D-PS2** | **The label is rendered on the server as a bitmap in the printer's language** (TSPL `BITMAP` for the RW403B), from the same geometry and QR matrix the PDF uses. | The firmware drops everything else (§2); one renderer keeps PDF and printer labels identical. |
| **D-PS3** | **A printer is a row with a language**, so a second printer — or a Zebra later — is a setting, not a release. | The owner: "not tied to one scanner or printer". |
| **D-PS4** | **Default per location, overridable per person; no prompt while a default exists.** | The owner's rule. |
| **D-PS5** | **The PDF + dialog path stays, labelled as the fallback** for a place with no station. | It is the only path that needs nothing installed; removing it would strand a site. |

## 6. Steps

- **PS1 — schema (migration, new tables, RLS on, no client policies):** `print_stations`
  (org, name, location, a hashed station token, last seen), `printers` (station, name, language,
  label stock), `print_defaults` (org + location, or a person), `print_jobs` (printer, payload
  bytes or a reference, status, attempts, error, client id unique). Matrix: defaults resolve
  person → location; another org's printer is refused; a job claimed once.
- **PS2 — TSPL renderer + job API:** `renderLabelTspl(label, stock)` in `packages/qr` (pure, golden
  byte tests against the PDF geometry); `POST /print-jobs`, station endpoints claim / done / failed
  with the station token; the Labels screen and "Print label" send to the default.
- **PS3 — the print station program** (`tools/print-station/`): Node, runs as a service, pairs with a
  one-time code from Settings, writes to the USB printer, survives reboots and unplugging.
  **Done when (a person):** a label pressed on an iPhone prints on the MUNBYN with no dialog.
- **PS4 — Settings → Devices:** Printers (add, rename, test page, online, default), Scanners (test
  this device, per-OS pairing help).
- **PS5 — physical acceptance**, in the owner's order: Mac → Windows → iPhone → Android — scan on
  each, print from each.

## 7. Open questions

| # | Question | Candidates | Recommendation |
|---|---|---|---|
| **Q-PS1** | What is the print station? | (a) **A Raspberry Pi 5 (~$100 with case and power), plugged into the printer by USB, left on in the shop.** (b) The office Windows PC, if it is never switched off. (c) This Mac. | **(a).** A dedicated box nobody shuts down, updates or unplugs by accident; (b) works but printing stops whenever that PC sleeps or restarts. |
| **Q-PS2** | Whose program runs on the station? | (a) **Ours** (PS3). (b) PrintNode's client + their cloud ($9/month, 5,000 prints). | **(a).** The owner ruled out third parties; the job is small because the printer takes raw bytes and needs no driver. (b) is the fallback if PS3 slips. |
| **Q-PS3** | USB or Bluetooth between the station and the printer? | USB · Bluetooth | **USB.** Bluetooth printing drops when either side sleeps; the station never moves. |
| **Q-PS4** | How many printers, and where? | one shop · shop + office · more | Decides how many stations to buy; the design takes any number. |

## 8. Progress log

- **2026-10-28 — plan written** after the owner rejected the print-dialog model. Research: the
  RW403B is USB/Bluetooth-only and speaks a TSPL subset (bitmap only); browsers cannot select a
  printer; the scanner is already device-independent.

## Sources

- MUNBYN RW403B: https://munbyn.com/products/munbyn-rw403b-bluetooth-thermal-label-printer
- RW403B over USB, TSPL subset tested on hardware: https://github.com/m0n01d/munbyn-print
- RW403B CUPS driver (PPD from MUNBYN's macOS driver): https://github.com/surma-lodur/Munbyn-CUPS
- TSPL on Raspberry Pi: https://github.com/RunTheWall/tspl-cups-driver
- PrintNode on a Raspberry Pi: https://www.printnode.com/en/docs/remote-printing-with-raspberry-pi
- PrintNode pricing: https://www.printnode.com/en/pricing
- WebHID support: https://caniuse.com/webhid
