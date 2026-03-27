import { NextRequest, NextResponse } from "next/server";
import { prepareMeliPublication } from "@/lib/meli/publications";
import { resolveMeliUserId } from "@/lib/meli/store";
import { NO_STORE_HEADERS, resolvePublicationError } from "@/app/api/meli/publications/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PrepareBody = {
  productId?: string;
  categoryId?: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as PrepareBody | null;
  const productId = (body?.productId ?? "").trim();
  const categoryId = (body?.categoryId ?? "").trim();

  if (!productId) {
    return NextResponse.json(
      { error: "productId e obrigatorio." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const userId = resolveMeliUserId(request.headers.get("x-user-id"));
    const response = await prepareMeliPublication(productId, userId, categoryId || undefined);

    return NextResponse.json(response, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const resolved = resolvePublicationError(error);

    return NextResponse.json(
      {
        error: resolved.message,
        causes: "causes" in resolved ? resolved.causes : undefined,
      },
      { status: resolved.status, headers: NO_STORE_HEADERS },
    );
  }
}
