"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  QrCode,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AUTO_REFRESH_INTERVAL_MS } from "@/lib/autoRefresh";

type ConnectionState = "idle" | "connecting" | "connected" | "disconnected";

type StatusResponse = {
  connected: boolean;
  state: ConnectionState;
  qrAvailable: boolean;
};

type QRResponse = {
  qr: string | null;
  connected: boolean;
  state: ConnectionState;
};

type ClearSessionResponse = {
  cleared?: boolean;
  error?: string;
};

type LoadMode = "initial" | "manual" | "background";

export function QRCodeSection() {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<ConnectionState>("idle");
  const [isLoading, setIsLoading] = useState(true);
  const [isClearingSession, setIsClearingSession] = useState(false);
  const [sessionMessage, setSessionMessage] = useState("");
  const [error, setError] = useState("");

  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshData = useCallback(async (mode: LoadMode = "background") => {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    const shouldShowLoader = mode !== "background";

    if (shouldShowLoader && mountedRef.current) {
      setIsLoading(true);
    }

    if (mode !== "background" && mountedRef.current) {
      setError("");
    }

    try {
      const statusResponse = await fetch("/api/whatsapp/status", {
        method: "GET",
        cache: "no-store",
      });

      const statusData = (await statusResponse.json()) as StatusResponse & {
        error?: string;
      };

      if (!statusResponse.ok) {
        throw new Error(statusData.error ?? "Falha ao carregar status do WhatsApp.");
      }

      if (!mountedRef.current) {
        return;
      }

      setConnected(statusData.connected);
      setState(statusData.state);

      if (statusData.connected) {
        setQrDataUrl(null);
        return;
      }

      const qrResponse = await fetch("/api/whatsapp/qr", {
        method: "GET",
        cache: "no-store",
      });

      const qrData = (await qrResponse.json()) as QRResponse & { error?: string };

      if (!qrResponse.ok) {
        throw new Error(qrData.error ?? "Falha ao carregar QR Code.");
      }

      if (!mountedRef.current) {
        return;
      }

      setQrDataUrl(qrData.qr);
      setConnected(qrData.connected);
      setState(qrData.state);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Falha ao carregar QR Code.");
      }
    } finally {
      if (shouldShowLoader && mountedRef.current) {
        setIsLoading(false);
      }
      inFlightRef.current = false;
    }
  }, []);

  const handleClearSession = useCallback(async () => {
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
    setConnected(false);
    setState("idle");
    setQrDataUrl(null);

    try {
      const response = await fetch("/api/whatsapp/clear-session", {
        method: "POST",
        cache: "no-store",
      });

      const data = (await response.json()) as ClearSessionResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "Falha ao limpar sessao do WhatsApp.");
      }

      if (!mountedRef.current) {
        return;
      }

      setSessionMessage("Sessao limpa com sucesso. Conecte novamente pelo QR ou pareamento.");
      await refreshData("manual");
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Falha ao limpar sessao.");
      }
    } finally {
      if (mountedRef.current) {
        setIsClearingSession(false);
      }
    }
  }, [isClearingSession, refreshData]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runPoll = async (mode: LoadMode) => {
      if (cancelled) {
        return;
      }

      await refreshData(mode);

      if (cancelled) {
        return;
      }

      timer = setTimeout(() => {
        void runPoll("background");
      }, AUTO_REFRESH_INTERVAL_MS);
    };

    void runPoll("initial");

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [refreshData]);

  return (
    <Card className="rounded-3xl p-6 md:p-7">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 ring-1 ring-primary/35">
          <QrCode className="size-6 text-primary" />
        </div>
        <div>
          <h2 className="font-heading text-2xl font-bold text-zinc-100">QR Code Direto</h2>
          <p className="text-sm text-zinc-400">Status primeiro, QR apenas quando desconectado</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4">
          <div className="mb-1 flex items-center gap-2 text-amber-300">
            <AlertTriangle className="size-4" />
            <p className="font-semibold">Limitacao em ambiente de nuvem</p>
          </div>
          <p className="text-sm leading-relaxed text-amber-100/90">
            O WhatsApp bloqueia conexoes diretas de servidores em nuvem (Replit, Vercel, etc).
            Este metodo funciona apenas quando o app esta rodando localmente no seu computador.
          </p>
        </div>

        <div className="rounded-2xl border border-violet-400/30 bg-violet-500/10 p-4">
          <div className="mb-1 flex items-center gap-2 text-violet-300">
            <Sparkles className="size-4" />
            <p className="font-semibold">Recomendacao para ambiente de nuvem</p>
          </div>
          <p className="text-sm leading-relaxed text-violet-100/90">
            Para usar em nuvem, utilize o metodo de pareamento. Ou configure uma API externa.
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
        {connected ? (
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="size-5" />
            <p className="text-sm font-medium">WhatsApp conectado com sucesso.</p>
          </div>
        ) : qrDataUrl ? (
          <div className="flex flex-col items-center gap-3">
            <Image
              src={qrDataUrl}
              alt="QR Code do WhatsApp"
              width={260}
              height={260}
              className="rounded-xl border border-white/10 bg-white p-2"
              unoptimized
            />
            <p className="text-sm text-zinc-300">Escaneie com o WhatsApp no celular.</p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center gap-2 text-zinc-300">
            <Loader2 className="size-4 animate-spin" />
            <p className="text-sm">Carregando status e QR...</p>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">QR indisponivel no momento. Estado atual: {state}.</p>
        )}

        <p className="mt-3 text-xs text-zinc-500">Atualizacao automatica a cada 10 segundos.</p>

        {sessionMessage ? <p className="mt-3 text-sm text-emerald-400">{sessionMessage}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Button
          type="button"
          variant="secondary"
          className="h-12 rounded-2xl text-base hover:bg-primary/20"
          onClick={() => void refreshData("manual")}
          disabled={isLoading || isClearingSession}
        >
          {isLoading ? "Atualizando..." : "Atualizar Agora"}
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
    </Card>
  );
}
