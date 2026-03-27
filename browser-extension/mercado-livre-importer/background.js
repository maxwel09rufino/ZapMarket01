const TAB_STATE_STORAGE_KEY = "zapmarket_meli_tab_state";
const LIST_JOB_STORAGE_KEY = "zapmarket_meli_list_job";
const TAB_STATE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_IMPORT_DELAY_MS = 900;

const runtimeState = {
  importLoopRunning: false,
};

function sanitizeText(value) {
  return String(value ?? "").trim();
}

function normalizeServerUrl(value) {
  return sanitizeText(value).replace(/\/+$/g, "");
}

function normalizeComparableUrl(value) {
  const normalizedValue = sanitizeText(value);
  if (!normalizedValue) {
    return "";
  }

  try {
    const parsed = new URL(normalizedValue);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return normalizedValue;
  }
}

function isMercadoLivreUrl(value) {
  try {
    const parsed = new URL(String(value ?? "").trim());
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "meli.la" ||
      hostname.endsWith(".meli.la") ||
      hostname === "mercadolivre.com" ||
      hostname.endsWith(".mercadolivre.com") ||
      hostname === "mercadolivre.com.br" ||
      hostname.endsWith(".mercadolivre.com.br") ||
      hostname === "mercadolibre.com" ||
      hostname.endsWith(".mercadolibre.com")
    );
  } catch {
    return false;
  }
}

function isMercadoLivreShortLink(value) {
  try {
    const parsed = new URL(String(value ?? "").trim());
    const hostname = parsed.hostname.toLowerCase();
    return hostname === "meli.la" || hostname.endsWith(".meli.la");
  } catch {
    return false;
  }
}

function extractMercadoLivreItemId(value) {
  const normalizedValue = sanitizeText(value).toUpperCase();
  if (!normalizedValue) {
    return "";
  }

  const match = normalizedValue.match(/MLB[-_]?\d{6,}/);
  return match ? match[0].replace(/[-_]/g, "") : "";
}

function pruneTabStateMap(stateMap) {
  const now = Date.now();
  const prunedEntries = Object.entries(stateMap ?? {}).filter(([, entry]) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }

    return now - Number(entry.updatedAt ?? 0) <= TAB_STATE_TTL_MS;
  });

  return Object.fromEntries(prunedEntries);
}

async function readTabStateMap() {
  const storage = await chrome.storage.session.get(TAB_STATE_STORAGE_KEY);
  return pruneTabStateMap(storage[TAB_STATE_STORAGE_KEY]);
}

async function writeTabStateMap(stateMap) {
  await chrome.storage.session.set({
    [TAB_STATE_STORAGE_KEY]: pruneTabStateMap(stateMap),
  });
}

async function updateTabStateMap(updater) {
  const currentState = await readTabStateMap();
  const nextState = updater({ ...currentState });
  await writeTabStateMap(nextState);
  return nextState;
}

function uniqueUrls(urls) {
  const normalized = [];
  const seen = new Set();

  for (const value of urls ?? []) {
    const candidate = sanitizeText(value);
    if (!candidate || !isMercadoLivreUrl(candidate)) {
      continue;
    }

    const key = normalizeComparableUrl(candidate);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(candidate);
  }

  return normalized;
}

function randomId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function clampPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.max(1, Math.trunc(parsed));
}

function parseOptionalNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTagList(value) {
  return sanitizeText(value)
    .split(",")
    .map((entry) => sanitizeText(entry))
    .filter((entry, index, items) => entry && items.indexOf(entry) === index);
}

function buildQueueEntries(urls) {
  return urls.map((url) => ({
    id: randomId("meli-source"),
    sourceUrl: url,
    currentPageUrl: url,
    status: "pending",
    pagesScanned: 0,
    totalPages: 0,
    totalResults: 0,
    collectedProducts: 0,
    error: "",
    lastMessage: "Aguardando...",
  }));
}

function createEmptyImportState() {
  return {
    status: "idle",
    currentIndex: -1,
    processed: 0,
    importedCount: 0,
    failedCount: 0,
    delayMs: DEFAULT_IMPORT_DELAY_MS,
    serverUrl: "",
    message: "Aguardando importacao.",
    error: "",
  };
}

