import { CAMPAIGN_TEMPLATE_STARTER } from "@/lib/campaigns/formatter";
import { createCampaign, listCampaigns } from "@/lib/campaigns/store";
import { MAX_RECIPIENTS_PER_CAMPAIGN } from "@/lib/campaigns/types";
import { resolveMercadoLivreProductLinks } from "@/lib/meli/affiliate";
import { resolveMercadoLivreVisibleCouponData } from "@/lib/meli/coupons";
import {
  fetchMercadoLivreProductForImport,
  type ProductImportLookupMode,
} from "@/lib/products/importBridge";
import { buildProductMarketingMessage } from "@/lib/products/message";
import { extractMercadoLivreItemIdFromUrl } from "@/lib/products/mercadoLivreLink";
import {
  createProduct,
  getProductByLink,
  listProducts,
  updateProductById,
} from "@/lib/products/store";
import { formatCurrencyBRL } from "@/lib/products/client";
import type { Product } from "@/lib/products/types";
import { createRecipientRecord, listRecipients } from "@/lib/recipients/store";
import {
  getRecipientTypeLabel,
  isRecipientSendable,
  matchesRecipientSearch,
  normalizePhoneNumber,
  type Recipient,
  type RecipientDraft,
} from "@/lib/recipients";
import type { AuthenticatedUser } from "@/lib/auth";
import type {
  AssistantAction,
  AssistantCard,
  AssistantResponsePayload,
  AssistantSummary,
  AssistantWorkflow,
} from "@/lib/assistant/types";

const DEFAULT_LOOKUP_MODE: ProductImportLookupMode = "html-root-app";
const MAX_RESULT_CARDS = 6;
const CONTACT_INLINE_PHONE_REGEX = /(55\d{10,13}|\d{10,15})/;
const MERCADO_LIVRE_LINK_REGEX = /https?:\/\/[^\s]+(?:mercadolivre|mercadolibre|meli\.la)[^\s]*/i;

function normalizeText(value: string | undefined | null) {
  return String(value ?? "").trim();
}

function normalizeSearchText(value: string | undefined | null) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function createCardId(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
}

function mapCampaignStatusLabel(status: string) {
  if (status === "sending") {
    return "Ativa";
  }

  if (status === "pending") {
    return "Pendente";
  }

  if (status === "finished") {
    return "Finalizada";
  }

  if (status === "failed") {
    return "Com falha";
  }

  return status;
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function buildQuickActions(actions: Array<AssistantAction | null | undefined>) {
  return actions.filter((action): action is AssistantAction => Boolean(action));
}

function extractMercadoLivreUrl(message: string) {
  const match = message.match(MERCADO_LIVRE_LINK_REGEX);
  if (!match) {
    return "";
  }

  return match[0].replace(/[),.;!?]+$/g, "");
}

function searchProductsByQuery(products: Product[], query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return products;
  }

  return products.filter((product) =>
    [product.title, product.seller ?? "", product.description].some((field) =>
      normalizeSearchText(field).includes(normalizedQuery),
    ),
  );
}

function searchCampaignsByQuery<
  T extends {
    name: string;
    productTitle: string;
    status: string;
  },
>(campaigns: T[], query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return campaigns;
  }

  return campaigns.filter((campaign) =>
    [campaign.name, campaign.productTitle, mapCampaignStatusLabel(campaign.status)].some((field) =>
      normalizeSearchText(field).includes(normalizedQuery),
    ),
  );
}

function toAssistantSummary(args: {
  productsCount: number;
  contactsCount: number;
  activeCampaignsCount: number;
  finishedCampaignsCount: number;
  failedCampaignsCount: number;
}) {
  return {
    productsCount: args.productsCount,
    contactsCount: args.contactsCount,
    activeCampaignsCount: args.activeCampaignsCount,
    finishedCampaignsCount: args.finishedCampaignsCount,
    failedCampaignsCount: args.failedCampaignsCount,
  } satisfies AssistantSummary;
}

async function loadAssistantSummary() {
  const [products, recipients, campaigns] = await Promise.all([
    listProducts(),
    listRecipients(),
    listCampaigns(),
  ]);

  const activeCampaignsCount = campaigns.filter(
    (campaign) => campaign.status === "pending" || campaign.status === "sending",
  ).length;
  const finishedCampaignsCount = campaigns.filter((campaign) => campaign.status === "finished")
    .length;
  const failedCampaignsCount = campaigns.filter((campaign) => campaign.status === "failed").length;

  return {
    products,
    recipients,
    campaigns,
    summary: toAssistantSummary({
      productsCount: products.length,
      contactsCount: recipients.length,
      activeCampaignsCount,
      finishedCampaignsCount,
      failedCampaignsCount,
    }),
  };
}

function buildSummaryMessage(summary: AssistantSummary) {
  return [
    "Resumo da sua plataforma:",
    "",
    `Produtos cadastrados: ${summary.productsCount}`,
    `Contatos cadastrados: ${summary.contactsCount}`,
    `Campanhas ativas: ${summary.activeCampaignsCount}`,
    `Campanhas finalizadas: ${summary.finishedCampaignsCount}`,
    `Campanhas com falha: ${summary.failedCampaignsCount}`,
  ].join("\n");
}

