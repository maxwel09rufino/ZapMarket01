import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
};

export async function POST() {
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