function createListJob(input) {
  return {
    id: randomId("meli-job"),
    workerTabId: input.workerTabId,
    workerTabCreated: Boolean(input.workerTabCreated),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: {
      maxProducts: input.maxProducts,
      minPrice: input.minPrice,
      maxPrice: input.maxPrice,
      tags: input.tags,
    },
    collection: {
      status: "running",
      message: "Abrindo a primeira lista...",
      error: "",
      currentQueueIndex: 0,
      queue: buildQueueEntries(input.urls),
      pagesScanned: 0,
      totalPages: 0,
      totalResults: 0,
      completedSources: 0,
    },
    import: createEmptyImportState(),
    products: [],
  };
}

async function readListJob() {
  const storage = await chrome.storage.local.get(LIST_JOB_STORAGE_KEY);
  return storage[LIST_JOB_STORAGE_KEY] ?? null;
}

async function writeListJob(job) {
  if (!job) {
    await chrome.storage.local.remove(LIST_JOB_STORAGE_KEY);
    return null;
  }

  const normalizedJob = {
    ...job,
    updatedAt: Date.now(),
  };

  await chrome.storage.local.set({
    [LIST_JOB_STORAGE_KEY]: normalizedJob,
  });
  return normalizedJob;
}

async function updateListJob(updater) {
  const current = await readListJob();
  const next = updater(current);
  return writeListJob(next);
}

function getCurrentQueueEntry(job) {
  return job?.collection?.queue?.[job.collection.currentQueueIndex] ?? null;
}

function hasNextQueueEntry(job) {
  const currentIndex = Number(job?.collection?.currentQueueIndex ?? -1);
  const queueLength = Number(job?.collection?.queue?.length ?? 0);
  return currentIndex >= 0 && currentIndex < queueLength - 1;
}

function normalizeProductLink(value) {
  const normalizedValue = sanitizeText(value);
  if (!normalizedValue || !isMercadoLivreUrl(normalizedValue)) {
    return "";
  }

  try {
    const parsed = new URL(normalizedValue);
    for (const key of [
      "matt_event_ts",
      "matt_d2id",
      "matt_tracing_id",
      "tracking_id",
      "sid",
      "source",
      "ref",
      "forceInApp",
      "reco_client",
      "reco_backend",
      "reco_backend_type",
      "reco_item_pos",
      "reco_id",
      "c_id",
      "c_uid",
    ]) {
      parsed.searchParams.delete(key);
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    return normalizedValue;
  }
}

function buildProductKey(product) {
  return (
    extractMercadoLivreItemId(product.itemId || product.link || product.sourceUrl) ||
    normalizeComparableUrl(product.link || product.sourceUrl) ||
    `${sanitizeText(product.title).toLowerCase()}::${Number(product.price) || 0}`
  );
}

function passesPriceFilters(product, settings) {
  const price = Number(product.price);
  const hasPrice = Number.isFinite(price) && price > 0;
  if (!hasPrice) {
    return settings.minPrice === undefined && settings.maxPrice === undefined;
  }

  if (settings.minPrice !== undefined && price < settings.minPrice) {
    return false;
  }

  if (settings.maxPrice !== undefined && price > settings.maxPrice) {
    return false;
  }

  return true;
}

function summarizeProducts(products) {
  return products.reduce(
    (summary, product) => {
      summary.importedCount += product.importStatus === "imported" ? 1 : 0;
      summary.failedCount += product.importStatus === "failed" ? 1 : 0;
      return summary;
    },
    {
      importedCount: 0,
      failedCount: 0,
    },
  );
}

function mergeCollectedProducts(existingProducts, incomingProducts, job, sourceUrl, pageUrl) {
  const mergedProducts = [];
  const seen = new Set();

  for (const existingProduct of existingProducts ?? []) {
    const key = buildProductKey(existingProduct);
    if (key && !seen.has(key)) {
      seen.add(key);
      mergedProducts.push(existingProduct);
    }
  }

  for (const product of incomingProducts ?? []) {
    const normalizedProduct = {
      id: sanitizeText(product.id) || undefined,
      itemId:
        sanitizeText(product.itemId) ||
        extractMercadoLivreItemId(product.link || product.sourceUrl) ||
        undefined,
      title:
        sanitizeText(product.title) ||
        sanitizeText(product.itemId) ||
        sanitizeText(product.link) ||
        "Produto sem titulo",
      price: Number.isFinite(Number(product.price)) ? Number(product.price) : 0,
      link: normalizeProductLink(product.link || product.sourceUrl),
      sourceUrl: sanitizeText(sourceUrl),
      pageUrl: sanitizeText(pageUrl),
      image: sanitizeText(product.image),
      rating: sanitizeText(product.rating),
      sales: sanitizeText(product.sales),
      seller: sanitizeText(product.seller),
      shipping: sanitizeText(product.shipping),
      freeShipping: Boolean(product.freeShipping),
      condition: sanitizeText(product.condition),
      tags: [...(job.settings.tags ?? [])],
      importStatus: "pending",
      importMessage: "",
      importedProductId: "",
      collectedAt: new Date().toISOString(),
    };

    if (!normalizedProduct.link || !passesPriceFilters(normalizedProduct, job.settings)) {
      continue;
    }

    const key = buildProductKey(normalizedProduct);
    if (!key || seen.has(key)) {
      continue;
    }

    if (
      job.settings.maxProducts !== undefined &&
      mergedProducts.length >= job.settings.maxProducts
    ) {
      break;
    }

    seen.add(key);
    mergedProducts.push(normalizedProduct);
  }

  return mergedProducts;
}

function recomputeCollectionSummary(job) {
  const queue = job.collection.queue ?? [];
  const pagesScanned = queue.reduce((sum, entry) => sum + Number(entry.pagesScanned ?? 0), 0);
  const totalPages = queue.reduce((sum, entry) => sum + Number(entry.totalPages ?? 0), 0);
  const totalResults = queue.reduce((sum, entry) => sum + Number(entry.totalResults ?? 0), 0);
  const completedSources = queue.filter((entry) => entry.status === "done").length;

  job.collection.pagesScanned = pagesScanned;
  job.collection.totalPages = totalPages;
  job.collection.totalResults = totalResults;
  job.collection.completedSources = completedSources;

  const productSummary = summarizeProducts(job.products);
  job.import.importedCount = productSummary.importedCount;
  job.import.failedCount = productSummary.failedCount;
  job.import.processed = productSummary.importedCount + productSummary.failedCount;

  return job;
}

function isMissingReceiverError(error) {
  const message = sanitizeText(error instanceof Error ? error.message : error);
  return (
    message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection")
  );
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: {
      tabId,
    },
    files: ["content.js"],
  });
}

