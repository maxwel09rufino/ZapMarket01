"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LoginFormProps = {
  nextPath: string;
};

type AuthApiResponse = {
  authenticated?: boolean;
  error?: string;
};

type AuthMode = "login" | "register";

export default function LoginForm({ nextPath }: LoginFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const title = useMemo(
    () => (mode === "login" ? "Entrar na plataforma" : "Criar conta"),
    [mode],
  );

  const subtitle = useMemo(
    () =>
      mode === "login"
        ? "Acesse seu painel e continue as automacoes do ZapMarket."
        : "Cadastre seu acesso para entrar no dashboard.",
    [mode],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setFeedback("");
    setIsSubmitting(true);

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload =
        mode === "login"
          ? {
              identifier,
              password,
            }
          : {
              name,
              email: identifier,
              password,
            };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responsePayload = (await response.json().catch(() => null)) as AuthApiResponse | null;
      if (!response.ok || !responsePayload?.authenticated) {
        throw new Error(responsePayload?.error ?? "Nao foi possivel autenticar.");
      }

      router.replace(nextPath);
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao autenticar.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-1">
        <h2 className="font-heading text-2xl font-bold text-zinc-50">{title}</h2>
        <p className="text-sm leading-6 text-zinc-400">{subtitle}</p>
      </div>

      {mode === "register" ? (
        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-300">Usuário</span>
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Seu nome de acesso"
              autoComplete="username"
              className="h-12 rounded-lg border-zinc-700 bg-zinc-900 pl-11 focus-visible:border-green-500 focus-visible:ring-green-500/20"
            />
          </div>
        </label>
      ) : null}

      <label className="block space-y-2">
        <span className="text-sm font-medium text-zinc-300">
          {mode === "login" ? "Email ou Usuário" : "Email"}
        </span>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <Input
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder={mode === "login" ? "seu@email.com ou usuario" : "seu@email.com"}
            autoComplete={mode === "login" ? "username" : "email"}
            className="h-12 rounded-lg border-zinc-700 bg-zinc-900 pl-11 focus-visible:border-green-500 focus-visible:ring-green-500/20"
          />
        </div>
      </label>

      <label className="block space-y-2">
        <span className="text-sm font-medium text-zinc-300">Senha</span>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Sua senha"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className="h-12 rounded-lg border-zinc-700 bg-zinc-900 pl-11 focus-visible:border-green-500 focus-visible:ring-green-500/20"
          />
        </div>
      </label>

      {feedback ? (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {feedback}
        </div>
      ) : null}

      <Button
        type="submit"
        size="lg"
        disabled={isSubmitting}
        className="h-12 w-full rounded-lg bg-green-600 text-white hover:bg-green-500"
      >
        {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
        {mode === "login" ? "Entrar" : "Criar conta"}
      </Button>

      <button
        type="button"
        className="w-full text-sm font-medium text-zinc-400 transition-colors hover:text-green-400"
        onClick={() => {
          setFeedback("");
          setMode((current) => (current === "login" ? "register" : "login"));
        }}
      >
        {mode === "login" ? "Criar conta" : "Ja tenho conta"}
      </button>
    </form>
  );
}
