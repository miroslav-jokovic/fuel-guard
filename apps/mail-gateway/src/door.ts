import {
  mailGatewayCycleStartSchema,
  type BrokerMailAnswer,
  type BrokerMailEnvelope,
  type MailGatewayCycleCounts,
  type MailGatewayCycleStart,
  type MailGatewayFolderRole,
  type MailGatewayProbeKind,
  type MailGatewayProbeResult,
} from "@silvicom/shared";

/**
 * The gateway's whole database surface: the six `mailgw_*` functions of migration 0643, and nothing
 * else (D-BMR3). The login cannot touch a table, so there is no query here that names one — and no
 * function takes an org, so neither does anything below.
 *
 * `runCycle` depends on the `Door` interface, so its tests run against an in-memory fake; `pgDoor`
 * is the real one, over `postgres` in the Supabase pooler's transaction mode (`prepare: false`, D-BMR2).
 */
export interface Door {
  begin(commit: string): Promise<MailGatewayCycleStart>;
  saveCursor(cycle: string, mailbox: string, folderId: string, role: MailGatewayFolderRole, deltaLink: string | null): Promise<void>;
  recordMessages(cycle: string, envelopes: BrokerMailEnvelope[]): Promise<number>;
  markThreads(cycle: string, answers: BrokerMailAnswer[], checkedMailboxes: string[]): Promise<number>;
  recordProbe(cycle: string, kind: MailGatewayProbeKind, mailbox: string, result: MailGatewayProbeResult): Promise<boolean>;
  end(cycle: string, counts: MailGatewayCycleCounts, states: { mailbox: string; state: "not_connected" | "over_quota" }[]): Promise<void>;
}

/**
 * The schema is not there yet: on staging the code can arrive minutes before its migration (F10),
 * and an unseeded database has no config row. Both end the run quietly (D-BMR3).
 */
export class DoorNotReady extends Error {
  constructor(readonly code: string) { super(`database door not ready (${code})`); this.name = "DoorNotReady"; }
}

/** Postgres error codes that mean "not ready", not "broken": undefined_function, no config row. */
const NOT_READY = new Set(["42883", "P0002"]);

/** The slice of `postgres`'s tagged-template client this file uses — so a test can hand in a fake. */
export type Sql = <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>;
export type SqlJson = (value: unknown) => unknown;

export function pgDoor(sql: Sql, json: SqlJson): Door {
  async function call<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); } catch (e) {
      const code = (e as { code?: string }).code;
      if (code && NOT_READY.has(code)) throw new DoorNotReady(code);
      throw e;
    }
  }
  return {
    begin: (commit) => call(async () => {
      const [row] = await sql<{ r: unknown }>`select mailgw_begin_cycle(${commit}) as r`;
      return mailGatewayCycleStartSchema.parse(row?.r);
    }),
    saveCursor: (cycle, mailbox, folderId, role, deltaLink) => call(async () => {
      await sql`select mailgw_save_cursor(${cycle}, ${mailbox}, ${folderId}, ${role}, ${deltaLink})`;
    }),
    recordMessages: (cycle, envelopes) => call(async () => {
      if (envelopes.length === 0) return 0;
      const [row] = await sql<{ n: number }>`select mailgw_record_messages(${cycle}, ${json(envelopes)}) as n`;
      return Number(row?.n ?? 0);
    }),
    markThreads: (cycle, answers, checked) => call(async () => {
      const [row] = await sql<{ n: number }>`select mailgw_mark_threads(${cycle}, ${json(answers)}, ${checked}) as n`;
      return Number(row?.n ?? 0);
    }),
    recordProbe: (cycle, kind, mailbox, result) => call(async () => {
      const [row] = await sql<{ ok: boolean }>`select mailgw_record_probe(${cycle}, ${kind}, ${mailbox}, ${result}) as ok`;
      return row?.ok === true;
    }),
    end: (cycle, counts, states) => call(async () => {
      await sql`select mailgw_end_cycle(${cycle}, ${json(counts)}, ${json(states)})`;
    }),
  };
}
