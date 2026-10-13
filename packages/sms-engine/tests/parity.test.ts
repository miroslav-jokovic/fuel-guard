import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { SMS_BASICS, SMS_PARITY, scoreSms, violationKey, type SmsBasic, type SmsInspectionInput } from "../src/index.js";

/**
 * D-IC6: the calculator must equal FMCSA. Our 2026-10-10 feed, scored at 2026-08-28, against what
 * FMCSA's 2026-08-28 snapshot published as scored (`fixtures/README.md`).
 */
type Row = Record<string, string>;
const fx = (name: string): Row[] => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const MEASUREMENT = "2026-08-28";
const iso = (ymd: string) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

const feedInsp = fx("feed-inspections.json");
const feedViol = fx("feed-violations.json");
const feedCit = fx("feed-citations.json");
const postAccident = new Set(fx("feed-post-accident.json").filter((r) => r.post_acc_ind === "Y").map((r) => r.inspection_id));
const smsInsp = fx("sms-inspections.json");
const smsViol = fx("sms-violations.json");

const BASIC_BY_DESC: Record<string, SmsBasic> = {
  "Unsafe Driving": "unsafe_driving",
  "Hours-of-Service Compliance": "hos_compliance",
  "Driver Fitness": "driver_fitness",
  "Controlled Substances/&#8203;Alcohol": "controlled_substances_alcohol",
  "Vehicle Maintenance": "vehicle_maintenance",
  "Hazardous Materials Compliance": "hm_compliance",
};

/**
 * Inspections whose record changed after the snapshot cannot be compared: today's feed holds the
 * corrected version, FMCSA scored the old one (0298004281's violations were rewritten 2026-09-26).
 */
const changedAfter = new Set(feedInsp.filter((r) => r.change_date!.slice(0, 8) >= "20260828").map((r) => `${r.report_number}|${r.report_state}`));

const citation = new Map(feedCit.map((c) => [`${c.inspection_id}|${c.vioseqnum}`, Number(c.citation_code) as 1 | 2 | 3]));
const violsBy = new Map<string, Row[]>();
for (const v of feedViol) violsBy.set(v.inspection_id!, [...(violsBy.get(v.inspection_id!) ?? []), v]);
const inputs: SmsInspectionInput[] = feedInsp
  .filter((r) => !changedAfter.has(`${r.report_number}|${r.report_state}`))
  .map((r) => ({
    id: `${r.report_number}|${r.report_state}`,
    date: iso(r.insp_date!),
    level: r.insp_level_id ? Number(r.insp_level_id) : null,
    hazmatPlacard: r.hazmat_placard_req === "Y" ? true : r.hazmat_placard_req === "N" ? false : null,
    postAccident: postAccident.has(r.inspection_id!),
    addedOn: iso(r.mcmis_add_date!.slice(0, 8)),
    violations: (violsBy.get(r.inspection_id!) ?? []).map((v) => ({
      id: v.insp_violation_id!,
      code: v.viol_code!,
      outOfService: v.out_of_service_indicator === "Y",
      citationResult: citation.get(`${v.inspection_id}|${v.seq_no}`) ?? null,
    })),
  }));

const score = scoreSms(inputs, MEASUREMENT);
const line = (insp: string, key: string, basic: string, sev: number, oos: number, tw: number, total: number) =>
  `${insp} ${key} ${basic} sev=${sev} oos=${oos} tw=${tw} total=${total}`;
const ours = score.inspections.flatMap((i) => i.violations.map((v) => line(i.id, v.key, v.basic, v.severityWeight, v.oosWeight, v.timeWeight, v.totalSeverityWeight)));

const smsKey = new Map(smsInsp.map((r) => [r.unique_id!, `${r.report_number}|${r.report_state}`]));
const theirs = smsViol
  .filter((v) => !changedAfter.has(smsKey.get(v.unique_id!)!))
  .map((v) => line(smsKey.get(v.unique_id!)!, violationKey(v.viol_code!), BASIC_BY_DESC[v.basic_desc!]!, Number(v.severity_weight), Number(v.oos_weight), Number(v.time_weight), Number(v.total_severity_wght)));

const minus = (a: string[], b: string[]) => {
  const left = new Map<string, number>();
  for (const x of b) left.set(x, (left.get(x) ?? 0) + 1);
  return a.filter((x) => { const n = left.get(x) ?? 0; if (n > 0) { left.set(x, n - 1); return false; } return true; });
};

/** What we score and FMCSA did not, pinned exactly — Q-IC9. Shrinking it is progress; growing it is a regression. */
const UNEXPLAINED = [
  "1034700595|AZ 172202A1HMSPS", "1034700595|AZ 172202A3HMSPS",
  "1875000002|OH 172203KHMSPS", "1875000002|OH 172302AHMM",
  "3017001745|CT 172502A1HMPP",
  "7751000395|AZ 172202A4HMSPS", "7751000395|AZ 172202BHMSPS", "7751000395|AZ 17324B1HMNBP",
  "U770601414|MT 172201DHMSPS", "U770601414|MT 172202BHMSPS",
  "UDMC997699|CA 172202A2HMSPS", "UDMC997699|CA 172506AHMPMC",
  "X803001320|WA 172400A1HML", "X803001320|WA 172519B1HMPMC",
];

describe("SMS parity with FMCSA's 2026-08-28 snapshot (D-IC6)", () => {
  it("compares the whole record except the 7 inspections FMCSA changed after the snapshot", () => {
    expect(smsInsp.filter((r) => changedAfter.has(`${r.report_number}|${r.report_state}`)).length).toBe(7);
    expect(changedAfter.has("0298004281|SC")).toBe(true);
    expect(theirs.length).toBe(735);
  });

  it("scores every violation FMCSA scored, with identical severity, OOS, time and total weight", () => {
    expect(minus(theirs, ours)).toEqual([]);
  });

  it("scores nothing FMCSA did not, except the pinned unexplained list", () => {
    const extra = minus(ours, theirs).map((l) => l.split(" ").slice(0, 2).join(" ")).sort();
    expect(extra).toEqual([...UNEXPLAINED].sort());
  });

  it("scores exactly FMCSA's inspections, each at FMCSA's time weight", () => {
    const smsTw = new Map(smsInsp.filter((r) => !changedAfter.has(`${r.report_number}|${r.report_state}`)).map((r) => [`${r.report_number}|${r.report_state}`, Number(r.time_weight)]));
    const oursTw = new Map(score.inspections.map((i) => [i.id, i.timeWeight]));
    expect([...oursTw.keys()].sort()).toEqual([...smsTw.keys()].sort());
    for (const [id, tw] of smsTw) expect(oursTw.get(id), id).toBe(tw);
  });

  it("marks a BASIC verified exactly when it has nothing unexplained", () => {
    for (const basic of SMS_BASICS) {
      const unexplained = minus(ours, theirs).filter((l) => l.split(" ")[2] === basic).length;
      expect(SMS_PARITY[basic].verified, basic).toBe(unexplained === 0);
    }
  });

  it("states each verified BASIC's count as FMCSA's own", () => {
    for (const basic of SMS_BASICS.filter((b) => SMS_PARITY[b].verified)) {
      const n = smsViol.filter((v) => BASIC_BY_DESC[v.basic_desc!] === basic).length;
      expect(SMS_PARITY[basic].note.startsWith(`${n} of ${n} `), basic).toBe(true);
    }
  });
});
