import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { PACKET_SPELLING, type PacketSpelling } from "./packetSpelling.js";
import {
  applyPacketSpelling,
  packetClipReport,
  packetLineTexts,
} from "./applicationPdf/packet/packetSpellingPatch.js";
import { PACKET_TEMPLATE_PATH } from "./applicationPdf/packet/packetTemplate.js";
import * as PACKET_TEXT from "./applicationPdf/packet/packetText.js";

/**
 * D-PKT20 — the carrier's typing errors, corrected (owner, 2026-09-25: *"my secretary retyped this
 * application so lets fix spelling mistakes"*).
 *
 * Three things are defended here. The REGISTER stays spelling and only spelling — the word-count
 * guard `packetWording.ts` always had, now over the whole packet. The PAPER takes every entry exactly
 * as often as it says and keeps no misspelling in its text layer. And the LAYOUT survives: a
 * correction that adds a letter must not run past the cell the carrier's PDF clips each line to —
 * which three did, on pages 11, 23 and 24, before the patcher learned to fit them — nor push a clip
 * into space another line uses.
 */

const original = await readFile(PACKET_TEMPLATE_PATH);
const load = (): Promise<PDFDocument> => PDFDocument.load(original, { ignoreEncryption: true });
const words = (s: string): number => s.trim().split(/\s+/).length;

