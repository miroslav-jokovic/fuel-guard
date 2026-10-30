/**
 * The operating system's half of reading a scanner: which serial ports this machine has, and a
 * process that reads one (SCANNER-RELAY-PLAN.md SR3).
 *
 * ── WHY A SERIAL PORT AND NOT THE KEYBOARD ───────────────────────────────────────────────────
 * In its factory mode the scanner is a keyboard and types into whatever window has focus — on
 * 10/30, a chat window on the office Mac (D-SR1). Switched to USB-COM mode with one setup barcode
 * from its manual, it types nothing and is a serial port this program can read like a file.
 *
 * ── NO MODULE TO COMPILE, ON ANY SYSTEM ──────────────────────────────────────────────────────
 * The station has no dependencies (PS3), so a port is read the way each system already can:
 *  · Windows — `System.IO.Ports.SerialPort` from PowerShell, which every Windows 10 and 11 has,
 *    copying the port's bytes to stdout. Ports and their USB ids from `Win32_PnPEntity`.
 *  · macOS and Linux — the port opened as the shell's stdin, `stty raw` on it, then `cat`. Ports
 *    from `/dev`; USB ids from `ioreg` (macOS) or sysfs (Linux).
 * Either way the reader is a child process: unplugging the scanner ends it, and stopping the station
 * kills it, with no read left blocked inside Node.
 *
 * Every function takes its process runner as a parameter, so `serial.test.mjs` checks the exact
 * commands and parsers without a scanner.
 */
import { spawn } from "node:child_process";
import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { run } from "./platform.mjs";

const POWERSHELL = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];

/** Windows: every device with "(COMn)" in its name, as JSON. One object when there is one — handled. */
export const WINDOWS_LIST_PORTS =
  "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\(COM\\d+\\)' } | " +
  "ForEach-Object { [pscustomobject]@{ name = $_.Name; id = $_.PNPDeviceID } } | ConvertTo-Json -Compress";

/** Windows: open the port and copy its bytes to stdout until it goes away. A `-File` script, for platform.mjs's reason. */
export const WINDOWS_READ_PORT = `
param([Parameter(Mandatory = $true)][string]$port)
$ErrorActionPreference = 'Stop'
$p = New-Object System.IO.Ports.SerialPort $port, 9600, 'None', 8, 'One'
# A USB serial device may send nothing until the host raises DTR; it costs nothing when ignored.
$p.DtrEnable = $true
$p.RtsEnable = $true
$p.Open()
$out = [Console]::OpenStandardOutput()
$buf = New-Object byte[] 512
try {
  while ($true) {
    $n = $p.BaseStream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $out.Write($buf, 0, $n)
    $out.Flush()
  }
} finally { $p.Close() }
`;

const hex4 = (v) => {
  const n = typeof v === "number" ? v : Number.parseInt(String(v), 16);
  return Number.isFinite(n) && n >= 0 && n <= 0xffff ? n.toString(16).padStart(4, "0") : undefined;
};

/** `USB\VID_0581&PID_0215\...` → its ids, lower-case. */
export function idsFromPnp(id) {
  const m = /VID_([0-9A-F]{4}).*PID_([0-9A-F]{4})/i.exec(String(id ?? ""));
  return m ? { vendorId: m[1].toLowerCase(), productId: m[2].toLowerCase() } : {};
}

