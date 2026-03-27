import { NextRequest, NextResponse } from "next/server";
import { getProductFromLink, getProductById } from "@/lib/products/mercadoLivreApi";

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

    if (id) {
      const result = await getProductById(id);
      const statusCode = "error" in result && result.status ? result.status : 200;
      return NextResponse.json(result, { status: statusCode });
    }

    const result = await getProductFromLink(link!);
    const statusCode = "error" in result && result.status ? result.status : 200;
    return NextResponse.json(result, { status: statusCode });
  } catch (error) {
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

    const result = await getProductFromLink(link);
    const statusCode = "error" in result && result.status ? result.status : 200;
    return NextResponse.json(result, { status: statusCode });
  } catch (error) {
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
