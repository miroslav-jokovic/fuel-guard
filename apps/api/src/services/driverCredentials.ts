import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isValidDriverUsername,
  normalizeDriverUsername,
  toSyntheticDriverEmail,
  usernameFromName,
} from "@fuelguard/shared";
import { revokePushTokens } from "./notify.js";

/**
 * Company-issued driver credentials (DRIVER-CREDENTIALS-PLAN.md). Each login is a normal Supabase
 * Auth user behind a SYNTHETIC non-deliverable email, so the JWT-claims hook, RLS driver scopes and
 * sessions all behave exactly as today. The org owns the lifecycle: create → hand out the one-time
 * password → reset / disable / enable / revoke from the Drivers page. Passwords are generated here,
 * bcrypt-hashed by Supabase Auth, and NEVER stored, logged, or audited by this codebase.
 *
 * Session-cutoff honesty (audited, not assumed): supabase-js 2.x has no "sign out user by id" admin
 * call. Disable uses a BAN — refresh is refused immediately, so a live session dies within the JWT
 * lifetime (1h, D31) — plus a push-token revoke so fleet data stops reaching the phone at once.
 * Revoke deletes the auth user outright (refresh tokens die with it).
 */

export type DriverCredentialErrorCode =
  | "not_found"
  | "already_linked"
  | "no_login"
  | "username_taken"
  | "invalid_username"
  | "auth_error";

export class DriverCredentialError extends Error {
  constructor(
    message: string,
    public code: DriverCredentialErrorCode,
  ) {
    super(message);
    this.name = "DriverCredentialError";
  }
}

/** Ban far beyond any credential's life; lifted with "none" on enable. */
const BAN_FOREVER = "87600h"; // ~10 years

// Unambiguous alphabet (no 0/O, 1/l/I, or symbols that die in handwriting) — the password is handed
// to a driver on paper/text. 16 chars over 55 symbols ≈ 92 bits of entropy.
const PW_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PW_LENGTH = 16;

/** Crypto-random one-time password. Pure output; never persisted by us. */
export function generateDriverPassword(length = PW_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) out += PW_ALPHABET[randomInt(PW_ALPHABET.length)];
  return out;
}

interface DriverRow {
  id: string;
  full_name: string;
  user_id: string | null;
  app_username: string | null;
  samsara_username: string | null;
}

async function loadDriver(admin: SupabaseClient, orgId: string, driverId: string): Promise<DriverRow> {
  const { data } = await admin
    .from("drivers")
    .select("id, full_name, user_id, app_username, samsara_username")
    .eq("org_id", orgId)
    .eq("id", driverId)
    .maybeSingle();
  if (!data) throw new DriverCredentialError("Driver not found", "not_found");
  return data as DriverRow;
}

/** Resolve + validate the username: explicit → stored → Samsara alpha code → derived from the name. */
async function resolveUsername(
  admin: SupabaseClient,
  orgId: string,
  driver: DriverRow,
  explicit: string | undefined,
): Promise<string> {
  const candidate = normalizeDriverUsername(
    explicit ?? driver.app_username ?? driver.samsara_username ?? usernameFromName(driver.full_name),
  );
  if (!isValidDriverUsername(candidate)) {
    throw new DriverCredentialError(
      "Username must be 3–32 chars of a-z, 0-9, dot, dash or underscore (starting alphanumeric).",
      "invalid_username",
    );
  }
  const { data: clash } = await admin
    .from("drivers")
    .select("id")
    .eq("org_id", orgId)
    .eq("app_username", candidate)
    .neq("id", driver.id)
    .limit(1);
  if ((clash ?? []).length > 0) {
    throw new DriverCredentialError(`Username '${candidate}' is already taken.`, "username_taken");
  }
  return candidate;
}

export interface IssuedCredential {
  username: string;
  password: string; // shown once by the caller; never stored
}

/**
 * Create the driver's login: auth user (synthetic email) + `driver` membership (what the JWT hook
 * reads) + roster binding. Multi-step against two systems → explicit CLEANUP on partial failure so a
 * half-created login never wedges the driver (the auth user is deleted; membership cascades).
 */
