const DEFAULT_SERVER_URL = "http://localhost:3000";
const SERVER_URL_STORAGE_KEY = "zapmarket_server_url";
const LIST_JOB_POLL_INTERVAL_MS = 1500;
const DEFAULT_BATCH_IMPORT_DELAY_MS = 900;

const state = {
  activeView: "product",
  preview: null,
  currentTabId: null,
  currentTabUrl: "",
  serverUrl: DEFAULT_SERVER_URL,
  isProductBusy: false,
  listJob: null,
  listPollTimer: null,
};

const elements = {
  serverUrl: document.getElementById("serverUrl"),
  saveServerUrl: document.getElementById("saveServerUrl"),
  productTabButton: document.getElementById("productTabButton"),
  listTabButton: document.getElementById("listTabButton"),
  productView: document.getElementById("productView"),
  listView: document.getElementById("listView"),
  productUrl: document.getElementById("productUrl"),
  useCurrentTab: document.getElementById("useCurrentTab"),
  previewButton: document.getElementById("previewButton"),
  importButton: document.getElementById("importButton"),
  statusCard: document.getElementById("statusCard"),
  previewCard: document.getElementById("previewCard"),
  previewImage: document.getElementById("previewImage"),
  previewSeller: document.getElementById("previewSeller"),
  previewTitle: document.getElementById("previewTitle"),
  previewPrice: document.getElementById("previewPrice"),
  previewStatusChip: document.getElementById("previewStatusChip"),
  previewMarketplaceChip: document.getElementById("previewMarketplaceChip"),
  previewExisting: document.getElementById("previewExisting"),
  previewLink: document.getElementById("previewLink"),
  productsLink: document.getElementById("productsLink"),
  listUrls: document.getElementById("listUrls"),
  fillCurrentTabList: document.getElementById("fillCurrentTabList"),
  appendCurrentTabList: document.getElementById("appendCurrentTabList"),
  clearListUrls: document.getElementById("clearListUrls"),
  maxProducts: document.getElementById("maxProducts"),
  tagInput: document.getElementById("tagInput"),
  minPrice: document.getElementById("minPrice"),
  maxPrice: document.getElementById("maxPrice"),
  startCollectionButton: document.getElementById("startCollectionButton"),
  pauseCollectionButton: document.getElementById("pauseCollectionButton"),
  resumeCollectionButton: document.getElementById("resumeCollectionButton"),
  clearCollectionButton: document.getElementById("clearCollectionButton"),
  startImportButton: document.getElementById("startImportButton"),
  pauseImportButton: document.getElementById("pauseImportButton"),
  resumeImportButton: document.getElementById("resumeImportButton"),
  exportCsvButton: document.getElementById("exportCsvButton"),
  exportJsonButton: document.getElementById("exportJsonButton"),
  listStatusCard: document.getElementById("listStatusCard"),
  progressSummary: document.getElementById("progressSummary"),
  progressPill: document.getElementById("progressPill"),
  progressBar: document.getElementById("progressBar"),
  statsGrid: document.getElementById("statsGrid"),
  queueList: document.getElementById("queueList"),
  tableSummary: document.getElementById("tableSummary"),
  resultsTableBody: document.getElementById("resultsTableBody"),
};

function sanitizeText(value) {
  return String(value ?? "").trim();
}

function normalizeServerUrl(value) {
  return sanitizeText(value).replace(/\/+$/g, "") || DEFAULT_SERVER_URL;
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
  return /(?:mercadolivre|mercadolibre|meli\.la)/i.test(sanitizeText(value));
}

function isMercadoLivreShortLink(value) {
  return /^https?:\/\/(?:[\w-]+\.)?meli\.la(?:\/|$)/i.test(sanitizeText(value));
}