async function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(
          Object.assign(new Error(runtimeError.message), {
            code: "tab_message_failed",
          }),
        );
        return;
      }

      resolve(response);
    });
  });
}

async function sendMessageToTabWithRecovery(tabId, message) {
  try {
    return await sendMessageToTab(tabId, message);
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }

    await injectContentScript(tabId);

    await delay(150);
    return sendMessageToTab(tabId, message);
  }
}

async function closeWorkerTabIfNeeded(job) {
  if (!job?.workerTabCreated || !Number.isInteger(job.workerTabId)) {
    return;
  }

  try {
    await chrome.tabs.remove(job.workerTabId);
  } catch {
    // Ignore removed tabs.
  }
}

async function openWorkerTab(url) {
  const tab = await chrome.tabs.create({
    url,
    active: false,
  });

  return {
    tabId: tab.id,
    created: true,
  };
}

async function navigateWorkerTab(tabId, url) {
  await chrome.tabs.update(tabId, {
    url,
    active: false,
  });
}

function getRemainingCollectLimit(job) {
  if (job.settings.maxProducts === undefined) {
    return undefined;
  }

  return Math.max(0, job.settings.maxProducts - job.products.length);
}

async function beginQueueNavigation(job, entry, nextUrl, statusMessage) {
  const updatedJob = await updateListJob((currentJob) => {
    if (!currentJob || currentJob.id !== job.id) {
      return currentJob;
    }

    const currentEntry = getCurrentQueueEntry(currentJob);
    if (!currentEntry || currentEntry.id !== entry.id) {
      return currentJob;
    }

    currentEntry.currentPageUrl = nextUrl;
    currentEntry.status = currentJob.collection.status === "paused" ? "paused" : "navigating";
    currentEntry.lastMessage = statusMessage;
    currentJob.collection.message = statusMessage;

    return recomputeCollectionSummary(currentJob);
  });

  if (
    updatedJob &&
    updatedJob.collection.status === "running" &&
    Number.isInteger(updatedJob.workerTabId)
  ) {
    await navigateWorkerTab(updatedJob.workerTabId, nextUrl);
  }

  return updatedJob;
}

