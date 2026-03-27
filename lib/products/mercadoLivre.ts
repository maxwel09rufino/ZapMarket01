import { ensureActiveMeliCredentialAccessToken } from "@/lib/meli/store";
import {
  buildMercadoLivreCatalogUrl,
  buildMercadoLivreItemUrl,
  extractMercadoLivreCatalogProductIdFromUrl,
  extractMercadoLivreItemId,
  extractMercadoLivrePreferredItemIdFromUrl,
  extractMercadoLivreOfficialStoreIdFromUrl,
  getMercadoLivreProductMismatchReason,
} from "@/lib/products/mercadoLivreLink";

const MERCADO_LIVRE_API_BASE = "https://api.mercadolibre.com";
const MERCADO_LIVRE_CACHE_TTL_MS = 10 * 60 * 1000;
const MERCADO_LIVRE_TIMEOUT_MS = 15000;
const ITEM_ID_REGEX = /MLB[-_]?(\d{6,})/i;
const SEARCH_QUERY_GENERIC_TOKENS = new Set([
  "aberto",
  "basic",
  "compressao",
  "compressão",
  "elastica",
  "elástica",
  "forte",
  "imobilizadora",
  "media",
  "média",
  "meia",
  "mmhg",
  "ortese",
  "órtese",
  "polegar",
]);
const SEARCH_QUERY_STOPWORDS = new Set([
  "a",
  "com",
  "cor",
  "da",
  "de",
  "do",
  "e",
  "em",
  "no",
  "para",
  "sem",
  "unissex",
]);

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
};

export const PRODUCT_LOOKUP_ERROR_MESSAGE = "Produto nao encontrado ou link invalido.";
export const PRODUCT_NOT_ITEM_LINK_MESSAGE =
  "Link informado nao aponta para um produto do Mercado Livre.";

type MercadoLivreItemPayload = {
  id?: string;
  title?: string;
  price?: number;
  original_price?: number | null;
  thumbnail?: string;
  pictures?: Array<{
    url?: string;
    secure_url?: string;
  }>;
  permalink?: string;
  seller_id?: number;
  sale_price?:
    | {
        amount?: number;
      }
    | null;
  tags?: string[];
  attributes?: MercadoLivreAttributePayload[];
};

type MercadoLivreDescriptionPayload = {
  plain_text?: string;
  text?: string;
};

type MercadoLivreSellerPayload = {
  nickname?: string;
};

type MercadoLivreAttributePayload = {
  id?: string;
  name?: string;
  value_name?: string;
  values?: Array<{
    name?: string;
  }>;
};

type MercadoLivreCatalogItemPayload = {
  item_id?: string;
  seller_id?: number;
  price?: number;
  original_price?: number | null;
  tags?: string[];
  official_store_id?: number | null;
  shipping?:
    | {
        free_shipping?: boolean;
        cost?: number | null;
      }
    | null;
};

type MercadoLivreCatalogProductPayload = {
  id?: string;
  catalog_product_id?: string;
  name?: string;
  permalink?: string;
  short_description?:
    | {
        content?: string;
        text?: string;
      }
    | null;
  pictures?: Array<{
    url?: string;
    secure_url?: string;
  }>;
  main_features?: Array<{
    text?: string;
  }>;
  buy_box_winner?: MercadoLivreCatalogItemPayload | null;
  attributes?: MercadoLivreAttributePayload[];
};

type MercadoLivreCatalogItemsPayload = {
  results?: MercadoLivreCatalogItemPayload[];
};

type MercadoLivreCatalogSearchPayload = {
  results?: MercadoLivreCatalogProductPayload[];
};

type JsonLdOffer =
  | {
      price?: number | string;
      url?: string;
    }
  | Array<{
      price?: number | string;
      url?: string;
    }>;

type JsonLdProduct = {
  "@type"?: string;
  name?: string;
  description?: string;
  image?: string | string[];
  offers?: JsonLdOffer;
  sku?: string;
  productID?: string;
  brand?:
    | string
    | {
        name?: string;
      };
};

type HtmlMetaSelector = {
  attribute: "property" | "name" | "itemprop";
  value: string;
};

export type MercadoLivreFetchedProduct = {
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
  canonicalLink?: string;
  marketplace: "mercadolivre";
  seller?: string;
  stock?: number;
  stockIsReferential?: boolean;
  variations?: Array<{
    id: string;
    price?: number;
    availableQuantity?: number;
    soldQuantity?: number;
    pictureIds: string[];
    attributeCombinations: Array<{
      id?: string;
      name?: string;
      valueId?: string;
      valueName?: string;
    }>;
    attributes: Array<{
      id?: string;
      name?: string;
      valueId?: string;
      valueName?: string;
    }>;
  }>;
};

type CacheEntry = {
  expiresAt: number;
  data: MercadoLivreFetchedProduct;
};

type ScrapedPageData = {
  product: MercadoLivreFetchedProduct;
  itemId?: string;
  finalUrl: string;
};

const productCache = new Map<string, CacheEntry>();

type MercadoLivreAuthState = {
  accessToken?: string;
  expiresAt?: number;
  pendingTokenPromise?: Promise<string | null>;
};

const globalForMercadoLivreAuth = globalThis as typeof globalThis & {
  mercadoLivreAuthState?: MercadoLivreAuthState;
};

const mercadoLivreAuthState =
  globalForMercadoLivreAuth.mercadoLivreAuthState ??
  (globalForMercadoLivreAuth.mercadoLivreAuthState = {});

export class ProductLookupError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function sanitizeText(value: string | undefined) {
  return (value ?? "").trim();
}

function logMercadoLivreLookup(stage: string, details: Record<string, unknown>) {
  console.info(
    "[MELI_LOOKUP]",
    JSON.stringify({
      stage,
      ...details,
    }),
  );
}

function decodeEscapedText(value: string) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/")
    .replace(/\\\\/g, "\\")
    .trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCharCode(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function stripHtmlTags(value: string) {
  return value.replace(/<[^>]*>/g, " ");
}

function normalizeHtmlText(value: string | undefined) {
  if (!value) {
    return "";
  }

  const decoded = decodeHtmlEntities(decodeEscapedText(value));
  return stripHtmlTags(decoded).replace(/\s+/g, " ").trim();
}

function normalizeCouponLabel(value: string | undefined) {
  const normalized = normalizeHtmlText(value);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizePromotionLabel(value: string | undefined) {
  const normalized = normalizeCouponLabel(value);
  if (!normalized) {
    return undefined;
  }

  if (/\{[^}]+\}/.test(normalized)) {
    return undefined;
  }

  const looksLikeInstallmentText =
    /\b\d+x\b/i.test(normalized) ||
    /\bparcel(?:a|as)\b/i.test(normalized) ||
    /\bsem juros\b/i.test(normalized) ||
    /\bcom juros\b/i.test(normalized);
  const looksLikePromotionText =
    /\bcupom\b/i.test(normalized) ||
    /\bpromo/i.test(normalized) ||
    /\bdesconto\b/i.test(normalized) ||
    /\boff\b/i.test(normalized) ||
    /\bpix\b/i.test(normalized);

  if (looksLikeInstallmentText && !looksLikePromotionText) {
    return undefined;
  }

  return normalized;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractMetaContentBySelector(html: string, selector: HtmlMetaSelector) {
  const escapedAttribute = escapeRegex(selector.attribute);
  const escapedValue = escapeRegex(selector.value);
  const patterns = [
    new RegExp(
      `<meta\\b[^>]*\\b${escapedAttribute}\\s*=\\s*["']${escapedValue}["'][^>]*\\bcontent\\s*=\\s*["']([^"']+)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta\\b[^>]*\\bcontent\\s*=\\s*["']([^"']+)["'][^>]*\\b${escapedAttribute}\\s*=\\s*["']${escapedValue}["'][^>]*>`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) {
      continue;
    }

    const content = normalizeHtmlText(match[1]);
    if (content.length > 0) {
      return content;
    }
  }

  return undefined;
}

function extractFirstMetaContent(html: string, selectors: HtmlMetaSelector[]) {
  for (const selector of selectors) {
    const content = extractMetaContentBySelector(html, selector);
    if (content !== undefined) {
      return content;
    }
  }

  return undefined;
}

function extractTitleFromHtml(html: string) {
  const fromMeta = extractFirstMetaContent(html, [
    { attribute: "property", value: "og:title" },
    { attribute: "name", value: "twitter:title" },
    { attribute: "itemprop", value: "name" },
    { attribute: "itemprop", value: "headline" },
  ]);
  if (fromMeta) {
    return fromMeta;
  }

  const headingMatch = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (headingMatch) {
    const heading = normalizeHtmlText(headingMatch[1]);
    if (heading.length > 0) {
      return heading;
    }
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const title = normalizeHtmlText(titleMatch[1]);
    if (title.length > 0) {
      return title;
    }
  }

  return "";
}

function extractDescriptionFromHtml(html: string) {
  return (
    extractFirstMetaContent(html, [
      { attribute: "property", value: "og:description" },
      { attribute: "name", value: "description" },
      { attribute: "itemprop", value: "description" },
    ]) ?? ""
  );
}

function extractPriceFieldFromHtml(html: string, fieldName: string) {
  const escapedFieldName = escapeRegex(fieldName);
  const patterns = [
    new RegExp(
      `"price"\\s*:\\s*\\{[\\s\\S]{0,240}?"${escapedFieldName}"\\s*:\\s*([0-9]+(?:[.,][0-9]+)?)`,
      "i",
    ),
    new RegExp(
      `"price"\\s*:\\s*\\{[\\s\\S]{0,240}?'${escapedFieldName}'\\s*:\\s*([0-9]+(?:[.,][0-9]+)?)`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) {
      continue;
    }

    const parsed = parseMoney(match[1]);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function extractPriceFromHtml(html: string) {
  const fromPriceObject =
    extractPriceFieldFromHtml(html, "value") ?? extractPriceFieldFromHtml(html, "amount");
  if (fromPriceObject !== undefined) {
    return fromPriceObject;
  }

  const fromMeta = extractFirstMetaContent(html, [
    { attribute: "itemprop", value: "price" },
    { attribute: "property", value: "product:price:amount" },
    { attribute: "property", value: "og:price:amount" },
  ]);
  const parsedFromMeta = parseMoney(fromMeta);
  if (parsedFromMeta !== undefined) {
    return parsedFromMeta;
  }

  const patterns = [
    /"price"\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i,
    /"priceAmount"\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) {
      continue;
    }

    const parsed = parseMoney(match[1]);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function extractImageFromHtml(html: string) {
  return (
    extractFirstMetaContent(html, [
      { attribute: "property", value: "og:image" },
      { attribute: "name", value: "twitter:image" },
      { attribute: "itemprop", value: "image" },
    ]) ?? ""
  );
}

function normalizeHost(hostname: string) {
  return hostname.trim().toLowerCase();
}

function isMercadoLivreHost(hostname: string) {
  const host = normalizeHost(hostname);
  if (host === "meli.la" || host.endsWith(".meli.la")) {
    return true;
  }

  if (host === "mercadolivre.com" || host.endsWith(".mercadolivre.com")) {
    return true;
  }

  if (host === "mercadolivre.com.br" || host.endsWith(".mercadolivre.com.br")) {
    return true;
  }

  return false;
}

function isSocialOrNonProductPath(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname.toLowerCase();
    return pathname.startsWith("/social/");
  } catch {
    return false;
  }
}

function normalizeUrlForCache(rawUrl: string) {
  const normalizedInput = sanitizeText(rawUrl);
  try {
    const parsed = new URL(normalizedInput);
    parsed.hash = "";
    return `url:${parsed.toString().toLowerCase()}`;
  } catch {
    return `url:${normalizedInput.toLowerCase()}`;
  }
}

function buildCatalogCacheKey(catalogProductId: string, officialStoreId?: number | null) {
  const normalizedCatalogProductId = sanitizeText(catalogProductId).toUpperCase();
  const normalizedOfficialStoreId =
    typeof officialStoreId === "number" && Number.isInteger(officialStoreId) && officialStoreId > 0
      ? officialStoreId
      : null;

  if (!normalizedCatalogProductId) {
    return null;
  }

  if (normalizedOfficialStoreId) {
    return `catalog:${normalizedCatalogProductId}:store:${normalizedOfficialStoreId}`;
  }

  return `catalog:${normalizedCatalogProductId}`;
}

function toItemId(value: string) {
  const match = value.match(ITEM_ID_REGEX);
  if (!match) {
    return null;
  }

  return `MLB${match[1]}`;
}

function extractItemIdFromText(rawText: string) {
  const text = sanitizeText(rawText);
  if (text.length === 0) {
    return null;
  }

  const directMatch = extractMercadoLivreItemId(text) ?? toItemId(text);
  if (directMatch) {
    return directMatch;
  }

  try {
    const decoded = decodeURIComponent(text);
    return extractMercadoLivreItemId(decoded) ?? toItemId(decoded);
  } catch {
    return null;
  }
}

function extractPreferredItemIdFromUrl(rawUrl: string) {
  return extractMercadoLivrePreferredItemIdFromUrl(rawUrl);
}

function pickMostFrequentItemId(candidates: string[]) {
  if (candidates.length === 0) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const itemId = extractItemIdFromText(candidate);
    if (!itemId) {
      continue;
    }
    counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return null;
  }

  let winner: string | null = null;
  let winnerCount = -1;
  for (const [itemId, count] of counts) {
    if (count > winnerCount) {
      winner = itemId;
      winnerCount = count;
    }
  }

  return winner;
}

function extractItemIdFromHtml(html: string) {
  for (const pattern of [
    /[?&]wid=(MLB[-_]?\d{6,})/gi,
    /"wid"\s*:\s*"?(MLB[-_]?\d{6,})"?/gi,
  ]) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      const itemId = extractItemIdFromText(match[1] ?? "");
      if (itemId) {
        return itemId;
      }
    }
  }

  const explicitPatterns = [
    /"item_id"\s*:\s*"?(MLB[-_]?\d{6,})"?/gi,
    /"itemId"\s*:\s*"?(MLB[-_]?\d{6,})"?/gi,
    /"target_item_id"\s*:\s*"?(MLB[-_]?\d{6,})"?/gi,
  ];

  const explicitCandidates: string[] = [];
  for (const pattern of explicitPatterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        explicitCandidates.push(match[1]);
      }
    }
  }

  const explicitWinner = pickMostFrequentItemId(explicitCandidates);
  if (explicitWinner) {
    return explicitWinner;
  }

  const allCandidates = Array.from(html.matchAll(/MLB[-_]?\d{6,}/gi)).map((match) => match[0]);
  return pickMostFrequentItemId(allCandidates);
}