function looksLikeMercadoLivreProductUrl(value) {
  const normalizedValue = sanitizeText(value);
  if (!normalizedValue || !isMercadoLivreUrl(normalizedValue)) {
    return false;
  }

  if (isMercadoLivreShortLink(normalizedValue)) {
    return true;
  }

  try {
    const parsed = new URL(normalizedValue);
    return (
      /\/(?:MLB[-_]?\d{6,}|p\/|up\/)/i.test(parsed.pathname) ||
      /(?:^|[?&])(item_id|itemId|wid)=/i.test(parsed.search)
    );
  } catch {
    return false;
  }
}

function parseOptionalPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function parseOptionalNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatCurrency(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "R$ 0,00";
  }

  return numericValue.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  });
}

function formatCount(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  return numericValue.toLocaleString("pt-BR");
}

function parseUrlLines(value) {
  return sanitizeText(value)
    .split(/\r?\n/g)
    .map((line) => sanitizeText(line))
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showStatus(card, message, tone = "info") {
  const text = sanitizeText(message);
  card.textContent = text;
  card.className = `status-card${text ? ` is-${tone}` : ""}${text ? "" : " hidden"}`;
}

function clearStatus(card) {
  showStatus(card, "");
}

function setProductBusy(isBusy) {
  state.isProductBusy = isBusy;
  elements.previewButton.disabled = isBusy;
  elements.importButton.disabled = isBusy || !state.preview;
  elements.useCurrentTab.disabled = isBusy;
  elements.saveServerUrl.disabled = isBusy;
}

function clearPreview() {
  state.preview = null;
  elements.previewCard.classList.add("hidden");
  elements.importButton.disabled = true;
}

function renderPreview(previewResponse) {
  state.preview = previewResponse.preview;

  const preview = previewResponse.preview;
  const existingProduct = previewResponse.existingProduct;
  const imageUrl = sanitizeText(preview.image) || sanitizeText(preview.images?.[0]);

  elements.previewImage.src = imageUrl || "";
  elements.previewImage.classList.toggle("hidden", !imageUrl);
  elements.previewSeller.textContent = sanitizeText(preview.seller) || "Mercado Livre";
  elements.previewTitle.textContent = preview.title;
  elements.previewPrice.textContent = formatCurrency(preview.price);
  elements.previewStatusChip.textContent =
    existingProduct ? "Ja existe no painel" : "Pronto para importar";
  elements.previewMarketplaceChip.textContent = preview.marketplace;
  elements.previewLink.href = preview.link;
  elements.productsLink.href = sanitizeText(previewResponse.productsUrl) || `${state.serverUrl}/produtos`;

  if (existingProduct) {
    elements.previewExisting.textContent = `Produto ja cadastrado: ${existingProduct.title}`;
    elements.previewExisting.classList.remove("hidden");
  } else {
    elements.previewExisting.textContent = "";
    elements.previewExisting.classList.add("hidden");
  }

  elements.previewCard.classList.remove("hidden");
  elements.importButton.disabled = false;
}

function setActiveView(view) {
  state.activeView = view === "list" ? "list" : "product";
  const isProductView = state.activeView === "product";

  elements.productTabButton.classList.toggle("is-active", isProductView);
  elements.listTabButton.classList.toggle("is-active", !isProductView);
  elements.productView.classList.toggle("hidden", !isProductView);
  elements.listView.classList.toggle("hidden", isProductView);
}

function getCollectionStatus(job) {
  return sanitizeText(job?.collection?.status) || "idle";
}

function getImportStatus(job) {
  return sanitizeText(job?.import?.status) || "idle";
}

function deriveListStatusPresentation(job) {
  if (!job) {
    return {
      message: "",
      tone: "info",
    };
  }

  const importError = sanitizeText(job.import?.error);
  const collectionError = sanitizeText(job.collection?.error);
  if (importError || collectionError) {
    return {
      message: importError || collectionError,
      tone: "error",
    };
  }

  const importStatus = getImportStatus(job);
  const collectionStatus = getCollectionStatus(job);
  const message =
    sanitizeText(job.import?.message) ||
    sanitizeText(job.collection?.message) ||
    "Aguardando coleta.";

  if (importStatus === "completed" || collectionStatus === "completed") {
    return {
      message,
      tone: "success",
    };
  }

  if (
    importStatus === "running" ||
    importStatus === "paused" ||
    collectionStatus === "running" ||
    collectionStatus === "paused"
  ) {
    return {
      message,
      tone: "info",
    };
  }

  return {
    message,
    tone: "info",
  };
}

function renderStatsGrid(job) {
  const products = job?.products ?? [];
  const stats = [
    {
      label: "Produtos",
      value: formatCount(products.length),
    },
    {
      label: "Paginas lidas",
      value: formatCount(job?.collection?.pagesScanned ?? 0),
    },
    {
      label: "Fontes concluidas",
      value: `${formatCount(job?.collection?.completedSources ?? 0)}/${formatCount(
        job?.collection?.queue?.length ?? 0,
      )}`,
    },
    {
      label: "Importados",
      value: formatCount(job?.import?.importedCount ?? 0),
    },
    {
      label: "Falhas",
      value: formatCount(job?.import?.failedCount ?? 0),
    },
    {
      label: "Resultados detectados",
      value: formatCount(job?.collection?.totalResults ?? 0),
    },
  ];

  elements.statsGrid.innerHTML = stats
    .map(
      (stat) => `
        <article class="stat-card">
          <span class="stat-value">${escapeHtml(stat.value)}</span>
          <span class="stat-label">${escapeHtml(stat.label)}</span>
        </article>
      `,
    )
    .join("");
}

function renderQueue(job) {
  const queue = job?.collection?.queue ?? [];
  if (queue.length === 0) {
    elements.queueList.innerHTML = '<p class="queue-empty">Nenhuma fila iniciada ainda.</p>';
    return;
  }

  elements.queueList.innerHTML = queue
    .map((entry, index) => {
      const isCurrent = Number(job.collection?.currentQueueIndex) === index;
      const status = sanitizeText(entry.status) || "pending";
      const pagesLabel = entry.totalPages
        ? `${formatCount(entry.pagesScanned)} / ${formatCount(entry.totalPages)} paginas`
        : `${formatCount(entry.pagesScanned)} pagina(s)`;
      const detail = sanitizeText(entry.lastMessage) || "Aguardando...";

      return `
        <article class="queue-item${isCurrent ? " is-current" : ""}">
          <div class="queue-head">
            <span class="queue-status">${escapeHtml(status)}</span>
            <span class="queue-pages">${escapeHtml(pagesLabel)}</span>
          </div>
          <p class="queue-url">${escapeHtml(entry.sourceUrl)}</p>
          <p class="queue-detail">${escapeHtml(detail)}</p>
        </article>
      `;
    })
    .join("");
}

function renderResultsTable(job) {
  const products = job?.products ?? [];
  elements.tableSummary.textContent =
    products.length > 0
      ? `${formatCount(products.length)} produto(s) coletado(s).`
      : "Nenhum item coletado ainda.";

  if (products.length === 0) {
    elements.resultsTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-cell">A coleta ainda nao retornou produtos validos.</td>
      </tr>
    `;
    return;
  }

  elements.resultsTableBody.innerHTML = products
    .map((product) => {
      const status = sanitizeText(product.importStatus) || "pending";
      const shipping = sanitizeText(product.shipping) || (product.freeShipping ? "Frete gratis" : "-");
      const seller = sanitizeText(product.seller) || "-";
      const condition = sanitizeText(product.condition) || "-";

      return `
        <tr>
          <td>
            <div class="cell-title">
              <a href="${escapeHtml(product.link)}" target="_blank" rel="noreferrer">${escapeHtml(product.title)}</a>
              <span>${escapeHtml(
                sanitizeText(product.itemId) || sanitizeText(product.sales) || "Sem ID",
              )}</span>
            </div>
          </td>
          <td>${escapeHtml(formatCurrency(product.price))}</td>
          <td>${escapeHtml(seller)}</td>
          <td>${escapeHtml(shipping)}</td>
          <td>${escapeHtml(condition)}</td>
          <td><span class="table-status is-${escapeHtml(status)}">${escapeHtml(status)}</span></td>
        </tr>
      `;
    })
    .join("");
}

function renderListJob(job) {
  state.listJob = job ?? null;

  const collectionStatus = getCollectionStatus(job);
  const importStatus = getImportStatus(job);
  const isCollectionRunning = collectionStatus === "running";
  const isCollectionPaused = collectionStatus === "paused";
  const isImportRunning = importStatus === "running";
  const isImportPaused = importStatus === "paused";
  const totalSources = Number(job?.collection?.queue?.length ?? 0);
  const completedSources = Number(job?.collection?.completedSources ?? 0);
  const progressRatio = totalSources > 0 ? Math.min(completedSources / totalSources, 1) : 0;

  elements.progressSummary.textContent =
    sanitizeText(job?.collection?.message) ||
    sanitizeText(job?.import?.message) ||
    "Aguardando coleta.";
  elements.progressPill.textContent =
    importStatus !== "idle" && importStatus !== "completed" ? `import ${importStatus}` : collectionStatus;
  elements.progressBar.style.width = `${Math.round(progressRatio * 100)}%`;

  renderStatsGrid(job);
  renderQueue(job);
  renderResultsTable(job);

  const listStatus = deriveListStatusPresentation(job);
  if (listStatus.message) {
    showStatus(elements.listStatusCard, listStatus.message, listStatus.tone);
  } else {
    clearStatus(elements.listStatusCard);
  }

  elements.startCollectionButton.disabled = isCollectionRunning;
  elements.pauseCollectionButton.disabled = !isCollectionRunning;
  elements.resumeCollectionButton.disabled = !isCollectionPaused;
  elements.clearCollectionButton.disabled = !job;
  elements.startImportButton.disabled = isImportRunning || (job?.products?.length ?? 0) === 0;
  elements.pauseImportButton.disabled = !isImportRunning;
  elements.resumeImportButton.disabled = !isImportPaused;
  elements.exportCsvButton.disabled = (job?.products?.length ?? 0) === 0;
  elements.exportJsonButton.disabled = (job?.products?.length ?? 0) === 0;
}

function startListPolling() {
  if (state.listPollTimer !== null) {
    return;
  }

  state.listPollTimer = window.setInterval(() => {
    void refreshListJob({ silent: true });
  }, LIST_JOB_POLL_INTERVAL_MS);
}

function stopListPolling() {
  if (state.listPollTimer === null) {
    return;
  }

  window.clearInterval(state.listPollTimer);
  state.listPollTimer = null;
}

async function readCurrentTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  state.currentTabId = Number.isInteger(tab?.id) ? tab.id : null;
  state.currentTabUrl = sanitizeText(tab?.url);
  return {
    id: state.currentTabId,
    url: state.currentTabUrl,
  };
}

async function saveServerUrl() {
  state.serverUrl = normalizeServerUrl(elements.serverUrl.value);
  elements.serverUrl.value = state.serverUrl;
  await chrome.storage.sync.set({
    [SERVER_URL_STORAGE_KEY]: state.serverUrl,
  });
  showStatus(elements.statusCard, "URL do painel salva.", "success");
}

async function apiRequest(pathname, options = {}) {
  const response = await fetch(`${state.serverUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const errorMessage =
      sanitizeText(payload?.error) ||
      sanitizeText(payload?.message) ||
      "Falha na comunicacao com o painel.";
    throw new Error(errorMessage);
  }

  return payload;
}

async function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve(response);
    });
  });
}

