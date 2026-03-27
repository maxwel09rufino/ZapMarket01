import { db } from "@/lib/db";
import type { PoolClient } from "pg";
import { formatCampaignMessage } from "@/lib/campaigns/formatter";
import {
  MAX_RECIPIENTS_PER_CAMPAIGN,
  type CampaignDeliveryRecord,
  type CampaignDeliveryStatus,
  type CampaignRecord,
  type CampaignStatus,
  type CreateCampaignInput,
} from "@/lib/campaigns/types";
import { getProductById, listProducts } from "@/lib/products/store";
import { buildRecipientDeliveryTarget } from "@/lib/recipients";
import { listRecipientsByIds } from "@/lib/recipients/store";

export class CampaignValidationError extends Error {}
export class CampaignNotFoundError extends Error {}

let ensureCampaignsSchemaPromise: Promise<void> | null = null;

type CampaignRow = {
  id: string;
  name: string;
  product_id: string | null;
  product_title: string;
  select_all_products: boolean;
  product_count: number;
  message_template: string;
  preview_message: string;
  delay_seconds: number;
  batch_limit: number;
  total_contacts: number;
  total_recipients: number;
  sent_count: number;
  submitted_count: number;
  failed_count: number;
  remaining_count: number;
  status: CampaignStatus;
  last_error: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
};

type Queryable = Pick<PoolClient, "query">;

type CampaignDeliveryRow = {
  id: string;
  campaign_id: string;
  recipient_id: string;
  recipient_name: string;
  recipient_type: CampaignDeliveryRecord["recipientType"];
  recipient_target: string;
  recipient_phone: string | null;
  product_id: string | null;
  product_title: string | null;
  product_image: string | null;
  message: string;
  status: CampaignDeliveryStatus;
  order_index: number;
  attempts: number;
  last_error: string | null;
  message_id: string | null;
  jid: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  sent_at: Date | string | null;
};

type CampaignChannelTargetRow = {
  recipient_target: string;
  recipient_name: string;
};

function sanitizeText(value: string | undefined) {
  return (value ?? "").trim();
}

function sanitizeRecipientIds(ids: string[]) {
  return Array.from(
    new Set(ids.map((id) => sanitizeText(id)).filter((id) => id.length > 0)),
  );
}

