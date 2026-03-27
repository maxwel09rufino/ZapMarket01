export type RecipientType = "contact" | "group" | "channel";

export type Recipient = {
  id: string;
  name: string;
  type: RecipientType;
  phone?: string;
  link?: string;
  tag?: string;
  inviteCode?: string;
  createdAt: Date;
};

export type RecipientDTO = Omit<Recipient, "createdAt"> & {
  createdAt: string;
};

type StoredRecipient = RecipientDTO;

export type RecipientDraft = {
  type: RecipientType;
  name: string;
  phone?: string;
  link?: string;
  tag?: string;
};

type ValidationSuccess = {
  ok: true;
  name: string;
  phone?: string;
  link?: string;
  tag?: string;
  inviteCode?: string;
};

type ValidationFailure = {
  ok: false;
  error: string;
};

type ValidationResult = ValidationSuccess | ValidationFailure;

export type CsvImportResult = {
  recipients: Recipient[];
  imported: number;
  failed: number;
  errors: string[];
};

const GROUP_LINK_REGEX = /^https:\/\/chat\.whatsapp\.com\/([A-Za-z0-9]+)/i;
const CHANNEL_LINK_REGEX = /^https:\/\/(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9]+)/i;
const PHONE_REGEX = /^\d{10,15}$/;

