import { NextRequest, NextResponse } from "next/server";
import {
  BotWhatsappValidationError,
  listBotMessagesByPhone,
} from "@/lib/botWhatsapp/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

export async function GET(request: NextRequest) {
  const phone = request.nextUrl.searchParams.get("phone") ?? "";
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 120);

  try {
    const messages = await listBotMessagesByPhone(phone, limit);
    return NextResponse.json(messages, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const status = error instanceof BotWhatsappValidationError ? 400 : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel carregar as mensagens da conversa.",
      },
      {
        status,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
