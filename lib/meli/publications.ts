import "server-only";

import axios, { AxiosError, type AxiosInstance } from "axios";
import {
  ensureActiveMeliCredentialAccessToken,
  MeliCredentialValidationError,
} from "@/lib/meli/store";
import type {
  MeliPublicationCategoryOption,
  MeliPublicationDraft,
  MeliPublicationDraftEntry,
  MeliPublicationField,
  MeliPublicationFieldScope,
  MeliPublicationFieldValueType,
  MeliPublicationListingTypeOption,
  MeliPublicationPrepareResponse,
  MeliPublicationPublishResponse,
  MeliPublicationValidationCause,
  MeliPublicationValidationResponse,
  MeliPublishedItemSummary,
} from "@/lib/meli/publications-client";
import {
  getProductById,
  ProductNotFoundError,
  updateProductPublicationById,
} from "@/lib/products/store";
import { toProductDTO } from "@/lib/products/types";

const MELI_API_BASE = "https://api.mercadolibre.com";
const MELI_TIMEOUT_MS = 20_000;

const REQUIRED_FIELD_TAGS = new Set(["required", "catalog_required", "conditional_required"]);

type RawMeliOption = {
  id?: string | number | null;
  name?: string | null;
};

type RawTagRecord = Record<string, boolean | string | number | null | undefined>;

type RawMeliField = {
  id?: string | null;
  name?: string | null;
  value_type?: string | null;
  values?: RawMeliOption[] | null;
  tags?: string[] | RawTagRecord | null;
  attribute_group_name?: string | null;
  hint?: string | null;
  value_max_length?: number | null;
  allowed_units?: RawMeliOption[] | null;
  default_unit?: string | null;
};

type RawCategoryPrediction = {
  category_id?: string | null;
  category_name?: string | null;
  domain_id?: string | null;
  domain_name?: string | null;
};

type RawCategory = {
  id?: string | null;
  name?: string | null;
  domain_id?: string | null;
  status?: string | null;
  listing_allowed?: boolean | null;
  settings?: {
    currencies?: string[] | null;
    item_conditions?: string[] | null;
    max_title_length?: number | null;
    max_pictures_per_item?: number | null;
    listing_allowed?: boolean | null;
    status?: string | null;
  } | null;
};

type RawAvailableListingTypes = {
  available?: Array<{
    id?: string | null;
    name?: string | null;
    mapping?: string | null;
    remaining_listings?: number | null;
  }> | null;
};

type RawTechSpecs = {
  input?: {
    groups?: Array<{
      label?: string | null;
      components?: Array<{
        label?: string | null;
        ui_config?: {
          hint?: string | null;
        } | null;
        attributes?: Array<{
          id?: string | null;
          label?: string | null;
        }> | null;
      }> | null;
    }> | null;
  } | null;
};

type RawMeliItem = {
  id?: string | null;
  permalink?: string | null;
  status?: string | null;
  category_id?: string | null;
  listing_type_id?: string | null;
  catalog_product_id?: string | null;
  last_updated?: string | null;
};

type TechHint = {
  groupName?: string;
  hint?: string;
  label?: string;
};

type PublicationContext = {
  categories: MeliPublicationCategoryOption[];
  selectedCategory: RawCategory | null;
  listingTypes: MeliPublicationListingTypeOption[];
  attributeFields: MeliPublicationField[];
  saleTermFields: MeliPublicationField[];
  warnings: string[];
};

type MeliSession = {
  accessToken: string;
  siteId: string;
  meliUserId?: string;
  credential: {
    id: string;
    name?: string;
    meliNickname?: string;
    siteId?: string;
  };
  client: AxiosInstance;
};

export class MeliPublicationError extends Error {}

export class MeliPublicationValidationError extends Error {
  causes: MeliPublicationValidationCause[];

  constructor(message: string, causes: MeliPublicationValidationCause[] = []) {
    super(message);
    this.name = "MeliPublicationValidationError";
    this.causes = causes;
  }
}

function sanitizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeOption(option: RawMeliOption) {
  const id = sanitizeText(option.id);
  const name = sanitizeText(option.name);
  if (!id && !name) {
    return null;
  }

  return {
    id: id || name,
    name: name || id,
  };
}

