import { NextRequest, NextResponse } from "next/server";
import {
  getLatestProductImportJob,
  ProductImportConflictError,
  startMercadoLivreLinksImport,
  startMercadoLivreSourceImport,
} from "@/lib/products/importQueue";
import { isMercadoLivreSearchUrl } from "@/lib/products/mercadoLivreSearchLink";
import { ProductValidationError } from "@/lib/products/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

type ImportProductsBody = {
  links?: string[];
  sourceUrl?: string;
  sourceName?: string;
  maxProducts?: number | string | null;
};

function parseMaxProducts(value: number | string | null | undefined) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numericValue = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(numericValue)) {
    throw new ProductValidationError("O limite da importacao precisa ser numerico.");
  }

  return Math.trunc(numericValue);
}

function resolveError(error: unknown) {
  if (error instanceof ProductImportConflictError) {
    return {
      status: 409,
      message: error.message,
    };
  }

  if (error instanceof ProductValidationError) {
    return {
      status: 400,
      message: error.message,
    };
  }

  return {
    status: 500,
    message: "Nao foi possivel iniciar a importacao oficial do Mercado Livre.",
  };
}

export async function GET() {
  return NextResponse.json(getLatestProductImportJob(), {
    headers: NO_STORE_HEADERS,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ImportProductsBody | null;
  const links = Array.isArray(body?.links)
    ? body.links.filter((entry): entry is string => typeof entry === "string")
    : [];
  const sourceUrl = (body?.sourceUrl ?? "").trim();
  const sourceName = (body?.sourceName ?? "").trim();
  const parsedMaxProducts = parseMaxProducts(body?.maxProducts);
  const inferredSearchSourceUrl =
    !sourceUrl && links.length === 1 && isMercadoLivreSearchUrl(links[0]) ? links[0].trim() : "";
  const effectiveSourceUrl = sourceUrl || inferredSearchSourceUrl;

  if (!effectiveSourceUrl && links.length === 0) {
    return NextResponse.json(
      {
        error: "Envie `sourceUrl` com uma URL de busca ou um array `links` com URLs de produto do Mercado Livre.",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (effectiveSourceUrl && isMercadoLivreSearchUrl(effectiveSourceUrl)) {
    return NextResponse.json(
      {
        error:
          "URLs de busca nao sao salvas por esta rota. Use /api/meli/search?url=...&collect=true para gerar a lista de links.",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const job = effectiveSourceUrl
      ? startMercadoLivreSourceImport({
          sourceUrl: effectiveSourceUrl,
          sourceName,
          maxProducts: parsedMaxProducts ?? 200,
        })
      : startMercadoLivreLinksImport({
          urls: links,
          sourceName,
          maxProducts: parsedMaxProducts,
        });

    return NextResponse.json(job, {
      status: 202,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const resolved = resolveError(error);
    return NextResponse.json(
      { error: resolved.message },
      { status: resolved.status, headers: NO_STORE_HEADERS },
    );
  }
}
