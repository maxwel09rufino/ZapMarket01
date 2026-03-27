import {
  extractMercadoLivreCatalogProductIdFromUrl,
  extractMercadoLivreItemIdFromFilterValue,
  extractMercadoLivreItemIdFromUrl,
  extractMercadoLivreUserProductIdFromUrl,
  normalizeMercadoLivreItemId,
} from "@/lib/products/mercadoLivreLink";

function sanitizeText(value: string | null | undefined) {
  return (value ?? "").trim();
}

export function stripMercadoLivreImportLinePrefix(value: string) {
  return value.replace(/^\s*\d+\s*[\)\].:-]?\s*/g, "");
}

function stripWrappingPunctuation(value: string) {
  return value
    .replace(/^[\s"'`<(\[{]+/g, "")
    .replace(/[\s"'`>),.;:\]}]+$/g, "");
}

function hasMercadoLivreHost(hostname: string) {
  const host = hostname.trim().toLowerCase();

  return (
    host === "meli.la" ||
    host.endsWith(".meli.la") ||
    host.includes("mercadolivre.com") ||
    host.includes("mercadolivre.com.br") ||
    host.includes("mercadolibre.com")
  );
}

function shouldPreserveSearchParams(parsed: URL) {
  if (parsed.hostname.toLowerCase() === "meli.la" || parsed.hostname.toLowerCase().endsWith(".meli.la")) {
    return true;
  }

  if (parsed.pathname.toLowerCase().startsWith("/social/")) {
    return true;
  }

  for (const key of ["wid", "item_id", "itemId", "item"]) {
    if (sanitizeText(parsed.searchParams.get(key))) {
      return true;
    }
  }

  return parsed.searchParams
    .getAll("pdp_filters")
    .some((value) => Boolean(extractMercadoLivreItemIdFromFilterValue(value)));
}

function hasExplicitItemQueryParam(parsed: URL) {
  return ["wid", "item_id", "itemId", "item"].some((key) => sanitizeText(parsed.searchParams.get(key)));
}

function normalizeParsedUrl(parsed: URL) {
  if (!hasMercadoLivreHost(parsed.hostname)) {
    return null;
  }

  parsed.protocol = "https:";

  const originalUrl = parsed.toString();
  const itemIdFromOriginalUrl = extractMercadoLivreItemIdFromUrl(originalUrl);
  const userProductId = extractMercadoLivreUserProductIdFromUrl(originalUrl);

  if (itemIdFromOriginalUrl && !hasExplicitItemQueryParam(parsed)) {
    parsed.searchParams.set("wid", itemIdFromOriginalUrl);
  }

  parsed.hash = "";

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  const itemId =
    extractMercadoLivreItemIdFromUrl(parsed.toString()) ?? normalizeMercadoLivreItemId(parsed.pathname);
  const isShortLink = hostname === "meli.la" || hostname.endsWith(".meli.la");
  const isProductHost = hostname.startsWith("produto.mercadolivre.");
  const isCatalogUrl = Boolean(extractMercadoLivreCatalogProductIdFromUrl(parsed.toString()));
  const isUserProductUrl = Boolean(userProductId);
  const isSocialUrl = pathname.startsWith("/social/");

  if (!isShortLink && !isProductHost && !isCatalogUrl && !isUserProductUrl && !isSocialUrl && !itemId) {
    return null;
  }

  if (!shouldPreserveSearchParams(parsed)) {
    parsed.search = "";
  }

  return parsed.toString();
}

function normalizeRawImportValue(rawValue: string) {
  const trimmed = stripWrappingPunctuation(stripMercadoLivreImportLinePrefix(sanitizeText(rawValue)));
  if (!trimmed) {
    return null;
  }

  return /^(?:www\.)?(?:mercadolivre|mercadolibre)\.[^\s/]+|^produto\.mercadolivre\.[^\s/]+|^meli\.la(?:\/|$)/i.test(
    trimmed,
  )
    ? `https://${trimmed.replace(/^\/+/, "")}`
    : trimmed;
}

function isMercadoLivreShortUrl(parsed: URL) {
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  if (host === "meli.la" || host.endsWith(".meli.la")) {
    return true;
  }

  return (
    (host === "mercadolivre.com" ||
      host.endsWith(".mercadolivre.com") ||
      host === "mercadolivre.com.br" ||
      host.endsWith(".mercadolivre.com.br")) &&
    pathname.startsWith("/sec/")
  );
}

export function normalizeMercadoLivreImportSource(rawValue: string) {
  const candidateWithProtocol = normalizeRawImportValue(rawValue);
  if (!candidateWithProtocol) {
    return null;
  }

  try {
    const parsed = new URL(candidateWithProtocol);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    return normalizeParsedUrl(parsed);
  } catch {
    return null;
  }
}

export function normalizeMercadoLivreShortImportSource(rawValue: string) {
  const candidateWithProtocol = normalizeRawImportValue(rawValue);
  if (!candidateWithProtocol) {
    return null;
  }

  try {
    const parsed = new URL(candidateWithProtocol);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    if (!isMercadoLivreShortUrl(parsed)) {
      return null;
    }

    parsed.protocol = "https:";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractMercadoLivreImportSourcesFromText(text: string) {
  const matches =
    text.match(
      /https?:\/\/[^\s"'<>]+|(?:www\.)?(?:mercadolivre|mercadolibre)\.[^\s"'<>]+|produto\.mercadolivre\.[^\s"'<>]+|meli\.la\/[^\s"'<>]+/gi,
    ) ?? [];

  const normalizedSources = new Set<string>();

  for (const match of matches) {
    const normalizedSource = normalizeMercadoLivreImportSource(match);
    if (normalizedSource) {
      normalizedSources.add(normalizedSource);
    }
  }

  return Array.from(normalizedSources);
}