function normalizeHtmlUrlCandidate(value: string) {
  return decodeEscapedText(value).replace(/&amp;/gi, "&").trim();
}

function extractCanonicalUrlFromHtml(html: string) {
  const patterns = [
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) {
      continue;
    }

    const candidate = normalizeHtmlUrlCandidate(match[1]);
    if (candidate.length > 0) {
      return candidate;
    }
  }

  return null;
}

function toAbsoluteMercadoLivreUrl(candidate: string, baseUrl: string) {
  const normalizedCandidate = normalizeHtmlUrlCandidate(candidate);
  if (normalizedCandidate.length === 0) {
    return null;
  }

  try {
    const candidateWithProtocol =
      /^(?:www\.)?(?:meli\.la|(?:[\w-]+\.)*mercadolivre\.[a-z.]+)(?:\/|$)/i.test(
        normalizedCandidate,
      )
        ? `https://${normalizedCandidate.replace(/^\/+/, "")}`
        : normalizedCandidate;

    const parsed = new URL(candidateWithProtocol, baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    if (!isMercadoLivreHost(parsed.hostname)) {
      return null;
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function hasHtmlClasses(classValue: string, requiredClasses: string[]) {
  const classes = new Set(
    sanitizeText(classValue)
      .split(/\s+/)
      .filter((entry) => entry.length > 0),
  );

  return requiredClasses.every((requiredClass) => classes.has(requiredClass));
}

function extractAffiliateLandingProductUrl(html: string, baseUrl: string) {
  const anchorPattern = /<a\b([^>]*)>([\s\S]{0,800}?)<\/a>/gi;
  let fallbackCandidate: string | null = null;

  for (const match of html.matchAll(anchorPattern)) {
    const attributes = match[1] ?? "";
    const label = normalizeHtmlText(match[2]);
    const classValue = attributes.match(/\bclass\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    const matchesButtonLabel = /\bir para(?:\s+o)? produto\b/i.test(label);
    const matchesButtonClass = hasHtmlClasses(classValue, [
      "poly-component__link",
      "poly-component__link--action-link",
    ]);

    if (!matchesButtonLabel && !matchesButtonClass) {
      continue;
    }

    const href = attributes.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) {
      continue;
    }

    const candidate = toAbsoluteMercadoLivreUrl(href, baseUrl);
    if (!candidate || isSocialOrNonProductPath(candidate)) {
      continue;
    }

    if (matchesButtonClass && matchesButtonLabel) {
      return candidate;
    }

    fallbackCandidate ??= candidate;
  }

  return fallbackCandidate;
}

function scoreSocialProductUrlCandidate(rawUrl: string, preferredItemId?: string) {
  let score = 0;

  try {
    const parsed = new URL(rawUrl);
    const path = parsed.pathname.toLowerCase();
    const queryAndHash = `${parsed.search.toLowerCase()}${parsed.hash.toLowerCase()}`;

    if (path.includes("/up/")) {
      score += 6;
    }
    if (path.startsWith("/p/")) {
      score += 3;
    }
    if (/\/mlb[-_]?\d{6,}/i.test(parsed.pathname)) {
      score += 3;
    }
    if (queryAndHash.includes("pdp_filters=item_id")) {
      score += 3;
    }
    if (queryAndHash.includes("wid=mlb")) {
      score += 2;
    }

    if (parsed.hostname.startsWith("www.mercadolivre.")) {
      score += 1;
    }
    if (parsed.hostname.startsWith("produto.mercadolivre.")) {
      score += 1;
    }
  } catch {
    // Keep score as-is.
  }

  const normalizedPreferredItemId = sanitizeText(preferredItemId).toUpperCase();
  if (normalizedPreferredItemId.length > 0) {
    const upperUrl = rawUrl.toUpperCase();
    if (upperUrl.includes(normalizedPreferredItemId)) {
      score += 10;
    }
    if (
      upperUrl.includes(`ITEM_ID%3A${normalizedPreferredItemId}`) ||
      upperUrl.includes(`ITEM_ID:${normalizedPreferredItemId}`)
    ) {
      score += 6;
    }
    if (upperUrl.includes(`WID=${normalizedPreferredItemId}`)) {
      score += 4;
    }
  }

  return score;
}

function extractProductUrlFromSocialHtml(
  html: string,
  baseUrl: string,
  preferredItemId?: string,
) {
  const patterns = [
    /https:\\\/\\\/[^"'<>\s]+/gi,
    /https:\/\/[^"'<>\s]+/gi,
    /\/\/[^"'<>\s]+/gi,
  ];

  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      const normalizedUrl = toAbsoluteMercadoLivreUrl(match[0], baseUrl);
      if (!normalizedUrl || isSocialOrNonProductPath(normalizedUrl)) {
        continue;
      }

      if (seen.has(normalizedUrl)) {
        continue;
      }

      seen.add(normalizedUrl);
      candidates.push(normalizedUrl);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  let winner: string | null = null;
  let winnerScore = -1;

  for (const candidate of candidates) {
    const score = scoreSocialProductUrlCandidate(candidate, preferredItemId);
    if (score > winnerScore) {
      winner = candidate;
      winnerScore = score;
    }
  }

  return winner ?? candidates[0] ?? null;
}

function extractSocialHtmlBlock(html: string, preferredItemId?: string) {
  const normalizedPreferredItemId = sanitizeText(preferredItemId).toUpperCase();
  if (normalizedPreferredItemId.length === 0) {
    return html;
  }

  const pattern = new RegExp(`${escapeRegex(normalizedPreferredItemId)}[\\s\\S]{0,6000}`, "i");
  const match = html.match(pattern);
  return match?.[0] ?? html;
}

function extractSocialProductUrlFromBlock(block: string, baseUrl: string) {
  const patterns = [
    /"action_links"\s*:\s*\[[\s\S]{0,1200}?"id"\s*:\s*"show_product"[\s\S]{0,400}?"url"\s*:\s*"([^"]+)"/i,
    /"url"\s*:\s*"([^"]+)"/i,
  ];

  for (const pattern of patterns) {
    const match = block.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const candidate = toAbsoluteMercadoLivreUrl(match[1], baseUrl);
    if (candidate && !isSocialOrNonProductPath(candidate)) {
      return candidate;
    }
  }

  return null;
}

function extractSocialPriceValue(
  block: string,
  priceKey: "current_price" | "previous_price",
) {
  const pattern = new RegExp(
    `"${priceKey}"\\s*:\\s*\\{[\\s\\S]{0,200}?"value"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`,
    "i",
  );
  const match = block.match(pattern);
  return parseMoney(match?.[1]);
}

function extractSocialTitle(block: string) {
  const match = block.match(/"title"\s*:\s*\{[\s\S]{0,240}?"text"\s*:\s*"([^"]+)"/i);
  const title = normalizeHtmlText(match?.[1]);
  return title.length > 0 ? title : undefined;
}

function extractLabelTextByKey(block: string, labelKey: string) {
  const pattern = new RegExp(
    `"${escapeRegex(labelKey)}"\\s*:\\s*\\{[\\s\\S]{0,320}?"text"\\s*:\\s*"([^"]+)"`,
    "i",
  );
  return normalizePromotionLabel(block.match(pattern)?.[1]);
}

function extractPromotionLabelFromHtml(html: string) {
  const patterns = [
    /"discount_label"\s*:\s*\{[\s\S]{0,320}?"text"\s*:\s*"([^"]+)"/i,
    /"coupon_label"\s*:\s*\{[\s\S]{0,320}?"text"\s*:\s*"([^"]+)"/i,
    /"promotion_name"\s*:\s*"([^"]{1,160})"/i,
  ];

  for (const pattern of patterns) {
    const label = normalizePromotionLabel(html.match(pattern)?.[1]);
    if (label) {
      return label;
    }
  }

  return undefined;
}

