# Printers and scanners on any device, chosen once in Settings (2026-10-28)

**Status: BUILDING — Q-PS1 and Q-PS2 ruled 2026-10-28; PS1 + PS2 in one PR (§8).**
PS0 (the devices on Mac and Windows) runs in parallel with PS1–PS4.

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
| **D-PS4** | **Default per organization, overridable per person; no prompt while a default exists.** *Amended 2026-10-28 while building PS1: "per location" had nothing to stand on — the product has no office-location table (`terminals` was dropped in 0259), and inventing one for printers would be a second, printer-only idea of where people work. A person in the shop chooses the shop printer as their own default once; when sites become a real thing, a site default is one more `print_defaults` scope.* | The owner's rule. |
| **D-PS5** | **The PDF + dialog path stays, labelled as the fallback** for a place with no station. | It is the only path that needs nothing installed; removing it would strand a site. |

## 6. Steps

- **PS0 — the two devices on Mac and Windows, in parallel with PS1–PS4 (owner 2026-10-28).**
  On each computer: the printer by USB prints the driver's test page, then a label from
  `/shop/labels` through the dialog (the D-PS5 fallback, at 100 % on 2 × 2 in); the scanner by its
  dongle opens that label on `/shop/scan` with nothing focused. **Plus the D-PS2 spike on the Mac:**
  a whole label drawn as one TSPL `BITMAP` and sent raw (`lp -o raw`) must print and scan back —
  this proves the station's print path on the real firmware before PS2 is built on it, and answers
  which bit value burns a dot on this firmware.
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
| **Q-PS1** | ~~What is the print station?~~ **RULED 2026-10-28: (b) the office Windows PC** — printer by USB, our program as a Windows service that starts before login; sleep set to Never, update restarts in active hours. Scanner: dongle on the PC at the desk, Bluetooth to the tablet when walking (one host at a time). A Pi stays the move if the PC proves unreliable — same program. | (a) **A Raspberry Pi 5 (~$100 with case and power), plugged into the printer by USB, left on in the shop.** (b) The office Windows PC, if it is never switched off. (c) This Mac. | **(a).** A dedicated box nobody shuts down, updates or unplugs by accident; (b) works but printing stops whenever that PC sleeps or restarts. |
| **Q-PS2** | ~~Whose program runs on the station?~~ **RULED 2026-10-28: (a) ours.** | (a) **Ours** (PS3). (b) PrintNode's client + their cloud ($9/month, 5,000 prints). | **(a).** The owner ruled out third parties; the job is small because the printer takes raw bytes and needs no driver. (b) is the fallback if PS3 slips. |
| **Q-PS3** | USB or Bluetooth between the station and the printer? | USB · Bluetooth | **USB.** Bluetooth printing drops when either side sleeps; the station never moves. |
| **Q-PS5** | Should \"printed\" wait for the printer, not just the queue? | (a) Queue accepted = printed (built). (b) Watch the spool job until it leaves the queue or reports a fault. | **(b), after PS5** shows how the MUNBYN's driver reports paper-out. |
| **Q-PS4** | How many printers, and where? | one shop · shop + office · more | Decides how many stations to buy; the design takes any number. |

## 8. Progress log

- **2026-10-28 — plan written** after the owner rejected the print-dialog model. Research: the
  RW403B is USB/Bluetooth-only and speaks a TSPL subset (bitmap only); browsers cannot select a
  printer; the scanner is already device-independent.
- **2026-10-28 — Q-PS1 ruled: the Windows PC is the station.** PS0 added: the devices on Mac and
  Windows in parallel, with the raw-TSPL spike on the Mac first.

- **2026-10-28 — Q-PS2 ruled: our own program.** Building started.
- **2026-10-28 — PS1 + PS2 built in one PR.** The four tables could not merge alone (`lint:table-producers`
  wants a writer in the same PR), and a waiver naming the very next PR was paperwork. What shipped:
  - **0526** — `print_stations`, `printers`, `print_defaults`, `print_jobs`; one same-org guard (PS001),
    a job's life only forward (PS002) and fixed once queued (PS003), retired printers refused as new
    defaults or jobs (PS004), the claim and report RPCs (PS005 for another station's job). A job taken
    and never reported for two minutes becomes `unknown` — never re-queued (a second label), never
    failed (a hidden one). Matrix `print-stations.test.mjs`, 49 checks; 10 mutants of the migration,
    every one killed.
  - **`@silvicom/qr`** gains `raster.ts` (one-bit bitmaps, QR drawn at whole dots per module, glyph
    outlines filled non-zero) and `tspl.ts` (only the RW403B's honoured commands; **bit 0 burns** and
    **`BITMAP` mode 1**, both as measured on the hardware by `m0n01d/munbyn-print`).
  - **API** — `modules/maintenance/printing/` renders the PDF's own stacked face (`LABEL_FACE_POINTS`,
    Liberation Sans from `lib/pdfFonts.ts`) at printer resolution; `/api/maintenance/print` (stations,
    printers, defaults, jobs, `POST /labels` which never asks while a default exists);
    `/api/print-station` (pair, hello, a 25-second long poll, report) with its own limiter, mounted
    ahead of the per-address budget like the TMS agent.
  - **Found on the way:** the same project measured the RW403B feeding ~1.9 % short and landing ~3.1 mm
    right. On a 2" label the first is ~1 mm and harmless to a QR; the second is what the printer's
    X nudge is for (≈ −25 dots), set once in Settings during PS5.
  - **Next:** PS3 (the Windows station program) and PS4 (Settings → Devices, and the Labels screen's
    Print going to the default).
- **2026-10-28 — PS3 built: `tools/print-station/`** (Node 20+, no dependencies). `pair` trades the
  Settings code for a token (config written atomically; on Windows in `%ProgramData%`, locked to
  Administrators and SYSTEM); `run` says hello with the machine's printers every minute, long-polls,
  prints each job RAW through the operating system's queue (Windows: `winspool` from PowerShell run with
  `-File`, so a printer name is a parameter and never code; macOS/Linux: `lp -o raw`) and reports;
  an outage is backed off forever, a refusal stops it. `install-windows.ps1` registers a startup task as
  SYSTEM that restarts itself, turns sleep off on mains power and logs to `station.log`. 14 node:test
  checks, run by `lint:agent-syntax`.
  - **Q-PS5 (open): "printed" means the queue accepted it.** A printer out of paper holds the label in
    Windows' queue until the roll is changed. Watching the spool job to completion (and reporting the
    printer's own fault) is the next precision step; recommendation: do it after PS5 shows how the
    MUNBYN's driver reports faults.

## Sources

- MUNBYN RW403B: https://munbyn.com/products/munbyn-rw403b-bluetooth-thermal-label-printer
- RW403B over USB, TSPL subset tested on hardware: https://github.com/m0n01d/munbyn-print
- RW403B CUPS driver (PPD from MUNBYN's macOS driver): https://github.com/surma-lodur/Munbyn-CUPS
- TSPL on Raspberry Pi: https://github.com/RunTheWall/tspl-cups-driver
- PrintNode on a Raspberry Pi: https://www.printnode.com/en/docs/remote-printing-with-raspberry-pi
- PrintNode pricing: https://www.printnode.com/en/pricing
- WebHID support: https://caniuse.com/webhid
