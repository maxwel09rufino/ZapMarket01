import { randomUUID } from "node:crypto";
import { isMercadoLivreShortLink, resolveMercadoLivreProductLinks } from "@/lib/meli/affiliate";
import { resolveMercadoLivreVisibleCouponData } from "@/lib/meli/coupons";
import type {
  ProductImportJobPhase,
  ProductImportJobSnapshot,
  ProductImportJobSourceType,
} from "@/lib/products/import";
import { fetchMercadoLivreProductByConfiguredApi } from "@/lib/products/mercadoLivreConfigured";
import {
  discoverMercadoLivreListProductLinks,
  ProductListImportError,
} from "@/lib/products/mercadoLivreList";
import { buildProductMarketingMessage } from "@/lib/products/message";
import { extractMercadoLivreItemIdFromUrl, normalizeMercadoLivreItemId } from "@/lib/products/mercadoLivreLink";
import {
  collectMercadoLivreSearchItemsFromUrl,
  MercadoLivreSearchError,
} from "@/lib/products/mercadoLivreSearch";
import {
  isMercadoLivreSearchUrl,
  parseMercadoLivreSearchUrl,
} from "@/lib/products/mercadoLivreSearchLink";
import {
  normalizeMercadoLivreImportSource,
  normalizeMercadoLivreShortImportSource,
} from "@/lib/products/importSource";
import {
  createProduct,
  getProductByItemId,
  getProductByLink,
  listProducts,
  ProductValidationError,
  updateProductById,
  type CreateProductInput,
} from "@/lib/products/store";

const MAX_RECENT_IMPORT_ERRORS = 10;
const PRODUCT_IMPORT_CONCURRENCY = 4;
const MAX_IMPORT_PRODUCTS = 200;

type ProductImportQueueEntry = {
  sourceUrl: string;
  shortLink?: string;
  position?: number;
};

type MutableProductImportJob = ProductImportJobSnapshot & {
  startedAtDate: Date;
  finishedAtDate?: Date;
};

type ProductImportQueueState = {
  latestJobId: string | null;
  jobs: Map<string, MutableProductImportJob>;
};

const globalForProductImportQueue = globalThis as typeof globalThis & {
  productImportQueueState?: ProductImportQueueState;
};

const productImportQueueState =
  globalForProductImportQueue.productImportQueueState ??
  (globalForProductImportQueue.productImportQueueState = {
    latestJobId: null,
    jobs: new Map<string, MutableProductImportJob>(),
  });

export class ProductImportConflictError extends Error {}

function sanitizeText(value: string | undefined | null) {
  return String(value ?? "").trim();
}

function getLatestMutableJob() {
  if (!productImportQueueState.latestJobId) {
    return null;
  }

  return productImportQueueState.jobs.get(productImportQueueState.latestJobId) ?? null;
}

function toSnapshot(job: MutableProductImportJob): ProductImportJobSnapshot {
  const { startedAtDate, finishedAtDate, ...publicJob } = job;

  return {
    ...publicJob,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate?.toISOString(),
  };
}

function setJobMessage(job: MutableProductImportJob, message: string) {
  job.message = message;
}

function pushRecentError(job: MutableProductImportJob, errorMessage: string) {
  job.recentErrors = [errorMessage, ...job.recentErrors].slice(0, MAX_RECENT_IMPORT_ERRORS);
}

function buildCompletionMessage(job: MutableProductImportJob) {
  return `Importacao HTML concluida: ${job.importedCount} importado(s), ${job.skippedCount} ignorado(s), ${job.failedCount} falha(s).`;
}

function markJobCompleted(job: MutableProductImportJob, message: string) {
  job.status = "completed";
  job.phase = "completed";
  job.finishedAtDate = new Date();
  job.finishedAt = job.finishedAtDate.toISOString();
  job.currentProductUrl = undefined;
  job.currentProductTitle = undefined;
  setJobMessage(job, message);
}

function markJobFailed(job: MutableProductImportJob, message: string) {
  job.status = "failed";
  job.phase = "failed";
  job.finishedAtDate = new Date();
  job.finishedAt = job.finishedAtDate.toISOString();
  job.currentProductUrl = undefined;
  job.currentProductTitle = undefined;
  setJobMessage(job, message);
  pushRecentError(job, message);
}

function normalizeImportLimit(value: number | undefined) {
  if (value === undefined) {
    return MAX_IMPORT_PRODUCTS;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new ProductValidationError(
      "O limite da importacao precisa ser um numero inteiro maior que zero.",
    );
  }

  return Math.min(MAX_IMPORT_PRODUCTS, value);
}

