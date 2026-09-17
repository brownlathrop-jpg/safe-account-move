-- Этап 4: работа командой — участники базы, приглашения, история изменений.

-- участники базы: data { email, role: owner|manager|storekeeper|viewer, name }
CREATE TABLE IF NOT EXISTS workspace_members (
  id           text PRIMARY KEY,
  workspace_id text,
  user_id      text,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_members_ws_idx ON workspace_members (workspace_id);
CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_uniq ON workspace_members (workspace_id, user_id);

DROP TRIGGER IF EXISTS crm_notify ON workspace_members;
CREATE TRIGGER crm_notify AFTER INSERT OR UPDATE OR DELETE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION crm_notify_change();

-- приглашения по e-mail
CREATE TABLE IF NOT EXISTS workspace_invites (
  token        text PRIMARY KEY,
  workspace_id text NOT NULL,
  email        text NOT NULL,
  role         text NOT NULL DEFAULT 'manager',
  invited_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS workspace_invites_email_idx ON workspace_invites (lower(email));
CREATE INDEX IF NOT EXISTS workspace_invites_ws_idx ON workspace_invites (workspace_id);

-- история изменений документов
CREATE TABLE IF NOT EXISTS document_log (
  id           bigserial PRIMARY KEY,
  workspace_id text,
  doc_table    text NOT NULL,
  doc_id       text,
  user_id      text,
  user_email   text,
  op           text NOT NULL,
  changes      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_log_doc_idx ON document_log (doc_table, doc_id, created_at DESC);
CREATE INDEX IF NOT EXISTS document_log_ws_idx ON document_log (workspace_id, created_at DESC);
