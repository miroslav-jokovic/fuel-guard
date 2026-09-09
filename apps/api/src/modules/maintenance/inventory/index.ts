/**
 * Shop inventory — the maintenance module's second feature (INVENTORY-PLAN.md, D-S360-7).
 *
 * Step I2 shipped the schema and the reader/writer pair; step I3 added the catalogue and location
 * writes, the photo signing and the status mapping, and mounted the whole surface under
 * `/api/maintenance/inventory`. The screens are I4.
 */
export { listParts, getPart, findPartsByUpc, toPartDto, PAGE_MAX } from "./parts.js";
export { listLocations, listStock, toStockLineDto } from "./stock.js";
export { listMovements, recordMovement, toMovementDto } from "./movements.js";
export { createPart, updatePart, setPartImagePath } from "./partsWrite.js";
export { createLocation, updateLocation } from "./locationsWrite.js";
export {
  signPartPhotoUpload,
  signPartPhotoUrl,
  partPhotoPath,
  isPhotoContentType,
  INVENTORY_PHOTO_BUCKET,
  PHOTO_URL_TTL_SEC,
} from "./photos.js";
export { statusForServiceError } from "./httpStatus.js";
export { isServiceError, type ServiceError } from "./types.js";