function normalizeFieldValueType(valueType: string | null | undefined): MeliPublicationFieldValueType {
  const normalized = sanitizeText(valueType).toLowerCase();

  if (
    normalized === "string" ||
    normalized === "number" ||
    normalized === "number_unit" ||
    normalized === "boolean" ||
    normalized === "list" ||
    normalized === "grid_id"
  ) {
    return normalized;
  }

  return normalized ? "unknown" : "string";
}

function readTagNames(tags: RawMeliField["tags"]) {
  if (Array.isArray(tags)) {
    return tags.filter((value): value is string => typeof value === "string");
  }

  if (!tags || typeof tags !== "object") {
    return [];
  }

  return Object.entries(tags)
    .filter(([, value]) => value === true || value === "true" || value === 1)
    .map(([key]) => key);
}

function isRequiredField(tags: RawMeliField["tags"]) {
  return readTagNames(tags).some((tag) => REQUIRED_FIELD_TAGS.has(tag));
}

function isMultivaluedField(tags: RawMeliField["tags"]) {
  return readTagNames(tags).includes("multivalued");
}

function truncateText(value: string, maxLength: number | null | undefined) {
  if (!maxLength || maxLength <= 0 || value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength).trim();
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => sanitizeText(value)).filter(Boolean)));
}

function createMeliClient(accessToken: string) {
  return axios.create({
    baseURL: MELI_API_BASE,
    timeout: MELI_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
}

function parseValidationCauses(data: unknown) {
  if (!data || typeof data !== "object" || !("cause" in data) || !Array.isArray(data.cause)) {
    return [] as MeliPublicationValidationCause[];
  }

  return data.cause
    .map((cause) => {
      if (!cause || typeof cause !== "object") {
        return null;
      }

      const message =
        sanitizeText("message" in cause ? cause.message : "") ||
        sanitizeText("error" in cause ? cause.error : "");

      if (!message) {
        return null;
      }

      return {
        code: sanitizeText("code" in cause ? cause.code : "") || undefined,
        type: sanitizeText("type" in cause ? cause.type : "") || undefined,
        department: sanitizeText("department" in cause ? cause.department : "") || undefined,
        message,
        references:
          "references" in cause && Array.isArray(cause.references)
            ? cause.references.map((value: unknown) => sanitizeText(value)).filter(Boolean)
            : undefined,
      };
    })
    .filter(Boolean) as MeliPublicationValidationCause[];
}

function resolveApiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof AxiosError) {
    if (error.code === "ECONNABORTED") {
      return "Tempo limite ao comunicar com o Mercado Livre.";
    }

    const messageFromBody =
      typeof error.response?.data === "object" &&
      error.response?.data &&
      "message" in error.response.data
        ? sanitizeText(error.response.data.message)
        : "";

    if (messageFromBody) {
      return messageFromBody;
    }
  }

  return error instanceof Error && error.message ? error.message : fallback;
}

async function createSession(userId?: string) {
  const auth = await ensureActiveMeliCredentialAccessToken(userId);
  if (!auth) {
    throw new MeliCredentialValidationError(
      "Cadastre uma credencial ativa do Mercado Livre em Configuracoes antes de publicar.",
    );
  }

  return {
    accessToken: auth.accessToken,
    siteId: sanitizeText(auth.credential.siteId) || "MLB",
    meliUserId: sanitizeText(auth.credential.meliUserId) || undefined,
    credential: {
      id: auth.credential.id,
      name: auth.credential.name,
      meliNickname: auth.credential.meliNickname,
      siteId: auth.credential.siteId,
    },
    client: createMeliClient(auth.accessToken),
  } satisfies MeliSession;
}

