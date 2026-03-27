import path from "node:path";
import { readFile } from "node:fs/promises";
import { db } from "@/lib/db";
import { getCampaignById, listCampaigns } from "@/lib/campaigns/store";

export class BotWhatsappValidationError extends Error {}
export class BotWhatsappNotFoundError extends Error {}

type BotSessionRow = {
  id: string;
  phone: string;
  remote_jid: string;
  contact_name: string | null;
  bot_active: boolean;
  linked_campaign_id: string | null;
  linked_campaign_name: string | null;
  last_message: string | null;
  last_message_from_me: boolean;
  last_message_at: Date | string | null;
  total_messages: number | string;
  created_at: Date | string;
  updated_at: Date | string;
};

type BotMessageRow = {
  id: string;
  whatsapp_message_id: string | null;
  phone: string;
  remote_jid: string;
  contact_name: string | null;
  message: string;
  from_me: boolean;
  message_type: string;
  created_at: Date | string;
};

type BotLogRow = {
  id: string;
  phone: string | null;
  remote_jid: string | null;
  level: string;
  event: string;
  details: unknown;
  created_at: Date | string;
};

type BotStatsRow = {
  total_conversations: number | string;
  active_conversations: number | string;
  linked_campaigns: number | string;
  total_messages: number | string;
  messages_today: number | string;
};

export type BotConversationRecord = {
  id: string;
  phone: string;
  remoteJid: string;
  contactName?: string;
  botActive: boolean;
  linkedCampaignId?: string;
  linkedCampaignName?: string;
  lastMessage?: string;
  lastMessageFromMe: boolean;
  lastMessageAt?: Date;
  totalMessages: number;
  createdAt: Date;
  updatedAt: Date;
};

export type BotMessageRecord = {
  id: string;
  whatsappMessageId?: string;
  phone: string;
  remoteJid: string;
  contactName?: string;
  message: string;
  fromMe: boolean;
  messageType: string;
  createdAt: Date;
};

export type BotLogRecord = {
  id: string;
  phone?: string;
  remoteJid?: string;
  level: string;
  event: string;
  details?: unknown;
  createdAt: Date;
};

export type BotCampaignOption = {
  id: string;
  name: string;
  status: string;
  sentCount: number;
  submittedCount: number;
  remainingCount: number;
  totalMessages: number;
};

export type BotWhatsappOverview = {
  stats: {
    totalConversations: number;
    activeConversations: number;
    linkedCampaigns: number;
    totalMessages: number;
    messagesToday: number;
  };
  conversations: BotConversationRecord[];
  campaigns: BotCampaignOption[];
  recentLogs: BotLogRecord[];
};

const globalForBotWhatsappSchema = globalThis as typeof globalThis & {
  ensureBotWhatsappSchemaPromise?: Promise<void>;
};

function sanitizePhone(value: string | undefined | null) {
  return String(value ?? "").replace(/\D/g, "");
}

