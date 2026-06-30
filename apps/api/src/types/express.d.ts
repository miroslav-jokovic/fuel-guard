import type { AuthContext } from "@fleetguard/shared";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