function extractSocialImageUrl(block: string) {
  const pictureId = sanitizeText(
    block.match(/"pictures"\s*:\s*\{[\s\S]{0,320}?"id"\s*:\s*"([^"]+)"/i)?.[1],
  );
  if (pictureId.length === 0) {
    return undefined;
  }

  return `https://http2.mlstatic.com/D_NQ_NP_${pictureId}-O.webp`;
}

function normalizeSocialDescription(description: string) {
  const normalized = sanitizeText(description);
  return /encontre todos os produtos/i.test(normalized) ? "" : normalized;
}

function extractProductFromSocialHtml(
  html: string,
  finalUrl: string,
  preferredItemId?: string,
): ScrapedPageData | null {
  const block = extractSocialHtmlBlock(html, preferredItemId);
  const productUrl =
    extractSocialProductUrlFromBlock(block, finalUrl) ??
    extractProductUrlFromSocialHtml(html, finalUrl, preferredItemId);
  const title = extractSocialTitle(block) ?? extractTitleFromHtml(html);
  const price =
    extractSocialPriceValue(block, "current_price") ??
    extractPriceFromHtml(block) ??
    extractPriceFromHtml(html);

  if (!productUrl || title.length === 0 || price === undefined) {
    if (preferredItemId) {
      return extractProductFromSocialHtml(html, finalUrl);
    }

    return null;
  }

  const originalPrice = extractSocialPriceValue(block, "previous_price");
  const discount = calculateDiscount(price, originalPrice);
  const couponLabel =
    extractLabelTextByKey(block, "discount_label") ??
    extractLabelTextByKey(block, "coupon_label") ??
    extractPromotionLabelFromHtml(html);
  const image = extractSocialImageUrl(block) ?? extractImageFromHtml(html) ?? "";
  const images = image ? [image] : [];
  const description = normalizeSocialDescription(extractDescriptionFromHtml(html));
  const itemId =
    extractItemIdFromText(productUrl) ??
    extractItemIdFromText(block) ??
    (sanitizeText(preferredItemId).length > 0 ? preferredItemId : undefined);
  const resolvedProductUrl = withPreferredItemIdOnUrl(productUrl, itemId);

  return {
    itemId,
    finalUrl,
    product: {
      title,
      price,
      originalPrice,
      discount,
      hasCouponOrDiscount:
        Boolean(discount && discount > 0) ||
        Boolean(couponLabel) ||
        /"discount_label"/i.test(block),
      couponLabel,
      image,
      images,
      description,
      link: resolvedProductUrl,
      marketplace: "mercadolivre",
    },
  };
}

function parseMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalizedValue = String(value).trim();
  if (normalizedValue.length === 0) {
    return undefined;
  }

  let numericValue: number;
  if (typeof value === "number") {
    numericValue = value;
  } else {
    const moneyLikeValue = normalizedValue.replace(/[^\d,.\-]/g, "");
    if (moneyLikeValue.length === 0) {
      return undefined;
    }

    const hasComma = moneyLikeValue.includes(",");
    const hasDot = moneyLikeValue.includes(".");
    let candidate = moneyLikeValue;

    if (hasComma && hasDot) {
      const commaIndex = moneyLikeValue.lastIndexOf(",");
      const dotIndex = moneyLikeValue.lastIndexOf(".");
      if (commaIndex > dotIndex) {
        candidate = moneyLikeValue.replace(/\./g, "").replace(",", ".");
      } else {
        candidate = moneyLikeValue.replace(/,/g, "");
      }
    } else if (hasComma) {
      candidate = moneyLikeValue.replace(",", ".");
    }

    numericValue = Number(candidate);
  }

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return undefined;
  }
  return Number(numericValue);
}

function calculateDiscount(price: number, originalPrice: number | undefined) {
  if (originalPrice === undefined || originalPrice <= price || originalPrice <= 0) {
    return undefined;
  }

  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

function withTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

function readCache(key: string) {
  const cached = productCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt < Date.now()) {
    productCache.delete(key);
    return null;
  }

  return cached.data;
}

function writeCache(keys: string[], data: MercadoLivreFetchedProduct) {
  const entry: CacheEntry = {
    data,
    expiresAt: Date.now() + MERCADO_LIVRE_CACHE_TTL_MS,
  };

  for (const key of keys) {
    if (key.trim().length > 0) {
      productCache.set(key, entry);
    }
  }
}

function validateFetchedProductIntegrity(
  product: MercadoLivreFetchedProduct,
  context: {
    originalUrl: string;
    resolvedUrl?: string;
    expectedItemId?: string | null;
    returnedItemId?: string | null;
    source: string;
  },
) {
  const hasImage =
    sanitizeText(product.image).length > 0 ||
    product.images.some((imageUrl) => sanitizeText(imageUrl).length > 0);

  if (
    sanitizeText(product.title).length === 0 ||
    !Number.isFinite(product.price) ||
    product.price <= 0 ||
    sanitizeText(product.link).length === 0 ||
    !hasImage
  ) {
    throw new ProductLookupError("Dados do produto invalido.", 422);
  }

  const mismatchReason = getMercadoLivreProductMismatchReason({
    expectedItemId: context.expectedItemId,
    returnedItemId: context.returnedItemId,
    permalink: product.link,
  });

  if (mismatchReason) {
    throw new ProductLookupError(mismatchReason, 409);
  }
}

function readValidatedCache(
  key: string,
  context: {
    originalUrl: string;
    resolvedUrl?: string;
    expectedItemId?: string | null;
  },
) {
  const cached = readCache(key);
  if (!cached) {
    return null;
  }

  try {
    validateFetchedProductIntegrity(cached, {
      ...context,
      source: `cache:${key}`,
    });
    logMercadoLivreLookup("cache-hit", {
      key,
      linkOriginal: context.originalUrl,
      linkResolvido: context.resolvedUrl ?? cached.link,
      idProduto: context.expectedItemId ?? undefined,
      produtoFinal: {
        title: cached.title,
        price: cached.price,
        link: cached.link,
      },
    });
    return cached;
  } catch (error) {
    productCache.delete(key);
    logMercadoLivreLookup("cache-invalidated", {
      key,
      linkOriginal: context.originalUrl,
      linkResolvido: context.resolvedUrl ?? cached.link,
      idProduto: context.expectedItemId ?? undefined,
      motivo: error instanceof Error ? error.message : "cache-invalido",
    });
    return null;
  }
}

function finalizeFetchedProduct(
  product: MercadoLivreFetchedProduct,
  context: {
    originalUrl: string;
    resolvedUrl?: string;
    expectedItemId?: string | null;
    returnedItemId?: string | null;
    source: string;
    apiResponse?: Record<string, unknown>;
  },
) {
  validateFetchedProductIntegrity(product, context);

  logMercadoLivreLookup("lookup-success", {
    source: context.source,
    linkOriginal: context.originalUrl,
    linkResolvido: context.resolvedUrl ?? product.link,
    idProduto: context.expectedItemId ?? context.returnedItemId ?? undefined,
    respostaApi: context.apiResponse,
    produtoFinal: {
      title: product.title,
      price: product.price,
      link: product.link,
      image: product.image || product.images[0] || "",
    },
  });

  return product;
}

async function fetchPageWithBrowserHeaders(rawUrl: string) {
  const { signal, clear } = withTimeoutSignal(MERCADO_LIVRE_TIMEOUT_MS);

  try {
    const response = await fetch(rawUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal,
      headers: BROWSER_HEADERS,
    });

    const html = await response.text().catch(() => "");
    return {
      status: response.status,
      finalUrl: response.url,
      html,
    };
  } finally {
    clear();
  }
}

