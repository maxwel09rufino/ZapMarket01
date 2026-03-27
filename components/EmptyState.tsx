import { PackageSearch } from "lucide-react";
import { Card } from "@/components/ui/card";

export default function EmptyState() {
  return (
    <Card className="mx-auto flex min-h-[360px] w-full max-w-4xl items-center justify-center rounded-3xl border-white/15 bg-[#0a0f18]/85 p-8">
      <div className="flex flex-col items-center text-center">
        <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
          <PackageSearch className="size-8 text-zinc-400" />
        </div>
        <h3 className="font-heading text-2xl font-bold text-zinc-100">
          Nenhum produto cadastrado
        </h3>
        <p className="mt-2 max-w-xl text-zinc-400">
          Adicione seu primeiro produto para comecar a gerar mensagens.
        </p>
      </div>
    </Card>
  );
}
