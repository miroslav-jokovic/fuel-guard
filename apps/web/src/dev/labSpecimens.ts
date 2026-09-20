/**
 * Specimen ROWS for the design-system lab (D-DS13).
 *
 * Fixtures only — no component, no state, no prose. They live beside the page rather than in it
 * because the page is the one route that renders production primitives without a login, which
 * makes it the place every new specimen wants to be; it reached the 500-line budget in
 * September 2026 and the data is the part of it that carries no argument. A new specimen's ROWS
 * belong here, its explanation belongs on the page.
 */
export const shippedRows = [
  { unit: "Unit 204", driver: "Maya Chen", gallons: "118.4", amount: "$412.86", mpg: "7.4", status: "Clear" },
  { unit: "Unit 118", driver: "Darnell Ross", gallons: "96.2", amount: "$338.71", mpg: "6.1", status: "Review" },
  { unit: "Unit 337", driver: "Priya Nandi", gallons: "141.9", amount: "$497.02", mpg: "7.9", status: "Clear" },
  { unit: "Unit 052", driver: "Tom Bergeron", gallons: "88.0", amount: "$310.44", mpg: "5.2", status: "Alert" },
];

export const metrics = [
  { label: "Fuel spend", value: "$48,720", change: "2.8% below plan" },
  { label: "Active alerts", value: "7", change: "2 require action", attention: true },
  { label: "Idle cost", value: "$1,284", change: "$196 avoidable" },
  { label: "Fleet MPG", value: "7.4", change: "+0.3 this period" },
];

export const rows = [
  {
    vehicle: "Unit 204",
    driver: "Maya Chen",
    station: "Pilot No. 118",
    amount: "$642.18",
    status: "Verified",
  },
  {
    vehicle: "Unit 318",
    driver: "Andre Silva",
    station: "Love's No. 728",
    amount: "$511.44",
    status: "Review",
  },
  {
    vehicle: "Unit 112",
    driver: "Nora Patel",
    station: "TA Dallas",
    amount: "$476.09",
    status: "Verified",
  },
  {
    vehicle: "Unit 425",
    driver: "Eli Brooks",
    station: "Flying J No. 614",
    amount: "$704.31",
    status: "Alert",
  },
];
