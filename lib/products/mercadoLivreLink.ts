const ITEM_ID_REGEX = /(ML[A-Z])[-_]?(\d{6,})/i;
const USER_PRODUCT_ID_REGEX = /(MLBU)(\d{6,})/i;
const ITEM_QUERY_PARAM_KEYS = ["wid", "item_id", "itemId", "item"] as const;

function normalizePositiveInteger(value: string | null | undefined) {
  const digits = String(value ?? "").trim().replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  const parsed = Number(digits);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeMercadoLivreItemId(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(ITEM_ID_REGEX);
  return match ? `${match[1].toUpperCase()}${match[2]}` : null;
}

export function extractMercadoLivreItemId(value: string | null | undefined) {
  const directMatch = normalizeMercadoLivreItemId(value);
  if (directMatch) {
    return directMatch;
  }

  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }

  try {
    return normalizeMercadoLivreItemId(decodeURIComponent(normalized));
  } catch {
    return null;
  }
}

export function normalizeMercadoLivreUserProductId(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(USER_PRODUCT_ID_REGEX);
  return match ? `${match[1].toUpperCase()}${match[2]}` : null;
}

export function extractMercadoLivreUserProductId(value: string | null | undefined) {
  const directMatch = normalizeMercadoLivreUserProductId(value);
  if (directMatch) {
    return directMatch;
  }

  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }

  try {
    return normalizeMercadoLivreUserProductId(decodeURIComponent(normalized));
  } catch {
    return null;
  }
}

export function extractMercadoLivreItemIdFromFilterValue(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }

  const candidates = [normalized];
  try {
    const decoded = decodeURIComponent(normalized);
    if (decoded !== normalized) {
      candidates.unshift(decoded);
    }
  } catch {
    // Ignora falha de decode e segue com o valor original.
  }

  for (const candidate of candidates) {
    const itemId = extractMercadoLivreItemId(
      candidate.match(/(?:^|[,:&?])(?:wid|item_id|itemId|item)(?::|=)(ML[A-Z][-_]?\d{6,})/i)?.[1] ??
        undefined,
    );
    if (itemId) {
      return itemId;
    }
  }

  return null;
}