function buildWelcomeMessage(user: AuthenticatedUser, summary: AssistantSummary) {
  const hasAnyData =
    summary.productsCount > 0 ||
    summary.contactsCount > 0 ||
    summary.activeCampaignsCount > 0 ||
    summary.finishedCampaignsCount > 0 ||
    summary.failedCampaignsCount > 0;

  if (!hasAnyData) {
    return [
      `Conta ativada com sucesso, ${user.name}.`,
      "",
      "Seu painel está pronto.",
      "",
      "Agora você pode:",
      "Cadastrar produtos",
      "Cadastrar contatos",
      "Criar campanhas",
      "Acompanhar resultados",
    ].join("\n");
  }

  return [
    `Bem-vindo de volta, ${user.name}.`,
    "",
    "Sou o assistente interno da plataforma.",
    "Posso importar produto por link, cadastrar contato, criar campanha guiada e mostrar seus resultados.",
  ].join("\n");
}

function buildProductCards(products: Product[]) {
  return products.slice(0, MAX_RESULT_CARDS).map((product) => ({
    id: createCardId("product"),
    title: truncateText(product.title, 80),
    description: product.seller ? `Loja: ${product.seller}` : "Mercado Livre",
    imageUrl: product.image || undefined,
    fields: [
      {
        label: "Preco",
        value: formatCurrencyBRL(product.price),
      },
      {
        label: "Link",
        value: product.link,
      },
    ],
  }) satisfies AssistantCard);
}

function buildRecipientCards(recipients: Recipient[]) {
  return recipients.slice(0, MAX_RESULT_CARDS).map((recipient) => ({
    id: createCardId("recipient"),
    title: truncateText(recipient.name, 80),
    description: getRecipientTypeLabel(recipient.type),
    fields: [
      {
        label: "Destino",
        value: recipient.phone ?? recipient.link ?? recipient.tag ?? "-",
      },
    ],
  }) satisfies AssistantCard);
}

function buildCampaignCards<
  T extends {
    id: string;
    name: string;
    productTitle: string;
    status: string;
    totalMessages: number;
  },
>(campaigns: T[]) {
  return campaigns.slice(0, MAX_RESULT_CARDS).map((campaign) => ({
    id: createCardId("campaign"),
    title: truncateText(campaign.name, 80),
    description: truncateText(campaign.productTitle, 90),
    fields: [
      {
        label: "Status",
        value: mapCampaignStatusLabel(campaign.status),
      },
      {
        label: "Mensagens",
        value: String(campaign.totalMessages),
      },
    ],
  }) satisfies AssistantCard);
}

async function previewMercadoLivreProduct(url: string) {
  const product = await fetchMercadoLivreProductForImport(url, DEFAULT_LOOKUP_MODE);
  const canonicalLink = product.canonicalLink ?? product.link;
  const resolvedLinks = await resolveMercadoLivreProductLinks({
    link: product.link,
    canonicalLink,
    linkOriginal: canonicalLink,
    linkAffiliate: product.link,
    linkShort: product.link,
  });

  const existingProduct =
    (await getProductByLink(resolvedLinks.link)) ??
    (resolvedLinks.link === resolvedLinks.linkOriginal
      ? null
      : await getProductByLink(resolvedLinks.linkOriginal));

  return {
    product,
    resolvedLinks,
    existingProduct,
  };
}

async function importMercadoLivreProduct(url: string) {
  const { product, resolvedLinks, existingProduct } = await previewMercadoLivreProduct(url);
  const fallbackMarketingMessage = buildProductMarketingMessage({
    title: product.title,
    price: product.price,
    link: resolvedLinks.link,
  });
  const visibleCouponData = await resolveMercadoLivreVisibleCouponData({
    url,
    title: product.title,
    price: product.price,
    originalPrice: product.originalPrice,
    hasCouponOrDiscount: product.hasCouponOrDiscount,
    couponLabel: product.couponLabel,
    fallbackMarketingMessage,
  });

  const payload = {
    title: product.title,
    price: product.price,
    originalPrice: product.originalPrice,
    discount: product.discount,
    hasCouponOrDiscount: visibleCouponData.hasCouponOrDiscount,
    couponLabel: visibleCouponData.couponLabel ?? "",
    image: product.image,
    images: product.images,
    description: product.description,
    itemId:
      extractMercadoLivreItemIdFromUrl(product.canonicalLink ?? product.link) ??
      extractMercadoLivreItemIdFromUrl(url) ??
      undefined,
    link: resolvedLinks.link,
    linkOriginal: resolvedLinks.linkOriginal,
    linkAffiliate: resolvedLinks.linkAffiliate,
    linkShort: resolvedLinks.linkShort,
    marketingMessage: visibleCouponData.marketingMessage,
    linkNormalized: resolvedLinks.linkOriginal,
    marketplace: product.marketplace,
    seller: product.seller ?? "",
  } as const;

  const savedProduct = existingProduct
    ? await updateProductById(existingProduct.id, payload)
    : await createProduct(payload);

  return {
    savedProduct,
    status: existingProduct ? "updated" : "created",
  };
}

function parseInlineContact(message: string) {
  const phoneMatch = message.match(CONTACT_INLINE_PHONE_REGEX);
  if (!phoneMatch) {
    return null;
  }

  const phone = normalizePhoneNumber(phoneMatch[0]);
  if (!phone) {
    return null;
  }

  const name = message.replace(phoneMatch[0], "").replace(/adicionar contato/gi, "").trim();
  if (!name) {
    return null;
  }

  return {
    name,
    phone,
  };
}

