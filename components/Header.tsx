import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Header() {
  return (
    <header className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
      <div className="space-y-2">
        <h1 className="font-heading text-4xl font-bold tracking-tight text-zinc-50 md:text-[3rem]">
          Visão Geral
        </h1>
        <p className="max-w-2xl text-lg text-zinc-300/90">
          Acompanhe o desempenho das suas automações no WhatsApp.
        </p>
      </div>

      <Button
        className="h-[52px] self-start rounded-2xl px-6 text-lg shadow-[0_0_30px_rgba(34,197,94,0.45)]"
        size="lg"
      >
        <Zap className="size-5" />
        Nova Campanha
      </Button>
    </header>
  );
}
