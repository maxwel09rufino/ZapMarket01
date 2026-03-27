import type { NextRequest } from "next/server";

type RateEntry = {
  count: number;
  resetAt: number;
};

type CooldownEntry = {
  lastSentAt: number;
};

type GuardStore = {
  rateLimit: Map<string, RateEntry>;
  sendCooldown: Map<string, CooldownEntry>;
};

declare global {
  var __zapmarket_whatsapp_guard_store__: GuardStore | undefined;
}

const store =
  globalThis.__zapmarket_whatsapp_guard_store__ ?? {
    rateLimit: new Map<string, RateEntry>(),
    sendCooldown: new Map<string, CooldownEntry>(),
  };

if (process.env.NODE_ENV !== "production") {
  globalThis.__zapmarket_whatsapp_guard_store__ = store;
}

export function getClientId(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}

export function enforceRateLimit({
  key,
  limit,
  windowMs,
}: {
  key: string;
  limit: number;
  windowMs: number;
}) {
  const now = Date.now();
  const entry = store.rateLimit.get(key);

  if (!entry || now > entry.resetAt) {
    store.rateLimit.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return { allowed: true, remaining: limit - 1 };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  entry.count += 1;
  return { allowed: true, remaining: Math.max(0, limit - entry.count) };
}

export function enforceSendCooldown({
  key,
  minIntervalMs,
}: {
  key: string;
  minIntervalMs: number;
}) {
  const now = Date.now();
  const existing = store.sendCooldown.get(key);

  if (existing && now - existing.lastSentAt < minIntervalMs) {
    return { allowed: false };
  }

  store.sendCooldown.set(key, { lastSentAt: now });
  return { allowed: true };
}
