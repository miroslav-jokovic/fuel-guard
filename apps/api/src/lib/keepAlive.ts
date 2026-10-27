/**
 * Holds a process open that has nothing else to: a `scheduler` worker that is only a STANDBY.
 *
 * The lease timers are unref'd (schedulerLease.ts `realTimers`) so they never keep an api process
 * from exiting at shutdown, and a standby has started no scheduler interval yet — so a worker that
 * had not won its lane had an empty event loop, exited 0 after its first lease read, and was
 * restarted every ~15 s. Railway never ran a standby worker (its api holds `general`), so this
 * first showed on AWS: the second AWS11 release (2026-10-27) rolled itself back on a worker that
 * Compose saw "restarting". Returns the stop handle for graceful shutdown.
 */
export function keepProcessAlive(): () => void {
  const t = setInterval(() => {}, 1 << 30);
  return () => clearInterval(t);
}
