import { MessageSquareText } from "lucide-react";
import LoginForm from "@/components/LoginForm";
import { Card } from "@/components/ui/card";
import { redirectAuthenticatedUser } from "@/lib/auth-server";
import { sanitizeNextPath } from "@/lib/auth-token";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{
    next?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  await redirectAuthenticatedUser();

  const resolvedSearchParams = await searchParams;
  const rawNextPath = Array.isArray(resolvedSearchParams.next)
    ? resolvedSearchParams.next[0]
    : resolvedSearchParams.next;
  const nextPath = sanitizeNextPath(rawNextPath);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(42%_36%_at_88%_0%,rgba(34,197,94,0.18),transparent),radial-gradient(30%_28%_at_6%_4%,rgba(59,130,246,0.14),transparent)]" />

      <Card className="relative w-full max-w-[520px] rounded-[32px] border-white/10 bg-[linear-gradient(135deg,rgba(7,10,16,0.96),rgba(5,8,14,0.92))] p-8 shadow-[0_30px_100px_rgba(2,6,23,0.55)] sm:p-10">
        <div className="mb-8 flex items-center gap-4">
          <div className="flex size-[72px] items-center justify-center rounded-[24px] bg-[#07150d] shadow-[0_0_40px_rgba(34,197,94,0.22)]">
            <MessageSquareText className="size-8 text-green-500" />
          </div>

          <div className="space-y-1">
            <p className="font-heading text-3xl font-bold text-green-500">ZapMarket</p>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-green-400">
              Automation
            </p>
            <p className="max-w-sm text-sm leading-6 text-zinc-400">
              Automacao inteligente para WhatsApp Marketing
            </p>
          </div>
        </div>

        <LoginForm nextPath={nextPath} />
      </Card>
    </div>
  );
}
