-- Мгновенные обновления (LISTEN/NOTIFY) и признак администратора.

alter table app_users add column if not exists is_admin boolean not null default false;

create or replace function crm_notify_change() returns trigger
language plpgsql as $$
declare
  r record;
  j jsonb;
begin
  if (tg_op = 'DELETE') then r := old; else r := new; end if;
  j := to_jsonb(r);
  perform pg_notify('crm_changes', json_build_object(
    'table', tg_table_name,
    'id', j->>'id',
    'workspace_id', j->>'workspace_id',
    'op', lower(tg_op)
  )::text);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'workspaces','products','product_folders','product_types','partners',
    'invoices','invoice_items','invoice_statuses','warehouses','stock_movements',
    'stock_receipts','stock_receipt_items','cashflow_items','organizations',
    'bank_accounts','banks','price_types','units'
  ] loop
    execute format('drop trigger if exists crm_notify on %I', t);
    execute format(
      'create trigger crm_notify after insert or update or delete on %I for each row execute function crm_notify_change()', t);
  end loop;
end $$;
