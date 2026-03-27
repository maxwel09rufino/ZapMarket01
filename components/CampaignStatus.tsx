import { AlertCircle, CheckCircle2, Play, Radio, RefreshCcw, Trash2 } from "lucide-react";
import { CampaignEmpty } from "@/components/CampaignEmpty";
import { Button } from "@/components/ui/button";
import type { CampaignRecordDTO } from "@/lib/campaigns/types";
import { cn } from "@/lib/utils";

type CampaignStatusProps = {
  campaigns: CampaignRecordDTO[];
  onStart: (campaignId: string) => void;
  onDelete: (campaign: CampaignRecordDTO) => void;
  startingCampaignId?: string | null;
  deletingCampaignId?: string | null;
};

function formatDateTime(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleString("pt-BR");
}

function getProgress(campaign: CampaignRecordDTO) {
  if (campaign.totalMessages <= 0) {
    return 0;
  }

  return Math.round(
    (
      (campaign.sentCount + campaign.submittedCount + campaign.failedCount) /
      campaign.totalMessages
    ) * 100,
  );
}

function getStatusLabel(status: CampaignRecordDTO["status"]) {
  if (status === "pending") {
    return "Pendente";
  }

  if (status === "sending") {
    return "Enviando";
  }

  if (status === "finished") {
    return "Finalizada";
  }

  return "Com erro";
}

function getStatusClass(status: CampaignRecordDTO["status"]) {
  if (status === "sending") {
    return "border-green-500/30 bg-green-500/10 text-green-200";
  }

  if (status === "finished") {
    return "border-blue-500/30 bg-blue-500/10 text-blue-200";
  }

  if (status === "failed") {
    return "border-red-500/30 bg-red-500/10 text-red-200";
  }

  return "border-zinc-700 bg-zinc-800 text-zinc-200";
}

export default function CampaignStatus({
  campaigns,
  onStart,
  onDelete,
  startingCampaignId = null,
  deletingCampaignId = null,
}: CampaignStatusProps) {
  if (campaigns.length === 0) {
    return (
      <CampaignEmpty
        className="min-h-[420px] rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
        title="Nenhuma campanha"
        description="Crie uma campanha, personalize a mensagem e inicie o disparo real quando quiser."
      />
    );
  }

  return (
    <div className="space-y-4">
      {campaigns.map((campaign) => {
        const progress = getProgress(campaign);
        const isStarting = startingCampaignId === campaign.id;
        const isDeleting = deletingCampaignId === campaign.id;
        const canStart =
          campaign.status === "pending" ||
          (campaign.status === "sending" && campaign.remainingCount > 0) ||
          (campaign.status === "failed" && campaign.remainingCount > 0);
        const canDelete = campaign.status !== "sending";

        return (
          <section
            key={campaign.id}
            className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-[0_0_40px_rgba(0,0,0,0.25)]"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="font-heading text-2xl font-semibold text-white">
                    {campaign.name}
                  </h3>
                  <span
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]",
                      getStatusClass(campaign.status),
                    )}
                  >
                    {getStatusLabel(campaign.status)}
                  </span>
                </div>

                <div className="mt-3 grid gap-3 text-sm text-zinc-300 sm:grid-cols-2 xl:grid-cols-4">
                  <p>Produto: {campaign.productTitle}</p>
                  <p>Escopo: {campaign.selectAllProducts ? "todos os produtos" : "produto unico"}</p>
                  <p>Base: {campaign.delaySeconds}s por envio</p>
                  <p>Destinatarios: {campaign.totalContacts}</p>
                  <p>Produtos no lote: {campaign.productCount}</p>
                  <p>Mensagens totais: {campaign.totalMessages}</p>
                  <p>Restantes: {campaign.remainingCount}</p>
                </div>

                <div className="mt-4 rounded-2xl border border-zinc-800 bg-black/30 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Modelo salvo
                  </p>
                  <p className="max-h-32 overflow-hidden whitespace-pre-line break-words text-sm text-zinc-100">
                    {campaign.previewMessage}
                  </p>
                </div>
              </div>

              <div className="w-full max-w-xs rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="mb-3 flex items-center justify-between text-sm text-zinc-300">
                  <span className="inline-flex items-center gap-2">
                    <Radio className="size-4 text-green-400" />
                    Progresso do lote
                  </span>
                  <span>{progress}%</span>
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-green-500 via-lime-400 to-green-300 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs text-zinc-300 sm:grid-cols-4">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 px-2 py-3">
                    <p className="text-lg font-semibold text-white">{campaign.sentCount}</p>
                    <p>Confirmadas</p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 px-2 py-3">
                    <p className="text-lg font-semibold text-white">{campaign.submittedCount}</p>
                    <p>Submetidas</p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 px-2 py-3">
                    <p className="text-lg font-semibold text-white">{campaign.failedCount}</p>
                    <p>Falhas</p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 px-2 py-3">
                    <p className="text-lg font-semibold text-white">{campaign.remainingCount}</p>
                    <p>Restam</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-xs text-zinc-500">
                  <p>Criada em: {formatDateTime(campaign.createdAt) ?? "--"}</p>
                  <p>Inicio: {formatDateTime(campaign.startedAt) ?? "--"}</p>
                  <p>Fim: {formatDateTime(campaign.finishedAt) ?? "--"}</p>
                </div>

                {campaign.lastError ? (
                  <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                    <p className="inline-flex items-center gap-2 font-medium">
                      <AlertCircle className="size-4" />
                      Ultimo erro
                    </p>
                    <p className="mt-2">{campaign.lastError}</p>
                  </div>
                ) : campaign.submittedCount > 0 ? (
                  <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                    <p className="inline-flex items-center gap-2 font-medium">
                      <AlertCircle className="size-4" />
                      Publicacao sem recibo
                    </p>
                    <p className="mt-2">
                      Envios para canal ficam como submetidos porque o WhatsApp nao devolve
                      confirmacao de publicacao.
                    </p>
                  </div>
                ) : campaign.status === "finished" ? (
                  <div className="mt-4 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-100">
                    <p className="inline-flex items-center gap-2 font-medium">
                      <CheckCircle2 className="size-4" />
                      Campanha concluida
                    </p>
                    <p className="mt-2">O lote terminou e os contadores acima mostram o resultado.</p>
                  </div>
                ) : null}

                {canStart ? (
                  <Button
                    type="button"
                    onClick={() => onStart(campaign.id)}
                    disabled={isStarting || isDeleting}
                    className="mt-4 h-11 w-full bg-green-600 text-white hover:bg-green-500"
                  >
                    {campaign.status === "failed" ? (
                      <RefreshCcw className="size-4" />
                    ) : campaign.status === "sending" ? (
                      <RefreshCcw className="size-4" />
                    ) : (
                      <Play className="size-4" />
                    )}
                    {isStarting
                      ? "Iniciando..."
                      : campaign.status === "failed"
                        ? "Retomar campanha"
                        : campaign.status === "sending"
                          ? "Retomar envio"
                          : "Iniciar campanha"}
                  </Button>
                ) : null}

                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onDelete(campaign)}
                  disabled={!canDelete || isDeleting || isStarting}
                  className="mt-3 h-11 w-full border-red-500/30 text-red-300 hover:text-red-200"
                >
                  <Trash2 className="size-4" />
                  {isDeleting
                    ? "Excluindo..."
                    : canDelete
                      ? "Excluir campanha"
                      : "Campanha em envio"}
                </Button>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
