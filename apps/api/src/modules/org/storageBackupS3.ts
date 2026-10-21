import { ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Env } from "../../env.js";
import type { BackupTarget, TargetObject } from "./storageBackup.js";

/**
 * The backup's second provider: an S3 bucket in the owner's own AWS account, set up 2026-10-21 —
 * `us-east-2`, a different region from Supabase's `us-west-2`, so one region's failure cannot take
 * both copies. Versioning on, Object Lock governance 90 days by default, public access blocked,
 * TLS-only, Glacier Instant Retrieval after 90 days. Those are bucket properties, not code: this file
 * only lists and puts, which is all its IAM user is allowed to do.
 *
 * Null when any of the four variables is missing (`envStorageBackup.ts`): the scheduler then never
 * starts and `/api/version` reports `off`.
 */
export function storageBackupConfigured(env: Env): boolean {
  return Boolean(
    env.STORAGE_BACKUP_S3_BUCKET &&
      env.STORAGE_BACKUP_S3_REGION &&
      env.STORAGE_BACKUP_AWS_ACCESS_KEY_ID &&
      env.STORAGE_BACKUP_AWS_SECRET_ACCESS_KEY,
  );
}

export function storageBackupTarget(env: Env): BackupTarget | null {
  const bucket = env.STORAGE_BACKUP_S3_BUCKET;
  const region = env.STORAGE_BACKUP_S3_REGION;
  const accessKeyId = env.STORAGE_BACKUP_AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.STORAGE_BACKUP_AWS_SECRET_ACCESS_KEY;
  if (!bucket || !region || !accessKeyId || !secretAccessKey) return null;
  const s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
  return {
    async inventory(prefix) {
      const held = new Map<string, TargetObject>();
      let token: string | undefined;
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        for (const o of page.Contents ?? []) {
          if (!o.Key) continue;
          held.set(o.Key, { size: o.Size ?? -1, lastModifiedMs: o.LastModified?.getTime() ?? 0 });
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return held;
    },
    async put(key, body, contentType) {
      // An Object Lock bucket refuses a PUT without an integrity checksum; the SDK's default CRC32
      // satisfies it, and naming it here keeps that true if the SDK's default ever changes.
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ChecksumAlgorithm: "CRC32" }),
      );
    },
  };
}
