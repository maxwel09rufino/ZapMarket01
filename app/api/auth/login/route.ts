import { NextRequest, NextResponse } from "next/server";
import {
  authenticateUser,
  AuthAuthenticationError,
  AuthRateLimitError,
  AuthValidationError,
  resolveRequestIp,
  toSessionTokenUser,
} from "@/lib/auth";
import {
  AUTH_COOKIE_NAME,
  issueSessionToken,
  resolveAuthCookieOptions,
} from "@/lib/auth-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
};

type LoginBody = {
  identifier?: string;
  email?: string;
  password?: string;
};

function resolveError(error: unknown) {
  if (error instanceof AuthRateLimitError) {
    return {
      status: 429,
      message: error.message,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }

  if (error instanceof AuthValidationError || error instanceof AuthAuthenticationError) {
    return {
      status: 400,
      message: error.message,
    };
  }

  return {
    status: 500,
    message: "Nao foi possivel autenticar o usuario.",
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as LoginBody | null;
  const identifier = String(body?.identifier ?? body?.email ?? "").trim();
  const password = String(body?.password ?? "");

  try {
    const user = await authenticateUser({
      identifier,
      password,
      ipAddress: resolveRequestIp(request.headers),
    });
    const token = await issueSessionToken(toSessionTokenUser(user));

    const response = NextResponse.json(
      {
        authenticated: true,
        user,
      },
      {
        status: 200,
        headers: RESPONSE_HEADERS,
      },
    );

    response.cookies.set(AUTH_COOKIE_NAME, token, resolveAuthCookieOptions());
    return response;
  } catch (error) {
    const resolved = resolveError(error);
    return NextResponse.json(
      {
        authenticated: false,
        error: resolved.message,
      },
      {
        status: resolved.status,
        headers: {
          ...RESPONSE_HEADERS,
          ...(resolved.retryAfterSeconds
            ? { "Retry-After": String(resolved.retryAfterSeconds) }
            : {}),
        },
      },
    );
  }
}
