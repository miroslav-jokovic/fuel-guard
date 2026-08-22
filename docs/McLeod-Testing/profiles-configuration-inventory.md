# McLeod profiles and configuration inventory

**Database:** `lme_analytics`  
**Inspected:** 2026-08-21  
**Access mode:** read-only SQL Server login  
**Scope:** profile, control, configuration, setup, policy, rule, template, mapping, code, type, user-access, and reference tables. Only schema metadata and row counts were inspected; configuration values and secrets were not read.

## Executive summary

The database contains a large McLeod configuration surface rather than one centralized configuration table. The configuration model is distributed across:

1. Company-level controls for dispatch, distance, accounting, EDI, fuel tax, payroll, web, and integrations.
2. User, role, access, menu, saved-search, and profile assignments.
3. Operational profiles for dispatch, planning, distance, detention, brokerage, manifesting, equipment, and alerts.
4. EDI, import/export, email, SMS, API, file-transfer, and third-party integration settings.
5. Reporting, KPI, alert, list, dashboard, and document-template definitions.
6. Code, type, status, mapping, and vocabulary reference data.
7. Fuel-card policies, limits, provider settings, and user-level controls.
8. Empty schemas for modules that are installed but not populated in this database.

### Inventory size

The catalog scan identified **293 candidate profile/configuration/reference tables**:

| State | Tables |
|---|---:|
| Populated | 142 |
| Empty schema | 151 |
| Total candidate set | 293 |

The candidate set is intentionally broad. It includes tables whose names indicate `profile`, `control`, `config`, `setup`, `template`, `policy`, `rule`, `code`, `type`, `mapping`, `limit`, `workflow`, `schedule`, `setting`, `access`, `security`, or `user`. Some are reference data rather than editable profiles.

### Most significant populated configuration areas

| Area | Representative populated tables | Observed rows |
|---|---|---:|
| User and UI configuration | `users`, `user_menu_toolbar`, `user_list_default`, `user_group` | 208; 916; 147; 16 |
| Dispatch and distance | `dispatch_control`, `distance_control`, `distance_profile`, `planning_profile` | 4; 4; 36; 20 |
| EDI definitions | `edi_standard_code`, `edi_set_definition`, `edi_segment_def`, `edi_element_def` | 353,560; 88,869; 88,170; 16,838 |
| EDI partner/templates | `edi_partner_code`, `edi_template_text`, `edi_composite_def` | 1,846; 1,658; 1,772 |
| General reference data | `code`, `hazmat_code`, `map_brokerage_code`, `information_packet` | 848; 3,403; 3,736; 1,938 |
| Reporting/configuration | `list_config`, `report_template`, `purge_control`, `perf_alert_def` | 15,615; 217; 332; 56 |
| Fuel policies | `fuel_prod_code`, `ifuel_card_tch`, `ifuel_msts_policy_mstr`, `ifuel_user` | 303; 1,601; 22; 7 |

## Data safety and interpretation rules

- This document contains table names, row counts, and selected schema-level descriptions only. It does not contain profile values, URLs with credentials, passwords, API keys, email contents, user passwords, or vendor credentials.
- A populated configuration table proves that rows exist; it does not prove that every row is active or currently assigned to a user/company.
- Many controls are company-scoped. Several inspected controls have one row per company, but queries must still use the actual `company_id` relationship rather than assuming row position or global uniqueness.
- Empty tables are retained because their schemas identify installed or available McLeod features. Empty does not necessarily mean the feature is disabled in the product UI.
- Table names and column names are interpreted from the installed schema and should be confirmed against the matching LoadMaster data dictionary before writing configuration changes or integration mappings.
- Direct SQL writes remain prohibited. The project’s McLeod integration guidance treats SQL as a read-only exception and prefers the supported Direct-Hosted Web API or an outbound sync agent.

## 1. Company-level controls and system configuration

These tables hold broad defaults and switches that influence multiple parts of LoadMaster.

