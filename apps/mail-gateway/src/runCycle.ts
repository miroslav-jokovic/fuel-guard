import type { MailGatewayCycleCounts, MailGatewayProbeResult } from "@silvicom/shared";
import { DoorNotReady, type Door } from "./door.js";
import { graphUrl } from "./graphCalls.js";
import { GraphThrottled, MailboxOverQuota, MailboxRefused, type GraphGet } from "./graphClient.js";
import { errorClass, type Logger } from "./log.js";
import { readMailbox, type MailboxCounts } from "./mailbox.js";
import { runDrafts } from "./drafts.js";
import type { GraphWrite } from "./graphWrite.js";

/**
 * One minute's run (D-BMR1, §7). All behaviour lives here, with Graph, the database, the clock and
 * the logger passed in, so the tests drive it against fakes and `lambda.ts` only builds the deps.
 *
 * 1. `begin` takes the lease. No cycle (switched off, or another run holds it) ends the run; so does
 *    a database whose door is not there yet (DoorNotReady, D-BMR3).
 * 2. The canary first, when due: if the mailbox that must be refused OPENS, the database switches the
 *    gateway off in the same call, and nothing else is read this minute (D-BMR14).
 * 3. Mailboxes, at most `concurrency` at once. A refused or full mailbox is a state; throttling skips
 *    that mailbox for this minute; nothing one mailbox does stops another.
 * 4. Drafts (P4, 0656): after the reads, so this minute's answers have already closed their emails.
 *    A database without 0656 answers "not ready" and the run simply has no draft work.
 * 5. Unlinked mailboxes due a probe get shape 4 only — no message is read (D-BMR14).
 * 6. `end` always runs, so the lease is released and the heartbeat written, whatever happened above.
 */

export interface CycleDeps {
  door: Door;
  graph: GraphGet;
  /** The two writes (createReply, delete a draft 360 made). Only the draft step uses it. */
  write: GraphWrite;
  log: Logger;
  now: () => Date;
  commit: string;
  canaryMailbox: string;
  /** How long the cycle may start new pages, in ms (Lambda's 50 s timeout leaves margin at 40 s). */
  budgetMs?: number;
  concurrency?: number;
}

export type CycleOutcome = "skipped" | "done" | "stopped_by_canary";

const probeResult = (status: number): MailGatewayProbeResult =>
  status === 403 ? "refused" : status >= 200 && status < 300 ? "opened" : status === 404 ? "not_found" : "error";

export async function runCycle(deps: CycleDeps): Promise<CycleOutcome> {
  const started = deps.now().getTime();
  let start;
  try { start = await deps.door.begin(deps.commit); } catch (e) {
    if (e instanceof DoorNotReady) { deps.log({ event: "cycle_skipped", reason: "not_ready" }); return "skipped"; }
    throw e;
  }
  if (!start.cycle_id) {
    deps.log({ event: "cycle_skipped", reason: start.enabled ? "lease_held" : "disabled" });
    return "skipped";
  }
  const cycle = start.cycle_id;
  const counts: MailGatewayCycleCounts = { mailboxes_read: 0, mailboxes_skipped: 0, messages_in: 0, external: 0, candidates: 0, bodies_read: 0, graph_throttled: 0, errors: 0,
    drafts_created: 0, drafts_stood_back: 0, drafts_refused: 0, drafts_removed: 0, drafts_failed: 0 };
  const per: MailboxCounts = { messages_in: 0, external: 0, candidates: 0, bodies_read: 0, cursor_resets: 0 };
  const states: { mailbox: string; state: "not_connected" | "over_quota" }[] = [];
  const allowed = new Set(start.mailboxes.map((m) => m.mailbox));
  const probeSet = new Set([deps.canaryMailbox.toLowerCase(), ...start.probe_unlinked]);
  let outcome: CycleOutcome = "done";
  try {
    if (start.canary_due) {
      const result = probeResult(await deps.graph.probe(graphUrl({ shape: "inbox_probe", mailbox: deps.canaryMailbox }, probeSet)));
      deps.log({ event: "canary", result });
      if (!(await deps.door.recordProbe(cycle, "canary", "canary", result))) { outcome = "stopped_by_canary"; return outcome; }
    }

    const deadline = started + (deps.budgetMs ?? 40_000);
    const queue = [...allowed];
    const worker = async () => {
      for (let mb = queue.shift(); mb; mb = queue.shift()) {
        try {
          if (await readMailbox(mb, { door: deps.door, graph: deps.graph, cycle, start, allowed, now: deps.now, deadline }, per)) counts.mailboxes_read++;
          else counts.mailboxes_skipped++;
        } catch (e) {
          counts.mailboxes_skipped++;
          if (e instanceof MailboxRefused) states.push({ mailbox: mb, state: "not_connected" });
          else if (e instanceof MailboxOverQuota) states.push({ mailbox: mb, state: "over_quota" });
          else if (e instanceof GraphThrottled) counts.graph_throttled++;
          else { counts.errors++; deps.log({ event: "mailbox_error", class: errorClass(e) }); }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? 4, Math.max(queue.length, 1)) }, worker));

    try {
      Object.assign(counts, await runDrafts({ door: deps.door, graph: deps.graph, write: deps.write, log: deps.log, cycle, allowed, now: deps.now, deadline }));
    } catch (e) {
      if (!(e instanceof DoorNotReady)) { counts.errors++; deps.log({ event: "draft_error", class: errorClass(e) }); }
    }

    for (const mb of start.probe_unlinked) {
      try {
        await deps.door.recordProbe(cycle, "unlinked", mb, probeResult(await deps.graph.probe(graphUrl({ shape: "inbox_probe", mailbox: mb }, probeSet))));
      } catch (e) { counts.errors++; deps.log({ event: "mailbox_error", class: errorClass(e) }); }
    }
    return outcome;
  } catch (e) {
    counts.errors++;
    deps.log({ event: "cycle_error", class: errorClass(e) });
    throw e;
  } finally {
    Object.assign(counts, { messages_in: per.messages_in, external: per.external, candidates: per.candidates, bodies_read: per.bodies_read });
    await deps.door.end(cycle, counts, states);
    deps.log({ event: "cycle_end", counts, ms: deps.now().getTime() - started });
  }
}
