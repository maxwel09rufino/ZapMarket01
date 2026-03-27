"use client";

import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Search } from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import BackButton from "@/components/BackButton";
import CampaignForm, { type CampaignFormValues } from "@/components/CampaignForm";
import CampaignStatus from "@/components/CampaignStatus";
import RecipientsSection from "@/components/RecipientsSection";
import SettingsCard from "@/components/SettingsCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CAMPAIGN_TEMPLATE_STARTER,
  formatCampaignMessage,
} from "@/lib/campaigns/formatter";
import {
  CAMPAIGN_PRESET_DELAYS,
  type CampaignRecordDTO,
} from "@/lib/campaigns/types";
import { subscribeToSoftRefresh } from "@/lib/autoRefresh";
import type { ProductRecord } from "@/lib/products/client";
import {
  fromRecipientDTO,
  matchesRecipientSearch,
  isRecipientSendable,
  type Recipient,
  type RecipientDTO,
} from "@/lib/recipients";

type CampaignView = "list" | "create";

const initialForm: CampaignFormValues = {
  campaignName: "",
  productId: "",
  selectAllProducts: false,
  messageTemplate: CAMPAIGN_TEMPLATE_STARTER,
};

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
    const message = payload && typeof payload === "object" && "error" in payload
      ? payload.error
      : undefined;
    throw new Error(message ?? fallbackMessage);
  }

  return payload as T;
}

