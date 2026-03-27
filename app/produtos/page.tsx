"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Copy,
  ExternalLink,
  Link2,
  ListOrdered,
  Loader2,
  PackageSearch,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import BackButton from "@/components/BackButton";
import MeliPublishModal from "@/components/MeliPublishModal";
import ProductModal from "@/components/ProductModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  formatCurrencyBRL,
  getProductOfferLabel,
  type ProductRecord,
  type ProductUpsertPayload,
} from "@/lib/products/client";
import type { ProductImportJobSnapshot } from "@/lib/products/import";
import {
  normalizeMercadoLivreImportSource,
  normalizeMercadoLivreShortImportSource,
  stripMercadoLivreImportLinePrefix,
} from "@/lib/products/importSource";
import { isMercadoLivreSearchUrl } from "@/lib/products/mercadoLivreSearchLink";
import type { MeliPublicationPublishResponse } from "@/lib/meli/publications-client";
import { subscribeToSoftRefresh } from "@/lib/autoRefresh";

type ApiErrorResponse = {
  error?: string;
};

type DeleteAllResponse = {
  success: boolean;
  deletedCount?: number;
};

type SearchLinksResponse = {
  sourceUrl?: string;
  normalizedUrl?: string;
  searchTerm?: string;
  totalProducts?: number;
  total_produtos?: number;
  productLinks?: string[];
};

function isSearchLinksResponse(
  value: SearchLinksResponse | ApiErrorResponse | null,
): value is SearchLinksResponse {
  const candidate = value as SearchLinksResponse | null;
  return Boolean(
    candidate &&
      (Array.isArray(candidate.productLinks) ||
        typeof candidate.totalProducts === "number" ||
        typeof candidate.total_produtos === "number"),
  );
}

type ParsedImportLine = {
  lineNumber: number;
  position: number;
  value: string;
  normalizedValue: string | null;
  error?: string;
};

type ImportEditorLine = {
  lineNumber: number;
  label: string;
  isInvalid: boolean;
};

