import { getProductsCount } from "@/lib/products/store";
import { getRecipientsCount } from "@/lib/recipients/store";

export type ConnectionStatus = "connected" | "disconnected";

export type DashboardOverview = {
  metrics: {
    messagesSent: number;
    activeCampaigns: number;
    totalContacts: number;
    registeredProducts: number;
  };
  recentCampaigns: Array<{
    id: string;
    name: string;
    sentMessages: number;
    status: "draft" | "active" | "paused";
    createdAt: string;
  }>;
  systemStatus: {
    whatsappApi: ConnectionStatus;
  };
  lastUpdatedAt: string;
};

const WHATSAPP_SERVICE_ORIGIN =
  process.env.WHATSAPP_SERVICE_ORIGIN ?? "http://127.0.0.1:3001";
const WHATSAPP_STATUS_TIMEOUT_MS = Number(process.env.WHATSAPP_STATUS_TIMEOUT_MS ?? 5000);

async function getWhatsappConnectionStatus(): Promise<ConnectionStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WHATSAPP_STATUS_TIMEOUT_MS);

  try {
    const response = await fetch(new URL("/status", WHATSAPP_SERVICE_ORIGIN), {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return "disconnected";
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          connected?: boolean;
          state?: string;
        }
      | null;

    const isConnected = payload?.connected === true || payload?.state === "connected";
    return isConnected ? "connected" : "disconnected";
  } catch {
    return "disconnected";
  } finally {
    clearTimeout(timeout);
  }
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const whatsappApi = await getWhatsappConnectionStatus();
  const registeredProducts = await getProductsCount().catch(() => 0);
  const totalContacts = await getRecipientsCount().catch(() => 0);

  return {
    metrics: {
      messagesSent: 0,
      activeCampaigns: 0,
      totalContacts,
      registeredProducts,
    },
    recentCampaigns: [],
    systemStatus: {
      whatsappApi,
    },
    lastUpdatedAt: new Date().toISOString(),
  };
}

export async function getMockDashboardOverview(): Promise<DashboardOverview> {
  return getDashboardOverview();
}