describe("the register", () => {
  it("makes spelling corrections only — no entry adds or drops a word", () => {
    const changed = PACKET_SPELLING.filter((e) => e.kind === "spelling" && words(e.wrong) !== words(e.right));
    expect(changed).toEqual([]);
  });

  it("only adds a space in a split, and only removes one in a join", () => {
    for (const e of PACKET_SPELLING.filter((x) => x.kind === "split")) {
      expect(e.right.replace(/ /g, ""), e.wrong).toBe(e.wrong.replace(/ /g, ""));
      expect(words(e.right), e.wrong).toBe(words(e.wrong) + 1);
    }
    for (const e of PACKET_SPELLING.filter((x) => x.kind === "join")) {
      expect(e.wrong.replace(/ /g, ""), e.wrong).toBe(e.right.replace(/ /g, ""));
    }
  });

  it("makes every character fix, and every change to the contract, argue for itself", () => {
    const silent = PACKET_SPELLING.filter(
      (e) => (e.kind === "character" || e.page >= 29) && (e.why ?? "").length < 10,
    );
    expect(silent).toEqual([]);
  });

  /**
   * ⚠ Order is the one mistake the landing count cannot always see: a word entry listed BEFORE a
   * phrase containing it consumes the phrase's text, and the phrase then lands 0 times — caught — or,
   * where the phrase occurs elsewhere too, lands on the wrong occurrence. So it is asserted directly.
   */
  it("lists every phrase before the shorter entries it contains", () => {
    const late: string[] = [];
    PACKET_SPELLING.forEach((e, i) => {
      for (const earlier of PACKET_SPELLING.slice(0, i)) {
        if (earlier.page === e.page && e.wrong !== earlier.wrong && e.wrong.includes(earlier.wrong)) {
          late.push(`p${e.page} "${e.wrong}" after "${earlier.wrong}"`);
        }
      }
    });
    expect(late).toEqual([]);
  });

  it("never lists the same correction twice", () => {
    const keys = PACKET_SPELLING.map((e) => `${e.page}|${e.wrong}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the corrected paper", () => {
  it("takes every entry exactly as often as it says, or refuses to render", async () => {
    const doc = await load();
    expect(() => applyPacketSpelling(doc)).not.toThrow();
    // Guards the guard: an entry that matches nothing must throw, not print the typo quietly.
    const ghost: PacketSpelling = { page: 5, wrong: "zzqx", right: "zzqy", kind: "spelling" };
    const second = await load();
    expect(() => applyPacketSpelling(second, [...PACKET_SPELLING, ghost])).toThrow(/zzqx/);
    const twice: PacketSpelling = { ...PACKET_SPELLING.find((e) => e.wrong === "maritial")!, times: 2 };
    const third = await load();
    expect(() => applyPacketSpelling(third, [twice])).toThrow(/maritial/);
  });

  it("keeps no misspelling in the text layer, and every correction in it", async () => {
    const doc = await load();
    applyPacketSpelling(doc);
    for (const e of PACKET_SPELLING) {
      const page = packetLineTexts(doc, e.page - 1).join("\n");
      expect(page, `p${e.page} ${e.right}`).toContain(e.right);
      // `wil` → `will` leaves `wil` inside the correction; only a typo that is not part of its fix can be absent.
      if (!e.right.includes(e.wrong)) expect(page, `p${e.page} ${e.wrong}`).not.toContain(e.wrong);
    }
  });

  /**
   * ⚠ **The independent ruler.** The test above only asks about entries STILL in the register, so
   * deleting one — `BACKFROUNG` from page 12 — passed it: measured by mutation, 2026-09-25. This list
   * is the audit itself (every page read, and spell-checked against a dictionary, on that date), kept
   * apart from the register on purpose: a typo is gone from the paper only if it is gone from here.
   */
  it("prints none of the typing errors the 2026-09-25 audit found on the carrier's paper", async () => {
    const doc = await load();
    applyPacketSpelling(doc);
    const paper = Array.from({ length: 31 }, (_, i) => packetLineTexts(doc, i).join("\n")).join("\n");
    const AUDITED = [
      "maritial", "reisdency", "FORFEITTURES", "typyes", "concerningmy", "fromDOT", "concering", "whcihc",
      "emploment", "Prevous", "prevous", "clasess", "recless", "violatinos", "accidnets", "birht",
      "Misdemenors", "examinded", "incarccerated", "IMPOREPER", "OVERWIGHT", "CONDTION", "RECIVED",
      "EXEPTED", "MANGER", "indepenent", "contractos", "unquilifed", "unathorized", "Unathorized", "ddrive",
      "arenot", "licnse", "overwight", "praking", "disqualifation", "withing", "resultin", "immedicately",
      "ATTACGED", "forgoing", "parrk", "ellective", "commerical", "SINGED", "inquires", "heatlh",
      "employement", "applicaton", "previuous", "€", "BACKFROUNG", "preiod", "Operaton", "infromation",
      "ahuthorize", "emplyer", "emplyment", "adultered", "preivious", "certy", "prvious", "emloyers",
      "paragrafs", "emplyers", "requlated", "emplyed", "howerver", "applicanthas", "benfit",
      "This references", "1 am not", "faxes", "buck every", "COMERCIAL", "T he", "168lu", "Carier",
      "firt", "Cartist", "carrer", "must he signed", "signatrure", "reprsentative", "QUATERLY",
      "regarded to provide", "ail violates", "orbond", "Seurity", "s solutions", "parting violations",
      "forfeited band", "shelf review", "to quality", "familirize", "requred", "eluded", "und get",
      "followign", "informend", "fues", "expalined", "Safety Registration", "Administraton",
      "administrated", "than relived", "helth", "serivces", "beneft", "disptacher", "Untill", "statue",
      "at trail", "if l do", "one arbitration", "natural arbitrator", "bending on", "he appeasable",
      "force or correction", "has red", "to the extend", "contract i agree", "they above", "with to review",
    ];
    const left = AUDITED.filter((typo) => paper.includes(typo));
    expect(left).toEqual([]);
    // Guards the guard: the same list, read against the carrier's ORIGINAL paper, finds them all —
    // except the one that spans a printed line break, which no single line can hold.
    const raw = await load();
    const given = Array.from({ length: 31 }, (_, i) => packetLineTexts(raw, i).join("\n")).join("\n");
    expect(AUDITED.filter((typo) => !given.includes(typo))).toEqual(["force or correction"]);
  });

  /**
   * ⚠ The layout claim, read back from the produced document rather than trusted. Every line on the
   * carrier's paper is clipped to a rectangle; a grown line either still fits, was re-centred,
   * widened its rectangle into free space, or was condensed. Whatever happened: nothing may reach
   * past its rectangle that did not already on the carrier's own paper (three lines do, by trailing
   * spaces only), and no rectangle may come to overlap another.
   */
  it("runs no corrected line past its cell, and pushes no cell into another", async () => {
    const before = await load();
    const after = await load();
    applyPacketSpelling(after);
    for (let page = 1; page <= 31; page++) {
      const was = packetClipReport(before, page);
      const now = packetClipReport(after, page);
      expect(now.overruns.length, `page ${page} overruns`).toBe(was.overruns.length);
      expect(now.overlaps, `page ${page} overlapping cells`).toBe(was.overlaps);
    }
  });

  it("condenses nothing noticeably — every corrected line prints at 97% width or more", async () => {
    const fits = applyPacketSpelling(await load());
    expect(fits.length).toBeGreaterThan(100);
    expect(fits.filter((f) => f.scale < 97)).toEqual([]);
  });
});

/**
 * `packetText.ts` quotes the carrier's headings onto the continuation sheet, which is attached to the
 * packet it continues — so its strings must read what the page above them prints.
 */
describe("the carrier's words quoted elsewhere", () => {
  const PAGE_OF: Record<string, number> = { P1: 1, P2: 2, P12: 12, P16: 16, P26: 26 };
  const strings = (o: unknown): string[] =>
    typeof o === "string" ? [o]
    : Array.isArray(o) ? o.flatMap(strings)
    : o && typeof o === "object" ? Object.values(o).flatMap(strings)
    : [];

  it("carries none of the register's misspellings in packetText.ts", () => {
    const left: string[] = [];
    for (const [name, page] of Object.entries(PAGE_OF)) {
      for (const s of strings((PACKET_TEXT as Record<string, unknown>)[name])) {
        for (const e of PACKET_SPELLING.filter((x) => x.page === page && !x.right.includes(x.wrong))) {
          if (s.includes(e.wrong)) left.push(`${name}: ${e.wrong}`);
        }
      }
    }
    expect(left).toEqual([]);
  });
});
