# McLeod maintenance database inventory

**Database:** `lme_analytics`  
**Inspected:** 2026-08-21  
**Access mode:** read-only SQL Server login  
**Scope:** maintenance-related tables, inspections, service failures, asset condition fields, odometer/service controls, repair-cost schemas, and adjacent safety/qualification data. Only schema metadata, row counts, and aggregate coverage were inspected; business records and sensitive values were not read.

## Executive summary

This snapshot does **not** contain a populated standalone fleet-maintenance/work-order subsystem. It does contain several maintenance-adjacent areas:

1. Vehicle inspection reports, inspected vehicles, and inspection violations.
2. Service-failure records tied to movements, orders, stops, tractors, and trailers.
3. Tractor and trailer asset records with inspection, in-service, out-of-service, status, and odometer fields.
4. Odometer/performance telemetry that could support maintenance due calculations.
5. Dispatch controls with maintenance A/B mileage/range fields.
6. Fuel and fuel-stop structures carrying oil, repair, tire-repair, and maintenance-related accounting fields.
7. Carrier qualification history with vehicle-maintenance safety metrics.
8. Accident/damage records that may be upstream inputs to repair workflows.
9. Empty schemas for repair orders, parts/labor, warranties, maintenance cards, and work-order families.

### Main conclusion

There are no populated tables whose names indicate a dedicated `maintenance`, `repair`, `work_order`, `part`, `tire`, `shop`, or `warranty` module. The strongest currently usable maintenance sources are:

| Maintenance area | Table | Rows |
|---|---|---:|
| Inspection reports | `inspection` | 1,620 |
| Inspected equipment | `inspect_vehicle` | 3,035 |
| Inspection violations | `inspect_violation` | 1,562 |
| Service failures | `servicefail` | 2,673 |
| Carrier qualification history | `carrier_qualification_history` | 5,383 |
| Tractor assets | `tractor` | 660 |
| Trailer assets | `trailer` | 459 |
| Odometer position history | `mc_position` | 1,035,043 |
| Performance/odometer metrics | `mc_performx` | 14,221 |
| Fuel-stop repair capability flags | `fuel_stop` | 5,005 |
| Fuel expense GL mappings | `fuel_expense` | 2 |

## Data safety and interpretation rules

- This document records table names, row counts, schema-level field names, and aggregates only. It does not contain inspection report numbers, driver names/licenses, addresses, VIN/serial values, vendor details, repair amounts, or other record values.
- An inspection or service-failure row is not equivalent to a maintenance work order. The relationship must be confirmed through the McLeod data dictionary and application workflow.
- Empty repair/parts/warranty schemas indicate available database structure, not necessarily that the LoadMaster license lacks the feature.
- Asset fields such as `inspection_date`, `inservice_date`, and `outservice_date` describe asset state/history, not a complete preventive-maintenance schedule.
- The project’s McLeod integration guidance requires read-only SQL when direct SQL is necessary and prohibits direct SQL writes. Maintenance changes should use McLeod application/API workflows.

## 1. Asset master and maintenance state

### 1.1 Tractors

`tractor` contains **660** asset rows. Maintenance-relevant fields identified in the schema include:

- `inspection_date`
- `inservice_date`
- `outservice_date`
- `service_status`
- `a_maint_hub` and `b_maint_hub`
- `oil_hub`
- `current_stop_id`
- `fuel_level`
- `odometer`/mileage-adjacent asset fields

Observed field coverage:

| Field group | Rows populated |
|---|---:|
| Inspection date | 609 / 660 |
| In-service date | 656 / 660 |
| Out-of-service date | 466 / 660 |
| Service status | 658 / 660 |
| Maintenance hub fields | 0 / 660 |

The tractor table is a useful asset anchor, but it does not expose a populated repair history or complete PM schedule by itself.

### 1.2 Trailers

`trailer` contains **459** asset rows. Maintenance-relevant fields include:

- `inspection_date`
- `inservice_date`
- `outservice_date`
- `trailer_status`
- `odometer` and `odometer_update_date`
- `reefer_id`
- `trailer_battery_status`
- `trailer_type`

