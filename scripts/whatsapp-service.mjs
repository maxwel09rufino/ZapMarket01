import http from "node:http";
import path from "node:path";
import { networkInterfaces } from "node:os";
import { mkdir, readFile, rm } from "node:fs/promises";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState as baileysMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { Pool } from "pg";
import QRCode from "qrcode";
import { WebSocket, WebSocketServer } from "ws";

async function loadLocalEnvFiles() {
  for (const fileName of [".env.local", ".env"]) {
    try {
      const filePath = path.join(process.cwd(), fileName);
      const fileContent = await readFile(filePath, "utf8");

      for (const rawLine of fileContent.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) {
          continue;
        }

        const separatorIndex = line.indexOf("=");
        if (separatorIndex <= 0) {
          continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        if (!key || process.env[key] !== undefined) {
          continue;
        }

        let value = line.slice(separatorIndex + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        process.env[key] = value;
      }
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        continue;
      }

      console.warn(`[whatsapp-service] falha ao carregar ${fileName}:`, error);
    }
  }
}

await loadLocalEnvFiles();

const SERVICE_HOST = process.env.WHATSAPP_SERVICE_HOST ?? "0.0.0.0";
const SERVICE_PORT = Number(process.env.WHATSAPP_SERVICE_PORT ?? 3001);
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT ?? 3000);
const SESSION_PATH =
  process.env.WHATSAPP_SESSION_PATH ?? path.join(process.cwd(), "sessions");
const BOT_WHATSAPP_SCHEMA_PATH = path.join(process.cwd(), "database", "bot-whatsapp.sql");
const REQUEST_TIMEOUT_MS = Number(process.env.WHATSAPP_REQUEST_TIMEOUT_MS ?? 25000);
const MAX_BODY_SIZE_BYTES = 64 * 1024;
const GROUP_INVITE_LINK_REGEX = /^https:\/\/chat\.whatsapp\.com\/([A-Za-z0-9]+)/i;
const GROUP_INVITE_CODE_REGEX = /^[A-Za-z0-9]{6,}$/;
const CHANNEL_LINK_REGEX = /^https:\/\/(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9]+)/i;
const NEWSLETTER_JID_REGEX = /^[A-Za-z0-9._:-]+@newsletter$/i;
const GROUP_JID_CACHE_TTL_MS = 10 * 60 * 1000;
const NEWSLETTER_JID_CACHE_TTL_MS = 10 * 60 * 1000;
const GROUP_SUBJECT_CACHE_TTL_MS = 10 * 60 * 1000;
const MERCADO_LIVRE_API_BASE = "https://api.mercadolibre.com";
const MERCADO_LIVRE_TIMEOUT_MS = 15000;
const BOT_MESSAGE_LIMIT = 1000;
const BOT_AUTOMATION_DELAY_RANGE_MS = [900, 2200];
const BOT_CAMPAIGN_DELAY_RANGE_MS = [350, 900];
const BOT_ASSISTANT_COMMAND_REGEX = /^[;\/!\.\-]+\s*(assistente|assitente)\b(?:[\s:,-]+([\s\S]*))?$/i;
const BOT_ASSISTANT_SHORTCUT_REGEX = /^\/(resumo|cadastrar-produto|adicionar-contato|criar-campanha)\b/i;
const MERCADO_LIVRE_LINK_REGEX =
  /https?:\/\/(?:[\w-]+\.)?(?:mercadolivre\.[a-z.]+|meli\.la)\/[^\s]+/i;
const CHANNEL_ADMIN_ROLES = new Set(["ADMIN", "OWNER", "SUPERADMIN"]);
const ENABLE_SSL_VALUES = new Set(["1", "true", "yes", "on", "require", "prefer"]);
const DISABLE_SSL_VALUES = new Set(["0", "false", "no", "off", "disable"]);

function resolveDatabaseSsl(connectionString) {
  const configuredValue = String(process.env.DATABASE_SSL ?? process.env.PGSSLMODE ?? "")
    .trim()
    .toLowerCase();

  if (ENABLE_SSL_VALUES.has(configuredValue)) {
    return { rejectUnauthorized: false };
  }

  if (DISABLE_SSL_VALUES.has(configuredValue)) {
    return undefined;
  }

  const normalizedConnectionString = sanitizeText(connectionString);
  if (!normalizedConnectionString) {
    return undefined;
  }

  try {
    const parsed = new URL(normalizedConnectionString);
    const host = sanitizeText(parsed.hostname).toLowerCase();
    if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return undefined;
    }

    return { rejectUnauthorized: false };
  } catch {
    return undefined;
  }
}

const databasePool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(resolveDatabaseSsl(process.env.DATABASE_URL)
    ? { ssl: resolveDatabaseSsl(process.env.DATABASE_URL) }
    : {}),
});

let ensureBotDatabasePromise = null;
let mercadoLivreTokenState = {
  accessToken: null,
  expiresAt: 0,
  pendingPromise: null,
};

class DashboardProductRequestError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.retryable = retryable;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPairingCode(code) {
  if (!code) return code;
  if (code.includes("-")) return code;
  const chunks = code.match(/.{1,3}/g);
  return chunks ? chunks.join("-") : code;
}

function normalizePhoneNumber(input) {
  return String(input ?? "").replace(/\D/g, "");
}

function isValidPhoneNumber(phone) {
  return /^\d{10,15}$/.test(phone);
}

function normalizeInviteCode(input) {
  const value = String(input ?? "").trim();
  const match = value.match(GROUP_INVITE_LINK_REGEX);
  return match?.[1] ?? value;
}

function isValidInviteCode(code) {
  return GROUP_INVITE_CODE_REGEX.test(code);
}

function isValidMediaUrl(input) {
  const value = String(input ?? "").trim();
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function writeJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function parseStatusCode(lastDisconnect) {
  return lastDisconnect?.error?.output?.statusCode;
}

function shouldRetryGroupJoin(error) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("not-authorized") ||
    normalized.includes("not_authorized") ||
    normalized.includes("not a participant") ||
    normalized.includes("participant") ||
    normalized.includes("member") ||
    normalized.includes("forbidden")
  );
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Tempo limite excedido.")), timeoutMs);
    }),
  ]);
}

async function readJsonBody(req) {
  return withTimeout(
    new Promise((resolve, reject) => {
      let body = "";

      req.on("data", (chunk) => {
        body += chunk;
        if (Buffer.byteLength(body, "utf8") > MAX_BODY_SIZE_BYTES) {
          reject(new Error("Corpo da requisicao muito grande."));
          req.destroy();
        }
      });

      req.on("error", reject);
      req.on("end", () => {
        if (!body.trim()) {
          resolve({});
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("JSON invalido."));
        }
      });
    }),
    REQUEST_TIMEOUT_MS,
  );
}

function resolveRandomDelayMs([minDelay, maxDelay]) {
  const safeMin = Math.max(Number(minDelay) || 0, 0);
  const safeMax = Math.max(Number(maxDelay) || safeMin, safeMin);
  return safeMin + Math.floor(Math.random() * (safeMax - safeMin + 1));
}

function isDirectContactJid(jid) {
  return (
    typeof jid === "string" &&
    (jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid") || jid.endsWith("@c.us"))
  );
}

function isGroupJid(jid) {
  return typeof jid === "string" && jid.endsWith("@g.us");
}

function isBotConversationJid(jid) {
  return isDirectContactJid(jid) || isGroupJid(jid);
}

function isNewsletterJid(jid) {
  return typeof jid === "string" && jid.toLowerCase().endsWith("@newsletter");
}

function normalizeWhatsappUserJid(value) {
  const jid = sanitizeText(value).toLowerCase();
  if (!jid || !jid.includes("@")) {
    return null;
  }

  const [left, server] = jid.split("@", 2);
  const user = left.split(":")[0];
  if (!user || !server) {
    return null;
  }

  return `${user}@${server}`;
}

function areSameWhatsappUser(left, right) {
  const normalizedLeft = normalizeWhatsappUserJid(left);
  const normalizedRight = normalizeWhatsappUserJid(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function normalizeChatPhone(input) {
  const value = String(input ?? "").trim();
  if (value.includes("@")) {
    return value.split("@")[0].replace(/\D/g, "");
  }

  return normalizePhoneNumber(value);
}

function sanitizeText(value) {
  return String(value ?? "").trim();
}

function isAssistantCommandMessage(value) {
  const text = sanitizeText(value);
  return BOT_ASSISTANT_COMMAND_REGEX.test(text) || BOT_ASSISTANT_SHORTCUT_REGEX.test(text);
}

function normalizeDashboardBaseUrl(value) {
  const sanitized = sanitizeText(value);
  if (!sanitized) {
    return null;
  }

  try {
    const parsed = new URL(
      /^[a-z]+:\/\//i.test(sanitized) ? sanitized : `http://${sanitized}`,
    );
    if (!parsed.port) {
      parsed.port = String(DASHBOARD_PORT);
    }
    parsed.pathname = "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function listLocalIpv4Addresses() {
  const interfaces = networkInterfaces();
  const addresses = new Set();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry?.family === "IPv4" && !entry.internal && entry.address) {
        addresses.add(entry.address);
      }
    }
  }

  return [...addresses];
}

function buildDashboardBaseUrls() {
  const baseUrls = new Set();

  for (const configuredUrl of [
    process.env.ZAPMARKET_DASHBOARD_URL,
    process.env.DASHBOARD_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
  ]) {
    const normalized = normalizeDashboardBaseUrl(configuredUrl);
    if (normalized) {
      baseUrls.add(normalized);
    }
  }

  const hostCandidates = new Set([
    "127.0.0.1",
    "localhost",
    SERVICE_HOST,
    ...listLocalIpv4Addresses(),
  ]);

  for (const host of hostCandidates) {
    const normalizedHost = sanitizeText(host);
    if (!normalizedHost || ["0.0.0.0", "::"].includes(normalizedHost)) {
      continue;
    }

    const normalized = normalizeDashboardBaseUrl(`http://${normalizedHost}:${DASHBOARD_PORT}`);
    if (normalized) {
      baseUrls.add(normalized);
    }
  }

  return [...baseUrls];
}

function buildServiceBaseUrls() {
  const baseUrls = new Set();
  const hostCandidates = new Set(["127.0.0.1", "localhost", ...listLocalIpv4Addresses()]);

  for (const host of hostCandidates) {
    const normalized = normalizeDashboardBaseUrl(`http://${host}:${SERVICE_PORT}`);
    if (normalized) {
      baseUrls.add(normalized);
    }
  }

  return [...baseUrls];
}

function extractChannelInviteCode(input) {
  return sanitizeText(input).match(CHANNEL_LINK_REGEX)?.[1] ?? null;
}

function normalizeNewsletterJid(input) {
  const value = sanitizeText(input);
  if (!value) {
    return null;
  }

  if (NEWSLETTER_JID_REGEX.test(value)) {
    return value.toLowerCase();
  }

  if (/^[A-Za-z0-9._:-]+$/.test(value)) {
    return `${value}@newsletter`.toLowerCase();
  }

  return null;
}

function resolveChannelTarget(input) {
  const value = sanitizeText(input);
  if (!value) {
    return null;
  }

  const inviteCode = extractChannelInviteCode(value);
  if (inviteCode) {
    return {
      type: "invite",
      key: inviteCode,
      cacheKey: `invite:${inviteCode}`,
    };
  }

  const newsletterJid = normalizeNewsletterJid(value);
  if (newsletterJid) {
    return {
      type: "jid",
      key: newsletterJid,
      cacheKey: `jid:${newsletterJid}`,
    };
  }

  return null;
}

function getChannelSendErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("not-authorized") ||
    normalized.includes("not_authorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("permission") ||
    normalized.includes("newsletter")
  ) {
    return "Nao foi possivel enviar para o canal. O numero conectado precisa ter permissao de administrador no canal.";
  }

  return "Falha ao enviar para o canal informado.";
}