async function refreshListJob(options = {}) {
  try {
    const response = await sendRuntimeMessage({
      type: "zapmarket:get-list-job",
    });

    if (!response?.ok) {
      throw new Error(sanitizeText(response?.error) || "Falha ao ler a fila da extensao.");
    }

    renderListJob(response.job ?? null);

    const shouldKeepPolling =
      getCollectionStatus(response.job) === "running" ||
      getCollectionStatus(response.job) === "paused" ||
      getImportStatus(response.job) === "running" ||
      getImportStatus(response.job) === "paused";

    if (shouldKeepPolling) {
      startListPolling();
    } else {
      stopListPolling();
    }

    return response.job ?? null;
  } catch (error) {
    renderListJob(state.listJob);
    if (!options.silent) {
      showStatus(
        elements.listStatusCard,
        error instanceof Error ? error.message : "Falha ao atualizar o estado da coleta.",
        "error",
      );
    }
    return state.listJob;
  }
}

async function handleUseCurrentTab() {
  const currentTab = await readCurrentTab();
  if (!currentTab.url) {
    showStatus(elements.statusCard, "Nao foi possivel ler a aba atual.", "error");
    return;
  }

  elements.productUrl.value = currentTab.url;
  clearPreview();

  if (isMercadoLivreShortLink(currentTab.url)) {
    await handleAutomaticShortLinkImport(currentTab.url);
    return;
  }

  clearStatus(elements.statusCard);
}