function buildItemKey(itemId: string | undefined | null) {
  const normalized = normalizeMercadoLivreItemId(itemId);
  return normalized ? `item:${normalized}` : null;
}

function buildLinkKey(link: string | undefined | null) {
  const normalized = normalizeMercadoLivreImportSource(link ?? "");
  return normalized ? `link:${normalized}` : null;
}

function registerKnownProduct(
  existingKeys: Set<string>,
  payload: {
    itemId?: string | null;
    links?: Array<string | undefined | null>;
  },
) {
  const itemKey = buildItemKey(payload.itemId);
  if (itemKey) {
    existingKeys.add(itemKey);
  }

  for (const link of payload.links ?? []) {
    const linkKey = buildLinkKey(link);
    if (linkKey) {
      existingKeys.add(linkKey);
    }
  }
}

function hasKnownProduct(
  existingKeys: Set<string>,
  payload: {
    itemId?: string | null;
    links?: Array<string | undefined | null>;
  },
) {
  const itemKey = buildItemKey(payload.itemId);
  if (itemKey && existingKeys.has(itemKey)) {
    return true;
  }

  return (payload.links ?? []).some((link) => {
    const linkKey = buildLinkKey(link);
    return Boolean(linkKey && existingKeys.has(linkKey));
  });
}

function normalizeMercadoLivreLinksImport(urls: string[], maxProducts: number) {
  const normalizedUrls = new Set<string>();

  for (const rawUrl of urls) {
    const normalizedUrl = normalizeMercadoLivreImportSource(rawUrl);
    if (!normalizedUrl) {
      continue;
    }

    normalizedUrls.add(normalizedUrl);
    if (normalizedUrls.size >= maxProducts) {
      break;
    }
  }

  if (normalizedUrls.size === 0) {
    throw new ProductValidationError(
      "Nenhum link valido do Mercado Livre foi encontrado. Envie URLs de produto, catalogo ou meli.la.",
    );
  }

  return Array.from(normalizedUrls);
}

function normalizeMercadoLivreLinkedEntriesImport(
  entries: Array<{
    originalLink?: string | null;
    shortLink?: string | null;
    position?: number | null;
  }>,
  maxProducts: number,
) {
  const normalizedEntries: ProductImportQueueEntry[] = [];

  for (const [index, rawEntry] of entries.entries()) {
    const lineNumber = rawEntry.position ?? index + 1;
    const sourceUrl = normalizeMercadoLivreImportSource(rawEntry.originalLink ?? "");

    if (!sourceUrl) {
      throw new ProductValidationError(`Linha ${lineNumber} invalida para link do produto.`);
    }

    const rawShortLink = sanitizeText(rawEntry.shortLink);
    const shortLink = rawShortLink ? normalizeMercadoLivreShortImportSource(rawShortLink) : null;
    if (rawShortLink && !shortLink) {
      throw new ProductValidationError(`Linha ${lineNumber} invalida para link afiliado meli.la.`);
    }

    normalizedEntries.push({
      sourceUrl,
      shortLink: shortLink ?? undefined,
      position: lineNumber,
    });

    if (normalizedEntries.length >= maxProducts) {
      break;
    }
  }

  if (normalizedEntries.length === 0) {
    throw new ProductValidationError(
      "Nenhum link valido do Mercado Livre foi encontrado. Envie URLs de produto e os meli.la correspondentes.",
    );
  }

  return normalizedEntries;
}

function createJob(input: {
  sourceUrl: string;
  sourceLabel?: string;
  maxProducts: number;
  sourceType?: ProductImportJobSourceType;
  phase?: ProductImportJobPhase;
  message?: string;
  totalPages?: number;
  totalResults?: number;
  discoveredProducts?: number;
  queuedProducts?: number;
}) {
  const startedAtDate = new Date();
  const job: MutableProductImportJob = {
    id: randomUUID(),
    sourceType: input.sourceType ?? "api",
    sourceUrl: input.sourceUrl,
    normalizedSourceUrl: input.sourceUrl,
    sourceLabel: input.sourceLabel,
    status: "running",
    phase: input.phase ?? "importing",
    message: input.message ?? "Preparando importacao por HTML inteligente...",
    startedAt: startedAtDate.toISOString(),
    startedAtDate,
    maxProducts: input.maxProducts,
    scannedPages: 0,
    totalPages: input.totalPages ?? 1,
    totalResults: input.totalResults ?? input.maxProducts,
    discoveredProducts: input.discoveredProducts ?? input.maxProducts,
    queuedProducts: input.queuedProducts ?? input.maxProducts,
    importedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    processedCount: 0,
    existingProductsAtStart: 0,
    currentPageUrl: undefined,
    currentProductUrl: undefined,
    currentProductTitle: undefined,
    recentErrors: [],
  };

  productImportQueueState.latestJobId = job.id;
  productImportQueueState.jobs.set(job.id, job);
  return job;
}

