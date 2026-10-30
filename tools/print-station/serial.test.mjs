import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  createFramer,
  idsFromPnp,
  listSerialPorts,
  parseIoreg,
  parseWindowsPorts,
  resolvePort,
  spawnReader,
  WINDOWS_LIST_PORTS,
  WINDOWS_READ_PORT,
} from "./serial.mjs";

// The exact commands and parsers each system gets, with fake runners — no scanner needed.

test("Windows ports: the COM number from the device name, the USB ids from its PnP id", () => {
  const one = JSON.stringify({ name: "USB Serial Device (COM3)", id: "USB\\VID_0581&PID_0215\\6&2B1A3C&0&2" });
  assert.deepEqual(parseWindowsPorts(one), [{ name: "COM3", label: "USB Serial Device (COM3)", vendorId: "0581", productId: "0215" }]);
  const many = JSON.stringify([
    { name: "Communications Port (COM1)", id: "ACPI\\PNP0501\\0" },
    { name: "Bluetooth link", id: "BTHENUM\\x" },
  ]);
  assert.deepEqual(parseWindowsPorts(many), [{ name: "COM1", label: "Communications Port (COM1)" }]);
  assert.deepEqual(parseWindowsPorts(""), []);
  assert.deepEqual(parseWindowsPorts("not json"), []);
  assert.deepEqual(idsFromPnp("USB\\VID_0581&PID_0215&MI_00\\x"), { vendorId: "0581", productId: "0215" });
});

test("Windows lists ports through Win32_PnPEntity, as -Command (no user input in it)", async () => {
  const calls = [];
  await listSerialPorts({ platform: "win32", exec: async (file, args) => (calls.push({ file, args }), "") });
  assert.equal(calls[0].file, "powershell.exe");
  assert.equal(calls[0].args.at(-1), WINDOWS_LIST_PORTS);
});

// Shape copied from `ioreg -r -c IOUSBHostDevice -l -w0` on the office Mac, 10/30 (the scanner in
// keyboard mode, so no serial port), with a CDC child added the way IOSerialFamily publishes one.
const IOREG = `+-o IOUSBHostDevice@01100000  <class IOUSBHostDevice, id 0x10003d4d7, registered, matched, active, busy 0 (33 ms), retain 37>
  |   "idProduct" = 533
  |   "USB Vendor Name" = "Scanner Barcode"
  |   "idVendor" = 1409
  +-o IOUSBHostInterface@0  <class IOUSBHostInterface, id 0x10003d4dc, registered, matched, active>
  | |   "idProduct" = 533
  | +-o AppleUSBACMData  <class AppleUSBACMData, id 0x1, registered>
  |   +-o IOModemSerialStreamSync  <class IOModemSerialStreamSync, id 0x2, registered>
  |     +-o IOSerialBSDClient  <class IOSerialBSDClient, id 0x3, registered>
  |           "IOCalloutDevice" = "/dev/cu.usbmodem11101"
+-o Munbyn RW403B-N@02100000  <class IOUSBHostDevice, id 0x10003d52b, registered, matched, active>
  |   "idProduct" = 52445
  |   "USB Product Name" = "Munbyn RW403B-N"
  |   "idVendor" = 4070
`;

test("macOS: a /dev/cu port belongs to the USB device above it, named by product or vendor", () => {
  const map = parseIoreg(IOREG);
  assert.deepEqual(map.get("/dev/cu.usbmodem11101"), { label: "Scanner Barcode", vendorId: "0581", productId: "0215" });
  assert.equal(map.size, 1);
});

test("macOS lists /dev/cu.* except the Mac's own ports, with ioreg's names and ids", async () => {
  const fs = { readdir: async () => ["cu.Bluetooth-Incoming-Port", "cu.debug-console", "cu.usbmodem11101", "cu.RW403B-NB655", "tty.usbmodem11101"] };
  const ports = await listSerialPorts({ platform: "darwin", fs, exec: async () => IOREG });
  assert.deepEqual(ports, [
    { name: "/dev/cu.RW403B-NB655" },
    { name: "/dev/cu.usbmodem11101", label: "Scanner Barcode", vendorId: "0581", productId: "0215" },
  ]);
});

