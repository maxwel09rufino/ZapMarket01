CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS bot_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone varchar(64) NOT NULL,
  remote_jid text NOT NULL,
  contact_name text,
  bot_active boolean NOT NULL DEFAULT false,
  linked_campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  last_message text,
  last_message_from_me boolean NOT NULL DEFAULT false,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE bot_sessions
  ADD COLUMN IF NOT EXISTS contact_name text;

ALTER TABLE bot_sessions
  ADD COLUMN IF NOT EXISTS bot_active boolean NOT NULL DEFAULT false;

ALTER TABLE bot_sessions
  ADD COLUMN IF NOT EXISTS linked_campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL;

ALTER TABLE bot_sessions
  ADD COLUMN IF NOT EXISTS last_message text;

ALTER TABLE bot_sessions
  ADD COLUMN IF NOT EXISTS last_message_from_me boolean NOT NULL DEFAULT false;

ALTER TABLE bot_sessions
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz;

ALTER TABLE bot_sessions
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW();

ALTER TABLE bot_sessions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();

ALTER TABLE bot_sessions
  ALTER COLUMN phone TYPE varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS bot_sessions_phone_uidx
  ON bot_sessions (phone);

CREATE UNIQUE INDEX IF NOT EXISTS bot_sessions_remote_jid_uidx
  ON bot_sessions (remote_jid);

CREATE INDEX IF NOT EXISTS bot_sessions_last_message_idx
  ON bot_sessions (last_message_at DESC NULLS LAST, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_message_id text,
  phone varchar(64) NOT NULL,
  remote_jid text NOT NULL,
  contact_name text,
  message text NOT NULL,
  from_me boolean NOT NULL DEFAULT false,
  message_type text NOT NULL DEFAULT 'text',
  created_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS whatsapp_message_id text;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS remote_jid text;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS contact_name text;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text';

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW();

ALTER TABLE messages
  ALTER COLUMN phone TYPE varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS messages_whatsapp_message_id_uidx
  ON messages (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_phone_created_idx
  ON messages (phone, created_at DESC);

CREATE INDEX IF NOT EXISTS messages_remote_jid_created_idx
  ON messages (remote_jid, created_at DESC);

CREATE TABLE IF NOT EXISTS bot_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone varchar(64),
  remote_jid text,
  level text NOT NULL DEFAULT 'info',
  event text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE bot_logs
  ADD COLUMN IF NOT EXISTS phone varchar(64);

ALTER TABLE bot_logs
  ADD COLUMN IF NOT EXISTS remote_jid text;

ALTER TABLE bot_logs
  ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'info';

ALTER TABLE bot_logs
  ADD COLUMN IF NOT EXISTS event text NOT NULL DEFAULT 'event';

ALTER TABLE bot_logs
  ADD COLUMN IF NOT EXISTS details jsonb;

ALTER TABLE bot_logs
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW();

ALTER TABLE bot_logs
  ALTER COLUMN phone TYPE varchar(64);

CREATE INDEX IF NOT EXISTS bot_logs_created_idx
  ON bot_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS bot_logs_phone_created_idx
  ON bot_logs (phone, created_at DESC);