function toDate(value: Date | string | null) {
  if (!value) {
    return undefined;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

function mapCampaignRow(row: CampaignRow): CampaignRecord {
  return {
    id: row.id,
    name: row.name,
    productId: row.product_id ?? undefined,
    productTitle: row.product_title,
    selectAllProducts: row.select_all_products,
    productCount: Number(row.product_count),
    messageTemplate: row.message_template,
    previewMessage: row.preview_message,
    delaySeconds: Number(row.delay_seconds),
    batchLimit: Number(row.batch_limit),
    totalContacts: Number(row.total_contacts),
    totalMessages: Number(row.total_recipients),
    sentCount: Number(row.sent_count),
    submittedCount: Number(row.submitted_count),
    failedCount: Number(row.failed_count),
    remainingCount: Number(row.remaining_count),
    status: row.status,
    lastError: row.last_error ?? undefined,
    createdAt: toDate(row.created_at) ?? new Date(),
    startedAt: toDate(row.started_at),
    finishedAt: toDate(row.finished_at),
  };
}

async function ensureCampaignsSchema() {
  if (!ensureCampaignsSchemaPromise) {
    ensureCampaignsSchemaPromise = db
      .query(`
        ALTER TABLE campaigns
          ALTER COLUMN product_id DROP NOT NULL;

        ALTER TABLE campaigns
          DROP CONSTRAINT IF EXISTS campaigns_product_id_fkey;

        ALTER TABLE campaigns
          ADD CONSTRAINT campaigns_product_id_fkey
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

        ALTER TABLE campaign_deliveries
          DROP CONSTRAINT IF EXISTS campaign_deliveries_product_id_fkey;

        ALTER TABLE campaign_deliveries
          ADD CONSTRAINT campaign_deliveries_product_id_fkey
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

        ALTER TABLE campaigns
          ADD COLUMN IF NOT EXISTS submitted_count integer NOT NULL DEFAULT 0;

        ALTER TABLE campaign_deliveries
          DROP CONSTRAINT IF EXISTS campaign_deliveries_status_check;

        ALTER TABLE campaign_deliveries
          ADD CONSTRAINT campaign_deliveries_status_check
          CHECK (status IN ('pending', 'sending', 'submitted', 'sent', 'failed'));

        UPDATE campaign_deliveries
        SET
          status = 'submitted',
          updated_at = NOW()
        WHERE recipient_type = 'channel'
          AND status = 'sent';

        WITH campaign_stats AS (
          SELECT
            campaign_id,
            COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
            COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted_count,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
            COUNT(*) FILTER (WHERE status IN ('pending', 'sending'))::int AS remaining_count
          FROM campaign_deliveries
          GROUP BY campaign_id
        )
        UPDATE campaigns
        SET
          sent_count = COALESCE(campaign_stats.sent_count, 0),
          submitted_count = COALESCE(campaign_stats.submitted_count, 0),
          failed_count = COALESCE(campaign_stats.failed_count, 0),
          remaining_count = COALESCE(campaign_stats.remaining_count, 0)
        FROM campaign_stats
        WHERE campaigns.id = campaign_stats.campaign_id;
      `)
      .then(() => undefined)
      .catch((error) => {
        ensureCampaignsSchemaPromise = null;
        throw error;
      });
  }

  await ensureCampaignsSchemaPromise;
}

async function getCampaignRowById(queryable: Queryable, campaignId: string) {
  const result = await queryable.query<CampaignRow>(
    `
      SELECT
        id,
        name,
        product_id,
        product_title,
        select_all_products,
        product_count,
        message_template,
        preview_message,
        delay_seconds,
        batch_limit,
        total_contacts,
        total_recipients,
        sent_count,
        submitted_count,
        failed_count,
        remaining_count,
        status,
        last_error,
        created_at,
        started_at,
        finished_at
      FROM campaigns
      WHERE id = $1
      LIMIT 1
    `,
    [campaignId],
  );

  return result.rows[0] ?? null;
}

async function releaseAndDeleteCampaignProducts(queryable: Queryable, campaignId: string) {
  const productResult = await queryable.query<{ product_id: string }>(
    `
      SELECT DISTINCT product_id
      FROM (
        SELECT product_id
        FROM campaigns
        WHERE id = $1

        UNION ALL

        SELECT product_id
        FROM campaign_deliveries
        WHERE campaign_id = $1
      ) product_refs
      WHERE product_id IS NOT NULL
    `,
    [campaignId],
  );

  const productIds = Array.from(
    new Set(productResult.rows.map((row) => sanitizeText(row.product_id)).filter(Boolean)),
  );

  if (productIds.length === 0) {
    return [];
  }

  await queryable.query(
    `
      UPDATE campaign_deliveries
      SET
        product_id = NULL,
        updated_at = NOW()
      WHERE campaign_id = $1
        AND product_id = ANY($2::uuid[])
    `,
    [campaignId, productIds],
  );

  await queryable.query(
    `
      UPDATE campaigns
      SET product_id = NULL
      WHERE id = $1
        AND product_id = ANY($2::uuid[])
    `,
    [campaignId, productIds],
  );

  const deleteResult = await queryable.query<{ id: string }>(
    `
      DELETE FROM products
      WHERE id = ANY($1::uuid[])
        AND NOT EXISTS (
          SELECT 1
          FROM campaigns
          WHERE campaigns.product_id = products.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM campaign_deliveries
          WHERE campaign_deliveries.product_id = products.id
        )
      RETURNING id
    `,
    [productIds],
  );

  return deleteResult.rows.map((row) => row.id);
}

function mapCampaignDeliveryRow(row: CampaignDeliveryRow): CampaignDeliveryRecord {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    recipientId: row.recipient_id,
    recipientName: row.recipient_name,
    recipientType: row.recipient_type,
    recipientTarget: row.recipient_target,
    recipientPhone: row.recipient_phone ?? undefined,
    productImage: row.product_image ?? undefined,
    message: row.message,
    status: row.status,
    orderIndex: Number(row.order_index),
    attempts: Number(row.attempts),
    lastError: row.last_error ?? undefined,
    messageId: row.message_id ?? undefined,
    jid: row.jid ?? undefined,
    createdAt: toDate(row.created_at) ?? new Date(),
    updatedAt: toDate(row.updated_at) ?? new Date(),
    sentAt: toDate(row.sent_at),
  };
}

function normalizeDelaySeconds(value: number) {
  const delaySeconds = Number(value);
  if (!Number.isFinite(delaySeconds) || delaySeconds <= 0) {
    throw new CampaignValidationError("Defina um intervalo valido para a campanha.");
  }

  return Math.round(delaySeconds);
}

function normalizeCampaignInput(input: CreateCampaignInput) {
  const name = sanitizeText(input.name);
  const productId = sanitizeText(input.productId);
  const selectAllProducts = Boolean(input.selectAllProducts);
  const messageTemplate = input.messageTemplate.replace(/\r\n/g, "\n").trim();
  const recipientIds = sanitizeRecipientIds(input.recipientIds);
  const delaySeconds = normalizeDelaySeconds(input.delaySeconds);

  if (!name) {
    throw new CampaignValidationError("Nome da campanha e obrigatorio.");
  }

  if (!selectAllProducts && !productId) {
    throw new CampaignValidationError("Selecione um produto cadastrado.");
  }

  if (!messageTemplate) {
    throw new CampaignValidationError("Modelo de divulgacao e obrigatorio.");
  }

  if (messageTemplate.length > 1000) {
    throw new CampaignValidationError(
      "Modelo muito grande. O limite atual do WhatsApp local e de 1000 caracteres.",
    );
  }

  if (recipientIds.length === 0) {
    throw new CampaignValidationError("Selecione pelo menos um destinatario.");
  }

  if (recipientIds.length > MAX_RECIPIENTS_PER_CAMPAIGN) {
    throw new CampaignValidationError(
      `Cada campanha suporta ate ${MAX_RECIPIENTS_PER_CAMPAIGN} destinatarios por lote.`,
    );
  }

  return {
    name,
    productId,
    selectAllProducts,
    messageTemplate,
    recipientIds,
    delaySeconds,
  };
}

async function refreshCampaignProgress(campaignId: string) {
  await ensureCampaignsSchema();
  const result = await db.query<CampaignRow>(
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
        campaigns.product_id,
        campaigns.product_title,
        campaigns.select_all_products,
        campaigns.product_count,
        campaigns.message_template,
        campaigns.preview_message,
        campaigns.delay_seconds,
        campaigns.batch_limit,
        campaigns.total_contacts,
        campaigns.total_recipients,
        campaigns.sent_count,
        campaigns.submitted_count,
        campaigns.failed_count,
        campaigns.remaining_count,
        campaigns.status,
        campaigns.last_error,
        campaigns.created_at,
        campaigns.started_at,
        campaigns.finished_at
    `,
    [campaignId],
  );

  if (!result.rows[0]) {
    throw new CampaignNotFoundError("Campanha nao encontrada.");
  }

  return mapCampaignRow(result.rows[0]);
}

export async function listCampaigns() {
  await ensureCampaignsSchema();
  const result = await db.query<CampaignRow>(
    `
      SELECT
        id,
        name,
        product_id,
        product_title,
        select_all_products,
        product_count,
        message_template,
        preview_message,
        delay_seconds,
        batch_limit,
        total_contacts,
        total_recipients,
        sent_count,
        submitted_count,
        failed_count,
        remaining_count,
        status,
        last_error,
        created_at,
        started_at,
        finished_at
      FROM campaigns
      ORDER BY created_at DESC
    `,
  );

  return result.rows.map(mapCampaignRow);
}

export async function getCampaignById(id: string) {
  await ensureCampaignsSchema();
  const campaignId = sanitizeText(id);
  if (!campaignId) {
    return null;
  }

  const row = await getCampaignRowById(db, campaignId);
  return row ? mapCampaignRow(row) : null;
}

export async function deleteCampaignById(id: string) {
  await ensureCampaignsSchema();
  const campaignId = sanitizeText(id);
  if (!campaignId) {
    throw new CampaignNotFoundError("Campanha nao encontrada.");
  }

  const current = await getCampaignById(campaignId);
  if (!current) {
    throw new CampaignNotFoundError("Campanha nao encontrada.");
  }

  if (current.status === "sending") {
    throw new CampaignValidationError(
      "Nao e possivel excluir uma campanha em andamento. Aguarde a fila terminar ou falhar.",
    );
  }

  const result = await db.query<CampaignRow>(
    `
      DELETE FROM campaigns
      WHERE id = $1
      RETURNING
        id,
        name,
        product_id,
        product_title,
        select_all_products,
        product_count,
        message_template,
        preview_message,
        delay_seconds,
        batch_limit,
        total_contacts,
        total_recipients,
        sent_count,
        submitted_count,
        failed_count,
        remaining_count,
        status,
        last_error,
        created_at,
        started_at,
        finished_at
    `,
    [campaignId],
  );

  return result.rows[0] ? mapCampaignRow(result.rows[0]) : current;
}

export async function createCampaign(input: CreateCampaignInput) {
  await ensureCampaignsSchema();
  const normalizedInput = normalizeCampaignInput(input);
  const selectedProducts = normalizedInput.selectAllProducts
    ? await listProducts()
    : await (async () => {
        const product = await getProductById(normalizedInput.productId);
        return product ? [product] : [];
      })();

  if (selectedProducts.length === 0) {
    throw new CampaignValidationError(
      normalizedInput.selectAllProducts
        ? "Nao ha produtos cadastrados para usar em todos os envios."
        : "Produto selecionado nao encontrado.",
    );
  }

  const recipients = await listRecipientsByIds(normalizedInput.recipientIds);
  if (recipients.length !== normalizedInput.recipientIds.length) {
    throw new CampaignValidationError("Um ou mais destinatarios selecionados nao foram encontrados.");
  }

  const invalidRecipients = recipients.filter(
    (recipient) => !buildRecipientDeliveryTarget(recipient),
  );

  if (invalidRecipients.length > 0) {
    throw new CampaignValidationError(
      "Alguns destinatarios selecionados nao possuem numero, convite ou link valido para disparo.",
    );
  }

  const previewProduct = selectedProducts[0];
  const previewMessage = formatCampaignMessage(normalizedInput.messageTemplate, {
    title: previewProduct.title,
    price: previewProduct.price,
    originalPrice: previewProduct.originalPrice,
    link: previewProduct.link,
    seller: previewProduct.seller,
  });

  if (!previewMessage) {
    throw new CampaignValidationError("O modelo nao pode gerar uma mensagem vazia.");
  }

  if (previewMessage.length > 1000) {
    throw new CampaignValidationError(
      "A mensagem final ultrapassa 1000 caracteres. Reduza o modelo antes de salvar.",
    );
  }

  for (const product of selectedProducts) {
    const message = formatCampaignMessage(normalizedInput.messageTemplate, {
      title: product.title,
      price: product.price,
      originalPrice: product.originalPrice,
      link: product.link,
      seller: product.seller,
    });

    if (!message) {
      throw new CampaignValidationError(
        `O produto "${product.title}" gerou uma mensagem vazia.`,
      );
    }

    if (message.length > 1000) {
      throw new CampaignValidationError(
        `A mensagem gerada para "${product.title}" ultrapassa 1000 caracteres.`,
      );
    }
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const totalMessages = recipients.length * selectedProducts.length;
    const campaignResult = await client.query<CampaignRow>(
      `
        INSERT INTO campaigns (
          name,
          product_id,
          product_title,
          select_all_products,
          product_count,
          message_template,
          preview_message,
          delay_seconds,
          batch_limit,
          total_contacts,
          total_recipients,
          sent_count,
          submitted_count,
          failed_count,
          remaining_count,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 0, 0, $11, 'pending')
        RETURNING
          id,
          name,
          product_id,
          product_title,
          select_all_products,
          product_count,
          message_template,
          preview_message,
          delay_seconds,
          batch_limit,
          total_contacts,
          total_recipients,
          sent_count,
          submitted_count,
          failed_count,
          remaining_count,
          status,
          last_error,
          created_at,
          started_at,
          finished_at
      `,
      [
        normalizedInput.name,
        previewProduct.id,
        normalizedInput.selectAllProducts
          ? `Todos os produtos (${selectedProducts.length})`
          : previewProduct.title,
        normalizedInput.selectAllProducts,
        selectedProducts.length,
        normalizedInput.messageTemplate,
        previewMessage,
        normalizedInput.delaySeconds,
        MAX_RECIPIENTS_PER_CAMPAIGN,
        recipients.length,
        totalMessages,
      ],
    );

    const campaign = campaignResult.rows[0];

    let orderIndex = 1;

    for (const product of selectedProducts) {
      const message = formatCampaignMessage(normalizedInput.messageTemplate, {
        title: product.title,
        price: product.price,
        originalPrice: product.originalPrice,
        link: product.link,
        seller: product.seller,
      });

      for (const recipient of recipients) {
        const recipientTarget = buildRecipientDeliveryTarget(recipient);

        if (!recipientTarget) {
          throw new CampaignValidationError(
            `O destinatario "${recipient.name}" nao possui um alvo valido para envio.`,
          );
        }

        await client.query(
          `
            INSERT INTO campaign_deliveries (
              campaign_id,
              recipient_id,
              recipient_name,
              recipient_type,
              recipient_phone,
              recipient_target,
              product_id,
              product_title,
              product_image,
              message,
              status,
              order_index
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)
          `,
          [
            campaign.id,
            recipient.id,
            recipient.name,
            recipient.type,
            recipient.phone ?? recipientTarget,
            recipientTarget,
            product.id,
            product.title,
            sanitizeText(product.image) || null,
            message,
            orderIndex,
          ],
        );

        orderIndex += 1;
      }
    }

    await releaseAndDeleteCampaignProducts(client, campaign.id);

    const currentCampaignRow = await getCampaignRowById(client, campaign.id);

    await client.query("COMMIT");
    return mapCampaignRow(currentCampaignRow ?? campaign);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markCampaignReadyToStart(id: string) {
  await ensureCampaignsSchema();
  const campaignId = sanitizeText(id);
  if (!campaignId) {
    throw new CampaignNotFoundError("Campanha nao encontrada.");
  }

  const current = await getCampaignById(campaignId);
  if (!current) {
    throw new CampaignNotFoundError("Campanha nao encontrada.");
  }

  if (current.status === "finished" && current.remainingCount === 0) {
    throw new CampaignValidationError("Campanha ja finalizada.");
  }

  if (current.status === "sending") {
    return current;
  }

  const result = await db.query<CampaignRow>(
    `
      UPDATE campaigns
      SET
        status = 'sending',
        last_error = NULL,
        started_at = COALESCE(started_at, NOW()),
        finished_at = NULL
      WHERE id = $1
        AND status IN ('pending', 'failed')
      RETURNING
        id,
        name,
        product_id,
        product_title,
        select_all_products,
        product_count,
        message_template,
        preview_message,
        delay_seconds,
        batch_limit,
        total_contacts,
        total_recipients,
        sent_count,
        submitted_count,
        failed_count,
        remaining_count,
        status,
        last_error,
        created_at,
        started_at,
        finished_at
    `,
    [campaignId],
  );

  return result.rows[0] ? mapCampaignRow(result.rows[0]) : current;
}

export async function recoverActiveCampaignIds() {
  await ensureCampaignsSchema();
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE campaign_deliveries
        SET
          status = 'pending',
          updated_at = NOW()
        WHERE status = 'sending'
      `,
    );

    const result = await client.query<{ id: string }>(
      `
        SELECT id
        FROM campaigns
        WHERE status = 'sending'
        ORDER BY created_at ASC
      `,
    );

    await client.query("COMMIT");
    return result.rows.map((row) => row.id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimNextPendingDelivery(campaignId: string) {
  await ensureCampaignsSchema();
  const result = await db.query<CampaignDeliveryRow>(
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
        campaign_deliveries.recipient_id,
        campaign_deliveries.recipient_name,
        campaign_deliveries.recipient_type,
        campaign_deliveries.recipient_target,
        campaign_deliveries.recipient_phone,
        campaign_deliveries.product_id,
        campaign_deliveries.product_title,
        campaign_deliveries.product_image,
        campaign_deliveries.message,
        campaign_deliveries.status,
        campaign_deliveries.order_index,
        campaign_deliveries.attempts,
        campaign_deliveries.last_error,
        campaign_deliveries.message_id,
        campaign_deliveries.jid,
        campaign_deliveries.created_at,
        campaign_deliveries.updated_at,
        campaign_deliveries.sent_at
    `,
    [campaignId],
  );

  return result.rows[0] ? mapCampaignDeliveryRow(result.rows[0]) : null;
}

export async function listCampaignChannelTargets(campaignId: string) {
  await ensureCampaignsSchema();
  const result = await db.query<CampaignChannelTargetRow>(
    `
      SELECT DISTINCT ON (recipient_target)
        recipient_target,
        recipient_name
      FROM campaign_deliveries
      WHERE campaign_id = $1
        AND recipient_type = 'channel'
      ORDER BY recipient_target, order_index ASC
    `,
    [campaignId],
  );

  return result.rows.map((row) => ({
    target: row.recipient_target,
    name: row.recipient_name,
  }));
}

async function markDeliveryWithStatus(
  deliveryId: string,
  result: {
    messageId: string | null;
    jid: string | null;
  },
  status: "sent" | "submitted",
) {
  await ensureCampaignsSchema();
  const updateResult = await db.query<{ campaign_id: string }>(
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
    [deliveryId, status, result.messageId, result.jid],
  );

  const campaignId = updateResult.rows[0]?.campaign_id;
  if (!campaignId) {
    throw new CampaignNotFoundError("Entrega da campanha nao encontrada.");
  }

  return refreshCampaignProgress(campaignId);
}

export async function markDeliverySent(
  deliveryId: string,
  result: {
    messageId: string | null;
    jid: string | null;
  },
) {
  return markDeliveryWithStatus(deliveryId, result, "sent");
}

export async function markDeliverySubmitted(
  deliveryId: string,
  result: {
    messageId: string | null;
    jid: string | null;
  },
) {
  return markDeliveryWithStatus(deliveryId, result, "submitted");
}

export async function markDeliveryFailed(deliveryId: string, errorMessage: string) {
  await ensureCampaignsSchema();
  const updateResult = await db.query<{ campaign_id: string }>(
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

  const campaignId = updateResult.rows[0]?.campaign_id;
  if (!campaignId) {
    throw new CampaignNotFoundError("Entrega da campanha nao encontrada.");
  }

  return refreshCampaignProgress(campaignId);
}

export async function markCampaignFinished(campaignId: string) {
  await refreshCampaignProgress(campaignId);
  await ensureCampaignsSchema();

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<CampaignRow>(
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
          product_id,
          product_title,
          select_all_products,
          product_count,
          message_template,
          preview_message,
          delay_seconds,
          batch_limit,
          total_contacts,
          total_recipients,
          sent_count,
          submitted_count,
          failed_count,
          remaining_count,
          status,
          last_error,
          created_at,
          started_at,
          finished_at
      `,
      [campaignId],
    );

    const currentRow = result.rows[0];
    if (!currentRow) {
      throw new CampaignNotFoundError("Campanha nao encontrada.");
    }

    if (currentRow.status === "finished") {
      await releaseAndDeleteCampaignProducts(client, campaignId);
    }

    const finalRow = await getCampaignRowById(client, campaignId);

    await client.query("COMMIT");
    return mapCampaignRow(finalRow ?? currentRow);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markCampaignFailed(campaignId: string, errorMessage: string) {
  await refreshCampaignProgress(campaignId);
  await ensureCampaignsSchema();

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<CampaignRow>(
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
          product_id,
          product_title,
          select_all_products,
          product_count,
          message_template,
          preview_message,
          delay_seconds,
          batch_limit,
          total_contacts,
          total_recipients,
          sent_count,
          submitted_count,
          failed_count,
          remaining_count,
          status,
          last_error,
          created_at,
          started_at,
          finished_at
      `,
      [campaignId, sanitizeText(errorMessage) || "Falha ao executar campanha."],
    );

    const currentRow = result.rows[0];
    if (!currentRow) {
      throw new CampaignNotFoundError("Campanha nao encontrada.");
    }

    await releaseAndDeleteCampaignProducts(client, campaignId);

    const finalRow = await getCampaignRowById(client, campaignId);

    await client.query("COMMIT");
    return mapCampaignRow(finalRow ?? currentRow);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
