import { NextResponse } from "next/server";
import { getProductsCount } from "@/lib/products/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

export async function GET() {
  const total = await getProductsCount();

  return NextResponse.json(
    {
      total,
    },
    {
      headers: NO_STORE_HEADERS,
    },
  );
}
