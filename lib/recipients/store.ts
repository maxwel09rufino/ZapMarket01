import { db } from "@/lib/db";
import {
  type Recipient,
  type RecipientDraft,
  type RecipientType,
  validateRecipientDraft,
} from "@/lib/recipients";

export class RecipientValidationError extends Error {}
export class RecipientNotFoundError extends Error {}

type RecipientRow = {
  id: string;
  name: string;
  type: RecipientType;
  phone: string | null;
  link: string | null;
  tag: string | null;
  invite_code: string | null;
  created_at: Date | string;
};

function sanitizeText(value: string | undefined) {
  return (value ?? "").trim();
}

function toDate(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function mapRowToRecipient(row: RecipientRow): Recipient {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    phone: row.phone ?? undefined,
    link: row.link ?? undefined,
    tag: row.tag ?? undefined,
    inviteCode: row.invite_code ?? undefined,
    createdAt: toDate(row.created_at),
  };
}

function normalizeRecipientDraft(draft: RecipientDraft) {
  const validation = validateRecipientDraft(draft);

  if (!validation.ok) {
    throw new RecipientValidationError(validation.error);
  }

  return {
    type: draft.type,
    name: validation.name,
    phone: validation.phone ?? null,
    link: validation.link ?? null,
    tag: validation.tag ?? null,
    inviteCode: validation.inviteCode ?? null,
  };
}

export async function listRecipients() {
  const result = await db.query<RecipientRow>(
    `
      SELECT
        id,
        name,
        type,
        phone,
        link,
        tag,
        invite_code,
        created_at
      FROM recipients
      ORDER BY created_at DESC
    `,
  );

  return result.rows.map(mapRowToRecipient);
}

export async function listRecipientsByIds(ids: string[]) {
  const normalizedIds = Array.from(
    new Set(ids.map((id) => sanitizeText(id)).filter((id) => id.length > 0)),
  );

  if (normalizedIds.length === 0) {
    return [] as Recipient[];
  }

  const result = await db.query<RecipientRow>(
    `
      SELECT
        id,
        name,
        type,
        phone,
        link,
        tag,
        invite_code,
        created_at
      FROM recipients
      WHERE id::text = ANY($1::text[])
    `,
    [normalizedIds],
  );

  const recipients = result.rows.map(mapRowToRecipient);
  const indexById = new Map(normalizedIds.map((id, index) => [id, index]));

  recipients.sort(
    (left, right) =>
      (indexById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (indexById.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );

  return recipients;
}

export async function getRecipientsCount() {
  const result = await db.query<{ total: string }>("SELECT COUNT(*)::text AS total FROM recipients");
  return Number(result.rows[0]?.total ?? 0);
}

export async function createRecipientRecord(draft: RecipientDraft) {
  const recipient = normalizeRecipientDraft(draft);

  const result = await db.query<RecipientRow>(
    `
      INSERT INTO recipients (
        name,
        type,
        phone,
        link,
        tag,
        invite_code
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        name,
        type,
        phone,
        link,
        tag,
        invite_code,
        created_at
    `,
    [
      recipient.name,
      recipient.type,
      recipient.phone,
      recipient.link,
      recipient.tag,
      recipient.inviteCode,
    ],
  );

  return mapRowToRecipient(result.rows[0]);
}

export async function createRecipientsBulk(drafts: RecipientDraft[]) {
  if (drafts.length === 0) {
    return [] as Recipient[];
  }

  const normalizedDrafts = drafts.map(normalizeRecipientDraft);
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const created: Recipient[] = [];
    for (const recipient of normalizedDrafts) {
      const result = await client.query<RecipientRow>(
        `
          INSERT INTO recipients (
            name,
            type,
            phone,
            link,
            tag,
            invite_code
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING
            id,
            name,
            type,
            phone,
            link,
            tag,
            invite_code,
            created_at
        `,
        [
          recipient.name,
          recipient.type,
          recipient.phone,
          recipient.link,
          recipient.tag,
          recipient.inviteCode,
        ],
      );

      created.push(mapRowToRecipient(result.rows[0]));
    }

    await client.query("COMMIT");
    return created;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteRecipientById(id: string) {
  const recipientId = sanitizeText(id);
  if (!recipientId) {
    throw new RecipientNotFoundError("Destinatario nao encontrado.");
  }

  const result = await db.query<RecipientRow>(
    `
      DELETE FROM recipients
      WHERE id = $1
      RETURNING
        id,
        name,
        type,
        phone,
        link,
        tag,
        invite_code,
        created_at
    `,
    [recipientId],
  );

  if (!result.rows[0]) {
    throw new RecipientNotFoundError("Destinatario nao encontrado.");
  }

  return mapRowToRecipient(result.rows[0]);
}
