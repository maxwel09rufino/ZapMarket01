import { NextRequest, NextResponse } from "next/server";
import { findAuthenticatedUserByToken } from "@/lib/auth";
import { AUTH_COOKIE_NAME } from "@/lib/auth-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
};

export async function GET(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json(
      {
        authenticated: false,
      },
      {
        status: 200,
        headers: RESPONSE_HEADERS,
      },
    );
  }

  const user = await findAuthenticatedUserByToken(token);
  if (!user) {
    const response = NextResponse.json(
      {
        authenticated: false,
      },
      {
        status: 200,
        headers: RESPONSE_HEADERS,
      },
    );
    response.cookies.delete(AUTH_COOKIE_NAME);
    return response;
  }

  return NextResponse.json(
    {
      authenticated: true,
      user,
    },
    {
      status: 200,
      headers: RESPONSE_HEADERS,
    },
  );
}
