import type { AssetTypeDto, StickerCode } from "@silvicom/shared";

/**
 * Where one barcode off a tablet's sticker goes in the Add equipment form (M9b). `readStickerCode`
 * (shared) says WHAT the code is; this says what the form does with it.
 *
 * ── A READ NEVER OVERWRITES WHAT IS ALREADY THERE ─────────────────────────────────────────────
 * A dual-SIM tablet prints two IMEIs, and an unknown model number reads as a serial; scanning in any
 * order must not let the second barcode silently replace the first. So a filled field keeps its value
 * and the note says what was set aside — one tap to fix, never a wrong tablet saved.
 *
 * ── THE TYPE AND THE NAME ARE OFFERED, NEVER INVENTED ─────────────────────────────────────────
 * An IMEI or a maker's model means a device. If exactly one type is held by a driver (0524's
 * `held_by`, the tablet — tablets follow the driver, D-DE1), that type is chosen; otherwise the
 * person picks, because guessing among types by their names is the rule 0524 refused. The name is
 * the maker and model ("Samsung SM-T575"), or the type's name, and it follows the sticker only
 * while the person has not typed a name of their own (`autoName`).
 */
export interface StickerForm {
  assetTypeId: string;
  name: string;
  serialNumber: string;
  imei: string;
  model: string;
  manufacturer: string;
}

export interface StickerFill {
  patch: Partial<StickerForm>;
  /** What was set aside, in a sentence; null when the read went where it belonged. */
  note: string | null;
}

export function fillFromSticker(
  form: StickerForm,
  code: StickerCode,
  types: readonly AssetTypeDto[],
  /** The name the sticker last filled in; the name follows the sticker while it still equals this. */
  autoName: string,
): StickerFill {
  const patch: Partial<StickerForm> = {};
  let note: string | null = null;

  if (code.kind === "imei") {
    if (!form.imei || form.imei === code.imei) patch.imei = code.imei;
    else note = `A second IMEI (${code.imei}) — a dual-SIM tablet has two. The first one is kept; change the IMEI field if that was the wrong one.`;
  } else if (code.kind === "serial") {
    if (!form.serialNumber || form.serialNumber === code.serial) patch.serialNumber = code.serial;
    else note = `Another code (${code.serial}) — the serial already reads ${form.serialNumber}. Type it in if this one is right.`;
  } else if (code.kind === "model") {
    if (!form.model) patch.model = code.model;
    if (!form.manufacturer) patch.manufacturer = code.manufacturer;
  } else {
    return { patch, note: null };
  }

  if (!form.assetTypeId && (code.kind === "imei" || code.kind === "model")) {
    const driverTypes = types.filter((t) => t.heldBy === "driver");
    if (driverTypes.length === 1) patch.assetTypeId = driverTypes[0]!.id;
  }

  if (!form.name || form.name === autoName) {
    const next = { ...form, ...patch };
    const typeName = types.find((t) => t.id === next.assetTypeId)?.name ?? "";
    const name = [next.manufacturer, next.model].filter(Boolean).join(" ") || typeName;
    if (name) patch.name = name;
  }
  return { patch, note };
}
