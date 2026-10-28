import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { listPrinters, printRaw, WINDOWS_RAW_PRINT } from "./platform.mjs";

// The exact commands each system gets, with a fake runner — no printer needed.

test("Windows prints RAW through winspool, the printer name a real parameter (-File), never code", async () => {
  const calls = [];
  const exec = async (file, args) => {
    const script = args[args.indexOf("-File") + 1];
    calls.push({ file, args, script: await readFile(script, "utf8"), job: await readFile(args.at(-1)) });
    return "";
  };
  await printRaw("Shop's MUNBYN; Remove-Item C:\\", Buffer.from("SIZE"), { platform: "win32", exec });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "powershell.exe");
  assert.ok(!calls[0].args.includes("-Command"), "-Command would join the printer name into the code");
  assert.equal(calls[0].args.at(-2), "Shop's MUNBYN; Remove-Item C:\\");
  assert.equal(calls[0].script, WINDOWS_RAW_PRINT);
  assert.match(calls[0].script, /pDataType = "RAW"/);
  assert.equal(calls[0].job.toString(), "SIZE");
});

test("macOS and Linux print RAW through CUPS", async () => {
  const calls = [];
  await printRaw("MUNBYN_RW403B", Buffer.from("SIZE"), {
    platform: "darwin",
    exec: async (file, args) => {
      calls.push({ file, args, job: await readFile(args.at(-1)) });
      return "";
    },
  });
  assert.equal(calls[0].file, "lp");
  assert.deepEqual(calls[0].args.slice(0, 4), ["-d", "MUNBYN_RW403B", "-o", "raw"]);
  assert.equal(calls[0].job.toString(), "SIZE");
});

test("a failed print surfaces the system's own words", async () => {
  await assert.rejects(
    printRaw("X", Buffer.from("a"), { platform: "darwin", exec: async () => { throw new Error("lp: The printer is not connected."); } }),
    /not connected/,
  );
});

test("lists printers by the name the station must print to", async () => {
  const win = await listPrinters({ platform: "win32", exec: async () => "MUNBYN RW403B\r\nMicrosoft Print to PDF\r\n\r\n" });
  assert.deepEqual(win, [{ name: "MUNBYN RW403B" }, { name: "Microsoft Print to PDF" }]);
  const mac = await listPrinters({ platform: "darwin", exec: async () => "Brother_HL_L2465DW\nMUNBYN_RW403B\n" });
  assert.deepEqual(mac.map((p) => p.name), ["Brother_HL_L2465DW", "MUNBYN_RW403B"]);
  assert.deepEqual(await listPrinters({ platform: "linux", exec: async () => { throw new Error("no destinations"); } }), []);
});
