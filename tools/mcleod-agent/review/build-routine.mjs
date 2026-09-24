#!/usr/bin/env node
/**
 * Builds `SILVICOM-READ-ROUTINE.sql` — the file the carrier's DBA reviews — from the code that runs.
 *
 * CA5 (docs/plans/mcleod/COLLECTOR-AUDIT-2026-09-24.md). Until 2026-09-24 the file was written by hand
 * and pinned statement by statement; it held ten statements while the agent could run twenty-four
 * (the whole finance sweep was missing) and it showed settings the code did not set. Now every
 * statement is taken from `queries.mjs`, every session setting and the MAXDOP hint from
 * `connection.mjs`, and `review.test.mjs` fails if the committed file differs from this output by a
 * single character. The prose is the owner's, to Alex, and lives here with the statements it
 * describes.
 *
 *   node review/build-routine.mjs          rewrite the file
 *   node review/build-routine.mjs --check  exit 1 if the committed file is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as Q from "../queries.mjs";
import { SESSION_SETTINGS, STATEMENT_HINT, APP_NAME, STATEMENT_TIMEOUT_MS } from "../connection.mjs";
import { JOBS } from "../schedule.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const ROUTINE_PATH = join(here, "SILVICOM-READ-ROUTINE.sql");

const RULE = "-- " + "=".repeat(88);
const THIN = "-- " + "-".repeat(88);
const every = (name) => {
  const j = JOBS.find((x) => x.name === name);
  return j.everyMs ? `every ${j.everyMs / 60_000 === 1 ? "minute" : `${j.everyMs / 60_000} minutes`}` : `every night at ${j.dailyAtHour}:00 AM Central`;
};

/** Sample ids so the close-read statements run as they stand; the connector binds the real ones. */
const SAMPLE_CLOSE_IDS = ["291013", "290837", "291386"];

const roster = Q.rosterQueries("identity");
const retire = Q.retirementQueries();
const close = Q.closeReadQueries(SAMPLE_CLOSE_IDS.length);

const PARTS = [
  {
    title: `PART 1 - OPEN LOADS (${every("loads")})`,
    intro: [
      "The loads your dispatchers are working right now, with their stops and dispatchers. About",
      "160 loads and 335 stops at a time. Measured on APPNEW: about 32 ms of CPU for all three.",
    ],
    statements: [
      ["OPEN LOADS", "Movements with status P or A that have a stop scheduled in the last 30 days.", Q.DISPATCH_LOADS],
      ["THE STOPS OF THOSE LOADS", "Your longitudes are stored as positive numbers; we flip the sign on our side.", Q.DISPATCH_LOAD_STOPS],
      ["THE DISPATCHERS ON THOSE LOADS", "Only users who have an open load right now, not the whole users table.", Q.DISPATCH_DISPATCHERS],
    ],
  },
  {
    title: `PART 2 - CLOSING LOADS (${every("close")})`,
    intro: [
      "Loads we still have open on our side but that have left your open board. We ask for their",
      "current state by movement id, so we see a delivery (D) or a void (V) because you recorded it,",
      "never because a load went missing. At most 300 ids per statement, each one a typed parameter.",
      `The ids below are examples so the file runs; measured with 300 ids: under 16 ms CPU, 3 ms.`,
    ],
    statements: [
      ["CURRENT STATE OF LOADS THAT LEFT THE BOARD", "Same columns as statement 1, looked up by id.", close.loads],
      ["THEIR STOPS", "Same columns as statement 2.", close.stops],
    ],
  },
  {
    title: `PART 3 - DRIVERS, TRUCKS AND TRAILERS (${every("roster")})`,
    intro: [
      "Keeps our driver, truck and trailer lists matching yours. Under 16 ms of CPU for all three.",
      "Today this runs from my laptop every 2 minutes; on the VM it slows to every 15.",
    ],
    statements: [
      ["ACTIVE DRIVERS", "Names, licence and medical card expiry, hire date and address. We read the driver's email from name_of_spouse, because that is where your team keeps it.", roster.drivers],
      ["ACTIVE TRUCKS", "Tractors that are in service, including the ones in the shop.", roster.vehicles],
      ["ACTIVE TRAILERS", "Trailers that are in service.", roster.trailers],
    ],
  },
  {
    title: `PART 4 - FINANCE (${every("financial")}, plus a wider pass on the first days of each month)`,
    intro: [
      "A rolling 75-day window of settlements, deductions, AP vouchers, fuel, movements, billing and",
      "the general ledger. Statements 20 and 21 run once for the window and once more for each",
      "calendar month it touches (three or four), so a night is 19 to 21 statements. Measured on the",
      "analytics copy: about 10 seconds of CPU for the whole night, on one core. These need the",
      "finance grants in section 6 of my letter; until then this part fails with a permission error",
      "under our login.",
    ],
    finance: true,
    statements: [
      ["DRIVER SETTLEMENTS", "", Q.SETTLEMENTS],
      ["SETTLEMENT LEDGER LINES", "", Q.SETTLEMENT_LEDGER_LINES],
      ["SETTLEMENT DEDUCTIONS", "", Q.SETTLEMENT_DEDUCTIONS],
      ["FUEL PURCHASES", "", Q.FUEL_PURCHASES],
      ["FUEL LEDGER LINES", "", Q.FUEL_LEDGER_LINES],
      ["AP VOUCHERS", "", Q.AP_VOUCHERS],
      ["SETTLED MOVEMENTS", "Every lookup is matched on company_id as well as the id (fixed 2026-09-24).", Q.MOVEMENT_FACTS],
      ["STOPS OF THOSE MOVEMENTS", "", Q.MOVEMENT_STOPS],
      ["MOVEMENT TOTALS, TO CHECK THE ROWS ABOVE", "", Q.MOVEMENT_FACT_COUNTS],
      ["BILLING HISTORY", "", Q.BILLING_HISTORY],
      ["CHART OF ACCOUNTS", "", Q.GL_ACCOUNTS],
      ["GENERAL LEDGER TOTALS BY DAY AND ACCOUNT", "", Q.GL_CONTROL_TOTALS],
      ["OFFICE PAYROLL LINES", "", Q.OFFICE_SETTLEMENT_LINES],
    ],
  },
  {
    title: "PART 5 - WHO HAS LEFT (by hand only, never on a timer)",
    intro: ["Drivers, trucks and trailers you have marked inactive. We run these when we clean up our lists."],
    statements: [
      ["INACTIVE DRIVERS", "", retire.drivers],
      ["RETIRED TRUCKS", "", retire.vehicles],
      ["RETIRED TRAILERS", "", retire.trailers],
    ],
  },
];

