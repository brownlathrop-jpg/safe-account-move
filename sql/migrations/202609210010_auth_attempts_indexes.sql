-- Раздельные счётчики блокировки входа: индексы под выборки по email и по IP.
create index if not exists auth_attempts_email_idx
  on auth_attempts (lower(email), created_at) where ok = false;

create index if not exists auth_attempts_ip_idx
  on auth_attempts (ip, created_at);
