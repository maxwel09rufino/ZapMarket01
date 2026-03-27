import axios, { AxiosError } from "axios";
import { resolveDirectProductUrlFromAffiliateLanding } from "@/lib/products/mercadoLivre";
import {
  buildMercadoLivreCatalogUrl,
  extractMercadoLivreCatalogProductIdFromUrl,
  extractMercadoLivreItemId,
  extractMercadoLivrePreferredItemIdFromUrl,
  extractMercadoLivreOfficialStoreIdFromUrl,
  extractMercadoLivreUserProductIdFromUrl,
  getMercadoLivreProductMismatchReason,
  normalizeMercadoLivreItemId,
} from "@/lib/products/mercadoLivreLink";

/**
 * Configurações da API do Mercado Livre
 */
const MERCADO_LIVRE_API_BASE = "https://api.mercadolibre.com";
const MERCADO_LIVRE_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Tipos
 */
export interface MercadoLivreProduct {
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  discount?: number;
  hasCouponOrDiscount: boolean;
  couponLabel?: string;
  currency: string;
  thumbnail: string;
  image: string | null;
  images: string[];
  permalink: string;
  seller: {
    id: number;
    name: string;
  } | null;
  stock: number;
  stockIsReferential: boolean;
  condition: string;
  description: string | null;
  variations: MercadoLivreVariation[];
}

export interface MercadoLivreVariation {
  id: string;
  price?: number;
  availableQuantity?: number;
  soldQuantity?: number;
  pictureIds: string[];
  attributeCombinations: MercadoLivreVariationAttribute[];
  attributes: MercadoLivreVariationAttribute[];
}

export interface MercadoLivreVariationAttribute {
  id?: string;
  name?: string;
  valueId?: string;
  valueName?: string;
}

interface MercadoLivreApiError {
  error: true;
  code: string;
  message: string;
  status?: number;
}

type MercadoLivreApiResponse = MercadoLivreProduct | MercadoLivreApiError;

type MercadoLivreRequestOptions = {
  accessToken?: string;
  sellerUserId?: string;
};

interface MercadoLivreCatalogItem {
  item_id?: string;
  seller_id?: number;
  official_store_id?: number | null;
  price?: number;
  original_price?: number | null;
  sale_price?:
    | {
        amount?: number | null;
      }
    | null;
  currency_id?: string;
  tags?: string[];
}

interface MercadoLivreCatalogProduct {
  id?: string;
  name?: string;
  permalink?: string;
  pictures?: Array<{
    url?: string;
    secure_url?: string;
  }>;
  short_description?:
    | {
        content?: string;
        text?: string;
      }
    | null;
  main_features?: Array<{
    text?: string;
  }>;
  buy_box_winner?: MercadoLivreCatalogItem | null;
}

interface MercadoLivreCatalogItemsResponse {
  results?: MercadoLivreCatalogItem[];
}

interface MercadoLivreUserProductPicturePayload {
  url?: string;
  secure_url?: string;
}

interface MercadoLivreUserProductFeaturePayload {
  text?: string;
}

interface MercadoLivreUserProductResponse {
  id?: string;
  name?: string;
  family_name?: string;
  site_id?: string;
  user_id?: number;
  catalog_product_id?: string | null;
  pictures?: MercadoLivreUserProductPicturePayload[] | null;
  thumbnail?: string | null;
  main_features?: MercadoLivreUserProductFeaturePayload[] | null;
}

interface MercadoLivreItemsSearchResponse {
  results?: Array<string | null> | null;
}

interface MercadoLivrePicturePayload {
  url?: string;
  secure_url?: string;
}

interface MercadoLivreItemVariationAttributePayload {
  id?: string;
  name?: string;
  value_id?: string | number | null;
  value_name?: string | null;
}

interface MercadoLivreItemVariationPayload {
  id?: string | number;
  price?: number | null;
  available_quantity?: number | null;
  sold_quantity?: number | null;
  picture_ids?: Array<string | null> | null;
  attribute_combinations?: MercadoLivreItemVariationAttributePayload[] | null;
  attributes?: MercadoLivreItemVariationAttributePayload[] | null;
}

interface MercadoLivreItemResponse {
  id?: string;
  title?: string;
  price?: number | null;
  original_price?: number | null;
  currency_id?: string | null;
  thumbnail?: string | null;
  pictures?: MercadoLivrePicturePayload[] | null;
  permalink?: string | null;
  seller_id?: number | null;
  available_quantity?: number | null;
  condition?: string | null;
  description?: string | null;
  sale_price?:
    | {
        amount?: number | null;
      }
    | null;
  tags?: string[] | null;
  variations?: MercadoLivreItemVariationPayload[] | null;
}

/**
 * Cache em memória (pode ser substituído por Redis depois)
 */
interface CacheEntry {
  data: MercadoLivreProduct;
  expiresAt: number;
}

const productCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

/**
 * Logger simples
 */
const logger = {
  info: (message: string, data?: unknown) =>
    console.log(`[MELI] ${message}`, data ? JSON.stringify(data) : ""),
  error: (message: string, error?: unknown) =>
    console.error(`[MELI] ERROR: ${message}`, error ? JSON.stringify(error) : ""),
  warn: (message: string, data?: unknown) =>
    console.warn(`[MELI] WARN: ${message}`, data ? JSON.stringify(data) : ""),
};