Observed field coverage:

| Field group | Rows populated |
|---|---:|
| Inspection date | 400 / 459 |
| In-service date | 457 / 459 |
| Out-of-service date | 319 / 459 |
| Trailer status | 205 / 459 |
| Reefer ID | 0 / 459 |

There are no populated trailer-to-reefer links in this snapshot, consistent with the earlier database inventory finding that the `reefer` table itself is empty.

### 1.3 Reefer assets

| Table | Rows | Maintenance relevance |
|---|---:|---|
| `reefer` | 0 | Schema contains reefer service status, in/out-of-service, fuel, engine-hour, and setpoint fields, but no rows are present. |
| `mc_reefer_profile` | 0 | Reefer profile/configuration schema, empty. |
| `mc_reefer_command_history` | 0 | Reefer command history schema, empty. |

## 2. Inspection and compliance records

### 2.1 Inspection reports

`inspection` contains **1,620** rows and **1,620 distinct report numbers**. The schema includes:

- Inspection start/end, post, received, verification, and reply dates
- Inspection level, state, location, milepost, and report status
- Vehicle/driver identifiers and driver-license fields
- Hazmat inspection and cargo-tank/placard fields
- Axle/chamber/left/right inspection indicators
- Out-of-service flag
- DataQ review/submission fields
- Order and shipper/consignee references

Coverage observed without reading report values:

| Metric | Result |
|---|---:|
| Inspection rows | 1,620 |
| Distinct reports | 1,620 |
| Rows with an out-of-service value | 1,620 |
| Rows with a hazmat-inspection value | 1,620 |
| Earliest inspection start | 2021-08-02 07:51 |
| Latest inspection start | 2025-11-30 13:15 |
| Earliest inspection end | 1970-01-01 00:30 |
| Latest inspection end | 2025-11-30 13:45 |

The `1970-01-01` minimum inspection-end value should be treated as a possible sentinel/default and validated before date-based reporting.

### 2.2 Inspected vehicles

`inspect_vehicle` contains **3,035** rows and links inspection reports to equipment through fields such as:

- `report_no`
- `equipment_id`
- `equipment_type`
- `equipment_year`
- `unit_type`
- `make`
- `serial_number`
- `tag`
- `oos`
- `cvsa_no` and `cvsa_issued_no`

There are **1,620 distinct report references** across the 3,035 vehicle rows, so a single inspection can contain multiple inspected units. The `report_no` relationship is the likely bridge to `inspection`.

### 2.3 Inspection violations

`inspect_violation` contains **1,562** rows across **741 distinct inspection reports**. It includes:

- Violation category and group
- Citation/report/section references
- Description
- Unit type
- Crash indicator
- Verification flag
- Out-of-service flag
- Weight

All 1,562 violation rows had an out-of-service value populated. The actual flag vocabulary was not read.

### 2.4 Other inspection schemas

| Table | Rows | Role indicated by schema |
|---|---:|---|
| `dr_inspection` | 0 | Driver inspection report schema with inspection date, level, report number, and violation count. |
| `inspect_action` | 0 | Inspection action schema. |
| `weight_inspection_detail` | 0 | Weight-inspection before/after measurements. |
| `weight_inspection_event` | 0 | Weight-inspection event, charge impact, requestor, and status. |
| `basic_history` | 0 | Basic inspection/maintenance summary schema. |
| `carrier_qualification_history` | 5,383 | Carrier qualification history with safety and vehicle-maintenance metrics; detailed below. |

## 3. Service failures and operational maintenance signals

### 3.1 Service failures

`servicefail` contains **2,673** records. The schema connects each failure to operational and asset context:

- `movement_id`, `order_id`, and `stop_id`
- `tractor_id` and `trailer_id`
- Customer, driver, dispatcher, operations user, and fleet manager
- Arrival/departure and scheduled appointment times
- Minutes late and stop type
- Resolution and status
- Fault attribution (`fault_of_carrier_or_driver` and `caused_by_type`)
- Reportable/review-required/reviewed fields
- Terminal and EDI references

