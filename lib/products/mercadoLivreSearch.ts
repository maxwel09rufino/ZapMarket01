import "server-only";

import axios, { AxiosError } from "axios";
import { ensureActiveMeliCredentialAccessToken } from "@/lib/meli/store";
import { normalizeMercadoLivreImportSource } from "@/lib/products/importSource";
import { parseMercadoLivreSearchUrl } from "@/lib/products/mercadoLivreSearchLink";
import type {
  MercadoLivreSearchFilter,
  MercadoLivreSearchItem,
  MercadoLivreSearchQuery,
  MercadoLivreSearchResponse,
  MercadoLivreSearchSort,
} from "@/lib/products/mercadoLivreSearchClient";

const MERCADO_LIVRE_API_BASE = "https://api.mercadolibre.com";
const MERCADO_LIVRE_SEARCH_TIMEOUT_MS = 15_000;
const MERCADO_LIVRE_SEARCH_RETRIES = 3;
const MERCADO_LIVRE_PUBLIC_SEARCH_LIMIT = 50;
const MERCADO_LIVRE_USER_SCAN_LIMIT = 100;
const MERCADO_LIVRE_PUBLIC_SEARCH_COLLECT_CONCURRENCY = 4;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

type RawSearchResult = {
  id?: string | null;
  title?: string | null;
  price?: number | null;
  original_price?: number | null;
  currency_id?: string | null;
  permalink?: string | null;
  thumbnail?: string | null;
  secure_thumbnail?: string | null;
  pictures?: Array<{
    secure_url?: string | null;
    url?: string | null;
  }> | null;
  condition?: string | null;
  category_id?: string | null;
  official_store_id?: number | null;
  seller_id?: number | null;
  seller?: {
    id?: number | null;
  } | null;
  available_quantity?: number | null;
};

type RawSiteSearchResponse = {
  paging?: {
    total?: number | null;
    offset?: number | null;
    limit?: number | null;
  } | null;
  results?: RawSearchResult[] | null;
  available_filters?: Array<{
    id?: string | null;
    name?: string | null;
    values?: Array<{
      id?: string | null;
      name?: string | null;
      results?: number | null;
    }> | null;
  }> | null;
  available_sorts?: Array<{
    id?: string | null;
    name?: string | null;
  }> | null;
};

type RawItemsMultigetResponse = Array<{
  code?: number | null;
  body?: RawSearchResult | null;
}>;

type RawUserItemsSearchResponse = {
  results?: Array<string | null> | null;
  scroll_id?: string | null;
};

type AuthContext = {
  accessToken: string;
  meliUserId?: string;
  meliNickname?: string;
  siteId?: string;
};

type NormalizedSearchInput = {
  siteId: string;
  query: string;
  sellerId: string;
  nickname: string;
  categoryId: string;
  officialStoreId: string;
  condition: string;
  sort: string;
  limit: number;
  offset: number;
};

type CacheEntry = {
  expiresAt: number;
  data: MercadoLivreSearchResponse;
};

export type MercadoLivreSearchCollectStrategy = "public-search" | "seller-scan";

export type MercadoLivreSearchCollectUpdate = {
  strategy: MercadoLivreSearchCollectStrategy;
  scannedPages: number;
  totalPages?: number;
  totalResults?: number;
  discoveredProducts: number;
  currentOffset?: number;
  currentScrollId?: string;
  currentReference?: string;
};

export type CollectMercadoLivreSearchItemsInput = MercadoLivreSearchQuery & {
  maxProducts?: number;
  onProgress?: (update: MercadoLivreSearchCollectUpdate) => void;
};

export type CollectedMercadoLivreSearchItems = {
  strategy: MercadoLivreSearchCollectStrategy;
  siteId: string;
  query: string;
  sellerId?: string;
  nickname?: string;
  categoryId?: string;
  officialStoreId?: string;
  condition?: string;
  sort?: string;
  pagesScanned: number;
  totalPages?: number;
  totalResults?: number;
  items: MercadoLivreSearchItem[];
  productLinks: string[];
};

export type CollectedMercadoLivreSearchUrlItems = CollectedMercadoLivreSearchItems & {
  sourceUrl: string;
  normalizedUrl: string;
  searchTerm: string;
  apiQuery: string;
};

