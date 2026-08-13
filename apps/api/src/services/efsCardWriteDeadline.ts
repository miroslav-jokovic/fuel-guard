import type { Env } from "../env.js";

/**
 * One controller owns the complete card mutation budget. The SOAP client still enforces each socket's
 * interactive deadline, while this signal stops a slow sequence of pacing waits and vendor calls from
 * holding the HTTP request indefinitely. A caller must reconcile an aborted write, never retry it.
 * The budget is read straight off `env`: `EFS_CARD_WRITE_TIMEOUT_MS` carries a zod `.default(25_000)`,
 * so it is never undefined and a second default here would be a silent place for the two to drift.
 */
export async function withEfsCardWriteDeadline<T>(
  env: Env,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = env.EFS_CARD_WRITE_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