async function handlePreview(auto = false, options = {}) {
  const skipSuccessStatus = options.skipSuccessStatus === true;
  const url = sanitizeText(elements.productUrl.value);
  if (!url) {
    showStatus(elements.statusCard, "Cole um link do Mercado Livre para continuar.", "error");
    return null;
  }

  if (!isMercadoLivreUrl(url)) {
    showStatus(elements.statusCard, "Esse link nao parece ser do Mercado Livre.", "error");
    return null;
  }

  setProductBusy(true);
  clearStatus(elements.statusCard);
  clearPreview();

  try {
    const payload = await apiRequest("/api/products/extension/preview", {
      method: "POST",
      body: JSON.stringify({
        url,
        lookupMode: "current",
      }),
    });

    renderPreview(payload);
    if (!skipSuccessStatus) {
      showStatus(
        elements.statusCard,
        auto
          ? "Produto encontrado automaticamente na aba atual."
          : "Preview carregado. Revise e importe quando quiser.",
        "success",
      );
    }
    return payload;
  } catch (error) {
    showStatus(
      elements.statusCard,
      error instanceof Error ? error.message : "Nao foi possivel gerar o preview.",
      "error",
    );
    return null;
  } finally {
    setProductBusy(false);
  }
}

async function handleImport(options = {}) {
  const skipSuccessStatus = options.skipSuccessStatus === true;
  const successMessage = sanitizeText(options.successMessage);
  if (!state.preview?.id) {
    showStatus(elements.statusCard, "Busque o preview antes de importar.", "error");
    return null;
  }

  setProductBusy(true);
  clearStatus(elements.statusCard);

  try {
    const payload = await apiRequest("/api/products/extension/commit", {
      method: "POST",
      body: JSON.stringify({
        previewId: state.preview.id,
      }),
    });

    if (payload.preview) {
      renderPreview({
        preview: payload.preview,
        productsUrl: `${state.serverUrl}/produtos`,
        existingProduct: payload.created ? undefined : payload.product,
      });
    }

    if (!skipSuccessStatus) {
      showStatus(
        elements.statusCard,
        successMessage || payload.message || "Produto importado com sucesso.",
        "success",
      );
    }
    return payload;
  } catch (error) {
    showStatus(
      elements.statusCard,
      error instanceof Error ? error.message : "Nao foi possivel importar o produto.",
      "error",
    );
    return null;
  } finally {
    setProductBusy(false);
  }
}

