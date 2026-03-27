import { db } from "@/lib/db";
import { resolveMercadoLivreProductLinks } from "@/lib/meli/affiliate";
import { buildProductMarketingMessage } from "@/lib/products/message";
import { normalizeMercadoLivreItemId } from "@/lib/products/mercadoLivreLink";
import type { Product, ProductMarketplace } from "@/lib/products/types";

export class ProductValidationError extends Error {}
export class ProductNotFoundError extends Error {}

type BaseProductInput = {
  title: string;
  price: number;
  originalPrice?: number;
  discount?: number;
  hasCouponOrDiscount?: boolean;
  couponLabel?: string;
  image?: string;
  images?: string[];
  description?: string;
  itemId?: string;
  link: string;
  linkNormalized?: string;
  linkOriginal?: string;
  linkAffiliate?: string;
  linkShort?: string;
  position?: number;
  marketingMessage?: string;
  marketplace?: ProductMarketplace;
  seller?: string;
};

export type ProductPublicationInput = {
  itemId?: string | null;
  permalink?: string | null;
  status?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  listingTypeId?: string | null;
  publishedAt?: Date | string | null;
  lastSyncAt?: Date | string | null;
  lastSyncError?: string | null;
};

type ProductRow = {
  id: string;
  title: string;
  price: number | string;
  original_price: number | string | null;
  discount: number | null;
  has_coupon_or_discount: boolean;
  coupon_label: string | null;
  image: string;
  images: unknown;
  description: string;
  item_id: string | null;
  link: string;
  link_original: string | null;
  link_affiliate: string | null;
  link_short: string | null;
  position: number | null;
  marketing_message: string | null;
  marketplace: ProductMarketplace;
  seller: string | null;
  meli_item_id: string | null;
  meli_permalink: string | null;
  meli_status: string | null;
  meli_category_id: string | null;
  meli_category_name: string | null;
  meli_listing_type_id: string | null;
  meli_published_at: Date | string | null;
  meli_last_sync_at: Date | string | null;
  meli_last_sync_error: string | null;
  created_at: Date | string;
};

type ProductDependencyStats = {
  campaignRefs: number;
  deliveryRefs: number;
};

export type CreateProductInput = BaseProductInput;
export type UpdateProductInput = BaseProductInput;

const PRODUCT_SELECT_FIELDS = `
  id,
  title,
  price,
  original_price,
  discount,
  has_coupon_or_discount,
  coupon_label,
  image,
  images,
  description,
  item_id,
  link,
  link_original,
  link_affiliate,
  link_short,
  position,
  marketing_message,
  marketplace,
  seller,
  meli_item_id,
  meli_permalink,
  meli_status,
  meli_category_id,
  meli_category_name,
  meli_listing_type_id,
  meli_published_at,
  meli_last_sync_at,
  meli_last_sync_error,
  created_at
`;

let ensureProductsSchemaPromise: Promise<void> | null = null;

function sanitizeText(value: string | undefined | null) {
  return (value ?? "").trim();
}

export function normalizeProductLink(value: string) {
  const sanitized = sanitizeText(value);
  if (!sanitized) {
    return "";
  }

  try {
    const parsed = new URL(sanitized);
    parsed.hash = "";
    parsed.search = "";

    const pathname = parsed.pathname.replace(/\/+$/g, "") || "/";
    return `${parsed.protocol}//${parsed.host}${pathname}`.toLowerCase();
  } catch {
    return sanitized
      .replace(/[?#].*$/g, "")
      .replace(/\/+$/g, "")
      .toLowerCase();
  }
}

function normalizeMoney(value: number | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new ProductValidationError("Preco invalido.");
  }

  return Number(value);
}

function normalizeCouponLabel(value: string | undefined) {
  const normalized = sanitizeText(value).replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : undefined;
}

function normalizePosition(value: number | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new ProductValidationError("Posicao invalida.");
  }

  return value;
}