export function parseWindowsPorts(json) {
  if (!json.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .map((r) => {
      const name = /\((COM\d+)\)/.exec(String(r?.name ?? ""))?.[1];
      return name ? { name, label: String(r.name).slice(0, 200), ...idsFromPnp(r.id) } : null;
    })
    .filter(Boolean);
}

/**
 * macOS: which USB device each `/dev/cu.*` belongs to, from `ioreg -r -c IOUSBHostDevice -l -w0`.
 * The tree prints a device line (`+-o Name@… <class IOUSBHostDevice…>`), its properties, then its
 * children indented further; a serial port appears below its device as `"IOCalloutDevice" = "/dev/cu…"`.
 * So the device a port belongs to is the nearest device line above it that is less indented.
 */
export function parseIoreg(text) {
  const out = new Map();
  const stack = [];
  for (const line of text.split(/\r?\n/)) {
    const device = /^([\s|]*)\+-o (.+?)\s+<class IOUSB(?:Host)?Device\b/.exec(line);
    if (device) {
      const depth = device[1].length;
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      const named = device[2].replace(/@[0-9a-f]+$/i, "");
      // An unnamed device prints as its class ("IOUSBHostDevice@01100000" — the office scanner, 10/30).
      stack.push({ depth, label: /^IOUSB/.test(named) ? undefined : named, vendorName: undefined, vendorId: undefined, productId: undefined });
      continue;
    }
    const other = /^([\s|]*)\+-o /.exec(line);
    if (other) continue;
    const top = stack[stack.length - 1];
    if (!top) continue;
    const prop = /"(idVendor|idProduct|USB Product Name|USB Vendor Name|IOCalloutDevice)" = (.+)$/.exec(line);
    if (!prop) continue;
    const value = prop[2].trim().replace(/^"|"$/g, "");
    if (prop[1] === "idVendor") top.vendorId = hex4(Number(value));
    else if (prop[1] === "idProduct") top.productId = hex4(Number(value));
    else if (prop[1] === "USB Product Name") top.label = value;
    else if (prop[1] === "USB Vendor Name") top.vendorName = value;
    else out.set(value, { label: top.label ?? top.vendorName, vendorId: top.vendorId, productId: top.productId });
  }
  return out;
}

/** Ports nobody plugs a scanner into: the Mac's own, and Bluetooth's. */
const MAC_SKIP = /^cu\.(Bluetooth-Incoming-Port|debug-console|wlan-debug)$/;

/** The serial ports this machine has: `[{ name, label?, vendorId?, productId? }]`. Never throws. */
export async function listSerialPorts({ platform = process.platform, exec = run, fs = { readdir, readFile, realpath } } = {}) {
  try {
    if (platform === "win32") {
      return parseWindowsPorts(await exec("powershell.exe", [...POWERSHELL, "-Command", WINDOWS_LIST_PORTS]));
    }
    const dev = await fs.readdir("/dev");
    if (platform === "darwin") {
      const usb = parseIoreg(await exec("ioreg", ["-r", "-c", "IOUSBHostDevice", "-l", "-w0"]).catch(() => ""));
      return dev
        .filter((n) => n.startsWith("cu.") && !MAC_SKIP.test(n))
        .sort()
        .map((n) => {
          const name = `/dev/${n}`;
          const u = usb.get(name);
          return { name, ...(u?.label ? { label: u.label.slice(0, 200) } : {}), ...(u?.vendorId ? { vendorId: u.vendorId } : {}), ...(u?.productId ? { productId: u.productId } : {}) };
        });
    }
    const ports = [];
    for (const n of dev.filter((d) => /^tty(ACM|USB)\d+$/.test(d)).sort()) {
      ports.push({ name: `/dev/${n}`, ...(await linuxIds(n, fs)) });
    }
    return ports;
  } catch {
    return [];
  }
}

/** Linux: walk up from the tty's device in sysfs to the USB device that has the ids. */
async function linuxIds(tty, fs) {
  try {
    let dir = await fs.realpath(`/sys/class/tty/${tty}/device`);
    for (let i = 0; i < 4; i += 1) {
      const vendor = await fs.readFile(join(dir, "idVendor"), "utf8").catch(() => null);
      if (vendor) {
        const product = await fs.readFile(join(dir, "idProduct"), "utf8").catch(() => "");
        return { vendorId: hex4(vendor.trim()), productId: hex4(product.trim()) };
      }
      dir = dirname(dir);
    }
  } catch {
    // no sysfs entry: no ids
  }
  return {};
}

/**
 * Which port to read for an assigned scanner: its own, while the system has it; otherwise the ONE
 * port with its USB ids (Windows gave it a new COM number — D-SR2); otherwise none (waiting).
 */
export function resolvePort(scanner, ports) {
  if (ports.some((p) => p.name === scanner.portName)) return scanner.portName;
  if (!scanner.vendorId || !scanner.productId) return null;
  const same = ports.filter((p) => p.vendorId === scanner.vendorId && p.productId === scanner.productId);
  return same.length === 1 ? same[0].name : null;
}

/** Start reading a port. Returns the child process; its stdout is the scanner's bytes. */
export function spawnReader(portName, { platform = process.platform, spawnImpl = spawn, scriptPath } = {}) {
  if (platform === "win32") {
    return spawnImpl("powershell.exe", [...POWERSHELL, "-File", scriptPath, portName], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  }
  // The port is the shell's stdin, so `stty` (which acts on stdin on both macOS and Linux) sets the
  // very descriptor `cat` then reads. The path is "$1", an argument — never part of the command text.
  return spawnImpl("/bin/sh", ["-c", 'exec <"$1" || exit 3; stty raw -echo 2>/dev/null; exec cat', "sh", portName], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Turns a scanner's bytes into reads. A read ends at CR or LF (every scanner's default suffix); a
 * read with no suffix — somebody turned it off with a setup barcode — is ended by `idleMs` of
 * silence, `useScanInput`'s IDLE_FLUSH reasoning. Control characters are dropped; an empty line is
 * nothing; a read longer than `maxLength` is refused whole, never cut into a wrong code.
 */
export function createFramer(onRead, { idleMs = 150, maxLength = 200, onRefused = () => {} } = {}) {
  let buffer = "";
  let timer = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const code = buffer.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    buffer = "";
    if (!code) return;
    if (code.length > maxLength) return onRefused(code);
    onRead(code);
  };
  return {
    push(chunk) {
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      for (const ch of text) {
        if (ch === "\r" || ch === "\n") flush();
        else buffer += ch;
      }
      if (timer) clearTimeout(timer);
      timer = buffer ? setTimeout(flush, idleMs) : null;
    },
    end: flush,
  };
}
