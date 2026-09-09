/**
 * Shop inventory — the maintenance module's second feature (INVENTORY-PLAN.md, D-S360-7).
 *
 * Step I2 ships the schema and this reader/writer pair. The routes that mount them are I3 and the
 * screens are I4, so nothing here is reachable from the product yet: the RPC ships with its caller
 * in one merge precisely because the feature is unreachable, which is the condition
 * `lint:migration-ordering` cannot check for a function (it never reads `create function`).
 */
export { listParts, getPart, findPartsByUpc, toPartDto, PAGE_MAX } from "./parts.js";
export { listLocations, listStock, toStockLineDto } from "./stock.js";
export { listMovements, recordMovement, toMovementDto } from "./movements.js";
export { isServiceError, type ServiceError } from "./types.js";