function normalizeChannelViewerRole(value) {
  const role = sanitizeText(value).toUpperCase();
  return role || null;
}

function extractChannelViewerRole(metadata) {
  return normalizeChannelViewerRole(
    metadata?.viewer_metadata?.role ?? metadata?.viewerMetadata?.role ?? metadata?.role,
  );
}

function extractChannelDisplayName(metadata) {
  const candidates = [
    metadata?.thread_metadata?.name?.text,
    metadata?.thread_metadata?.name,
    metadata?.name?.text,
    metadata?.name,
  ];

  for (const candidate of candidates) {
    const value = sanitizeText(candidate);
    if (value) {
      return value;
    }
  }

  return null;
}

function extractChannelOwner(metadata) {
  return normalizeWhatsappUserJid(metadata?.owner ?? metadata?.thread_metadata?.owner);
}

function shortenText(value, maxLength = 220) {
  const text = sanitizeText(value).replace(/\s+/g, " ");
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

function formatCurrencyBRL(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "R$ 0,00";
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(numericValue);
}

function extractMessageContent(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  if (message.conversation) {
    return {
      text: sanitizeText(message.conversation),
      type: "conversation",
    };
  }

  if (message.extendedTextMessage?.text) {
    return {
      text: sanitizeText(message.extendedTextMessage.text),
      type: "extendedTextMessage",
    };
  }

  if (message.imageMessage?.caption) {
    return {
      text: sanitizeText(message.imageMessage.caption),
      type: "imageMessage",
    };
  }

  if (message.videoMessage?.caption) {
    return {
      text: sanitizeText(message.videoMessage.caption),
      type: "videoMessage",
    };
  }

  if (message.buttonsResponseMessage?.selectedButtonId) {
    return {
      text: sanitizeText(message.buttonsResponseMessage.selectedButtonId),
      type: "buttonsResponseMessage",
    };
  }

  if (message.listResponseMessage?.singleSelectReply?.selectedRowId) {
    return {
      text: sanitizeText(message.listResponseMessage.singleSelectReply.selectedRowId),
      type: "listResponseMessage",
    };
  }

  if (message.ephemeralMessage?.message) {
    return extractMessageContent(message.ephemeralMessage.message);
  }

  if (message.viewOnceMessageV2?.message) {
    return extractMessageContent(message.viewOnceMessageV2.message);
  }

  if (message.viewOnceMessage?.message) {
    return extractMessageContent(message.viewOnceMessage.message);
  }

  if (message.documentWithCaptionMessage?.message) {
    return extractMessageContent(message.documentWithCaptionMessage.message);
  }

  return null;
}

function extractMercadoLivreLink(text) {
  return sanitizeText(text).match(MERCADO_LIVRE_LINK_REGEX)?.[0] ?? null;
}

async function ensureBotDatabaseReady() {
  if (!ensureBotDatabasePromise) {
    ensureBotDatabasePromise = readFile(BOT_WHATSAPP_SCHEMA_PATH, "utf8")
      .then((sql) => databasePool.query(sql))
      .then(() => undefined)
      .catch((error) => {
        ensureBotDatabasePromise = null;
        throw error;
      });
  }

  await ensureBotDatabasePromise;
}

async function logBotEvent({
  phone = null,
  remoteJid = null,
  level = "info",
  event,
  details = null,
}) {
  if (!event) {
    return;
  }

  try {
    await ensureBotDatabaseReady();
    await databasePool.query(
      `
        INSERT INTO bot_logs (
          phone,
          remote_jid,
          level,
          event,
          details
        )
        VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [
        phone,
        remoteJid,
        level,
        event,
        details ? JSON.stringify(details) : null,
      ],
    );
  } catch (error) {
    console.error("[whatsapp-service] falha ao salvar log do bot:", error);
  }
}

async function upsertBotSession({
  phone,
  remoteJid,
  contactName,
  lastMessage,
  lastMessageFromMe,
  lastMessageAt,
}) {
  await ensureBotDatabaseReady();
  const normalizedPhone = normalizeChatPhone(phone || remoteJid);
  const normalizedRemoteJid = sanitizeText(remoteJid);

  if (!normalizedPhone || !normalizedRemoteJid) {
    throw new Error("Sessao do bot sem telefone ou jid valido.");
  }

  const result = await databasePool.query(
    `
      INSERT INTO bot_sessions (
        phone,
        remote_jid,
        contact_name,
        last_message,
        last_message_from_me,
        last_message_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), $5, $6, NOW(), NOW())
      ON CONFLICT (phone)
      DO UPDATE SET
        remote_jid = EXCLUDED.remote_jid,
        contact_name = COALESCE(NULLIF(EXCLUDED.contact_name, ''), bot_sessions.contact_name),
        last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), bot_sessions.last_message),
        last_message_from_me = EXCLUDED.last_message_from_me,
        last_message_at = COALESCE(EXCLUDED.last_message_at, bot_sessions.last_message_at),
        updated_at = NOW()
      RETURNING
        id,
        phone,
        remote_jid,
        contact_name,
        bot_active,
        linked_campaign_id
    `,
    [
      normalizedPhone,
      normalizedRemoteJid,
      sanitizeText(contactName),
      sanitizeText(lastMessage),
      Boolean(lastMessageFromMe),
      lastMessageAt ?? new Date(),
    ],
  );

  return result.rows[0] ?? null;
}

async function getBotSessionByPhone(phone) {
  await ensureBotDatabaseReady();
  const normalizedPhone = normalizeChatPhone(phone);
  if (!normalizedPhone) {
    return null;
  }

  const result = await databasePool.query(
    `
      SELECT
        id,
        phone,
        remote_jid,
        contact_name,
        bot_active,
        linked_campaign_id
      FROM bot_sessions
      WHERE phone = $1
      LIMIT 1
    `,
    [normalizedPhone],
  );

  return result.rows[0] ?? null;
}

async function setBotActiveState({
  phone,
  remoteJid,
  contactName,
  active,
  lastMessage,
}) {
  const session = await upsertBotSession({
    phone,
    remoteJid,
    contactName,
    lastMessage,
    lastMessageFromMe: false,
    lastMessageAt: new Date(),
  });

  const result = await databasePool.query(
    `
      UPDATE bot_sessions
      SET
        bot_active = $2,
        updated_at = NOW()
      WHERE phone = $1
      RETURNING
        id,
        phone,
        remote_jid,
        contact_name,
        bot_active,
        linked_campaign_id
    `,
    [session.phone, Boolean(active)],
  );

  return result.rows[0] ?? session;
}

async function saveMessageLog({
  whatsappMessageId = null,
  phone,
  remoteJid,
  contactName,
  text,
  fromMe,
  messageType = "text",
  createdAt = new Date(),
}) {
  const normalizedText = sanitizeText(text);
  if (!normalizedText) {
    return null;
  }

  const session = await upsertBotSession({
    phone,
    remoteJid,
    contactName,
    lastMessage: normalizedText,
    lastMessageFromMe: fromMe,
    lastMessageAt: createdAt,
  });

  const result = await databasePool.query(
    `
      INSERT INTO messages (
        whatsapp_message_id,
        phone,
        remote_jid,
        contact_name,
        message,
        from_me,
        message_type,
        created_at
      )
      VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8)
      ON CONFLICT DO NOTHING
      RETURNING id, phone
    `,
    [
      whatsappMessageId,
      session.phone,
      session.remote_jid,
      sanitizeText(contactName),
      normalizedText,
      Boolean(fromMe),
      sanitizeText(messageType) || "text",
      createdAt,
    ],
  );

  return result.rows[0] ?? null;
}

async function listRecentProducts(limit = 5) {
  await ensureBotDatabaseReady();
  const result = await databasePool.query(
    `
      SELECT
        id,
        title,
        price,
        original_price,
        link
      FROM products
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [Math.min(Math.max(Number(limit) || 5, 1), 10)],
  );

  return result.rows;
}

