import {
  callWhatsappService,
  ensureJsonObject,
} from "@/lib/whatsapp/serviceProxy";

type WhatsappStatus = {
  connected: boolean;
  state: string;
};

type SendCampaignMessageInput = {
  recipientType: "contact" | "group" | "channel";
  target: string;
  message: string;
  imageUrl?: string;
};

type ChannelAccessResult = {
  jid: string | null;
  role: string | null;
  canSend: boolean;
  name: string | null;
};

type SendCampaignMessageResult = {
  jid: string | null;
  messageId: string | null;
  usedImage: boolean;
  deliveryStatus: "sent" | "submitted";
};

export async function getWhatsappConnectionStatus() {
  const { status, payload } = await callWhatsappService({
    method: "GET",
    path: "/status",
  });

  const data = ensureJsonObject(payload) as Partial<WhatsappStatus> & {
    error?: string;
  };

  if (status < 200 || status >= 300) {
    throw new Error(data.error ?? "Nao foi possivel consultar o status do WhatsApp.");
  }

  return {
    connected: Boolean(data.connected),
    state: typeof data.state === "string" ? data.state : "unknown",
  };
}

export async function getChannelSendAccess(target: string): Promise<ChannelAccessResult> {
  const { status, payload } = await callWhatsappService({
    method: "POST",
    path: "/channel-access",
    body: {
      target,
    },
    timeoutMs: 30000,
  });

  const data = ensureJsonObject(payload) as {
    ok?: boolean;
    jid?: string | null;
    role?: string | null;
    canSend?: boolean;
    name?: string | null;
    error?: string;
  };

  if (status < 200 || status >= 300 || !data.ok) {
    throw new Error(data.error ?? "Nao foi possivel validar o canal informado.");
  }

  return {
    jid: data.jid ?? null,
    role: typeof data.role === "string" ? data.role : null,
    canSend: Boolean(data.canSend),
    name: typeof data.name === "string" ? data.name : null,
  };
}

export async function sendCampaignWhatsappMessage(
  input: SendCampaignMessageInput,
): Promise<SendCampaignMessageResult> {
  const { status, payload } = await callWhatsappService({
    method: "POST",
    path: "/send",
    body: {
      recipientType: input.recipientType,
      target: input.target,
      message: input.message,
      imageUrl: input.imageUrl,
    },
    timeoutMs: 30000,
  });

  const data = ensureJsonObject(payload) as {
    sent?: boolean;
    jid?: string | null;
    messageId?: string | null;
    usedImage?: boolean;
    deliveryStatus?: "sent" | "submitted" | null;
    error?: string;
  };

  if (status < 200 || status >= 300 || !data.sent) {
    throw new Error(data.error ?? "Falha ao enviar mensagem pelo WhatsApp.");
  }

  const fallbackDeliveryStatus = input.recipientType === "channel" ? "submitted" : "sent";

  return {
    jid: data.jid ?? null,
    messageId: data.messageId ?? null,
    usedImage: Boolean(data.usedImage),
    deliveryStatus:
      data.deliveryStatus === "submitted" || data.deliveryStatus === "sent"
        ? data.deliveryStatus
        : fallbackDeliveryStatus,
  };
}
