"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProductForm, {
  type ProductFormErrors,
  type ProductFormValues,
} from "@/components/ProductForm";
import {
  calculateDiscount,
  formatCurrencyBRL,
  type ProductRecord,
  type ProductUpsertPayload,
} from "@/lib/products/client";
import { buildProductMarketingMessage } from "@/lib/products/message";

type ProductLookupResponse = ProductUpsertPayload & {
  itemId?: string;
};

type ProductModalProps = {
  open: boolean;
  onClose: () => void;
  onSave: (payload: ProductUpsertPayload) => Promise<unknown> | unknown;
  onSaveAndPublish?: (payload: ProductUpsertPayload) => Promise<unknown> | unknown;
  initialProduct?: ProductRecord | null;
};

const initialValues: ProductFormValues = {
  title: "",
  itemId: "",
  linkOriginal: "",
  linkAffiliate: "",
  linkShort: "",
  marketingMessage: "",
  price: "",
  originalPrice: "",
  image: "",
  images: [],
  description: "",
  seller: "",
  discount: null,
  hasCouponOrDiscount: false,
  couponLabel: "",
  marketplace: "mercadolivre",
};

function mapProductToFormValues(product: ProductRecord): ProductFormValues {
  return {
    title: product.title,
    itemId: product.itemId ?? "",
    linkOriginal: product.linkOriginal,
    linkAffiliate: product.linkAffiliate ?? "",
    linkShort: product.linkShort ?? "",
    marketingMessage: product.marketingMessage,
    price: String(product.price),
    originalPrice: product.originalPrice !== undefined ? String(product.originalPrice) : "",
    image: product.image,
    images: product.images,
    description: product.description,
    seller: product.seller ?? "",
    discount: product.discount ?? null,
    hasCouponOrDiscount: product.hasCouponOrDiscount,
    couponLabel: product.couponLabel ?? "",
    marketplace: "mercadolivre",
  };
}

function parseMoneyInput(raw: string, fieldLabel: string) {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const numericValue = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new Error(`${fieldLabel} invalido.`);
  }

  return Number(numericValue);
}

function mapLookupPayloadToFormValues(payload: ProductLookupResponse): ProductFormValues {
  return {
    title: payload.title,
    itemId: payload.itemId ?? "",
    linkOriginal: payload.linkOriginal,
    linkAffiliate: payload.linkAffiliate ?? "",
    linkShort: payload.linkShort ?? "",
    marketingMessage: payload.marketingMessage ?? "",
    price: String(payload.price),
    originalPrice: payload.originalPrice !== undefined ? String(payload.originalPrice) : "",
    image: payload.image,
    images: payload.images ?? [],
    description: payload.description ?? "",
    seller: payload.seller ?? "",
    discount: payload.discount ?? null,
    hasCouponOrDiscount: payload.hasCouponOrDiscount,
    couponLabel: payload.couponLabel ?? "",
    marketplace: "mercadolivre",
  };
}

function looksLikeMercadoLivreLink(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    (normalized.startsWith("http://") || normalized.startsWith("https://")) &&
    (normalized.includes("mercadolivre") ||
      normalized.includes("mercadolibre") ||
      normalized.includes("meli.la"))
  );
}

