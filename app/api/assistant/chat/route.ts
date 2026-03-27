import { NextRequest, NextResponse } from "next/server";
import { findAuthenticatedUserByToken } from "@/lib/auth";
import { buildInitialAssistantResponse, handleAssistantRequest } from "@/lib/assistant/engine";
import type { AssistantRequestPayload } from "@/lib/assistant/types";
import { AUTH_COOKIE_NAME } from "@/lib/auth-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

async function resolveAuthenticatedUser(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  return findAuthenticatedUserByToken(token);
}

export async function GET(request: NextRequest) {
  const user = await resolveAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json(
      {
        error: "Nao autenticado.",
      },
      {
        status: 401,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  try {
    const payload = await buildInitialAssistantResponse(user);
    return NextResponse.json(payload, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Falha ao carregar o assistente.",
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await resolveAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json(
      {
        error: "Nao autenticado.",
      },
      {
        status: 401,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  const body = (await request.json().catch(() => null)) as AssistantRequestPayload | null;

  try {
    const payload = await handleAssistantRequest({
      user,
      message: body?.message,
      actionId: body?.actionId,
      workflow: body?.workflow ?? null,
    });

    return NextResponse.json(payload, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Nao foi possivel processar o comando do assistente.",
        workflow: body?.workflow ?? null,
      },
      {
        status: 200,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