export function statementCount() {
  return PARTS.reduce((n, p) => n + p.statements.length, 0);
}

/** Every statement in the file, in order — `review.test.mjs` checks each against the code. */
export function routineStatements() {
  return PARTS.flatMap((p) => p.statements.map(([title, , sql]) => ({ title, sql })));
}

const wrapText = (text, width = 86) => {
  const out = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if ((line + " " + word).trim().length > width) {
      out.push(line.trim());
      line = word;
    } else line += " " + word;
  }
  if (line.trim()) out.push(line.trim());
  return out;
};

export function buildRoutine() {
  const total = statementCount();
  const L = [];
  L.push(
    "/* " + "=".repeat(86),
    "   Silvicom 360 connector - every statement it runs against LME (database: lme)",
    "   " + "=".repeat(86),
    "",
    "   Alex - this is the file my letter refers to. It holds every statement our connector runs,",
    "   word for word, in the order and with the settings it uses. It is plain T-SQL: open it in",
    "   SSMS and run it, and you will get back the rows we get. Run it as an administrator: under",
    "   our own login it stops at Part 4 with a permission error until the finance grants exist.",
    "",
    "   This file is produced from our connector's code, so it cannot drift from what actually runs;",
    "   if anything in it ever changes, we will send you the new file before the change goes live.",
    "",
    "   The short version:",
    `     login        silvicom_dispatch_ro - read only, no insert/update/delete anywhere`,
    `     runs on      the Board VM, one program, one connection, sending data OUT to us over HTTPS`,
    `     shows up as  program_name "${APP_NAME}" in sys.dm_exec_sessions`,
    `     statements   ${total}, in five parts, never two at the same time`,
    "",
    "   Thanks,",
    "   Miki",
    "   " + "=".repeat(86) + " */",
    "",
    RULE,
    "-- SESSION SETTINGS - our connector sends these ahead of EVERY statement, and adds",
    `-- ${STATEMENT_HINT} on its own line after every statement (you will see it below each one).`,
    `-- It also stops any statement that runs longer than ${STATEMENT_TIMEOUT_MS / 1000} seconds, and pauses for 15 minutes`,
    "-- after three timeouts in a row.",
    RULE,
  );
  const why = {
    "SET LOCK_TIMEOUT 5000;": "if a row is busy we give up after 5 s; your users never wait on us",
    "SET DEADLOCK_PRIORITY LOW;": "if SQL Server has to choose, it cancels us",
    "SET TRANSACTION ISOLATION LEVEL READ COMMITTED;": "never READ UNCOMMITTED / NOLOCK",
    "SET NOCOUNT ON;": "",
  };
  for (const s of SESSION_SETTINGS) L.push(why[s] ? `${s.padEnd(48)}-- ${why[s]}` : s);
  L.push(
    "",
    "-- Parameters. The connector passes these as typed parameters, never pasted into the SQL text.",
    "-- They are declared here only so the file runs on its own.",
    "DECLARE @companyId   varchar(32) = 'TMS';",
    "DECLARE @staleBefore datetime    = DATEADD(day, -30, GETDATE());",
    "DECLARE @windowStart varchar(32) = CONVERT(varchar(10), DATEADD(day, -75, GETDATE()), 23);",
    "DECLARE @windowEnd   varchar(32) = CONVERT(varchar(10), DATEADD(day, 1, GETDATE()), 23);",
    ...SAMPLE_CLOSE_IDS.map((id, i) => `DECLARE @id${i}         varchar(32) = '${id}';`),
    "",
  );
  let n = 0;
  for (const part of PARTS) {
    L.push(RULE, `-- ${part.title}`, "--", ...part.intro.map((l) => `-- ${l}`), RULE, "");
    for (const [title, note, sql] of part.statements) {
      n += 1;
      L.push(THIN, `-- STATEMENT ${n} of ${total}: ${title}`);
      if (note) L.push("--", ...wrapText(note).map((l) => `-- ${l}`));
      L.push(THIN, sql.trim(), `${STATEMENT_HINT};`, "");
    }
  }
  L.push(RULE, `-- END - ${total} statements. That is everything the connector reads.`, RULE, "");
  return L.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = buildRoutine();
  if (process.argv.includes("--check")) {
    const current = readFileSync(ROUTINE_PATH, "utf8");
    if (current !== text) {
      console.error("SILVICOM-READ-ROUTINE.sql is stale: run `node review/build-routine.mjs` and tell the carrier what changed.");
      process.exit(1);
    }
    console.log("SILVICOM-READ-ROUTINE.sql is current.");
  } else {
    writeFileSync(ROUTINE_PATH, text);
    console.log(`wrote ${ROUTINE_PATH} (${statementCount()} statements)`);
  }
}
