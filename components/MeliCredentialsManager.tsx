"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { subscribeToSoftRefresh } from "@/lib/autoRefresh";

type Credential = {
  id: string;
  name?: string;
  clientIdPreview?: string;
  meliUserId?: string;
  meliNickname?: string;
  siteId?: string;
  affiliateTrackingId?: string;
  affiliateSlug?: string;
  isActive: boolean;
  hasAccessToken: boolean;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

type CredentialsResponse = {
  credentials: Credential[];
  activeCredentialId: string | null;
};

const initialFormState = {
  name: "",
  client_id: "",
  client_secret: "",
  refresh_token: "",
  affiliate_tracking_id: "",
  affiliate_slug: "",
};

const textareaClassName =
  "min-h-[132px] w-full rounded-2xl border border-white/10 bg-[#0b1018] px-4 py-3 font-mono text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-primary/60 focus:ring-2 focus:ring-primary/30";

export default function MeliCredentialsManager() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [oauthSubmitting, setOauthSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(initialFormState);
  const [redirectUri, setRedirectUri] = useState("");

  const loadCredentials = useCallback(async (showLoader = true) => {
    try {
      if (showLoader) {
        setLoading(true);
      }
      const response = await fetch("/api/meli/credentials", {
        cache: "no-store",
      });

      const data = (await response.json().catch(() => null)) as
        | CredentialsResponse
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(data && "error" in data ? data.error : "Erro ao carregar credenciais.");
      }

      const nextCredentials =
        data && "credentials" in data && Array.isArray(data.credentials) ? data.credentials : [];
      setCredentials(nextCredentials);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar credenciais.");
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadCredentials();

    return subscribeToSoftRefresh(() => {
      void loadCredentials(false);
    });
  }, [loadCredentials]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setRedirectUri(`${window.location.origin}/api/meli/oauth/callback`);

    const currentUrl = new URL(window.location.href);
    const oauthStatus = currentUrl.searchParams.get("meli_oauth");
    const oauthMessage = currentUrl.searchParams.get("meli_oauth_message");

    if (oauthStatus === "success") {
      setSuccess(oauthMessage || "Conta do Mercado Livre conectada com sucesso.");
      setError("");
      setShowForm(false);
      void loadCredentials(false);
    }

    if (oauthStatus === "error") {
      setError(oauthMessage || "Nao foi possivel concluir a conexao com o Mercado Livre.");
      setSuccess("");
      setShowForm(true);
    }

    if (oauthStatus || oauthMessage) {
      currentUrl.searchParams.delete("meli_oauth");
      currentUrl.searchParams.delete("meli_oauth_message");

      const nextUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
      window.history.replaceState({}, "", nextUrl);
    }
  }, [loadCredentials]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/meli/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            message?: string;
            credential?: Credential;
            error?: string;
          }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Nao foi possivel validar a credencial.");
      }

      setSuccess(payload?.message ?? "Credencial salva com sucesso.");
      setFormData(initialFormState);
      setShowForm(false);
      await loadCredentials();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Nao foi possivel validar a credencial.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteCredential(credentialId: string) {
    if (!window.confirm("Deseja remover esta credencial do Mercado Livre?")) {
      return;
    }

    setError("");
    setSuccess("");

    try {
      const response = await fetch(`/api/meli/credentials/${credentialId}`, {
        method: "DELETE",
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Nao foi possivel remover a credencial.");
      }

      setSuccess("Credencial removida com sucesso.");
      await loadCredentials();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Nao foi possivel remover a credencial.",
      );
    }
  }

  async function handleOAuthConnect() {
    setOauthSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/meli/oauth/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: formData.name,
          client_id: formData.client_id,
          client_secret: formData.client_secret,
          affiliate_tracking_id: formData.affiliate_tracking_id,
          affiliate_slug: formData.affiliate_slug,
          redirect_path: "/configuracoes?tab=credentials",
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            authorizationUrl?: string;
          error?: string;
        }
        | null;

      if (!response.ok || !payload?.authorizationUrl) {
        throw new Error(payload?.error ?? "Nao foi possivel iniciar a conexao OAuth.");
      }

      window.location.assign(payload.authorizationUrl);
    } catch (oauthError) {
      setError(
        oauthError instanceof Error
          ? oauthError.message
          : "Nao foi possivel iniciar a conexao OAuth.",
      );
    } finally {
      setOauthSubmitting(false);
    }
  }

  const activeCredential = credentials.find((credential) => credential.isActive) ?? null;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <h2 className="font-heading text-3xl font-bold text-zinc-50">
            Credenciais da API do Mercado Livre
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Preencha <code className="rounded bg-white/5 px-1.5 py-0.5">client_id</code> e{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5">client_secret</code> e conclua o
            OAuth pelo botao de conexao. O <code className="rounded bg-white/5 px-1.5 py-0.5">refresh_token</code>{" "}
            passa a ser salvo automaticamente. Se precisar, o cadastro manual continua disponivel
            como fallback. Para gerar links de afiliado automaticamente, informe tambem{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5">matt_tool</code> e o slug social
            usado no <code className="rounded bg-white/5 px-1.5 py-0.5">matt_word</code>.
          </p>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Se a app OAuth ja estiver configurada no servidor, voce pode clicar em conectar mesmo
            com esses campos vazios.
          </p>
        </div>

        <Button
          type="button"
          onClick={() => setShowForm((current) => !current)}
          className="bg-primary text-primary-foreground"
        >
          <Plus className="size-4" />
          {showForm ? "Fechar cadastro" : "Cadastrar credencial"}
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="rounded-3xl border-white/10 bg-[#0a111d]/90 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-zinc-400">Credencial ativa</p>
              <p className="mt-2 text-xl font-semibold text-zinc-50">
                {activeCredential?.name || activeCredential?.meliNickname || "Nenhuma ativa"}
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                {activeCredential?.meliUserId
                  ? `Conta ${activeCredential.meliUserId}`
                  : "Cadastre uma credencial para afiliado, link curto e publicacao."}
              </p>
            </div>
            <div className="rounded-2xl bg-emerald-500/15 p-3 text-emerald-300">
              <ShieldCheck className="size-5" />
            </div>
          </div>
        </Card>

        <Card className="rounded-3xl border-white/10 bg-[#0a111d]/90 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-zinc-400">Access token</p>
              <p className="mt-2 text-xl font-semibold text-zinc-50">
                {activeCredential?.hasAccessToken ? "Disponivel" : "Pendente"}
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                {activeCredential?.expiresAt
                  ? `Expira em ${new Date(activeCredential.expiresAt).toLocaleString("pt-BR")}`
                  : "O token sera renovado automaticamente quando necessario."}
              </p>
            </div>
            <div className="rounded-2xl bg-blue-500/15 p-3 text-blue-300">
              <KeyRound className="size-5" />
            </div>
          </div>
        </Card>

        <Card className="rounded-3xl border-white/10 bg-[#0a111d]/90 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-zinc-400">Credenciais salvas</p>
              <p className="mt-2 text-xl font-semibold text-zinc-50">{credentials.length}</p>
              <p className="mt-1 text-sm text-zinc-500">
                A credencial ativa e a usada nos recursos afiliados, encurtador e publicacao.
              </p>
            </div>
            <div className="rounded-2xl bg-violet-500/15 p-3 text-violet-300">
              <Sparkles className="size-5" />
            </div>
          </div>
        </Card>
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

      {showForm ? (
        <Card className="rounded-[28px] border-white/10 bg-[#09111b]/92 p-6 sm:p-7">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h3 className="font-heading text-2xl font-semibold text-zinc-50">
                Nova credencial OAuth
              </h3>
              <p className="mt-1 text-sm text-zinc-400">
                O fluxo recomendado agora e automatico: informe a app, clique em conectar e o
                sistema salva o refresh token da conta autorizada sem copiar codigo manualmente.
                Os campos de afiliado sao opcionais, mas necessarios para gerar links afiliados
                automaticamente.
              </p>
            </div>

            <div className="rounded-2xl bg-primary/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Mercado Livre
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
              <p className="font-medium text-blue-50">Redirect URI da aplicacao</p>
              <p className="mt-2 break-all font-mono text-xs text-blue-100/90">
                {redirectUri || "Carregando redirect URI..."}
              </p>
              <p className="mt-2 text-blue-100/80">
                Cadastre exatamente essa URL na sua app do Mercado Livre para o callback OAuth.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  Nome da credencial
                </label>
                <Input
                  type="text"
                  value={formData.name}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Ex: Conta principal da loja"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">Client ID</label>
                <Input
                  type="text"
                  value={formData.client_id}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, client_id: event.target.value }))
                  }
                  placeholder="5922320425781480"
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  Client Secret
                </label>
                <textarea
                  value={formData.client_secret}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, client_secret: event.target.value }))
                  }
                  rows={4}
                  placeholder="Cole o client secret da sua app"
                  required
                  className={textareaClassName}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  Refresh Token
                </label>
                <textarea
                  value={formData.refresh_token}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, refresh_token: event.target.value }))
                  }
                  rows={4}
                  placeholder="Opcional: use apenas no cadastro manual"
                  className={textareaClassName}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  ID afiliado / matt_tool
                </label>
                <Input
                  type="text"
                  value={formData.affiliate_tracking_id}
                  onChange={(event) =>
                    setFormData((current) => ({
                      ...current,
                      affiliate_tracking_id: event.target.value,
                    }))
                  }
                  placeholder="Ex: 16388091"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  Slug social / matt_word
                </label>
                <Input
                  type="text"
                  value={formData.affiliate_slug}
                  onChange={(event) =>
                    setFormData((current) => ({
                      ...current,
                      affiliate_slug: event.target.value,
                    }))
                  }
                  placeholder="Ex: rufinomaxwel"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              Depois da autorizacao, o token ativo sera renovado automaticamente quando necessario
              e a credencial conectada passa a ser a referencia usada pelo modo API Mercado Livre
              na area de produtos.
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => void handleOAuthConnect()}
                disabled={oauthSubmitting || submitting}
              >
                {oauthSubmitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                {oauthSubmitting ? "Redirecionando..." : "Conectar Mercado Livre"}
              </Button>

              <Button type="submit" variant="secondary" disabled={submitting || oauthSubmitting}>
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <KeyRound className="size-4" />
                )}
                {submitting ? "Validando e salvando..." : "Salvar manualmente"}
              </Button>

              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowForm(false)}
                disabled={submitting || oauthSubmitting}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-heading text-2xl font-semibold text-zinc-50">
              Credenciais cadastradas
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              {credentials.length} registro(s) disponíveis para o painel.
            </p>
          </div>
        </div>

        {loading ? (
          <Card className="rounded-[28px] border-white/10 bg-[#09111b]/80 p-10 text-center text-zinc-400">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="size-5 animate-spin" />
              Carregando credenciais...
            </div>
          </Card>
        ) : credentials.length === 0 ? (
          <Card className="rounded-[28px] border-dashed border-white/10 bg-[#09111b]/80 p-10 text-center text-zinc-400">
            Nenhuma credencial cadastrada ainda.
          </Card>
        ) : (
          <div className="grid gap-4">
            {credentials.map((credential) => (
              <Card
                key={credential.id}
                className={`rounded-[28px] p-6 ${
                  credential.isActive
                    ? "border-emerald-500/30 bg-[linear-gradient(135deg,rgba(15,60,36,0.38),rgba(9,17,27,0.96))]"
                    : "border-white/10 bg-[#09111b]/88"
                }`}
              >
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-heading text-2xl font-semibold text-zinc-50">
                        {credential.name || credential.meliNickname || "Credencial Mercado Livre"}
                      </h4>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                          credential.isActive
                            ? "bg-emerald-500/15 text-emerald-200"
                            : "bg-white/8 text-zinc-300"
                        }`}
                      >
                        {credential.isActive ? "Ativa" : "Inativa"}
                      </span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                      <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
                        <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                          Conta
                        </p>
                        <p className="mt-2 text-sm font-medium text-zinc-100">
                          {credential.meliNickname || "--"}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
                        <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                          ID da conta
                        </p>
                        <p className="mt-2 text-sm font-medium text-zinc-100">
                          {credential.meliUserId || "--"}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
                        <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                          Client ID
                        </p>
                        <p className="mt-2 text-sm font-medium text-zinc-100">
                          {credential.clientIdPreview || "--"}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
                        <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                          matt_tool
                        </p>
                        <p className="mt-2 text-sm font-medium text-zinc-100">
                          {credential.affiliateTrackingId || "--"}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
                        <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                          matt_word
                        </p>
                        <p className="mt-2 text-sm font-medium text-zinc-100">
                          {credential.affiliateSlug || "--"}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-3 text-sm text-zinc-400 sm:grid-cols-2 xl:grid-cols-4">
                      <p className="inline-flex items-center gap-2">
                        <UserRound className="size-4 text-zinc-500" />
                        Site: {credential.siteId || "MLB"}
                      </p>
                      <p className="inline-flex items-center gap-2">
                        <Clock3 className="size-4 text-zinc-500" />
                        Ultimo uso:{" "}
                        {credential.lastUsedAt
                          ? new Date(credential.lastUsedAt).toLocaleString("pt-BR")
                          : "--"}
                      </p>
                      <p>Criada em {new Date(credential.createdAt).toLocaleString("pt-BR")}</p>
                      <p>Atualizada em {new Date(credential.updatedAt).toLocaleString("pt-BR")}</p>
                    </div>
                  </div>

                  <div className="flex flex-col items-start gap-3 lg:items-end">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                        credential.hasAccessToken
                          ? "bg-blue-500/15 text-blue-200"
                          : "bg-amber-500/15 text-amber-200"
                      }`}
                    >
                      {credential.hasAccessToken ? "Token pronto" : "Token pendente"}
                    </span>

                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handleDeleteCredential(credential.id)}
                      className="border-red-500/25 text-red-200 hover:bg-red-500/10"
                    >
                      <Trash2 className="size-4" />
                      Remover
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