type SyncedImportEditorProps = {
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled: boolean;
  lines: ImportEditorLine[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  gutterRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
};

function parseImportEntries(text: string) {
  return text
    .split(/\r?\n/)
    .map((entry) => stripMercadoLivreImportLinePrefix(entry).trim())
    .filter(Boolean);
}

function parseProductImportLines(text: string) {
  const rawLines = text.split(/\r?\n/);
  const parsedLines: ParsedImportLine[] = [];
  let position = 0;

  rawLines.forEach((rawLine, index) => {
    const value = stripMercadoLivreImportLinePrefix(rawLine).trim();
    if (!value) {
      return;
    }

    position += 1;
    const normalizedValue = normalizeMercadoLivreImportSource(value);
    parsedLines.push({
      lineNumber: index + 1,
      position,
      value,
      normalizedValue,
      error: normalizedValue ? undefined : `Linha ${index + 1} invalida para link do produto.`,
    });
  });

  return parsedLines;
}

function parseShortImportLines(text: string) {
  const rawLines = text.split(/\r?\n/);
  const parsedLines: ParsedImportLine[] = [];
  let position = 0;

  rawLines.forEach((rawLine, index) => {
    const value = stripMercadoLivreImportLinePrefix(rawLine).trim();
    if (!value) {
      return;
    }

    position += 1;
    const normalizedValue = normalizeMercadoLivreShortImportSource(value);
    parsedLines.push({
      lineNumber: index + 1,
      position,
      value,
      normalizedValue,
      error: normalizedValue ? undefined : `Linha ${index + 1} invalida para link afiliado meli.la.`,
    });
  });

  return parsedLines;
}

function buildImportEditorLines(
  text: string,
  kind: "product" | "short",
): ImportEditorLine[] {
  const rawLines = text.split(/\r?\n/);
  const visualLines: ImportEditorLine[] = [];
  let position = 0;

  rawLines.forEach((rawLine, index) => {
    const value = stripMercadoLivreImportLinePrefix(rawLine).trim();
    if (!value) {
      visualLines.push({
        lineNumber: index + 1,
        label: "",
        isInvalid: false,
      });
      return;
    }

    position += 1;
    const normalizedValue =
      kind === "product"
        ? normalizeMercadoLivreImportSource(value)
        : normalizeMercadoLivreShortImportSource(value);

    visualLines.push({
      lineNumber: index + 1,
      label: String(position),
      isInvalid: !normalizedValue,
    });
  });

  return visualLines.length > 0
    ? visualLines
    : [
        {
          lineNumber: 1,
          label: "1",
          isInvalid: false,
        },
      ];
}

function applyAutomaticNumbering(text: string) {
  const rawLines = text.split(/\r?\n/);
  let position = 0;

  return rawLines
    .map((rawLine) => {
      const value = stripMercadoLivreImportLinePrefix(rawLine).trim();
      if (!value) {
        return "";
      }

      position += 1;
      return `${position}. ${value}`;
    })
    .join("\n");
}

function formatImportDateTime(value: string | undefined) {
  if (!value) {
    return "--";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "--";
  }

  return parsed.toLocaleString("pt-BR");
}

function SyncedImportEditor({
  label,
  description,
  value,
  onChange,
  placeholder,
  disabled,
  lines,
  textareaRef,
  gutterRef,
  onScroll,
}: SyncedImportEditorProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0f1724]/90">
      <div className="border-b border-white/10 px-4 py-3">
        <p className="text-sm font-semibold text-zinc-100">{label}</p>
        <p className="mt-1 text-xs text-zinc-500">{description}</p>
      </div>

      <div className="flex min-h-[280px]">
        <div
          ref={gutterRef}
          className="max-h-[360px] min-w-12 overflow-hidden border-r border-white/10 bg-black/10 px-2 py-4 text-right text-xs text-zinc-500"
          aria-hidden="true"
        >
          {lines.map((line) => (
            <div
              key={`${label}-${line.lineNumber}`}
              className={`h-[22px] leading-[22px] ${line.isInvalid ? "text-red-300" : ""}`}
            >
              {line.label}
            </div>
          ))}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onScroll={onScroll}
          rows={12}
          placeholder={placeholder}
          disabled={disabled}
          className="max-h-[360px] min-h-[280px] flex-1 resize-none overflow-y-auto bg-transparent px-4 py-4 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-70"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function ProdutosPageContent() {
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);
  const [publishingProduct, setPublishingProduct] = useState<ProductRecord | null>(null);
  const [importInput, setImportInput] = useState("");
  const [affiliateImportInput, setAffiliateImportInput] = useState("");
  const [pendingAction, setPendingAction] = useState<"generate-links" | "import-products" | null>(
    null,
  );
  const [importJob, setImportJob] = useState<ProductImportJobSnapshot | null>(null);
  const [generatedLinks, setGeneratedLinks] = useState<string[]>([]);
  const [generatedLinksMeta, setGeneratedLinksMeta] = useState<{
    sourceUrl?: string;
    normalizedUrl?: string;
    searchTerm?: string;
    totalProducts: number;
  } | null>(null);
  const [showSearchImportJob, setShowSearchImportJob] = useState(false);
  const [feedback, setFeedback] = useState("");
  const handledImportOutcomeRef = useRef<string | null>(null);
  const syncScrollLockRef = useRef(false);
  const productTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const productGutterRef = useRef<HTMLDivElement | null>(null);
  const affiliateTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const affiliateGutterRef = useRef<HTMLDivElement | null>(null);

  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [products],
  );
  const inputEntries = useMemo(() => parseImportEntries(importInput), [importInput]);
  const affiliateEntries = useMemo(
    () => parseImportEntries(affiliateImportInput),
    [affiliateImportInput],
  );
  const parsedProductLines = useMemo(() => parseProductImportLines(importInput), [importInput]);
  const parsedAffiliateLines = useMemo(
    () => parseShortImportLines(affiliateImportInput),
    [affiliateImportInput],
  );
  const productEditorLines = useMemo(
    () => buildImportEditorLines(importInput, "product"),
    [importInput],
  );
  const affiliateEditorLines = useMemo(
    () => buildImportEditorLines(affiliateImportInput, "short"),
    [affiliateImportInput],
  );
  const searchSourceUrl = useMemo(
    () =>
      affiliateEntries.length === 0 &&
      inputEntries.length === 1 &&
      isMercadoLivreSearchUrl(inputEntries[0])
        ? inputEntries[0]
        : "",
    [affiliateEntries.length, inputEntries],
  );
  const isSearchInputMode = searchSourceUrl.length > 0;
  const hasAffiliateInput = affiliateEntries.length > 0 || affiliateImportInput.trim().length > 0;
  const invalidProductLine = useMemo(
    () => parsedProductLines.find((line) => !line.normalizedValue) ?? null,
    [parsedProductLines],
  );
  const invalidAffiliateLine = useMemo(
    () => parsedAffiliateLines.find((line) => !line.normalizedValue) ?? null,
    [parsedAffiliateLines],
  );
  const importSyncError = useMemo(() => {
    if (isSearchInputMode || !hasAffiliateInput) {
      return null;
    }

    if (parsedProductLines.length !== parsedAffiliateLines.length) {
      return `Quantidade de links nao bate: ${parsedProductLines.length} produto(s) e ${parsedAffiliateLines.length} afiliado(s).`;
    }

    if (invalidProductLine) {
      return invalidProductLine.error ?? "Existe um link de produto invalido.";
    }

    if (invalidAffiliateLine) {
      return invalidAffiliateLine.error ?? "Existe um link afiliado invalido.";
    }

    return null;
  }, [
    hasAffiliateInput,
    invalidAffiliateLine,
    invalidProductLine,
    isSearchInputMode,
    parsedAffiliateLines.length,
    parsedProductLines.length,
  ]);
  const importPreviewRows = useMemo(() => {
    if (isSearchInputMode) {
      return [];
    }

    const maxRows = Math.max(parsedProductLines.length, parsedAffiliateLines.length);
    return Array.from({ length: maxRows }, (_, index) => {
      const productLine = parsedProductLines[index] ?? null;
      const affiliateLine = parsedAffiliateLines[index] ?? null;
      let status = "ok";
      let message = "Pronto para importar.";

      if (!productLine) {
        status = "error";
        message = "Falta o link do produto nesta posicao.";
      } else if (!affiliateLine && hasAffiliateInput) {
        status = "error";
        message = "Falta o link meli.la correspondente.";
      } else if (productLine.error || affiliateLine?.error) {
        status = "error";
        message = productLine.error ?? affiliateLine?.error ?? "Linha invalida.";
      } else if (!hasAffiliateInput) {
        message = "Importacao simples.";
      }

      return {
        position: index + 1,
        productValue: productLine?.value ?? "",
        affiliateValue: affiliateLine?.value ?? "",
        status,
        message,
      };
    }).slice(0, 12);
  }, [hasAffiliateInput, isSearchInputMode, parsedAffiliateLines, parsedProductLines]);
  const generatedLinksText = useMemo(() => generatedLinks.join("\n"), [generatedLinks]);
  const isGeneratingLinks = pendingAction === "generate-links";
  const isImportingProducts = pendingAction === "import-products";
  const visibleImportJob =
    !isSearchInputMode || showSearchImportJob ? importJob : null;

  const importProgress = useMemo(() => {
    if (!visibleImportJob) {
      return 0;
    }

    if (visibleImportJob.queuedProducts <= 0) {
      return visibleImportJob.status === "completed" ? 100 : 0;
    }

    return Math.min(
      100,
      Math.round((visibleImportJob.processedCount / visibleImportJob.queuedProducts) * 100),
    );
  }, [visibleImportJob]);

  const loadProducts = useCallback(async (showLoader = true) => {
    if (showLoader) {
      setIsLoading(true);
    }

    try {
      const response = await fetch("/api/products", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Nao foi possivel carregar os produtos.");
      }

      const payload = (await response.json()) as ProductRecord[];
      setProducts(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao carregar os produtos.");
    } finally {
      if (showLoader) {
        setIsLoading(false);
      }
    }
  }, []);

  const loadImportJob = useCallback(async () => {
    try {
      const response = await fetch("/importar-produtos", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Nao foi possivel consultar a importacao em andamento.");
      }

      const payload = (await response.json().catch(() => null)) as ProductImportJobSnapshot | null;
      setImportJob(payload && typeof payload === "object" ? payload : null);
    } catch {
      // Mantem o ultimo estado conhecido se a consulta falhar.
    }
  }, []);

  useEffect(() => {
    void loadProducts();
    void loadImportJob();

    return subscribeToSoftRefresh(() => {
      void loadProducts(false);
      void loadImportJob();
    });
  }, [loadImportJob, loadProducts]);

  useEffect(() => {
    if (importJob?.status !== "running") {
      return;
    }

    const interval = setInterval(() => {
      void loadImportJob();
    }, 2000);

    return () => clearInterval(interval);
  }, [importJob?.id, importJob?.status, loadImportJob]);

  useEffect(() => {
    if (!importJob || importJob.status === "running") {
      return;
    }

    if (isSearchInputMode && !showSearchImportJob) {
      return;
    }

    const outcomeKey = `${importJob.id}:${importJob.status}`;
    if (handledImportOutcomeRef.current === outcomeKey) {
      return;
    }

    handledImportOutcomeRef.current = outcomeKey;
    setFeedback(importJob.message);
    void loadProducts();
  }, [importJob, isSearchInputMode, loadProducts, showSearchImportJob]);

  useEffect(() => {
    setGeneratedLinks([]);
    setGeneratedLinksMeta(null);
    setShowSearchImportJob(false);
  }, [searchSourceUrl]);

  const upsertProductInState = (product: ProductRecord) => {
    setProducts((previous) => {
      const next = previous.filter((entry) => entry.id !== product.id);
      return [product, ...next];
    });
  };

  const fetchSearchLinks = async () => {
    const searchParams = new URLSearchParams({
      url: searchSourceUrl,
      collect: "true",
      maxProducts: "200",
    });
    const response = await fetch(`/api/meli/search?${searchParams.toString()}`, {
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | SearchLinksResponse
      | ApiErrorResponse
      | null;

    if (!response.ok) {
      const message =
        payload && "error" in payload ? payload.error : "Nao foi possivel gerar a lista de links.";
      throw new Error(message ?? "Nao foi possivel gerar a lista de links.");
    }

    const searchPayload = isSearchLinksResponse(payload) ? payload : null;
    const productLinks = Array.isArray(searchPayload?.productLinks)
      ? searchPayload.productLinks.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : [];

    if (productLinks.length === 0) {
      throw new Error("Nenhum link de produto foi encontrado para essa busca.");
    }

    return {
      productLinks,
      meta: {
        sourceUrl: searchPayload?.sourceUrl,
        normalizedUrl: searchPayload?.normalizedUrl,
        searchTerm: searchPayload?.searchTerm,
        totalProducts:
          typeof searchPayload?.totalProducts === "number"
            ? searchPayload.totalProducts
            : typeof searchPayload?.total_produtos === "number"
              ? searchPayload.total_produtos
              : productLinks.length,
      },
    };
  };

  const applyGeneratedLinks = (result: {
    productLinks: string[];
    meta: {
      sourceUrl?: string;
      normalizedUrl?: string;
      searchTerm?: string;
      totalProducts: number;
    };
  }) => {
    setGeneratedLinks(result.productLinks);
    setGeneratedLinksMeta(result.meta);
  };

  const syncEditorScroll = useCallback(
    (
      sourceTextarea: HTMLTextAreaElement | null,
      targetTextarea: HTMLTextAreaElement | null,
      sourceGutter: HTMLDivElement | null,
      targetGutter: HTMLDivElement | null,
    ) => {
      if (!sourceTextarea || syncScrollLockRef.current) {
        return;
      }

      syncScrollLockRef.current = true;

      if (sourceGutter) {
        sourceGutter.scrollTop = sourceTextarea.scrollTop;
      }

      if (targetTextarea) {
        targetTextarea.scrollTop = sourceTextarea.scrollTop;
      }

      if (targetGutter) {
        targetGutter.scrollTop = sourceTextarea.scrollTop;
      }

      requestAnimationFrame(() => {
        syncScrollLockRef.current = false;
      });
    },
    [],
  );

  const handleProductEditorScroll = useCallback(() => {
    syncEditorScroll(
      productTextareaRef.current,
      affiliateTextareaRef.current,
      productGutterRef.current,
      affiliateGutterRef.current,
    );
  }, [syncEditorScroll]);

  const handleAffiliateEditorScroll = useCallback(() => {
    syncEditorScroll(
      affiliateTextareaRef.current,
      productTextareaRef.current,
      affiliateGutterRef.current,
      productGutterRef.current,
    );
  }, [syncEditorScroll]);

  const startImportJobWithLinks = async (links: string[], sourceName: string) => {
    const response = await fetch("/importar-produtos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        links,
        sourceName,
        maxProducts: Math.min(200, links.length),
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | ProductImportJobSnapshot
      | ApiErrorResponse
      | null;

    if (!response.ok) {
      const message =
        payload && "error" in payload ? payload.error : "Nao foi possivel iniciar a importacao.";
      throw new Error(message ?? "Nao foi possivel iniciar a importacao.");
    }

    if (!payload || !("id" in payload)) {
      throw new Error("Resposta invalida ao iniciar a importacao.");
    }

    handledImportOutcomeRef.current = null;
    setImportJob(payload);
    return payload;
  };

  const startImportJobWithAffiliatePairs = async (
    links: string[],
    shortLinks: string[],
    sourceName: string,
  ) => {
    const response = await fetch("/products/import-with-affiliate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        links,
        short_links: shortLinks,
        sourceName,
        maxProducts: Math.min(200, links.length),
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | ProductImportJobSnapshot
      | ApiErrorResponse
      | null;

    if (!response.ok) {
      const message =
        payload && "error" in payload ? payload.error : "Nao foi possivel iniciar a importacao.";
      throw new Error(message ?? "Nao foi possivel iniciar a importacao.");
    }

    if (!payload || !("id" in payload)) {
      throw new Error("Resposta invalida ao iniciar a importacao.");
    }

    handledImportOutcomeRef.current = null;
    setImportJob(payload);
    return payload;
  };

  const handleGenerateLinks = async () => {
    if (!isSearchInputMode) {
      setFeedback("Cole uma unica URL de busca do Mercado Livre para gerar a lista.");
      return;
    }

    setPendingAction("generate-links");
    setFeedback("");
    setShowSearchImportJob(false);

    try {
      const result = await fetchSearchLinks();
      applyGeneratedLinks(result);
      setFeedback(
        `${result.productLinks.length} link(s) gerado(s) para voce jogar no encurtador do Mercado Livre.`,
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel gerar a lista de links.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleAutoNumberInputs = () => {
    if (pendingAction !== null || importJob?.status === "running") {
      return;
    }

    setImportInput((previous) => applyAutomaticNumbering(previous));
    setAffiliateImportInput((previous) => applyAutomaticNumbering(previous));
    setFeedback("Numeracao aplicada nas listas preenchidas.");
  };

  const handleImportProducts = async () => {
    const directLinks = isSearchInputMode
      ? []
      : parsedProductLines
          .map((line) => line.normalizedValue)
          .filter((entry): entry is string => Boolean(entry));
    const shortLinks = parsedAffiliateLines
      .map((line) => line.normalizedValue)
      .filter((entry): entry is string => Boolean(entry));

    if (!isSearchInputMode && directLinks.length === 0) {
      setFeedback("Cole pelo menos um link valido do Mercado Livre.");
      return;
    }

    if (!isSearchInputMode && invalidProductLine) {
      setFeedback(invalidProductLine.error ?? "Existe um link de produto invalido.");
      return;
    }

    if (!isSearchInputMode && hasAffiliateInput && importSyncError) {
      setFeedback(importSyncError);
      return;
    }

    setPendingAction("import-products");
    setFeedback("");

    try {
      let linksToImport = directLinks;

      if (isSearchInputMode) {
        setShowSearchImportJob(true);
        const result = await fetchSearchLinks();
        applyGeneratedLinks(result);
        linksToImport = result.productLinks;
      } else {
        setGeneratedLinks([]);
        setGeneratedLinksMeta(null);
        setShowSearchImportJob(false);
      }

      if (!isSearchInputMode && hasAffiliateInput) {
        await startImportJobWithAffiliatePairs(linksToImport, shortLinks, "painel-produtos-afiliado");
      } else {
        await startImportJobWithLinks(
          linksToImport,
          isSearchInputMode ? "painel-produtos-busca" : "painel-produtos",
        );
      }
      setFeedback(
        !isSearchInputMode && hasAffiliateInput
          ? `${linksToImport.length} par(es) de link enviados para importacao sincronizada.`
          : `${linksToImport.length} link(s) enviados para importacao por HTML inteligente.`,
      );
    } catch (error) {
      if (isSearchInputMode) {
        setShowSearchImportJob(false);
      }

      setFeedback(error instanceof Error ? error.message : "Nao foi possivel iniciar a importacao.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleSaveProduct = async (payload: ProductUpsertPayload) => {
    const isEditing = Boolean(editingProduct);

    const response = await fetch("/api/products", {
      method: isEditing ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        isEditing
          ? {
              ...payload,
              position: payload.position ?? editingProduct?.position,
              id: editingProduct?.id,
            }
          : payload,
      ),
    });

    const result = (await response.json().catch(() => null)) as ProductRecord | ApiErrorResponse | null;
    if (!response.ok) {
      const message = result && "error" in result ? result.error : "Erro ao salvar produto.";
      throw new Error(message ?? "Erro ao salvar produto.");
    }

    if (!result || !("id" in result)) {
      throw new Error("Resposta invalida ao salvar produto.");
    }

    upsertProductInState(result);
    setFeedback(isEditing ? "Produto atualizado com sucesso." : "Produto salvo com sucesso.");
    setEditingProduct(null);
    return result;
  };

  const handleSaveAndPublishProduct = async (payload: ProductUpsertPayload) => {
    const response = await fetch("/api/products", {
      method: editingProduct ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        editingProduct
          ? {
              ...payload,
              position: payload.position ?? editingProduct.position,
              id: editingProduct.id,
            }
          : payload,
      ),
    });

    const result = (await response.json().catch(() => null)) as ProductRecord | ApiErrorResponse | null;
    if (!response.ok) {
      const message = result && "error" in result ? result.error : "Erro ao salvar produto.";
      throw new Error(message ?? "Erro ao salvar produto.");
    }

    if (!result || !("id" in result)) {
      throw new Error("Resposta invalida ao salvar produto.");
    }

    upsertProductInState(result);
    setPublishingProduct(result);
    setIsPublishModalOpen(true);
    setFeedback("Produto salvo. Abrindo a publicacao do Mercado Livre.");
    return result;
  };

  const handleDeleteProduct = async (product: ProductRecord) => {
    const shouldDelete = window.confirm(`Deseja excluir o produto "${product.title}"?`);
    if (!shouldDelete) {
      return;
    }

    const response = await fetch("/api/products", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: product.id }),
    });

    const payload = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    if (!response.ok) {
      setFeedback(payload?.error ?? "Nao foi possivel excluir o produto.");
      return;
    }

    setProducts((previous) => previous.filter((entry) => entry.id !== product.id));
    setFeedback("Produto excluido com sucesso.");
  };

  const handleDeleteAllProducts = async () => {
    if (products.length === 0 || isDeletingAll) {
      return;
    }

    const shouldDelete = window.confirm(
      `Deseja excluir todos os ${products.length} produtos cadastrados? Essa acao nao pode ser desfeita.`,
    );
    if (!shouldDelete) {
      return;
    }

    setIsDeletingAll(true);

    try {
      const response = await fetch("/api/products", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deleteAll: true }),
      });

      const payload = (await response.json().catch(() => null)) as
        | ApiErrorResponse
        | DeleteAllResponse
        | null;

      if (!response.ok) {
        const message = payload && "error" in payload ? payload.error : "Nao foi possivel excluir os produtos.";
        setFeedback(message ?? "Nao foi possivel excluir os produtos.");
        return;
      }

      const deletedCount =
        payload && "deletedCount" in payload && typeof payload.deletedCount === "number"
          ? payload.deletedCount
          : products.length;

      setProducts([]);
      setFeedback(
        deletedCount === 1
          ? "1 produto excluido com sucesso."
          : `${deletedCount} produtos excluidos com sucesso.`,
      );
    } finally {
      setIsDeletingAll(false);
    }
  };

  const handleCopyText = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback(successMessage);
    } catch {
      setFeedback("Nao foi possivel copiar o conteudo.");
    }
  };

  const handlePublicationResult = (result: MeliPublicationPublishResponse) => {
    setProducts((previous) =>
      previous.map((entry) => (entry.id === result.product.id ? result.product : entry)),
    );
    setPublishingProduct(result.product);
    setFeedback(result.warning ? `${result.message} Aviso: ${result.warning}` : result.message);
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <BackButton />
        </div>

        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300/80">
              Importador SaaS Mercado Livre
            </p>
            <h1 className="mt-2 font-heading text-4xl font-bold text-zinc-50">
              Importacao HTML em lote
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-zinc-400">
              O painel agora aceita um ou varios links, usa leitura HTML inteligente do Mercado
              Livre, inclusive um unico link de busca como `https://lista.mercadolivre.com.br/tenis-nike`,
              gera link de afiliado, tenta encurtar para `meli.la` e cria a mensagem pronta de
              divulgacao para WhatsApp.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              className="h-11 rounded-2xl px-5 text-sm font-semibold"
              onClick={() => void handleDeleteAllProducts()}
              disabled={products.length === 0 || isDeletingAll}
            >
              <Trash2 className="size-4" />
              {isDeletingAll ? "Excluindo..." : "Limpar produtos"}
            </Button>
          </div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-4">
          <Card className="rounded-2xl border-white/10 bg-[#0b1018]/85 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Produtos</p>
            <p className="mt-3 text-3xl font-semibold text-zinc-50">{products.length}</p>
          </Card>
          <Card className="rounded-2xl border-white/10 bg-[#0b1018]/85 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Importados</p>
            <p className="mt-3 text-3xl font-semibold text-emerald-300">
              {visibleImportJob?.importedCount ?? 0}
            </p>
          </Card>
          <Card className="rounded-2xl border-white/10 bg-[#0b1018]/85 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Ignorados</p>
            <p className="mt-3 text-3xl font-semibold text-amber-300">
              {visibleImportJob?.skippedCount ?? 0}
            </p>
          </Card>
          <Card className="rounded-2xl border-white/10 bg-[#0b1018]/85 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Erros</p>
            <p className="mt-3 text-3xl font-semibold text-red-300">
              {visibleImportJob?.failedCount ?? 0}
            </p>
          </Card>
        </div>

        <Card className="mb-6 rounded-3xl border-white/15 bg-[#0b1018]/90 p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-heading text-2xl font-semibold text-zinc-50">
                Cole suas listas aqui
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-zinc-400">
                Use a coluna da esquerda para os links dos produtos e a da direita para os
                `meli.la` correspondentes, sempre na mesma ordem. Quando a quantidade nao bater,
                a importacao fica bloqueada.
              </p>
              <p className="mt-2 max-w-3xl text-xs text-emerald-300/80">
                Busca publica continua funcionando com uma unica URL de lista do Mercado Livre na
                coluna principal. O modo pareado salva `linkShort` explicito e a `position` de cada
                linha.
              </p>
            </div>
            <Badge
              className={
                isSearchInputMode && !showSearchImportJob
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : visibleImportJob?.status === "failed"
                  ? "border-red-500/30 bg-red-500/10 text-red-200"
                  : visibleImportJob?.status === "completed"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                    : "border-sky-500/30 bg-sky-500/10 text-sky-200"
              }
            >
              {isSearchInputMode && !showSearchImportJob
                ? "Modo lista de links"
                : visibleImportJob?.status === "running"
                ? "Importacao em andamento"
                : visibleImportJob?.status === "completed"
                  ? "Ultima importacao concluida"
                  : visibleImportJob?.status === "failed"
                    ? "Ultima importacao falhou"
                : "Aguardando importacao"}
            </Badge>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <SyncedImportEditor
              label="Links dos produtos"
              description={
                isSearchInputMode
                  ? "Modo busca: uma unica URL publica de lista do Mercado Livre."
                  : "Aceita produto.mercadolivre, mercadolivre.com.br, /p/MLB... e tambem listas numeradas."
              }
              value={importInput}
              onChange={setImportInput}
              placeholder={`1. https://produto.mercadolivre.com.br/MLB123456789\n2. https://www.mercadolivre.com.br/p/MLB987654321\n3. https://lista.mercadolivre.com.br/tenis-nike`}
              disabled={pendingAction !== null || (!isSearchInputMode && importJob?.status === "running")}
              lines={productEditorLines}
              textareaRef={productTextareaRef}
              gutterRef={productGutterRef}
              onScroll={handleProductEditorScroll}
            />

            <SyncedImportEditor
              label="Links afiliados (meli.la)"
              description={
                isSearchInputMode
                  ? "Deixe vazio para gerar a lista primeiro e depois colar os encurtados."
                  : "Cada linha precisa corresponder a mesma posicao da coluna de produtos."
              }
              value={affiliateImportInput}
              onChange={setAffiliateImportInput}
              placeholder={`1. https://meli.la/abc123\n2. https://meli.la/xyz456\n3. https://meli.la/qwe789`}
              disabled={pendingAction !== null || importJob?.status === "running"}
              lines={affiliateEditorLines}
              textareaRef={affiliateTextareaRef}
              gutterRef={affiliateGutterRef}
              onScroll={handleAffiliateEditorScroll}
            />
          </div>

          {importSyncError ? (
            <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {importSyncError}
            </div>
          ) : null}

          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-xs text-zinc-500">
              {isSearchInputMode
                ? "A URL de busca usa a API publica para montar a lista. Depois de gerar os links, cole os meli.la na coluna da direita para importar em pares."
                : hasAffiliateInput
                  ? "Modo sincronizado ativo: o sistema valida a quantidade, guarda a posicao e associa cada meli.la a linha correspondente."
                  : "O processamento usa fila assincrona, cache em memoria do parser HTML e controle de erros por item."}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" variant="secondary" size="default" asChild>
                <Link href="/configuracoes">
                  <ExternalLink className="size-4" />
                  Credencial ativa
                </Link>
              </Button>

              <Button
                type="button"
                variant="secondary"
                className="h-12 rounded-2xl px-5 text-sm font-semibold"
                onClick={handleAutoNumberInputs}
                disabled={pendingAction !== null || importJob?.status === "running"}
              >
                <ListOrdered className="size-4" />
                Auto numerar
              </Button>

              <Button
                type="button"
                variant="secondary"
                className="h-12 rounded-2xl px-5 text-sm font-semibold"
                onClick={() => void handleGenerateLinks()}
                disabled={!isSearchInputMode || pendingAction !== null}
              >
                {isGeneratingLinks ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Link2 className="size-4" />
                )}
                {isGeneratingLinks ? "Gerando..." : "Gerar lista de links"}
              </Button>

              <Button
                type="button"
                className="h-12 rounded-2xl px-5 text-sm font-semibold"
                onClick={() => void handleImportProducts()}
                disabled={pendingAction !== null || importJob?.status === "running"}
              >
                {isImportingProducts || importJob?.status === "running" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                {isImportingProducts || importJob?.status === "running"
                  ? "Importando..."
                  : "Importar produtos"}
              </Button>
            </div>
          </div>

          {!isSearchInputMode && importPreviewRows.length > 0 ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Preview antes de salvar</p>
                  <p className="text-xs text-zinc-500">
                    Mostrando ate 12 linhas para revisar a ordem e os erros antes da importacao.
                  </p>
                </div>
                <p className="text-xs text-zinc-400">
                  {parsedProductLines.length} produto(s) | {parsedAffiliateLines.length} afiliado(s)
                </p>
              </div>

              <div className="mt-4 space-y-2">
                {importPreviewRows.map((row) => (
                  <div
                    key={`preview-${row.position}`}
                    className={`rounded-xl border px-3 py-3 text-xs ${
                      row.status === "error"
                        ? "border-red-500/30 bg-red-500/10 text-red-100"
                        : "border-emerald-500/20 bg-emerald-500/5 text-zinc-200"
                    }`}
                  >
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-1">
                        <p className="font-semibold">Linha {row.position}</p>
                        <p className="truncate text-zinc-300">
                          Produto: {row.productValue || "nao informado"}
                        </p>
                        <p className="truncate text-zinc-400">
                          Afiliado: {row.affiliateValue || "nao informado"}
                        </p>
                      </div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                        {row.message}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {generatedLinksMeta ? (
            <div className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">
                    Lista de links gerada para {generatedLinksMeta.searchTerm ?? "sua busca"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {generatedLinksMeta.totalProducts} link(s) encontrado(s). Um link por linha, pronto para colar no encurtador do Mercado Livre.
                  </p>
                  {generatedLinksMeta.normalizedUrl ? (
                    <p className="mt-2 break-all text-xs text-zinc-500">
                      Origem: {generatedLinksMeta.normalizedUrl}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void handleCopyText(
                        generatedLinksText,
                        `${generatedLinks.length} link(s) copiado(s) para a area de transferencia.`,
                      )
                    }
                  >
                    <Copy className="size-3.5" />
                    Copiar lista
                  </Button>
                </div>
              </div>

              <textarea
                readOnly
                value={generatedLinksText}
                rows={Math.min(14, Math.max(6, generatedLinks.length))}
                className="mt-4 w-full rounded-2xl border border-white/10 bg-[#0f1724] p-4 text-xs text-zinc-100 outline-none"
              />
            </div>
          ) : null}

          {visibleImportJob ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{visibleImportJob.message}</p>
                  <p className="text-xs text-zinc-500">
                    Inicio: {formatImportDateTime(visibleImportJob.startedAt)} | Fim:{" "}
                    {formatImportDateTime(visibleImportJob.finishedAt)}
                  </p>
                </div>
                <p className="text-sm font-semibold text-zinc-200">{importProgress}%</p>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-lime-400 to-sky-400 transition-all"
                  style={{ width: `${importProgress}%` }}
                />
              </div>

              <div className="mt-4 grid gap-3 text-sm text-zinc-300 sm:grid-cols-2 xl:grid-cols-4">
                <p>Links recebidos: {visibleImportJob.queuedProducts}</p>
                <p>Processados: {visibleImportJob.processedCount}</p>
                <p>Importados/atualizados: {visibleImportJob.importedCount}</p>
                <p>Ignorados: {visibleImportJob.skippedCount}</p>
                <p>Falhas: {visibleImportJob.failedCount}</p>
                <p>Produtos ja existentes: {visibleImportJob.existingProductsAtStart}</p>
                <p>Origem: HTML inteligente do Mercado Livre</p>
                <p>Fonte: {visibleImportJob.sourceLabel ?? "painel"}</p>
              </div>

              {visibleImportJob.currentProductTitle || visibleImportJob.currentProductUrl ? (
                <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-zinc-300">
                  <p className="font-medium text-zinc-100">Produto atual</p>
                  <p className="mt-1 break-all text-xs text-zinc-400">
                    {visibleImportJob.currentProductTitle ?? visibleImportJob.currentProductUrl}
                  </p>
                </div>
              ) : null}

              {visibleImportJob.recentErrors.length > 0 ? (
                <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-100">
                  <p className="font-medium">Ultimas falhas</p>
                  <div className="mt-2 space-y-1 text-xs">
                    {visibleImportJob.recentErrors.slice(0, 5).map((error) => (
                      <p key={error} className="break-all">
                        {error}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>

        {feedback ? (
          <p className="mb-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300">
            {feedback}
          </p>
        ) : null}

        {isLoading ? (
          <Card className="rounded-2xl border-white/15 bg-[#0b1018]/85 p-6 text-zinc-300">
            Carregando produtos...
          </Card>
        ) : sortedProducts.length === 0 ? (
          <Card className="rounded-3xl border-white/15 bg-[#0b1018]/90 p-12 text-center">
            <div className="mx-auto flex max-w-xl flex-col items-center">
              <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
                <PackageSearch className="size-8 text-zinc-400" />
              </div>
              <h3 className="font-heading text-2xl font-bold text-zinc-100">
                Nenhum produto importado ainda
              </h3>
              <p className="mt-2 text-zinc-400">
                Cole acima uma busca publica do Mercado Livre ou links de produto para montar sua
                base com item ID, links de afiliado e mensagem pronta para WhatsApp.
              </p>
            </div>
          </Card>
        ) : (
          <section className="overflow-hidden rounded-2xl border border-white/15 bg-[#0b1018]/85">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-zinc-400">
                  <tr>
                    <th className="px-4 py-3">Produto</th>
                    <th className="px-4 py-3">Links</th>
                    <th className="px-4 py-3">Divulgacao</th>
                    <th className="px-4 py-3 text-right">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProducts.map((product) => (
                    <tr key={product.id} className="border-t border-white/10 text-zinc-200">
                      <td className="px-4 py-4 align-top">
                        <div className="flex gap-4">
                          {product.image ? (
                            <img
                              src={product.image}
                              alt={product.title}
                              className="h-20 w-20 rounded-xl object-cover"
                            />
                          ) : (
                            <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-white/5">
                              <PackageSearch className="size-4 text-zinc-500" />
                            </div>
                          )}

                          <div className="min-w-[260px] max-w-[360px]">
                            <p className="text-sm font-semibold text-zinc-100">{product.title}</p>
                            <p className="mt-2 text-lg font-semibold text-emerald-300">
                              {formatCurrencyBRL(product.price)}
                            </p>
                            {product.originalPrice !== undefined && product.originalPrice > product.price ? (
                              <p className="text-xs text-zinc-500 line-through">
                                {formatCurrencyBRL(product.originalPrice)}
                              </p>
                            ) : null}
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                              <Badge variant="secondary">Mercado Livre</Badge>
                              {product.position ? (
                                <Badge className="bg-violet-500/15 text-violet-200">
                                  Linha {product.position}
                                </Badge>
                              ) : null}
                              {product.itemId ? (
                                <Badge className="bg-sky-500/15 text-sky-200">
                                  ITEM_ID: {product.itemId}
                                </Badge>
                              ) : null}
                              {getProductOfferLabel(product) ? (
                                <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-200">
                                  {getProductOfferLabel(product)}
                                </Badge>
                              ) : null}
                              {product.meliPublication?.itemId ? (
                                <Badge className="bg-emerald-500/15 text-emerald-200">
                                  Publicado ML
                                </Badge>
                              ) : null}
                            </div>
                            {product.couponLabel ? (
                              <p className="mt-2 text-xs font-medium text-amber-300">
                                Cupom/promocao: {product.couponLabel}
                              </p>
                            ) : null}
                            {product.seller ? (
                              <p className="mt-2 text-xs text-zinc-400">Loja: {product.seller}</p>
                            ) : null}
                            <p className="mt-2 text-xs text-zinc-500">
                              Importado em {formatImportDateTime(product.createdAt)}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-4 align-top">
                        <div className="space-y-2 text-xs">
                          <a
                            href={product.linkOriginal}
                            target="_blank"
                            rel="noreferrer"
                            className="block max-w-[360px] truncate text-zinc-300 hover:text-zinc-100"
                          >
                            Original: {product.linkOriginal}
                          </a>
                          {product.linkAffiliate ? (
                            <a
                              href={product.linkAffiliate}
                              target="_blank"
                              rel="noreferrer"
                              className="block max-w-[360px] truncate text-emerald-300 hover:text-emerald-200"
                            >
                              Afiliado: {product.linkAffiliate}
                            </a>
                          ) : (
                            <p className="text-zinc-500">Afiliado: nao configurado</p>
                          )}
                          {product.linkShort ? (
                            <a
                              href={product.linkShort}
                              target="_blank"
                              rel="noreferrer"
                              className="block max-w-[360px] truncate text-sky-300 hover:text-sky-200"
                            >
                              Curto: {product.linkShort}
                            </a>
                          ) : (
                            <p className="text-zinc-500">Curto: indisponivel</p>
                          )}
                          <a
                            href={product.link}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:text-primary/80"
                          >
                            Abrir link principal
                            <ExternalLink className="size-3.5" />
                          </a>
                        </div>
                      </td>

                      <td className="px-4 py-4 align-top">
                        <pre className="max-w-[320px] whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-300">
                          {product.marketingMessage}
                        </pre>
                      </td>

                      <td className="px-4 py-4 align-top">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="border-emerald-500/30 text-emerald-200 hover:text-emerald-100"
                            onClick={() => {
                              setPublishingProduct(product);
                              setIsPublishModalOpen(true);
                            }}
                          >
                            <Upload className="size-3.5" />
                            {product.meliPublication?.itemId ? "Gerenciar ML" : "Publicar ML"}
                          </Button>

                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              void handleCopyText(
                                product.marketingMessage,
                                `Divulgacao copiada: ${product.title}`,
                              )
                            }
                          >
                            <Copy className="size-3.5" />
                            Copiar divulgacao
                          </Button>

                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setEditingProduct(product);
                              setIsModalOpen(true);
                            }}
                          >
                            <Pencil className="size-3.5" />
                            Editar
                          </Button>

                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="border-red-500/30 text-red-300 hover:text-red-200"
                            onClick={() => void handleDeleteProduct(product)}
                          >
                            <Trash2 className="size-3.5" />
                            Excluir
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      <ProductModal
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingProduct(null);
        }}
        onSave={handleSaveProduct}
        onSaveAndPublish={handleSaveAndPublishProduct}
        initialProduct={editingProduct}
      />

      <MeliPublishModal
        open={isPublishModalOpen}
        product={publishingProduct}
        onClose={() => {
          setIsPublishModalOpen(false);
          setPublishingProduct(null);
        }}
        onPublished={handlePublicationResult}
      />
    </div>
  );
}

export default function ProdutosPage() {
  return (
    <AuthGuard>
      <ProdutosPageContent />
    </AuthGuard>
  );
}
