import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, getClientId } from "@/lib/whatsapp/requestGuards";
import { isValidPhoneNumber, normalizePhoneNumber } from "@/lib/whatsapp/phone";
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
    key: `whatsapp:pair:${clientId}`,
    limit: 10,
    windowMs: 60_000,
  });

  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Muitas tentativas de pareamento. Aguarde e tente novamente." },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  const body = (await request.json().catch(() => null)) as { phone?: string } | null;
  const phone = normalizePhoneNumber(body?.phone ?? "");

  if (!isValidPhoneNumber(phone)) {
    return NextResponse.json(
      { error: "Numero invalido. Use o formato com DDI e DDD." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const { status, payload } = await callWhatsappService({
      method: "POST",
      path: "/pair",
      body: { phone },
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
