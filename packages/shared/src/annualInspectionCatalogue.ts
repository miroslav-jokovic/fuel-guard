/**
 * The §396.17 annual vehicle inspection item catalogue — D-AVI1, D-AVI2
 * (`docs/plans/maintenance/ANNUAL-INSPECTION-PLAN.md`).
 *
 * ── WHY THIS IS AUTHORED FROM APPENDIX A AND NOT FROM THE FORM ───────────────────────────────────
 * The office fills a J.J. Keller form 14834 (Rev. 1/22), and D-AVI7 says the printed page stays that
 * form. But the page is Keller's copyrighted arrangement of a list that belongs to the government:
 * **Appendix A to 49 CFR Part 396**, "Minimum Periodic Inspection Standards", whose fifteen numbered
 * groups are exactly this form's groups 1–15. So the product reasons about Appendix A and merely
 * *prints* onto Keller's layout. That separation is what makes the template a coordinate map rather
 * than a dependency — swapping the page is a new map, not a new domain model.
 *
 * Keller's group 16 ("list any other condition which may prevent safe operation") has no Appendix A
 * counterpart and is not an item here: it is free text on the report row, not a pass/fail component.
 *
 * ── THE COUNT, AND THE STRAY MARK THAT EXPLAINS WHY THE SAMPLE IS NOT THE SOURCE ────────────────
 * 56 items. The filled sample this plan was measured from carries **57** marks: group 7's item (c)
 * wraps onto a second printed line ("Front Axle Beam/All" / "Other Steering Components") and the
 * inspector marked both halves. One component, two ticks — harmless on paper, and precisely the
 * class of thing a catalogue removes. Counted 2026-08-31 against the coordinates in the plan's §1.
 *
 * ── VERSIONING (D-AVI1) ─────────────────────────────────────────────────────────────────────────
 * Every inspection stores the version it was taken under, so a report renders as it was inspected
 * after this file changes. Same reasoning as `DERIVER_VERSION` and the versioned hazmat data: the
 * regulation moves, and evidence may not be retroactively rewritten by a deploy.
 */

/**
 * Bump on ANY change to the item set, a key, or a default. Reports pin it; the renderer prints it.
 * Minor for wording, major for an item appearing, disappearing or changing meaning.
 */
export const INSPECTION_CATALOGUE_VERSION = "1.0.0";

/** What can be inspected. Mirrors `documents.subject_type`'s equipment half (0146). */
export const INSPECTION_SUBJECT_TYPES = ["tractor", "trailer"] as const;
export type InspectionSubjectType = (typeof INSPECTION_SUBJECT_TYPES)[number];

/**
 * The three marks the form's own instruction line defines: "✔ OK, X NEEDS REPAIR, NA IF ITEMS DO
 * NOT APPLY". Stored as words rather than glyphs — see the plan's §2.5: pdf-lib's standard fonts
 * are WinAnsi and throw outright on U+2714, so the page is stamped `Ok` / `X` / `N/A`.
 */
export const INSPECTION_RESULTS = ["ok", "needs_repair", "na"] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

export interface InspectionGroup {
  readonly number: number;
  readonly title: string;
  /** The Appendix A paragraph this group is, so the UI and the report can both cite it. */
  readonly cfr: string;
}

export interface InspectionItem {
  /** Stable and never reused. A renamed label keeps its key; a changed meaning gets a new one. */
  readonly key: string;
  readonly group: number;
  readonly label: string;
  readonly cfr: string;
  /**
   * What the form opens this component on, per kind of equipment — **measured, not reasoned**.
   *
   * ── BOTH COLUMNS COME FROM REAL FILLED REPORTS ─────────────────────────────────────────────────
   * Tractor 654 (2026-06-16) and trailer 535968 (2026-08) — the two the office produced before any
   * of this was built. They differ on eighteen components and the surprises are the point: this is
   * a REEFER fleet, so a trailer's exhaust, fuel system, air compressor and tractor protection valve
   * are all marked `Ok`, where reasoning from "which parts a trailer has" would have said `N/A` and
   * been wrong. Coupling and steering go the other way.
   *
   * That is why this is transcribed rather than derived. An earlier version inferred the trailer
   * column from where a part normally lives and was wrong on seven items; the plan carried it as
   * §6 Q6 — "reasoned, not measured" — until the second form turned up.
   *
   * Truck and trailer share one form and one decal (owner, 2026-08-31): the difference IS this
   * table, plus the unit number. Nothing is locked — an inspector can change any of it.
   */
  readonly defaults: Record<InspectionSubjectType, InspectionResult>;
}

