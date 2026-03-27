"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Plus, Radio, Search, Upload, User, Users } from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import BackButton from "@/components/BackButton";
import ContactsList from "@/components/ContactsList";
import RecipientModal from "@/components/RecipientModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  importRecipientsFromCsv,
  fromRecipientDTO,
  matchesRecipientSearch,
  toRecipientDraft,
  type Recipient,
  type RecipientDTO,
  type RecipientDraft,
  type RecipientType,
} from "@/lib/recipients";
import { subscribeToSoftRefresh } from "@/lib/autoRefresh";

function ContatosPageContent() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [query, setQuery] = useState("");
  const [isChoiceModalOpen, setIsChoiceModalOpen] = useState(false);
  const [activeRecipientType, setActiveRecipientType] = useState<RecipientType | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  const loadRecipients = useCallback(async (showLoader = true) => {
    if (showLoader) {
      setIsLoading(true);
    }

    try {
      const response = await fetch("/api/recipients", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Nao foi possivel carregar os destinatarios.");
      }

      const payload = (await response.json().catch(() => [])) as RecipientDTO[];
      if (Array.isArray(payload)) {
        setRecipients(payload.map(fromRecipientDTO));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar destinatarios.";
      setFeedback(message);
    } finally {
      if (showLoader) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadRecipients();

    return subscribeToSoftRefresh(() => {
      void loadRecipients(false);
    });
  }, [loadRecipients]);

  const filteredRecipients = useMemo(
    () => recipients.filter((recipient) => matchesRecipientSearch(recipient, query)),
    [recipients, query],
  );

  const handleSaveRecipient = async (draft: RecipientDraft) => {
    const response = await fetch("/api/recipients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(draft),
    });

    const payload = (await response.json().catch(() => null)) as
      | RecipientDTO
      | {
          error?: string;
        }
      | null;

    if (!response.ok) {
      const message = payload && "error" in payload ? payload.error : "Nao foi possivel salvar.";
      throw new Error(message ?? "Nao foi possivel salvar.");
    }

    const recipient = fromRecipientDTO(payload as RecipientDTO);
    setRecipients((prev) => [recipient, ...prev]);
    setFeedback(`${recipient.name} salvo com sucesso.`);
  };

  const handleRemoveRecipient = async (recipientId: string) => {
    const response = await fetch("/api/recipients", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: recipientId }),
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setFeedback(payload?.error ?? "Nao foi possivel remover o destinatario.");
      return;
    }

    setRecipients((prev) => prev.filter((item) => item.id !== recipientId));
    setFeedback("Destinatario removido com sucesso.");
  };

  const handleImportCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const csvText = await file.text();
    const result = importRecipientsFromCsv(csvText);

    if (result.recipients.length > 0) {
      try {
        const drafts = result.recipients.map((recipient) => toRecipientDraft(recipient));
        const response = await fetch("/api/recipients", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ recipients: drafts }),
        });

        const payload = (await response.json().catch(() => null)) as
          | { recipients?: RecipientDTO[]; error?: string }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "Falha ao importar destinatarios.");
        }

        const createdRecipients = (payload?.recipients ?? []).map(fromRecipientDTO);
        setRecipients((prev) => [...createdRecipients, ...prev]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao importar destinatarios.";
        setFeedback(message);
        return;
      }
    }

    if (result.imported > 0 && result.failed === 0) {
      setFeedback(`Importacao concluida: ${result.imported} destinatario(s) adicionados.`);
      return;
    }

    if (result.imported > 0) {
      setFeedback(
        `Importacao parcial: ${result.imported} importado(s) e ${result.failed} com erro.`,
      );
      return;
    }

    const firstError = result.errors[0] ?? "Falha ao importar CSV.";
    setFeedback(firstError);
  };

  const typeCards: Array<{
    type: RecipientType;
    title: string;
    description: string;
    Icon: typeof User;
  }> = [
    {
      type: "contact",
      title: "Contato",
      description: "Salvar numero de WhatsApp",
      Icon: User,
    },
    {
      type: "group",
      title: "Grupo",
      description: "Salvar link de grupo do WhatsApp",
      Icon: Users,
    },
    {
      type: "channel",
      title: "Canal",
      description: "Salvar link de canal ou comunidade",
      Icon: Radio,
    },
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-6xl p-6">
        <div className="mb-6">
          <BackButton />
        </div>

        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="font-heading text-4xl font-bold">Contatos</h1>
            <p className="mt-1 text-zinc-400">
              Gerencie contatos para campanhas de WhatsApp.
            </p>
          </div>

          <div className="flex gap-3">
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleImportCsv}
            />

            <Button
              type="button"
              variant="secondary"
              className="h-11 rounded-xl"
              onClick={() => csvInputRef.current?.click()}
            >
              <Upload className="size-4" />
              Importar CSV
            </Button>
            <Button
              type="button"
              className="h-11 rounded-xl bg-green-600 text-white hover:bg-green-500"
              onClick={() => setIsChoiceModalOpen(true)}
            >
              <Plus className="size-4" />
              Adicionar
            </Button>
          </div>
        </header>

        <section className="mb-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <label className="mb-2 block text-sm text-zinc-300">Busca inteligente</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nome, telefone, link ou tag..."
              className="h-11 rounded-lg border-zinc-700 bg-zinc-800 pl-10 focus-visible:border-green-500"
            />
          </div>
        </section>

        {isLoading ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-400">
            Carregando destinatarios...
          </div>
        ) : (
          <ContactsList
            recipients={filteredRecipients}
            onRemove={(recipientId) => void handleRemoveRecipient(recipientId)}
          />
        )}

        {feedback ? <p className="mt-4 text-sm text-zinc-400">{feedback}</p> : null}
      </main>

      {isChoiceModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0"
            onClick={() => setIsChoiceModalOpen(false)}
            aria-label="Fechar escolha"
          />

          <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="mb-5 font-heading text-2xl font-semibold text-white">Adicionar</h2>

            <div className="grid gap-4 md:grid-cols-3">
              {typeCards.map(({ type, title, description, Icon }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    setIsChoiceModalOpen(false);
                    setActiveRecipientType(type);
                  }}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left transition hover:border-green-500/40"
                >
                  <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-zinc-800">
                    <Icon className="size-5 text-zinc-300" />
                  </div>
                  <h3 className="font-heading text-xl font-semibold text-white">{title}</h3>
                  <p className="mt-1 text-sm text-zinc-400">{description}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <RecipientModal
        key={activeRecipientType ?? "none"}
        open={activeRecipientType !== null}
        recipientType={activeRecipientType}
        onClose={() => setActiveRecipientType(null)}
        onSave={handleSaveRecipient}
      />
    </div>
  );
}

export default function ContatosPage() {
  return (
    <AuthGuard>
      <ContatosPageContent />
    </AuthGuard>
  );
}
