"use client";

import Link from "next/link";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  Bot,
  CirclePlay,
  FileText,
  Link2,
  Loader2,
  Menu,
  MessageSquareText,
  PackagePlus,
  QrCode,
  RefreshCw,
  Search,
  Settings,
  Smartphone,
  Sparkles,
  UsersRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { ConnectionCard } from "@/components/ConnectionCard";
import { MetricCard } from "@/components/Card";
import { PairingSection } from "@/components/PairingSection";
import { QRCodeSection } from "@/components/QRCodeSection";
import { Sidebar } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AUTO_REFRESH_INTERVAL_MS } from "@/lib/autoRefresh";

type ConnectionMode = "qr" | "pairing";
type RealtimeState = "connecting" | "connected" | "offline";
type FeedbackTone = "success" | "error" | "info";

type BotConversation = {
  id: string;
  phone: string;
  remoteJid: string;
  contactName?: string;
  botActive: boolean;
  linkedCampaignId?: string;
  linkedCampaignName?: string;
  lastMessage?: string;
  lastMessageFromMe: boolean;
  lastMessageAt?: string;
  totalMessages: number;
  createdAt: string;
  updatedAt: string;
};

type BotMessage = {
  id: string;
  whatsappMessageId?: string;
  phone: string;
  remoteJid: string;
  contactName?: string;
  message: string;
  fromMe: boolean;
  messageType: string;
  createdAt: string;
};

type BotLog = {
  id: string;
  phone?: string;
  remoteJid?: string;
  level: string;
  event: string;
  details?: unknown;
  createdAt: string;
};

type BotCampaignOption = {
  id: string;
  name: string;
  status: string;
  sentCount: number;
  submittedCount: number;
  remainingCount: number;
  totalMessages: number;
};

type BotOverview = {
  stats: {
    totalConversations: number;
    activeConversations: number;
    linkedCampaigns: number;
    totalMessages: number;
    messagesToday: number;
  };
  conversations: BotConversation[];
  campaigns: BotCampaignOption[];
  recentLogs: BotLog[];
  serviceStatus: {
    available: boolean;
    connected: boolean;
    state: string;
    qrAvailable: boolean;
    lastPairingCode: string | null;
    lastPairingCodeAt: string | null;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    error?: string;
  };
};

type FeedbackState = {
  tone: FeedbackTone;
  text: string;
};

const SIDEBAR_STORAGE_KEY = "zapmarket.sidebar.collapsed";
function formatPhone(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 13) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return digits || "-";
}

function isGroupConversation(remoteJid?: string) {
  return typeof remoteJid === "string" && remoteJid.endsWith("@g.us");
}

function formatConversationHandle(phone: string, remoteJid?: string) {
  return isGroupConversation(remoteJid) ? "Grupo do WhatsApp" : formatPhone(phone);
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "Sem registro";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Sem registro";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

function formatRelativeTime(value?: string | null) {
  if (!value) {
    return "Sem atividade";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Sem atividade";
  }

  const diffMs = parsed.getTime() - Date.now();
  const formatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  const minutes = Math.round(diffMs / 60000);

  if (Math.abs(minutes) < 60) {
    return formatter.format(minutes, "minute");
  }

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return formatter.format(hours, "hour");
  }

  const days = Math.round(hours / 24);
  return formatter.format(days, "day");
}