async function copyLinkToClipboard(value) {
  const normalizedValue = sanitizeText(value);
  if (!normalizedValue || !navigator.clipboard?.writeText) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(normalizedValue);
    return true;
  } catch {
    return false;
  }
}

async function handleAutomaticShortLinkImport(url) {
  const normalizedUrl = sanitizeText(url);
  if (!normalizedUrl) {
    return null;
  }

  elements.productUrl.value = normalizedUrl;
  const copied = await copyLinkToClipboard(normalizedUrl);
  const previewPayload = await handlePreview(true, {
    skipSuccessStatus: true,
  });
  if (!previewPayload) {
    return null;
  }

  const importPayload = await handleImport({
    skipSuccessStatus: true,
  });
  if (!importPayload) {
    return null;
  }

  showStatus(
    elements.statusCard,
    `${copied ? "Link meli.la copiado." : "Link meli.la detectado."} ${
      importPayload.message || "Produto importado automaticamente."
    }`,
    "success",
  );

  return importPayload;
}

async function fillListUrls(mode) {
  const currentTab = await readCurrentTab();
  if (!currentTab.url || !isMercadoLivreUrl(currentTab.url)) {
    showStatus(
      elements.listStatusCard,
      "Abra uma busca, categoria ou pagina do Mercado Livre para usar a aba atual.",
      "error",
    );
    return;
  }

  const existingUrls = parseUrlLines(elements.listUrls.value);
  const currentUrl = currentTab.url;
  const nextUrls =
    mode === "append"
      ? Array.from(new Set([...existingUrls, currentUrl]))
      : [currentUrl];

  elements.listUrls.value = nextUrls.join("\n");
  showStatus(
    elements.listStatusCard,
    mode === "append" ? "URL da aba atual adicionada na fila." : "URL da aba atual aplicada na fila.",
    "success",
  );
}

