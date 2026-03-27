import { useMemo, useState } from "react";
import { Link2, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  getRecipientBadgeClass,
  getRecipientTypeLabel,
  isRecipientSendable,
  type Recipient,
  type RecipientType,
} from "@/lib/recipients";

type RecipientsSectionProps = {
  recipients: Recipient[];
  selectedRecipientIds: string[];
  onToggleRecipient: (recipientId: string) => void;
  onToggleSelectAllVisible: (visibleRecipientIds: string[]) => void;
};

const FILTER_OPTIONS: Array<{
  value: "all" | RecipientType;
  label: string;
}> = [
  { value: "all", label: "Todos" },
  { value: "contact", label: "Contatos" },
  { value: "group", label: "Grupos" },
  { value: "channel", label: "Canais" },
];

function getRecipientSecondaryText(recipient: Recipient) {
  if (recipient.type === "contact") {
    return recipient.phone ?? "--";
  }

  return recipient.link ?? "--";
}

function getRecipientHelperText(recipient: Recipient) {
  if (recipient.type === "contact") {
    return "Disparo real disponivel para WhatsApp individual.";
  }

  if (recipient.type === "group") {
    return "Grupo com link de convite valido pode entrar no disparo real da campanha.";
  }

  return "Canal com link valido entra no disparo real da campanha quando o numero conectado tiver permissao para publicar nele.";
}

function isRecipientSelectable(recipient: Recipient) {
  if (recipient.type === "contact") {
    return Boolean(recipient.phone);
  }

  return Boolean(recipient.link);
}

export default function RecipientsSection({
  recipients,
  selectedRecipientIds,
  onToggleRecipient,
  onToggleSelectAllVisible,
}: RecipientsSectionProps) {
  const [activeFilter, setActiveFilter] = useState<"all" | RecipientType>("all");

  const selectedSet = new Set(selectedRecipientIds);
  const countsByType = useMemo(
    () => ({
      contact: recipients.filter((recipient) => recipient.type === "contact").length,
      group: recipients.filter((recipient) => recipient.type === "group").length,
      channel: recipients.filter((recipient) => recipient.type === "channel").length,
    }),
    [recipients],
  );

  const filteredRecipients = useMemo(() => {
    if (activeFilter === "all") {
      return recipients;
    }

    return recipients.filter((recipient) => recipient.type === activeFilter);
  }, [activeFilter, recipients]);

  const visibleSelectableIds = filteredRecipients
    .filter(isRecipientSelectable)
    .map((recipient) => recipient.id);

  const allVisibleSelected =
    visibleSelectableIds.length > 0 &&
    visibleSelectableIds.every((recipientId) => selectedSet.has(recipientId));

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="font-heading text-xl font-semibold text-white">
            2 Destinatarios da Campanha
          </h3>
          <p className="mt-1 text-sm text-zinc-400">
            Contatos, grupos e canais ficam acessiveis na mesma area. O disparo real fica
            disponivel para quem tiver numero, convite ou link de canal valido.
          </p>
        </div>
        <p className="text-sm text-zinc-400">Selecionados na campanha: {selectedRecipientIds.length}</p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((option) => {
          const count =
            option.value === "all"
              ? recipients.length
              : countsByType[option.value];

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setActiveFilter(option.value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                activeFilter === option.value
                  ? "border-green-500/50 bg-green-500/15 text-green-300"
                  : "border-zinc-700 bg-zinc-950/70 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              }`}
            >
              {option.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-zinc-400">
        <button
          type="button"
          onClick={() => onToggleSelectAllVisible(visibleSelectableIds)}
          disabled={visibleSelectableIds.length === 0}
          className="font-medium text-green-500 transition hover:text-green-400 disabled:cursor-not-allowed disabled:text-zinc-600"
        >
          {allVisibleSelected ? "Limpar visiveis" : "Selecionar visiveis"}
        </button>
        <span>Contatos: {countsByType.contact}</span>
        <span>Grupos: {countsByType.group}</span>
        <span>Canais: {countsByType.channel}</span>
      </div>

      {filteredRecipients.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 text-sm text-zinc-400">
          Nenhum destinatario encontrado para este filtro.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRecipients.map((recipient) => {
            const selectable = isRecipientSelectable(recipient);
            const sendable = isRecipientSendable(recipient);

            return (
              <label
                key={recipient.id}
                className={`flex items-start gap-3 rounded-xl border p-4 transition ${
                  selectable
                    ? "cursor-pointer border-zinc-800 bg-zinc-950/60 hover:border-green-500/40"
                    : "cursor-default border-zinc-800/80 bg-zinc-950/40"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(recipient.id)}
                  onChange={() => selectable && onToggleRecipient(recipient.id)}
                  disabled={!selectable}
                  className="mt-1 size-4 rounded border-zinc-600 bg-zinc-800 text-green-500 focus:ring-green-500/40 disabled:cursor-not-allowed disabled:opacity-40"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-zinc-100">{recipient.name}</p>
                    <Badge className={getRecipientBadgeClass(recipient.type)}>
                      {getRecipientTypeLabel(recipient.type)}
                    </Badge>
                    {!sendable ? (
                      <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                        Sem disparo real
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2 text-sm text-zinc-300">
                    {recipient.type === "contact" ? (
                      <p className="inline-flex items-center gap-2">
                        <Phone className="size-4 text-zinc-500" />
                        {getRecipientSecondaryText(recipient)}
                      </p>
                    ) : (
                      <p className="inline-flex items-start gap-2 break-all">
                        <Link2 className="mt-0.5 size-4 text-zinc-500" />
                        <span>{getRecipientSecondaryText(recipient)}</span>
                      </p>
                    )}
                  </div>

                  <p className="mt-2 text-xs text-zinc-500">{getRecipientHelperText(recipient)}</p>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}