export async function createDriverLogin(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  opts: { username?: string } = {},
): Promise<IssuedCredential> {
  const driver = await loadDriver(admin, orgId, driverId);
  if (driver.user_id) {
    throw new DriverCredentialError(
      "This driver already has a login — reset the password instead.",
      "already_linked",
    );
  }
  const username = await resolveUsername(admin, orgId, driver, opts.username);
  const password = generateDriverPassword();

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: toSyntheticDriverEmail(username),
    password,
    email_confirm: true, // synthetic address — nothing to confirm, nothing is ever sent
    user_metadata: { driver_id: driver.id, org_id: orgId, app_username: username },
  });
  if (createErr || !created?.user) {
    const taken = /already|registered|exists/i.test(createErr?.message ?? "");
    throw new DriverCredentialError(
      taken ? `Username '${username}' is already taken.` : (createErr?.message ?? "Could not create the login"),
      taken ? "username_taken" : "auth_error",
    );
  }
  const userId = created.user.id;

  const rollback = async () => {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined); // membership cascades with it
  };
  const { error: memberErr } = await admin
    .from("memberships")
    .insert({ org_id: orgId, user_id: userId, role: "driver" });
  if (memberErr) {
    await rollback();
    throw new DriverCredentialError(memberErr.message, "auth_error");
  }
  const { error: linkErr } = await admin
    .from("drivers")
    .update({
      user_id: userId,
      app_username: username,
      app_access_enabled: true,
      app_credential_created_at: new Date().toISOString(),
    })
    .eq("id", driver.id)
    .eq("org_id", orgId);
  if (linkErr) {
    await rollback();
    throw new DriverCredentialError(linkErr.message, "auth_error");
  }
  return { username, password };
}

/** New generated password (old sessions die at refresh / within the 1h JWT lifetime). */
export async function resetDriverPassword(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<IssuedCredential> {
  const driver = await loadDriver(admin, orgId, driverId);
  if (!driver.user_id || !driver.app_username) {
    throw new DriverCredentialError("This driver has no login to reset.", "no_login");
  }
  const password = generateDriverPassword();
  const { error } = await admin.auth.admin.updateUserById(driver.user_id, { password });
  if (error) throw new DriverCredentialError(error.message, "auth_error");
  await admin
    .from("drivers")
    .update({ app_credential_reset_at: new Date().toISOString() })
    .eq("id", driver.id)
    .eq("org_id", orgId);
  return { username: driver.app_username, password };
}

/** Temporary hold: ban (refresh refused immediately) + push tokens revoked. Roster row untouched. */
export async function disableDriverLogin(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<void> {
  const driver = await loadDriver(admin, orgId, driverId);
  if (!driver.user_id) throw new DriverCredentialError("This driver has no login.", "no_login");
  const { error } = await admin.auth.admin.updateUserById(driver.user_id, { ban_duration: BAN_FOREVER });
  if (error) throw new DriverCredentialError(error.message, "auth_error");
  await revokePushTokens(admin, driver.user_id);
  await admin
    .from("drivers")
    .update({ app_access_enabled: false })
    .eq("id", driver.id)
    .eq("org_id", orgId);
}

/** Lift the hold. */
export async function enableDriverLogin(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<void> {
  const driver = await loadDriver(admin, orgId, driverId);
  if (!driver.user_id) throw new DriverCredentialError("This driver has no login.", "no_login");
  const { error } = await admin.auth.admin.updateUserById(driver.user_id, { ban_duration: "none" });
  if (error) throw new DriverCredentialError(error.message, "auth_error");
  await admin
    .from("drivers")
    .update({ app_access_enabled: true })
    .eq("id", driver.id)
    .eq("org_id", orgId);
}

/**
 * Permanent removal: unlink the roster row FIRST (0116 makes the FK survivable either way), revoke
 * push tokens, then delete the auth user — refresh tokens and the membership die with it. The
 * username is kept on the roster row so a re-issue can reuse it.
 */
export async function revokeDriverLogin(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<void> {
  const driver = await loadDriver(admin, orgId, driverId);
  if (!driver.user_id) throw new DriverCredentialError("This driver has no login.", "no_login");
  const userId = driver.user_id;
  await revokePushTokens(admin, userId);
  const { error: unlinkErr } = await admin
    .from("drivers")
    .update({ user_id: null, app_access_enabled: false })
    .eq("id", driver.id)
    .eq("org_id", orgId);
  if (unlinkErr) throw new DriverCredentialError(unlinkErr.message, "auth_error");
  await admin.from("memberships").delete().eq("org_id", orgId).eq("user_id", userId);
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new DriverCredentialError(error.message, "auth_error");
}