| Table | Rows | Configuration role indicated by schema |
|---|---:|---|
| `system_parameter` | 82 | Named system parameters, parameter types/descriptions, and values. Values were not read. |
| `system_config` | 0 | General system configuration schema. |
| `batch_control` | 188 | Batch/code descriptions and batch processing configuration. |
| `mapping_control` | 4 | Global mapping control. |
| `mapping_vendor` | 2 | Mapping/weather/distance vendor endpoints and profiles. URLs were not read. |
| `mc_control` | 5 | McLeod control including host/routing-distance configuration. Host values were not read. |
| `gp_control` | 4 | General processing control including host and exchange-rate exclusions. |
| `gp_mapping` | 0 | General processing mapping schema. |
| `data_feed_control` | 12 | Feed code, format, direction, transfer type, and processing status configuration. |
| `copy_control` | 14 | Copy behavior for orders, rates, equipment, and brokerage qualification profiles. |
| `purge_control` | 332 | Purge definitions and enablement flags. |
| `uid_control` | 5 | UID/identifier type control. |
| `interface_codes` | 40 | Interface code types and display vocabulary. |
| `list_config` | 15,615 | List/grid configuration records. The rows may be user- or screen-specific; values were not read. |
| `list_definition` | 0 | List-definition schema. |
| `custom_field_def` | 2 | Custom-field definitions, display type, defaults, and edit flags. |
| `code` | 848 | General field/code vocabulary and EDI standard-code references. |
| `code_mask` | 0 | Code-mask schema. |
| `action_code` | 4 | Action descriptions and next-action relationships. |
| `reason_code` | 32 | General reason-code vocabulary. |
| `comment_type` | 49 | Comment-type vocabulary. |
| `cache_last_access` | 2 | Cache access metadata. |

### Company-scoped controls observed

The following controls had a row count and distinct-company count consistent with company-scoped configuration. The values themselves were not selected.

| Table | Rows | Distinct companies |
|---|---:|---:|
| `ap_control` | 4 | 4 |
| `arcontrol` | 4 | 4 |
| `dispatch_control` | 4 | 4 |
| `distance_control` | 4 | 4 |
| `edi_control` | 4 | 4 |
| `gl_control` | 4 | 4 |
| `mapping_control` | 4 | 4 |
| `payroll_control` | 4 | 4 |
| `seg_alloc_control` | 4 | 4 |
| `www_control` | 4 | 4 |
| `mc_control` | 5 | 4 |
| `email_control` | 3 | 3 |
| `fuel_tax_control` | 3 | 3 |
| `pnn_control` | 2 | 2 |
| `rate_index_control` | 3 | 2 |

## 2. User, role, access, and profile assignments

The user/security area is a separate configuration surface from the operational profiles. It includes UI preferences, saved searches, access rules, and profile references stored on user records.

| Table | Rows | Configuration role indicated by schema |
|---|---:|---|
| `users` | 208 | User master with references to multiple operational/reporting profiles, groups, notification methods, and web settings. Credential-bearing columns exist; values were not read. |
| `user_group` | 16 | User-group definitions and user-type relationships. |
| `webusertype` | 27 | Web user-type descriptions. |
| `web_users` | 0 | Web-user schema. |
| `web_user_roles` | 0 | Web-user role schema. |
| `user_menu_toolbar` | 916 | User menu and toolbar configuration. |
| `user_list_default` | 147 | Per-user default list configuration. |
| `user_saved_search` | 37 | User saved-search records. |
| `user_screen_action` | 49 | User screen/action permissions or preferences. |
| `user_screen_prop` | 0 | User screen property schema. |
| `user_color` | 0 | User color preference schema. |
| `user_sys_health` | 0 | User system-health preference schema. |
| `agent_access_ctrl` | 4 | Agent/contact access controls. |
| `perms_agent_access` | 280 | Agent-access permission definitions. |
| `agency_users` | 0 | Agency-to-user assignments. |
| `sy_user` | 0 | System-user schema. |
| `sy_role` | 0 | System-role schema. |
| `pending_lock_users` | 0 | Pending user-lock notifications/schema. |
| `auth_mask` | 6 | Authorization masking/configuration schema. |
| `authorization_status` | 0 | Authorization status reference schema. |
| `remote_profile` | 0 | Remote-access profile schema. |
| `remote_http_header` | 0 | Remote HTTP-header schema. |
| `oauth_token_data` | 0 | OAuth-token storage schema. Values were not queried. |
| `edi_user` | 2 | EDI user records. |
| `edi_api_user` | 0 | EDI API user schema. |
| `ifuel_user` | 7 | Fuel-interface users and user-level purchasing/cash limits. Credential-bearing columns exist; values were not read. |
| `ifuel_user_limit` | 0 | Fuel-interface user-limit schema. |
| `pnn_transcore_user` | 4 | TransCore/loadboard user mapping. |
| `routing_guide_users` | 0 | Routing-guide users. |
| `routing_guide_user_groups` | 0 | Routing-guide user groups. |
| `trailer_wash_users` | 0 | Trailer-wash users. |
| `tw_users_hist` | 0 | Trailer-wash user history schema. |
| `tw_wo_users_hist` | 0 | Trailer-wash work-order user history schema. |

### User profile assignment coverage

The `users` table contains 208 rows and has references for multiple profile types. In the inspected snapshot:

- One user row referenced `daily_snap_profile`.
- No user rows had non-null values for `call_list_profile`, `daily_brok_profile`, `manifest_profile`, `crm_vs_profile`, `fileimport_profile`, or `dragndrop_profile_id`.
- This does not prove that the corresponding profile tables are unused; profiles may be selected through other UI or company-level mechanisms.

## 3. Operational profiles and controls

### 3.1 Dispatch, planning, routing, and distance

| Table | Rows | Configuration role indicated by schema |
|---|---:|---|
| `dispatch_control` | 4 | Dispatch defaults, auto-rating, manifesting, templates, notifications, brokerage filters, route optimization, and equipment-pool behavior. |
| `distance_control` | 4 | Billing, fuel, pay, ETA, loaded/empty, hazmat, practical, and planning distance profiles/methods. |
| `distance_profile` | 36 | Named distance profiles with lookup type and method. |
| `distance_method` | 4 | Distance-method definitions. |
| `distance_type` | 6 | Distance-type vocabulary. |
| `planning_profile` | 20 | Planning defaults for order/tractor types, response codes, movement types, and revenue codes. |
| `daily_brok_profile` | 0 | Daily brokerage KPI/profile schema. |
| `daily_snap_profile` | 1 | Daily snapshot metrics and user-list configuration. |
| `dragndrop_profile` | 0 | Dispatch drag-and-drop rules for equipment, movement, location, revenue, and order filters. |
| `linehaul_routing_option` | 0 | Linehaul routing option/status schema. |
| `late_route_control` | 0 | Late-route defaults and email-error handling schema. |
| `routing_guide_profile` | 0 | Routing-guide profile schema. |
| `routing_guide_profile_dtl` | 0 | Routing-guide profile details. |
| `manifest_profile` | 0 | Manifest/order inbound/outbound types and revenue-code defaults. |
| `manifest_workflow` | 0 | Manifest workflow/status schema. |
| `logistics_control` | 0 | Auto-rating, manifesting, and confirmation-template control schema. |
| `order_hist_type` | 614 | Order-history type vocabulary. |
| `order_type` | 1 | Order-type reference/configuration. |
| `orderhist_profile` | 0 | Order-history profile schema. |
| `orderhist_profile_detail` | 0 | Order-history profile details. |
| `pnn_control` | 2 | Loadboard/PNN schedule, contact, geographic default, and error-email controls. |
| `pnn_schedule` | 6 | PNN schedule definitions. |
| `pnn_equip_type` | 272 | PNN equipment type mappings. |
| `pnn_revcode` | 0 | PNN revenue-code mappings. |
| `pnn_builder_profile` | 0 | PNN output/profile builder schema. |
| `brk_qual_profile` | 8 | Brokerage qualification profile definitions. |
| `brokerage_workflow` | 0 | Brokerage workflow schema. |
| `brokerage_workflow_detail` | 0 | Brokerage workflow detail/status schema. |
| `fmvendor_control` | 4 | Freight-matching/vendor controls, auto-rate confirmation, milestone, booking, and notification settings. |
| `carrier_call_list_profile` | 0 | Carrier call-list profile schema. |
| `call_list_profile` | 4 | Call-list profiles with activity, response, value, and user references. |
| `callin_script_template` | 4 | Call-in scripts based on equipment, order, revenue, stop, and user-group criteria. |
| `callin_script_template_detail` | 40 | Call-in script detail rows. |

### 3.2 Equipment, safety, claims, and detention

| Table | Rows | Configuration role indicated by schema |
|---|---:|---|
| `equipment_type` | 292 | Equipment type definitions and external mappings. |
| `equipment_type_match` | 212 | Equipment-type matching rules. |
| `equipstatuscode` | 4 | Equipment status codes. |
| `equipment_pool_rule` | 0 | Equipment-pool assignment rules. |
| `accident_control` | 3 | Accident workflow/control, recruitment email, inspection bonus/penalty codes, and label template reference. |
| `accidenttype` | 0 | Accident type vocabulary schema. |
| `alcohol_control` | 1 | Alcohol/compliance control. |
| `drugcontrol` | 1 | Drug/compliance control. |
| `claim_type` | 12 | Claim-type vocabulary. |
| `detention_profile` | 4 | Detention profiles by location/stop type and operations user. |
| `detention_control` | 0 | Detention email and historical-view control schema. |
| `detention_def` | 0 | Detention billing/pay definitions and earning-code schema. |
| `dock_control` | 4 | Dock/hostler/workflow controls, barcode patterns, staging, and automation. |
| `driver_manager_profile` | 2 | Driver-manager default tabs and views. |
| `driverlogcontrol` | 0 | Driver-log control schema. |
| `trailer_loan_profile` | 0 | Trailer-loan profile schema. |
| `trailer_wash_code` | 0 | Trailer-wash code/type schema. |
| `trailer_wash_control` | 0 | Trailer-wash enablement and ticket-template schema. |
| `video_safety_control` | 0 | Video-safety endpoint/email schema. |
| `violation_code` | 0 | Violation code and rule-type schema. |
| `hazmat_code` | 3,403 | Hazmat class and code vocabulary. |
| `freight_group_item_profile` | 0 | Freight-item, packaging, NMFC, and hazmat profile schema. |
| `freight_item_type` | 0 | Freight-item type and required-field schema. |