async function advanceToNextSource(job, message) {
  const nextQueueIndex = job.collection.currentQueueIndex + 1;
  const nextEntry = job.collection.queue[nextQueueIndex];

  if (!nextEntry) {
    const completedJob = await updateListJob((currentJob) => {
      if (!currentJob || currentJob.id !== job.id) {
        return currentJob;
      }

      currentJob.collection.status = "completed";
      currentJob.collection.message =
        message || `Coleta concluida com ${currentJob.products.length} produto(s).`;
      currentJob.import.message =
        currentJob.products.length > 0
          ? "Produtos prontos para exportacao ou importacao em lote."
          : "Nenhum produto coletado.";
      return recomputeCollectionSummary(currentJob);
    });

    await closeWorkerTabIfNeeded(completedJob);
    return completedJob;
  }

  const updatedJob = await updateListJob((currentJob) => {
    if (!currentJob || currentJob.id !== job.id) {
      return currentJob;
    }

    currentJob.collection.currentQueueIndex = nextQueueIndex;
    nextEntry.currentPageUrl = nextEntry.sourceUrl;
    nextEntry.status = currentJob.collection.status === "paused" ? "paused" : "navigating";
    nextEntry.lastMessage = "Abrindo a proxima lista...";
    currentJob.collection.message = "Abrindo a proxima lista...";
    return recomputeCollectionSummary(currentJob);
  });

  if (
    updatedJob &&
    updatedJob.collection.status === "running" &&
    Number.isInteger(updatedJob.workerTabId)
  ) {
    await navigateWorkerTab(updatedJob.workerTabId, nextEntry.sourceUrl);
  }

  return updatedJob;
}

async function handleCollectionFailure(job, errorMessage) {
  const normalizedMessage =
    sanitizeText(errorMessage) || "Nao foi possivel coletar esta pagina do Mercado Livre.";
  const currentEntry = getCurrentQueueEntry(job);
  if (!currentEntry) {
    return job;
  }

  const updatedJob = await updateListJob((currentJob) => {
    if (!currentJob || currentJob.id !== job.id) {
      return currentJob;
    }

    const entry = getCurrentQueueEntry(currentJob);
    if (!entry || entry.id !== currentEntry.id) {
      return currentJob;
    }

    entry.status = "error";
    entry.error = normalizedMessage;
    entry.lastMessage = normalizedMessage;
    currentJob.collection.message = normalizedMessage;
    currentJob.collection.error = normalizedMessage;
    return recomputeCollectionSummary(currentJob);
  });

  if (updatedJob && hasNextQueueEntry(updatedJob)) {
    return advanceToNextSource(updatedJob, "Continuando a fila apos uma falha.");
  }

  if ((updatedJob?.products?.length ?? 0) > 0) {
    const completedJob = await updateListJob((currentJob) => {
      if (!currentJob || currentJob.id !== job.id) {
        return currentJob;
      }

      currentJob.collection.status = "completed";
      currentJob.collection.message =
        "Coleta encerrada com falhas na ultima URL, mas os produtos ja coletados foram preservados.";
      return recomputeCollectionSummary(currentJob);
    });

    await closeWorkerTabIfNeeded(completedJob);
    return completedJob;
  }

  const failedJob = await updateListJob((currentJob) => {
    if (!currentJob || currentJob.id !== job.id) {
      return currentJob;
    }

    currentJob.collection.status = "error";
    currentJob.collection.error = normalizedMessage;
    currentJob.collection.message = normalizedMessage;
    return recomputeCollectionSummary(currentJob);
  });

  await closeWorkerTabIfNeeded(failedJob);
  return failedJob;
}

