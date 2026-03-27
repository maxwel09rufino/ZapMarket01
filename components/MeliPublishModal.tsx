"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ExternalLink,
  Loader2,
  PackageCheck,
  RefreshCcw,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  MeliPublicationDraft,
  MeliPublicationDraftEntry,
  MeliPublicationField,
  MeliPublicationPrepareResponse,
  MeliPublicationPublishResponse,
  MeliPublicationValidationCause,
  MeliPublicationValidationResponse,
} from "@/lib/meli/publications-client";
import type { ProductRecord } from "@/lib/products/client";

type ApiError = {
  error?: string;
  message?: string;
  causes?: MeliPublicationValidationCause[];
};

type MeliPublishModalProps = {
  open: boolean;
  product: ProductRecord | null;
  onClose: () => void;
  onPublished: (result: MeliPublicationPublishResponse) => void;
};

function getApiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  if ("error" in payload && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }

  if ("message" in payload && typeof payload.message === "string" && payload.message.trim()) {
    return payload.message;
  }

  return fallback;
}

function getApiCauses(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("causes" in payload)) {
    return [] as MeliPublicationValidationCause[];
  }

  return Array.isArray(payload.causes) ? payload.causes : [];
}

function entryHasValue(entry: MeliPublicationDraftEntry | undefined) {
  if (!entry) {
    return false;
  }

  return Boolean(
    (entry.valueId ?? "").trim() ||
      (entry.valueName ?? "").trim() ||
      (entry.unit ?? "").trim() ||
      entry.values?.some((value) => value.trim().length > 0),
  );
}

function mergeEntries(
  freshEntries: MeliPublicationDraftEntry[],
  previousEntries: MeliPublicationDraftEntry[],
) {
  return freshEntries.map((entry) => {
    const previous = previousEntries.find(
      (candidate) => candidate.scope === entry.scope && candidate.id === entry.id,
    );

    return previous && entryHasValue(previous) ? { ...entry, ...previous } : entry;
  });
}

function pickConditionOption(field: MeliPublicationField, condition: MeliPublicationDraft["condition"]) {
  return (
    field.options.find((option) => {
      const normalized = option.name.toLowerCase();
      return (
        (condition === "new" && (normalized.includes("novo") || normalized.includes("new"))) ||
        (condition === "used" && (normalized.includes("usado") || normalized.includes("used"))) ||
        (condition === "not_specified" &&
          (normalized.includes("nao especificado") || normalized.includes("not specified")))
      );
    }) ?? null
  );
}

function mergeDraft(
  previousDraft: MeliPublicationDraft | null,
  nextDraft: MeliPublicationDraft,
  listingTypeIds: string[],
) {
  if (!previousDraft) {
    return nextDraft;
  }

  return {
    ...nextDraft,
    title: previousDraft.title || nextDraft.title,
    price: previousDraft.price || nextDraft.price,
    availableQuantity: previousDraft.availableQuantity || nextDraft.availableQuantity,
    description: previousDraft.description || nextDraft.description,
    pictures: previousDraft.pictures.length > 0 ? previousDraft.pictures : nextDraft.pictures,
    condition: previousDraft.condition,
    listingTypeId: listingTypeIds.includes(previousDraft.listingTypeId)
      ? previousDraft.listingTypeId
      : nextDraft.listingTypeId,
    attributes: mergeEntries(nextDraft.attributes, previousDraft.attributes),
    saleTerms: mergeEntries(nextDraft.saleTerms, previousDraft.saleTerms),
  };
}

function statusLabel(status?: string) {
  const normalized = (status ?? "").trim().toLowerCase();
  if (!normalized) {
    return "Nao publicado";
  }

  if (normalized === "active") {
    return "Ativo";
  }
  if (normalized === "paused") {
    return "Pausado";
  }
  if (normalized === "closed") {
    return "Encerrado";
  }

  return normalized;
}

function fieldInputValue(entry: MeliPublicationDraftEntry | undefined) {
  return entry?.valueName ?? "";
}