## 4. EDI, import/export, communication, and integrations

### 4.1 EDI profiles and definitions

| Table | Rows | Configuration role indicated by schema |
|---|---:|---|
| `edi_control` | 4 | Company-level EDI control. |
| `edi_control_shared` | 1 | Shared EDI server/cache/intercompany settings. |
| `edi_as2_control` | 1 | AS2 enablement, directories, MDN, URL, and command-user configuration. Values were not read. |
| `edi_comm_control` | 11 | EDI communications transport, connection, authentication type, URL, and token-endpoint configuration. Values were not read. |
| `edi_profile` | 0 | EDI acknowledgment/template/transmit profile schema. |
| `edi_profile_deter` | 0 | EDI profile detail schema. |
| `edi_template` | 9 | EDI sender/receiver, format, transaction, and translation templates. |
| `edi_template_text` | 1,658 | EDI template text/detail. |
| `edi_transformation_profile` | 0 | EDI transformation profile schema. |
| `edibilling_profile` | 1 | Billing EDI acknowledgment, template, transmit, auto-rate, and image settings. |
| `ediorder_profile` | 3 | Order EDI settings including equipment, order, pay, rate, revenue, segment-allocation, location, and partner mappings. |
| `edistatus_profile` | 1 | EDI status acknowledgment, batch, create, hold, template, transmit, and image settings. |
| `edischedule` | 2 | EDI transaction schedule/parent-row configuration. |
| `edimonitor_control` | 4 | EDI monitor backup profiles and backup time. |
| `edi_process_setting` | 6 | EDI processing settings. |
| `edi_data_rule` | 1 | EDI data-rule values/tests. |
| `edi_dataruleshared` | 28 | Shared EDI data rules. |
| `edi_shipmatch_rule` | 0 | EDI shipment-match/deduction mapping schema. |
| `edi_sysadmin_rule` | 80 | EDI system-admin email/filter rules. |
| `edi_partner_code` | 1,846 | EDI partner-code vocabulary and enabled flags. |
| `edi_standard_code` | 353,560 | EDI standard-code vocabulary. |
| `edi_error_code` | 54 | EDI error-code vocabulary. |
| `edi_composite_def` | 1,772 | EDI composite definitions. |
| `edi_element_def` | 16,838 | EDI element definitions and data types. |
| `edi_segment_def` | 88,170 | EDI segment definitions. |
| `edi_set_definition` | 88,869 | EDI transaction/set definitions. |
| `edi_logger_setting` | 52 | EDI log-level and retention settings. |
| `edi_imaging_config` | 0 | EDI imaging configuration schema. |
| `edidelaycode` | 0 | EDI delay-code schema. |

### 4.2 File, API, email, and vendor integration controls