Aggregate coverage:

| Metric | Result |
|---|---:|
| Service-failure rows | 2,673 |
| Movements with failures | 2,315 |
| Orders with failures | 2,315 |
| Tractors with failures | 412 |
| Trailers with failures | 279 |
| Rows flagged reportable | 2,673 |
| Rows with `reviewed_date` | 0 |
| Earliest entered date | 2014-03-17 14:46 |
| Latest entered date | 2026-08-21 09:34 |

This is a current operational exception queue, not a repair-order ledger. It may be useful for identifying assets that require maintenance triage, but a separate repair/work-order record is not present in the populated schema.

### 3.2 Service-failure controls

The `dispatch_control` table has four company-scoped rows and includes maintenance/service-failure fields:

- `maint_a_miles`, `maint_a_range`, and unit
- `maint_b_miles`, `maint_b_range`, and unit
- Service-failure date/consumer/drop/pick/ship settings
- Inspection-time and departure requirements
- Dispatch-hold/preventive behavior

All four `dispatch_control` rows had at least one maintenance A/B threshold field populated. The actual threshold values were not read.

Other related controls:

| Table | Rows | Maintenance-related configuration |
|---|---:|---|
| `mc_exapp_control` | 53 | Odometer, departure, service-failure, and auto-departure update behavior. |
| `distance_profile` | 36 | `rm_maint_cost` maintenance-cost field. |
| `fuelopt_control` | 0 | PM oil-change and repair-related optimization fields, but empty. |
| `tmt_control` | 0 | Maintenance hub fields, but empty. |
| `arcontrol` | 4 | Mileage override suppression field. |
| `distance_control` | 4 | Stored mileage and distance-method controls. |
| `www_control` | 4 | Service-failure availability/portal behavior. |

## 4. Odometer, mileage, and maintenance-due support

### 4.1 Position telemetry

`mc_position` contains **1,035,043** rows and includes an `odometer` field. This is the largest apparent source for asset movement/odometer history and may support PM due calculations if the correct equipment linkage and timestamp are confirmed.

### 4.2 Performance metrics

`mc_performx` contains **14,221** rows with fields including:

- Driver and date range
- Start/end odometer
- Distance and engine time
- Idle/parked/cruise fuel
- Speed and performance measures

It may support mileage and usage-based maintenance analytics, but it is a performance summary rather than a maintenance transaction table.

### 4.3 Other mileage sources

| Table | Rows | Maintenance relevance |
|---|---:|---|
| `driver_miles` | 71 | Driver mileage and preventable/unpreventable accident totals; not a PM history. |
| `mc_position` | 1,035,043 | Odometer position history. |
| `mc_performx` | 14,221 | Start/end odometer and distance/performance summary. |
| `tractor` | 660 | Asset-level inspection/service/out-of-service state. |
| `trailer` | 459 | Asset-level inspection/service/out-of-service and odometer state. |
| `distance_profile` | 36 | Maintenance-cost field in distance-profile configuration. |
| `mileage` | 0 | Mileage transaction schema. |
| `stored_mileage` | 0 | Stored-mileage schema. |
| `local_mileage` | 0 | Local-mileage schema. |

## 5. Repair, parts, labor, warranty, tire, and maintenance-cost schemas

### 5.1 Dedicated maintenance transaction schemas are empty

The database has no populated table names matching the direct maintenance domains `maintenance`, `repair`, `work order`, `parts`, `tire`, `shop`, or `warranty`.

The closest repair/maintenance transaction schemas are all empty:

