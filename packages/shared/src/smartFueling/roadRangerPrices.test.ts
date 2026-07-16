import { describe, it, expect } from "vitest";
import { parseRoadRangerPrices, roadRangerStationKey, parseCentralTimestamp } from "./roadRangerPrices.js";

// Verbatim structure from the real 2026-07 page (Drupal, 56 rows): address + city-state divs in <th>,
// four price <td>s (Unleaded, E85, Car Diesel Cash, Truck Diesel Cash), "Data last updated" stamp.
const PAGE = `<html><body>
<p>Prices are updated at least daily. Data last updated: 7/16/2026 1:30:40 PM CDT</p>
<section class="rr-fuel-prices-container"><table class="table table-striped rr-fuel-prices"><thead>
<tr><th>Location</th><th>Unleaded</th><th>E85</th><th>Car Diesel (Cash)</th><th>Truck Diesel (Cash)</th></tr>
</thead><tbody>
<tr><th><div class="address">2202 N. Main Street</div><div class="city-state">Brinkley, AR</div></th><td>$3.499</td><td>N/A</td><td>$4.999</td><td>$4.999</td></tr>
<tr><th><div class="address">100 Plaza Drive</div><div class="city-state">Elkrun Heights, IA</div></th><td>$3.899</td><td>N/A</td><td>N/A</td><td>$4.949</td></tr>
<tr><th><div class="address">1 No Truck Rd</div><div class="city-state">Nowhere, TX</div></th><td>$3.099</td><td>N/A</td><td>$4.599</td><td>N/A</td></tr>
</tbody></table></section></body></html>`;

describe("parseRoadRangerPrices", () => {
  const r = parseRoadRangerPrices(PAGE);

  it("parses truck-diesel CASH rows with deterministic station keys", () => {
    expect(r.headerFound).toBe(true);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({
      address: "2202 N. Main Street", city: "Brinkley", state: "AR", truckDieselCash: 4.999,
      stationKey: "2202-n-main-street_brinkley-ar",
    });
    expect(r.rows[1]).toMatchObject({ city: "Elkrun Heights", truckDieselCash: 4.949 });
  });

  it("drops rows without a truck-diesel price and counts them (car-diesel-only is not plannable)", () => {
    expect(r.skipped).toBe(1);
  });

  it("parses the Central-time update stamp to ISO", () => {
    expect(r.updatedAtIso).toBe("2026-07-16T18:30:40.000Z"); // 1:30:40 PM CDT = 18:30:40 UTC
    expect(parseCentralTimestamp("1/5/2026 9:00:00 AM CST")).toBe("2026-01-05T15:00:00.000Z");
  });

  it("station keys are stable and collision-resistant across formatting", () => {
    expect(roadRangerStationKey("2202 N. Main Street", "Brinkley", "AR"))
      .toBe(roadRangerStationKey("2202 N Main Street", "BRINKLEY", "ar"));
  });

  it("returns headerFound=false when the price table is absent (markup change → loud failure)", () => {
    expect(parseRoadRangerPrices("<html><table class='other'></table></html>").headerFound).toBe(false);
  });
});