async function listOfferCampaigns(limit = 5) {
  await ensureBotDatabaseReady();
  const result = await databasePool.query(
    `
      SELECT
        id,
        name,
        status,
        sent_count,
        remaining_count
      FROM campaigns
      WHERE status IN ('pending', 'sending')
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [Math.min(Math.max(Number(limit) || 5, 1), 10)],
  );

  return result.rows;
}

function isFatalCampaignError(message) {
  const normalized = sanitizeText(message).toLowerCase();
  return (
    normalized.includes("nao conectado") ||
    normalized.includes("indisponivel") ||
    normalized.includes("connection closed")
  );
}

function buildMercadoLivreHeaders(accessToken) {
  return {
    Accept: "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function parsePositiveNumber(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return undefined;
  }

  return Number(numericValue);
}

function extractSalePriceAmount(salePrice) {
  return parsePositiveNumber(salePrice?.amount);
}

function resolveDisplayedPrice(regularPrice, salePrice) {
  if (
    salePrice !== undefined &&
    regularPrice !== undefined &&
    salePrice < regularPrice
  ) {
    return salePrice;
  }

  return regularPrice ?? salePrice ?? 0;
}

function resolveOriginalPrice(explicitOriginalPrice, regularPrice, displayedPrice) {
  const originalPrice = parsePositiveNumber(explicitOriginalPrice);
  if (originalPrice !== undefined && originalPrice > displayedPrice) {
    return originalPrice;
  }

  if (regularPrice !== undefined && regularPrice > displayedPrice) {
    return regularPrice;
  }

  return undefined;
}

function extractMercadoLivreProductId(value) {
  const match = String(value ?? "").match(/MLB[-_]?(\d{6,})/i);
  return match ? `MLB${match[1]}` : null;
}

function normalizeMercadoLivreUrlCandidate(value) {
  try {
    const parsed = new URL(String(value ?? "").trim());
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname.includes("mercadolivre.com") ||
      hostname.includes("mercadolivre.com.br") ||
      hostname.includes("meli.la")
    ) {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function isMercadoLivreUrlHost(hostname) {
  const normalizedHost = sanitizeText(hostname).toLowerCase();
  return (
    normalizedHost === "meli.la" ||
    normalizedHost.endsWith(".meli.la") ||
    normalizedHost === "mercadolivre.com" ||
    normalizedHost.endsWith(".mercadolivre.com") ||
    normalizedHost === "mercadolivre.com.br" ||
    normalizedHost.endsWith(".mercadolivre.com.br") ||
    normalizedHost === "mercadolibre.com" ||
    normalizedHost.endsWith(".mercadolibre.com")
  );
}

function normalizeHtmlText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function hasHtmlClasses(classValue, requiredClasses) {
  const classes = new Set(
    sanitizeText(classValue)
      .split(/\s+/)
      .filter(Boolean),
  );

  return requiredClasses.every((requiredClass) => classes.has(requiredClass));
}

function toAbsoluteMercadoLivreUrl(candidate, baseUrl) {
  const normalizedCandidate = sanitizeText(candidate).replace(/&amp;/gi, "&");
  if (!normalizedCandidate) {
    return null;
  }

  try {
    const candidateWithProtocol = /^(?:www\.)?(?:meli\.la|(?:[\w-]+\.)*mercadolivre\.[a-z.]+)(?:\/|$)/i.test(
      normalizedCandidate,
    )
      ? `https://${normalizedCandidate.replace(/^\/+/, "")}`
      : normalizedCandidate;
    const parsed = new URL(candidateWithProtocol, baseUrl);

    if (!["http:", "https:"].includes(parsed.protocol) || !isMercadoLivreUrlHost(parsed.hostname)) {
      return null;
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractAffiliateLandingProductUrl(html, baseUrl) {
  const anchorPattern = /<a\b([^>]*)>([\s\S]{0,800}?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const attributes = match[1] ?? "";
    const label = normalizeHtmlText(match[2]);
    if (!/\bir para produto\b/i.test(label)) {
      continue;
    }

    const classValue = attributes.match(/\bclass\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    if (
      !hasHtmlClasses(classValue, [
        "poly-component__link",
        "poly-component__link--action-link",
      ])
    ) {
      continue;
    }

    const href = attributes.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) {
      continue;
    }

    const candidate = toAbsoluteMercadoLivreUrl(href, baseUrl);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? MERCADO_LIVRE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      redirect: options.redirect ?? "follow",
      cache: "no-store",
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => null);

    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      payload,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestDashboardJson(
  pathname,
  { method = "POST", body, timeoutMs = REQUEST_TIMEOUT_MS, fallbackMessage } = {},
) {
  const dashboardBaseUrls = buildDashboardBaseUrls();
  let lastRetryableError = null;

  for (const baseUrl of dashboardBaseUrls) {
    const requestUrl = new URL(pathname, `${baseUrl}/`).toString();

    try {
      const response = await fetchJsonWithTimeout(requestUrl, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
        },
        timeoutMs,
      });
      const responseMessage = sanitizeText(
        response?.payload?.error ?? response?.payload?.message,
      );

      if (!response.ok) {
        const message = responseMessage || fallbackMessage;
        if (response.status >= 400 && response.status < 500) {
          throw new DashboardProductRequestError(message, {
            retryable: false,
          });
        }

        lastRetryableError = new DashboardProductRequestError(message, {
          retryable: true,
        });
        continue;
      }

      return response.payload;
    } catch (error) {
      if (error instanceof DashboardProductRequestError) {
        if (!error.retryable) {
          throw error;
        }

        lastRetryableError = error;
        continue;
      }

      lastRetryableError = new DashboardProductRequestError(
        fallbackMessage,
        { retryable: true },
      );
    }
  }

  throw (
    lastRetryableError ??
    new DashboardProductRequestError(fallbackMessage, {
      retryable: true,
    })
  );
}

async function requestBotAssistantReply({
  remoteJid,
  senderId,
  senderName,
  message,
}) {
  const payload = await requestDashboardJson("/api/bot-whatsapp/incoming", {
    method: "POST",
    body: {
      remoteJid,
      senderId,
      senderName,
      message,
    },
    fallbackMessage: "Nao foi possivel acionar o assistente do WhatsApp.",
  });

  const reply = sanitizeText(payload?.reply ?? payload?.message);
  if (!reply) {
    throw new DashboardProductRequestError(
      "O assistente do WhatsApp nao retornou resposta.",
      { retryable: false },
    );
  }

  return reply;
}

async function getMercadoLivreAccessToken() {
  const now = Date.now();
  if (
    mercadoLivreTokenState.accessToken &&
    mercadoLivreTokenState.expiresAt - 60_000 > now
  ) {
    return mercadoLivreTokenState.accessToken;
  }

  if (mercadoLivreTokenState.pendingPromise) {
    return mercadoLivreTokenState.pendingPromise;
  }

  async function readActiveStoredMeliCredential() {
    try {
      const result = await databasePool.query(
        `
          SELECT
            id,
            client_id,
            client_secret,
            refresh_token,
            access_token,
            expires_at
          FROM meli_credentials
          WHERE is_active = true
          ORDER BY created_at DESC
          LIMIT 1
        `,
      );

      return result.rows[0] ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/meli_credentials/i.test(message) || /relation .* does not exist/i.test(message)) {
        return null;
      }

      throw error;
    }
  }

  async function updateStoredMeliCredentialTokens(id, tokenPayload) {
    try {
      await databasePool.query(
        `
          UPDATE meli_credentials
          SET
            refresh_token = $2,
            access_token = $3,
            token_type = $4,
            expires_at = $5,
            last_used_at = now(),
            updated_at = now()
          WHERE id = $1
        `,
        [
          id,
          tokenPayload.refreshToken,
          tokenPayload.accessToken,
          tokenPayload.tokenType ?? "Bearer",
          tokenPayload.expiresAt,
        ],
      );
    } catch (error) {
      console.warn("[whatsapp-service] falha ao atualizar token Mercado Livre no banco:", error);
    }
  }

  const clientId = sanitizeText(process.env.MERCADO_LIVRE_CLIENT_ID);
  const clientSecret = sanitizeText(process.env.MERCADO_LIVRE_CLIENT_SECRET);
  const refreshToken = sanitizeText(process.env.MERCADO_LIVRE_REFRESH_TOKEN);

  mercadoLivreTokenState.pendingPromise = (async () => {
    const storedCredential = await readActiveStoredMeliCredential();
    const storedAccessToken = sanitizeText(storedCredential?.access_token);
    const storedExpiresAt = storedCredential?.expires_at ? new Date(storedCredential.expires_at) : null;
    const storedTokenValid =
      storedAccessToken &&
      storedExpiresAt &&
      !Number.isNaN(storedExpiresAt.getTime()) &&
      storedExpiresAt.getTime() - 60_000 > now;

    if (storedTokenValid) {
      mercadoLivreTokenState.accessToken = storedAccessToken;
      mercadoLivreTokenState.expiresAt = storedExpiresAt.getTime();
      return storedAccessToken;
    }

    const preferredClientId = sanitizeText(storedCredential?.client_id) || clientId;
    const preferredClientSecret = sanitizeText(storedCredential?.client_secret) || clientSecret;
    const preferredRefreshToken = sanitizeText(storedCredential?.refresh_token) || refreshToken;

    if (!preferredClientId || !preferredClientSecret || !preferredRefreshToken) {
      mercadoLivreTokenState.accessToken = null;
      mercadoLivreTokenState.expiresAt = 0;
      return null;
    }

    const response = await fetchJsonWithTimeout(`${MERCADO_LIVRE_API_BASE}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: preferredClientId,
        client_secret: preferredClientSecret,
        refresh_token: preferredRefreshToken,
      }),
      timeoutMs: MERCADO_LIVRE_TIMEOUT_MS,
    });

    if (!response.ok || !response.payload?.access_token) {
      mercadoLivreTokenState.accessToken = null;
      mercadoLivreTokenState.expiresAt = 0;
      return null;
    }

    mercadoLivreTokenState.accessToken = sanitizeText(response.payload.access_token);
    mercadoLivreTokenState.expiresAt =
      Date.now() + Number(response.payload.expires_in ?? 21_600) * 1000;

    if (storedCredential?.id) {
      await updateStoredMeliCredentialTokens(storedCredential.id, {
        accessToken: mercadoLivreTokenState.accessToken,
        refreshToken:
          sanitizeText(response.payload.refresh_token) || preferredRefreshToken,
        tokenType: sanitizeText(response.payload.token_type) || "Bearer",
        expiresAt: new Date(mercadoLivreTokenState.expiresAt),
      });
    }

    return mercadoLivreTokenState.accessToken;
  })();

  try {
    return await mercadoLivreTokenState.pendingPromise;
  } finally {
    mercadoLivreTokenState.pendingPromise = null;
  }
}

async function fetchMercadoLivreApi(pathname, { authRequired = false } = {}) {
  const requestUrl = `${MERCADO_LIVRE_API_BASE}${pathname}`;
  const publicResponse = await fetchJsonWithTimeout(requestUrl, {
    headers: buildMercadoLivreHeaders(),
  });

  if (!authRequired && ![401, 403].includes(publicResponse.status)) {
    return publicResponse;
  }

  const accessToken = await getMercadoLivreAccessToken();
  if (!accessToken) {
    return publicResponse;
  }

  return fetchJsonWithTimeout(requestUrl, {
    headers: buildMercadoLivreHeaders(accessToken),
  });
}

async function fetchMercadoLivreSellerName(sellerId) {
  if (!sellerId) {
    return undefined;
  }

  const response = await fetchMercadoLivreApi(`/users/${sellerId}`);
  if (!response.ok || !response.payload) {
    return undefined;
  }

  const nickname = sanitizeText(
    response.payload.nickname ?? response.payload.first_name ?? response.payload.name,
  );
  return nickname || undefined;
}

async function fetchMercadoLivreDescription(itemId) {
  if (!itemId) {
    return "";
  }

  const response = await fetchMercadoLivreApi(`/items/${itemId}/description`);
  if (!response.ok || !response.payload) {
    return "";
  }

  return sanitizeText(response.payload.plain_text ?? response.payload.text);
}

function mapMercadoLivrePictures(pictures) {
  return Array.isArray(pictures)
    ? pictures
        .map((picture) => sanitizeText(picture?.secure_url ?? picture?.url))
        .filter(Boolean)
    : [];
}

function pickBestCatalogItem(productPayload, itemsPayload) {
  const candidates = [
    ...(productPayload?.buy_box_winner ? [productPayload.buy_box_winner] : []),
    ...(Array.isArray(itemsPayload?.results) ? itemsPayload.results : []),
  ].filter((candidate) => resolveDisplayedPrice(
    parsePositiveNumber(candidate?.price),
    extractSalePriceAmount(candidate?.sale_price),
  ) > 0);

  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    const leftPrice = resolveDisplayedPrice(
      parsePositiveNumber(left?.price),
      extractSalePriceAmount(left?.sale_price),
    );
    const rightPrice = resolveDisplayedPrice(
      parsePositiveNumber(right?.price),
      extractSalePriceAmount(right?.sale_price),
    );

    return leftPrice - rightPrice;
  })[0];
}

async function expandMercadoLivreUrl(url) {
  const response = await fetchJsonWithTimeout(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    redirect: "follow",
    timeoutMs: MERCADO_LIVRE_TIMEOUT_MS,
  });

  const html = typeof response.payload === "string" ? response.payload : "";
  const resolvedLandingUrl = html
    ? extractAffiliateLandingProductUrl(html, response.url || url)
    : null;

  if (resolvedLandingUrl) {
    return resolvedLandingUrl;
  }

  return response.url || url;
}

function normalizeFetchedProductPayload(product, fallbackLink) {
  const title = sanitizeText(product?.title);
  const price = parsePositiveNumber(product?.price);
  const image = sanitizeText(product?.image);
  const images = Array.isArray(product?.images)
    ? product.images.map((entry) => sanitizeText(entry)).filter(Boolean)
    : [];

  if (!title || price === undefined) {
    throw new DashboardProductRequestError(
      "O dashboard retornou um produto invalido para importacao.",
      { retryable: true },
    );
  }

  return {
    title,
    price,
    originalPrice: parsePositiveNumber(product?.originalPrice),
    discount: parsePositiveNumber(product?.discount),
    hasCouponOrDiscount: Boolean(product?.hasCouponOrDiscount),
    couponLabel: sanitizeText(product?.couponLabel) || undefined,
    image,
    images: images.length > 0 ? images : [image].filter(Boolean),
    description: sanitizeText(product?.description),
    link: sanitizeText(product?.link) || fallbackLink,
    seller: sanitizeText(product?.seller) || undefined,
  };
}

async function fetchMercadoLivreProductFromDashboard(rawLink) {
  const normalizedUrl = normalizeMercadoLivreUrlCandidate(rawLink);
  if (!normalizedUrl) {
    throw new DashboardProductRequestError("Link do Mercado Livre invalido.", {
      retryable: false,
    });
  }

  const payload = await requestDashboardJson("/api/products/fetch", {
    method: "POST",
    body: {
      url: normalizedUrl,
      lookupMode: "current",
    },
    timeoutMs: Math.max(MERCADO_LIVRE_TIMEOUT_MS, REQUEST_TIMEOUT_MS),
    fallbackMessage:
      "Nao foi possivel consultar o produto do Mercado Livre pelo dashboard local.",
  });

  return normalizeFetchedProductPayload(payload, normalizedUrl);
}

async function importMercadoLivreProductViaDashboard(rawLink) {
  const normalizedUrl = normalizeMercadoLivreUrlCandidate(rawLink);
  if (!normalizedUrl) {
    throw new DashboardProductRequestError("Link do Mercado Livre invalido.", {
      retryable: false,
    });
  }

  const payload = await requestDashboardJson("/api/products/extension/import", {
    method: "POST",
    body: {
      url: normalizedUrl,
      affiliateUrl: normalizedUrl,
      lookupMode: "current",
    },
    timeoutMs: Math.max(MERCADO_LIVRE_TIMEOUT_MS, REQUEST_TIMEOUT_MS),
    fallbackMessage:
      "Nao foi possivel importar o produto do Mercado Livre pelo dashboard local.",
  });

  const normalizedProduct = normalizeFetchedProductPayload(payload?.product, normalizedUrl);

  return {
    status: sanitizeText(payload?.status) === "updated" ? "updated" : "created",
    message: sanitizeText(payload?.message),
    savedProduct: {
      id: sanitizeText(payload?.product?.id) || null,
      title: sanitizeText(payload?.product?.title) || normalizedProduct.title,
      link: sanitizeText(payload?.product?.link) || normalizedProduct.link,
    },
  };
}

async function fetchMercadoLivreProductFromLink(rawLink) {
  try {
    return await fetchMercadoLivreProductFromDashboard(rawLink);
  } catch (error) {
    if (!(error instanceof DashboardProductRequestError) || !error.retryable) {
      throw error;
    }
  }

  const normalizedUrl = normalizeMercadoLivreUrlCandidate(rawLink);
  if (!normalizedUrl) {
    throw new Error("Link do Mercado Livre invalido.");
  }

  const expandedUrl = await expandMercadoLivreUrl(normalizedUrl);
  const productId = extractMercadoLivreProductId(expandedUrl);

  if (!productId) {
    throw new Error("Nao foi possivel identificar o produto do Mercado Livre.");
  }

  const itemResponse = await fetchMercadoLivreApi(`/items/${productId}`);
  if (itemResponse.ok && itemResponse.payload) {
    const item = itemResponse.payload;
    const regularPrice = parsePositiveNumber(item.price);
    const salePrice = extractSalePriceAmount(item.sale_price);
    const price = resolveDisplayedPrice(regularPrice, salePrice);
    const originalPrice = resolveOriginalPrice(item.original_price, regularPrice, price);
    const images = mapMercadoLivrePictures(item.pictures);
    const [description, seller] = await Promise.all([
      fetchMercadoLivreDescription(item.id),
      fetchMercadoLivreSellerName(item.seller_id),
    ]);

    return {
      title: sanitizeText(item.title) || "Produto do Mercado Livre",
      price,
      originalPrice,
      discount:
        originalPrice && originalPrice > price
          ? Math.round(((originalPrice - price) / originalPrice) * 100)
          : undefined,
      hasCouponOrDiscount: Boolean(originalPrice && originalPrice > price),
      couponLabel: undefined,
      image: images[0] ?? sanitizeText(item.thumbnail),
      images: images.length > 0 ? images : [sanitizeText(item.thumbnail)].filter(Boolean),
      description,
      link: sanitizeText(item.permalink) || normalizedUrl,
      seller,
    };
  }

  const [catalogResponse, catalogItemsResponse] = await Promise.all([
    fetchMercadoLivreApi(`/products/${productId}`, { authRequired: true }),
    fetchMercadoLivreApi(`/products/${productId}/items`, { authRequired: true }),
  ]);

  if (!catalogResponse.ok || !catalogItemsResponse.ok) {
    throw new Error("Nao foi possivel consultar o produto do Mercado Livre pela API oficial.");
  }

  const catalogProduct = catalogResponse.payload;
  const bestItem = pickBestCatalogItem(catalogProduct, catalogItemsResponse.payload);
  if (!bestItem) {
    throw new Error("Produto de catalogo sem ofertas disponiveis.");
  }

  const regularPrice = parsePositiveNumber(bestItem.price);
  const salePrice = extractSalePriceAmount(bestItem.sale_price);
  const price = resolveDisplayedPrice(regularPrice, salePrice);
  const originalPrice = resolveOriginalPrice(bestItem.original_price, regularPrice, price);
  const images = mapMercadoLivrePictures(catalogProduct.pictures);
  const [description, seller] = await Promise.all([
    fetchMercadoLivreDescription(bestItem.item_id),
    fetchMercadoLivreSellerName(bestItem.seller_id),
  ]);

  return {
    title: sanitizeText(catalogProduct.name) || "Produto do Mercado Livre",
    price,
    originalPrice,
    discount:
      originalPrice && originalPrice > price
        ? Math.round(((originalPrice - price) / originalPrice) * 100)
        : undefined,
    hasCouponOrDiscount: Boolean(originalPrice && originalPrice > price),
    couponLabel: undefined,
    image: images[0] ?? "",
    images,
    description,
    link: sanitizeText(catalogProduct.permalink) || normalizedUrl,
    seller,
  };
}

async function findExistingProductByLinks(...links) {
  await ensureBotDatabaseReady();
  const normalizedLinks = [...new Set(links.map((link) => sanitizeText(link)).filter(Boolean))];
  if (normalizedLinks.length === 0) {
    return null;
  }

  const result = await databasePool.query(
    `
      SELECT
        id,
        title,
        link
      FROM products
      WHERE link = ANY($1::text[])
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [normalizedLinks],
  );

  return result.rows[0] ?? null;
}

async function insertMercadoLivreProduct(product) {
  await ensureBotDatabaseReady();

  const result = await databasePool.query(
    `
      INSERT INTO products (
        title,
        price,
        original_price,
        discount,
        has_coupon_or_discount,
        coupon_label,
        image,
        images,
        description,
        link,
        marketplace,
        seller
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, 'mercadolivre', $11)
      RETURNING id, title, link
    `,
    [
      sanitizeText(product.title) || "Produto do Mercado Livre",
      Number(product.price ?? 0),
      product.originalPrice ?? null,
      product.discount ?? null,
      Boolean(product.hasCouponOrDiscount),
      sanitizeText(product.couponLabel) || null,
      sanitizeText(product.image),
      JSON.stringify(Array.isArray(product.images) ? product.images : []),
      sanitizeText(product.description),
      sanitizeText(product.link),
      sanitizeText(product.seller) || null,
    ],
  );

  return result.rows[0] ?? null;
}

async function createMercadoLivreProductViaDashboard(product) {
  const payload = await requestDashboardJson("/api/products", {
    method: "POST",
    body: {
      title: product.title,
      price: product.price,
      originalPrice: product.originalPrice ?? null,
      discount: product.discount ?? null,
      hasCouponOrDiscount: product.hasCouponOrDiscount,
      couponLabel: product.couponLabel ?? "",
      image: product.image ?? "",
      images: Array.isArray(product.images) ? product.images : [],
      description: product.description ?? "",
      link: product.link,
      marketplace: "mercadolivre",
      seller: product.seller ?? "",
    },
    timeoutMs: Math.max(MERCADO_LIVRE_TIMEOUT_MS, REQUEST_TIMEOUT_MS),
    fallbackMessage: "Nao foi possivel salvar o produto pelo dashboard local.",
  });

  return {
    id: sanitizeText(payload?.id) || null,
    title: sanitizeText(payload?.title) || sanitizeText(product.title),
    link: sanitizeText(payload?.link) || sanitizeText(product.link),
  };
}

async function updateMercadoLivreProductViaDashboard(productId, product) {
  const payload = await requestDashboardJson("/api/products", {
    method: "PATCH",
    body: {
      id: productId,
      title: product.title,
      price: product.price,
      originalPrice: product.originalPrice ?? null,
      discount: product.discount ?? null,
      hasCouponOrDiscount: product.hasCouponOrDiscount,
      couponLabel: product.couponLabel ?? "",
      image: product.image ?? "",
      images: Array.isArray(product.images) ? product.images : [],
      description: product.description ?? "",
      link: product.link,
      marketplace: "mercadolivre",
      seller: product.seller ?? "",
    },
    timeoutMs: Math.max(MERCADO_LIVRE_TIMEOUT_MS, REQUEST_TIMEOUT_MS),
    fallbackMessage: "Nao foi possivel atualizar o produto pelo dashboard local.",
  });

  return {
    id: sanitizeText(payload?.id) || sanitizeText(productId),
    title: sanitizeText(payload?.title) || sanitizeText(product.title),
    link: sanitizeText(payload?.link) || sanitizeText(product.link),
  };
}

async function createMercadoLivreProduct(product) {
  try {
    return await createMercadoLivreProductViaDashboard(product);
  } catch (error) {
    if (!(error instanceof DashboardProductRequestError) || !error.retryable) {
      throw error;
    }
  }

  return insertMercadoLivreProduct(product);
}

async function updateMercadoLivreProduct(productId, product) {
  try {
    return await updateMercadoLivreProductViaDashboard(productId, product);
  } catch (error) {
    if (!(error instanceof DashboardProductRequestError) || !error.retryable) {
      throw error;
    }
  }

  await ensureBotDatabaseReady();

  const result = await databasePool.query(
    `
      UPDATE products
      SET
        title = $2,
        price = $3,
        original_price = $4,
        discount = $5,
        has_coupon_or_discount = $6,
        coupon_label = $7,
        image = $8,
        images = $9::jsonb,
        description = $10,
        link = $11,
        seller = $12
      WHERE id = $1
      RETURNING id, title, link
    `,
    [
      sanitizeText(productId),
      sanitizeText(product.title) || "Produto do Mercado Livre",
      Number(product.price ?? 0),
      product.originalPrice ?? null,
      product.discount ?? null,
      Boolean(product.hasCouponOrDiscount),
      sanitizeText(product.couponLabel) || null,
      sanitizeText(product.image),
      JSON.stringify(Array.isArray(product.images) ? product.images : []),
      sanitizeText(product.description),
      sanitizeText(product.link),
      sanitizeText(product.seller) || null,
    ],
  );

  return result.rows[0] ?? null;
}

async function importMercadoLivreProductFromLink(rawLink) {
  try {
    return await importMercadoLivreProductViaDashboard(rawLink);
  } catch (error) {
    if (!(error instanceof DashboardProductRequestError) || !error.retryable) {
      throw error;
    }
  }

  const product = await fetchMercadoLivreProductFromLink(rawLink);
  const existingProduct = await findExistingProductByLinks(rawLink, product.link);

  if (existingProduct) {
    const updatedProduct = await updateMercadoLivreProduct(existingProduct.id, product);
    return {
      status: "updated",
      message: "Produto ja existia e foi atualizado com os dados mais recentes.",
      savedProduct: {
        id: updatedProduct?.id ?? existingProduct.id,
        title: updatedProduct?.title ?? existingProduct.title ?? product.title,
        link: updatedProduct?.link ?? existingProduct.link ?? product.link,
      },
    };
  }

  const createdProduct = await createMercadoLivreProduct(product);
  return {
    status: "created",
    message: "Produto cadastrado com sucesso no painel.",
    savedProduct: {
      id: createdProduct?.id ?? null,
      title: createdProduct?.title ?? product.title,
      link: createdProduct?.link ?? product.link,
    },
  };
}

async function findCampaignByName(name) {
  await ensureBotDatabaseReady();
  const normalizedName = sanitizeText(name);
  if (!normalizedName) {
    return null;
  }

  const result = await databasePool.query(
    `
      SELECT
        id,
        name,
        status,
        delay_seconds,
        remaining_count,
        sent_count,
        submitted_count,
        failed_count
      FROM campaigns
      WHERE name ILIKE $1
      ORDER BY
        CASE WHEN LOWER(name) = LOWER($2) THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT 1
    `,
    [`%${normalizedName}%`, normalizedName],
  );

  return result.rows[0] ?? null;
}

async function getCampaignByIdForBot(campaignId) {
  await ensureBotDatabaseReady();
  const result = await databasePool.query(
    `
      SELECT
        id,
        name,
        status,
        delay_seconds,
        remaining_count,
        sent_count,
        failed_count
      FROM campaigns
      WHERE id = $1
      LIMIT 1
    `,
    [campaignId],
  );

  return result.rows[0] ?? null;
}

async function markCampaignReadyToStartFromBot(campaignId) {
  await ensureBotDatabaseReady();
  const result = await databasePool.query(
    `
      UPDATE campaigns
      SET
        status = CASE
          WHEN status IN ('pending', 'failed') THEN 'sending'
          ELSE status
        END,
        last_error = NULL,
        started_at = COALESCE(started_at, NOW()),
        finished_at = NULL
      WHERE id = $1
      RETURNING
        id,
        name,
        status,
        delay_seconds,
        remaining_count
    `,
    [campaignId],
  );

  return result.rows[0] ?? null;
}

async function claimNextCampaignDeliveryFromBot(campaignId) {
  await ensureBotDatabaseReady();
  const result = await databasePool.query(
    `
      WITH next_delivery AS (
        SELECT id
        FROM campaign_deliveries
        WHERE campaign_id = $1
          AND status = 'pending'
        ORDER BY order_index ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE campaign_deliveries
      SET
        status = 'sending',
        attempts = attempts + 1,
        updated_at = NOW()
      FROM next_delivery
      WHERE campaign_deliveries.id = next_delivery.id
      RETURNING
        campaign_deliveries.id,
        campaign_deliveries.campaign_id,
        campaign_deliveries.recipient_type,
        campaign_deliveries.recipient_target,
        campaign_deliveries.recipient_phone,
        campaign_deliveries.recipient_name,
        campaign_deliveries.product_image,
        campaign_deliveries.product_title,
        campaign_deliveries.message
    `,
    [campaignId],
  );

  return result.rows[0] ?? null;
}

async function refreshCampaignProgressFromBot(campaignId) {
  await ensureBotDatabaseReady();
  const result = await databasePool.query(
    `
      WITH stats AS (
        SELECT
          COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
          COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted_count,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
          COUNT(*) FILTER (WHERE status IN ('pending', 'sending'))::int AS remaining_count
        FROM campaign_deliveries
        WHERE campaign_id = $1
      )
      UPDATE campaigns
      SET
        sent_count = stats.sent_count,
        submitted_count = stats.submitted_count,
        failed_count = stats.failed_count,
        remaining_count = stats.remaining_count
      FROM stats
      WHERE campaigns.id = $1
      RETURNING
        campaigns.id,
        campaigns.name,
        campaigns.status,
        campaigns.delay_seconds,
        campaigns.remaining_count,
        campaigns.sent_count,
        campaigns.submitted_count,
        campaigns.failed_count
    `,
    [campaignId],
  );

  return result.rows[0] ?? null;
}

async function markCampaignDeliveryWithStatusFromBot(deliveryId, sendResult, status) {
  const result = await databasePool.query(
    `
      UPDATE campaign_deliveries
      SET
        status = $2,
        last_error = NULL,
        message_id = $3,
        jid = $4,
        sent_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING campaign_id
    `,
    [deliveryId, status, sendResult.messageId ?? null, sendResult.jid ?? null],
  );

  const campaignId = result.rows[0]?.campaign_id;
  if (!campaignId) {
    return null;
  }

  return refreshCampaignProgressFromBot(campaignId);
}

async function markCampaignDeliverySentFromBot(deliveryId, sendResult) {
  return markCampaignDeliveryWithStatusFromBot(deliveryId, sendResult, "sent");
}

async function markCampaignDeliverySubmittedFromBot(deliveryId, sendResult) {
  return markCampaignDeliveryWithStatusFromBot(deliveryId, sendResult, "submitted");
}

async function markCampaignDeliveryFailedFromBot(deliveryId, errorMessage) {
  const result = await databasePool.query(
    `
      UPDATE campaign_deliveries
      SET
        status = 'failed',
        last_error = $2,
        updated_at = NOW()
      WHERE id = $1
      RETURNING campaign_id
    `,
    [deliveryId, sanitizeText(errorMessage) || "Falha ao enviar mensagem."],
  );

  const campaignId = result.rows[0]?.campaign_id;
  if (!campaignId) {
    return null;
  }

  return refreshCampaignProgressFromBot(campaignId);
}

async function markCampaignFinishedFromBot(campaignId) {
  await refreshCampaignProgressFromBot(campaignId);

  const result = await databasePool.query(
    `
      UPDATE campaigns
      SET
        status = CASE
          WHEN remaining_count = 0 THEN 'finished'
          ELSE status
        END,
        finished_at = CASE
          WHEN remaining_count = 0 THEN NOW()
          ELSE finished_at
        END
      WHERE id = $1
      RETURNING
        id,
        name,
        status,
        remaining_count,
        sent_count,
        submitted_count,
        failed_count
    `,
    [campaignId],
  );

  return result.rows[0] ?? null;
}

async function markCampaignFailedFromBot(campaignId, errorMessage) {
  await refreshCampaignProgressFromBot(campaignId);

  const result = await databasePool.query(
    `
      UPDATE campaigns
      SET
        status = 'failed',
        last_error = $2,
        finished_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        name,
        status,
        remaining_count,
        sent_count,
        submitted_count,
        failed_count
    `,
    [campaignId, sanitizeText(errorMessage) || "Falha ao executar campanha."],
  );

  return result.rows[0] ?? null;
}

class WhatsAppSocketService {
  constructor() {
    this.sock = null;
    this.socketEpoch = 0;
    this.removeSocketListeners = null;
    this.lifecycleLock = Promise.resolve();
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;

    this.connected = false;
    this.state = "idle";
    this.qrDataUrl = null;
    this.lastPairingCode = null;
    this.lastPairingCodeAt = null;
    this.groupJidCache = new Map();
    this.groupSubjectCache = new Map();
    this.newsletterJidCache = new Map();
    this.sendQueues = new Map();
    this.runningBotCampaigns = new Set();

    this.logger = pino({
      level: process.env.NODE_ENV === "production" ? "info" : "debug",
      name: "zapmarket-whatsapp-service",
    });
  }

  runLocked(task) {
    const run = this.lifecycleLock.then(task, task);
    this.lifecycleLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  clearReconnectTimer() {
    if (!this.reconnectTimer) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  async disposeSocket(reason) {
    const socket = this.sock;
    const removeListeners = this.removeSocketListeners;
    if (!socket) {
      return;
    }

    this.socketEpoch += 1;
    this.sock = null;
    this.removeSocketListeners = null;

    if (removeListeners) {
      try {
        removeListeners();
      } catch (error) {
        this.logger.debug(
          { err: error },
          "Falha ao remover listeners do socket antigo.",
        );
      }
    }

    try {
      socket.ws?.close?.();
    } catch (error) {
      this.logger.debug({ err: error }, "Falha ao fechar ws do socket antigo.");
    }

    try {
      socket.end?.(new Error(reason));
    } catch (error) {
      this.logger.debug({ err: error }, "Falha ao encerrar socket antigo.");
    }

    await wait(50);
  }

  async createSocket() {
    await this.disposeSocket("socket-replacement");

    this.state = "connecting";
    this.connected = false;
    this.qrDataUrl = null;

    await mkdir(SESSION_PATH, { recursive: true });
    const { state, saveCreds } = await baileysMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    const epoch = this.socketEpoch + 1;
    this.socketEpoch = epoch;

    const sock = makeWASocket({
      version,
      printQRInTerminal: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, this.logger),
      },
      logger: this.logger.child({ module: "baileys" }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    const onConnectionUpdate = (update) => {
      void this.handleConnectionUpdate(update, epoch);
    };
    const onMessagesUpsert = (payload) => {
      void this.handleMessagesUpsert(payload);
    };

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", onConnectionUpdate);
    sock.ev.on("messages.upsert", onMessagesUpsert);

    this.removeSocketListeners = () => {
      try {
        sock.ev.removeAllListeners("creds.update");
      } catch {
        // noop
      }
      try {
        sock.ev.removeAllListeners("connection.update");
      } catch {
        // noop
      }
      try {
        sock.ev.removeAllListeners("messages.upsert");
      } catch {
        // noop
      }
    };

    this.sock = sock;
  }

  scheduleReconnect(trigger) {
    if (this.reconnectTimer) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(
        { attempts: this.reconnectAttempts },
        "Numero maximo de tentativas de reconexao atingido.",
      );
      return;
    }

    const attempt = this.reconnectAttempts + 1;
    const delay = Math.min(30000, 1000 * 2 ** (attempt - 1));
    this.reconnectAttempts = attempt;

    this.logger.info(
      { attempt, delay, trigger },
      "Agendando reconexao do WhatsApp.",
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.runLocked(async () => {
        if (this.connected || this.state === "connecting") {
          return;
        }

        try {
          await this.createSocket();
        } catch (error) {
          this.state = "disconnected";
          this.connected = false;
          this.logger.error(
            { err: error },
            "Falha ao recriar socket durante reconexao.",
          );
          this.scheduleReconnect("retry-failure");
        }
      });
    }, delay);
  }

  async handleConnectionUpdate(update, epoch) {
    if (epoch !== this.socketEpoch) {
      return;
    }

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        this.qrDataUrl = await QRCode.toDataURL(qr);
        broadcastRealtimeEvent("status:update", this.getStatus());
      } catch (error) {
        this.logger.error({ err: error }, "Falha ao converter QR para base64.");
      }
    }

    if (connection === "open") {
      this.clearReconnectTimer();
      this.reconnectAttempts = 0;
      this.connected = true;
      this.state = "connected";
      this.qrDataUrl = null;
      this.logger.info("WhatsApp conectado com sucesso.");
      await logBotEvent({
        level: "info",
        event: "whatsapp.connected",
        details: this.getStatus(),
      });
      broadcastRealtimeEvent("status:update", this.getStatus());
      return;
    }

    if (connection === "close") {
      await this.runLocked(async () => {
        if (epoch !== this.socketEpoch) {
          return;
        }

        this.connected = false;
        this.state = "disconnected";

        const statusCode = parseStatusCode(lastDisconnect);
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        this.logger.warn(
          { statusCode, shouldReconnect },
          "Conexao WhatsApp encerrada.",
        );
        broadcastRealtimeEvent("status:update", this.getStatus());

        await this.disposeSocket("connection-close");

        if (shouldReconnect) {
          this.scheduleReconnect("connection-close");
        } else {
          this.clearReconnectTimer();
          this.logger.error(
            "Sessao deslogada. Pareie novamente para restaurar a conexao.",
          );
        }
      });
    }
  }

  async start() {
    await this.runLocked(async () => {
      if (this.connected || this.state === "connecting") {
        return;
      }

      try {
        await ensureBotDatabaseReady();
        await this.createSocket();
      } catch (error) {
        this.state = "disconnected";
        this.connected = false;
        this.scheduleReconnect("start-failure");
        throw error;
      }
    });
  }

  async stop() {
    await this.runLocked(async () => {
      this.clearReconnectTimer();
      await this.disposeSocket("manual-stop");
      this.connected = false;
      this.state = "idle";
    });
  }

  async clearSession() {
    await this.runLocked(async () => {
      this.clearReconnectTimer();
      this.reconnectAttempts = 0;
      this.qrDataUrl = null;
      this.lastPairingCode = null;
      this.lastPairingCodeAt = null;
      this.groupJidCache.clear();
      this.groupSubjectCache.clear();
      this.newsletterJidCache.clear();

      if (this.sock?.logout) {
        try {
          await this.sock.logout();
        } catch (error) {
          this.logger.debug(
            { err: error },
            "Falha ao deslogar socket antes de limpar sessao.",
          );
        }
      }

      await this.disposeSocket("clear-session");
      await rm(SESSION_PATH, { recursive: true, force: true });
      await mkdir(SESSION_PATH, { recursive: true });

      this.connected = false;
      this.state = "idle";
    });

    broadcastRealtimeEvent("status:update", this.getStatus());

    try {
      await this.start();
    } catch (error) {
      this.logger.warn(
        { err: error },
        "Sessao limpa, mas a reinicializacao imediata do cliente falhou.",
      );
    }

    return this.getStatus();
  }

  async getQR() {
    await this.start();

    if (this.connected) {
      return null;
    }

    if (this.qrDataUrl) {
      return this.qrDataUrl;
    }

    const timeoutAt = Date.now() + 20000;
    while (!this.qrDataUrl && !this.connected && Date.now() < timeoutAt) {
      await wait(500);
    }

    return this.qrDataUrl;
  }

  async getPairingCode(phone) {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!isValidPhoneNumber(normalizedPhone)) {
      throw new Error("Numero invalido. Use o formato com DDI e DDD.");
    }

    await this.start();

    if (this.connected) {
      throw new Error("WhatsApp ja esta conectado.");
    }

    if (!this.sock) {
      throw new Error("Cliente WhatsApp indisponivel.");
    }

    const code = await withTimeout(
      this.sock.requestPairingCode(normalizedPhone),
      REQUEST_TIMEOUT_MS,
    );
    this.lastPairingCode = formatPairingCode(code);
    this.lastPairingCodeAt = Date.now();
    broadcastRealtimeEvent("status:update", this.getStatus());
    return this.lastPairingCode;
  }

  enqueueSend(jid, task) {
    const queueKey = sanitizeText(jid);
    const previousTask = this.sendQueues.get(queueKey) ?? Promise.resolve();
    const nextTask = previousTask
      .catch(() => undefined)
      .then(task);

    this.sendQueues.set(queueKey, nextTask);

    return nextTask.finally(() => {
      if (this.sendQueues.get(queueKey) === nextTask) {
        this.sendQueues.delete(queueKey);
      }
    });
  }

  async handleMessagesUpsert(payload) {
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];

    for (const message of messages) {
      if (!message || message.key?.fromMe) {
        continue;
      }

      const remoteJid = sanitizeText(
        message.key?.remoteJid ??
          message.key?.participant ??
          message.message?.extendedTextMessage?.contextInfo?.participant ??
          "",
      );
      if (!isBotConversationJid(remoteJid) || remoteJid === "status@broadcast") {
        continue;
      }

      const content = extractMessageContent(message.message);
      const text = sanitizeText(content?.text);
      if (!text) {
        continue;
      }

      const phone = normalizeChatPhone(remoteJid);
      const contactName = await this.resolveBotConversationName(
        remoteJid,
        sanitizeText(message.pushName ?? ""),
      );
      const senderJid = sanitizeText(
        message.key?.participant ??
          message.message?.extendedTextMessage?.contextInfo?.participant ??
          remoteJid,
      );
      const senderName = sanitizeText(message.pushName ?? "") || contactName;
      const createdAt = message.messageTimestamp
        ? new Date(Number(message.messageTimestamp) * 1000)
        : new Date();

      const savedMessage = await saveMessageLog({
        whatsappMessageId: sanitizeText(message.key?.id) || null,
        phone,
        remoteJid,
        contactName,
        text,
        fromMe: false,
        messageType: content?.type ?? "text",
        createdAt,
      }).catch((error) => {
        this.logger.error({ err: error, remoteJid }, "Falha ao salvar mensagem recebida.");
        return null;
      });

      if (sanitizeText(message.key?.id) && !savedMessage) {
        continue;
      }

      broadcastRealtimeEvent("message:new", {
        phone,
        remoteJid,
      });

      await logBotEvent({
        phone,
        remoteJid,
        level: "info",
        event: "bot.message.received",
        details: {
          text: shortenText(text, 240),
        },
      });

      await this.processIncomingBotMessage({
        phone,
        remoteJid,
        contactName,
        senderJid,
        senderName,
        text,
      });
    }
  }

  async processIncomingBotMessage({
    phone,
    remoteJid,
    contactName,
    senderJid,
    senderName,
    text,
  }) {
    const normalizedText = sanitizeText(text);
    const normalizedLower = normalizedText.toLowerCase();

    if (isAssistantCommandMessage(normalizedText)) {
      await this.handleAssistantCommand({
        phone,
        remoteJid,
        contactName,
        senderJid,
        senderName,
        message: normalizedText,
      });
      return;
    }

    if (normalizedLower === "/ativar") {
      const session = await setBotActiveState({
        phone,
        remoteJid,
        contactName,
        active: true,
        lastMessage: normalizedText,
      });

      await logBotEvent({
        phone,
        remoteJid,
        level: "info",
        event: "bot.session.activated",
        details: {
          sessionId: session?.id ?? null,
        },
      });

      broadcastRealtimeEvent("session:update", {
        phone,
        remoteJid,
      });

      await this.sendBotReply(remoteJid, "🤖 Bot ativado com sucesso!", {
        phone,
        contactName,
      });
      return;
    }

    if (normalizedLower === "/desativar") {
      const session = await setBotActiveState({
        phone,
        remoteJid,
        contactName,
        active: false,
        lastMessage: normalizedText,
      });

      await logBotEvent({
        phone,
        remoteJid,
        level: "info",
        event: "bot.session.deactivated",
        details: {
          sessionId: session?.id ?? null,
        },
      });

      broadcastRealtimeEvent("session:update", {
        phone,
        remoteJid,
      });

      await this.sendBotReply(remoteJid, "❌ Bot desativado!", {
        phone,
        contactName,
      });
      return;
    }

    const session = await getBotSessionByPhone(phone);
    if (!session?.bot_active) {
      return;
    }

    const campaignCommandMatch = normalizedText.match(/^\/campanha\s+(.+)$/i);
    if (campaignCommandMatch) {
      await this.handleCampaignCommand({
        phone,
        remoteJid,
        contactName,
        campaignName: campaignCommandMatch[1],
      });
      return;
    }

    const mercadoLivreLink = extractMercadoLivreLink(normalizedText);
    if (mercadoLivreLink) {
      await this.handleMercadoLivreLink({
        phone,
        remoteJid,
        contactName,
        link: mercadoLivreLink,
      });
      return;
    }

    if (/^oi\b/i.test(normalizedText)) {
      await this.sendBotReply(
        remoteJid,
        '👋 Ola! Envie "promocao" para ver produtos, "ofertas" para campanhas ou um link do Mercado Livre para cadastrar.',
        {
          phone,
          contactName,
        },
      );
      return;
    }

    if (/\bpromo[cç][aã]o\b/i.test(normalizedText)) {
      await this.handlePromotionRequest({
        phone,
        remoteJid,
        contactName,
      });
      return;
    }

    if (/\bofertas\b/i.test(normalizedText)) {
      await this.handleOffersRequest({
        phone,
        remoteJid,
        contactName,
        linkedCampaignId: session.linked_campaign_id ?? null,
      });
    }
  }

  async handleAssistantCommand({
    phone,
    remoteJid,
    contactName,
    senderJid,
    senderName,
    message,
  }) {
    await logBotEvent({
      phone,
      remoteJid,
      level: "info",
      event: "bot.assistant.request",
      details: {
        senderJid: sanitizeText(senderJid) || null,
        senderName: sanitizeText(senderName) || null,
        text: shortenText(message, 240),
      },
    });

    try {
      const reply = await requestBotAssistantReply({
        remoteJid,
        senderId: sanitizeText(senderJid) || remoteJid,
        senderName: sanitizeText(senderName) || contactName,
        message,
      });

      await this.sendBotReply(remoteJid, reply, {
        phone,
        contactName,
      });

      await logBotEvent({
        phone,
        remoteJid,
        level: "info",
        event: "bot.assistant.reply",
        details: {
          senderJid: sanitizeText(senderJid) || null,
          senderName: sanitizeText(senderName) || null,
          reply: shortenText(reply, 240),
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await logBotEvent({
        phone,
        remoteJid,
        level: "error",
        event: "bot.assistant.error",
        details: {
          senderJid: sanitizeText(senderJid) || null,
          senderName: sanitizeText(senderName) || null,
          message: errorMessage,
        },
      });

      await this.sendBotReply(
        remoteJid,
        "⚠️ Nao consegui falar com o assistente agora. Tente novamente em alguns segundos.",
        {
          phone,
          contactName,
        },
      );
    }
  }

  async handlePromotionRequest({ phone, remoteJid, contactName }) {
    const products = await listRecentProducts(5);

    if (products.length === 0) {
      await this.sendBotReply(
        remoteJid,
        "📦 Ainda nao ha produtos cadastrados. Envie um link do Mercado Livre para eu cadastrar.",
        {
          phone,
          contactName,
        },
      );
      return;
    }

    await this.sendBotReply(remoteJid, "🔥 Separei algumas promocoes para voce:", {
      phone,
      contactName,
    });

    for (const product of products) {
      await this.sendBotReply(
        remoteJid,
        `📱 ${product.title}\n💰 ${formatCurrencyBRL(product.price)}\n\n🔗 ${product.link}`,
        {
          phone,
          contactName,
        },
      );
    }
  }

  async handleOffersRequest({ phone, remoteJid, contactName, linkedCampaignId }) {
    const campaigns = await listOfferCampaigns(5);

    if (campaigns.length === 0) {
      await this.sendBotReply(
        remoteJid,
        "📢 Nao encontrei campanhas ativas no momento.",
        {
          phone,
          contactName,
        },
      );
      return;
    }

    const linkedCampaign =
      linkedCampaignId &&
      campaigns.find((campaign) => campaign.id === linkedCampaignId);

    const lines = campaigns.map((campaign) => {
      const statusLabel = campaign.status === "sending" ? "em envio" : "pronta";
      const suffix =
        linkedCampaign && linkedCampaign.id === campaign.id ? " • vinculada a esta conversa" : "";
      return `• ${campaign.name} (${statusLabel}${suffix})`;
    });

    await this.sendBotReply(
      remoteJid,
      `📢 Campanhas disponiveis agora:\n${lines.join("\n")}\n\nUse /campanha nome_da_campanha para disparar uma campanha.`,
      {
        phone,
        contactName,
      },
    );
  }

  async handleMercadoLivreLink({ phone, remoteJid, contactName, link }) {
    await this.sendBotReply(remoteJid, "📦 Produto recebido, processando...", {
      phone,
      contactName,
    });

    try {
      const importedProduct = await importMercadoLivreProductFromLink(link);
      const productEvent =
        importedProduct.status === "updated" ? "bot.product.updated" : "bot.product.created";
      const realtimeEvent =
        importedProduct.status === "updated" ? "product:updated" : "product:created";

      await logBotEvent({
        phone,
        remoteJid,
        level: "info",
        event: productEvent,
        details: {
          productId: importedProduct.savedProduct.id,
          title: importedProduct.savedProduct.title,
          link: importedProduct.savedProduct.link,
          sourceLink: link,
        },
      });

      broadcastRealtimeEvent(realtimeEvent, {
        phone,
        remoteJid,
        productId: importedProduct.savedProduct.id,
      });

      await this.sendBotReply(
        remoteJid,
        importedProduct.status === "updated"
          ? `ℹ️ Esse produto ja estava cadastrado e foi atualizado:\n${importedProduct.savedProduct.title}`
          : importedProduct.message || "✅ Produto cadastrado com sucesso!",
        {
          phone,
          contactName,
        },
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Nao foi possivel cadastrar o produto enviado.";

      await logBotEvent({
        phone,
        remoteJid,
        level: "error",
        event: "bot.product.error",
        details: {
          link,
          message,
        },
      });

      await this.sendBotReply(
        remoteJid,
        `⚠️ Nao consegui cadastrar esse produto.\n${message}`,
        {
          phone,
          contactName,
        },
      );
    }
  }

  async handleCampaignCommand({ phone, remoteJid, contactName, campaignName }) {
    const campaign = await findCampaignByName(campaignName);
    if (!campaign) {
      await this.sendBotReply(
        remoteJid,
        "📢 Nao encontrei essa campanha pelo nome informado.",
        {
          phone,
          contactName,
        },
      );
      return;
    }

    if (campaign.status === "finished" && Number(campaign.remaining_count ?? 0) === 0) {
      await this.sendBotReply(
        remoteJid,
        `📢 A campanha "${campaign.name}" ja foi finalizada.`,
        {
          phone,
          contactName,
        },
      );
      return;
    }

    if (this.runningBotCampaigns.has(campaign.id) || campaign.status === "sending") {
      await this.sendBotReply(
        remoteJid,
        `📢 A campanha "${campaign.name}" ja esta em andamento.`,
        {
          phone,
          contactName,
        },
      );
      return;
    }

    const readyCampaign = await markCampaignReadyToStartFromBot(campaign.id);
    if (!readyCampaign) {
      await this.sendBotReply(
        remoteJid,
        "📢 Nao foi possivel iniciar essa campanha agora.",
        {
          phone,
          contactName,
        },
      );
      return;
    }

    await logBotEvent({
      phone,
      remoteJid,
      level: "info",
      event: "bot.campaign.started",
      details: {
        campaignId: readyCampaign.id,
        campaignName: readyCampaign.name,
      },
    });

    broadcastRealtimeEvent("campaign:update", {
      campaignId: readyCampaign.id,
    });

    await this.sendBotReply(
      remoteJid,
      `📢 Campanha "${readyCampaign.name}" iniciada com sucesso!`,
      {
        phone,
        contactName,
      },
    );

    void this.runBotCampaign(readyCampaign.id);
  }

  async runBotCampaign(campaignId) {
    if (this.runningBotCampaigns.has(campaignId)) {
      return;
    }

    this.runningBotCampaigns.add(campaignId);

    try {
      while (true) {
        const campaign = await getCampaignByIdForBot(campaignId);
        if (!campaign || campaign.status !== "sending") {
          return;
        }

        const delivery = await claimNextCampaignDeliveryFromBot(campaignId);
        if (!delivery) {
          const finishedCampaign = await markCampaignFinishedFromBot(campaignId);
          await logBotEvent({
            level: "info",
            event: "bot.campaign.finished",
            details: {
              campaignId,
              campaignName: finishedCampaign?.name ?? null,
              sentCount: finishedCampaign?.sent_count ?? null,
              submittedCount: finishedCampaign?.submitted_count ?? null,
              failedCount: finishedCampaign?.failed_count ?? null,
            },
          });
          broadcastRealtimeEvent("campaign:update", {
            campaignId,
          });
          return;
        }

        try {
          const sendResult = await this.sendMessage(
            {
              recipientType:
                delivery.recipient_type === "group"
                  ? "group"
                  : delivery.recipient_type === "channel"
                    ? "channel"
                    : "contact",
              target: delivery.recipient_target,
              message: delivery.message,
              imageUrl: delivery.product_image ?? "",
            },
            undefined,
            undefined,
            {
              phone: delivery.recipient_phone,
              contactName: delivery.recipient_name,
              logMessage: true,
            },
          );

          if (sendResult.deliveryStatus === "submitted") {
            await markCampaignDeliverySubmittedFromBot(delivery.id, sendResult);
          } else {
            await markCampaignDeliverySentFromBot(delivery.id, sendResult);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await markCampaignDeliveryFailedFromBot(delivery.id, message);

          if (isFatalCampaignError(message)) {
            await markCampaignFailedFromBot(campaignId, message);
            await logBotEvent({
              level: "error",
              event: "bot.campaign.stopped",
              details: {
                campaignId,
                message,
              },
            });
            broadcastRealtimeEvent("campaign:update", {
              campaignId,
            });
            return;
          }
        }

        broadcastRealtimeEvent("campaign:update", {
          campaignId,
        });

        const waitMs =
          Number(campaign.delay_seconds ?? 0) * 1000 +
          resolveRandomDelayMs(BOT_CAMPAIGN_DELAY_RANGE_MS);
        if (waitMs > 0) {
          await wait(waitMs);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markCampaignFailedFromBot(campaignId, message).catch(() => null);
      await logBotEvent({
        level: "error",
        event: "bot.campaign.error",
        details: {
          campaignId,
          message,
        },
      });
      broadcastRealtimeEvent("campaign:update", {
        campaignId,
      });
    } finally {
      this.runningBotCampaigns.delete(campaignId);
    }
  }

  async sendBotReply(jid, text, options = {}) {
    return this.sendContent(jid, text, null, {
      ...options,
      delayMs: resolveRandomDelayMs(BOT_AUTOMATION_DELAY_RANGE_MS),
      logMessage: true,
      messageType: "text",
    });
  }

  async sendContent(jid, text, mediaUrl, options = {}) {
    await this.start();

    if (!this.connected || !this.sock) {
      throw new Error("WhatsApp nao conectado.");
    }

    const normalizedText = sanitizeText(text);
    if (!normalizedText || normalizedText.length > BOT_MESSAGE_LIMIT) {
      throw new Error("Mensagem obrigatoria e deve ter no maximo 1000 caracteres.");
    }

    return this.enqueueSend(jid, async () => {
      if (options.delayMs && options.delayMs > 0) {
        await wait(options.delayMs);
      }

      let usedImage = false;
      let result;

      if (mediaUrl) {
        try {
          result = await withTimeout(
            this.sock.sendMessage(jid, {
              image: {
                url: mediaUrl,
              },
              caption: normalizedText,
            }),
            REQUEST_TIMEOUT_MS,
          );
          usedImage = true;
        } catch (error) {
          this.logger.warn(
            { err: error, mediaUrl },
            "Falha ao enviar imagem da campanha. Recuando para texto puro.",
          );
        }
      }

      if (!result) {
        result = await withTimeout(
          this.sock.sendMessage(jid, { text: normalizedText }),
          REQUEST_TIMEOUT_MS,
        );
      }

      if (options.logMessage && isBotConversationJid(jid)) {
        const phone = normalizeChatPhone(options.phone ?? jid);
        const contactName = sanitizeText(options.contactName);

        await saveMessageLog({
          whatsappMessageId: sanitizeText(result?.key?.id) || null,
          phone,
          remoteJid: jid,
          contactName,
          text: normalizedText,
          fromMe: true,
          messageType: options.messageType ?? "text",
          createdAt: new Date(),
        }).catch((error) => {
          this.logger.error({ err: error, jid }, "Falha ao registrar resposta do bot.");
        });

        broadcastRealtimeEvent("message:new", {
          phone,
          remoteJid: jid,
        });
      }

      return {
        jid,
        messageId: result?.key?.id ?? null,
        usedImage,
        deliveryStatus: isNewsletterJid(jid) ? "submitted" : "sent",
      };
    });
  }

  async resolveGroupJid(inviteCode) {
    const normalizedInviteCode = normalizeInviteCode(inviteCode);

    if (!isValidInviteCode(normalizedInviteCode)) {
      throw new Error("Codigo de convite do grupo invalido.");
    }

    const cached = this.groupJidCache.get(normalizedInviteCode);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.jid;
    }

    await this.start();

    if (!this.connected || !this.sock) {
      throw new Error("WhatsApp nao conectado.");
    }

    let metadata;

    try {
      metadata = await withTimeout(
        this.sock.groupGetInviteInfo(normalizedInviteCode),
        REQUEST_TIMEOUT_MS,
      );
    } catch (error) {
      this.logger.warn(
        { err: error, inviteCode: normalizedInviteCode },
        "Falha ao consultar o grupo pelo convite.",
      );
      throw new Error("Nao foi possivel consultar o grupo pelo convite informado.");
    }

    const jid = typeof metadata?.id === "string" ? metadata.id : null;
    if (!jid) {
      throw new Error("Nao foi possivel resolver o grupo pelo convite informado.");
    }

    this.groupJidCache.set(normalizedInviteCode, {
      jid,
      expiresAt: Date.now() + GROUP_JID_CACHE_TTL_MS,
    });

    return jid;
  }

  async joinGroup(inviteCode, fallbackJid) {
    const normalizedInviteCode = normalizeInviteCode(inviteCode);

    if (!isValidInviteCode(normalizedInviteCode)) {
      throw new Error("Codigo de convite do grupo invalido.");
    }

    await this.start();

    if (!this.connected || !this.sock) {
      throw new Error("WhatsApp nao conectado.");
    }

    const joinedJid = await withTimeout(
      this.sock.groupAcceptInvite(normalizedInviteCode),
      REQUEST_TIMEOUT_MS,
    );

    const jid =
      typeof joinedJid === "string" && joinedJid.trim().length > 0
        ? joinedJid
        : fallbackJid;

    if (!jid) {
      throw new Error("Nao foi possivel entrar no grupo informado.");
    }

    this.groupJidCache.set(normalizedInviteCode, {
      jid,
      expiresAt: Date.now() + GROUP_JID_CACHE_TTL_MS,
    });

    return jid;
  }

  async resolveBotConversationName(remoteJid, fallbackName = "") {
    const fallbackLabel =
      sanitizeText(fallbackName) || normalizeChatPhone(remoteJid) || sanitizeText(remoteJid);

    if (!isGroupJid(remoteJid)) {
      return fallbackLabel;
    }

    const cached = this.groupSubjectCache.get(remoteJid);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.subject;
    }

    if (!this.connected || !this.sock) {
      return fallbackLabel;
    }

    try {
      const metadata = await withTimeout(
        this.sock.groupMetadata(remoteJid),
        REQUEST_TIMEOUT_MS,
      );
      const subject = sanitizeText(metadata?.subject);

      if (!subject) {
        return fallbackLabel;
      }

      this.groupSubjectCache.set(remoteJid, {
        subject,
        expiresAt: Date.now() + GROUP_SUBJECT_CACHE_TTL_MS,
      });

      return subject;
    } catch (error) {
      this.logger.debug(
        { err: error, remoteJid },
        "Falha ao resolver o nome do grupo para o bot.",
      );
      return fallbackLabel;
    }
  }

  async resolveChannelJid(target) {
    const normalizedTarget = resolveChannelTarget(target);

    if (!normalizedTarget) {
      throw new Error("Link do canal invalido.");
    }

    const cached = this.newsletterJidCache.get(normalizedTarget.cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.jid;
    }

    await this.start();

    if (!this.connected || !this.sock) {
      throw new Error("WhatsApp nao conectado.");
    }

    let metadata;

    try {
      metadata = await withTimeout(
        this.sock.newsletterMetadata(normalizedTarget.type, normalizedTarget.key),
        REQUEST_TIMEOUT_MS,
      );
    } catch (error) {
      this.logger.warn(
        { err: error, target: normalizedTarget.key, lookupType: normalizedTarget.type },
        "Falha ao consultar o canal informado.",
      );
      throw new Error("Nao foi possivel consultar o canal informado.");
    }

    const jid = normalizeNewsletterJid(metadata?.id ?? normalizedTarget.key);
    if (!jid) {
      throw new Error("Nao foi possivel resolver o canal informado.");
    }

    const cacheEntry = {
      jid,
      expiresAt: Date.now() + NEWSLETTER_JID_CACHE_TTL_MS,
    };

    this.newsletterJidCache.set(normalizedTarget.cacheKey, cacheEntry);
    this.newsletterJidCache.set(`jid:${jid}`, cacheEntry);

    return jid;
  }

  async getChannelSendAccess(target) {
    const normalizedTarget = resolveChannelTarget(target);

    if (!normalizedTarget) {
      throw new Error("Link do canal invalido.");
    }

    await this.start();

    if (!this.connected || !this.sock) {
      throw new Error("WhatsApp nao conectado.");
    }

    let metadata;

    try {
      metadata = await withTimeout(
        this.sock.newsletterMetadata(normalizedTarget.type, normalizedTarget.key),
        REQUEST_TIMEOUT_MS,
      );
    } catch (error) {
      this.logger.warn(
        { err: error, target: normalizedTarget.key, lookupType: normalizedTarget.type },
        "Falha ao consultar permissao do canal informado.",
      );
      throw new Error("Nao foi possivel validar o canal informado.");
    }

    const jid = normalizeNewsletterJid(metadata?.id ?? normalizedTarget.key);
    if (!jid) {
      throw new Error("Nao foi possivel resolver o canal informado.");
    }

    const cacheEntry = {
      jid,
      expiresAt: Date.now() + NEWSLETTER_JID_CACHE_TTL_MS,
    };

    this.newsletterJidCache.set(normalizedTarget.cacheKey, cacheEntry);
    this.newsletterJidCache.set(`jid:${jid}`, cacheEntry);

    const role = extractChannelViewerRole(metadata);
    const owner = extractChannelOwner(metadata);
    const connectedUser =
      normalizeWhatsappUserJid(this.sock.user?.id) ??
      normalizeWhatsappUserJid(this.sock.user?.phoneNumber) ??
      normalizeWhatsappUserJid(this.sock.user?.lid);
    const isOwnerSession = areSameWhatsappUser(owner, connectedUser);

    return {
      jid,
      role,
      owner,
      connectedUser,
      canSend: isOwnerSession || (role ? CHANNEL_ADMIN_ROLES.has(role) : false),
      name: extractChannelDisplayName(metadata),
    };
  }

  async sendMessage(input, message, imageUrl, options = {}) {
    const payload =
      typeof input === "object" && input !== null
        ? {
          recipientType:
            input.recipientType === "group"
              ? "group"
              : input.recipientType === "channel"
                ? "channel"
                : "contact",
            target: String(input.target ?? ""),
            message: input.message ?? "",
            imageUrl: input.imageUrl ?? "",
          }
        : {
            recipientType: "contact",
            target: input,
            message,
            imageUrl,
          };

    const text = String(payload.message ?? "").trim();
    const mediaUrl = isValidMediaUrl(payload.imageUrl) ? String(payload.imageUrl).trim() : null;

    if (text.length === 0 || text.length > 1000) {
      throw new Error("Mensagem obrigatoria e deve ter no maximo 1000 caracteres.");
    }

    if (payload.recipientType === "group") {
      const inviteCode = normalizeInviteCode(payload.target);

      if (!isValidInviteCode(inviteCode)) {
        throw new Error("Codigo de convite do grupo invalido.");
      }

      const jid = await this.resolveGroupJid(inviteCode);

      try {
        return await this.sendContent(jid, text, mediaUrl, {
          ...options,
          logMessage: false,
        });
      } catch (error) {
        if (!shouldRetryGroupJoin(error)) {
          throw error;
        }

        this.logger.warn(
          { err: error, inviteCode },
          "Falha inicial ao enviar para grupo. Tentando entrar pelo convite.",
        );

        const joinedJid = await this.joinGroup(inviteCode, jid);
        return this.sendContent(joinedJid, text, mediaUrl, {
          ...options,
          logMessage: false,
        });
      }
    }

    if (payload.recipientType === "channel") {
      const jid = await this.resolveChannelJid(payload.target);

      try {
        return await this.sendContent(jid, text, mediaUrl, {
          ...options,
          logMessage: false,
        });
      } catch (error) {
        this.logger.warn(
          { err: error, target: payload.target, jid },
          "Falha ao enviar para canal.",
        );
        throw new Error(getChannelSendErrorMessage(error));
      }
    }

    const normalized = normalizePhoneNumber(payload.target);

    if (!isValidPhoneNumber(normalized)) {
      throw new Error("Numero invalido para envio.");
    }

    return this.sendContent(`${normalized}@s.whatsapp.net`, text, mediaUrl, {
      ...options,
      phone: normalized,
      logMessage: options.logMessage ?? false,
    });
  }

  getStatus() {
    return {
      connected: this.connected,
      state: this.state,
      qrAvailable: Boolean(this.qrDataUrl),
      lastPairingCode: this.lastPairingCode,
      lastPairingCodeAt: this.lastPairingCodeAt
        ? new Date(this.lastPairingCodeAt).toISOString()
        : null,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
    };
  }
}

const whatsappService = new WhatsAppSocketService();
const realtimeServer = new WebSocketServer({ noServer: true });

function broadcastRealtimeEvent(type, payload = {}) {
  const message = JSON.stringify({
    type,
    payload,
    at: new Date().toISOString(),
  });

  for (const client of realtimeServer.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

const server = http.createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const requestUrl = new URL(req.url ?? "/", `http://${SERVICE_HOST}:${SERVICE_PORT}`);
  const pathname = requestUrl.pathname;

  try {
    if (method === "GET" && pathname === "/status") {
      await whatsappService.start().catch(() => null);
      writeJson(res, 200, whatsappService.getStatus());
      return;
    }

    if (method === "GET" && pathname === "/qr") {
      const qr = await whatsappService.getQR();
      const status = whatsappService.getStatus();
      writeJson(res, 200, {
        qr,
        connected: status.connected,
        state: status.state,
      });
      return;
    }

    if (method === "POST" && pathname === "/pair") {
      const body = await readJsonBody(req);
      const code = await whatsappService.getPairingCode(body.phone ?? "");
      writeJson(res, 200, { code });
      return;
    }

    if (method === "POST" && pathname === "/send") {
      const body = await readJsonBody(req);
      const result = await whatsappService.sendMessage({
        recipientType:
          body.recipientType === "group"
            ? "group"
            : body.recipientType === "channel"
              ? "channel"
              : "contact",
        target: body.target ?? body.number ?? "",
        message: body.message ?? "",
        imageUrl: body.imageUrl ?? "",
      });
      writeJson(res, 200, { sent: true, ...result });
      return;
    }

    if (method === "POST" && pathname === "/channel-access") {
      const body = await readJsonBody(req);
      const target = sanitizeText(body.target);

      if (!target) {
        writeJson(res, 400, { error: "Link do canal e obrigatorio." });
        return;
      }

      const result = await whatsappService.getChannelSendAccess(target);
      writeJson(res, 200, { ok: true, ...result });
      return;
    }

    if (method === "POST" && pathname === "/clear-session") {
      const status = await whatsappService.clearSession();
      writeJson(res, 200, { cleared: true, ...status });
      return;
    }

    writeJson(res, 404, { error: "Endpoint nao encontrado." });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lowerMessage = message.toLowerCase();

    if (
      lowerMessage.includes("numero invalido") ||
      lowerMessage.includes("codigo de convite") ||
      lowerMessage.includes("link do canal invalido") ||
      lowerMessage.includes("mensagem obrigatoria") ||
      lowerMessage.includes("json invalido") ||
      lowerMessage.includes("muito grande")
    ) {
      writeJson(res, 400, { error: message });
      return;
    }

    if (lowerMessage.includes("nao foi possivel validar o canal informado")) {
      writeJson(res, 400, { error: message });
      return;
    }

    if (lowerMessage.includes("nao conectado")) {
      writeJson(res, 409, { error: message });
      return;
    }

    writeJson(res, 500, { error: message || "Falha no servico do WhatsApp." });
  }
});

realtimeServer.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "status:update",
      payload: whatsappService.getStatus(),
      at: new Date().toISOString(),
    }),
  );
});

