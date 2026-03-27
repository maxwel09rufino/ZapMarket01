import { NextRequest, NextResponse } from "next/server";
import {
  fetchMercadoLivreProductByHtml,
  ProductLookupError,
} from "@/lib/products/mercadoLivre";
import {
  buildMercadoLivreItemUrl,
  extractMercadoLivreItemId,
} from "@/lib/products/mercadoLivreLink";

function resolveLookupUrl(link: string | null, id: string | null) {
  if (id) {
    const normalizedId = extractMercadoLivreItemId(id);
    if (!normalizedId) {
      throw new ProductLookupError("ID do produto invalido.", 400);
    }

    return buildMercadoLivreItemUrl(normalizedId);
  }

  return String(link ?? "").trim();
}

/**
 * GET /api/productos/mercadolivre?link=https://...
 * Busca produto pelo link do Mercado Livre
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const link = searchParams.get("link");
    const id = searchParams.get("id");

    if (!link && !id) {
      return NextResponse.json(
        {
          error: true,
          code: "MISSING_PARAMS",
          message: "Forneça ?link=... ou ?id=...",
        },
        { status: 400 },
      );
    }

    const lookupUrl = resolveLookupUrl(link, id);
    const result = await fetchMercadoLivreProductByHtml(lookupUrl);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ProductLookupError) {
      return NextResponse.json(
        {
          error: true,
          code: "LOOKUP_ERROR",
          message: error.message,
        },
        { status: error.status },
      );
    }

    console.error("Erro em /api/productos/mercadolivre:", error);
    return NextResponse.json(
      {
        error: true,
        code: "SERVER_ERROR",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/productos/mercadolivre
 * Body: { link: "https://..." }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { link } = body;

    if (!link || !link.trim()) {
      return NextResponse.json(
        {
          error: true,
          code: "INVALID_LINK",
          message: "Link do produto é obrigatório",
        },
        { status: 400 },
      );
    }

    const result = await fetchMercadoLivreProductByHtml(link);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ProductLookupError) {
      return NextResponse.json(
        {
          error: true,
          code: "LOOKUP_ERROR",
          message: error.message,
        },
        { status: error.status },
      );
    }

    console.error("Erro em POST /api/productos/mercadolivre:", error);
    return NextResponse.json(
      {
        error: true,
        code: "SERVER_ERROR",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}
