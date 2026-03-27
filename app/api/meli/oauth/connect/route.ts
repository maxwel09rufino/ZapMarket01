import { NextRequest, NextResponse } from "next/server";
import {
  createMeliOAuthSession,
  MeliCredentialValidationError,
  resolveMeliUserId,
} from "@/lib/meli/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MELI_OAUTH_AUTHORIZE_URL = "https://auth.mercadolivre.com.br/authorization";
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

type ConnectBody = {
  name?: string;
  client_id?: string;
  client_secret?: string;
  affiliate_tracking_id?: string;
  affiliate_slug?: string;
  redirect_path?: string;
};

function resolveError(error: unknown) {
  if (error instanceof MeliCredentialValidationError) {
    return {
      status: 400,
      message: error.message,
    };
  }

  return {
    status: 500,
    message: "Nao foi possivel iniciar a conexao OAuth com o Mercado Livre.",
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ConnectBody | null;
  if (!body) {
    return NextResponse.json(
      { error: "Payload invalido." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const userId = resolveMeliUserId(request.headers.get("x-user-id"));
    const session = await createMeliOAuthSession({
      userId,
      name: body.name,
      clientId: body.client_id ?? "",
      clientSecret: body.client_secret ?? "",
      affiliateTrackingId: body.affiliate_tracking_id,
      affiliateSlug: body.affiliate_slug,
      redirectPath: body.redirect_path,
    });

    const redirectUri = new URL("/api/meli/oauth/callback", request.nextUrl.origin).toString();
    const authorizationUrl = new URL(MELI_OAUTH_AUTHORIZE_URL);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", session.clientId ?? "");
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("state", session.stateToken);

    return NextResponse.json(
      {
        authorizationUrl: authorizationUrl.toString(),
        redirectUri,
        expiresAt: session.expiresAt,
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
