-- Тарифы, срок оплаты доступа, платежи и подтверждение e-mail.

alter table workspaces add column if not exists plan text not null default 'trial';
alter table workspaces add column if not exists paid_until timestamptz;
alter table workspaces add column if not exists suspended boolean not null default false;

create table if not exists workspace_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  amount numeric(14,2) not null default 0,
  months int not null default 1,
  plan text not null default '',
  paid_until timestamptz,
  comment text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists workspace_payments_ws_idx on workspace_payments (workspace_id, created_at desc);

alter table app_users add column if not exists email_confirmed_at timestamptz;

create table if not exists email_confirmations (
  token text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists email_confirmations_user_idx on email_confirmations (user_id);

-- действующим пользователям и базам ничего не ломаем
update app_users set email_confirmed_at = coalesce(email_confirmed_at, created_at, now());
update workspaces
   set plan = 'pro',
       paid_until = coalesce(paid_until, now() + interval '5 years')
 where plan = 'trial';
