import { NextRequest, NextResponse } from "next/server";
import {
  createMeliCredentialFromAuthorizationCode,
  MeliCredentialValidationError,
} from "@/lib/meli/store";
import { resolveRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function resolveSettingsUrl(request: NextRequest, redirectPath?: string) {
  const origin = resolveRequestOrigin(request);
  const fallback = new URL("/configuracoes?tab=credentials", origin);
  const normalized = sanitizeText(redirectPath);
  if (!normalized || !normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }

  return new URL(normalized, origin);
}

function appendStatus(url: URL, status: "success" | "error", message: string) {
  url.searchParams.set("tab", "credentials");
  url.searchParams.set("meli_oauth", status);

  const normalizedMessage = sanitizeText(message);
  if (normalizedMessage) {
    url.searchParams.set("meli_oauth_message", normalizedMessage);
  }

  return url;
}

function resolveErrorMessage(error: unknown) {
  if (error instanceof MeliCredentialValidationError) {
    return error.message;
  }

  return "Nao foi possivel concluir a conexao OAuth com o Mercado Livre.";
}

export async function GET(request: NextRequest) {
  const state = sanitizeText(request.nextUrl.searchParams.get("state"));
  const code = sanitizeText(request.nextUrl.searchParams.get("code"));
  const providerError = sanitizeText(request.nextUrl.searchParams.get("error"));
  const providerDescription = sanitizeText(request.nextUrl.searchParams.get("error_description"));

  if (providerError) {
    const redirectUrl = appendStatus(
      resolveSettingsUrl(request),
      "error",
      providerDescription || providerError,
    );
    return NextResponse.redirect(redirectUrl);
  }

  if (!state || !code) {
    const redirectUrl = appendStatus(
      resolveSettingsUrl(request),
      "error",
      "Callback OAuth invalido. O Mercado Livre nao retornou codigo e estado completos.",
    );
    return NextResponse.redirect(redirectUrl);
  }

  try {
    const redirectUri = new URL("/api/meli/oauth/callback", resolveRequestOrigin(request)).toString();
    const result = await createMeliCredentialFromAuthorizationCode({
      stateToken: state,
      code,
      redirectUri,
    });

    const accountLabel =
      result.credential.meliNickname || result.credential.meliUserId || "Mercado Livre";
    const redirectUrl = appendStatus(
      resolveSettingsUrl(request, result.redirectPath),
      "success",
      `Conta ${accountLabel} conectada com sucesso.`,
    );
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    const redirectUrl = appendStatus(
      resolveSettingsUrl(request),
      "error",
      resolveErrorMessage(error),
    );
    return NextResponse.redirect(redirectUrl);
  }
}
