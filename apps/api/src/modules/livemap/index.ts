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
 * else's and this module should still be reading it through them.
 */
export { liveMapRouter } from "./routes/index.js";
export { readLiveMapBoard, FLEET_WIDE_SCOPE_REASON } from "./liveMapBoard.js";