async function resolveItemIdFromUrl(rawUrl: string) {
  const catalogProductId = extractMercadoLivreCatalogProductIdFromUrl(rawUrl);
  const normalizeResolvedItemCandidate = (value: string | null | undefined) => {
    const itemId = extractItemIdFromText(value ?? "");
    if (!itemId) {
      return null;
    }

    if (catalogProductId && itemId === catalogProductId) {
      return null;
    }

    return itemId;
  };
  const preferredItemId = extractPreferredItemIdFromUrl(rawUrl);
  if (preferredItemId) {
    return preferredItemId;
  }

  const itemIdFromRaw = catalogProductId ? null : normalizeResolvedItemCandidate(rawUrl);
  if (itemIdFromRaw) {
    return itemIdFromRaw;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, 400);
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, 400);
  }

  if (!isMercadoLivreHost(parsedUrl.hostname)) {
    throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, 400);
  }

  const itemIdFromPath = catalogProductId
    ? null
    : normalizeResolvedItemCandidate(`${parsedUrl.pathname}${parsedUrl.search}`);
  if (itemIdFromPath) {
    return itemIdFromPath;
  }

  const { signal, clear } = withTimeoutSignal(MERCADO_LIVRE_TIMEOUT_MS);
  try {
    const redirectResponse = await fetch(parsedUrl.toString(), {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal,
      headers: BROWSER_HEADERS,
    });

    const location = redirectResponse.headers.get("location");
    if (location) {
      const absoluteLocation = new URL(location, parsedUrl).toString();
      const itemIdFromLocation = normalizeResolvedItemCandidate(absoluteLocation);
      if (itemIdFromLocation) {
        return itemIdFromLocation;
      }
    }
  } catch (error) {
    if (error instanceof ProductLookupError) {
      throw error;
    }
    // Continue with full-page fallback.
  } finally {
    clear();
  }

  const page = await fetchPageWithBrowserHeaders(parsedUrl.toString());
  const itemIdFromFinalUrl = normalizeResolvedItemCandidate(page.finalUrl);
  if (itemIdFromFinalUrl) {
    return itemIdFromFinalUrl;
  }

  const canonicalUrl = extractCanonicalUrlFromHtml(page.html);
  const landingProductUrl = extractAffiliateLandingProductUrl(
    page.html,
    canonicalUrl ?? page.finalUrl ?? rawUrl,
  );
  if (
    landingProductUrl &&
    normalizeUrlForCache(landingProductUrl) !== normalizeUrlForCache(page.finalUrl || rawUrl)
  ) {
    try {
      return await resolveItemIdFromUrl(landingProductUrl);
    } catch {
      // Continue with the original page heuristics below.
    }
  }

  const itemIdFromCanonical = normalizeResolvedItemCandidate(canonicalUrl ?? "");
  if (itemIdFromCanonical) {
    return itemIdFromCanonical;
  }

  const jsonLdProduct = findJsonLdProduct(page.html);
  const itemIdFromJsonLd = normalizeResolvedItemCandidate(
    extractItemIdFromJsonLdProduct(jsonLdProduct),
  );
  if (itemIdFromJsonLd) {
    return itemIdFromJsonLd;
  }

  const itemIdFromHtml = normalizeResolvedItemCandidate(extractItemIdFromHtml(page.html));
  if (itemIdFromHtml) {
    return itemIdFromHtml;
  }

  if (
    isSocialOrNonProductPath(page.finalUrl) ||
    (canonicalUrl && isSocialOrNonProductPath(canonicalUrl))
  ) {
    throw new ProductLookupError(PRODUCT_NOT_ITEM_LINK_MESSAGE, 422);
  }

  throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, 400);
}

function mapImages(payload: MercadoLivreItemPayload) {
  const pictureUrls = (payload.pictures ?? [])
    .map((picture) => sanitizeText(picture.secure_url ?? picture.url))
    .filter((imageUrl) => imageUrl.length > 0);

  const thumbnail = sanitizeText(payload.thumbnail);
  const allImages = thumbnail.length > 0 ? [thumbnail, ...pictureUrls] : pictureUrls;

  return Array.from(new Set(allImages));
}

async function fetchItemDescription(itemId: string) {
  try {
    const response = await fetchMercadoLivreApiResponse(`/items/${itemId}/description`);

    if (!response || !response.ok) {
      return "";
    }

    const payload = (await response.json().catch(() => null)) as MercadoLivreDescriptionPayload | null;
    return sanitizeText(payload?.plain_text ?? payload?.text);
  } catch {
    return "";
  }
}

async function fetchSellerName(sellerId: number | undefined) {
  if (!sellerId || !Number.isFinite(sellerId)) {
    return undefined;
  }

  try {
    const response = await fetchMercadoLivreApiResponse(`/users/${sellerId}`);

    if (!response || !response.ok) {
      return undefined;
    }

    const payload = (await response.json().catch(() => null)) as MercadoLivreSellerPayload | null;
    const nickname = sanitizeText(payload?.nickname);
    return nickname.length > 0 ? nickname : undefined;
  } catch {
    return undefined;
  }
}

function hasCouponTag(tags: string[] | undefined) {
  return (tags ?? []).some((tag) => {
    const normalizedTag = tag.toLowerCase();
    return normalizedTag.includes("coupon") || normalizedTag.includes("promotion");
  });
}

function extractSalePriceAmount(
  salePrice: MercadoLivreItemPayload["sale_price"],
  price: number,
) {
  if (!salePrice || typeof salePrice !== "object") {
    return undefined;
  }

  const amount = salePrice.amount;
  if (!Number.isFinite(amount) || amount === undefined || amount < 0) {
    return undefined;
  }

  return Number(amount) < price ? Number(amount) : undefined;
}

async function fetchItemData(itemId: string) {
  try {
    const response = await fetchMercadoLivreApiResponse(`/items/${itemId}`);

    if (!response) {
      throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, 401);
    }

    if (!response.ok) {
      throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, response.status);
    }

    const payload = (await response.json().catch(() => null)) as MercadoLivreItemPayload | null;
    if (!payload) {
      throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, 404);
    }

    const returnedItemId = extractItemIdFromText(payload.id ?? "");
    const mismatchReason = getMercadoLivreProductMismatchReason({
      expectedItemId: itemId,
      returnedItemId,
      permalink: payload.permalink,
    });
    if (mismatchReason) {
      throw new ProductLookupError(mismatchReason, 409);
    }

    return payload;
  } catch (error) {
    if (error instanceof ProductLookupError) {
      throw error;
    }

    throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, 400);
  }
}

function mapImagesFromHtml(html: string) {
  const images = new Set<string>();
  const patterns = [
    /https:\\\/\\\/http2\.mlstatic\.com\\\/[^"'<>\\s]+?\.(?:jpg|jpeg|png|webp)/gi,
    /https:\/\/http2\.mlstatic\.com\/[^"'<>\\s]+?\.(?:jpg|jpeg|png|webp)/gi,
  ];

  for (const pattern of patterns) {
    const matches = html.match(pattern) ?? [];
    for (const match of matches) {
      const decoded = decodeEscapedText(match);
      if (decoded.length > 0) {
        images.add(decoded);
      }
      if (images.size >= 12) {
        break;
      }
    }
    if (images.size >= 12) {
      break;
    }
  }

  return Array.from(images);
}

function parseJsonLdProductCandidate(rawJsonLd: string) {
  const raw = sanitizeText(rawJsonLd);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const candidates: JsonLdProduct[] = [];
    const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== "object") {
        continue;
      }

      const graphValue = (current as { "@graph"?: unknown })["@graph"];
      if (Array.isArray(graphValue)) {
        queue.push(...graphValue);
      }

      candidates.push(current as JsonLdProduct);
    }

    const productCandidate = candidates.find((entry) => {
      const type = sanitizeText(entry["@type"]);
      return type.toLowerCase().includes("product") || Boolean(entry.name && entry.offers);
    });

    return productCandidate ?? null;
  } catch {
    return null;
  }
}

function extractRootAppHtmlSegment(html: string) {
  const rootAppMatch = html.match(/<main\b[^>]*\bid\s*=\s*["']root-app["'][^>]*>/i);
  if (!rootAppMatch || rootAppMatch.index === undefined) {
    return null;
  }

  const rootAppHtml = html.slice(rootAppMatch.index);
  const closingMainMatch = rootAppHtml.match(/<\/main>/i);
  if (!closingMainMatch || closingMainMatch.index === undefined) {
    return rootAppHtml;
  }

  return rootAppHtml.slice(0, closingMainMatch.index + closingMainMatch[0].length);
}

function findJsonLdProductInsideHtml(html: string) {
  const regex =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json(?:;[^"']*)?["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const productCandidate = parseJsonLdProductCandidate(match[1] ?? "");
    if (productCandidate) {
      return productCandidate;
    }
  }

  return null;
}

function findJsonLdProduct(html: string) {
  const rootAppHtml = extractRootAppHtmlSegment(html);
  if (rootAppHtml) {
    const rootAppProduct = findJsonLdProductInsideHtml(rootAppHtml);
    if (rootAppProduct) {
      return rootAppProduct;
    }
  }

  return findJsonLdProductInsideHtml(html);
}

function extractOriginalPriceFromHtml(html: string, currentPrice: number) {
  const fromPriceObject =
    extractPriceFieldFromHtml(html, "original_value") ??
    extractPriceFieldFromHtml(html, "originalValue");
  if (fromPriceObject !== undefined && fromPriceObject > currentPrice) {
    return fromPriceObject;
  }

  const patterns = [
    /"original_price"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i,
    /"originalPrice"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) {
      continue;
    }

    const parsed = parseMoney(match[1]);
    if (parsed !== undefined && parsed > currentPrice) {
      return parsed;
    }
  }

  return undefined;
}

function extractSellerNameFromHtml(html: string) {
  const pattern = /"seller_name":"([^"]+)"/i;
  const match = html.match(pattern);
  if (!match) {
    return undefined;
  }

  const decoded = decodeEscapedText(match[1]);
  return decoded.length > 0 ? decoded : undefined;
}

function extractSupplierNameFromAttributes(
  attributes: MercadoLivreAttributePayload[] | undefined,
) {
  for (const attribute of attributes ?? []) {
    const identifier = sanitizeText(attribute.id).toUpperCase();
    const attributeName = sanitizeText(attribute.name).toLowerCase();
    const looksLikeSupplierField =
      identifier === "BRAND" ||
      attributeName.includes("marca") ||
      attributeName.includes("fabricante");

    if (!looksLikeSupplierField) {
      continue;
    }

    const valueName =
      sanitizeText(attribute.value_name) ||
      sanitizeText(attribute.values?.[0]?.name);

    if (valueName.length > 0) {
      return valueName;
    }
  }

  return undefined;
}

function extractOfferFromJsonLd(offers: JsonLdOffer | undefined) {
  if (!offers) {
    return undefined;
  }

  const normalizedOffers = Array.isArray(offers) ? offers : [offers];
  for (const offer of normalizedOffers) {
    const price = parseMoney(offer.price);
    if (price !== undefined) {
      return {
        price,
        url: sanitizeText(offer.url),
      };
    }
  }

  return undefined;
}

function extractItemIdFromJsonLdProduct(jsonLdProduct: JsonLdProduct | null) {
  if (!jsonLdProduct) {
    return null;
  }

  const fromSku = extractItemIdFromText(sanitizeText(jsonLdProduct.sku));
  if (fromSku) {
    return fromSku;
  }

  const fromProductId = extractItemIdFromText(sanitizeText(jsonLdProduct.productID));
  if (fromProductId) {
    return fromProductId;
  }

  const fromOffer = extractItemIdFromText(sanitizeText(extractOfferFromJsonLd(jsonLdProduct.offers)?.url));
  if (fromOffer) {
    return fromOffer;
  }

  return null;
}

