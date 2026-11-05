import { describe, expect, it } from "vitest";
import type { AdsSpendPlatform, AdsSpendReconcile } from "@silvicom/shared";
import { budgetLine, platformLine, reconcileLine, usd } from "./spendLines";

/** "Spend control live" in words (E1c): which state is a warning, and that each figure is shown as given. */
const meta = (over: Partial<AdsSpendPlatform> = {}): AdsSpendPlatform => ({
  platform: "meta", month_to_date_cents: 80_000, cap_cents: 300_000, live_daily_cents: 5_000, forecast_cents: 160_000, ...over,
});
const rec = (over: Partial<AdsSpendReconcile> = {}): AdsSpendReconcile => ({
  connection_id: "c", provider: "meta", last_run_at: "2026-11-15T07:00:00Z", late: false, changes_since: 0, ...over,
});
const when = () => "11/15/2026 1:00 AM";

describe("spendLines", () => {
  it("shows dollars from cents, with cents only when there are some", () => {
    expect([usd(300_000), usd(1_550), usd(0)]).toEqual(["$3,000", "$15.50", "$0"]);
  });

  it("a platform under its cap states the forecast the API gave, without a warning", () => {
    expect(platformLine(meta(), 16)).toEqual({
      spent: "$800 of $3,000 spent this month",
      forecast: "On course for $1,600 if today's daily budgets run for the 16 days left.",
      tone: "ok",
    });
  });

  it("a forecast over the cap warns that adding budget is refused", () => {
    const out = platformLine(meta({ forecast_cents: 300_001 }), 16);
    expect(out.tone).toBe("warn");
    expect(out.forecast).toContain("over the cap, so a launch or raise that adds budget is refused.");
  });

  it("a forecast exactly at the cap is not over it — the guard refuses only above", () => {
    expect(platformLine(meta({ forecast_cents: 300_000 }), 16).tone).toBe("ok");
  });

  it("the last day reads 'today', not '1 days'", () => {
    expect(platformLine(meta(), 1).forecast).toContain("run for today.");
  });

  it("no cap saved stops the platform, in red", () => {
    expect(platformLine(meta({ cap_cents: null }), 16)).toEqual({
      spent: "$800 spent this month", forecast: "No monthly cap is saved, so nothing can launch here.", tone: "stop",
    });
  });

  it("an AI budget never saved stops the agents; one used up warns", () => {
    expect(budgetLine(15_000, null, "AI tokens").tone).toBe("stop");
    expect(budgetLine(15_000, 1_000_000, "AI tokens")).toEqual({ text: "15,000 of 1,000,000 AI tokens used this month.", tone: "ok" });
    expect(budgetLine(500, 500, "picture credits").tone).toBe("warn");
  });

  it("reconcile: never run, run and quiet, differences found, and stopped", () => {
    expect(reconcileLine(rec({ last_run_at: null, late: true }), when)).toEqual({ text: "Never checked against Meta yet.", tone: "warn" });
    expect(reconcileLine(rec(), when)).toEqual({ text: "Checked against Meta 11/15/2026 1:00 AM; nothing differed since.", tone: "ok" });
    expect(reconcileLine(rec({ changes_since: 2 }), when)).toEqual({ text: "Checked against Meta 11/15/2026 1:00 AM; 2 differences recorded since.", tone: "warn" });
    expect(reconcileLine(rec({ late: true }), when).text).toContain("the daily check has stopped running.");
  });
});
