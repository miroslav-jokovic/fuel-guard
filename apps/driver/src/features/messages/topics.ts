/**
 * The Realtime topic for the inbox or one conversation (0514). PRIVATE, and somebody's own: the inbox
 * is the signed-in person's, a conversation only its participants'. The public names this replaced
 * (`messages-inbox`, `messages-<thread>`) stop working once the project's "Allow public access" is
 * off, which is the point.
 */
export function driverMessagesTopic(userId: string, threadId?: string): string {
  return threadId ? `driver:thread:${threadId}` : `driver:inbox:${userId}`;
}
