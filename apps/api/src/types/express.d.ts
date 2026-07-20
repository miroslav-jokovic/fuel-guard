import type { AuthContext } from "@fuelguard/shared";

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