function stringifyLogDetails(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatLogEvent(event: string) {
  const normalized = String(event ?? "").replace(/\./g, " ").trim();
  if (!normalized) {
    return "Evento";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

async function requestJson<T>(
  input: RequestInfo,
  init: RequestInit | undefined,
  fallbackMessage: string,
) {
  const response = await fetch(input, {
    cache: "no-store",
    ...init,
  });

  const payload = (await response.json().catch(() => null)) as
    | T
    | {
        error?: string;
      }
    | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : undefined;
    throw new Error(message ?? fallbackMessage);
  }

  return payload as T;
}

function buildRealtimeCandidates() {
  if (typeof window === "undefined") {
    return [];
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const configured = process.env.NEXT_PUBLIC_WHATSAPP_SERVICE_WS_URL;
  const candidates = [
    configured,
    `${protocol}//${window.location.hostname}:3001/events`,
    "ws://127.0.0.1:3001/events",
    "ws://localhost:3001/events",
  ].filter((value): value is string => Boolean(value && value.trim()));

  return Array.from(new Set(candidates));
}

function BotWhatsappPageContent() {
  const [activeConnectionMode, setActiveConnectionMode] = useState<ConnectionMode>("qr");
  const [overview, setOverview] = useState<BotOverview | null>(null);
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [selectedPhone, setSelectedPhone] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [conversationQuery, setConversationQuery] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isLoadingOverview, setIsLoadingOverview] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isStartingCampaign, setIsStartingCampaign] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>("connecting");
  const deferredConversationQuery = useDeferredValue(conversationQuery);

  const selectedPhoneRef = useRef(selectedPhone);
  const logsSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    selectedPhoneRef.current = selectedPhone;
  }, [selectedPhone]);

  const selectedConversation = useMemo(
    () => overview?.conversations.find((conversation) => conversation.phone === selectedPhone) ?? null,
    [overview, selectedPhone],
  );

  const filteredConversations = useMemo(() => {
    const query = deferredConversationQuery.trim().toLowerCase();
    const source = overview?.conversations ?? [];

    if (!query) {
      return source;
    }

    return source.filter((conversation) => {
      const haystack = [
        conversation.contactName,
        conversation.phone,
        conversation.lastMessage,
        conversation.linkedCampaignName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [deferredConversationQuery, overview?.conversations]);

  useEffect(() => {
    const persistedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (persistedValue === "true") {
      setIsSidebarCollapsed(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  const loadOverview = useCallback(async (showLoader: boolean) => {
    if (showLoader) {
      setIsLoadingOverview(true);
    }

    try {
      const payload = await requestJson<BotOverview>(
        "/api/bot-whatsapp/overview",
        undefined,
        "Nao foi possivel carregar o painel do bot.",
      );

      startTransition(() => {
        setOverview(payload);
      });

      setSelectedPhone((currentPhone) => {
        if (payload.conversations.some((conversation) => conversation.phone === currentPhone)) {
          return currentPhone;
        }

        return payload.conversations[0]?.phone ?? "";
      });
    } catch (error) {
      if (showLoader) {
        setFeedback({
          tone: "error",
          text: error instanceof Error ? error.message : "Nao foi possivel carregar o bot.",
        });
      }
    } finally {
      if (showLoader) {
        setIsLoadingOverview(false);
      }
    }
  }, []);

  const loadMessages = useCallback(async (phone: string, showLoader: boolean) => {
    if (!phone) {
      startTransition(() => {
        setMessages([]);
      });
      return;
    }

    if (showLoader) {
      setIsLoadingMessages(true);
    }

    try {
      const payload = await requestJson<BotMessage[]>(
        `/api/bot-whatsapp/messages?phone=${encodeURIComponent(phone)}&limit=120`,
        undefined,
        "Nao foi possivel carregar as mensagens da conversa.",
      );

      startTransition(() => {
        setMessages(payload);
      });
    } catch (error) {
      if (showLoader) {
        setFeedback({
          tone: "error",
          text: error instanceof Error ? error.message : "Nao foi possivel carregar a conversa.",
        });
      }
    } finally {
      if (showLoader) {
        setIsLoadingMessages(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadOverview(true);

    const intervalId = window.setInterval(() => {
      void loadOverview(false);
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadOverview]);

  useEffect(() => {
    if (!selectedPhone) {
      startTransition(() => {
        setMessages([]);
      });
      return;
    }

    void loadMessages(selectedPhone, true);

    const intervalId = window.setInterval(() => {
      void loadMessages(selectedPhone, false);
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadMessages, selectedPhone]);

  useEffect(() => {
    setSelectedCampaignId(selectedConversation?.linkedCampaignId ?? "");
  }, [selectedConversation?.id, selectedConversation?.linkedCampaignId]);

  useEffect(() => {
    const candidates = buildRealtimeCandidates();
    if (candidates.length === 0) {
      setRealtimeState("offline");
      return;
    }

    let cancelled = false;
    let candidateIndex = 0;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (cancelled) {
        return;
      }

      const candidate = candidates[candidateIndex % candidates.length];
      candidateIndex += 1;
      setRealtimeState("connecting");
      socket = new WebSocket(candidate);

      socket.onopen = () => {
        if (cancelled) {
          socket?.close();
          return;
        }

        setRealtimeState("connected");
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data ?? "{}")) as {
            type?: string;
            payload?: {
              phone?: string;
            };
          };

          if (!payload.type) {
            return;
          }

          void loadOverview(false);

          const eventPhone = payload.payload?.phone ?? "";
          if (eventPhone && eventPhone === selectedPhoneRef.current) {
            void loadMessages(eventPhone, false);
            return;
          }

          if (payload.type === "status:update" && selectedPhoneRef.current) {
            void loadMessages(selectedPhoneRef.current, false);
          }
        } catch {
          // Ignora eventos malformados do canal em tempo real.
        }
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        if (cancelled) {
          return;
        }

        setRealtimeState("offline");
        reconnectTimer = window.setTimeout(connect, 4000);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [loadMessages, loadOverview]);

  const handleToggleBotActive = useCallback(async () => {
    if (!selectedConversation || isSavingSession) {
      return;
    }

    setIsSavingSession(true);

    try {
      const updated = await requestJson<BotConversation>(
        "/api/bot-whatsapp/sessions",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            phone: selectedConversation.phone,
            botActive: !selectedConversation.botActive,
          }),
        },
        "Nao foi possivel atualizar o status do bot nesta conversa.",
      );

      setFeedback({
        tone: "success",
        text: updated.botActive
          ? "Bot ativado na conversa selecionada."
          : "Bot desativado na conversa selecionada.",
      });

      await loadOverview(false);
    } catch (error) {
      setFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "Falha ao atualizar a conversa.",
      });
    } finally {
      setIsSavingSession(false);
    }
  }, [isSavingSession, loadOverview, selectedConversation]);

  const handleSaveCampaignLink = useCallback(async () => {
    if (!selectedConversation || isSavingSession) {
      return;
    }

    setIsSavingSession(true);

    try {
      const updated = await requestJson<BotConversation>(
        "/api/bot-whatsapp/sessions",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            phone: selectedConversation.phone,
            linkedCampaignId: selectedCampaignId || null,
          }),
        },
        "Nao foi possivel vincular a campanha a esta conversa.",
      );

      setSelectedCampaignId(updated.linkedCampaignId ?? "");
      setFeedback({
        tone: "success",
        text: updated.linkedCampaignId
          ? "Campanha vinculada com sucesso a esta conversa."
          : "Vinculo da campanha removido desta conversa.",
      });

      await loadOverview(false);
    } catch (error) {
      setFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "Falha ao salvar o vinculo da campanha.",
      });
    } finally {
      setIsSavingSession(false);
    }
  }, [isSavingSession, loadOverview, selectedCampaignId, selectedConversation]);

  const handleStartCampaign = useCallback(async () => {
    const campaignId = selectedCampaignId || selectedConversation?.linkedCampaignId || "";
    if (!campaignId || isStartingCampaign) {
      return;
    }

    setIsStartingCampaign(true);

    try {
      const campaign = await requestJson<{ name: string }>(
        "/api/bot-whatsapp/campaigns/start",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            campaignId,
          }),
        },
        "Nao foi possivel iniciar a campanha pelo painel do bot.",
      );

      setFeedback({
        tone: "success",
        text: `Campanha "${campaign.name}" iniciada com sucesso.`,
      });

      await loadOverview(false);
    } catch (error) {
      setFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "Falha ao iniciar a campanha.",
      });
    } finally {
      setIsStartingCampaign(false);
    }
  }, [isStartingCampaign, loadOverview, selectedCampaignId, selectedConversation?.linkedCampaignId]);

  const handleRefreshCurrentConversation = useCallback(async () => {
    await Promise.all([
      loadOverview(false),
      selectedPhone ? loadMessages(selectedPhone, true) : Promise.resolve(),
    ]);
  }, [loadMessages, loadOverview, selectedPhone]);

  const handleScrollToLogs = useCallback(() => {
    logsSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const serviceStatus = overview?.serviceStatus;
  const activeCampaign = overview?.campaigns.find((campaign) => campaign.id === selectedCampaignId);
  const feedbackClassName =
    feedback?.tone === "success"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
      : feedback?.tone === "info"
        ? "border-blue-500/25 bg-blue-500/10 text-blue-100"
        : "border-red-500/25 bg-red-500/10 text-red-100";

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_45%_at_92%_4%,rgba(34,197,94,0.14),transparent),radial-gradient(30%_30%_at_0%_0%,rgba(59,130,246,0.12),transparent)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px]">
        <Sidebar
          collapsed={isSidebarCollapsed}
          mobileOpen={isMobileSidebarOpen}
          onToggleCollapse={() => setIsSidebarCollapsed((previous) => !previous)}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
        />

        <main className="w-full flex-1 px-4 pb-8 pt-8 sm:px-6 lg:px-9">
          <div className="mb-4 flex items-center justify-between lg:hidden">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => setIsMobileSidebarOpen(true)}
              aria-label="Abrir menu lateral"
            >
              <Menu className="size-5" />
            </Button>
          </div>

          <header className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-2xl border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
                <Bot className="size-4" />
                Bot WhatsApp
              </div>
              <h1 className="font-heading text-4xl font-bold tracking-tight text-zinc-50 md:text-[3rem]">
                Automacao conversacional com controle em tempo real.
              </h1>
              <p className="max-w-3xl text-lg text-zinc-300/90">
                Conecte o numero, acompanhe as conversas, ative o bot por comando e vincule
                campanhas e produtos sem sair do painel.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                className="h-12 rounded-2xl"
                onClick={() => void handleRefreshCurrentConversation()}
              >
                <RefreshCw className="size-4" />
                Atualizar
              </Button>

              <Button asChild className="h-12 rounded-2xl">
                <Link href="/campanhas" prefetch>
                  <CirclePlay className="size-4" />
                  Criar Campanha
                </Link>
              </Button>
            </div>
          </header>

          {feedback ? (
            <div className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${feedbackClassName}`}>
              {feedback.text}
            </div>
          ) : null}

          <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Conversas"
              value={overview?.stats.totalConversations ?? 0}
              icon={UsersRound}
              iconColorClassName="text-blue-300"
              iconBgClassName="bg-blue-500/15"
              isLoading={isLoadingOverview}
            />
            <MetricCard
              title="Bots Ativos"
              value={overview?.stats.activeConversations ?? 0}
              icon={Bot}
              iconColorClassName="text-emerald-300"
              iconBgClassName="bg-emerald-500/15"
              isLoading={isLoadingOverview}
            />
            <MetricCard
              title="Mensagens Hoje"
              value={overview?.stats.messagesToday ?? 0}
              icon={MessageSquareText}
              iconColorClassName="text-violet-300"
              iconBgClassName="bg-violet-500/15"
              isLoading={isLoadingOverview}
            />
            <MetricCard
              title="Campanhas Vinculadas"
              value={overview?.stats.linkedCampaigns ?? 0}
              icon={Activity}
              iconColorClassName="text-amber-300"
              iconBgClassName="bg-amber-500/15"
              isLoading={isLoadingOverview}
            />
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_380px]">
            <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
              <Card className="rounded-[28px] border-white/10 bg-[#070d16]/85 p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-heading text-2xl font-semibold text-zinc-50">Conversas</p>
                    <p className="text-sm text-zinc-400">Lista viva das conversas do bot.</p>
                  </div>
                  <div
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
                      realtimeState === "connected"
                        ? "bg-emerald-500/15 text-emerald-200"
                        : realtimeState === "connecting"
                          ? "bg-amber-500/15 text-amber-200"
                          : "bg-red-500/15 text-red-200"
                    }`}
                  >
                    {realtimeState === "connected" ? (
                      <Wifi className="size-3.5" />
                    ) : (
                      <WifiOff className="size-3.5" />
                    )}
                    {realtimeState === "connected"
                      ? "Tempo real"
                      : realtimeState === "connecting"
                        ? "Conectando"
                        : "Sem socket"}
                  </div>
                </div>

                <div className="relative mb-4">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                  <Input
                    value={conversationQuery}
                    onChange={(event) => setConversationQuery(event.target.value)}
                    placeholder="Buscar por nome, telefone ou campanha..."
                    className="pl-10"
                  />
                </div>

                <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  Conversas e grupos aparecem aqui depois da primeira mensagem recebida.
                  Para ativar um grupo novo, envie uma mensagem nele ou use <span className="font-semibold">/ativar</span> depois que o WhatsApp estiver conectado.
                </div>

                <div className="space-y-3">
                  {filteredConversations.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-zinc-400">
                      Nenhuma conversa registrada ainda.
                    </div>
                  ) : (
                    filteredConversations.map((conversation) => {
                      const isActive = selectedPhone === conversation.phone;

                      return (
                        <button
                          key={conversation.id}
                          type="button"
                          onClick={() => setSelectedPhone(conversation.phone)}
                          className={`w-full rounded-2xl border p-4 text-left transition-all ${
                            isActive
                              ? "border-primary/40 bg-primary/10 shadow-[0_18px_42px_rgba(34,197,94,0.12)]"
                              : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-base font-semibold text-zinc-100">
                                {conversation.contactName ||
                                  formatConversationHandle(
                                    conversation.phone,
                                    conversation.remoteJid,
                                  )}
                              </p>
                              <p className="mt-0.5 text-xs text-zinc-500">
                                {formatConversationHandle(
                                  conversation.phone,
                                  conversation.remoteJid,
                                )}
                              </p>
                            </div>
                            <p className="shrink-0 text-[11px] text-zinc-500">
                              {formatRelativeTime(conversation.lastMessageAt)}
                            </p>
                          </div>

                          <p className="mt-3 line-clamp-2 text-sm text-zinc-300">
                            {conversation.lastMessage || "Sem mensagem registrada."}
                          </p>

                          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
                            <span
                              className={`rounded-full px-2.5 py-1 ${
                                conversation.botActive
                                  ? "bg-emerald-500/15 text-emerald-200"
                                  : "bg-red-500/15 text-red-200"
                              }`}
                            >
                              {conversation.botActive ? "Bot ativo" : "Bot inativo"}
                            </span>
                            <span className="rounded-full bg-white/5 px-2.5 py-1 text-zinc-300">
                              {conversation.totalMessages} mensagens
                            </span>
                            {conversation.linkedCampaignName ? (
                              <span className="rounded-full bg-blue-500/15 px-2.5 py-1 text-blue-200">
                                {conversation.linkedCampaignName}
                              </span>
                            ) : null}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </Card>

              <Card className="rounded-[28px] border-white/10 bg-[#070d16]/85 p-5">
                {selectedConversation ? (
                  <>
                    <div className="flex flex-col gap-4 border-b border-white/10 pb-5">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div>
                          <p className="font-heading text-2xl font-semibold text-zinc-50">
                            {selectedConversation.contactName || "Conversa sem nome"}
                          </p>
                          <p className="mt-1 text-sm text-zinc-400">
                            {formatConversationHandle(
                              selectedConversation.phone,
                              selectedConversation.remoteJid,
                            )}{" "}
                            • ultima atividade{" "}
                            {formatDateTime(selectedConversation.lastMessageAt)}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-11 rounded-2xl"
                            onClick={() => void handleToggleBotActive()}
                            disabled={isSavingSession}
                          >
                            {isSavingSession ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Settings className="size-4" />
                            )}
                            {selectedConversation.botActive ? "Desativar Bot" : "Ativar Bot"}
                          </Button>

                          <Button
                            type="button"
                            variant="secondary"
                            className="h-11 rounded-2xl"
                            onClick={() => void loadMessages(selectedConversation.phone, true)}
                            disabled={isLoadingMessages}
                          >
                            <RefreshCw className="size-4" />
                            Atualizar Chat
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto_auto]">
                        <select
                          value={selectedCampaignId}
                          onChange={(event) => setSelectedCampaignId(event.target.value)}
                          className="h-12 rounded-2xl border border-white/10 bg-[#0b1018] px-4 text-sm text-zinc-100 outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/30"
                        >
                          <option value="">Sem campanha vinculada</option>
                          {(overview?.campaigns ?? []).map((campaign) => (
                            <option key={campaign.id} value={campaign.id}>
                              {campaign.name} • {campaign.status}
                            </option>
                          ))}
                        </select>

                        <Button
                          type="button"
                          variant="secondary"
                          className="h-12 rounded-2xl"
                          onClick={() => void handleSaveCampaignLink()}
                          disabled={isSavingSession}
                        >
                          <Link2 className="size-4" />
                          Vincular
                        </Button>

                        <Button
                          type="button"
                          className="h-12 rounded-2xl"
                          onClick={() => void handleStartCampaign()}
                          disabled={
                            isStartingCampaign ||
                            !(selectedCampaignId || selectedConversation.linkedCampaignId)
                          }
                        >
                          {isStartingCampaign ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <CirclePlay className="size-4" />
                          )}
                          Iniciar Campanha
                        </Button>
                      </div>

                      {activeCampaign ? (
                        <div className="rounded-2xl border border-primary/15 bg-primary/10 px-4 py-3 text-sm text-zinc-100">
                          <p className="font-semibold">{activeCampaign.name}</p>
                          <p className="mt-1 text-zinc-300">
                            Status {activeCampaign.status}, {activeCampaign.sentCount} confirmadas,{" "}
                            {activeCampaign.submittedCount} submetidas e{" "}
                            {activeCampaign.remainingCount} restantes.
                          </p>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-5 space-y-3">
                      {isLoadingMessages && messages.length === 0 ? (
                        <div className="flex min-h-[360px] items-center justify-center text-zinc-400">
                          <Loader2 className="size-5 animate-spin" />
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-10 text-center text-sm text-zinc-400">
                          Nenhuma mensagem registrada nesta conversa ainda.
                        </div>
                      ) : (
                        <div className="max-h-[720px] space-y-3 overflow-y-auto pr-1">
                          {messages.map((message) => (
                            <div
                              key={message.id}
                              className={`flex ${message.fromMe ? "justify-end" : "justify-start"}`}
                            >
                              <div
                                className={`max-w-[85%] rounded-[24px] px-4 py-3 ${
                                  message.fromMe
                                    ? "bg-primary/20 text-zinc-50"
                                    : "bg-white/[0.05] text-zinc-100"
                                }`}
                              >
                                <p className="whitespace-pre-wrap text-sm leading-6">
                                  {message.message}
                                </p>
                                <p className="mt-2 text-[11px] text-zinc-400">
                                  {formatDateTime(message.createdAt)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-center">
                    <div className="flex size-16 items-center justify-center rounded-3xl bg-white/5 text-zinc-300">
                      <MessageSquareText className="size-7" />
                    </div>
                    <div>
                      <p className="font-heading text-2xl font-semibold text-zinc-50">
                        Nenhuma conversa selecionada
                      </p>
                      <p className="mt-2 max-w-md text-sm leading-6 text-zinc-400">
                        Assim que o numero receber mensagens, a conversa vai aparecer aqui com
                        historico, status do bot e vinculo de campanha.
                      </p>
                    </div>
                  </div>
                )}
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="rounded-[28px] border-white/10 bg-[#070d16]/85 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-heading text-2xl font-semibold text-zinc-50">
                      Status do Servico
                    </p>
                    <p className="mt-1 text-sm text-zinc-400">
                      Monitoramento do socket local e da conexao com o WhatsApp.
                    </p>
                  </div>
                  <div
                    className={`flex size-12 items-center justify-center rounded-2xl ${
                      serviceStatus?.connected
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-red-500/15 text-red-300"
                    }`}
                  >
                    <Smartphone className="size-5" />
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm text-zinc-400">WhatsApp local</p>
                        <p className="mt-1 text-lg font-semibold text-zinc-100">
                          {serviceStatus?.connected ? "Conectado" : "Desconectado"}
                        </p>
                      </div>
                      <span
                        className={`size-3 rounded-full ${
                          serviceStatus?.connected
                            ? "bg-emerald-500 shadow-[0_0_14px_rgba(34,197,94,0.85)]"
                            : "bg-red-500 shadow-[0_0_14px_rgba(239,68,68,0.85)]"
                        }`}
                      />
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-zinc-300">
                      <p>Estado: {serviceStatus?.state ?? "indisponivel"}</p>
                      <p>QR disponivel: {serviceStatus?.qrAvailable ? "sim" : "nao"}</p>
                      <p>
                        Reconexoes: {serviceStatus?.reconnectAttempts ?? 0}
                        {serviceStatus?.maxReconnectAttempts
                          ? ` / ${serviceStatus.maxReconnectAttempts}`
                          : ""}
                      </p>
                      {serviceStatus?.lastPairingCode ? (
                        <p>Ultimo codigo de pareamento: {serviceStatus.lastPairingCode}</p>
                      ) : null}
                    </div>
                  </div>

                  <div
                    className={`rounded-2xl border p-4 text-sm ${
                      realtimeState === "connected"
                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                        : "border-amber-500/20 bg-amber-500/10 text-amber-100"
                    }`}
                  >
                    <p className="font-semibold">
                      {realtimeState === "connected"
                        ? "Canal em tempo real conectado."
                        : "Painel usando polling e tentando reconectar o socket."}
                    </p>
                    <p className="mt-1 text-xs text-current/80">
                      Atualiza conversas, logs e campanhas sem recarregar a pagina sempre que o
                      servico local publicar eventos.
                    </p>
                  </div>

                  {serviceStatus?.error ? (
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
                      {serviceStatus.error}
                    </div>
                  ) : null}
                </div>
              </Card>

              <Card className="rounded-[28px] border-white/10 bg-[#070d16]/85 p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-heading text-2xl font-semibold text-zinc-50">Conexao</p>
                    <p className="text-sm text-zinc-400">
                      Escaneie o QR ou gere um codigo de pareamento.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-primary/15 p-3 text-primary">
                    {activeConnectionMode === "qr" ? (
                      <QrCode className="size-5" />
                    ) : (
                      <Link2 className="size-5" />
                    )}
                  </div>
                </div>

                <div className="grid gap-3">
                  <ConnectionCard
                    title="QR Code"
                    description="Conecta o numero direto pelo celular no modo local."
                    icon={QrCode}
                    badgeText="Rapido"
                    isActive={activeConnectionMode === "qr"}
                    onClick={() => setActiveConnectionMode("qr")}
                  />
                  <ConnectionCard
                    title="Pareamento"
                    description="Gera um codigo para vincular o numero sem abrir outra tela."
                    icon={Link2}
                    isActive={activeConnectionMode === "pairing"}
                    onClick={() => setActiveConnectionMode("pairing")}
                  />
                </div>

                <div className="mt-5">
                  {activeConnectionMode === "qr" ? <QRCodeSection /> : <PairingSection />}
                </div>
              </Card>

              <Card className="rounded-[28px] border-white/10 bg-[#070d16]/85 p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="rounded-2xl bg-blue-500/15 p-3 text-blue-300">
                    <Sparkles className="size-5" />
                  </div>
                  <div>
                    <p className="font-heading text-2xl font-semibold text-zinc-50">
                      Acoes Rapidas
                    </p>
                    <p className="text-sm text-zinc-400">
                      Fluxos mais usados para operar o bot.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3">
                  <Button asChild className="h-12 rounded-2xl">
                    <Link href="/campanhas" prefetch>
                      <PackagePlus className="size-4" />
                      Criar campanha
                    </Link>
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    className="h-12 rounded-2xl"
                    onClick={() => void handleSaveCampaignLink()}
                    disabled={!selectedConversation || isSavingSession}
                  >
                    <Link2 className="size-4" />
                    Vincular campanha ao bot
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    className="h-12 rounded-2xl"
                    onClick={handleScrollToLogs}
                  >
                    <FileText className="size-4" />
                    Visualizar logs
                  </Button>
                </div>
              </Card>
            </div>
          </section>

          <section ref={logsSectionRef} className="mt-8">
            <Card className="rounded-[28px] border-white/10 bg-[#070d16]/85 p-5">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="font-heading text-2xl font-semibold text-zinc-50">Logs do Bot</p>
                  <p className="mt-1 text-sm text-zinc-400">
                    Eventos recentes do atendimento automatico, produtos e campanhas.
                  </p>
                </div>
                <div className="rounded-2xl bg-white/5 px-3 py-2 text-sm text-zinc-300">
                  {overview?.recentLogs.length ?? 0} eventos
                </div>
              </div>

              <div className="grid gap-3">
                {(overview?.recentLogs ?? []).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-zinc-400">
                    Nenhum log registrado ainda.
                  </div>
                ) : (
                  overview?.recentLogs.map((log) => (
                    <div
                      key={log.id}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                log.level === "error"
                                  ? "bg-red-500/15 text-red-200"
                                  : "bg-emerald-500/15 text-emerald-200"
                              }`}
                            >
                              {log.level}
                            </span>
                            <p className="text-sm font-semibold text-zinc-100">
                              {formatLogEvent(log.event)}
                            </p>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-zinc-300">
                            {stringifyLogDetails(log.details) || "Sem detalhes adicionais."}
                          </p>
                        </div>

                        <div className="shrink-0 text-xs text-zinc-500">
                          <p>{formatDateTime(log.createdAt)}</p>
                          {log.phone ? <p className="mt-1">{formatPhone(log.phone)}</p> : null}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </section>
        </main>
      </div>
    </div>
  );
}

export default function BotWhatsappPage() {
  return (
    <AuthGuard>
      <BotWhatsappPageContent />
    </AuthGuard>
  );
}
