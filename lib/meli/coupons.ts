import { isMercadoLivreShortLink, resolveMercadoLivreProductLinks } from "@/lib/meli/affiliate";
import { fetchMercadoLivreProductByConfiguredApi } from "@/lib/products/mercadoLivreConfigured";
import { extractMercadoLivreItemIdFromUrl } from "@/lib/products/mercadoLivreLink";

const MELI_API_BASE = "https://api.mercadolibre.com";
const MELI_COUPONS_PAGE_URL = "https://www.mercadolivre.com.br/cupons";
const COUPON_CACHE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
};

type MeliItemPayload = {
  id?: string;
  title?: string;
  price?: number | null;
  original_price?: number | null;
  sale_price?:
    | {
        amount?: number | null;
      }
    | null;
  seller_id?: number | null;
  category_id?: string | null;
  permalink?: string | null;
  currency_id?: string | null;
};

type MeliCategoryPayload = {
  id?: string;
  name?: string;
  path_from_root?:
    | Array<{
        id?: string;
        name?: string;
      }>
    | null;
};

type CouponSource = "product-discount" | "product-page" | "coupon-page";
type CouponDiscountType = "percentage" | "fixed_amount" | "price" | "label";

type CouponCandidate = {
  source: CouponSource;
  name?: string;
  code?: string;
  discountType?: CouponDiscountType;
  discountPercentage?: number;
  discountAmount?: number;
  minimumPurchase?: number;
  maximumDiscount?: number;
  validUntil?: string;
  sellerId?: string;
  sellerName?: string;
  categoryId?: string;
  categoryName?: string;
  itemId?: string;
  label?: string;
};

export type MercadoLivreCoupon = {
  source: CouponSource;
  name: string;
  code?: string;
  discountLabel: string;
  discountType?: CouponDiscountType;
  discountPercentage?: number;
  discountAmount?: number;
  minimumPurchase?: number;
  maximumDiscount?: number;
  validUntil?: string;
  sellerId?: string;
  sellerName?: string;
  categoryId?: string;
  categoryName?: string;
  itemId?: string;
  applicable: boolean;
  matchReasons: string[];
};

export type MercadoLivreCouponLookupProduct = {
  itemId: string;
  title: string;
  price: number;
  originalPrice?: number;
  discount?: number;
  categoryId?: string;
  categoryName?: string;
  categoryPath: string[];
  sellerId?: string;
  sellerName?: string;
  permalink: string;
  resolvedLink: string;
  affiliateLink?: string;
  shortLink?: string;
  couponLabel?: string;
  hasCouponOrDiscount: boolean;
};

export type MercadoLivreCouponLookupResult = {
  product: MercadoLivreCouponLookupProduct;
  coupons: MercadoLivreCoupon[];
  marketingMessage: string;
  searchedAt: string;
  cache: {
    hit: boolean;
    ttlSeconds: number;
  };
};

export type MercadoLivreVisibleCouponData = {
  hasCouponOrDiscount: boolean;
  couponLabel?: string;
  marketingMessage?: string;
  coupon?: MercadoLivreCoupon;
};

type CouponLookupCacheEntry = {
  expiresAt: number;
  data: Omit<MercadoLivreCouponLookupResult, "cache">;
};

const couponLookupCache = new Map<string, CouponLookupCacheEntry>();

function sanitizeText(value: string | number | null | undefined) {
  return String(value ?? "").trim();
}

