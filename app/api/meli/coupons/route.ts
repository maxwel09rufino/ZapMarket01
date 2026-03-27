import { NextRequest, NextResponse } from "next/server";
import { searchMercadoLivreCouponsByUrl } from "@/lib/meli/coupons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

type CouponLookupBody = {
  url?: string;
  product_link?: string;
};

function sanitizeText(value: string | undefined | null) {
  return String(value ?? "").trim();
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as CouponLookupBody | null;
  const url = sanitizeText(body?.url ?? body?.product_link);

  if (!url) {
    return NextResponse.json(
      { error: "url e obrigatorio." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const couponLookup = await searchMercadoLivreCouponsByUrl(url);

    return NextResponse.json(
      {
        product: couponLookup.product,
        produto: couponLookup.product,
        coupons: couponLookup.coupons,
        cupons: couponLookup.coupons,
        marketingMessage: couponLookup.marketingMessage,
        anuncio: couponLookup.marketingMessage,
        searchedAt: couponLookup.searchedAt,
        cache: couponLookup.cache,
      },
      {
        status: 200,
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && sanitizeText(error.message)
            ? error.message
            : "Nao foi possivel buscar cupons para esse produto.",
      },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