async function scrapeProductFromPage(
  rawUrl: string,
  options?: {
    allowSocialFallback?: boolean;
  },
): Promise<ScrapedPageData> {
  const allowSocialFallback = options?.allowSocialFallback ?? true;
  const page = await fetchPageWithBrowserHeaders(rawUrl);
  if (!page.html) {
    throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, 404);
  }

  const canonicalUrl = extractCanonicalUrlFromHtml(page.html);
  const landingProductUrl = extractAffiliateLandingProductUrl(
    page.html,
    canonicalUrl ?? page.finalUrl ?? rawUrl,
  );

  const isSocialLink =
    isSocialOrNonProductPath(page.finalUrl) ||
    (canonicalUrl && isSocialOrNonProductPath(canonicalUrl));
  if (isSocialLink && allowSocialFallback) {
    const socialItemId = extractItemIdFromHtml(page.html) ?? undefined;
    const socialProductUrl =
      landingProductUrl ??
      extractProductUrlFromSocialHtml(
        page.html,
        canonicalUrl ?? page.finalUrl ?? rawUrl,
        socialItemId,
      );

    if (
      socialProductUrl &&
      normalizeUrlForCache(socialProductUrl) !== normalizeUrlForCache(page.finalUrl || rawUrl)
    ) {
      try {
        return await scrapeProductFromPage(socialProductUrl, {
          allowSocialFallback: false,
        });
      } catch {
        // Fallback to the social landing payload when the product page is blocked.
      }
    }

    const socialProduct = extractProductFromSocialHtml(
      page.html,
      page.finalUrl || rawUrl,
      socialItemId,
    );
    if (socialProduct) {
      return socialProduct;
    }

    if (socialItemId) {
      return scrapeProductFromPage(buildProductUrlFromItemId(socialItemId), {
        allowSocialFallback: false,
      });
    }
  }

  if (isSocialLink) {
    throw new ProductLookupError(PRODUCT_NOT_ITEM_LINK_MESSAGE, 422);
  }

  if (
    landingProductUrl &&
    normalizeUrlForCache(landingProductUrl) !== normalizeUrlForCache(page.finalUrl || rawUrl)
  ) {
    return scrapeProductFromPage(landingProductUrl, options);
  }

  const jsonLdProduct = findJsonLdProduct(page.html);
  const title =
    sanitizeText(jsonLdProduct?.name) ||
    extractTitleFromHtml(page.html);
  const description =
    sanitizeText(jsonLdProduct?.description) ||
    extractDescriptionFromHtml(page.html);
  const offer = extractOfferFromJsonLd(jsonLdProduct?.offers);
  const htmlPrice = extractPriceFromHtml(page.html);
  const price = htmlPrice ?? offer?.price;

  if (title.length === 0 || price === undefined) {
    throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, 404);
  }

  const jsonLdImages = Array.isArray(jsonLdProduct?.image)
    ? jsonLdProduct.image
    : jsonLdProduct?.image
      ? [jsonLdProduct.image]
      : [];
  const metaImage = extractImageFromHtml(page.html);

  const mergedImages = Array.from(
    new Set([
      ...jsonLdImages.map((entry) => sanitizeText(entry)),
      ...(metaImage ? [metaImage] : []),
      ...mapImagesFromHtml(page.html),
    ]),
  ).filter((entry) => entry.length > 0);

  const image = mergedImages[0] ?? "";
  const originalPrice =
    extractOriginalPriceFromHtml(page.html, price) ??
    (offer?.price !== undefined && offer.price > price ? offer.price : undefined);
  const discount = calculateDiscount(price, originalPrice);
  const couponLabel = extractPromotionLabelFromHtml(page.html);
  const hasPromotionFromHtml =
    Boolean(couponLabel) ||
    /"available_promotions"\s*:\s*\[/i.test(page.html) ||
    /\bcoupon\b/i.test(page.html) ||
    /\bcupon\b/i.test(page.html);

  const sellerFromHtml = extractSellerNameFromHtml(page.html);
  const sellerFromJsonLd =
    typeof jsonLdProduct?.brand === "string"
      ? sanitizeText(jsonLdProduct.brand)
      : sanitizeText(jsonLdProduct?.brand?.name);
  const seller = sellerFromHtml ?? (sellerFromJsonLd.length > 0 ? sellerFromJsonLd : undefined);

  const productLink = sanitizeText(offer?.url) || canonicalUrl || page.finalUrl || rawUrl;
  const itemId =
    extractItemIdFromJsonLdProduct(jsonLdProduct) ??
    extractItemIdFromText(productLink) ??
    extractItemIdFromText(page.finalUrl) ??
    extractItemIdFromText(canonicalUrl ?? "") ??
    extractItemIdFromHtml(page.html) ??
    undefined;
  const resolvedProductLink = withPreferredItemIdOnUrl(productLink, itemId);

  return {
    itemId,
    finalUrl: page.finalUrl,
    product: {
      title,
      price,
      originalPrice,
      discount,
      couponLabel,
      hasCouponOrDiscount: Boolean(discount && discount > 0) || hasPromotionFromHtml,
      image,
      images: mergedImages,
      description,
      link: resolvedProductLink,
      canonicalLink:
        sanitizeText(canonicalUrl ?? undefined) || sanitizeText(page.finalUrl) || undefined,
      marketplace: "mercadolivre",
      seller,
    },
  };
}

function ensureValidMercadoLivreUrl(rawUrl: string) {
  const itemId = extractItemIdFromText(rawUrl);
  if (itemId) {
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, 400);
  }

  if (!["http:", "https:"].includes(parsed.protocol) || !isMercadoLivreHost(parsed.hostname)) {
    throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, 400);
  }
}

function normalizeAffiliateLink(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    if (!isMercadoLivreHost(parsed.hostname)) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function withPreferredAffiliateLink(
  product: MercadoLivreFetchedProduct,
  preferredAffiliateLink: string | null,
): MercadoLivreFetchedProduct {
  if (!preferredAffiliateLink || product.link === preferredAffiliateLink) {
    return product;
  }

  return {
    ...product,
    canonicalLink: product.canonicalLink ?? product.link,
    link: preferredAffiliateLink,
  };
}

function buildProductUrlFromItemId(itemId: string) {
  return buildMercadoLivreItemUrl(itemId);
}

export async function fetchMercadoLivreProductByHtml(
  rawUrl: string,
): Promise<MercadoLivreFetchedProduct> {
  const productUrl = sanitizeText(rawUrl);
  if (productUrl.length === 0) {
    throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, 400);
  }

  ensureValidMercadoLivreUrl(productUrl);
  const preferredAffiliateLink = normalizeAffiliateLink(productUrl);
  const catalogProductId = extractMercadoLivreCatalogProductIdFromUrl(productUrl);
  const requestedOfficialStoreId = extractMercadoLivreOfficialStoreIdFromUrl(productUrl);
  const requestedItemId =
    extractPreferredItemIdFromUrl(productUrl) ??
    (catalogProductId ? null : extractItemIdFromText(productUrl));

  const urlCacheKey = normalizeUrlForCache(productUrl);
  logMercadoLivreLookup("lookup-start", {
    linkOriginal: productUrl,
    linkResolvido: productUrl,
    idProduto: requestedItemId ?? undefined,
    catalogProductId: catalogProductId ?? undefined,
  });

  const cachedByUrl = readValidatedCache(urlCacheKey, {
    originalUrl: productUrl,
    resolvedUrl: productUrl,
    expectedItemId: requestedItemId,
  });
  if (cachedByUrl) {
    return withPreferredAffiliateLink(cachedByUrl, preferredAffiliateLink);
  }

  const isAffiliateOrSocialSource =
    /https?:\/\/(?:[\w-]+\.)?meli\.la\//i.test(productUrl) || isSocialOrNonProductPath(productUrl);

  if (isAffiliateOrSocialSource) {
    try {
      const directProductUrl = await resolveDirectProductUrlFromAffiliateLanding(productUrl);
      if (directProductUrl) {
        logMercadoLivreLookup("link-resolved", {
          linkOriginal: productUrl,
          linkResolvido: directProductUrl,
          idProduto: extractItemIdFromText(directProductUrl) ?? requestedItemId ?? undefined,
        });
        const resolvedProduct = await fetchMercadoLivreProductByHtml(directProductUrl);
        writeCache([urlCacheKey, normalizeUrlForCache(directProductUrl)], resolvedProduct);
        return withPreferredAffiliateLink(resolvedProduct, preferredAffiliateLink);
      }
    } catch (error) {
      logMercadoLivreLookup("link-resolution-failed", {
        linkOriginal: productUrl,
        idProduto: requestedItemId ?? undefined,
        motivo: error instanceof Error ? error.message : "falha-ao-resolver-link",
      });
    }
  }

  let resolvedItemId: string | null = requestedItemId;
  try {
    resolvedItemId = resolvedItemId ?? (await resolveItemIdFromUrl(productUrl));
  } catch {
    resolvedItemId = resolvedItemId ?? null;
  }

  const catalogCacheKey = catalogProductId
    ? buildCatalogCacheKey(catalogProductId, requestedOfficialStoreId)
    : null;
  if (catalogCacheKey) {
    const cachedCatalogProduct = readValidatedCache(catalogCacheKey, {
      originalUrl: productUrl,
      resolvedUrl: productUrl,
      expectedItemId: resolvedItemId ?? requestedItemId,
    });
    if (cachedCatalogProduct) {
      writeCache([urlCacheKey], cachedCatalogProduct);
      return withPreferredAffiliateLink(cachedCatalogProduct, preferredAffiliateLink);
    }
  }

  if (resolvedItemId) {
    const itemCacheKey = `item:${resolvedItemId}`;
    const cachedByItem = readValidatedCache(itemCacheKey, {
      originalUrl: productUrl,
      resolvedUrl: productUrl,
      expectedItemId: resolvedItemId,
    });
    if (cachedByItem) {
      writeCache([urlCacheKey], cachedByItem);
      return withPreferredAffiliateLink(cachedByItem, preferredAffiliateLink);
    }

    try {
      const scrapedFromItemId = await scrapeProductFromPage(buildProductUrlFromItemId(resolvedItemId));
      const finalizedScrapedProduct = finalizeFetchedProduct(scrapedFromItemId.product, {
        originalUrl: productUrl,
        resolvedUrl: scrapedFromItemId.finalUrl,
        expectedItemId: resolvedItemId,
        returnedItemId: scrapedFromItemId.itemId ?? resolvedItemId,
        source: "html:item-url",
      });
      const cacheKeys = [
        urlCacheKey,
        itemCacheKey,
        normalizeUrlForCache(scrapedFromItemId.finalUrl),
        normalizeUrlForCache(finalizedScrapedProduct.link),
      ];
      if (catalogCacheKey) {
        cacheKeys.push(catalogCacheKey);
      }
      writeCache(cacheKeys, finalizedScrapedProduct);
      return withPreferredAffiliateLink(finalizedScrapedProduct, preferredAffiliateLink);
    } catch (error) {
      logMercadoLivreLookup("html-item-fallback", {
        linkOriginal: productUrl,
        linkResolvido: buildProductUrlFromItemId(resolvedItemId),
        idProduto: resolvedItemId,
        motivo: error instanceof Error ? error.message : "falha-html-item",
      });
    }
  }

  const scraped = await scrapeProductFromPage(productUrl);
  const finalizedScrapedProduct = finalizeFetchedProduct(scraped.product, {
    originalUrl: productUrl,
    resolvedUrl: scraped.finalUrl,
    expectedItemId: resolvedItemId ?? requestedItemId ?? undefined,
    returnedItemId: scraped.itemId ?? resolvedItemId ?? requestedItemId ?? undefined,
    source: "html:raw-url",
  });
  const cacheKeys = [
    urlCacheKey,
    normalizeUrlForCache(scraped.finalUrl),
    normalizeUrlForCache(finalizedScrapedProduct.link),
  ];
  if (catalogCacheKey) {
    cacheKeys.push(catalogCacheKey);
  }
  if (resolvedItemId) {
    cacheKeys.push(`item:${resolvedItemId}`);
  }
  if (scraped.itemId && scraped.itemId !== resolvedItemId) {
    cacheKeys.push(`item:${scraped.itemId}`);
  }
  writeCache(cacheKeys, finalizedScrapedProduct);
  return withPreferredAffiliateLink(finalizedScrapedProduct, preferredAffiliateLink);
}

