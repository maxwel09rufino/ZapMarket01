import { NextRequest, NextResponse } from "next/server";
import { isMercadoLivreShortLink } from "@/lib/meli/affiliate";
import { resolveMercadoLivreVisibleCouponData } from "@/lib/meli/coupons";
import {
  resolveExtensionLookupMode,
  resolveExtensionProductLookup,
} from "@/lib/products/extensionLookup";
import { emitProductImportEvent } from "@/lib/products/importEvents";
import { extractMercadoLivreItemIdFromUrl } from "@/lib/products/mercadoLivreLink";
import { buildProductMarketingMessage } from "@/lib/products/message";
import {
  createProduct,
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

type ImportRequestBody = {
  url?: string;
  affiliateUrl?: string;
  lookupMode?: string;
};

function sanitizeText(value: string | undefined | null) {
  return String(value ?? "").trim();
}

function resolvePreferredAffiliateLink(candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    const normalizedCandidate = sanitizeText(candidate);
    if (isMercadoLivreShortLink(normalizedCandidate)) {
      return normalizedCandidate;
    }
  }

  return "";
}

function validateImportedProduct(args: {
  requestedUrl: string;
  affiliateUrl?: string;
  resolvedLink: string;
  canonicalLink?: string;
  title: string;
  price: number;
  image: string;
  images: string[];
}) {
  const hasAffiliateLink =
    isMercadoLivreShortLink(args.requestedUrl) ||
    isMercadoLivreShortLink(args.affiliateUrl) ||
    isMercadoLivreShortLink(args.resolvedLink);
  const itemId =
    extractMercadoLivreItemIdFromUrl(args.resolvedLink) ??
    extractMercadoLivreItemIdFromUrl(args.canonicalLink ?? "") ??
    extractMercadoLivreItemIdFromUrl(args.requestedUrl);
  const hasImage =
    sanitizeText(args.image).length > 0 ||
    args.images.some((entry) => sanitizeText(entry).length > 0);

  if (
    sanitizeText(args.title).length === 0 ||
    !Number.isFinite(args.price) ||
    args.price <= 0 ||
    !hasImage ||
    (!itemId && !hasAffiliateLink)
  ) {
    throw new ProductValidationError("Dados do produto invalido antes do cadastro.");
  }

  return itemId ?? undefined;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ImportRequestBody | null;
  const url = sanitizeText(body?.url);
  const affiliateUrl = sanitizeText(body?.affiliateUrl);
  const lookupMode = resolveExtensionLookupMode(body?.lookupMode);

  if (!url) {
    return NextResponse.json(
      {
        error: "Link do produto e obrigatorio.",
        status: "error",
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const product = await resolveExtensionProductLookup(url, lookupMode);
    const canonicalLink = product.canonicalLink ?? product.link;
    const preferredAffiliateLink = resolvePreferredAffiliateLink([
      affiliateUrl,
      product.link,
      url,
    ]);
    const primaryLink = preferredAffiliateLink || canonicalLink;
    const itemId = validateImportedProduct({
      requestedUrl: url,
      affiliateUrl: preferredAffiliateLink || undefined,
      resolvedLink: product.link,
      canonicalLink: product.canonicalLink,
      title: product.title,
      price: product.price,
      image: product.image,
      images: product.images,
    });

    console.info(
      "[PRODUCT_IMPORT]",
      JSON.stringify({
        stage: "import-resolved",
        linkOriginal: url,
        linkResolvido: product.link,
        linkAfiliado: preferredAffiliateLink || undefined,
        idProduto: itemId,
        produto: {
          title: product.title,
          price: product.price,
          image: product.image || product.images[0] || "",
        },
      }),
    );

    const existingProduct =
      (await getProductByLink(primaryLink)) ??
      (primaryLink === canonicalLink ? null : await getProductByLink(canonicalLink));
    const fallbackMarketingMessage = buildProductMarketingMessage({
      title: product.title,
      price: product.price,
      link: primaryLink,
    });
    const visibleCouponData = await resolveMercadoLivreVisibleCouponData({
      url,
      title: product.title,
      price: product.price,
      originalPrice: product.originalPrice,
      hasCouponOrDiscount: product.hasCouponOrDiscount,
      couponLabel: product.couponLabel,
      fallbackMarketingMessage,
    });

    const payload = {
      title: product.title,
      price: product.price,
      originalPrice: product.originalPrice,
      discount: product.discount,
      hasCouponOrDiscount: visibleCouponData.hasCouponOrDiscount,
      couponLabel: visibleCouponData.couponLabel ?? "",
      image: product.image,
      images: product.images,
      description: product.description,
      link: primaryLink,
      linkOriginal: canonicalLink,
      linkAffiliate: preferredAffiliateLink || undefined,
      linkShort: isMercadoLivreShortLink(primaryLink) ? primaryLink : undefined,
      linkNormalized: canonicalLink,
      marketingMessage: visibleCouponData.marketingMessage,
      marketplace: product.marketplace,
      seller: product.seller ?? "",
    };

    const savedProduct = existingProduct
      ? await updateProductById(existingProduct.id, payload)
      : await createProduct(payload);

    emitProductImportEvent({
      type: "product-committed",
      previewId: savedProduct.id,
      productId: savedProduct.id,
      productTitle: savedProduct.title,
      link: savedProduct.link,
      at: new Date().toISOString(),
    });

    console.info(
      "[PRODUCT_IMPORT]",
      JSON.stringify({
        stage: "product-committed",
        linkOriginal: url,
        linkResolvido: product.link,
        linkAfiliado: preferredAffiliateLink || undefined,
        idProduto: itemId,
        productId: savedProduct.id,
        status: existingProduct ? "updated" : "imported",
      }),
    );

    return NextResponse.json(
      {
        ok: true,
        status: existingProduct ? "updated" : "imported",
        message: existingProduct
          ? "Produto ja existente e foi atualizado!"
          : "Produto importado com sucesso!",
        product: toProductDTO(savedProduct),
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
            message: "Falha ao importar produto.",
          };

    return NextResponse.json(
      {
        error: resolvedError.message,
        status: "error",
      },
      {
        status: resolvedError.status,
        headers: CORS_HEADERS,
      },
    );
  }
}