function validateListFilters() {
  const minPrice = parseOptionalNumber(elements.minPrice.value);
  const maxPrice = parseOptionalNumber(elements.maxPrice.value);

  if (
    minPrice !== undefined &&
    maxPrice !== undefined &&
    Number.isFinite(minPrice) &&
    Number.isFinite(maxPrice) &&
    minPrice > maxPrice
  ) {
    throw new Error("O preco minimo nao pode ser maior que o preco maximo.");
  }

  return {
    maxProducts: parseOptionalPositiveInteger(elements.maxProducts.value),
    minPrice,
    maxPrice,
    tags: sanitizeText(elements.tagInput.value),
  };
}

async function handleStartCollection() {
  const urls = parseUrlLines(elements.listUrls.value);
  if (urls.length === 0) {
    showStatus(elements.listStatusCard, "Cole pelo menos uma URL de lista do Mercado Livre.", "error");
    return;
  }

  if (urls.some((url) => !isMercadoLivreUrl(url))) {
    showStatus(
      elements.listStatusCard,
      "A fila contem URLs fora do Mercado Livre. Revise antes de continuar.",
      "error",
    );
    return;
  }

  const filters = validateListFilters();
  const currentTab = await readCurrentTab();
  const firstQueueUrl = normalizeComparableUrl(urls[0]);
  const currentTabUrl = normalizeComparableUrl(currentTab.url);

  showStatus(elements.listStatusCard, "Iniciando coleta da fila...", "info");

  const response = await sendRuntimeMessage({
    type: "zapmarket:start-list-job",
    urls,
    tabId: currentTab.id,
    currentTabUrl: currentTab.url,
    useCurrentTab: Boolean(currentTabUrl && currentTabUrl === firstQueueUrl),
    maxProducts: filters.maxProducts,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    tags: filters.tags,
  });

  if (!response?.ok) {
    throw new Error(sanitizeText(response?.error) || "Nao foi possivel iniciar a coleta.");
  }

  renderListJob(response.job ?? null);
  startListPolling();
}