function buildCampaignName(productTitle: string) {
  const baseTitle = truncateText(productTitle.replace(/\s+/g, " ").trim(), 34);
  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date());
  return `Campanha ${baseTitle} ${dateLabel}`;
}

function buildCampaignRecipientOptions(recipients: Recipient[]) {
  const sendableRecipients = recipients.filter(isRecipientSendable);
  const firstTwenty = sendableRecipients.slice(0, Math.min(20, sendableRecipients.length));
  const firstFifty = sendableRecipients.slice(
    0,
    Math.min(MAX_RECIPIENTS_PER_CAMPAIGN, sendableRecipients.length),
  );

  return {
    sendableRecipients,
    options: buildQuickActions([
      firstFifty.length > 0
        ? {
            id: "campaign-scope:first-50",
            label:
              sendableRecipients.length <= MAX_RECIPIENTS_PER_CAMPAIGN
                ? `Todos os contatos aptos (${firstFifty.length})`
                : `Primeiros ${firstFifty.length} contatos aptos`,
            kind: "submit",
            value: "Usar contatos aptos",
          }
        : null,
      firstTwenty.length > 0 && firstTwenty.length < firstFifty.length
        ? {
            id: "campaign-scope:first-20",
            label: `Primeiros ${firstTwenty.length} contatos aptos`,
            kind: "submit",
            value: "Usar primeiros contatos",
          }
        : null,
      {
        id: "campaign-open-contacts",
        label: "Gerenciar contatos",
        kind: "navigate",
        href: "/contatos",
      },
      {
        id: "cancel-workflow",
        label: "Cancelar",
        kind: "submit",
        value: "Cancelar",
      },
    ]),
  };
}

function buildDefaultAssistantActions() {
  return buildQuickActions([
    {
      id: "quick-summary",
      label: "Resumo da conta",
      kind: "submit",
      value: "Resumo da conta",
    },
    {
      id: "quick-product",
      label: "Cadastrar produto",
      kind: "submit",
      value: "Cadastrar produto",
    },
    {
      id: "quick-contact",
      label: "Adicionar contato",
      kind: "submit",
      value: "Adicionar contato",
    },
    {
      id: "quick-campaign",
      label: "Criar campanha",
      kind: "submit",
      value: "Criar campanha",
    },
  ]);
}

async function handleProductImportWorkflow(args: {
  actionId: string;
  workflow: Extract<AssistantWorkflow, { type: "product-import" }>;
}) {
  if (args.actionId === "cancel-workflow") {
    return {
      message: "Fluxo cancelado. Quando quiser, envie outro link do Mercado Livre.",
      workflow: null,
      actions: buildDefaultAssistantActions(),
    } satisfies AssistantResponsePayload;
  }

  if (args.actionId !== "confirm-product-import") {
    return {
      message: "Use os botoes para confirmar ou cancelar a importacao do produto.",
      workflow: args.workflow,
    } satisfies AssistantResponsePayload;
  }

  const imported = await importMercadoLivreProduct(args.workflow.sourceUrl);

  return {
    message:
      imported.status === "updated"
        ? "Produto ja existia e foi atualizado com sucesso."
        : "Produto cadastrado com sucesso.",
    cards: [
      {
        id: createCardId("product-imported"),
        title: imported.savedProduct.title,
        description: imported.savedProduct.seller
          ? `Loja: ${imported.savedProduct.seller}`
          : "Mercado Livre",
        imageUrl: imported.savedProduct.image || undefined,
        tone: "success",
        fields: [
          {
            label: "Preco",
            value: formatCurrencyBRL(imported.savedProduct.price),
          },
          {
            label: "Link",
            value: imported.savedProduct.link,
          },
        ],
      },
    ],
    workflow: null,
    actions: buildQuickActions([
      {
        id: "goto-products",
        label: "Abrir produtos",
        kind: "navigate",
        href: "/produtos",
      },
      {
        id: "quick-campaign",
        label: "Criar campanha",
        kind: "submit",
        value: "Criar campanha",
      },
    ]),
  } satisfies AssistantResponsePayload;
}