async function requestListPageCollection(tabId) {
  const job = await readListJob();
  const currentEntry = getCurrentQueueEntry(job);
  if (
    !job ||
    !currentEntry ||
    job.collection.status !== "running" ||
    job.workerTabId !== tabId ||
    currentEntry.status !== "navigating"
  ) {
    return null;
  }

  const preparedJob = await updateListJob((currentJob) => {
    if (!currentJob || currentJob.id !== job.id) {
      return currentJob;
    }

    const entry = getCurrentQueueEntry(currentJob);
    if (!entry || entry.id !== currentEntry.id || entry.status !== "navigating") {
      return currentJob;
    }

    entry.status = "scraping";
    entry.lastMessage = "Lendo produtos da pagina atual...";
    currentJob.collection.message = "Lendo produtos da pagina atual...";
    return currentJob;
  });

  if (!preparedJob) {
    return null;
  }

  let response;
  try {
    response = await sendMessageToTabWithRecovery(tabId, {
      type: "zapmarket:collect-list-page",
      maxProducts: getRemainingCollectLimit(preparedJob),
      minPrice: preparedJob.settings.minPrice,
      maxPrice: preparedJob.settings.maxPrice,
    });
  } catch (error) {
    return handleCollectionFailure(
      preparedJob,
      error instanceof Error ? error.message : "Falha ao conversar com a aba do Mercado Livre.",
    );
  }

  if (!response?.ok || !response.payload) {
    return handleCollectionFailure(
      preparedJob,
      sanitizeText(response?.error) || "A aba nao conseguiu extrair os produtos desta pagina.",
    );
  }

  const payload = response.payload;
  const finalizedJob = await updateListJob((currentJob) => {
    if (!currentJob || currentJob.id !== preparedJob.id) {
      return currentJob;
    }

    const entry = getCurrentQueueEntry(currentJob);
    if (!entry || entry.id !== currentEntry.id) {
      return currentJob;
    }

    currentJob.products = mergeCollectedProducts(
      currentJob.products,
      payload.products,
      currentJob,
      entry.sourceUrl,
      payload.pageUrl,
    );

    entry.pagesScanned += 1;
    entry.totalPages = Number(payload.totalPages) || entry.totalPages;
    entry.totalResults = Number(payload.totalResults) || entry.totalResults;
    entry.collectedProducts = currentJob.products.length;
    entry.lastMessage =
      sanitizeText(payload.message) ||
      `Pagina ${entry.pagesScanned} lida com ${payload.products.length} produto(s).`;

    currentJob.collection.message = entry.lastMessage;
    currentJob.collection.error = "";
    return recomputeCollectionSummary(currentJob);
  });

  if (!finalizedJob) {
    return null;
  }

  const remainingLimit = getRemainingCollectLimit(finalizedJob);
  const shouldContinue =
    sanitizeText(payload.nextPageUrl) &&
    normalizeComparableUrl(payload.nextPageUrl) !== normalizeComparableUrl(payload.pageUrl) &&
    (remainingLimit === undefined || remainingLimit > 0);

  if (shouldContinue) {
    return beginQueueNavigation(
      finalizedJob,
      getCurrentQueueEntry(finalizedJob),
      payload.nextPageUrl,
      "Avancando para a proxima pagina...",
    );
  }

  const completedJob = await updateListJob((currentJob) => {
    if (!currentJob || currentJob.id !== finalizedJob.id) {
      return currentJob;
    }

    const entry = getCurrentQueueEntry(currentJob);
    if (!entry) {
      return currentJob;
    }

    entry.status = "done";
    entry.lastMessage =
      currentJob.products.length > 0
        ? `Lista concluida com ${currentJob.products.length} produto(s) acumulado(s).`
        : "Lista concluida sem produtos validos.";
    currentJob.collection.message = entry.lastMessage;
    return recomputeCollectionSummary(currentJob);
  });

  return advanceToNextSource(completedJob, "Coleta concluida nesta URL.");
}

async function startListJob(message, sender) {
  const urls = uniqueUrls(message.urls ?? [message.url]);
  if (urls.length === 0) {
    throw new Error("Informe pelo menos uma URL valida do Mercado Livre.");
  }

  const existingJob = await readListJob();
  if (existingJob) {
    await closeWorkerTabIfNeeded(existingJob);
    await writeListJob(null);
  }

  const selectedTabId = Number(message.tabId);
  const useCurrentTab = message.useCurrentTab === true && Number.isInteger(selectedTabId);
  if (message.useCurrentTab === true && !useCurrentTab) {
    throw new Error("Nao foi possivel identificar a aba atual para coletar a lista.");
  }

  const worker = useCurrentTab
    ? {
        tabId: selectedTabId,
        created: false,
      }
    : await openWorkerTab(urls[0]);

  const job = await writeListJob(
    createListJob({
      workerTabId: worker.tabId,
      workerTabCreated: worker.created,
      urls,
      maxProducts:
        message.maxProducts === undefined ? undefined : clampPositiveInteger(message.maxProducts),
      minPrice: parseOptionalNumber(message.minPrice),
      maxPrice: parseOptionalNumber(message.maxPrice),
      tags: parseTagList(message.tags),
    }),
  );

  const firstEntry = getCurrentQueueEntry(job);
  if (!firstEntry) {
    throw new Error("Nao foi possivel preparar a fila de importacao.");
  }

  firstEntry.status = "navigating";
  firstEntry.lastMessage = "Abrindo a primeira lista...";
  await writeListJob(job);

  const currentTabUrl = normalizeComparableUrl(message.currentTabUrl || sender.tab?.url);
  const firstUrl = normalizeComparableUrl(firstEntry.sourceUrl);

  if (useCurrentTab && currentTabUrl && currentTabUrl === firstUrl) {
    await requestListPageCollection(worker.tabId);
    return readListJob();
  }

  await navigateWorkerTab(worker.tabId, firstEntry.sourceUrl);
  return readListJob();
}

