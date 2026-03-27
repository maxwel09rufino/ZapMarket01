import { normalizeMercadoLivreImportSource } from "@/lib/products/importSource";

const MERCADO_LIVRE_TIMEOUT_MS = 15000;
const MERCADO_LIVRE_LIST_PAGE_SIZE = 50;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
};

export const MERCADO_LIVRE_LIST_IMPORT_ERROR_MESSAGE =
  "Nao foi possivel ler a lista de produtos do Mercado Livre.";
const MERCADO_LIVRE_SUSPICIOUS_TRAFFIC_MESSAGE =
  "O Mercado Livre bloqueou a leitura automatica desta lista com uma verificacao de trafego. Aguarde alguns minutos e tente novamente.";

export type MercadoLivreListScanUpdate = {
  pageUrl: string;
  pageOffset: number;
  scannedPages: number;
  totalPages: number;
  totalResults: number;
  productLinksOnPage: number;
  discoveredProducts: number;
};

export type MercadoLivreListDiscovery = {
  sourceUrl: string;
  normalizedUrl: string;
  totalResults: number;
  totalPages: number;
  pagesScanned: number;
  productLinks: string[];
};

export class ProductListImportError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function sanitizeText(value: string | undefined) {
  return (value ?? "").trim();
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

function withTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

function isMercadoLivreListHost(hostname: string) {
  const host = hostname.trim().toLowerCase();
  return host === "lista.mercadolivre.com.br" || host.endsWith(".lista.mercadolivre.com.br");
}

function normalizeMercadoLivreListPath(pathname: string) {
  return pathname.replace(/_Desde_\d+/i, "").replace(/\/+$/, "");
}

export function normalizeMercadoLivreListUrl(rawUrl: string) {
  const input = sanitizeText(rawUrl);
  if (!input) {
    throw new ProductListImportError(MERCADO_LIVRE_LIST_IMPORT_ERROR_MESSAGE, 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new ProductListImportError(MERCADO_LIVRE_LIST_IMPORT_ERROR_MESSAGE, 400);
  }

  if (!["http:", "https:"].includes(parsed.protocol) || !isMercadoLivreListHost(parsed.hostname)) {
    throw new ProductListImportError(
      "Informe uma URL de lista do Mercado Livre valida.",
      400,
    );
  }

  const normalizedPathname = normalizeMercadoLivreListPath(parsed.pathname);
  if (!normalizedPathname || normalizedPathname === "/") {
    throw new ProductListImportError(
      "A URL informada nao parece ser uma lista publica do Mercado Livre.",
      400,
    );
  }

  parsed.pathname = normalizedPathname;
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}

function buildMercadoLivreListPageUrl(baseUrl: string, offset: number) {
  if (offset <= 0) {
    return baseUrl;
  }

  const parsed = new URL(baseUrl);
  parsed.pathname = `${normalizeMercadoLivreListPath(parsed.pathname)}_Desde_${offset + 1}`;
  return parsed.toString();
}

export function extractMercadoLivreProductId(rawUrl: string) {
  const text = sanitizeText(rawUrl);
  if (!text) {
    return null;
  }

  try {
    const parsed = new URL(text);
    const wid = sanitizeText(parsed.searchParams.get("wid") ?? undefined).toUpperCase();
    if (/^MLB\d{6,}$/.test(wid)) {
      return wid;
    }
  } catch {
    // Fallback to text search below.
  }

  const match = text.toUpperCase().match(/MLB\d{6,}/);
  return match ? match[0] : null;
}

export function normalizeMercadoLivreImportProductUrl(rawUrl: string) {
  return normalizeMercadoLivreImportSource(rawUrl);
}

function extractNumber(value: string | undefined) {
  const digits = sanitizeText(value).replace(/\D/g, "");
  if (!digits) {
    return undefined;
  }

  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractTotalResults(html: string) {
  const quantityMatch = html.match(/ui-search-search-result__quantity-results">([^<]+)</i);
  const quantityValue = extractNumber(quantityMatch?.[1]);
  if (quantityValue !== undefined) {
    return quantityValue;
  }

  const totalMatch = html.match(/"total":(\d+)/i);
  const totalValue = extractNumber(totalMatch?.[1]);
  if (totalValue !== undefined) {
    return totalValue;
  }

  throw new ProductListImportError(MERCADO_LIVRE_LIST_IMPORT_ERROR_MESSAGE, 502);
}

function extractPageOffset(html: string) {
  const offsetMatch = html.match(/"offset":(\d+)/i);
  return extractNumber(offsetMatch?.[1]) ?? 0;
}

function extractProductLinksFromHtml(html: string, baseUrl: string) {
  const productLinks = new Set<string>();
  const hrefRegex = /href\s*=\s*["']([^"'<>]+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = hrefRegex.exec(html)) !== null) {
    const decodedCandidate = decodeHtmlEntities(match[1]);
    let normalizedCandidate: string | null = null;

    try {
      normalizedCandidate = normalizeMercadoLivreImportProductUrl(
        new URL(decodedCandidate, baseUrl).toString(),
      );
    } catch {
      normalizedCandidate = null;
    }

    if (normalizedCandidate) {
      productLinks.add(normalizedCandidate);
    }
  }

  return Array.from(productLinks);
}

function isSuspiciousTrafficResponse(finalUrl: string, html: string) {
  const normalizedUrl = finalUrl.toLowerCase();
  if (
    normalizedUrl.includes("/gz/account-verification") ||
    normalizedUrl.includes("/security/suspicious_traffic")
  ) {
    return true;
  }

  return (
    /suspicious-traffic-frontend/i.test(html) ||
    /security\/suspicious_traffic/i.test(html) ||
    /account-verification/i.test(html)
  );
}

async function fetchListPage(url: string) {
  const { signal, clear } = withTimeoutSignal(MERCADO_LIVRE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal,
      headers: BROWSER_HEADERS,
    });

    const html = await response.text().catch(() => "");
    if (!response.ok || !html) {
      throw new ProductListImportError(MERCADO_LIVRE_LIST_IMPORT_ERROR_MESSAGE, response.status);
    }

    if (isSuspiciousTrafficResponse(response.url || url, html)) {
      throw new ProductListImportError(MERCADO_LIVRE_SUSPICIOUS_TRAFFIC_MESSAGE, 429);
    }

    return {
      html,
      finalUrl: response.url || url,
    };
  } catch (error) {
    if (error instanceof ProductListImportError) {
      throw error;
    }

    throw new ProductListImportError(MERCADO_LIVRE_LIST_IMPORT_ERROR_MESSAGE, 502);
  } finally {
    clear();
  }
}

export async function discoverMercadoLivreListProductLinks(
  rawUrl: string,
  options?: {
    maxProducts?: number;
    onPageScanned?: (update: MercadoLivreListScanUpdate) => void;
  },
): Promise<MercadoLivreListDiscovery> {
  const normalizedUrl = normalizeMercadoLivreListUrl(rawUrl);
  const maxProducts = options?.maxProducts;
  if (maxProducts !== undefined && (!Number.isInteger(maxProducts) || maxProducts <= 0)) {
    throw new ProductListImportError("O limite de importacao precisa ser um numero inteiro maior que zero.", 400);
  }

  const firstPage = await fetchListPage(normalizedUrl);
  const totalResults = extractTotalResults(firstPage.html);
  const totalPages = Math.max(1, Math.ceil(totalResults / MERCADO_LIVRE_LIST_PAGE_SIZE));
  const discovered = new Set<string>();
  let scannedPages = 0;

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const pageOffset = pageIndex * MERCADO_LIVRE_LIST_PAGE_SIZE;
    const pageUrl = buildMercadoLivreListPageUrl(normalizedUrl, pageOffset);
    const page = pageIndex === 0 ? firstPage : await fetchListPage(pageUrl);
    const productLinks = extractProductLinksFromHtml(page.html, page.finalUrl || pageUrl);
    scannedPages = pageIndex + 1;

    if (pageIndex === 0 && productLinks.length === 0) {
      throw new ProductListImportError(
        "Nao foi possivel identificar produtos nessa lista do Mercado Livre.",
        422,
      );
    }

    for (const link of productLinks) {
      discovered.add(link);
      if (maxProducts !== undefined && discovered.size >= maxProducts) {
        break;
      }
    }

    options?.onPageScanned?.({
      pageUrl,
      pageOffset: extractPageOffset(page.html) || pageOffset,
      scannedPages,
      totalPages,
      totalResults,
      productLinksOnPage: productLinks.length,
      discoveredProducts: discovered.size,
    });

    if (maxProducts !== undefined && discovered.size >= maxProducts) {
      break;
    }
  }

  return {
    sourceUrl: rawUrl,
    normalizedUrl,
    totalResults,
    totalPages,
    pagesScanned: scannedPages,
    productLinks: Array.from(discovered),
  };
}
