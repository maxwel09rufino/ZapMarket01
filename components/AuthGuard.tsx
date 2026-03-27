"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";

type AuthGuardProps = {
  children: ReactNode;
};

type SessionResponse = {
  authenticated?: boolean;
};

const AUTH_DISABLED_ON_CLIENT =
  String(process.env.NEXT_PUBLIC_DISABLE_AUTH ?? "").trim().toLowerCase() === "true" ||
  String(process.env.NEXT_PUBLIC_DISABLE_AUTH ?? "").trim() === "1";

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthenticated, setIsAuthenticated] = useState(AUTH_DISABLED_ON_CLIENT);
  const [isCheckingSession, setIsCheckingSession] = useState(!AUTH_DISABLED_ON_CLIENT);

  useEffect(() => {
    if (AUTH_DISABLED_ON_CLIENT) {
      return;
    }

    let cancelled = false;

    const checkSession = async () => {
      const nextPath =
        typeof window === "undefined"
          ? pathname
          : `${window.location.pathname}${window.location.search}`;

      setIsCheckingSession(true);

      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
        });

        const payload = (await response.json().catch(() => null)) as SessionResponse | null;
        if (cancelled) {
          return;
        }

        if (payload?.authenticated) {
          setIsAuthenticated(true);
          setIsCheckingSession(false);
          return;
        }

        setIsAuthenticated(false);
        setIsCheckingSession(false);
        router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
      } catch {
        if (cancelled) {
          return;
        }

        setIsAuthenticated(false);
        setIsCheckingSession(false);
        router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
      }
    };

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (isCheckingSession || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020409] px-6">
        <div className="glass-panel flex w-full max-w-md flex-col items-center gap-4 rounded-[28px] border border-white/10 px-6 py-10 text-center">
          <div className="rounded-2xl bg-emerald-500/12 p-4 text-emerald-300">
            {isCheckingSession ? (
              <Loader2 className="size-6 animate-spin" />
            ) : (
              <ShieldCheck className="size-6" />
            )}
          </div>
          <div className="space-y-1">
            <p className="font-heading text-xl font-semibold text-zinc-50">
              Validando sessao
            </p>
            <p className="text-sm text-zinc-400">
              Aguarde enquanto verificamos seu acesso ao painel.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