| Table | Rows | Schema role indicated by columns |
|---|---:|---|
| `vcard` | 0 | Virtual-card records with maintenance group, repair order, warranty, labor, parts, tax, and GL fields. |
| `vcard_trx_history` | 0 | Historical transactions with repair number, labor cost, parts cost, tax, tractor, and vendor fields. |
| `vcard_trx_total` | 0 | Aggregated labor, parts, miscellaneous, tax, fee, and invoice totals. |
| `vcard_control` | 0 | Virtual-card maintenance group and parts/labor GL defaults. |
| `vcard_user` | 0 | Virtual-card user maintenance-group schema. |
| `if_card_fle_hist` | 0 | Fleet-card maintenance allowance/expense history schema. |
| `ifuel_card_fle` | 0 | Fleet-card maintenance limits/OTB schema. |
| `fuelopt_control` | 0 | PM oil-change and repair optimization control schema. |
| `fuelopt_header` | 0 | Fuel optimization cost summary schema. |
| `fuelopt_request` | 0 | Fuel optimization request schema. |
| `fuelopt_route` | 0 | Fuel optimization route schema. |
| `fuelopt_solution` | 0 | Fuel optimization solution with actual/effective cost schema. |
| `fuelopt_stop` | 0 | Fuel optimization stop schema. |
| `tmt_control` | 0 | Maintenance hub/control schema. |
| `tmt_detail` | 0 | Maintenance detail schema. |
| `tmt_update` | 0 | Maintenance update schema. |

This is the strongest evidence that the snapshot does not contain a populated repair-order or work-order maintenance subsystem.

### 5.2 Fuel and maintenance-adjacent cost data

| Table | Rows | Maintenance relevance |
|---|---:|---|
| `fuel_expense` | 2 | Contains GL mappings for oil, repair, and tire costs for driver/lease-owner contexts. |
| `fuel_detail` | 3 | Current fuel detail includes oil cost/quarts and service-used fields. |
| `fuel_detail_hist` | 65,847 | Historical fuel detail includes oil cost/quarts and service-used fields. |
| `fuel_total` | 6,731 | Aggregate fuel totals include driver/fleet oil cost and quarts. |
| `fuel_stop` | 5,005 | Fuel-stop master includes `minor_repairs` and `tire_repair` capability flags, plus truck-wash/scales/services. |
| `tch_checks` | 6,605 | TCH checks include service-charge fields; not a maintenance ledger. |
| `posted_wire` | 31,494 | Payment records include service charges; not a maintenance ledger. |

These tables can help identify maintenance-related cost categories or service locations, but they do not provide a reliable repair history by themselves.

## 6. Accidents, damage, and qualification records

Maintenance can be triggered by accidents, damage, or carrier-qualification findings. These areas should be treated as adjacent evidence, not as work orders.

| Table | Rows | Role indicated by schema |
|---|---:|---|
| `motoraccident` | 392 | Motor-accident records with damage amount/area, inspection report, and preventability. |
| `accident_control` | 3 | Accident workflow/control and inspection-related configuration. |
| `cargo_claim` | 0 | Cargo-claim schema with repair-bill/preventability fields. |
| `claim_detail` | 0 | Claim detail/damage-code schema. |
| `property_damage` | 0 | Property-damage schema. |
| `dr_accidents` | 0 | Driver accident/damage schema. |
| `carrier_qualification_history` | 5,383 | Qualification history with vehicle-maintenance safety metrics. |
| `driver_miles` | 71 | Driver mileage and preventable-accident totals. |
| `inspect_violation` | 1,562 | Inspection violations and out-of-service indicators. |
| `inspection` | 1,620 | Inspection reports and out-of-service/hazmat fields. |

### Carrier qualification maintenance metrics

`carrier_qualification_history` includes vehicle-maintenance metrics such as:

- `vehicle_maint_oa`
- `vehicle_maint_ot`
- `vehicle_maint_pct`
- `vehicle_maint_sv`

It also includes carrier safety, insurance, driver fitness, fatigued driving, and qualification status fields. This is a compliance/qualification history source, not a maintenance service history.

## 7. Maintenance-related configuration and control paths

### 7.1 PM threshold path

```text
company
  -> dispatch_control
       -> maintenance A/B mileage and range thresholds
       -> service-failure and inspection behavior
  -> tractor / trailer
       -> asset inspection and service state
  -> mc_position / mc_performx
       -> odometer and usage evidence
```

