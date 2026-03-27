import { NextResponse } from "next/server";

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

const WHATSAPP_SERVICE_ORIGIN =
  process.env.WHATSAPP_SERVICE_ORIGIN ?? "http://127.0.0.1:3001";
const WHATSAPP_PROXY_TIMEOUT_MS = Number(process.env.WHATSAPP_PROXY_TIMEOUT_MS ?? 20000);

type ServiceCallOptions = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

function buildServiceUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(normalizedPath, WHATSAPP_SERVICE_ORIGIN).toString();
}

export function ensureJsonObject(payload: unknown) {
  if (typeof payload === "object" && payload !== null) {
    return payload as Record<string, unknown>;
  }

  return { data: payload };
}

export async function callWhatsappService(options: ServiceCallOptions) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? WHATSAPP_PROXY_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildServiceUrl(options.path), {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : { error: await response.text().catch(() => "Resposta invalida do servico.") };

    return {
      status: response.status,
      payload,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function whatsappServiceUnavailableResponse(error: unknown) {
  return NextResponse.json(
    {
      error: "Servico local do WhatsApp indisponivel.",
      details: error instanceof Error ? error.message : String(error),
    },
    {
      status: 503,
      headers: NO_STORE_HEADERS,
    },
  );
}

// Envia mensagem para grupo ou contato via serviço local
export async function sendWhatsappMessage({ number, message }: { number: string; message: string }) {
  return callWhatsappService({
    method: "POST",
    path: "/send",
    body: { number, message },
  });
}