export default function ProductModal({
  open,
  onClose,
  onSave,
  onSaveAndPublish,
  initialProduct = null,
}: ProductModalProps) {
  const [lookupUrl, setLookupUrl] = useState("");
  const [lookupMessage, setLookupMessage] = useState("");
  const [isLookupLoading, setIsLookupLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isQuickPublishing, setIsQuickPublishing] = useState(false);
  const [values, setValues] = useState<ProductFormValues>(initialValues);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const isEditing = initialProduct !== null;

  const refreshDerivedValues = (nextState: ProductFormValues) => {
    try {
      const priceValue = parseMoneyInput(String(nextState.price), "Preco");
      const originalPriceValue = parseMoneyInput(String(nextState.originalPrice), "Preco original");
      nextState.discount = calculateDiscount(priceValue ?? 0, originalPriceValue) ?? null;
    } catch {
      nextState.discount = null;
    }

    nextState.hasCouponOrDiscount =
      Boolean(nextState.discount && nextState.discount > 0) ||
      nextState.couponLabel.trim().length > 0 ||
      nextState.hasCouponOrDiscount;

    const messageLink =
      nextState.linkShort.trim() || nextState.linkAffiliate.trim() || nextState.linkOriginal.trim();

    if (!nextState.marketingMessage.trim() && nextState.title.trim() && messageLink) {
      const priceValue = parseMoneyInput(String(nextState.price), "Preco");
      nextState.marketingMessage = buildProductMarketingMessage({
        title: nextState.title.trim(),
        price: priceValue ?? 0,
        link: messageLink,
      });
    }

    return nextState;
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (initialProduct) {
      setValues(mapProductToFormValues(initialProduct));
      setLookupUrl(initialProduct.linkOriginal);
      setLookupMessage("");
      setErrors({});
      return;
    }

    setLookupUrl("");
    setLookupMessage("");
    setValues(initialValues);
    setErrors({});
  }, [open, initialProduct]);

  const canSave = useMemo(() => {
    return (
      values.title.trim() !== "" &&
      values.linkOriginal.trim() !== "" &&
      values.price.trim() !== "" &&
      !isLookupLoading &&
      !isSaving &&
      !isQuickPublishing
    );
  }, [isLookupLoading, isQuickPublishing, isSaving, values]);

  const handleFieldChange = <K extends keyof ProductFormValues>(
    field: K,
    value: ProductFormValues[K],
  ) => {
    setValues((prev) => {
      const nextState = { ...prev, [field]: value };

      if (field === "linkOriginal") {
        nextState.linkAffiliate = "";
        nextState.linkShort = "";
      }

      if (
        field === "title" ||
        field === "price" ||
        field === "originalPrice" ||
        field === "couponLabel" ||
        field === "linkOriginal" ||
        field === "linkAffiliate" ||
        field === "linkShort"
      ) {
        if (field !== "couponLabel") {
          nextState.marketingMessage = "";
        }
        return refreshDerivedValues(nextState);
      }

      return nextState;
    });

    if (errors[field as keyof ProductFormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const resetState = () => {
    setLookupUrl("");
    setLookupMessage("");
    setIsLookupLoading(false);
    setIsSaving(false);
    setIsQuickPublishing(false);
    setValues(initialValues);
    setErrors({});
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const buildPayload = (sourceValues = values) => {
    const price = parseMoneyInput(sourceValues.price, "Preco");
    if (price === undefined || price <= 0) {
      throw new Error("Preco invalido.");
    }

    const originalPrice = parseMoneyInput(sourceValues.originalPrice, "Preco original");
    const discount = calculateDiscount(price, originalPrice) ?? sourceValues.discount ?? undefined;
    const image = sourceValues.image.trim();
    const mergedImages = Array.from(new Set([image, ...sourceValues.images])).filter(Boolean);
    const preferredLink =
      sourceValues.linkShort.trim() ||
      sourceValues.linkAffiliate.trim() ||
      sourceValues.linkOriginal.trim();

    return {
      title: sourceValues.title.trim(),
      itemId: sourceValues.itemId.trim() || undefined,
      link: preferredLink,
      linkOriginal: sourceValues.linkOriginal.trim(),
      linkAffiliate: sourceValues.linkAffiliate.trim() || undefined,
      linkShort: sourceValues.linkShort.trim() || undefined,
      marketingMessage:
        sourceValues.marketingMessage.trim() ||
        buildProductMarketingMessage({
          title: sourceValues.title.trim(),
          price,
          link: preferredLink,
        }),
      price,
      originalPrice,
      discount,
      hasCouponOrDiscount:
        Boolean(sourceValues.hasCouponOrDiscount) ||
        Boolean(discount && discount > 0) ||
        sourceValues.couponLabel.trim().length > 0,
      couponLabel: sourceValues.couponLabel.trim() || undefined,
      image,
      images: mergedImages,
      description: sourceValues.description.trim(),
      seller: sourceValues.seller.trim() || undefined,
      marketplace: "mercadolivre",
    } satisfies ProductUpsertPayload;
  };

  const handleLookup = async (
    lookupUrlOverride?: string,
    options?: { autoCreateAndPublish?: boolean },
  ) => {
    const url = (lookupUrlOverride ?? lookupUrl).trim();

    if (!url) {
      setLookupMessage("Digite um link para buscar os dados do produto.");
      return;
    }

    setLookupMessage("");
    setIsLookupLoading(true);

    try {
      const response = await fetch("/api/products/fetch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url, includeCoupons: true }),
      });

      const payload = (await response.json().catch(() => null)) as
        | ProductLookupResponse
        | { error?: string }
        | null;

      if (!response.ok) {
        const errorMessage =
          payload && "error" in payload ? payload.error : "Produto nao encontrado ou link invalido.";
        setLookupMessage(errorMessage ?? "Produto nao encontrado ou link invalido.");
        return;
      }

      if (!payload || !("title" in payload)) {
        setLookupMessage("Resposta invalida ao buscar produto.");
        return;
      }

      const nextValues = refreshDerivedValues(mapLookupPayloadToFormValues(payload));
      setValues(nextValues);

      if (options?.autoCreateAndPublish && !isEditing && onSaveAndPublish) {
        setLookupMessage("Produto encontrado pelo parser HTML. Cadastrando e abrindo a publicacao...");
        setIsQuickPublishing(true);
        await onSaveAndPublish(buildPayload(nextValues));
        handleClose();
        return;
      }

      setLookupMessage(
        payload.couponLabel
          ? `Produto encontrado pelo parser HTML. Promocao detectada: ${payload.couponLabel}.`
          : `Produto encontrado pelo HTML do Mercado Livre. Preco atual: ${formatCurrencyBRL(
              payload.price,
            )}.`,
      );
    } catch (error) {
      setLookupMessage(
        error instanceof Error ? error.message : "Produto nao encontrado ou link invalido.",
      );
    } finally {
      setIsLookupLoading(false);
      setIsQuickPublishing(false);
    }
  };

  const handleSave = async () => {
    const nextErrors: ProductFormErrors = {};

    if (!values.title.trim()) {
      nextErrors.title = "Nome do produto e obrigatorio.";
    }
    if (!values.linkOriginal.trim()) {
      nextErrors.linkOriginal = "Link do produto e obrigatorio.";
    }
    if (!values.price.trim()) {
      nextErrors.price = "Preco e obrigatorio.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    try {
      const payload = buildPayload();
      setIsSaving(true);
      await onSave(payload);
      handleClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel salvar o produto.";
      setLookupMessage(message);
    } finally {
      setIsSaving(false);
    }
  };

  if (!open) {
    return null;
  }

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

      <div className="glass-panel relative z-10 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl p-6 md:p-7">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-heading text-2xl font-bold text-zinc-100">
            {isEditing ? "Editar Produto" : "Novo Produto"}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300 transition hover:border-primary/40 hover:text-primary"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mb-6 rounded-xl border border-white/10 bg-[#0d1420]/80 p-4">
          <p className="text-sm font-medium text-zinc-100">Importacao por HTML inteligente do Mercado Livre</p>
          <p className="mt-1 text-xs text-zinc-400">
            Cole o link do produto para preencher os dados extraidos do HTML, gerar o link de afiliado e
            tentar criar o link curto `meli.la`.
          </p>

          <label className="mb-2 mt-4 block text-sm font-medium text-zinc-200">Link do produto</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={lookupUrl}
              onChange={(event) => setLookupUrl(event.target.value)}
              onPaste={(event) => {
                if (isEditing) {
                  return;
                }

                const pastedText = event.clipboardData.getData("text");
                if (!looksLikeMercadoLivreLink(pastedText)) {
                  return;
                }

                event.preventDefault();
                setLookupUrl(pastedText);
                void handleLookup(pastedText, { autoCreateAndPublish: true });
              }}
              placeholder="https://produto.mercadolivre.com.br/... ou https://meli.la/..."
              className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
            />
            <Button
              type="button"
              variant="secondary"
              className="h-11 rounded-lg px-4 hover:border-primary/40 hover:text-primary"
              onClick={() => void handleLookup()}
              disabled={isLookupLoading}
            >
              {isLookupLoading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              Buscar Produto
            </Button>
          </div>

          {!isEditing && onSaveAndPublish ? (
            <Button
              type="button"
              className="mt-3 h-11 rounded-lg px-4"
              onClick={() => void handleLookup(undefined, { autoCreateAndPublish: true })}
              disabled={isLookupLoading || isSaving || isQuickPublishing}
            >
              {isLookupLoading || isQuickPublishing ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              Buscar e Publicar ML
            </Button>
          ) : null}

          <p className="mt-2 text-xs text-zinc-500">
            A leitura do produto usa HTML publico. Credencial ativa fica opcional apenas para
            afiliado, link curto e publicacao.
          </p>
          {lookupMessage ? <p className="mt-2 text-xs text-zinc-400">{lookupMessage}</p> : null}
        </div>

        {values.image ? (
          <div className="mb-6 rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
              Preview da imagem
            </p>
            <img
              src={values.image}
              alt={values.title || "Imagem do produto"}
              className="h-[300px] w-[300px] rounded-lg object-cover"
            />
          </div>
        ) : null}

        <ProductForm values={values} errors={errors} onFieldChange={handleFieldChange} />

        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} disabled={!canSave}>
            {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {isEditing ? "Salvar Alteracoes" : "Salvar Produto"}
          </Button>
        </div>
      </div>
    </div>
  );
}
