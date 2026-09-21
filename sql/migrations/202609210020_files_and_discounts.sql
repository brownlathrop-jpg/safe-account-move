-- Догоняем схему до фактического состояния базы:
-- таблица файлов (картинки товаров) и таблица скидок создавались вручную.

create table if not exists files (
  id           text primary key,
  bucket       text not null,
  path         text not null,
  content_type text not null default 'application/octet-stream',
  bytes        bytea not null,
  workspace_id text,
  created_at   timestamptz not null default now()
);

alter table files add column if not exists workspace_id text;
create unique index if not exists files_bucket_path_key on files (bucket, path);
create index if not exists files_ws_idx on files (workspace_id);

-- картинки без базы больше не отдаются (api/file.$.ts возвращает 403),
-- поэтому проставляем базу по товару, который ссылается на этот файл
update files f
   set workspace_id = (
     select p.workspace_id from products p
      where p.workspace_id is not null
        and (p.data->>'image_url') = '/api/file/' || f.path
      limit 1
   )
 where f.workspace_id is null;

-- таблица скидок (есть в списке разрешённых таблиц приложения)
create table if not exists discounts (
  id           text primary key,
  workspace_id text,
  user_id      text,
  data         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists discounts_ws_idx on discounts (workspace_id);
create index if not exists discounts_user_idx on discounts (user_id);
create index if not exists discounts_data_idx on discounts using gin (data jsonb_path_ops);
