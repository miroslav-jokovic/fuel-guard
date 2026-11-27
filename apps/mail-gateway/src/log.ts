import type { MailGatewayCycleCounts } from "@silvicom/shared";

/**
 * The gateway's only way to write a log line (§6 Logs): counts and error CLASSES, never an address,
 * a subject, a message id or a token. CloudWatch keeps these 30 days, and anyone who can read the
 * log group would otherwise be reading dispatcher mail.
 *
 * That is enforced by shape, not by care: `LogEvent` has no free-text field, only closed words and
 * numbers, and `log.test.ts` fails if any other file in `src/` calls `console.*`. An error is logged
 * by its class name (`MailboxRefused`, `GraphThrottled`, …) — the names are this program's own.
 *
 * `CANARY_OPENED` is printed bare as well: it is the pattern setup.sh's metric filter and alarm
 * watch (D-BMR14), and it must not depend on JSON parsing.
 */
export type ErrorClass =
  | "MailboxRefused" | "MailboxOverQuota" | "GraphThrottled" | "CursorReset" | "GraphFailed"
  | "RefusedCall" | "DoorNotReady" | "TokenFailed" | "Timeout" | "Unexpected";

export type LogEvent =
  | { event: "cycle_skipped"; reason: "lease_held" | "disabled" | "not_ready" }
  | { event: "cycle_end"; counts: MailGatewayCycleCounts; ms: number }
  | { event: "mailbox_error"; class: ErrorClass }
  | { event: "cycle_error"; class: ErrorClass }
  | { event: "draft_error"; class: ErrorClass }
  | { event: "canary"; result: "refused" | "opened" | "not_found" | "error" };

export type Logger = (e: LogEvent) => void;

export const consoleLogger: Logger = (e) => {
  if (e.event === "canary" && e.result === "opened") console.log("CANARY_OPENED");
  console.log(JSON.stringify(e));
};

const KNOWN = new Set<ErrorClass>(["MailboxRefused", "MailboxOverQuota", "GraphThrottled", "CursorReset", "GraphFailed", "RefusedCall", "DoorNotReady", "TokenFailed", "Timeout"]);

/** An error's class name if it is one of ours, else "Unexpected" — never its message. */
export function errorClass(e: unknown): ErrorClass {
  const name = (e as { name?: unknown } | null)?.name;
  return typeof name === "string" && KNOWN.has(name as ErrorClass) ? (name as ErrorClass) : "Unexpected";
}
