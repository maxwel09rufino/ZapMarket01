import { NextRequest, NextResponse } from "next/server";
import {
  ProductLookupError,
  PRODUCT_LOOKUP_ERROR_MESSAGE,
} from "@/lib/products/mercadoLivre";
import { fetchMercadoLivreProductByConfiguredApi } from "@/lib/products/mercadoLivreConfigured";
import { MeliCredentialValidationError } from "@/lib/meli/store";
import { isMercadoLivreShortLink, resolveMercadoLivreProductLinks } from "@/lib/meli/affiliate";
import {
  formatMercadoLivreCouponLabel,
  pickPreferredMercadoLivreCoupon,
  searchMercadoLivreCouponsByUrl,
} from "@/lib/meli/coupons";
import { extractMercadoLivreItemIdFromUrl } from "@/lib/products/mercadoLivreLink";
import { buildProductMarketingMessage } from "@/lib/products/message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

type FetchProductBody = {
  url?: string;
  includeCoupons?: boolean;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as FetchProductBody | null;
  const url = (body?.url ?? "").trim();
  const includeCoupons = body?.includeCoupons === true;

  if (!url) {
    return NextResponse.json(
      { error: PRODUCT_LOOKUP_ERROR_MESSAGE },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const product = await fetchMercadoLivreProductByConfiguredApi(url);
    const canonicalLink = product.canonicalLink ?? product.link;
    const resolvedLinks = await resolveMercadoLivreProductLinks({
      link: url,
      canonicalLink,
      linkOriginal: canonicalLink,
      linkShort: isMercadoLivreShortLink(url) ? url : undefined,
    });
    const preferredLink = resolvedLinks.linkShort || resolvedLinks.linkAffiliate || resolvedLinks.linkOriginal;
    const itemId =
      extractMercadoLivreItemIdFromUrl(canonicalLink) ??
      extractMercadoLivreItemIdFromUrl(url) ??
      undefined;
    const couponLookup = includeCoupons
      ? await searchMercadoLivreCouponsByUrl(url).catch(() => null)
      : null;
    const preferredCoupon = couponLookup ? pickPreferredMercadoLivreCoupon(couponLookup.coupons) : null;
    const visibleCouponLabel =
      formatMercadoLivreCouponLabel(preferredCoupon) ??
      product.couponLabel;
    const visibleMarketingMessage =
      includeCoupons && couponLookup?.marketingMessage
        ? couponLookup.marketingMessage
        : buildProductMarketingMessage({
            title: product.title,
            price: product.price,
            link: preferredLink,
          });

    return NextResponse.json(
      {
        ...product,
        itemId,
        link: preferredLink,
        linkOriginal: resolvedLinks.linkOriginal,
        linkAffiliate: resolvedLinks.linkAffiliate,
        linkShort: resolvedLinks.linkShort,
        hasCouponOrDiscount: product.hasCouponOrDiscount || Boolean(preferredCoupon),
        couponLabel: visibleCouponLabel,
        marketingMessage: visibleMarketingMessage,
        marketingMessageWithCoupon: couponLookup?.marketingMessage,
        coupons: couponLookup?.coupons ?? [],
        couponSearch: couponLookup,
      },
      {
        status: 200,
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    if (error instanceof ProductLookupError || error instanceof MeliCredentialValidationError) {
      return NextResponse.json(
        {
          error: error.message || PRODUCT_LOOKUP_ERROR_MESSAGE,
        },
        {
          status: error instanceof ProductLookupError ? error.status : 400,
          headers: NO_STORE_HEADERS,
        },
      );
    }

    return NextResponse.json(
      { error: PRODUCT_LOOKUP_ERROR_MESSAGE },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
