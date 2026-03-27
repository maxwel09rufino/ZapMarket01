import { NextRequest, NextResponse } from "next/server";
import {
  CampaignNotFoundError,
  CampaignValidationError,
  createCampaign,
  deleteCampaignById,
  listCampaigns,
} from "@/lib/campaigns/store";
import { ensureCampaignQueueReady, ensureCampaignRuns } from "@/lib/campaigns/queue";
import {
  toCampaignRecordDTO,
  type CreateCampaignInput,
} from "@/lib/campaigns/types";

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

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);

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
      return {
        status: 500,
        message: "Tabela de campanhas nao encontrada. Crie as tabelas antes de usar a API.",
      };
    }

    if (code === "22P02") {
      return {
        status: 400,
        message: "ID invalido informado para a campanha ou destinatarios.",
      };
    }
  }

  return {
    status: 500,
    message: "Nao foi possivel processar a campanha.",
  };
}

export async function GET() {
  try {
    await ensureCampaignQueueReady();
    const campaigns = (await listCampaigns()).map(toCampaignRecordDTO);
    ensureCampaignRuns(
      campaigns
        .filter((campaign) => campaign.status === "sending" && campaign.remainingCount > 0)
        .map((campaign) => campaign.id),
    );
    return NextResponse.json(campaigns, {
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

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as CreateCampaignInput | null;
  if (!body) {
    return NextResponse.json(
      { error: "Payload invalido." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const campaign = await createCampaign(body);
    return NextResponse.json(toCampaignRecordDTO(campaign), {
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

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  const id = (body?.id ?? "").trim();

  if (!id) {
    return NextResponse.json(
      { error: "ID da campanha e obrigatorio." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const campaign = await deleteCampaignById(id);
    return NextResponse.json(
      { success: true, campaign: toCampaignRecordDTO(campaign) },
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
