const DEFAULT_SERVER_URL = "http://localhost:3000";
const SERVER_URL_STORAGE_KEY = "zapmarket_server_url";
const WIDGET_ID = "zapmarket-floating-importer";
const CONTEXT_REFRESH_INTERVAL_MS = 5_000;

const state = {
  serverUrl: DEFAULT_SERVER_URL,
  currentUrl: window.location.href,
  sourceUrl: "",
  shortLink: "",
  tabId: null,
  isBusy: false,
  isCopied: false,
  lastStatusTone: "info",
  lastStatusMessage: "Aguardando link do Mercado Livre...",
  autoAttemptKey: "",
  importedSourceUrl: "",
  lastReadyNotificationUrl: "",
  extensionContextAvailable: true,
  refreshIntervalId: null,
};

const elements = {
  host: null,
  root: null,
  button: null,
};

function sanitizeText(value) {
  return String(value ?? "").trim();
}

function isExtensionContextAvailable() {
  try {
    return typeof chrome !== "undefined" && Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function isExtensionContextInvalidError(error) {
  const message = sanitizeText(error instanceof Error ? error.message : error).toLowerCase();
  return message.includes("extension context invalidated");
}

function stopRefreshLoop() {
  if (state.refreshIntervalId === null) {
    return;
  }

  window.clearInterval(state.refreshIntervalId);
  state.refreshIntervalId = null;
}

function handleExtensionContextInvalidation() {
  if (!state.extensionContextAvailable) {
    return;
  }

  state.extensionContextAvailable = false;
  state.isBusy = false;
  state.shortLink = "";
  state.sourceUrl = "";
  state.autoAttemptKey = "";
  stopRefreshLoop();
  setStatus("Extensao recarregada. Atualize esta pagina para continuar.", "error");
}

function consumeExtensionContextError(error) {
  if (isExtensionContextInvalidError(error) || !isExtensionContextAvailable()) {
    handleExtensionContextInvalidation();
    return true;
  }

  return false;
}

function normalizeServerUrl(value) {
  return sanitizeText(value).replace(/\/+$/g, "") || DEFAULT_SERVER_URL;
}

function isMercadoLivreUrl(value) {
  return /(?:mercadolivre|mercadolibre|meli\.la)/i.test(sanitizeText(value));
}

function isMercadoLivreShortLink(value) {
  return /^https?:\/\/(?:[\w-]+\.)?meli\.la(?:\/|$)/i.test(sanitizeText(value));
}

function normalizeComparableUrl(value) {
  const normalizedValue = sanitizeText(value);
  if (!normalizedValue) {
    return "";
  }

  try {
    const parsed = new URL(normalizedValue, window.location.href);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return normalizedValue;
  }
}

function normalizeMercadoLivreProductLink(value) {
  const normalizedValue = sanitizeText(value);
  if (!normalizedValue) {
    return "";
  }

  try {
    const parsed = new URL(normalizedValue, window.location.href);
    if (!isMercadoLivreUrl(parsed.toString())) {
      return "";
    }

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
    const normalizedUrl = parsed.toString();
    return /\/(?:MLB[-_]?\d{6,}|p\/|up\/)/i.test(parsed.pathname) ||
      /(?:^|[?&])(wid|item_id|itemId)=/i.test(parsed.search)
      ? normalizedUrl
      : "";
  } catch {
    return "";
  }
}

function parsePriceFromText(value) {
  const normalizedValue = sanitizeText(value);
  if (!normalizedValue) {
    return undefined;
  }

  const cleanedValue = normalizedValue
    .replace(/\s+/g, " ")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsedValue = Number(cleanedValue);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function extractTextFromSelectors(root, selectors) {
  for (const selector of selectors) {
    const node = root.querySelector(selector);
    const text = sanitizeText(node?.textContent);
    if (text) {
      return text;
    }
  }

  return "";
}

function extractAttributeFromSelectors(root, selectors, attributeName) {
  for (const selector of selectors) {
    const node = root.querySelector(selector);
    const value = sanitizeText(node?.getAttribute?.(attributeName));
    if (value) {
      return value;
    }
  }

  return "";
}

function extractPriceFromNode(root) {
  const ariaLabelPrice = extractAttributeFromSelectors(
    root,
    [
      '[aria-label*="R$"]',
      '[aria-label*="$"]',
      '[data-testid="price"]',
      ".poly-price__current",
      ".andes-money-amount",
    ],
    "aria-label",
  );
  const ariaPriceValue = parsePriceFromText(ariaLabelPrice);
  if (ariaPriceValue !== undefined) {
    return ariaPriceValue;
  }

  const fractionNode = root.querySelector(
    ".andes-money-amount__fraction, .poly-price__current .andes-money-amount__fraction",
  );
  const centsNode = root.querySelector(
    ".andes-money-amount__cents, .poly-price__current .andes-money-amount__cents",
  );
  const fractionText = sanitizeText(fractionNode?.textContent).replace(/\D/g, "");
  const centsText = sanitizeText(centsNode?.textContent).replace(/\D/g, "");
  if (fractionText) {
    const combinedValue = Number(`${fractionText}.${centsText || "00"}`);
    if (Number.isFinite(combinedValue)) {
      return combinedValue;
    }
  }

  return parsePriceFromText(
    extractTextFromSelectors(root, [
      ".poly-price__current",
      ".andes-money-amount",
      '[data-testid="price"]',
      ".ui-search-price__second-line",
    ]),
  );
}

function extractRatingFromNode(root) {
  const candidates = [
    extractAttributeFromSelectors(root, ['[aria-label*="estrelas"]', '[aria-label*="star"]'], "aria-label"),
    extractTextFromSelectors(root, [".poly-reviews__rating", ".ui-search-reviews__rating-number"]),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const match = candidate.match(/(\d+(?:[.,]\d+)?)/);
    if (match) {
      return match[1].replace(",", ".");
    }
  }

  return "";
}

function extractSalesFromNode(root) {
  const blockText = sanitizeText(root.textContent).replace(/\s+/g, " ");
  const match = blockText.match(/(\+?\s*\d[\d.]*)\s+vendidos?/i);
  return match ? sanitizeText(match[1]).replace(/\s+/g, "") : "";
}

function extractConditionFromNode(root) {
  const text = sanitizeText(root.textContent).replace(/\s+/g, " ");
  const match = text.match(/\b(Novo|Usado|Recondicionado)\b/i);
  return match ? match[1] : "";
}

function extractShippingFromNode(root) {
  const text = sanitizeText(root.textContent).replace(/\s+/g, " ");
  const match = text.match(/Frete\s+gr[áa]tis|Chegar[aá].{0,24}|Envio.{0,24}/i);
  return match ? match[0] : "";
}

function extractSellerFromNode(root) {
  const sellerText = extractTextFromSelectors(root, [
    ".poly-component__seller",
    ".poly-component__brand",
    ".shops__seller-name",
    ".ui-search-official-store-label",
  ]);

  return sellerText.replace(/^por\s+/i, "");
}

function extractImageFromNode(root) {
  const imageNode = root.querySelector("img");
  return sanitizeText(imageNode?.currentSrc || imageNode?.src || imageNode?.getAttribute?.("data-src"));
}

function collectProductCardNodes() {
  const selectors = [
    '[data-testid="poly-card"]',
    ".poly-card",
    "li.ui-search-layout__item",
    "div.ui-search-result__wrapper",
    "div.ui-search-result",
  ];
  const cards = [];
  const seen = new Set();

  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      const card = node.closest("article, li, div");
      if (!(card instanceof HTMLElement)) {
        continue;
      }

      const key = card.dataset?.itemId || `${selector}:${cards.length}:${card.textContent?.length ?? 0}`;
      if (!seen.has(key)) {
        seen.add(key);
        cards.push(card);
      }
    }
  }

  return cards;
}

function extractProductFromCard(card) {
  const anchorCandidates = Array.from(card.querySelectorAll("a[href]"));
  let link = "";

  for (const anchor of anchorCandidates) {
    const normalizedLink = normalizeMercadoLivreProductLink(anchor.href);
    if (normalizedLink) {
      link = normalizedLink;
      break;
    }
  }

  if (!link) {
    return null;
  }

  const itemId = sanitizeText(link.match(/MLB[-_]?\d{6,}/i)?.[0] ?? "");
  const title =
    extractTextFromSelectors(card, [
      '[data-testid="title"]',
      ".poly-component__title",
      ".ui-search-item__title",
      "h2",
      "h3",
    ]) ||
    sanitizeText(anchorCandidates[0]?.textContent) ||
    itemId ||
    "Produto sem titulo";
  const price = extractPriceFromNode(card);

  return {
    itemId,
    title,
    price: price ?? 0,
    link,
    image: extractImageFromNode(card),
    rating: extractRatingFromNode(card),
    sales: extractSalesFromNode(card),
    seller: extractSellerFromNode(card),
    shipping: extractShippingFromNode(card),
    freeShipping: /frete\s+gr[áa]tis/i.test(card.textContent ?? ""),
    condition: extractConditionFromNode(card),
  };
}

function extractPageNumberFromText(value) {
  const digits = sanitizeText(value).replace(/\D/g, "");
  if (!digits) {
    return 0;
  }

  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function extractCurrentPageNumber() {
  const selectors = [
    'li.andes-pagination__button--current span',
    'li.andes-pagination__button--current a',
    '[aria-current="page"]',
    '.andes-pagination__button--current',
  ];

  for (const selector of selectors) {
    const node = document.querySelector(selector);
    const parsedValue = extractPageNumberFromText(node?.textContent);
    if (parsedValue > 0) {
      return parsedValue;
    }
  }

  return 0;
}

function extractNextPageUrl() {
  const selectors = [
    'a[title="Seguinte"]',
    'a[title="Próxima"]',
    'a[title="Proxima"]',
    'a[title="Siguiente"]',
    'a[aria-label="Seguinte"]',
    'a[aria-label="Próxima"]',
    'a[aria-label="Proxima"]',
    'a[aria-label="Siguiente"]',
    "li.andes-pagination__button--next a",
    "a.andes-pagination__button--next",
    'a[rel="next"]',
  ];

  for (const selector of selectors) {
    const anchor = document.querySelector(selector);
    if (anchor instanceof HTMLAnchorElement && sanitizeText(anchor.href)) {
      return anchor.href;
    }
  }

  const currentPage = extractCurrentPageNumber();
  let nextCandidate = "";
  let nextPageNumber = Number.POSITIVE_INFINITY;

  for (const anchor of document.querySelectorAll("a[href]")) {
    if (!(anchor instanceof HTMLAnchorElement) || !sanitizeText(anchor.href)) {
      continue;
    }

    const pageNumber = extractPageNumberFromText(anchor.textContent);
    if (pageNumber <= 0) {
      continue;
    }

    if (currentPage > 0 && pageNumber <= currentPage) {
      continue;
    }

    if (pageNumber < nextPageNumber) {
      nextPageNumber = pageNumber;
      nextCandidate = anchor.href;
    }
  }

  if (nextCandidate) {
    return nextCandidate;
  }

  return "";
}

function extractTotalResults() {
  const candidates = [
    extractTextFromSelectors(document, [
      ".ui-search-search-result__quantity-results",
      '[data-testid="result-quantity"]',
      ".andes-breadcrumb__label",
    ]),
    sanitizeText(document.body?.textContent).match(/(\d[\d.]*)\s+resultados/i)?.[1] ?? "",
  ];

  for (const candidate of candidates) {
    const digits = sanitizeText(candidate).replace(/\D/g, "");
    if (digits) {
      const parsed = Number(digits);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

function extractTotalPages() {
  const pageNumbers = Array.from(
    document.querySelectorAll(".andes-pagination__button span, .andes-pagination__button a"),
  )
    .map((node) => Number(sanitizeText(node.textContent)))
    .filter((value) => Number.isFinite(value) && value > 0);

  return pageNumbers.length > 0 ? Math.max(...pageNumbers) : 0;
}

async function waitForListContent() {
  const timeoutAt = Date.now() + 18_000;
  const selectors = [
    '[data-testid="poly-card"]',
    ".poly-card",
    "li.ui-search-layout__item",
    "div.ui-search-result__wrapper",
    'a[title="Seguinte"]',
    'a[title="Próxima"]',
    'a[title="Proxima"]',
    "li.andes-pagination__button--next a",
  ];

  while (Date.now() < timeoutAt) {
    if (selectors.some((selector) => document.querySelector(selector))) {
      return true;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  return false;
}

async function autoScrollPage() {
  let lastHeight = 0;
  let stablePasses = 0;

  for (let index = 0; index < 28; index += 1) {
    window.scrollBy({
      top: Math.max(window.innerHeight * 0.9, 480),
      behavior: "smooth",
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 260);
    });

    const currentHeight = Math.max(
      document.documentElement?.scrollHeight ?? 0,
      document.body?.scrollHeight ?? 0,
    );

    if (currentHeight === lastHeight) {
      stablePasses += 1;
    } else {
      stablePasses = 0;
      lastHeight = currentHeight;
    }

    if (stablePasses >= 4) {
      break;
    }
  }

  window.scrollTo({
    top: 0,
    behavior: "auto",
  });
}

async function collectMercadoLivreListPage(options) {
  const hasListContent = await waitForListContent();
  await autoScrollPage();

  const cards = collectProductCardNodes();
  const products = cards
    .map((card) => extractProductFromCard(card))
    .filter(Boolean)
    .slice(0, Number.isFinite(Number(options?.maxProducts)) ? Number(options.maxProducts) : undefined);

  if (!hasListContent && products.length === 0) {
    throw new Error("Nenhum card de produto foi encontrado nesta pagina.");
  }

  return {
    pageUrl: window.location.href,
    nextPageUrl: extractNextPageUrl(),
    totalResults: extractTotalResults(),
    totalPages: extractTotalPages(),
    detectedCards: cards.length,
    products,
    message:
      products.length > 0
        ? `${products.length} produto(s) identificado(s) nesta pagina.`
        : "Pagina lida, mas sem produtos validos.",
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "zapmarket:collect-list-page") {
    void (async () => {
      try {
        const payload = await collectMercadoLivreListPage(message);
        sendResponse({
          ok: true,
          payload,
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Nao foi possivel coletar os produtos desta pagina.",
        });
      }
    })();

    return true;
  }

  return false;
});

function hasDetectedAffiliateShortLink() {
  return Boolean(sanitizeText(state.shortLink));
}

function extractFirstShortLink(value) {
  return sanitizeText(value).match(/https?:\/\/(?:[\w-]+\.)?meli\.la\/[^\s"'<>]+/i)?.[0] ?? "";
}

function detectAffiliateShortLinkFromDom() {
  const selector = [
    'a[href*="meli.la"]',
    'input[value*="meli.la"]',
    'textarea',
    '[data-testid*="link"]',
    '[class*="link"]',
  ].join(",");

  for (const node of document.querySelectorAll(selector)) {
    const candidates = [
      node instanceof HTMLAnchorElement ? node.href : "",
      node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.value : "",
      node.textContent ?? "",
      node.getAttribute?.("value") ?? "",
      node.getAttribute?.("href") ?? "",
    ];

    for (const candidate of candidates) {
      const shortLink = extractFirstShortLink(candidate);
      if (shortLink) {
        return shortLink;
      }
    }
  }

  return extractFirstShortLink(document.body?.innerText ?? "");
}

function getWidgetStyles() {
  return `
    :host {
      all: initial;
    }

    .shell {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      display: inline-flex;
      border-radius: 999px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.22);
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    }

    .button {
      appearance: none;
      border: none;
      border-radius: 999px;
      background: linear-gradient(135deg, #ef4444, #991b1b);
      color: #ffffff;
      padding: 16px 22px;
      min-width: 248px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      transition:
        transform 160ms ease,
        box-shadow 160ms ease,
        background 180ms ease,
        opacity 180ms ease;
      box-shadow: 0 14px 28px rgba(153, 27, 27, 0.34);
    }

    .button:hover {
      transform: translateY(-1px);
      box-shadow: 0 18px 32px rgba(15, 23, 42, 0.26);
    }

    .button:disabled {
      cursor: not-allowed;
      opacity: 1;
      transform: none;
    }

    .button.is-affiliate {
      background: linear-gradient(135deg, #16a34a, #166534);
      box-shadow: 0 10px 24px rgba(22, 163, 74, 0.28);
    }

    .button.is-busy {
      background: linear-gradient(135deg, #f59e0b, #b45309);
      box-shadow: 0 10px 24px rgba(245, 158, 11, 0.28);
    }

    .button.is-error {
      background: linear-gradient(135deg, #ef4444, #991b1b);
      box-shadow: 0 10px 24px rgba(239, 68, 68, 0.28);
    }
  `;
}

function setStatus(message, tone = "info") {
  state.lastStatusMessage = sanitizeText(message);
  state.lastStatusTone = tone;
  renderWidget();
}

function getPrimaryButtonLabel() {
  if (!state.extensionContextAvailable) {
    return "Atualize a pagina";
  }

  if (state.isBusy) {
    return "Importando automaticamente...";
  }

  if (!hasDetectedAffiliateShortLink()) {
    return "Link não identificado!";
  }

  if (state.importedSourceUrl && state.importedSourceUrl === state.sourceUrl) {
    return "Link identificado!";
  }

  return "Link identificado!";
}

function getPrimaryButtonTone() {
  if (!state.extensionContextAvailable) {
    return "error";
  }

  if (state.isBusy) {
    return hasDetectedAffiliateShortLink() ? "affiliate" : "busy";
  }

  if (hasDetectedAffiliateShortLink()) {
    return "affiliate";
  }

  return "error";
}

function renderWidget() {
  if (!elements.root) {
    return;
  }

  elements.button.textContent = getPrimaryButtonLabel();
  elements.button.disabled =
    !state.extensionContextAvailable || state.isBusy || !hasDetectedAffiliateShortLink();
  elements.button.title = state.lastStatusMessage || getPrimaryButtonLabel();
  elements.button.className = `button${
    getPrimaryButtonTone() === "affiliate"
      ? " is-affiliate"
      : getPrimaryButtonTone() === "busy"
        ? " is-busy"
        : getPrimaryButtonTone() === "error"
          ? " is-error"
          : ""
  }`;
}

function ensureWidget() {
  if (elements.host?.isConnected) {
    return;
  }

  const host = document.createElement("div");
  host.id = WIDGET_ID;
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = getWidgetStyles();

  const shell = document.createElement("section");
  shell.className = "shell";
  shell.innerHTML = `
    <button class="button" type="button"></button>
  `;

  shadow.append(style, shell);
  document.documentElement.appendChild(host);

  elements.host = host;
  elements.root = shell;
  elements.button = shell.querySelector(".button");

  elements.button.addEventListener("click", () => {
    void handleManualImport();
  });

  renderWidget();
}

function getClipboardFallbackContainer() {
  const textarea = document.createElement("textarea");
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  return textarea;
}

async function copyToClipboard(value) {
  const normalizedValue = sanitizeText(value);
  if (!normalizedValue) {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(normalizedValue);
      return true;
    }
  } catch {
    // Fallback below.
  }

  try {
    const textarea = getClipboardFallbackContainer();
    textarea.value = normalizedValue;
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

async function sendRuntimeMessage(message) {
  if (!isExtensionContextAvailable()) {
    throw new Error("Extension context invalidated.");
  }

  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }

        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  }).catch((error) => {
    if (consumeExtensionContextError(error)) {
      throw new Error("Extension context invalidated.");
    }

    throw error;
  });
}

async function notifyContentReady() {
  const normalizedUrl = normalizeComparableUrl(window.location.href);
  if (!normalizedUrl || state.lastReadyNotificationUrl === normalizedUrl) {
    return;
  }

  state.lastReadyNotificationUrl = normalizedUrl;
  await sendRuntimeMessage({
    type: "zapmarket:content-ready",
    currentUrl: normalizedUrl,
  }).catch(() => undefined);
}

async function loadServerUrl() {
  if (!isExtensionContextAvailable()) {
    handleExtensionContextInvalidation();
    return;
  }

  try {
    const storage = await chrome.storage.sync.get(SERVER_URL_STORAGE_KEY);
    state.serverUrl = normalizeServerUrl(storage[SERVER_URL_STORAGE_KEY]);
  } catch (error) {
    if (consumeExtensionContextError(error)) {
      return;
    }

    throw error;
  }
}

async function getTabState() {
  const response = await sendRuntimeMessage({
    type: "zapmarket:get-tab-state",
  });

  if (!response?.ok) {
    throw new Error(sanitizeText(response?.error) || "Falha ao ler o estado da aba.");
  }

  return response.tabState ?? null;
}

async function markAutoImported() {
  await sendRuntimeMessage({
    type: "zapmarket:mark-auto-imported",
    currentUrl: state.currentUrl,
  }).catch(() => undefined);
}

async function importWithExtension(sourceUrl) {
  const response = await sendRuntimeMessage({
    type: "zapmarket:import-product",
    sourceUrl,
    serverUrl: state.serverUrl,
  });

  if (!response?.ok) {
    throw new Error(sanitizeText(response?.error) || "Nao foi possivel importar o produto.");
  }

  return response.payload;
}

async function runImportFlow({ sourceUrl, autoTriggered }) {
  const normalizedSourceUrl = sanitizeText(sourceUrl);
  if (!normalizedSourceUrl || state.isBusy) {
    return;
  }

  if (!state.extensionContextAvailable || !isExtensionContextAvailable()) {
    handleExtensionContextInvalidation();
    return;
  }

  state.isBusy = true;
  renderWidget();

  const copied = await copyToClipboard(normalizedSourceUrl);
  setStatus(
    copied
      ? "Link copiado com sucesso. Iniciando importacao..."
      : "Nao consegui copiar o link, mas vou importar mesmo assim.",
    "busy",
  );

  try {
    const payload = await importWithExtension(normalizedSourceUrl);
    state.importedSourceUrl = normalizedSourceUrl;
    state.lastStatusTone = "success";
    state.lastStatusMessage =
      sanitizeText(payload?.message) || "Produto importado automaticamente no ZapMarket.";
    if (autoTriggered) {
      await markAutoImported();
    }
  } catch (error) {
    state.lastStatusTone = "error";
    state.lastStatusMessage =
      error instanceof Error
        ? error.message
        : "Nao foi possivel importar o produto automaticamente.";
  } finally {
    state.isBusy = false;
    renderWidget();
  }
}

async function handleManualImport() {
  await runImportFlow({
    sourceUrl: state.sourceUrl,
    autoTriggered: false,
  });
}

async function refreshContext() {
  if (!document.documentElement || !state.extensionContextAvailable) {
    return;
  }

  if (!isExtensionContextAvailable()) {
    handleExtensionContextInvalidation();
    return;
  }

  ensureWidget();
  try {
    await loadServerUrl();
  } catch (error) {
    if (consumeExtensionContextError(error)) {
      return;
    }

    throw error;
  }

  state.currentUrl = window.location.href;
  await notifyContentReady();
  state.sourceUrl = "";
  state.shortLink = "";

  let tabState = null;
  try {
    tabState = await getTabState();
  } catch {
    tabState = null;
  }

  const detectedShortLink =
    sanitizeText(tabState?.shortLink) ||
    detectAffiliateShortLinkFromDom() ||
    (isMercadoLivreShortLink(state.currentUrl) ? state.currentUrl : "");
  if (detectedShortLink) {
    state.shortLink = detectedShortLink;
    state.sourceUrl = detectedShortLink;
  }

  if (!state.importedSourceUrl || state.importedSourceUrl !== state.sourceUrl) {
    setStatus(
      detectedShortLink
        ? "Link meli.la detectado. Preparando copia e importacao automatica..."
        : "Link de afiliado meli.la ainda nao foi identificado.",
      detectedShortLink ? "busy" : "info",
    );
  } else {
    renderWidget();
  }

  const autoAttemptKey = `${detectedShortLink}|${state.currentUrl}`;
  if (detectedShortLink && !tabState?.autoImported && state.autoAttemptKey !== autoAttemptKey) {
    state.autoAttemptKey = autoAttemptKey;
    await runImportFlow({
      sourceUrl: detectedShortLink,
      autoTriggered: true,
    });
  }
}

async function bootstrap() {
  if (!isMercadoLivreUrl(window.location.href)) {
    return;
  }

  ensureWidget();
  try {
    await refreshContext();
  } catch (error) {
    if (consumeExtensionContextError(error)) {
      return;
    }

    throw error;
  }

  let lastUrl = window.location.href;
  state.refreshIntervalId = window.setInterval(() => {
    if (!state.extensionContextAvailable || !isExtensionContextAvailable()) {
      handleExtensionContextInvalidation();
      return;
    }

    ensureWidget();
    const domShortLink = detectAffiliateShortLinkFromDom();

    if (window.location.href !== lastUrl || sanitizeText(domShortLink) !== sanitizeText(state.shortLink)) {
      lastUrl = window.location.href;
      state.autoAttemptKey = "";
      if (sanitizeText(domShortLink) !== sanitizeText(state.shortLink)) {
        state.importedSourceUrl = "";
      }
      state.lastReadyNotificationUrl = "";
    }

    void refreshContext().catch((error) => {
      if (!consumeExtensionContextError(error)) {
        console.error("[zapmarket-extension] Falha ao atualizar contexto da pagina.", error);
      }
    });
  }, CONTEXT_REFRESH_INTERVAL_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void bootstrap().catch((error) => {
      if (!consumeExtensionContextError(error)) {
        console.error("[zapmarket-extension] Falha ao iniciar content script.", error);
      }
    });
  });
} else {
  void bootstrap().catch((error) => {
    if (!consumeExtensionContextError(error)) {
      console.error("[zapmarket-extension] Falha ao iniciar content script.", error);
    }
  });
}
