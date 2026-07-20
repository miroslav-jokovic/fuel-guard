-- Payment method for MANUAL fill-ups whose fuel was NOT bought on an EFS card. EFS-card and imported fills
-- arrive already attributed to a card, so this stays null for them; it's captured on the Log Fill-up form
-- for cash / checks / personal or fleet cards / vouchers, so those spends aren't left ambiguous.
alter table fuel_transactions add column if not exists payment_method text;

comment on column fuel_transactions.payment_method is
  'Tender for a MANUAL fill not on an EFS card: cash | efs_check | personal_card | fleet_card | fuel_voucher | other. Null for EFS-card / imported fills.';
