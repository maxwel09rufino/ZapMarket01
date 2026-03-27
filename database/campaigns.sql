CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_title text NOT NULL,
  select_all_products boolean NOT NULL DEFAULT false,
  product_count integer NOT NULL DEFAULT 1 CHECK (product_count > 0),
  message_template text NOT NULL,
  preview_message text NOT NULL,
  delay_seconds integer NOT NULL CHECK (delay_seconds > 0),
  batch_limit integer NOT NULL DEFAULT 50 CHECK (batch_limit > 0),
  total_contacts integer NOT NULL DEFAULT 0 CHECK (total_contacts >= 0),
  total_recipients integer NOT NULL CHECK (total_recipients >= 0),
  sent_count integer NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  submitted_count integer NOT NULL DEFAULT 0 CHECK (submitted_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  remaining_count integer NOT NULL CHECK (remaining_count >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'finished', 'failed')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS campaign_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES recipients(id) ON DELETE RESTRICT,
  recipient_name text NOT NULL,
  recipient_type text NOT NULL DEFAULT 'contact' CHECK (recipient_type IN ('contact', 'group', 'channel')),
  recipient_phone text NOT NULL,
  recipient_target text NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_title text,
  product_image text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'submitted', 'sent', 'failed')),
  order_index integer NOT NULL CHECK (order_index > 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  message_id text,
  jid text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS campaigns_status_created_idx
  ON campaigns (status, created_at DESC);

CREATE INDEX IF NOT EXISTS campaign_deliveries_campaign_status_order_idx
  ON campaign_deliveries (campaign_id, status, order_index);

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS select_all_products boolean NOT NULL DEFAULT false;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS product_count integer NOT NULL DEFAULT 1;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS total_contacts integer NOT NULL DEFAULT 0;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS submitted_count integer NOT NULL DEFAULT 0;

ALTER TABLE campaign_deliveries
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id) ON DELETE RESTRICT;

ALTER TABLE campaign_deliveries
  ADD COLUMN IF NOT EXISTS product_title text;

ALTER TABLE campaign_deliveries
  ADD COLUMN IF NOT EXISTS product_image text;

ALTER TABLE campaigns
  ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE campaigns
  DROP CONSTRAINT IF EXISTS campaigns_product_id_fkey;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

ALTER TABLE campaign_deliveries
  DROP CONSTRAINT IF EXISTS campaign_deliveries_product_id_fkey;

ALTER TABLE campaign_deliveries
  ADD CONSTRAINT campaign_deliveries_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

ALTER TABLE campaign_deliveries
  ADD COLUMN IF NOT EXISTS recipient_type text;

ALTER TABLE campaign_deliveries
  ADD COLUMN IF NOT EXISTS recipient_target text;

UPDATE campaign_deliveries
SET recipient_type = 'contact'
WHERE recipient_type IS NULL OR recipient_type = '';

UPDATE campaign_deliveries
SET recipient_target = recipient_phone
WHERE recipient_target IS NULL OR recipient_target = '';

ALTER TABLE campaign_deliveries
  ALTER COLUMN recipient_type SET DEFAULT 'contact';

ALTER TABLE campaign_deliveries
  ALTER COLUMN recipient_type SET NOT NULL;

ALTER TABLE campaign_deliveries
  ALTER COLUMN recipient_target SET NOT NULL;

ALTER TABLE campaign_deliveries
  DROP CONSTRAINT IF EXISTS campaign_deliveries_status_check;

ALTER TABLE campaign_deliveries
  ADD CONSTRAINT campaign_deliveries_status_check
  CHECK (status IN ('pending', 'sending', 'submitted', 'sent', 'failed'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'campaign_deliveries_recipient_type_check'
  ) THEN
    ALTER TABLE campaign_deliveries
      ADD CONSTRAINT campaign_deliveries_recipient_type_check
      CHECK (recipient_type IN ('contact', 'group', 'channel'));
  END IF;
END $$;

UPDATE campaigns
SET
  product_count = COALESCE(NULLIF(product_count, 0), 1),
  total_contacts = CASE
    WHEN total_contacts > 0 THEN total_contacts
    ELSE total_recipients
  END;

UPDATE campaign_deliveries
SET product_image = products.image
FROM products
WHERE campaign_deliveries.product_id = products.id
  AND (campaign_deliveries.product_image IS NULL OR campaign_deliveries.product_image = '');

UPDATE campaign_deliveries
SET
  status = 'submitted',
  updated_at = NOW()
WHERE recipient_type = 'channel'
  AND status = 'sent';

WITH campaign_stats AS (
  SELECT
    campaign_id,
    COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
    COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted_count,
    COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
    COUNT(*) FILTER (WHERE status IN ('pending', 'sending'))::int AS remaining_count
  FROM campaign_deliveries
  GROUP BY campaign_id
)
UPDATE campaigns
SET
  sent_count = COALESCE(campaign_stats.sent_count, 0),
  submitted_count = COALESCE(campaign_stats.submitted_count, 0),
  failed_count = COALESCE(campaign_stats.failed_count, 0),
  remaining_count = COALESCE(campaign_stats.remaining_count, 0)
FROM campaign_stats
WHERE campaigns.id = campaign_stats.campaign_id;
