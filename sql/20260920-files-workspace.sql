-- Картинки и файлы привязываем к базе (workspace), чтобы клиенты не видели чужие.
ALTER TABLE files ADD COLUMN IF NOT EXISTS workspace_id text;
CREATE INDEX IF NOT EXISTS files_ws_idx ON files (workspace_id);
