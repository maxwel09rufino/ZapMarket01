import { NextResponse } from "next/server";
import { getDashboardOverview } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const overview = await getDashboardOverview();

  return NextResponse.json(overview, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