async function collectExistingProductKeys() {
  const existingProducts = await listProducts();
  const existingKeys = new Set<string>();

  existingProducts.forEach((product) => {
    registerKnownProduct(existingKeys, {
      itemId: product.itemId,
      links: [product.link, product.linkOriginal, product.linkAffiliate, product.linkShort],
    });
  });

  return {
    existingKeys,
    existingProductsAtStart: existingProducts.length,
  };
}

async function buildCreateInput(entry: ProductImportQueueEntry): Promise<CreateProductInput> {
  const fetchedProduct = await fetchMercadoLivreProductByConfiguredApi(entry.sourceUrl);
  const canonicalLink = fetchedProduct.canonicalLink ?? fetchedProduct.link;
  const resolvedLinks = await resolveMercadoLivreProductLinks({
    link: entry.sourceUrl,
    canonicalLink,
    linkOriginal: canonicalLink,
    linkShort:
      entry.shortLink ??
      (isMercadoLivreShortLink(entry.sourceUrl) ? entry.sourceUrl : undefined),
  });
  const preferredLink = resolvedLinks.linkShort || resolvedLinks.linkAffiliate || resolvedLinks.linkOriginal;
  const itemId =
    extractMercadoLivreItemIdFromUrl(canonicalLink) ??
    extractMercadoLivreItemIdFromUrl(entry.sourceUrl) ??
    undefined;
  const fallbackMarketingMessage = buildProductMarketingMessage({
    title: fetchedProduct.title,
    price: fetchedProduct.price,
    link: preferredLink,
  });
  const visibleCouponData = await resolveMercadoLivreVisibleCouponData({
    url: entry.sourceUrl,
    title: fetchedProduct.title,
    price: fetchedProduct.price,
    originalPrice: fetchedProduct.originalPrice,
    hasCouponOrDiscount: fetchedProduct.hasCouponOrDiscount,
    couponLabel: fetchedProduct.couponLabel,
    fallbackMarketingMessage,
  });

  return {
    title: fetchedProduct.title,
    price: fetchedProduct.price,
    originalPrice: fetchedProduct.originalPrice,
    discount: fetchedProduct.discount,
    hasCouponOrDiscount: visibleCouponData.hasCouponOrDiscount,
    couponLabel: visibleCouponData.couponLabel,
    image: fetchedProduct.image,
    images: fetchedProduct.images,
    description: fetchedProduct.description,
    itemId,
    link: preferredLink,
    linkOriginal: resolvedLinks.linkOriginal,
    linkAffiliate: resolvedLinks.linkAffiliate,
    linkShort: resolvedLinks.linkShort,
    position: entry.position,
    marketingMessage: visibleCouponData.marketingMessage,
    marketplace: "mercadolivre",
    seller: fetchedProduct.seller,
  };
}

async function importSingleProduct(
  job: MutableProductImportJob,
  existingKeys: Set<string>,
  entry: ProductImportQueueEntry,
) {
  job.currentProductUrl = entry.shortLink || entry.sourceUrl;
  setJobMessage(job, "Importando produtos pelo HTML inteligente...");

  try {
    const createInput = await buildCreateInput(entry);
    job.currentProductTitle = createInput.title;

    const existingByLink =
      (createInput.itemId ? await getProductByItemId(createInput.itemId) : null) ??
      (await getProductByLink(createInput.linkOriginal ?? createInput.link)) ??
      (createInput.linkShort ? await getProductByLink(createInput.linkShort) : null) ??
      (createInput.linkAffiliate ? await getProductByLink(createInput.linkAffiliate) : null);

    if (
      !existingByLink &&
      hasKnownProduct(existingKeys, {
        itemId: createInput.itemId,
        links: [entry.sourceUrl, entry.shortLink],
      })
    ) {
      job.skippedCount += 1;
      job.processedCount += 1;
      return;
    }

    const savedProduct = existingByLink
      ? await updateProductById(existingByLink.id, createInput)
      : await createProduct(createInput);

    registerKnownProduct(existingKeys, {
      itemId: savedProduct.itemId,
      links: [
        entry.sourceUrl,
        entry.shortLink,
        savedProduct.link,
        savedProduct.linkOriginal,
        savedProduct.linkAffiliate,
        savedProduct.linkShort,
      ],
    });
    job.importedCount += 1;
    job.processedCount += 1;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Falha ao importar produto.";
    job.failedCount += 1;
    job.processedCount += 1;
    pushRecentError(job, `${entry.shortLink || entry.sourceUrl} -> ${errorMessage}`);
  }
}