function calculateDiscount(price: number, originalPrice: number | undefined, fallback?: number) {
  if (originalPrice !== undefined && originalPrice > price && originalPrice > 0) {
    return Math.round(((originalPrice - price) / originalPrice) * 100);
  }

  if (fallback !== undefined && Number.isFinite(fallback) && fallback > 0) {
    return Math.round(fallback);
  }

  return undefined;
}

function normalizeImages(image: string, images: string[] | undefined) {
  const normalized = (images ?? [])
    .map((entry) => sanitizeText(entry))
    .filter((entry) => entry.length > 0);

  if (image.length > 0 && !normalized.includes(image)) {
    return [image, ...normalized];
  }

  return normalized;
}

async function toProductInput(input: BaseProductInput) {
  const title = sanitizeText(input.title);
  const link = sanitizeText(input.link);
  const seller = sanitizeText(input.seller);
  const description = sanitizeText(input.description);
  const image = sanitizeText(input.image);
  const couponLabel = normalizeCouponLabel(input.couponLabel);
  const itemId = normalizeMercadoLivreItemId(input.itemId);
  const position = normalizePosition(input.position);

  if (title.length === 0) {
    throw new ProductValidationError("Nome do produto e obrigatorio.");
  }
  if (link.length === 0) {
    throw new ProductValidationError("Link do produto e obrigatorio.");
  }

  const price = normalizeMoney(input.price);
  if (price === undefined || price <= 0) {
    throw new ProductValidationError("Preco invalido.");
  }

  const originalPrice = normalizeMoney(input.originalPrice);
  const discount = calculateDiscount(price, originalPrice, input.discount);
  const hasCouponOrDiscount =
    Boolean(input.hasCouponOrDiscount) ||
    Boolean(couponLabel) ||
    Boolean(discount && discount > 0);
  const images = normalizeImages(image, input.images);
  const marketplace = input.marketplace ?? "mercadolivre";
  const resolvedLinks =
    marketplace === "mercadolivre"
      ? await resolveMercadoLivreProductLinks({
          link,
          linkOriginal: sanitizeText(input.linkOriginal),
          linkAffiliate: sanitizeText(input.linkAffiliate),
          linkShort: sanitizeText(input.linkShort),
        })
      : {
          link,
          linkOriginal: sanitizeText(input.linkOriginal) || link,
          linkAffiliate: sanitizeText(input.linkAffiliate) || undefined,
          linkShort: sanitizeText(input.linkShort) || undefined,
        };
  const linkOriginal = sanitizeText(resolvedLinks.linkOriginal) || link;
  const linkAffiliate = sanitizeText(resolvedLinks.linkAffiliate);
  const linkShort = sanitizeText(resolvedLinks.linkShort);
  const preferredLink = sanitizeText(resolvedLinks.link) || link;
  const linkNormalized = normalizeProductLink(input.linkNormalized ?? linkOriginal);
  const marketingMessage =
    sanitizeText(input.marketingMessage) ||
    buildProductMarketingMessage({
      title,
      price,
      link: preferredLink,
    });

  return {
    title,
    price,
    originalPrice,
    discount,
    hasCouponOrDiscount,
    couponLabel,
    image,
    images,
    description,
    itemId: itemId || undefined,
    link: preferredLink,
    linkNormalized,
    linkOriginal,
    linkAffiliate: linkAffiliate.length > 0 ? linkAffiliate : undefined,
    linkShort: linkShort.length > 0 ? linkShort : undefined,
    position,
    marketingMessage,
    marketplace,
    seller: seller.length > 0 ? seller : undefined,
  };
}