class MercadoLivreLookupValidationError extends Error {
  status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

function validateResolvedProduct(
  product: MercadoLivreProduct,
  context: {
    source: string;
    originalUrl?: string;
    resolvedUrl?: string;
    expectedItemId?: string | null;
    returnedItemId?: string | null;
  },
) {
  const hasImage =
    String(product.image ?? "").trim().length > 0 ||
    String(product.thumbnail ?? "").trim().length > 0 ||
    product.images.some((imageUrl) => String(imageUrl ?? "").trim().length > 0);

  if (
    String(product.title ?? "").trim().length === 0 ||
    !Number.isFinite(product.price) ||
    product.price <= 0 ||
    String(product.permalink ?? "").trim().length === 0 ||
    !hasImage
  ) {
    throw new MercadoLivreLookupValidationError("Dados do produto invalido.", 422);
  }

  const mismatchReason = getMercadoLivreProductMismatchReason({
    expectedItemId: context.expectedItemId,
    returnedItemId: context.returnedItemId ?? product.id,
    permalink: product.permalink,
  });
  if (mismatchReason) {
    throw new MercadoLivreLookupValidationError(mismatchReason, 409);
  }

  logger.info("Lookup success", {
    source: context.source,
    linkOriginal: context.originalUrl,
    linkResolvido: context.resolvedUrl ?? product.permalink,
    idProduto: context.expectedItemId ?? context.returnedItemId ?? product.id,
    respostaApi: {
      id: product.id,
      title: product.title,
      permalink: product.permalink,
    },
    produtoFinal: {
      title: product.title,
      price: product.price,
      image: product.image ?? product.thumbnail,
      link: product.permalink,
    },
  });

  return product;
}

function resolveExpectedItemIdForLookupValidation(args: {
  preferredItemId?: string | null;
  productId?: string | null;
  isExplicitCatalogUrl?: boolean;
  returnedItemId?: string | null;
  allowPreferredItemFallbackValidation?: boolean;
}) {
  const normalizedPreferredItemId = normalizeMercadoLivreItemId(args.preferredItemId);
  const normalizedReturnedItemId = normalizeMercadoLivreItemId(args.returnedItemId);

  if (
    args.allowPreferredItemFallbackValidation &&
    normalizedPreferredItemId &&
    normalizedReturnedItemId &&
    normalizedReturnedItemId !== normalizedPreferredItemId
  ) {
    return undefined;
  }

  return args.preferredItemId ?? (args.isExplicitCatalogUrl ? undefined : args.productId ?? undefined);
}

function buildApiHeaders(options?: MercadoLivreRequestOptions) {
  const accessToken = options?.accessToken?.trim();

  return {
    "Accept-Language": "pt-BR,pt;q=0.9",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

function normalizeProductId(productId: string) {
  const extracted = extractProductId(productId);
  return extracted ?? productId.trim().toUpperCase();
}

function extractMercadoLivreId(rawValue: string | null | undefined) {
  return extractMercadoLivreItemId(rawValue);
}

function extractPreferredItemId(url: string) {
  return extractMercadoLivrePreferredItemIdFromUrl(url);
}

/**
 * 🔗 Expande URLs encurtadas (meli.la)
 * Respeita redirects até 5 vezes
 */
async function expandUrl(url: string): Promise<string> {
  const { signal, clear } = createTimeoutSignal(MERCADO_LIVRE_TIMEOUT_MS);

  try {
    logger.info(`Expandindo URL: ${url}`);

    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    const finalUrl = response.url || url;
    const shouldResolveIntermediaryUrl =
      isMercadoLivreShortLink(url) ||
      isMercadoLivreSocialUrl(finalUrl) ||
      !hasResolvableMercadoLivreProductIdentity(finalUrl);

    if (shouldResolveIntermediaryUrl) {
      const resolvedProductUrl =
        (await resolveDirectProductUrlFromAffiliateLanding(url).catch(() => null)) ??
        (finalUrl !== url
          ? await resolveDirectProductUrlFromAffiliateLanding(finalUrl).catch(() => null)
          : null);

      if (resolvedProductUrl) {
        logger.info("Link real extraido da pagina intermediaria", {
          linkOriginal: url,
          linkResolvido: resolvedProductUrl,
        });
        return resolvedProductUrl;
      }
    }

    logger.info(`URL expandida: ${finalUrl}`);

    return finalUrl;
  } catch (error) {
    logger.warn(`Erro ao expandir URL ${url}`, error);
    return url; // Retorna a URL original se falhar
  } finally {
    clear();
  }
}

/**
 * 🧠 Extrai ID do produto da URL ou texto
 */
function extractProductId(url: string): string | null {
  const preferredItemId = extractPreferredItemId(url);
  if (preferredItemId) {
    return preferredItemId;
  }

  if (extractMercadoLivreCatalogProductIdFromUrl(url)) {
    return null;
  }

  try {
    const parsed = new URL(url);
    return extractMercadoLivreId(parsed.pathname) ?? extractMercadoLivreId(url);
  } catch {
    return extractMercadoLivreId(url);
  }
}

function extractUserProductId(url: string) {
  return extractMercadoLivreUserProductIdFromUrl(url);
}

/**
 * 🧪 Valida se é uma URL do Mercado Livre
 */
function isMercadoLivreUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    return (
      hostname.includes("mercadolivre.com") ||
      hostname.includes("mercadolivre.com.br") ||
      hostname.includes("meli.la") ||
      hostname.includes("meli.com")
    );
  } catch {
    return false;
  }
}

function isMercadoLivreSocialUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().startsWith("/social/");
  } catch {
    return false;
  }
}

function isMercadoLivreShortLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    return (
      hostname.includes("meli.la") ||
      ((hostname.includes("mercadolivre.com") || hostname.includes("mercadolivre.com.br")) &&
        pathname.startsWith("/sec/"))
    );
  } catch {
    return false;
  }
}

function hasResolvableMercadoLivreProductIdentity(url: string): boolean {
  return Boolean(
    extractPreferredItemId(url) ||
      extractMercadoLivreCatalogProductIdFromUrl(url) ||
      extractUserProductId(url),
  );
}

/**
 * ⏸️ Delay para retry
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCatalogFallbackUrl(productId: string) {
  return buildMercadoLivreCatalogUrl(productId);
}

function parsePositiveNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Number(value);
}

function parseNonNegativeNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Number(value);
}

function extractSalePriceAmount(
  salePrice:
    | {
        amount?: number | null;
      }
    | null
    | undefined,
) {
  return parsePositiveNumber(salePrice?.amount);
}

function resolveDisplayedPrice(
  regularPrice: number | undefined,
  salePrice: number | undefined,
) {
  if (
    salePrice !== undefined &&
    regularPrice !== undefined &&
    salePrice < regularPrice
  ) {
    return salePrice;
  }

  return regularPrice ?? salePrice ?? 0;
}

function resolveOriginalPrice(
  explicitOriginalPrice: unknown,
  regularPrice: number | undefined,
  displayedPrice: number,
) {
  const originalPrice = parsePositiveNumber(explicitOriginalPrice);
  if (originalPrice !== undefined && originalPrice > displayedPrice) {
    return originalPrice;
  }

  if (regularPrice !== undefined && regularPrice > displayedPrice) {
    return regularPrice;
  }

  return undefined;
}

function calculateDiscount(price: number, originalPrice?: number) {
  if (originalPrice === undefined || originalPrice <= price || originalPrice <= 0) {
    return undefined;
  }

  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

function hasPromotionTag(tags: string[] | null | undefined) {
  return (tags ?? []).some((tag) => {
    const normalizedTag = String(tag ?? "").trim().toLowerCase();
    return normalizedTag.includes("coupon") || normalizedTag.includes("promotion");
  });
}

function mapItemImages(item: MercadoLivreItemResponse) {
  const pictures = (item.pictures ?? [])
    .map((picture) => String(picture.secure_url ?? picture.url ?? "").trim())
    .filter((value) => value.length > 0);
  const thumbnail = String(item.thumbnail ?? "").trim();
  const allImages = thumbnail ? [thumbnail, ...pictures] : pictures;
  return Array.from(new Set(allImages));
}

function normalizeVariationValueId(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function mapVariationAttributes(
  attributes: MercadoLivreItemVariationAttributePayload[] | null | undefined,
): MercadoLivreVariationAttribute[] {
  return (attributes ?? []).map((attribute) => ({
    id: String(attribute.id ?? "").trim() || undefined,
    name: String(attribute.name ?? "").trim() || undefined,
    valueId: normalizeVariationValueId(attribute.value_id),
    valueName: String(attribute.value_name ?? "").trim() || undefined,
  }));
}

function mapItemVariations(item: MercadoLivreItemResponse) {
  return (item.variations ?? [])
    .map((variation): MercadoLivreVariation | null => {
      const id = String(variation.id ?? "").trim();
      if (!id) {
        return null;
      }

      return {
        id,
        price: parsePositiveNumber(variation.price),
        availableQuantity: parseNonNegativeNumber(variation.available_quantity),
        soldQuantity: parseNonNegativeNumber(variation.sold_quantity),
        pictureIds: (variation.picture_ids ?? [])
          .map((pictureId) => String(pictureId ?? "").trim())
          .filter((pictureId) => pictureId.length > 0),
        attributeCombinations: mapVariationAttributes(variation.attribute_combinations),
        attributes: mapVariationAttributes(variation.attributes),
      };
    })
    .filter((variation): variation is MercadoLivreVariation => Boolean(variation));
}

async function fetchSellerData(
  sellerId: number | undefined,
  options?: MercadoLivreRequestOptions,
): Promise<MercadoLivreProduct["seller"]> {
  if (!sellerId) {
    return null;
  }

  try {
    const sellerResponse = await axios.get(
      `${MERCADO_LIVRE_API_BASE}/users/${sellerId}`,
      {
        timeout: MERCADO_LIVRE_TIMEOUT_MS,
        headers: buildApiHeaders(options),
      },
    );

    return {
      id: sellerResponse.data.id,
      name: sellerResponse.data.nickname || sellerResponse.data.first_name || "Unknown",
    };
  } catch {
    logger.warn(`Erro ao buscar dados do vendedor ${sellerId}`);
    return null;
  }
}

async function fetchItemDescription(
  productId: string,
  options?: MercadoLivreRequestOptions,
): Promise<string | null> {
  try {
    const descResponse = await axios.get(
      `${MERCADO_LIVRE_API_BASE}/items/${productId}/description`,
      {
        timeout: MERCADO_LIVRE_TIMEOUT_MS,
        headers: buildApiHeaders(options),
      },
    );

    return descResponse.data.plain_text || descResponse.data.text || null;
  } catch {
    logger.warn(`Erro ao buscar descrição do produto ${productId}`);
    return null;
  }
}

function mapCatalogImages(product: MercadoLivreCatalogProduct) {
  return (product.pictures ?? [])
    .map((picture) => picture.secure_url || picture.url || "")
    .filter((value) => value.trim().length > 0);
}

function extractCatalogDescription(product: MercadoLivreCatalogProduct) {
  const shortDescription = String(
    product.short_description?.content ?? product.short_description?.text ?? "",
  ).trim();

  if (shortDescription) {
    return shortDescription;
  }

  const features = (product.main_features ?? [])
    .map((feature) => String(feature.text ?? "").trim())
    .filter((value) => value.length > 0);

  return features.length > 0 ? features.join("\n") : null;
}

function pickBestCatalogItem(
  product: MercadoLivreCatalogProduct,
  itemsPayload: MercadoLivreCatalogItemsResponse,
  preferredItemId?: string,
  options?: {
    allowFallbackWhenPreferredMissing?: boolean;
    officialStoreId?: number | null;
  },
) {
  const candidates = [
    ...(product.buy_box_winner ? [product.buy_box_winner] : []),
    ...(itemsPayload.results ?? []),
  ].filter(
    (item): item is MercadoLivreCatalogItem =>
      Boolean(item?.item_id) &&
      resolveDisplayedPrice(
        parsePositiveNumber(item.price),
        extractSalePriceAmount(item.sale_price),
      ) > 0,
  );

  if (candidates.length === 0) {
    return null;
  }

  const requestedOfficialStoreId =
    typeof options?.officialStoreId === "number" &&
    Number.isInteger(options.officialStoreId) &&
    options.officialStoreId > 0
      ? options.officialStoreId
      : undefined;
  const filteredCandidates = requestedOfficialStoreId
    ? candidates.filter((item) => item.official_store_id === requestedOfficialStoreId)
    : candidates;

  if (filteredCandidates.length === 0) {
    return null;
  }

  const normalizedPreferredItemId = extractMercadoLivreId(preferredItemId);
  if (normalizedPreferredItemId) {
    const preferredCandidate = filteredCandidates.find(
      (item) => extractMercadoLivreId(item.item_id) === normalizedPreferredItemId,
    );

    if (preferredCandidate) {
      return preferredCandidate;
    }

    if (!options?.allowFallbackWhenPreferredMissing) {
      return null;
    }
  }

  return [...filteredCandidates].sort((left, right) => {
    const leftPrice = resolveDisplayedPrice(
      parsePositiveNumber(left.price),
      extractSalePriceAmount(left.sale_price),
    );
    const rightPrice = resolveDisplayedPrice(
      parsePositiveNumber(right.price),
      extractSalePriceAmount(right.sale_price),
    );
    return leftPrice - rightPrice;
  })[0];
}

/**
 * 🔑 Busca produto na API com retry automático
 */
