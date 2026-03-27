"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  extractInviteCode,
  validateRecipientDraft,
  type RecipientDraft,
  type RecipientType,
} from "@/lib/recipients";

type RecipientModalProps = {
  open: boolean;
  recipientType: RecipientType | null;
  onClose: () => void;
  onSave: (draft: RecipientDraft) => Promise<void> | void;
};

const initialState = {
  name: "",
  phone: "",
  link: "",
  tag: "",
};

const copyByType: Record<
  RecipientType,
  {
    title: string;
    nameLabel: string;
    namePlaceholder: string;
    secondaryLabel: string;
    secondaryPlaceholder: string;
  }
> = {
  contact: {
    title: "Novo Contato",
    nameLabel: "Nome",
    namePlaceholder: "Nome do contato",
    secondaryLabel: "WhatsApp",
    secondaryPlaceholder: "5511999999999",
  },
  group: {
    title: "Novo Grupo",
    nameLabel: "Nome do Grupo",
    namePlaceholder: "Promocoes Eletronicos",
    secondaryLabel: "Link do Grupo",
    secondaryPlaceholder: "https://chat.whatsapp.com/ABC123XYZ",
  },
  channel: {
    title: "Novo Canal",
    nameLabel: "Nome do Canal",
    namePlaceholder: "Canal de Ofertas",
    secondaryLabel: "Link do Canal",
    secondaryPlaceholder: "https://whatsapp.com/channel/ABC123XYZ",
  },
};

export default function RecipientModal({
  open,
  recipientType,
  onClose,
  onSave,
}: RecipientModalProps) {
  const [form, setForm] = useState(initialState);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const metadata = recipientType ? copyByType[recipientType] : null;

  const inviteCode = useMemo(() => extractInviteCode(form.link), [form.link]);

  const handleClose = useCallback(() => {
    setForm(initialState);
    setError("");
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  if (!open || !recipientType || !metadata) {
    return null;
  }

  const handleSubmit = async () => {
    const draft: RecipientDraft = {
      type: recipientType,
      name: form.name,
      phone: form.phone,
      link: form.link,
      tag: form.tag,
    };
    const validation = validateRecipientDraft(draft);

    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    try {
      setIsSaving(true);
      await onSave(draft);
      handleClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Nao foi possivel salvar.");
    } finally {
      setIsSaving(false);
    }
  };

  const isContact = recipientType === "contact";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <button type="button" className="absolute inset-0" onClick={handleClose} aria-label="Fechar" />

      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-heading text-2xl font-semibold text-white">{metadata.title}</h2>
          <button
            type="button"
            onClick={handleClose}
            className="flex size-8 items-center justify-center rounded-lg border border-zinc-700 text-zinc-400 transition hover:border-green-500 hover:text-green-400"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-zinc-300">{metadata.nameLabel}</label>
            <Input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder={metadata.namePlaceholder}
              className="h-11 rounded-lg border-zinc-700 bg-zinc-800 focus-visible:border-green-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-zinc-300">{metadata.secondaryLabel}</label>
            <Input
              value={isContact ? form.phone : form.link}
              onChange={(event) =>
                setForm((prev) =>
                  isContact
                    ? { ...prev, phone: event.target.value }
                    : { ...prev, link: event.target.value },
                )
              }
              placeholder={metadata.secondaryPlaceholder}
              className="h-11 rounded-lg border-zinc-700 bg-zinc-800 focus-visible:border-green-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-zinc-300">Tag (opcional)</label>
            <Input
              value={form.tag}
              onChange={(event) => setForm((prev) => ({ ...prev, tag: event.target.value }))}
              placeholder="Clientes, Ofertas, VIP..."
              className="h-11 rounded-lg border-zinc-700 bg-zinc-800 focus-visible:border-green-500"
            />
          </div>
        </div>

        {!isContact && inviteCode ? (
          <div className="mt-4 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300">
            <p className="font-medium">Grupo detectado</p>
            <p className="mt-1 flex items-center gap-2 text-green-200">
              <Link2 className="size-4" />
              Invite Code: {inviteCode}
            </p>
          </div>
        ) : null}

        {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

        <div className="mt-6 flex justify-end">
          <Button
            type="button"
            className="bg-green-600 text-white hover:bg-green-500"
            onClick={() => void handleSubmit()}
            disabled={isSaving}
          >
            {isSaving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
