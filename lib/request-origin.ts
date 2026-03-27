import type { NextRequest } from "next/server";

function sanitizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function readForwardedHeader(value: string | null) {
  const normalized = sanitizeText(value);
  if (!normalized) {
    return "";
  }

  const [firstValue] = normalized.split(",");
  return sanitizeText(firstValue);
}

function sanitizeOriginCandidate(value: string | null | undefined) {
  const normalized = sanitizeText(value);
  if (!normalized) {
    return "";
  }

  try {
    const url = new URL(normalized);
    if (!url.protocol || !url.host) {
      return "";
    }

    return url.origin;
  } catch {
    return "";
  }
}

function isInternalHost(host: string) {
  const normalized = host.toLowerCase();
  return (
    !normalized ||
    normalized.startsWith("0.0.0.0") ||
    normalized.startsWith("127.0.0.1") ||
    normalized.startsWith("localhost")
  );
}

export function resolveRequestOrigin(request: NextRequest) {
  const configuredOrigin =
    sanitizeOriginCandidate(process.env.NEXT_PUBLIC_APP_URL) ||
    sanitizeOriginCandidate(process.env.APP_URL);

  if (configuredOrigin) {
    return configuredOrigin;
  }

  const forwardedHost = readForwardedHeader(request.headers.get("x-forwarded-host"));
  const forwardedProto = readForwardedHeader(request.headers.get("x-forwarded-proto")) || "https";

  if (forwardedHost && !isInternalHost(forwardedHost)) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = sanitizeText(request.headers.get("host"));
  const fallbackOrigin = request.nextUrl.origin;
  if (host && !isInternalHost(host)) {
    const protocol = request.nextUrl.protocol || "https:";
    return `${protocol}//${host}`;
  }

  return fallbackOrigin;
}