async function fetchPublicationContext(
  session: MeliSession,
  title: string,
  categoryId?: string,
): Promise<PublicationContext> {
  const warnings: string[] = [];
  const predictedCategories = title
    ? (
        await session.client.get<RawCategoryPrediction[]>(
          `/sites/${session.siteId}/domain_discovery/search`,
          { params: { q: title } },
        )
      ).data
    : [];

  const categories = predictedCategories
    .map((entry) => {
      const id = sanitizeText(entry.category_id);
      const name = sanitizeText(entry.category_name);
      if (!id || !name) {
        return null;
      }

      return {
        id,
        name,
        domainId: sanitizeText(entry.domain_id) || undefined,
        domainName: sanitizeText(entry.domain_name) || undefined,
      } satisfies MeliPublicationCategoryOption;
    })
    .filter(Boolean) as MeliPublicationCategoryOption[];

  const selectedCategoryId = sanitizeText(categoryId) || categories[0]?.id;
  if (!selectedCategoryId) {
    warnings.push("Nenhuma categoria foi sugerida pelo preditor oficial. Escolha um titulo mais especifico.");

    return {
      categories,
      selectedCategory: null,
      listingTypes: [],
      attributeFields: [],
      saleTermFields: [],
      warnings,
    };
  }

  const [categoryResponse, attributeResponse, saleTermResponse, listingTypeResponse] =
    await Promise.all([
      session.client.get<RawCategory>(`/categories/${selectedCategoryId}`),
      session.client.get<RawMeliField[]>(`/categories/${selectedCategoryId}/attributes`),
      session.client.get<RawMeliField[]>(`/categories/${selectedCategoryId}/sale_terms`),
      session.meliUserId
        ? session.client.get<RawAvailableListingTypes>(
            `/users/${session.meliUserId}/available_listing_types`,
            { params: { category_id: selectedCategoryId } },
          )
        : session.client.get<Array<{ id?: string; name?: string; mapping?: string }>>(
            `/sites/${session.siteId}/listing_types`,
          ),
    ]);

  const selectedCategory = categoryResponse.data;
  const listingAllowed =
    selectedCategory.settings?.listing_allowed ?? selectedCategory.listing_allowed ?? false;
  const categoryStatus = sanitizeText(selectedCategory.settings?.status ?? selectedCategory.status);

  if (!listingAllowed || (categoryStatus && categoryStatus !== "enabled")) {
    warnings.push("A categoria escolhida pode nao estar habilitada para publicacao nessa conta.");
  }

  let techHints = new Map<string, TechHint>();
  const domainId = sanitizeText(selectedCategory.domain_id);
  if (domainId) {
    try {
      const techSpecs = await session.client.get<RawTechSpecs>(`/domains/${domainId}/technical_specs`);
      techHints = buildTechHintMap(techSpecs.data);
    } catch {
      // A publicacao segue apenas com atributos/sale terms se a ficha tecnica nao estiver disponivel.
    }
  }

  const listingTypes = normalizeListingTypes(listingTypeResponse.data);

  return {
    categories:
      categories.find((entry) => entry.id === selectedCategoryId) || !sanitizeText(selectedCategory.name)
        ? categories
        : [
            ...categories,
            {
              id: selectedCategoryId,
              name: sanitizeText(selectedCategory.name),
              domainId: sanitizeText(selectedCategory.domain_id) || undefined,
            },
          ],
    selectedCategory,
    listingTypes,
    attributeFields: buildFields("attribute", attributeResponse.data, techHints),
    saleTermFields: buildFields("sale_term", saleTermResponse.data, techHints),
    warnings,
  };
}

function normalizeListingTypes(
  data: RawAvailableListingTypes | Array<{ id?: string; name?: string; mapping?: string }>,
) {
  const source = Array.isArray(data) ? data : data.available ?? [];

  return source
    .map((entry) => {
      const id = sanitizeText(entry.id);
      const name = sanitizeText(entry.name);
      if (!id || !name) {
        return null;
      }

      return {
        id,
        name,
        mapping: sanitizeText("mapping" in entry ? entry.mapping : "") || undefined,
        remainingListings:
          "remaining_listings" in entry && typeof entry.remaining_listings === "number"
            ? entry.remaining_listings
            : null,
      } satisfies MeliPublicationListingTypeOption;
    })
    .filter(Boolean) as MeliPublicationListingTypeOption[];
}