async function handleListJobAction(message, successMessage) {
  const response = await sendRuntimeMessage(message);
  if (!response?.ok) {
    throw new Error(sanitizeText(response?.error) || "Falha ao atualizar a coleta.");
  }

  if (message.type === "zapmarket:clear-list-job") {
    renderListJob(null);
    clearStatus(elements.listStatusCard);
    stopListPolling();
    return;
  }

  renderListJob(response.job ?? null);
  if (successMessage) {
    showStatus(elements.listStatusCard, successMessage, "success");
  }

  const shouldKeepPolling =
    getCollectionStatus(response.job) === "running" ||
    getCollectionStatus(response.job) === "paused" ||
    getImportStatus(response.job) === "running" ||
    getImportStatus(response.job) === "paused";

  if (shouldKeepPolling) {
    startListPolling();
  } else {
    stopListPolling();
  }
}

async function handleStartBatchImport() {
  state.serverUrl = normalizeServerUrl(elements.serverUrl.value);
  elements.serverUrl.value = state.serverUrl;

  const response = await sendRuntimeMessage({
    type: "zapmarket:start-batch-import",
    serverUrl: state.serverUrl,
    delayMs: DEFAULT_BATCH_IMPORT_DELAY_MS,
  });

  if (!response?.ok) {
    throw new Error(sanitizeText(response?.error) || "Nao foi possivel iniciar a importacao em lote.");
  }

  renderListJob(response.job ?? null);
  showStatus(elements.listStatusCard, "Importacao em lote iniciada.", "success");
  startListPolling();
}

function escapeCsvValue(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function downloadBlob(filename, mimeType, contents) {
  const blob = new Blob([contents], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
  }, 0);
}

function buildExportFilename(extension) {
  const dateStamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `zapmarket-mercado-livre-${dateStamp}.${extension}`;
}

function collectUniqueProductLinks(products) {
  return Array.from(
    new Set(
      (products ?? [])
        .map((product) => sanitizeText(product.link))
        .filter(Boolean),
    ),
  );
}

function exportProductsAsCsv(products) {
  const links = collectUniqueProductLinks(products);
  const rows = [
    "link",
    ...links.map((link) => escapeCsvValue(link)),
  ];

  downloadBlob(buildExportFilename("csv"), "text/csv;charset=utf-8", rows.join("\n"));
}

function exportProductsAsJson(products) {
  const links = collectUniqueProductLinks(products);
  downloadBlob(
    buildExportFilename("json"),
    "application/json;charset=utf-8",
    JSON.stringify(links, null, 2),
  );
}

function ensureProductsForExport() {
  const products = state.listJob?.products ?? [];
  if (products.length === 0) {
    throw new Error("Nenhum produto coletado para exportar.");
  }

  return products;
}

async function bootstrap() {
  const storage = await chrome.storage.sync.get(SERVER_URL_STORAGE_KEY);
  state.serverUrl = normalizeServerUrl(storage[SERVER_URL_STORAGE_KEY]);
  elements.serverUrl.value = state.serverUrl;

  renderListJob(null);
  setActiveView("product");

  const currentUrlParam = sanitizeText(new URLSearchParams(window.location.search).get("url"));
  const currentTab = await readCurrentTab();
  const candidateUrl = currentUrlParam || currentTab.url;
  if (candidateUrl) {
    elements.productUrl.value = candidateUrl;
  }

  await refreshListJob({
    silent: true,
  });

  if (isMercadoLivreShortLink(candidateUrl)) {
    await handleAutomaticShortLinkImport(candidateUrl);
    return;
  }

  if (looksLikeMercadoLivreProductUrl(candidateUrl)) {
    await handlePreview(true);
  }
}

elements.saveServerUrl.addEventListener("click", () => {
  void saveServerUrl();
});

elements.productTabButton.addEventListener("click", () => {
  setActiveView("product");
});

elements.listTabButton.addEventListener("click", () => {
  setActiveView("list");
});

elements.useCurrentTab.addEventListener("click", () => {
  void handleUseCurrentTab();
});

elements.previewButton.addEventListener("click", () => {
  const url = sanitizeText(elements.productUrl.value);
  if (isMercadoLivreShortLink(url)) {
    void handleAutomaticShortLinkImport(url);
    return;
  }

  void handlePreview(false);
});

elements.importButton.addEventListener("click", () => {
  void handleImport();
});

