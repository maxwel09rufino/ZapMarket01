import { Link as LinkIcon, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  getRecipientBadgeClass,
  getRecipientTypeLabel,
  type Recipient,
} from "@/lib/recipients";

type ContactsListProps = {
  recipients: Recipient[];
  onRemove: (recipientId: string) => void;
};

function EmptyContacts() {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
      <p className="font-heading text-2xl font-semibold text-zinc-100">Nenhum contato cadastrado</p>
      <p className="mt-2 text-zinc-400">
        Adicione contatos, grupos ou canais para comecar.
      </p>
    </div>
  );
}

export default function ContactsList({ recipients, onRemove }: ContactsListProps) {
  if (recipients.length === 0) {
    return <EmptyContacts />;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm text-zinc-300">
          <thead className="bg-zinc-950/80 text-xs uppercase tracking-wide text-zinc-400">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Telefone / Link</th>
              <th className="px-4 py-3">Tag</th>
              <th className="px-4 py-3 text-right">Acoes</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((recipient) => (
              <tr key={recipient.id} className="border-t border-zinc-800/80">
                <td className="px-4 py-3 font-medium text-zinc-100">{recipient.name}</td>
                <td className="px-4 py-3">
                  <Badge className={getRecipientBadgeClass(recipient.type)}>
                    {getRecipientTypeLabel(recipient.type)}
                  </Badge>
                </td>
                <td className="max-w-[380px] px-4 py-3">
                  {recipient.type === "contact" ? (
                    <span>{recipient.phone}</span>
                  ) : recipient.link ? (
                    <a
                      href={recipient.link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-green-400 hover:text-green-300"
                    >
                      <LinkIcon className="size-4" />
                      <span className="truncate">{recipient.link}</span>
                    </a>
                  ) : (
                    <span className="text-zinc-500">-</span>
                  )}
                </td>
                <td className="px-4 py-3">{recipient.tag ?? <span className="text-zinc-500">-</span>}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onRemove(recipient.id)}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:border-red-500/60 hover:text-red-300"
                  >
                    <Trash2 className="size-3.5" />
                    Remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
