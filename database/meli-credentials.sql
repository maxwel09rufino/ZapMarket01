CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS meli_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  credential_name text,
  client_id text,
  client_secret text,
  refresh_token text,
  access_token text,
  token_type text DEFAULT 'Bearer',
  expires_at timestamptz,
  meli_user_id text,
  meli_nickname text,
  site_id text DEFAULT 'MLB',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE IF NOT EXISTS meli_product_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  credential_id uuid REFERENCES meli_credentials(id) ON DELETE SET NULL,
  product_link text NOT NULL,
  product_id text,
  title text,
  price numeric(12, 2),
  currency text,
  image_url text,
  seller_name text,
  stock integer,
  is_valid boolean,
  error_message text,
  validation_status text CHECK (validation_status IN ('success', 'error', 'pending')),
  user_agent text,
  response_time_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meli_credential_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid NOT NULL REFERENCES meli_credentials(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'refreshed', 'revoked', 'error')),
  details jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meli_credentials_user_id_idx
  ON meli_credentials(user_id);

CREATE INDEX IF NOT EXISTS meli_credentials_active_idx
  ON meli_credentials(user_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS meli_product_validations_user_id_idx
  ON meli_product_validations(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS meli_credential_logs_credential_id_idx
  ON meli_credential_logs(credential_id, created_at DESC);
