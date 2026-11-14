/**
 * livemap — the dispatcher's board, assembled from four other modules' tables and owning none.
 *
 * It is a READ module, which is unusual here and deliberate: `vehicle_positions` belongs to the
 * Samsara collector, `vehicles` and `drivers` to roster, `loads` and `load_stops` to loads. This
 * module's whole job is to answer one question those four cannot answer separately — "where is my
 * fleet and what is it doing" — and to answer it server-side, because D-LM11 rules that shipping six
 * table shapes and a scoping rule into a browser bundle is the thing to avoid.
 *
 * Owns no table, so it appears in no writer manifest. If that ever changes, the table is somebody
 * else's and this module should still be reading it through them. The first case came on 2026-10-10:
 * the board's recorded ETAs (DB7) are `loads`' table, written through `recordStopEtaPredictions`.
 */
export { liveMapRouter } from "./routes/index.js";
/** Ask AI's `fleet_now` (F21 R6b): the live map's board, counted by its own truck states. */
export { assistantFleetNow, FLEET_NOW_STATES, MAX_FLEET_NOW_TRUCKS } from "./assistantFleetNow.js";
export { startBoardEtaRecorder } from "./boardEtaRecorder.js";
export { startHomeTimeScheduler, runHomeTimeOnce } from "./homeTimeAlerts.js";
export { readLiveMapBoard, FLEET_WIDE_SCOPE_REASON } from "./liveMapBoard.js";
export { readLiveMapBoardCached, BOARD_CACHE_TTL_MS } from "./liveMapBoardCache.js";
export { readDriverDispatch } from "./driverDispatch.js";