test("Linux lists ttyACM/ttyUSB with ids from sysfs", async () => {
  const files = { "/sys/bus/usb/devices/1-1/idVendor": "0581\n", "/sys/bus/usb/devices/1-1/idProduct": "0215\n" };
  const fs = {
    readdir: async () => ["ttyACM0", "ttyS0", "sda"],
    realpath: async () => "/sys/bus/usb/devices/1-1/1-1:1.0",
    readFile: async (p) => {
      if (p in files) return files[p];
      throw new Error("ENOENT");
    },
  };
  assert.deepEqual(await listSerialPorts({ platform: "linux", fs }), [{ name: "/dev/ttyACM0", vendorId: "0581", productId: "0215" }]);
});

test("listing never throws: no ports is an empty list", async () => {
  assert.deepEqual(await listSerialPorts({ platform: "win32", exec: async () => { throw new Error("no powershell"); } }), []);
});

test("the port to read: its own, else the ONE port with its USB ids, else none", () => {
  const scanner = { portName: "COM3", vendorId: "0581", productId: "0215" };
  assert.equal(resolvePort(scanner, [{ name: "COM3" }]), "COM3");
  assert.equal(resolvePort(scanner, [{ name: "COM5", vendorId: "0581", productId: "0215" }]), "COM5");
  assert.equal(
    resolvePort(scanner, [
      { name: "COM5", vendorId: "0581", productId: "0215" },
      { name: "COM6", vendorId: "0581", productId: "0215" },
    ]),
    null,
    "two candidates: guessing would read the wrong scanner",
  );
  assert.equal(resolvePort({ portName: "COM3", vendorId: null, productId: null }, [{ name: "COM5" }]), null);
});

test("readers: PowerShell -File with the port as a parameter on Windows; stty + cat with the port as $1 elsewhere", () => {
  const calls = [];
  const spawnImpl = (file, args) => (calls.push({ file, args }), new EventEmitter());
  spawnReader("COM3; Remove-Item C:\\", { platform: "win32", spawnImpl, scriptPath: "C:\\x\\read-port.ps1" });
  assert.equal(calls[0].file, "powershell.exe");
  assert.ok(!calls[0].args.includes("-Command"));
  assert.deepEqual(calls[0].args.slice(-3), ["-File", "C:\\x\\read-port.ps1", "COM3; Remove-Item C:\\"]);
  assert.match(WINDOWS_READ_PORT, /DtrEnable = \$true/);
  spawnReader("/dev/cu.usbmodem1; rm -rf ~", { platform: "darwin", spawnImpl });
  assert.equal(calls[1].file, "/bin/sh");
  assert.equal(calls[1].args.at(-1), "/dev/cu.usbmodem1; rm -rf ~");
  assert.ok(!calls[1].args[1].includes("usbmodem"), "the path is an argument, never in the command text");
});

test("framing: CR, LF or CRLF ends a read; chunks join; empty lines are nothing", () => {
  const reads = [];
  const f = createFramer((c) => reads.push(c));
  f.push(Buffer.from("SIL1:AS"));
  f.push(Buffer.from("T:7K3M9P\r\n012345678905\r\r\n"));
  f.push("\n");
  f.push("SIL1:TEST:Ok-42z\n");
  assert.deepEqual(reads, ["SIL1:AST:7K3M9P", "012345678905", "SIL1:TEST:Ok-42z"]);
});

test("framing: a read with no suffix is ended by silence; control characters are dropped", async () => {
  const reads = [];
  const f = createFramer((c) => reads.push(c), { idleMs: 10 });
  f.push("\u0002ABC123\u0003");
  assert.deepEqual(reads, []);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(reads, ["ABC123"]);
});

test("framing: a read longer than any code is refused whole, never cut", () => {
  const reads = [];
  const refused = [];
  const f = createFramer((c) => reads.push(c), { maxLength: 10, onRefused: (c) => refused.push(c) });
  f.push("12345678901\r");
  assert.deepEqual(reads, []);
  assert.deepEqual(refused, ["12345678901"]);
});
