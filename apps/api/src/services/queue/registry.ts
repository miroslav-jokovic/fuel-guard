import type { JobKind } from "../jobs.js";
import type { JobHandler } from "./types.js";

/**
 * Kind → handler registry (WQ0). A handler runs a job entirely from its serialized payload — no closures
 * over request state — so any worker can execute any kind. Registration happens at worker startup.
 */
const handlers = new Map<JobKind, JobHandler>();

export function registerHandler(kind: JobKind, handler: JobHandler): void {
  handlers.set(kind, handler);
}

export function getHandler(kind: JobKind): JobHandler | undefined {
  return handlers.get(kind);
}

export function registeredKinds(): JobKind[] {
  return [...handlers.keys()];
}

/** Test/reset helper. */
export function clearHandlers(): void {
  handlers.clear();
}