function withPreferredItemIdOnUrl(rawUrl: string, preferredItemId?: string) {
  const normalizedPreferredItemId = sanitizeText(preferredItemId).toUpperCase();
  if (!normalizedPreferredItemId) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    const currentPreferredItemId =
      extractItemIdFromText(parsed.searchParams.get("wid") ?? "") ??
      extractItemIdFromText(parsed.searchParams.get("item_id") ?? "") ??
      extractItemIdFromText(parsed.searchParams.get("itemId") ?? "");

    if (currentPreferredItemId === normalizedPreferredItemId) {
      return parsed.toString();
    }

    parsed.searchParams.set("wid", normalizedPreferredItemId);
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export async function resolveDirectProductUrlFromAffiliateLanding(rawUrl: string) {
  const page = await fetchPageWithBrowserHeaders(rawUrl);
  if (!page.html) {
    return null;
  }

  const canonicalUrl = extractCanonicalUrlFromHtml(page.html);
  const landingProductUrl = extractAffiliateLandingProductUrl(
    page.html,
    canonicalUrl ?? page.finalUrl ?? rawUrl,
  );
  if (
    landingProductUrl &&
    normalizeUrlForCache(landingProductUrl) !== normalizeUrlForCache(page.finalUrl || rawUrl)
  ) {
    return landingProductUrl;
  }

  const isSocialLink =
    isSocialOrNonProductPath(page.finalUrl) ||
    (canonicalUrl && isSocialOrNonProductPath(canonicalUrl));

  if (!isSocialLink) {
    const resolvedProductUrl = canonicalUrl || page.finalUrl || rawUrl;
    if (normalizeUrlForCache(resolvedProductUrl) === normalizeUrlForCache(rawUrl)) {
      return null;
    }

    return resolvedProductUrl;
  }

  const socialItemId = extractItemIdFromHtml(page.html) ?? undefined;
  const socialProductUrl =
    extractProductUrlFromSocialHtml(
      page.html,
      canonicalUrl ?? page.finalUrl ?? rawUrl,
      socialItemId,
    ) ??
    (socialItemId ? buildProductUrlFromItemId(socialItemId) : null);

  if (!socialProductUrl) {
    return null;
  }

  if (normalizeUrlForCache(socialProductUrl) === normalizeUrlForCache(rawUrl)) {
    return null;
  }

  return withPreferredItemIdOnUrl(socialProductUrl, socialItemId);
}

function buildSearchTermsFromProductUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname
      .replace(/^\/+/, "")
      .replace(/\/+$/, "")
      .replace(/^MLB-\d+-/i, "")
      .replace(/-_JM$/i, "")
      .replace(/\/p\/MLB[-_]?\d+$/i, "")
      .replace(/\/up\/MLBU\d+$/i, "")
      .replace(/\bMLB[-_]?\d+\b/gi, "");

    const query = decodeURIComponent(pathname)
      .replace(/[-_/]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return query.length > 0 ? query : null;
  } catch {
    return null;
  }
}

function extractSearchTitleFromDescription(description: string) {
  const lines = description
    .split(/\r?\n/)
    .map((line) => sanitizeText(line.replace(/^\*+|\*+$/g, "")))
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const normalizedLine = normalizeSearchText(line);
    if (!normalizedLine) {
      continue;
    }

    if (
      normalizedLine.includes("nota fiscal") ||
      normalizedLine.includes("envio imediato") ||
      normalizedLine.includes("descricao do produto anunciado") ||
      normalizedLine.includes("descrição do produto anunciado")
    ) {
      continue;
    }

    if (line.length >= 12) {
      return line;
    }
  }

  return null;
}

function buildCompactSearchQuery(value: string) {
  const tokens = tokenizeSearchText(value);
  if (tokens.length === 0) {
    return null;
  }

  const eligibleTokens = tokens.filter((token) => {
    if (SEARCH_QUERY_STOPWORDS.has(token)) {
      return false;
    }

    if (/^\d+$/.test(token)) {
      return false;
    }

    return token.length >= 4;
  });

  const nonGenericTokens = eligibleTokens.filter((token) => !SEARCH_QUERY_GENERIC_TOKENS.has(token));
  const genericTokensFromTail = [...eligibleTokens]
    .reverse()
    .filter((token) => SEARCH_QUERY_GENERIC_TOKENS.has(token));

  const selectedTokens: string[] = [];
  for (const token of nonGenericTokens) {
    if (!selectedTokens.includes(token)) {
      selectedTokens.push(token);
    }
    if (selectedTokens.length >= 4) {
      break;
    }
  }

  for (const token of genericTokensFromTail) {
    if (!selectedTokens.includes(token)) {
      selectedTokens.push(token);
    }
    if (selectedTokens.length >= 4) {
      break;
    }
  }

  const compactQuery = selectedTokens.join(" ").trim();
  return compactQuery.length > 0 ? compactQuery : null;
}

function buildCatalogSearchQueries(rawUrl: string, descriptionHint?: string) {
  const queries = new Set<string>();
  const slugQuery = buildSearchTermsFromProductUrl(rawUrl);
  const descriptionTitle = descriptionHint ? extractSearchTitleFromDescription(descriptionHint) : null;

  for (const candidate of [descriptionTitle, slugQuery]) {
    const normalizedCandidate = sanitizeText(candidate ?? "");
    if (!normalizedCandidate) {
      continue;
    }

    queries.add(normalizedCandidate);

    const compactCandidate = buildCompactSearchQuery(normalizedCandidate);
    if (compactCandidate) {
      queries.add(compactCandidate);
    }
  }

  return Array.from(queries);
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearchText(value: string) {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 0);
}

function scoreCatalogSearchResult(query: string, productName: string) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedProductName = normalizeSearchText(productName);

  if (!normalizedQuery || !normalizedProductName) {
    return {
      score: 0,
      matchedTokens: 0,
      matchRatio: 0,
    };
  }

  const queryTokens = tokenizeSearchText(query).filter((token) => token.length > 2);
  if (queryTokens.length === 0) {
    return {
      score: 0,
      matchedTokens: 0,
      matchRatio: 0,
    };
  }

  let score = 0;
  let matchedTokens = 0;
  for (const token of queryTokens) {
    if (normalizedProductName.includes(token)) {
      matchedTokens += 1;
      score += SEARCH_QUERY_GENERIC_TOKENS.has(token) ? 1 : 3;
    }
  }

  if (normalizedProductName.includes(normalizedQuery)) {
    score += 8;
  }

  return {
    score,
    matchedTokens,
    matchRatio: matchedTokens / queryTokens.length,
  };
}

function getMercadoLivreClientId() {
  return sanitizeText(process.env.MERCADO_LIVRE_CLIENT_ID);
}

function getMercadoLivreClientSecret() {
  return sanitizeText(process.env.MERCADO_LIVRE_CLIENT_SECRET);
}

function getMercadoLivreRefreshToken() {
  return sanitizeText(process.env.MERCADO_LIVRE_REFRESH_TOKEN);
}

function hasMercadoLivreApiCredentials() {
  return (
    getMercadoLivreClientId().length > 0 &&
    getMercadoLivreClientSecret().length > 0 &&
    getMercadoLivreRefreshToken().length > 0
  );
}