| Table | Rows | Configuration role indicated by schema |
|---|---:|---|
| `fileimport_profile` | 125 | Import profiles with data type, description, action, and previous-code matching. |
| `fileexport_profile` | 0 | Export profile schema. |
| `import_data_type` | 260 | Import data-type descriptions. |
| `data_feed_control` | 12 | Data-feed direction, format, transfer, and processing controls. |
| `email_control` | 3 | Default email/fax/SMS/rate-request controls. |
| `email_profile` | 23 | Email transport/profile configuration. Credential-bearing columns exist; values were not read. |
| `sms_control` | 4 | SMS account/callback configuration. Values were not read. |
| `exchange_control` | 3 | Exchange/contact method, URL, and username configuration. Values were not read. |
| `public_api_control` | 1 | Public API enablement and user-creation control. |
| `remote_profile` | 0 | Remote transport profile schema. |
| `remote_http_header` | 0 | Remote HTTP header schema. |
| `hubtran_control` | 4 | HubTran API and outbound order-history/comment settings. Values were not read. |
| `contract_management_control` | 0 | Contract-management endpoint and web-tendering schema. |
| `macropoint_control` | 0 | MacroPoint vendor URL/error-email schema. |
| `fourkites_control` | 0 | FourKites email/control schema. |
| `ufollowit_control` | 0 | uFollowIt master-user schema. |
| `carrierins_control` | 4 | Carrier-insurance onboarding, packet URL, and notification settings. Values were not read. |
| `imaging_control` | 1 | Imaging host configuration. Values were not read. |
| `p44_config_profile` | 0 | Project44 configuration profile schema. |
| `loadpay_control` | 0 | LoadPay vendor URL and default setting schema. |
| `triumphpay_control` | 0 | TriumphPay vendor URL/default setting schema. |
| `tenfour_control` | 4 | TenFour email/username configuration. Values were not read. |
| `tenfour_email_control` | 0 | TenFour email exception schema. |
| `tmi_control` | 0 | TMI control schema. |
| `tmt_control` | 0 | TMT account-map, fuel update, and exception-email schema. |
| `vcard_control` | 0 | Virtual-card accounting defaults, transaction limits, and voucher type schema. |
| `vcard_user` | 0 | Virtual-card user limits/schema. |
| `www_control` | 4 | Web portal notifications, rate requests, factoring, advances, templates, and user-group settings. Values were not read. |
| `www_cust_control` | 0 | Customer web settings and quick-pay/advance configuration schema. |
| `www_equipment_type` | 0 | Customer web equipment-type schema. |

## 5. Reporting, templates, alerts, and workflow configuration

| Table | Rows | Configuration role indicated by schema |
|---|---:|---|
| `report_template` | 217 | Report/document templates with document, HTML, label, print-device, template-number, and engine settings. |
| `report_template_revision` | 0 | Report-template revision schema. |
| `report_schedule` | 19 | Scheduled reports, notification users/emails, next-generation date, and email profile references. |
| `fs_column_def` | 2 | Financial/report column definitions. |
| `fs_report_def` | 1 | Financial/report definition. |
| `fs_row_def` | 1 | Financial/report row definition. |
| `kpi_definition` | 36 | KPI definitions, methods, exclusions, delay/OSD types, and report descriptions. |
| `kpi_template` | 8 | KPI templates and driver-type associations. |
| `perf_alert_def` | 56 | Performance alert thresholds, metrics, periods, enablement, and notification content. |
| `rapid_alert_def` | 0 | Rapid operational/financial alert schema. |
| `pft_control` | 0 | Profitability report/control schema. |
| `crm_vs_profile` | 0 | CRM versus-sales profile schema. |
| `bid_scoreboard_profile` | 0 | Bid-scoreboard filters and profitability/rate-index profile schema. |
| `integrated_search_profile` | 4 | Integrated-search profile definitions. |
| `integrated_search_detail` | 20 | Integrated-search configuration details. |
| `integrated_search_detail_group` | 16 | Integrated-search detail groups. |
| `integrated_search_result` | 0 | Integrated-search result schema. |
| `information_packet` | 1,938 | Information/packet records used by configured workflows or UI features. |
| `list_config` | 15,615 | List/grid configuration. |
| `list_definition` | 0 | List-definition schema. |
| `callin_script_template` | 4 | Call-in script templates. |
| `callin_script_template_detail` | 40 | Call-in script template details. |
| `object_workflow` | 0 | Generic object workflow schema. |
| `osd_workflow` | 0 | Over/short/damage workflow schema. |
| `invoice_workflow` | 0 | Invoice workflow schema. |
| `invoice_workflow_history` | 0 | Invoice workflow history schema. |
| `brokerage_workflow` | 0 | Brokerage workflow schema. |
| `brokerage_workflow_detail` | 0 | Brokerage workflow detail schema. |
| `manifest_workflow` | 0 | Manifest workflow schema. |
| `notification_control` | 0 | Notification type/status/service configuration schema. |
| `notification_definition` | 0 | Notification definitions/schema. |

## 6. Financial and fuel policy/configuration tables

These tables overlap with the accounting inventory but are included here because they define behavior, limits, mappings, or defaults rather than transaction history.