function buildTechHintMap(data: RawTechSpecs) {
  const map = new Map<string, TechHint>();

  for (const group of data.input?.groups ?? []) {
    const groupName = sanitizeText(group.label);
    for (const component of group.components ?? []) {
      const hint = sanitizeText(component.ui_config?.hint ?? component.label);
      for (const attribute of component.attributes ?? []) {
        const id = sanitizeText(attribute.id);
        if (!id) {
          continue;
        }

        map.set(id, {
          groupName: groupName || undefined,
          hint: hint || undefined,
          label: sanitizeText(attribute.label) || undefined,
        });
      }
    }
  }

  return map;
}

function buildFields(
  scope: MeliPublicationFieldScope,
  rows: RawMeliField[] | null | undefined,
  techHints: Map<string, TechHint>,
) {
  return (rows ?? [])
    .filter((row) => isRequiredField(row.tags) || sanitizeText(row.id) === "ITEM_CONDITION")
    .map((row) => {
      const id = sanitizeText(row.id);
      if (!id) {
        return null;
      }

      const techHint = techHints.get(id);
      return {
        scope,
        id,
        name: sanitizeText(techHint?.label ?? row.name) || id,
        valueType: normalizeFieldValueType(row.value_type),
        required: isRequiredField(row.tags),
        multivalued: isMultivaluedField(row.tags),
        groupName: sanitizeText(techHint?.groupName ?? row.attribute_group_name) || undefined,
        hint: sanitizeText(techHint?.hint ?? row.hint) || undefined,
        defaultUnit: sanitizeText(row.default_unit) || undefined,
        maxLength: typeof row.value_max_length === "number" ? row.value_max_length : undefined,
        options: (row.values ?? [])
          .map(normalizeOption)
          .filter((entry): entry is NonNullable<ReturnType<typeof normalizeOption>> => Boolean(entry)),
        allowedUnits: (row.allowed_units ?? [])
          .map(normalizeOption)
          .filter((entry): entry is NonNullable<ReturnType<typeof normalizeOption>> => Boolean(entry)),
      } satisfies MeliPublicationField;
    })
    .filter(Boolean) as MeliPublicationField[];
}

function pickDefaultCondition(category: RawCategory) {
  const conditions = (category.settings?.item_conditions ?? []).map((entry) => sanitizeText(entry));
  if (conditions.includes("new")) {
    return "new" as const;
  }

  if (conditions.includes("used")) {
    return "used" as const;
  }

  return "not_specified" as const;
}

function resolveDefaultEntry(
  field: MeliPublicationField,
  condition: MeliPublicationDraft["condition"],
): MeliPublicationDraftEntry | null {
  const entry: MeliPublicationDraftEntry = {
    id: field.id,
    scope: field.scope,
    valueType: field.valueType,
  };

  if (field.id === "ITEM_CONDITION") {
    const preferredOption =
      field.options.find((option) => {
        const name = option.name.toLowerCase();
        return (
          (condition === "new" && (name.includes("novo") || name.includes("new"))) ||
          (condition === "used" && (name.includes("usado") || name.includes("used"))) ||
          (condition === "not_specified" &&
            (name.includes("nao especificado") || name.includes("not specified")))
        );
      }) ?? null;

    if (preferredOption) {
      entry.valueId = preferredOption.id;
      entry.valueName = preferredOption.name;
      return entry;
    }
  }

  if (field.id === "WARRANTY_TYPE") {
    const noWarranty =
      field.options.find((option) => option.name.toLowerCase().includes("sem garantia")) ?? null;

    if (noWarranty) {
      entry.valueId = noWarranty.id;
      entry.valueName = noWarranty.name;
      return entry;
    }
  }

  if (field.options.length === 1 && field.required && !field.multivalued) {
    entry.valueId = field.options[0].id;
    entry.valueName = field.options[0].name;
    return entry;
  }

  if (field.valueType === "number_unit" && field.defaultUnit) {
    entry.unit = field.defaultUnit;
    return entry;
  }

  return null;
}

function buildDefaultEntries(fields: MeliPublicationField[], condition: MeliPublicationDraft["condition"]) {
  return fields
    .map((field) => resolveDefaultEntry(field, condition))
    .filter(Boolean) as MeliPublicationDraftEntry[];
}

