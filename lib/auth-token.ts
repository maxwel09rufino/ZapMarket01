import { SignJWT, jwtVerify } from "jose";

export const AUTH_COOKIE_NAME = "zapmarket.session";
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
export const DEFAULT_POST_LOGIN_PATH = "/dashboard";

export type SessionTokenUser = {
  userId: string;
  name: string;
  email: string;
};

type SessionTokenPayload = {
  email: string;
  name: string;
  typ: "zapmarket-session";
};

const AUTH_TOKEN_ISSUER = "zapmarket-automation";
const AUTH_TOKEN_AUDIENCE = "zapmarket-dashboard";
const DEVELOPMENT_AUTH_SECRET = "zapmarket-dev-auth-secret-change-me";

function getAuthSecret() {
  const configuredSecret = String(
    process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "",
  ).trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV !== "production") {
    return DEVELOPMENT_AUTH_SECRET;
  }

  throw new Error("AUTH_SECRET nao configurado.");
}

function getAuthSecretKey() {
  return new TextEncoder().encode(getAuthSecret());
}

export async function issueSessionToken(user: SessionTokenUser) {
  return new SignJWT({
    email: user.email,
    name: user.name,
    typ: "zapmarket-session",
  } satisfies SessionTokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.userId)
    .setIssuer(AUTH_TOKEN_ISSUER)
    .setAudience(AUTH_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${AUTH_COOKIE_MAX_AGE_SECONDS}s`)
    .sign(getAuthSecretKey());
}

export async function verifySessionToken(token: string) {
  const normalizedToken = String(token ?? "").trim();
  if (!normalizedToken) {
    return null;
  }

  try {
    const { payload } = await jwtVerify<SessionTokenPayload>(
      normalizedToken,
      getAuthSecretKey(),
      {
        issuer: AUTH_TOKEN_ISSUER,
        audience: AUTH_TOKEN_AUDIENCE,
      },
    );

    const userId = String(payload.sub ?? "").trim();
    const email = String(payload.email ?? "").trim().toLowerCase();
    const name = String(payload.name ?? "").trim();

    if (!userId || !email || !name || payload.typ !== "zapmarket-session") {
      return null;
    }

    return {
      userId,
      email,
      name,
    } satisfies SessionTokenUser;
  } catch {
    return null;
  }
}

export function resolveAuthCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
    priority: "high" as const,
  };
}

export function sanitizeNextPath(value: string | undefined | null) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return DEFAULT_POST_LOGIN_PATH;
  }

  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return DEFAULT_POST_LOGIN_PATH;
  }

  if (
    normalized.startsWith("/login") ||
    normalized.startsWith("/api/auth") ||
    normalized.startsWith("/_next")
  ) {
    return DEFAULT_POST_LOGIN_PATH;
  }

  return normalized;
}
