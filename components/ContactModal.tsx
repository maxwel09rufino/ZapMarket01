"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ContactModalProps = {
  open: boolean;
  onClose: () => void;
  onSave: (payload: { name: string; phone: string; tag?: string }) => void;
};

const initialState = {
  name: "",
  phone: "",
  tag: "",
};

export default function ContactModal({ open, onClose, onSave }: ContactModalProps) {
  const [form, setForm] = useState(initialState);
  const [error, setError] = useState("");

  const handleClose = useCallback(() => {
    setForm(initialState);
    setError("");
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  if (!open) {
    return null;
  }

  const handleSubmit = () => {
    if (!form.name.trim() || !form.phone.trim()) {
      setError("Nome e WhatsApp sao obrigatorios.");
      return;
    }

    onSave({
      name: form.name.trim(),
      phone: form.phone.trim(),
      tag: form.tag.trim() || undefined,
    });
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0"
        onClick={handleClose}
        aria-label="Fechar"
      />

      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-heading text-2xl font-semibold text-white">Novo Contato</h2>
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
            <label className="mb-1.5 block text-sm text-zinc-300">Nome</label>
            <Input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              className="h-11 rounded-lg border-zinc-700 bg-zinc-800 focus-visible:border-green-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-zinc-300">WhatsApp (com DDD)</label>
            <Input
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
              placeholder="5511999999999"
              className="h-11 rounded-lg border-zinc-700 bg-zinc-800 focus-visible:border-green-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-zinc-300">Lista / Tag (opcional)</label>
            <Input
              value={form.tag}
              onChange={(event) => setForm((prev) => ({ ...prev, tag: event.target.value }))}
              placeholder="Clientes VIP"
              className="h-11 rounded-lg border-zinc-700 bg-zinc-800 focus-visible:border-green-500"
            />
          </div>
        </div>

        {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

        <div className="mt-6 flex justify-end">
          <Button type="button" className="bg-green-600 text-white hover:bg-green-500" onClick={handleSubmit}>
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}
