/**
 * The operating system's half of the print station: which printers it has, and sending raw bytes to
 * one (PRINTERS-AND-SCANNERS-PLAN.md PS3).
 *
 * ── RAW, THROUGH THE SPOOLER, ON EVERY SYSTEM ────────────────────────────────────────────────
 * The API sends a job already in the printer's language (TSPL for the MUNBYN RW403B), so nothing
 * here renders or converts: the bytes go to the operating system's print queue marked RAW, and the
 * queue passes them to the printer untouched. Going through the spooler rather than claiming the
 * USB device directly means the MUNBYN's own driver can stay installed for anybody who still prints
 * the PDF from that PC (the plan's D-PS5 fallback) — the two share the printer instead of fighting
 * over it, which is the "Busy" failure the direct-USB tools for this printer document.
 *
 *  · Windows — `winspool.drv` (OpenPrinter / StartDocPrinter with datatype RAW / WritePrinter),
 *    called from PowerShell, which every Windows 10 and 11 has. No module to compile.
 *  · macOS and Linux — CUPS: `lp -o raw`.
 *
 * ── "PRINTED" MEANS THE QUEUE TOOK IT ────────────────────────────────────────────────────────
 * The report says printed once the operating system accepted every byte. A printer out of paper
 * shows in the system's own queue and prints when the roll is changed; a second press of Print in
 * that window would make a second label. Watching the queue to the end is the plan's Q-PS5, owed.
 *
 * Every function takes its process runner as a parameter, so `platform.test.mjs` checks the exact
 * commands without a printer.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Run a program; resolve with stdout, reject with a readable error that carries stderr. */
export function run(file, args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || error.message).trim().split(/\r?\n/).slice(-3).join(" ");
        reject(new Error(detail || `${file} failed`));
        return;
      }
      resolve(String(stdout));
    });
  });
}

const POWERSHELL = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];

/**
 * The Windows path, as a script FILE run with `-File`: with `-Command`, PowerShell joins every
 * following argument into the command text, so a printer named "Shop's MUNBYN" would be parsed as
 * code. With `-File` the printer name and the job's path arrive as real parameters. The C# rides in a
 * single-quoted here-string, so nothing in it is interpolated.
 */
export const WINDOWS_RAW_PRINT = `
param([Parameter(Mandatory = $true)][string]$printer, [Parameter(Mandatory = $true)][string]$file)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class SilvicomRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);
  static Win32Exception Last(string what) {
    return new Win32Exception(Marshal.GetLastWin32Error(), what + " failed: " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
  }
  public static void Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw Last("Opening printer '" + printer + "'");
    try {
      DOCINFO info = new DOCINFO();
      info.pDocName = "Silvicom label";
      info.pDataType = "RAW";
      if (StartDocPrinter(h, 1, info) == 0) throw Last("Starting the print job");
      try {
        if (!StartPagePrinter(h)) throw Last("Starting the page");
        int written;
        if (!WritePrinter(h, bytes, bytes.Length, out written)) throw Last("Writing to the printer");
        if (written != bytes.Length) throw new Exception("The printer took " + written + " of " + bytes.Length + " bytes.");
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@
[SilvicomRawPrint]::Send($printer, [System.IO.File]::ReadAllBytes($file))
`;

/** The printers this system has, by the name the station must print to. */
export async function listPrinters({ platform = process.platform, exec = run } = {}) {
  if (platform === "win32") {
    const out = await exec("powershell.exe", [...POWERSHELL, "-Command", "Get-Printer | Select-Object -ExpandProperty Name"]);
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((name) => ({ name }));
  }
  // `lpstat -e` lists destination names one per line; no printers at all is an error exit on some
  // systems, which here simply means an empty list.
  const out = await exec("lpstat", ["-e"]).catch(() => "");
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((name) => ({ name }));
}

/** Send a job's bytes, untouched, to the named printer. Resolves once the system's queue has them. */
export async function printRaw(printerName, bytes, { platform = process.platform, exec = run } = {}) {
  if (typeof printerName !== "string" || printerName.trim() === "") throw new Error("No printer name.");
  const id = randomUUID();
  const file = join(tmpdir(), `silvicom-label-${id}.bin`);
  const script = join(tmpdir(), `silvicom-print-${id}.ps1`);
  await writeFile(file, bytes);
  try {
    if (platform === "win32") {
      await writeFile(script, WINDOWS_RAW_PRINT, "utf8");
      await exec("powershell.exe", [...POWERSHELL, "-File", script, printerName, file]);
    } else {
      await exec("lp", ["-d", printerName, "-o", "raw", "-t", "Silvicom label", file]);
    }
  } finally {
    await unlink(file).catch(() => {});
    await unlink(script).catch(() => {});
  }
}
