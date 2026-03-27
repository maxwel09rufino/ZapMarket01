import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ConnectionStatus } from "@/lib/dashboard";

type StatusCardProps = {
  status: ConnectionStatus;
};

export function StatusCard({ status }: StatusCardProps) {
  const isConnected = status === "connected";

  return (
    <Card className="rounded-3xl p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={
              isConnected
                ? "flex size-12 items-center justify-center rounded-full bg-emerald-500/20"
                : "flex size-12 items-center justify-center rounded-full bg-red-500/20"
            }
          >
            <Smartphone
              className={isConnected ? "size-5 text-emerald-400" : "size-5 text-red-400"}
            />
          </div>
          <div>
            <p className="text-2xl font-semibold text-zinc-100 md:text-[1.6rem]">WhatsApp API</p>
            <p className="text-xl text-zinc-400 md:text-lg">
              {isConnected ? "Conectado" : "Desconectado"}
            </p>
          </div>
        </div>
        <span
          className={
            isConnected
              ? "size-3 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(34,197,94,0.9)]"
              : "size-3 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.9)]"
          }
        />
      </div>

      <div className="my-5 h-px bg-white/10" />

      <Button
        className="h-12 w-full rounded-2xl text-lg font-semibold"
        disabled={isConnected}
      >
        {isConnected ? "Conectado" : "Conectar Agora"}
      </Button>
    </Card>
  );
}