async function getProductDataWithRetry(
  productId: string,
  options?: MercadoLivreRequestOptions,
): Promise<MercadoLivreProduct> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      logger.info(`Buscando produto ${productId} (tentativa ${attempt + 1}/${MAX_RETRIES})`);

      const url = `${MERCADO_LIVRE_API_BASE}/items/${productId}`;
      const response = await axios.get<MercadoLivreItemResponse>(url, {
        timeout: MERCADO_LIVRE_TIMEOUT_MS,
        headers: buildApiHeaders(options),
        params: {
          include_attributes: "all",
        },
      });

      if (response.status !== 200) {
        throw new Error(`Status ${response.status}`);
      }

      const data = response.data;
      const regularPrice = parsePositiveNumber(data.price);
      const salePrice = extractSalePriceAmount(data.sale_price);
      const price = resolveDisplayedPrice(regularPrice, salePrice);
      const originalPrice = resolveOriginalPrice(data.original_price, regularPrice, price);
      const discount = calculateDiscount(price, originalPrice);
      const images = mapItemImages(data);
      const variations = mapItemVariations(data);
      const hasCouponOrDiscount =
        Boolean(discount && discount > 0) ||
        Boolean(salePrice !== undefined && regularPrice !== undefined && salePrice < regularPrice) ||
        hasPromotionTag(data.tags);
      const couponLabel =
        hasPromotionTag(data.tags) && !(discount && discount > 0) ? "Cupom ativo" : undefined;

      const [sellerData, description] = await Promise.all([
        fetchSellerData(data.seller_id ?? undefined, options),
        fetchItemDescription(productId, options),
      ]);

      const product: MercadoLivreProduct = {
        id: data.id || productId,
        title: data.title || "Sem título",
        price,
        originalPrice,
        discount,
        hasCouponOrDiscount,
        couponLabel,
        currency: data.currency_id || "BRL",
        thumbnail: images[0] ?? (data.thumbnail || ""),
        image: images[0] ?? null,
        images,
        permalink: data.permalink || "",
        seller: sellerData,
        stock: parseNonNegativeNumber(data.available_quantity) ?? 0,
        stockIsReferential: true,
        condition: data.condition || "unknown",
        description: description,
        variations,
      };

      const validatedProduct = validateResolvedProduct(product, {
        source: "api:item",
        expectedItemId: productId,
        returnedItemId: data.id ?? productId,
      });

      logger.info(`Produto encontrado: ${validatedProduct.title}`);
      return validatedProduct;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 404) {
        throw new Error(`Produto ${productId} não encontrado (404)`);
      }
      if (axiosError.response?.status === 403) {
        logger.warn(`Acesso negado ao produto ${productId} (403)`);
        throw new Error(`Acesso negado ao produto ${productId}`);
      }

      if (attempt < MAX_RETRIES - 1) {
        const waitTime = RETRY_DELAY_MS * (attempt + 1);
        logger.warn(
          `Tentativa ${attempt + 1} falhou. Aguardando ${waitTime}ms antes de retry...`,
        );
        await delay(waitTime);
      }
    }
  }

  throw new Error(
    `Falha ao buscar produto ${productId} após ${MAX_RETRIES} tentativas: ${lastError?.message}`,
  );
}

