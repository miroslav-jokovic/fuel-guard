-- 0034: reviewer ground-truth disposition on cases — the label the accuracy program is built on.
-- Distinct from workflow `status` (where it sits in the queue): disposition records whether the flag was
-- RIGHT. Precision = confirmed / (confirmed + false_positive + benign_explained); inconclusive is excluded.
alter table anomalies add column if not exists disposition    text
  check (disposition in ('confirmed', 'false_positive', 'benign_explained', 'inconclusive'));
alter table anomalies add column if not exists disposition_by  uuid references auth.users(id);
alter table anomalies add column if not exists disposition_at  timestamptz;

-- Metrics queries scan by org over disposed cases (optionally windowed by when the fill happened).
create index if not exists idx_anomalies_disposition on anomalies (org_id, disposition, fueled_at desc)
  where disposition is not null;
