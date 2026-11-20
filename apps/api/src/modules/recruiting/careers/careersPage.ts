import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normaliseEmail,
  normalisePhone,
  openingUnpublishedReason,
  type CareersPageSave,
  type CareersPageStatus,
  type OpeningFacts,
} from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { listOpenings } from "../leads/hiringSetup.js";

/**
 * The careers page's row (APPLY-PAGE-PLAN AP1; 0641's `recruiting_careers_pages`): read and saved by Settings ›
 * Recruiting, read by the public page (AP2). Every query here is scoped to the caller's org; the one lookup by
 * handle alone is the public page's, in its own file.
 */

interface CareersPageRow {
  id: string;
  handle: string;
  enabled: boolean;
  accommodation_email: string | null;
  accommodation_phone: string | null;
}

const COLUMNS = "id, handle, enabled, accommodation_email, accommodation_phone";

async function readRow(admin: SupabaseClient, orgId: string): Promise<CareersPageRow | null> {
  const { data, error } = await admin.from("recruiting_careers_pages").select(COLUMNS).eq("org_id", orgId).maybeSingle();
  if (error) throw new Error(`recruiting_careers_pages: ${error.message}`);
  return data as CareersPageRow | null;
}

/** `<WEB_APP_URL>/careers/<handle>`: the SPA serves the page; the API only answers it. */
export const careersPageUrl = (env: Env, handle: string): string => `${env.WEB_APP_URL.replace(/\/+$/, "")}/careers/${handle}`;

export async function readCareersPage(admin: SupabaseClient, env: Env, orgId: string): Promise<CareersPageStatus> {
  const [row, openings] = await Promise.all([readRow(admin, orgId), listOpenings(admin, orgId)]);
  return {
    configured: row !== null,
    handle: row?.handle ?? null,
    enabled: row?.enabled ?? false,
    accommodationEmail: row?.accommodation_email ?? null,
    accommodationPhone: row?.accommodation_phone ?? null,
    publicUrl: row ? careersPageUrl(env, row.handle) : null,
    robotCheckReady: Boolean(env.TURNSTILE_SECRET_KEY),
    // A closed opening is history; the office does not need it listed against the page.
    openings: openings
      .filter((o) => o.status !== "closed")
      .map((o) => {
        const current = o.current as { title: string; facts: OpeningFacts } | null;
        return { id: o.id, title: current?.title ?? null, status: o.status, unpublished: openingUnpublishedReason(o.status, current) };
      }),
  };
}

export interface CareersPageRefusal {
  status: number;
  code: string;
  message: string;
}
export const isCareersPageRefusal = (v: unknown): v is CareersPageRefusal =>
  typeof v === "object" && v !== null && "code" in v && "status" in v;

export interface SavedCareersPage {
  before: { handle: string; enabled: boolean } | null;
}

export async function saveCareersPage(
  admin: SupabaseClient,
  orgId: string,
  actorId: string,
  input: CareersPageSave,
  now: Date,
): Promise<SavedCareersPage | CareersPageRefusal> {
  const row = await readRow(admin, orgId);
  // The schema already refused a value these cannot read; null here means the field was left empty.
  const fields = {
    handle: input.handle,
    enabled: input.enabled,
    accommodation_email: input.accommodationEmail ? normaliseEmail(input.accommodationEmail) : null,
    accommodation_phone: input.accommodationPhone ? normalisePhone(input.accommodationPhone) : null,
    updated_by: actorId,
    updated_at: now.toISOString(),
  };
  const { error } = row
    ? await admin.from("recruiting_careers_pages").update(fields).eq("org_id", orgId).eq("id", row.id)
    : await admin.from("recruiting_careers_pages").insert({ org_id: orgId, ...fields });
  if (error) {
    // Only the handle's own unique key is "taken"; the org's (two first saves racing) is a plain failure, and the
    // second press then finds the row and updates it.
    if ((error as { code?: string }).code === "23505" && error.message.includes("recruiting_careers_pages_handle_key")) {
      return { status: 409, code: "careers_handle_taken", message: "Another Silvicom 360 account already uses this address. Choose another." };
    }
    throw new Error(`recruiting_careers_pages: ${error.message}`);
  }
  return { before: row ? { handle: row.handle, enabled: row.enabled } : null };
}
