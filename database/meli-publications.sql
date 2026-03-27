ALTER TABLE products
  ADD COLUMN IF NOT EXISTS meli_item_id text,
  ADD COLUMN IF NOT EXISTS meli_permalink text,
  ADD COLUMN IF NOT EXISTS meli_status text,
  ADD COLUMN IF NOT EXISTS meli_category_id text,
  ADD COLUMN IF NOT EXISTS meli_category_name text,
  ADD COLUMN IF NOT EXISTS meli_listing_type_id text,
  ADD COLUMN IF NOT EXISTS meli_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS meli_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS meli_last_sync_error text;
