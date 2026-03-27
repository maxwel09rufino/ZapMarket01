import { NextRequest, NextResponse } from "next/server";
import type { AuthenticatedUser } from "@/lib/auth";
import { handleAssistantRequest } from "@/lib/assistant/engine";
import type {
  AssistantAction,
  AssistantCard,
  AssistantResponsePayload,
} from "@/lib/assistant/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WHATSAPP_REPLY_LENGTH = 950;
const ASSISTANT_SHORTCUT_REGEX = /^\/(resumo|cadastrar-produto|adicionar-contato|criar-campanha)\b\s*(.*)$/i;

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeSearchText(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function stripAssistantCommand(message: string) {
  return message
    .replace(/^[;\/!\.\-]+\s*(assistente|assitente)\b[\s:,-]*/i, "")
    .trim();
}

function buildAssistantUserEmail(id: string) {
  const localPart = normalizeText(id).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${localPart || "grupo-whatsapp"}@zapmarket.local`;
}

function truncateText(value: string, maxLength: number) {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}...`;
}

function formatCard(card: AssistantCard, index: number) {
  const lines = [`${index + 1}. ${truncateText(card.title, 120)}`];

  if (card.description) {
    lines.push(truncateText(card.description, 140));
  }

  for (const field of card.fields ?? []) {
    const label = truncateText(field.label, 30);
    const value = truncateText(field.value, 180);

    if (label && value) {
      lines.push(`${label}: ${value}`);
    }
  }

  return lines.join("\n");
}

function mapActionToWhatsappCommand(action: string) {
  const normalizedAction = normalizeSearchText(action);

  if (
    normalizedAction === "resumo da conta" ||
    normalizedAction === "resumo" ||
    normalizedAction === "ver resultados"
  ) {
    return "/resumo";
  }

  if (normalizedAction === "cadastrar produto") {
    return "/cadastrar-produto";
  }

  if (normalizedAction === "adicionar contato") {
    return "/adicionar-contato";
  }

  if (normalizedAction === "criar campanha") {
    return "/criar-campanha";
  }

  return `/assistente ${action}`;
}

function formatSubmitActions(actions: AssistantAction[] | undefined) {
  const submitActions = (actions ?? [])
    .filter((action) => action.kind === "submit")
    .map((action) => normalizeText(action.value || action.label))
    .filter(Boolean)
    .slice(0, 4);

  if (submitActions.length === 0) {
    return "";
  }

  return [
    "Sugestoes:",
    ...submitActions.map((action) => `- ${mapActionToWhatsappCommand(action)}`),
  ].join("\n");
}

function formatInitialAssistantMenu(userName: string) {
  const displayName = normalizeText(userName) || "Cliente";

  return [
    `🚀 Bem-vindo de volta, ${displayName}!`,
    "",
    "Seu assistente inteligente do ZapMarket está pronto para ajudar você a importar produtos, gerenciar contatos e criar campanhas de divulgação automaticamente.",
    "",
    "O que você deseja fazer agora?",
    "",
    "📊 Gestão da Conta",
    '1️⃣ "/resumo" — Ver resumo da sua conta e resultados',
    "",
    "🛍 Produtos",
    '2️⃣ "/cadastrar-produto" — Importar produto através do link',
    "",
    "👥 Contatos",
    '3️⃣ "/adicionar-contato" — Adicionar novo contato à lista',
    "",
    "📣 Campanhas",
    '4️⃣ "/criar-campanha" — Criar uma campanha guiada de divulgação',
    "",
    "💡 Dica: Basta enviar um dos comandos acima para começar.",
  ].join("\n");
}

function normalizeAssistantMessage(rawMessage: string) {
  const strippedMessage = stripAssistantCommand(rawMessage);
  const shortcutMatch = strippedMessage.match(ASSISTANT_SHORTCUT_REGEX);

  if (shortcutMatch) {
    const command = normalizeSearchText(shortcutMatch[1]);
    const argument = normalizeText(shortcutMatch[2]);

    if (command === "resumo") {
      return {
        message: "resumo da conta",
        isInitialMenu: false,
      };
    }

    if (command === "cadastrar-produto") {
      return {
        message: argument || "cadastrar produto",
        isInitialMenu: false,
      };
    }

    if (command === "adicionar-contato") {
      return {
        message: argument ? `adicionar contato ${argument}` : "adicionar contato",
        isInitialMenu: false,
      };
    }

    if (command === "criar-campanha") {
      return {
        message: "criar campanha",
        isInitialMenu: false,
      };
    }
  }

  return {
    message: strippedMessage,
    isInitialMenu: strippedMessage.length === 0,
  };
}

function composeWhatsappReply(response: AssistantResponsePayload) {
  const sections = [normalizeText(response.message)];
  const cards = response.cards ?? [];

  if (cards.length > 0) {
    sections.push(
      cards
        .slice(0, 3)
        .map((card, index) => formatCard(card, index))
        .join("\n\n"),
    );
  }

  const suggestions = formatSubmitActions(response.actions);
  if (suggestions) {
    sections.push(suggestions);
  }

  const reply = sections.filter(Boolean).join("\n\n");
  return truncateText(reply || "Sem resposta do assistente.", MAX_WHATSAPP_REPLY_LENGTH);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const remoteJid = normalizeText(body?.remoteJid ?? body?.groupId);
    const senderId = normalizeText(body?.senderId);
    const senderName = normalizeText(body?.senderName);
    const rawMessage = normalizeText(body?.message);

    if (!remoteJid || !rawMessage) {
      return NextResponse.json({ error: "Dados obrigatórios ausentes." }, { status: 400 });
    }

    const user: AuthenticatedUser = {
      id: senderId || remoteJid,
      name: senderName || "Grupo WhatsApp",
      email: buildAssistantUserEmail(senderId || remoteJid),
      plan: "WhatsApp",
      createdAt: new Date().toISOString(),
    };

    const assistantInput = normalizeAssistantMessage(rawMessage);
    const response = await handleAssistantRequest({ user, message: assistantInput.message });
    const reply = assistantInput.isInitialMenu
      ? formatInitialAssistantMenu(user.name)
      : composeWhatsappReply(response);

    return NextResponse.json({ ok: true, reply });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
