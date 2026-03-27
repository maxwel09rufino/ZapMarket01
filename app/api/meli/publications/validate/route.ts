import { NextRequest, NextResponse } from "next/server";
import { validateMeliPublication } from "@/lib/meli/publications";
import type { MeliPublicationDraft } from "@/lib/meli/publications-client";
import { resolveMeliUserId } from "@/lib/meli/store";
import { NO_STORE_HEADERS, resolvePublicationError } from "@/app/api/meli/publications/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ValidateBody = {
  draft?: MeliPublicationDraft;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ValidateBody | null;
  const draft = body?.draft;

  if (!draft || typeof draft !== "object") {
    return NextResponse.json(
      { error: "draft e obrigatorio." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const userId = resolveMeliUserId(request.headers.get("x-user-id"));
    const response = await validateMeliPublication(draft, userId);

    return NextResponse.json(response, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const resolved = resolvePublicationError(error);

    return NextResponse.json(
      {
        valid: false,
        error: resolved.message,
        message: resolved.message,
        causes: "causes" in resolved ? resolved.causes : undefined,
      },
      { status: resolved.status, headers: NO_STORE_HEADERS },
    );
  }
}
