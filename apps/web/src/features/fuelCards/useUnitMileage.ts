import { ref } from "vue";
import type { EfsMileageCode } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";

/**
 * Reading and correcting the odometer EFS holds for a unit (`docs/37` §6 D, E′).
 *
 * ── Why this is not vue-query, unlike every other fuel-card read ────────────────────────────────
 * `useEfsCards` caches because the card list is a VIEW — the same data serves every visitor and a
 * stale second is harmless. This is a lookup inside a form, and the value it fetches is the thing
 * the operator is about to overwrite. A cached reading here would mean confirming a correction
 * against a number that is no longer true, on an operation whose whole difficulty is that the
 * vendor never tells you what it did (§3). So every look-up is a fresh call, and the reading shown
 * after a write comes from the API's own verifying re-read rather than from a refetch we schedule.
 *
 * ── Not a capability, and therefore not `useOperationDispatch` ──────────────────────────────────
 * The card operations all go through the capability registry: ledger row, idempotency key,
 * step-up, reconciler. This write targets a UNIT and that ledger keys on a card, so §4 and §6
 * chose a plain audited write instead. Routing it through `useOperationDispatch` would need a
 * capability key the registry does not have.
 */

/** What EFS holds for one unit right now. The comparison fields the API also returns are
 *  deliberately not read here — see `UnitMileageDrawer.vue`. */
export interface UnitMileageReading {
  unit: string;
  code: EfsMileageCode;
  /** Null when EFS holds no reading for this unit — not zero, which would mean a new truck. */
  efsMileage: number | null;
  /** False when no vehicle in this company carries this unit number. */
  knownVehicle: boolean;
}

/**
 * Three-valued plus one, and every value is a different sentence to an operator.
 *
 * `already_current` is not a failure and not a write: the API skips the dispatch when EFS already
 * holds the requested value, because a re-read afterwards would show that value whether or not the
 * vendor did anything (`services/efsMileageOverride.ts`).
 */
export type MileageLanding = "landed" | "not_landed" | "indeterminate" | "already_current";

export interface MileageOverrideOutcome {
  landing: MileageLanding;
  before: number | null;
  after: number | null;
  requested: number;
  unit: string;
  code: EfsMileageCode;
  dispatched: boolean;
}

export class UnitMileageError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "UnitMileageError";
  }
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await apiFetch<T>(path, { method, ...(body === undefined ? {} : { body }) });
  if (!res.ok) {
    throw new UnitMileageError(
      res.status,
      res.error?.code ?? "error",
      res.status === 429
        ? "Too many mileage writes just now — this is capped at three a minute. Try again shortly."
        : res.error?.message ?? "That did not work",
    );
  }
  return res.data as T;
}

export function useUnitMileage() {
  const reading = ref<UnitMileageReading | null>(null);
  const outcome = ref<MileageOverrideOutcome | null>(null);
  const looking = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);

  async function lookUp(unit: string, code: EfsMileageCode): Promise<void> {
    looking.value = true;
    error.value = null;
    // Cleared TOGETHER with the reading: a result panel left standing beside a freshly looked-up
    // different unit reads as that unit's outcome.
    outcome.value = null;
    reading.value = null;
    try {
      reading.value = await call<UnitMileageReading>(
        `/api/fuel-cards/unit-mileage?unit=${encodeURIComponent(unit)}&code=${code}`,
      );
    } catch (e) {
      error.value = e instanceof UnitMileageError ? e.message : "Could not reach EFS";
    } finally {
      looking.value = false;
    }
  }

  async function override(unit: string, code: EfsMileageCode, mileage: number): Promise<void> {
    saving.value = true;
    error.value = null;
    try {
      outcome.value = await call<MileageOverrideOutcome>("/api/fuel-cards/unit-mileage", "POST", { unit, code, mileage });
      /**
       * The reading is replaced from the OUTCOME's `after`, which is the API's verifying re-read —
       * not from a second look-up of our own. Two reads where the server already did one would
       * spend a vendor call to answer a question that has been answered, and could disagree with
       * the verdict shown beside it.
       */
      if (reading.value) reading.value = { ...reading.value, efsMileage: outcome.value.after };
    } catch (e) {
      error.value = e instanceof UnitMileageError ? e.message : "Could not reach EFS";
    } finally {
      saving.value = false;
    }
  }

  function reset(): void {
    reading.value = null;
    outcome.value = null;
    error.value = null;
  }

  return { reading, outcome, looking, saving, error, lookUp, override, reset };
}

/**
 * What the operator reads for each landing.
 *
 * Kept out of the component so the wording is testable, and because three of the four are cases
 * nobody will be looking at the screen for — they need to survive being written once and read at
 * the worst possible moment.
 */
export function landingNotice(o: MileageOverrideOutcome): { tone: "success" | "warning" | "error" | "info"; title: string; detail: string } {
  switch (o.landing) {
    case "landed":
      return {
        tone: "success",
        title: `EFS now holds ${o.after?.toLocaleString()} miles for unit ${o.unit}`,
        detail: "Confirmed by reading the value back from EFS after the write.",
      };
    case "already_current":
      return {
        tone: "info",
        title: `EFS already held ${o.requested.toLocaleString()} miles`,
        detail: "Nothing was sent. The reading was already the value you asked for.",
      };
    case "not_landed":
      return {
        tone: "error",
        title: "EFS did not take the change",
        detail:
          `The reading is still ${o.before?.toLocaleString() ?? "unchanged"}. EFS accepted the request and kept its `
          + "old value, so nothing about this truck has changed at the pump.",
      };
    case "indeterminate":
      return {
        tone: "warning",
        title: "The reading moved, but not to your number",
        detail:
          `You asked for ${o.requested.toLocaleString()} and EFS now holds ${o.after?.toLocaleString() ?? "something else"}. `
          + "The ELD feed writes this value too, so it may have updated between the write and the check. "
          + "Look it up again before deciding whether to repeat this.",
      };
  }
}