async function getCatalogProductDataWithRetry(
  catalogProductId: string,
  options?: MercadoLivreRequestOptions,
  preferredItemId?: string,
  fallbackOptions?: {
    allowFallbackWhenPreferredMissing?: boolean;
    officialStoreId?: number | null;
  },
): Promise<MercadoLivreProduct> {
  let lastError: Error | null = null;

  if (!options?.accessToken?.trim()) {
    throw new Error(
      "Esse produto de catalogo exige uma credencial ativa do Mercado Livre para consulta oficial.",
    );
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      logger.info(
        `Buscando produto de catalogo ${catalogProductId} (tentativa ${attempt + 1}/${MAX_RETRIES})`,
      );

      if (preferredItemId && preferredItemId !== catalogProductId) {
        try {
          return await getProductDataWithRetry(preferredItemId, options);
        } catch (preferredItemError) {
          logger.warn(
            `Falha ao buscar preferred item ${preferredItemId} do catálogo ${catalogProductId}`,
            preferredItemError,
          );
        }
      }

      const catalogResponse = await axios.get<MercadoLivreCatalogProduct>(
        `${MERCADO_LIVRE_API_BASE}/products/${catalogProductId}`,
        {
          timeout: MERCADO_LIVRE_TIMEOUT_MS,
          headers: buildApiHeaders(options),
        },
      );

      const catalogProduct = catalogResponse.data;
      let bestItem = pickBestCatalogItem(catalogProduct, {}, preferredItemId, fallbackOptions);

      if (!bestItem) {
        try {
          const itemsResponse = await axios.get<MercadoLivreCatalogItemsResponse>(
            `${MERCADO_LIVRE_API_BASE}/products/${catalogProductId}/items`,
            {
              timeout: MERCADO_LIVRE_TIMEOUT_MS,
              headers: buildApiHeaders(options),
            },
          );
          bestItem = pickBestCatalogItem(
            catalogProduct,
            itemsResponse.data,
            preferredItemId,
            fallbackOptions,
          );
        } catch (catalogItemsError) {
          logger.warn(
            `Falha ao buscar itens do catálogo ${catalogProductId} na trilha legada`,
            catalogItemsError,
          );
        }
      }

      if (!bestItem) {
        if (
          normalizeMercadoLivreItemId(preferredItemId) &&
          !fallbackOptions?.allowFallbackWhenPreferredMissing
        ) {
          throw new MercadoLivreLookupValidationError(
            `Produto retornado nao corresponde ao item ${normalizeMercadoLivreItemId(preferredItemId)}.`,
            409,
          );
        }

        throw new Error(`Produto de catálogo ${catalogProductId} sem ofertas disponíveis.`);
      }

      if (bestItem.item_id) {
        try {
          return await getProductDataWithRetry(bestItem.item_id, options);
        } catch (itemError) {
          logger.warn(
            `Falha ao buscar item derivado ${bestItem.item_id} do catálogo ${catalogProductId}`,
            itemError,
          );
        }
      }

      const [sellerData, description] = await Promise.all([
        fetchSellerData(bestItem.seller_id, options),
        bestItem.item_id ? fetchItemDescription(bestItem.item_id, options) : Promise.resolve(null),
      ]);

      const images = mapCatalogImages(catalogProduct);
      const title = String(catalogProduct.name ?? "").trim();
      const regularPrice = parsePositiveNumber(bestItem.price);
      const salePrice = extractSalePriceAmount(bestItem.sale_price);
      const price = resolveDisplayedPrice(regularPrice, salePrice);
      const originalPrice = resolveOriginalPrice(bestItem.original_price, regularPrice, price);
      const discount = calculateDiscount(price, originalPrice);
      const resolvedBestItemId = extractMercadoLivreId(bestItem.item_id);
      const normalizedPreferredItemId = extractMercadoLivreId(preferredItemId);
      const expectedItemIdForValidation =
        fallbackOptions?.allowFallbackWhenPreferredMissing &&
        resolvedBestItemId &&
        normalizedPreferredItemId &&
        resolvedBestItemId !== normalizedPreferredItemId
          ? undefined
          : preferredItemId ?? undefined;
      const hasCouponOrDiscount =
        Boolean(discount && discount > 0) ||
        Boolean(salePrice !== undefined && regularPrice !== undefined && salePrice < regularPrice) ||
        hasPromotionTag(bestItem.tags);

      if (!title || !Number.isFinite(price) || price <= 0) {
        throw new Error(`Produto de catálogo ${catalogProductId} retornou dados insuficientes.`);
      }

      return validateResolvedProduct(
        {
          id: String(catalogProduct.id ?? catalogProductId),
          title,
          price,
          originalPrice,
        discount,
        hasCouponOrDiscount,
        couponLabel:
          hasPromotionTag(bestItem.tags) && !(discount && discount > 0) ? "Cupom ativo" : undefined,
        currency: String(bestItem.currency_id ?? "BRL"),
        thumbnail: images[0] ?? "",
        image: images[0] ?? null,
        images,
        permalink: String(catalogProduct.permalink ?? "").trim() || buildCatalogFallbackUrl(catalogProductId),
        seller: sellerData,
        stock: 0,
          stockIsReferential: true,
          condition: "new",
          description: description || extractCatalogDescription(catalogProduct),
          variations: [],
        },
        {
          source: "api:catalog",
          expectedItemId: expectedItemIdForValidation,
          returnedItemId: bestItem.item_id ?? catalogProduct.id ?? catalogProductId,
          resolvedUrl:
            String(catalogProduct.permalink ?? "").trim() || buildCatalogFallbackUrl(catalogProductId),
        },
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 404) {
        throw new Error(`Produto de catálogo ${catalogProductId} não encontrado (404)`);
      }
      if ([401, 403].includes(axiosError.response?.status ?? 0)) {
        throw new Error(
          "A credencial ativa nao tem permissao para consultar produtos de catalogo do Mercado Livre.",
        );
      }

      if (attempt < MAX_RETRIES - 1) {
        const waitTime = RETRY_DELAY_MS * (attempt + 1);
        logger.warn(
          `Tentativa ${attempt + 1} do catálogo falhou. Aguardando ${waitTime}ms antes de retry...`,
        );
        await delay(waitTime);
      }
    }
  }

  throw new Error(
    `Falha ao buscar produto de catálogo ${catalogProductId} após ${MAX_RETRIES} tentativas: ${lastError?.message}`,
  );
}

