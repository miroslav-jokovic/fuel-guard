# One scanner on one PC, used from any device (2026-10-30)

**Status: BUILDING — SR1–SR4 in one PR; SR5 (the hardware check) needs the owner at the scanner.**

**What the owner asked for (2026-10-30).** *"Create some module or router in 360 so it is working as
some kind of connector for this scanner and printer, and that way allow us to use it on any device as
long as it is connected to one PC."* Then: *"build this properly without assumptions and make it
production ready."*

**What prompted it.** The Tera scanner on its USB cable to the office Mac was tested against a tablet:
scans reached only the Mac, and they were typed into whatever window had focus — on 10/30, a Claude
Code chat, not Silvicom. Nothing was broken: a scanner in its factory mode is a **keyboard** for the
machine it is plugged into (PRINTERS-AND-SCANNERS-PLAN §3). Printing already has the shape the owner
wants — any device presses Print, the server queues it, the print station on the PC prints it
(0526). This plan gives the scanner the same shape in the other direction.

Supersedes, for a scanner set up this way, §3's "nothing to select": a relayed scanner IS a row in
Settings. A scanner paired by Bluetooth straight to a phone or tablet keeps working exactly as before.

## 1. Facts this plan rests on (measured or cited — none assumed)

| Fact | Source | Consequence |
| --- | --- | --- |
| In keyboard (HID) mode the scanner types into the **focused window** of the machine it is plugged into. | Owner, 10/30 (scans landed in a Claude chat) | A program on the PC cannot "listen to the scanner" in this mode without capturing the whole keyboard — OS hooks, admin rights, and still racing the focused window. Rejected (D-SR1). |
| Tera scanners have a **USB-COM / virtual serial port** mode, switched by scanning one setup barcode; out of it with the *USB HID Keyboard* barcode. Most models need no driver; the 1500C/2500C and 6900 manuals say a driver is needed. | Tera HW0001, 1300, 8100, 9000, HW0009, 1500C, 6900 manuals (Sources) | In COM mode the scanner is a **serial port**, not a keyboard: nothing is typed anywhere, and the station can read it like a file (D-SR1). |
| The office scanner enumerates as USB **VID 0x0581 / PID 0x0215**, manufacturer "Scanner Barcode", a composite HID device. | `system_profiler SPUSBDataType` on the office Mac, 10/30 | VID 0x0581 is the id Tera's devices use (0x0107 2.4 GHz receiver, 0x011C/0x0115 5100, 0x020C 2D EVHK0012 — devicehunt). PID 0x0215 is **not** in any public list, so **the exact model is unknown → Q-SR1.** |
| Windows 10/11 ship a class driver for USB CDC serial (`usbser.sys`); macOS exposes one as `/dev/cu.usbmodem*` with no driver. | Microsoft USB serial driver docs; macOS IOSerialFamily | No driver install on the station, IF the scanner presents as CDC — SR5 checks this on our unit. |
| The print station already holds an outbound, token-authenticated connection to the API and a heartbeat (`/api/print-station`, 0526). | `printStation.ts`, `station.mjs` | The scanner rides the same program, the same token and the same pairing. No second install. |
| zod `z.object` strips unknown keys; the station's client treats every 4xx except 429 as a permanent refusal and **exits**. | `printingContract.ts`, `client.mjs` | A new station's extra `hello` fields are harmless to an old API — but a new station posting a scan to an old API (404) would **stop printing**. The station must treat a missing scan route as "not supported yet" (D-SR8). |
| The station router's limiter is 300 requests per 15 minutes for everything. | `printStation.ts` | A busy unit check (one read a second) would spend it in five minutes and start refusing **print** polls. Reads get their own budget (D-SR8). |

## 2. The design

```
 shop floor                     office PC                       our API                    any device
 ──────────                     ─────────                       ───────                    ──────────
 trigger ── 2.4 GHz / cable ──► scanner (COM mode) ─► station ─► POST /print-station/scans ─► scanner_reads
                                 a serial port,       (same       (its own budget)              │ routed to the
                                 types nothing        program)                                  │ device holding it
                                                                                                ▼
                                                    "Use the office scanner" ◄── long poll ── browser tab
                                                                                 (≈1 s)       → the page's
                                                                                                 scan handler
```

## 3. Decisions

