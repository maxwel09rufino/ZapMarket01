import {
  fetchMercadoLivreProductByHtml,
  ProductLookupError,
  type MercadoLivreFetchedProduct,
} from "@/lib/products/mercadoLivre";
import { fetchMercadoLivreProductByConfiguredApi } from "@/lib/products/mercadoLivreConfigured";
import {
  extractMercadoLivreCatalogProductIdFromUrl,
  extractMercadoLivreItemIdFromUrl,
} from "@/lib/products/mercadoLivreLink";

export type ExtensionLookupMode = "auto" | "current" | "meli-api";

function sanitizeText(value: string | undefined | null) {
  return String(value ?? "").trim();
}

function hasExplicitItemReference(rawUrl: string) {
  const normalizedUrl = sanitizeText(rawUrl);
  if (!normalizedUrl) {
    return false;
  }

  if (extractMercadoLivreItemIdFromUrl(normalizedUrl)) {
    return true;
  }

  if (extractMercadoLivreCatalogProductIdFromUrl(normalizedUrl)) {
    return true;
  }

  return /(?:^|[?&])(wid|item_id|itemId|item)=/i.test(normalizedUrl);
}

function shouldPreferConfiguredLookup(rawUrl: string) {
  const normalizedUrl = sanitizeText(rawUrl);
  if (!normalizedUrl) {
    return false;
  }

  try {
    const parsed = new URL(normalizedUrl);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (hostname === "meli.la" || hostname.endsWith(".meli.la")) {
      return true;
    }

    if (pathname.startsWith("/social/")) {
      return true;
    }

    if (hasExplicitItemReference(normalizedUrl)) {
      return true;
    }

    return parsed.searchParams
      .getAll("pdp_filters")
      .some((value) => /item_id/i.test(sanitizeText(value)));
  } catch {
    return hasExplicitItemReference(normalizedUrl) || /item_id(?:%3A|:)/i.test(normalizedUrl);
  }
}

export function resolveExtensionLookupMode(value: unknown): ExtensionLookupMode {
  return value === "meli-api" || value === "auto" || value === "current" ? value : "current";
}

export async function resolveExtensionProductLookup(
  rawUrl: string,
  lookupMode: ExtensionLookupMode = "auto",
): Promise<MercadoLivreFetchedProduct> {
  if (lookupMode === "current") {
    if (shouldPreferConfiguredLookup(rawUrl)) {
      try {
        return await fetchMercadoLivreProductByConfiguredApi(rawUrl);
      } catch {
        // Cai para o resolver publico abaixo.
      }
    }

    return fetchMercadoLivreProductByHtml(rawUrl);
  }

  if (lookupMode === "meli-api") {
    return fetchMercadoLivreProductByConfiguredApi(rawUrl);
  }

  try {
    return await fetchMercadoLivreProductByConfiguredApi(rawUrl);
  } catch (error) {
    if (error instanceof ProductLookupError) {
      return fetchMercadoLivreProductByHtml(rawUrl);
    }

    throw error;
  }
}