function slugifyText(value: string | undefined | null) {
  return sanitizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeWhitespace(value: string | undefined | null) {
  return sanitizeText(value).replace(/\s+/g, " ").trim();
}

function stripHtml(value: string) {
  return normalizeWhitespace(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&"),
  );
}

function parseMoney(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  const normalized = sanitizeText(value);
  if (!normalized) {
    return undefined;
  }

  const digitsOnly = normalized.replace(/[^\d.,-]/g, "");
  if (!digitsOnly) {
    return undefined;
  }

  const commaCount = (digitsOnly.match(/,/g) ?? []).length;
  const dotCount = (digitsOnly.match(/\./g) ?? []).length;

  let normalizedNumber = digitsOnly;
  if (commaCount > 0 && dotCount > 0) {
    normalizedNumber = normalizedNumber.replace(/\./g, "").replace(",", ".");
  } else if (commaCount > 0) {
    normalizedNumber = normalizedNumber.replace(/\./g, "").replace(",", ".");
  } else {
    normalizedNumber = normalizedNumber.replace(/,/g, "");
  }

  const parsed = Number(normalizedNumber);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function calculateDiscount(price: number, originalPrice?: number) {
  if (originalPrice === undefined || originalPrice <= price || originalPrice <= 0) {
    return undefined;
  }

  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

function formatCurrencyBRL(value: number | undefined) {
  if (value === undefined) {
    return undefined;
  }

  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  });
}

function buildDiscountLabel(candidate: CouponCandidate) {
  if (candidate.discountPercentage !== undefined) {
    return `${candidate.discountPercentage}% OFF`;
  }

  if (candidate.discountAmount !== undefined) {
    const formatted = formatCurrencyBRL(candidate.discountAmount);
    return formatted ? `${formatted} OFF` : "Desconto ativo";
  }

  if (candidate.label) {
    return candidate.label;
  }

  return "Cupom disponivel";
}

function isGenericCouponLabel(value: string | undefined | null) {
  const normalized = slugifyText(value);
  return (
    normalized.length === 0 ||
    normalized === "cupom ativo" ||
    normalized === "cupom disponivel" ||
    normalized === "desconto ativo no produto" ||
    normalized === "desconto ativo"
  );
}

function buildCouponMarketingMessage(args: {
  title: string;
  price: number;
  originalPrice?: number;
  link: string;
  coupon?: MercadoLivreCoupon;
}) {
  const lines = [args.title, ""];

  if (args.originalPrice !== undefined && args.originalPrice > args.price) {
    lines.push(`🔥 DE ${formatCurrencyBRL(args.originalPrice)}`);
  }

  lines.push(`🔥 POR ${formatCurrencyBRL(args.price)}`);

  if (args.coupon) {
    lines.push("");
    lines.push(`🎟 Cupom: ${args.coupon.code ?? args.coupon.discountLabel}`);
  }

  lines.push("");
  lines.push(`🔗 ${args.link}`);

  return lines.filter((entry) => sanitizeText(entry).length > 0).join("\n");
}

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

async function fetchJson<T>(url: string, init?: RequestInit) {
  const timeout = createTimeoutSignal(REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: timeout.signal,
    });

    if (!response.ok) {
      throw new Error(`Falha ao consultar ${url}: status ${response.status}.`);
    }

    return (await response.json()) as T;
  } finally {
    timeout.clear();
  }
}

async function fetchText(url: string, init?: RequestInit) {
  const timeout = createTimeoutSignal(REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: timeout.signal,
    });

    if (!response.ok) {
      throw new Error(`Falha ao consultar ${url}: status ${response.status}.`);
    }

    return await response.text();
  } finally {
    timeout.clear();
  }
}

function normalizeCacheUrl(rawUrl: string) {
  const normalized = sanitizeText(rawUrl);
  if (!normalized) {
    return "";
  }

  try {
    const parsed = new URL(normalized);
    parsed.hash = "";
    return parsed.toString().toLowerCase();
  } catch {
    return normalized.toLowerCase();
  }
}

function getCacheKeys(args: {
  rawUrl: string;
  itemId?: string;
  permalink?: string;
  shortLink?: string;
}) {
  return Array.from(
    new Set(
      [
        normalizeCacheUrl(args.rawUrl),
        args.itemId ? `item:${args.itemId}` : "",
        normalizeCacheUrl(args.permalink ?? ""),
        normalizeCacheUrl(args.shortLink ?? ""),
      ].filter(Boolean),
    ),
  );
}

