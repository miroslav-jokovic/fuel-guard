import { z } from "zod";

/**
 * A truck's J1939 fault codes as Samsara reports them, pure (OUT-OF-ROUTE-MAP-ANALYSIS-2026-11-27 §7,
 * D-ORM8–D-ORM10). Samsara's payload is parsed in `modules/samsara` only (docs/ARCHITECTURE.md §2); this
 * file holds what a code IS once parsed, and the two judgements the screen makes about a list of them.
 *
 * ── WHAT A CODE CARRIES (measured on the live fleet, 2026-11-27: 290 codes on 136 of 254 vehicles) ──
 * `spn` (what is wrong) and `fmi` (how it is wrong) are the two numbers a shop's own diagnostic tool
 * looks up; `module` is the J1939 source address of the controller that raised it (Samsara's `txId`),
 * and `moduleName` Samsara's name for that address. Every one of the 24 addresses seen came with the
 * same name each time (0 "Engine #1", 61 "Exhaust Emission Controller", 232 "Forward Road Image
 * Processor"…), so grouping reads the NUMBER, which a renamed label cannot move.
 *
 * ── "MANUFACTURER ASSIGNABLE SPN" (Q-ORM8, ruled (a) 2026-11-27) ─────────────────────────────────
 * 155 of the 290 (53%) carry that text instead of a description: the engine maker defines them and
 * Samsara has no words for them. They are flagged `makerSpecific` with no description, so the screen
 * says "maker-specific code" and shows SPN/FMI and the module for the shop's tool — no OEM table is
 * bought or guessed at. The flag is Samsara's own text, not an SPN range of ours.
 */
export const truckFaultCodeSchema = z.object({
  /** J1939 source address of the controller (Samsara `txId`); null when Samsara omits it. */
  module: z.number().int().nonnegative().nullable(),
  moduleName: z.string().nullable(),
  spn: z.number().int().nonnegative(),
  fmi: z.number().int().nonnegative().nullable(),
  /** Samsara's description of the SPN; null when it has none or the code is maker-specific. */
  description: z.string().nullable(),
  fmiDescription: z.string().nullable(),
  makerSpecific: z.boolean(),
  occurrences: z.number().int().nonnegative().nullable(),
});
export type TruckFaultCode = z.infer<typeof truckFaultCodeSchema>;

export const truckLampStateSchema = z.object({
  stop: z.boolean(),
  warning: z.boolean(),
  emissions: z.boolean(),
  protect: z.boolean(),
});
export type TruckLampState = z.infer<typeof truckLampStateSchema>;

/**
 * Which follow-ups show the truck's codes (Q-ORM6, ruled (a) 2026-11-27): every maintenance follow-up
 * on a truck — a battery or a tire follow-up is often explained by a code. A trailer's has no engine
 * controllers to read, and a route or safety line is not the shop's. The API answers by it and the
 * drawer mounts by it, so the two cannot disagree.
 */
export function followUpHasTruckCodes(f: { category: string; subjectKind: string }): boolean {
  return f.category === "maintenance" && f.subjectKind === "truck";
}

/** One fault-code reading: the codes a truck reported at one moment. */
export interface TruckFaultSnapshot {
  at: string;
  codes: TruckFaultCode[];
}

/**
 * Which list a code is drawn in (Q-ORM7, ruled (a)): every code is shown, the truck's own systems
 * first, and the codes of the cameras, the radar and the telematics units folded under their own
 * heading. Measured 2026-11-27, those five addresses raised 99 of the 290 live codes — a third of the
 * list, and not one a mechanic fixes with a wrench:
 *   232 Forward Road Image Processor (41) · 42 Headway Controller — the following-distance radar (19)
 *   · 74 Communications Unit, Cellular (28) · 37 Off Vehicle Gateway (10) · 76 Communications Unit, Radio (1)
 * Anything not on this list — including an address never seen before — is drawn with the truck's own,
 * so an unknown controller is never hidden.
 */
export const ELECTRONICS_MODULE_ADDRESSES: ReadonlySet<number> = new Set([37, 42, 74, 76, 232]);
export type FaultCodeGroup = "vehicle" | "electronics";
export function faultCodeGroup(code: Pick<TruckFaultCode, "module">): FaultCodeGroup {
  return code.module !== null && ELECTRONICS_MODULE_ADDRESSES.has(code.module) ? "electronics" : "vehicle";
}

/** One code's identity: the same SPN and FMI from the same controller is the same code. */
export const faultCodeKey = (c: Pick<TruckFaultCode, "module" | "spn" | "fmi">): string => `${c.module ?? "-"}:${c.spn}:${c.fmi ?? "-"}`;

export interface FaultCodeSeen extends TruckFaultCode {
  firstSeen: string;
  lastSeen: string;
}

/**
 * The codes that came and went: in at least one reading of the window, and not on the truck now
 * (D-ORM9). Samsara's history records a reading when the codes CHANGE (measured: 0 readings in 30
 * days on a truck whose 14 codes never moved, 741 on a busy one), so `lastSeen` is the last reading
 * that still had the code — it cleared at the next one. Newest first.
 */
export function faultCodesCameAndWent(history: readonly TruckFaultSnapshot[], now: readonly TruckFaultCode[]): FaultCodeSeen[] {
  const onNow = new Set(now.map(faultCodeKey));
  const seen = new Map<string, FaultCodeSeen>();
  const ordered = [...history].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const snap of ordered) {
    for (const c of snap.codes) {
      const key = faultCodeKey(c);
      if (onNow.has(key)) continue;
      const prev = seen.get(key);
      // The newest reading's words win: Samsara's occurrence count only grows while a code is active.
      seen.set(key, { ...c, firstSeen: prev?.firstSeen ?? snap.at, lastSeen: snap.at });
    }
  }
  return [...seen.values()].sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
}

/**
 * Where "came and went" starts (D-ORM9): a day before the follow-up's first warning — Samsara writes a
 * reading only on a change, so a code already on when the follow-up opened and cleared later is only
 * seen in a reading from before it — and never more than 30 days back (a 30-day read measured ≤ 2
 * pages, ≤ 483 ms, ≤ 124 KB on the four busiest trucks). `capped` says the 30 days cut it.
 */
export const FAULT_CODE_LEAD_MS = 24 * 3_600_000;
export const FAULT_CODE_MAX_DAYS = 30;
export function faultCodeWindow(firstAtIso: string, untilMs: number): { sinceIso: string; capped: boolean } {
  const wanted = Date.parse(firstAtIso) - FAULT_CODE_LEAD_MS;
  const earliest = untilMs - FAULT_CODE_MAX_DAYS * 86_400_000;
  return wanted < earliest
    ? { sinceIso: new Date(earliest).toISOString(), capped: true }
    : { sinceIso: new Date(wanted).toISOString(), capped: false };
}