function mapPublishedItemSummary(item: RawMeliItem, categoryName?: string): MeliPublishedItemSummary | null {
  const id = sanitizeText(item.id);
  if (!id) {
    return null;
  }

  return {
    id,
    permalink: sanitizeText(item.permalink) || undefined,
    status: sanitizeText(item.status) || undefined,
    categoryId: sanitizeText(item.category_id) || undefined,
    categoryName: sanitizeText(categoryName) || undefined,
    listingTypeId: sanitizeText(item.listing_type_id) || undefined,
    catalogProductId: sanitizeText(item.catalog_product_id) || undefined,
    lastUpdated: sanitizeText(item.last_updated) || undefined,
  };
}

async function syncExistingPublication(
  session: MeliSession,
  productId: string,
  itemId?: string,
  fallbackCategoryName?: string,
) {
  const normalizedItemId = sanitizeText(itemId);
  if (!normalizedItemId) {
    return null;
  }

  try {
    const response = await session.client.get<RawMeliItem>(`/items/${normalizedItemId}`);
    const item = mapPublishedItemSummary(response.data);

    await updateProductPublicationById(productId, {
      itemId: item?.id ?? normalizedItemId,
      permalink: item?.permalink ?? null,
      status: item?.status ?? null,
      categoryId: item?.categoryId ?? null,
      categoryName: item?.categoryName ?? fallbackCategoryName ?? null,
      listingTypeId: item?.listingTypeId ?? null,
      lastSyncAt: new Date(),
      lastSyncError: null,
    });

    return item;
  } catch (error) {
    await updateProductPublicationById(productId, {
      itemId: normalizedItemId,
      lastSyncAt: new Date(),
      lastSyncError: resolveApiErrorMessage(error, "Nao foi possivel sincronizar o anuncio."),
    });

    return null;
  }
}

function buildDraft(
  product: NonNullable<Awaited<ReturnType<typeof getProductById>>>,
  context: PublicationContext,
): MeliPublicationDraft {
  if (!context.selectedCategory) {
    throw new MeliPublicationError("Nenhuma categoria valida foi encontrada para esse produto.");
  }

  const condition = pickDefaultCondition(context.selectedCategory);
  const titleLimit = context.selectedCategory.settings?.max_title_length ?? 60;
  const picturesLimit = context.selectedCategory.settings?.max_pictures_per_item ?? 6;
  const currencyId = context.selectedCategory.settings?.currencies?.[0] ?? "BRL";
  const pictures = uniqueStrings([product.image, ...product.images]).slice(0, picturesLimit);
  const listingTypeId =
    context.listingTypes.find((entry) => entry.id === product.meliPublication?.listingTypeId)?.id ??
    context.listingTypes[0]?.id ??
    "";

  return {
    productId: product.id,
    title: truncateText(product.title, titleLimit),
    categoryId: sanitizeText(context.selectedCategory.id),
    listingTypeId,
    price: product.price,
    currencyId,
    availableQuantity: 1,
    buyingMode: "buy_it_now",
    condition,
    description: sanitizeText(product.description) || product.title,
    pictures,
    channels: ["marketplace"],
    attributes: buildDefaultEntries(context.attributeFields, condition),
    saleTerms: buildDefaultEntries(context.saleTermFields, condition),
  };
}

function entryHasValue(entry: MeliPublicationDraftEntry) {
  return Boolean(
    sanitizeText(entry.valueId) ||
      sanitizeText(entry.valueName) ||
      sanitizeText(entry.unit) ||
      (Array.isArray(entry.values) && entry.values.some((value) => sanitizeText(value))),
  );
}

function buildFieldPayload(entry: MeliPublicationDraftEntry, field: MeliPublicationField) {
  if (!entryHasValue(entry)) {
    return null;
  }

  if (field.multivalued) {
    const values = (entry.values ?? [])
      .map((value) => sanitizeText(value))
      .filter(Boolean)
      .map((value) => ({ name: value }));

    return values.length > 0 ? { id: field.id, values } : null;
  }

  if ((field.valueType === "list" || field.valueType === "boolean") && entry.valueId) {
    return {
      id: field.id,
      value_id: entry.valueId,
      value_name: sanitizeText(entry.valueName) || undefined,
    };
  }

  if (field.valueType === "number_unit") {
    const numberValue = Number(String(entry.valueName ?? "").replace(",", "."));
    if (!Number.isFinite(numberValue)) {
      return null;
    }

    return {
      id: field.id,
      value_struct: {
        number: numberValue,
        unit: sanitizeText(entry.unit) || field.defaultUnit || "",
      },
    };
  }

  return {
    id: field.id,
    value_name: sanitizeText(entry.valueName),
  };
}

