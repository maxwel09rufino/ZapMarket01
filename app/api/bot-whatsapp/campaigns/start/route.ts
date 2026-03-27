import { NextRequest, NextResponse } from "next/server";
import { startCampaignExecution } from "@/lib/campaigns/queue";
import {
  CampaignNotFoundError,
  CampaignValidationError,
} from "@/lib/campaigns/store";
import { toCampaignRecordDTO } from "@/lib/campaigns/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

type StartCampaignBody = {
  campaignId?: string;
};

function resolveError(error: unknown) {
  if (error instanceof CampaignValidationError) {
    return {
      status: 400,
      message: error.message,
    };
  }

  if (error instanceof CampaignNotFoundError) {
    return {
      status: 404,
      message: error.message,
    };
  }

  if (error instanceof Error && error.message.toLowerCase().includes("nao conectado")) {
    return {
      status: 409,
      message: error.message,
    };
  }

  return {
    status: 500,
    message: "Nao foi possivel iniciar a campanha pelo painel do bot.",
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as StartCampaignBody | null;
  const campaignId = (body?.campaignId ?? "").trim();

  if (!campaignId) {
    return NextResponse.json(
      { error: "Selecione uma campanha para iniciar." },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  try {
    const campaign = await startCampaignExecution(campaignId);
    return NextResponse.json(toCampaignRecordDTO(campaign), {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const resolved = resolveError(error);
    return NextResponse.json(
      { error: resolved.message },
      {
        status: resolved.status,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
