import { NextResponse } from "next/server";
import {
  callWhatsappService,
  ensureJsonObject,
  NO_STORE_HEADERS,
  whatsappServiceUnavailableResponse,
} from "@/lib/whatsapp/serviceProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { status, payload } = await callWhatsappService({
      method: "GET",
      path: "/status",
    });

    return NextResponse.json(ensureJsonObject(payload), {
      status,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return whatsappServiceUnavailableResponse(error);
  }
}
