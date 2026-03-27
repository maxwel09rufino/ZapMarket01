"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Menu, Megaphone, Package, SendHorizontal, Sparkles, UsersRound } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  AssistantAction,
  AssistantCard,
  AssistantResponsePayload,
  AssistantSummary,
  AssistantWorkflow,
} from "@/lib/assistant/types";

type PlatformAssistantShellProps = {
  userName: string;
};

type ConversationMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  cards?: AssistantCard[];
  actions?: AssistantAction[];
};

const SIDEBAR_STORAGE_KEY = "zapmarket.sidebar.collapsed";

function createMessageId(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
}

function summaryCards(summary: AssistantSummary | null) {
  if (!summary) {
    return [];
  }

  return [
    {
      title: "Produtos",
      value: summary.productsCount,
      icon: Package,
      tone: "text-emerald-300",
    },
    {
      title: "Contatos",
      value: summary.contactsCount,
      icon: UsersRound,
      tone: "text-sky-300",
    },
    {
      title: "Campanhas Ativas",
      value: summary.activeCampaignsCount,
      icon: Megaphone,
      tone: "text-amber-300",
    },
  ];
}

export default function PlatformAssistantShell({ userName }: PlatformAssistantShellProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [summary, setSummary] = useState<AssistantSummary | null>(null);
  const [workflow, setWorkflow] = useState<AssistantWorkflow | null>(null);
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const persistedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (persistedValue === "true") {
      setIsSidebarCollapsed(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, isSubmitting]);

  useEffect(() => {
    let cancelled = false;

    const loadInitial = async () => {
      setIsLoadingInitial(true);

      try {
        const response = await fetch("/api/assistant/chat", {
          cache: "no-store",
        });

        const payload = (await response.json().catch(() => null)) as AssistantResponsePayload | null;
        if (cancelled) {
          return;
        }

        if (!response.ok || !payload?.message) {
          throw new Error("Nao foi possivel iniciar o assistente.");
        }

        setMessages([
          {
            id: createMessageId("assistant"),
            role: "assistant",
            text: payload.message,
            cards: payload.cards,
            actions: payload.actions,
          },
        ]);
        setSummary(payload.summary ?? null);
        setWorkflow(payload.workflow ?? null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setMessages([
          {
            id: createMessageId("assistant-error"),
            role: "assistant",
            text: error instanceof Error ? error.message : "Falha ao carregar o assistente.",
          },
        ]);
      } finally {
        if (!cancelled) {
          setIsLoadingInitial(false);
        }
      }
    };

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, []);

  async function sendAssistantRequest(args: {
    message?: string;
    actionId?: string;
    showUserText?: string;
  }) {
    if (isSubmitting) {
      return;
    }

    const outgoingText = (args.showUserText ?? args.message ?? "").trim();
    if (!outgoingText && !args.actionId) {
      return;
    }

    if (outgoingText) {
      setMessages((current) => [
        ...current,
        {
          id: createMessageId("user"),
          role: "user",
          text: outgoingText,
        },
      ]);
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: args.message,
          actionId: args.actionId,
          workflow,
        }),
      });

      const payload = (await response.json().catch(() => null)) as AssistantResponsePayload | null;
      if (!payload?.message) {
        throw new Error("Nao foi possivel processar a sua solicitacao.");
      }

      setMessages((current) => [
        ...current,
        {
          id: createMessageId("assistant"),
          role: "assistant",
          text: payload.message,
          cards: payload.cards,
          actions: payload.actions,
        },
      ]);
      setSummary(payload.summary ?? null);
      setWorkflow(payload.workflow ?? null);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: createMessageId("assistant-error"),
          role: "assistant",
          text: error instanceof Error ? error.message : "Falha ao processar a solicitacao.",
        },
      ]);
      setWorkflow(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextMessage = inputValue.trim();
    if (!nextMessage) {
      return;
    }

    setInputValue("");
    await sendAssistantRequest({
      message: nextMessage,
      showUserText: nextMessage,
    });
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#020409]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(48%_40%_at_90%_0%,rgba(34,197,94,0.16),transparent),radial-gradient(26%_26%_at_0%_6%,rgba(59,130,246,0.12),transparent)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px]">
        <Sidebar
          collapsed={isSidebarCollapsed}
          mobileOpen={isMobileSidebarOpen}
          onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
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

          <section className="rounded-[32px] border border-white/10 bg-[linear-gradient(135deg,rgba(9,14,23,0.96),rgba(5,8,14,0.92))] px-6 py-7 shadow-[0_28px_80px_rgba(2,6,23,0.45)] sm:px-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200">
                  <div className="rounded-xl bg-emerald-500/15 p-2 text-emerald-300">
                    <Sparkles className="size-5" />
                  </div>
                  Assistente da Plataforma
                </div>

                <h1 className="font-heading text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl">
                  Controle produtos, contatos e campanhas por comando.
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-300 sm:text-lg">
                  {userName}, este bot guia a operacao da plataforma passo a passo: importa produto
                  por link, cadastra contatos, monta campanha guiada e mostra o resumo da conta.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {summaryCards(summary).map((item) => (
                  <Card
                    key={item.title}
                    className="rounded-3xl border-white/10 bg-[#0a111d]/90 p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-zinc-400">{item.title}</p>
                        <p className="mt-2 text-2xl font-bold text-zinc-50">{item.value}</p>
                      </div>
                      <div className={`rounded-2xl bg-white/5 p-3 ${item.tone}`}>
                        <item.icon className="size-5" />
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Card className="rounded-[30px] border-white/10 bg-[#070d16]/88 p-0">
              <div className="border-b border-white/10 px-6 py-5">
                <p className="font-heading text-2xl font-semibold text-zinc-50">
                  Conversa inteligente
                </p>
                <p className="mt-1 text-sm text-zinc-400">
                  Envie comandos naturais como &quot;buscar produto&quot;,
                  &quot;adicionar contato&quot; ou cole um link do Mercado Livre.
                </p>
              </div>

              <div className="max-h-[62vh] overflow-y-auto px-4 py-5 sm:px-6">
                <div className="space-y-4">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[88%] rounded-[24px] px-4 py-3 ${
                          message.role === "user"
                            ? "bg-emerald-500 text-emerald-950"
                            : "border border-white/10 bg-white/[0.03] text-zinc-100"
                        }`}
                      >
                        <p className="whitespace-pre-wrap text-sm leading-6">{message.text}</p>

                        {message.cards?.length ? (
                          <div className="mt-4 grid gap-3">
                            {message.cards.map((card) => (
                              <div
                                key={card.id}
                                className="rounded-2xl border border-white/10 bg-black/20 p-4"
                              >
                                <div className="flex gap-3">
                                  {card.imageUrl ? (
                                    <img
                                      src={card.imageUrl}
                                      alt={card.title}
                                      className="size-16 rounded-2xl object-cover"
                                    />
                                  ) : null}
                                  <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-zinc-50">{card.title}</p>
                                    {card.description ? (
                                      <p className="mt-1 text-xs text-zinc-400">{card.description}</p>
                                    ) : null}
                                    {card.fields?.length ? (
                                      <div className="mt-3 grid gap-2">
                                        {card.fields.map((field) => (
                                          <div
                                            key={`${card.id}-${field.label}`}
                                            className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2"
                                          >
                                            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                                              {field.label}
                                            </p>
                                            <p className="mt-1 break-all text-sm text-zinc-200">
                                              {field.value}
                                            </p>
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {message.actions?.length ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {message.actions.map((action) =>
                              action.kind === "navigate" ? (
                                <Button
                                  key={action.id}
                                  type="button"
                                  variant="secondary"
                                  className="h-9 rounded-xl"
                                  onClick={() => {
                                    if (action.href) {
                                      window.location.href = action.href;
                                    }
                                  }}
                                >
                                  {action.label}
                                </Button>
                              ) : (
                                <Button
                                  key={action.id}
                                  type="button"
                                  variant="secondary"
                                  className="h-9 rounded-xl"
                                  disabled={isSubmitting}
                                  onClick={() =>
                                    void sendAssistantRequest({
                                      actionId: action.id,
                                      message: action.value ?? action.label,
                                      showUserText: action.label,
                                    })
                                  }
                                >
                                  {action.label}
                                </Button>
                              ),
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}

                  {isLoadingInitial ? (
                    <div className="flex justify-start">
                      <div className="rounded-[24px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
                        Carregando assistente...
                      </div>
                    </div>
                  ) : null}

                  {isSubmitting ? (
                    <div className="flex justify-start">
                      <div className="rounded-[24px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
                        Processando comando...
                      </div>
                    </div>
                  ) : null}

                  <div ref={scrollAnchorRef} />
                </div>
              </div>

              <form
                onSubmit={handleSubmit}
                className="border-t border-white/10 px-4 py-4 sm:px-6"
              >
                <div className="flex gap-3">
                  <Input
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    placeholder="Digite um comando ou cole um link do Mercado Livre..."
                    className="h-12 rounded-2xl border-white/10 bg-[#0b1018]"
                    disabled={isLoadingInitial || isSubmitting}
                  />
                  <Button
                    type="submit"
                    size="lg"
                    className="h-12 rounded-2xl px-5"
                    disabled={isLoadingInitial || isSubmitting}
                  >
                    <SendHorizontal className="size-4" />
                    Enviar
                  </Button>
                </div>
              </form>
            </Card>

            <Card className="rounded-[30px] border-white/10 bg-[#070d16]/88 p-6">
              <p className="font-heading text-2xl font-semibold text-zinc-50">
                Comandos do bot
              </p>

              <div className="mt-4 grid gap-3 text-sm text-zinc-300">
                {[
                  "cadastrar produto",
                  "enviar link",
                  "listar produtos",
                  "buscar produto meia",
                  "adicionar contato",
                  "listar campanhas",
                  "criar campanha",
                  "resumo da conta",
                ].map((command) => (
                  <button
                    key={command}
                    type="button"
                    className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/10"
                    onClick={() =>
                      void sendAssistantRequest({
                        message: command,
                        showUserText: command,
                      })
                    }
                    disabled={isLoadingInitial || isSubmitting}
                  >
                    {command}
                  </button>
                ))}
              </div>
            </Card>
          </section>
        </main>
      </div>
    </div>
  );
}
