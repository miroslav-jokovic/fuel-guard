import { FUEL_COSTS_QUERY_KEYS } from "./fuelCostsLinkContract.js";
import { FINDING_QUEUE_STATES, type FindingQueueState } from "./findingQueue.js";
import { QUEUE_FINDING_KINDS, type FindingKind } from "./findingAssignment.js";

/**
 * The Fuel problems page's URL (`/fuel-problems`), ONE definition read by the page and by Ask AI's
 * `open_view` (F21 Step 5, D-AI6; why a contract: `fuelCostsLinkContract.ts`).
 *
 * The window and the trucks are the spend filters' own keys (`useSpendFilters`, `FUEL_COSTS_QUERY_KEYS`):
 * the page shares them with Fuel costs on purpose, so they are not respelled here. `state` and `kind`
 * are comma-joined lists from the queue's own vocabularies; their ABSENCE is the page's default (the
 * three working states, every kind), so a link that says nothing opens the queue. `owner=me` is the
 * one owner filter the page has (Q-FUI4: no member directory yet).
 */
export const FUEL_PROBLEMS_QUERY_KEYS = {
  from: FUEL_COSTS_QUERY_KEYS.from,
  to: FUEL_COSTS_QUERY_KEYS.to,
  trucks: FUEL_COSTS_QUERY_KEYS.trucks,
  state: "state",
  kind: "kind",
  owner: "owner",
} as const;

export const FUEL_PROBLEMS_OWNER_ME = "me";

export interface FuelProblemsLinkFilters {
  from?: string;
  to?: string;
  vehicleIds?: readonly string[];
  states?: readonly FindingQueueState[];
  kinds?: readonly FindingKind[];
  mine?: boolean;
}

export function fuelProblemsToQuery(f: FuelProblemsLinkFilters): Record<string, string> {
  const K = FUEL_PROBLEMS_QUERY_KEYS;
  const q: Record<string, string> = {};
  if (f.from) q[K.from] = f.from;
  if (f.to) q[K.to] = f.to;
  if (f.vehicleIds?.length) q[K.trucks] = f.vehicleIds.join(",");
  if (f.states?.length) q[K.state] = f.states.join(",");
  if (f.kinds?.length) q[K.kind] = f.kinds.join(",");
  if (f.mine) q[K.owner] = FUEL_PROBLEMS_OWNER_ME;
  return q;
}

/** The queue states and kinds a link may name: the page's own lists, so the two cannot differ. */
export const FUEL_PROBLEMS_LINK_STATES: readonly FindingQueueState[] = FINDING_QUEUE_STATES;
export const FUEL_PROBLEMS_LINK_KINDS: readonly FindingKind[] = QUEUE_FINDING_KINDS;