server.on("upgrade", (req, socket, head) => {
  const requestUrl = new URL(req.url ?? "/", `http://${SERVICE_HOST}:${SERVICE_PORT}`);
  if (requestUrl.pathname !== "/events") {
    socket.destroy();
    return;
  }

  realtimeServer.handleUpgrade(req, socket, head, (ws) => {
    realtimeServer.emit("connection", ws, req);
  });
});

async function shutdown(signal) {
  console.log(`[whatsapp-service] encerrando (${signal})...`);
  server.close(() => {
    console.log("[whatsapp-service] servidor HTTP encerrado.");
  });
  try {
    await new Promise((resolve) => realtimeServer.close(resolve));
  } catch {
    // noop
  }
  await whatsappService.stop().catch(() => null);
  await databasePool.end().catch(() => null);
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

server.listen(SERVICE_PORT, SERVICE_HOST, () => {
  void ensureBotDatabaseReady().catch((error) => {
    console.error("[whatsapp-service] falha ao preparar banco do bot:", error);
  });
  console.log(`[whatsapp-service] rodando em http://${SERVICE_HOST}:${SERVICE_PORT}`);
  for (const serviceUrl of buildServiceBaseUrls()) {
    console.log(`[whatsapp-service] acesso: ${serviceUrl}`);
  }
  console.log(`[whatsapp-service] sessao em ${SESSION_PATH}`);
});