export const INSPECTION_GROUPS: readonly InspectionGroup[] = [
  { number: 1, title: "Brake system", cfr: "App. A ¶1" },
  { number: 2, title: "Coupling devices", cfr: "App. A ¶2" },
  { number: 3, title: "Exhaust system", cfr: "App. A ¶3" },
  { number: 4, title: "Fuel system", cfr: "App. A ¶4" },
  { number: 5, title: "Lighting devices", cfr: "App. A ¶5" },
  { number: 6, title: "Safe loading", cfr: "App. A ¶6" },
  { number: 7, title: "Steering mechanism", cfr: "App. A ¶7" },
  { number: 8, title: "Suspension", cfr: "App. A ¶8" },
  { number: 9, title: "Frame", cfr: "App. A ¶9" },
  { number: 10, title: "Tires", cfr: "App. A ¶10" },
  { number: 11, title: "Wheels and rims", cfr: "App. A ¶11" },
  { number: 12, title: "Windshield glazing", cfr: "App. A ¶12" },
  { number: 13, title: "Windshield wipers", cfr: "App. A ¶13" },
  { number: 14, title: "Motorcoach seats", cfr: "App. A ¶14" },
  { number: 15, title: "Rear impact guard", cfr: "App. A ¶15" },
] as const;

/**
 * The 56 components, in the form's printed order — which is Appendix A's order, and which the
 * coordinate map's bijection test (A5) pins cell-for-cell.
 */