export class MercadoLivreSearchError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const searchCache = new Map<string, CacheEntry>();

function sanitizeText(value: unknown) {
  return String(value ?? "").trim();
}

function parsePositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeLimit(limit?: number) {
  if (!Number.isFinite(limit)) {
    return MERCADO_LIVRE_PUBLIC_SEARCH_LIMIT;
  }

  return Math.min(MERCADO_LIVRE_PUBLIC_SEARCH_LIMIT, Math.max(1, Math.trunc(limit ?? 0)));
}

function normalizeOffset(offset?: number) {
  if (!Number.isFinite(offset)) {
    return 0;
  }

  return Math.max(0, Math.trunc(offset ?? 0));
}

function normalizeMaxProducts(value: number | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new MercadoLivreSearchError(
      "O limite da importacao oficial precisa ser um numero inteiro maior que zero.",
      400,
    );
  }

  return Math.trunc(value);
}

function normalizeSearchInput(input: MercadoLivreSearchQuery): NormalizedSearchInput {
  return {
    siteId: sanitizeText(input.siteId) || "MLB",
    query: sanitizeText(input.query),
    sellerId: sanitizeText(input.sellerId),
    nickname: sanitizeText(input.nickname),
    categoryId: sanitizeText(input.categoryId),
    officialStoreId: sanitizeText(input.officialStoreId),
    condition: sanitizeText(input.condition),
    sort: sanitizeText(input.sort),
    limit: normalizeLimit(input.limit),
    offset: normalizeOffset(input.offset),
  };
}

function assertHasSearchCriteria(input: {
  query: string;
  sellerId: string;
  nickname: string;
  categoryId: string;
  officialStoreId: string;
}) {
  if (!input.query && !input.sellerId && !input.nickname && !input.categoryId && !input.officialStoreId) {
    throw new MercadoLivreSearchError(
      "Informe pelo menos um termo de busca, vendedor, categoria ou loja oficial.",
      400,
    );
  }
}

function buildSearchCacheKey(query: NormalizedSearchInput) {
  return JSON.stringify({
    siteId: query.siteId,
    query: query.query,
    sellerId: query.sellerId,
    nickname: query.nickname,
    categoryId: query.categoryId,
    officialStoreId: query.officialStoreId,
    condition: query.condition,
    sort: query.sort,
    limit: query.limit,
    offset: query.offset,
  });
}

function readSearchCache(key: string) {
  const cached = searchCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt < Date.now()) {
    searchCache.delete(key);
    return null;
  }

  return cached.data;
}

function writeSearchCache(key: string, data: MercadoLivreSearchResponse) {
  searchCache.set(key, {
    data,
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
  });
}

function shouldRetry(error: AxiosError | Error, attempt: number) {
  if (attempt >= MERCADO_LIVRE_SEARCH_RETRIES - 1) {
    return false;
  }

  if (error instanceof AxiosError) {
    const status = error.response?.status ?? 0;
    return error.code === "ECONNABORTED" || status === 429 || status >= 500;
  }

  return true;
}

function isAuthorizationError(error: unknown) {
  return (
    error instanceof AxiosError &&
    [401, 403].includes(error.response?.status ?? 0)
  );
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestWithRetry<T>(request: () => Promise<T>) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MERCADO_LIVRE_SEARCH_RETRIES; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!shouldRetry(lastError, attempt)) {
        break;
      }

      await delay(500 * (attempt + 1));
    }
  }

  throw lastError ?? new Error("Falha ao comunicar com o Mercado Livre.");
}

async function getOptionalAuthContext(): Promise<AuthContext | null> {
  const activeCredential = await ensureActiveMeliCredentialAccessToken().catch(() => null);
  if (!activeCredential?.accessToken?.trim()) {
    return null;
  }

  return {
    accessToken: activeCredential.accessToken.trim(),
    meliUserId: sanitizeText(activeCredential.credential.meliUserId) || undefined,
    meliNickname: sanitizeText(activeCredential.credential.meliNickname) || undefined,
    siteId: sanitizeText(activeCredential.credential.siteId) || undefined,
  };
}

