import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, verifySessionToken } from "@/lib/auth-token";

function isPublicApiPath(pathname: string) {
  return (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/products/extension") ||
    pathname === "/api/bot-whatsapp/incoming"
  );
}

function buildLoginRedirectUrl(request: NextRequest) {
  const url = new URL("/login", request.url);
  const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (nextPath && nextPath !== "/login") {
    url.searchParams.set("next", nextPath);
  }

  return url;
}

function clearSessionCookie(response: NextResponse) {
  response.cookies.delete(AUTH_COOKIE_NAME);
  return response;
}

export async function proxy(request: NextRequest) {
  if (process.env.DISABLE_AUTH === "true") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (pathname === "/") {
    return NextResponse.next();
  }

  if (isPublicApiPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (pathname === "/login") {
    if (session) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    return token ? clearSessionCookie(NextResponse.next()) : NextResponse.next();
  }

  if (session) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return clearSessionCookie(
      NextResponse.json(
        {
          authenticated: false,
          error: "Nao autenticado.",
        },
        {
          status: 401,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      ),
    );
  }

  return clearSessionCookie(NextResponse.redirect(buildLoginRedirectUrl(request)));
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/dashboard/:path*",
    "/assistente/:path*",
    "/produtos/:path*",
    "/campanhas/:path*",
    "/contatos/:path*",
    "/whatsapp/:path*",
    "/bot-whatsapp/:path*",
    "/configuracoes/:path*",
    "/api/:path*",
  ],
};
