import { z } from "zod";
import { parseSchedulerLanes } from "./schedulerLanes.js";

/**
 * Which process runs which background work, split out of `env.ts` on the `envDispatchBoard.ts`
 * precedent: one concern (docs/WORKER-DEPLOYMENT.md, PLATFORM-RELIABILITY-PLAN D-RLY2), and `env.ts`
 * sits at its 500-line budget. Spread into the one schema, so a deployment still gets one parse.
 */
export const schedulingEnvFields = {
  // Whether THIS process also runs background schedulers in-process (default true, single-service
  // deploy). Set RUN_SCHEDULERS_IN_PROCESS=false on a service that must run none (`@fleetguard/web`).
  // Since D-RLY2 it no longer has to be the only guard: a process that runs a lane must also hold that
  // lane's database lease (0506), so two copies of a service cannot both run the same schedulers.
  RUN_SCHEDULERS_IN_PROCESS: z
    .string()
    .default("true")
    .transform((s) => s.toLowerCase() !== "false"),

  // Which scheduler lanes this process competes for (schedulerLanes.ts): "all" (default — the
  // single-service deploy, unchanged), or a comma list. Production since D-RLY2: `@fleetguard/api`
  // runs `egress` (the WEX-whitelisted EFS work), the worker service runs `general`.
  // A typo fails the boot with the one env error, rather than running no schedulers in silence.
  SCHEDULER_LANES: z
    .string()
    .default("all")
    .transform((s, ctx) => {
      try {
        return parseSchedulerLanes(s);
      } catch (e) {
        ctx.addIssue({ code: "custom", message: e instanceof Error ? e.message : String(e) });
        return z.NEVER;
      }
    }),

  // Job execution mode (plan Q8, docs/plans/P0-WORKER-QUEUE-PLAN.md). "inprocess" (default) runs job
  // `work` inline via runJob() as today; "queue" makes callers enqueue and the worker pool execute.
  // Migrated per-kind; reversible by flipping this flag.
  JOB_EXECUTION_MODE: z.enum(["inprocess", "queue"]).default("inprocess"),

  // Worker role split (plan WQ3): a worker process runs schedulers, the queue consumer, or both.
  // Deploy 1 `scheduler` replica (owns the setInterval schedulers, single-owner) + N `consumer`
  // replicas (claim + execute jobs, horizontally scalable). Default `both` = the single-worker deploy.
  WORKER_ROLE: z.enum(["scheduler", "consumer", "both"]).default("both"),
};