export default function MeliPublishModal({
  open,
  product,
  onClose,
  onPublished,
}: MeliPublishModalProps) {
  const [prepareData, setPrepareData] = useState<MeliPublicationPrepareResponse | null>(null);
  const [draft, setDraft] = useState<MeliPublicationDraft | null>(null);
  const [feedback, setFeedback] = useState("");
  const [validation, setValidation] = useState<MeliPublicationValidationResponse | null>(null);
  const [validationCauses, setValidationCauses] = useState<MeliPublicationValidationCause[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isReloadingCategory, setIsReloadingCategory] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  const groupedAttributeFields = useMemo(() => {
    const groups = new Map<string, MeliPublicationField[]>();

    for (const field of prepareData?.attributeFields ?? []) {
      const key = field.groupName ?? "Atributos obrigatorios";
      groups.set(key, [...(groups.get(key) ?? []), field]);
    }

    return Array.from(groups.entries());
  }, [prepareData?.attributeFields]);

  useEffect(() => {
    if (!open || !product) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setFeedback("");
      setValidation(null);
      setValidationCauses([]);

      try {
        const response = await fetch("/api/meli/publications/prepare", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ productId: product.id }),
        });

        const payload = (await response.json().catch(() => null)) as
          | MeliPublicationPrepareResponse
          | ApiError
          | null;

        if (!response.ok) {
          throw new Error(
            getApiErrorMessage(payload, "Nao foi possivel preparar a publicacao."),
          );
        }

        if (!payload || !("draft" in payload)) {
          throw new Error("Resposta invalida ao preparar a publicacao.");
        }

        if (!cancelled) {
          setPrepareData(payload);
          setDraft(payload.draft);
        }
      } catch (error) {
        if (!cancelled) {
          setFeedback(error instanceof Error ? error.message : "Nao foi possivel preparar a publicacao.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [open, product]);

  if (!open || !product) {
    return null;
  }

  const handleClose = () => {
    setPrepareData(null);
    setDraft(null);
    setFeedback("");
    setValidation(null);
    setValidationCauses([]);
    setIsLoading(false);
    setIsReloadingCategory(false);
    setIsValidating(false);
    setIsPublishing(false);
    onClose();
  };

  const updateDraft = (updater: (current: MeliPublicationDraft) => MeliPublicationDraft) => {
    setDraft((current) => (current ? updater(current) : current));
  };

  const reloadCategoryContext = async (categoryId: string) => {
    if (!product) {
      return;
    }

    setIsReloadingCategory(true);
    setFeedback("");

    try {
      const response = await fetch("/api/meli/publications/prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ productId: product.id, categoryId }),
      });

      const payload = (await response.json().catch(() => null)) as
        | MeliPublicationPrepareResponse
        | ApiError
        | null;

      if (!response.ok) {
        throw new Error(
          getApiErrorMessage(payload, "Nao foi possivel recarregar a categoria."),
        );
      }

      if (!payload || !("draft" in payload)) {
        throw new Error("Resposta invalida ao atualizar a categoria.");
      }

      setPrepareData(payload);
      setDraft((currentDraft) =>
        mergeDraft(currentDraft, payload.draft, payload.listingTypes.map((entry) => entry.id)),
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel recarregar a categoria.");
    } finally {
      setIsReloadingCategory(false);
    }
  };

  const handleEntryChange = (
    field: MeliPublicationField,
    updates: Partial<MeliPublicationDraftEntry>,
  ) => {
    updateDraft((currentDraft) => {
      const sourceEntries =
        field.scope === "attribute" ? currentDraft.attributes : currentDraft.saleTerms;
      const nextEntry: MeliPublicationDraftEntry = {
        id: field.id,
        scope: field.scope,
        valueType: field.valueType,
        ...sourceEntries.find((entry) => entry.id === field.id && entry.scope === field.scope),
        ...updates,
      };

      const nextEntries = [
        ...sourceEntries.filter((entry) => !(entry.id === field.id && entry.scope === field.scope)),
        nextEntry,
      ];

      return {
        ...currentDraft,
        attributes: field.scope === "attribute" ? nextEntries : currentDraft.attributes,
        saleTerms: field.scope === "sale_term" ? nextEntries : currentDraft.saleTerms,
      };
    });
  };

  const syncConditionAttribute = (nextCondition: MeliPublicationDraft["condition"]) => {
    const conditionField = prepareData?.attributeFields.find((field) => field.id === "ITEM_CONDITION");
    if (!conditionField) {
      return;
    }

    const option = pickConditionOption(conditionField, nextCondition);
    if (!option) {
      return;
    }

    handleEntryChange(conditionField, {
      valueId: option.id,
      valueName: option.name,
      values: undefined,
    });
  };

  const handleValidate = async () => {
    if (!draft) {
      return;
    }

    setIsValidating(true);
    setFeedback("");
    setValidation(null);
    setValidationCauses([]);

    try {
      const response = await fetch("/api/meli/publications/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ draft }),
      });

      const payload = (await response.json().catch(() => null)) as
        | MeliPublicationValidationResponse
        | ApiError
        | null;

      if (!response.ok) {
        setValidation(null);
        setValidationCauses(getApiCauses(payload));
        throw new Error(
          getApiErrorMessage(payload, "Nao foi possivel validar a publicacao."),
        );
      }

      if (!payload || !("valid" in payload)) {
        throw new Error("Resposta invalida ao validar a publicacao.");
      }

      setValidation(payload);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel validar a publicacao.");
    } finally {
      setIsValidating(false);
    }
  };

  const handlePublish = async () => {
    if (!draft) {
      return;
    }

    setIsPublishing(true);
    setFeedback("");

    try {
      const response = await fetch("/api/meli/publications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ draft }),
      });

      const payload = (await response.json().catch(() => null)) as
        | MeliPublicationPublishResponse
        | ApiError
        | null;

      if (!response.ok) {
        setValidationCauses(getApiCauses(payload));
        throw new Error(getApiErrorMessage(payload, "Nao foi possivel publicar o item."));
      }

      if (!payload || !("item" in payload)) {
        throw new Error("Resposta invalida ao publicar o item.");
      }

      onPublished(payload);
      handleClose();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel publicar o item.");
    } finally {
      setIsPublishing(false);
    }
  };

  const renderField = (field: MeliPublicationField) => {
    const currentEntry =
      draft?.[field.scope === "attribute" ? "attributes" : "saleTerms"].find(
        (entry) => entry.id === field.id && entry.scope === field.scope,
      ) ?? undefined;

    if (field.options.length > 0 && !field.multivalued) {
      return (
        <select
          value={currentEntry?.valueId ?? ""}
          onChange={(event) => {
            const option = field.options.find((entry) => entry.id === event.target.value);
            handleEntryChange(field, {
              valueId: option?.id || undefined,
              valueName: option?.name || undefined,
            });
          }}
          className="h-11 w-full rounded-lg border border-white/10 bg-[#1f2937] px-3 text-sm text-zinc-100 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/30"
        >
          <option value="">Selecione</option>
          {field.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      );
    }

    if (field.valueType === "number_unit") {
      return (
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <Input
            value={fieldInputValue(currentEntry)}
            onChange={(event) =>
              handleEntryChange(field, {
                valueName: event.target.value,
              })
            }
            placeholder="Digite o valor"
            className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
          />
          <select
            value={currentEntry?.unit ?? field.defaultUnit ?? ""}
            onChange={(event) => handleEntryChange(field, { unit: event.target.value })}
            className="h-11 w-full rounded-lg border border-white/10 bg-[#1f2937] px-3 text-sm text-zinc-100 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/30"
          >
            <option value="">Selecione</option>
            {field.allowedUnits.map((unit) => (
              <option key={unit.id} value={unit.name}>
                {unit.name}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (field.multivalued) {
      return (
        <Input
          value={currentEntry?.values?.join(", ") ?? ""}
          onChange={(event) =>
            handleEntryChange(field, {
              values: event.target.value
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
              valueId: undefined,
              valueName: undefined,
            })
          }
          placeholder="Separe os valores por virgula"
          className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
        />
      );
    }

    return (
      <Input
        value={fieldInputValue(currentEntry)}
        onChange={(event) =>
          handleEntryChange(field, {
            valueName: event.target.value,
            valueId: undefined,
          })
        }
        placeholder={field.hint ?? "Digite o valor"}
        className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
      />
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        className="absolute inset-0"
        role="button"
        tabIndex={0}
        aria-label="Fechar modal"
        onClick={handleClose}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            handleClose();
          }
        }}
      />

      <div className="glass-panel relative z-10 max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl p-6 md:p-7">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">
              <Upload className="size-3.5" />
              Publicacao oficial Mercado Livre
            </div>
            <h2 className="font-heading text-2xl font-bold text-zinc-100">Publicar produto</h2>
            <p className="text-sm text-zinc-400">
              A publicacao usa apenas a API oficial, com categoria prevista, atributos da categoria e
              validacao antes do envio.
            </p>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300 transition hover:border-primary/40 hover:text-primary"
          >
            <X className="size-4" />
          </button>
        </div>

        {isLoading || !draft || !prepareData ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-zinc-300">
            <div className="flex items-center gap-3">
              <Loader2 className="size-4 animate-spin" />
              Carregando contexto de publicacao...
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="rounded-2xl border border-white/10 bg-[#0d1420]/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Produto selecionado
                </p>
                <h3 className="mt-2 text-lg font-semibold text-zinc-100">{product.title}</h3>
                <p className="mt-2 text-sm text-zinc-400">
                  {prepareData.credential.meliNickname ||
                    prepareData.credential.name ||
                    "Credencial ativa"}{" "}
                  • Site {prepareData.credential.siteId}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#0d1420]/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Status atual
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge className="bg-emerald-500/15 text-emerald-200">
                    {statusLabel(prepareData.publishedItem?.status ?? product.meliPublication?.status)}
                  </Badge>
                  {prepareData.publishedItem?.id ? (
                    <Badge variant="secondary" className="border-white/10 text-zinc-300">
                      {prepareData.publishedItem.id}
                    </Badge>
                  ) : null}
                </div>
                {prepareData.publishedItem?.permalink ? (
                  <a
                    href={prepareData.publishedItem.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80"
                  >
                    Abrir anuncio atual
                    <ExternalLink className="size-4" />
                  </a>
                ) : (
                  <p className="mt-3 text-sm text-zinc-500">Esse produto ainda nao foi publicado.</p>
                )}
              </div>
            </div>

            {prepareData.warnings.length > 0 ? (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <AlertCircle className="size-4" />
                  Pontos de atencao antes da publicacao
                </div>
                <div className="space-y-1 text-xs">
                  {prepareData.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              </div>
            ) : null}

            {feedback ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
                {feedback}
              </div>
            ) : null}

            {validation ? (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                <div className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="size-4" />
                  {validation.message}
                </div>
              </div>
            ) : null}

            {validationCauses.length > 0 ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
                <p className="font-medium">Validacao com pendencias</p>
                <div className="mt-2 space-y-1 text-xs">
                  {validationCauses.map((cause, index) => (
                    <p key={`${cause.message}-${index}`}>{cause.message}</p>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-200">Titulo do anuncio</label>
                <Input
                  value={draft.title}
                  onChange={(event) =>
                    updateDraft((currentDraft) => ({ ...currentDraft, title: event.target.value }))
                  }
                  className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-200">Categoria</label>
                <div className="flex gap-3">
                  <select
                    value={draft.categoryId}
                    onChange={(event) => void reloadCategoryContext(event.target.value)}
                    className="h-11 w-full rounded-lg border border-white/10 bg-[#1f2937] px-3 text-sm text-zinc-100 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/30"
                    disabled={isReloadingCategory}
                  >
                    {prepareData.categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-11 rounded-lg px-4"
                    onClick={() => void reloadCategoryContext(draft.categoryId)}
                    disabled={isReloadingCategory}
                  >
                    {isReloadingCategory ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCcw className="size-4" />
                    )}
                    Recarregar
                  </Button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-200">Tipo de anuncio</label>
                <select
                  value={draft.listingTypeId}
                  onChange={(event) =>
                    updateDraft((currentDraft) => ({
                      ...currentDraft,
                      listingTypeId: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-lg border border-white/10 bg-[#1f2937] px-3 text-sm text-zinc-100 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">Selecione</option>
                  {prepareData.listingTypes.map((listingType) => (
                    <option key={listingType.id} value={listingType.id}>
                      {listingType.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-200">Condicao do item</label>
                <select
                  value={draft.condition}
                  onChange={(event) => {
                    const nextCondition = event.target.value as MeliPublicationDraft["condition"];
                    updateDraft((currentDraft) => ({
                      ...currentDraft,
                      condition: nextCondition,
                    }));
                    syncConditionAttribute(nextCondition);
                  }}
                  className="h-11 w-full rounded-lg border border-white/10 bg-[#1f2937] px-3 text-sm text-zinc-100 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/30"
                >
                  <option value="new">Novo</option>
                  <option value="used">Usado</option>
                  <option value="not_specified">Nao especificado</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-200">Preco</label>
                <Input
                  value={String(draft.price)}
                  onChange={(event) =>
                    updateDraft((currentDraft) => ({
                      ...currentDraft,
                      price: Number(event.target.value.replace(",", ".")) || 0,
                    }))
                  }
                  className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-200">Quantidade</label>
                <Input
                  value={String(draft.availableQuantity)}
                  onChange={(event) =>
                    updateDraft((currentDraft) => ({
                      ...currentDraft,
                      availableQuantity: Math.max(
                        1,
                        Number(event.target.value.replace(/\D/g, "")) || 1,
                      ),
                    }))
                  }
                  className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-200">URLs das imagens</label>
              <textarea
                value={draft.pictures.join("\n")}
                onChange={(event) =>
                  updateDraft((currentDraft) => ({
                    ...currentDraft,
                    pictures: event.target.value
                      .split("\n")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  }))
                }
                rows={4}
                className="w-full rounded-lg border border-white/10 bg-[#1f2937] p-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-primary/60 focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-200">Descricao</label>
              <textarea
                value={draft.description}
                onChange={(event) =>
                  updateDraft((currentDraft) => ({
                    ...currentDraft,
                    description: event.target.value,
                  }))
                }
                rows={5}
                className="w-full rounded-lg border border-white/10 bg-[#1f2937] p-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-primary/60 focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {groupedAttributeFields.map(([groupName, fields]) => (
              <section key={groupName} className="rounded-2xl border border-white/10 bg-[#0d1420]/70 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-400">{groupName}</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {fields.map((field) => (
                    <div key={field.id} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-zinc-100">{field.name}</label>
                        {field.required ? (
                          <Badge variant="secondary" className="border-red-500/30 text-red-200">
                            Obrigatorio
                          </Badge>
                        ) : null}
                      </div>
                      {renderField(field)}
                      {field.hint ? <p className="text-xs text-zinc-500">{field.hint}</p> : null}
                    </div>
                  ))}
                </div>
              </section>
            ))}

            {prepareData.saleTermFields.length > 0 ? (
              <section className="rounded-2xl border border-white/10 bg-[#0d1420]/70 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-400">
                  Condicoes da venda
                </h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {prepareData.saleTermFields.map((field) => (
                    <div key={field.id} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-zinc-100">{field.name}</label>
                        {field.required ? (
                          <Badge variant="secondary" className="border-red-500/30 text-red-200">
                            Obrigatorio
                          </Badge>
                        ) : null}
                      </div>
                      {renderField(field)}
                      {field.hint ? <p className="text-xs text-zinc-500">{field.hint}</p> : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="secondary" onClick={handleClose}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="border-primary/30 text-primary hover:text-primary"
                onClick={() => void handleValidate()}
                disabled={isValidating || isPublishing}
              >
                {isValidating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                Validar publicacao
              </Button>
              <Button
                type="button"
                onClick={() => void handlePublish()}
                disabled={isPublishing || isValidating || isLoading}
              >
                {isPublishing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <PackageCheck className="size-4" />
                )}
                Publicar no Mercado Livre
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