function toPublicationInput(input: ProductPublicationInput) {
  const itemId = sanitizeText(input.itemId);
  const permalink = sanitizeText(input.permalink);
  const status = sanitizeText(input.status);
  const categoryId = sanitizeText(input.categoryId);
  const categoryName = sanitizeText(input.categoryName);
  const listingTypeId = sanitizeText(input.listingTypeId);
  const lastSyncError = sanitizeText(input.lastSyncError);

  return {
    itemId: itemId || undefined,
    permalink: permalink || undefined,
    status: status || undefined,
    categoryId: categoryId || undefined,
    categoryName: categoryName || undefined,
    listingTypeId: listingTypeId || undefined,
    publishedAt: toOptionalDate(input.publishedAt),
    lastSyncAt: toOptionalDate(input.lastSyncAt),
    lastSyncError: lastSyncError || undefined,
  };
}

function parseNumeric(value: number | string | null) {
  if (value === null) {
    return undefined;
  }

  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? Number(numericValue) : undefined;
}

function parseImages(value: unknown, fallbackImage: string) {
  const images = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

  if (fallbackImage.length > 0 && !images.includes(fallbackImage)) {
    return [fallbackImage, ...images];
  }

  return images;
}

function toDate(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function toOptionalDate(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

async function ensureProductsSchema() {
  if (!ensureProductsSchemaPromise) {
    ensureProductsSchemaPromise = db
      .query(`
        ALTER TABLE products
          ADD COLUMN IF NOT EXISTS coupon_label text,
          ADD COLUMN IF NOT EXISTS link_normalized text,
          ADD COLUMN IF NOT EXISTS item_id text,
          ADD COLUMN IF NOT EXISTS link_original text,
          ADD COLUMN IF NOT EXISTS link_affiliate text,
          ADD COLUMN IF NOT EXISTS link_short text,
          ADD COLUMN IF NOT EXISTS position integer,
          ADD COLUMN IF NOT EXISTS marketing_message text,
          ADD COLUMN IF NOT EXISTS meli_item_id text,
          ADD COLUMN IF NOT EXISTS meli_permalink text,
          ADD COLUMN IF NOT EXISTS meli_status text,
          ADD COLUMN IF NOT EXISTS meli_category_id text,
          ADD COLUMN IF NOT EXISTS meli_category_name text,
          ADD COLUMN IF NOT EXISTS meli_listing_type_id text,
          ADD COLUMN IF NOT EXISTS meli_published_at timestamptz,
          ADD COLUMN IF NOT EXISTS meli_last_sync_at timestamptz,
          ADD COLUMN IF NOT EXISTS meli_last_sync_error text
      `)
      .then(() => undefined)
      .catch((error) => {
        ensureProductsSchemaPromise = null;
        throw error;
      });
  }

  await ensureProductsSchemaPromise;
}

function mapRowToProduct(row: ProductRow): Product {
  const image = sanitizeText(row.image);
  const itemId = sanitizeText(row.meli_item_id);
  const permalink = sanitizeText(row.meli_permalink);
  const status = sanitizeText(row.meli_status);
  const categoryId = sanitizeText(row.meli_category_id);
  const categoryName = sanitizeText(row.meli_category_name);
  const listingTypeId = sanitizeText(row.meli_listing_type_id);
  const lastSyncError = sanitizeText(row.meli_last_sync_error);
  const publishedAt = toOptionalDate(row.meli_published_at);
  const lastSyncAt = toOptionalDate(row.meli_last_sync_at);

  const hasPublicationMetadata =
    itemId ||
    permalink ||
    status ||
    categoryId ||
    categoryName ||
    listingTypeId ||
    publishedAt ||
    lastSyncAt ||
    lastSyncError;

  return {
    id: row.id,
    title: row.title,
    price: parseNumeric(row.price) ?? 0,
    originalPrice: parseNumeric(row.original_price),
    discount: row.discount ?? undefined,
    hasCouponOrDiscount: row.has_coupon_or_discount,
    couponLabel: normalizeCouponLabel(row.coupon_label ?? undefined),
    image,
    images: parseImages(row.images, image),
    description: row.description,
    itemId: normalizeMercadoLivreItemId(row.item_id) ?? undefined,
    link: row.link,
    linkOriginal: sanitizeText(row.link_original) || row.link,
    linkAffiliate: sanitizeText(row.link_affiliate) || undefined,
    linkShort: sanitizeText(row.link_short) || undefined,
    position: typeof row.position === "number" && row.position > 0 ? row.position : undefined,
    marketingMessage:
      sanitizeText(row.marketing_message) ||
      buildProductMarketingMessage({
        title: row.title,
        price: parseNumeric(row.price) ?? 0,
        link: row.link,
      }),
    marketplace: row.marketplace,
    seller: row.seller ?? undefined,
    meliPublication: hasPublicationMetadata
      ? {
          itemId: itemId || undefined,
          permalink: permalink || undefined,
          status: status || undefined,
          categoryId: categoryId || undefined,
          categoryName: categoryName || undefined,
          listingTypeId: listingTypeId || undefined,
          publishedAt,
          lastSyncAt,
          lastSyncError: lastSyncError || undefined,
        }
      : undefined,
    createdAt: toDate(row.created_at),
  };
}

async function getProductDependencyStats(productId: string): Promise<ProductDependencyStats> {
  const [campaignResult, deliveryResult] = await Promise.all([
    db.query<{ total: string }>(
      `
        SELECT COUNT(*)::text AS total
        FROM campaigns
        WHERE product_id = $1
      `,
      [productId],
    ),
    db.query<{ total: string }>(
      `
        SELECT COUNT(*)::text AS total
        FROM campaign_deliveries
        WHERE product_id = $1
      `,
      [productId],
    ),
  ]);

  return {
    campaignRefs: Number(campaignResult.rows[0]?.total ?? 0),
    deliveryRefs: Number(deliveryResult.rows[0]?.total ?? 0),
  };
}

async function getAllProductsDependencyStats(): Promise<ProductDependencyStats> {
  const [campaignResult, deliveryResult] = await Promise.all([
    db.query<{ total: string }>(
      `
        SELECT COUNT(*)::text AS total
        FROM campaigns
        WHERE product_id IS NOT NULL
      `,
    ),
    db.query<{ total: string }>(
      `
        SELECT COUNT(*)::text AS total
        FROM campaign_deliveries
        WHERE product_id IS NOT NULL
      `,
    ),
  ]);

  return {
    campaignRefs: Number(campaignResult.rows[0]?.total ?? 0),
    deliveryRefs: Number(deliveryResult.rows[0]?.total ?? 0),
  };
}

export async function getProductById(id: string) {
  await ensureProductsSchema();
  const productId = sanitizeText(id);
  if (!productId) {
    return null;
  }

  const result = await db.query<ProductRow>(
    `
      SELECT
        ${PRODUCT_SELECT_FIELDS}
      FROM products
      WHERE id = $1
      LIMIT 1
    `,
    [productId],
  );

  return result.rows[0] ? mapRowToProduct(result.rows[0]) : null;
}

export async function getProductByLink(link: string) {
  await ensureProductsSchema();
  const normalizedLink = normalizeProductLink(link);
  if (!normalizedLink) {
    return null;
  }

  const result = await db.query<ProductRow>(
    `
      SELECT
        ${PRODUCT_SELECT_FIELDS}
      FROM products
      WHERE COALESCE(
        NULLIF(link_normalized, ''),
        lower(regexp_replace(regexp_replace(trim(COALESCE(link_original, link)), '[?#].*$', ''), '/+$', ''))
      ) = $1
        OR lower(regexp_replace(regexp_replace(trim(COALESCE(link_short, '')), '[?#].*$', ''), '/+$', '')) = $1
        OR lower(regexp_replace(regexp_replace(trim(COALESCE(link_affiliate, '')), '[?#].*$', ''), '/+$', '')) = $1
        OR lower(regexp_replace(regexp_replace(trim(link), '[?#].*$', ''), '/+$', '')) = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [normalizedLink],
  );

  return result.rows[0] ? mapRowToProduct(result.rows[0]) : null;
}

export async function getProductByItemId(itemId: string | null | undefined) {
  await ensureProductsSchema();
  const normalizedItemId = normalizeMercadoLivreItemId(itemId);
  if (!normalizedItemId) {
    return null;
  }

  const result = await db.query<ProductRow>(
    `
      SELECT
        ${PRODUCT_SELECT_FIELDS}
      FROM products
      WHERE upper(trim(COALESCE(item_id, ''))) = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [normalizedItemId],
  );

  return result.rows[0] ? mapRowToProduct(result.rows[0]) : null;
}

export async function listProducts() {
  await ensureProductsSchema();
  const result = await db.query<ProductRow>(
    `
      SELECT
        ${PRODUCT_SELECT_FIELDS}
      FROM products
      ORDER BY created_at DESC
    `,
  );

  return result.rows.map(mapRowToProduct);
}

export async function getProductsCount() {
  await ensureProductsSchema();
  const result = await db.query<{ total: string }>("SELECT COUNT(*)::text AS total FROM products");
  return Number(result.rows[0]?.total ?? 0);
}

export async function createProduct(input: CreateProductInput) {
  await ensureProductsSchema();
  const product = await toProductInput(input);

  const result = await db.query<ProductRow>(
    `
      INSERT INTO products (
        title,
        price,
        original_price,
        discount,
        has_coupon_or_discount,
        coupon_label,
        image,
        images,
        description,
        item_id,
        link,
        link_normalized,
        link_original,
        link_affiliate,
        link_short,
        position,
        marketing_message,
        marketplace,
        seller
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING
        ${PRODUCT_SELECT_FIELDS}
    `,
    [
      product.title,
      product.price,
      product.originalPrice ?? null,
      product.discount ?? null,
      product.hasCouponOrDiscount,
      product.couponLabel ?? null,
      product.image,
      JSON.stringify(product.images),
      product.description,
      product.itemId ?? null,
      product.link,
      product.linkNormalized,
      product.linkOriginal,
      product.linkAffiliate ?? null,
      product.linkShort ?? null,
      product.position ?? null,
      product.marketingMessage,
      product.marketplace,
      product.seller ?? null,
    ],
  );

  return mapRowToProduct(result.rows[0]);
}

export async function updateProductById(id: string, input: UpdateProductInput) {
  await ensureProductsSchema();
  const productId = sanitizeText(id);
  if (!productId) {
    throw new ProductNotFoundError("Produto nao encontrado.");
  }

  const current = await getProductById(productId);
  if (!current) {
    throw new ProductNotFoundError("Produto nao encontrado.");
  }

  const product = await toProductInput(input);
  const result = await db.query<ProductRow>(
    `
      UPDATE products
      SET
        title = $2,
        price = $3,
        original_price = $4,
        discount = $5,
        has_coupon_or_discount = $6,
        coupon_label = $7,
        image = $8,
        images = $9::jsonb,
        description = $10,
        item_id = $11,
        link = $12,
        link_normalized = $13,
        link_original = $14,
        link_affiliate = $15,
        link_short = $16,
        position = $17,
        marketing_message = $18,
        marketplace = $19,
        seller = $20
      WHERE id = $1
      RETURNING
        ${PRODUCT_SELECT_FIELDS}
    `,
    [
      productId,
      product.title,
      product.price,
      product.originalPrice ?? null,
      product.discount ?? null,
      product.hasCouponOrDiscount,
      product.couponLabel ?? null,
      product.image,
      JSON.stringify(product.images),
      product.description,
      product.itemId ?? null,
      product.link,
      product.linkNormalized,
      product.linkOriginal,
      product.linkAffiliate ?? null,
      product.linkShort ?? null,
      product.position ?? null,
      product.marketingMessage,
      product.marketplace,
      product.seller ?? null,
    ],
  );

  return result.rows[0] ? mapRowToProduct(result.rows[0]) : current;
}

export async function updateProductPublicationById(id: string, input: ProductPublicationInput) {
  await ensureProductsSchema();
  const productId = sanitizeText(id);
  if (!productId) {
    throw new ProductNotFoundError("Produto nao encontrado.");
  }

  const current = await getProductById(productId);
  if (!current) {
    throw new ProductNotFoundError("Produto nao encontrado.");
  }

  const publication = toPublicationInput(input);
  const result = await db.query<ProductRow>(
    `
      UPDATE products
      SET
        meli_item_id = $2,
        meli_permalink = $3,
        meli_status = $4,
        meli_category_id = $5,
        meli_category_name = $6,
        meli_listing_type_id = $7,
        meli_published_at = $8,
        meli_last_sync_at = $9,
        meli_last_sync_error = $10
      WHERE id = $1
      RETURNING
        ${PRODUCT_SELECT_FIELDS}
    `,
    [
      productId,
      publication.itemId ?? null,
      publication.permalink ?? null,
      publication.status ?? null,
      publication.categoryId ?? null,
      publication.categoryName ?? null,
      publication.listingTypeId ?? null,
      publication.publishedAt ?? null,
      publication.lastSyncAt ?? null,
      publication.lastSyncError ?? null,
    ],
  );

  return result.rows[0] ? mapRowToProduct(result.rows[0]) : current;
}

export async function deleteProductById(id: string) {
  await ensureProductsSchema();
  const productId = sanitizeText(id);
  if (!productId) {
    throw new ProductNotFoundError("Produto nao encontrado.");
  }

  const dependencies = await getProductDependencyStats(productId);
  if (dependencies.campaignRefs > 0 || dependencies.deliveryRefs > 0) {
    const parts = [];

    if (dependencies.campaignRefs > 0) {
      parts.push(
        `${dependencies.campaignRefs} campanha${dependencies.campaignRefs === 1 ? "" : "s"}`,
      );
    }

    if (dependencies.deliveryRefs > 0) {
      parts.push(
        `${dependencies.deliveryRefs} entrega${dependencies.deliveryRefs === 1 ? "" : "s"}`,
      );
    }

    throw new ProductValidationError(
      `Nao foi possivel excluir o produto porque ele esta vinculado a ${parts.join(
        " e ",
      )}. Remova as campanhas relacionadas primeiro.`,
    );
  }

  const result = await db.query<ProductRow>(
    `
      DELETE FROM products
      WHERE id = $1
      RETURNING
        ${PRODUCT_SELECT_FIELDS}
    `,
    [productId],
  );

  if (!result.rows[0]) {
    throw new ProductNotFoundError("Produto nao encontrado.");
  }

  return mapRowToProduct(result.rows[0]);
}

export async function deleteAllProducts() {
  await ensureProductsSchema();
  const dependencies = await getAllProductsDependencyStats();
  if (dependencies.campaignRefs > 0 || dependencies.deliveryRefs > 0) {
    const parts = [];

    if (dependencies.campaignRefs > 0) {
      parts.push(
        `${dependencies.campaignRefs} campanha${dependencies.campaignRefs === 1 ? "" : "s"}`,
      );
    }

    if (dependencies.deliveryRefs > 0) {
      parts.push(
        `${dependencies.deliveryRefs} entrega${dependencies.deliveryRefs === 1 ? "" : "s"}`,
      );
    }

    throw new ProductValidationError(
      `Nao foi possivel excluir todos os produtos porque existem ${parts.join(
        " e ",
      )} vinculadas. Remova as campanhas relacionadas primeiro.`,
    );
  }

  const result = await db.query("DELETE FROM products");
  return result.rowCount ?? 0;
}
