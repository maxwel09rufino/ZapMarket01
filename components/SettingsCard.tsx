import { Clock3, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SettingsCardProps = {
  selectedInterval: number;
  customIntervalInput: string;
  onSelectPreset: (seconds: number) => void;
  onChangeCustomInterval: (value: string) => void;
  onCreateCampaign: () => void;
  isSubmitting?: boolean;
};

const intervals = [60, 120, 180];

export default function SettingsCard({
  selectedInterval,
  customIntervalInput,
  onSelectPreset,
  onChangeCustomInterval,
  onCreateCampaign,
  isSubmitting = false,
}: SettingsCardProps) {
  return (
    <aside className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <h3 className="mb-5 font-heading text-xl font-semibold text-white">Configuracoes</h3>

      <div className="mb-5">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <Clock3 className="size-4 text-green-400" />
          Intervalo de Envio
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          O sistema aplica o atraso escolhido com pequena variacao automatica.
        </p>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {intervals.map((seconds) => (
            <button
              key={seconds}
              type="button"
              onClick={() => onSelectPreset(seconds)}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm font-medium transition",
                selectedInterval === seconds
                  ? "border-green-500 bg-green-600 text-white"
                  : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-green-500/50 hover:text-green-400",
              )}
            >
              {Math.round(seconds / 60)} min
            </button>
          ))}
        </div>

        <div className="mt-4">
          <label className="mb-1.5 block text-sm text-zinc-300">Personalizado (segundos)</label>
          <Input
            value={customIntervalInput}
            onChange={(event) => onChangeCustomInterval(event.target.value)}
            inputMode="numeric"
            placeholder="Ex: 90"
            className="h-11 rounded-lg border-zinc-700 bg-zinc-800 focus-visible:border-green-500"
          />
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-sm text-green-100">
        Anti-bloqueio ativo: fila real, atraso por mensagem e limite de 50 contatos por campanha.
      </div>

      <div className="mb-5 rounded-xl border border-yellow-600/40 bg-yellow-500/10 p-4 text-sm text-yellow-200">
        O aparelho e a sessao do WhatsApp devem permanecer conectados durante todo o disparo.
      </div>

      <Button
        type="button"
        onClick={onCreateCampaign}
        disabled={isSubmitting}
        className="h-11 w-full bg-green-600 text-white hover:bg-green-500"
      >
        <Save className="size-4" />
        {isSubmitting ? "Salvando..." : "Salvar Campanha"}
      </Button>
    </aside>
  );
}
