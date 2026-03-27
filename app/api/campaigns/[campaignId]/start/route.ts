import { NextResponse } from "next/server";
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

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "42P01") {
      return {
        status: 500,
        message: "Tabela de campanhas nao encontrada. Crie as tabelas antes de usar a API.",
      };
    }
  }

  return {
    status: 500,
    message: "Nao foi possivel iniciar a campanha.",
  };
}

export async function POST(
  _request: Request,
  context: {
    params: Promise<{
      campaignId: string;
    }>;
  },
) {
  const { campaignId } = await context.params;

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
