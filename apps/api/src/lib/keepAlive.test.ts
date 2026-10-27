import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * A standby `scheduler` worker must stay up (keepAlive.ts). Only a real process shows it: the bug is
 * Node's event loop emptying, which no fake timer can reproduce. Each child starts a real lease
 * against a store that always answers "held by someone else" (Railway, in the 2026-10-27 release),
 * with the real unref'd timers, and the test asks whether the child is still alive 1.5 s later.
 */
const leaseUrl = new URL("./schedulerLease.ts", import.meta.url).href;
const keepAliveUrl = new URL("./keepAlive.ts", import.meta.url).href;

function standby(withKeepAlive: boolean): Promise<"alive" | "exited"> {
  const script = `
    const { startLaneLease } = await import(${JSON.stringify(leaseUrl)});
    const { keepProcessAlive } = await import(${JSON.stringify(keepAliveUrl)});
    const store = {
      acquire: async () => ({ held: false, holder: "railway", expiresAt: null }),
      release: async () => {},
    };
    startLaneLease({ lane: "general", holder: "aws", store, onAcquired() {}, onLost() {}, log() {} });
    ${withKeepAlive ? "keepProcessAlive();" : ""}
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    stdio: "ignore",
  });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve("alive");
    }, 1_500);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve("exited");
    });
  });
}

describe("keepProcessAlive", () => {
  it("a standby lease alone lets the process exit — the worker crash loop of 2026-10-27", async () => {
    expect(await standby(false)).toBe("exited");
  }, 15_000);

  it("keeps a standby scheduler worker running", async () => {
    expect(await standby(true)).toBe("alive");
  }, 15_000);
});