function getCachedLookup(keys: string[]) {
  const now = Date.now();

  for (const key of keys) {
    const cached = couponLookupCache.get(key);
    if (!cached) {
      continue;
    }

    if (cached.expiresAt <= now) {
      couponLookupCache.delete(key);
      continue;
    }

    return {
      data: cached.data,
      ttlSeconds: Math.max(1, Math.floor((cached.expiresAt - now) / 1000)),
    };
  }

  return null;
}

function setCachedLookup(keys: string[], data: Omit<MercadoLivreCouponLookupResult, "cache">) {
  const expiresAt = Date.now() + COUPON_CACHE_TTL_MS;

  for (const key of keys) {
    couponLookupCache.set(key, {
      expiresAt,
      data,
    });
  }
}

function extractPromotionLabelFromHtml(html: string) {
  const patterns = [
    /"discount_label"\s*:\s*\{[\s\S]{0,320}?"text"\s*:\s*"([^"]+)"/i,
    /"coupon_label"\s*:\s*\{[\s\S]{0,320}?"text"\s*:\s*"([^"]+)"/i,
    /"promotion_name"\s*:\s*"([^"]{1,160})"/i,
  ];

  for (const pattern of patterns) {
    const label = normalizeWhitespace(pattern.exec(html)?.[1]);
    if (label) {
      return label;
    }
  }

  return undefined;
}

function matchCouponCode(text: string) {
  const labeledCode =
    text.match(
      /(?:cupom|coupon|codigo|codigo do cupom|coupon code)[:\s#-]*([A-Z0-9_-]{4,20})/i,
    )?.[1] ?? "";

  if (labeledCode) {
    return sanitizeText(labeledCode).toUpperCase();
  }

  const genericCode = text.match(/\b[A-Z0-9]{5,14}\b/g) ?? [];
  return genericCode
    .find(
      (entry) =>
        /[A-Z]/.test(entry) &&
        /\d/.test(entry) &&
        !/^ML[A-Z]\d{6,}$/i.test(entry) &&
        !/^HTTP/i.test(entry),
    )
    ?.toUpperCase();
}

function extractCouponCandidatesFromHtml(html: string, source: CouponSource) {
  const snippets = new Set<string>();
  const keywordPattern =
    /coupon_code|couponCode|partial_coupon_code|fixed_percentage|fixed_amount|min_purchase_amount|cupom|coupon|cupon|promotion_name/gi;

  let match: RegExpExecArray | null;
  while ((match = keywordPattern.exec(html)) !== null) {
    snippets.add(
      html.slice(Math.max(0, match.index - 260), Math.min(html.length, match.index + 760)),
    );
  }

  const blocks = html
    .split(/<\/(?:section|article|li|div|script)>/i)
    .filter((block) => /(cupom|coupon|cupon|promotion_name|fixed_percentage|fixed_amount)/i.test(block))
    .slice(0, 120);

  for (const block of blocks) {
    snippets.add(block.slice(0, 1200));
  }

  const candidates: CouponCandidate[] = [];

  for (const snippet of snippets) {
    const text = stripHtml(snippet);
    if (!text) {
      continue;
    }

    const discountPercentage = parseMoney(
      snippet.match(
        /"(?:fixed_percentage|discount_percentage|percentage|percent_off)"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i,
      )?.[1] ?? text.match(/([0-9]{1,2})\s*%/i)?.[1],
    );

    const discountAmount = parseMoney(
      snippet.match(
        /"(?:fixed_amount|discount_amount|amount_off)"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i,
      )?.[1] ??
        text.match(
          /(?:desconto|off|economize|cupom)\D{0,20}R\$\s*([0-9][0-9\.,]*)/i,
        )?.[1],
    );

    const minimumPurchase = parseMoney(
      snippet.match(/"min_purchase_amount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1] ??
        text.match(
          /(?:minimo|minimo de compra|compra minima|acima de|a partir de)\D{0,20}R\$\s*([0-9][0-9\.,]*)/i,
        )?.[1],
    );

    const maximumDiscount = parseMoney(
      snippet.match(/"max_purchase_amount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1],
    );

    const candidate: CouponCandidate = {
      source,
      name: normalizeWhitespace(
        snippet.match(/"promotion_name"\s*:\s*"([^"]{1,160})"/i)?.[1] ??
          snippet.match(/"title"\s*:\s*"([^"]{1,160})"/i)?.[1] ??
          text.match(/(?:cupom|coupon)\s+([^\n\r]{4,90})/i)?.[1],
      ),
      code: matchCouponCode(text),
      discountType:
        discountPercentage !== undefined
          ? "percentage"
          : discountAmount !== undefined
            ? "fixed_amount"
            : undefined,
      discountPercentage,
      discountAmount,
      minimumPurchase,
      maximumDiscount,
      validUntil: normalizeWhitespace(
        snippet.match(/"(?:finish_date|end_date|valid_until)"\s*:\s*"([^"]+)"/i)?.[1] ??
          text.match(/(?:valido ate|valido at[eé]|ate)\s+([0-9]{2}\/[0-9]{2}(?:\/[0-9]{2,4})?)/i)?.[1],
      ),
      sellerId: sanitizeText(snippet.match(/"seller_id"\s*:\s*"?(\\?\d+)"?/i)?.[1]),
      sellerName: normalizeWhitespace(
        snippet.match(/"seller_name"\s*:\s*"([^"]+)"/i)?.[1] ??
          text.match(/(?:vendedor|loja)\s*:\s*([^\n\r]{3,80})/i)?.[1],
      ),
      categoryId: sanitizeText(snippet.match(/"category_id"\s*:\s*"([^"]+)"/i)?.[1]),
      categoryName: normalizeWhitespace(
        snippet.match(/"category_name"\s*:\s*"([^"]+)"/i)?.[1] ??
          text.match(/(?:categoria)\s*:\s*([^\n\r]{3,80})/i)?.[1],
      ),
      itemId: sanitizeText(
        snippet.match(/(ML[A-Z][-_]?\d{6,})/i)?.[1] ??
          text.match(/(ML[A-Z][-_]?\d{6,})/i)?.[1],
      ).replace(/[-_]/g, ""),
      label: normalizeWhitespace(
        snippet.match(/"coupon_label"\s*:\s*\{[\s\S]{0,320}?"text"\s*:\s*"([^"]+)"/i)?.[1],
      ),
    };

    if (
      !candidate.code &&
      !candidate.name &&
      candidate.discountPercentage === undefined &&
      candidate.discountAmount === undefined &&
      !candidate.label
    ) {
      continue;
    }

    candidates.push(candidate);
  }

  return candidates;
}

