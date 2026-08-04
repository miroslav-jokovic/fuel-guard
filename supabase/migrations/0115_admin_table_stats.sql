-- 0115: admin_table_stats() — table-size/row-count visibility for the diagnostics panel, so data growth
-- is a number on a screen instead of a surprise (the hos_duty_segments statement-timeout incident was
-- discovered only when a job started failing). SECURITY DEFINER because pg_stat_user_tables needs owner
-- rights; execute is revoked from every client role — ONLY the service role (the API's diagnostics
-- endpoint, which is admin-gated) may call it. No table data is exposed, only relation names and sizes.
create or replace function admin_table_stats()
returns table (table_name text, live_rows bigint, dead_rows bigint, total_bytes bigint)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select relname::text,
         n_live_tup::bigint,
         n_dead_tup::bigint,
         pg_total_relation_size(relid)::bigint
  from pg_stat_user_tables
  where schemaname = 'public'
  order by pg_total_relation_size(relid) desc;
$$;

revoke all on function admin_table_stats() from public;
revoke all on function admin_table_stats() from anon;
revoke all on function admin_table_stats() from authenticated;
grant execute on function admin_table_stats() to service_role;
