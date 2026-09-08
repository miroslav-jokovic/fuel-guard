import { describe, expect, it } from "vitest";
import { parseArgs } from "./seedDemoLoads.js";

/**
 * The argument parser is the only pure part of this script, and it is the part where a mistake is
 * silent and expensive: this thing writes to PRODUCTION, and `--apply` is the difference between a
 * report and rows. Everything below is about that one boolean and the two ids beside it.
 */
describe("seedDemoLoads argument parsing", () => {
  it("reads the two ids and defaults to a dry run", () => {
    const args = parseArgs(["--org", "org-1", "--driver", "dr-1"]);
    expect(args).toEqual({ org: "org-1", driver: "dr-1", apply: false, remove: false });
  });

  /**
   * ⚠ The trap this test exists for. `--org --apply` is a plausible typo — a hand that skipped the
   * uuid — and a naive parser takes `--apply` as the org id, leaving `apply` false and producing a
   * confusing "No organization --apply". Worse is the mirror case below. A value is only a value if
   * it does not itself look like a flag.
   */
  it("never swallows the next FLAG as a value", () => {
    const args = parseArgs(["--org", "--apply", "--driver", "dr-1"]);
    expect(args.org).toBeNull();
    expect(args.apply).toBe(true);
  });

  it("a trailing --org with nothing after it is null, not undefined", () => {
    expect(parseArgs(["--driver", "dr-1", "--org"]).org).toBeNull();
  });

  it("--apply and --remove are independent, so a removal can also be dry-run", () => {
    expect(parseArgs(["--remove"])).toMatchObject({ apply: false, remove: true });
    expect(parseArgs(["--remove", "--apply"])).toMatchObject({ apply: true, remove: true });
  });

  it("order does not matter", () => {
    expect(parseArgs(["--apply", "--driver", "dr-1", "--org", "org-1"])).toEqual({
      org: "org-1",
      driver: "dr-1",
      apply: true,
      remove: false,
    });
  });
});
