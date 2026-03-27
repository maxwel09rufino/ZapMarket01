import { NextRequest, NextResponse } from "next/server";
import { getClientId, enforceRateLimit } from "@/lib/whatsapp/requestGuards";
import {
  callWhatsappService,
  ensureJsonObject,
  NO_STORE_HEADERS,
  whatsappServiceUnavailableResponse,
} from "@/lib/whatsapp/serviceProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const clientId = getClientId(request);
  const rate = enforceRateLimit({
    key: `whatsapp:qr:${clientId}`,
    limit: 30,
    windowMs: 60_000,
  });

  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Muitas requisicoes para QR Code. Tente novamente em instantes." },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const { status, payload } = await callWhatsappService({
      method: "GET",
      path: "/qr",
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
