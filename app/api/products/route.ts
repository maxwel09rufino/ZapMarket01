import { NextRequest, NextResponse } from "next/server";
import {
  createProduct,
  deleteAllProducts,
  deleteProductById,
  listProducts,
  ProductNotFoundError,
  ProductValidationError,
  updateProductById,
  type CreateProductInput,
} from "@/lib/products/store";
import { toProductDTO } from "@/lib/products/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

type ProductBody = {
  id?: string;
  deleteAll?: boolean;
  title?: string;
  price?: number | string;
  originalPrice?: number | string | null;
  discount?: number | string | null;
  hasCouponOrDiscount?: boolean;
  couponLabel?: string;
  image?: string;
  images?: string[];
  description?: string;
  itemId?: string;
  link?: string;
  linkOriginal?: string;
  linkAffiliate?: string;
  linkShort?: string;
  position?: number | string;
  marketingMessage?: string;
  marketplace?: "mercadolivre";
  seller?: string;
};

function parseNumber(
  value: number | string | null | undefined,
  fieldLabel: string,
): number;
function parseNumber(
  value: number | string | null | undefined,
  fieldLabel: string,
  options: { optional: true },
): number | undefined;
function parseNumber(
  value: number | string | null | undefined,
  fieldLabel: string,
  options?: { optional: true },
) {
  if (value === undefined || value === null || value === "") {
    if (options?.optional) {
      return undefined;
    }
    throw new ProductValidationError(`${fieldLabel} invalido.`);
  }

  const numericValue = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(numericValue)) {
    throw new ProductValidationError(`${fieldLabel} invalido.`);
  }

  return Number(numericValue);
}

function parseCreateInput(body: ProductBody): CreateProductInput {
  const preferredLink = (body.link ?? "").trim() || (body.linkOriginal ?? "").trim();

  return {
    title: (body.title ?? "").trim(),
    price: parseNumber(body.price, "Preco"),
    originalPrice: parseNumber(body.originalPrice, "Preco original", { optional: true }),
    discount: parseNumber(body.discount, "Desconto", { optional: true }),
    hasCouponOrDiscount: Boolean(body.hasCouponOrDiscount),
    couponLabel: (body.couponLabel ?? "").trim(),
    image: (body.image ?? "").trim(),
    images: Array.isArray(body.images) ? body.images : [],
    description: (body.description ?? "").trim(),
    itemId: (body.itemId ?? "").trim(),
    link: preferredLink,
    linkOriginal: (body.linkOriginal ?? "").trim(),
    linkAffiliate: (body.linkAffiliate ?? "").trim(),
    linkShort: (body.linkShort ?? "").trim(),
    position: parseNumber(body.position, "Posicao", { optional: true }),
    marketingMessage: (body.marketingMessage ?? "").trim(),
    marketplace: body.marketplace ?? "mercadolivre",
    seller: (body.seller ?? "").trim(),
  };
}

function resolveError(error: unknown) {
  if (error instanceof ProductValidationError) {
    return {
      status: 400,
      message: error.message,
    };
  }

  if (error instanceof ProductNotFoundError) {
    return {
      status: 404,
      message: error.message,
    };
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    const errorMessage = "message" in error ? String(error.message).toLowerCase() : "";

    if (code === "28P01") {
      return {
        status: 500,
        message: "Falha ao autenticar no PostgreSQL. Verifique o DATABASE_URL.",
      };
    }

    if (code === "3D000") {
      return {
        status: 500,
        message: "Banco de dados nao encontrado. Verifique se o banco 'zapmarket' existe.",
      };
    }

    if (code === "42P01") {
      if (errorMessage.includes("campaign")) {
        return {
          status: 500,
          message: "Tabela de campanhas nao encontrada. Crie as tabelas antes de excluir produtos vinculados.",
        };
      }

      return {
        status: 500,
        message: "Tabela 'products' nao encontrada. Crie a tabela antes de usar a API.",
      };
    }

    if (code === "23503") {
      return {
        status: 409,
        message: "Existem campanhas ou entregas vinculadas a estes produtos. Remova as campanhas relacionadas primeiro.",
      };
    }
  }

  return {
    status: 500,
    message: "Nao foi possivel processar a solicitacao.",
  };
}

export async function GET() {
  const products = (await listProducts()).map(toProductDTO);
  return NextResponse.json(products, {
    headers: NO_STORE_HEADERS,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ProductBody | null;
  if (!body) {
    return NextResponse.json(
      { error: "Payload invalido." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const created = await createProduct(parseCreateInput(body));
    return NextResponse.json(toProductDTO(created), {
      status: 201,
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

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ProductBody | null;
  if (!body) {
    return NextResponse.json(
      { error: "Payload invalido." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const id = (body.id ?? "").trim();
  if (!id) {
    return NextResponse.json(
      { error: "ID do produto e obrigatorio." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const updated = await updateProductById(id, parseCreateInput(body));
    return NextResponse.json(toProductDTO(updated), {
      status: 200,
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

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ProductBody | null;

  try {
    if (body?.deleteAll) {
      const deletedCount = await deleteAllProducts();
      return NextResponse.json(
        { success: true, deletedCount },
        {
          status: 200,
          headers: NO_STORE_HEADERS,
        },
      );
    }

    const id = (body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json(
        { error: "ID do produto e obrigatorio." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    await deleteProductById(id);
    return NextResponse.json(
      { success: true },
      {
        status: 200,
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