function toDate(value: Date | string | null) {
  if (!value) {
    return undefined;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseInteger(value: number | string | null | undefined) {
  const numericValue = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numericValue) ? Number(numericValue) : 0;
}

async function loadBotWhatsappSchemaSql() {
  const schemaPath = path.join(process.cwd(), "database", "bot-whatsapp.sql");
  return readFile(schemaPath, "utf8");
}

export async function ensureBotWhatsappSchema() {
  if (!globalForBotWhatsappSchema.ensureBotWhatsappSchemaPromise) {
    globalForBotWhatsappSchema.ensureBotWhatsappSchemaPromise = loadBotWhatsappSchemaSql()
      .then((sql) => db.query(sql))
      .then(() => undefined)
      .catch((error) => {
        globalForBotWhatsappSchema.ensureBotWhatsappSchemaPromise = undefined;
        throw error;
      });
  }

  await globalForBotWhatsappSchema.ensureBotWhatsappSchemaPromise;
}

function mapConversationRow(row: BotSessionRow): BotConversationRecord {
  return {
    id: row.id,
    phone: row.phone,
    remoteJid: row.remote_jid,
    contactName: row.contact_name ?? undefined,
    botActive: row.bot_active,
    linkedCampaignId: row.linked_campaign_id ?? undefined,
    linkedCampaignName: row.linked_campaign_name ?? undefined,
    lastMessage: row.last_message ?? undefined,
    lastMessageFromMe: row.last_message_from_me,
    lastMessageAt: toDate(row.last_message_at),
    totalMessages: parseInteger(row.total_messages),
    createdAt: toDate(row.created_at) ?? new Date(),
    updatedAt: toDate(row.updated_at) ?? new Date(),
  };
}

function mapMessageRow(row: BotMessageRow): BotMessageRecord {
  return {
    id: row.id,
    whatsappMessageId: row.whatsapp_message_id ?? undefined,
    phone: row.phone,
    remoteJid: row.remote_jid,
    contactName: row.contact_name ?? undefined,
    message: row.message,
    fromMe: row.from_me,
    messageType: row.message_type,
    createdAt: toDate(row.created_at) ?? new Date(),
  };
}

function mapLogRow(row: BotLogRow): BotLogRecord {
  return {
    id: row.id,
    phone: row.phone ?? undefined,
    remoteJid: row.remote_jid ?? undefined,
    level: row.level,
    event: row.event,
    details: row.details ?? undefined,
    createdAt: toDate(row.created_at) ?? new Date(),
  };
}

export async function listBotConversations(limit = 40) {
  await ensureBotWhatsappSchema();
  const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 200);

  const result = await db.query<BotSessionRow>(
    `
      SELECT
        sessions.id,
        sessions.phone,
        sessions.remote_jid,
        sessions.contact_name,
        sessions.bot_active,
        sessions.linked_campaign_id,
        campaigns.name AS linked_campaign_name,
        sessions.last_message,
        sessions.last_message_from_me,
        sessions.last_message_at,
        COALESCE(message_stats.total_messages, 0)::int AS total_messages,
        sessions.created_at,
        sessions.updated_at
      FROM bot_sessions AS sessions
      LEFT JOIN campaigns
        ON campaigns.id = sessions.linked_campaign_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total_messages
        FROM messages
        WHERE remote_jid = sessions.remote_jid
      ) AS message_stats ON TRUE
      ORDER BY
        COALESCE(sessions.last_message_at, sessions.updated_at, sessions.created_at) DESC,
        sessions.created_at DESC
      LIMIT $1
    `,
    [safeLimit],
  );

  return result.rows.map(mapConversationRow);
}

export async function listBotMessagesByPhone(phone: string, limit = 120) {
  await ensureBotWhatsappSchema();
  const normalizedPhone = sanitizePhone(phone);
  if (!normalizedPhone) {
    throw new BotWhatsappValidationError("Telefone da conversa invalido.");
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 120, 1), 500);
  const result = await db.query<BotMessageRow>(
    `
      SELECT
        id,
        whatsapp_message_id,
        phone,
        remote_jid,
        contact_name,
        message,
        from_me,
        message_type,
        created_at
      FROM messages
      WHERE phone = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [normalizedPhone, safeLimit],
  );

  return result.rows.reverse().map(mapMessageRow);
}

export async function listRecentBotLogs(limit = 30) {
  await ensureBotWhatsappSchema();
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 200);
  const result = await db.query<BotLogRow>(
    `
      SELECT
        id,
        phone,
        remote_jid,
        level,
        event,
        details,
        created_at
      FROM bot_logs
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [safeLimit],
  );

  return result.rows.map(mapLogRow);
}

