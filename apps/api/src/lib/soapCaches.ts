import { invalidatePolicy } from "./efsPolicyCache.js";
import { __resetEfsSessions } from "./efsSoapSession.js";
import { invalidateTlsAgents } from "./soapClient.js";

/**
 * EFS cache invalidation is coupled to credential identity. A password change invalidates the cached
 * clientId and policy results, but it does not change the TLS certificate or the keep-alive sockets.
 * A certificate change also has to drop pooled sockets still presenting the old identity. Keeping these
 * operations named makes that distinction explicit instead of allowing six call sites to drift apart.
 */
export function invalidateOrgSoapCaches(orgId: string): void {
  __resetEfsSessions(orgId);
  invalidatePolicy(orgId);
}

export function invalidateOrgSoapIdentity(orgId: string): void {
  invalidateTlsAgents();
  invalidateOrgSoapCaches(orgId);
}