async function getMercadoLivreAccessToken() {
  const configuredCredential = await ensureActiveMeliCredentialAccessToken().catch(() => null);
  const configuredAccessToken = sanitizeText(configuredCredential?.accessToken);
  if (configuredAccessToken.length > 0) {
    return configuredAccessToken;
  }

  if (!hasMercadoLivreApiCredentials()) {
    return null;
  }

  const now = Date.now();
  if (
    mercadoLivreAuthState.accessToken &&
    mercadoLivreAuthState.expiresAt &&
    mercadoLivreAuthState.expiresAt - 60_000 > now
  ) {
    return mercadoLivreAuthState.accessToken;
  }

  if (mercadoLivreAuthState.pendingTokenPromise) {
    return mercadoLivreAuthState.pendingTokenPromise;
  }

  mercadoLivreAuthState.pendingTokenPromise = (async () => {
    try {
      const { signal, clear } = withTimeoutSignal(MERCADO_LIVRE_TIMEOUT_MS);
      try {
        const response = await fetch(`${MERCADO_LIVRE_API_BASE}/oauth/token`, {
          method: "POST",
          cache: "no-store",
          signal,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: getMercadoLivreClientId(),
            client_secret: getMercadoLivreClientSecret(),
            refresh_token: getMercadoLivreRefreshToken(),
          }),
        });

        if (!response.ok) {
          mercadoLivreAuthState.accessToken = undefined;
          mercadoLivreAuthState.expiresAt = undefined;
          return null;
        }

        const payload = (await response.json().catch(() => null)) as
          | {
              access_token?: string;
              expires_in?: number;
            }
          | null;

        const accessToken = sanitizeText(payload?.access_token);
        if (!accessToken) {
          mercadoLivreAuthState.accessToken = undefined;
          mercadoLivreAuthState.expiresAt = undefined;
          return null;
        }

        const expiresInSeconds =
          typeof payload?.expires_in === "number" && Number.isFinite(payload.expires_in)
            ? payload.expires_in
            : 6 * 60 * 60;

        mercadoLivreAuthState.accessToken = accessToken;
        mercadoLivreAuthState.expiresAt = Date.now() + expiresInSeconds * 1000;
        return accessToken;
      } finally {
        clear();
      }
    } catch {
      mercadoLivreAuthState.accessToken = undefined;
      mercadoLivreAuthState.expiresAt = undefined;
      return null;
    } finally {
      mercadoLivreAuthState.pendingTokenPromise = undefined;
    }
  })();

  return mercadoLivreAuthState.pendingTokenPromise;
}

async function fetchMercadoLivreApiResponse(
  path: string,
  options?: {
    authRequired?: boolean;
  },
) {
  const requestUrl = `${MERCADO_LIVRE_API_BASE}${path}`;
  const { signal, clear } = withTimeoutSignal(MERCADO_LIVRE_TIMEOUT_MS);

  try {
    const execute = (accessToken?: string | null) =>
      fetch(requestUrl, {
        cache: "no-store",
        signal,
        headers: {
          Accept: "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });

    if (options?.authRequired) {
      const accessToken = await getMercadoLivreAccessToken();
      if (!accessToken) {
        return null;
      }

      return execute(accessToken);
    }

    const publicResponse = await execute();
    if (![401, 403].includes(publicResponse.status)) {
      return publicResponse;
    }

    const accessToken = await getMercadoLivreAccessToken();
    if (!accessToken) {
      return publicResponse;
    }

    return execute(accessToken);
  } finally {
    clear();
  }
}

function mapCatalogImages(payload: MercadoLivreCatalogProductPayload) {
  const images = (payload.pictures ?? [])
    .map((picture) => sanitizeText(picture.secure_url ?? picture.url))
    .filter((imageUrl) => imageUrl.length > 0);

  return Array.from(new Set(images));
}

function extractCatalogDescription(payload: MercadoLivreCatalogProductPayload) {
  const shortDescription = sanitizeText(
    payload.short_description?.content ?? payload.short_description?.text,
  );
  if (shortDescription.length > 0) {
    return shortDescription;
  }

  const mainFeatures = (payload.main_features ?? [])
    .map((feature) => sanitizeText(feature.text))
    .filter((feature) => feature.length > 0);

  return mainFeatures.join("\n");
}

function pickBestCatalogItem(
  payload: MercadoLivreCatalogProductPayload,
  itemsPayload: MercadoLivreCatalogItemsPayload,
  selectionFilters?: {
    officialStoreId?: number | null;
  },
) {
  const candidates = [
    ...(payload.buy_box_winner ? [payload.buy_box_winner] : []),
    ...(itemsPayload.results ?? []),
  ].filter(
    (item): item is MercadoLivreCatalogItemPayload =>
      Boolean(item?.item_id) && parseMoney(item.price) !== undefined,
  );

  if (candidates.length === 0) {
    return null;
  }

  const requestedOfficialStoreId =
    typeof selectionFilters?.officialStoreId === "number" &&
    Number.isInteger(selectionFilters.officialStoreId) &&
    selectionFilters.officialStoreId > 0
      ? selectionFilters.officialStoreId
      : undefined;
  const filteredCandidates = requestedOfficialStoreId
    ? candidates.filter((item) => item.official_store_id === requestedOfficialStoreId)
    : candidates;

  if (filteredCandidates.length === 0) {
    return null;
  }

  return [...filteredCandidates].sort((left, right) => {
    const leftPrice = parseMoney(left.price) ?? Number.MAX_SAFE_INTEGER;
    const rightPrice = parseMoney(right.price) ?? Number.MAX_SAFE_INTEGER;

    if (leftPrice !== rightPrice) {
      return leftPrice - rightPrice;
    }

    const leftFreeShipping = left.shipping?.free_shipping ? 1 : 0;
    const rightFreeShipping = right.shipping?.free_shipping ? 1 : 0;
    if (leftFreeShipping !== rightFreeShipping) {
      return rightFreeShipping - leftFreeShipping;
    }

    const leftOfficialStore = left.official_store_id ? 1 : 0;
    const rightOfficialStore = right.official_store_id ? 1 : 0;
    return rightOfficialStore - leftOfficialStore;
  })[0];
}

async function fetchCatalogProductData(catalogProductId: string) {
  const response = await fetchMercadoLivreApiResponse(`/products/${catalogProductId}`, {
    authRequired: true,
  });

  if (!response) {
    return null;
  }

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }

    throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, response.status);
  }

  return (await response.json().catch(() => null)) as MercadoLivreCatalogProductPayload | null;
}

async function fetchCatalogProductItems(catalogProductId: string) {
  const response = await fetchMercadoLivreApiResponse(`/products/${catalogProductId}/items`, {
    authRequired: true,
  });

  if (!response) {
    return null;
  }

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }

    throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, response.status);
  }

  return (await response.json().catch(() => null)) as MercadoLivreCatalogItemsPayload | null;
}

async function searchCatalogProducts(query: string) {
  const normalizedQuery = sanitizeText(query);
  if (!normalizedQuery) {
    return [];
  }

  const response = await fetchMercadoLivreApiResponse(
    `/products/search?site_id=MLB&q=${encodeURIComponent(normalizedQuery)}`,
    {
      authRequired: true,
    },
  );

  if (!response || !response.ok) {
    return [];
  }

  const payload = (await response.json().catch(() => null)) as MercadoLivreCatalogSearchPayload | null;
  return Array.isArray(payload?.results) ? payload.results : [];
}

async function fetchCatalogProductById(
  catalogProductId: string,
  selectionFilters?: {
    officialStoreId?: number | null;
  },
): Promise<MercadoLivreFetchedProduct | null> {
  if (!catalogProductId) {
    return null;
  }

  const [catalogProduct, catalogItems] = await Promise.all([
    fetchCatalogProductData(catalogProductId),
    fetchCatalogProductItems(catalogProductId),
  ]);

  if (!catalogProduct || !catalogItems) {
    return null;
  }

  const bestItem = pickBestCatalogItem(catalogProduct, catalogItems, selectionFilters);
  const title = sanitizeText(catalogProduct.name);
  const price = parseMoney(bestItem?.price);

  if (!bestItem?.item_id || title.length === 0 || price === undefined) {
    return null;
  }

  const [descriptionFromItem, sellerName] = await Promise.all([
    fetchItemDescription(bestItem.item_id),
    fetchSellerName(bestItem.seller_id),
  ]);

  const originalPrice = parseMoney(bestItem.original_price);
  const discount = calculateDiscount(price, originalPrice);
  const images = mapCatalogImages(catalogProduct);
  const description = descriptionFromItem || extractCatalogDescription(catalogProduct);
  const permalink =
    sanitizeText(catalogProduct.permalink) || buildMercadoLivreCatalogUrl(catalogProductId);
  const supplierName = extractSupplierNameFromAttributes(catalogProduct.attributes);
  const hasCouponOrDiscount =
    Boolean(discount && discount > 0) || hasCouponTag(bestItem.tags);

  return {
    title,
    price,
    originalPrice,
    discount,
    couponLabel: hasCouponTag(bestItem.tags) && !(discount && discount > 0) ? "Cupom ativo" : undefined,
    hasCouponOrDiscount,
    image: images[0] ?? "",
    images,
    description,
    link: permalink,
    marketplace: "mercadolivre",
    seller: sellerName ?? supplierName,
  };
}

async function searchCatalogProductBySlug(
  rawUrl: string,
  descriptionHint?: string,
): Promise<MercadoLivreFetchedProduct | null> {
  const queries = buildCatalogSearchQueries(rawUrl, descriptionHint);

  for (const query of queries) {
    const results = await searchCatalogProducts(query);
    if (results.length === 0) {
      continue;
    }

    const rankedResults = results
      .map((result) => ({
        result,
        ...scoreCatalogSearchResult(query, sanitizeText(result.name)),
      }))
      .filter((entry) => entry.score > 0)
      .filter((entry) => entry.matchedTokens >= 4 && (entry.matchRatio >= 0.6 || entry.score >= 8))
      .sort((left, right) => right.score - left.score)
      .slice(0, 6);

    for (const entry of rankedResults) {
      const catalogProductId = sanitizeText(entry.result.id ?? entry.result.catalog_product_id);
      if (!catalogProductId) {
        continue;
      }

      const catalogProduct = await fetchCatalogProductById(catalogProductId);
      if (catalogProduct) {
        return catalogProduct;
      }
    }
  }

  return null;
}

function mapApiResponseToProduct(
  item: MercadoLivreItemPayload,
  description: string,
  sellerName: string | undefined,
  expectedItemId?: string | null,
) {
  const title = sanitizeText(item.title);
  const price = parseMoney(item.price);
  const originalPrice = parseMoney(item.original_price);
  const discount = price === undefined ? undefined : calculateDiscount(price, originalPrice);
  const images = mapImages(item);
  const permalink = sanitizeText(item.permalink);
  const returnedItemId = extractItemIdFromText(item.id ?? "") ?? extractItemIdFromText(permalink);
  const salePriceAmount = price === undefined ? undefined : extractSalePriceAmount(item.sale_price, price);
  const hasCouponTagDetected = hasCouponTag(item.tags);
  const supplierName = extractSupplierNameFromAttributes(item.attributes);
  const couponLabel =
    discount === undefined && (salePriceAmount !== undefined || hasCouponTagDetected)
      ? "Cupom ativo"
      : undefined;
  const hasCouponOrDiscount =
    Boolean(discount && discount > 0) ||
    salePriceAmount !== undefined ||
    hasCouponTagDetected;

  if (title.length === 0 || price === undefined || permalink.length === 0) {
    throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, 404);
  }

  const mismatchReason = getMercadoLivreProductMismatchReason({
    expectedItemId,
    returnedItemId,
    permalink,
  });
  if (mismatchReason) {
    throw new ProductLookupError(mismatchReason, 409);
  }

  return {
    title,
    price,
    originalPrice,
    discount,
    couponLabel,
    hasCouponOrDiscount,
    image: images[0] ?? "",
    images,
    description,
    link: permalink,
    marketplace: "mercadolivre" as const,
    seller: sellerName ?? supplierName,
  };
}