function buildHeaders(accessToken?: string) {
  return {
    Accept: "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function mapSearchItem(item: RawSearchResult): MercadoLivreSearchItem | null {
  const id = sanitizeText(item.id);
  const title = sanitizeText(item.title);
  const price = parsePositiveNumber(item.price);

  if (!id || !title || price === undefined) {
    return null;
  }

  const firstPicture =
    sanitizeText(item.pictures?.[0]?.secure_url ?? item.pictures?.[0]?.url) ||
    sanitizeText(item.secure_thumbnail ?? item.thumbnail);

  const originalPrice = parsePositiveNumber(item.original_price);

  return {
    id,
    title,
    price,
    originalPrice: originalPrice !== undefined && originalPrice > price ? originalPrice : undefined,
    currency: sanitizeText(item.currency_id) || "BRL",
    permalink: sanitizeText(item.permalink),
    thumbnail: sanitizeText(item.thumbnail) || undefined,
    image: firstPicture || undefined,
    condition: sanitizeText(item.condition) || undefined,
    categoryId: sanitizeText(item.category_id) || undefined,
    officialStoreId:
      typeof item.official_store_id === "number" ? item.official_store_id : undefined,
    sellerId:
      typeof item.seller_id === "number"
        ? item.seller_id
        : typeof item.seller?.id === "number"
          ? item.seller.id
          : undefined,
    availableQuantity:
      typeof item.available_quantity === "number" ? item.available_quantity : undefined,
  };
}

function mapSearchItems(results: RawSearchResult[]) {
  return results
    .map((item) => mapSearchItem(item))
    .filter(Boolean) as MercadoLivreSearchItem[];
}

function mapFilters(rawFilters: RawSiteSearchResponse["available_filters"]): MercadoLivreSearchFilter[] {
  return (rawFilters ?? [])
    .map((filter) => {
      const id = sanitizeText(filter.id);
      const name = sanitizeText(filter.name);
      if (!id || !name) {
        return null;
      }

      return {
        id,
        name,
        values: (filter.values ?? [])
          .map((value) => {
            const valueId = sanitizeText(value.id);
            const valueName = sanitizeText(value.name);
            const results = parsePositiveNumber(value.results) ?? 0;
            return valueId && valueName ? { id: valueId, name: valueName, results } : null;
          })
          .filter(Boolean) as MercadoLivreSearchFilter["values"],
      };
    })
    .filter(Boolean) as MercadoLivreSearchFilter[];
}

function mapSorts(rawSorts: RawSiteSearchResponse["available_sorts"]): MercadoLivreSearchSort[] {
  return (rawSorts ?? [])
    .map((sort) => {
      const id = sanitizeText(sort.id);
      const name = sanitizeText(sort.name);
      return id && name ? { id, name } : null;
    })
    .filter(Boolean) as MercadoLivreSearchSort[];
}

async function multigetItems(ids: string[], accessToken?: string) {
  if (ids.length === 0) {
    return new Map<string, MercadoLivreSearchItem>();
  }

  const requestItems = (token?: string) =>
    requestWithRetry(() =>
      axios.get<RawItemsMultigetResponse>(`${MERCADO_LIVRE_API_BASE}/items`, {
        timeout: MERCADO_LIVRE_SEARCH_TIMEOUT_MS,
        headers: buildHeaders(token),
        params: {
          ids: ids.join(","),
          attributes:
            "id,title,price,original_price,currency_id,permalink,thumbnail,pictures,condition,category_id,official_store_id,seller_id,available_quantity",
        },
      }),
    );

  const response = await requestItems(accessToken).catch(async (error) => {
    if (accessToken && isAuthorizationError(error)) {
      return requestItems(undefined);
    }

    throw error;
  });

  const mapped = new Map<string, MercadoLivreSearchItem>();

  for (const entry of response.data ?? []) {
    if (entry.code !== 200 || !entry.body) {
      continue;
    }

    const item = mapSearchItem(entry.body);
    if (item) {
      mapped.set(item.id, item);
    }
  }

  return mapped;
}

async function hydrateSearchResults(rawResults: RawSearchResult[], accessToken?: string) {
  const multigetMap = await multigetItems(
    rawResults
      .map((item) => sanitizeText(item.id))
      .filter(Boolean)
      .slice(0, MERCADO_LIVRE_PUBLIC_SEARCH_LIMIT),
    accessToken,
  ).catch(() => new Map<string, MercadoLivreSearchItem>());

  return rawResults
    .map((item) => {
      const itemId = sanitizeText(item.id);
      return multigetMap.get(itemId) ?? mapSearchItem(item);
    })
    .filter(Boolean) as MercadoLivreSearchItem[];
}

async function fetchSiteSearchResponse(
  input: NormalizedSearchInput,
  accessToken?: string,
) {
  const requestSearch = (token?: string) =>
    requestWithRetry(() =>
      axios.get<RawSiteSearchResponse>(`${MERCADO_LIVRE_API_BASE}/sites/${input.siteId}/search`, {
        timeout: MERCADO_LIVRE_SEARCH_TIMEOUT_MS,
        headers: buildHeaders(token),
        params: {
          q: input.query || undefined,
          seller_id: input.sellerId || undefined,
          nickname: input.nickname || undefined,
          category: input.categoryId || undefined,
          official_store_id: input.officialStoreId || undefined,
          condition: input.condition || undefined,
          sort: input.sort || undefined,
          offset: input.offset,
          limit: input.limit,
        },
      }),
    );

  return requestSearch(accessToken).catch(async (error) => {
    if (accessToken && isAuthorizationError(error)) {
      return requestSearch(undefined);
    }

    throw error;
  });
}

function normalizeCollectedProductLinks(items: MercadoLivreSearchItem[]) {
  const links = new Set<string>();

  for (const item of items) {
    const normalizedLink = normalizeMercadoLivreImportSource(item.permalink) ?? sanitizeText(item.permalink);
    if (normalizedLink) {
      links.add(normalizedLink);
    }
  }

  return Array.from(links);
}

function appendCollectedItems(
  collected: Map<string, MercadoLivreSearchItem>,
  items: MercadoLivreSearchItem[],
  maxProducts: number | undefined,
) {
  for (const item of items) {
    if (!collected.has(item.id)) {
      collected.set(item.id, item);
    }

    if (maxProducts !== undefined && collected.size >= maxProducts) {
      break;
    }
  }
}

function resolveDesiredPublicSearchItemCount(
  totalResults: number,
  inputOffset: number,
  maxProducts: number | undefined,
) {
  const availableItems = Math.max(0, totalResults - inputOffset);
  if (maxProducts === undefined) {
    return availableItems;
  }

  return Math.min(maxProducts, availableItems);
}

function buildRemainingPublicSearchOffsets(args: {
  inputOffset: number;
  pageSize: number;
  desiredItemCount: number;
}) {
  const offsets: number[] = [];
  const targetEndExclusive = args.inputOffset + args.desiredItemCount;

  for (
    let pageOffset = args.inputOffset + args.pageSize;
    pageOffset < targetEndExclusive;
    pageOffset += args.pageSize
  ) {
    offsets.push(pageOffset);
  }

  return offsets;
}

function chunkItems<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function canUseAuthenticatedSellerScan(input: NormalizedSearchInput, authContext: AuthContext | null) {
  if (!authContext?.accessToken) {
    return false;
  }

  if (
    input.query ||
    input.categoryId ||
    input.officialStoreId ||
    input.condition ||
    input.sort
  ) {
    return false;
  }

  const requestedSellerId = input.sellerId;
  const requestedNickname = input.nickname.toLowerCase();
  const activeSellerId = sanitizeText(authContext.meliUserId);
  const activeNickname = sanitizeText(authContext.meliNickname).toLowerCase();

  return Boolean(
    (requestedSellerId && activeSellerId && requestedSellerId === activeSellerId) ||
      (requestedNickname && activeNickname && requestedNickname === activeNickname),
  );
}

function resolveSellerScanUserId(input: NormalizedSearchInput, authContext: AuthContext) {
  if (input.sellerId && authContext.meliUserId && input.sellerId === authContext.meliUserId) {
    return input.sellerId;
  }

  if (
    input.nickname &&
    authContext.meliNickname &&
    input.nickname.toLowerCase() === authContext.meliNickname.toLowerCase() &&
    authContext.meliUserId
  ) {
    return authContext.meliUserId;
  }

  return authContext.meliUserId ?? "";
}

function resolveMercadoLivreSearchError(error: unknown): never {
  if (error instanceof MercadoLivreSearchError) {
    throw error;
  }

  if (error instanceof AxiosError) {
    const status = error.response?.status ?? 500;

    if (status === 400) {
      throw new MercadoLivreSearchError(
        "Os parametros enviados para a busca do Mercado Livre sao invalidos.",
        400,
      );
    }

    if (status === 401 || status === 403) {
      throw new MercadoLivreSearchError(
        "A API do Mercado Livre recusou a autenticacao da busca autenticada. Revise a credencial ativa em Configuracoes.",
        status,
      );
    }

    if (status === 404) {
      throw new MercadoLivreSearchError(
        "O recurso de busca solicitado nao foi encontrado na API do Mercado Livre.",
        404,
      );
    }

    if (status === 429) {
      throw new MercadoLivreSearchError(
        "A API do Mercado Livre limitou temporariamente a busca. Tente novamente em instantes.",
        429,
      );
    }
  }

  throw new MercadoLivreSearchError("Nao foi possivel consultar os produtos do Mercado Livre.", 500);
}

async function collectPublicSearchItems(
  input: NormalizedSearchInput,
  accessToken: string | undefined,
  maxProducts: number | undefined,
  onProgress?: (update: MercadoLivreSearchCollectUpdate) => void,
): Promise<CollectedMercadoLivreSearchItems> {
  const collected = new Map<string, MercadoLivreSearchItem>();
  let pagesScanned = 0;

  const firstPageInput: NormalizedSearchInput = {
    ...input,
    limit: input.limit,
    offset: input.offset,
  };
  const firstPageResponse = await fetchSiteSearchResponse(firstPageInput, accessToken);
  const firstPageItems = mapSearchItems(firstPageResponse.data.results ?? []);
  const totalResults =
    parsePositiveNumber(firstPageResponse.data.paging?.total) ?? firstPageItems.length;
  const resolvedOffset =
    parsePositiveNumber(firstPageResponse.data.paging?.offset) ?? firstPageInput.offset;
  const resolvedLimit =
    parsePositiveNumber(firstPageResponse.data.paging?.limit) ?? firstPageInput.limit;
  const totalPages =
    totalResults > 0 ? Math.max(1, Math.ceil(totalResults / Math.max(1, resolvedLimit))) : 1;
  const desiredItemCount = resolveDesiredPublicSearchItemCount(
    totalResults,
    input.offset,
    maxProducts,
  );

  appendCollectedItems(collected, firstPageItems, maxProducts);
  pagesScanned += 1;

  onProgress?.({
    strategy: "public-search",
    scannedPages: pagesScanned,
    totalPages,
    totalResults,
    discoveredProducts: collected.size,
    currentOffset: resolvedOffset,
    currentReference: `offset:${resolvedOffset}`,
  });

  const hasMorePages =
    desiredItemCount > firstPageItems.length &&
    firstPageItems.length > 0 &&
    resolvedOffset + resolvedLimit < totalResults;

  if (hasMorePages) {
    const remainingOffsets = buildRemainingPublicSearchOffsets({
      inputOffset: input.offset,
      pageSize: resolvedLimit,
      desiredItemCount,
    });
    const targetEndExclusive = input.offset + desiredItemCount;

    for (const offsetChunk of chunkItems(
      remainingOffsets,
      MERCADO_LIVRE_PUBLIC_SEARCH_COLLECT_CONCURRENCY,
    )) {
      const pageResults = await Promise.all(
        offsetChunk.map(async (pageOffset) => {
          const pageLimit = Math.min(input.limit, Math.max(1, targetEndExclusive - pageOffset));
          const pageInput: NormalizedSearchInput = {
            ...input,
            offset: pageOffset,
            limit: pageLimit,
          };
          const response = await fetchSiteSearchResponse(pageInput, accessToken);

          return {
            pageOffset,
            items: mapSearchItems(response.data.results ?? []),
          };
        }),
      );

      pageResults.sort((left, right) => left.pageOffset - right.pageOffset);

      for (const pageResult of pageResults) {
        appendCollectedItems(collected, pageResult.items, maxProducts);
        pagesScanned += 1;

        onProgress?.({
          strategy: "public-search",
          scannedPages: pagesScanned,
          totalPages,
          totalResults,
          discoveredProducts: collected.size,
          currentOffset: pageResult.pageOffset,
          currentReference: `offset:${pageResult.pageOffset}`,
        });

        if (pageResult.items.length === 0) {
          break;
        }

        if (maxProducts !== undefined && collected.size >= maxProducts) {
          break;
        }
      }

      if (maxProducts !== undefined && collected.size >= maxProducts) {
        break;
      }
    }
  }

  const items = Array.from(collected.values());

  return {
    strategy: "public-search",
    siteId: input.siteId,
    query: input.query,
    sellerId: input.sellerId || undefined,
    nickname: input.nickname || undefined,
    categoryId: input.categoryId || undefined,
    officialStoreId: input.officialStoreId || undefined,
    condition: input.condition || undefined,
    sort: input.sort || undefined,
    pagesScanned,
    totalPages,
    totalResults: totalResults ?? items.length,
    items,
    productLinks: normalizeCollectedProductLinks(items),
  };
}

async function collectSellerItemsByScan(
  input: NormalizedSearchInput,
  authContext: AuthContext,
  maxProducts: number | undefined,
  onProgress?: (update: MercadoLivreSearchCollectUpdate) => void,
): Promise<CollectedMercadoLivreSearchItems> {
  const sellerUserId = resolveSellerScanUserId(input, authContext);
  if (!sellerUserId) {
    return collectPublicSearchItems(input, authContext.accessToken, maxProducts, onProgress);
  }

  const collected = new Map<string, MercadoLivreSearchItem>();
  const seenScrollIds = new Set<string>();
  let scrollId: string | undefined;
  let pagesScanned = 0;

  while (true) {
    const remainingProducts =
      maxProducts === undefined ? MERCADO_LIVRE_USER_SCAN_LIMIT : Math.max(0, maxProducts - collected.size);
    const pageLimit = Math.max(
      1,
      Math.min(MERCADO_LIVRE_USER_SCAN_LIMIT, remainingProducts || MERCADO_LIVRE_USER_SCAN_LIMIT),
    );

    const response = await requestWithRetry(() =>
      axios.get<RawUserItemsSearchResponse>(
        `${MERCADO_LIVRE_API_BASE}/users/${sellerUserId}/items/search`,
        {
          timeout: MERCADO_LIVRE_SEARCH_TIMEOUT_MS,
          headers: buildHeaders(authContext.accessToken),
          params: {
            search_type: "scan",
            status: "active",
            limit: pageLimit,
            scroll_id: scrollId || undefined,
          },
        },
      ),
    );

    const itemIds = (response.data.results ?? [])
      .map((itemId) => sanitizeText(itemId))
      .filter(Boolean);
    const nextScrollId = sanitizeText(response.data.scroll_id) || undefined;

    pagesScanned += 1;

    const multigetMap = await multigetItems(itemIds, authContext.accessToken);
    for (const itemId of itemIds) {
      const item = multigetMap.get(itemId);
      if (!item || collected.has(item.id)) {
        continue;
      }

      collected.set(item.id, item);
      if (maxProducts !== undefined && collected.size >= maxProducts) {
        break;
      }
    }

    onProgress?.({
      strategy: "seller-scan",
      scannedPages: pagesScanned,
      discoveredProducts: collected.size,
      currentScrollId: nextScrollId,
      currentReference: itemIds[0] || nextScrollId || sellerUserId,
    });

    if (itemIds.length === 0) {
      break;
    }

    if (maxProducts !== undefined && collected.size >= maxProducts) {
      break;
    }

    if (!nextScrollId || seenScrollIds.has(nextScrollId)) {
      break;
    }

    seenScrollIds.add(nextScrollId);
    scrollId = nextScrollId;
  }

  const items = Array.from(collected.values());

  return {
    strategy: "seller-scan",
    siteId: input.siteId || authContext.siteId || "MLB",
    query: input.query,
    sellerId: input.sellerId || sellerUserId,
    nickname: input.nickname || authContext.meliNickname || undefined,
    categoryId: input.categoryId || undefined,
    officialStoreId: input.officialStoreId || undefined,
    condition: input.condition || undefined,
    sort: input.sort || undefined,
    pagesScanned,
    totalResults: items.length,
    items,
    productLinks: normalizeCollectedProductLinks(items),
  };
}

export async function searchMercadoLivreItems(
  input: MercadoLivreSearchQuery,
): Promise<MercadoLivreSearchResponse> {
  const normalizedInput = normalizeSearchInput(input);
  assertHasSearchCriteria(normalizedInput);

  const cacheKey = buildSearchCacheKey(normalizedInput);
  const cached = readSearchCache(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetchSiteSearchResponse(normalizedInput);
    const results = await hydrateSearchResults(response.data.results ?? []);

    const searchResponse: MercadoLivreSearchResponse = {
      siteId: normalizedInput.siteId,
      query: normalizedInput.query,
      sellerId: normalizedInput.sellerId || undefined,
      nickname: normalizedInput.nickname || undefined,
      categoryId: normalizedInput.categoryId || undefined,
      officialStoreId: normalizedInput.officialStoreId || undefined,
      condition: normalizedInput.condition || undefined,
      sort: normalizedInput.sort || undefined,
      paging: {
        total: parsePositiveNumber(response.data.paging?.total) ?? results.length,
        offset: parsePositiveNumber(response.data.paging?.offset) ?? normalizedInput.offset,
        limit: parsePositiveNumber(response.data.paging?.limit) ?? normalizedInput.limit,
        hasMore:
          (parsePositiveNumber(response.data.paging?.offset) ?? normalizedInput.offset) +
            (parsePositiveNumber(response.data.paging?.limit) ?? normalizedInput.limit) <
          (parsePositiveNumber(response.data.paging?.total) ?? results.length),
      },
      results,
      availableFilters: mapFilters(response.data.available_filters),
      availableSorts: mapSorts(response.data.available_sorts),
    };

    writeSearchCache(cacheKey, searchResponse);
    return searchResponse;
  } catch (error) {
    resolveMercadoLivreSearchError(error);
  }
}

export async function collectMercadoLivreSearchItems(
  input: CollectMercadoLivreSearchItemsInput,
): Promise<CollectedMercadoLivreSearchItems> {
  const normalizedInput = normalizeSearchInput(input);
  const maxProducts = normalizeMaxProducts(input.maxProducts);
  assertHasSearchCriteria(normalizedInput);

  try {
    const authContext = await getOptionalAuthContext();

    if (canUseAuthenticatedSellerScan(normalizedInput, authContext)) {
      try {
        return await collectSellerItemsByScan(
          normalizedInput,
          authContext as AuthContext,
          maxProducts,
          input.onProgress,
        );
      } catch (error) {
        if (!isAuthorizationError(error)) {
          throw error;
        }
      }
    }

    return await collectPublicSearchItems(
      normalizedInput,
      undefined,
      maxProducts,
      input.onProgress,
    );
  } catch (error) {
    resolveMercadoLivreSearchError(error);
  }
}

export async function collectMercadoLivreSearchItemsFromUrl(
  rawUrl: string,
  options?: Omit<CollectMercadoLivreSearchItemsInput, "query" | "siteId">,
): Promise<CollectedMercadoLivreSearchUrlItems> {
  const searchUrlInfo = parseMercadoLivreSearchUrl(rawUrl);
  if (!searchUrlInfo) {
    throw new MercadoLivreSearchError(
      "Informe uma URL de busca publica do Mercado Livre, como https://lista.mercadolivre.com.br/tenis-nike.",
      400,
    );
  }

  const collected = await collectMercadoLivreSearchItems({
    ...options,
    siteId: searchUrlInfo.siteId,
    query: searchUrlInfo.searchTerm,
    limit: options?.limit ?? MERCADO_LIVRE_PUBLIC_SEARCH_LIMIT,
  });

  return {
    ...collected,
    sourceUrl: searchUrlInfo.sourceUrl,
    normalizedUrl: searchUrlInfo.normalizedUrl,
    searchTerm: searchUrlInfo.searchTerm,
    apiQuery: searchUrlInfo.apiQuery,
  };
}