export const INSPECTION_ITEMS: readonly InspectionItem[] = [
  // 1 — Brake system. (i)–(k) are `na` on this fleet's air-braked equipment, not in general.
  { key: "brake.service_brakes", group: 1, label: "Service brakes", cfr: "App. A ¶1(a)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "brake.parking_system", group: 1, label: "Parking brake system", cfr: "App. A ¶1(b)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "brake.drums_rotors", group: 1, label: "Brake drums or rotors", cfr: "App. A ¶1(c)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "brake.hose", group: 1, label: "Brake hose", cfr: "App. A ¶1(d)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "brake.tubing", group: 1, label: "Brake tubing", cfr: "App. A ¶1(e)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "brake.low_pressure_warning", group: 1, label: "Low pressure warning device", cfr: "App. A ¶1(f)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "brake.tractor_protection_valve", group: 1, label: "Tractor protection valve", cfr: "App. A ¶1(g)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "brake.air_compressor", group: 1, label: "Air compressor", cfr: "App. A ¶1(h)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "brake.electric", group: 1, label: "Electric brakes", cfr: "App. A ¶1(i)", defaults: { tractor: "na", trailer: "na" } },
  { key: "brake.hydraulic", group: 1, label: "Hydraulic brakes", cfr: "App. A ¶1(j)", defaults: { tractor: "na", trailer: "na" } },
  { key: "brake.vacuum", group: 1, label: "Vacuum systems", cfr: "App. A ¶1(k)", defaults: { tractor: "na", trailer: "na" } },
  { key: "brake.antilock", group: 1, label: "Antilock brake system", cfr: "App. A ¶1(l)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "brake.automatic_adjusters", group: 1, label: "Automatic brake adjusters", cfr: "App. A ¶1(m)", defaults: { tractor: "ok", trailer: "ok" } },

  // 2 — Coupling devices. The fifth wheel is the tractor's half, the kingpin side rides the trailer.
  { key: "coupling.fifth_wheel", group: 2, label: "Fifth wheels", cfr: "App. A ¶2(a)", defaults: { tractor: "ok", trailer: "na" } },
  { key: "coupling.pintle_hooks", group: 2, label: "Pintle hooks", cfr: "App. A ¶2(b)", defaults: { tractor: "na", trailer: "na" } },
  { key: "coupling.drawbar_eye", group: 2, label: "Drawbar/towbar eye", cfr: "App. A ¶2(c)", defaults: { tractor: "ok", trailer: "na" } },
  { key: "coupling.drawbar_tongue", group: 2, label: "Drawbar/towbar tongue", cfr: "App. A ¶2(d)", defaults: { tractor: "na", trailer: "na" } },
  { key: "coupling.safety_devices", group: 2, label: "Safety devices", cfr: "App. A ¶2(e)", defaults: { tractor: "ok", trailer: "na" } },
  { key: "coupling.saddle_mounts", group: 2, label: "Saddle-mounts", cfr: "App. A ¶2(f)", defaults: { tractor: "na", trailer: "na" } },

  // 3 — Exhaust. A trailer has no engine; the whole group is the power unit's.
  { key: "exhaust.no_leaks_at_cab", group: 3, label: "No leaks forward of or directly below the driver/sleeper compartment", cfr: "App. A ¶3(a)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "exhaust.bus_discharge", group: 3, label: "Bus: no leaking or discharging in violation of standard", cfr: "App. A ¶3(b)", defaults: { tractor: "na", trailer: "na" } },
  { key: "exhaust.no_burn_risk", group: 3, label: "Unlikely to burn, char or damage wiring, fuel supply or any combustible part", cfr: "App. A ¶3(c)", defaults: { tractor: "ok", trailer: "ok" } },

  // 4 — Fuel system. Reefer tanks are inspected as part of the trailer's own equipment, not here.
  { key: "fuel.no_visible_leak", group: 4, label: "No visible leak", cfr: "App. A ¶4(a)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "fuel.filler_cap", group: 4, label: "Fuel tank filler cap", cfr: "App. A ¶4(b)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "fuel.tank_secure", group: 4, label: "Fuel tank securely attached", cfr: "App. A ¶4(c)", defaults: { tractor: "ok", trailer: "ok" } },

  // 5 — Lighting. One line on the form, one component here.
  { key: "lighting.all_operable", group: 5, label: "All required lights and reflectors operable", cfr: "App. A ¶5 / §393.9", defaults: { tractor: "ok", trailer: "ok" } },

  // 6 — Safe loading.
  { key: "safe_loading.parts_secured", group: 6, label: "Vehicle parts, load, dunnage, spare tire etc. secured", cfr: "App. A ¶6(a)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "safe_loading.front_end_structure", group: 6, label: "Front end structure", cfr: "App. A ¶6(b)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "safe_loading.intermodal_securement", group: 6, label: "Intermodal container securement devices", cfr: "App. A ¶6(c)", defaults: { tractor: "na", trailer: "na" } },

  // 7 — Steering. Entirely the power unit's; a trailer is steered by the tractor.
  { key: "steering.wheel_free_play", group: 7, label: "Steering wheel free play", cfr: "App. A ¶7(a)", defaults: { tractor: "ok", trailer: "na" } },
  { key: "steering.column", group: 7, label: "Steering column", cfr: "App. A ¶7(b)", defaults: { tractor: "ok", trailer: "na" } },
  { key: "steering.front_axle_beam", group: 7, label: "Front axle beam and all other steering components", cfr: "App. A ¶7(c)", defaults: { tractor: "ok", trailer: "na" } },
  { key: "steering.gear_box", group: 7, label: "Steering gear box", cfr: "App. A ¶7(d)", defaults: { tractor: "ok", trailer: "na" } },
  { key: "steering.pitman_arm", group: 7, label: "Pitman arm", cfr: "App. A ¶7(e)", defaults: { tractor: "ok", trailer: "na" } },
  { key: "steering.power_steering", group: 7, label: "Power steering", cfr: "App. A ¶7(f)", defaults: { tractor: "ok", trailer: "na" } },
  { key: "steering.ball_socket_joints", group: 7, label: "Ball and socket joints", cfr: "App. A ¶7(g)", defaults: { tractor: "ok", trailer: "na" } },
  { key: "steering.tie_rods_drag_links", group: 7, label: "Tie rods and drag links", cfr: "App. A ¶7(h)", defaults: { tractor: "ok", trailer: "na" } },
  { key: "steering.nuts", group: 7, label: "Nuts", cfr: "App. A ¶7(i)", defaults: { tractor: "ok", trailer: "na" } },
  { key: "steering.system", group: 7, label: "Steering system", cfr: "App. A ¶7(j)", defaults: { tractor: "ok", trailer: "na" } },

  // 8 — Suspension.
  { key: "suspension.axle_positioning", group: 8, label: "Axle positioning parts", cfr: "App. A ¶8(a)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "suspension.spring_assembly", group: 8, label: "Spring assembly", cfr: "App. A ¶8(b)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "suspension.torque_radius_tracking", group: 8, label: "Torque, radius or tracking components", cfr: "App. A ¶8(c)", defaults: { tractor: "ok", trailer: "ok" } },

  // 9 — Frame. Sliding subframes are a trailer feature; a tractor answers `na`.
  { key: "frame.members", group: 9, label: "Frame members", cfr: "App. A ¶9(a)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "frame.tire_wheel_clearance", group: 9, label: "Tire and wheel clearance", cfr: "App. A ¶9(b)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "frame.adjustable_axle", group: 9, label: "Adjustable axle assemblies (sliding subframes)", cfr: "App. A ¶9(c)", defaults: { tractor: "na", trailer: "ok" } },

  // 10 — Tires. §393.75(b)/(c): 4/32" on a steering axle, 2/32" everywhere else.
  { key: "tires.steer_axle", group: 10, label: "Steer-axle tires", cfr: "App. A ¶10(a) / §393.75(b)", defaults: { tractor: "ok", trailer: "na" } },
  { key: "tires.all_other", group: 10, label: "All other tires", cfr: "App. A ¶10(b) / §393.75(c)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "tires.speed_restricted", group: 10, label: "Speed-restricted tires", cfr: "App. A ¶10(c)", defaults: { tractor: "na", trailer: "na" } },

  // 11 — Wheels and rims. Lock rings and welded repairs are `na` on this fleet's wheels.
  { key: "wheels.lock_or_side_ring", group: 11, label: "Lock or side ring", cfr: "App. A ¶11(a)", defaults: { tractor: "na", trailer: "na" } },
  { key: "wheels.wheels_and_rims", group: 11, label: "Wheels and rims", cfr: "App. A ¶11(b)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "wheels.fasteners", group: 11, label: "Fasteners", cfr: "App. A ¶11(c)", defaults: { tractor: "ok", trailer: "ok" } },
  { key: "wheels.welds", group: 11, label: "Welds", cfr: "App. A ¶11(d)", defaults: { tractor: "na", trailer: "na" } },

  // 12–15 — the single-component groups.
  { key: "windshield.glazing", group: 12, label: "No cracks, discoloration or obstructions (see §393.60 for exceptions)", cfr: "App. A ¶12 / §393.60", defaults: { tractor: "ok", trailer: "na" } },
  { key: "wipers.operable", group: 13, label: "No missing, damaged or inoperable wipers", cfr: "App. A ¶13 / §393.78", defaults: { tractor: "ok", trailer: "na" } },
  { key: "motorcoach_seats.secure", group: 14, label: "Seats securely fastened to the vehicle structure", cfr: "App. A ¶14", defaults: { tractor: "na", trailer: "na" } },
  { key: "rear_impact_guard.present", group: 15, label: "In place, securely attached, proper size and placement (see §393.86)", cfr: "App. A ¶15 / §393.86", defaults: { tractor: "na", trailer: "ok" } },
] as const;

/** How many components a complete report answers, for both the UI's counter and the A5 bijection. */
export const INSPECTION_ITEM_COUNT = INSPECTION_ITEMS.length;

const ITEMS_BY_KEY: ReadonlyMap<string, InspectionItem> = new Map(
  INSPECTION_ITEMS.map((i) => [i.key, i] as const),
);

export function inspectionItem(key: string): InspectionItem | undefined {
  return ITEMS_BY_KEY.get(key);
}

/** The answer the form opens on (D-AVI13) — straight off the measured column. */
export function defaultInspectionResult(
  item: InspectionItem,
  subjectType: InspectionSubjectType,
): InspectionResult {
  return item.defaults[subjectType];
}

/** Every item with the answer the form opens on — what A4 seeds a draft's item rows from. */
export function defaultInspectionItems(
  subjectType: InspectionSubjectType,
): { key: string; result: InspectionResult }[] {
  return INSPECTION_ITEMS.map((item) => ({
    key: item.key,
    result: defaultInspectionResult(item, subjectType),
  }));
}