export async function fetchMercadoLivreProductByUrl(rawUrl: string): Promise<MercadoLivreFetchedProduct> {
  const productUrl = sanitizeText(rawUrl);
  if (productUrl.length === 0) {
    throw new ProductLookupError(PRODUCT_LOOKUP_ERROR_MESSAGE, 400);
  }

  ensureValidMercadoLivreUrl(productUrl);
  const preferredAffiliateLink = normalizeAffiliateLink(productUrl);
  const catalogProductId = extractMercadoLivreCatalogProductIdFromUrl(productUrl);
  const requestedOfficialStoreId = extractMercadoLivreOfficialStoreIdFromUrl(productUrl);
  const requestedItemId =
    extractPreferredItemIdFromUrl(productUrl) ??
    (catalogProductId ? null : extractItemIdFromText(productUrl));

  const urlCacheKey = normalizeUrlForCache(productUrl);
  logMercadoLivreLookup("lookup-start", {
    linkOriginal: productUrl,
    linkResolvido: productUrl,
    idProduto: requestedItemId ?? undefined,
    catalogProductId: catalogProductId ?? undefined,
  });

  const cachedByUrl = readValidatedCache(urlCacheKey, {
    originalUrl: productUrl,
    resolvedUrl: productUrl,
    expectedItemId: requestedItemId,
  });
  if (cachedByUrl) {
    return withPreferredAffiliateLink(cachedByUrl, preferredAffiliateLink);
  }

  const isAffiliateOrSocialSource =
    /https?:\/\/(?:[\w-]+\.)?meli\.la\//i.test(productUrl) || isSocialOrNonProductPath(productUrl);

  if (isAffiliateOrSocialSource) {
    try {
      const directProductUrl = await resolveDirectProductUrlFromAffiliateLanding(productUrl);
      if (directProductUrl) {
        logMercadoLivreLookup("link-resolved", {
          linkOriginal: productUrl,
          linkResolvido: directProductUrl,
          idProduto: extractItemIdFromText(directProductUrl) ?? requestedItemId ?? undefined,
        });
        const resolvedProduct = await fetchMercadoLivreProductByUrl(directProductUrl);
        writeCache([urlCacheKey, normalizeUrlForCache(directProductUrl)], resolvedProduct);
        return withPreferredAffiliateLink(resolvedProduct, preferredAffiliateLink);
      }
    } catch (error) {
      logMercadoLivreLookup("link-resolution-failed", {
        linkOriginal: productUrl,
        idProduto: requestedItemId ?? undefined,
        motivo: error instanceof Error ? error.message : "falha-ao-resolver-link",
      });
    }
  }

  let resolvedItemId: string | null = requestedItemId;
  try {
    resolvedItemId = resolvedItemId ?? (await resolveItemIdFromUrl(productUrl));
  } catch {
    resolvedItemId = resolvedItemId ?? null;
  }

  if (catalogProductId) {
    const catalogCacheKey = buildCatalogCacheKey(catalogProductId, requestedOfficialStoreId);
    const cachedCatalogProduct = catalogCacheKey
      ? readValidatedCache(catalogCacheKey, {
          originalUrl: productUrl,
          resolvedUrl: productUrl,
          expectedItemId: resolvedItemId ?? requestedItemId,
        })
      : null;
    if (cachedCatalogProduct) {
      writeCache([urlCacheKey], cachedCatalogProduct);
      return withPreferredAffiliateLink(cachedCatalogProduct, preferredAffiliateLink);
    }
  }

  if (resolvedItemId) {
    const itemCacheKey = `item:${resolvedItemId}`;
    const cachedByItem = readValidatedCache(itemCacheKey, {
      originalUrl: productUrl,
      resolvedUrl: productUrl,
      expectedItemId: resolvedItemId,
    });
    if (cachedByItem) {
      writeCache([urlCacheKey], cachedByItem);
      return withPreferredAffiliateLink(cachedByItem, preferredAffiliateLink);
    }

    try {
      const item = await fetchItemData(resolvedItemId);
      const [description, sellerName] = await Promise.all([
        fetchItemDescription(resolvedItemId),
        fetchSellerName(item.seller_id),
      ]);

      const mapped = finalizeFetchedProduct(
        mapApiResponseToProduct(item, description, sellerName, resolvedItemId),
        {
          originalUrl: productUrl,
          resolvedUrl: sanitizeText(item.permalink) || productUrl,
          expectedItemId: resolvedItemId,
          returnedItemId: item.id ?? resolvedItemId,
          source: "api:item",
          apiResponse: {
            id: sanitizeText(item.id),
            title: sanitizeText(item.title),
            permalink: sanitizeText(item.permalink),
          },
        },
      );
      writeCache([urlCacheKey, itemCacheKey, normalizeUrlForCache(mapped.link)], mapped);
      return withPreferredAffiliateLink(mapped, preferredAffiliateLink);
    } catch (error) {
      const isShortOrSocialSource =
        /https?:\/\/(?:[\w-]+\.)?meli\.la\//i.test(productUrl) || isSocialOrNonProductPath(productUrl);

      if (
        error instanceof ProductLookupError &&
        [404, 409].includes(error.status) &&
        !catalogProductId &&
        !isShortOrSocialSource
      ) {
        throw error;
      }

      logMercadoLivreLookup("api-item-fallback", {
        linkOriginal: productUrl,
        linkResolvido: productUrl,
        idProduto: resolvedItemId,
        motivo: error instanceof Error ? error.message : "falha-api-item",
      });
    }

    try {
      const scrapedFromItemId = await scrapeProductFromPage(buildProductUrlFromItemId(resolvedItemId));
      const finalizedScrapedProduct = finalizeFetchedProduct(scrapedFromItemId.product, {
        originalUrl: productUrl,
        resolvedUrl: scrapedFromItemId.finalUrl,
        expectedItemId: resolvedItemId,
        returnedItemId: scrapedFromItemId.itemId ?? resolvedItemId,
        source: "scrape:item-url",
      });
      const cacheKeys = [
        urlCacheKey,
        `item:${resolvedItemId}`,
        normalizeUrlForCache(scrapedFromItemId.finalUrl),
        normalizeUrlForCache(finalizedScrapedProduct.link),
      ];
      writeCache(cacheKeys, finalizedScrapedProduct);
      return withPreferredAffiliateLink(finalizedScrapedProduct, preferredAffiliateLink);
    } catch {
      // Continue with raw URL scraping fallback.
    }
  }

  if (catalogProductId && !resolvedItemId) {
    try {
      const catalogProduct = await fetchCatalogProductById(catalogProductId, {
        officialStoreId: requestedOfficialStoreId,
      });
      if (catalogProduct) {
        const finalizedCatalogProduct = finalizeFetchedProduct(catalogProduct, {
          originalUrl: productUrl,
          resolvedUrl: catalogProduct.link,
          expectedItemId: undefined,
          returnedItemId: undefined,
          source: "api:catalog",
          apiResponse: {
            permalink: catalogProduct.link,
            title: catalogProduct.title,
          },
        });
        writeCache(
          [
            urlCacheKey,
            ...(buildCatalogCacheKey(catalogProductId, requestedOfficialStoreId)
              ? [buildCatalogCacheKey(catalogProductId, requestedOfficialStoreId)!]
              : []),
            normalizeUrlForCache(finalizedCatalogProduct.link),
          ],
          finalizedCatalogProduct,
        );
        return withPreferredAffiliateLink(finalizedCatalogProduct, preferredAffiliateLink);
      }
    } catch {
      // Continue with raw URL scraping fallback.
    }
  }

  if (catalogProductId && requestedOfficialStoreId) {
    const accessToken = await getMercadoLivreAccessToken();
    if (!accessToken) {
      throw new ProductLookupError(
        "Esse link de catalogo com loja oficial exige credencial ativa do Mercado Livre para identificar a oferta correta.",
        401,
      );
    }

    throw new ProductLookupError(
      "Nao foi possivel identificar a oferta da loja oficial solicitada nesse catalogo.",
      409,
    );
  }

  if (!resolvedItemId && !catalogProductId) {
    try {
      const catalogProductFromSlug = await searchCatalogProductBySlug(productUrl);
      if (catalogProductFromSlug) {
        const finalizedCatalogProduct = finalizeFetchedProduct(catalogProductFromSlug, {
          originalUrl: productUrl,
          resolvedUrl: catalogProductFromSlug.link,
          expectedItemId: undefined,
          returnedItemId: undefined,
          source: "catalog:search",
          apiResponse: {
            permalink: catalogProductFromSlug.link,
            title: catalogProductFromSlug.title,
          },
        });
        const cacheKeys = [urlCacheKey, normalizeUrlForCache(finalizedCatalogProduct.link)];
        if (catalogProductId) {
          cacheKeys.push(`catalog:${catalogProductId}`);
        }
        writeCache(cacheKeys, finalizedCatalogProduct);
        return withPreferredAffiliateLink(finalizedCatalogProduct, preferredAffiliateLink);
      }
    } catch {
      // Continue with raw URL scraping fallback.
    }
  }

  const scraped = await scrapeProductFromPage(productUrl);
  const finalizedScrapedProduct = finalizeFetchedProduct(scraped.product, {
    originalUrl: productUrl,
    resolvedUrl: scraped.finalUrl,
    expectedItemId: resolvedItemId ?? requestedItemId ?? undefined,
    returnedItemId: scraped.itemId,
    source: "scrape:raw-url",
  });
  const cacheKeys = [
    urlCacheKey,
    normalizeUrlForCache(scraped.finalUrl),
    normalizeUrlForCache(finalizedScrapedProduct.link),
  ];
  if (scraped.itemId) {
    cacheKeys.push(`item:${scraped.itemId}`);
  }
  writeCache(cacheKeys, finalizedScrapedProduct);
  return withPreferredAffiliateLink(finalizedScrapedProduct, preferredAffiliateLink);
}
