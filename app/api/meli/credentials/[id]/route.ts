import { NextRequest, NextResponse } from "next/server";
import {
  deleteMeliCredential,
  MeliCredentialNotFoundError,
  MeliCredentialValidationError,
  resolveMeliUserId,
} from "@/lib/meli/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

function resolveError(error: unknown) {
  if (
    error instanceof MeliCredentialNotFoundError ||
    error instanceof MeliCredentialValidationError
  ) {
    return {
      status: error instanceof MeliCredentialNotFoundError ? 404 : 400,
      message: error.message,
    };
  }

  return {
    status: 500,
    message: "Nao foi possivel remover a credencial do Mercado Livre.",
  };
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext<"/api/meli/credentials/[id]">,
) {
  try {
    const userId = resolveMeliUserId(request.headers.get("x-user-id"));
    const { id } = await context.params;

    await deleteMeliCredential(id, userId);

    return NextResponse.json(
      { success: true },
      {
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    const resolved = resolveError(error);
    return NextResponse.json(
      { error: resolved.message },
      { status: resolved.status, headers: NO_STORE_HEADERS },
    );
  }
}