elements.productUrl.addEventListener("input", () => {
  clearPreview();
  clearStatus(elements.statusCard);
});

elements.fillCurrentTabList.addEventListener("click", () => {
  void fillListUrls("replace");
});

elements.appendCurrentTabList.addEventListener("click", () => {
  void fillListUrls("append");
});

elements.clearListUrls.addEventListener("click", () => {
  elements.listUrls.value = "";
  clearStatus(elements.listStatusCard);
});

elements.startCollectionButton.addEventListener("click", () => {
  void handleStartCollection().catch((error) => {
    showStatus(
      elements.listStatusCard,
      error instanceof Error ? error.message : "Nao foi possivel iniciar a coleta.",
      "error",
    );
  });
});

elements.pauseCollectionButton.addEventListener("click", () => {
  void handleListJobAction(
    {
      type: "zapmarket:pause-list-job",
    },
    "Coleta pausada.",
  ).catch((error) => {
    showStatus(
      elements.listStatusCard,
      error instanceof Error ? error.message : "Nao foi possivel pausar a coleta.",
      "error",
    );
  });
});

elements.resumeCollectionButton.addEventListener("click", () => {
  void handleListJobAction(
    {
      type: "zapmarket:resume-list-job",
    },
    "Coleta retomada.",
  ).catch((error) => {
    showStatus(
      elements.listStatusCard,
      error instanceof Error ? error.message : "Nao foi possivel retomar a coleta.",
      "error",
    );
  });
});

elements.clearCollectionButton.addEventListener("click", () => {
  void handleListJobAction(
    {
      type: "zapmarket:clear-list-job",
    },
    "",
  ).catch((error) => {
    showStatus(
      elements.listStatusCard,
      error instanceof Error ? error.message : "Nao foi possivel limpar a fila.",
      "error",
    );
  });
});

elements.startImportButton.addEventListener("click", () => {
  void handleStartBatchImport().catch((error) => {
    showStatus(
      elements.listStatusCard,
      error instanceof Error ? error.message : "Nao foi possivel iniciar a importacao.",
      "error",
    );
  });
});

elements.pauseImportButton.addEventListener("click", () => {
  void handleListJobAction(
    {
      type: "zapmarket:pause-batch-import",
    },
    "Importacao em lote pausada.",
  ).catch((error) => {
    showStatus(
      elements.listStatusCard,
      error instanceof Error ? error.message : "Nao foi possivel pausar a importacao.",
      "error",
    );
  });
});

elements.resumeImportButton.addEventListener("click", () => {
  void handleListJobAction(
    {
      type: "zapmarket:resume-batch-import",
    },
    "Importacao em lote retomada.",
  ).catch((error) => {
    showStatus(
      elements.listStatusCard,
      error instanceof Error ? error.message : "Nao foi possivel retomar a importacao.",
      "error",
    );
  });
});

elements.exportCsvButton.addEventListener("click", () => {
  try {
    exportProductsAsCsv(ensureProductsForExport());
    showStatus(elements.listStatusCard, "CSV gerado com sucesso.", "success");
  } catch (error) {
    showStatus(
      elements.listStatusCard,
      error instanceof Error ? error.message : "Falha ao exportar CSV.",
      "error",
    );
  }
});

elements.exportJsonButton.addEventListener("click", () => {
  try {
    exportProductsAsJson(ensureProductsForExport());
    showStatus(elements.listStatusCard, "JSON gerado com sucesso.", "success");
  } catch (error) {
    showStatus(
      elements.listStatusCard,
      error instanceof Error ? error.message : "Falha ao exportar JSON.",
      "error",
    );
  }
});

window.addEventListener("beforeunload", () => {
  stopListPolling();
});

bootstrap().catch((error) => {
  clearPreview();
  renderListJob(null);
  showStatus(
    elements.statusCard,
    error instanceof Error ? error.message : "Falha ao iniciar a extensao.",
    "error",
  );
});