async function runProductLinksImportJob(job: MutableProductImportJob, productEntries: ProductImportQueueEntry[]) {
  try {
    const { existingKeys, existingProductsAtStart } = await collectExistingProductKeys();
    job.existingProductsAtStart = existingProductsAtStart;
    job.totalResults = productEntries.length;
    job.discoveredProducts = productEntries.length;
    job.queuedProducts = productEntries.length;

    if (productEntries.length === 0) {
      markJobCompleted(job, "Nenhum link importavel foi encontrado.");
      return;
    }

    let nextIndex = 0;
    const requiresDeterministicOrder = productEntries.some((entry) => Boolean(entry.shortLink));
    const workerCount = requiresDeterministicOrder
      ? 1
      : Math.min(PRODUCT_IMPORT_CONCURRENCY, productEntries.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;

          if (currentIndex >= productEntries.length) {
            return;
          }

          await importSingleProduct(job, existingKeys, productEntries[currentIndex]);
        }
      }),
    );

    if (job.status !== "running") {
      return;
    }

    markJobCompleted(job, buildCompletionMessage(job));
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Falha ao importar produtos pelo parser HTML.";
    markJobFailed(job, errorMessage);
  }
}

async function runProductSearchImportJob(job: MutableProductImportJob, sourceUrl: string) {
  try {
    const parsedSearchUrl = parseMercadoLivreSearchUrl(sourceUrl);
    const finishImportFromLinks = async (args: {
      normalizedUrl: string;
      searchTerm?: string;
      totalPages?: number;
      totalResults?: number;
      discoveredProducts: number;
      productLinks: string[];
      message: string;
    }) => {
      job.sourceUrl = sourceUrl;
      job.normalizedSourceUrl = args.normalizedUrl;
      job.sourceLabel =
        job.sourceLabel ||
        (args.searchTerm ? `busca:${args.searchTerm}` : "busca-mercado-livre");
      job.totalPages = args.totalPages;
      job.totalResults = args.totalResults;
      job.discoveredProducts = args.discoveredProducts;
      job.queuedProducts = args.productLinks.length;
      job.currentPageUrl = args.normalizedUrl;
      job.phase = "importing";
      setJobMessage(job, args.message);

      await runProductLinksImportJob(
        job,
        args.productLinks.map((sourceUrl, index) => ({
          sourceUrl,
          position: index + 1,
        })),
      );
    };

    try {
      const collected = await collectMercadoLivreSearchItemsFromUrl(sourceUrl, {
        maxProducts: job.maxProducts,
        onProgress: (update) => {
          job.phase = "scanning";
          job.scannedPages = update.scannedPages;
          job.totalPages = update.totalPages;
          job.totalResults = update.totalResults;
          job.discoveredProducts = update.discoveredProducts;
          job.currentPageUrl =
            update.currentOffset !== undefined
              ? `${sourceUrl}#offset=${update.currentOffset}`
              : sourceUrl;
          setJobMessage(
            job,
            `Buscando produtos pela lista do Mercado Livre: ${update.discoveredProducts} encontrado(s) em ${update.scannedPages} pagina(s).`,
          );
        },
      });

      job.scannedPages = collected.pagesScanned;
      await finishImportFromLinks({
        normalizedUrl: collected.normalizedUrl,
        searchTerm: collected.searchTerm,
        totalPages: collected.totalPages,
        totalResults: collected.totalResults,
        discoveredProducts: collected.items.length,
        productLinks: collected.productLinks,
        message: `Busca concluida para "${collected.searchTerm}". Importando ${collected.productLinks.length} produto(s).`,
      });
      return;
    } catch (error) {
      if (!(error instanceof MercadoLivreSearchError)) {
        throw error;
      }

      setJobMessage(
        job,
        "A leitura principal nao encontrou a lista esperada. Tentando varredura publica completa...",
      );
    }

    const discovered = await discoverMercadoLivreListProductLinks(sourceUrl, {
      maxProducts: job.maxProducts,
      onPageScanned: (update) => {
        job.phase = "scanning";
        job.scannedPages = update.scannedPages;
        job.totalPages = update.totalPages;
        job.totalResults = update.totalResults;
        job.discoveredProducts = update.discoveredProducts;
        job.currentPageUrl = update.pageUrl;
        setJobMessage(
          job,
          `Lendo a lista publica do Mercado Livre: ${update.discoveredProducts} link(s) encontrado(s) em ${update.scannedPages} pagina(s).`,
        );
      },
    });

    job.scannedPages = discovered.pagesScanned;
    await finishImportFromLinks({
      normalizedUrl: discovered.normalizedUrl,
      searchTerm: parsedSearchUrl?.searchTerm,
      totalPages: discovered.totalPages,
      totalResults: discovered.totalResults,
      discoveredProducts: discovered.productLinks.length,
      productLinks: discovered.productLinks,
      message: `Leitura publica concluida para "${parsedSearchUrl?.searchTerm ?? "busca"}". Importando ${discovered.productLinks.length} produto(s).`,
    });
  } catch (error) {
    const errorMessage =
      error instanceof MercadoLivreSearchError ||
      error instanceof ProductListImportError ||
      error instanceof ProductValidationError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Falha ao consultar a lista publica do Mercado Livre.";
    markJobFailed(job, errorMessage);
  }
}