| Table | Rows | Configuration role indicated by schema |
|---|---:|---|
| `gl_control` | 4 | GL segment delimiter and segment-description configuration. |
| `gl_control_mapping` | 4 | GL control mapping. |
| `gl_segment_code` | 4 | GL segment-code vocabulary. |
| `gl_type` | 43 | GL account/type configuration. |
| `ap_control` | 4 | AP posting/check and default-date configuration. |
| `arcontrol` | 4 | AR billing/invoice/statement/template and exchange-rate configuration. |
| `payroll_control` | 4 | Payroll GL mappings, limits, pay frequencies, check type, tax, and settlement settings. |
| `revenue_code` | 15 | Revenue-code descriptions and revenue/expense GL mapping. |
| `seg_alloc_code` | 6 | Segment-allocation code and GL-segment assignments. |
| `seg_alloc_control` | 4 | Revenue, settlement, and other segment-allocation methods. |
| `rate_index_control` | 3 | Rate-index generation and billed/contract/spot rate types. |
| `fuel_tax_control` | 3 | Fuel-tax control and fuel-stop mapping. |
| `fuel_tax_file_type` | 0 | Fuel-tax file schedule schema. |
| `fuel_chain_code` | 11 | Fuel-chain code vocabulary. |
| `fuel_prod_code` | 303 | Fuel product code/descriptions. |
| `ifuel_control` | 2 | Fuel-provider URLs, certificates, validation, product, PIN, tractor, and tax settings. Values were not read. |
| `ifuel_msts_policy_mstr` | 22 | MSTS fuel policy master. |
| `ifuel_card_limit` | 0 | Fuel-card limit schema. |
| `ifuel_limits_msts` | 0 | MSTS amount/quantity policy-limit schema. |
| `ifuel_product_limit` | 0 | Product-specific fuel limits schema. |
| `wirecode` | 39 | Fuel/advance wire limits, deduction/charge mappings, and issuing-user rules. |
| `charge_code` | 21 | Charge rate/pay/deduction behavior and EDI code mappings. |
| `charge_code_edi` | 4 | Charge-to-EDI mappings. |
| `deduct_code` | 233 | Deduction types, tax flags, limits, and code behavior. |
| `deduct_code_edi` | 0 | Deduction-to-EDI mappings schema. |
| `map_charge_to_deduct_code` | 0 | Charge-to-deduction mappings schema. |
| `partner_settlements_setup` | 0 | Partner-settlement cycle, invoice, AP/AR, and statement settings schema. |
| `currency_type` | 3 | Currency type vocabulary. |
| `currency_control` | 0 | Currency selector/control schema. |
| `currency_exchange_def` | 0 | Exchange calculation and variance schema. |
| `currency_mapping` | 0 | Currency mapping schema. |
| `tax_deduct_setup` | 0 | Tax deduction and W-2 code setup schema. |
| `taxyear_setup` | 19 | Tax-year/quarter setup. |

## 7. Active profile and control observations

### Populated profile tables

The populated profile tables are:

- `brk_qual_profile` — 8
- `call_list_profile` — 4
- `daily_snap_profile` — 1
- `detention_profile` — 4
- `driver_manager_profile` — 2
- `email_profile` — 23
- `fileimport_profile` — 125
- `integrated_search_profile` — 4
- `kpi_template` — 8
- `planning_profile` — 20
- `report_template` — 217

Several profile families exist only as schema in this snapshot, including daily brokerage, drag-and-drop dispatch, manifest, order history, routing guide, remote, transformation, customer web, P44, and WS search profiles.

### Populated control tables

The populated control tables include:

- `accident_control` — 3
- `agent_access_ctrl` — 4
- `alcohol_control` — 1
- `ap_control` — 4
- `arcontrol` — 4
- `carrierins_control` — 4
- `data_feed_control` — 12
- `dispatch_control` — 4
- `distance_control` — 4
- `dock_control` — 4
- `edi_as2_control` — 1
- `edi_comm_control` — 11
- `edi_control` — 4
- `edi_control_shared` — 1
- `edimonitor_control` — 4
- `email_control` — 3
- `exchange_control` — 3
- `fuel_tax_control` — 3
- `geocode_control` — 22
- `gl_control` — 4
- `gp_control` — 4
- `hubtran_control` — 4
- `ifuel_control` — 2
- `imaging_control` — 1
- `mapping_control` — 4
- `mc_control` — 5
- `mc_exapp_control` — 53
- `mc_zmit_options` — 5
- `payroll_control` — 4
- `pnn_control` — 2
- `public_api_control` — 1
- `purge_control` — 332
- `rate_index_control` — 3
- `seg_alloc_control` — 4
- `sms_control` — 4
- `tenfour_control` — 4
- `www_control` — 4

### Additional populated reference/configuration tables

The main sections above describe the functional configuration families. These populated reference/configuration tables are also part of the 142 populated candidates:

