"use client";

import { useState } from "react";
import { CheckCircle2, Link2, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type PairResponse = {
  code?: string;
  error?: string;
};

type ClearSessionResponse = {
  cleared?: boolean;
  error?: string;
};

export function PairingSection() {
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isClearingSession, setIsClearingSession] = useState(false);
  const [sessionMessage, setSessionMessage] = useState("");
  const [error, setError] = useState("");

  const handleGenerateCode = async () => {
    const cleanPhone = phone.replace(/\D/g, "");
    if (!cleanPhone) {
      setError("Digite um numero valido com DDI e DDD.");
      return;
    }

    setIsLoading(true);
    setError("");
    setSessionMessage("");
    setPairingCode("");

    try {
      const response = await fetch("/api/whatsapp/pair", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone: cleanPhone }),
      });

      const data = (await response.json()) as PairResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "Falha ao gerar codigo de pareamento.");
      }

      setPairingCode(data.code ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar codigo.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearSession = async () => {
    if (isClearingSession) {
      return;
    }

    const confirmed = window.confirm(
      "Isso vai remover a sessao salva do WhatsApp neste computador. Deseja continuar?",
    );
    if (!confirmed) {
      return;
    }

    setIsClearingSession(true);
    setError("");
    setSessionMessage("");
    setPairingCode("");

    try {
      const response = await fetch("/api/whatsapp/clear-session", {
        method: "POST",
        cache: "no-store",
      });

      const data = (await response.json()) as ClearSessionResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "Falha ao limpar sessao do WhatsApp.");
      }

      setSessionMessage("Sessao limpa com sucesso. Gere um novo codigo para reconectar.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao limpar sessao.");
    } finally {
      setIsClearingSession(false);
    }
  };

  return (
    <Card className="rounded-3xl p-6 md:p-7">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 ring-1 ring-primary/35">
          <Link2 className="size-6 text-primary" />
        </div>
        <h2 className="font-heading text-2xl font-bold text-zinc-100">Codigo de Pareamento</h2>
      </div>

      <div className="space-y-4">
        <Input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="Digite seu numero (com DDD)"
          inputMode="numeric"
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            type="button"
            className="h-12 rounded-2xl text-base font-semibold"
            onClick={() => void handleGenerateCode()}
            disabled={isLoading || isClearingSession}
          >
            {isLoading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Gerando...
              </>
            ) : (
              "Gerar Codigo"
            )}
          </Button>

          <Button
            type="button"
            variant="secondary"
            className="h-12 rounded-2xl border border-red-500/35 bg-red-500/10 text-base text-red-200 hover:bg-red-500/20"
            onClick={() => void handleClearSession()}
            disabled={isClearingSession || isLoading}
          >
            {isClearingSession ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Limpando Sessao...
              </>
            ) : (
              <>
                <Trash2 className="size-4" />
                Limpar Sessao
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
        {pairingCode ? (
          <div className="space-y-2">
            <p className="font-heading text-3xl font-bold tracking-widest text-primary">
              {pairingCode}
            </p>
            <p className="flex items-center gap-2 text-sm text-zinc-300">
              <CheckCircle2 className="size-4 text-emerald-400" />
              Digite esse codigo no WhatsApp
            </p>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">
            Gere um codigo para conectar seu WhatsApp por pareamento.
          </p>
        )}
      </div>

      {sessionMessage ? <p className="mt-4 text-sm text-emerald-400">{sessionMessage}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
    </Card>
  );
}