export function getLatestProductImportJob() {
  const latestJob = getLatestMutableJob();
  return latestJob ? toSnapshot(latestJob) : null;
}

export function startMercadoLivreLinksImport(input: {
  urls: string[];
  sourceName?: string;
  maxProducts?: number;
}) {
  const activeJob = getLatestMutableJob();
  if (activeJob && activeJob.status === "running") {
    throw new ProductImportConflictError("Ja existe uma importacao em andamento.");
  }

  const maxProducts = normalizeImportLimit(input.maxProducts);
  const normalizedUrls = normalizeMercadoLivreLinksImport(input.urls, maxProducts);
  const sourceName = sanitizeText(input.sourceName) || "importacao-em-lote";
  const job = createJob({
    sourceUrl: "mercado-livre-api://batch-links",
    sourceLabel: sourceName,
    maxProducts: normalizedUrls.length,
  });

  void runProductLinksImportJob(
    job,
    normalizedUrls.map((sourceUrl, index) => ({
      sourceUrl,
      position: index + 1,
    })),
  );
  return toSnapshot(job);
}

export function startMercadoLivreLinkedImport(input: {
  entries: Array<{
    originalLink?: string | null;
    shortLink?: string | null;
    position?: number | null;
  }>;
  sourceName?: string;
  maxProducts?: number;
}) {
  const activeJob = getLatestMutableJob();
  if (activeJob && activeJob.status === "running") {
    throw new ProductImportConflictError("Ja existe uma importacao em andamento.");
  }

  const maxProducts = normalizeImportLimit(input.maxProducts);
  const normalizedEntries = normalizeMercadoLivreLinkedEntriesImport(input.entries, maxProducts);
  const sourceName = sanitizeText(input.sourceName) || "importacao-afiliada-em-lote";
  const job = createJob({
    sourceUrl: "mercado-livre-api://batch-linked-import",
    sourceLabel: sourceName,
    maxProducts: normalizedEntries.length,
  });

  void runProductLinksImportJob(job, normalizedEntries);
  return toSnapshot(job);
}

export function startMercadoLivreSourceImport(input: {
  sourceUrl: string;
  sourceName?: string;
  maxProducts?: number;
}) {
  const activeJob = getLatestMutableJob();
  if (activeJob && activeJob.status === "running") {
    throw new ProductImportConflictError("Ja existe uma importacao em andamento.");
  }

  const sourceUrl = sanitizeText(input.sourceUrl);
  if (!sourceUrl) {
    throw new ProductValidationError("Informe uma URL de busca do Mercado Livre.");
  }

  if (!isMercadoLivreSearchUrl(sourceUrl)) {
    throw new ProductValidationError(
      "A origem enviada precisa ser uma busca publica do Mercado Livre, como https://lista.mercadolivre.com.br/tenis-nike.",
    );
  }

  const maxProducts = normalizeImportLimit(input.maxProducts);
  const parsedSearchUrl = parseMercadoLivreSearchUrl(sourceUrl);
  const sourceName =
    sanitizeText(input.sourceName) || parsedSearchUrl?.searchTerm || "busca-mercado-livre";
  const job = createJob({
    sourceUrl,
    sourceLabel: sourceName,
    maxProducts,
    phase: "scanning",
    message: "Consultando a lista publica do Mercado Livre...",
    totalPages: 0,
    totalResults: 0,
    discoveredProducts: 0,
    queuedProducts: 0,
  });

  void runProductSearchImportJob(job, sourceUrl);
  return toSnapshot(job);
}