function CampanhasPageContent() {
  const [view, setView] = useState<CampaignView>("list");
  const [formValues, setFormValues] = useState<CampaignFormValues>(initialForm);
  const [selectedInterval, setSelectedInterval] = useState<number>(CAMPAIGN_PRESET_DELAYS[0]);
  const [customIntervalInput, setCustomIntervalInput] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRecordDTO[]>([]);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [recipientQuery, setRecipientQuery] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [startingCampaignId, setStartingCampaignId] = useState<string | null>(null);
  const [deletingCampaignId, setDeletingCampaignId] = useState<string | null>(null);
  const deferredRecipientQuery = useDeferredValue(recipientQuery);

  const sendableRecipients = useMemo(
    () => recipients.filter(isRecipientSendable),
    [recipients],
  );

  const selectedRecipients = useMemo(
    () => recipients.filter((recipient) => selectedRecipientIds.includes(recipient.id)),
    [recipients, selectedRecipientIds],
  );

  const selectedSendableCount = useMemo(
    () => selectedRecipients.filter(isRecipientSendable).length,
    [selectedRecipients],
  );

  const selectedNonSendableCount = selectedRecipients.length - selectedSendableCount;

  const filteredRecipients = useMemo(
    () =>
      recipients.filter((recipient) =>
        matchesRecipientSearch(recipient, deferredRecipientQuery),
      ),
    [deferredRecipientQuery, recipients],
  );

  const productOptions = useMemo<Array<{ id: string; name: string }>>(
    () => products.map((product) => ({ id: product.id, name: product.title })),
    [products],
  );

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === formValues.productId) ?? null,
    [products, formValues.productId],
  );

  const previewProduct = useMemo(() => {
    if (formValues.selectAllProducts) {
      return products[0] ?? null;
    }

    return selectedProduct;
  }, [formValues.selectAllProducts, products, selectedProduct]);

  const estimatedMessageCount = useMemo(() => {
    const productMultiplier = formValues.selectAllProducts
      ? products.length
      : formValues.productId
        ? 1
        : 0;

    return selectedSendableCount * productMultiplier;
  }, [formValues.productId, formValues.selectAllProducts, products.length, selectedSendableCount]);

  const previewMessage = useMemo(() => {
    if (!previewProduct) {
      return formValues.messageTemplate.trim();
    }

    return formatCampaignMessage(formValues.messageTemplate, {
      title: previewProduct.title,
      price: previewProduct.price,
      originalPrice: previewProduct.originalPrice,
      link: previewProduct.link,
      seller: previewProduct.seller,
    });
  }, [formValues.messageTemplate, previewProduct]);

  const loadInitialData = useCallback(async (showLoader = true) => {
    if (showLoader) {
      setIsLoadingData(true);
      setIsLoadingCampaigns(true);
    }

    try {
      const [recipientsPayload, productsPayload, campaignsPayload] = await Promise.all([
        requestJson<RecipientDTO[]>(
          "/api/recipients",
          undefined,
          "Nao foi possivel carregar os contatos.",
        ),
        requestJson<ProductRecord[]>(
          "/api/products",
          undefined,
          "Nao foi possivel carregar os produtos.",
        ),
        requestJson<CampaignRecordDTO[]>(
          "/api/campaigns",
          undefined,
          "Nao foi possivel carregar as campanhas.",
        ),
      ]);

      setRecipients(recipientsPayload.map(fromRecipientDTO));
      setProducts(productsPayload);
      startTransition(() => {
        setCampaigns(campaignsPayload);
      });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao carregar a area de campanhas.");
    } finally {
      if (showLoader) {
        setIsLoadingData(false);
        setIsLoadingCampaigns(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadInitialData();

    return subscribeToSoftRefresh(() => {
      void loadInitialData(false);
    });
  }, [loadInitialData]);

  useEffect(() => {
    let cancelled = false;

    const pollCampaigns = async () => {
      try {
        const payload = await requestJson<CampaignRecordDTO[]>(
          "/api/campaigns",
          undefined,
          "Nao foi possivel atualizar as campanhas.",
        );

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setCampaigns(payload);
        });
      } catch {
        // Mantem o ultimo estado conhecido se a atualizacao falhar.
      }
    };

    const interval = setInterval(() => {
      void pollCampaigns();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const updateField = <K extends keyof CampaignFormValues>(
    field: K,
    value: CampaignFormValues[K],
  ) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
    if (feedback) {
      setFeedback("");
    }
  };

  const resetCreateForm = () => {
    setFormValues(initialForm);
    setSelectedInterval(CAMPAIGN_PRESET_DELAYS[0]);
    setCustomIntervalInput("");
    setSelectedRecipientIds([]);
    setRecipientQuery("");
  };

  const refreshCampaigns = async () => {
    const payload = await requestJson<CampaignRecordDTO[]>(
      "/api/campaigns",
      undefined,
      "Nao foi possivel atualizar as campanhas.",
    );

    startTransition(() => {
      setCampaigns(payload);
    });
  };

  const handleInsertVariable = (variable: string) => {
    setFormValues((prev) => ({
      ...prev,
      messageTemplate: prev.messageTemplate.trimEnd()
        ? `${prev.messageTemplate.trimEnd()} ${variable}`
        : variable,
    }));
  };

  const handleChangeCustomInterval = (value: string) => {
    const digitsOnly = value.replace(/\D/g, "");
    setCustomIntervalInput(digitsOnly);

    const numericValue = Number(digitsOnly);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      setSelectedInterval(numericValue);
    }
  };

  const handleToggleRecipient = (recipientId: string) => {
    setSelectedRecipientIds((previousIds) =>
      previousIds.includes(recipientId)
        ? previousIds.filter((currentId) => currentId !== recipientId)
        : [...previousIds, recipientId],
    );

    if (feedback) {
      setFeedback("");
    }
  };

  const handleToggleSelectAllVisible = (visibleRecipientIds: string[]) => {
    if (visibleRecipientIds.length === 0) {
      setFeedback("Nao ha destinatarios visiveis para selecionar.");
      return;
    }

    setSelectedRecipientIds((previousIds) => {
      const selectedSet = new Set(previousIds);
      const allVisibleSelected = visibleRecipientIds.every((id) => selectedSet.has(id));

      if (allVisibleSelected) {
        visibleRecipientIds.forEach((id) => selectedSet.delete(id));
      } else {
        visibleRecipientIds.forEach((id) => selectedSet.add(id));
      }

      return Array.from(selectedSet);
    });
  };

  const handleCreateCampaign = async () => {
    if (!formValues.campaignName.trim()) {
      setFeedback("Informe um nome para a campanha.");
      return;
    }

    if (!formValues.selectAllProducts && !formValues.productId) {
      setFeedback("Selecione um produto cadastrado.");
      return;
    }

    if (formValues.selectAllProducts && products.length === 0) {
      setFeedback("Nao ha produtos cadastrados para usar em todos os envios.");
      return;
    }

    if (!formValues.messageTemplate.trim()) {
      setFeedback("Escreva um modelo de divulgacao personalizado.");
      return;
    }

    if (selectedRecipientIds.length === 0) {
      setFeedback("Selecione pelo menos um destinatario para o disparo.");
      return;
    }

    if (selectedSendableCount === 0) {
      setFeedback(
        "Selecione pelo menos um destinatario com numero, convite ou link valido para iniciar o disparo real.",
      );
      return;
    }

    if (selectedNonSendableCount > 0) {
      setFeedback(
        "Alguns destinatarios selecionados nao possuem numero, convite ou link valido para o disparo real. Revise antes de criar.",
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const createdCampaign = await requestJson<CampaignRecordDTO>(
        "/api/campaigns",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: formValues.campaignName,
            productId: formValues.productId,
            selectAllProducts: formValues.selectAllProducts,
            recipientIds: selectedRecipientIds,
            messageTemplate: formValues.messageTemplate,
            delaySeconds: selectedInterval,
          }),
        },
        "Nao foi possivel criar a campanha.",
      );

      await refreshCampaigns();
      resetCreateForm();
      setView("list");
      setFeedback(
        `Campanha "${createdCampaign.name}" criada. Clique em Iniciar para comecar o disparo real.`,
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel criar a campanha.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartCampaign = async (campaignId: string) => {
    setStartingCampaignId(campaignId);

    try {
      const campaign = await requestJson<CampaignRecordDTO>(
        `/api/campaigns/${campaignId}/start`,
        {
          method: "POST",
        },
        "Nao foi possivel iniciar a campanha.",
      );

      await refreshCampaigns();
      setFeedback(
        `Campanha "${campaign.name}" iniciada. O envio em massa esta rodando na fila real.`,
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao iniciar a campanha.");
    } finally {
      setStartingCampaignId(null);
    }
  };

  const handleDeleteCampaign = async (campaign: CampaignRecordDTO) => {
    const shouldDelete = window.confirm(
      `Deseja excluir a campanha "${campaign.name}"? As entregas vinculadas a ela tambem serao removidas.`,
    );
    if (!shouldDelete) {
      return;
    }

    setDeletingCampaignId(campaign.id);

    try {
      await requestJson<{ success: boolean }>(
        "/api/campaigns",
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: campaign.id,
          }),
        },
        "Nao foi possivel excluir a campanha.",
      );

      await refreshCampaigns();
      setFeedback(`Campanha "${campaign.name}" excluida com sucesso.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel excluir a campanha.");
    } finally {
      setDeletingCampaignId(null);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-7xl p-6">
        <div className="mb-6">
          <BackButton />
        </div>

        {view === "list" ? (
          <section>
            <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="font-heading text-4xl font-bold">Campanhas</h1>
                <p className="mt-1 max-w-3xl text-zinc-400">
                  Disparo em massa real com fila, delay controlado, produto cadastrado e
                  acompanhamento em tempo real.
                </p>
              </div>

              <Button
                type="button"
                className="h-11 bg-green-600 text-white hover:bg-green-500"
                onClick={() => setView("create")}
              >
                <Plus className="size-4" />
                Nova Campanha
              </Button>
            </header>

            {isLoadingCampaigns && campaigns.length === 0 ? (
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-10 text-center text-zinc-400">
                Carregando campanhas...
              </div>
            ) : (
              <CampaignStatus
                campaigns={campaigns}
                onStart={handleStartCampaign}
                onDelete={handleDeleteCampaign}
                startingCampaignId={startingCampaignId}
                deletingCampaignId={deletingCampaignId}
              />
            )}
          </section>
        ) : (
          <section>
            <div className="mb-5">
              <button
                type="button"
                onClick={() => setView("list")}
                className="flex items-center gap-2 text-gray-400 transition hover:text-green-500"
              >
                <ArrowLeft className="size-4" />
                Voltar
              </button>
            </div>

            <header className="mb-6">
              <h1 className="font-heading text-4xl font-bold">Nova Campanha</h1>
              <p className="mt-1 text-zinc-400">
                Monte o disparo com produto real, contatos reais e um modelo totalmente
                personalizado.
              </p>
            </header>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
              <div className="space-y-6">
                <CampaignForm
                  values={formValues}
                  onChange={updateField}
                  onInsertVariable={handleInsertVariable}
                  onUseStarterTemplate={() =>
                    setFormValues((prev) => ({
                      ...prev,
                      messageTemplate: CAMPAIGN_TEMPLATE_STARTER,
                    }))
                  }
                  products={productOptions}
                  previewMessage={previewMessage}
                />

                <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                  <label className="mb-2 block text-sm text-zinc-300">Buscar destinatario</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                    <Input
                      value={recipientQuery}
                      onChange={(event) => setRecipientQuery(event.target.value)}
                      placeholder="Buscar por nome, telefone, link ou tag..."
                      className="h-11 rounded-lg border-zinc-700 bg-zinc-800 pl-10 focus-visible:border-green-500"
                    />
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    Contatos, grupos com convite valido e canais com link valido participam do
                    disparo real. Para canais, o sistema marca como submetido quando o WhatsApp
                    nao devolve confirmacao de publicacao.
                  </p>
                </section>

                <RecipientsSection
                  recipients={filteredRecipients}
                  selectedRecipientIds={selectedRecipientIds}
                  onToggleRecipient={handleToggleRecipient}
                  onToggleSelectAllVisible={handleToggleSelectAllVisible}
                />
              </div>

              <div className="lg:sticky lg:top-6 lg:self-start">
                <SettingsCard
                  selectedInterval={selectedInterval}
                  customIntervalInput={customIntervalInput}
                  onSelectPreset={(seconds) => {
                    setSelectedInterval(seconds);
                    setCustomIntervalInput("");
                  }}
                  onChangeCustomInterval={handleChangeCustomInterval}
                  onCreateCampaign={handleCreateCampaign}
                  isSubmitting={isSubmitting}
                />

                {isLoadingData ? (
                  <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
                    Carregando produtos e contatos...
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
                    <p>Produtos disponiveis: {products.length}</p>
                    <p className="mt-2">
                      Escopo atual: {formValues.selectAllProducts ? "todos os produtos" : "1 produto"}
                    </p>
                    <p className="mt-2">Destinatarios elegiveis: {sendableRecipients.length}</p>
                    <p className="mt-2">Selecionados nesta campanha: {selectedRecipientIds.length}</p>
                    <p className="mt-2">Selecionados com disparo real: {selectedSendableCount}</p>
                    <p className="mt-2">Selecionados sem disparo real: {selectedNonSendableCount}</p>
                    <p className="mt-2">Mensagens previstas: {estimatedMessageCount}</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {feedback ? <p className="mt-4 text-sm text-zinc-400">{feedback}</p> : null}
      </main>
    </div>
  );
}

export default function CampanhasPage() {
  return (
    <AuthGuard>
      <CampanhasPageContent />
    </AuthGuard>
  );
}
