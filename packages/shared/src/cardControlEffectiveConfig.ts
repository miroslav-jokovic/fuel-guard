export type EffectiveOrigin = "card" | "policy" | "policy-overridden" | "policy-ignored";

export interface EffectiveRow<T> {
  value: T;
  origin: EffectiveOrigin;
}

/** Whether a merged row is actually enforced at the pump. */
export const isEnforced = (origin: EffectiveOrigin): boolean => origin === "card" || origin === "policy";