async function handleContactCreateWorkflow(args: {
  message: string;
  actionId: string;
  workflow: Extract<AssistantWorkflow, { type: "contact-create" }>;
}) {
  if (args.actionId === "cancel-workflow") {
    return {
      message: "Cadastro de contato cancelado.",
      workflow: null,
      actions: buildDefaultAssistantActions(),
    } satisfies AssistantResponsePayload;
  }

  if (args.workflow.stage === "await-name") {
    const contactName = normalizeText(args.message);
    if (!contactName) {
      return {
        message: "Digite o nome do contato que deseja cadastrar.",
        workflow: args.workflow,
      } satisfies AssistantResponsePayload;
    }

    return {
      message: `Agora envie o telefone do contato ${contactName} no formato 5511999999999.`,
      workflow: {
        type: "contact-create",
        stage: "await-phone",
        draft: {
          name: contactName,
        },
      },
      actions: buildQuickActions([
        {
          id: "cancel-workflow",
          label: "Cancelar",
          kind: "submit",
          value: "Cancelar",
        },
      ]),
    } satisfies AssistantResponsePayload;
  }

  const phone = normalizePhoneNumber(args.message);
  if (!phone || phone.length < 10 || phone.length > 15) {
    return {
      message: "Telefone invalido. Envie apenas numeros, por exemplo 5511999999999.",
      workflow: args.workflow,
    } satisfies AssistantResponsePayload;
  }

  const recipient = await createRecipientRecord({
    type: "contact",
    name: args.workflow.draft.name,
    phone,
  } satisfies RecipientDraft);

  return {
    message: `Contato ${recipient.name} cadastrado com sucesso.`,
    cards: [
      {
        id: createCardId("contact"),
        title: recipient.name,
        tone: "success",
        fields: [
          {
            label: "Telefone",
            value: recipient.phone ?? "-",
          },
        ],
      },
    ],
    workflow: null,
    actions: buildQuickActions([
      {
        id: "goto-contacts",
        label: "Abrir contatos",
        kind: "navigate",
        href: "/contatos",
      },
      {
        id: "quick-campaign",
        label: "Criar campanha",
        kind: "submit",
        value: "Criar campanha",
      },
    ]),
  } satisfies AssistantResponsePayload;
}