export async function getBotConversationByPhone(phone: string) {
  await ensureBotWhatsappSchema();
  const normalizedPhone = sanitizePhone(phone);
  if (!normalizedPhone) {
    return null;
  }

  const result = await db.query<BotSessionRow>(
    `
      SELECT
        sessions.id,
        sessions.phone,
        sessions.remote_jid,
        sessions.contact_name,
        sessions.bot_active,
        sessions.linked_campaign_id,
        campaigns.name AS linked_campaign_name,
        sessions.last_message,
        sessions.last_message_from_me,
        sessions.last_message_at,
        COALESCE(message_stats.total_messages, 0)::int AS total_messages,
        sessions.created_at,
        sessions.updated_at
      FROM bot_sessions AS sessions
      LEFT JOIN campaigns
        ON campaigns.id = sessions.linked_campaign_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total_messages
        FROM messages
        WHERE remote_jid = sessions.remote_jid
      ) AS message_stats ON TRUE
      WHERE sessions.phone = $1
      LIMIT 1
    `,
    [normalizedPhone],
  );

  return result.rows[0] ? mapConversationRow(result.rows[0]) : null;
}

export async function updateBotSessionState(input: {
  phone: string;
  botActive?: boolean;
  linkedCampaignId?: string | null;
}) {
  await ensureBotWhatsappSchema();
  const phone = sanitizePhone(input.phone);
  if (!phone) {
    throw new BotWhatsappValidationError("Telefone da conversa invalido.");
  }

  if (input.linkedCampaignId !== undefined && input.linkedCampaignId !== null) {
    const campaign = await getCampaignById(input.linkedCampaignId);
    if (!campaign) {
      throw new BotWhatsappValidationError("Campanha selecionada nao encontrada.");
    }
  }

  const current = await getBotConversationByPhone(phone);
  if (!current) {
    throw new BotWhatsappNotFoundError("Conversa do bot nao encontrada.");
  }

  const result = await db.query<{ id: string }>(
    `
      UPDATE bot_sessions
      SET
        bot_active = COALESCE($2, bot_active),
        linked_campaign_id = CASE WHEN $4 THEN $3::uuid ELSE linked_campaign_id END,
        updated_at = NOW()
      WHERE bot_sessions.phone = $1
      RETURNING bot_sessions.id
    `,
    [
      phone,
      input.botActive ?? null,
      input.linkedCampaignId ?? null,
      input.linkedCampaignId !== undefined,
    ],
  );

  if (!result.rows[0]) {
    throw new BotWhatsappNotFoundError("Conversa do bot nao encontrada.");
  }

  const updated = await getBotConversationByPhone(phone);
  if (!updated) {
    throw new BotWhatsappNotFoundError("Conversa do bot nao encontrada.");
  }

  return updated;
}

export async function getBotWhatsappOverview(): Promise<BotWhatsappOverview> {
  await ensureBotWhatsappSchema();

  const [statsResult, conversations, campaigns, recentLogs] = await Promise.all([
    db.query<BotStatsRow>(
      `
        SELECT
          COUNT(*)::int AS total_conversations,
          COUNT(*) FILTER (WHERE bot_active)::int AS active_conversations,
          COUNT(*) FILTER (WHERE linked_campaign_id IS NOT NULL)::int AS linked_campaigns,
          COALESCE((SELECT COUNT(*)::int FROM messages), 0)::int AS total_messages,
          COALESCE((
            SELECT COUNT(*)::int
            FROM messages
            WHERE created_at >= date_trunc('day', NOW())
          ), 0)::int AS messages_today
        FROM bot_sessions
      `,
    ),
    listBotConversations(40),
    listCampaigns(),
    listRecentBotLogs(24),
  ]);

  const stats = statsResult.rows[0];

  return {
    stats: {
      totalConversations: parseInteger(stats?.total_conversations),
      activeConversations: parseInteger(stats?.active_conversations),
      linkedCampaigns: parseInteger(stats?.linked_campaigns),
      totalMessages: parseInteger(stats?.total_messages),
      messagesToday: parseInteger(stats?.messages_today),
    },
    conversations,
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      sentCount: campaign.sentCount,
      submittedCount: campaign.submittedCount,
      remainingCount: campaign.remainingCount,
      totalMessages: campaign.totalMessages,
    })),
    recentLogs,
  };
}
