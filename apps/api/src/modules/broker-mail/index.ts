/**
 * The broker-mail module (BROKER-MAIL-READER-PLAN.md). Owns `broker_mail_messages` and the four
 * `mail_gateway_*` tables (0643); the mail gateway on Lambda writes them through `mailgw_*` functions,
 * and this module is where the API reads them. P1 added the heartbeat; P2 the page's
 * read and Settings › Broker mail (`routes.ts`); P3 the texts (`brokerMailTexts.ts`, in the `mail` lane).
 */
export { getGatewayHealth, gatewayHealthy, type GatewayHealth } from "./gatewayHealth.js";
export { brokerMailRouter } from "./routes.js";
export { startBrokerMailTextScheduler } from "./brokerMailTexts.js";
