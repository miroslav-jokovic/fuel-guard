import type { AuthContext } from "@silvicom/shared";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      /** Set by the TMS ingest router after authenticating the agent's bearer ingest token. */
      tms?: { orgId: string; provider: string };
    }
  }
}

export {};