async function searchUserProductItemIds(
  sellerId: number | undefined,
  userProductId: string,
  options?: MercadoLivreRequestOptions,
) {
  const normalizedAccessToken = options?.accessToken?.trim();
  const normalizedCredentialSellerId = String(options?.sellerUserId ?? "").trim();
  const normalizedTargetSellerId = sellerId ? String(sellerId).trim() : "";

  if (!normalizedTargetSellerId || !normalizedAccessToken) {
    return [];
  }

  if (normalizedCredentialSellerId && normalizedCredentialSellerId !== normalizedTargetSellerId) {
    return [];
  }

  try {
    const response = await axios.get<MercadoLivreItemsSearchResponse>(
      `${MERCADO_LIVRE_API_BASE}/users/${sellerId}/items/search`,
      {
        timeout: MERCADO_LIVRE_TIMEOUT_MS,
        headers: buildApiHeaders(options),
        params: {
          user_product_id: userProductId,
        },
      },
    );

    return Array.from(
      new Set(
        (response.data.results ?? [])
          .map((value) => normalizeMercadoLivreItemId(value))
          .filter((value): value is string => Boolean(value)),
      ),
    );
  } catch (error) {
    logger.warn(`Falha ao buscar itens do user product ${userProductId}`, error);
    return [];
  }
}

async function getUserProductDataWithRetry(
  userProductId: string,
  options?: MercadoLivreRequestOptions,
  preferredItemId?: string,
): Promise<MercadoLivreProduct> {
  let lastError: Error | null = null;

  if (!options?.accessToken?.trim()) {
    throw new Error(
      "Esse user product exige uma credencial ativa do Mercado Livre para consulta oficial.",
    );
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      logger.info(
        `Buscando user product ${userProductId} (tentativa ${attempt + 1}/${MAX_RETRIES})`,
      );

      const response = await axios.get<MercadoLivreUserProductResponse>(
        `${MERCADO_LIVRE_API_BASE}/user-products/${userProductId}`,
        {
          timeout: MERCADO_LIVRE_TIMEOUT_MS,
          headers: buildApiHeaders(options),
        },
      );

      const userProduct = response.data;
      const resolvedCatalogProductId = String(userProduct.catalog_product_id ?? "").trim() || undefined;

      if (resolvedCatalogProductId) {
        return await getCatalogProductDataWithRetry(
          resolvedCatalogProductId,
          options,
          preferredItemId,
          { allowFallbackWhenPreferredMissing: true },
        );
      }

      if (preferredItemId && preferredItemId !== userProductId) {
        try {
          return await getProductDataWithRetry(preferredItemId, options);
        } catch (preferredItemError) {
          logger.warn(
            `Falha ao buscar preferred item ${preferredItemId} do user product ${userProductId}`,
            preferredItemError,
          );
        }
      }

      const candidateItemIds = await searchUserProductItemIds(
        userProduct.user_id,
        userProductId,
        options,
      );

      for (const candidateItemId of candidateItemIds) {
        try {
          return await getProductDataWithRetry(candidateItemId, options);
        } catch (candidateItemError) {
          logger.warn(
            `Falha ao buscar item ${candidateItemId} do user product ${userProductId}`,
            candidateItemError,
          );
        }
      }

      const name = String(userProduct.name ?? userProduct.family_name ?? "").trim();

      throw new MercadoLivreLookupValidationError(
        name
          ? `O user product ${userProductId} (${name}) foi reconhecido pela API oficial, mas nao expoe um item publico com preco consultavel. Use um link de anuncio com ITEM_ID acessivel ou um link de catalogo /p/MLB...`
          : `O user product ${userProductId} foi reconhecido pela API oficial, mas nao expoe um item publico com preco consultavel. Use um link de anuncio com ITEM_ID acessivel ou um link de catalogo /p/MLB...`,
        422,
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (error instanceof MercadoLivreLookupValidationError) {
        throw error;
      }

      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 404) {
        throw new Error(`User product ${userProductId} não encontrado (404)`);
      }
      if ([401, 403].includes(axiosError.response?.status ?? 0)) {
        throw new Error(
          "A credencial ativa nao tem permissao para consultar esse user product do Mercado Livre.",
        );
      }

      if (attempt < MAX_RETRIES - 1) {
        const waitTime = RETRY_DELAY_MS * (attempt + 1);
        logger.warn(
          `Tentativa ${attempt + 1} do user product falhou. Aguardando ${waitTime}ms antes de retry...`,
        );
        await delay(waitTime);
      }
    }
  }

  throw new Error(
    `Falha ao buscar user product ${userProductId} após ${MAX_RETRIES} tentativas: ${lastError?.message}`,
  );
}

