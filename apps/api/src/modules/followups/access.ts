/**
 * Who may see and work which follow-ups (WARNING-DESK-PLAN D-WD1, D-WD13).
 *
 *  · `maintenance.follow-ups` — the desk, every category. Who works it is the Permissions page's answer
 *    (a role or one person, Q-WD1), never a role list written here.
 *  · `dispatch.route-follow-ups` — the Route category alone, on dispatch's own screen. Out of route is ONE
 *    record both screens show, so whoever handles it first closes it for both.
 *
 * Seeing needs the screen; ACTING also needs `manage` on the section behind that screen, so the auditor
 * and the accountant (maintenance: view) read the desk and change nothing. Both answers come from the
 * screen catalogue and the section matrix — `holdsSurface` checks the section gate first (D-SURF2).
 */
import type { Request } from "express";
import { callerCanManage, FOLLOW_UP_CATEGORIES, type FollowUpCategory } from "@silvicom/shared";
import { holdsSurface } from "../../middleware/requireSurface.js";

export const DESK_SURFACE = "maintenance.follow-ups";
export const ROUTE_SURFACE = "dispatch.route-follow-ups";
export const RULES_SURFACE = "maintenance.follow-ups.rules";

const holdsDesk = holdsSurface(DESK_SURFACE);
const holdsRoute = holdsSurface(ROUTE_SURFACE);

export interface DeskAccess {
  /** Categories the caller may see. Empty = neither screen. */
  categories: FollowUpCategory[];
  /** Categories the caller may act on. */
  actsOn: FollowUpCategory[];
}

export async function deskAccess(req: Request): Promise<DeskAccess> {
  const role = req.auth?.role ?? null;
  const sections = req.auth?.sections ?? null;
  if (await holdsDesk(req)) {
    const manages = callerCanManage(role, "maintenance", sections);
    // A maintenance viewer who also works dispatch's Route screen may still act on Route.
    const routeActs = !manages && callerCanManage(role, "dispatch", sections) && (await holdsRoute(req));
    return { categories: [...FOLLOW_UP_CATEGORIES], actsOn: manages ? [...FOLLOW_UP_CATEGORIES] : routeActs ? ["route"] : [] };
  }
  if (await holdsRoute(req)) {
    return { categories: ["route"], actsOn: callerCanManage(role, "dispatch", sections) ? ["route"] : [] };
  }
  return { categories: [], actsOn: [] };
}
