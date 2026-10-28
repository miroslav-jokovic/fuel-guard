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

## Try it on a Mac or Linux machine

```sh
node station.mjs printers                                  # what CUPS can print to
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
