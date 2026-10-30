# Silvicom print station

The small program that lets **any device** print labels to the shop's label printer with no print
dialog (`docs/plans/maintenance/PRINTERS-AND-SCANNERS-PLAN.md`). It runs on the always-on computer
the printer is plugged into by USB — the office Windows PC — dials out to Silvicom, waits for print
jobs and writes them to the printer. Nobody else installs anything.

## Install on the Windows PC (once, ~5 minutes)

1. Plug the MUNBYN into the PC by **USB**, install its Windows driver, print the driver's test page.
2. Install Node.js if `node --version` does not answer 20 or newer: `winget install OpenJS.NodeJS.LTS`.
3. In Silvicom: **Settings → Devices → Add print station**, name it ("Office PC"). Copy the code it shows
   (valid 15 minutes).
4. Copy this folder to the PC, open **PowerShell as administrator** in it, and run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Code ABCD-EFGH -Api https://<your Silvicom address>
   ```
5. Back in Settings → Devices the station turns **online** and lists the printers Windows has. Add the
   MUNBYN as a printer (stock: 2" roll) and make it the default. Print a test label.

The installer registers a scheduled task, **Silvicom Print Station**, that starts with Windows before
anyone logs in, runs as SYSTEM, restarts itself if it stops, and turns sleep off on mains power.
Its log is `C:\ProgramData\Silvicom\PrintStation\station.log`.

## A scanner on this PC, used from any device (SCANNER-RELAY-PLAN.md)

The same program reads the shop's scanner, so a phone, tablet or another computer can use a scanner
plugged into this PC — the scans go to whichever device pressed **Use** (Scan page, or Settings →
Printers & scanners), never into a window on this PC.

1. Plug the scanner (or its 2.4 GHz USB receiver) into this PC.
2. Switch the scanner to **USB-COM / virtual serial port** mode: scan that setup barcode in the
   scanner's own manual. It stops typing like a keyboard and becomes a serial port. (The manual's
   **USB HID Keyboard** barcode switches it back.)
3. Check the PC sees it: `node station.mjs ports` lists it (Windows: a `COM` number; Mac:
   `/dev/cu.usbmodem…`). Windows also shows it under *Ports (COM & LPT)* in Device Manager.
4. In Silvicom: **Settings → Printers & scanners → Add scanner**, pick this station and that port.
   Within a minute its status turns **Ready**.
5. On any device: **Scan → Use Office scanner**. A blue strip at the top says scans now come to that
   screen; **Stop** lets it go. Settings shows who is using each scanner and when it last read.

A scanner that Silvicom shows as **Not found** is unplugged or still in keyboard mode; **Cannot open**
means another program on this PC holds the port. Needs version 1.1.0 of this program or newer — older
versions keep printing and are shown as *Update station*.

## Try it on a Mac or Linux machine

```sh
node station.mjs printers                                  # what CUPS can print to
node station.mjs ports                                     # serial ports a scanner can be read on
node station.mjs pair ABCD-EFGH --api https://<your Silvicom address>
node station.mjs run                                       # Ctrl-C to stop
```

## Good to know

- **Moving it to another PC:** Settings → Devices → the station → *New pairing code*, then install on
  the new PC. Pairing again cuts the old PC off.
- **"Printed" means Windows' print queue accepted the label.** If the printer is out of paper, the
  label waits in Windows' queue and comes out when the roll is changed — don't press Print again.
- **Revoked or re-paired:** the program stops and logs "Silvicom refused this station". Pair again.
- Tests: `node --test "tools/print-station/*.test.mjs"` (run by `pnpm lint:agent-syntax`).
