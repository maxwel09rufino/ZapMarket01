import { NextRequest, NextResponse } from "next/server";
import {
  AuthConflictError,
  AuthValidationError,
  createUserAccount,
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

type RegisterBody = {
  name?: string;
  email?: string;
  password?: string;
};

function resolveError(error: unknown) {
  if (error instanceof AuthConflictError) {
    return {
      status: 409,
      message: error.message,
    };
  }

  if (error instanceof AuthValidationError) {
    return {
      status: 400,
      message: error.message,
    };
  }

  return {
    status: 500,
    message: "Nao foi possivel criar a conta.",
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RegisterBody | null;
  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim();
  const password = String(body?.password ?? "");

  try {
    const user = await createUserAccount({
      name,
      email,
      password,
    });
    const token = await issueSessionToken(toSessionTokenUser(user));

    const response = NextResponse.json(
      {
        authenticated: true,
        user,
      },
      {
        status: 201,
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
        headers: RESPONSE_HEADERS,
      },
    );
  }
}
