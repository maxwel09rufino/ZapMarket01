import { NextRequest, NextResponse } from "next/server";
import { isMercadoLivreShortLink } from "@/lib/meli/affiliate";
import {
  createProductImportPreview,
  serializeProductImportPreview,
} from "@/lib/products/extensionPreview";
import {
  resolveExtensionLookupMode,
  resolveExtensionProductLookup,
} from "@/lib/products/extensionLookup";
import { emitProductImportEvent } from "@/lib/products/importEvents";
import { getProductByLink } from "@/lib/products/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type PreviewRequestBody = {
  url?: string;
  lookupMode?: string;
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
  const body = (await request.json().catch(() => null)) as PreviewRequestBody | null;
  const url = sanitizeText(body?.url);
  const lookupMode = resolveExtensionLookupMode(body?.lookupMode);

  if (!url) {
    return NextResponse.json(
      { error: "Link do produto e obrigatorio." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const product = await resolveExtensionProductLookup(url, lookupMode);
    const canonicalLink = product.canonicalLink ?? product.link;
    const lookupLink = isMercadoLivreShortLink(url) ? url : canonicalLink;
    const existingProduct = await getProductByLink(lookupLink);

    const preview = await createProductImportPreview({
      source: "extension",
      lookupMode,
      requestedUrl: url,
      title: product.title,
      price: product.price,
      originalPrice: product.originalPrice,
      discount: product.discount,
      hasCouponOrDiscount: product.hasCouponOrDiscount,
      couponLabel: product.couponLabel,
      image: product.image,
      images: product.images,
      description: product.description,
      link: canonicalLink,
      marketplace: product.marketplace,
      seller: product.seller,
      existingProductId: existingProduct?.id,
    });

    emitProductImportEvent({
      type: "preview-created",
      previewId: preview.id,
      productTitle: preview.title,
      link: preview.link,
      at: new Date().toISOString(),
    });

    const origin = new URL(request.url).origin;

    return NextResponse.json(
      {
        preview: serializeProductImportPreview(preview),
        dashboardUrl: `${origin}/produtos`,
        productsUrl: `${origin}/produtos`,
        existingProduct: existingProduct
          ? {
              id: existingProduct.id,
              title: existingProduct.title,
            }
          : undefined,
      },
      {
        status: 200,
        headers: CORS_HEADERS,
      },
    );
  } catch (error) {
    const resolvedError =
      error instanceof Error
        ? {
            status: 400,
            message: error.message,
          }
        : {
            status: 500,
            message: "Nao foi possivel preparar a importacao do produto.",
          };

    return NextResponse.json(
      { error: resolvedError.message },
      {
        status: resolvedError.status,
        headers: CORS_HEADERS,
      },
    );
  }
}
