import type { AuthContext } from "@fuelguard/shared";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
