import { NextRequest, NextResponse } from "next/server";
import {
  enforceRateLimit,
  enforceSendCooldown,
  getClientId,
} from "@/lib/whatsapp/requestGuards";
import { isValidPhoneNumber, normalizePhoneNumber } from "@/lib/whatsapp/phone";
import {
  callWhatsappService,
  ensureJsonObject,
  NO_STORE_HEADERS,
  whatsappServiceUnavailableResponse,
} from "@/lib/whatsapp/serviceProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SendBody = {
  number?: string;
  message?: string;
  imageUrl?: string;
};

function isValidImageUrl(value: string | undefined) {
  const url = String(value ?? "").trim();
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const clientId = getClientId(request);
  const rate = enforceRateLimit({
    key: `whatsapp:send:${clientId}`,
    limit: 25,
    windowMs: 60_000,
  });

  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Limite de envio atingido. Aguarde para tentar novamente." },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  const body = (await request.json().catch(() => null)) as SendBody | null;
  const number = normalizePhoneNumber(body?.number ?? "");
  const message = (body?.message ?? "").trim();
  const imageUrl = isValidImageUrl(body?.imageUrl) ? String(body?.imageUrl).trim() : undefined;

  if (!isValidPhoneNumber(number)) {
    return NextResponse.json(
      { error: "Numero invalido para envio." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (message.length === 0 || message.length > 1000) {
    return NextResponse.json(
      { error: "Mensagem obrigatoria e deve ter no maximo 1000 caracteres." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const cooldown = enforceSendCooldown({
    key: `${clientId}:${number}`,
    minIntervalMs: 3000,
  });

  if (!cooldown.allowed) {
    return NextResponse.json(
      { error: "Envio muito rapido. Aguarde alguns segundos e tente novamente." },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const { status, payload } = await callWhatsappService({
      method: "POST",
      path: "/send",
      body: { number, message, imageUrl },
      headers: {
        "x-zapmarket-client-id": clientId,
      },
    });

    return NextResponse.json(ensureJsonObject(payload), {
      status,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return whatsappServiceUnavailableResponse(error);
  }
}
