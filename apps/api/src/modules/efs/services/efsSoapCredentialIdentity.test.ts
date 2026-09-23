import { describe, expect, it } from "vitest";
import { isEfsEndpointHost } from "./efsSoapCredentialIdentity.js";

describe("isEfsEndpointHost", () => {
  it.each(["ws.efsllc.com", "ws.partner.efsllc.com", "qa.efsllc.com", "WS.EFSLLC.COM", "ws.efsllc.com."])(
    "accepts the EFS-issued host %s",
    (host) => expect(isEfsEndpointHost(host)).toBe(true),
  );

  it.each(["attacker.test", "efsllc.com.attacker.test", "notefsllc.com", "efsllc.co", "", "127.0.0.1"])(
    "refuses %s — a suffix match on the label boundary, not on the string",
    (host) => expect(isEfsEndpointHost(host)).toBe(false),
  );
});