function createRecipientId() {
  if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return `recipient-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isRecipientType(value: string): value is RecipientType {
  return value === "contact" || value === "group" || value === "channel";
}

function sanitizeOptionalText(value: string | undefined) {
  const sanitized = (value ?? "").trim();
  return sanitized.length > 0 ? sanitized : undefined;
}

function normalizeLink(link: string | undefined) {
  return (link ?? "").trim();
}

export function normalizePhoneNumber(input: string | undefined) {
  return String(input ?? "").replace(/\D/g, "");
}

export function extractInviteCode(link: string | undefined) {
  const match = normalizeLink(link).match(GROUP_LINK_REGEX);
  return match?.[1];
}

export function isValidGroupLink(link: string | undefined) {
  return GROUP_LINK_REGEX.test(normalizeLink(link));
}

export function isValidChannelLink(link: string | undefined) {
  const normalized = normalizeLink(link);
  return CHANNEL_LINK_REGEX.test(normalized) || GROUP_LINK_REGEX.test(normalized);
}

export function validateRecipientDraft(draft: RecipientDraft): ValidationResult {
  const name = draft.name.trim();
  const tag = sanitizeOptionalText(draft.tag);

  if (!name) {
    return {
      ok: false,
      error: "Nome e obrigatorio.",
    };
  }

  if (draft.type === "contact") {
    const phone = normalizePhoneNumber(draft.phone);
    if (!phone) {
      return {
        ok: false,
        error: "WhatsApp e obrigatorio.",
      };
    }

    if (!PHONE_REGEX.test(phone)) {
      return {
        ok: false,
        error: "Use o formato 5511999999999.",
      };
    }

    return {
      ok: true,
      name,
      phone,
      tag,
    };
  }

  if (draft.type === "group") {
    const link = normalizeLink(draft.link);
    const inviteCode = extractInviteCode(link);

    if (!link) {
      return {
        ok: false,
        error: "Link do grupo e obrigatorio.",
      };
    }

    if (!isValidGroupLink(link) || !inviteCode) {
      return {
        ok: false,
        error: "Use um link valido: https://chat.whatsapp.com/{invite_code}",
      };
    }

    return {
      ok: true,
      name,
      link,
      tag,
      inviteCode,
    };
  }

  const link = normalizeLink(draft.link);
  if (!link) {
    return {
      ok: false,
      error: "Link do canal e obrigatorio.",
    };
  }

  if (!isValidChannelLink(link)) {
    return {
      ok: false,
      error: "Canal aceita links whatsapp.com/channel/ ou chat.whatsapp.com/.",
    };
  }

  return {
    ok: true,
    name,
    link,
    tag,
    inviteCode: extractInviteCode(link),
  };
}

export function createRecipient(
  draft: RecipientDraft,
):
  | {
      ok: true;
      recipient: Recipient;
    }
  | {
      ok: false;
      error: string;
    } {
  const validation = validateRecipientDraft(draft);

  if (!validation.ok) {
    return validation;
  }

  return {
    ok: true,
    recipient: {
      id: createRecipientId(),
      name: validation.name,
      type: draft.type,
      phone: validation.phone,
      link: validation.link,
      tag: validation.tag,
      inviteCode: validation.inviteCode,
      createdAt: new Date(),
    },
  };
}

export function toRecipientDraft(recipient: Recipient): RecipientDraft {
  return {
    type: recipient.type,
    name: recipient.name,
    phone: recipient.phone,
    link: recipient.link,
    tag: recipient.tag,
  };
}

export function toRecipientDTO(recipient: Recipient): RecipientDTO {
  return {
    ...recipient,
    createdAt: recipient.createdAt.toISOString(),
  };
}

export function fromRecipientDTO(recipient: RecipientDTO): Recipient {
  return {
    ...recipient,
    createdAt: new Date(recipient.createdAt),
  };
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function toRecipientType(rawType: string) {
  const normalized = rawType.trim().toLowerCase();
  return isRecipientType(normalized) ? normalized : null;
}

export function importRecipientsFromCsv(csvContent: string): CsvImportResult {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return {
      recipients: [],
      imported: 0,
      failed: 1,
      errors: ["CSV vazio."],
    };
  }

  const headerColumns = splitCsvLine(lines[0]).map((column) => column.toLowerCase());
  const requiredColumns = ["type", "name", "phone", "link", "tag"];
  const missing = requiredColumns.filter((column) => !headerColumns.includes(column));

  if (missing.length > 0) {
    return {
      recipients: [],
      imported: 0,
      failed: 1,
      errors: [`Cabecalho invalido. Colunas obrigatorias: ${requiredColumns.join(", ")}.`],
    };
  }

  const recipients: Recipient[] = [];
  const errors: string[] = [];
  const columnIndex = Object.fromEntries(
    requiredColumns.map((column) => [column, headerColumns.indexOf(column)]),
  );

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const cells = splitCsvLine(line);
    const rowNumber = lineIndex + 1;

    const typeValue = cells[columnIndex.type] ?? "";
    const type = toRecipientType(typeValue);

    if (!type) {
      errors.push(`Linha ${rowNumber}: tipo invalido "${typeValue}".`);
      continue;
    }

    const draft: RecipientDraft = {
      type,
      name: cells[columnIndex.name] ?? "",
      phone: cells[columnIndex.phone] ?? "",
      link: cells[columnIndex.link] ?? "",
      tag: cells[columnIndex.tag] ?? "",
    };

    const created = createRecipient(draft);
    if (!created.ok) {
      errors.push(`Linha ${rowNumber}: ${created.error}`);
      continue;
    }

    recipients.push(created.recipient);
  }

  return {
    recipients,
    imported: recipients.length,
    failed: errors.length,
    errors,
  };
}

export function parseStoredRecipient(value: unknown): Recipient | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<StoredRecipient> & {
    groupLink?: string;
  };

  const type = typeof raw.type === "string" ? raw.type : "";
  const name = typeof raw.name === "string" ? raw.name : "";
  const tag = typeof raw.tag === "string" ? raw.tag : undefined;
  const phone = typeof raw.phone === "string" ? raw.phone : undefined;
  const link =
    typeof raw.link === "string"
      ? raw.link
      : typeof raw.groupLink === "string"
        ? raw.groupLink
        : undefined;

  if (!isRecipientType(type)) {
    return null;
  }

  const validation = validateRecipientDraft({
    type,
    name,
    phone,
    link,
    tag,
  });

  if (!validation.ok) {
    return null;
  }

  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : createRecipientId();
  const createdAtRaw = typeof raw.createdAt === "string" ? raw.createdAt : "";
  const createdAt = createdAtRaw ? new Date(createdAtRaw) : new Date();

  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }

  return {
    id,
    name: validation.name,
    type,
    phone: validation.phone,
    link: validation.link,
    tag: validation.tag,
    inviteCode: validation.inviteCode,
    createdAt,
  };
}

export function matchesRecipientSearch(recipient: Recipient, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const searchableFields = [
    recipient.name,
    recipient.phone ?? "",
    recipient.link ?? "",
    recipient.tag ?? "",
    recipient.inviteCode ?? "",
  ];

  return searchableFields.some((field) => field.toLowerCase().includes(normalizedQuery));
}

export function getRecipientTypeLabel(type: RecipientType) {
  if (type === "contact") {
    return "CONTATO";
  }

  if (type === "group") {
    return "GRUPO";
  }

  return "CANAL";
}

export function getRecipientBadgeClass(type: RecipientType) {
  if (type === "contact") {
    return "bg-blue-500 text-white border-transparent";
  }

  if (type === "group") {
    return "bg-green-500 text-white border-transparent";
  }

  return "bg-purple-500 text-white border-transparent";
}

export function isRecipientSendable(recipient: Recipient) {
  if (recipient.type === "contact") {
    return Boolean(recipient.phone);
  }

  if (recipient.type === "group") {
    return Boolean(recipient.inviteCode || extractInviteCode(recipient.link));
  }

  return Boolean(recipient.link);
}

export function buildRecipientDeliveryTarget(recipient: Recipient) {
  if (recipient.type === "contact") {
    if (!recipient.phone) {
      return null;
    }
    return recipient.phone;
  }

  if (recipient.type === "group") {
    const inviteCode = recipient.inviteCode || extractInviteCode(recipient.link);
    if (!inviteCode) {
      return null;
    }
    return inviteCode;
  }

  return recipient.link ?? null;
}