function assertLocalDraft(draft: MeliPublicationDraft, fields: MeliPublicationField[]) {
  const causes: MeliPublicationValidationCause[] = [];

  if (!sanitizeText(draft.title)) {
    causes.push({ message: "Informe o titulo do anuncio." });
  }
  if (!sanitizeText(draft.categoryId)) {
    causes.push({ message: "Selecione uma categoria para publicar." });
  }
  if (!sanitizeText(draft.listingTypeId)) {
    causes.push({ message: "Selecione um tipo de anuncio." });
  }
  if (!Number.isFinite(draft.price) || draft.price <= 0) {
    causes.push({ message: "Informe um preco valido." });
  }
  if (draft.pictures.length === 0) {
    causes.push({ message: "Adicione pelo menos uma imagem publica do produto." });
  }

  for (const field of fields.filter((entry) => entry.required)) {
    const draftEntry = [...draft.attributes, ...draft.saleTerms].find(
      (entry) => entry.scope === field.scope && entry.id === field.id,
    );

    if (!draftEntry || !entryHasValue(draftEntry)) {
      causes.push({ message: `Preencha o campo obrigatorio "${field.name}".` });
    }
  }

  if (causes.length > 0) {
    throw new MeliPublicationValidationError("Revise os campos obrigatorios antes de validar.", causes);
  }
}

function buildItemPayload(
  draft: MeliPublicationDraft,
  attributeFields: MeliPublicationField[],
  saleTermFields: MeliPublicationField[],
) {
  const attributeMap = new Map(attributeFields.map((field) => [field.id, field]));
  const saleTermMap = new Map(saleTermFields.map((field) => [field.id, field]));

  const attributes = draft.attributes
    .map((entry) => {
      const field = attributeMap.get(entry.id);
      return field ? buildFieldPayload(entry, field) : null;
    })
    .filter(Boolean);

  const saleTerms = draft.saleTerms
    .map((entry) => {
      const field = saleTermMap.get(entry.id);
      return field ? buildFieldPayload(entry, field) : null;
    })
    .filter(Boolean);

  return {
    title: sanitizeText(draft.title),
    category_id: sanitizeText(draft.categoryId),
    price: Number(draft.price),
    currency_id: sanitizeText(draft.currencyId) || "BRL",
    available_quantity: Math.max(1, Number(draft.availableQuantity || 1)),
    buying_mode: "buy_it_now",
    listing_type_id: sanitizeText(draft.listingTypeId),
    condition: sanitizeText(draft.condition) || "not_specified",
    channels: uniqueStrings(draft.channels).length > 0 ? uniqueStrings(draft.channels) : ["marketplace"],
    pictures: uniqueStrings(draft.pictures).map((source) => ({ source })),
    attributes,
    sale_terms: saleTerms,
  };
}

