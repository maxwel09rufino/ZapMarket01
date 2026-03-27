const MERCADO_LIVRE_SEARCH_QUERY_PARAM_KEYS = ["q", "as_word"] as const;

export type MercadoLivreSearchUrlInfo = {
  sourceUrl: string;
  normalizedUrl: string;
  siteId: "MLB";
  searchTerm: string;
  apiQuery: string;
};

function sanitizeText(value: unknown) {
  return String(value ?? "").trim();
}

function decodeUrlSegment(value: string) {
  const normalizedValue = sanitizeText(value);
  if (!normalizedValue) {
    return "";
  }

  try {
    return decodeURIComponent(normalizedValue);
  } catch {
    return normalizedValue;
  }
}

function collapseWhitespace(value: string) {
  return sanitizeText(value).replace(/\s+/g, " ");
}

function hasMercadoLivreSearchHost(hostname: string) {
  const host = sanitizeText(hostname).toLowerCase();
  return (
    host === "lista.mercadolivre.com.br" ||
    host.endsWith(".lista.mercadolivre.com.br") ||
    host === "lista.mercadolibre.com" ||
    host.endsWith(".lista.mercadolibre.com")
  );
}

function stripSearchPagingMarkers(value: string) {
  return value
    .replace(/_Desde_\d+.*$/i, "")
    .replace(/_NoIndex_True.*$/i, "")
    .replace(/_DisplayType_[^_]+.*$/i, "")
    .replace(/_CustId_\d+.*$/i, "");
}

function normalizeSearchTerm(value: string) {
  const decodedValue = decodeUrlSegment(value).replace(/\+/g, " ");
  const withoutPaging = stripSearchPagingMarkers(decodedValue);
  return collapseWhitespace(withoutPaging.replace(/[-_]+/g, " "));
}

function extractSearchTermFromPath(pathname: string) {
  const segments = pathname
    .split("/")
    .map((segment) => sanitizeText(segment))
    .filter(Boolean);

  for (const segment of segments) {
    if (/^_Desde_/i.test(segment)) {
      continue;
    }

    const searchTerm = normalizeSearchTerm(segment);
    if (searchTerm) {
      return searchTerm;
    }
  }

  return "";
}

function extractSearchTermFromParsedUrl(parsedUrl: URL) {
  for (const key of MERCADO_LIVRE_SEARCH_QUERY_PARAM_KEYS) {
    const value = parsedUrl.searchParams.get(key);
    const searchTerm = normalizeSearchTerm(value ?? "");
    if (searchTerm) {
      return searchTerm;
    }
  }

  return extractSearchTermFromPath(parsedUrl.pathname);
}

function normalizeSearchPath(searchTerm: string) {
  return `/${searchTerm
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

export function buildMercadoLivreSearchApiQuery(searchTerm: string) {
  return collapseWhitespace(searchTerm).replace(/\s+/g, "+");
}

export function isMercadoLivreSearchUrl(rawUrl: string) {
  const normalizedUrl = sanitizeText(rawUrl);
  if (!normalizedUrl) {
    return false;
  }

  try {
    const parsedUrl = new URL(normalizedUrl);
    return (
      ["http:", "https:"].includes(parsedUrl.protocol) &&
      hasMercadoLivreSearchHost(parsedUrl.hostname) &&
      extractSearchTermFromParsedUrl(parsedUrl).length > 0
    );
  } catch {
    return false;
  }
}

export function parseMercadoLivreSearchUrl(rawUrl: string): MercadoLivreSearchUrlInfo | null {
  const sourceUrl = sanitizeText(rawUrl);
  if (!sourceUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(sourceUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol) || !hasMercadoLivreSearchHost(parsedUrl.hostname)) {
      return null;
    }

    const searchTerm = extractSearchTermFromParsedUrl(parsedUrl);
    if (!searchTerm) {
      return null;
    }

    const normalizedUrl = new URL(parsedUrl.toString());
    normalizedUrl.protocol = "https:";
    normalizedUrl.hash = "";
    normalizedUrl.search = "";
    normalizedUrl.pathname = normalizeSearchPath(searchTerm);

    return {
      sourceUrl,
      normalizedUrl: normalizedUrl.toString(),
      siteId: "MLB",
      searchTerm,
      apiQuery: buildMercadoLivreSearchApiQuery(searchTerm),
    };
  } catch {
    return null;
  }
}

export function extractMercadoLivreSearchTerm(rawUrl: string) {
  return parseMercadoLivreSearchUrl(rawUrl)?.searchTerm ?? null;
}
