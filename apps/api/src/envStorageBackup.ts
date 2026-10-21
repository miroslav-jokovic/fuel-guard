import { z } from "zod";

/**
 * Where the nightly off-provider copy of every evidence bucket goes (`modules/org/storageBackup.ts`),
 * split out of `env.ts` on the `envUnitFiles.ts` precedent: one feature, one group of variables, and
 * `env.ts` sits near its 500-line budget. Spread into the one schema, so a deployment still gets one parse.
 *
 * All four or none. A partial set is a deployment mistake, and `storageBackupTarget` treats it as OFF
 * rather than guessing — `/api/version` then says `off`, which is visible, instead of a backup that
 * fails every night with a credentials error nobody reads.
 *
 * Production only. Staging has its own evidence (test uploads), and copying it into the same bucket
 * would put testers' files beside drivers' medical cards under the same 90-day lock.
 *
 * The key belongs to IAM user `silvicom-storage-backup`, whose policy allows list/get/put on this one
 * bucket and nothing else — no delete — so a leaked key can add files but cannot destroy the copy.
 */
export const storageBackupEnvFields = {
  STORAGE_BACKUP_S3_BUCKET: z.string().optional(),
  STORAGE_BACKUP_S3_REGION: z.string().optional(),
  STORAGE_BACKUP_AWS_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_BACKUP_AWS_SECRET_ACCESS_KEY: z.string().optional(),
};