function matchesCategory(candidateName: string | undefined, categories: string[]) {
  const normalizedCandidate = slugifyText(candidateName);
  if (!normalizedCandidate) {
    return false;
  }

  return categories.some((category) => {
    const normalizedCategory = slugifyText(category);
    return (
      normalizedCategory.length > 0 &&
      (normalizedCandidate.includes(normalizedCategory) ||
        normalizedCategory.includes(normalizedCandidate))
    );
  });
}

function isExpired(value: string | undefined) {
  const normalized = sanitizeText(value);
  if (!normalized) {
    return false;
  }

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.getTime() < Date.now();
  }

  const dateMatch = normalized.match(/(\d{2})\/(\d{2})(?:\/(\d{2,4}))?/);
  if (!dateMatch) {
    return false;
  }

  const year =
    dateMatch[3] && dateMatch[3].length === 2
      ? Number(`20${dateMatch[3]}`)
      : Number(dateMatch[3] ?? new Date().getFullYear());
  const parsedDate = new Date(year, Number(dateMatch[2]) - 1, Number(dateMatch[1]), 23, 59, 59);
  return !Number.isNaN(parsedDate.getTime()) && parsedDate.getTime() < Date.now();
}

function mapCouponCandidateToResult(
  candidate: CouponCandidate,
  context: MercadoLivreCouponLookupProduct,
) {
  const matchReasons: string[] = [];
  const categoryCandidates = [context.categoryName ?? "", ...context.categoryPath].filter(Boolean);

  if (candidate.itemId && candidate.itemId === context.itemId) {
    matchReasons.push("Item da promocao corresponde ao produto.");
  }

  if (candidate.sellerId && context.sellerId && candidate.sellerId === context.sellerId) {
    matchReasons.push("Vendedor do cupom corresponde ao vendedor do produto.");
  }

  if (
    candidate.sellerName &&
    context.sellerName &&
    slugifyText(candidate.sellerName) === slugifyText(context.sellerName)
  ) {
    matchReasons.push("Nome do vendedor bate com o produto.");
  }

  if (candidate.categoryId && context.categoryId && candidate.categoryId === context.categoryId) {
    matchReasons.push("Categoria do cupom corresponde a categoria do produto.");
  }

  if (matchesCategory(candidate.categoryName, categoryCandidates)) {
    matchReasons.push("Texto da categoria do cupom combina com a categoria do produto.");
  }

  if (candidate.source === "product-discount") {
    matchReasons.push("Desconto detectado diretamente no produto.");
  }

  if (candidate.source === "product-page") {
    matchReasons.push("Promocao identificada na pagina oficial do produto.");
  }

  if (
    candidate.source === "coupon-page" &&
    !candidate.itemId &&
    !candidate.sellerId &&
    !candidate.sellerName &&
    !candidate.categoryId &&
    !candidate.categoryName
  ) {
    matchReasons.push("Cupom geral encontrado na pagina oficial de cupons.");
  }

  const minimumPurchaseFailed =
    candidate.minimumPurchase !== undefined && context.price < candidate.minimumPurchase;
  const expired = isExpired(candidate.validUntil);
  const requiresScopedMatch =
    Boolean(candidate.itemId) ||
    Boolean(candidate.sellerId) ||
    Boolean(candidate.sellerName) ||
    Boolean(candidate.categoryId) ||
    Boolean(candidate.categoryName);

  const applicable =
    !minimumPurchaseFailed &&
    !expired &&
    (!requiresScopedMatch || matchReasons.length > 0);

  if (minimumPurchaseFailed) {
    matchReasons.push("Valor minimo do cupom nao foi atingido.");
  }

  if (expired) {
    matchReasons.push("Cupom encontrado, mas ja expirado.");
  }

  return {
    source: candidate.source,
    name:
      candidate.name ||
      candidate.label ||
      (candidate.code ? `Cupom ${candidate.code}` : "Cupom Mercado Livre"),
    code: candidate.code || undefined,
    discountLabel: buildDiscountLabel(candidate),
    discountType: candidate.discountType,
    discountPercentage: candidate.discountPercentage,
    discountAmount: candidate.discountAmount,
    minimumPurchase: candidate.minimumPurchase,
    maximumDiscount: candidate.maximumDiscount,
    validUntil: sanitizeText(candidate.validUntil) || undefined,
    sellerId: sanitizeText(candidate.sellerId) || undefined,
    sellerName: sanitizeText(candidate.sellerName) || undefined,
    categoryId: sanitizeText(candidate.categoryId) || undefined,
    categoryName: sanitizeText(candidate.categoryName) || undefined,
    itemId: sanitizeText(candidate.itemId) || undefined,
    applicable,
    matchReasons,
  } satisfies MercadoLivreCoupon;
}

