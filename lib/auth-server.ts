import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  AUTH_COOKIE_NAME,
  DEFAULT_POST_LOGIN_PATH,
  sanitizeNextPath,
} from "@/lib/auth-token";
import { findAuthenticatedUserByToken } from "@/lib/auth";

export async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  return findAuthenticatedUserByToken(token);
}

export async function requireAuthenticatedUser(nextPath?: string) {
  const user = await getAuthenticatedUser();
  if (user) {
    return user;
  }

  const sanitizedNextPath = sanitizeNextPath(nextPath ?? DEFAULT_POST_LOGIN_PATH);
  const loginPath =
    sanitizedNextPath === DEFAULT_POST_LOGIN_PATH
      ? "/login"
      : `/login?next=${encodeURIComponent(sanitizedNextPath)}`;

  redirect(loginPath);
}

export async function redirectAuthenticatedUser() {
  const user = await getAuthenticatedUser();
  if (user) {
    redirect(DEFAULT_POST_LOGIN_PATH);
  }

  return null;
}