export async function prepareMeliPublication(
  productId: string,
  userId?: string,
  categoryId?: string,
): Promise<MeliPublicationPrepareResponse> {
  const product = await getProductById(productId);
  if (!product) {
    throw new ProductNotFoundError("Produto nao encontrado.");
  }

  const session = await createSession(userId);
  const publishedItem = await syncExistingPublication(
    session,
    product.id,
    product.meliPublication?.itemId,
    product.meliPublication?.categoryName,
  );
  const context = await fetchPublicationContext(session, product.title, categoryId);

  if (!sanitizeText(product.description)) {
    context.warnings.push("O produto esta sem descricao. Vale completar antes de publicar.");
  }

  const draft = buildDraft(product, context);
  const publishedItemSummary =
    publishedItem || product.meliPublication?.itemId
      ? {
          id: sanitizeText(publishedItem?.id ?? product.meliPublication?.itemId),
          permalink: publishedItem?.permalink ?? product.meliPublication?.permalink,
          status: publishedItem?.status ?? product.meliPublication?.status,
          categoryId: publishedItem?.categoryId ?? product.meliPublication?.categoryId,
          categoryName: publishedItem?.categoryName ?? product.meliPublication?.categoryName,
          listingTypeId: publishedItem?.listingTypeId ?? product.meliPublication?.listingTypeId,
          lastUpdated:
            publishedItem?.lastUpdated ?? product.meliPublication?.lastSyncAt?.toISOString(),
        }
      : undefined;

  return {
    credential: {
      id: session.credential.id,
      name: session.credential.name,
      meliNickname: session.credential.meliNickname,
      siteId: session.siteId,
    },
    product: toProductDTO(product),
    categories: context.categories,
    listingTypes: context.listingTypes,
    attributeFields: context.attributeFields,
    saleTermFields: context.saleTermFields,
    draft,
    publishedItem: publishedItemSummary,
    warnings: uniqueStrings(context.warnings),
  };
}

export async function validateMeliPublication(
  draft: MeliPublicationDraft,
  userId?: string,
): Promise<MeliPublicationValidationResponse> {
  const session = await createSession(userId);
  const context = await fetchPublicationContext(session, draft.title, draft.categoryId);
  const fields = [...context.attributeFields, ...context.saleTermFields];

  assertLocalDraft(draft, fields);

  try {
    await session.client.post("/items/validate", buildItemPayload(draft, context.attributeFields, context.saleTermFields));
    return {
      valid: true,
      message: "Publicacao validada com sucesso pela API oficial do Mercado Livre.",
      causes: [],
    };
  } catch (error) {
    if (error instanceof AxiosError && error.response?.status === 400) {
      const causes = parseValidationCauses(error.response.data);
      throw new MeliPublicationValidationError(
        resolveApiErrorMessage(error, "A API do Mercado Livre recusou a validacao."),
        causes,
      );
    }

    throw new MeliPublicationError(
      resolveApiErrorMessage(error, "Nao foi possivel validar a publicacao no Mercado Livre."),
    );
  }
}

async function savePublicationState(
  productId: string,
  item: MeliPublishedItemSummary,
  lastSyncError?: string | null,
) {
  return updateProductPublicationById(productId, {
    itemId: item.id,
    permalink: item.permalink ?? null,
    status: item.status ?? null,
    categoryId: item.categoryId ?? null,
    categoryName: item.categoryName ?? null,
    listingTypeId: item.listingTypeId ?? null,
    publishedAt: new Date(),
    lastSyncAt: new Date(),
    lastSyncError: lastSyncError ?? null,
  });
}

export async function publishMeliPublication(
  draft: MeliPublicationDraft,
  userId?: string,
): Promise<MeliPublicationPublishResponse> {
  await validateMeliPublication(draft, userId);

  const session = await createSession(userId);
  const context = await fetchPublicationContext(session, draft.title, draft.categoryId);

  try {
    const createResponse = await session.client.post<RawMeliItem>(
      "/items",
      buildItemPayload(draft, context.attributeFields, context.saleTermFields),
    );

    const item = mapPublishedItemSummary(
      createResponse.data,
      context.categories.find((entry) => entry.id === draft.categoryId)?.name,
    );

    if (!item) {
      throw new MeliPublicationError("O Mercado Livre nao retornou um item valido apos a publicacao.");
    }

    let warning: string | undefined;
    const description = sanitizeText(draft.description);
    if (description) {
      try {
        await session.client.post(`/items/${item.id}/description`, {
          plain_text: description,
        });
      } catch (error) {
        warning = resolveApiErrorMessage(
          error,
          "O item foi publicado, mas a descricao nao foi enviada.",
        );
      }
    }

    const updatedProduct = await savePublicationState(draft.productId, item, warning ?? null);

    return {
      message: "Anuncio publicado com sucesso no Mercado Livre.",
      item,
      product: toProductDTO(updatedProduct),
      warning,
    };
  } catch (error) {
    throw new MeliPublicationError(
      resolveApiErrorMessage(error, "Nao foi possivel publicar o item no Mercado Livre."),
    );
  }
}
