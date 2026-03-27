import { db } from "@/lib/db";
import type { ProductMarketplace } from "@/lib/products/types";

export type ProductImportPreviewStatus = "pending" | "confirmed" | "failed";

export type ProductImportPreview = {
  id: string;
  source: string;
  status: ProductImportPreviewStatus;
  lookupMode: string;
  requestedUrl: string;
  title: string;
  price: number;
  originalPrice?: number;
  discount?: number;
  hasCouponOrDiscount: boolean;
  couponLabel?: string;
  image: string;
  images: string[];
  description: string;
  link: string;
  marketplace: ProductMarketplace;
  seller?: string;
  existingProductId?: string;
  importedProductId?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ProductImportPreviewDTO = Omit<ProductImportPreview, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

type ProductImportPreviewRow = {
  id: string;
  source: string;
  status: ProductImportPreviewStatus;
  lookup_mode: string;
  requested_url: string;
  title: string;
  price: number | string;
  original_price: number | string | null;
  discount: number | null;
  has_coupon_or_discount: boolean;
  coupon_label: string | null;
  image: string;
  images: unknown;
  description: string;
  link: string;
  marketplace: ProductMarketplace;
  seller: string | null;
  existing_product_id: string | null;
  imported_product_id: string | null;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type CreateProductImportPreviewInput = {
  source: string;
  lookupMode: string;
  requestedUrl: string;
  title: string;
  price: number;
  originalPrice?: number;
  discount?: number;
  hasCouponOrDiscount: boolean;
  couponLabel?: string;
  image: string;
  images: string[];
  description: string;
  link: string;
  marketplace: ProductMarketplace;
  seller?: string;
  existingProductId?: string;
};

let ensureProductImportPreviewSchemaPromise: Promise<void> | null = null;

function sanitizeText(value: string | undefined | null) {
  return String(value ?? "").trim();
}

function parseNumeric(value: number | string | null) {
  if (value === null) {
    return undefined;
  }

  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? Number(numericValue) : undefined;
}

function toDate(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }

  return parsed;
}

function parseImages(value: unknown, image: string) {
  const images = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

  if (image && !images.includes(image)) {
    return [image, ...images];
  }

  return images;
}

function mapRowToProductImportPreview(row: ProductImportPreviewRow): ProductImportPreview {
  const image = sanitizeText(row.image);

  return {
    id: row.id,
    source: row.source,
    status: row.status,
    lookupMode: row.lookup_mode,
    requestedUrl: row.requested_url,
    title: row.title,
    price: parseNumeric(row.price) ?? 0,
    originalPrice: parseNumeric(row.original_price),
    discount: row.discount ?? undefined,
    hasCouponOrDiscount: row.has_coupon_or_discount,
    couponLabel: sanitizeText(row.coupon_label) || undefined,
    image,
    images: parseImages(row.images, image),
    description: row.description,
    link: row.link,
    marketplace: row.marketplace,
    seller: sanitizeText(row.seller) || undefined,
    existingProductId: sanitizeText(row.existing_product_id) || undefined,
    importedProductId: sanitizeText(row.imported_product_id) || undefined,
    errorMessage: sanitizeText(row.error_message) || undefined,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

async function ensureProductImportPreviewSchema() {
  if (!ensureProductImportPreviewSchemaPromise) {
    ensureProductImportPreviewSchemaPromise = db
      .query(`
        CREATE TABLE IF NOT EXISTS product_import_previews (
          id text PRIMARY KEY,
          source text NOT NULL,
          status text NOT NULL,
          lookup_mode text NOT NULL,
          requested_url text NOT NULL,
          title text NOT NULL,
          price numeric(14,2) NOT NULL,
          original_price numeric(14,2),
          discount integer,
          has_coupon_or_discount boolean NOT NULL DEFAULT false,
          coupon_label text,
          image text NOT NULL DEFAULT '',
          images jsonb NOT NULL DEFAULT '[]'::jsonb,
          description text NOT NULL DEFAULT '',
          link text NOT NULL,
          marketplace text NOT NULL DEFAULT 'mercadolivre',
          seller text,
          existing_product_id text,
          imported_product_id text,
          error_message text,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS product_import_previews_status_created_at_idx
          ON product_import_previews (status, created_at DESC);
      `)
      .then(() => undefined)
      .catch((error) => {
        ensureProductImportPreviewSchemaPromise = null;
        throw error;
      });
  }

  await ensureProductImportPreviewSchemaPromise;
}

export function serializeProductImportPreview(
  preview: ProductImportPreview,
): ProductImportPreviewDTO {
  return {
    ...preview,
    createdAt: preview.createdAt.toISOString(),
    updatedAt: preview.updatedAt.toISOString(),
  };
}

export async function createProductImportPreview(input: CreateProductImportPreviewInput) {
  await ensureProductImportPreviewSchema();

  const previewId =
    typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `product-import-preview-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const result = await db.query<ProductImportPreviewRow>(
    `
      INSERT INTO product_import_previews (
        id,
        source,
        status,
        lookup_mode,
        requested_url,
        title,
        price,
        original_price,
        discount,
        has_coupon_or_discount,
        coupon_label,
        image,
        images,
        description,
        link,
        marketplace,
        seller,
        existing_product_id
      )
      VALUES (
        $1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17
      )
      RETURNING
        id,
        source,
        status,
        lookup_mode,
        requested_url,
        title,
        price,
        original_price,
        discount,
        has_coupon_or_discount,
        coupon_label,
        image,
        images,
        description,
        link,
        marketplace,
        seller,
        existing_product_id,
        imported_product_id,
        error_message,
        created_at,
        updated_at
    `,
    [
      previewId,
      input.source,
      input.lookupMode,
      input.requestedUrl,
      input.title,
      input.price,
      input.originalPrice ?? null,
      input.discount ?? null,
      input.hasCouponOrDiscount,
      input.couponLabel ?? null,
      input.image,
      JSON.stringify(input.images),
      input.description,
      input.link,
      input.marketplace,
      input.seller ?? null,
      input.existingProductId ?? null,
    ],
  );

  return mapRowToProductImportPreview(result.rows[0]);
}

export async function getProductImportPreviewById(previewId: string) {
  await ensureProductImportPreviewSchema();

  const normalizedPreviewId = sanitizeText(previewId);
  if (!normalizedPreviewId) {
    return null;
  }

  const result = await db.query<ProductImportPreviewRow>(
    `
      SELECT
        id,
        source,
        status,
        lookup_mode,
        requested_url,
        title,
        price,
        original_price,
        discount,
        has_coupon_or_discount,
        coupon_label,
        image,
        images,
        description,
        link,
        marketplace,
        seller,
        existing_product_id,
        imported_product_id,
        error_message,
        created_at,
        updated_at
      FROM product_import_previews
      WHERE id = $1
      LIMIT 1
    `,
    [normalizedPreviewId],
  );

  return result.rows[0] ? mapRowToProductImportPreview(result.rows[0]) : null;
}

export async function confirmProductImportPreview(
  previewId: string,
  input: {
    importedProductId: string;
    existingProductId?: string;
  },
) {
  await ensureProductImportPreviewSchema();

  const normalizedPreviewId = sanitizeText(previewId);
  if (!normalizedPreviewId) {
    return null;
  }

  const result = await db.query<ProductImportPreviewRow>(
    `
      UPDATE product_import_previews
      SET
        status = 'confirmed',
        imported_product_id = $2,
        existing_product_id = $3,
        error_message = NULL,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        source,
        status,
        lookup_mode,
        requested_url,
        title,
        price,
        original_price,
        discount,
        has_coupon_or_discount,
        coupon_label,
        image,
        images,
        description,
        link,
        marketplace,
        seller,
        existing_product_id,
        imported_product_id,
        error_message,
        created_at,
        updated_at
    `,
    [normalizedPreviewId, input.importedProductId, input.existingProductId ?? null],
  );

  return result.rows[0] ? mapRowToProductImportPreview(result.rows[0]) : null;
}

export async function failProductImportPreview(previewId: string, message: string) {
  await ensureProductImportPreviewSchema();

  const normalizedPreviewId = sanitizeText(previewId);
  if (!normalizedPreviewId) {
    return null;
  }

  const result = await db.query<ProductImportPreviewRow>(
    `
      UPDATE product_import_previews
      SET
        status = 'failed',
        error_message = $2,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        source,
        status,
        lookup_mode,
        requested_url,
        title,
        price,
        original_price,
        discount,
        has_coupon_or_discount,
        coupon_label,
        image,
        images,
        description,
        link,
        marketplace,
        seller,
        existing_product_id,
        imported_product_id,
        error_message,
        created_at,
        updated_at
    `,
    [normalizedPreviewId, sanitizeText(message) || "Falha ao importar produto."],
  );

  return result.rows[0] ? mapRowToProductImportPreview(result.rows[0]) : null;
}
