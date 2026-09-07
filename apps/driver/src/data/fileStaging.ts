import { Directory, File, Paths } from 'expo-file-system';

/**
 * Staging area for media attached to queued work (stop photos in Phase 3, hazmat in Phase 6).
 *
 * The rule that prevents the cardinal sin: a photo is COPIED here before the driver sees any
 * confirmation, and deleted only after its outbox record is confirmed delivered (plan §13.8 / D12).
 * Files live in the app sandbox (not the shared media store) and are excluded from cloud backup.
 */
const STAGING_DIR = 'outbox-staging';

function stagingDirectory(): Directory {
  return new Directory(Paths.document, STAGING_DIR);
}

function ensureDir(): Directory {
  const dir = stagingDirectory();
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Copy a captured file into the staging area under a deterministic, record-scoped name. */
export async function stageFile(sourceUri: string, recordId: string, index = 0): Promise<string> {
  const dir = ensureDir();
  const source = new File(sourceUri);
  const extension = source.extension || '.jpg';
  const target = new File(dir, `${recordId}-${index}${extension}`);
  if (target.exists) target.delete();
  await source.copy(target);
  return target.uri;
}

/** Best-effort delete. A missing file is fine (already cleaned up); cleanup never raises. */
function deleteAll(uris: readonly string[]): void {
  for (const uri of uris) {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // Never let cleanup break the thing it was cleaning up after.
    }
  }
}

/** Delete staged files for a record — called ONLY after a confirmed sync. */
export function discardStagedFiles(uris: readonly string[]): void {
  deleteAll(uris);
}

/**
 * Delete the scanner's own temporary files once they are no longer the only copy.
 *
 * The native module writes each page into the OS cache directory and hands back its URI. Two paths
 * left those behind forever (plan Step 1.4, audit finding F9):
 *
 *   · a REJECTED capture — a driver re-shooting a glaring bill of lading five times leaves five
 *     orphans, and `sweepOrphans` cannot help because it only knows about the staging directory;
 *   · an ACCEPTED capture — `stageFile` COPIES into the sandbox, so after the copy the temporary is
 *     redundant, and on iOS `temporaryDirectory` is not aggressively purged while the app is installed.
 *
 * ⚠ Call this only when the bytes exist somewhere else or are known to be unwanted. It is deliberately
 * a different function from `discardStagedFiles` rather than the same one under a vaguer name: those
 * two have opposite preconditions, and one comment cannot honestly cover both.
 */
export function discardScannerTempFiles(uris: readonly string[]): void {
  deleteAll(uris);
}

/** True when every staged file for a record still exists (a relaunch must not lose them). */
export function stagedFilesIntact(uris: readonly string[]): boolean {
  return uris.every((uri) => {
    try {
      return new File(uri).exists;
    } catch {
      return false;
    }
  });
}

/** Orphan sweep: delete staged files not referenced by any live outbox record. */
export function sweepOrphans(referenced: readonly string[]): number {
  const dir = stagingDirectory();
  if (!dir.exists) return 0;
  const keep = new Set(referenced);
  let removed = 0;
  for (const entry of dir.list()) {
    if (entry instanceof File && !keep.has(entry.uri)) {
      try {
        entry.delete();
        removed += 1;
      } catch {
        /* best effort */
      }
    }
  }
  return removed;
}
