-- Личные настройки пользователя (в т.ч. тип цены по умолчанию).
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
