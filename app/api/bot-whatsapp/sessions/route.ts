import { NextRequest, NextResponse } from "next/server";
import {
  BotWhatsappNotFoundError,
  BotWhatsappValidationError,
  updateBotSessionState,
} from "@/lib/botWhatsapp/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

type SessionBody = {
  phone?: string;
  botActive?: boolean;
  linkedCampaignId?: string | null;
};

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as SessionBody | null;
  const phone = (body?.phone ?? "").trim();

  if (!phone) {
    return NextResponse.json(
      { error: "Telefone da conversa e obrigatorio." },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  try {
    const updatedSession = await updateBotSessionState({
      phone,
      botActive:
        typeof body?.botActive === "boolean" ? body.botActive : undefined,
      linkedCampaignId:
        body && "linkedCampaignId" in body ? body.linkedCampaignId ?? null : undefined,
    });

    return NextResponse.json(updatedSession, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const status =
      error instanceof BotWhatsappValidationError
        ? 400
        : error instanceof BotWhatsappNotFoundError
          ? 404
          : 500;

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel atualizar a conversa do bot.",
      },
      {
        status,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