| Table | Rows | Role indicated by schema |
|---|---:|---|
| `ap_1099_code` | 44 | AP 1099 code vocabulary. |
| `ap_cycle_code` | 38 | AP cycle-code vocabulary. |
| `ap_term_code` | 5 | AP payment-term vocabulary. |
| `ar_reason_code` | 6 | AR reason-code vocabulary. |
| `bank_trx_code` | 36 | Bank transaction-code vocabulary. |
| `bid_status_code` | 64 | Bid-status vocabulary. |
| `br_tracking_mc_mapping` | 24 | Brokerage tracking/message-code mappings. |
| `claim_type` | 12 | Claim-type vocabulary. |
| `excisetax_control` | 3 | Excise-tax control. |
| `job_class_code` | 1 | Job-class vocabulary. |
| `map_brokerage_code` | 3,736 | Brokerage/external code mappings. |
| `mc_error_code` | 1,816 | McLeod error-code vocabulary. |
| `tch_prompt` | 92 | TCH prompt/reference vocabulary. |
| `w2_box_12_codes` | 30 | W-2 Box 12 code vocabulary. |

## 8. Empty profile/configuration schemas

The catalog contains 151 empty candidate schemas. The lists below call out the notable empty families; the complete count is preserved above, but these lists are grouped for readability rather than being a substitute for a machine-generated zero-row appendix. An empty result means the schema exists without rows in this snapshot; it does not prove that the feature is unavailable or disabled.

### Empty operational/profile schemas

`accidenttype`, `alk_trip_control`, `barcode_parsing_rule`, `bid_scoreboard_profile`, `bonus_code_dtl`, `bonus_code_hdr`, `brokerage_workflow`, `brokerage_workflow_detail`, `carrier_call_list_profile`, `carrier_performance_profile`, `dedicated_cycle_code`, `dedicated_group_code`, `dl_ded_type_det`, `dl_ded_type_reg`, `dl_reason_code`, `dr_action_code`, `dr_agent_setup`, `dr_app_profile`, `dr_applicant_type`, `dr_workflow`, `dragndrop_profile`, `ds_cap_profile`, `ds_me_eta_profile`, `ds_mv_eval_profile`, `dspopt_control`, `equipment_pool_rule`, `fak_profile`, `fourkites_control`, `freight_group_item_profile`, `freight_item_type`, `geocode_notify`, `late_route_control`, `linehaul_routing_option`, `logistics_control`, `macropoint_control`, `manh_tr_type`, `manh_tr_type_dtl`, `manh_trailer_type`, `manh_trailer_type_dtl`, `manifest_profile`, `manifest_workflow`, `notification_control`, `notification_definition`, `object_workflow`, `orderhist_profile`, `orderhist_profile_detail`, `osd_workflow`, `p44_config_profile`, `perf_rule_match`, `pft_control`, `pnn_builder_profile`, `pnn_revcode`, `policyholder`, `prospect_type`, `rapid_alert_def`, `routing_guide_profile`, `routing_guide_profile_dtl`, `routing_guide_user_groups`, `routing_guide_users`, `service_commission_rule`, `trailer_loan_profile`, `trailer_wash_code`, `trailer_wash_control`, `trailer_wash_users`, `txl_icon_color_control`, `ufollowit_control`, `video_safety_control`, `violation_code`, `www_cust_control`, `www_equipment_type`.

### Empty integration and communication schemas

`contract_management_control`, `credit_control`, `currency_control`, `currency_exchange_def`, `currency_mapping`, `edi_api_user`, `edi_imaging_config`, `edi_profile`, `edi_profile_deter`, `edi_shipmatch_rule`, `edi_transformation_profile`, `edi_user_tmpcolors`, `fileexport_profile`, `fuelopt_control`, `fuel_tax_file_type`, `ifuel_card_comdata`, `ifuel_card_efs`, `ifuel_card_fle`, `ifuel_card_limit`, `ifuel_card_msts`, `ifuel_card_quikq`, `ifuel_card_tchek`, `ifuel_limits_msts`, `ifuel_policies_msts`, `ifuel_pool_efs_dtl`, `ifuel_pool_efs_hdr`, `ifuel_product_limit`, `ifuel_quikq_asset`, `ifuel_quikq_override`, `ifuel_user_limit`, `invoice_workflow`, `invoice_workflow_history`, `loadpay_control`, `mc_fueltax_control`, `p44_config_profile`, `remote_profile`, `system_config`, `tenfour_email_control`, `tmi_control`, `tmt_control`, `triumphpay_control`, `vcard_control`, `vcard_user`, `web_users`, `web_user_roles`, `ws_search_profile`, `ws_search_profile_users`.

### Empty reference and definition schemas

