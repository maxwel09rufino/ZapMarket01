import { NextRequest, NextResponse } from "next/server";
import {
  createMeliCredential,
  listMeliCredentials,
  MeliCredentialValidationError,
  resolveMeliUserId,
} from "@/lib/meli/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

type CreateCredentialBody = {
  name?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  affiliate_tracking_id?: string;
  affiliate_slug?: string;
};

function resolveError(error: unknown) {
  if (error instanceof MeliCredentialValidationError) {
    return {
      status: 400,
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
  }

  return {
    status: 500,
    message: "Nao foi possivel processar as credenciais do Mercado Livre.",
  };
}

export async function GET(request: NextRequest) {
  try {
    const userId = resolveMeliUserId(request.headers.get("x-user-id"));
    const credentials = await listMeliCredentials(userId);

    return NextResponse.json(
      {
        credentials,
        activeCredentialId: credentials.find((credential) => credential.isActive)?.id ?? null,
      },
      {
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

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as CreateCredentialBody | null;
  if (!body) {
    return NextResponse.json(
      { error: "Payload invalido." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const userId = resolveMeliUserId(request.headers.get("x-user-id"));
    const credential = await createMeliCredential({
      userId,
      name: body.name,
      clientId: body.client_id ?? "",
      clientSecret: body.client_secret ?? "",
      refreshToken: body.refresh_token ?? "",
      affiliateTrackingId: body.affiliate_tracking_id,
      affiliateSlug: body.affiliate_slug,
    });

    return NextResponse.json(
      {
        message: "Credencial validada e salva com sucesso.",
        credential,
      },
      {
        status: 201,
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
