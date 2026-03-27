"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  History,
  Loader2,
  SearchCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { subscribeToSoftRefresh } from "@/lib/autoRefresh";

interface ValidationResult {
  id: string;
  product_id: string;
  title: string;
  price: number;
  currency: string;
  image_url: string | null;
  seller_name: string | null;
  stock: number | null;
  is_valid: boolean;
  error_message: string | null;
  validation_status: string;
  created_at: string;
}

export default function MeliProductValidator() {
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [lastValidation, setLastValidation] = useState<ValidationResult | null>(null);
  const [validations, setValidations] = useState<ValidationResult[]>([]);

  const fetchValidations = useCallback(async () => {
    try {
      const response = await fetch("/api/meli/validate?limit=10&offset=0", {
        cache: "no-store",
      });

      const data = (await response.json().catch(() => null)) as
        | {
            validations?: ValidationResult[];
          }
        | null;

      if (Array.isArray(data?.validations)) {
        setValidations(data.validations);
      }
    } catch (fetchError) {
      console.error("Erro ao buscar validacoes:", fetchError);
    }
  }, []);

  useEffect(() => {
    void fetchValidations();

    return subscribeToSoftRefresh(() => {
      void fetchValidations();
    });
  }, [fetchValidations]);

  async function handleValidate(event: FormEvent) {
    event.preventDefault();
    if (!link.trim()) {
      setError("Por favor, insira um link do Mercado Livre.");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/meli/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ product_link: link }),
      });

      const data = (await response.json().catch(() => null)) as
        | {
            validation?: ValidationResult;
            error?: string;
            message?: string;
          }
        | null;

      if (!response.ok) {
        setError(data?.error || data?.message || "Erro ao validar produto.");
        return;
      }

      if (data?.validation) {
        setLastValidation(data.validation);
      }
      setSuccess("Produto validado com sucesso.");
      setLink("");
      await fetchValidations();
    } catch (validationError) {
      setError("Erro ao conectar com o servidor.");
      console.error(validationError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <Card className="rounded-[28px] border-white/10 bg-[#09111b]/92 p-6 sm:p-7">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-heading text-3xl font-bold text-zinc-50">Validar produto</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                Teste qualquer link do Mercado Livre usando a API oficial, veja o retorno salvo no
                PostgreSQL e confirme se o item esta pronto para o seu fluxo.
              </p>
            </div>

            <div className="rounded-2xl bg-blue-500/15 p-3 text-blue-300">
              <SearchCheck className="size-5" />
            </div>
          </div>

          <form onSubmit={handleValidate} className="space-y-4">
            <div>
              <label htmlFor="meli-link" className="mb-2 block text-sm font-medium text-zinc-300">
                Link do produto
              </label>
              <Input
                id="meli-link"
                type="url"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="https://www.mercadolivre.com.br/..."
                disabled={loading}
              />
            </div>

            {error ? (
              <div className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                <AlertCircle className="size-4 shrink-0" />
                <p>{error}</p>
              </div>
            ) : null}

            {success ? (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                <CheckCircle2 className="size-4 shrink-0" />
                <p>{success}</p>
              </div>
            ) : null}

            <Button type="submit" disabled={loading} className="w-full sm:w-auto">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <SearchCheck className="size-4" />}
              {loading ? "Validando..." : "Validar produto"}
            </Button>
          </form>
        </Card>

        <Card className="rounded-[28px] border-white/10 bg-[#09111b]/92 p-6">
          <h3 className="font-heading text-2xl font-semibold text-zinc-50">Resumo rapido</h3>
          <div className="mt-5 grid gap-3">
            <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Historico</p>
              <p className="mt-2 text-2xl font-bold text-zinc-50">{validations.length}</p>
              <p className="mt-1 text-sm text-zinc-400">Ultimas validacoes carregadas da API.</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Ultimo status</p>
              <p className="mt-2 text-sm font-semibold text-zinc-50">
                {lastValidation?.validation_status || "Aguardando teste"}
              </p>
              <p className="mt-1 text-sm text-zinc-400">
                O ultimo resultado detalhado aparece logo abaixo.
              </p>
            </div>

            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              A validacao usa a API oficial do Mercado Livre, sem scraping.
            </div>
          </div>
        </Card>
      </div>

      {lastValidation ? (
        <Card className="rounded-[28px] border-white/10 bg-[#09111b]/92 p-6 sm:p-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-heading text-2xl font-semibold text-zinc-50">
                Resultado da validacao
              </h3>
              <p className="mt-1 text-sm text-zinc-400">
                Dados retornados pela API oficial para o ultimo link testado.
              </p>
            </div>

            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                lastValidation.is_valid
                  ? "bg-emerald-500/15 text-emerald-200"
                  : "bg-red-500/15 text-red-200"
              }`}
            >
              {lastValidation.is_valid ? "Valido" : "Com erro"}
            </span>
          </div>

          <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#060b13]">
              {lastValidation.image_url ? (
                <img
                  src={lastValidation.image_url}
                  alt={lastValidation.title}
                  className="h-full min-h-[220px] w-full object-cover"
                />
              ) : (
                <div className="flex min-h-[220px] items-center justify-center text-sm text-zinc-500">
                  Sem imagem disponivel
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Titulo</p>
                <p className="mt-2 text-lg font-semibold text-zinc-50">{lastValidation.title}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Preco</p>
                  <p className="mt-2 text-sm font-semibold text-zinc-50">
                    {lastValidation.currency} {lastValidation.price}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Estoque</p>
                  <p className="mt-2 text-sm font-semibold text-zinc-50">
                    {lastValidation.stock ?? "N/A"}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Produto ID</p>
                  <p className="mt-2 text-sm font-semibold text-zinc-50">
                    {lastValidation.product_id}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Status</p>
                  <p className="mt-2 text-sm font-semibold text-zinc-50">
                    {lastValidation.validation_status}
                  </p>
                </div>
              </div>

              {lastValidation.seller_name ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Vendedor</p>
                  <p className="mt-2 text-sm font-medium text-zinc-200">
                    {lastValidation.seller_name}
                  </p>
                </div>
              ) : null}

              {lastValidation.error_message ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {lastValidation.error_message}
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="rounded-[28px] border-white/10 bg-[#09111b]/92 p-6 sm:p-7">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-heading text-2xl font-semibold text-zinc-50">
              Historico de validacoes
            </h3>
            <p className="mt-1 text-sm text-zinc-400">Ultimos 10 testes salvos no PostgreSQL.</p>
          </div>

          <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300">
            <History className="size-3.5" />
            {validations.length} registros
          </div>
        </div>

        {validations.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/10 bg-black/10 p-8 text-center text-sm text-zinc-400">
            Nenhuma validacao encontrada ainda.
          </div>
        ) : (
          <div className="grid gap-3">
            {validations.map((validation) => (
              <div
                key={validation.id}
                className="rounded-3xl border border-white/10 bg-black/12 px-5 py-4"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-zinc-50">
                      {validation.title}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {new Date(validation.created_at).toLocaleString("pt-BR")}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-zinc-100">
                      {validation.currency} {validation.price}
                    </div>

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                        validation.is_valid
                          ? "bg-emerald-500/15 text-emerald-200"
                          : "bg-red-500/15 text-red-200"
                      }`}
                    >
                      {validation.is_valid ? "Valido" : "Erro"}
                    </span>

                    <a
                      href={`https://api.mercadolibre.com/items/${validation.product_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-sm font-medium text-primary transition hover:text-primary/80"
                    >
                      <ExternalLink className="size-4" />
                      API
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