async function handleCampaignCreateWorkflow(args: {
  message: string;
  actionId: string;
  workflow: Extract<AssistantWorkflow, { type: "campaign-create" }>;
}) {
  if (args.actionId === "cancel-workflow") {
    return {
      message: "Fluxo de campanha cancelado.",
      workflow: null,
      actions: buildDefaultAssistantActions(),
    } satisfies AssistantResponsePayload;
  }

  if (args.workflow.stage === "select-product") {
    const products = await listProducts();

    if (products.length === 0) {
      return {
        message: "Voce ainda nao possui produtos cadastrados. Primeiro envie um link do Mercado Livre para importar um produto.",
        workflow: null,
        actions: buildQuickActions([
          {
            id: "goto-products",
            label: "Abrir produtos",
            kind: "navigate",
            href: "/produtos",
          },
          {
            id: "quick-product",
            label: "Cadastrar produto",
            kind: "submit",
            value: "Cadastrar produto",
          },
        ]),
      } satisfies AssistantResponsePayload;
    }

    let productsForSelection = products.slice(0, MAX_RESULT_CARDS);
    if (normalizeText(args.message)) {
      const filteredProducts = searchProductsByQuery(products, args.message);
      if (filteredProducts.length > 0) {
        productsForSelection = filteredProducts.slice(0, MAX_RESULT_CARDS);
      }
    }

    const selectedProductId = args.actionId.startsWith("campaign-product:")
      ? args.actionId.replace("campaign-product:", "")
      : "";

    if (selectedProductId) {
      const selectedProduct = products.find((product) => product.id === selectedProductId);
      if (!selectedProduct) {
        return {
          message: "Produto nao encontrado. Escolha uma opcao valida.",
          workflow: args.workflow,
        } satisfies AssistantResponsePayload;
      }

      const { sendableRecipients, options } = buildCampaignRecipientOptions(await listRecipients());
      if (sendableRecipients.length === 0) {
        return {
          message: "Nao existem contatos aptos para disparo. Cadastre pelo menos um contato antes de criar a campanha.",
          workflow: null,
          actions: buildQuickActions([
            {
              id: "goto-contacts",
              label: "Abrir contatos",
              kind: "navigate",
              href: "/contatos",
            },
            {
              id: "quick-contact",
              label: "Adicionar contato",
              kind: "submit",
              value: "Adicionar contato",
            },
          ]),
        } satisfies AssistantResponsePayload;
      }

      return {
        message: [
          "Vamos criar uma campanha.",
          "",
          `Produto selecionado: ${selectedProduct.title}`,
          "",
          "Agora escolha como deseja selecionar os contatos para esta campanha.",
          `Limite atual por lote: ${MAX_RECIPIENTS_PER_CAMPAIGN} destinatarios.`,
        ].join("\n"),
        workflow: {
          type: "campaign-create",
          stage: "select-recipient-scope",
          productId: selectedProduct.id,
          productTitle: selectedProduct.title,
        },
        cards: buildProductCards([selectedProduct]),
        actions: options,
      } satisfies AssistantResponsePayload;
    }

    return {
      message: normalizeText(args.message)
        ? "Encontrei estes produtos. Escolha o item que deseja divulgar."
        : "Vamos criar uma campanha.\n\nEscolha o produto que deseja divulgar.",
      workflow: args.workflow,
      cards: buildProductCards(productsForSelection),
      actions: buildQuickActions([
        ...productsForSelection.map((product) => ({
          id: `campaign-product:${product.id}`,
          label: truncateText(product.title, 42),
          kind: "submit" as const,
          value: product.title,
        })),
        {
          id: "goto-products",
          label: "Abrir produtos",
          kind: "navigate" as const,
          href: "/produtos",
        },
        {
          id: "cancel-workflow",
          label: "Cancelar",
          kind: "submit" as const,
          value: "Cancelar",
        },
      ]),
    } satisfies AssistantResponsePayload;
  }

  if (args.workflow.stage === "select-recipient-scope") {
    const recipients = await listRecipients();
    const sendableRecipients = recipients.filter(isRecipientSendable);

    let recipientIds: string[] = [];
    let recipientLabel = "";

    if (args.actionId === "campaign-scope:first-20") {
      recipientIds = sendableRecipients
        .slice(0, Math.min(20, sendableRecipients.length))
        .map((recipient) => recipient.id);
      recipientLabel = `Primeiros ${recipientIds.length} contatos aptos`;
    } else {
      recipientIds = sendableRecipients
        .slice(0, Math.min(MAX_RECIPIENTS_PER_CAMPAIGN, sendableRecipients.length))
        .map((recipient) => recipient.id);
      recipientLabel =
        sendableRecipients.length <= MAX_RECIPIENTS_PER_CAMPAIGN
          ? `Todos os contatos aptos (${recipientIds.length})`
          : `Primeiros ${recipientIds.length} contatos aptos`;
    }

    if (recipientIds.length === 0) {
      return {
        message: "Nao existem contatos aptos para seguir com a campanha.",
        workflow: null,
        actions: buildQuickActions([
          {
            id: "goto-contacts",
            label: "Abrir contatos",
            kind: "navigate",
            href: "/contatos",
          },
        ]),
      } satisfies AssistantResponsePayload;
    }

    return {
      message: [
        "Contatos definidos com sucesso.",
        "",
        `Escopo selecionado: ${recipientLabel}`,
        "",
        "Agora escolha o intervalo entre os envios.",
      ].join("\n"),
      workflow: {
        type: "campaign-create",
        stage: "select-delay",
        productId: args.workflow.productId,
        productTitle: args.workflow.productTitle,
        recipientIds,
        recipientLabel,
        messageTemplate: CAMPAIGN_TEMPLATE_STARTER,
        campaignName: buildCampaignName(args.workflow.productTitle),
      },
      actions: buildQuickActions([
        {
          id: "campaign-delay:60",
          label: "60 segundos",
          kind: "submit",
          value: "60 segundos",
        },
        {
          id: "campaign-delay:120",
          label: "120 segundos",
          kind: "submit",
          value: "120 segundos",
        },
        {
          id: "campaign-delay:180",
          label: "180 segundos",
          kind: "submit",
          value: "180 segundos",
        },
        {
          id: "cancel-workflow",
          label: "Cancelar",
          kind: "submit",
          value: "Cancelar",
        },
      ]),
    } satisfies AssistantResponsePayload;
  }

  if (args.workflow.stage === "select-delay") {
    const rawDelay = args.actionId.startsWith("campaign-delay:")
      ? args.actionId.replace("campaign-delay:", "")
      : "";
    const delaySeconds = Number(rawDelay);

    if (!Number.isFinite(delaySeconds) || delaySeconds <= 0) {
      return {
        message: "Escolha um intervalo valido para a campanha.",
        workflow: args.workflow,
      } satisfies AssistantResponsePayload;
    }

    return {
      message: [
        "Campanha pronta para criacao.",
        "",
        `Produto: ${args.workflow.productTitle}`,
        `Contatos: ${args.workflow.recipientLabel}`,
        `Intervalo: ${delaySeconds} segundos`,
        "",
        "Se confirmar, vou criar a campanha com o modelo padrao do sistema.",
      ].join("\n"),
      workflow: {
        type: "campaign-create",
        stage: "confirm",
        draft: {
          productId: args.workflow.productId,
          productTitle: args.workflow.productTitle,
          recipientIds: args.workflow.recipientIds,
          recipientLabel: args.workflow.recipientLabel,
          messageTemplate: args.workflow.messageTemplate,
          campaignName: args.workflow.campaignName,
          delaySeconds,
        },
      },
      actions: buildQuickActions([
        {
          id: "confirm-campaign-create",
          label: "Criar campanha",
          kind: "submit",
          value: "Criar campanha",
        },
        {
          id: "goto-campaigns",
          label: "Abrir campanhas",
          kind: "navigate",
          href: "/campanhas",
        },
        {
          id: "cancel-workflow",
          label: "Cancelar",
          kind: "submit",
          value: "Cancelar",
        },
      ]),
    } satisfies AssistantResponsePayload;
  }

  if (args.actionId !== "confirm-campaign-create") {
    return {
      message: "Use o botao de confirmacao para criar a campanha ou cancele o fluxo atual.",
      workflow: args.workflow,
    } satisfies AssistantResponsePayload;
  }

  const createdCampaign = await createCampaign({
    name: args.workflow.draft.campaignName,
    productId: args.workflow.draft.productId,
    recipientIds: args.workflow.draft.recipientIds,
    messageTemplate: args.workflow.draft.messageTemplate,
    delaySeconds: args.workflow.draft.delaySeconds,
  });

  return {
    message: "Campanha criada com sucesso. Ela ficou pronta para ser iniciada no painel.",
    cards: [
      {
        id: createCardId("campaign-created"),
        title: createdCampaign.name,
        tone: "success",
        fields: [
          {
            label: "Produto",
            value: createdCampaign.productTitle,
          },
          {
            label: "Status",
            value: mapCampaignStatusLabel(createdCampaign.status),
          },
          {
            label: "Mensagens",
            value: String(createdCampaign.totalMessages),
          },
        ],
      },
    ],
    workflow: null,
    actions: buildQuickActions([
      {
        id: "goto-campaigns",
        label: "Abrir campanhas",
        kind: "navigate",
        href: "/campanhas",
      },
      {
        id: "quick-results",
        label: "Ver resultados",
        kind: "submit",
        value: "Ver resultados",
      },
    ]),
  } satisfies AssistantResponsePayload;
}

