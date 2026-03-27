import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { redirectAuthenticatedUser } from "@/lib/auth-server";
import { DEFAULT_POST_LOGIN_PATH, sanitizeNextPath } from "@/lib/auth-token";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string;
    mode?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  if (process.env.DISABLE_AUTH === "true") {
    redirect("/dashboard");
  }

  await redirectAuthenticatedUser();

  const resolvedSearchParams = (await searchParams) ?? {};
  const nextPath = sanitizeNextPath(resolvedSearchParams.next ?? DEFAULT_POST_LOGIN_PATH);
  const initialMode = resolvedSearchParams.mode === "register" ? "register" : "login";

  return (
    <main className="min-h-screen bg-[#020409] px-6 py-10 text-zinc-50">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center justify-center">
        <section className="glass-panel grid w-full max-w-4xl overflow-hidden rounded-[32px] border border-white/10 bg-[#070d17]/90 shadow-[0_24px_80px_rgba(0,0,0,0.35)] lg:grid-cols-[1.15fr_0.85fr]">
          <div className="hidden flex-col justify-between border-r border-white/10 bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.16),_transparent_55%),linear-gradient(180deg,_rgba(6,11,20,0.95),_rgba(3,7,15,0.98))] p-10 lg:flex">
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="flex size-16 items-center justify-center rounded-3xl bg-green-500/12 text-green-400 shadow-[0_18px_40px_rgba(34,197,94,0.14)]">
                  <span className="text-3xl font-black">Z</span>
                </div>
                <div>
                  <p className="font-heading text-4xl font-black tracking-tight text-green-400">
                    ZapMarket
                  </p>
                  <p className="text-sm font-semibold uppercase tracking-[0.32em] text-emerald-300/90">
                    Automation
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <h1 className="font-heading text-4xl font-black leading-tight text-white">
                  Automacao inteligente para WhatsApp Marketing
                </h1>
                <p className="max-w-xl text-base leading-7 text-zinc-300">
                  Gerencie campanhas, produtos e fluxos do Mercado Livre em um painel
                  unico, com importacao, atendimento e operacao centralizados.
                </p>
              </div>
            </div>

            <div className="grid gap-3 text-sm text-zinc-300">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                Dashboard, produtos e campanhas em um unico lugar.
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                Login local com criacao de conta integrada ao banco da Railway.
              </div>
            </div>
          </div>

          <div className="p-6 sm:p-8 lg:p-10">
            <div className="mx-auto w-full max-w-md space-y-8">
              <div className="space-y-2 lg:hidden">
                <p className="font-heading text-3xl font-black tracking-tight text-green-400">
                  ZapMarket
                </p>
                <p className="text-sm uppercase tracking-[0.26em] text-emerald-300/80">
                  Automation
                </p>
              </div>

              <LoginForm nextPath={nextPath} initialMode={initialMode} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
