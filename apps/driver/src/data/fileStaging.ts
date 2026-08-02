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

/** Delete staged files for a record — called ONLY after a confirmed sync. */
export function discardStagedFiles(uris: readonly string[]): void {
  for (const uri of uris) {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // A missing file is fine (already cleaned up); never let cleanup break a successful sync.
    }
  }
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