async function handleWorkflowMessage(args: {
  message: string;
  actionId: string;
  workflow: AssistantWorkflow;
}) {
  if (args.workflow.type === "product-import") {
    return handleProductImportWorkflow({
      actionId: args.actionId,
      workflow: args.workflow,
    });
  }

  if (args.workflow.type === "contact-create") {
    return handleContactCreateWorkflow({
      message: args.message,
      actionId: args.actionId,
      workflow: args.workflow,
    });
  }

  return handleCampaignCreateWorkflow({
    message: args.message,
    actionId: args.actionId,
    workflow: args.workflow,
  });
}

async function buildProductPreviewResponse(url: string) {
  const { product, existingProduct } = await previewMercadoLivreProduct(url);

  return {
    message: [
      "Produto identificado.",
      "",
      `Titulo: ${product.title}`,
      `Preco: ${formatCurrencyBRL(product.price)}`,
      "",
      existingProduct
        ? "Este produto ja existe. Deseja atualizar os dados?"
        : "Deseja cadastrar este produto?",
    ].join("\n"),
    cards: [
      {
        id: createCardId("product-preview"),
        title: product.title,
        description: product.seller ? `Loja: ${product.seller}` : "Mercado Livre",
        imageUrl: product.image || undefined,
        fields: [
          {
            label: "Preco",
            value: formatCurrencyBRL(product.price),
          },
          {
            label: "Link original",
            value: product.canonicalLink ?? product.link,
          },
        ],
      },
    ],
    workflow: {
      type: "product-import",
      stage: "confirm",
      sourceUrl: url,
    },
    actions: buildQuickActions([
      {
        id: "confirm-product-import",
        label: existingProduct ? "Atualizar produto" : "Cadastrar produto",
        kind: "submit",
        value: existingProduct ? "Atualizar produto" : "Cadastrar produto",
      },
      {
        id: "cancel-workflow",
        label: "Cancelar",
        kind: "submit",
        value: "Cancelar",
      },
    ]),
  } satisfies AssistantResponsePayload;
}

async function buildProductsListResponse(query?: string) {
  const products = searchProductsByQuery(await listProducts(), query ?? "");
  if (products.length === 0) {
    return {
      message: query
        ? `Nenhum produto encontrado para "${query}".`
        : "Voce ainda nao possui produtos cadastrados.",
      actions: buildQuickActions([
        {
          id: "goto-products",
          label: "Abrir produtos",
          kind: "navigate",
          href: "/produtos",
        },
        {
          id: "quick-product",
          label: "Cadastrar produto",
          kind: "submit",
          value: "Cadastrar produto",
        },
      ]),
    } satisfies AssistantResponsePayload;
  }

  return {
    message: query
      ? `Produtos encontrados para "${query}":`
      : `Voce possui ${products.length} produto(s) cadastrados.`,
    cards: buildProductCards(products),
    actions: buildQuickActions([
      {
        id: "goto-products",
        label: "Abrir produtos",
        kind: "navigate",
        href: "/produtos",
      },
    ]),
  } satisfies AssistantResponsePayload;
}

async function buildRecipientsListResponse(query?: string) {
  const recipients = await listRecipients();
  const filteredRecipients = query
    ? recipients.filter((recipient) => matchesRecipientSearch(recipient, query))
    : recipients;

  if (filteredRecipients.length === 0) {
    return {
      message: query
        ? `Nenhum contato encontrado para "${query}".`
        : "Voce ainda nao possui contatos cadastrados.",
      actions: buildQuickActions([
        {
          id: "goto-contacts",
          label: "Abrir contatos",
          kind: "navigate",
          href: "/contatos",
        },
        {
          id: "quick-contact",
          label: "Adicionar contato",
          kind: "submit",
          value: "Adicionar contato",
        },
      ]),
    } satisfies AssistantResponsePayload;
  }

  return {
    message: query
      ? `Contatos encontrados para "${query}":`
      : `Voce possui ${filteredRecipients.length} contato(s) cadastrados.`,
    cards: buildRecipientCards(filteredRecipients),
    actions: buildQuickActions([
      {
        id: "goto-contacts",
        label: "Abrir contatos",
        kind: "navigate",
        href: "/contatos",
      },
    ]),
  } satisfies AssistantResponsePayload;
}

async function buildCampaignsResponse(query?: string) {
  const campaigns = searchCampaignsByQuery(await listCampaigns(), query ?? "");
  if (campaigns.length === 0) {
    return {
      message: query
        ? `Nenhuma campanha encontrada para "${query}".`
        : "Voce ainda nao possui campanhas cadastradas.",
      actions: buildQuickActions([
        {
          id: "goto-campaigns",
          label: "Abrir campanhas",
          kind: "navigate",
          href: "/campanhas",
        },
        {
          id: "quick-campaign",
          label: "Criar campanha",
          kind: "submit",
          value: "Criar campanha",
        },
      ]),
    } satisfies AssistantResponsePayload;
  }

  return {
    message: query
      ? `Campanhas encontradas para "${query}":`
      : `Voce possui ${campaigns.length} campanha(s) cadastradas.`,
    cards: buildCampaignCards(campaigns),
    actions: buildQuickActions([
      {
        id: "goto-campaigns",
        label: "Abrir campanhas",
        kind: "navigate",
        href: "/campanhas",
      },
    ]),
  } satisfies AssistantResponsePayload;
}

