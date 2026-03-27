import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, getClientId } from "@/lib/whatsapp/requestGuards";
import {
  callWhatsappService,
  ensureJsonObject,
  NO_STORE_HEADERS,
  whatsappServiceUnavailableResponse,
} from "@/lib/whatsapp/serviceProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const clientId = getClientId(request);
  const rate = enforceRateLimit({
    key: `whatsapp:clear-session:${clientId}`,
    limit: 5,
    windowMs: 60_000,
  });

  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Muitas tentativas de limpar sessao. Aguarde e tente novamente." },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const { status, payload } = await callWhatsappService({
      method: "POST",
      path: "/clear-session",
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