function extractMercadoLivreItemIdFromHash(hash: string) {
  const normalizedHash = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!normalizedHash.trim()) {
    return null;
  }

  const hashParams = new URLSearchParams(normalizedHash);
  for (const key of ITEM_QUERY_PARAM_KEYS) {
    const itemId = extractMercadoLivreItemId(hashParams.get(key));
    if (itemId) {
      return itemId;
    }
  }

  return extractMercadoLivreItemId(
    normalizedHash.match(/(?:^|[?&#]|%26)(?:wid|item_id|itemId|item)=([^&#]+)/i)?.[1] ??
      normalizedHash.match(/item_id(?:%3A|:)(ML[A-Z][-_]?\d{6,})/i)?.[1] ??
      undefined,
  );
}

export function extractMercadoLivreCatalogProductIdFromUrl(rawUrl: string): string | null {
  const normalized = String(rawUrl ?? "").trim();
  if (!normalized) {
    return null;
  }

  const extractFromPathname = (pathname: string) => {
    const normalizedPathname = String(pathname ?? "").trim();
    if (!normalizedPathname || !normalizedPathname.toLowerCase().includes("/p/")) {
      return null;
    }

    return (
      extractMercadoLivreItemId(
        normalizedPathname.match(/\/p\/(ML[A-Z][-_]?\d{6,})(?:[/?#]|$)/i)?.[1] ?? undefined,
      ) ?? extractMercadoLivreItemId(normalizedPathname)
    );
  };

  try {
    const parsed = new URL(normalized);
    const fromPathname = extractFromPathname(parsed.pathname);
    if (fromPathname) {
      return fromPathname;
    }

    for (const [key, value] of parsed.searchParams.entries()) {
      if (key.toLowerCase() === "go") {
        const fromGoParam: string | null = extractMercadoLivreCatalogProductIdFromUrl(value);
        if (fromGoParam) {
          return fromGoParam;
        }
      }

      const fromSearchParam = extractFromPathname(value);
      if (fromSearchParam) {
        return fromSearchParam;
      }

      try {
        const decodedValue = decodeURIComponent(value);
        const fromDecodedSearchParam = extractFromPathname(decodedValue);
        if (fromDecodedSearchParam) {
          return fromDecodedSearchParam;
        }
      } catch {
        // Ignore decode failures and continue scanning.
      }
    }

    const fromHash = extractFromPathname(parsed.hash);
    if (fromHash) {
      return fromHash;
    }

    return extractFromPathname(decodeURIComponent(normalized));
  } catch {
    return extractFromPathname(normalized);
  }
}

function isSameCatalogAndItemId(
  candidateItemId: string | null | undefined,
  catalogProductId: string | null | undefined,
) {
  const normalizedCandidateItemId = normalizeMercadoLivreItemId(candidateItemId);
  const normalizedCatalogProductId = normalizeMercadoLivreItemId(catalogProductId);

  return Boolean(
    normalizedCandidateItemId &&
      normalizedCatalogProductId &&
      normalizedCandidateItemId === normalizedCatalogProductId,
  );
}

export function extractMercadoLivrePreferredItemIdFromUrl(rawUrl: string) {
  const normalized = String(rawUrl ?? "").trim();
  if (!normalized) {
    return null;
  }

  const topLevelCatalogProductId = extractMercadoLivreCatalogProductIdFromUrl(normalized);
  const shouldAcceptPreferredItem = (itemId: string | null | undefined, rawContext?: string | null) => {
    if (!itemId) {
      return false;
    }

    const contextCatalogProductId =
      extractMercadoLivreCatalogProductIdFromUrl(String(rawContext ?? "").trim()) ??
      topLevelCatalogProductId;

    return !isSameCatalogAndItemId(itemId, contextCatalogProductId);
  };

  try {
    const parsed = new URL(normalized);

    for (const key of ITEM_QUERY_PARAM_KEYS) {
      const itemId = extractMercadoLivreItemId(parsed.searchParams.get(key));
      if (shouldAcceptPreferredItem(itemId, parsed.searchParams.get(key))) {
        return itemId;
      }
    }

    for (const value of parsed.searchParams.getAll("pdp_filters")) {
      const itemId = extractMercadoLivreItemIdFromFilterValue(value);
      if (shouldAcceptPreferredItem(itemId, value)) {
        return itemId;
      }
    }

    const hashItemId = extractMercadoLivreItemIdFromHash(parsed.hash);
    if (shouldAcceptPreferredItem(hashItemId, parsed.hash)) {
      return hashItemId;
    }
  } catch {
    // Fallback below handles raw string parsing.
  }

  const candidates = [normalized];
  try {
    const decoded = decodeURIComponent(normalized);
    if (decoded !== normalized) {
      candidates.unshift(decoded);
    }
  } catch {
    // Ignore decode failure and keep original string.
  }

  for (const candidate of candidates) {
    const itemId = extractMercadoLivreItemId(
      candidate.match(/(?:wid|item_id|itemId|item)=([^&#]+)/i)?.[1] ??
        candidate.match(/item_id(?:%3A|:)(ML[A-Z][-_]?\d{6,})/i)?.[1] ??
        undefined,
    );
    if (shouldAcceptPreferredItem(itemId, candidate)) {
      return itemId;
    }
  }

  return null;
}

export function extractMercadoLivreOfficialStoreIdFromUrl(rawUrl: string) {
  const normalized = String(rawUrl ?? "").trim();
  if (!normalized) {
    return null;
  }

  const extractFromDecodedValue = (value: string | null | undefined) => {
    const normalizedValue = String(value ?? "").trim();
    if (!normalizedValue) {
      return null;
    }

    const directMatch =
      normalizePositiveInteger(
        normalizedValue.match(/(?:^|[,:&?])official_store(?::|=)(\d+)/i)?.[1] ?? undefined,
      ) ?? normalizePositiveInteger(normalizedValue);
    if (directMatch) {
      return directMatch;
    }

    try {
      const decoded = decodeURIComponent(normalizedValue);
      return (
        normalizePositiveInteger(
          decoded.match(/(?:^|[,:&?])official_store(?::|=)(\d+)/i)?.[1] ?? undefined,
        ) ?? normalizePositiveInteger(decoded)
      );
    } catch {
      return null;
    }
  };

  try {
    const parsed = new URL(normalized);

    const directQueryValue =
      normalizePositiveInteger(parsed.searchParams.get("official_store")) ??
      normalizePositiveInteger(parsed.searchParams.get("official_store_id"));
    if (directQueryValue) {
      return directQueryValue;
    }

    for (const value of parsed.searchParams.getAll("pdp_filters")) {
      const officialStoreId = extractFromDecodedValue(value);
      if (officialStoreId) {
        return officialStoreId;
      }
    }

    return extractFromDecodedValue(parsed.hash);
  } catch {
    return extractFromDecodedValue(normalized);
  }
}

export function extractMercadoLivreItemIdFromUrl(rawUrl: string) {
  const normalized = String(rawUrl ?? "").trim();
  if (!normalized) {
    return null;
  }

  const preferredItemId = extractMercadoLivrePreferredItemIdFromUrl(normalized);
  if (preferredItemId) {
    return preferredItemId;
  }

  const catalogProductId = extractMercadoLivreCatalogProductIdFromUrl(normalized);
  if (catalogProductId) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    return extractMercadoLivreItemId(parsed.pathname);
  } catch {
    return extractMercadoLivreItemId(normalized);
  }
}

export function extractMercadoLivreUserProductIdFromUrl(rawUrl: string) {
  const normalized = String(rawUrl ?? "").trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);

    return (
      extractMercadoLivreUserProductId(parsed.searchParams.get("user_product_id")) ??
      extractMercadoLivreUserProductId(parsed.hash) ??
      extractMercadoLivreUserProductId(parsed.pathname)
    );
  } catch {
    return extractMercadoLivreUserProductId(normalized);
  }
}

export function mercadoLivreLinkMatchesItemId(
  rawUrl: string | null | undefined,
  expectedItemId: string | null | undefined,
) {
  const normalizedExpectedItemId = normalizeMercadoLivreItemId(expectedItemId);
  if (!normalizedExpectedItemId) {
    return true;
  }

  const normalizedUrl = String(rawUrl ?? "").trim();
  if (!normalizedUrl) {
    return false;
  }

  if (extractMercadoLivreItemIdFromUrl(normalizedUrl) === normalizedExpectedItemId) {
    return true;
  }

  if (extractMercadoLivreItemId(normalizedUrl) === normalizedExpectedItemId) {
    return true;
  }

  const upperUrl = normalizedUrl.toUpperCase();
  return (
    upperUrl.includes(normalizedExpectedItemId) ||
    upperUrl.includes(normalizedExpectedItemId.replace(/^([A-Z]{3})/, "$1-")) ||
    upperUrl.includes(normalizedExpectedItemId.replace(/^([A-Z]{3})/, "$1_"))
  );
}

export function getMercadoLivreProductMismatchReason(args: {
  expectedItemId?: string | null;
  returnedItemId?: string | null;
  permalink?: string | null;
}) {
  const normalizedExpectedItemId = normalizeMercadoLivreItemId(args.expectedItemId);
  if (!normalizedExpectedItemId) {
    return null;
  }

  const normalizedReturnedItemId = normalizeMercadoLivreItemId(args.returnedItemId);
  if (normalizedReturnedItemId && normalizedReturnedItemId !== normalizedExpectedItemId) {
    return `Produto retornado nao corresponde ao item ${normalizedExpectedItemId}.`;
  }

  if (
    normalizedReturnedItemId === normalizedExpectedItemId ||
    mercadoLivreLinkMatchesItemId(args.permalink, normalizedExpectedItemId)
  ) {
    return null;
  }

  return `Produto retornado nao corresponde ao item ${normalizedExpectedItemId}.`;
}

export function buildMercadoLivreItemUrl(itemId: string) {
  const normalizedItemId = normalizeMercadoLivreItemId(itemId) ?? itemId.trim().toUpperCase();
  return `https://produto.mercadolivre.com.br/${normalizedItemId}`;
}

export function buildMercadoLivreCatalogUrl(catalogProductId: string) {
  const normalizedCatalogProductId =
    normalizeMercadoLivreItemId(catalogProductId) ?? catalogProductId.trim().toUpperCase();
  return `https://www.mercadolivre.com.br/p/${normalizedCatalogProductId}`;
}

export function buildMercadoLivreUserProductUrl(userProductId: string) {
  const normalizedUserProductId =
    normalizeMercadoLivreUserProductId(userProductId) ?? userProductId.trim().toUpperCase();
  return `https://www.mercadolivre.com.br/up/${normalizedUserProductId}`;
}