async function pauseCollection() {
  return updateListJob((job) => {
    if (!job || job.collection.status !== "running") {
      return job;
    }

    job.collection.status = "paused";
    job.collection.message = "Coleta pausada. Retome quando quiser.";

    const currentEntry = getCurrentQueueEntry(job);
    if (currentEntry && currentEntry.status !== "done" && currentEntry.status !== "error") {
      currentEntry.status = "paused";
      currentEntry.lastMessage = "Pausado.";
    }

    return recomputeCollectionSummary(job);
  });
}

async function resumeCollection() {
  const resumedJob = await updateListJob((job) => {
    if (!job || job.collection.status !== "paused") {
      return job;
    }

    job.collection.status = "running";
    job.collection.message = "Retomando a coleta...";

    const currentEntry = getCurrentQueueEntry(job);
    if (currentEntry && currentEntry.status === "paused") {
      currentEntry.status = "navigating";
      currentEntry.lastMessage = "Retomando...";
    }

    return recomputeCollectionSummary(job);
  });

  if (!resumedJob) {
    return null;
  }

  const currentEntry = getCurrentQueueEntry(resumedJob);
  if (
    resumedJob.collection.status === "running" &&
    currentEntry &&
    Number.isInteger(resumedJob.workerTabId)
  ) {
    await navigateWorkerTab(
      resumedJob.workerTabId,
      currentEntry.currentPageUrl || currentEntry.sourceUrl,
    );
  }

  return readListJob();
}

async function clearListJob() {
  const job = await readListJob();
  if (job) {
    await closeWorkerTabIfNeeded(job);
  }

  await writeListJob(null);
  return null;
}

