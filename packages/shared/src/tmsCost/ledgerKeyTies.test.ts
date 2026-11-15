import { describe, it, expect } from "vitest";
import {
  BILL_RECEIVABLE_GLID,
  EXCEPTION_LIMIT,
  ledgerByKey,
  subledgerByKey,
  tieByPostingKey,
  tmsLedgerKeyLinesPayloadSchema,
} from "./ledgerKeyTies.js";
import { SETTLEMENT_PAYABLE_GLID_PREFIX } from "./settlementFact.js";

/**
 * Sub-ledger against ledger, one posting key at a time (TRUCK-DRIVER-PNL-PLAN P0c). The fixtures are
 * the July 2026 sandbox shapes: a bill posts its receivable and its revenue under one key; a
 * settlement accrual credits the payable; a SETV reversal debits it back.
 */
const line = (post_module: string, post_key: string, glid: string, net_amount: number) => ({
  txn_date: "2026-07-14", post_module, post_key, glid, lines: 1, net_amount,
});

describe("ledgerByKey", () => {
  const LINES = [
    line("BILL", "1001", BILL_RECEIVABLE_GLID, 4864.64),
    line("BILL", "1001", "30000001", -4250),
    line("BILL", "1001", "30000031", -614.64),
    line("BILL", "1002", BILL_RECEIVABLE_GLID, -213.5),
    line("SET", "1001", "20500010", -900),
    line("SET", "1001", "40000001", 900),
    line("SET", "1003", "20500020 ", -1500),
    // The same key and account in another module is another posting, and is not SET's.
    line("SETV", "1001", "20500010", 900),
  ];

  it("reads one module's control account per key, and ignores the other legs and modules", () => {
    const bill = ledgerByKey(LINES, "BILL", (g) => g === BILL_RECEIVABLE_GLID, 1);
    expect([...bill]).toEqual([["1001", 4864.64], ["1002", -213.5]]);
  });

  it("flips the settlement payable's credit into the pay it accrued, on either payable", () => {
    const set = ledgerByKey(LINES, "SET", (g) => g.startsWith(SETTLEMENT_PAYABLE_GLID_PREFIX), -1);
    expect([...set]).toEqual([["1001", 900], ["1003", 1500]]);
  });
});

describe("subledgerByKey", () => {
  it("sums rows per trimmed key and counts the rows with no key", () => {
    const { byKey, unkeyed } = subledgerByKey(
      [{ k: "K1 ", v: 10 }, { k: "K1", v: 5 }, { k: null, v: 99 }, { k: " ", v: 1 }],
      (r) => r.k,
      (r) => r.v,
    );
    expect([...byKey]).toEqual([["K1", 15]]);
    expect(unkeyed).toBe(2);
  });
});

describe("tieByPostingKey", () => {
  it("ties a month whose every key agrees to the cent", () => {
    const t = tieByPostingKey("BILL", new Map([["a", 100.004], ["b", -50]]), new Map([["a", 100], ["b", -50]]));
    expect(t).toMatchObject({ keys: 2, matched: 2, tied: true, exceptions: [] });
  });

  it("names each kind of exception — disagreeing, ledger-only and staged-only — and is not tied", () => {
    const t = tieByPostingKey(
      "BILL",
      new Map([["same", 10], ["off", 100], ["missed", 900]]),
      new Map([["same", 10], ["off", 90], ["extra", 900]]),
    );
    expect(t.matched).toBe(1);
    expect(t.mismatched).toEqual({ count: 1, difference: -10 });
    expect(t.ledgerOnly).toEqual({ count: 1, amount: 900 });
    expect(t.subledgerOnly).toEqual({ count: 1, amount: 900 });
    expect(t.tied).toBe(false);
    // The two $900 exceptions cancel in a total; here both are named, largest first.
    expect(t.exceptions.map((e) => e.post_key)).toEqual(["extra", "missed", "off"]);
    expect(t.exceptions.find((e) => e.post_key === "missed")).toEqual({ post_key: "missed", ledger: 900, subledger: null, difference: -900 });
  });

  it("lists exceptions by size, whatever order the keys arrived in", () => {
    const t = tieByPostingKey("BILL", new Map([["small", 5], ["big", 100], ["tiny", 1]]), new Map());
    expect(t.exceptions.map((e) => e.post_key)).toEqual(["big", "small", "tiny"]);
  });

  it("does not call a zero-value settlement with no ledger line an exception", () => {
    const t = tieByPostingKey("SET", new Map(), new Map([["z", 0]]));
    expect(t).toMatchObject({ matched: 1, tied: true });
  });

  it("is not tied while staged rows carry no posting key", () => {
    expect(tieByPostingKey("BILL", new Map([["a", 1]]), new Map([["a", 1]]), 3)).toMatchObject({ unkeyed: 3, tied: false });
  });

  it("keeps the largest exceptions when there are more than it lists", () => {
    const ledger = new Map(Array.from({ length: EXCEPTION_LIMIT + 5 }, (_, i) => [`k${i}`, i + 1] as [string, number]));
    const t = tieByPostingKey("BILL", ledger, new Map());
    expect(t.exceptions).toHaveLength(EXCEPTION_LIMIT);
    expect(t.exceptions[0]!.ledger).toBe(EXCEPTION_LIMIT + 5);
    expect(t.ledgerOnly.count).toBe(EXCEPTION_LIMIT + 5);
  });
});

describe("the wire contract", () => {
  it("takes a month of key lines and refuses a period that does not start on the 1st", () => {
    const lines = [line("BILL", "1001", BILL_RECEIVABLE_GLID, 1)];
    expect(tmsLedgerKeyLinesPayloadSchema.safeParse({ period_start: "2026-07-01", period_end: "2026-08-01", company_id: "TMS", lines }).success).toBe(true);
    expect(tmsLedgerKeyLinesPayloadSchema.safeParse({ period_start: "2026-07-02", period_end: "2026-08-01", lines }).success).toBe(false);
  });
});
