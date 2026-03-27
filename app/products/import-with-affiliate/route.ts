import { NextRequest, NextResponse } from "next/server";
import {
  ProductImportConflictError,
  startMercadoLivreLinkedImport,
} from "@/lib/products/importQueue";
import { ProductValidationError } from "@/lib/products/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

type ImportWithAffiliateBody = {
  links?: unknown;
  short_links?: unknown;
  shortLinks?: unknown;
  sourceName?: string;
  maxProducts?: number | string | null;
};

function parseStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

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
    message: "Nao foi possivel iniciar a importacao com links afiliados.",
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ImportWithAffiliateBody | null;
  const links = parseStringArray(body?.links);
  const shortLinks = parseStringArray(body?.shortLinks ?? body?.short_links);
  const sourceName = String(body?.sourceName ?? "").trim();

  if (links.length === 0 && shortLinks.length === 0) {
    return NextResponse.json(
      {
        error:
          "Envie `links` e `short_links` com a mesma quantidade de linhas para importar os produtos em ordem.",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (links.length !== shortLinks.length) {
    return NextResponse.json(
      {
        error: `Quantidade de links nao corresponde: ${links.length} produto(s) e ${shortLinks.length} afiliado(s).`,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const job = startMercadoLivreLinkedImport({
      entries: links.map((originalLink, index) => ({
        originalLink,
        shortLink: shortLinks[index] ?? null,
        position: index + 1,
      })),
      sourceName: sourceName || "painel-produtos-afiliado",
      maxProducts: parseMaxProducts(body?.maxProducts),
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