async function importProductWithDashboard({ sourceUrl, serverUrl }) {
  const normalizedSourceUrl = sanitizeText(sourceUrl);
  const normalizedServerUrl = normalizeServerUrl(serverUrl);

  if (!normalizedSourceUrl) {
    throw new Error("Link do produto nao informado.");
  }

  if (!normalizedServerUrl) {
    throw new Error("URL do painel invalida.");
  }

  const response = await fetch(`${normalizedServerUrl}/api/products/extension/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: normalizedSourceUrl,
      affiliateUrl: normalizedSourceUrl,
      lookupMode: "current",
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      sanitizeText(payload?.error) ||
        sanitizeText(payload?.message) ||
        "Nao foi possivel importar o produto no ZapMarket.",
    );
  }

  return payload;
}

async function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function findNextImportIndex(products, startIndex) {
  for (let index = Math.max(0, startIndex); index < products.length; index += 1) {
    if (products[index]?.importStatus !== "imported") {
      return index;
    }
  }

  return -1;
}

async function runImportLoop() {
  if (runtimeState.importLoopRunning) {
    return;
  }

  runtimeState.importLoopRunning = true;

  try {
    while (true) {
      const job = await readListJob();
      if (!job || job.import.status !== "running") {
        break;
      }

      const nextIndex = findNextImportIndex(job.products, job.import.currentIndex + 1);
      if (nextIndex < 0) {
        await updateListJob((currentJob) => {
          if (!currentJob) {
            return currentJob;
          }

          currentJob.import.status = "completed";
          currentJob.import.message = "Importacao em lote concluida.";
          currentJob.import.error = "";
          return recomputeCollectionSummary(currentJob);
        });
        break;
      }

      const preparedJob = await updateListJob((currentJob) => {
        if (!currentJob) {
          return currentJob;
        }

        const currentProduct = currentJob.products[nextIndex];
        if (!currentProduct) {
          return currentJob;
        }

        currentJob.import.currentIndex = nextIndex;
        currentJob.import.message = `Importando ${nextIndex + 1} de ${currentJob.products.length}...`;
        currentProduct.importStatus = "running";
        currentProduct.importMessage = "Enviando para o painel...";
        return recomputeCollectionSummary(currentJob);
      });

      if (!preparedJob) {
        break;
      }

      const product = preparedJob.products[nextIndex];
      try {
        const payload = await importProductWithDashboard({
          sourceUrl: product.link,
          serverUrl: preparedJob.import.serverUrl,
        });

        await updateListJob((currentJob) => {
          if (!currentJob) {
            return currentJob;
          }

          const currentProduct = currentJob.products[nextIndex];
          if (!currentProduct) {
            return currentJob;
          }

          currentProduct.importStatus = "imported";
          currentProduct.importMessage =
            sanitizeText(payload?.message) || "Produto importado com sucesso.";
          currentProduct.importedProductId = sanitizeText(payload?.product?.id);
          currentJob.import.message = currentProduct.importMessage;
          currentJob.import.error = "";
          return recomputeCollectionSummary(currentJob);
        });
      } catch (error) {
        await updateListJob((currentJob) => {
          if (!currentJob) {
            return currentJob;
          }

          const currentProduct = currentJob.products[nextIndex];
          if (!currentProduct) {
            return currentJob;
          }

          currentProduct.importStatus = "failed";
          currentProduct.importMessage =
            error instanceof Error
              ? error.message
              : "Nao foi possivel importar este produto.";
          currentJob.import.message = currentProduct.importMessage;
          currentJob.import.error = currentProduct.importMessage;
          return recomputeCollectionSummary(currentJob);
        });
      }

      const latestJob = await readListJob();
      if (!latestJob || latestJob.import.status !== "running") {
        break;
      }

      await delay(clampPositiveInteger(latestJob.import.delayMs, DEFAULT_IMPORT_DELAY_MS));
    }
  } finally {
    runtimeState.importLoopRunning = false;
  }
}

async function startBatchImport(message) {
  const normalizedServerUrl = normalizeServerUrl(message.serverUrl);
  if (!normalizedServerUrl) {
    throw new Error("Defina a URL do painel antes de importar em lote.");
  }

  const currentJob = await readListJob();
  if (!currentJob || (currentJob.products?.length ?? 0) === 0) {
    throw new Error("Colete pelo menos um produto antes de importar em lote.");
  }

  const job = await updateListJob((currentJob) => {
    if (!currentJob || (currentJob.products?.length ?? 0) === 0) {
      return currentJob;
    }

    currentJob.import.status = "running";
    currentJob.import.serverUrl = normalizedServerUrl;
    currentJob.import.delayMs = clampPositiveInteger(
      message.delayMs,
      DEFAULT_IMPORT_DELAY_MS,
    );
    currentJob.import.message = "Iniciando importacao em lote...";
    currentJob.import.error = "";
    currentJob.import.currentIndex = -1;

    for (const product of currentJob.products) {
      if (product.importStatus === "running") {
        product.importStatus = "pending";
        product.importMessage = "";
      }
    }

    return recomputeCollectionSummary(currentJob);
  });

  if (!job || job.import.status !== "running") {
    throw new Error("Nao foi possivel iniciar a importacao em lote.");
  }

  void runImportLoop();
  return job;
}

async function pauseBatchImport() {
  return updateListJob((job) => {
    if (!job || job.import.status !== "running") {
      return job;
    }

    job.import.status = "paused";
    job.import.message = "Importacao em lote pausada.";
    return recomputeCollectionSummary(job);
  });
}

async function resumeBatchImport() {
  const resumedJob = await updateListJob((job) => {
    if (!job || job.import.status !== "paused") {
      return job;
    }

    job.import.status = "running";
    job.import.message = "Retomando importacao em lote...";
    job.import.error = "";
    return recomputeCollectionSummary(job);
  });

  if (resumedJob) {
    void runImportLoop();
  }

  return resumedJob;
}

async function handleCommittedNavigation(details) {
  if (details.frameId !== 0 || details.tabId < 0) {
    return;
  }

  const normalizedUrl = sanitizeText(details.url);
  await updateTabStateMap((stateMap) => {
    const tabKey = String(details.tabId);
    const currentEntry = stateMap[tabKey];

    if (isMercadoLivreShortLink(normalizedUrl)) {
      stateMap[tabKey] = {
        shortLink: normalizedUrl,
        currentUrl: normalizedUrl,
        autoImported: false,
        updatedAt: Date.now(),
      };
      return stateMap;
    }

    if (!isMercadoLivreUrl(normalizedUrl)) {
      delete stateMap[tabKey];
      return stateMap;
    }

    if (!currentEntry) {
      return stateMap;
    }

    const previousUrl = normalizeComparableUrl(currentEntry.currentUrl);
    const currentUrl = normalizeComparableUrl(normalizedUrl);
    if (currentEntry.autoImported && previousUrl && previousUrl !== currentUrl) {
      delete stateMap[tabKey];
      return stateMap;
    }

    stateMap[tabKey] = {
      ...currentEntry,
      currentUrl: normalizedUrl,
      updatedAt: Date.now(),
    };
    return stateMap;
  });
}

async function getTabState(tabId) {
  const stateMap = await readTabStateMap();
  return stateMap[String(tabId)] ?? null;
}

async function markTabAsAutoImported(tabId, currentUrl) {
  await updateTabStateMap((stateMap) => {
    const tabKey = String(tabId);
    const currentEntry = stateMap[tabKey];
    if (!currentEntry) {
      return stateMap;
    }

    stateMap[tabKey] = {
      ...currentEntry,
      autoImported: true,
      currentUrl: sanitizeText(currentUrl) || currentEntry.currentUrl,
      updatedAt: Date.now(),
    };
    return stateMap;
  });
}

chrome.webNavigation.onCommitted.addListener((details) => {
  void handleCommittedNavigation(details);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void updateTabStateMap((stateMap) => {
    delete stateMap[String(tabId)];
    return stateMap;
  });

  void updateListJob((job) => {
    if (!job || job.workerTabId !== tabId) {
      return job;
    }

    job.workerTabId = null;
    job.workerTabCreated = false;

    if (job.collection.status === "running" || job.collection.status === "paused") {
      job.collection.status = "error";
      job.collection.error = "A aba usada para a coleta foi fechada.";
      job.collection.message = job.collection.error;
    }

    return recomputeCollectionSummary(job);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "zapmarket:get-tab-state") {
    void (async () => {
      try {
        const tabId = Number(message.tabId ?? sender.tab?.id);
        const tabState = Number.isInteger(tabId) ? await getTabState(tabId) : null;
        sendResponse({ ok: true, tabState });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao ler o estado da aba.",
        });
      }
    })();

    return true;
  }

  if (message?.type === "zapmarket:mark-auto-imported") {
    void (async () => {
      try {
        const tabId = Number(message.tabId ?? sender.tab?.id);
        if (Number.isInteger(tabId)) {
          await markTabAsAutoImported(tabId, message.currentUrl);
        }

        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao atualizar o estado da aba.",
        });
      }
    })();

    return true;
  }

  if (message?.type === "zapmarket:import-product") {
    void (async () => {
      try {
        const payload = await importProductWithDashboard({
          sourceUrl: message.sourceUrl,
          serverUrl: message.serverUrl,
        });
        sendResponse({ ok: true, payload });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao importar produto.",
        });
      }
    })();

    return true;
  }

  if (message?.type === "zapmarket:start-list-job") {
    void (async () => {
      try {
        const job = await startListJob(message, sender);
        sendResponse({ ok: true, job });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao iniciar a coleta.",
        });
      }
    })();

    return true;
  }

  if (message?.type === "zapmarket:get-list-job") {
    void (async () => {
      try {
        sendResponse({
          ok: true,
          job: await readListJob(),
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao ler o estado da coleta.",
        });
      }
    })();

    return true;
  }

  if (message?.type === "zapmarket:pause-list-job") {
    void (async () => {
      try {
        sendResponse({
          ok: true,
          job: await pauseCollection(),
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao pausar a coleta.",
        });
      }
    })();

    return true;
  }

  if (message?.type === "zapmarket:resume-list-job") {
    void (async () => {
      try {
        sendResponse({
          ok: true,
          job: await resumeCollection(),
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao retomar a coleta.",
        });
      }
    })();

    return true;
  }

  if (message?.type === "zapmarket:clear-list-job") {
    void (async () => {
      try {
        await clearListJob();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao limpar a coleta.",
        });
      }
    })();

    return true;
  }

  if (message?.type === "zapmarket:start-batch-import") {
    void (async () => {
      try {
        const job = await startBatchImport(message);
        sendResponse({ ok: true, job });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao iniciar a importacao em lote.",
        });
      }
    })();

    return true;
  }

  if (message?.type === "zapmarket:pause-batch-import") {
    void (async () => {
      try {
        sendResponse({
          ok: true,
          job: await pauseBatchImport(),
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao pausar a importacao em lote.",
        });
      }
    })();

    return true;
  }

  if (message?.type === "zapmarket:resume-batch-import") {
    void (async () => {
      try {
        sendResponse({
          ok: true,
          job: await resumeBatchImport(),
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao retomar a importacao em lote.",
        });
      }
    })();

    return true;
  }

  if (message?.type === "zapmarket:content-ready") {
    void (async () => {
      try {
        const tabId = Number(sender.tab?.id);
        if (!Number.isInteger(tabId)) {
          sendResponse({ ok: false, error: "Aba invalida." });
          return;
        }

        await requestListPageCollection(tabId);
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao processar a aba.",
        });
      }
    })();

    return true;
  }

  return false;
});