function dedupeCoupons(coupons: MercadoLivreCoupon[]) {
  const seen = new Set<string>();
  const sourcePriority: Record<CouponSource, number> = {
    "product-discount": 0,
    "product-page": 1,
    "coupon-page": 2,
  };

  return coupons
    .sort((left, right) => {
      if (left.applicable !== right.applicable) {
        return left.applicable ? -1 : 1;
      }

      return sourcePriority[left.source] - sourcePriority[right.source];
    })
    .filter((coupon) => {
      const key = [
        coupon.source,
        sanitizeText(coupon.code).toUpperCase(),
        slugifyText(coupon.name),
        sanitizeText(coupon.itemId),
        sanitizeText(coupon.categoryId),
        sanitizeText(coupon.sellerId),
        sanitizeText(coupon.discountLabel),
      ].join("|");

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

export function pickPreferredMercadoLivreCoupon(coupons: MercadoLivreCoupon[]) {
  return (
    coupons.find((coupon) => coupon.applicable && sanitizeText(coupon.code).length > 0) ??
    coupons.find((coupon) => coupon.applicable) ??
    null
  );
}

export function formatMercadoLivreCouponLabel(coupon: MercadoLivreCoupon | null | undefined) {
  if (!coupon) {
    return undefined;
  }

  if (sanitizeText(coupon.code)) {
    return `Cupom ${sanitizeText(coupon.code).toUpperCase()} - ${coupon.discountLabel}`;
  }

  return sanitizeText(coupon.name) || sanitizeText(coupon.discountLabel) || undefined;
}

export async function resolveMercadoLivreVisibleCouponData(args: {
  url: string;
  title: string;
  price: number;
  originalPrice?: number;
  hasCouponOrDiscount?: boolean;
  couponLabel?: string;
  fallbackMarketingMessage: string;
}) {
  let hasCouponOrDiscount = Boolean(args.hasCouponOrDiscount);
  let couponLabel = sanitizeText(args.couponLabel) || undefined;
  let marketingMessage = args.fallbackMarketingMessage;
  let coupon: MercadoLivreCoupon | null = null;

  try {
    const couponLookup = await searchMercadoLivreCouponsByUrl(args.url);
    coupon = pickPreferredMercadoLivreCoupon(couponLookup.coupons);

    if (coupon) {
      hasCouponOrDiscount = true;

      const resolvedCouponLabel = formatMercadoLivreCouponLabel(coupon);
      if (!couponLabel || isGenericCouponLabel(couponLabel)) {
        couponLabel = resolvedCouponLabel ?? couponLabel;
      }

      if (sanitizeText(couponLookup.marketingMessage)) {
        marketingMessage = couponLookup.marketingMessage;
      }
    }
  } catch {
    // Mantem os dados atuais do produto se a busca de cupom falhar.
  }

  return {
    hasCouponOrDiscount,
    couponLabel,
    marketingMessage,
    coupon: coupon ?? undefined,
  } satisfies MercadoLivreVisibleCouponData;
}

export async function searchMercadoLivreCouponsByUrl(
  rawUrl: string,
): Promise<MercadoLivreCouponLookupResult> {
  const initialCacheKeys = getCacheKeys({ rawUrl });
  const initialCached = getCachedLookup(initialCacheKeys);
  if (initialCached) {
    return {
      ...initialCached.data,
      cache: {
        hit: true,
        ttlSeconds: initialCached.ttlSeconds,
      },
    };
  }

  const product = await fetchMercadoLivreProductByConfiguredApi(rawUrl);
  const canonicalLink = product.canonicalLink ?? product.link;
  const itemId =
    extractMercadoLivreItemIdFromUrl(canonicalLink) ?? extractMercadoLivreItemIdFromUrl(rawUrl);

  if (!itemId) {
    throw new Error("Nao foi possivel identificar o ITEM_ID do produto.");
  }

  const itemPayload = await fetchJson<MeliItemPayload>(`${MELI_API_BASE}/items/${itemId}`);
  const categoryPayload = itemPayload.category_id
    ? await fetchJson<MeliCategoryPayload>(`${MELI_API_BASE}/categories/${itemPayload.category_id}`).catch(
        () => null,
      )
    : null;

  const resolvedLinks = await resolveMercadoLivreProductLinks({
    link: rawUrl,
    canonicalLink,
    linkOriginal: canonicalLink,
    linkShort: isMercadoLivreShortLink(rawUrl) ? rawUrl : undefined,
  });
  const resolvedLink =
    resolvedLinks.linkShort || resolvedLinks.linkAffiliate || resolvedLinks.linkOriginal || canonicalLink;
  const productContext: MercadoLivreCouponLookupProduct = {
    itemId,
    title: product.title,
    price: product.price,
    originalPrice: product.originalPrice,
    discount: product.discount ?? calculateDiscount(product.price, product.originalPrice),
    categoryId: sanitizeText(itemPayload.category_id) || undefined,
    categoryName: sanitizeText(categoryPayload?.name) || undefined,
    categoryPath:
      categoryPayload?.path_from_root
        ?.map((entry) => sanitizeText(entry.name))
        .filter(Boolean) ?? [],
    sellerId:
      sanitizeText(itemPayload.seller_id) ||
      undefined,
    sellerName: sanitizeText(product.seller) || undefined,
    permalink: sanitizeText(itemPayload.permalink) || canonicalLink,
    resolvedLink,
    affiliateLink: resolvedLinks.linkAffiliate,
    shortLink: resolvedLinks.linkShort,
    couponLabel: sanitizeText(product.couponLabel) || undefined,
    hasCouponOrDiscount: product.hasCouponOrDiscount,
  };

  const secondaryCacheKeys = getCacheKeys({
    rawUrl,
    itemId,
    permalink: productContext.permalink,
    shortLink: productContext.shortLink,
  });
  const cached = getCachedLookup(secondaryCacheKeys);
  if (cached) {
    return {
      ...cached.data,
      cache: {
        hit: true,
        ttlSeconds: cached.ttlSeconds,
      },
    };
  }

  const [productHtml, couponsHtml] = await Promise.all([
    fetchText(productContext.permalink, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
    }).catch(() => ""),
    fetchText(MELI_COUPONS_PAGE_URL, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
    }).catch(() => ""),
  ]);

  const productCandidates: CouponCandidate[] = [];

  if (productContext.originalPrice !== undefined && productContext.originalPrice > productContext.price) {
    productCandidates.push({
      source: "product-discount",
      name: productContext.couponLabel || "Desconto ativo no produto",
      discountType: "price",
      discountPercentage: productContext.discount,
      label:
        productContext.discount !== undefined
          ? `${productContext.discount}% OFF`
          : productContext.couponLabel || "Desconto ativo",
      itemId: productContext.itemId,
      sellerId: productContext.sellerId,
      sellerName: productContext.sellerName,
      categoryId: productContext.categoryId,
      categoryName: productContext.categoryName,
    });
  }

  const productPageLabel =
    extractPromotionLabelFromHtml(productHtml) || productContext.couponLabel;
  if (productPageLabel) {
    productCandidates.push({
      source: "product-page",
      name: productPageLabel,
      label: productPageLabel,
      itemId: productContext.itemId,
      sellerId: productContext.sellerId,
      sellerName: productContext.sellerName,
      categoryId: productContext.categoryId,
      categoryName: productContext.categoryName,
    });
  }

  const couponPageCandidates = extractCouponCandidatesFromHtml(couponsHtml, "coupon-page");

  const coupons = dedupeCoupons(
    [...productCandidates, ...couponPageCandidates].map((candidate) =>
      mapCouponCandidateToResult(candidate, productContext),
    ),
  );

  const preferredCoupon =
    coupons.find((coupon) => coupon.applicable && sanitizeText(coupon.code).length > 0) ??
    coupons.find((coupon) => coupon.applicable);
  const data = {
    product: productContext,
    coupons,
    marketingMessage: buildCouponMarketingMessage({
      title: productContext.title,
      price: productContext.price,
      originalPrice: productContext.originalPrice,
      link: productContext.shortLink || productContext.affiliateLink || productContext.resolvedLink,
      coupon: preferredCoupon,
    }),
    searchedAt: new Date().toISOString(),
  } satisfies Omit<MercadoLivreCouponLookupResult, "cache">;

  setCachedLookup(secondaryCacheKeys, data);

  return {
    ...data,
    cache: {
      hit: false,
      ttlSeconds: Math.floor(COUPON_CACHE_TTL_MS / 1000),
    },
  };
}
