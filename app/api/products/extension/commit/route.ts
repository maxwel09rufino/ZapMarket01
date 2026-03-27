import { NextRequest, NextResponse } from "next/server";
import { isMercadoLivreShortLink } from "@/lib/meli/affiliate";
import {
  confirmProductImportPreview,
  failProductImportPreview,
  getProductImportPreviewById,
  serializeProductImportPreview,
} from "@/lib/products/extensionPreview";
import { emitProductImportEvent } from "@/lib/products/importEvents";
import {
  createProduct,
  getProductById,
  getProductByLink,
  ProductValidationError,
  updateProductById,
} from "@/lib/products/store";
import { toProductDTO } from "@/lib/products/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type CommitRequestBody = {
  previewId?: string;
};

function sanitizeText(value: string | undefined | null) {
  return String(value ?? "").trim();
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as CommitRequestBody | null;
  const previewId = sanitizeText(body?.previewId);

  if (!previewId) {
    return NextResponse.json(
      { error: "Preview da importacao e obrigatorio." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const preview = await getProductImportPreviewById(previewId);
  if (!preview) {
    return NextResponse.json(
      { error: "Preview de importacao nao encontrado." },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  if (preview.importedProductId) {
    const existingImportedProduct = await getProductById(preview.importedProductId);

    if (existingImportedProduct) {
      return NextResponse.json(
        {
          message: "Esse preview ja foi importado anteriormente.",
          product: toProductDTO(existingImportedProduct),
          preview: serializeProductImportPreview(preview),
        },
        {
          status: 200,
          headers: CORS_HEADERS,
        },
      );
    }
  }

  try {
    const requestedLink = isMercadoLivreShortLink(preview.requestedUrl)
      ? preview.requestedUrl
      : preview.link;
    const existingProduct =
      (preview.existingProductId ? await getProductById(preview.existingProductId) : null) ??
      (await getProductByLink(requestedLink)) ??
      (requestedLink === preview.link ? null : await getProductByLink(preview.link));

    const payload = {
      title: preview.title,
      price: preview.price,
      originalPrice: preview.originalPrice,
      discount: preview.discount,
      hasCouponOrDiscount: preview.hasCouponOrDiscount,
      couponLabel: preview.couponLabel ?? "",
      image: preview.image,
      images: preview.images,
      description: preview.description,
      link: requestedLink,
      linkOriginal: preview.link,
      linkAffiliate:
        requestedLink !== preview.link && !isMercadoLivreShortLink(requestedLink)
          ? requestedLink
          : undefined,
      linkShort: isMercadoLivreShortLink(requestedLink) ? requestedLink : undefined,
      linkNormalized: preview.link,
      marketplace: preview.marketplace,
      seller: preview.seller ?? "",
    };

    const savedProduct = existingProduct
      ? await updateProductById(existingProduct.id, payload)
      : await createProduct(payload);
    const confirmedPreview = await confirmProductImportPreview(preview.id, {
      importedProductId: savedProduct.id,
      existingProductId: existingProduct?.id,
    });

    emitProductImportEvent({
      type: "product-committed",
      previewId: preview.id,
      productId: savedProduct.id,
      productTitle: savedProduct.title,
      link: savedProduct.link,
      at: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        message: existingProduct
          ? "Produto ja existia e foi atualizado com os dados mais recentes."
          : "Produto cadastrado com sucesso no painel.",
        created: !existingProduct,
        product: toProductDTO(savedProduct),
        preview: confirmedPreview ? serializeProductImportPreview(confirmedPreview) : undefined,
      },
      {
        status: 200,
        headers: CORS_HEADERS,
      },
    );
  } catch (error) {
    const resolvedError =
      error instanceof ProductValidationError
        ? {
            status: 400,
            message: error.message,
          }
        : {
            status: 500,
            message: "Nao foi possivel confirmar a importacao do produto.",
          };

    await failProductImportPreview(preview.id, resolvedError.message).catch(() => undefined);

    return NextResponse.json(
      { error: resolvedError.message },
      {
        status: resolvedError.status,
        headers: CORS_HEADERS,
      },
    );
  }
}