function buildHelpResponse() {
  return {
    message: [
      "Posso entender estes comandos:",
      "",
      "cadastrar produto",
      "enviar link",
      "listar produtos",
      "buscar produto {nome}",
      "criar campanha",
      "listar campanhas",
      "ver contatos",
      "adicionar contato",
      "ver resultados",
      "resumo da conta",
    ].join("\n"),
    actions: buildDefaultAssistantActions(),
  } satisfies AssistantResponsePayload;
}

export async function buildInitialAssistantResponse(user: AuthenticatedUser) {
  const { summary } = await loadAssistantSummary();

  return {
    message: buildWelcomeMessage(user, summary),
    summary,
    actions: buildQuickActions([
      ...buildDefaultAssistantActions(),
      {
        id: "goto-dashboard",
        label: "Abrir dashboard",
        kind: "navigate",
        href: "/dashboard",
      },
    ]),
  } satisfies AssistantResponsePayload;
}

export async function handleAssistantRequest(args: {
  user: AuthenticatedUser;
  message?: string;
  actionId?: string;
  workflow?: AssistantWorkflow | null;
}) {
  const message = normalizeText(args.message);
  const normalizedMessage = normalizeSearchText(message);
  const actionId = normalizeText(args.actionId);

  if (args.workflow) {
    try {
      const workflowResponse = await handleWorkflowMessage({
        message,
        actionId,
        workflow: args.workflow,
      });

      const { summary } = await loadAssistantSummary();
      return {
        ...workflowResponse,
        summary,
      } satisfies AssistantResponsePayload;
    } catch (error) {
      const { summary } = await loadAssistantSummary();
      return {
        message:
          error instanceof Error
            ? error.message
            : "Nao foi possivel concluir o fluxo solicitado.",
        summary,
        workflow: args.workflow,
      } satisfies AssistantResponsePayload;
    }
  }

  if (!message && !actionId) {
    return buildInitialAssistantResponse(args.user);
  }

  if (
    normalizedMessage.includes("ativar conta") ||
    normalizedMessage.includes("primeiro acesso")
  ) {
    const { summary } = await loadAssistantSummary();
    return {
      message: buildWelcomeMessage(args.user, summary),
      summary,
      actions: buildDefaultAssistantActions(),
    } satisfies AssistantResponsePayload;
  }

  const mercadoLivreUrl = extractMercadoLivreUrl(message);
  if (mercadoLivreUrl) {
    try {
      const response = await buildProductPreviewResponse(mercadoLivreUrl);
      const { summary } = await loadAssistantSummary();
      return {
        ...response,
        summary,
      } satisfies AssistantResponsePayload;
    } catch (error) {
      const { summary } = await loadAssistantSummary();
      return {
        message:
          error instanceof Error
            ? error.message
            : "Nao foi possivel identificar o produto pelo link enviado.",
        summary,
        actions: buildQuickActions([
          {
            id: "goto-products",
            label: "Abrir produtos",
            kind: "navigate",
            href: "/produtos",
          },
        ]),
      } satisfies AssistantResponsePayload;
    }
  }

  if (
    normalizedMessage === "resumo da conta" ||
    normalizedMessage === "ver resultados" ||
    normalizedMessage === "resumo" ||
    normalizedMessage.includes("resultado")
  ) {
    const { summary } = await loadAssistantSummary();
    return {
      message: buildSummaryMessage(summary),
      summary,
      actions: buildQuickActions([
        {
          id: "goto-dashboard",
          label: "Abrir dashboard",
          kind: "navigate",
          href: "/dashboard",
        },
        {
          id: "goto-campaigns",
          label: "Abrir campanhas",
          kind: "navigate",
          href: "/campanhas",
        },
      ]),
    } satisfies AssistantResponsePayload;
  }

  if (normalizedMessage.includes("quantos contatos")) {
    const { summary } = await loadAssistantSummary();
    return {
      message: `Voce possui ${summary.contactsCount} contato(s) cadastrados.`,
      summary,
      actions: buildQuickActions([
        {
          id: "goto-contacts",
          label: "Abrir contatos",
          kind: "navigate",
          href: "/contatos",
        },
      ]),
    } satisfies AssistantResponsePayload;
  }

  if (normalizedMessage.includes("quantos produtos")) {
    const { summary } = await loadAssistantSummary();
    return {
      message: `Voce possui ${summary.productsCount} produto(s) cadastrados.`,
      summary,
      actions: buildQuickActions([
        {
          id: "goto-products",
          label: "Abrir produtos",
          kind: "navigate",
          href: "/produtos",
        },
      ]),
    } satisfies AssistantResponsePayload;
  }

  if (
    normalizedMessage.includes("campanha ativa") ||
    normalizedMessage.includes("campanhas ativas")
  ) {
    const { summary } = await loadAssistantSummary();
    return {
      message: `Voce possui ${summary.activeCampaignsCount} campanha(s) ativa(s).`,
      summary,
      actions: buildQuickActions([
        {
          id: "goto-campaigns",
          label: "Abrir campanhas",
          kind: "navigate",
          href: "/campanhas",
        },
      ]),
    } satisfies AssistantResponsePayload;
  }

  if (normalizedMessage === "listar produtos" || normalizedMessage === "ver produtos") {
    const response = await buildProductsListResponse();
    const { summary } = await loadAssistantSummary();
    return { ...response, summary } satisfies AssistantResponsePayload;
  }

  if (normalizedMessage.startsWith("buscar produto")) {
    const query = message.replace(/buscar produto/gi, "").trim();
    if (!query) {
      return {
        message: "Digite o termo que deseja buscar. Exemplo: buscar produto meia",
        actions: buildQuickActions([
          {
            id: "quick-products",
            label: "Listar produtos",
            kind: "submit",
            value: "Listar produtos",
          },
        ]),
      } satisfies AssistantResponsePayload;
    }

    const response = await buildProductsListResponse(query);
    const { summary } = await loadAssistantSummary();
    return { ...response, summary } satisfies AssistantResponsePayload;
  }

  if (normalizedMessage === "ver contatos" || normalizedMessage === "listar contatos") {
    const response = await buildRecipientsListResponse();
    const { summary } = await loadAssistantSummary();
    return { ...response, summary } satisfies AssistantResponsePayload;
  }

  if (normalizedMessage.startsWith("buscar contato")) {
    const query = message.replace(/buscar contato/gi, "").trim();
    if (!query) {
      return {
        message: "Digite o nome, telefone ou tag que deseja buscar.",
      } satisfies AssistantResponsePayload;
    }

    const response = await buildRecipientsListResponse(query);
    const { summary } = await loadAssistantSummary();
    return { ...response, summary } satisfies AssistantResponsePayload;
  }

  if (normalizedMessage.includes("importar contatos")) {
    return {
      message: "A importacao em massa de contatos pode ser feita na tela de contatos via CSV. Se quiser cadastrar um contato agora, posso guiar voce aqui mesmo.",
      actions: buildQuickActions([
        {
          id: "goto-contacts",
          label: "Abrir contatos",
          kind: "navigate",
          href: "/contatos",
        },
        {
          id: "quick-contact",
          label: "Adicionar contato",
          kind: "submit",
          value: "Adicionar contato",
        },
      ]),
    } satisfies AssistantResponsePayload;
  }

  if (normalizedMessage.startsWith("adicionar contato")) {
    const inlineContact = parseInlineContact(message);
    if (inlineContact) {
      try {
        const recipient = await createRecipientRecord({
          type: "contact",
          name: inlineContact.name,
          phone: inlineContact.phone,
        });
        const { summary } = await loadAssistantSummary();
        return {
          message: `Contato ${recipient.name} cadastrado com sucesso.`,
          summary,
          cards: buildRecipientCards([recipient]),
          actions: buildQuickActions([
            {
              id: "goto-contacts",
              label: "Abrir contatos",
              kind: "navigate",
              href: "/contatos",
            },
          ]),
        } satisfies AssistantResponsePayload;
      } catch (error) {
        return {
          message:
            error instanceof Error
              ? error.message
              : "Nao foi possivel cadastrar o contato informado.",
        } satisfies AssistantResponsePayload;
      }
    }

    return {
      message: "Digite o nome do contato que deseja cadastrar.",
      workflow: {
        type: "contact-create",
        stage: "await-name",
      },
      actions: buildQuickActions([
        {
          id: "cancel-workflow",
          label: "Cancelar",
          kind: "submit",
          value: "Cancelar",
        },
      ]),
    } satisfies AssistantResponsePayload;
  }

  if (normalizedMessage === "listar campanhas" || normalizedMessage === "ver campanhas") {
    const response = await buildCampaignsResponse();
    const { summary } = await loadAssistantSummary();
    return { ...response, summary } satisfies AssistantResponsePayload;
  }

  if (normalizedMessage.startsWith("buscar campanha")) {
    const query = message.replace(/buscar campanha/gi, "").trim();
    if (!query) {
      return {
        message: "Digite o nome ou o produto da campanha que deseja buscar.",
      } satisfies AssistantResponsePayload;
    }

    const response = await buildCampaignsResponse(query);
    const { summary } = await loadAssistantSummary();
    return { ...response, summary } satisfies AssistantResponsePayload;
  }

  if (normalizedMessage.includes("criar campanha")) {
    const { summary } = await loadAssistantSummary();
    return {
      message: "Vamos criar uma campanha.\n\nEscolha o produto que deseja divulgar.",
      summary,
      workflow: {
        type: "campaign-create",
        stage: "select-product",
      },
      actions: buildQuickActions([
        {
          id: "goto-products",
          label: "Abrir produtos",
          kind: "navigate",
          href: "/produtos",
        },
        {
          id: "cancel-workflow",
          label: "Cancelar",
          kind: "submit",
          value: "Cancelar",
        },
      ]),
    } satisfies AssistantResponsePayload;
  }

  if (normalizedMessage === "cadastrar produto" || normalizedMessage === "enviar link") {
    return {
      message: "Envie o link do produto do Mercado Livre e eu preparo a importacao para confirmacao.",
      actions: buildQuickActions([
        {
          id: "goto-products",
          label: "Abrir produtos",
          kind: "navigate",
          href: "/produtos",
        },
      ]),
    } satisfies AssistantResponsePayload;
  }

  return buildHelpResponse();
}
