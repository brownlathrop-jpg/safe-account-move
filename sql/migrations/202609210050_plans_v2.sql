-- Новая линейка тарифов: бесплатный, ИП, Бизнес, Опт + дополнительные пользователи и опции.

alter table workspaces add column if not exists extra_members int not null default 0;
alter table workspaces add column if not exists addons jsonb not null default '[]'::jsonb;

-- переносим старые названия тарифов
update workspaces set plan = 'free' where plan in ('trial', '');
update workspaces set plan = 'ip' where plan = 'start';
update workspaces set plan = 'opt' where plan = 'pro';
update workspaces set plan = 'free' where plan not in ('free', 'ip', 'business', 'opt');

update workspace_payments set plan = 'free' where plan = 'trial';
update workspace_payments set plan = 'ip' where plan = 'start';
update workspace_payments set plan = 'opt' where plan = 'pro';

-- быстрый подсчёт документов за месяц (лимит бесплатного тарифа)
create index if not exists invoices_ws_created_idx on invoices (workspace_id, created_at desc);