/**
 * 📦 Lê do cache
 */
function readFromCache(productId: string): MercadoLivreProduct | null {
  const cached = productCache.get(productId);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt < Date.now()) {
    productCache.delete(productId);
    logger.info(`Cache expirado para ${productId}`);
    return null;
  }

  logger.info(`Cache hit para ${productId}`);
  return cached.data;
}

/**
 * 💾 Escreve no cache
 */
function writeToCache(productId: string, data: MercadoLivreProduct): void {
  productCache.set(productId, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  logger.info(`Produto ${productId} armazenado em cache`);
}

function buildCatalogLookupCacheKey(catalogProductId: string, officialStoreId?: number | null): string {
  const normalizedCatalogProductId = String(catalogProductId ?? "")
    .trim()
    .toUpperCase();
  const normalizedOfficialStoreId =
    typeof officialStoreId === "number" && Number.isInteger(officialStoreId) && officialStoreId > 0
      ? officialStoreId
      : null;

  if (normalizedOfficialStoreId) {
    return `catalog:${normalizedCatalogProductId}:store:${normalizedOfficialStoreId}`;
  }

  return `catalog:${normalizedCatalogProductId}`;
}

/**
 * 🚀 Função principal - Busca produto por qualquer link do Mercado Livre
 */
export async function getProductFromLink(
  link: string,
  options?: MercadoLivreRequestOptions,
): Promise<MercadoLivreApiResponse> {
  try {
    // 1️⃣ Validar URL
    if (!link || link.trim().length === 0) {
      return {
        error: true,
        code: "INVALID_URL",
        message: "Link vazio ou inválido",
        status: 400,
      };
    }

    if (!isMercadoLivreUrl(link)) {
      return {
        error: true,
        code: "NOT_MERCADOLIVRE_URL",
        message: "Link não é do Mercado Livre",
        status: 400,
      };
    }

    logger.info("Lookup start", {
      linkOriginal: link,
    });

    // 2️⃣ Expandir link (caso seja meli.la)
    const initialPreferredItemId = extractPreferredItemId(link);
    const initialCatalogProductId = extractMercadoLivreCatalogProductIdFromUrl(link);
    const initialUserProductId = extractUserProductId(link);
    const finalUrl = await expandUrl(link);
    const preferredItemId = initialPreferredItemId ?? extractPreferredItemId(finalUrl);
    const catalogProductId =
      initialCatalogProductId ?? extractMercadoLivreCatalogProductIdFromUrl(finalUrl);
    const userProductId = initialUserProductId ?? extractUserProductId(finalUrl);
    const requestedOfficialStoreId =
      extractMercadoLivreOfficialStoreIdFromUrl(link) ??
      extractMercadoLivreOfficialStoreIdFromUrl(finalUrl);
    const isExplicitCatalogUrl = finalUrl.toLowerCase().includes("/p/");

    if (isMercadoLivreSocialUrl(finalUrl) && !preferredItemId && !catalogProductId && !userProductId) {
      return {
        error: true,
        code: "SOCIAL_PROFILE_URL",
        message:
          "O link informado abre um perfil social do Mercado Livre sem ITEM_ID, catalogo ou user product exposto pela API oficial. Use o link direto do anuncio (/MLB...), catalogo (/p/MLB...) ou user product (/up/MLBU...).",
        status: 400,
      };
    }

    logger.info("Link resolvido", {
      linkOriginal: link,
      linkResolvido: finalUrl,
      idProduto: preferredItemId ?? undefined,
      catalogProductId: catalogProductId ?? undefined,
      userProductId: userProductId ?? undefined,
    });

    // 3️⃣ Extrair ID do produto
    const lookupId = preferredItemId ?? catalogProductId ?? userProductId ?? extractProductId(finalUrl);
    if (!lookupId) {
      return {
        error: true,
        code: "PRODUCT_ID_NOT_FOUND",
        message: "Não foi possível extrair o ID do produto",
        status: 400,
      };
    }
    const cacheLookupId =
      catalogProductId && lookupId === catalogProductId
        ? buildCatalogLookupCacheKey(catalogProductId, requestedOfficialStoreId)
        : lookupId;

    // 4️⃣ Verificar cache
    const cached = readFromCache(cacheLookupId);
    if (cached) {
      try {
        const expectedItemIdForCacheValidation = resolveExpectedItemIdForLookupValidation({
          preferredItemId,
          productId: lookupId,
          isExplicitCatalogUrl,
          returnedItemId: cached.id,
          allowPreferredItemFallbackValidation: Boolean(
            preferredItemId && (catalogProductId || userProductId || isExplicitCatalogUrl),
          ),
        });
        validateResolvedProduct(cached, {
          source: "cache",
          originalUrl: link,
          resolvedUrl: finalUrl,
          expectedItemId: expectedItemIdForCacheValidation,
          returnedItemId: cached.id,
        });
        logger.info("Cache hit", {
          linkOriginal: link,
          linkResolvido: finalUrl,
          idProduto: lookupId,
        });
        return cached;
      } catch {
        productCache.delete(cacheLookupId);
      }
    }

    // 5️⃣ Buscar dados da API
    let product: MercadoLivreProduct;
    let allowPreferredItemFallbackValidation = false;

    if (catalogProductId && !preferredItemId) {
      product = await getCatalogProductDataWithRetry(catalogProductId, options, undefined, {
        allowFallbackWhenPreferredMissing: true,
        officialStoreId: requestedOfficialStoreId,
      });
    } else if (userProductId && !preferredItemId && !catalogProductId) {
      product = await getUserProductDataWithRetry(userProductId, options, undefined);
    } else {
      const itemLookupId = preferredItemId ?? extractProductId(finalUrl) ?? lookupId;

      try {
        product = await getProductDataWithRetry(itemLookupId, options);
      } catch (itemError) {
        const itemErrorMessage = itemError instanceof Error ? itemError.message : String(itemError);

        if (
          userProductId &&
          userProductId !== itemLookupId &&
          (itemErrorMessage.includes("não encontrado (404)") ||
            itemErrorMessage.includes("Acesso negado ao produto"))
        ) {
          allowPreferredItemFallbackValidation = true;
          product = await getUserProductDataWithRetry(
            userProductId,
            options,
            preferredItemId ?? undefined,
          );
        } else if (
          catalogProductId &&
          catalogProductId !== itemLookupId &&
          (itemErrorMessage.includes("não encontrado (404)") ||
            itemErrorMessage.includes("Acesso negado ao produto"))
        ) {
          allowPreferredItemFallbackValidation = true;
          product = await getCatalogProductDataWithRetry(
            catalogProductId,
            options,
            preferredItemId ?? itemLookupId,
            {
              allowFallbackWhenPreferredMissing: true,
              officialStoreId: requestedOfficialStoreId,
            },
          );
        } else if (
          catalogProductId &&
          isExplicitCatalogUrl &&
          itemErrorMessage.includes("não encontrado (404)")
        ) {
          allowPreferredItemFallbackValidation = true;
          product = await getCatalogProductDataWithRetry(
            catalogProductId,
            options,
            preferredItemId ?? undefined,
            {
              allowFallbackWhenPreferredMissing: true,
              officialStoreId: requestedOfficialStoreId,
            },
          );
        } else {
          throw itemError;
        }
      }
    }

    const expectedItemIdForFinalValidation = resolveExpectedItemIdForLookupValidation({
      preferredItemId,
      productId: lookupId,
      isExplicitCatalogUrl,
      returnedItemId: product.id,
      allowPreferredItemFallbackValidation,
    });

    const validatedProduct = validateResolvedProduct(product, {
      source: "lookup:final",
      originalUrl: link,
      resolvedUrl: finalUrl,
      expectedItemId: expectedItemIdForFinalValidation,
      returnedItemId: product.id,
    });

    // 6️⃣ Armazenar em cache
    writeToCache(cacheLookupId, validatedProduct);

    return validatedProduct;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Erro em getProductFromLink", error);

    return {
      error: true,
      code: "FETCH_FAILED",
      message: message || "Erro ao buscar produto",
      status: error instanceof MercadoLivreLookupValidationError ? error.status : 500,
    };
  }
}

/**
 * 🔍 Busca produto direto pelo ID
 */
export async function getProductById(
  productId: string,
  options?: MercadoLivreRequestOptions,
): Promise<MercadoLivreApiResponse> {
  try {
    if (!productId || productId.trim().length === 0) {
      return {
        error: true,
        code: "INVALID_PRODUCT_ID",
        message: "ID do produto vazio ou inválido",
        status: 400,
      };
    }

    const normalizedProductId = normalizeProductId(productId);

    // Verificar cache
    const cached = readFromCache(normalizedProductId);
    if (cached) {
      try {
        validateResolvedProduct(cached, {
          source: "cache:id",
          expectedItemId: normalizedProductId,
          returnedItemId: cached.id,
        });
        return cached;
      } catch {
        productCache.delete(normalizedProductId);
      }
    }

    // Buscar da API
    const product = await getProductDataWithRetry(normalizedProductId, options);

    // Armazenar em cache
    writeToCache(normalizedProductId, product);

    return product;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Erro ao buscar produto ${productId}`, error);

    return {
      error: true,
      code: "FETCH_FAILED",
      message: message || "Erro ao buscar produto",
      status: error instanceof MercadoLivreLookupValidationError ? error.status : 500,
    };
  }
}

/**
 * 🗑️ Limpar cache
 */
export function clearCache(): void {
  productCache.clear();
  logger.info("Cache limpo");
}

/**
 * 📊 Obter informações do cache
 */
export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: productCache.size,
    entries: Array.from(productCache.keys()),
  };
}