The four `dispatch_control` rows all contain at least one A/B maintenance threshold field. The actual values and units must be read through an approved non-secret field allowlist before calculating PM due dates.

### 7.2 Inspection path

```text
inspection
  -> inspect_vehicle
  -> inspect_violation
```

The relationship appears to use `report_no`. One inspection report can have multiple inspected vehicles and violations. This path can support compliance and out-of-service reporting, but it does not expose a repair completion or parts/labor workflow.

### 7.3 Service-failure path

```text
servicefail
  -> movement / order / stop
  -> tractor / trailer
  -> review / resolution / fault attribution
```

This path is suitable for maintenance-triage candidates, especially where failures are attached to a tractor or trailer. It should not be interpreted as proof that a repair was performed.

### 7.4 Maintenance-cost path

```text
fuel_expense
  -> oil / repair / tire GL mappings
fuel_detail_hist / fuel_total
  -> oil cost and service-used fields
vcard_trx_history / vcard_trx_total
  -> repair-order, labor, parts, warranty schema (empty)
```

The cost path is incomplete in this snapshot because the dedicated virtual-card repair transaction tables contain no rows.

## 8. Related views and procedures

No view or stored procedure names matched the maintenance-specific patterns `maintenance`, `service`, `inspection`, `repair`, `tire`, `warranty`, or `work`.

Maintenance analysis therefore relies on the base tables and controls documented above. The four database procedures identified in the broader inventory were not executed because none is clearly maintenance-specific and direct procedure execution is outside the approved read-only inventory scope.

## 9. Data-quality and availability findings

1. **No dedicated populated maintenance module was found.** There are no populated maintenance/work-order/repair/parts/tire/shop/warranty tables by name.
2. **Inspection data is populated.** There are 1,620 inspection reports, 3,035 inspected-vehicle rows, and 1,562 violation rows.
3. **Service-failure data is populated and current.** There are 2,673 service-failure rows, reaching 2026-08-21 in the entered-date range.
4. **Service-failure review is incomplete.** All 2,673 rows were flagged reportable, while none had a `reviewed_date`.
5. **Asset maintenance state is partially available.** Tractor and trailer inspection/in-service/out-of-service fields are well populated, but maintenance-hub fields on tractors are empty.
6. **Odometer evidence is substantial.** `mc_position` and `mc_performx` provide potentially useful mileage/usage inputs for a future PM index.
7. **PM controls exist but are narrow.** `dispatch_control` has maintenance A/B threshold fields for all four rows; `fuelopt_control` and `tmt_control` are empty.
8. **Repair-cost schemas are empty.** Virtual-card repair-order, parts, labor, warranty, and maintenance transaction tables contain zero rows.
9. **Inspection dates include a possible sentinel.** The earliest `inspection_end` value is 1970-01-01 and must be validated before date reporting.
10. **Fuel-stop maintenance flags are capabilities, not transactions.** `minor_repairs` and `tire_repair` on `fuel_stop` indicate service availability at locations, not work performed on assets.

## 10. Recommended read-only extraction order

1. Confirm whether the requested maintenance use case is PM due tracking, inspection compliance, service-failure triage, repair-cost reporting, or asset availability.
2. Start with `tractor`/`trailer` identifiers and `mc_position` odometer history.
3. Read the maintenance-threshold fields from `dispatch_control` and `distance_profile` using a non-secret allowlist.
4. Join `inspection` to `inspect_vehicle` and `inspect_violation` by company/report identifiers.
5. Join `servicefail` to movement/order/stop and asset IDs to produce maintenance candidates.
6. Treat `fuel_expense`, fuel history, and fuel-stop flags as cost/location enrichment only.
7. Validate the 1970 inspection timestamp sentinel and all blank/flag vocabularies with the McLeod data dictionary.
8. Do not infer a repair completion from an inspection, service failure, fuel-stop capability, or out-of-service flag.
9. Do not execute writes, maintenance procedures, or configuration changes directly against this database.

The database can support a read-only maintenance-triage and PM-due analysis, but it does not currently provide evidence of a populated end-to-end maintenance work-order system.
