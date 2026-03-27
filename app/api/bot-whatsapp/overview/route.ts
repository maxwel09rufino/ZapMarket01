import { NextResponse } from "next/server";
import {
  ensureJsonObject,
  callWhatsappService,
} from "@/lib/whatsapp/serviceProxy";
import { getBotWhatsappOverview } from "@/lib/botWhatsapp/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

async function getServiceStatus() {
  try {
    const { status, payload } = await callWhatsappService({
      method: "GET",
      path: "/status",
    });

    const data = ensureJsonObject(payload) as {
      connected?: boolean;
      state?: string;
      qrAvailable?: boolean;
      lastPairingCode?: string | null;
      lastPairingCodeAt?: string | null;
      reconnectAttempts?: number;
      maxReconnectAttempts?: number;
      error?: string;
    };

    return {
      available: status >= 200 && status < 500,
      connected: Boolean(data.connected),
      state: typeof data.state === "string" ? data.state : "unknown",
      qrAvailable: Boolean(data.qrAvailable),
      lastPairingCode:
        typeof data.lastPairingCode === "string" ? data.lastPairingCode : null,
      lastPairingCodeAt:
        typeof data.lastPairingCodeAt === "string" ? data.lastPairingCodeAt : null,
      reconnectAttempts:
        typeof data.reconnectAttempts === "number" ? data.reconnectAttempts : 0,
      maxReconnectAttempts:
        typeof data.maxReconnectAttempts === "number" ? data.maxReconnectAttempts : 0,
      error:
        status >= 400 ? data.error ?? "Servico local do WhatsApp indisponivel." : undefined,
    };
  } catch (error) {
    return {
      available: false,
      connected: false,
      state: "offline",
      qrAvailable: false,
      lastPairingCode: null,
      lastPairingCodeAt: null,
      reconnectAttempts: 0,
      maxReconnectAttempts: 0,
      error: error instanceof Error ? error.message : "Servico local do WhatsApp indisponivel.",
    };
  }
}

export async function GET() {
  try {
    const [overview, serviceStatus] = await Promise.all([
      getBotWhatsappOverview(),
      getServiceStatus(),
    ]);

    return NextResponse.json(
      {
        ...overview,
        serviceStatus,
      },
      {
        status: 200,
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel carregar o painel do bot.",
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
