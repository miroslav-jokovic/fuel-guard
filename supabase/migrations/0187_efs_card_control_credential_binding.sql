-- 0187 — bind card-control capability and mutation evidence to the EFS credential identity.
--
-- These columns are additive and nullable so deployment does not revoke the two existing confirmed
-- orgs before their next probe. A null probed_identity_hash means the entitlement was probed before
-- credential identity binding existed; it is grandfathered temporarily and logged once per org by the
-- capability check. Phase 2 exit gate: no org with write_entitlement = 'confirmed' may still have a
-- null probed_identity_hash.

alter table efs_card_control_settings
  add column if not exists probed_endpoint_host text,
  add column if not exists probed_identity_hash text,
  add column if not exists probed_document_shape text;

comment on column efs_card_control_settings.probed_endpoint_host is
  'Hostname of the EFS endpoint used by the probe that established write entitlement; null means no endpoint was recorded yet.';
comment on column efs_card_control_settings.probed_identity_hash is
  'Keyed hash of the probed EFS endpoint host, SOAP username and account id; null means the entitlement predates credential identity binding and is temporarily grandfathered. Phase 2 exit gate: no org with write_entitlement = ''confirmed'' may still have a null probed_identity_hash.';
comment on column efs_card_control_settings.probed_document_shape is
  'Document shape observed during the entitlement probe, such as flat or nested:header; null means the probe did not observe a card document shape.';

alter table efs_card_mutations
  add column if not exists environment text,
  add column if not exists endpoint_host text,
  add column if not exists card_last4 text;

comment on column efs_card_mutations.environment is
  'EFS environment resolved on the credentials used for this write; null means the mutation predates environment evidence.';
comment on column efs_card_mutations.endpoint_host is
  'EFS endpoint hostname resolved on the credentials used for this write; null means the mutation predates endpoint evidence.';
comment on column efs_card_mutations.card_last4 is
  'Last four digits of the card targeted by this write; null means the mutation predates this forensic field.';