| ID | Decision | Why |
| --- | --- | --- |
| **D-SR1** | **The scanner is read as a serial port (USB-COM mode), by the print station.** Never by capturing keystrokes. | Keyboard mode types into the focused window (the 10/30 incident) and cannot be read by a background program without capturing the keyboard. COM mode types nothing; the station opens the port like a file. |
| **D-SR2** | **A scanner is a row on a station, like a printer** (`scanners`), named once in Settings and bound to the port the station reported. The station reports its serial ports on every hello; Settings offers that list, never a typed name. USB vendor/product ids are kept so a port Windows renumbers (COM3 → COM5 after a different USB socket) is followed when exactly one port has them. | D-PS3's shape. A typed port name is a typo waiting; a renumbered port that silently stops reading is the "scanner beeps and nothing happens" failure. |
| **D-SR3** | **One device holds a scanner at a time.** "Use on this device" takes it; holding is a 90-second lease the device's own wait for reads renews. Closing the tab, losing Wi-Fi or putting the tablet down for 90 s frees it. Taking a scanner somebody else holds asks first and names them. | A trigger pull must land on exactly one screen. A lease, not a flag, because a tab that crashed can never say it let go. |
| **D-SR4** | **A read is routed when it arrives** — to whoever holds the scanner at that moment, decided in the database (`scanner_record_read`). Nobody holding it: the read is kept, undelivered, and Settings shows *"last read 2 min ago — nobody was using it"*. | The same read cannot reach two screens, and the case "I scanned and nothing happened" has an answer on a screen. |
| **D-SR5** | **A read older than 60 seconds is never delivered**, and the station drops a read it could not send within 30 seconds (and logs it). | A scan is an instruction about *now* ("this tablet, this truck"). Delivered five minutes late into whatever page is open by then, it is a wrong assignment. The scanner already beeped, so the person re-scans. |
| **D-SR6** | **A relayed read enters the same path as a keystroke burst** — every enabled `useScanInput` listener on the page receives it, exactly as every one receives a `keydown`. The Scan page, Assign equipment, unit check, Add equipment's sticker field and the scanner test all work with no change of their own. With no scan screen open, the read is shown as a notice instead of vanishing. | One path, not six. The listeners already decide among themselves who owns the keyboard (`enabled`); a relayed read obeys the same rule. |
| **D-SR7** | **Reads are kept 7 days** (`dataRetentionPolicy`), then pruned. | They are a diagnostic trail ("did the scan reach Silvicom?"), not a record — the act a scan leads to (an assignment, a check) is recorded by its own table. |
| **D-SR8** | **An old API never stops a new station, and reads never starve printing.** The station posts reads to their own route with its own limit (1,800 / 15 min — two a second sustained), and treats a 404 there as "this Silvicom has no scanners yet" (logged once, keeps printing). | §1's two facts. |
| **D-SR9** | **Who may do what:** using a scanner (holding it, receiving its reads) is `maintenance:view` — the Scan page's own gate; adding, renaming and retiring one is `maintenance:manage`, as for printers. | A reader that needs more rights than the page it feeds would put the scanner beside the page instead of on it (CLAUDE.md, *No workarounds*). |

## 4. Steps

- **SR1 — schema** (0532): `scanners`, `scanner_reads`, `print_station_ports`; `scanner_record_read` and `scanner_take` RPCs; matrix `supabase/tests/scanner-relay.test.mjs`.
- **SR2 — API**: station side (ports in hello, scanners in its answer, `POST /scans`); office side (`/api/maintenance/scanners`: list, add, edit, retire, take, let go, wait for reads).
- **SR3 — station 1.1.0**: list serial ports (Windows `Win32_PnPEntity`, macOS `/dev/cu.*`, Linux `/dev/ttyACM*`/`ttyUSB*` + sysfs ids), read each assigned scanner (PowerShell `System.IO.Ports` on Windows; `stty raw` + `cat` elsewhere), frame reads on CR/LF, reconnect on unplug.
- **SR4 — web**: Settings → Scanners (table, add/edit drawer, "Use on this device"); the relay store feeding `useScanInput`; "Use the office scanner" on the Scan page; a bar while this device holds one.
- **SR5 — the hardware check (owner + me, on the office Mac, then the Windows PC).** Scan the *USB-COM* setup barcode from the scanner's own manual; confirm a serial port appears (`/dev/cu.usbmodem*` / *Ports (COM & LPT)* in Device Manager); confirm reads arrive on a tablet holding it; confirm the 2.4 GHz receiver does the same. Undo is the manual's *USB HID Keyboard* barcode.

## 5. Open questions

| ID | Question | Candidates | Recommendation |
| --- | --- | --- | --- |
| **Q-SR1** | Which Tera model is the office scanner, and does its USB-COM mode work over the 2.4 GHz receiver as well as the cable? | The model number on the label under the scanner (HW0002, HW0009, D5100, 8100 …). | **Owner reads the label**; I find its manual's setup barcode; SR5 measures both connections. If the model has no USB-COM mode (some 1D models need a vendor driver), the fallback is the vendor's virtual COM driver on the PC, then a second scanner — never keystroke capture (D-SR1). |
| **Q-SR2** | How long may a device hold a scanner with nobody scanning? | 90 s lease (built) · until "Stop using" | **90 s, renewed while the screen is open.** A tablet left on a bench keeps it; a closed tab frees it within 90 s. |

## 6. Progress log

- **2026-10-30 — plan written; SR1–SR4 building** on `claude/scanner-relay`. Office scanner measured as
  USB 0x0581:0x0215 on the Mac (model unknown → Q-SR1). The print station on the Mac (LaunchAgent,
  1.0.0) keeps printing through the change: its hello is accepted unchanged and it is never sent a
  scanner it cannot read.

## Sources

- Tera HW0001 manual (USB.COM / virtual serial port): https://www.manualslib.com/manual/4006170/Tera-Hw0001.html
- Tera 8100 manual: https://www.manualslib.com/manual/4004888/Tera-8100.html
- Tera 1300 manual: https://www.manualslib.com/manual/4259329/Tera-1300.html
- Tera 9000 manual (no driver needed): https://manuals.plus/m/06bbb9a0ac0f1c364f8223bcc58c388587cad165c19fdc4cf3cc5407cf84d256
- Tera HW0009 manual (USB-COM, 2.4 GHz, BT HID/SPP/BLE): https://manuals.plus/m/338f2f4335a34f2ea29a49bf030c3a7d78592aa4ff83857612963c398a34f91c
- Tera 6900 manual (needs the virtual COM driver): https://manuals.plus/tera/tera-6900-1d-handheld-barcode-scanner-user-manual
- Tera 1500C manual (driver required): https://www.scribd.com/document/647075675/Tera-1500C-Barcode-Scanner-Manual
- Tera manuals index: https://tera-digital.com/pages/user-manual
- USB VID 0x0581 device list: https://devicehunt.com/view/type/usb/vendor/0581/device/0107