`ap_begin_bal`, `ar_cycle_code`, `budget_code`, `code_mask`, `deduct_code_edi`, `excisetax_code`, `fsc_rates_canada`, `gl_batch_type`, `gl_journal_type`, `gl_mapping`, `gl_source_type`, `icard_limits_msts`, `image_type`, `list_definition`, `map_charge_to_deduct_code`, `map_external_code_to_gla_code`, `gp_mapping`, `rateware_tariff_code`, `ratedisk_zipcode`, `revenue_allocation_control`, `revenue_code_dim`, `tax_deduct_setup`, `w2_paid_insurance`. Related populated vocabularies include `currency_type` and `order_type`, while their broader definition/profile families are sparse or empty.

## 9. Configuration relationships and likely extraction paths

### 9.1 User-to-profile path

```text
users
  -> user_group / webusertype
  -> operational profile IDs
       -> dispatch / planning / manifest / report / import / alert behavior
```

The `users` table stores many profile references, but this snapshot shows sparse direct assignment for several profile columns. A future analysis should inspect blank versus non-null semantics and confirm whether company-level defaults override user-level references.

### 9.2 Company-control path

```text
company
  -> company-scoped *_control rows
       -> dispatch / distance / GL / AP / AR / payroll / EDI / web behavior
```

The inspected controls commonly have one row per company. Any configuration export must include the company key and should never merge controls across companies solely by row order.

### 9.3 EDI configuration path

```text
edi_control / edi_comm_control
  -> edi_profile / ediorder_profile / edistatus_profile / edibilling_profile
  -> edi_template / edi_template_text
  -> edi_partner_code / edi_standard_code
  -> edi_set_definition / edi_segment_def / edi_element_def
```

The EDI definition tables are among the largest configuration/reference datasets. They describe message vocabulary and structure, not necessarily active carrier usage. Active usage should be determined through profile, partner, schedule, and transaction relationships.

### 9.4 Fuel-policy path

```text
ifuel_control
  -> ifuel_msts_policy_mstr / ifuel_card_* / ifuel_user*
  -> fuel product, cash, quantity, and purchase limits
```

The fuel-policy area contains credential-bearing schema fields and monetary/quantity limits. It should be queried only through a field allowlist and never with `SELECT *`.

## 10. Sensitive configuration surfaces

The schema contains configuration areas that may hold secrets or personal/financial access data:

- `email_profile` and `users` contain credential-bearing email configuration columns.
- `ifuel_user` contains vendor/user access and cash/purchase-limit fields.
- `edi_comm_control`, `edi_as2_control`, `exchange_control`, `hubtran_control`, `sms_control`, `tenfour_control`, and related tables contain endpoint, username, authentication, or certificate-related fields.
- `direct_deposit`, bank configuration, and payment-provider tables can expose financial-account or payment-routing data.
- User, payee, tax, and web-user tables contain identity or access-control data.

No values from these columns were selected for this inventory. Any follow-up configuration export must explicitly enumerate approved non-secret columns and redact endpoint credentials, passwords, access tokens, private keys, tax IDs, bank details, and personal contact data.

## 11. Findings and recommended next steps

### Findings

1. **Configuration is distributed, not centralized.** There are 293 profile/configuration/reference candidates across many McLeod modules.
2. **The active configuration is concentrated in a few areas.** Dispatch/distance, EDI definitions, list/report templates, user UI configuration, code vocabularies, and fuel policies are populated.
3. **Many profile families are schema-only.** Routing guide, manifest, remote, customer web, P44, transformation, and several payment/integration profiles contain no rows in this snapshot.
4. **Company controls are strongly partitioned.** Many core controls have four rows for four distinct companies; company-scoped filtering is required.
5. **User-level profile assignment is sparse.** Only one direct `daily_snap_profile` assignment was observed through the checked user columns; profile use may be driven by other tables or company defaults.
6. **EDI metadata is extensive.** The large EDI definition tables should not be treated as proof that every EDI transaction type is enabled or active.
7. **Configuration includes sensitive credentials.** Configuration analysis must remain metadata-first and field-allowlisted.

### Recommended read-only next steps

1. Confirm which configuration domain is needed: dispatch, EDI, fuel policy, user access, reporting, or accounting controls.
2. Obtain the exact LoadMaster version data dictionary and confirm the semantics of profile IDs, blank values, company scoping, and enablement flags.
3. Build a narrow query for active rows using an explicit non-secret field allowlist.
4. Resolve user/profile and company/control relationships before exporting configuration.
5. Use the supported McLeod API or an approved read-only view where the configuration is exposed there; use direct SQL only for gaps.
6. Never issue configuration writes directly against this database. Test any future integration against a separate approved copy and use McLeod application/API workflows for changes.

The database is suitable for read-only configuration discovery, but this inventory is not an authorization to modify any profile, control, policy, endpoint, user, or integration record.
